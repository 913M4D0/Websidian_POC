import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import { findIssue, saveResolution } from '@/lib/issue-store';
import { resolveIssue } from '@/lib/issues';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = authenticate(request, true);
    const { id } = await context.params;
    const current = await findIssue(actor, id);
    const raw = await readJson(request);
    const next = resolveIssue(
      current,
      raw,
      '처리 담당자',
      new Date().toISOString(),
    );
    return json({ issue: await saveResolution(actor, next, current.revision) });
  } catch (error) {
    return apiFailure(error);
  }
}
