import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseCreateIssue, type Issue } from '../lib/issues.ts';
import { issueText, searchIssues, compareIssues } from '../lib/issue-search.ts';

const issues = JSON.parse(
  readFileSync(new URL('../data/issues.json', import.meta.url), 'utf8'),
) as Issue[];
void test('294 source-neutral issue records and 24 GitHub drafts, no embedded query answers', () => {
  assert.equal(issues.length, 294);
  assert.equal(new Set(issues.map((issue) => issue.id)).size, 294);
  for (const issue of issues) {
    parseCreateIssue(issue);
    assert.equal(issue.synthetic, true);
    assert.equal(issue.status === 'closed', Boolean(issue.resolution));
    for (const field of [
      'scenario',
      'expectedBrief',
      'relevance',
      'isStory',
      'intent',
      'risk',
    ])
      assert.equal(field in issue, false);
  }
  const drafts = JSON.parse(
    readFileSync(
      new URL('../data/github-issue-drafts.json', import.meta.url),
      'utf8',
    ),
  ) as { seedId: string }[];
  assert.equal(drafts.length, 24);
  assert.equal(new Set(drafts.map((draft) => draft.seedId)).size, 24);
  assert.deepEqual(
    issues
      .slice(0, 24)
      .filter((issue) => issue.status === 'open')
      .map((issue) => issue.id),
    ['WS-008', 'WS-016', 'WS-024'],
  );
});
void test('24 GitHub bindings attach only to representative issue identities', () => {
  const drafts = JSON.parse(
    readFileSync(
      new URL('../data/github-issue-drafts.json', import.meta.url),
      'utf8',
    ),
  ) as { seedId: string }[];
  const bindings = JSON.parse(
    readFileSync(
      new URL('../data/github-bindings.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, NonNullable<Issue['source']>>;
  assert.equal(Object.keys(bindings).length, 24);
  assert.deepEqual(
    Object.keys(bindings).sort(),
    drafts.map((draft) => draft.seedId).sort(),
  );
  const seedIds = new Set(issues.map((issue) => issue.id));
  const sources = Object.values(bindings);
  assert.equal(new Set(sources.map((source) => source.externalId)).size, 24);
  assert.equal(new Set(sources.map((source) => source.url)).size, 24);
  for (const [id, source] of Object.entries(bindings)) {
    assert.ok(seedIds.has(id));
    assert.equal(source.platform, 'github');
    assert.match(source.externalId, /^[1-9]\d*$/);
    assert.equal(
      source.url,
      `https://github.com/913M4D0/Websidian_POC/issues/${source.externalId}`,
    );
  }
  const linkedIssues = issues.map((issue) => ({
    ...issue,
    source: bindings[issue.id],
  }));
  assert.equal(linkedIssues.length, 294);
  assert.equal(new Set(linkedIssues.map((issue) => issue.id)).size, 294);
  assert.equal(linkedIssues.filter((issue) => issue.source).length, 24);
});
void test('real scenario data is searchable and query state leaves source records unchanged', () => {
  const before = JSON.stringify(issues);
  for (const id of ['WS-008', 'WS-016', 'WS-024']) {
    const issue = issues.find((item) => item.id === id)!;
    const results = searchIssues(issueText(issue), issues, id);
    assert.equal(results.length, 293);
    assert.ok(results[0].score > 0);
    assert.ok(!results.some((result) => result.issueId === id));
  }
  assert.equal(JSON.stringify(issues), before);
  const pair = compareIssues(
    issues.find((issue) => issue.id === 'WS-022')!,
    issues.find((issue) => issue.id === 'WS-021')!,
  );
  assert.ok(pair.resourceScore > 0);
  assert.equal(pair.timeDistanceDays, 8);
});

void test('representative demo reset is owner-scoped and restores the seed overlay', () => {
  const store = readFileSync(
    new URL('../lib/issue-store.ts', import.meta.url),
    'utf8',
  );
  const memoryStore = readFileSync(
    new URL('../lib/memory-store.ts', import.meta.url),
    'utf8',
  );
  const route = readFileSync(
    new URL('../app/api/issues/[id]/reset-demo/route.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    store,
    /resettableDemoIds = new Set\(\['WS-008', 'WS-016', 'WS-024'\]\)/,
  );
  assert.match(
    store,
    /DELETE FROM websidian_issues WHERE owner_id = \? AND id = \? AND revision = \?/,
  );
  assert.match(
    memoryStore,
    /DELETE FROM websidian_memory_artifacts WHERE owner_id = \? AND issue_id = \?/,
  );
  assert.match(route, /authenticate\(request, true\)/);
  assert.match(route, /deleteMemoryArtifact\(actor, id\)/);
});
