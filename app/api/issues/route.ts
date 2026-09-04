import {
  authenticate,
  apiFailure,
  ApiError,
  json,
  readJson,
} from '@/lib/api-security';
import { listIssues, insertIssue } from '@/lib/issue-store';
import { parseCreateIssue, type Issue } from '@/lib/issues';
import { llmPolicy } from '@/lib/llm-policy';

export async function GET(request: Request) {
  try {
    return json({
      issues: await listIssues(authenticate(request)),
      llm: llmPolicy,
      storage: 'D1 · 개인 POC 작업공간',
    });
  } catch (error) {
    return apiFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = authenticate(request, true);
    const raw = await readJson(request);
    const input = parseCreateIssue(raw);
    const requestId = (raw as { requestId?: unknown }).requestId;
    if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId))
      throw new ApiError(400, '등록 요청 ID를 확인해 주세요.');
    const issue: Issue = {
      ...input,
      id: `WS-L-${requestId}`,
      status: 'open',
      synthetic: false,
      revision: 1,
      activities: [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          author: '작성자',
          body: '이슈를 등록했습니다.',
        },
      ],
      resolution: null,
    };
    return json({ issue: await insertIssue(actor, issue) }, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
