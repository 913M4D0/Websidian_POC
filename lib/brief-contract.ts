import { llmPolicy } from './llm-policy.ts';

export type LlmStatus = {
  ready: boolean;
  reason: string;
  provider: 'OpenRouter';
  requestedModel: string;
  modelId: string;
  reasoning: string | null;
  requires: string[];
};

export class BriefError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BriefError';
    this.status = status;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BriefError('AI 데이터 형식을 확인해 주세요.');
  return value as Record<string, unknown>;
}

export type VerifiedModel = {
  id: string;
  effort: string;
  maxTokens: number;
};

/** Exact model selection: no aliases, Pro, batch or silent model substitutions. */
export function verifyRequestedModel(
  catalog: unknown,
  configuredId: string,
): VerifiedModel {
  if (configuredId !== llmPolicy.modelId)
    throw new BriefError(
      '요청한 GPT 5.6 Luna 모델 ID와 서버 설정이 다릅니다.',
      503,
    );
  const data = object(catalog).data;
  if (!Array.isArray(data))
    throw new BriefError('모델 목록을 확인하지 못했습니다.', 503);
  const model = data.find(
    (value) => value && typeof value === 'object' && value.id === configuredId,
  ) as Record<string, unknown> | undefined;
  if (!model)
    throw new BriefError(
      'OpenRouter 공개 목록에서 요청 모델을 확인하지 못했습니다.',
      503,
    );
  const name = typeof model.name === 'string' ? model.name.toLowerCase() : '';
  if (name.replace(/[-\s]+/g, ' ').trim() !== 'openai: gpt 5.6 luna')
    throw new BriefError(
      'OpenRouter 모델 이름이 요청한 모델과 일치하지 않습니다.',
      503,
    );
  const parameters = model.supported_parameters;
  if (
    !Array.isArray(parameters) ||
    ['reasoning', 'max_tokens'].some(
      (parameter) => !parameters.includes(parameter),
    )
  )
    throw new BriefError(
      '요청 모델의 추론 설정 지원을 확인하지 못했습니다.',
      503,
    );
  const reasoning =
    model.reasoning && typeof model.reasoning === 'object'
      ? (model.reasoning as Record<string, unknown>)
      : {};
  // OpenRouter documents null as accepting all gateway efforts; omission is NOT support.
  const efforts =
    reasoning.supported_efforts === null
      ? ['max']
      : reasoning.supported_efforts;
  if (!Array.isArray(efforts) || !efforts.includes('max'))
    throw new BriefError(
      '요청 모델의 최대 추론 강도(max) 지원을 확인하지 못했습니다.',
      503,
    );
  const topProvider =
    model.top_provider && typeof model.top_provider === 'object'
      ? (model.top_provider as Record<string, unknown>)
      : {};
  const advertisedMax = topProvider.max_completion_tokens;
  return {
    id: configuredId,
    effort: 'max',
    maxTokens:
      typeof advertisedMax === 'number' && advertisedMax > 0
        ? Math.floor(advertisedMax)
        : 128000,
  };
}
