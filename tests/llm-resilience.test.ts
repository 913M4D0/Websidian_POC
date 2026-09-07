import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseDelimitedBrief,
  parseDelimitedDisplay,
  parseDelimitedDisplayProgress,
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
  assert.equal(response.headers.get('content-encoding'), 'identity');
  assert.match(body, /: {256,}/);
  assert.match(body, /event: heartbeat/);
  assert.match(body, /event: delta/);
  assert.match(body, /구획 없는 평문/);
  assert.match(body, /event: result/);
});

void test('browser SSE flushes a heartbeat before generation completes', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const response = aiResponseStream(async ({ emit }) => {
    await gate;
    emit('첫 구획');
    return { content: '첫 구획' };
  });
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(new TextDecoder().decode(first.value), /event: heartbeat/);
  release();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert.match(rest, /event: delta/);
  assert.match(rest, /event: result/);
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

void test('complete delimiter output is grouped into presentation cards and fields', () => {
  const content = [
    '<<요약>>',
    '현재 이슈의 핵심 맥락입니다.',
    '<<확인된맥락>>',
    '<<제목>>과거 처리 사례',
    '<<구분>>사실',
    '<<근거>>WS-007',
    '<<내용>>과거에는 설정을 되돌렸습니다.',
    '<<권장처리>>',
    '<<제목>>범위 확인',
    '<<구분>>추정',
    '<<근거>>WS-007',
    '<<내용>>적용 범위를 먼저 비교합니다.',
    '<<끝>>',
  ].join('\n');
  const parsed = parseDelimitedDisplay(content, 'analysis');
  assert.ok(parsed);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.blocks.length, 3);
  assert.deepEqual(parsed.blocks[1], {
    label: '확인된맥락',
    body: '',
    fields: [
      { label: '제목', value: '과거 처리 사례' },
      { label: '구분', value: '사실' },
      { label: '근거', value: 'WS-007' },
      { label: '내용', value: '과거에는 설정을 되돌렸습니다.' },
    ],
  });
});

void test('valid streaming prefixes create and fill the active card immediately', () => {
  const first = parseDelimitedDisplayProgress(
    '<<요약>>\n현재 이슈를 분석하고 있',
    'analysis',
  );
  assert.ok(first);
  assert.equal(first.complete, false);
  assert.equal(first.blocks[0].label, '요약');
  assert.equal(first.blocks[0].body, '현재 이슈를 분석하고 있');

  const next = parseDelimitedDisplayProgress(
    '<<요약>>\n현재 이슈를 분석했습니다.\n<<확인된맥락>>\n<<제목>>과거 처',
    'analysis',
  );
  assert.ok(next);
  assert.equal(next.blocks.length, 2);
  assert.deepEqual(next.blocks[1].fields, [
    { label: '제목', value: '과거 처' },
  ]);

  const markerBoundary = parseDelimitedDisplayProgress(
    '<<요약>>\n현재 이슈를 분석했습니다.\n<<확인된맥락>>\n<<제',
    'analysis',
  );
  assert.ok(markerBoundary);
  assert.equal(markerBoundary.blocks.length, 2);
  assert.deepEqual(markerBoundary.blocks[1].fields, []);
});

void test('incomplete or malformed delimiter output falls back without alteration', () => {
  const malformed = [
    '<<요약>>',
    '앞부분은 정상입니다.',
    '<<확인사항>>',
    '<<제목>>닫히지 않은 결과',
    '<<내용>>받은 텍스트는 보존합니다.',
  ].join('\n');
  assert.equal(parseDelimitedDisplay(malformed, 'brief'), null);
  assert.equal(
    parseDelimitedDisplay(`${malformed}\n<<알수없는구획>>값\n<<끝>>`, 'brief'),
    null,
  );
  assert.equal(
    parseDelimitedDisplay(`설명 문구\n${malformed}\n<<끝>>`, 'brief'),
    null,
  );
  assert.equal(
    parseDelimitedDisplay(
      '<<전략>>정상 시작\n<<테스트케이스>깨진 표식\n<<끝>>',
      'test-cases',
    ),
    null,
  );
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

void test('the UI formats complete delimiters and preserves raw streaming or broken output', () => {
  const source = readFileSync(
    new URL('../components/memory-universe.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /DelimitedOutputView content=\{analysis\.content\} kind="analysis"/,
  );
  assert.match(source, /content=\{testPlan\.content\}[\s\S]*kind="test-cases"/);
  assert.match(
    source,
    /DelimitedOutputView content=\{brief\.content\} kind="brief"/,
  );
  assert.match(source, /llm-plain-output[^\n]*\{draft\}/);
  assert.match(source, /llm-plain-output[^\n]*\{briefDraft\}/);
  const view = readFileSync(
    new URL('../components/delimited-output-view.tsx', import.meta.url),
    'utf8',
  );
  assert.match(view, /data-output-format="raw"/);
  assert.match(view, /data-output-format="sections"/);
  assert.match(view, /parseDelimitedDisplayProgress/);
  assert.match(view, /is-streaming/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
  assert.match(source, /performance\.now\(\) - startedAt/);
  assert.match(
    source,
    /DelimitedOutputView content=\{draft\} kind=\{mode\} streaming/,
  );
  assert.match(
    source,
    /content=\{briefDraft\}[\s\S]*kind="brief"[\s\S]*streaming/,
  );
  assert.match(source, /Accept: 'text\/event-stream'/);
  assert.doesNotMatch(source, /pendingBirthIds/);
  assert.match(source, /setBirthIssueId\(issue\.id\)/);
  const memoryService = readFileSync(
    new URL('../lib/memory-service.ts', import.meta.url),
    'utf8',
  );
  assert.match(memoryService, /compileModel !== 'source-fallback'/);
});
