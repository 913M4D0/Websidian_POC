import { authenticate, apiFailure, json } from '@/lib/api-security';
import { buildIssueInsightContext } from '@/lib/issue-insight';
import { listIssues } from '@/lib/issue-store';
import { generateIssueTestCases } from '@/lib/llm-server';
import { aiResponseStream } from '@/lib/ai-response-stream';

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
    return request.headers.get('accept')?.includes('text/event-stream')
      ? aiResponseStream(({ emit, signal }) =>
          generateIssueTestCases(actor, insightContext, {
            onDelta: emit,
            signal,
          }),
        )
      : json(await generateIssueTestCases(actor, insightContext));
  } catch (error) {
    return apiFailure(error);
  }
}
