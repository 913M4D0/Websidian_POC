/** Source-neutral issue records. Search output must never be written into these records. */
export type IssueResource = { key: string; label: string; kind: string };
export type IssueActivity = {
  id: string;
  at: string;
  author: string;
  body: string;
};
export type IssueResolution = {
  at: string;
  author: string;
  body: string;
  outcome: string;
};
export type IssueAttributes = Record<string, string | number>;
export type Issue = {
  id: string;
  title: string;
  body: string;
  issueType: string;
  team: string;
  occurredAt: string;
  status: 'open' | 'closed';
  tags: string[];
  resources: IssueResource[];
  activities: IssueActivity[];
  resolution: IssueResolution | null;
  attributes: IssueAttributes;
  synthetic: boolean;
  revision: number;
  source?: { platform: string; externalId: string; url: string };
};
export type CreateIssueInput = Pick<
  Issue,
  | 'title'
  | 'body'
  | 'issueType'
  | 'team'
  | 'occurredAt'
  | 'tags'
  | 'resources'
  | 'attributes'
>;

export class IssueInputError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'IssueInputError';
    this.status = status;
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IssueInputError(`${field} 형식이 올바르지 않습니다.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new IssueInputError(`${field}는 일반 객체여야 합니다.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new IssueInputError(`${field}을(를) 입력해 주세요.`);
  }
  if (value.length > maximum)
    throw new IssueInputError(`${field}은(는) ${maximum}자 이하여야 합니다.`);
  return value.trim();
}

function dateOnly(value: unknown): string {
  const date = text(value, '발생일', 10);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new IssueInputError(
      '발생일은 실제 존재하는 YYYY-MM-DD 날짜여야 합니다.',
    );
  }
  return date;
}

function tags(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50)
    throw new IssueInputError('태그는 최대 50개까지 입력할 수 있습니다.');
  return [...new Set(value.map((tag) => text(tag, '태그', 120)))];
}

function attributes(value: unknown): IssueAttributes {
  if (value === undefined) return {};
  const entries = Object.entries(record(value, '추가 속성'));
  if (entries.length > 100)
    throw new IssueInputError('추가 속성은 최대 100개까지 입력할 수 있습니다.');
  return Object.fromEntries(
    entries.map(([key, item]) => {
      const cleanKey = text(key, '속성명', 120);
      if (
        cleanKey === '__proto__' ||
        cleanKey === 'constructor' ||
        cleanKey === 'prototype'
      ) {
        throw new IssueInputError('사용할 수 없는 속성명입니다.');
      }
      if (typeof item !== 'string' && typeof item !== 'number') {
        throw new IssueInputError('속성 값은 문자열 또는 숫자여야 합니다.');
      }
      if (typeof item === 'number' && !Number.isFinite(item))
        throw new IssueInputError('속성 숫자는 유한해야 합니다.');
      if (typeof item === 'string' && item.length > 4000)
        throw new IssueInputError('속성 값은 4000자 이하여야 합니다.');
      return [cleanKey, item];
    }),
  );
}

function resources(value: unknown): IssueResource[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new IssueInputError('관련 자료는 최대 100개까지 입력할 수 있습니다.');
  const parsed = value.map((item) => {
    const resource = record(item, '관련 자료');
    return {
      key: text(resource.key, '자료 식별자', 1000),
      label: text(resource.label, '자료명', 240),
      kind: text(resource.kind, '자료 유형', 120),
    };
  });
  return [
    ...new Map(parsed.map((resource) => [resource.key, resource])).values(),
  ];
}

/** Whitelist fields: callers cannot set IDs, source bindings, status or audit identity. */
export function parseCreateIssue(raw: unknown): CreateIssueInput {
  const input = record(raw, '이슈');
  return {
    title: text(input.title, '제목', 240),
    body: text(input.body, '본문', 20000),
    issueType: text(input.issueType ?? '미분류', '이슈 유형', 120),
    team: text(input.team ?? '미지정', '담당 팀', 120),
    occurredAt: dateOnly(input.occurredAt),
    tags: tags(input.tags),
    resources: resources(input.resources),
    attributes: attributes(input.attributes),
  };
}

/** Complete the existing issue without replacing its original title/body or source. */
export function resolveIssue(
  issue: Issue,
  raw: unknown,
  actor: string,
  now: string,
): Issue {
  const input = record(raw, '처리 내용');
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) < 1
  ) {
    throw new IssueInputError('expectedRevision은 필수 양의 정수입니다.');
  }
  if (input.expectedRevision !== issue.revision) {
    throw new IssueInputError(
      '다른 변경이 먼저 저장되었습니다. 새로고침 후 다시 시도해 주세요.',
      409,
    );
  }
  if (issue.status === 'closed')
    throw new IssueInputError('이미 처리 완료된 이슈입니다.', 409);
  const body = text(input.body, '처리 내용', 20000);
  const outcome = text(input.outcome, '처리 결과', 240);
  const author = text(actor, '처리자', 240);
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.valueOf()))
    throw new IssueInputError('처리 시각이 올바르지 않습니다.');
  const at = timestamp.toISOString();
  const revision = issue.revision + 1;
  return {
    ...issue,
    status: 'closed',
    revision,
    tags: input.tags === undefined ? [...issue.tags] : tags(input.tags),
    attributes:
      input.attributes === undefined
        ? { ...issue.attributes }
        : { ...issue.attributes, ...attributes(input.attributes) },
    resources: issue.resources.map((resource) => ({ ...resource })),
    activities: [
      ...issue.activities.map((activity) => ({ ...activity })),
      { id: `${issue.id}:resolution:${revision}`, at, author, body },
    ],
    resolution: { at, author, body, outcome },
  };
}
