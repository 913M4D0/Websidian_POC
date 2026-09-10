import { env } from 'cloudflare:workers';
import { authenticate, apiFailure, ApiError, json } from '@/lib/api-security';
import { listLlmRuns, llmRunsCsv } from '@/lib/llm-observability';

export async function GET(request: Request) {
  try {
    const actor = authenticate(request);
    const db = (env as unknown as { DB?: D1Database }).DB;
    if (!db) throw new ApiError(503, 'AI 측정 저장소가 연결되지 않았습니다.');
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') ?? 1_000);
    if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 5_000)
      throw new ApiError(400, '측정 내역은 1~5,000건까지 조회할 수 있습니다.');
    const rows = await listLlmRuns(db, actor, rawLimit);
    if (url.searchParams.get('format') !== 'csv')
      return json({ scope: 'current-user', count: rows.length, rows });
    return new Response(`\uFEFF${llmRunsCsv(rows)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="websidian-llm-runs.csv"',
        'Cache-Control': 'private, no-store',
        Vary: 'Cookie, oai-authenticated-user-id',
      },
    });
  } catch (error) {
    return apiFailure(error);
  }
}
