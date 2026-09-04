import type { Issue } from '@/lib/issues';
import { compareIssues } from '@/lib/issue-search';

/** Renderer DTO only. Canonical issues and query results are stored separately. */
export type MemoryNode = {
  id: string;
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
  { nodes: MemoryNode[]; candidates: Map<string, MemoryLink[]> }
>();

function graphCandidates(issues: Issue[]) {
  const cached = graphCache.get(issues);
  if (cached) return cached;
  const nodes: MemoryNode[] = issues.map((issue) => ({
    id: issue.id,
    issueKey: issue.id.startsWith('WS-L-')
      ? `LOCAL · ${issue.id.slice(-6)}`
      : issue.id,
    name: issue.title,
    kind: 'issue',
    cluster: issue.team,
    clusterLabel: issue.team,
    color: colorFor(issue.team),
    occurredAt: issue.occurredAt,
    changedSources: issue.resources.map((resource) => resource.key),
    importance: 0.5,
    x: 0,
    y: 0,
    z: 0,
  }));
  const candidates = new Map<string, MemoryLink[]>(
    issues.map((issue) => [issue.id, []]),
  );
  for (let left = 0; left < issues.length; left += 1) {
    for (let right = left + 1; right < issues.length; right += 1) {
      const a = issues[left];
      const b = issues[right];
      const pair = compareIssues(a, b);
      if (pair.textScore === 0 && pair.resourceScore === 0) continue;
      const [source, target] = [a.id, b.id].sort();
      const edge: MemoryLink = {
        id: `${source}::${target}`,
        source,
        target,
        relation: '관련 기록',
        ...pair,
        timeDistanceDays: pair.timeDistanceDays ?? 0,
      };
      candidates.get(a.id)!.push(edge);
      candidates.get(b.id)!.push(edge);
    }
  }
  for (const list of candidates.values())
    list.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const computed = { nodes, candidates };
  graphCache.set(issues, computed);
  return computed;
}

export function createMemoryGraph(issues: Issue[], neighbors = 4) {
  const { nodes, candidates } = graphCandidates(issues);
  // k-nearest edges limit visual density, not retrieval or the taxonomy.
  const visible = new Map<string, MemoryLink>();
  for (const list of candidates.values()) {
    for (const edge of list.slice(0, neighbors)) visible.set(edge.id, edge);
  }
  return { nodes, links: [...visible.values()] };
}
