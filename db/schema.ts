import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

/**
 * AI summaries and vectors are derived artifacts. They intentionally live
 * outside the canonical issue JSON so a provider failure can never rewrite an
 * issue or prevent its completion.
 */
export const memoryArtifacts = sqliteTable(
  'websidian_memory_artifacts',
  {
    ownerId: text('owner_id').notNull(),
    issueId: text('issue_id').notNull(),
    sourceRevision: integer('source_revision').notNull(),
    contentHash: text('content_hash').notNull(),
    compileStatus: text('compile_status').notNull(),
    embeddingStatus: text('embedding_status').notNull(),
    embeddingModel: text('embedding_model'),
    dimensions: integer('dimensions'),
    payload: text('payload').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.issueId] }),
    index('websidian_memory_artifacts_owner_status').on(
      table.ownerId,
      table.embeddingStatus,
    ),
  ],
);

/**
 * Content-free AI telemetry for reproducible POC benchmarks. Prompts, issue
 * bodies, generated output, credentials, and raw authentication identifiers
 * are not stored in this table. owner_id contains a one-way scope digest.
 */
export const llmRuns = sqliteTable(
  'websidian_llm_runs',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    issueId: text('issue_id'),
    lane: text('lane').notNull(),
    requestedModelId: text('requested_model_id').notNull(),
    servedModelId: text('served_model_id'),
    promptVersion: text('prompt_version').notNull(),
    reasoningEffort: text('reasoning_effort').notNull(),
    evidenceCount: integer('evidence_count').notNull(),
    inputCharacters: integer('input_characters').notNull(),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at').notNull(),
    firstTokenMs: integer('first_token_ms'),
    durationMs: integer('duration_ms').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    cachedTokens: integer('cached_tokens'),
    totalTokens: integer('total_tokens'),
    providerCostMicrounits: integer('provider_cost_microunits'),
    providerCostUnit: text('provider_cost_unit').notNull(),
    providerRequestId: text('provider_request_id'),
    attempts: integer('attempts').notNull(),
    finishReason: text('finish_reason'),
    status: text('status').notNull(),
    fallback: integer('fallback', { mode: 'boolean' }).notNull(),
    errorStage: text('error_stage'),
  },
  (table) => [
    index('websidian_llm_runs_owner_started').on(
      table.ownerId,
      table.startedAt,
    ),
    index('websidian_llm_runs_owner_lane').on(table.ownerId, table.lane),
  ],
);
