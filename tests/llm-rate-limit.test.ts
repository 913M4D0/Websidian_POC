import assert from 'node:assert/strict';
import test from 'node:test';
import { AiLimitError, reserveAiCall } from '../lib/llm-rate-limit.ts';

void test('AI rate limiter rejects missing storage and reserves global plus lane buckets', async () => {
  await assert.rejects(
    () => reserveAiCall(undefined, 'owner', 'embedding-query'),
    (error) => error instanceof AiLimitError && error.status === 503,
  );

  const inserts: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              return {};
            },
            async first() {
              if (sql.includes('INSERT INTO')) inserts.push(values);
              return { count: 1 };
            },
          };
        },
        async run() {
          return {};
        },
      };
    },
  } as unknown as D1Database;

  await reserveAiCall(db, 'owner', 'embedding-query');
  assert.equal(inserts.length, 4);
  assert.deepEqual(
    inserts.map((values) => String(values[1]).split(':')[0]),
    ['global', 'embedding-query', 'global', 'embedding-query'],
  );
  assert.deepEqual(
    inserts.map((values) => values[3]),
    [12, 6, 120, 60],
  );

  const blockedDb = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            async run() {
              return {};
            },
            async first() {
              return sql.includes('INSERT INTO') ? null : { count: 1 };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  await assert.rejects(
    () => reserveAiCall(blockedDb, 'owner', 'analysis'),
    (error) => error instanceof AiLimitError && error.status === 429,
  );
});
