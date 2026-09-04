import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const origin = 'http://localhost:3000';
const login = await fetch(`${origin}/signin-with-chatgpt?return_to=/`, {
  redirect: 'manual',
});
assert.equal(login.status, 302);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function call(path, body, headers = {}) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: cookie,
      ...(body === undefined
        ? {}
        : { 'Content-Type': 'application/json', Origin: origin }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: response.status, data };
}
const before = await call('/api/issues');
assert.equal(before.status, 200, JSON.stringify(before.data));
const snapshot = JSON.stringify(before.data.issues);
const initialCount = before.data.issues.length;
assert.equal((await fetch(`${origin}/api/issues`)).status, 401);
assert.equal(
  (
    await fetch(`${origin}/api/issues`, {
      headers: { 'oai-authenticated-user-id': 'spoofed' },
    })
  ).status,
  401,
);
const requestId = crypto.randomUUID(),
  id = `WS-L-${requestId}`;
const payload = {
  requestId,
  title: '[QA LOCAL] 영구 저장 및 동시 처리 확인',
  body: '자동 검증을 위한 임시 이슈입니다.',
  team: '검증팀',
  issueType: '임의 새 분류',
  occurredAt: '2026-09-04',
  tags: ['새로운 태그'],
  resources: [
    { key: 'form:/qa/local', label: '검증 양식', kind: '새로운 자료 종류' },
  ],
  attributes: { '새 평가': 17 },
};
try {
  assert.equal(
    (await call('/api/issues', payload, { Origin: 'https://foreign.invalid' }))
      .status,
    403,
  );
  const created = await call('/api/issues', payload);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.issue.id, id);
  assert.equal(
    (
      await call('/api/issues', {
        ...payload,
        title: '중복 요청은 원문을 교체하지 않음',
      })
    ).data.issue.title,
    payload.title,
  );
  assert.equal(
    (await call('/api/issues')).data.issues.length,
    initialCount + 1,
  );
  assert.equal(
    (
      await call(`/api/issues/${id}/resolve`, {
        expectedRevision: 99,
        body: '검증',
        outcome: '검증',
      })
    ).status,
    409,
  );
  const treatment = {
    expectedRevision: 1,
    body: '동시 요청에서 한 건만 처리 기록으로 저장했습니다.',
    outcome: '검증 완료',
    attributes: { '처리 측정': 2 },
  };
  const concurrent = await Promise.all([
    call(`/api/issues/${id}/resolve`, treatment),
    call(`/api/issues/${id}/resolve`, treatment),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  const after = await call('/api/issues');
  const stored = after.data.issues.find((issue) => issue.id === id);
  assert.equal(stored.revision, 2);
  assert.equal(stored.status, 'closed');
  assert.equal(stored.title, payload.title);
  assert.equal(stored.body, payload.body);
  assert.equal(stored.activities.length, 2);
  assert.equal(after.data.issues.length, initialCount + 1);
  const search = await call('/api/search', { query: '중복 주문 다시 시도' });
  assert.equal(search.status, 200);
  assert.equal(search.data.results.length, initialCount + 1);
  assert.equal((await call('/api/search', { query: '' })).status, 400);
  assert.equal(
    (await call('/api/search', { query: 'x'.repeat(66000) })).status,
    413,
  );
  const originals = (await call('/api/issues')).data.issues.filter(
    (issue) => issue.id !== id,
  );
  assert.equal(JSON.stringify(originals), snapshot);
  console.log(
    JSON.stringify({
      passed: true,
      seedCount: initialCount,
      create: 'durable',
      idempotentCreate: true,
      resolve: 'same ID / r2',
      concurrentStatuses: [200, 409],
      search: 'all ranked; immutable source',
      anonymousAndSpoofed: 401,
      crossOrigin: 403,
      oversize: 413,
    }),
  );
} finally {
  // Remove only the exact QA row created by this run, never seed/user records.
  const root = join(process.cwd(), '.wrangler', 'state', 'v3', 'd1');
  const files = readdirSync(root, { recursive: true }).filter((file) =>
    String(file).endsWith('.sqlite'),
  );
  for (const file of files) {
    const db = new DatabaseSync(join(root, String(file)));
    try {
      if (
        !db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='websidian_issues'",
          )
          .get()
      )
        continue;
      const row = db
        .prepare(
          'SELECT payload FROM websidian_issues WHERE owner_id=? AND id=?',
        )
        .get('local_seedy', id);
      if (!row) continue;
      assert.equal(JSON.parse(row.payload).title, payload.title);
      db.prepare('DELETE FROM websidian_issues WHERE owner_id=? AND id=?').run(
        'local_seedy',
        id,
      );
    } finally {
      db.close();
    }
  }
  assert.equal((await call('/api/issues')).data.issues.length, initialCount);
  console.log('Local QA record removed; original dataset restored.');
}
