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

const issues = JSON.parse(
  readFileSync(new URL('../data/issues.json', import.meta.url), 'utf8'),
) as Issue[];

void test('memory universe contains completed issues only, work issue is an explicit projection', () => {
  const initial = createMemoryGraph(issues);
  assert.equal(initial.nodes.length, 251);
  assert.ok(initial.nodes.every((node) => node.phase === 'memory'));
  assert.ok(
    initial.nodes.every((node) => node.id === `memory:${node.issueId}`),
  );
  const working = createMemoryGraph(issues, 4, 'WS-008');
  assert.equal(working.nodes.length, 252);
  assert.deepEqual(
    working.nodes
      .filter((node) => node.phase === 'active')
      .map((node) => node.id),
    ['active:WS-008'],
  );
  assert.ok(!working.nodes.some((node) => node.issueId === 'WS-016'));
  const canonical = issues.find((issue) => issue.id === 'WS-008')!;
  const projection = working.nodes.find(
    (node) => node.issueId === canonical.id,
  )!;
  assert.equal(projection.name, canonical.title);
  assert.equal(projection.issueKey, canonical.id);
  assert.equal(projection.color, '#d7ba7d');
  assert.deepEqual(
    working.links.filter((link) => !link.id.includes('active:')),
    initial.links,
  );
});

void test('working issue connects by actual relevance only to completed memories', () => {
  const active = issues.find((issue) => issue.id === 'WS-024')!;
  const graph = createMemoryGraph(issues, 4, active.id);
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const link of graph.links) {
    assert.ok(ids.has(linkEndpointId(link.source)));
    assert.ok(ids.has(linkEndpointId(link.target)));
  }
  const activeLinks = graph.links.filter((link) => link.id.includes('active:'));
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
      linkEndpointId(link.target).startsWith('memory:'),
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
  assert.equal(completedGraph.nodes.length, 252);
  assert.ok(completedGraph.nodes.every((node) => node.phase === 'memory'));
  const memory = completedGraph.nodes.find(
    (node) => node.id === 'memory:WS-008',
  )!;
  assert.equal(memory.issueId, issue.id);
  assert.equal(memory.issueKey, issue.id);
  assert.equal(memory.name, issue.title);
  assert.equal(resolved.body, issue.body);
  assert.equal(JSON.stringify(issues), before);
  assert.ok(completedGraph.links.every((link) => !link.id.includes('active:')));
});

void test('unknown or already completed work selections do not fabricate nodes', () => {
  assert.deepEqual(
    createMemoryGraph(issues, 4, 'missing'),
    createMemoryGraph(issues),
  );
  assert.deepEqual(
    createMemoryGraph(issues, 4, 'WS-001'),
    createMemoryGraph(issues),
  );
  const selectedOne = createMemoryGraph(issues, 4, 'WS-016');
  assert.ok(!selectedOne.nodes.some((node) => node.id === 'active:WS-008'));
  assert.equal(
    selectedOne.nodes.filter((node) => node.phase === 'active').length,
    1,
  );
});

void test('empty history and unrelated work issue have safe node-only graphs', () => {
  assert.deepEqual(createMemoryGraph([]), { nodes: [], links: [] });
  const active = issues.find((issue) => issue.id === 'WS-008')!;
  const graph = createMemoryGraph([active], 4, active.id);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].phase, 'active');
  assert.deepEqual(graph.links, []);
  assert.deepEqual(createMemoryGraph([active]), { nodes: [], links: [] });
  assert.deepEqual(createMemoryGraph(issues, 0).links, []);
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
