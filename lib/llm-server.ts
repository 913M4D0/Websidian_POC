import { env } from 'cloudflare:workers';
import {
  BriefError,
  buildOpenRouterRequest,
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
} from './memory-artifact.ts';
import {
  buildIssueInsightRequest,
  type IssueAnalysisResponse,
  type IssueInsightContext,
  type IssueTestPlanResponse,
} from './issue-insight.ts';
import {
  parseDelimitedBrief,
  parseDelimitedIssueAnalysis,
  parseDelimitedIssueTestPlan,
  parseDelimitedMemory,
} from './delimited-output.ts';
import { readOpenRouterTextStream } from './openrouter-stream.ts';

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

type GenerationHooks = {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
};

const generationSignal = (signal?: AbortSignal) => {
  const deadline = AbortSignal.timeout(llmPolicy.generationTimeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
};

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
    modelId: 'source-fallback',
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
async function reserveCall(
  actor: string,
  lane: 'insight' | 'brief' | 'memory',
) {
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
  for (const [duration, globalMaximum, laneMaximum] of [
    [60_000, 6, 4],
    [3_600_000, 36, 24],
  ]) {
    for (const [scope, maximum] of [
      ['global', globalMaximum],
      [lane, laneMaximum],
    ] as const) {
      const bucket = `${scope}:${duration}:${Math.floor(now / duration)}`;
      const result = await db
        .prepare(`INSERT INTO websidian_llm_limits (owner_id, bucket, count, expires_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(owner_id, bucket) DO UPDATE SET count = count + 1
      WHERE count < ? RETURNING count`)
        .bind(actor, bucket, now + duration * 2, maximum)
        .first<{ count: number }>();
      if (!result)
        throw new BriefError(
          'AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
          429,
        );
    }
  }
}

function providerRequestId(response: Response) {
  return (
    response.headers.get('x-generation-id') ||
    response.headers.get('x-request-id') ||
    response.headers.get('x-openrouter-request-id') ||
    'unknown'
  ).slice(0, 120);
}

function logProviderFailure(
  operation: string,
  stage: string,
  startedAt: number,
  details: Record<string, string | number | boolean | null>,
) {
  // Never log issue text, generated output, provider bodies, or credentials.
  console.warn('Websidian AI request failed', {
    operation,
    stage,
    elapsedMs: Date.now() - startedAt,
    ...details,
  });
}

function streamWarning(result: {
  finishReason: string | null;
  completed: boolean;
  providerError: boolean;
}) {
  return result.providerError ||
    result.finishReason !== 'stop' ||
    !result.completed
    ? 'AI 응답이 중간에 끝났거나 완전히 수신되지 않아, 받은 평문 전체를 그대로 표시합니다.'
    : undefined;
}

const safeLine = (value: string, maximum = 360) =>
  value
    .replace(/<</g, '‹‹')
    .replace(/>>/g, '››')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);

function sourceInsightFallback(
  context: IssueInsightContext,
  kind: 'analysis' | 'test-cases',
  reason: string,
): IssueAnalysisResponse | IssueTestPlanResponse {
  const histories = context.relatedHistories.slice(0, 3);
  const common = {
    rootIssueId: context.rootIssue.id,
    evidenceIds: context.citationIds,
    modelId: 'source-fallback',
    reasoning: 'source-only',
    generatedAt: new Date().toISOString(),
    engine: 'source-fallback' as const,
    warning: `${reason} 원문 기반 안전 결과를 표시합니다.`,
  };
  if (kind === 'analysis') {
    const historyText = histories.length
      ? histories
          .map(
            (item) =>
              `<<확인된맥락>>\n<<제목>>${safeLine(item.title)}\n<<구분>>사실\n<<근거>>${item.issueId}\n<<내용>>${safeLine(item.resolution.outcome)} · ${safeLine(item.resolution.bodyExcerpt, 520)}`,
          )
          .join('\n')
      : `<<확인된맥락>>\n<<제목>>현재 이슈 원문\n<<구분>>사실\n<<근거>>${context.rootIssue.id}\n<<내용>>${safeLine(context.rootIssue.bodyExcerpt, 520)}`;
    const content = [
      '<<요약>>',
      `${safeLine(context.rootIssue.title)}에 대해 연결된 원문 이력을 우선 확인합니다. 실시간 AI 보강은 완료되지 않았습니다.`,
      historyText,
      '<<권장처리>>',
      '<<제목>>원문 근거 재확인',
      '<<구분>>추정',
      `<<근거>>${context.citationIds.slice(0, 3).join(',')}`,
      '<<내용>>조치 전에 현재 이슈와 연결된 처리 이력의 적용 범위와 변경 자료를 직접 확인하세요.',
      '<<끝>>',
    ].join('\n');
    return {
      ...common,
      kind,
      content,
      analysis: parseDelimitedIssueAnalysis(content, context.citationIds),
    };
  }
  const evidenceIds = context.citationIds.slice(0, 3);
  const cases = [
    ['TC-01', '현재 이슈 핵심 흐름', '현재 이슈의 재현 조건을 준비한다.'],
    [
      'TC-02',
      '연결된 과거 처리 회귀',
      '연결된 과거 이슈의 처리 조건을 준비한다.',
    ],
    [
      'TC-03',
      '부작용 및 중복 처리 방지',
      '관련 업무 흐름과 변경 자료를 준비한다.',
    ],
  ]
    .map(
      ([id, title, precondition]) =>
        `<<테스트케이스>>\n<<번호>>${id}\n<<제목>>${title}\n<<우선순위>>필수\n<<사전조건>>${precondition}\n<<실행단계>>현재 이슈 흐름을 실행한다.\n연결된 이력의 조건을 함께 적용한다.\n중복 처리와 부작용 여부를 확인한다.\n<<기대결과>>기대 동작을 만족하고 관련 이력의 회귀 위험이 발생하지 않는다.\n<<근거>>${evidenceIds.join(',')}`,
    )
    .join('\n');
  const content = [
    '<<전략>>',
    `${safeLine(context.rootIssue.title)}의 현재 흐름과 연결된 처리 이력을 함께 검증합니다. 실시간 AI 보강은 완료되지 않았습니다.`,
    cases,
    '<<끝>>',
  ].join('\n');
  return {
    ...common,
    kind,
    content,
    testPlan: parseDelimitedIssueTestPlan(content, context.citationIds),
  };
}

function sourceBriefFallback(
  context: ReturnType<typeof buildBriefContext>,
  reason: string,
): BriefResponse {
  const evidenceIds = context.sources.map((source) => source.issueId);
  const findings = context.sources
    .slice(0, 3)
    .map(
      (source) =>
        `<<확인사항>>\n<<제목>>${safeLine(source.title)}\n<<구분>>사실\n<<근거>>${source.issueId}\n<<내용>>${safeLine(source.resolution.outcome)} · ${safeLine(source.resolution.bodyExcerpt, 520)}`,
    )
    .join('\n');
  const content = [
    '<<요약>>',
    '실시간 AI 보강을 완료하지 못해 선택한 이슈 원문과 처리 결과를 그대로 정리했습니다.',
    findings,
    '<<다음행동>>',
    '현재 이슈와 각 근거 이슈의 적용 범위 및 변경 자료를 직접 확인하세요.',
    '<<끝>>',
  ].join('\n');
  return {
    brief: parseDelimitedBrief(content, evidenceIds),
    content,
    evidenceIds,
    modelId: llmPolicy.modelId,
    reasoning: 'source-only',
    generatedAt: new Date().toISOString(),
    engine: 'source-fallback',
    warning: `${reason} 원문 기반 안전 결과를 표시합니다.`,
  };
}

async function generateIssueInsight(
  actor: string,
  context: IssueInsightContext,
  kind: 'analysis' | 'test-cases',
  hooks: GenerationHooks = {},
): Promise<IssueAnalysisResponse | IssueTestPlanResponse> {
  const status = await getLlmStatus();
  if (!status.ready) throw new BriefError(status.reason, 503);
  const lockKey = `${actor}:insight:${kind}:${context.rootIssue.id}`;
  if (inFlight.has(lockKey))
    throw new BriefError('이미 이 이슈의 AI 작업을 처리 중입니다.', 429);
  const apiKey = configuration().OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new BriefError('AI 서버 설정이 필요합니다.', 503);
  inFlight.add(lockKey);
  const startedAt = Date.now();
  try {
    const model = await verifiedModel();
    await reserveCall(actor, 'insight');
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
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify(buildIssueInsightRequest(model, context, kind)),
        signal: generationSignal(hooks.signal),
        redirect: 'manual',
      },
    );
    if (!response.ok) {
      logProviderFailure(kind, 'provider-http', startedAt, {
        upstreamStatus: response.status,
        providerRequestId: providerRequestId(response),
      });
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
    const streamed = await readOpenRouterTextStream(
      response,
      512_000,
      hooks.onDelta,
    );
    const warning = streamWarning(streamed);
    if (warning)
      logProviderFailure(kind, 'stream-partial', startedAt, {
        finishReason: streamed.finishReason,
        completed: streamed.completed,
        providerError: streamed.providerError,
        receivedChars: streamed.text.length,
        providerRequestId: providerRequestId(response),
      });
    const common = {
      rootIssueId: context.rootIssue.id,
      evidenceIds: context.citationIds,
      content: streamed.text,
      modelId: model.id,
      reasoning: model.effort,
      generatedAt: new Date().toISOString(),
      engine: 'openrouter' as const,
      ...(warning ? { warning } : {}),
    };
    return kind === 'analysis'
      ? {
          ...common,
          kind,
          analysis: parseDelimitedIssueAnalysis(
            streamed.text,
            context.citationIds,
          ),
        }
      : {
          ...common,
          kind,
          testPlan: parseDelimitedIssueTestPlan(
            streamed.text,
            context.citationIds,
          ),
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
    inFlight.delete(lockKey);
  }
}

export async function generateIssueAnalysis(
  actor: string,
  context: IssueInsightContext,
  hooks: GenerationHooks = {},
): Promise<IssueAnalysisResponse> {
  try {
    return (await generateIssueInsight(
      actor,
      context,
      'analysis',
      hooks,
    )) as IssueAnalysisResponse;
  } catch (error) {
    const reason =
      error instanceof BriefError
        ? error.message
        : 'AI 서비스 연결에 실패했습니다.';
    console.warn('Websidian AI source fallback', {
      operation: 'analysis',
      status: error instanceof BriefError ? error.status : 503,
    });
    return sourceInsightFallback(
      context,
      'analysis',
      reason,
    ) as IssueAnalysisResponse;
  }
}

export async function generateIssueTestCases(
  actor: string,
  context: IssueInsightContext,
  hooks: GenerationHooks = {},
): Promise<IssueTestPlanResponse> {
  try {
    return (await generateIssueInsight(
      actor,
      context,
      'test-cases',
      hooks,
    )) as IssueTestPlanResponse;
  } catch (error) {
    const reason =
      error instanceof BriefError
        ? error.message
        : 'AI 서비스 연결에 실패했습니다.';
    console.warn('Websidian AI source fallback', {
      operation: 'test-cases',
      status: error instanceof BriefError ? error.status : 503,
    });
    return sourceInsightFallback(
      context,
      'test-cases',
      reason,
    ) as IssueTestPlanResponse;
  }
}

async function generateBriefWithProvider(
  actor: string,
  context: ReturnType<typeof buildBriefContext>,
  hooks: GenerationHooks = {},
): Promise<BriefResponse> {
  const status = await getLlmStatus();
  if (!status.ready) throw new BriefError(status.reason, 503);
  const lockKey = `${actor}:brief`;
  if (inFlight.has(lockKey))
    throw new BriefError('이미 AI Brief를 생성 중입니다.', 429);
  const apiKey = configuration().OPENROUTER_API_KEY;
  if (!apiKey?.trim()) throw new BriefError('AI 서버 설정이 필요합니다.', 503);
  inFlight.add(lockKey);
  const startedAt = Date.now();
  try {
    const model = await verifiedModel();
    await reserveCall(actor, 'brief');
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'Websidian issue history',
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify(buildOpenRouterRequest(model, context)),
        signal: generationSignal(hooks.signal),
        redirect: 'manual',
      },
    );
    if (!response.ok) {
      logProviderFailure('brief', 'provider-http', startedAt, {
        upstreamStatus: response.status,
        providerRequestId: providerRequestId(response),
      });
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
    const streamed = await readOpenRouterTextStream(
      response,
      512_000,
      hooks.onDelta,
    );
    const warning = streamWarning(streamed);
    if (warning)
      logProviderFailure('brief', 'stream-partial', startedAt, {
        finishReason: streamed.finishReason,
        completed: streamed.completed,
        providerError: streamed.providerError,
        receivedChars: streamed.text.length,
        providerRequestId: providerRequestId(response),
      });
    const evidenceIds = context.sources.map((source) => source.issueId);
    return {
      brief: parseDelimitedBrief(streamed.text, evidenceIds),
      content: streamed.text,
      evidenceIds,
      modelId: model.id,
      reasoning: model.effort,
      generatedAt: new Date().toISOString(),
      engine: 'openrouter',
      ...(warning ? { warning } : {}),
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
    inFlight.delete(lockKey);
  }
}

export async function generateBrief(
  actor: string,
  context: ReturnType<typeof buildBriefContext>,
  hooks: GenerationHooks = {},
): Promise<BriefResponse> {
  try {
    return await generateBriefWithProvider(actor, context, hooks);
  } catch (error) {
    const reason =
      error instanceof BriefError
        ? error.message
        : 'AI 서비스 연결에 실패했습니다.';
    console.warn('Websidian AI source fallback', {
      operation: 'brief',
      status: error instanceof BriefError ? error.status : 503,
    });
    return sourceBriefFallback(context, reason);
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
  const lockKey = `${actor}:memory:${issue.id}`;
  if (inFlight.has(lockKey))
    throw new MemoryArtifactError('이미 AI 작업을 처리 중입니다.', 429);
  const apiKey = configuration().OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new MemoryArtifactError('AI 서버 설정이 필요합니다.', 503);
  inFlight.add(lockKey);
  const startedAt = Date.now();
  try {
    const model = await verifiedModel();
    await reserveCall(actor, 'memory');
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-OpenRouter-Title': 'Websidian memory compiler',
          'X-OpenRouter-Metadata': 'enabled',
        },
        body: JSON.stringify(buildMemoryCompileRequest(model, issue)),
        signal: AbortSignal.timeout(llmPolicy.generationTimeoutMs),
        redirect: 'manual',
      },
    );
    if (!response.ok) {
      logProviderFailure('memory', 'provider-http', startedAt, {
        upstreamStatus: response.status,
        providerRequestId: providerRequestId(response),
      });
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
    const streamed = await readOpenRouterTextStream(response);
    const warning = streamWarning(streamed);
    if (warning)
      logProviderFailure('memory', 'stream-partial', startedAt, {
        finishReason: streamed.finishReason,
        completed: streamed.completed,
        providerError: streamed.providerError,
        receivedChars: streamed.text.length,
        providerRequestId: providerRequestId(response),
      });
    const compiled = parseDelimitedMemory(streamed.text);
    if (
      warning ||
      !streamed.text.includes('<<끝>>') ||
      !compiled.summary ||
      (!compiled.concepts.length && !compiled.facets.length)
    )
      throw new MemoryArtifactError(
        'AI 기억 평문이 완결되지 않아 원문 기반 기억으로 전환합니다.',
        502,
      );
    return {
      compiled,
      content: streamed.text,
      modelId: model.id,
      reasoning: model.effort,
      compiledAt: new Date().toISOString(),
      ...(warning ? { warning } : {}),
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
    inFlight.delete(lockKey);
  }
}
