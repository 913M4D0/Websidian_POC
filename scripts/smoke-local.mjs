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
const completedBefore = before.data.issues.filter(
  (issue) => issue.status === 'closed',
);
const llmStatus = await call('/api/llm');
assert.equal(llmStatus.status, 200, JSON.stringify(llmStatus.data));
assert.equal(
  llmStatus.data.ready,
  false,
  'Smoke must not call a configured paid LLM provider. Unconfigure it for this local test.',
);
const referenceMemory = completedBefore.find(
  (issue) => issue.resources.length > 0,
);
assert.ok(
  referenceMemory,
  'A completed history with resources is required for this smoke run.',
);
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
    referenceMemory.resources[0],
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
  assert.equal(created.data.issue.status, 'open');
  assert.equal(created.data.issue.memory, undefined);
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
  const openSearch = await call('/api/search', {
    query: '검증 양식',
    excludeId: id,
  });
  assert.equal(openSearch.status, 200);
  assert.equal(openSearch.data.results.length, completedBefore.length);
  assert.ok(
    openSearch.data.results.every((result) =>
      completedBefore.some((issue) => issue.id === result.issueId),
    ),
  );
  assert.ok(
    openSearch.data.results.some(
      (result) =>
        result.issueId === referenceMemory.id && result.resourceScore > 0,
    ),
  );
  const openHistory = await call('/api/history', {
    query: '검증 양식',
    referenceId: id,
    pinnedIds: [referenceMemory.id],
  });
  assert.equal(openHistory.status, 200, JSON.stringify(openHistory.data));
  assert.ok(
    openHistory.data.evidence.some(
      (evidence) => evidence.issueId === referenceMemory.id,
    ),
  );
  assert.ok(
    openHistory.data.evidence.every((evidence) =>
      completedBefore.some((issue) => issue.id === evidence.issueId),
    ),
  );
  for (const pinnedIds of [[id], ['WS-L-not-accessible']]) {
    assert.equal(
      (
        await call('/api/history', {
          query: '검증 양식',
          referenceId: id,
          pinnedIds,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await call('/api/history', {
        query: '검증 양식',
        referenceId: 'WS-L-not-accessible',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('/api/search', {
        query: '검증 양식',
        excludeId: 'WS-L-not-accessible',
      })
    ).status,
    400,
  );
  const progressBody = '과거 처리 기록과 관련 양식을 확인했습니다.';
  const progress = await call(`/api/issues/${id}/activities`, {
    expectedRevision: 1,
    body: progressBody,
  });
  assert.equal(progress.status, 200, JSON.stringify(progress.data));
  assert.equal(progress.data.issue.revision, 2);
  assert.equal(progress.data.issue.status, 'open');
  assert.equal(progress.data.issue.title, payload.title);
  assert.equal(progress.data.issue.body, payload.body);
  assert.deepEqual(progress.data.issue.resources, payload.resources);
  assert.equal(progress.data.issue.activities.length, 2);
  assert.equal(progress.data.issue.activities[1].body, progressBody);
  assert.equal(progress.data.issue.memory, undefined);
  assert.equal(
    (
      await call(`/api/issues/${id}/activities`, {
        expectedRevision: 1,
        body: progressBody,
      })
    ).status,
    409,
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
    expectedRevision: 2,
    body: '동시 요청에서 한 건만 처리 기록으로 저장했습니다.',
    outcome: '검증 완료',
    attributes: { '처리 측정': 2 },
    resources: [
      {
        key: 'form:/qa/local',
        label: '원문 자료명 변경 시도',
        kind: '원문 자료 유형 변경 시도',
      },
      {
        key: 'report:/qa/completion',
        label: '처리 완료 검증 기록',
        kind: '처리 보고서',
      },
    ],
    evidenceIssueIds: [referenceMemory.id],
  };
  for (const evidenceIssueIds of [[id], ['WS-L-not-accessible']]) {
    assert.equal(
      (
        await call(`/api/issues/${id}/resolve`, {
          ...treatment,
          evidenceIssueIds,
        })
      ).status,
      400,
    );
  }
  const concurrent = await Promise.all([
    call(`/api/issues/${id}/resolve`, treatment),
    call(`/api/issues/${id}/resolve`, treatment),
  ]);
  assert.deepEqual(
    concurrent.map((r) => r.status).sort((left, right) => left - right),
    [200, 409],
  );
  const after = await call('/api/issues');
  const stored = after.data.issues.find((issue) => issue.id === id);
  assert.equal(stored.revision, 3);
  assert.equal(stored.status, 'closed');
  assert.equal(stored.title, payload.title);
  assert.equal(stored.body, payload.body);
  assert.equal(stored.activities.length, 3);
  assert.equal(stored.activities[1].body, progressBody);
  assert.equal(stored.activities[2].body, treatment.body);
  assert.deepEqual(
    stored.resources.slice(0, payload.resources.length),
    payload.resources,
  );
  assert.equal(stored.resources.length, payload.resources.length + 1);
  assert.deepEqual(stored.resolution.evidenceIssueIds, [referenceMemory.id]);
  assert.equal(stored.memory.method, 'extractive-v1');
  assert.equal(stored.memory.sourceRevision, 3);
  assert.equal(stored.memory.version, 1);
  assert.deepEqual(stored.memory.relatedIssueIds, [referenceMemory.id]);
  assert.ok(stored.memory.terms.length > 0);
  assert.equal(stored.memory.compiledAt, stored.resolution.at);
  assert.equal(after.data.issues.length, initialCount + 1);
  assert.equal(after.data.issues.filter((issue) => issue.id === id).length, 1);
  assert.equal(
    after.data.issues.filter((issue) => issue.status === 'closed').length,
    completedBefore.length + 1,
  );
  assert.equal(
    (
      await call(`/api/issues/${id}/activities`, {
        expectedRevision: 3,
        body: '완료 이후 기록 시도',
      })
    ).status,
    409,
  );
  const search = await call('/api/search', { query: '중복 주문 다시 시도' });
  assert.equal(search.status, 200);
  assert.equal(search.data.results.length, completedBefore.length + 1);
  assert.ok(
    search.data.results.every((result) =>
      after.data.issues.some(
        (issue) => issue.id === result.issueId && issue.status === 'closed',
      ),
    ),
  );
  const newMemoryHistory = await call('/api/history', {
    query: '동시 요청 처리 기록',
    pinnedIds: [id],
  });
  assert.equal(
    newMemoryHistory.status,
    200,
    JSON.stringify(newMemoryHistory.data),
  );
  assert.equal(
    newMemoryHistory.data.evidence.find((evidence) => evidence.issueId === id)
      ?.summary,
    treatment.body,
  );
  const history = await call('/api/history', {
    query: '중복 주문 다시 시도',
    pinnedIds: [referenceMemory.id],
  });
  assert.equal(history.status, 200, JSON.stringify(history.data));
  assert.equal(history.data.engine, 'lexical-resource-v1');
  for (const evidence of history.data.evidence) {
    const source = after.data.issues.find(
      (issue) => issue.id === evidence.issueId,
    );
    assert.equal(source?.status, 'closed');
    assert.equal(source.title, evidence.title);
    assert.ok(
      [
        source.body,
        source.resolution?.body,
        ...source.activities.map((activity) => activity.body),
      ].some((body) => body?.includes(evidence.summary)),
    );
  }
  const beforeBrief = JSON.stringify((await call('/api/issues')).data.issues);
  const brief = await call('/api/brief', {
    query: '동시 요청 처리 기록',
    pinnedIds: [id],
  });
  assert.equal(brief.status, 503, JSON.stringify(brief.data));
  assert.equal(
    JSON.stringify((await call('/api/issues')).data.issues),
    beforeBrief,
  );
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
      progress: 'audited r2; stale update 409',
      resolve:
        'same canonical ID / r3; completed memory replaces pending graph view',
      memory: 'extractive-v1 / sourceRevision 3; source preserved',
      concurrentStatuses: [200, 409],
      search: 'completed memories only; immutable source',
      history: 'closed-only source excerpts; invalid pins rejected',
      unconfiguredBrief: '503; no writes',
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
