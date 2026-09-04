import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { IssueInputError, type Issue } from '../lib/issues.ts';
import { compareIssues, issueText } from '../lib/issue-search.ts';
import {
  buildHistory,
  parseHistoryInput,
  searchCompletedIssues,
} from '../lib/issue-history.ts';

const issues = JSON.parse(
  readFileSync(new URL('../data/issues.json', import.meta.url), 'utf8'),
) as Issue[];

void test('completed search excludes all pending issues but uses open reference resources', () => {
  const reference = issues.find((issue) => issue.id === 'WS-024')!;
  const results = searchCompletedIssues(
    issueText(reference),
    issues,
    reference.id,
  );
  assert.equal(
    results.length,
    issues.filter((issue) => issue.status === 'closed').length,
  );
  assert.ok(
    results.every(
      (result) =>
        issues.find((issue) => issue.id === result.issueId)?.status ===
        'closed',
    ),
  );
  assert.ok(results.some((result) => result.resourceScore > 0));
  const withoutReference = searchCompletedIssues('날짜 기준', issues);
  assert.ok(
    withoutReference.every(
      (result) =>
        issues.find((issue) => issue.id === result.issueId)?.status ===
        'closed',
    ),
  );
});

void test('history explores two hops and discovers actual other-team history without a scripted path', () => {
  const reference = issues.find((issue) => issue.id === 'WS-024')!;
  const before = JSON.stringify(issues);
  const result = buildHistory(
    { query: issueText(reference), referenceId: reference.id },
    issues,
  );
  const cause = result.evidence.find((item) => item.issueId === 'WS-021');
  assert.ok(
    cause,
    'UTC shared utility history must be reachable through a relevant historical issue',
  );
  assert.equal(cause.depth, 2);
  assert.ok(cause.viaIssueId);
  assert.ok(
    result.evidence.some(
      (item) => item.issueId === cause.viaIssueId && item.depth === 1,
    ),
  );
  assert.equal(JSON.stringify(issues), before);
  assert.equal(result.engine, 'lexical-resource-v1');
});

void test('history summaries and titles are literal sources, never query-specific rewritten records', () => {
  for (const id of ['WS-008', 'WS-016', 'WS-024']) {
    const reference = issues.find((issue) => issue.id === id)!;
    const result = buildHistory(
      { query: issueText(reference), referenceId: id },
      issues,
    );
    assert.ok(result.evidence.length > 0);
    assert.equal(
      new Set(result.evidence.map((item) => item.issueId)).size,
      result.evidence.length,
    );
    for (const evidence of result.evidence) {
      const source = issues.find((issue) => issue.id === evidence.issueId)!;
      assert.equal(source.status, 'closed');
      assert.equal(evidence.title, source.title);
      assert.equal(evidence.occurredAt, source.occurredAt);
      assert.ok(
        [
          source.body,
          source.resolution?.body,
          ...source.activities.map((activity) => activity.body),
        ].some((text) => text?.includes(evidence.summary)),
      );
      assert.ok(
        Number.isFinite(evidence.score) &&
          evidence.score >= 0 &&
          evidence.score <= 1,
      );
      const parent = issues.find(
        (issue) => issue.id === (evidence.viaIssueId ?? id),
      )!;
      assert.ok(
        evidence.sharedResources.every(
          (key) =>
            source.resources.some((resource) => resource.key.trim() === key) &&
            parent.resources.some((resource) => resource.key.trim() === key),
        ),
      );
    }
  }
});

void test('unknown or inaccessible IDs and open pins are rejected without source leakage', () => {
  for (const raw of [
    { query: '접수', referenceId: 'not-visible' },
    { query: '접수', pinnedIds: ['not-visible'] },
    { query: '접수', pinnedIds: ['WS-024'] },
    { query: '접수', referenceId: 'WS-001', pinnedIds: ['WS-001'] },
    { query: '접수', pinnedIds: Array(31).fill('WS-001') },
    { query: '접수', pinnedIds: [12] },
    { query: ' ' },
    { query: 'x'.repeat(6001) },
    null,
  ])
    assert.throws(() => parseHistoryInput(raw, issues), IssueInputError);
});

void test('unmatched queries return no invented evidence; explicit closed pins remain inspectable', () => {
  assert.deepEqual(
    buildHistory({ query: 'zzzzzznomatchword' }, issues).evidence,
    [],
  );
  const pinned = buildHistory(
    { query: 'zzzzzznomatchword', pinnedIds: ['WS-001', 'WS-001'] },
    issues,
  );
  const chosen = pinned.evidence.find((item) => item.issueId === 'WS-001');
  assert.equal(chosen?.score, 0);
  assert.equal(chosen?.depth, 1);
  assert.equal(
    pinned.evidence.filter((item) => item.issueId === 'WS-001').length,
    1,
  );
});

void test('durable explicit references are traversed both ways even with zero similarity', () => {
  const completed = (id: string, title: string, body: string): Issue => ({
    id,
    title,
    body,
    issueType: '',
    team: 'example',
    occurredAt: '2026-09-04',
    status: 'closed',
    tags: [],
    resources: [],
    activities: [],
    resolution: {
      at: '2026-09-04T00:00:00Z',
      author: 'example',
      body,
      outcome: '',
    },
    attributes: {},
    synthetic: true,
    revision: 1,
  });
  const apples = completed('a', 'apples', 'orchards');
  const circuits = completed('b', 'circuits', 'voltage');
  const pending = {
    ...completed('c', 'pending', 'unfinished'),
    status: 'open' as const,
    resolution: null,
  };
  assert.equal(compareIssues(apples, circuits).score, 0);
  for (const field of ['resolution', 'memory']) {
    const source: Issue =
      field === 'resolution'
        ? {
            ...apples,
            resolution: {
              ...apples.resolution!,
              evidenceIssueIds: ['b', 'b', 'a', 'c', 'missing-private'],
            },
          }
        : {
            ...apples,
            memory: {
              version: 1,
              compiledAt: '2026-09-04T00:00:00Z',
              method: 'extractive-v1',
              sourceRevision: 1,
              terms: [],
              relatedIssueIds: ['b', 'b', 'a', 'c', 'missing-private'],
            },
          };
    const records = [source, circuits, pending];
    const before = JSON.stringify(records);
    const forward = buildHistory({ query: 'apples' }, records);
    const b = forward.evidence.find((item) => item.issueId === 'b');
    assert.equal(b?.depth, 2);
    assert.equal(b?.viaIssueId, 'a');
    assert.equal(b?.score, 0);
    assert.deepEqual(forward.evidence.map((item) => item.issueId).sort(), [
      'a',
      'b',
    ]);
    const reverse = buildHistory({ query: 'circuits' }, records);
    const a = reverse.evidence.find((item) => item.issueId === 'a');
    assert.equal(a?.depth, 2);
    assert.equal(a?.viaIssueId, 'b');
    assert.equal(a?.score, 0);
    assert.deepEqual(reverse.evidence.map((item) => item.issueId).sort(), [
      'a',
      'b',
    ]);
    assert.equal(JSON.stringify(records), before);
  }
});
