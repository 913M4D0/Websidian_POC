import { authenticate, apiFailure, json } from '@/lib/api-security';
import { getLlmStatus } from '@/lib/llm-server';

export async function GET(request: Request) {
  try {
    authenticate(request);
    return json(await getLlmStatus());
  } catch (error) {
    return apiFailure(error);
  }
}
