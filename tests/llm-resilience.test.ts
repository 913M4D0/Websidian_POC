import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseDelimitedDisplay,
  parseDelimitedDisplayProgress,
  parseDelimitedIssueAnalysis,
  parseDelimitedIssueTestPlan,
  parseDelimitedMemory,
  sourceMemory,
} from '../lib/delimited-output.ts';
import { readOpenRouterTextStream } from '../lib/openrouter-stream.ts';
import { aiResponseStream } from '../lib/ai-response-stream.ts';
import { streamApi } from '../lib/browser-stream.ts';

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

void test('coalesced browser SSE is painted progressively before its result resolves', async () => {
  const content = [
    '<<요약>>',
    '가'.repeat(220),
    '<<확인된맥락>>',
    '<<제목>>과거 이력',
    '<<구분>>사실',
    '<<근거>>WS-001',
    '<<내용>>확인된 내용',
    '<<권장처리>>',
    '<<제목>>안전한 처리',
    '<<구분>>추정',
    '<<근거>>WS-001',
    '<<내용>>원문 범위를 먼저 확인한다.',
    '<<끝>>',
  ].join('\n');
  const transport = [
    `event: delta\r\ndata: ${JSON.stringify({ text: content })}\r\n\r\n`,
    `event: result\r\ndata: ${JSON.stringify({ content })}\r\n\r\n`,
  ].join('');
  let visible = '';
  const snapshots: string[] = [];
  const events: string[] = [];
  const result = await streamApi<{ content: string }>(
    '/coalesced',
    {},
    {
      onDelta(text) {
        visible += text;
        snapshots.push(visible);
        events.push('paint');
      },
    },
    {
      fetcher: async () => streamingResponse([transport]),
      nextFrame: async () => undefined,
    },
  );
  events.push('result');
  assert.equal(result.content, content);
  assert.equal(visible, content);
  assert.ok(snapshots.length > 5);
  assert.ok(snapshots.length < 120);
  assert.equal(events.at(-2), 'paint');
  assert.ok(
    snapshots.some(
      (snapshot) =>
        parseDelimitedDisplayProgress(snapshot, 'analysis')?.blocks.length ===
        1,
    ),
  );
  assert.equal(
    parseDelimitedDisplay(snapshots.at(-1) || '', 'analysis')?.blocks.length,
    3,
  );
});

void test('result-only fallback text is still replayed across visible frames', async () => {
  const content = '구획 생성에 실패한 평문도 글자 단위로 보존한다.';
  const transport = `event: result\ndata: ${JSON.stringify({ content })}\n\n`;
  let visible = '';
  let paints = 0;
  await streamApi<{ content: string }>(
    '/fallback',
    {},
    {
      onDelta(text) {
        visible += text;
        paints += 1;
      },
    },
    {
      fetcher: async () => streamingResponse([transport]),
      nextFrame: async () => undefined,
    },
  );
  assert.equal(visible, content);
  assert.ok(paints > 3);
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
  assert.equal(parseDelimitedDisplay(malformed, 'analysis'), null);
  assert.equal(
    parseDelimitedDisplay(
      `${malformed}\n<<알수없는구획>>값\n<<끝>>`,
      'analysis',
    ),
    null,
  );
  assert.equal(
    parseDelimitedDisplay(`설명 문구\n${malformed}\n<<끝>>`, 'analysis'),
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

void test('known delimiter names still fall back raw when their structure is broken', () => {
  const validAnalysis = [
    '<<요약>>정상 요약',
    '<<확인된맥락>>',
    '<<제목>>확인된 기록',
    '<<구분>>사실',
    '<<근거>>WS-001',
    '<<내용>>원문에 기록된 내용',
    '<<권장처리>>',
    '<<제목>>확인할 조치',
    '<<구분>>추정',
    '<<근거>>WS-001',
    '<<내용>>범위를 먼저 확인한다.',
    '<<끝>>',
  ].join('\n');
  assert.ok(parseDelimitedDisplay(validAnalysis, 'analysis'));

  const malformed = [
    '<<요약>>a<<요약>>b<<끝>>',
    '<<요약>>a<<권장처리>><<제목>>x<<구분>>추정<<근거>>WS-1<<내용>>y<<확인된맥락>><<제목>>z<<구분>>사실<<근거>>WS-1<<내용>>q<<끝>>',
    '<<요약>><<제목>>필드가 잘못 소속됨<<끝>>',
    '<<요약>>a<<확인된맥락>><<제목>>x<<구분>>사실<<근거>>WS-1<<권장처리>><<제목>>r<<구분>>추정<<근거>>WS-1<<내용>>n<<끝>>',
    '<<요약>>a<<확인된맥락>><<제목>>x<<제목>>중복<<구분>>사실<<근거>>WS-1<<내용>>n<<권장처리>><<제목>>r<<구분>>추정<<근거>>WS-1<<내용>>n<<끝>>',
    '<<요약>>a<<확인된맥락>><<제목>><<구분>>사실<<근거>>WS-1<<내용>>n<<권장처리>><<제목>>r<<구분>>추정<<근거>>WS-1<<내용>>n<<끝>>',
    validAnalysis.replace('<<요약>>', '<< 요약 >>'),
    `${validAnalysis}\n뒤쪽 잡문`,
  ];
  for (const output of malformed)
    assert.equal(parseDelimitedDisplay(output, 'analysis'), null, output);
  assert.ok(
    parseDelimitedDisplay(
      validAnalysis.replace('<<구분>>사실', '<<구분>>사실 (원문 근거)'),
      'analysis',
    ),
  );
});

void test('test-case cards require every field, three cases, and valid marker order', () => {
  const testCase = (number: number, overrides = '') =>
    [
      '<<테스트케이스>>',
      `<<번호>>TC-0${number}`,
      `<<제목>>검증 ${number}`,
      '<<우선순위>>필수',
      '<<사전조건>>준비 완료',
      '<<실행단계>>1단계\n2단계\n3단계',
      '<<기대결과>>정상 처리',
      '<<근거>>WS-001',
      overrides,
    ]
      .filter(Boolean)
      .join('\n');
  const valid = [
    '<<전략>>연결된 이력까지 함께 검증한다.',
    testCase(1),
    testCase(2),
    testCase(3),
    '<<회귀범위>>',
    '<<제목>>주변 흐름',
    '<<구분>>추정',
    '<<근거>>WS-001',
    '<<내용>>연결 업무도 확인한다.',
    '<<끝>>',
  ].join('\n');
  assert.ok(parseDelimitedDisplay(valid, 'test-cases'));

  const malformed = [
    ['<<전략>>전략', testCase(1), '<<끝>>'].join('\n'),
    valid.replace('<<기대결과>>정상 처리\n', ''),
    valid.replace(
      '<<번호>>TC-01\n<<제목>>',
      '<<제목>>검증\n<<번호>>TC-01\n<<제목>>',
    ),
  ];
  for (const output of malformed)
    assert.equal(parseDelimitedDisplay(output, 'test-cases'), null, output);

  // Card presentation validates the delimiter contract, not the model's
  // wording. Semantic variants remain visible and are normalized separately.
  for (const output of [
    valid.replace('<<우선순위>>필수', '<<우선순위>>긴급 회귀'),
    valid.replace('1단계\n2단계\n3단계', '한 줄로 1, 2, 3단계를 확인한다.'),
  ])
    assert.ok(parseDelimitedDisplay(output, 'test-cases'), output);
});

void test('memory card schema rejects missing, reversed, or empty fields', () => {
  const validMemory =
    '<<요약>>처리 기억<<핵심어>>주문\n재시도<<분류>><<이름>>영역<<값>>주문\n결제<<끝>>';
  const facetsOnlyMemory =
    '<<요약>>처리 기억<<핵심어>><<분류>><<이름>>영역<<값>>주문<<끝>>';
  assert.ok(parseDelimitedDisplay(validMemory, 'memory'));
  assert.ok(parseDelimitedDisplay(facetsOnlyMemory, 'memory'));
  const reversed = '<<요약>>기억<<핵심어>>a<<분류>><<값>>x<<이름>>y<<끝>>';
  assert.equal(parseDelimitedDisplay(reversed, 'memory'), null, reversed);
  assert.ok(
    parseDelimitedDisplay(
      '<<요약>>기억<<핵심어>>a<<분류>><<이름>>y<<값>>1\n2\n3\n4\n5<<끝>>',
      'memory',
    ),
  );
  assert.ok(parseDelimitedDisplay('<<요약>>기억<<핵심어>><<끝>>', 'memory'));
});

void test('streaming accepts only the unfinished active tail and never loses a literal angle bracket', () => {
  const prefix =
    '<<요약>>요약<<확인된맥락>><<제목>>제목<<구분>>사실<<근거>>WS-1<<내용>>진행 중';
  assert.ok(parseDelimitedDisplayProgress(prefix, 'analysis'));
  assert.equal(
    parseDelimitedDisplayProgress(`${prefix}<`, 'analysis')
      ?.blocks.at(-1)
      ?.fields.at(-1)?.value,
    '진행 중<',
  );
  assert.equal(
    parseDelimitedDisplayProgress(`${prefix}< 비교`, 'analysis')
      ?.blocks.at(-1)
      ?.fields.at(-1)?.value,
    '진행 중< 비교',
  );
  assert.equal(
    parseDelimitedDisplayProgress(
      '<<요약>>요약<<확인된맥락>><<제목>>제목<<구분>>사실<<근거>>WS-1<<권장처리>><<제목>>조치',
      'analysis',
    ),
    null,
  );
  assert.equal(
    parseDelimitedDisplayProgress(
      '<<요약>>요약<<확인된맥락>>잘못된 직접 본문',
      'analysis',
    ),
    null,
  );
});

void test('every grapheme prefix of valid outputs remains card-renderable after the first marker', () => {
  const analysis = [
    '<<요약>>요약',
    '<<확인된맥락>><<제목>>기록<<구분>>사실<<근거>>WS-1<<내용>>내용',
    '<<권장처리>><<제목>>조치<<구분>>추정<<근거>>WS-1<<내용>>처리',
    '<<끝>>',
  ].join('\n');
  const testCase = (id: number) =>
    `<<테스트케이스>><<번호>>TC-0${id}<<제목>>검증<<우선순위>>필수<<사전조건>>준비<<실행단계>>1\n2\n3<<기대결과>>완료<<근거>>WS-1`;
  const outputs = [
    [analysis, 'analysis'],
    [
      `<<전략>>전략\n${testCase(1)}\n${testCase(2)}\n${testCase(3)}\n<<끝>>`,
      'test-cases',
    ],
    ['<<요약>>기억<<핵심어>>검색<<끝>>', 'memory'],
  ] as const;

  for (const [output, kind] of outputs) {
    const graphemes = Array.from(output);
    const firstMarkerEnd = graphemes.indexOf('>') + 2;
    for (let length = firstMarkerEnd; length <= graphemes.length; length += 1) {
      const prefix = graphemes.slice(0, length).join('');
      assert.ok(
        parseDelimitedDisplayProgress(prefix, kind),
        `${kind} failed at ${JSON.stringify(prefix.slice(-24))}`,
      );
    }
  }
});

void test('browser stream reconciles a divergent final result and keeps graphemes intact', async () => {
  const divergent = [
    `event: delta\ndata: ${JSON.stringify({ text: '초안' })}\n\n`,
    `event: result\ndata: ${JSON.stringify({ content: '최종 원문' })}\n\n`,
  ].join('');
  let visible = '';
  await streamApi<{ content: string }>(
    '/divergent',
    {},
    {
      onDelta: (text) => {
        visible += text;
      },
      onReplace: (text) => {
        visible = text;
      },
    },
    {
      fetcher: async () => streamingResponse([divergent]),
      nextFrame: async () => undefined,
    },
  );
  assert.equal(visible, '최종 원문');

  const graphemes: string[] = [];
  const content = '가👨‍👩‍👧‍👦é';
  await streamApi<{ content: string }>(
    '/graphemes',
    {},
    { onDelta: (text) => graphemes.push(text) },
    {
      fetcher: async () =>
        streamingResponse([
          `event: result\ndata: ${JSON.stringify({ content })}\n\n`,
        ]),
      nextFrame: async () => undefined,
    },
  );
  assert.deepEqual(graphemes, ['가', '👨‍👩‍👧‍👦', 'é']);
});

void test('large coalesced output catches up in a bounded number of paints', async () => {
  const content = '가'.repeat(5500);
  const transport = `event: result\ndata: ${JSON.stringify({ content })}\n\n`;
  const chunks: string[] = [];
  await streamApi<{ content: string }>(
    '/large-result',
    {},
    { onDelta: (text) => chunks.push(text) },
    {
      fetcher: async () => streamingResponse([transport]),
      nextFrame: async () => undefined,
    },
  );
  assert.equal(chunks.join(''), content);
  assert.ok(chunks.length <= 100, `painted ${chunks.length} times`);
});

void test('aborting while the paint queue drains cannot resolve a stale result', async () => {
  const controller = new AbortController();
  let enterFrame = () => {};
  let releaseFrame = () => {};
  const entered = new Promise<void>((resolve) => {
    enterFrame = resolve;
  });
  const frame = new Promise<void>((resolve) => {
    releaseFrame = resolve;
  });
  const content = '받은 평문을 화면에 재생하는 중';
  const transport = [
    `event: delta\ndata: ${JSON.stringify({ text: content })}\n\n`,
    `event: result\ndata: ${JSON.stringify({ content })}\n\n`,
  ].join('');
  const request = streamApi<{ content: string }>(
    '/cancel-drain',
    {},
    { onDelta: () => undefined, onReplace: () => undefined },
    {
      fetcher: async () => streamingResponse([transport]),
      nextFrame: async () => {
        enterFrame();
        await frame;
      },
      signal: controller.signal,
    },
  );
  await entered;
  controller.abort();
  releaseFrame();
  await assert.rejects(request, (error: unknown) => {
    assert.equal((error as Error).name, 'AbortError');
    return true;
  });
});

void test('transport failure preserves received plain text and stops pending paints', async () => {
  const encoder = new TextEncoder();
  const content = '수신됐지만 아직 그리지 않은 평문';
  let sent = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            encoder.encode(
              `event: delta\ndata: ${JSON.stringify({ text: content })}\n\n`,
            ),
          );
          return;
        }
        controller.error(new Error('connection lost'));
      },
    }),
  );
  let releaseFrame = () => {};
  const frame = new Promise<void>((resolve) => {
    releaseFrame = resolve;
  });
  let visible = '';
  await assert.rejects(
    streamApi<{ content: string }>(
      '/transport-error',
      {},
      {
        onDelta: (text) => {
          visible += text;
        },
        onReplace: (text) => {
          visible = text;
        },
      },
      {
        fetcher: async () => response,
        nextFrame: async () => frame,
      },
    ),
    /받은 평문은 보존했습니다/,
  );
  assert.equal(visible, content);
  releaseFrame();
  await Promise.resolve();
  assert.equal(visible, content);
});

void test('a tail reset after the complete result still resolves successfully', async () => {
  const encoder = new TextEncoder();
  const content = '완료 원문';
  let sent = false;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            encoder.encode(
              [
                `event: delta\ndata: ${JSON.stringify({ text: content })}\n\n`,
                `event: result\ndata: ${JSON.stringify({ content })}\n\n`,
              ].join(''),
            ),
          );
          return;
        }
        controller.error(new Error('tail reset'));
      },
    }),
  );
  let visible = '';
  const result = await streamApi<{ content: string }>(
    '/tail-reset',
    {},
    {
      onDelta: (text) => {
        visible += text;
      },
      onReplace: (text) => {
        visible = text;
      },
    },
    { fetcher: async () => response, nextFrame: async () => undefined },
  );
  assert.equal(result.content, content);
  assert.equal(visible, content);
});

void test(
  'browser stream finishes through its timer when animation frames are paused',
  { timeout: 1000 },
  async () => {
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'document',
    );
    const animationDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'requestAnimationFrame',
    );
    const cancelDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'cancelAnimationFrame',
    );
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'visible' },
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: () => 1,
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: () => undefined,
    });
    try {
      let visible = '';
      await streamApi<{ content: string }>(
        '/paused-frame',
        {},
        { onDelta: (text) => (visible += text) },
        {
          fetcher: async () =>
            streamingResponse([
              `event: result\ndata: ${JSON.stringify({ content: '완료' })}\n\n`,
            ]),
        },
      );
      assert.equal(visible, '완료');
    } finally {
      for (const [name, descriptor] of [
        ['document', documentDescriptor],
        ['requestAnimationFrame', animationDescriptor],
        ['cancelAnimationFrame', cancelDescriptor],
      ] as const) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    }
  },
);

void test('provider ignores a full message after delta streaming instead of duplicating it', async () => {
  const response = streamingResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: '정상' } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ message: { content: '정상' }, finish_reason: 'stop' }] })}\n`,
    'data: [DONE]\n',
  ]);
  const result = await readOpenRouterTextStream(response);
  assert.equal(result.text, '정상');
});

void test('provider message fallback is one-shot and a NUL-only delta cannot lock its mode', async () => {
  const response = streamingResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: '\u0000' } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ message: { content: '전체 결과' } }] })}\n`,
    `data: ${JSON.stringify({ choices: [{ message: { content: '전체 결과 반복' } }] })}\n`,
    'data: [DONE]\n',
  ]);
  const result = await readOpenRouterTextStream(response);
  assert.equal(result.text, '전체 결과');
  assert.equal(result.completed, true);
});

void test('malformed provider transport marks a preserved answer as partial', async () => {
  const response = streamingResponse([
    `data: ${JSON.stringify({ choices: [{ delta: { content: '보존할 평문' } }] })}\n`,
    'data: not-json\n',
    'data: [DONE]\n',
  ]);
  const result = await readOpenRouterTextStream(response);
  assert.equal(result.text, '보존할 평문');
  assert.equal(result.providerError, true);
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
  assert.match(source, /llm-plain-output[^\n]*\{draft\}/);
  const view = readFileSync(
    new URL('../components/delimited-output-view.tsx', import.meta.url),
    'utf8',
  );
  assert.match(view, /data-output-format="raw"/);
  assert.match(view, /data-output-format="sections"/);
  assert.match(view, /parseDelimitedDisplayProgress/);
  assert.match(view, /is-streaming/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML/);
  const browserStream = readFileSync(
    new URL('../lib/browser-stream.ts', import.meta.url),
    'utf8',
  );
  assert.match(browserStream, /Accept: 'text\/event-stream'/);
  assert.match(browserStream, /await nextFrame\(\)/);
  assert.match(browserStream, /completedText\.startsWith\(receivedText\)/);
  assert.match(source, /performance\.now\(\) - startedAt/);
  assert.match(
    source,
    /DelimitedOutputView content=\{draft\} kind=\{mode\} streaming/,
  );
  assert.doesNotMatch(source, /pendingBirthIds/);
  assert.match(source, /setBirthIssueId\(issue\.id\)/);
  const memoryService = readFileSync(
    new URL('../lib/memory-service.ts', import.meta.url),
    'utf8',
  );
  assert.match(memoryService, /compileModel !== 'source-fallback'/);
});

void test('completed AI results can be copied verbatim with a restricted-browser fallback', () => {
  const source = readFileSync(
    new URL('../components/memory-universe.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /current && !busy &&/);
  assert.match(source, /copyResult\(current\.content/);
  assert.match(source, /navigator\.clipboard\?\.writeText/);
  assert.match(source, /Reflect\.get\(document, 'execCommand'\)/);
  assert.match(source, /결과 전체 복사/);
  assert.match(source, /복사 완료/);
  assert.match(source, /복사 실패 · 다시 시도/);
  assert.match(source, /현재까지 받은 내용 복사/);
});

void test('selected issues use progressive disclosure and the History Brief path is removed', () => {
  const source = readFileSync(
    new URL('../components/memory-universe.tsx', import.meta.url),
    'utf8',
  );
  const css = readFileSync(
    new URL('../app/workbench.css', import.meta.url),
    'utf8',
  );
  const overview = source.indexOf('className="inspector-overview"');
  const aiTools = source.indexOf('className="inspector-ai-tools"');
  const disclosure = source.indexOf('className="inspector-details"');
  const fullBody = source.indexOf('className="original-body"', disclosure);

  assert.ok(overview >= 0 && overview < aiTools);
  assert.ok(disclosure > aiTools && fullBody > disclosure);
  assert.match(source, /compactText\(selected\.body\)/);
  assert.match(source, /key=\{`\$\{selected\.id\}:\$\{selected\.status\}`\}/);
  assert.match(source, /history\?\.evidence\.slice\(0, 8\)\.map/);
  assert.match(source, /onClick=\{\(\) => inspectIssue\(issue\)\}/);
  assert.match(source, /<small>\{shortId\(contextRoot\.id\)\} 기준<\/small>/);
  assert.doesNotMatch(source, /AI History Brief|generateBrief|\/api\/brief/);
  assert.doesNotMatch(source, /className="reroot-button"/);
  assert.match(
    css,
    /\.issue-inspector \.related-issue \{[\s\S]*min-height: 50px/,
  );
  assert.equal(
    existsSync(new URL('../app/api/brief/route.ts', import.meta.url)),
    false,
  );
});
