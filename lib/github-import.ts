import { ApiError } from './api-security.ts';
import type { Issue, IssueActivity } from './issues.ts';

export type GitHubRepository = { owner: string; repo: string; slug: string };

type GitHubUser = { login?: unknown; id?: unknown } | null;
type GitHubLabel = { name?: unknown } | string;
export type GitHubIssueRecord = {
  id?: unknown;
  node_id?: unknown;
  number?: unknown;
  title?: unknown;
  body?: unknown;
  state?: unknown;
  state_reason?: unknown;
  html_url?: unknown;
  url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  closed_at?: unknown;
  user?: GitHubUser;
  closed_by?: GitHubUser;
  labels?: unknown;
  assignees?: unknown;
  pull_request?: unknown;
};
export type GitHubCommentRecord = {
  id?: unknown;
  issue_url?: unknown;
  body?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  user?: GitHubUser;
};

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}$/;

export function parseGitHubRepository(value: unknown): GitHubRepository {
  if (typeof value !== 'string' || !value.trim() || value.length > 300)
    throw new ApiError(400, 'GitHub 저장소 주소를 확인해 주세요.');
  const input = value.trim();
  let parts: string[];
  if (/^https?:\/\//i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new ApiError(400, 'GitHub 저장소 주소를 확인해 주세요.');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname.toLowerCase() !== 'github.com' ||
      url.port ||
      url.username ||
      url.password
    )
      throw new ApiError(
        400,
        'github.com의 HTTPS 저장소 주소만 사용할 수 있습니다.',
      );
    parts = url.pathname.split('/').filter(Boolean);
  } else {
    parts = input.split('/').filter(Boolean);
  }
  if (parts.length < 2)
    throw new ApiError(400, 'owner/repository 형식으로 입력해 주세요.');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!ownerPattern.test(owner) || !repositoryPattern.test(repo))
    throw new ApiError(400, 'GitHub owner/repository 형식을 확인해 주세요.');
  return { owner, repo, slug: `${owner}/${repo}` };
}

function requiredString(value: unknown, field: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim())
    throw new ApiError(502, `GitHub ${field} 값이 없습니다.`);
  return value.slice(0, maximum);
}

function positiveInteger(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new ApiError(502, `GitHub ${field} 값을 확인하지 못했습니다.`);
  return value as number;
}

function login(user: GitHubUser | undefined, fallback = 'GitHub 사용자') {
  return user && typeof user.login === 'string' && user.login.trim()
    ? user.login.slice(0, 180)
    : fallback;
}

function timestamp(value: unknown, field: string) {
  const raw = requiredString(value, field, 80);
  const date = new Date(raw);
  if (!Number.isFinite(date.valueOf()))
    throw new ApiError(502, `GitHub ${field} 날짜를 확인하지 못했습니다.`);
  return date.toISOString();
}

function providerUrl(
  value: unknown,
  field: string,
  hostname: 'github.com' | 'api.github.com',
  expectedPath: string,
) {
  const raw = requiredString(value, field, 1000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(502, `GitHub ${field} 형식을 확인하지 못했습니다.`);
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== hostname ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname.toLowerCase() !== expectedPath.toLowerCase()
  )
    throw new ApiError(502, `GitHub ${field} 주소를 거부했습니다.`);
  return raw;
}

function labels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.flatMap((label): string[] => {
        const name =
          typeof label === 'string'
            ? label
            : label && typeof label === 'object'
              ? (label as GitHubLabel & { name?: unknown }).name
              : undefined;
        return typeof name === 'string' && name.trim()
          ? [name.trim().slice(0, 120)]
          : [];
      }),
    ),
  ].slice(0, 50);
}

function assignees(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((user) => login(user as GitHubUser, ''))
    .filter(Boolean)
    .slice(0, 12);
}

function commentActivity(comment: GitHubCommentRecord): IssueActivity {
  const id = positiveInteger(comment.id, '댓글 ID');
  return {
    id: `github-comment:${id}`,
    at: timestamp(comment.created_at, '댓글 작성일'),
    author: `GitHub · ${login(comment.user)}`,
    body:
      typeof comment.body === 'string' && comment.body.trim()
        ? comment.body.slice(0, 20_000)
        : '(GitHub 댓글 본문 없음)',
  };
}

/** Convert a provider snapshot without interpreting its business meaning. */
export function mapGitHubIssue(
  record: GitHubIssueRecord,
  comments: GitHubCommentRecord[],
  repository: GitHubRepository,
  syncedAt: string,
): Issue {
  if (record.pull_request !== undefined)
    throw new ApiError(400, 'Pull Request는 이슈 기억으로 가져오지 않습니다.');
  const providerId = positiveInteger(record.id, '이슈 ID');
  const number = positiveInteger(record.number, '이슈 번호');
  const state = record.state;
  if (state !== 'open' && state !== 'closed')
    throw new ApiError(502, 'GitHub 이슈 상태를 확인하지 못했습니다.');
  const url = providerUrl(
    record.html_url,
    '이슈 URL',
    'github.com',
    `/${repository.slug}/issues/${number}`,
  );
  const apiUrl = providerUrl(
    record.url,
    '이슈 API URL',
    'api.github.com',
    `/repos/${repository.slug}/issues/${number}`,
  );
  const occurredAt = timestamp(record.created_at, '이슈 생성일').slice(0, 10);
  const updatedAt = timestamp(record.updated_at, '이슈 수정일');
  const stateReason =
    typeof record.state_reason === 'string'
      ? record.state_reason.slice(0, 120)
      : null;
  const issueComments = comments
    .filter((comment) => comment.issue_url === apiUrl)
    .sort(
      (left, right) =>
        String(left.created_at).localeCompare(String(right.created_at)) ||
        Number(left.id) - Number(right.id),
    )
    .slice(0, 100)
    .map(commentActivity);
  const names = labels(record.labels);
  const owners = assignees(record.assignees);
  const body =
    typeof record.body === 'string' && record.body.trim()
      ? record.body.slice(0, 20_000)
      : '(GitHub 이슈 본문 없음)';
  const closedAt =
    state === 'closed'
      ? timestamp(record.closed_at ?? record.updated_at, '이슈 종료일')
      : null;
  return {
    id: `WS-GH-${providerId}`,
    title: requiredString(record.title, '이슈 제목', 240),
    body,
    issueType: names[0] ?? 'GitHub Issue',
    team: owners.length ? owners.join(', ').slice(0, 120) : repository.slug,
    occurredAt,
    status: state,
    tags: names,
    resources: [
      {
        key: `github:${repository.slug}#${number}`,
        label: `${repository.slug} #${number}`,
        kind: 'GitHub 원본',
      },
    ],
    activities: issueComments,
    resolution:
      state === 'closed'
        ? {
            at: closedAt!,
            author: `GitHub · ${login(record.closed_by, '닫은 사용자 미확인')}`,
            body: 'GitHub 원본의 닫힘 상태를 가져왔습니다. 해결 여부와 원인은 원본 기록을 확인해야 합니다.',
            outcome: `GitHub 닫힘 · ${stateReason ?? '사유 미제공'}`,
          }
        : null,
    attributes: {
      'GitHub 번호': number,
      'GitHub 상태': state,
      'GitHub 닫힘 사유': stateReason ?? '미제공',
      'GitHub 댓글 수': issueComments.length,
      'GitHub 작성자': login(record.user),
    },
    synthetic: false,
    revision: 1,
    source: {
      platform: 'github',
      externalId: String(providerId),
      url,
      repository: repository.slug,
      number,
      nodeId:
        typeof record.node_id === 'string'
          ? record.node_id.slice(0, 300)
          : undefined,
      updatedAt,
      syncedAt,
      stateReason,
      managed: true,
    },
  };
}

export function nextGitHubPage(
  link: string | null,
  repository: GitHubRepository,
  resource: 'issues' | 'comments',
) {
  if (!link) return null;
  const entry = link
    .split(',')
    .map((part) => part.trim())
    .find((part) => /;\s*rel="next"$/.test(part));
  const match = entry?.match(/^<([^>]+)>/);
  if (!match) return null;
  const url = new URL(match[1]);
  const expected = `/repos/${repository.owner}/${repository.repo}/issues`;
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'api.github.com' ||
    url.username ||
    url.password ||
    url.port ||
    !url.pathname.startsWith(expected) ||
    (resource === 'comments' && !url.pathname.endsWith('/comments')) ||
    (resource === 'issues' && url.pathname !== expected)
  )
    throw new ApiError(502, 'GitHub 페이지 연결 주소를 거부했습니다.');
  return url.toString();
}

async function boundedArray(response: Response, maximum = 4_000_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, 'GitHub 응답이 비어 있습니다.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw new ApiError(502, 'GitHub 응답이 허용 크기를 초과했습니다.');
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
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(value)) throw new Error('not array');
    return value as unknown[];
  } catch {
    throw new ApiError(502, 'GitHub 응답 JSON을 확인하지 못했습니다.');
  }
}

async function fetchPages(
  firstUrl: string,
  repository: GitHubRepository,
  resource: 'issues' | 'comments',
  token?: string,
) {
  const values: unknown[] = [];
  let url: string | null = firstUrl;
  const maximumPages = resource === 'issues' ? 3 : 6;
  let remaining: string | null = null;
  for (let page = 0; url && page < maximumPages; page += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Websidian-POC',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'manual',
      });
    } catch {
      throw new ApiError(503, 'GitHub에 연결하지 못했습니다.');
    }
    remaining = response.headers.get('x-ratelimit-remaining');
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404)
        throw new ApiError(
          404,
          '저장소를 찾지 못했습니다. 주소 또는 비공개 저장소 권한을 확인해 주세요.',
        );
      if (response.status === 403 || response.status === 429)
        throw new ApiError(
          429,
          'GitHub 요청 한도 또는 접근 정책을 확인해 주세요.',
        );
      throw new ApiError(502, 'GitHub가 이슈 목록을 반환하지 못했습니다.');
    }
    values.push(...(await boundedArray(response)));
    url = nextGitHubPage(response.headers.get('link'), repository, resource);
  }
  return { values, remaining };
}

export async function fetchGitHubRepository(
  repository: GitHubRepository,
  token?: string,
) {
  const root = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues`;
  const issues = await fetchPages(
    `${root}?state=all&sort=updated&direction=asc&per_page=100`,
    repository,
    'issues',
    token,
  );
  const comments = await fetchPages(
    `${root}/comments?sort=updated&direction=asc&per_page=100`,
    repository,
    'comments',
    token,
  );
  return {
    issues: (issues.values as GitHubIssueRecord[]).filter(
      (issue) => issue.pull_request === undefined,
    ),
    comments: comments.values as GitHubCommentRecord[],
    rateLimitRemaining: comments.remaining ?? issues.remaining,
  };
}
