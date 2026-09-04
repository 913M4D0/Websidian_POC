import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import { listIssues } from '@/lib/issue-store';
import { buildHistory } from '@/lib/issue-history';
import {
  BriefError,
  buildBriefContext,
  parseBriefInput,
} from '@/lib/brief-contract';
import { generateBrief, getLlmStatus } from '@/lib/llm-server';

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const input = parseBriefInput(await readJson(request));
    const status = await getLlmStatus();
    if (!status.ready) throw new BriefError(status.reason, 503);
    const issues = await listIssues(actor);
    // Client IDs are validated against the authenticated dataset; client evidence is ignored.
    const history = buildHistory(input, issues);
    const context = buildBriefContext(input, history.evidence, issues);
    return json(await generateBrief(actor, context));
  } catch (error) {
    return apiFailure(error);
  }
}
