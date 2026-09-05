import {
  authenticate,
  apiFailure,
  ApiError,
  json,
  readJson,
} from '@/lib/api-security';
import { embeddingPolicy, getEmbeddingStatus } from '@/lib/embedding-server';
import { listIssues } from '@/lib/issue-store';
import { indexMemoryBatch } from '@/lib/memory-service';
import { memoryIndexSnapshot } from '@/lib/memory-store';

export async function GET(request: Request) {
  try {
    const actor = authenticate(request);
    const issues = await listIssues(actor);
    const snapshot = await memoryIndexSnapshot(
      actor,
      issues,
      embeddingPolicy.modelId,
    );
    return json({
      total: snapshot.total,
      indexed: snapshot.indexed,
      compiled: snapshot.compiled,
      remaining: snapshot.remaining,
      stale: snapshot.stale,
      artifacts: snapshot.publicArtifacts,
      embedding: getEmbeddingStatus(),
      disclosure:
        '실행 시 처리 완료 이슈의 발췌문을 OpenRouter ZDR 제공자에게 전송하며 API 사용량이 발생할 수 있습니다.',
    });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const raw = (await readJson(request)) as { limit?: unknown };
    const limit = raw?.limit ?? embeddingPolicy.batchSize;
    if (!Number.isSafeInteger(limit) || (limit as number) < 1)
      throw new ApiError(400, '색인 처리 건수를 확인해 주세요.');
    const result = await indexMemoryBatch(
      actor,
      await listIssues(actor),
      limit as number,
    );
    return json({
      total: result.total,
      indexed: result.indexed,
      compiled: result.compiled,
      remaining: result.remaining,
      stale: result.stale,
      processed: result.processed,
      modelId: result.modelId,
      artifacts: result.publicArtifacts,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
