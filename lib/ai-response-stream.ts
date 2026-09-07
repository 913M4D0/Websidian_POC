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
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      const startedAt = Date.now();
      send('heartbeat', { elapsedMs: 0 });
      heartbeat = setInterval(
        () => send('heartbeat', { elapsedMs: Date.now() - startedAt }),
        10_000,
      );
      void work({
        emit: (text) => text && send('delta', { text }),
        signal: aborter.signal,
      })
        .then((result) => send('result', result))
        .catch((error: unknown) => send('error', { error: safeError(error) }))
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      aborter.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      Vary: 'Cookie, oai-authenticated-user-id',
      'X-Accel-Buffering': 'no',
    },
  });
}
