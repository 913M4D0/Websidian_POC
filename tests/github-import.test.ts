import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../lib/api-security.ts';
import {
  mapGitHubIssue,
  nextGitHubPage,
  parseGitHubRepository,
  type GitHubIssueRecord,
} from '../lib/github-import.ts';

const repository = parseGitHubRepository(
  'https://github.com/913M4D0/Websidian_POC/issues/24',
);
const raw: GitHubIssueRecord = {
  id: 987654321,
  node_id: 'I_kwDO-test',
  number: 24,
  title: '주문 승인 후 중복 알림',
  body: '승인 화면에서 동일 알림이 두 번 표시됩니다.',
  state: 'closed',
  state_reason: 'not_planned',
  html_url: 'https://github.com/913M4D0/Websidian_POC/issues/24',
  url: 'https://api.github.com/repos/913M4D0/Websidian_POC/issues/24',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
  closed_at: '2026-08-03T00:00:00Z',
  user: { login: 'reporter' },
  closed_by: { login: 'owner' },
  labels: [{ name: '기획 확인' }],
  assignees: [{ login: '업무팀' }],
};

void test('GitHub repository parser accepts only a github.com HTTPS source', () => {
  assert.deepEqual(repository, {
    owner: '913M4D0',
    repo: 'Websidian_POC',
    slug: '913M4D0/Websidian_POC',
  });
  assert.equal(
    parseGitHubRepository('913M4D0/Websidian_POC').slug,
    repository.slug,
  );
  for (const value of [
    'http://github.com/owner/repo',
    'https://api.github.com/repos/owner/repo',
    'https://github.com.evil.test/owner/repo',
    'file:///etc/passwd',
    'owner',
  ])
    assert.throws(() => parseGitHubRepository(value), ApiError);
});

void test('GitHub mapping preserves provider facts without inventing resolution meaning', () => {
  const issue = mapGitHubIssue(
    raw,
    [
      {
        id: 55,
        issue_url: raw.url,
        body: '기획 의도된 동작으로 확인했습니다.',
        created_at: '2026-08-02T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
        user: { login: 'planner' },
      },
      {
        id: 56,
        issue_url: `${String(raw.url)}-other`,
        body: '다른 이슈 댓글',
        created_at: '2026-08-02T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
      },
    ],
    repository,
    '2026-09-05T00:00:00Z',
  );
  assert.equal(issue.id, 'WS-GH-987654321');
  assert.equal(issue.status, 'closed');
  assert.equal(issue.source?.externalId, '987654321');
  assert.equal(issue.source?.number, 24);
  assert.equal(issue.source?.stateReason, 'not_planned');
  assert.equal(issue.resolution?.outcome, 'GitHub 닫힘 · not_planned');
  assert.match(issue.resolution!.body, /원인은 원본 기록을 확인/);
  assert.doesNotMatch(issue.resolution!.body, /해결 완료|수정 완료/);
  assert.equal(issue.activities.length, 1);
  assert.equal(issue.activities[0].body, '기획 의도된 동작으로 확인했습니다.');
});

void test('pull requests are rejected and pagination cannot escape api.github.com repository path', () => {
  assert.throws(
    () =>
      mapGitHubIssue(
        { ...raw, pull_request: {} },
        [],
        repository,
        '2026-09-05',
      ),
    ApiError,
  );
  assert.throws(
    () =>
      mapGitHubIssue(
        { ...raw, html_url: 'javascript:alert(1)' },
        [],
        repository,
        '2026-09-05',
      ),
    ApiError,
  );
  const valid =
    '<https://api.github.com/repos/913M4D0/Websidian_POC/issues?page=2>; rel="next"';
  assert.match(nextGitHubPage(valid, repository, 'issues')!, /page=2/);
  assert.throws(
    () =>
      nextGitHubPage(
        '<https://evil.test/steal?page=2>; rel="next"',
        repository,
        'issues',
      ),
    ApiError,
  );
});
