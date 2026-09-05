import type { Issue } from './issues.ts';
import { compareIssues } from './issue-search.ts';

/** Renderer DTO only. Canonical issues and query results are stored separately. */
export type MemoryNode = {
  id: string;
  /** Stable canonical issue identity; visual identity changes on completion. */
  issueId: string;
  phase: 'active' | 'memory';
  issueKey: string;
  name: string;
  kind: 'issue';
  cluster: string;
  clusterLabel: string;
  color: string;
  occurredAt: string;
  changedSources: string[];
  importance: number;
  x: number;
  y: number;
  z: number;
  fx?: number;
  fy?: number;
  fz?: number;
  vx?: number;
  vy?: number;
  vz?: number;
};
export type MemoryLink = {
  id: string;
  source: string | MemoryNode;
  target: string | MemoryNode;
  relation: string;
  score: number;
  textScore: number;
  resourceScore: number;
  semanticScore?: number;
  timeDistanceDays: number;
};
export type MemoryCluster = {
  id: string;
  korean: string;
  color: string;
  lane: number;
};

export function colorFor(value: string) {
  let hash = 0;
  for (const char of value)
    hash = (Math.imul(31, hash) + char.charCodeAt(0)) | 0;
  return [
    '#4ec9b0',
    '#c586c0',
    '#ce9178',
    '#569cd6',
    '#b5cea8',
    '#dcdcaa',
    '#9cdcfe',
    '#d16969',
  ][Math.abs(hash) % 8];
}

export function getClusters(nodes: MemoryNode[]): MemoryCluster[] {
  return [...new Set(nodes.map((node) => node.cluster))]
    .sort()
    .map((id, lane) => ({ id, korean: id, color: colorFor(id), lane }));
}

export function linkEndpointId(endpoint: string | MemoryNode) {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

const graphCache = new WeakMap<
  Issue[],
  {
    nodes: MemoryNode[];
    candidates: Map<string, MemoryLink[]>;
    evidenceLinks: MemoryLink[];
    activeCandidates: Map<string, MemoryLink[]>;
  }
>();

export function issueNodeId(issue: Pick<Issue, 'id' | 'status'>) {
  return `${issue.status === 'closed' ? 'memory' : 'active'}:${issue.id}`;
}

function issueToNode(issue: Issue): MemoryNode {
  return {
    id: issueNodeId(issue),
    issueId: issue.id,
    phase: issue.status === 'closed' ? 'memory' : 'active',
    issueKey: issue.id,
    name: issue.title,
    kind: 'issue',
    cluster: issue.team,
    clusterLabel: issue.team,
    // Amber marks the work in progress; selection still changes brightness only.
    color: issue.status === 'open' ? '#d7ba7d' : colorFor(issue.team),
    occurredAt: issue.occurredAt,
    changedSources: issue.resources.map((resource) => resource.key),
    importance: 0.5,
    x: 0,
    y: 0,
    z: 0,
  };
}

function issueLink(a: Issue, b: Issue, referenced = false): MemoryLink | null {
  const pair = compareIssues(a, b);
  if (!referenced && pair.textScore === 0 && pair.resourceScore === 0)
    return null;
  const [source, target] = [issueNodeId(a), issueNodeId(b)].sort();
  return {
    id: `${source}::${target}`,
    source,
    target,
    // A human recorded this reference while resolving an issue. It is not a
    // causal claim, and its actual similarity score is never increased.
    relation: referenced ? '처리 시 참고한 기록' : '관련 기록',
    ...pair,
    timeDistanceDays: pair.timeDistanceDays ?? 0,
  };
}

function compareLinks(a: MemoryLink, b: MemoryLink) {
  return b.score - a.score || a.id.localeCompare(b.id);
}

function graphCandidates(issues: Issue[]) {
  const cached = graphCache.get(issues);
  if (cached) return cached;
  const completed = issues.filter((issue) => issue.status === 'closed');
  const completedIds = new Set(completed.map((issue) => issue.id));
  const references = new Map(
    completed.map((issue) => [
      issue.id,
      new Set(
        [
          ...(issue.memory?.relatedIssueIds ?? []),
          ...(issue.resolution?.evidenceIssueIds ?? []),
        ].filter((id) => id !== issue.id && completedIds.has(id)),
      ),
    ]),
  );
  const nodes = completed.map(issueToNode);
  const evidenceLinks: MemoryLink[] = [];
  const candidates = new Map<string, MemoryLink[]>(
    nodes.map((node) => [node.id, []]),
  );
  for (let left = 0; left < completed.length; left += 1) {
    for (let right = left + 1; right < completed.length; right += 1) {
      const a = completed[left];
      const b = completed[right];
      const referenced =
        references.get(a.id)!.has(b.id) || references.get(b.id)!.has(a.id);
      const edge = issueLink(a, b, referenced);
      if (!edge) continue;
      if (referenced) evidenceLinks.push(edge);
      candidates.get(issueNodeId(a))!.push(edge);
      candidates.get(issueNodeId(b))!.push(edge);
    }
  }
  for (const list of candidates.values()) list.sort(compareLinks);
  const computed = {
    nodes,
    candidates,
    evidenceLinks,
    activeCandidates: new Map<string, MemoryLink[]>(),
  };
  graphCache.set(issues, computed);
  return computed;
}

/**
 * Completed issues form durable memory. An explicitly opened work item is a
 * temporary projection, never another stored issue or a permanent memory.
 */
export function createMemoryGraph(
  issues: Issue[],
  neighbors = 4,
  activeIssueId?: string | null,
  semanticArtifacts: {
    issueId: string;
    semanticNeighbors: { issueId: string; score: number }[];
  }[] = [],
) {
  const { nodes, candidates, evidenceLinks, activeCandidates } =
    graphCandidates(issues);
  const limit = Number.isFinite(neighbors)
    ? Math.max(0, Math.floor(neighbors))
    : 4;
  // k-nearest edges limit visual density, not retrieval or the taxonomy.
  // Explicit resolution evidence remains visible outside the top-k budget;
  // references are not similarity guesses and must not disappear on a slider.
  const visible = new Map<string, MemoryLink>(
    evidenceLinks.map((link) => [link.id, link]),
  );
  for (const list of candidates.values()) {
    for (const edge of list.slice(0, limit)) visible.set(edge.id, edge);
  }
  const completedById = new Map(
    issues
      .filter((issue) => issue.status === 'closed')
      .map((issue) => [issue.id, issue]),
  );
  for (const artifact of semanticArtifacts) {
    const sourceIssue = completedById.get(artifact.issueId);
    if (!sourceIssue) continue;
    for (const neighbor of artifact.semanticNeighbors.slice(0, limit)) {
      const targetIssue = completedById.get(neighbor.issueId);
      if (!targetIssue || targetIssue.id === sourceIssue.id) continue;
      const pair = compareIssues(sourceIssue, targetIssue);
      const [source, target] = [
        issueNodeId(sourceIssue),
        issueNodeId(targetIssue),
      ].sort();
      const id = `${source}::${target}`;
      const existing = visible.get(id);
      visible.set(id, {
        id,
        source,
        target,
        relation:
          existing?.relation === '처리 시 참고한 기록'
            ? existing.relation
            : '의미상 가까운 기록',
        textScore: pair.textScore,
        resourceScore: pair.resourceScore,
        semanticScore: neighbor.score,
        score:
          0.55 * neighbor.score +
          0.3 * pair.textScore +
          0.15 * pair.resourceScore,
        timeDistanceDays: pair.timeDistanceDays ?? 0,
      });
    }
  }
  const active = issues.find(
    (issue) => issue.id === activeIssueId && issue.status === 'open',
  );
  if (!active) return { nodes, links: [...visible.values()] };

  // Work-item selection cannot displace links between existing memories.
  let activeLinks = activeCandidates.get(active.id);
  if (!activeLinks) {
    activeLinks = issues
      .filter((issue) => issue.status === 'closed')
      .map((issue) => issueLink(active, issue))
      .filter((link): link is MemoryLink => link !== null)
      .sort(compareLinks);
    activeCandidates.set(active.id, activeLinks);
  }
  for (const edge of activeLinks.slice(0, limit)) visible.set(edge.id, edge);
  return {
    nodes: [...nodes, issueToNode(active)],
    links: [...visible.values()],
  };
}
