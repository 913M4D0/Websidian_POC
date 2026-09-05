import {
  authenticate,
  apiFailure,
  ApiError,
  json,
  readJson,
} from '@/lib/api-security';
import { listIssues } from '@/lib/issue-store';
import { searchCompletedIssues } from '@/lib/issue-history';
import { rankHybrid } from '@/lib/memory-artifact';
import { semanticScores } from '@/lib/memory-service';

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const raw = (await readJson(request)) as {
      query?: unknown;
      excludeId?: unknown;
    };
    if (
      !raw ||
      typeof raw.query !== 'string' ||
      !raw.query.trim() ||
      raw.query.length > 6000
    )
      throw new ApiError(400, '탐색할 내용을 1~6,000자로 입력해 주세요.');
    if (raw.excludeId !== undefined && typeof raw.excludeId !== 'string')
      throw new ApiError(400, '기준 이슈 ID를 확인해 주세요.');
    const issues = await listIssues(actor);
    if (
      raw.excludeId !== undefined &&
      !issues.some((issue) => issue.id === raw.excludeId)
    )
      throw new ApiError(400, '기준 이슈를 확인해 주세요.');
    const lexical = searchCompletedIssues(
      raw.query,
      issues,
      raw.excludeId as string | undefined,
    );
    let semantic = new Map<string, number>();
    let semanticReason = '';
    try {
      semantic = await semanticScores(
        actor,
        raw.query,
        issues,
        raw.excludeId as string | undefined,
      );
    } catch (error) {
      semanticReason =
        error instanceof Error
          ? error.message
          : '의미 검색을 사용할 수 없어 원문 검색으로 전환했습니다.';
    }
    return json({
      query: raw.query,
      results: rankHybrid(lexical, semantic),
      engine: semantic.size ? 'hybrid-embedding-v1' : 'lexical-resource-v1',
      semanticReason,
      llmConnected: semantic.size > 0,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
