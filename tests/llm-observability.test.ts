import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finishLlmRun,
  listLlmRuns,
  llmRunsCsv,
  saveLlmRun,
  startLlmRun,
} from '../lib/llm-observability.ts';

void test('LLM run metrics capture cost, usage, timing, and no source text', () => {
  const clock = startLlmRun({
    ownerId: 'owner-test',
    issueId: 'WS-008',
    lane: 'analysis',
    requestedModelId: 'openai/gpt-5.6-luna',
    promptVersion: 'analysis-delimited-v2',
    reasoningEffort: 'medium',
    evidenceCount: 11,
    inputCharacters: 12_345,
    startedAtMs: 1_000,
  });
  const record = finishLlmRun(clock, {
    servedModelId: 'openai/gpt-5.6-luna',
    firstTokenAtMs: 1_420,
    completedAtMs: 2_500,
    usage: {
      promptTokens: 900,
      completionTokens: 200,
      reasoningTokens: 80,
      cachedTokens: 100,
      totalTokens: 1_100,
      providerCost: 0.0123456,
    },
    providerRequestId: 'gen-1',
    attempts: 2,
    finishReason: 'stop',
    status: 'success',
  });
  assert.equal(record.firstTokenMs, 420);
  assert.equal(record.durationMs, 1_500);
  assert.equal(record.providerCostMicrounits, 12_346);
  assert.equal(record.providerCostUnit, 'openrouter-credit');
  assert.equal(record.attempts, 2);
  assert.equal(record.fallback, false);
  assert.equal('prompt' in record, false);
  assert.equal('content' in record, false);
  assert.equal('output' in record, false);
});

void test('fallback metrics remain bounded and export without owner identity', () => {
  const clock = startLlmRun({
    ownerId: 'private-owner',
    issueId: null,
    lane: 'memory',
    requestedModelId: 'model',
    promptVersion: 'memory-v1',
    reasoningEffort: 'medium',
    evidenceCount: 0,
    inputCharacters: 50,
    startedAtMs: 10,
  });
  const { ownerId: _ownerId, ...row } = finishLlmRun(clock, {
    completedAtMs: 20,
    status: 'fallback',
    fallback: true,
    errorStage: 'provider-http',
  });
  const csv = llmRunsCsv([row]);
  assert.match(csv, /^id,issueId,lane,/);
  assert.doesNotMatch(csv, /private-owner/);
  assert.match(csv, /fallback/);
  assert.match(csv, /provider-http/);
  assert.equal(row.attempts, 0);
});

void test('missing telemetry storage never blocks the AI result', async () => {
  const clock = startLlmRun({
    ownerId: 'owner',
    issueId: 'WS-001',
    lane: 'test-cases',
    requestedModelId: 'model',
    promptVersion: 'test-v1',
    reasoningEffort: 'medium',
    evidenceCount: 2,
    inputCharacters: 100,
  });
  const record = finishLlmRun(clock, { status: 'success' });
  assert.equal(await saveLlmRun(undefined, record), false);
});

void test('D1 storage hashes owner scope and owner queries use the same digest', async () => {
  let inserted: unknown[] = [];
  let selected: unknown[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          if (sql.includes('INSERT INTO')) inserted = values;
          else selected = values;
          return {
            async run() {
              return {};
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const ownerId = 'owner-sensitive';
  const clock = startLlmRun({
    ownerId,
    issueId: 'WS-001',
    lane: 'analysis',
    requestedModelId: 'model',
    promptVersion: 'analysis-v1',
    reasoningEffort: 'max',
    evidenceCount: 7,
    inputCharacters: 100,
  });
  assert.equal(
    await saveLlmRun(db, finishLlmRun(clock, { status: 'success' })),
    true,
  );
  await listLlmRuns(db, ownerId);
  assert.equal(typeof inserted[1], 'string');
  assert.equal(String(inserted[1]).length, 64);
  assert.notEqual(inserted[1], ownerId);
  assert.equal(selected[0], inserted[1]);
});

void test('CSV export neutralizes spreadsheet formula prefixes', () => {
  const clock = startLlmRun({
    ownerId: 'owner',
    issueId: 'WS-001',
    lane: 'analysis',
    requestedModelId: 'model',
    promptVersion: 'analysis-v1',
    reasoningEffort: 'max',
    evidenceCount: 1,
    inputCharacters: 10,
  });
  const { ownerId: _ownerId, ...row } = finishLlmRun(clock, {
    servedModelId: '=WEBSERVICE("https://example.invalid")',
    providerRequestId: '@SUM(1+1)',
    status: 'success',
  });
  const csv = llmRunsCsv([row]);
  assert.match(csv, /'=WEBSERVICE/);
  assert.match(csv, /'@SUM/);
});
