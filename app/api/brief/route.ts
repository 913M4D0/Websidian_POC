import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import { listIssues } from '@/lib/issue-store';
import { buildHistory } from '@/lib/issue-history';
import { buildBriefContext, parseBriefInput } from '@/lib/brief-contract';
import { generateBrief } from '@/lib/llm-server';
import { aiResponseStream } from '@/lib/ai-response-stream';

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const input = parseBriefInput(await readJson(request));
    const issues = await listIssues(actor);
    // Client IDs are validated against the authenticated dataset; client evidence is ignored.
    const history = buildHistory(input, issues);
    const context = buildBriefContext(input, history.evidence, issues);
    return request.headers.get('accept')?.includes('text/event-stream')
      ? aiResponseStream(({ emit, signal }) =>
          generateBrief(actor, context, { onDelta: emit, signal }),
        )
      : json(await generateBrief(actor, context));
  } catch (error) {
    return apiFailure(error);
  }
}
