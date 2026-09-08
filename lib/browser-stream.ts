type StreamHooks = {
  onDelta?: (text: string) => void;
  onReplace?: (text: string) => void;
  onHeartbeat?: (elapsedMs: number) => void;
};

type StreamOptions = {
  fetcher?: typeof fetch;
  nextFrame?: () => Promise<void>;
  signal?: AbortSignal;
};

const browserFrame = () =>
  new Promise<void>((resolve) => {
    if (
      typeof requestAnimationFrame !== 'function' ||
      (typeof document !== 'undefined' &&
        document.visibilityState !== 'visible')
    ) {
      setTimeout(resolve, 0);
      return;
    }
    let settled = false;
    let animationFrame = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (animationFrame && typeof cancelAnimationFrame === 'function')
        cancelAnimationFrame(animationFrame);
      resolve();
    };
    // Some browsers pause animation frames under power-saving or occlusion.
    // The timer keeps an already received answer from remaining busy forever.
    const timeout = setTimeout(finish, 80);
    animationFrame = requestAnimationFrame(finish);
  });

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function takeCharacters(value: string, maximum: number) {
  if (graphemeSegmenter) {
    let end = 0;
    let count = 0;
    for (const item of graphemeSegmenter.segment(value)) {
      end = item.index + item.segment.length;
      count += 1;
      if (count >= maximum) break;
    }
    return { head: value.slice(0, end), tail: value.slice(end) };
  }
  const points = Array.from(value);
  const head = points.slice(0, maximum).join('');
  return { head, tail: value.slice(head.length) };
}

function charactersPerFrame(backlog: string) {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible')
    return Math.max(1, backlog.length);
  const size = backlog.length;
  if (size > 2048) return 256;
  if (size > 1024) return 128;
  if (size > 512) return 64;
  if (size > 256) return 32;
  if (size > 128) return 16;
  if (size > 64) return 8;
  if (size > 32) return 4;
  if (size > 16) return 2;
  return 1;
}

/**
 * Separates network delivery from painting. Gateways are allowed to coalesce
 * many SSE events into one chunk; this queue still yields between visible
 * updates so React cannot batch the entire answer and result into one paint.
 */
function progressiveTextQueue(
  onDelta: ((text: string) => void) | undefined,
  nextFrame: () => Promise<void>,
  signal?: AbortSignal,
) {
  let pending = '';
  let running: Promise<void> | null = null;
  let cancelled = false;

  const start = () => {
    if (running || !pending || !onDelta || cancelled) return;
    running = (async () => {
      while (pending && !cancelled && !signal?.aborted) {
        const frameStartedAt = Date.now();
        await nextFrame();
        if (cancelled || signal?.aborted) break;
        const delayedFrame = Date.now() - frameStartedAt >= 48;
        const { head, tail } = takeCharacters(
          pending,
          delayedFrame
            ? Math.max(1, pending.length)
            : charactersPerFrame(pending),
        );
        pending = tail;
        onDelta(head);
      }
      // Let React commit the last draft before the final result hides loading.
      if (!cancelled && !signal?.aborted) await nextFrame();
    })().finally(() => {
      running = null;
      if (pending && !cancelled && !signal?.aborted) start();
    });
  };

  return {
    append(text: string) {
      if (!text || cancelled || signal?.aborted) return;
      pending += text;
      start();
    },
    async drain() {
      while (running) await running;
    },
    cancel() {
      cancelled = true;
      pending = '';
    },
  };
}

function finalContent(value: unknown) {
  if (!value || typeof value !== 'object' || !('content' in value)) return '';
  return typeof value.content === 'string' ? value.content : '';
}

/** Fetches the app's SSE endpoint and reveals received text across paints. */
export async function streamApi<T>(
  path: string,
  body: unknown,
  hooks: StreamHooks = {},
  options: StreamOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const queue = progressiveTextQueue(
    hooks.onDelta,
    options.nextFrame ?? browserFrame,
    options.signal,
  );
  const throwIfAborted = () => {
    if (!options.signal?.aborted) return;
    queue.cancel();
    throw new DOMException('AI 요청이 취소되었습니다.', 'AbortError');
  };
  let response: Response;
  try {
    response = await fetcher(path, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error(
      '서버와 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.',
    );
  }
  if (!response.ok) {
    const raw = await response.text();
    let message = '';
    try {
      const payload = JSON.parse(raw) as { error?: unknown };
      if (typeof payload.error === 'string') message = payload.error;
    } catch {}
    throw new Error(message || 'AI 스트리밍 요청을 시작하지 못했습니다.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('AI 스트리밍 응답이 비어 있습니다.');
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedText = '';
  let result: T | undefined;
  let streamError = '';

  const processEvent = (block: string) => {
    const lines = block.replace(/\r\n?/g, '\n').split('\n');
    const event =
      lines
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim() || 'message';
    const raw = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!raw) return;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (event === 'delta') {
      const text =
        payload && typeof payload === 'object' && 'text' in payload
          ? payload.text
          : '';
      if (typeof text === 'string' && text) {
        receivedText += text;
        queue.append(text);
      }
    } else if (event === 'heartbeat') {
      const elapsed =
        payload && typeof payload === 'object' && 'elapsedMs' in payload
          ? payload.elapsedMs
          : 0;
      if (typeof elapsed === 'number') hooks.onHeartbeat?.(elapsed);
    } else if (event === 'result') {
      result = payload as T;
    } else if (event === 'error') {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? payload.error
          : '';
      streamError =
        typeof message === 'string' && message
          ? message
          : 'AI 스트리밍 요청을 완료하지 못했습니다.';
    }
  };

  const drainEvents = () => {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffer);
      if (!boundary || boundary.index === undefined) return;
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      processEvent(block);
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drainEvents();
    }
    buffer += decoder.decode();
    drainEvents();
    if (buffer.trim()) processEvent(buffer);
  } catch {
    throwIfAborted();
    // A tail reset after the complete result event must not turn a valid
    // answer into a visible failure. Reconciliation below still drains or
    // replaces the draft with the authoritative result content.
    if (result === undefined || streamError) {
      queue.cancel();
      hooks.onReplace?.(receivedText);
      throw new Error(
        receivedText
          ? 'AI 스트리밍 연결이 중간에 끊겼습니다. 받은 평문은 보존했습니다.'
          : 'AI 스트리밍 연결이 중간에 끊겼습니다. 다시 시도해 주세요.',
      );
    }
  } finally {
    reader.releaseLock();
  }

  throwIfAborted();
  if (streamError) {
    if (hooks.onReplace) {
      queue.cancel();
      hooks.onReplace(receivedText);
    } else {
      await queue.drain();
    }
    throwIfAborted();
    throw new Error(streamError);
  }
  if (result !== undefined) {
    const completedText = finalContent(result);
    if (!receivedText && completedText) queue.append(completedText);
    else if (completedText.startsWith(receivedText))
      queue.append(completedText.slice(receivedText.length));
    const replaceWith =
      completedText &&
      completedText !== receivedText &&
      !completedText.startsWith(receivedText)
        ? completedText
        : '';
    if (replaceWith) {
      queue.cancel();
      throwIfAborted();
      hooks.onReplace?.(replaceWith);
      return result;
    }
    await queue.drain();
    throwIfAborted();
    return result;
  }
  if (hooks.onReplace) {
    queue.cancel();
    hooks.onReplace(receivedText);
  } else {
    await queue.drain();
  }
  throwIfAborted();
  throw new Error(streamError || 'AI 스트리밍 응답이 완료되지 않았습니다.');
}
