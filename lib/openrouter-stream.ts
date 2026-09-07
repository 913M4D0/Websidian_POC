import { BriefError } from './brief-contract.ts';

export type OpenRouterStreamResult = {
  text: string;
  finishReason: string | null;
  completed: boolean;
  providerError: boolean;
};

type StreamEnvelope = {
  error?: unknown;
  choices?: Array<{
    delta?: { content?: unknown };
    message?: { content?: unknown };
    finish_reason?: unknown;
  }>;
};

/**
 * Reads OpenRouter's SSE transport while treating the model output itself as
 * plain text. Malformed transport events are ignored once useful text exists;
 * callers can still accept complete delimiter blocks instead of discarding an
 * otherwise usable generation.
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
      return;
    }
    if (envelope.error) {
      providerError = true;
      return;
    }
    const choice = envelope.choices?.[0];
    const content = choice?.delta?.content ?? choice?.message?.content;
    if (typeof content === 'string') {
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
  return { text: cleaned, finishReason, completed, providerError };
}
