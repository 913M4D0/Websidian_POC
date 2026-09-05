import { env } from 'cloudflare:workers';
import { ApiError } from './api-security.ts';
import type { Issue } from './issues.ts';
import {
  contentHash,
  toClientArtifact,
  type MemoryArtifact,
} from './memory-artifact.ts';

let initialization: Promise<unknown> | undefined;
const database = async () => {
  const db = (env as unknown as { DB?: D1Database }).DB;
  if (!db) throw new ApiError(503, 'AI 기억 저장소가 연결되지 않았습니다.');
  // Deployments use the checked-in Drizzle migration. This idempotent guard
  // also keeps local Wrangler and an interrupted migration recoverable.
  initialization ??= db
    .prepare(`CREATE TABLE IF NOT EXISTS websidian_memory_artifacts (
      owner_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      source_revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      compile_status TEXT NOT NULL,
      embedding_status TEXT NOT NULL,
      embedding_model TEXT,
      dimensions INTEGER,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id, issue_id)
    )`)
    .run()
    .catch((error) => {
      initialization = undefined;
      throw error;
    });
  await initialization;
  return db;
};

function parse(payload: string): MemoryArtifact | null {
  try {
    const artifact = JSON.parse(payload) as MemoryArtifact;
    return artifact && typeof artifact.issueId === 'string' ? artifact : null;
  } catch {
    return null;
  }
}

export async function listMemoryArtifacts(actor: string) {
  const rows = await (
    await database()
  )
    .prepare(
      'SELECT payload FROM websidian_memory_artifacts WHERE owner_id = ?',
    )
    .bind(actor)
    .all<{ payload: string }>();
  return rows.results
    .map((row) => parse(row.payload))
    .filter((artifact): artifact is MemoryArtifact => artifact !== null);
}

export async function findMemoryArtifact(actor: string, issueId: string) {
  const row = await (
    await database()
  )
    .prepare(
      'SELECT payload FROM websidian_memory_artifacts WHERE owner_id = ? AND issue_id = ?',
    )
    .bind(actor, issueId)
    .first<{ payload: string }>();
  return row ? parse(row.payload) : null;
}

export async function saveMemoryArtifacts(
  actor: string,
  artifacts: MemoryArtifact[],
) {
  if (!artifacts.length) return;
  const db = await database();
  const statements = artifacts.map((artifact) =>
    db
      .prepare(`INSERT INTO websidian_memory_artifacts
      (owner_id, issue_id, source_revision, content_hash, compile_status,
       embedding_status, embedding_model, dimensions, payload, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_id, issue_id) DO UPDATE SET
        source_revision = excluded.source_revision,
        content_hash = excluded.content_hash,
        compile_status = excluded.compile_status,
        embedding_status = excluded.embedding_status,
        embedding_model = excluded.embedding_model,
        dimensions = excluded.dimensions,
        payload = excluded.payload,
        updated_at = excluded.updated_at`)
      .bind(
        actor,
        artifact.issueId,
        artifact.sourceRevision,
        artifact.contentHash,
        artifact.compileStatus,
        artifact.embeddingStatus,
        artifact.embeddingModel ?? null,
        artifact.dimensions ?? null,
        JSON.stringify(artifact),
        artifact.updatedAt,
      ),
  );
  // Keep each D1 batch modest; 300-node POC backfills still complete in a few
  // round trips without relying on undocumented maximum statement counts.
  for (let index = 0; index < statements.length; index += 50)
    await db.batch(statements.slice(index, index + 50));
}

export async function memoryIndexSnapshot(
  actor: string,
  issues: Issue[],
  embeddingModel?: string,
) {
  const completed = issues.filter((issue) => issue.status === 'closed');
  const artifacts = await listMemoryArtifacts(actor);
  const byId = new Map(
    artifacts.map((artifact) => [artifact.issueId, artifact]),
  );
  let indexed = 0;
  let compiled = 0;
  let stale = 0;
  for (const issue of completed) {
    const artifact = byId.get(issue.id);
    if (artifact?.compileStatus === 'ready') compiled += 1;
    if (
      artifact?.embeddingStatus === 'ready' &&
      artifact.sourceRevision === issue.revision &&
      (!embeddingModel || artifact.embeddingModel === embeddingModel)
    )
      indexed += 1;
    else if (artifact) stale += 1;
  }
  return {
    total: completed.length,
    indexed,
    compiled,
    remaining: Math.max(0, completed.length - indexed),
    stale,
    artifacts,
    publicArtifacts: artifacts.map(toClientArtifact),
  };
}

export async function isArtifactCurrent(
  issue: Issue,
  artifact: MemoryArtifact | null,
) {
  return Boolean(
    artifact &&
    artifact.sourceRevision === issue.revision &&
    artifact.contentHash === (await contentHash(issue)),
  );
}
