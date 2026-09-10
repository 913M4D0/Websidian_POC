import { createRequire } from 'node:module';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);

function option(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

const liveLlm = process.argv.includes('--live-llm');
const url = option(
  'url',
  'http://localhost:3000/signin-with-chatgpt?return_to=/',
);
const outputPath = resolve(
  option('output', 'output/submission/03_WEBSIDIAN_DEMO.mp4'),
);
const ffmpeg = option('ffmpeg', process.env.WEBSIDIAN_FFMPEG_PATH || 'ffmpeg');
const playwrightPath =
  process.env.WEBSIDIAN_PLAYWRIGHT_PATH || option('playwright', 'playwright');

const { chromium } = require(playwrightPath);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const analysisContent = `<<요약>>
파트너 주문 재시도에서 동일 구매 건이 두 번 접수된 현상입니다. 과거 공통 모듈 변경 뒤 같은 장애가 발생해 롤백했던 기록과, 파트너 채널만 공통 요청 처리 계약에서 빠져 있던 점검 기록이 함께 연결됩니다. 모든 데이터는 실무 유사 합성 POC 자료입니다.
<<확인된맥락>>
<<제목>>재시도 요청 식별자 미유지
<<구분>>사실
<<근거>>WS-008,WS-007
<<내용>>파트너 어댑터는 공통 요청 처리 계약 미적용 상태이며, 연결 지연 뒤 다시 시도할 때 서로 다른 주문번호가 생성됐습니다.
<<확인된맥락>>
<<제목>>과거 동일 장애와 롤백 이력
<<구분>>사실
<<근거>>WS-005,WS-006
<<내용>>처리 중 상태를 시간만으로 해제한 변경은 중복 승인 장애를 만들었고, 해당 버전은 롤백 뒤 사용 금지 처리됐습니다.
<<확인된맥락>>
<<제목>>공통 처리 모듈 재사용 가능성
<<구분>>추정
<<근거>>WS-002,WS-003,WS-007
<<내용>>파트너 경로도 구매 시도 단위 식별자와 검증된 공통 모듈을 적용하면 별도 중복 로직 없이 같은 원칙으로 정리할 수 있습니다.
<<주의할위험>>
<<제목>>영향 주문 임의 정리 위험
<<구분>>사실
<<근거>>WS-008,WS-005
<<내용>>이미 접수된 주문은 삭제부터 하지 말고 승인·취소·최종 주문 상태를 먼저 대조해야 합니다.
<<권장처리>>
<<제목>>파트너 요청 키 수명주기 확인
<<구분>>사실
<<근거>>WS-003,WS-007
<<내용>>동일 구매 시도의 최초 요청과 재시도에 같은 식별자가 전달되는지 먼저 확인합니다.
<<권장처리>>
<<제목>>검증된 공통 모듈 적용
<<구분>>추정
<<근거>>WS-002,WS-006
<<내용>>철회된 1.3.0을 제외하고 회귀 시험이 포함된 버전의 적용 범위를 검토합니다.
<<권장처리>>
<<제목>>장시간 승인 지연 회귀 시험
<<구분>>사실
<<근거>>WS-005,WS-006
<<내용>>15초 승인 지연과 반복 재시도 조건에서 주문 실행이 한 번인지 확인합니다.
<<추가확인>>파트너 어댑터가 요청 식별자를 새로 발급하는 정확한 시점을 확인해야 합니다.
<<끝>>`;

const testContent = `<<전략>>
동일 구매 시도 재전송, 장시간 승인 지연, 새로운 구매 시도의 구분을 핵심 축으로 검증합니다. 과거 장애의 롤백 조건을 필수 회귀 범위로 포함합니다. 모든 데이터는 실무 유사 합성 POC 자료입니다.
<<테스트케이스>>
<<번호>>TC-01
<<제목>>연결 지연 뒤 동일 주문 재시도
<<우선순위>>필수
<<사전조건>>파트너 주문 화면에서 상품 3개를 선택한다.
응답을 10초 지연할 수 있다.
<<실행단계>>주문을 한 번 요청한다.
연결 지연 안내가 보이면 다시 시도를 누른다.
접수 목록과 승인 내역을 조회한다.
<<기대결과>>주문번호와 승인은 각각 한 건이며 동일 구매 시도 키가 유지된다.
<<근거>>WS-008,WS-003,WS-005
<<테스트케이스>>
<<번호>>TC-02
<<제목>>15초 승인 지연 중 반복 재시도
<<우선순위>>필수
<<사전조건>>외부 승인 응답을 15초 지연한다.
검증된 공통 모듈 버전을 적용한다.
<<실행단계>>주문 요청을 보낸다.
3초와 8초 시점에 같은 요청을 다시 보낸다.
모든 응답과 최종 주문을 확인한다.
<<기대결과>>처리 중 상태가 유지되고 실행은 한 번이며 완료 뒤 같은 주문 결과를 반환한다.
<<근거>>WS-005,WS-006
<<테스트케이스>>
<<번호>>TC-03
<<제목>>수량 변경 후 새로운 구매 시도
<<우선순위>>높음
<<사전조건>>첫 주문이 정상 완료되어 있다.
같은 화면에서 상품 수량을 변경한다.
<<실행단계>>수량을 3개에서 4개로 변경한다.
새 주문을 요청한다.
이전 주문과 새 주문의 식별자를 비교한다.
<<기대결과>>새 구매 시도에는 새 식별자가 발급되고 이전 주문 결과와 섞이지 않는다.
<<근거>>WS-003,WS-008
<<회귀범위>>
<<제목>>공통 요청 처리 모듈 사용 채널
<<구분>>사실
<<근거>>WS-002,WS-007
<<내용>>모바일·웹 채널의 기존 재시도 동작과 파트너 채널 적용 결과를 함께 점검합니다.
<<회귀범위>>
<<제목>>철회 버전 재유입 방지
<<구분>>사실
<<근거>>WS-005,WS-006
<<내용>>시간 경과만으로 처리 중 상태를 해제하는 1.3.0 동작이 빌드에 포함되지 않았는지 확인합니다.
<<끝>>`;

function responsePayload(kind, content) {
  const analysis = {
    summary: '',
    findings: [],
    risks: [],
    recommendations: [],
    openQuestions: [],
  };
  const testPlan = { strategy: '', cases: [], regressionScope: [] };
  return {
    kind,
    rootIssueId: 'WS-008',
    evidenceIds:
      kind === 'analysis'
        ? ['WS-002', 'WS-003', 'WS-005', 'WS-006', 'WS-007', 'WS-008']
        : ['WS-002', 'WS-003', 'WS-005', 'WS-006', 'WS-007', 'WS-008'],
    ...(kind === 'analysis' ? { analysis } : { testPlan }),
    content,
    modelId: 'demo-deterministic-stream',
    reasoning: 'not-invoked',
    generatedAt: new Date().toISOString(),
    engine: 'source-fallback',
  };
}

function ffmpegAvailable(command) {
  const check = spawnSync(command, ['-version'], {
    windowsHide: true,
    encoding: 'utf8',
  });
  return !check.error && check.status === 0;
}

if (!ffmpegAvailable(ffmpeg)) {
  throw new Error(
    'ffmpeg를 찾지 못했습니다. --ffmpeg <경로> 또는 WEBSIDIAN_FFMPEG_PATH를 지정해 주세요.',
  );
}

mkdirSync(dirname(outputPath), { recursive: true });
const workspaceRoot = resolve('.');
const captureDir = resolve(workspaceRoot, 'tmp/demo-video-capture');
const captureRelative = relative(workspaceRoot, captureDir);
if (
  !captureRelative ||
  captureRelative.startsWith('..') ||
  isAbsolute(captureRelative)
) {
  throw new Error('임시 녹화 경로가 프로젝트 작업공간 밖에 있습니다.');
}
rmSync(captureDir, { recursive: true, force: true });
mkdirSync(captureDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: captureDir, size: { width: 1280, height: 720 } },
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
});

if (!liveLlm) {
  await context.addInitScript(
    ({ analysis, analysisResult, tests, testsResult }) => {
      const originalFetch = window.fetch.bind(window);
      const makeStream = (content, result) => {
        const encoder = new TextEncoder();
        const chunks = Array.from(content.matchAll(/[\s\S]{1,18}/g), (m) => m[0]);
        let index = -1;
        const stream = new ReadableStream({
          start(controller) {
            const push = () => {
              index += 1;
              if (index === 0) {
                controller.enqueue(
                  encoder.encode(
                    `event: heartbeat\ndata: ${JSON.stringify({ elapsedMs: 0 })}\n\n`,
                  ),
                );
              }
              if (index < chunks.length) {
                controller.enqueue(
                  encoder.encode(
                    `event: delta\ndata: ${JSON.stringify({ text: chunks[index] })}\n\n`,
                  ),
                );
                setTimeout(push, 105);
                return;
              }
              controller.enqueue(
                encoder.encode(
                  `event: result\ndata: ${JSON.stringify(result)}\n\n`,
                ),
              );
              controller.close();
            };
            setTimeout(push, 900);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      };
      window.fetch = (input, init) => {
        const target =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);
        const pathname = new URL(target, window.location.href).pathname;
        if (pathname.endsWith('/api/issues/WS-008/analyze'))
          return Promise.resolve(makeStream(analysis, analysisResult));
        if (pathname.endsWith('/api/issues/WS-008/test-cases'))
          return Promise.resolve(makeStream(tests, testsResult));
        return originalFetch(input, init);
      };
    },
    {
      analysis: analysisContent,
      analysisResult: responsePayload('analysis', analysisContent),
      tests: testContent,
      testsResult: responsePayload('test-cases', testContent),
    },
  );
}

const page = await context.newPage();
const video = page.video();

async function setCaption(chapter, title, description) {
  await page.evaluate(
    ({ chapter, title, description, live }) => {
      let overlay = document.querySelector('#websidian-demo-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'websidian-demo-overlay';
        overlay.innerHTML =
          '<div class="demo-brand"><b>WEBSIDIAN</b><span></span></div><div class="demo-caption"><small></small><strong></strong><p></p></div><div class="demo-disclosure"></div>';
        document.body.appendChild(overlay);
        const style = document.createElement('style');
        style.textContent = `
          #websidian-demo-overlay { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: "Malgun Gothic", "Noto Sans KR", sans-serif; color: #f5f7fa; }
          #websidian-demo-overlay .demo-brand { position: absolute; left: 28px; top: 22px; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid rgba(255,255,255,.16); background: rgba(8,12,18,.76); backdrop-filter: blur(12px); border-radius: 7px; box-shadow: 0 10px 34px rgba(0,0,0,.24); letter-spacing: .15em; font-size: 12px; }
          #websidian-demo-overlay .demo-brand span { width: 6px; height: 6px; border-radius: 999px; background: #75efbc; box-shadow: 0 0 14px #75efbc; }
          #websidian-demo-overlay .demo-caption { position: absolute; left: 50%; bottom: 28px; width: min(710px, calc(100vw - 48px)); transform: translateX(-50%); padding: 15px 20px 16px; border: 1px solid rgba(255,255,255,.2); background: rgba(7,11,17,.88); backdrop-filter: blur(16px); border-radius: 9px; box-shadow: 0 18px 55px rgba(0,0,0,.42); }
          #websidian-demo-overlay .demo-caption small { display: block; color: #75efbc; font-size: 11px; font-weight: 700; letter-spacing: .16em; margin-bottom: 5px; }
          #websidian-demo-overlay .demo-caption strong { display: block; font-size: 21px; line-height: 1.35; letter-spacing: -.025em; }
          #websidian-demo-overlay .demo-caption p { margin: 4px 0 0; color: #b8c1cc; font-size: 13px; line-height: 1.5; }
          #websidian-demo-overlay .demo-disclosure { position: absolute; right: 18px; top: 20px; padding: 6px 9px; color: #aeb8c4; background: rgba(8,12,18,.7); border-radius: 5px; font-size: 10px; }
        `;
        document.head.appendChild(style);
      }
      overlay.querySelector('.demo-caption small').textContent = chapter;
      overlay.querySelector('.demo-caption strong').textContent = title;
      overlay.querySelector('.demo-caption p').textContent = description;
      overlay.querySelector('.demo-disclosure').textContent = live
        ? '실무 유사 합성 POC 데이터 · OpenRouter 실시간 호출'
        : '실무 유사 합성 POC 데이터 · 제출 영상용 결정론적 AI 스트림';
      const caption = overlay.querySelector('.demo-caption');
      caption.animate(
        [
          { opacity: 0, transform: 'translate(-50%, 12px)' },
          { opacity: 1, transform: 'translate(-50%, 0)' },
        ],
        { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    },
    { chapter, title, description, live: liveLlm },
  );
}

async function moveAcrossGraph() {
  const box = await page.locator('.graph-viewport').boundingBox();
  if (!box) return;
  const points = [
    [0.35, 0.42],
    [0.53, 0.29],
    [0.67, 0.5],
    [0.51, 0.63],
    [0.38, 0.5],
  ];
  for (const [x, y] of points) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, {
      steps: 24,
    });
    await sleep(360);
  }
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.issue-row', { timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.graph-loading'), {
    timeout: 60_000,
  });

  await setCaption(
    '01 · MEMORY UNIVERSE',
    '흩어진 이슈가 회전하는 하나의 기억망이 됩니다',
    '완료된 이력은 성운으로, 진행 중인 이슈는 흰색 노드로 구분합니다.',
  );
  await moveAcrossGraph();
  await sleep(3_600);

  await setCaption(
    '02 · ISSUE INTAKE',
    '신규 이슈 WS-008을 바로 찾습니다',
    '제목·이슈 번호·담당 팀으로 검색하고, 목록과 그래프 어느 쪽에서도 선택할 수 있습니다.',
  );
  const search = page.getByPlaceholder('제목 · 이슈 번호 · 담당 팀 검색');
  await search.click();
  await search.pressSequentially('WS-008', { delay: 180 });
  await sleep(1_000);
  await page.locator('.issue-row').filter({ hasText: 'WS-008' }).first().click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.graph-viewport')
        ?.getAttribute('data-active-node') === 'active:WS-008',
    { timeout: 30_000 },
  );
  await sleep(4_200);

  await setCaption(
    '03 · GRAPH HISTORY',
    '현재 이슈를 중심으로 직접·2단계 이력이 정렬됩니다',
    '관련 노드를 따라가며 과거 해결, 중대 장애, 롤백, 공통화 기록을 한 화면에서 확인합니다.',
  );
  await page.locator('.related-issue').first().click();
  await sleep(2_800);
  const rootButton = page.getByRole('button', { name: '기준 이슈로' });
  if (await rootButton.isVisible()) await rootButton.click();
  await sleep(3_200);

  await setCaption(
    '04 · AI ISSUE ANALYSIS',
    '연결된 원문만 모아 원인·위험·처리 방향을 분석합니다',
    '구획이 도착하는 즉시 카드가 만들어지고, 결과 글자가 실시간으로 채워집니다.',
  );
  await page.getByRole('button', { name: /이슈 분석/ }).first().click();
  await page.waitForSelector('.insight-dialog', { timeout: 15_000 });
  await page.waitForSelector('.insight-loading.has-output', {
    timeout: liveLlm ? 45_000 : 10_000,
  });
  await page.waitForSelector('.insight-result', {
    timeout: liveLlm ? 180_000 : 30_000,
  });
  await sleep(4_500);

  await setCaption(
    '05 · HISTORY-BASED TESTS',
    '같은 히스토리로 회귀 테스트 케이스까지 생성합니다',
    '과거 롤백 조건과 사이드 위험을 놓치지 않도록 실행 단계와 기대 결과를 근거 이슈와 함께 제시합니다.',
  );
  await page.getByRole('button', { name: /테스트 케이스/ }).first().click();
  await page.waitForSelector('.insight-loading.has-output', {
    timeout: liveLlm ? 45_000 : 10_000,
  });
  await page.waitForSelector('.insight-result', {
    timeout: liveLlm ? 180_000 : 40_000,
  });
  await sleep(4_000);

  await page
    .getByRole('button', { name: '테스트 케이스 결과 전체 복사' })
    .click();
  await sleep(1_600);
  await setCaption(
    '06 · FROM HISTORY TO ANSWER',
    '과거의 기록을 연결해 미래의 해답을 찾습니다',
    '원문 이슈는 바꾸지 않고, 필요한 순간에만 관련 이력을 탐색·분석·검증에 재사용합니다.',
  );
  await sleep(6_000);
} finally {
  await context.close();
  await browser.close();
}

const rawPath = await video.path();
const stableRawPath = resolve(captureDir, 'websidian-demo-raw.webm');
if (rawPath !== stableRawPath) renameSync(rawPath, stableRawPath);

const conversion = spawnSync(
  ffmpeg,
  [
    '-y',
    '-i',
    stableRawPath,
    '-t',
    '89',
    '-vf',
    'scale=1920:1080:flags=lanczos,fps=30',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    outputPath,
  ],
  { windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
);
if (conversion.status !== 0) {
  throw new Error(
    `MP4 변환 실패: ${conversion.stderr || conversion.error?.message || 'unknown error'}`,
  );
}

console.log(
  JSON.stringify(
    {
      output: outputPath,
      raw: stableRawPath,
      mode: liveLlm ? 'live-llm' : 'deterministic-submission-stream',
      source: url,
      title: basename(outputPath),
    },
    null,
    2,
  ),
);
