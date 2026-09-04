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
