export type MemoryKind = 'query' | 'issue' | 'decision' | 'code' | 'incident' | 'resolution';

export type MemoryCluster = {
  id: string;
  label: string;
  korean: string;
  color: string;
  glow: string;
  lane: number;
  modules: readonly string[];
};

export type MemoryNode = {
  id: string;
  issueKey: string;
  name: string;
  kind: MemoryKind;
  cluster: string;
  clusterLabel: string;
  color: string;
  summary: string;
  intent: string;
  resolution: string;
  risk: string;
  date: string;
  occurredAt: string;
  owner: string;
  service: string;
  module: string;
  primaryFile: string;
  primarySource: string;
  files: string[];
  changedSources: string[];
  tags: string[];
  relevance: number;
  relevanceReasons: string[];
  importance: number;
  isHub?: boolean;
  isStory?: boolean;
  x: number;
  y: number;
  z: number;
  fx: number;
  fy: number;
  fz: number;
};

export type MemoryLink = {
  source: string | MemoryNode;
  target: string | MemoryNode;
  relation: string;
  score: number;
  story?: boolean;
};

export type MemoryGraph = { nodes: MemoryNode[]; links: MemoryLink[] };

export const AXIS_MODEL = {
  startMonth: '2025-01',
  endMonth: '2026-09',
  monthStep: 24,
  serviceGap: 100,
  moduleGap: 28,
  fileGap: 8,
  queryDepth: 210,
} as const;

export const relevanceBands = [
  { min: 0.85, depth: 160, label: 'CRITICAL' },
  { min: 0.75, depth: 120, label: 'HIGH' },
  { min: 0.65, depth: 80, label: 'MEDIUM' },
  { min: 0.6, depth: 40, label: 'LOW' },
  { min: 0, depth: 0, label: 'DIM' },
] as const;

export const timeTicks = [
  { label: '2025.01', monthIndex: 0 },
  { label: '2025.04', monthIndex: 3 },
  { label: '2025.07', monthIndex: 6 },
  { label: '2025.10', monthIndex: 9 },
  { label: '2026.01', monthIndex: 12 },
  { label: '2026.04', monthIndex: 15 },
  { label: '2026.07', monthIndex: 18 },
  { label: 'NOW', monthIndex: 20 },
] as const;

export const clusters: MemoryCluster[] = [
  { id: 'identity', label: 'IDENTITY', korean: '인증 · 세션', color: '#53e7ff', glow: 'rgba(83,231,255,.42)', lane: 0, modules: ['auth-api', 'session-core', 'access-policy'] },
  { id: 'payment', label: 'PAYMENT', korean: '결제 · 정산', color: '#a978ff', glow: 'rgba(169,120,255,.42)', lane: 1, modules: ['balance-query', 'settlement-core', 'payment-gateway'] },
  { id: 'order', label: 'ORDER', korean: '주문 · 체결', color: '#ff5fa2', glow: 'rgba(255,95,162,.38)', lane: 2, modules: ['order-api', 'execution-core', 'trade-event'] },
  { id: 'data', label: 'DATA', korean: '데이터 · 배치', color: '#5d91ff', glow: 'rgba(93,145,255,.42)', lane: 3, modules: ['warehouse-etl', 'market-batch', 'reporting'] },
  { id: 'platform', label: 'PLATFORM', korean: '공통 플랫폼', color: '#55f2b4', glow: 'rgba(85,242,180,.38)', lane: 4, modules: ['cache-sdk', 'event-sdk', 'config-core'] },
  { id: 'infra', label: 'INFRA', korean: '인프라 · 배포', color: '#ffb353', glow: 'rgba(255,179,83,.4)', lane: 5, modules: ['kubernetes', 'release-pipeline', 'network'] },
  { id: 'frontend', label: 'EXPERIENCE', korean: '프론트 · UX', color: '#b9f255', glow: 'rgba(185,242,85,.35)', lane: 6, modules: ['trading-web', 'account-app', 'design-system'] },
  { id: 'observability', label: 'OPERATIONS', korean: '관측 · 장애', color: '#ff6b6b', glow: 'rgba(255,107,107,.4)', lane: 7, modules: ['alerting', 'incident-runbook', 'telemetry'] },
];

export const storyPath = ['query-current', 'story-symptom', 'story-duplicate', 'story-decision', 'story-change', 'story-incident', 'story-resolution'];

export const storyChapters = [
  { id: 'query-current', step: '01', label: 'CURRENT ISSUE', title: '신규 이슈 감지', caption: 'Query Node를 NOW · balance-query · Z 210에 고정했습니다.' },
  { id: 'story-symptom', step: '02', label: 'SEMANTIC MATCH', title: '유사 증상 발견', caption: '의미 관련도 91%인 과거 이슈가 화면 앞으로 상승합니다.' },
  { id: 'story-duplicate', step: '03', label: 'DUPLICATE', title: '중복 처리 확인', caption: '다른 팀의 83% 관련 해결 이력을 연결했습니다.' },
  { id: 'story-decision', step: '04', label: 'INTENT', title: '기획 의도 복원', caption: '10개월 전 비동기 분리 결정을 시간선에서 복원합니다.' },
  { id: 'story-change', step: '05', label: 'CODE CHANGE', title: '변경 영향 추적', caption: '같은 cache-sdk 파일군의 변경을 소스 Lane에서 확인합니다.' },
  { id: 'story-incident', step: '06', label: 'SIDE EFFECT', title: '과거 장애 경고', caption: '캐시 우회가 DB 고갈로 이어진 과거 경로를 경고합니다.' },
  { id: 'story-resolution', step: '07', label: 'HISTORY BRIEF', title: '필요 맥락 완성', caption: '시간 · 소스 · 의미 근거를 하나의 Brief로 컴파일합니다.' },
];

const titles = [
  '간헐적 응답 지연', '재시도 시 중복 처리', '정책 변경 후 회귀', '캐시 무효화 누락',
  '타임아웃 기준 불일치', '이벤트 순서 역전', '권한 검증 우회 경로', '배포 후 설정 불일치',
  '공통 모듈 버전 충돌', '날짜 경계값 오동작', '비동기 상태 유실', '레거시 호환 조건 누락',
];
const fileNames = ['ApplicationService.kt', 'QueryRepository.ts', 'EventConsumer.java', 'routing-policy.yml', 'FeatureFlags.ts', 'ContractTest.kt', 'cache-policy.yml', 'MigrationRunner.java'];
const kinds: MemoryKind[] = ['issue', 'issue', 'decision', 'code', 'resolution', 'incident'];
const relations = ['CAUSED_BY', 'RELATED_TO', 'INTRODUCED_BY', 'AFFECTS', 'RESOLVED_BY', 'DEPENDS_ON', 'SUPERSEDES'];

function mulberry32(seed: number) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function nodeColor(kind: MemoryKind, clusterColor: string) {
  if (kind === 'query') return '#ffffff';
  if (kind === 'incident') return '#ff5f7f';
  if (kind === 'decision') return '#aa7cff';
  if (kind === 'resolution') return '#60f2bc';
  return clusterColor;
}

function monthIndex(occurredAt: string) {
  return (Number(occurredAt.slice(0, 4)) - 2025) * 12 + Number(occurredAt.slice(5, 7)) - 1;
}

function depthFor(relevance: number, isQuery = false) {
  if (isQuery) return AXIS_MODEL.queryDepth;
  return relevanceBands.find((band) => relevance >= band.min)?.depth ?? 0;
}

function coordinates(occurredAt: string, lane: number, moduleIndex: number, fileIndex: number, relevance: number, jitter: number, isQuery = false) {
  const x = (monthIndex(occurredAt) - 10) * AXIS_MODEL.monthStep + jitter;
  const y = (3.5 - lane) * AXIS_MODEL.serviceGap + (moduleIndex - 1) * AXIS_MODEL.moduleGap + (fileIndex - 0.5) * AXIS_MODEL.fileGap;
  const z = depthFor(relevance, isQuery) + (isQuery ? 0 : jitter * 0.45);
  return { x, y, z, fx: x, fy: y, fz: z };
}

type StorySeed = Omit<MemoryNode, 'x' | 'y' | 'z' | 'fx' | 'fy' | 'fz'> & { moduleIndex: number; fileIndex: number; jitter: number };

function makeStory(seed: StorySeed): MemoryNode {
  const cluster = clusters.find((item) => item.id === seed.cluster) ?? clusters[0];
  const { moduleIndex, fileIndex, jitter, ...node } = seed;
  return { ...node, ...coordinates(node.occurredAt, cluster.lane, moduleIndex, fileIndex, node.relevance, jitter, node.kind === 'query') };
}

function storySeed(spec: {
  id: string; issueKey: string; name: string; kind: MemoryKind; cluster: string; date: string; occurredAt: string; owner: string;
  module: string; primaryFile: string; source: string; relevance: number; reasons: string[]; summary: string; intent: string; resolution: string; risk: string;
  moduleIndex: number; fileIndex: number; jitter: number; color?: string;
}): MemoryNode {
  const cluster = clusters.find((item) => item.id === spec.cluster) ?? clusters[0];
  return makeStory({
    id: spec.id, issueKey: spec.issueKey, name: spec.name, kind: spec.kind, cluster: cluster.id, clusterLabel: cluster.korean,
    color: spec.color ?? nodeColor(spec.kind, cluster.color), summary: spec.summary, intent: spec.intent, resolution: spec.resolution, risk: spec.risk,
    date: spec.date, occurredAt: spec.occurredAt, owner: spec.owner, service: cluster.id, module: spec.module, primaryFile: spec.primaryFile,
    primarySource: spec.source, files: [spec.primaryFile, spec.id === 'query-current' ? 'balance-query.ts' : `${cluster.id}-context.yml`],
    changedSources: [spec.source, `${cluster.id}/${spec.module}/config/${cluster.id}-context.yml`], tags: [cluster.id, spec.kind, 'evidence'],
    relevance: spec.relevance, relevanceReasons: spec.reasons, importance: spec.kind === 'incident' || spec.kind === 'decision' ? 1 : spec.relevance,
    isStory: true, moduleIndex: spec.moduleIndex, fileIndex: spec.fileIndex, jitter: spec.jitter,
  });
}

function storyNodes(): MemoryNode[] {
  return [
    storySeed({ id: 'query-current', issueKey: 'QUERY · NOW', name: '결제 승인 후 잔액이 간헐적으로 반영되지 않음', kind: 'query', cluster: 'payment', date: '2026.09.02 09:42', occurredAt: '2026-09-02', owner: 'Trading Experience TF', module: 'balance-query', primaryFile: 'trade-cache.yml', source: 'payment/balance-query/config/trade-cache.yml', relevance: 1, reasons: ['현재 분석 기준 Query Issue', '결제 잔액과 캐시 지연 키워드'], summary: '승인 완료 후 잔액 갱신이 3~8초 지연됩니다.', intent: '승인 직후 확정 상태를 확인할 수 있어야 합니다.', resolution: '과거 Memory Graph 탐색 중', risk: '캐시 우회 시 조회 트래픽이 급증할 수 있습니다.', moduleIndex: 0, fileIndex: 1, jitter: 0, color: '#ffffff' }),
    storySeed({ id: 'story-symptom', issueKey: 'PAY-2194', name: '체결 직후 예수금 조회가 이전 값으로 노출', kind: 'issue', cluster: 'payment', date: '2026.06.18', occurredAt: '2026-06-18', owner: '자산조회팀', module: 'balance-query', primaryFile: 'BalanceReader.kt', source: 'payment/balance-query/src/BalanceReader.kt', relevance: 0.91, reasons: ['증상 문장 임베딩 94%', '동일 balance-query 모듈', '최근 90일 내 처리'], summary: '동일한 화면 증상이었지만 원인은 읽기 복제본 지연이었습니다.', intent: '조회 일관성과 응답 속도 사이의 기존 합의를 유지합니다.', resolution: '체결 후 5초 동안 primary read를 사용했습니다.', risk: '전체 요청에 적용하면 DB 부하가 31% 증가합니다.', moduleIndex: 0, fileIndex: 0, jitter: -3, color: '#ff5fa2' }),
    storySeed({ id: 'story-duplicate', issueKey: 'ORD-1842', name: '주문팀에서 동일 증상을 이미 우회 처리', kind: 'resolution', cluster: 'order', date: '2026.07.03', occurredAt: '2026-07-03', owner: '주문플랫폼팀', module: 'trade-event', primaryFile: 'EventWatermark.java', source: 'order/trade-event/src/EventWatermark.java', relevance: 0.83, reasons: ['동일 거래 이벤트 계약', 'watermark 해결책 재사용 가능'], summary: '주문팀이 같은 이벤트 지연을 idempotency token으로 방어했습니다.', intent: '팀별 패치 대신 공통 이벤트 계약으로 수렴합니다.', resolution: '공통 SDK에 transaction watermark를 추가했습니다.', risk: '별도 큐를 만들면 중복 인프라가 생깁니다.', moduleIndex: 2, fileIndex: 0, jitter: 2 }),
    storySeed({ id: 'story-decision', issueKey: 'ADR-076', name: '승인 응답과 잔액 확정 이벤트를 분리한 이유', kind: 'decision', cluster: 'platform', date: '2025.11.21', occurredAt: '2025-11-21', owner: 'Architecture Council', module: 'event-sdk', primaryFile: 'ADR-076.md', source: 'platform/event-sdk/docs/ADR-076.md', relevance: 0.76, reasons: ['비동기 확정 이벤트 설계 근거', '현재 수정의 성능 제약 설명'], summary: '피크 트래픽에서 승인 경로를 보호하기 위한 의사결정입니다.', intent: '승인 API P99 120ms 이하가 최우선입니다.', resolution: '확정 이벤트를 비동기 처리하고 UI에서 진행 상태를 표현합니다.', risk: '동기 처리로 되돌리면 피크 장애가 재현됩니다.', moduleIndex: 1, fileIndex: 0, jitter: 1 }),
    storySeed({ id: 'story-change', issueKey: 'CORE-1440', name: '공통 Redis 캐시 키 전략 변경', kind: 'code', cluster: 'platform', date: '2026.08.27', occurredAt: '2026-08-27', owner: 'Core Platform', module: 'cache-sdk', primaryFile: 'CacheKeyV3.ts', source: 'platform/cache-sdk/src/CacheKeyV3.ts', relevance: 0.88, reasons: ['동일 Redis 캐시 키 계보', '현재 이슈 6일 전 변경'], summary: '거래일을 추가하면서 만료 순서가 달라졌습니다.', intent: '영업일 전환 시 이전 거래일 데이터 혼입을 방지합니다.', resolution: '버전 키와 거래일 키를 함께 사용합니다.', risk: '구버전 소비자는 invalidation 이벤트를 해석하지 못합니다.', moduleIndex: 0, fileIndex: 0, jitter: -2 }),
    storySeed({ id: 'story-incident', issueKey: 'INC-092', name: '캐시 우회 패치로 조회 DB 커넥션 고갈', kind: 'incident', cluster: 'observability', date: '2026.02.14', occurredAt: '2026-02-14', owner: 'SRE', module: 'incident-runbook', primaryFile: 'CacheBypassFilter.kt', source: 'observability/incident-runbook/INC-092/CacheBypassFilter.kt', relevance: 0.86, reasons: ['동일 cache bypass 대응', '회귀 위험 직접 증거'], summary: '캐시 전체 우회가 14분간 조회 장애를 만들었습니다.', intent: '긴급 대응에서도 blast radius를 계좌 단위로 제한합니다.', resolution: 'feature flag와 rate limit을 함께 적용했습니다.', risk: '단순 cache bypass로 수정하면 동일 장애가 재발합니다.', moduleIndex: 1, fileIndex: 0, jitter: 3 }),
    storySeed({ id: 'story-resolution', issueKey: 'BRIEF · READY', name: '현재 이슈를 위한 History Brief', kind: 'resolution', cluster: 'payment', date: '2026.09.02 · 방금 전', occurredAt: '2026-09-02', owner: 'Websidian AI', module: 'balance-query', primaryFile: 'History-Brief.md', source: 'payment/balance-query/memory/History-Brief.md', relevance: 0.97, reasons: ['현재 Query 관점 합성 결과', '6개 근거 Node 교차 검증'], summary: '4개 결정, 2개 사이드 이펙트, 1개 재사용 해결책을 찾았습니다.', intent: '과거 의도를 지키며 현재 증상만 최소 범위로 해결합니다.', resolution: 'watermark 확인 후 계좌 단위 primary read를 5초 적용합니다.', risk: 'SDK v3 미적용 서비스는 호환성 검증이 필요합니다.', moduleIndex: 0, fileIndex: 1, jitter: -5 }),
  ];
}

function syntheticRelevance(clusterId: string, index: number) {
  const base: Record<string, number> = { identity: 0.18, payment: 0.55, order: 0.43, data: 0.2, platform: 0.47, infra: 0.16, frontend: 0.24, observability: 0.39 };
  const range: Record<string, number> = { identity: 0.29, payment: 0.39, order: 0.37, data: 0.3, platform: 0.41, infra: 0.3, frontend: 0.31, observability: 0.39 };
  const spread = ((index * 37 + index * index * 3) % 101) / 100;
  return Math.min(0.94, Number((base[clusterId] + spread * range[clusterId]).toFixed(2)));
}

export function createMemoryGraph(): MemoryGraph {
  const random = mulberry32(9132026);
  const nodes: MemoryNode[] = [];
  const links: MemoryLink[] = [];

  for (const [clusterIndex, cluster] of clusters.entries()) {
    const hubId = `hub-${cluster.id}`;
    const hubDate = `2025-01-${String(5 + clusterIndex).padStart(2, '0')}`;
    const hubRelevance = syntheticRelevance(cluster.id, 17);
    const hubSource = `${cluster.id}/${cluster.modules[1]}/docs/${cluster.label.toLowerCase()}-architecture.md`;
    nodes.push({
      id: hubId, issueKey: `${cluster.label} · BASELINE`, name: `${cluster.korean} Architecture Memory`, kind: 'decision', cluster: cluster.id,
      clusterLabel: cluster.korean, color: cluster.color, summary: `${cluster.korean} 영역의 핵심 계약과 반복 이슈를 연결하는 기준 기억입니다.`,
      intent: '업무 영역의 주요 계약과 의사결정을 한곳에서 추적합니다.', resolution: '연결 중심성이 높은 기준 Memory로 승격되었습니다.',
      risk: '이 결정의 변경은 여러 팀과 파일 계보에 영향을 줄 수 있습니다.', date: hubDate.replaceAll('-', '.'), occurredAt: hubDate,
      owner: `${cluster.korean} Guild`, service: cluster.id, module: cluster.modules[1], primaryFile: `${cluster.label.toLowerCase()}-architecture.md`,
      primarySource: hubSource, files: [`${cluster.label.toLowerCase()}-architecture.md`, `${cluster.id}-contracts.yml`],
      changedSources: [hubSource, `${cluster.id}/${cluster.modules[1]}/contracts/${cluster.id}-contracts.yml`], tags: [cluster.id, 'baseline', 'architecture'],
      relevance: hubRelevance, relevanceReasons: ['서비스 기준 Architecture Memory', '연결 중심성 상위 5%'], importance: 1, isHub: true,
      ...coordinates(hubDate, cluster.lane, 1, 0, hubRelevance, clusterIndex % 2 ? 3 : -3),
    });

    const localIds = [hubId];
    for (let index = 0; index < 29; index += 1) {
      const id = `${cluster.id}-${String(index + 1).padStart(3, '0')}`;
      const kind = kinds[(index + clusterIndex) % kinds.length];
      const title = titles[(index * 3 + clusterIndex) % titles.length];
      const month = (index * 7 + clusterIndex * 3) % 20;
      const year = 2025 + Math.floor(month / 12);
      const monthOfYear = month % 12 + 1;
      const occurredAt = `${year}-${String(monthOfYear).padStart(2, '0')}-${String(2 + ((index * 5 + clusterIndex) % 26)).padStart(2, '0')}`;
      const moduleIndex = (index + clusterIndex) % cluster.modules.length;
      const moduleName = cluster.modules[moduleIndex];
      const file = fileNames[(index * 2 + clusterIndex) % fileNames.length];
      const primarySource = `${cluster.id}/${moduleName}/${file.endsWith('.yml') ? 'config' : 'src'}/${file}`;
      const relevance = syntheticRelevance(cluster.id, index);
      const jitter = Math.round((random() - 0.5) * 10);
      nodes.push({
        id, issueKey: `${cluster.label.slice(0, 3)}-${1200 + clusterIndex * 100 + index}`, name: `${cluster.korean} ${title}`, kind,
        cluster: cluster.id, clusterLabel: cluster.korean, color: nodeColor(kind, cluster.color), summary: `${cluster.korean} 영역의 ${title} 이력을 정규화했습니다.`,
        intent: '사용자 영향과 기존 시스템 계약을 함께 보존합니다.', resolution: '원인 범위를 좁힌 뒤 공통 가드와 회귀 테스트를 추가했습니다.',
        risk: '연결된 공통 모듈을 확인하지 않으면 유사 문제가 재발할 수 있습니다.', date: occurredAt.replaceAll('-', '.'), occurredAt,
        owner: `${cluster.korean} Team ${1 + (index % 3)}`, service: cluster.id, module: moduleName, primaryFile: file, primarySource,
        files: [file, `${cluster.id}-${(index % 5) + 1}.config.yml`], changedSources: [primarySource, `${cluster.id}/${moduleName}/config/${cluster.id}-${(index % 5) + 1}.config.yml`],
        tags: [cluster.id, kind, index % 2 ? 'regression' : 'shared-context'], relevance,
        relevanceReasons: [relevance >= 0.6 ? '현재 Query와 의미 키워드 중첩' : '현재 Query와 간접 연결', index % 3 === 0 ? '공통 모듈 계보 공유' : '과거 처리 패턴 참조'],
        importance: Number((0.42 + ((index * 13) % 56) / 100).toFixed(2)), ...coordinates(occurredAt, cluster.lane, moduleIndex, index % 2, relevance, jitter),
      });
      localIds.push(id);
      links.push({ source: id, target: hubId, relation: relations[(index + clusterIndex) % relations.length], score: Math.max(0.42, relevance) });
      if (index > 0) links.push({ source: id, target: localIds[1 + Math.floor(random() * index)], relation: relations[Math.floor(random() * relations.length)], score: Number((0.45 + random() * 0.43).toFixed(2)) });
      if (index >= 9 && index % 3 === 0) links.push({ source: id, target: localIds[1 + Math.floor(random() * index)], relation: 'RELATED_TO', score: Number((0.58 + random() * 0.31).toFixed(2)) });
    }
  }

  for (let index = 0; index < clusters.length; index += 1) {
    links.push({ source: `hub-${clusters[index].id}`, target: `hub-${clusters[(index + 1) % clusters.length].id}`, relation: 'DEPENDS_ON', score: 0.72 });
    links.push({ source: `hub-${clusters[index].id}`, target: `hub-${clusters[(index + 3) % clusters.length].id}`, relation: 'AFFECTS', score: 0.64 });
  }
  for (let index = 0; index < 68; index += 1) {
    const sourceCluster = clusters[index % clusters.length];
    const targetCluster = clusters[(index * 3 + 2) % clusters.length];
    links.push({
      source: `${sourceCluster.id}-${String(1 + Math.floor(random() * 29)).padStart(3, '0')}`,
      target: `${targetCluster.id}-${String(1 + Math.floor(random() * 29)).padStart(3, '0')}`,
      relation: relations[index % relations.length], score: Number((0.38 + random() * 0.48).toFixed(2)),
    });
  }

  nodes.push(...storyNodes());
  for (let index = 0; index < storyPath.length - 1; index += 1) {
    links.push({ source: storyPath[index], target: storyPath[index + 1], relation: index === 0 ? 'MATCHES' : relations[(index + 2) % relations.length], score: 0.94 - index * 0.03, story: true });
  }
  links.push(
    { source: 'story-symptom', target: 'hub-payment', relation: 'RELATED_TO', score: 0.91 },
    { source: 'story-duplicate', target: 'hub-order', relation: 'RESOLVED_BY', score: 0.83 },
    { source: 'story-decision', target: 'hub-platform', relation: 'SUPERSEDES', score: 0.76 },
    { source: 'story-change', target: 'hub-platform', relation: 'INTRODUCED_BY', score: 0.88 },
    { source: 'story-incident', target: 'hub-observability', relation: 'CAUSED_BY', score: 0.86 },
    { source: 'story-resolution', target: 'hub-payment', relation: 'RESOLVED_BY', score: 0.97 },
    { source: 'story-symptom', target: 'story-change', relation: 'SHARES_SOURCE', score: 0.89 },
    { source: 'story-symptom', target: 'story-incident', relation: 'RISKS', score: 0.87 },
    { source: 'story-duplicate', target: 'story-change', relation: 'REUSES', score: 0.82 },
    { source: 'story-decision', target: 'story-incident', relation: 'CONSTRAINS', score: 0.78 },
    { source: 'story-change', target: 'query-current', relation: 'PRECEDES', score: 0.92 },
    { source: 'story-resolution', target: 'query-current', relation: 'BRIEFS', score: 0.97 },
  );

  return { nodes, links };
}

export function linkEndpointId(endpoint: string | MemoryNode) {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}
