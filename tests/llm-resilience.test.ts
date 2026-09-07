import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseDelimitedBrief,
  parseDelimitedIssueAnalysis,
  parseDelimitedIssueTestPlan,
  parseDelimitedMemory,
  sourceMemory,
} from '../lib/delimited-output.ts';
import { readOpenRouterTextStream } from '../lib/openrouter-stream.ts';
import { aiResponseStream } from '../lib/ai-response-stream.ts';

function streamingResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

void test('OpenRouter SSE text survives arbitrary chunk boundaries and partial stream errors', async () => {
  const response = streamingResponse([
    'data: {"choices":[{"delta":{"content":"<<전',
    '략>>\\n핵심"}}]}\n\n',
    'data: not-json\n\n',
    'data: {"choices":[{"delta":{"content":" 검증"},"finish_reason":"length"}]}\n\n',
    'data: {"error":{"code":502}}\n\n',
    'data: [DONE]\n\n',
  ]);
  const result = await readOpenRouterTextStream(response);
  assert.equal(result.text, '<<전략>>\n핵심 검증');
  assert.equal(result.finishReason, 'length');
  assert.equal(result.providerError, true);
  assert.equal(result.completed, true);
});

void test('browser SSE sends heartbeat, raw delta, and a final result', async () => {
  const response = aiResponseStream(async ({ emit }) => {
    emit('구획 없는 평문');
    return { content: '구획 없는 평문' };
  });
  const body = await response.text();
  assert.match(
    response.headers.get('content-type') || '',
    /text\/event-stream/,
  );
  assert.match(body, /event: heartbeat/);
  assert.match(body, /event: delta/);
  assert.match(body, /구획 없는 평문/);
  assert.match(body, /event: result/);
});

void test('provider stream keeps already received text when the connection breaks', async () => {
  const encoder = new TextEncoder();
  let sent = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"받은 평문"}}]}\n\n',
            ),
          );
          return;
        }
        controller.error(new Error('connection lost'));
      },
    }),
  );
  const result = await readOpenRouterTextStream(response);
  assert.equal(result.text, '받은 평문');
  assert.equal(result.providerError, true);
  assert.equal(result.completed, false);
});

void test('malformed or missing delimiters never discard non-empty model text', () => {
  const raw = '구획을 지키지 않은 평문 결과도 그대로 표시되어야 합니다.';
  const ids = ['WS-008', 'WS-007'];
  assert.match(parseDelimitedIssueAnalysis(raw, ids).summary, /구획을/);
  assert.match(
    parseDelimitedIssueTestPlan(raw, ids).cases[0].expected,
    /구획을/,
  );
  assert.match(parseDelimitedBrief(raw, ids).summary, /구획을/);
  assert.match(parseDelimitedMemory(raw).summary, /구획을/);
});

void test('delimiter parsing never invents a valid citation for uncited text', () => {
  const parsed = parseDelimitedIssueAnalysis(
    '<<요약>>확정이라고 주장함\n<<확인된맥락>>\n<<제목>>근거 없음\n<<구분>>사실\n<<근거>>NOT-ALLOWED\n<<내용>>확정이라고 주장함\n<<끝>>',
    ['WS-008'],
  );
  assert.deepEqual(parsed.findings[0].evidenceIds, []);
});

void test('completed issues always have a deterministic source memory when AI is unavailable', () => {
  const memory = sourceMemory({
    id: 'WS-X',
    title: '중복 알림 확인',
    body: '알림이 두 번 표시됩니다.',
    issueType: '오류',
    team: '업무팀',
    occurredAt: '2026-09-07',
    status: 'closed',
    tags: ['알림'],
    resources: [],
    activities: [],
    resolution: {
      at: '2026-09-07T00:00:00.000Z',
      author: '담당자',
      body: '중복 구독을 제거했습니다.',
      outcome: '정상화',
    },
    attributes: {},
    synthetic: true,
    revision: 2,
  });
  assert.match(memory.summary, /중복 구독/);
  assert.ok(memory.concepts.includes('알림'));
  assert.ok(memory.facets.some((facet) => facet.name === '처리 결과'));
});

void test('the UI renders provider text directly instead of requiring parsed delimiters', () => {
  const source = readFileSync(
    new URL('../components/memory-universe.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /llm-plain-output[^\n]*\{analysis\.content\}/);
  assert.match(source, /llm-plain-output[^\n]*\{testPlan\.content\}/);
  assert.match(source, /llm-plain-output[^\n]*\{brief\.content\}/);
  assert.match(source, /Accept: 'text\/event-stream'/);
  assert.doesNotMatch(source, /pendingBirthIds/);
  assert.match(source, /setBirthIssueId\(issue\.id\)/);
  const memoryService = readFileSync(
    new URL('../lib/memory-service.ts', import.meta.url),
    'utf8',
  );
  assert.match(memoryService, /compileModel !== 'source-fallback'/);
});
