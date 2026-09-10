#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.WEBSIDIAN_PLAYWRIGHT_PATH || 'playwright',
);
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const input = path.resolve(repositoryRoot, process.argv[2] || '');
const output = path.resolve(repositoryRoot, process.argv[3] || '');
const documentTitle = process.argv[4] || path.basename(input, path.extname(input));

if (!process.argv[2] || !process.argv[3]) {
  throw new Error(
    'usage: node scripts/export-submission-document.mjs <input.md> <output.pdf> [title]',
  );
}

const pandoc = process.env.WEBSIDIAN_PANDOC_PATH || 'pandoc';
const stylesheet = path.join(
  repositoryRoot,
  'assets',
  'submission-document.css',
);
const temporaryDirectory = await mkdtemp(
  path.join(tmpdir(), 'websidian-document-'),
);
const intermediate = path.join(temporaryDirectory, 'document.html');
await mkdir(path.dirname(output), { recursive: true });

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });

try {
  await run(pandoc, [
    input,
    '--from=gfm',
    '--to=html5',
    '--standalone',
    '--metadata',
    `pagetitle=${documentTitle}`,
    '--css',
    stylesheet,
    '--output',
    intermediate,
  ]);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1240, height: 1754 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(intermediate).href, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.pdf({
      path: output,
      format: 'A4',
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="box-sizing:border-box;width:100%;padding:0 14mm 5mm;color:#6b7280;font:8px Malgun Gothic,Arial,sans-serif;display:flex;justify-content:space-between"><span>Websidian · 실무 유사 합성 POC</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
  process.stdout.write(`${output}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
