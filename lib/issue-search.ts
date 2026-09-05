import type { Issue } from './issues.ts';

/**
 * Transparent lexical retrieval v1; not embeddings, LLM inference, or proof of cause.
 * Tags/types are low-weight hints, never a prerequisite or hard taxonomy filter.
 */
export type IssueComparison = {
  score: number;
  textScore: number;
  resourceScore: number;
  timeDistanceDays: number | null;
};
export type IssueSearchResult = IssueComparison & {
  issueId: string;
  evidence: string[];
  /** Present only when the server has a same-model semantic index. */
  semanticScore?: number;
};

type Bag = Map<string, number>;
const cache = new WeakMap<Issue, Bag>();
const normalize = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase('ko-KR');

export function issueText(issue: Issue): string {
  return [
    issue.id,
    issue.title,
    issue.body,
    ...issue.activities.map((activity) => activity.body),
    issue.resolution?.body ?? '',
    issue.resolution?.outcome ?? '',
    ...(issue.memory?.terms ?? []),
    ...issue.resources.flatMap((resource) => [resource.key, resource.label]),
  ].join('\n');
}

function tokenize(value: string): string[] {
  const tokens: string[] = [];
  const words = normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    if (word.length < 2) continue;
    tokens.push(`w:${word}`);
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/u.test(word)) {
      const characters = Array.from(word);
      for (let index = 0; index < characters.length - 1; index += 1) {
        tokens.push(`b:${characters[index]}${characters[index + 1]}`);
      }
    }
  }
  return tokens;
}

function add(bag: Bag, value: string, weight: number): void {
  for (const token of tokenize(value))
    bag.set(token, (bag.get(token) ?? 0) + weight);
}

function issueBag(issue: Issue): Bag {
  const existing = cache.get(issue);
  if (existing) return existing;
  const bag: Bag = new Map();
  add(bag, issue.id, 1);
  add(bag, issue.title, 2);
  add(bag, issue.body, 1);
  for (const activity of issue.activities) add(bag, activity.body, 0.8);
  // Resolution body is also an activity after completion: index it once.
  if (
    issue.resolution &&
    !issue.activities.some(
      (activity) => activity.body === issue.resolution?.body,
    )
  ) {
    add(bag, issue.resolution.body, 0.8);
  }
  add(bag, issue.resolution?.outcome ?? '', 0.5);
  add(bag, issue.memory?.terms.join(' ') ?? '', 0.35);
  add(bag, issue.tags.join(' '), 0.1);
  add(bag, issue.issueType, 0.1);
  for (const resource of issue.resources)
    add(bag, `${resource.key} ${resource.label}`, 0.4);
  cache.set(issue, bag);
  return bag;
}

function cosine(left: Bag, right: Bag, idf?: Map<string, number>): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const weight = (token: string, count: number) =>
    Math.log1p(count) * (idf?.get(token) ?? 1);
  for (const [token, count] of left) {
    const value = weight(token, count);
    leftNorm += value * value;
    if (right.has(token)) dot += value * weight(token, right.get(token)!);
  }
  for (const [token, count] of right) {
    const value = weight(token, count);
    rightNorm += value * value;
  }
  return leftNorm && rightNorm
    ? Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)))
    : 0;
}

function resourceKeys(issue: Issue): Set<string> {
  return new Set(
    issue.resources.map((resource) => resource.key.trim()).filter(Boolean),
  );
}

function sharedKeys(left: Issue, right: Issue): string[] {
  const rightKeys = resourceKeys(right);
  return [...resourceKeys(left)].filter((key) => rightKeys.has(key));
}

function resourceSimilarity(left: Issue, right: Issue): number {
  const leftKeys = resourceKeys(left);
  const rightKeys = resourceKeys(right);
  if (!leftKeys.size || !rightKeys.size) return 0;
  const shared = [...leftKeys].filter((key) => rightKeys.has(key)).length;
  return shared / (leftKeys.size + rightKeys.size - shared);
}

function timeDistance(left: Issue, right?: Issue): number | null {
  if (!right) return null;
  const first = Date.parse(left.occurredAt);
  const second = Date.parse(right.occurredAt);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  return Math.round(Math.abs(first - second) / 86400000);
}

/** The date is evidence only: temporal proximity does not establish causality. */
export function compareIssues(left: Issue, right: Issue): IssueComparison {
  const textScore = cosine(issueBag(left), issueBag(right));
  const resourceScore = resourceSimilarity(left, right);
  return {
    textScore,
    resourceScore,
    timeDistanceDays: timeDistance(left, right),
    score: 0.75 * textScore + 0.25 * resourceScore,
  };
}

/** Return all records ranked, including zero matches; the UI controls pagination. */
export function searchIssues(
  query: string,
  issues: Issue[],
  excludeId?: string,
): IssueSearchResult[] {
  const cleanQuery = query.trim();
  const queryBag: Bag = new Map();
  add(queryBag, cleanQuery, 1);
  const reference = excludeId
    ? issues.find((issue) => issue.id === excludeId)
    : undefined;
  const candidates = issues.filter((issue) => issue.id !== excludeId);
  const documentFrequency = new Map<string, number>();
  for (const issue of candidates) {
    for (const token of issueBag(issue).keys())
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const idf = new Map(
    [...documentFrequency].map(([token, count]) => [
      token,
      Math.log(1 + (candidates.length + 1) / (count + 1)),
    ]),
  );
  const normalizedQuery = normalize(cleanQuery);
  return candidates
    .map((issue): IssueSearchResult => {
      const bag = issueBag(issue);
      const textScore = cleanQuery ? cosine(queryBag, bag, idf) : 0;
      const matchedResources = cleanQuery
        ? issue.resources.filter((resource) => {
            const key = normalize(resource.key).trim();
            const label = normalize(resource.label).trim();
            return (
              (key.length >= 2 && normalizedQuery.includes(key)) ||
              (label.length >= 2 && normalizedQuery.includes(label))
            );
          })
        : [];
      const matchingKeys =
        reference && cleanQuery ? sharedKeys(reference, issue) : [];
      const resourceScore = !cleanQuery
        ? 0
        : Math.max(
            matchedResources.length
              ? matchedResources.length / Math.max(1, issue.resources.length)
              : 0,
            reference ? resourceSimilarity(reference, issue) : 0,
          );
      const evidence: string[] = [];
      const matches = [...queryBag.keys()].filter((token) => bag.has(token));
      const wholeWords = matches.filter((token) => token.startsWith('w:'));
      const fragments = matches.filter(
        (token) =>
          token.startsWith('b:') &&
          !wholeWords.some((word) => word.slice(2).includes(token.slice(2))),
      );
      const terms = [
        ...new Set(
          [...wholeWords, ...fragments].map((token) => token.slice(2)),
        ),
      ].slice(0, 6);
      if (terms.length)
        evidence.push(`원문·처리기록 검색어 일치: ${terms.join(', ')}`);
      if (matchedResources.length)
        evidence.push(
          `검색어에 포함된 자료: ${matchedResources.map((resource) => resource.label).join(', ')}`,
        );
      if (matchingKeys.length)
        evidence.push(`같은 자료 식별자: ${matchingKeys.join(', ')}`);
      return {
        issueId: issue.id,
        textScore,
        resourceScore,
        timeDistanceDays: timeDistance(issue, reference),
        score: 0.8 * textScore + 0.2 * resourceScore,
        evidence,
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.issueId.localeCompare(right.issueId),
    );
}
