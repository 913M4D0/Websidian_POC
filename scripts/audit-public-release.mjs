#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputArgument = process.argv.indexOf('--output');
const outputPath =
  outputArgument >= 0 && process.argv[outputArgument + 1]
    ? path.resolve(repositoryRoot, process.argv[outputArgument + 1])
    : null;
const scanHistory = process.argv.includes('--history');

const rules = [
  ['OpenRouter key', /\bsk-or-v1-[A-Za-z0-9_-]{20,}\b/g],
  ['GitHub classic token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  [
    'JWT-like credential',
    /\beyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\b/g,
  ],
  ['local Windows user path', /\b[A-Z]:\\Users\\[^\\\s]+\\/gi],
];
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const names = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: repositoryRoot, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean)
  .filter((name) => textExtensions.has(path.extname(name).toLowerCase()))
  .filter((name) => !name.startsWith('tmp/'));

const findings = [];
for (const name of names) {
  const absolute = path.join(repositoryRoot, name);
  const content = await readFile(absolute, 'utf8');
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push({ file: name, rule });
  }
}

let historyBytes = 0;
if (scanHistory) {
  const history = execFileSync('git', ['log', '-p', '--all', '--no-ext-diff'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  historyBytes = Buffer.byteLength(history);
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    if (pattern.test(history)) findings.push({ file: 'git-history', rule });
  }
}

const lines = [
  'Websidian public-release source scan',
  `run_at=${new Date().toISOString()}`,
  `text_files_scanned=${names.length}`,
  `finding_count=${findings.length}`,
  `git_history_scanned=${scanHistory}`,
  `git_history_bytes=${historyBytes}`,
  'scope=tracked and untracked text files, excluding ignored files and tmp/; optional git patch history',
  'note=pattern scan only; not a legal, privacy, or complete secret audit',
  ...findings.map(({ file, rule }) => `FINDING\t${rule}\t${file}`),
  findings.length ? 'RESULT=REVIEW_REQUIRED' : 'RESULT=PASS',
  '',
];
const report = lines.join('\n');
if (outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, 'utf8');
}
process.stdout.write(report);
if (findings.length) process.exitCode = 1;
