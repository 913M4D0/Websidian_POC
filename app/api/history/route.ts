import { authenticate, apiFailure, json, readJson } from '@/lib/api-security';
import { listIssues } from '@/lib/issue-store';
import { buildHistory, parseHistoryInput } from '@/lib/issue-history';

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const raw = await readJson(request);
    const issues = await listIssues(actor);
    const input = parseHistoryInput(raw, issues);
    return json(buildHistory(input, issues));
  } catch (error) {
    return apiFailure(error);
  }
}
