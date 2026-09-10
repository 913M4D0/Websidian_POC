import { BriefError } from './brief-contract.ts';
import type { LlmUsage } from './llm-observability.ts';

export type OpenRouterStreamResult = {
  text: string;
  finishReason: string | null;
  completed: boolean;
  providerError: boolean;
  firstContentAt: number | null;
  servedModelId: string | null;
  generationId: string | null;
  usage: LlmUsage;
};

type StreamEnvelope = {
  id?: unknown;
  model?: unknown;
  error?: unknown;
  usage?: unknown;
  choices?: Array<{
    delta?: { content?: unknown };
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
};

/**
 * Reads OpenRouter's SSE transport while treating the model output itself as
 * plain text. Malformed transport events mark the response partial while
 * preserving every valid model character received around them.
 */
export async function readOpenRouterTextStream(
  response: Response,
  maximum = 512_000,
  onDelta?: (text: string) => void,
): Promise<OpenRouterStreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new BriefError('AI 스트리밍 응답이 비어 있습니다.', 502);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason: string | null = null;
  let completed = false;
  let providerError = false;
  let received = 0;
  let contentMode: 'delta' | 'message' | null = null;
  let firstContentAt: number | null = null;
  let servedModelId: string | null = null;
  let generationId: string | null = null;
  let usage: LlmUsage = {
    promptTokens: null,
    completionTokens: null,
    reasoningTokens: null,
    cachedTokens: null,
    totalTokens: null,
    providerCost: null,
  };

  const nonNegativeNumber = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null;

  const readUsage = (value: unknown): LlmUsage | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const raw = value as Record<string, unknown>;
    const completionDetails =
      raw.completion_tokens_details &&
      typeof raw.completion_tokens_details === 'object' &&
      !Array.isArray(raw.completion_tokens_details)
        ? (raw.completion_tokens_details as Record<string, unknown>)
        : {};
    const promptDetails =
      raw.prompt_tokens_details &&
      typeof raw.prompt_tokens_details === 'object' &&
      !Array.isArray(raw.prompt_tokens_details)
        ? (raw.prompt_tokens_details as Record<string, unknown>)
        : {};
    return {
      promptTokens: nonNegativeNumber(raw.prompt_tokens),
      completionTokens: nonNegativeNumber(raw.completion_tokens),
      reasoningTokens: nonNegativeNumber(completionDetails.reasoning_tokens),
      cachedTokens: nonNegativeNumber(promptDetails.cached_tokens),
      totalTokens: nonNegativeNumber(raw.total_tokens),
      providerCost: nonNegativeNumber(raw.cost),
    };
  };

  const processLine = (line: string) => {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!normalized.startsWith('data:')) return;
    const payload = normalized.slice(5).trimStart();
    if (!payload) return;
    if (payload.trim() === '[DONE]') {
      completed = true;
      return;
    }
    let envelope: StreamEnvelope;
    try {
      envelope = JSON.parse(payload) as StreamEnvelope;
    } catch {
      providerError = true;
      return;
    }
    if (envelope.error) {
      providerError = true;
      return;
    }
    if (typeof envelope.id === 'string' && envelope.id.trim())
      generationId = envelope.id.trim().slice(0, 160);
    if (typeof envelope.model === 'string' && envelope.model.trim())
      servedModelId = envelope.model.trim().slice(0, 160);
    usage = readUsage(envelope.usage) ?? usage;
    const choice = envelope.choices?.[0];
    const delta = choice?.delta?.content;
    const message = choice?.message?.content;
    const cleanDelta =
      typeof delta === 'string' ? delta.split('\u0000').join('') : '';
    const cleanMessage =
      typeof message === 'string' ? message.split('\u0000').join('') : '';
    let content = '';
    if (cleanDelta && contentMode !== 'message') {
      contentMode = 'delta';
      content = cleanDelta;
    } else if (cleanMessage && contentMode === null) {
      // `message.content` is a one-shot non-stream fallback. Once selected,
      // later message snapshots or deltas must not duplicate that full value.
      contentMode = 'message';
      content = cleanMessage;
    }
    if (content) {
      firstContentAt ??= Date.now();
      text += content;
      onDelta?.(content);
    }
    if (typeof choice?.finish_reason === 'string')
      finishReason = choice.finish_reason;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximum) {
        await reader.cancel();
        throw new BriefError(
          'AI 스트리밍 응답이 허용 크기를 초과했습니다.',
          502,
        );
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) processLine(line);
    }
  } catch (error) {
    providerError = true;
    if (!text.trim()) throw error;
  }
  buffer += decoder.decode();
  if (buffer) processLine(buffer);
  const cleaned = text.split('\u0000').join('').trim();
  if (!cleaned)
    throw new BriefError(
      providerError
        ? 'AI 제공자가 스트리밍 중 생성을 완료하지 못했습니다.'
        : 'AI가 표시할 수 있는 평문을 반환하지 않았습니다.',
      502,
    );
  return {
    text: cleaned,
    finishReason,
    completed,
    providerError,
    firstContentAt,
    servedModelId,
    generationId,
    usage,
  };
}
