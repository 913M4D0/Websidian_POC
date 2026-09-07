import { authenticate, apiFailure, json } from '@/lib/api-security';
import { buildIssueInsightContext } from '@/lib/issue-insight';
import { listIssues } from '@/lib/issue-store';
import { generateIssueAnalysis } from '@/lib/llm-server';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = authenticate(request, true);
    const { id } = await context.params;
    const { context: insightContext } = buildIssueInsightContext(
      id,
      await listIssues(actor),
    );
    return json(await generateIssueAnalysis(actor, insightContext));
  } catch (error) {
    return apiFailure(error);
  }
}
