import { env } from 'cloudflare:workers';
import seedRecords from '@/data/issues.json';
import sourceBindings from '@/data/github-bindings.json';
import type { Issue } from '@/lib/issues';
import { ApiError } from '@/lib/api-security';

export const seedIssues = (seedRecords as unknown as Issue[]).map((issue) => ({
  ...issue,
  source: (sourceBindings as Record<string, Issue['source']>)[issue.id],
}));

// Read-only versioned seeds + per-user durable overlays. Search never writes here.
// A new deployment cannot replace a user's treatment or create duplicate seed nodes.
let initialization: Promise<unknown> | undefined;
async function database() {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new ApiError(503, '영구 저장소가 아직 연결되지 않았습니다.');
  initialization ??= db
    .prepare(`CREATE TABLE IF NOT EXISTS websidian_issues (
    owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload TEXT NOT NULL, PRIMARY KEY(owner_id, id)
  )`)
    .run()
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  await initialization;
  return db;
}

export async function listIssues(actor: string): Promise<Issue[]> {
  const db = await database();
  const rows = await db
    .prepare('SELECT payload FROM websidian_issues WHERE owner_id = ?')
    .bind(actor)
    .all<{ payload: string }>();
  const merged = new Map(seedIssues.map((issue) => [issue.id, issue as Issue]));
  for (const row of rows.results) {
    const issue = JSON.parse(row.payload) as Issue;
    merged.set(issue.id, withSource(issue));
  }
  return [...merged.values()].sort(
    (a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
}

export async function findIssue(actor: string, id: string): Promise<Issue> {
  const db = await database();
  const row = await db
    .prepare(
      'SELECT payload FROM websidian_issues WHERE owner_id = ? AND id = ?',
    )
    .bind(actor, id)
    .first<{ payload: string }>();
  const issue = row
    ? (JSON.parse(row.payload) as Issue)
    : seedIssues.find((item) => item.id === id);
  if (!issue) throw new ApiError(404, '이슈를 찾을 수 없습니다.');
  return withSource(issue);
}

function withSource(issue: Issue): Issue {
  const binding = (sourceBindings as Record<string, Issue['source']>)[issue.id];
  return binding ? { ...issue, source: binding } : issue;
}

export async function insertIssue(actor: string, issue: Issue): Promise<Issue> {
  const db = await database();
  await db
    .prepare(
      'INSERT OR IGNORE INTO websidian_issues (owner_id, id, revision, payload) VALUES (?, ?, ?, ?)',
    )
    .bind(actor, issue.id, issue.revision, JSON.stringify(issue))
    .run();
  return findIssue(actor, issue.id);
}

/**
 * One-way provider snapshots are import-once. A repeated import or an ID
 * collision never overwrites local treatment, resolution, or user-authored data.
 */
export async function insertExternalIssue(actor: string, issue: Issue) {
  if (!issue.source?.managed)
    throw new ApiError(400, '외부 원본 표시가 없는 이슈는 가져올 수 없습니다.');
  if (seedIssues.some((seed) => seed.id === issue.id))
    return { issue: await findIssue(actor, issue.id), created: false };
  const db = await database();
  const result = await db
    .prepare(
      'INSERT OR IGNORE INTO websidian_issues (owner_id, id, revision, payload) VALUES (?, ?, ?, ?)',
    )
    .bind(actor, issue.id, issue.revision, JSON.stringify(issue))
    .run();
  return {
    issue: await findIssue(actor, issue.id),
    created: Boolean(result.meta.changes),
  };
}

export async function saveIssueRevision(
  actor: string,
  issue: Issue,
  expectedRevision: number,
) {
  const db = await database();
  // A first seed edit inserts its overlay; subsequent edits use revision CAS.
  const result = await db
    .prepare(`INSERT INTO websidian_issues (owner_id, id, revision, payload) VALUES (?, ?, ?, ?)
    ON CONFLICT(owner_id, id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload
    WHERE websidian_issues.revision = ?`)
    .bind(
      actor,
      issue.id,
      issue.revision,
      JSON.stringify(issue),
      expectedRevision,
    )
    .run();
  if (!result.meta.changes)
    throw new ApiError(
      409,
      '다른 창에서 이슈가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
    );
  return issue;
}

// Kept for existing callers; progress and completion share the same atomic CAS.
export const saveResolution = saveIssueRevision;
