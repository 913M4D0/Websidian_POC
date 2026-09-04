import {
  authenticate,
  apiFailure,
  ApiError,
  json,
  readJson,
} from '@/lib/api-security';
import { listIssues } from '@/lib/issue-store';
import { searchIssues } from '@/lib/issue-search';

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
    return json({
      query: raw.query,
      results: searchIssues(
        raw.query,
        issues,
        raw.excludeId as string | undefined,
      ),
      engine: 'lexical-resource-v1',
      llmConnected: false,
    });
  } catch (error) {
    return apiFailure(error);
  }
}
