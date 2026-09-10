export type LlmLane =
  | 'analysis'
  | 'test-cases'
  | 'memory'
  | 'embedding-document'
  | 'embedding-query';

export type LlmRunStatus =
  | 'success'
  | 'partial'
  | 'fallback'
  | 'cancelled'
  | 'error';

export type LlmUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  providerCost: number | null;
};

export type LlmRunRecord = {
  id: string;
  ownerId: string;
  issueId: string | null;
  lane: LlmLane;
  requestedModelId: string;
  servedModelId: string | null;
  promptVersion: string;
  reasoningEffort: string;
  evidenceCount: number;
  inputCharacters: number;
  startedAt: string;
  completedAt: string;
  firstTokenMs: number | null;
  durationMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  providerCostMicrounits: number | null;
  providerCostUnit: 'openrouter-credit';
  providerRequestId: string | null;
  attempts: number;
  finishReason: string | null;
  status: LlmRunStatus;
  fallback: boolean;
  errorStage: string | null;
};

export type LlmRunStart = Pick<
  LlmRunRecord,
  | 'ownerId'
  | 'issueId'
  | 'lane'
  | 'requestedModelId'
  | 'promptVersion'
  | 'reasoningEffort'
  | 'evidenceCount'
  | 'inputCharacters'
> & { startedAtMs?: number };

export type LlmRunFinish = {
  servedModelId?: string | null;
  firstTokenAtMs?: number | null;
  completedAtMs?: number;
  usage?: Partial<LlmUsage> | null;
  providerRequestId?: string | null;
  attempts?: number;
  finishReason?: string | null;
  status: LlmRunStatus;
  fallback?: boolean;
  errorStage?: string | null;
};

type RunClock = { id: string; startedAtMs: number; input: LlmRunStart };

const optionalCount = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;

const boundedText = (value: string | null | undefined, maximum: number) =>
  value?.trim() ? value.trim().slice(0, maximum) : null;

export function startLlmRun(input: LlmRunStart): RunClock {
  return {
    id: crypto.randomUUID(),
    startedAtMs: input.startedAtMs ?? Date.now(),
    input,
  };
}

export function finishLlmRun(
  clock: RunClock,
  finish: LlmRunFinish,
): LlmRunRecord {
  const completedAtMs = Math.max(
    clock.startedAtMs,
    finish.completedAtMs ?? Date.now(),
  );
  const firstTokenAtMs = finish.firstTokenAtMs ?? null;
  const usage = finish.usage ?? {};
  const providerCost =
    typeof usage.providerCost === 'number' &&
    Number.isFinite(usage.providerCost) &&
    usage.providerCost >= 0
      ? usage.providerCost
      : null;
  return {
    id: clock.id,
    ownerId: clock.input.ownerId,
    issueId: boundedText(clock.input.issueId, 120),
    lane: clock.input.lane,
    requestedModelId: clock.input.requestedModelId.slice(0, 160),
    servedModelId: boundedText(finish.servedModelId, 160),
    promptVersion: clock.input.promptVersion.slice(0, 120),
    reasoningEffort: clock.input.reasoningEffort.slice(0, 40),
    evidenceCount: Math.max(0, Math.round(clock.input.evidenceCount)),
    inputCharacters: Math.max(0, Math.round(clock.input.inputCharacters)),
    startedAt: new Date(clock.startedAtMs).toISOString(),
    completedAt: new Date(completedAtMs).toISOString(),
    firstTokenMs:
      firstTokenAtMs === null
        ? null
        : Math.max(0, Math.round(firstTokenAtMs - clock.startedAtMs)),
    durationMs: Math.max(0, Math.round(completedAtMs - clock.startedAtMs)),
    promptTokens: optionalCount(usage.promptTokens),
    completionTokens: optionalCount(usage.completionTokens),
    reasoningTokens: optionalCount(usage.reasoningTokens),
    cachedTokens: optionalCount(usage.cachedTokens),
    totalTokens: optionalCount(usage.totalTokens),
    providerCostMicrounits:
      providerCost === null ? null : Math.round(providerCost * 1_000_000),
    providerCostUnit: 'openrouter-credit',
    providerRequestId: boundedText(finish.providerRequestId, 160),
    attempts: Math.max(0, Math.round(finish.attempts ?? 0)),
    finishReason: boundedText(finish.finishReason, 80),
    status: finish.status,
    fallback: finish.fallback ?? finish.status === 'fallback',
    errorStage: boundedText(finish.errorStage, 80),
  };
}

/**
 * Observability is best-effort and must never make issue analysis or memory
 * creation fail. No issue body, prompt, generated text, API key, or email is
 * persisted here. The authentication owner key is stored as a one-way digest.
 */
export async function saveLlmRun(
  db: D1Database | undefined,
  record: LlmRunRecord,
) {
  if (!db) return false;
  try {
    const ownerDigest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`websidian-llm-owner-v1:${record.ownerId}`),
    );
    const ownerScope = Array.from(new Uint8Array(ownerDigest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    await db
      .prepare(`INSERT INTO websidian_llm_runs (
        id, owner_id, issue_id, lane, requested_model_id, served_model_id,
        prompt_version, reasoning_effort, evidence_count, input_characters,
        started_at, completed_at, first_token_ms, duration_ms, prompt_tokens,
        completion_tokens, reasoning_tokens, cached_tokens, total_tokens,
        provider_cost_microunits, provider_cost_unit, provider_request_id,
        attempts, finish_reason, status, fallback, error_stage
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        record.id,
        ownerScope,
        record.issueId,
        record.lane,
        record.requestedModelId,
        record.servedModelId,
        record.promptVersion,
        record.reasoningEffort,
        record.evidenceCount,
        record.inputCharacters,
        record.startedAt,
        record.completedAt,
        record.firstTokenMs,
        record.durationMs,
        record.promptTokens,
        record.completionTokens,
        record.reasoningTokens,
        record.cachedTokens,
        record.totalTokens,
        record.providerCostMicrounits,
        record.providerCostUnit,
        record.providerRequestId,
        record.attempts,
        record.finishReason,
        record.status,
        record.fallback ? 1 : 0,
        record.errorStage,
      )
      .run();
    return true;
  } catch (error) {
    console.warn('Websidian LLM telemetry unavailable', {
      lane: record.lane,
      status: record.status,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return false;
  }
}

export type LlmRunExportRow = Omit<LlmRunRecord, 'ownerId'>;

const databaseText = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
      ? `${value}`
      : '';

const optionalDatabaseText = (value: unknown) =>
  value === null || value === undefined ? null : databaseText(value);

export async function listLlmRuns(
  db: D1Database,
  ownerId: string,
  requestedLimit = 1_000,
): Promise<LlmRunExportRow[]> {
  const limit = Math.max(1, Math.min(5_000, Math.floor(requestedLimit)));
  const ownerDigest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`websidian-llm-owner-v1:${ownerId}`),
  );
  const ownerScope = Array.from(new Uint8Array(ownerDigest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const result = await db
    .prepare(`SELECT
      id, issue_id AS issueId, lane, requested_model_id AS requestedModelId,
      served_model_id AS servedModelId, prompt_version AS promptVersion,
      reasoning_effort AS reasoningEffort, evidence_count AS evidenceCount,
      input_characters AS inputCharacters, started_at AS startedAt,
      completed_at AS completedAt, first_token_ms AS firstTokenMs,
      duration_ms AS durationMs, prompt_tokens AS promptTokens,
      completion_tokens AS completionTokens, reasoning_tokens AS reasoningTokens,
      cached_tokens AS cachedTokens, total_tokens AS totalTokens,
      provider_cost_microunits AS providerCostMicrounits,
      provider_cost_unit AS providerCostUnit,
      provider_request_id AS providerRequestId, attempts,
      finish_reason AS finishReason, status, fallback,
      error_stage AS errorStage
    FROM websidian_llm_runs
    WHERE owner_id = ?
    ORDER BY started_at DESC, id DESC
    LIMIT ?`)
    .bind(ownerScope, limit)
    .all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: databaseText(row.id),
    issueId: optionalDatabaseText(row.issueId),
    lane: databaseText(row.lane) as LlmLane,
    requestedModelId: databaseText(row.requestedModelId),
    servedModelId: optionalDatabaseText(row.servedModelId),
    promptVersion: databaseText(row.promptVersion),
    reasoningEffort: databaseText(row.reasoningEffort),
    evidenceCount: Number(row.evidenceCount),
    inputCharacters: Number(row.inputCharacters),
    startedAt: String(row.startedAt),
    completedAt: String(row.completedAt),
    firstTokenMs: row.firstTokenMs === null ? null : Number(row.firstTokenMs),
    durationMs: Number(row.durationMs),
    promptTokens: row.promptTokens === null ? null : Number(row.promptTokens),
    completionTokens:
      row.completionTokens === null ? null : Number(row.completionTokens),
    reasoningTokens:
      row.reasoningTokens === null ? null : Number(row.reasoningTokens),
    cachedTokens: row.cachedTokens === null ? null : Number(row.cachedTokens),
    totalTokens: row.totalTokens === null ? null : Number(row.totalTokens),
    providerCostMicrounits:
      row.providerCostMicrounits === null
        ? null
        : Number(row.providerCostMicrounits),
    providerCostUnit: 'openrouter-credit',
    providerRequestId: optionalDatabaseText(row.providerRequestId),
    attempts: Number(row.attempts),
    finishReason: optionalDatabaseText(row.finishReason),
    status: databaseText(row.status) as LlmRunStatus,
    fallback: Boolean(row.fallback),
    errorStage: optionalDatabaseText(row.errorStage),
  }));
}

function csvCell(value: unknown) {
  const source =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? `${value}`
          : JSON.stringify(value);
  const text = /^[=+\-@]/.test(source) ? `'${source}` : source;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function llmRunsCsv(rows: LlmRunExportRow[]) {
  const keys: (keyof LlmRunExportRow)[] = [
    'id',
    'issueId',
    'lane',
    'requestedModelId',
    'servedModelId',
    'promptVersion',
    'reasoningEffort',
    'evidenceCount',
    'inputCharacters',
    'startedAt',
    'completedAt',
    'firstTokenMs',
    'durationMs',
    'promptTokens',
    'completionTokens',
    'reasoningTokens',
    'cachedTokens',
    'totalTokens',
    'providerCostMicrounits',
    'providerCostUnit',
    'providerRequestId',
    'attempts',
    'finishReason',
    'status',
    'fallback',
    'errorStage',
  ];
  return [
    keys.join(','),
    ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(',')),
  ].join('\r\n');
}
