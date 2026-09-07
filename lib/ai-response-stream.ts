type StreamHooks = {
  emit: (text: string) => void;
  signal: AbortSignal;
};

function safeError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : 'AI 요청을 완료하지 못했습니다.';
}

/** Sends browser-visible deltas and heartbeats while the provider is working. */
export function aiResponseStream<T>(
  work: (hooks: StreamHooks) => Promise<T>,
): Response {
  const encoder = new TextEncoder();
  const aborter = new AbortController();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  let writes = Promise.resolve();
  const queue = (value: string) => {
    if (closed) return;
    writes = writes
      .then(() => writer.write(encoder.encode(value)))
      .catch(() => {
        closed = true;
        aborter.abort();
      });
  };
  const send = (event: string, data: unknown, padding = '') => {
    queue(
      `${padding ? `: ${padding}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
  };
  const startedAt = Date.now();
  // Sites may inspect and buffer a response prefix. Start beyond the common
  // small-prefix range, then keep enough traffic flowing to flush slow paths.
  send('heartbeat', { elapsedMs: 0 }, ' '.repeat(32_768));
  const heartbeat = setInterval(
    () =>
      send(
        'heartbeat',
        { elapsedMs: Date.now() - startedAt },
        ' '.repeat(1_024),
      ),
    1_000,
  );
  void work({
    emit: (text) => text && send('delta', { text }),
    signal: aborter.signal,
  })
    .then((result) => send('result', result))
    .catch((error: unknown) => send('error', { error: safeError(error) }))
    .finally(async () => {
      clearInterval(heartbeat);
      await writes;
      if (!closed) {
        closed = true;
        try {
          await writer.close();
        } catch {}
      }
    });
  void writer.closed.catch(() => {
    clearInterval(heartbeat);
    closed = true;
    aborter.abort();
  });
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'Content-Encoding': 'identity',
      Vary: 'Cookie, oai-authenticated-user-id',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
