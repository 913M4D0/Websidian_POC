import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Local QA only. Use a separately launched headless browser, never the user's session.
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.WEBSIDIAN_PLAYWRIGHT_PATH || 'playwright',
);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1536, height: 960 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const dir = new URL('../outputs/', import.meta.url).pathname.replace(
  /^\/([A-Z]:)/i,
  '$1',
);
mkdirSync(dir, { recursive: true });
let qaId;
let createdTitle;
try {
  await page.goto('http://localhost:3000/signin-with-chatgpt?return_to=/');
  await page.waitForSelector('.issue-row', { timeout: 45000 });
  await page.waitForFunction(() => !document.querySelector('.graph-loading'), {
    timeout: 45000,
  });
  const initial = await page.evaluate(
    async () => (await (await fetch('/api/issues')).json()).issues,
  );
  await page.screenshot({ path: join(dir, 'standalone-overview.png') });
  assert.equal(
    await page.locator('.graph-viewport').getAttribute('data-active-node'),
    '',
  );
  assert.equal(
    Number(
      await page.locator('.graph-viewport').getAttribute('data-memory-count'),
    ),
    initial.filter((issue) => issue.status === 'closed').length,
  );
  await page.getByPlaceholder('제목 · 이슈 번호 · 담당 팀 검색').fill('WS-024');
  await page.locator('.issue-row').first().click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.graph-viewport')
        ?.getAttribute('data-active-node') === 'active:WS-024',
  );
  await page.waitForSelector('.related-issue');
  assert.ok(
    await page.locator('.related-issue').filter({ hasText: 'WS-021' }).count(),
  );
  assert.equal(
    await page.locator('.inspector-details').getAttribute('open'),
    null,
  );
  await page.screenshot({ path: join(dir, 'standalone-related.png') });
  if (!process.argv.includes('--inspect')) {
    createdTitle = `[QA BROWSER] 웹 자체 이슈 ${crypto.randomUUID()}`;
    await page.getByRole('button', { name: '이슈 등록', exact: true }).click();
    await page.getByLabel('제목', { exact: true }).fill(createdTitle);
    await page
      .getByLabel('본문', { exact: true })
      .fill(
        '접수 목록에서 날짜가 다르게 보입니다. 공통 자료와 지난 처리 기록을 확인합니다.',
      );
    const createResponse = page.waitForResponse(
      (r) => r.url().endsWith('/api/issues') && r.request().method() === 'POST',
    );
    await page
      .getByRole('dialog')
      .getByRole('button', { name: '이슈 등록', exact: true })
      .click();
    const created = await (await createResponse).json();
    qaId = created.issue.id;
    await page.waitForFunction(
      (id) =>
        document
          .querySelector('.graph-viewport')
          ?.getAttribute('data-active-node') === `active:${id}`,
      qaId,
    );
    await page.getByText('이슈 상세 보기', { exact: true }).click();
    await page
      .getByLabel('확인한 내용 · 진행 기록', { exact: true })
      .fill('일자 경계 자료를 확인했고 추가 검증 중입니다.');
    await page
      .getByRole('button', { name: '진행 기록 저장', exact: true })
      .click();
    await page
      .getByText('일자 경계 자료를 확인했고 추가 검증 중입니다.', {
        exact: true,
      })
      .waitFor();
    await page
      .getByRole('button', { name: '처리 완료 · 기억으로 전환', exact: true })
      .click();
    await page
      .getByLabel('처리 내용', { exact: true })
      .fill(
        '기존 날짜 정책에 맞춰 표시 기준을 확인하고 안내했습니다. 원문과 진행 이력을 보존합니다.',
      );
    await page
      .getByLabel('처리 결과 · 자유 입력', { exact: true })
      .fill('기존 정책 안내 후 종료');
    await page
      .getByRole('button', { name: '완료하고 기억에 저장', exact: true })
      .click();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector('.graph-viewport')
          ?.getAttribute('data-selected-node') === `memory:${id}` &&
        document
          .querySelector('.graph-viewport')
          ?.getAttribute('data-active-node') === '',
      qaId,
    );
    const completed = await page.evaluate(
      async (id) =>
        (await (await fetch('/api/issues')).json()).issues.find(
          (issue) => issue.id === id,
        ),
      qaId,
    );
    assert.equal(completed.status, 'closed');
    assert.equal(completed.revision, 3);
    assert.equal(completed.title, createdTitle);
    assert.equal(completed.memory.method, 'extractive-v1');
    assert.ok(completed.memory.relatedIssueIds.length >= 1);
    await page.screenshot({ path: join(dir, 'standalone-completed.png') });
    await page.reload();
    await page.waitForSelector('.issue-row');
    await page.getByRole('button', { name: /^기억\s*\d+/ }).click();
    await page
      .getByPlaceholder('제목 · 이슈 번호 · 담당 팀 검색')
      .fill(createdTitle);
    await page.locator('.issue-row').first().click();
    await page.getByText('이슈 상세 보기', { exact: true }).click();
    await page.getByText('기존 정책 안내 후 종료', { exact: true }).waitFor();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button', { name: '이슈 상세 닫기', exact: true })
    .click();
  await page.getByRole('button', { name: /신규 이슈/ }).click();
  await page.getByPlaceholder('제목 · 이슈 번호 · 담당 팀 검색').fill('WS-024');
  await page.locator('.issue-row').first().click();
  await page.waitForSelector('.related-issue');
  assert.equal(await page.locator('.inspector-overview').isVisible(), true);
  assert.equal(
    await page.getByRole('button', { name: /이슈 분석/ }).isVisible(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: /테스트 케이스/ }).isVisible(),
    true,
  );
  await page.screenshot({ path: join(dir, 'standalone-mobile.png') });
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.scroll <= dimensions.viewport + 1,
    'No horizontal page overflow',
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: 'pass',
      pageErrors: errors,
      qaId,
      screenshots: dir,
    }),
  );
} catch (error) {
  await page
    .screenshot({ path: join(dir, 'standalone-failure.png') })
    .catch(() => {});
  console.error(JSON.stringify({ pageErrors: errors, message: error.message }));
  throw error;
} finally {
  // Only the exact UUID issue created by this test, never seed or user data.
  if (!qaId && createdTitle) {
    try {
      qaId = await page.evaluate(
        async (title) =>
          (await (await fetch('/api/issues')).json()).issues.find(
            (i) => i.title === title,
          )?.id,
        createdTitle,
      );
    } catch {}
  }
  if (qaId) {
    assert.match(qaId, /^WS-L-[0-9a-f-]{36}$/i);
    const root = join(
      process.cwd(),
      '.wrangler/state/v3/d1/miniflare-D1DatabaseObject',
    );
    for (const file of readdirSync(root).filter((name) =>
      name.endsWith('.sqlite'),
    )) {
      const db = new DatabaseSync(join(root, file));
      try {
        if (
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name='websidian_issues'",
            )
            .get()
        ) {
          db.prepare(
            'DELETE FROM websidian_issues WHERE owner_id = ? AND id = ?',
          ).run('local_seedy', qaId);
        }
      } finally {
        db.close();
      }
    }
    console.log('Removed only this browser test issue: ' + qaId);
  }
  await browser.close();
}
