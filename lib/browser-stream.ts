type StreamHooks = {
  onDelta?: (text: string) => void;
  onHeartbeat?: (elapsedMs: number) => void;
};

type StreamOptions = {
  fetcher?: typeof fetch;
  nextFrame?: () => Promise<void>;
};

const browserFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 16);
  });

function takeCharacters(value: string, maximum: number) {
  const points = Array.from(value);
  return {
    head: points.slice(0, maximum).join(''),
    tail: points.slice(maximum).join(''),
  };
}

function charactersPerFrame(backlog: string) {
  const length = Array.from(backlog).length;
  if (length > 2_000) return 48;
  if (length > 1_000) return 24;
  if (length > 400) return 12;
  if (length > 120) return 6;
  return 2;
}

/**
 * Separates network delivery from painting. Gateways are allowed to coalesce
 * many SSE events into one chunk; this queue still yields between visible
 * updates so React cannot batch the entire answer and result into one paint.
 */
function progressiveTextQueue(
  onDelta: ((text: string) => void) | undefined,
  nextFrame: () => Promise<void>,
) {
  let pending = '';
  let running: Promise<void> | null = null;

  const start = () => {
    if (running || !pending || !onDelta) return;
    running = (async () => {
      while (pending) {
        await nextFrame();
        const { head, tail } = takeCharacters(
          pending,
          charactersPerFrame(pending),
        );
        pending = tail;
        onDelta(head);
      }
      // Let React commit the last draft before the final result hides loading.
      await nextFrame();
    })().finally(() => {
      running = null;
      if (pending) start();
    });
  };

  return {
    append(text: string) {
      if (!text) return;
      pending += text;
      start();
    },
    async drain() {
      while (running) await running;
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
  );
  let response: Response;
  try {
    response = await fetcher(path, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
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

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainEvents();
  }
  buffer += decoder.decode();
  drainEvents();
  if (buffer.trim()) processEvent(buffer);

  if (result !== undefined) {
    const completedText = finalContent(result);
    if (!receivedText && completedText) queue.append(completedText);
    else if (completedText.startsWith(receivedText))
      queue.append(completedText.slice(receivedText.length));
    await queue.drain();
    return result;
  }
  await queue.drain();
  throw new Error(streamError || 'AI 스트리밍 응답이 완료되지 않았습니다.');
}
