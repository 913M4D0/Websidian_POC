import { env } from 'cloudflare:workers';
import { MemoryArtifactError } from './memory-artifact.ts';

export const embeddingPolicy = {
  provider: 'OpenRouter',
  modelId: 'qwen/qwen3-embedding-8b',
  requestedModel: 'Qwen3 Embedding 8B',
  batchSize: 32,
  privacy: 'data_collection=deny · zdr=true',
} as const;

type EmbeddingEnvironment = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_EMBEDDING_MODEL?: string;
};
const configuration = () => env as unknown as EmbeddingEnvironment;

let catalogCache: { expires: number; promise: Promise<string> } | undefined;

async function boundedJson(response: Response, maximum: number) {
  const reader = response.body?.getReader();
  if (!reader)
    throw new MemoryArtifactError('임베딩 서비스 응답이 비어 있습니다.', 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new MemoryArtifactError(
        '임베딩 서비스 응답이 허용 크기를 초과했습니다.',
        502,
      );
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
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new MemoryArtifactError(
      '임베딩 서비스가 유효한 JSON을 반환하지 않았습니다.',
      502,
    );
  }
}

export function verifyEmbeddingCatalog(catalog: unknown, configured: string) {
  if (configured !== embeddingPolicy.modelId)
    throw new MemoryArtifactError(
      `OPENROUTER_EMBEDDING_MODEL을 ${embeddingPolicy.modelId}로 설정해 주세요.`,
      503,
    );
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
    throw new MemoryArtifactError(
      '임베딩 모델 목록을 확인하지 못했습니다.',
      503,
    );
  const data = (catalog as { data?: unknown }).data;
  if (
    !Array.isArray(data) ||
    !data.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        (item as { id?: unknown }).id === configured,
    )
  )
    throw new MemoryArtifactError(
      'OpenRouter 공개 목록에서 지정 임베딩 모델을 확인하지 못했습니다.',
      503,
    );
  return configured;
}

async function verifiedEmbeddingModel() {
  const configured = configuration().OPENROUTER_EMBEDDING_MODEL?.trim();
  if (!configured)
    throw new MemoryArtifactError(
      'OPENROUTER_EMBEDDING_MODEL 서버 설정이 필요합니다.',
      503,
    );
  if (!catalogCache || catalogCache.expires < Date.now()) {
    const promise = (async () => {
      try {
        const response = await fetch(
          'https://openrouter.ai/api/v1/embeddings/models',
          { signal: AbortSignal.timeout(8000), redirect: 'manual' },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new MemoryArtifactError(
            'OpenRouter 임베딩 모델 목록을 확인하지 못했습니다.',
            503,
          );
        }
        return verifyEmbeddingCatalog(
          await boundedJson(response, 4_000_000),
          configured,
        );
      } catch (error) {
        if (error instanceof MemoryArtifactError) throw error;
        throw new MemoryArtifactError(
          '임베딩 모델 목록 확인이 지연되고 있습니다.',
          503,
        );
      }
    })();
    catalogCache = { expires: Date.now() + 120_000, promise };
  }
  return catalogCache.promise;
}

export function getEmbeddingStatus() {
  const settings = configuration();
  const requires = [
    ...(!settings.OPENROUTER_API_KEY?.trim() ? ['OPENROUTER_API_KEY'] : []),
    ...(!settings.OPENROUTER_EMBEDDING_MODEL?.trim()
      ? ['OPENROUTER_EMBEDDING_MODEL']
      : []),
  ];
  const exactModel =
    settings.OPENROUTER_EMBEDDING_MODEL?.trim() === embeddingPolicy.modelId;
  return {
    ready: requires.length === 0 && exactModel,
    modelId: embeddingPolicy.modelId,
    requestedModel: embeddingPolicy.requestedModel,
    requires,
    reason: requires.length
      ? '임베딩 서버 설정이 필요합니다.'
      : exactModel
        ? '의미 색인 요청 준비됨'
        : `임베딩 모델을 ${embeddingPolicy.modelId}로 고정해 주세요.`,
  };
}

function parseVectors(value: unknown, expected: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new MemoryArtifactError('임베딩 응답 형식이 올바르지 않습니다.', 502);
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length !== expected)
    throw new MemoryArtifactError('임베딩 응답 개수가 일치하지 않습니다.', 502);
  const ordered = data
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new MemoryArtifactError(
          '임베딩 항목 형식이 올바르지 않습니다.',
          502,
        );
      const { index, embedding } = item as {
        index?: unknown;
        embedding?: unknown;
      };
      if (
        !Number.isSafeInteger(index) ||
        !Array.isArray(embedding) ||
        !embedding.length ||
        embedding.length > 16_384 ||
        embedding.some(
          (number) => typeof number !== 'number' || !Number.isFinite(number),
        )
      )
        throw new MemoryArtifactError(
          '임베딩 벡터를 검증하지 못했습니다.',
          502,
        );
      return { index: index as number, embedding: embedding as number[] };
    })
    .sort((left, right) => left.index - right.index);
  if (ordered.some((item, index) => item.index !== index))
    throw new MemoryArtifactError('임베딩 응답 순서가 일치하지 않습니다.', 502);
  const dimensions = ordered[0].embedding.length;
  if (ordered.some((item) => item.embedding.length !== dimensions))
    throw new MemoryArtifactError('임베딩 벡터 차원이 일치하지 않습니다.', 502);
  return ordered.map((item) => item.embedding);
}

export async function embedTexts(
  inputs: string[],
  inputType: 'search_document' | 'search_query',
) {
  if (!inputs.length || inputs.length > embeddingPolicy.batchSize)
    throw new MemoryArtifactError(
      `임베딩은 한 번에 1~${embeddingPolicy.batchSize}건까지 처리합니다.`,
    );
  if (inputs.some((input) => !input.trim() || input.length > 80_000))
    throw new MemoryArtifactError('임베딩 입력 크기를 확인해 주세요.');
  const key = configuration().OPENROUTER_API_KEY?.trim();
  if (!key)
    throw new MemoryArtifactError('OpenRouter API 키 설정이 필요합니다.', 503);
  const model = await verifiedEmbeddingModel();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'Websidian semantic memory',
        'X-OpenRouter-Cache': 'false',
      },
      body: JSON.stringify({
        model,
        input: inputs,
        input_type: inputType,
        encoding_format: 'float',
        provider: {
          allow_fallbacks: true,
          data_collection: 'deny',
          zdr: true,
        },
      }),
      signal: AbortSignal.timeout(45_000),
      redirect: 'manual',
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429)
        throw new MemoryArtifactError(
          '임베딩 제공자의 요청 한도에 도달했습니다.',
          429,
        );
      if (response.status === 413)
        throw new MemoryArtifactError(
          '임베딩 입력이 너무 큽니다. 더 작은 묶음으로 다시 시도해 주세요.',
          413,
        );
      if ([401, 402, 403].includes(response.status))
        throw new MemoryArtifactError(
          'OpenRouter 키 권한·잔액·데이터 정책을 확인해 주세요.',
          503,
        );
      throw new MemoryArtifactError('임베딩 요청을 완료하지 못했습니다.', 502);
    }
    const envelope = await boundedJson(response, 16_000_000);
    return { model, vectors: parseVectors(envelope, inputs.length) };
  } catch (error) {
    if (error instanceof MemoryArtifactError) throw error;
    if (
      error instanceof Error &&
      ['AbortError', 'TimeoutError'].includes(error.name)
    )
      throw new MemoryArtifactError('임베딩 요청 시간이 초과되었습니다.', 504);
    throw new MemoryArtifactError('임베딩 서비스 연결에 실패했습니다.', 503);
  }
}
