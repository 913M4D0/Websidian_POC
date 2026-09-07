import { IssueInputError, type Issue } from './issues.ts';
import { compareIssues, searchIssues } from './issue-search.ts';

export type HistoryInput = {
  query: string;
  referenceId?: string;
  pinnedIds?: string[];
};
export type HistoryEvidence = {
  issueId: string;
  title: string;
  occurredAt: string;
  /** A verbatim source excerpt, not a generated interpretation. */
  summary: string;
  score: number;
  depth: 1 | 2;
  viaIssueId?: string;
  sharedResources: string[];
  timeDistanceDays: number | null;
};
export type IssueHistory = {
  query: string;
  referenceId?: string;
  evidence: HistoryEvidence[];
  engine: 'lexical-resource-v1';
};

/** Resolve IDs only against this caller's already-scoped dataset. */
export function parseHistoryInput(raw: unknown, issues: Issue[]): HistoryInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new IssueInputError('히스토리 탐색 요청을 확인해 주세요.');
  const input = raw as Record<string, unknown>;
  if (
    typeof input.query !== 'string' ||
    !input.query.trim() ||
    input.query.length > 6000
  )
    throw new IssueInputError('탐색할 내용을 1~6,000자로 입력해 주세요.');
  if (
    input.referenceId !== undefined &&
    (typeof input.referenceId !== 'string' ||
      !issues.some((issue) => issue.id === input.referenceId))
  )
    throw new IssueInputError('기준 이슈를 확인해 주세요.');
  const pins = input.pinnedIds ?? [];
  if (!Array.isArray(pins) || pins.length > 30)
    throw new IssueInputError('참고 이슈는 최대 30개까지 선택할 수 있습니다.');
  const completed = new Set(
    issues
      .filter((issue) => issue.status === 'closed')
      .map((issue) => issue.id),
  );
  if (
    pins.some(
      (id) =>
        typeof id !== 'string' ||
        !completed.has(id) ||
        id === input.referenceId,
    )
  )
    throw new IssueInputError('참고 이슈를 확인해 주세요.');
  return {
    query: input.query.trim(),
    ...(input.referenceId === undefined
      ? {}
      : { referenceId: input.referenceId as string }),
    pinnedIds: [...new Set(pins as string[])],
  };
}

/** Completed histories only; the open reference still contributes resource matching. */
export function searchCompletedIssues(
  query: string,
  issues: Issue[],
  referenceId?: string,
) {
  const candidates = issues.filter(
    (issue) => issue.status === 'closed' || issue.id === referenceId,
  );
  return searchIssues(query, candidates, referenceId).filter((match) =>
    candidates.some(
      (issue) => issue.id === match.issueId && issue.status === 'closed',
    ),
  );
}

function sourceExcerpt(issue: Issue): string {
  return (
    issue.resolution?.body ||
    issue.activities.at(-1)?.body ||
    issue.body
  ).slice(0, 600);
}

function sharedResources(issue: Issue, reference?: Issue): string[] {
  if (!reference) return [];
  const keys = new Set(
    reference.resources.map((resource) => resource.key.trim()),
  );
  return [
    ...new Set(
      issue.resources
        .map((resource) => resource.key.trim())
        .filter((key) => keys.has(key)),
    ),
  ];
}

/**
 * Deterministic two-hop evidence retrieval. Similarity is a ranking signal, not
 * probability, causation, or an LLM decision. No scenario answer paths are used.
 */
export function buildHistory(raw: HistoryInput, issues: Issue[]): IssueHistory {
  const input = parseHistoryInput(raw, issues);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const reference = input.referenceId ? byId.get(input.referenceId) : undefined;
  const candidates = issues.filter(
    (issue) => issue.status === 'closed' && issue.id !== input.referenceId,
  );
  const candidateIds = new Set(candidates.map((issue) => issue.id));
  const references = new Map(
    candidates.map((issue) => [
      issue.id,
      new Set(
        [
          ...(issue.memory?.relatedIssueIds ?? []),
          ...(issue.resolution?.evidenceIssueIds ?? []),
        ].filter((id) => id !== issue.id && candidateIds.has(id)),
      ),
    ]),
  );
  const ranks = searchCompletedIssues(input.query, issues, input.referenceId);
  const rankById = new Map(ranks.map((rank) => [rank.issueId, rank]));
  const directIds = [
    ...new Set([
      ...(input.pinnedIds ?? []),
      ...ranks
        .filter((rank) => rank.score > 0)
        .slice(0, 5)
        .map((rank) => rank.issueId),
    ]),
  ];
  const evidence = new Map<string, HistoryEvidence>();
  for (const id of directIds) {
    const issue = byId.get(id)!;
    const rank = rankById.get(id);
    evidence.set(id, {
      issueId: id,
      title: issue.title,
      occurredAt: issue.occurredAt,
      summary: sourceExcerpt(issue),
      score: rank?.score ?? 0,
      depth: 1,
      sharedResources: sharedResources(issue, reference),
      timeDistanceDays: rank?.timeDistanceDays ?? null,
    });
  }
  for (const id of directIds) {
    const parent = byId.get(id)!;
    const comparisons = candidates
      .filter((issue) => issue.id !== id)
      .map((issue) => ({ issue, comparison: compareIssues(parent, issue) }))
      .sort(
        (left, right) =>
          right.comparison.score - left.comparison.score ||
          left.issue.id.localeCompare(right.issue.id),
      );
    // Match the memory graph's undirected, durable evidence edges. Explicit
    // references survive the similarity budget even when their score is zero;
    // being consulted during treatment does not establish a causal connection.
    const neighbors = new Map(
      [
        ...comparisons
          .filter(({ comparison }) => comparison.score > 0)
          .slice(0, 4),
        ...comparisons.filter(
          ({ issue }) =>
            references.get(id)!.has(issue.id) ||
            references.get(issue.id)!.has(id),
        ),
      ].map((neighbor) => [neighbor.issue.id, neighbor]),
    );
    for (const { issue, comparison } of neighbors.values()) {
      const existing = evidence.get(issue.id);
      if (existing?.depth === 1) continue;
      const score =
        0.85 * Math.min(rankById.get(id)?.score ?? 0, comparison.score);
      if (existing && existing.score >= score) continue;
      evidence.set(issue.id, {
        issueId: issue.id,
        title: issue.title,
        occurredAt: issue.occurredAt,
        summary: sourceExcerpt(issue),
        score,
        depth: 2,
        viaIssueId: id,
        sharedResources: sharedResources(issue, parent),
        timeDistanceDays: comparison.timeDistanceDays,
      });
    }
  }
  return {
    query: input.query,
    ...(input.referenceId ? { referenceId: input.referenceId } : {}),
    evidence: [...evidence.values()].sort(
      (left, right) =>
        left.depth - right.depth ||
        right.score - left.score ||
        left.issueId.localeCompare(right.issueId),
    ),
    engine: 'lexical-resource-v1',
  };
}
