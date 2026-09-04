import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import { findIssue, saveIssueRevision } from '@/lib/issue-store';
import { appendIssueActivity } from '@/lib/issues';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = authenticate(request, true);
    const { id } = await context.params;
    const current = await findIssue(actor, id);
    const next = appendIssueActivity(
      current,
      await readJson(request),
      '처리 담당자',
      new Date().toISOString(),
    );
    return json({
      issue: await saveIssueRevision(actor, next, current.revision),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
