export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// This header is injected/overwritten by the authenticated Sites gateway.
// Do not expose this application through a bypassing Worker origin.
export function authenticate(request: Request, mutation = false) {
  const actor = request.headers.get('oai-authenticated-user-id');
  if (!actor) throw new ApiError(401, '로그인이 필요합니다.');
  if (mutation) {
    const origin = request.headers.get('origin');
    if (
      !origin ||
      origin !== new URL(request.url).origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      throw new ApiError(403, '같은 사이트에서만 변경할 수 있습니다.');
    }
  }
  return actor;
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError(415, 'JSON 형식으로 보내 주세요.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '요청 내용이 없습니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) {
        await reader.cancel();
        throw new ApiError(413, '입력 내용은 64KB 이내여야 합니다.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, '요청 JSON을 확인해 주세요.');
  }
}

export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie, oai-authenticated-user-id',
    },
  });

export function apiFailure(error: unknown) {
  if (
    error instanceof Error &&
    'status' in error &&
    typeof error.status === 'number'
  )
    return json({ error: error.message }, error.status);
  console.error(
    'Websidian API failed',
    error instanceof Error ? error.message : 'unknown',
  );
  return json(
    { error: '저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    503,
  );
}
