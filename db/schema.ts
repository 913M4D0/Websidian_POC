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
