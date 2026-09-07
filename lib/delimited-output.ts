import type {
  InsightClaim,
  IssueAnalysis,
  IssueTestPlan,
} from './issue-insight.ts';
import type { BriefResult } from './brief-contract.ts';
import type { CompiledMemory, MemoryFacet } from './memory-artifact.ts';
import type { Issue } from './issues.ts';

const markers = () => /<<([^<>\r\n]{1,40})>>/g;

type Section = { name: string; body: string };

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

export function parseDelimitedBrief(
  output: string,
  allowedIds: readonly string[],
): BriefResult {
  const top = ['요약', '확인사항', '주의사항', '다음행동', '끝'] as const;
  const parsed = sections(output, top);
  const raw = clean(output, 2400);
  const briefClaim = (item: Section, fallbackTitle: string) => {
    const claim = claimFromBlock(item.body, allowedIds, fallbackTitle);
    return {
      text: `${claim.title}: ${claim.text}`,
      kind: claim.kind,
      evidenceIds: claim.evidenceIds,
    };
  };
  const findings = parsed
    .filter((item) => item.name === '확인사항')
    .slice(0, 10)
    .map((item) => briefClaim(item, '확인된 맥락'));
  return {
    summary:
      clean(parsed.find((item) => item.name === '요약')?.body || raw, 2400) ||
      '선택한 이력을 기준으로 현재 이슈의 맥락을 정리했습니다.',
    findings: findings.length
      ? findings
      : [
          {
            text: raw || '연결된 이슈의 원문을 확인해야 합니다.',
            kind: 'inference',
            evidenceIds: [],
          },
        ],
    cautions: parsed
      .filter((item) => item.name === '주의사항')
      .slice(0, 8)
      .map((item) => briefClaim(item, '주의 사항')),
    nextActions: parsed
      .filter((item) => item.name === '다음행동')
      .flatMap((item) => list(item.body, 8, 800))
      .slice(0, 8),
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
