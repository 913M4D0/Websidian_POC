#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const playwrightPath = process.env.WEBSIDIAN_PLAYWRIGHT_PATH || 'playwright';
const { chromium } = require(playwrightPath);

const repositoryRoot = path.resolve(
  new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'),
);
const input = path.resolve(
  repositoryRoot,
  process.argv[2] || 'public/websidian-presentation.html',
);
const output = path.resolve(
  repositoryRoot,
  process.argv[3] || 'output/pdf/01_WEBSIDIAN_PRESENTATION.pdf',
);
await mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const url = new URL(pathToFileURL(input));
  url.searchParams.set('print', '1');
  await page.goto(url.href, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  const slideCount = await page.locator('.slide').count();
  if (!slideCount) throw new Error('발표 슬라이드를 찾지 못했습니다.');
  await page.pdf({
    path: output,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    pageRanges: `1-${slideCount}`,
    tagged: true,
  });
  process.stdout.write(`${output}\n`);
} finally {
  await browser.close();
}
