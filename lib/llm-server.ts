import { env } from 'cloudflare:workers';
import {
  BriefError,
  buildOpenRouterRequest,
  parseBriefOutput,
  verifyRequestedModel,
  type BriefResponse,
  type LlmStatus,
  type VerifiedModel,
  type buildBriefContext,
} from './brief-contract.ts';
import { llmPolicy } from './llm-policy.ts';
import type { Issue } from './issues.ts';
import {
  buildMemoryCompileRequest,
  MemoryArtifactError,
  parseCompiledMemory,
} from './memory-artifact.ts';
import {
  buildIssueInsightRequest,
  parseIssueAnalysisOutput,
  parseIssueTestPlanOutput,
  type IssueAnalysisResponse,
  type IssueInsightContext,
  type IssueTestPlanResponse,
} from './issue-insight.ts';

type LlmEnvironment = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  DB?: D1Database;
};
const configuration = () => env as unknown as LlmEnvironment;

// Cache only public catalog metadata. No API keys or generated/user data are cached.
let catalogCache:
  | { expires: number; promise: Promise<VerifiedModel> }
  | undefined;
let rateInitialization: Promise<unknown> | undefined;
const inFlight = new Set<string>();

async function boundedJson(
  response: Response,
  maximum: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new BriefError('AI 서비스 응답이 비어 있습니다.', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new BriefError('AI 서비스 응답이 허용 크기를 초과했습니다.', 502);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BriefError('AI 서비스가 유효한 JSON을 반환하지 않았습니다.', 502);
  }
}

async function verifiedModel(): Promise<VerifiedModel> {
  const configuredId = configuration().OPENROUTER_MODEL?.trim();
  if (configuredId !== llmPolicy.modelId)
    throw new BriefError(
      'OPENROUTER_MODEL을 검증된 GPT 5.6 Luna ID로 설정해 주세요.',
      503,
    );
  if (!catalogCache || catalogCache.expires < Date.now()) {
    const promise = (async () => {
      try {
        // This catalog request is public/read-only and never contains user data or a key.
        const response = await fetch('https://openrouter.ai/api/v1/models', {
          signal: AbortSignal.timeout(8000),
          redirect: 'manual',
        });
        if (!response.ok)
          throw new BriefError(
            'OpenRouter 모델 목록을 확인하지 못했습니다.',
            503,
          );
        return verifyRequestedModel(
          await boundedJson(response, 6_000_000),
          configuredId,
        );
      } catch (error) {
        if (error instanceof BriefError) throw error;
        throw new BriefError(
          '모델 목록 확인이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
          503,
        );
      }
    })();
    // Retain a short failure cache too, avoiding catalog request storms on outage.
    catalogCache = { expires: Date.now() + 120_000, promise };
  }
  return catalogCache.promise;
}

export async function getLlmStatus(): Promise<LlmStatus> {
  const settings = configuration();
  const requires = [
    ...(!settings.OPENROUTER_API_KEY?.trim() ? ['OPENROUTER_API_KEY'] : []),
    ...(!settings.OPENROUTER_MODEL?.trim() ? ['OPENROUTER_MODEL'] : []),
  ];
  const base = {
    ready: false,
    provider: 'OpenRouter' as const,
    requestedModel: llmPolicy.requestedModel,
    modelId: llmPolicy.modelId,
    reasoning: null,
    requires,
  };
  if (requires.length)
    return {
      ...base,
      reason:
        'AI 서버 설정이 필요합니다. 원문 기반 히스토리 탐색은 사용할 수 있습니다.',
    };
  try {
    const model = await verifiedModel();
    return {
      ...base,
      ready: true,
      reasoning: model.effort,
      reason:
        '모델과 서버 설정이 확인되었습니다. API 키 권한·잔액은 생성 요청 시 검증됩니다.',
    };
  } catch (error) {
    return {
      ...base,
      reason:
        error instanceof BriefError
          ? error.message
          : 'AI 서버 설정을 확인하지 못했습니다.',
    };
  }
}

/** Durable request reservations, atomic across Worker isolates; failures consume a slot too. */
async function reserveCall(actor: string) {
  const db = configuration().DB;
  if (!db)
    throw new BriefError('AI 요청 제한 저장소가 연결되지 않았습니다.', 503);
  rateInitialization ??= db
    .prepare(`CREATE TABLE IF NOT EXISTS websidian_llm_limits (
    owner_id TEXT NOT NULL, bucket TEXT NOT NULL, count INTEGER NOT NULL,
    expires_at INTEGER NOT NULL, PRIMARY KEY(owner_id, bucket)
  )`)
    .run()
    .catch((error) => {
      rateInitialization = undefined;
      throw error;
    });
  await rateInitialization;
  const now = Date.now();
  await db
    .prepare('DELETE FROM websidian_llm_limits WHERE expires_at < ?')
    .bind(now)
    .run();
  for (const [duration, maximum] of [
    [60_000, 3],
    [3_600_000, 18],
  ]) {
    const bucket = `${duration}:${Math.floor(now / duration)}`;
    const result = await db
      .prepare(`INSERT INTO websidian_llm_limits (owner_id, bucket, count, expires_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(owner_id, bucket) DO UPDATE SET count = count + 1
      WHERE count < ? RETURNING count`)
      .bind(actor, bucket, now + duration * 2, maximum)
      .first<{ count: number }>();
    if (!result)
      throw new BriefError(
        'AI 생성은 1분 3회·1시간 18회까지 가능합니다. 잠시 후 다시 시도해 주세요.',
        429,
      );
  }
}

async function generateIssueInsight(
  actor: string,
  context: IssueInsightContext,
  kind: 'analysis' | 'test-cases',
): Promise<IssueAnalysisResponse | IssueTestPlanResponse> {
  const status = await getLlmStatus();
  if (!status.ready) throw new BriefError(status.reason, 503);
  if (inFlight.has(actor))
    throw new BriefError('이미 이 이슈의 AI 작업을 처리 중입니다.', 429);
  const apiKey = configuration().OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new BriefError('AI 서버 설정이 필요합니다.', 503);
  inFlight.add(actor);
  try {
    const model = await verifiedModel();
    await reserveCall(actor);
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title':
            kind === 'analysis'
              ? 'Websidian issue analysis'
              : 'Websidian test cases',
        },
        body: JSON.stringify(buildIssueInsightRequest(model, context, kind)),
        signal: AbortSignal.timeout(llmPolicy.generationTimeoutMs),
        redirect: 'manual',
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new BriefError(
          'AI 제공자의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
          429,
        );
      if ([401, 402, 403].includes(response.status))
        throw new BriefError(
          'AI 제공자의 키 권한·잔액·모델 접근 설정을 확인해 주세요.',
          503,
        );
      throw new BriefError('AI가 결과 생성을 완료하지 못했습니다.', 502);
    }
    const envelope = (await boundedJson(response, 512_000)) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    };
    const choice = envelope.choices?.[0];
    if (
      choice?.finish_reason !== 'stop' ||
      typeof choice.message?.content !== 'string'
    )
      throw new BriefError('AI 응답이 완성되지 않았습니다.', 502);
    let raw: unknown;
    try {
      raw = JSON.parse(choice.message.content);
    } catch {
      throw new BriefError('AI 응답 JSON 형식이 올바르지 않습니다.', 502);
    }
    const common = {
      rootIssueId: context.rootIssue.id,
      evidenceIds: context.citationIds,
      modelId: model.id,
      reasoning: model.effort,
      generatedAt: new Date().toISOString(),
      engine: 'openrouter' as const,
    };
    return kind === 'analysis'
      ? {
          ...common,
          kind,
          analysis: parseIssueAnalysisOutput(raw, context.citationIds),
        }
      : {
          ...common,
          kind,
          testPlan: parseIssueTestPlanOutput(raw, context.citationIds),
        };
  } catch (error) {
    if (error instanceof BriefError) throw error;
    if (
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    )
      throw new BriefError(
        'AI 최대 추론이 3분 안에 완료되지 않았습니다. 자동 재요청하지 않았습니다.',
        504,
      );
    throw new BriefError('AI 서비스 연결에 실패했습니다.', 503);
  } finally {
    inFlight.delete(actor);
  }
}

export async function generateIssueAnalysis(
  actor: string,
  context: IssueInsightContext,
): Promise<IssueAnalysisResponse> {
  return (await generateIssueInsight(
    actor,
    context,
    'analysis',
  )) as IssueAnalysisResponse;
}

export async function generateIssueTestCases(
  actor: string,
  context: IssueInsightContext,
): Promise<IssueTestPlanResponse> {
  return (await generateIssueInsight(
    actor,
    context,
    'test-cases',
  )) as IssueTestPlanResponse;
}

export async function generateBrief(
  actor: string,
  context: ReturnType<typeof buildBriefContext>,
): Promise<BriefResponse> {
  const status = await getLlmStatus();
  if (!status.ready) throw new BriefError(status.reason, 503);
  if (inFlight.has(actor))
    throw new BriefError('이미 AI Brief를 생성 중입니다.', 429);
  const apiKey = configuration().OPENROUTER_API_KEY;
  if (!apiKey?.trim()) throw new BriefError('AI 서버 설정이 필요합니다.', 503);
  inFlight.add(actor);
  try {
    const model = await verifiedModel();
    await reserveCall(actor);
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'Websidian issue history',
        },
        body: JSON.stringify(buildOpenRouterRequest(model, context)),
        signal: AbortSignal.timeout(llmPolicy.generationTimeoutMs),
        redirect: 'manual',
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new BriefError(
          'AI 제공자의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
          429,
        );
      if ([401, 402, 403].includes(response.status))
        throw new BriefError(
          'AI 제공자의 키 권한·잔액·모델 접근 설정을 확인해 주세요.',
          503,
        );
      throw new BriefError(
        'AI 제공자가 생성 요청을 완료하지 못했습니다. 원문 근거는 유지됩니다.',
        502,
      );
    }
    const envelope = (await boundedJson(response, 512_000)) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    };
    const choice = envelope?.choices?.[0];
    if (
      choice?.finish_reason !== 'stop' ||
      typeof choice.message?.content !== 'string'
    )
      throw new BriefError(
        'AI 응답이 완성되지 않았습니다. 결과를 저장하지 않았습니다.',
        502,
      );
    let raw: unknown;
    try {
      raw = JSON.parse(choice.message.content);
    } catch {
      throw new BriefError('AI 응답이 지정된 Brief JSON 형식과 다릅니다.', 502);
    }
    const evidenceIds = context.sources.map((source) => source.issueId);
    return {
      brief: parseBriefOutput(raw, evidenceIds),
      evidenceIds,
      modelId: model.id,
      reasoning: model.effort,
      generatedAt: new Date().toISOString(),
      engine: 'openrouter',
    };
  } catch (error) {
    if (error instanceof BriefError) throw error;
    // Never log provider response bodies, submitted issue content or secret-bearing errors.
    if (
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    )
      throw new BriefError(
        'AI 최대 추론이 3분 안에 완료되지 않았습니다. 자동 재요청하지 않았습니다.',
        504,
      );
    throw new BriefError(
      'AI 연결에 실패했습니다. 원문 기반 히스토리 탐색을 이용해 주세요.',
      503,
    );
  } finally {
    inFlight.delete(actor);
  }
}

/**
 * Compile retrieval-only metadata for one completed issue. The caller stores
 * this separately from the canonical issue and may retry safely.
 */
export async function compileIssueMemory(actor: string, issue: Issue) {
  if (issue.status !== 'closed' || !issue.resolution)
    throw new MemoryArtifactError(
      '처리 완료된 이슈만 AI 기억으로 컴파일할 수 있습니다.',
      409,
    );
  const status = await getLlmStatus();
  if (!status.ready) throw new MemoryArtifactError(status.reason, 503);
  if (inFlight.has(actor))
    throw new MemoryArtifactError('이미 AI 작업을 처리 중입니다.', 429);
  const apiKey = configuration().OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new MemoryArtifactError('AI 서버 설정이 필요합니다.', 503);
  inFlight.add(actor);
  try {
    const model = await verifiedModel();
    await reserveCall(actor);
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'Websidian memory compiler',
        },
        body: JSON.stringify(buildMemoryCompileRequest(model, issue)),
        signal: AbortSignal.timeout(llmPolicy.generationTimeoutMs),
        redirect: 'manual',
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new MemoryArtifactError(
          'AI 제공자의 요청 한도에 도달했습니다.',
          429,
        );
      if ([401, 402, 403].includes(response.status))
        throw new MemoryArtifactError(
          'AI 제공자의 키 권한·잔액·모델 접근 설정을 확인해 주세요.',
          503,
        );
      throw new MemoryArtifactError(
        'AI 기억 컴파일을 완료하지 못했습니다.',
        502,
      );
    }
    const envelope = (await boundedJson(response, 512_000)) as {
      choices?: { message?: { content?: unknown }; finish_reason?: string }[];
    };
    const choice = envelope.choices?.[0];
    if (
      choice?.finish_reason !== 'stop' ||
      typeof choice.message?.content !== 'string'
    )
      throw new MemoryArtifactError('AI 기억 응답이 완성되지 않았습니다.', 502);
    let raw: unknown;
    try {
      raw = JSON.parse(choice.message.content);
    } catch {
      throw new MemoryArtifactError(
        'AI 기억 JSON 형식이 올바르지 않습니다.',
        502,
      );
    }
    return {
      compiled: parseCompiledMemory(raw),
      modelId: model.id,
      reasoning: model.effort,
      compiledAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof MemoryArtifactError) throw error;
    if (error instanceof BriefError)
      throw new MemoryArtifactError(error.message, error.status);
    if (
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    )
      throw new MemoryArtifactError(
        'AI 기억 컴파일이 3분 안에 완료되지 않았습니다.',
        504,
      );
    throw new MemoryArtifactError('AI 기억 서비스 연결에 실패했습니다.', 503);
  } finally {
    inFlight.delete(actor);
  }
}
