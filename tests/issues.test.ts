import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IssueInputError,
  parseCreateIssue,
  resolveIssue,
  type Issue,
} from '../lib/issues.ts';
import { compareIssues, searchIssues } from '../lib/issue-search.ts';

const draft = {
  title: '접수 재시도 시 중복 등록',
  body: '응답 지연 이후 재시도하면 같은 신청서가 두 번 접수됩니다.',
  issueType: '새로운 업무 분류',
  team: '고객지원',
  occurredAt: '2026-09-04',
  tags: ['자율 분류', '자율 분류'],
  resources: [
    { key: 'procedure:reception', label: '접수 처리 지침', kind: '업무 절차' },
  ],
  attributes: { '대기 시간(분)': 12, '임의 평가 기준': '확인 필요' },
};
function fixture(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    ...parseCreateIssue(draft),
    status: 'open',
    activities: [],
    resolution: null,
    synthetic: false,
    revision: 1,
    ...overrides,
  };
}

void test('free classifications and attributes are accepted; protected fields are omitted', () => {
  const parsed = parseCreateIssue({
    ...draft,
    id: 'injected',
    status: 'closed',
    source: { platform: 'spoofed' },
  });
  assert.deepEqual(parsed.tags, ['자율 분류']);
  assert.equal(parsed.issueType, '새로운 업무 분류');
  assert.equal(parsed.attributes['대기 시간(분)'], 12);
  assert.equal('id' in parsed, false);
  assert.equal('status' in parsed, false);
  assert.equal('source' in parsed, false);
});

void test('validation rejects impossible dates, invalid attribute values, and oversized text', () => {
  assert.throws(
    () => parseCreateIssue({ ...draft, occurredAt: '2026-02-30' }),
    IssueInputError,
  );
  assert.throws(
    () => parseCreateIssue({ ...draft, title: 'a'.repeat(241) }),
    IssueInputError,
  );
  assert.throws(
    () => parseCreateIssue({ ...draft, attributes: { invalid: Number.NaN } }),
    IssueInputError,
  );
  assert.throws(
    () => parseCreateIssue({ ...draft, attributes: { invalid: [] } }),
    IssueInputError,
  );
  assert.throws(() => parseCreateIssue(null), IssueInputError);
});

void test('defaults and empty resource collections require no fixed taxonomy', () => {
  const parsed = parseCreateIssue({
    title: '회의실 예약 요청',
    body: '새 공간의 예약 방법 확인 요청',
    occurredAt: '2026-09-04',
  });
  assert.deepEqual(parsed.tags, []);
  assert.deepEqual(parsed.resources, []);
  assert.deepEqual(parsed.attributes, {});
  assert.equal(typeof parsed.issueType, 'string');
});

void test('resolve preserves identity and original record; appends an audited treatment', () => {
  const issue = fixture({
    source: {
      platform: 'github',
      externalId: '24',
      url: 'https://github.com/example/repo/issues/24',
    },
  });
  const before = JSON.stringify(issue);
  const resolved = resolveIssue(
    issue,
    {
      expectedRevision: 1,
      body: '접수 식별키로 기존 건을 조회한 뒤 중복을 차단했습니다.',
      outcome: '처리 완료',
      title: 'should not replace',
      bodyOverride: 'ignored',
      tags: ['예외 처리'],
      attributes: { '새 평가 항목': 3 },
    },
    'actor-1',
    '2026-09-04T05:00:00Z',
  );
  assert.equal(JSON.stringify(issue), before);
  assert.equal(resolved.id, issue.id);
  assert.equal(resolved.title, issue.title);
  assert.equal(resolved.body, issue.body);
  assert.deepEqual(resolved.source, issue.source);
  assert.equal(resolved.status, 'closed');
  assert.equal(resolved.revision, 2);
  assert.equal(resolved.activities.length, 1);
  assert.equal(resolved.activities[0].author, 'actor-1');
  assert.equal(resolved.resolution?.author, 'actor-1');
  assert.equal(resolved.attributes['대기 시간(분)'], 12);
  assert.equal(resolved.attributes['새 평가 항목'], 3);
});

void test('resolve rejects missing/stale revision and already closed issues', () => {
  const issue = fixture();
  assert.throws(
    () =>
      resolveIssue(
        issue,
        { body: '내용', outcome: '결과' },
        'actor',
        '2026-09-04',
      ),
    (error: unknown) =>
      error instanceof IssueInputError && error.status === 400,
  );
  assert.throws(
    () =>
      resolveIssue(
        issue,
        { expectedRevision: 2, body: '내용', outcome: '결과' },
        'actor',
        '2026-09-04',
      ),
    (error: unknown) =>
      error instanceof IssueInputError && error.status === 409,
  );
  assert.throws(
    () =>
      resolveIssue(
        { ...issue, status: 'closed' },
        { expectedRevision: 1, body: '내용', outcome: '결과' },
        'actor',
        '2026-09-04',
      ),
    (error: unknown) =>
      error instanceof IssueInputError && error.status === 409,
  );
});

void test('queries produce distinct rankings without modifying issue records', () => {
  const records = [
    fixture(),
    fixture({
      id: 'issue-2',
      title: '완료 문서의 부서명 보존',
      body: '승인 완료 시점의 소속 정보를 보존하는 정책입니다.',
      resources: [],
      tags: ['기록관리'],
    }),
    fixture({
      id: 'issue-3',
      title: '점심 메뉴',
      body: '식당 운영 안내',
      resources: [],
      tags: [],
    }),
  ];
  const before = JSON.stringify(records);
  assert.equal(searchIssues('중복 신청서 접수', records)[0].issueId, 'issue-1');
  assert.equal(searchIssues('승인 소속 보존', records)[0].issueId, 'issue-2');
  assert.equal(JSON.stringify(records), before);
  assert.equal(searchIssues('zzzz-nomatch', records).length, 3);
  assert.ok(
    searchIssues('zzzz-nomatch', records).every((result) => result.score === 0),
  );
});

void test('Korean bigrams connect words despite different particles and classifications', () => {
  const records = [
    fixture({
      id: 'match',
      title: '신청서가 중복으로 접수되었습니다',
      body: '재시도 요청 확인',
      issueType: '다른 분류',
      tags: [],
    }),
    fixture({
      id: 'other',
      title: '회의실 조명',
      body: '전등 교체',
      resources: [],
      tags: [],
    }),
  ];
  assert.equal(searchIssues('신청서는 중복접수', records)[0].issueId, 'match');
  assert.ok(searchIssues('신청서는 중복접수', records)[0].textScore > 0);
});

void test('shared non-code resources and actual dates are observable evidence, not causation', () => {
  const reference = fixture();
  const earlier = fixture({
    id: 'earlier',
    title: '담당자 확인 기준',
    body: '접수 과정 검토',
    occurredAt: '2026-09-01',
  });
  const match = searchIssues(
    '접수 처리 지침',
    [reference, earlier],
    reference.id,
  );
  assert.equal(match.length, 1);
  assert.equal(match[0].resourceScore, 1);
  assert.equal(match[0].timeDistanceDays, 3);
  assert.ok(
    match[0].evidence.some((evidence) =>
      evidence.includes('procedure:reception'),
    ),
  );
  assert.ok(match[0].evidence.every((evidence) => !evidence.includes('원인')));
  assert.equal(compareIssues(reference, earlier).resourceScore, 1);
  assert.equal(compareIssues(reference, earlier).timeDistanceDays, 3);
});

void test('empty search keeps complete pagination and no invented match evidence', () => {
  const records = [fixture(), fixture({ id: 'issue-2' })];
  const results = searchIssues('   ', records);
  assert.equal(results.length, 2);
  assert.ok(
    results.every(
      (result) =>
        result.score === 0 &&
        result.evidence.length === 0 &&
        result.timeDistanceDays === null,
    ),
  );
});

void test('pair scores are symmetric, finite, bounded and accept no resources', () => {
  const left = fixture({ resources: [] });
  const right = fixture({
    id: 'issue-2',
    resources: [],
    title: '다른 업무',
    body: '예산 검토',
    tags: [],
  });
  const forward = compareIssues(left, right);
  const reverse = compareIssues(right, left);
  assert.ok(Math.abs(forward.textScore - reverse.textScore) < 1e-12);
  assert.ok(Math.abs(forward.score - reverse.score) < 1e-12);
  const score = compareIssues(left, right);
  assert.ok(score.score >= 0 && score.score <= 1);
  assert.equal(score.resourceScore, 0);
});
