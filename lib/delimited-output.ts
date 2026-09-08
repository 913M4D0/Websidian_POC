import type {
  InsightClaim,
  IssueAnalysis,
  IssueTestPlan,
} from './issue-insight.ts';
import type { CompiledMemory, MemoryFacet } from './memory-artifact.ts';
import type { Issue } from './issues.ts';

const markers = () => /<<([^<>\r\n]{1,40})>>/g;

type Section = { name: string; body: string };

export type DelimitedDisplayKind = 'analysis' | 'test-cases' | 'memory';

export type CustomerDisplayKind = Exclude<DelimitedDisplayKind, 'memory'>;

export type DelimitedDisplayField = {
  label: string;
  value: string;
};

export type DelimitedDisplayBlock = {
  label: string;
  body: string;
  fields: DelimitedDisplayField[];
};

export type DelimitedDisplay = {
  blocks: DelimitedDisplayBlock[];
  complete: boolean;
};

export type DelimitedDisplaySegment =
  | {
      type: 'block';
      start: number;
      end: number;
      block: DelimitedDisplayBlock;
      complete: boolean;
    }
  | {
      type: 'raw';
      start: number;
      end: number;
      content: string;
    };

export type DelimitedDisplayComposition = {
  segments: DelimitedDisplaySegment[];
  terminated: boolean;
  activeTarget?: Pick<DelimitedDisplaySegment, 'type' | 'start'>;
};

type DisplayFieldRule = {
  label: string;
  allowEmpty?: boolean;
};

type DisplaySectionRule = {
  label: string;
  min: number;
  max: number;
  mode: 'scalar' | 'object';
  allowEmpty?: boolean;
  fields?: readonly DisplayFieldRule[];
};

const displayClaimFields = [
  { label: '제목' },
  { label: '구분' },
  { label: '근거' },
  { label: '내용' },
] as const satisfies readonly DisplayFieldRule[];

const displaySchemas: Record<
  DelimitedDisplayKind,
  readonly DisplaySectionRule[]
> = {
  analysis: [
    { label: '요약', min: 1, max: 1, mode: 'scalar' },
    {
      label: '확인된맥락',
      min: 1,
      max: 3,
      mode: 'object',
      fields: displayClaimFields,
    },
    {
      label: '주의할위험',
      min: 0,
      max: 2,
      mode: 'object',
      fields: displayClaimFields,
    },
    {
      label: '권장처리',
      min: 1,
      max: 3,
      mode: 'object',
      fields: displayClaimFields,
    },
    { label: '추가확인', min: 0, max: 2, mode: 'scalar' },
  ],
  'test-cases': [
    { label: '전략', min: 1, max: 1, mode: 'scalar' },
    {
      label: '테스트케이스',
      min: 3,
      max: 3,
      mode: 'object',
      fields: [
        { label: '번호' },
        { label: '제목' },
        { label: '우선순위' },
        { label: '사전조건', allowEmpty: true },
        { label: '실행단계' },
        { label: '기대결과' },
        { label: '근거' },
      ],
    },
    {
      label: '회귀범위',
      min: 0,
      max: 2,
      mode: 'object',
      fields: displayClaimFields,
    },
  ],
  memory: [
    { label: '요약', min: 1, max: 1, mode: 'scalar' },
    {
      label: '핵심어',
      min: 1,
      max: 1,
      mode: 'scalar',
      allowEmpty: true,
    },
    {
      label: '분류',
      min: 0,
      max: 4,
      mode: 'object',
      fields: [{ label: '이름' }, { label: '값' }],
    },
  ],
};

function validValue(
  value: string,
  rule: DisplayFieldRule | DisplaySectionRule,
  partial: boolean,
) {
  const trimmed = value.trim();
  if (!partial && !trimmed && !rule.allowEmpty) return false;
  return true;
}

/**
 * Strict presentation parser. Complete output must end with <<끝>>; unknown,
 * unbalanced, or out-of-order markers deliberately return null so the UI can
 * show the provider's untouched text instead of hiding a malformed response.
 */
function parseDisplayAttempt(
  output: string,
  kind: DelimitedDisplayKind,
  allowIncomplete: boolean,
): DelimitedDisplay | null {
  const normalized = output.replace(/\r\n?/g, '\n');
  const schema = displaySchemas[kind];
  const ruleIndexByLabel = new Map(
    schema.map((rule, index) => [rule.label, index]),
  );
  const allowedFields = new Set(
    schema.flatMap((rule) => rule.fields?.map((field) => field.label) ?? []),
  );
  const allowed = new Set([...ruleIndexByLabel.keys(), ...allowedFields, '끝']);
  let parseable = normalized;
  if (allowIncomplete) {
    const lastOpen = parseable.lastIndexOf('<<');
    const lastClose = parseable.lastIndexOf('>>');
    if (lastOpen > lastClose) {
      const unfinishedMarker = parseable.slice(lastOpen);
      if (unfinishedMarker.length > 44 || unfinishedMarker.includes('\n'))
        return null;
      parseable = parseable.slice(0, lastOpen);
    }
  }

  const matches = [...parseable.matchAll(markers())];
  if (!matches.length || parseable.slice(0, matches[0].index).trim())
    return null;

  const withoutValidMarkers = parseable.replace(markers(), '');
  if (withoutValidMarkers.includes('<<') || withoutValidMarkers.includes('>>'))
    return null;

  const tokens = matches.map((match, index) => ({
    rawLabel: match[1],
    label: match[1].trim(),
    value: parseable
      .slice(match.index! + match[0].length, matches[index + 1]?.index)
      .trim(),
  }));
  if (tokens.some((token) => token.rawLabel !== token.label)) return null;
  if (tokens.some((token) => !allowed.has(token.label))) return null;
  if (tokens[0].label !== schema[0].label) return null;

  const endIndex = tokens.findIndex((token) => token.label === '끝');
  const complete = endIndex === tokens.length - 1;
  if (
    (endIndex >= 0 && !complete) ||
    (complete && tokens[endIndex].value) ||
    (!complete && !allowIncomplete)
  )
    return null;

  const contentTokens = complete ? tokens.slice(0, -1) : tokens;
  const blocks: DelimitedDisplayBlock[] = [];
  const counts = schema.map(() => 0);
  let activeRuleIndex = -1;
  let activeFieldCount = 0;

  const activeComplete = () => {
    if (activeRuleIndex < 0) return false;
    const rule = schema[activeRuleIndex];
    const block = blocks[blocks.length - 1];
    if (rule.mode === 'scalar') return validValue(block.body, rule, false);
    return !block.body && activeFieldCount === (rule.fields?.length ?? 0);
  };

  for (const [tokenIndex, token] of contentTokens.entries()) {
    const isActiveTail =
      allowIncomplete && !complete && tokenIndex === contentTokens.length - 1;
    const nextRuleIndex = ruleIndexByLabel.get(token.label);
    if (nextRuleIndex !== undefined) {
      if (activeRuleIndex >= 0 && !activeComplete()) return null;
      if (nextRuleIndex < activeRuleIndex) return null;
      if (counts[nextRuleIndex] >= schema[nextRuleIndex].max) return null;
      for (let index = 0; index < nextRuleIndex; index += 1)
        if (counts[index] < schema[index].min) return null;

      activeRuleIndex = nextRuleIndex;
      activeFieldCount = 0;
      counts[nextRuleIndex] += 1;
      const rule = schema[nextRuleIndex];
      if (rule.mode === 'object' && token.value) return null;
      if (
        rule.mode === 'scalar' &&
        !validValue(token.value, rule, isActiveTail)
      )
        return null;
      blocks.push({ label: token.label, body: token.value, fields: [] });
      continue;
    }

    if (activeRuleIndex < 0) return null;
    const rule = schema[activeRuleIndex];
    const expected = rule.fields?.[activeFieldCount];
    if (rule.mode !== 'object' || !expected || token.label !== expected.label)
      return null;
    if (!validValue(token.value, expected, isActiveTail)) return null;
    blocks[blocks.length - 1].fields.push({
      label: token.label,
      value: token.value,
    });
    activeFieldCount += 1;
  }

  if (!blocks.length) return null;
  if (complete) {
    if (!activeComplete()) return null;
    if (counts.some((count, index) => count < schema[index].min)) return null;
  }
  return { blocks, complete };
}

function parseDisplay(
  output: string,
  kind: DelimitedDisplayKind,
  allowIncomplete: boolean,
) {
  const parsed = parseDisplayAttempt(output, kind, allowIncomplete);
  if (
    parsed ||
    !allowIncomplete ||
    !output.endsWith('<') ||
    output.endsWith('<<')
  )
    return parsed;
  // At an object-card boundary the first grapheme of the next marker looks
  // like illegal direct body text. Retry while holding only that ambiguous
  // marker grapheme; free text fields keep the original successful parse and
  // therefore still display a literal trailing "<" immediately.
  return parseDisplayAttempt(output.slice(0, -1), kind, true);
}

export function parseDelimitedDisplay(
  output: string,
  kind: DelimitedDisplayKind,
): DelimitedDisplay | null {
  return parseDisplay(output, kind, false);
}

/** Accepts a valid prefix so cards can be built while model text arrives. */
export function parseDelimitedDisplayProgress(
  output: string,
  kind: DelimitedDisplayKind,
): DelimitedDisplay | null {
  return parseDisplay(output, kind, true);
}

type IndexedMarker = {
  rawLabel: string;
  label: string;
  start: number;
  end: number;
};

function indexedMarkers(output: string, end: number): IndexedMarker[] {
  return [...output.slice(0, end).matchAll(markers())].map((match) => ({
    rawLabel: match[1],
    label: match[1].trim(),
    start: match.index!,
    end: match.index! + match[0].length,
  }));
}

function unfinishedMarkerStart(output: string, streaming: boolean) {
  if (!streaming) return output.length;
  const open = output.lastIndexOf('<<');
  const close = output.lastIndexOf('>>');
  if (open <= close) return output.length;
  const tail = output.slice(open);
  return tail.length <= 44 && !/[\r\n]/.test(tail) ? open : output.length;
}

function firstDelimiterAt(output: string, start: number, end: number) {
  const open = output.indexOf('<<', start);
  const close = output.indexOf('>>', start);
  const candidates = [open, close].filter(
    (index) => index >= start && index < end,
  );
  return candidates.length ? Math.min(...candidates) : -1;
}

function firstBrokenDelimiterAt(
  output: string,
  start: number,
  end: number,
  localMarkers: readonly IndexedMarker[],
) {
  const coveredOpen = new Set(localMarkers.map((marker) => marker.start));
  const coveredClose = new Set(localMarkers.map((marker) => marker.end - 2));
  let first = -1;
  for (const [delimiter, covered] of [
    ['<<', coveredOpen],
    ['>>', coveredClose],
  ] as const) {
    let position = output.indexOf(delimiter, start);
    while (position >= 0 && position < end) {
      if (!covered.has(position) && (first < 0 || position < first))
        first = position;
      position = output.indexOf(delimiter, position + 2);
    }
  }
  return first;
}

function pushRawSegment(
  segments: DelimitedDisplaySegment[],
  output: string,
  start: number,
  end: number,
) {
  if (end <= start || !output.slice(start, end).trim()) return;
  const content = output.slice(start, end);
  const previous = segments.at(-1);
  if (previous?.type === 'raw' && previous.end === start) {
    previous.end = end;
    previous.content += content;
    return;
  }
  segments.push({ type: 'raw', start, end, content });
}

function parseLocalDisplayBlock(
  output: string,
  marker: IndexedMarker,
  end: number,
  rule: DisplaySectionRule,
  streamingTail: boolean,
  localMarkers: readonly IndexedMarker[],
):
  | {
      block: DelimitedDisplayBlock;
      end: number;
      complete: boolean;
      rawStart?: number;
    }
  | undefined {
  if (rule.mode === 'scalar') {
    const invalidAt = firstDelimiterAt(output, marker.end, end);
    const bodyEnd = invalidAt >= 0 ? invalidAt : end;
    const body = output.slice(marker.end, bodyEnd).trim();
    const activeValue = streamingTail && invalidAt < 0;
    if (!body && !rule.allowEmpty && !activeValue) return;
    return {
      block: { label: marker.label, body, fields: [] },
      end: bodyEnd,
      complete: invalidAt >= 0 || !streamingTail,
      rawStart: invalidAt >= 0 ? invalidAt : undefined,
    };
  }

  const fields = localMarkers.slice(1);
  const expectedFields = rule.fields ?? [];
  const brokenAt = firstBrokenDelimiterAt(
    output,
    marker.end,
    end,
    localMarkers,
  );
  const firstSignal = Math.min(
    fields[0]?.start ?? end,
    brokenAt >= 0 ? brokenAt : end,
  );
  if (output.slice(marker.end, firstSignal).trim()) return;

  const parsedFields: DelimitedDisplayField[] = [];
  for (let index = 0; index < expectedFields.length; index += 1) {
    const fieldMarker = fields[index];
    const expected = expectedFields[index];
    if (!fieldMarker || (brokenAt >= 0 && brokenAt < fieldMarker.start)) {
      if (streamingTail && brokenAt < 0)
        return {
          block: { label: marker.label, body: '', fields: parsedFields },
          end,
          complete: false,
        };
      return;
    }
    if (
      fieldMarker.rawLabel !== fieldMarker.label ||
      fieldMarker.label !== expected.label
    )
      return;
    const nextMarker = fields[index + 1];
    const valueEnd = Math.min(
      nextMarker?.start ?? end,
      brokenAt >= 0 && brokenAt >= fieldMarker.end ? brokenAt : end,
    );
    const value = output.slice(fieldMarker.end, valueEnd).trim();
    const isActiveField =
      streamingTail &&
      brokenAt < 0 &&
      !nextMarker &&
      index === fields.length - 1;
    if (!validValue(value, expected, isActiveField)) return;
    parsedFields.push({ label: fieldMarker.label, value });
  }

  const extraMarker = fields[expectedFields.length];
  const rawStart = [extraMarker?.start, brokenAt]
    .filter(
      (position): position is number => position !== undefined && position >= 0,
    )
    .sort((left, right) => left - right)[0];
  return {
    block: { label: marker.label, body: '', fields: parsedFields },
    end: rawStart ?? end,
    complete: rawStart !== undefined || !streamingTail,
    ...(rawStart !== undefined ? { rawStart } : {}),
  };
}

/**
 * Best-effort presentation recovery for customer-facing analysis and test-case
 * text. Locally valid sections remain cards while malformed source slices stay
 * untouched. Memory is deliberately excluded at the type boundary because its
 * persisted artifact must continue through the strict parser above.
 */
export function parseDelimitedDisplaySegments(
  output: string,
  kind: CustomerDisplayKind,
  streaming = false,
): DelimitedDisplayComposition {
  const parseEnd = unfinishedMarkerStart(output, streaming);
  const schema = displaySchemas[kind];
  const ruleByLabel = new Map(schema.map((rule) => [rule.label, rule]));
  const ruleIndexByLabel = new Map(
    schema.map((rule, index) => [rule.label, index]),
  );
  const allMarkers = indexedMarkers(output, parseEnd);
  const boundaries = allMarkers.filter(
    (marker) =>
      marker.rawLabel === marker.label &&
      (ruleByLabel.has(marker.label) || marker.label === '끝'),
  );
  const segments: DelimitedDisplaySegment[] = [];
  let cursor = 0;
  let terminated = false;
  let lastAcceptedRuleIndex = -1;
  const acceptedCounts = schema.map(() => 0);

  for (const [boundaryIndex, boundary] of boundaries.entries()) {
    if (boundary.start < cursor) continue;
    pushRawSegment(segments, output, cursor, boundary.start);

    if (boundary.label === '끝') {
      terminated = !output.slice(boundary.end).trim();
      cursor = boundary.end;
      pushRawSegment(segments, output, cursor, output.length);
      cursor = output.length;
      break;
    }

    const nextBoundary = boundaries[boundaryIndex + 1];
    const sectionEnd = nextBoundary?.start ?? parseEnd;
    const rule = ruleByLabel.get(boundary.label)!;
    const ruleIndex = ruleIndexByLabel.get(boundary.label)!;
    const globallyValid =
      ruleIndex >= lastAcceptedRuleIndex &&
      acceptedCounts[ruleIndex] < rule.max;
    const localMarkers = allMarkers.filter(
      (marker) => marker.start >= boundary.start && marker.start < sectionEnd,
    );
    const streamingTail = streaming && !nextBoundary;
    const parsed = globallyValid
      ? parseLocalDisplayBlock(
          output,
          boundary,
          sectionEnd,
          rule,
          streamingTail,
          localMarkers,
        )
      : undefined;

    if (!parsed) {
      pushRawSegment(segments, output, boundary.start, sectionEnd);
    } else {
      segments.push({
        type: 'block',
        start: boundary.start,
        end: parsed.end,
        block: parsed.block,
        complete: parsed.complete,
      });
      if (parsed.rawStart !== undefined)
        pushRawSegment(segments, output, parsed.rawStart, sectionEnd);
      acceptedCounts[ruleIndex] += 1;
      lastAcceptedRuleIndex = Math.max(lastAcceptedRuleIndex, ruleIndex);
    }
    cursor = sectionEnd;
  }

  if (cursor < parseEnd) pushRawSegment(segments, output, cursor, parseEnd);
  const active = streaming && !terminated ? segments.at(-1) : undefined;
  return {
    segments,
    terminated,
    ...(active
      ? { activeTarget: { type: active.type, start: active.start } }
      : {}),
  };
}

function sections(text: string, topLevel: readonly string[]) {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const allowed = new Set(topLevel);
  const matches = [...normalized.matchAll(markers())].filter((match) =>
    allowed.has(match[1].trim()),
  );
  return matches.map(
    (match, index): Section => ({
      name: match[1].trim(),
      body: normalized
        .slice(match.index! + match[0].length, matches[index + 1]?.index)
        .trim(),
    }),
  );
}

function field(block: string, name: string, fieldNames: readonly string[]) {
  const parsed = sections(block, fieldNames);
  return parsed.find((item) => item.name === name)?.body.trim() ?? '';
}

function clean(value: string, maximum: number) {
  return value
    .replace(markers(), '')
    .split('\u0000')
    .join('')
    .trim()
    .slice(0, maximum);
}

function list(value: string, maximumItems: number, maximumLength = 800) {
  return value
    .split(/\n|\s*\|\|\s*/)
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, maximumItems)
    .map((item) => clean(item, maximumLength));
}

function evidence(value: string, allowedIds: readonly string[]) {
  const allowed = new Set(allowedIds);
  const found = value
    .split(/[\s,|/]+/)
    .map((item) =>
      item.replaceAll('[', '').replaceAll(']', '').replace(/[()]/g, '').trim(),
    )
    .filter((id) => allowed.has(id));
  return [...new Set(found)].slice(0, 17);
}

const claimFields = ['제목', '구분', '근거', '내용'] as const;

function claimFromBlock(
  block: string,
  allowedIds: readonly string[],
  fallbackTitle: string,
): InsightClaim {
  const cited = evidence(
    field(block, '근거', claimFields) || block,
    allowedIds,
  );
  const body = clean(field(block, '내용', claimFields) || block, 1600);
  const kindText = field(block, '구분', claimFields).toLowerCase();
  return {
    title: clean(field(block, '제목', claimFields) || fallbackTitle, 180),
    text: body || '제공된 이력의 원문을 추가로 확인해야 합니다.',
    kind:
      kindText.includes('사실') || kindText === 'fact' ? 'fact' : 'inference',
    evidenceIds: cited,
  };
}

export function parseDelimitedIssueAnalysis(
  output: string,
  allowedIds: readonly string[],
): IssueAnalysis {
  const top = [
    '요약',
    '확인된맥락',
    '주의할위험',
    '권장처리',
    '추가확인',
    '끝',
  ] as const;
  const parsed = sections(output, top);
  const raw = clean(output, 2400);
  const summary = clean(
    parsed.find((item) => item.name === '요약')?.body || raw,
    2400,
  );
  const claims = (name: string, title: string, maximum: number) =>
    parsed
      .filter((item) => item.name === name)
      .slice(0, maximum)
      .map((item) => claimFromBlock(item.body, allowedIds, title));
  const findings = claims('확인된맥락', '관련 이력에서 확인할 맥락', 10);
  const recommendations = claims('권장처리', '권장 처리 방향', 8);
  return {
    summary: summary || '제공된 이력을 기준으로 현재 이슈를 검토했습니다.',
    findings: findings.length
      ? findings
      : [
          {
            title: '관련 이력 분석',
            text: raw || '제공된 이력의 원문을 확인해야 합니다.',
            kind: 'inference',
            evidenceIds: [],
          },
        ],
    risks: claims('주의할위험', '주의할 위험', 8),
    recommendations: recommendations.length
      ? recommendations
      : [
          {
            title: '원문 근거 확인',
            text: '처리 전에 연결된 이슈의 원문과 처리 결과를 확인하세요.',
            kind: 'inference',
            evidenceIds: [],
          },
        ],
    openQuestions: parsed
      .filter((item) => item.name === '추가확인')
      .flatMap((item) => list(item.body, 8, 800))
      .slice(0, 8),
  };
}

export function parseDelimitedIssueTestPlan(
  output: string,
  allowedIds: readonly string[],
): IssueTestPlan {
  const top = ['전략', '테스트케이스', '회귀범위', '끝'] as const;
  const caseFields = [
    '번호',
    '제목',
    '우선순위',
    '사전조건',
    '실행단계',
    '기대결과',
    '근거',
  ] as const;
  const parsed = sections(output, top);
  const strategy = clean(
    parsed.find((item) => item.name === '전략')?.body || output,
    2400,
  );
  const cases = parsed
    .filter((item) => item.name === '테스트케이스')
    .slice(0, 8)
    .map((item, index) => {
      const priority = field(item.body, '우선순위', caseFields).toLowerCase();
      const steps = list(field(item.body, '실행단계', caseFields), 12, 800);
      const cited = evidence(
        field(item.body, '근거', caseFields) || item.body,
        allowedIds,
      );
      return {
        id: clean(
          field(item.body, '번호', caseFields) || `TC-${index + 1}`,
          40,
        ),
        title: clean(
          field(item.body, '제목', caseFields) || `핵심 검증 ${index + 1}`,
          240,
        ),
        priority: (priority.includes('필수') || priority === 'critical'
          ? 'critical'
          : priority.includes('높') || priority === 'high'
            ? 'high'
            : 'medium') as 'critical' | 'high' | 'medium',
        preconditions: list(field(item.body, '사전조건', caseFields), 8, 600),
        steps: steps.length
          ? steps
          : ['현재 이슈의 재현 조건을 준비하고 핵심 흐름을 실행한다.'],
        expected: clean(
          field(item.body, '기대결과', caseFields) ||
            '현재 이슈의 기대 동작과 관련 이력의 회귀 조건을 모두 만족한다.',
          1200,
        ),
        evidenceIds: cited,
      };
    });
  return {
    strategy: strategy || '현재 이슈와 연결된 처리 이력을 함께 검증합니다.',
    cases: cases.length
      ? cases
      : [
          {
            id: 'TC-01',
            title: '현재 이슈 핵심 흐름 확인',
            priority: 'critical',
            preconditions: ['현재 이슈의 재현 조건과 관련 이력을 준비한다.'],
            steps: [
              '현재 이슈의 핵심 흐름을 실행한다.',
              '연결된 과거 이슈의 처리 결과와 부작용 여부를 비교한다.',
            ],
            expected:
              clean(output, 1200) ||
              '현재 기대 동작을 만족하고 연결된 이력의 회귀 위험이 발생하지 않는다.',
            evidenceIds: [],
          },
        ],
    regressionScope: parsed
      .filter((item) => item.name === '회귀범위')
      .slice(0, 8)
      .map((item) => claimFromBlock(item.body, allowedIds, '회귀 확인 범위')),
  };
}

export function parseDelimitedMemory(output: string): CompiledMemory {
  const top = ['요약', '핵심어', '분류', '끝'] as const;
  const facetFields = ['이름', '값'] as const;
  const parsed = sections(output, top);
  const facets: MemoryFacet[] = parsed
    .filter((item) => item.name === '분류')
    .slice(0, 12)
    .map((item) => ({
      name: clean(field(item.body, '이름', facetFields) || '관찰 항목', 120),
      values: list(field(item.body, '값', facetFields) || item.body, 16, 160),
    }))
    .filter((item) => item.values.length);
  return {
    summary: clean(
      parsed.find((item) => item.name === '요약')?.body || output,
      2400,
    ),
    concepts: parsed
      .filter((item) => item.name === '핵심어')
      .flatMap((item) => list(item.body, 24, 160))
      .slice(0, 24),
    facets,
  };
}

/** Deterministic source-only memory used when optional AI enrichment is unavailable. */
export function sourceMemory(issue: Issue): CompiledMemory {
  const concepts = [
    issue.issueType,
    issue.team,
    ...issue.tags,
    ...issue.resources.map((resource) => resource.label),
  ]
    .map((item) => clean(item, 160))
    .filter(Boolean);
  return {
    summary: clean(
      `${issue.title}. 처리 결과: ${issue.resolution?.outcome || '처리 완료'}. ${issue.resolution?.body || issue.body}`,
      2400,
    ),
    concepts: [...new Set(concepts)].slice(0, 24),
    facets: [
      { name: '담당 영역', values: [clean(issue.team, 160)] },
      { name: '이슈 유형', values: [clean(issue.issueType, 160)] },
      ...(issue.resolution?.outcome
        ? [
            {
              name: '처리 결과',
              values: [clean(issue.resolution.outcome, 160)],
            },
          ]
        : []),
    ].filter((item) => item.values[0]),
  };
}
