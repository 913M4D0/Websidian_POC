import {
  authenticate,
  apiFailure,
  ApiError,
  json,
  readJson,
} from '@/lib/api-security';
import { findIssue, resetDemoIssueOverlay } from '@/lib/issue-store';
import { deleteMemoryArtifact } from '@/lib/memory-store';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = authenticate(request, true);
    const { id } = await context.params;
    const raw = await readJson(request);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new ApiError(400, '현재 이슈 버전을 확인해 주세요.');
    const input = raw as { expectedRevision?: unknown };
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      (input.expectedRevision as number) < 1
    )
      throw new ApiError(400, '현재 이슈 버전을 확인해 주세요.');
    const current = await findIssue(actor, id);
    if (current.status !== 'closed')
      throw new ApiError(409, '이미 처리 전 상태인 이슈입니다.');
    if (current.revision !== input.expectedRevision)
      throw new ApiError(
        409,
        '다른 창에서 이슈가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
      );

    const issue = await resetDemoIssueOverlay(
      actor,
      id,
      input.expectedRevision as number,
    );
    await deleteMemoryArtifact(actor, id);
    return json({ issue });
  } catch (error) {
    return apiFailure(error);
  }
}
