import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { demoResolutionDefaults } from '../lib/demo-scenarios.ts';
import {
  buildIssueInsightContext,
  buildIssueInsightRequest,
  parseIssueAnalysisOutput,
  parseIssueTestPlanOutput,
} from '../lib/issue-insight.ts';
import type { Issue } from '../lib/issues.ts';

const issues = JSON.parse(
  readFileSync(new URL('../data/issues.json', import.meta.url), 'utf8'),
) as Issue[];
const model = {
  id: 'openai/gpt-5.6-luna',
  effort: 'max',
  maxTokens: 16000,
};

void test('three representative roots automatically retrieve their designed histories', () => {
  const expected = {
    'WS-008': {
      direct: ['WS-007', 'WS-001', 'WS-003', 'WS-004', 'WS-005'],
      connected: ['WS-002', 'WS-006'],
    },
    'WS-016': {
      direct: ['WS-015', 'WS-009', 'WS-014', 'WS-010', 'WS-013'],
      connected: ['WS-011', 'WS-012'],
    },
    'WS-024': {
      direct: ['WS-019', 'WS-017', 'WS-022', 'WS-020', 'WS-023'],
      connected: ['WS-018', 'WS-021'],
    },
  } as const;
  for (const [id, route] of Object.entries(expected)) {
    const before = JSON.stringify(issues);
    const { context, history } = buildIssueInsightContext(id, issues);
    assert.equal(context.rootIssue.id, id);
    assert.deepEqual(
      history.evidence
        .filter((item) => item.depth === 1)
        .map((item) => item.issueId),
      route.direct,
    );
    for (const connected of route.connected)
      assert.ok(
        history.evidence.some(
          (item) => item.depth === 2 && item.issueId === connected,
        ),
      );
    assert.deepEqual(context.citationIds, [
      id,
      ...context.relatedHistories.map((item) => item.issueId),
    ]);
    assert.equal(JSON.stringify(issues), before);
  }
});

void test('analysis and test plan reject invented citations and unexpected fields', () => {
  const available = ['WS-008', 'WS-007'];
  const analysis = {
    summary: '합성 이력에서 재시도 처리 흐름을 우선 확인합니다.',
    findings: [
      {
        title: '공통 처리 확인',
        text: '파트너 경로의 적용 상태를 확인해야 합니다.',
        kind: 'fact',
        evidenceIds: ['WS-007'],
      },
    ],
    risks: [],
    recommendations: [
      {
        title: '재시도 검증',
        text: '같은 구매 시도의 식별자가 유지되는지 검증합니다.',
        kind: 'inference',
        evidenceIds: ['WS-008', 'WS-007'],
      },
    ],
    openQuestions: ['승인 상태와 주문 상태가 일치하는가?'],
  } as const;
  assert.deepEqual(parseIssueAnalysisOutput(analysis, available), analysis);
  assert.throws(() =>
    parseIssueAnalysisOutput(
      {
        ...analysis,
        findings: [{ ...analysis.findings[0], evidenceIds: ['NOT-A-SOURCE'] }],
      },
      available,
    ),
  );
  assert.throws(() =>
    parseIssueAnalysisOutput(
      { ...analysis, execute: 'close issue' },
      available,
    ),
  );

  const testPlan = {
    strategy: '재시도와 장시간 지연을 함께 검증합니다.',
    cases: [
      {
        id: 'TC-01',
        title: '응답 지연 뒤 재시도',
        priority: 'critical',
        preconditions: ['시험 주문이 준비되어 있다.'],
        steps: ['주문 응답을 지연한다.', '같은 화면에서 다시 시도한다.'],
        expected: '주문은 한 건만 생성된다.',
        evidenceIds: ['WS-008', 'WS-007'],
      },
    ],
    regressionScope: [
      {
        title: '기존 채널',
        text: '기존 주문 채널의 재시도도 함께 확인합니다.',
        kind: 'inference',
        evidenceIds: ['WS-007'],
      },
    ],
  } as const;
  assert.deepEqual(parseIssueTestPlanOutput(testPlan, available), testPlan);
  assert.throws(() =>
    parseIssueTestPlanOutput(
      {
        ...testPlan,
        cases: [{ ...testPlan.cases[0], priority: 'optional' }],
      },
      available,
    ),
  );
});

void test('automatic provider requests stream concise delimiter text with endpoint fallback', () => {
  const { context } = buildIssueInsightContext('WS-008', issues);
  for (const kind of ['analysis', 'test-cases'] as const) {
    const request = buildIssueInsightRequest(model, context, kind);
    assert.equal(request.model, 'openai/gpt-5.6-luna');
    assert.deepEqual(request.reasoning, { effort: 'max', exclude: true });
    assert.equal(request.stream, true);
    assert.equal(request.service_tier, 'priority');
    assert.equal(request.max_tokens, 16000);
    assert.equal(request.provider.allow_fallbacks, true);
    assert.equal('require_parameters' in request.provider, false);
    assert.equal(request.provider.data_collection, 'deny');
    assert.equal(request.provider.sort, 'latency');
    assert.equal('tools' in request, false);
    assert.equal('response_format' in request, false);
    assert.match(request.messages[0].content, /<<끝>>/);
    assert.match(request.messages[0].content, /Never return JSON/);
    assert.match(request.messages[1].content, /WS-008/);
    assert.doesNotMatch(request.messages[0].content, /파트너 주문 화면/);
  }
});

void test('WS-008 is the only representative issue with safe demo completion defaults', () => {
  const defaults = demoResolutionDefaults('WS-008');
  assert.ok(defaults);
  assert.match(defaults.body, /WS-007/);
  assert.match(defaults.body, /WS-001·WS-003/);
  assert.match(defaults.outcome, /중복 접수 방지/);
  assert.match(defaults.resources, /submit-order\.test\.ts/);
  assert.equal(demoResolutionDefaults('WS-016'), null);
  assert.equal(demoResolutionDefaults('WS-024'), null);
});
