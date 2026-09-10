export type AiLimitLane =
  | 'analysis'
  | 'test-cases'
  | 'memory'
  | 'embedding-document'
  | 'embedding-query';

export class AiLimitError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AiLimitError';
    this.status = status;
  }
}

let rateInitialization: Promise<unknown> | undefined;

/** Durable reservations are atomic across Worker isolates and failed calls consume a slot. */
export async function reserveAiCall(
  db: D1Database | undefined,
  actor: string,
  lane: AiLimitLane,
) {
  if (!db)
    throw new AiLimitError('AI 요청 제한 저장소가 연결되지 않았습니다.', 503);
  rateInitialization ??= db
    .prepare(`CREATE TABLE IF NOT EXISTS websidian_llm_limits (
    owner_id TEXT NOT NULL, bucket TEXT NOT NULL, count INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id, bucket)
  )`)
    .run()
    .catch((error) => {
      rateInitialization = undefined;
      throw error;
    });
  await rateInitialization;
  const now = Date.now();
  await db
    .prepare('DELETE FROM websidian_llm_limits WHERE expires_at < ?')
    .bind(now)
    .run();
  for (const [duration, globalMaximum, laneMaximum] of [
    [60_000, 12, 6],
    [3_600_000, 120, 60],
  ]) {
    for (const [scope, maximum] of [
      ['global', globalMaximum],
      [lane, laneMaximum],
    ] as const) {
      const bucket = `${scope}:${duration}:${Math.floor(now / duration)}`;
      const result = await db
        .prepare(`INSERT INTO websidian_llm_limits (owner_id, bucket, count, expires_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(owner_id, bucket) DO UPDATE SET count = count + 1
      WHERE count < ? RETURNING count`)
        .bind(actor, bucket, now + duration * 2, maximum)
        .first<{ count: number }>();
      if (!result)
        throw new AiLimitError(
          'AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
          429,
        );
    }
  }
}
