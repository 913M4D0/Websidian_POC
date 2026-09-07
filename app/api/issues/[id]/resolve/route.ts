import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import { findIssue, listIssues, saveResolution } from '@/lib/issue-store';
import { buildHistory } from '@/lib/issue-history';
import { issueText } from '@/lib/issue-search';
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
    const issues = await listIssues(actor);
    const automaticEvidence = buildHistory(
      {
        query: issueText(current).slice(0, 6000),
        referenceId: current.id,
      },
      issues,
    )
      .evidence.slice(0, 30)
      .map((item) => item.issueId);
    const next = resolveIssue(
      current,
      {
        ...(raw as Record<string, unknown>),
        evidenceIssueIds: automaticEvidence,
      },
      '처리 담당자',
      new Date().toISOString(),
      issues,
    );
    return json({ issue: await saveResolution(actor, next, current.revision) });
  } catch (error) {
    return apiFailure(error);
  }
}
