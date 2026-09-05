import { authenticate, apiFailure, json } from '@/lib/api-security';
import { findIssue } from '@/lib/issue-store';
import { compileAndIndexIssue } from '@/lib/memory-service';
import { toClientArtifact } from '@/lib/memory-artifact';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = authenticate(request, true);
    const { id } = await context.params;
    const result = await compileAndIndexIssue(
      actor,
      await findIssue(actor, id),
    );
    return json({
      artifact: toClientArtifact(result.artifact),
      reused: result.reused,
      ...('warning' in result && result.warning
        ? { warning: result.warning }
        : {}),
    });
  } catch (error) {
    return apiFailure(error);
  }
}
