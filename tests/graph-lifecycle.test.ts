import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveIssue, type Issue } from '../lib/issues.ts';
import { compareIssues } from '../lib/issue-search.ts';
import {
  createMemoryGraph,
  issueNodeId,
  linkEndpointId,
} from '../lib/memory-graph.ts';
import {
  createNebulaLayout,
  rotateNebulaPosition,
} from '../lib/gravity-layout.ts';

const issues = JSON.parse(
  readFileSync(new URL('../data/issues.json', import.meta.url), 'utf8'),
) as Issue[];

void test('first universe contains every issue with open work visibly separated', () => {
  const initial = createMemoryGraph(issues);
  assert.equal(initial.nodes.length, 294);
  assert.equal(
    initial.nodes.filter((node) => node.phase === 'memory').length,
    251,
  );
  assert.equal(
    initial.nodes.filter((node) => node.phase === 'active').length,
    43,
  );
  assert.ok(
    initial.nodes.every(
      (node) =>
        node.id ===
        `${node.phase === 'memory' ? 'memory' : 'active'}:${node.issueId}`,
    ),
  );
  const working = createMemoryGraph(issues, 4, 'WS-008');
  assert.equal(working.nodes.length, 294);
  assert.deepEqual(working, initial);
  assert.ok(working.nodes.some((node) => node.issueId === 'WS-016'));
  const canonical = issues.find((issue) => issue.id === 'WS-008')!;
  const projection = working.nodes.find(
    (node) => node.issueId === canonical.id,
  )!;
  assert.equal(projection.name, canonical.title);
  assert.equal(projection.issueKey, canonical.id);
  assert.equal(projection.color, '#ffffff');
  assert.equal(new Set(working.nodes.map((node) => node.issueId)).size, 294);
});

void test('working issue connects by actual relevance only to completed memories', () => {
  const active = issues.find((issue) => issue.id === 'WS-024')!;
  const graph = createMemoryGraph(issues, 4, active.id);
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const link of graph.links) {
    assert.ok(ids.has(linkEndpointId(link.source)));
    assert.ok(ids.has(linkEndpointId(link.target)));
  }
  const activeNodeId = issueNodeId(active);
  const activeLinks = graph.links.filter(
    (link) =>
      linkEndpointId(link.source) === activeNodeId ||
      linkEndpointId(link.target) === activeNodeId,
  );
  const expected = issues
    .filter((issue) => issue.status === 'closed')
    .map((issue) => ({
      issue,
      pair: compareIssues(active, issue),
      id: [issueNodeId(active), issueNodeId(issue)].sort().join('::'),
    }))
    .filter(({ pair }) => pair.textScore > 0 || pair.resourceScore > 0)
    .sort((a, b) => b.pair.score - a.pair.score || a.id.localeCompare(b.id))
    .slice(0, 4);
  assert.equal(activeLinks.length, 4);
  assert.deepEqual(
    activeLinks.map((link) => link.id),
    expected.map((pair) => pair.id),
  );
  assert.ok(
    activeLinks.every((link) =>
      [linkEndpointId(link.source), linkEndpointId(link.target)].some((id) =>
        id.startsWith('memory:'),
      ),
    ),
  );
});

void test('completion removes active node, adds one memory, and retains issue identity and raw content', () => {
  const issue = issues.find((item) => item.id === 'WS-008')!;
  const before = JSON.stringify(issues);
  const activeGraph = createMemoryGraph(issues, 4, issue.id);
  const resolved = resolveIssue(
    issue,
    {
      expectedRevision: issue.revision,
      body: '공통 중복 방지 모듈 적용과 재시도 테스트를 완료했습니다.',
      outcome: '처리 완료',
    },
    'POC 처리자',
    '2026-09-04T06:00:00.000Z',
  );
  const completedGraph = createMemoryGraph(
    issues.map((record) => (record.id === resolved.id ? resolved : record)),
    4,
    resolved.id,
  );
  assert.ok(activeGraph.nodes.some((node) => node.id === 'active:WS-008'));
  assert.ok(!completedGraph.nodes.some((node) => node.id === 'active:WS-008'));
  assert.equal(
    completedGraph.nodes.filter((node) => node.issueId === issue.id).length,
    1,
  );
  assert.equal(completedGraph.nodes.length, 294);
  assert.equal(
    completedGraph.nodes.filter((node) => node.phase === 'active').length,
    42,
  );
  const memory = completedGraph.nodes.find(
    (node) => node.id === 'memory:WS-008',
  )!;
  assert.equal(memory.issueId, issue.id);
  assert.equal(memory.issueKey, issue.id);
  assert.equal(memory.name, issue.title);
  assert.equal(resolved.body, issue.body);
  assert.equal(JSON.stringify(issues), before);
  assert.ok(
    completedGraph.links.every((link) => !link.id.includes('active:WS-008')),
  );
});

void test('selection never fabricates or hides nodes', () => {
  assert.deepEqual(
    createMemoryGraph(issues, 4, 'missing'),
    createMemoryGraph(issues),
  );
  assert.deepEqual(
    createMemoryGraph(issues, 4, 'WS-001'),
    createMemoryGraph(issues),
  );
  const selectedOne = createMemoryGraph(issues, 4, 'WS-016');
  assert.ok(selectedOne.nodes.some((node) => node.id === 'active:WS-008'));
  assert.equal(
    selectedOne.nodes.filter((node) => node.phase === 'active').length,
    43,
  );
});

void test('empty history and unrelated work issue have safe node-only graphs', () => {
  assert.deepEqual(createMemoryGraph([]), { nodes: [], links: [] });
  const active = issues.find((issue) => issue.id === 'WS-008')!;
  const graph = createMemoryGraph([active], 4, active.id);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].phase, 'active');
  assert.deepEqual(graph.links, []);
  assert.deepEqual(createMemoryGraph([active]), graph);
  assert.deepEqual(createMemoryGraph(issues, 0).links, []);
});

void test('ordered nebula is deterministic, spherical, and grows outward with time', () => {
  const graph = createMemoryGraph(issues);
  const first = createNebulaLayout(graph.nodes, graph.links);
  const reversed = createNebulaLayout(
    [...graph.nodes].reverse(),
    [...graph.links].reverse(),
  );
  assert.equal(first.size, 294);
  for (const [id, point] of first) {
    assert.deepEqual(point, reversed.get(id));
    assert.ok([point.x, point.y, point.z].every(Number.isFinite));
  }
  const rounded = new Set(
    [...first.values()].map(
      (point) =>
        `${point.x.toFixed(5)}:${point.y.toFixed(5)}:${point.z.toFixed(5)}`,
    ),
  );
  assert.equal(rounded.size, graph.nodes.length);
  const ordered = [...graph.nodes].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.issueId.localeCompare(b.issueId),
  );
  const meanRadius = (records: typeof ordered) =>
    records.reduce((sum, node) => {
      const point = first.get(node.id)!;
      return sum + Math.hypot(point.x, point.y, point.z);
    }, 0) / records.length;
  assert.ok(meanRadius(ordered.slice(-24)) > meanRadius(ordered.slice(0, 24)));
  const armOccupancy = Array.from({ length: 5 }, () => 0);
  ordered.forEach((node, index) => {
    const point = first.get(node.id)!;
    const progress = (index + 0.5) / ordered.length;
    let phase = Math.atan2(point.z, point.x) - progress * Math.PI * 4.4;
    phase = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    armOccupancy[
      Math.round((phase / (Math.PI * 2)) * armOccupancy.length) %
        armOccupancy.length
    ] += 1;
  });
  assert.ok(
    Math.max(...armOccupancy) - Math.min(...armOccupancy) <= 12,
    `unbalanced nebula arms: ${armOccupancy.join(',')}`,
  );
  const coordinates = [...first.values()];
  const standardDeviation = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        values.length,
    );
  };
  const axisValues = (['x', 'y', 'z'] as const).map((axis) =>
    coordinates.map((point) => point[axis]),
  );
  const spans = axisValues.map(
    (values) => Math.max(...values) - Math.min(...values),
  );
  const deviations = axisValues.map(standardDeviation);
  assert.ok(
    Math.min(...spans) / Math.max(...spans) > 0.9,
    `non-spherical nebula spans: ${spans.join(',')}`,
  );
  assert.ok(
    Math.min(...deviations) / Math.max(...deviations) > 0.8,
    `non-spherical nebula deviations: ${deviations.join(',')}`,
  );
  const means = axisValues.map(
    (values) => values.reduce((sum, value) => sum + value, 0) / values.length,
  );
  const covariance = axisValues.map((left, leftIndex) =>
    axisValues.map(
      (right, rightIndex) =>
        left.reduce(
          (sum, value, index) =>
            sum +
            (value - means[leftIndex]) * (right[index] - means[rightIndex]),
          0,
        ) / left.length,
    ),
  );
  const determinant =
    covariance[0][0] *
      (covariance[1][1] * covariance[2][2] -
        covariance[1][2] * covariance[2][1]) -
    covariance[0][1] *
      (covariance[1][0] * covariance[2][2] -
        covariance[1][2] * covariance[2][0]) +
    covariance[0][2] *
      (covariance[1][0] * covariance[2][1] -
        covariance[1][1] * covariance[2][0]);
  const sphericity =
    (3 * Math.cbrt(Math.max(0, determinant))) /
    (covariance[0][0] + covariance[1][1] + covariance[2][2]);
  assert.ok(
    sphericity > 0.92,
    `nebula collapsed toward a rotated plane: ${sphericity}`,
  );
});

void test('overview orbit target is rigid and preserves the nebula volume', () => {
  const left = { x: 120, y: -45, z: 80 };
  const right = { x: -36, y: 72, z: 210 };
  const pivot = { x: 47, y: 4, z: -24 };
  const angle = Math.PI * 0.37;
  const rotatedLeft = rotateNebulaPosition(left, angle, pivot);
  const rotatedRight = rotateNebulaPosition(right, angle, pivot);
  const distance = (a: typeof left, b: typeof left) =>
    Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(
    Math.abs(distance(rotatedLeft, pivot) - distance(left, pivot)) < 1e-10,
  );
  assert.ok(
    Math.abs(distance(rotatedLeft, rotatedRight) - distance(left, right)) <
      1e-10,
  );
  assert.deepEqual(rotateNebulaPosition(pivot, angle, pivot), pivot);
  assert.equal(rotatedLeft.y, left.y);
  assert.deepEqual(rotateNebulaPosition(left, 0), left);
});

void test('recorded completion evidence survives the edge budget without implying similarity or causality', () => {
  const makeIssue = (word: string): Issue => ({
    id: word,
    title: word,
    body: word,
    issueType: word,
    team: word,
    occurredAt: '2026-09-04',
    status: 'open',
    tags: [],
    resources: [],
    activities: [],
    resolution: null,
    attributes: {},
    synthetic: false,
    revision: 1,
  });
  const target = resolveIssue(
    makeIssue('alpha'),
    { expectedRevision: 1, body: 'alpha', outcome: 'alpha' },
    'tester',
    '2026-09-04T06:00:00.000Z',
  );
  const source = resolveIssue(
    makeIssue('beta'),
    {
      expectedRevision: 1,
      body: 'beta',
      outcome: 'beta',
      evidenceIssueIds: [target.id],
    },
    'tester',
    '2026-09-04T07:00:00.000Z',
    [target],
  );
  const records = [target, source];
  const before = JSON.stringify(records);
  const graph = createMemoryGraph(records, 0);
  assert.equal(graph.links.length, 1);
  assert.equal(graph.links[0].relation, '처리 시 참고한 기록');
  assert.equal(graph.links[0].score, 0);
  assert.equal(graph.links[0].textScore, 0);
  assert.equal(graph.links[0].resourceScore, 0);
  assert.equal(graph.links[0].score, compareIssues(source, target).score);
  assert.equal(JSON.stringify(records), before);
  // Either stored evidence representation is sufficient; no duplicate edge.
  const { memory: _memory, ...resolutionOnly } = source;
  assert.equal(createMemoryGraph([target, resolutionOnly], 0).links.length, 1);
  const memoryOnly = {
    ...source,
    resolution: { ...source.resolution!, evidenceIssueIds: [] },
  };
  assert.equal(createMemoryGraph([target, memoryOnly], 0).links.length, 1);
  // Defensive filtering: stale, self, missing, or unfinished targets add no edges.
  const open = makeIssue('gamma');
  const invalidTargets = {
    ...source,
    memory: {
      ...source.memory!,
      relatedIssueIds: [source.id, open.id, 'missing'],
    },
    resolution: { ...source.resolution!, evidenceIssueIds: [] },
  };
  assert.deepEqual(
    createMemoryGraph([target, invalidTargets, open], 0, open.id).links,
    [],
  );
});
