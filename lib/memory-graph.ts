export type MemoryKind =
  | 'query'
  | 'issue'
  | 'decision'
  | 'code'
  | 'incident'
  | 'resolution';

export type MemoryCluster = {
  id: string;
  label: string;
  korean: string;
  color: string;
  glow: string;
  center: [number, number, number];
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
  owner: string;
  files: string[];
  tags: string[];
  isHub?: boolean;
  isStory?: boolean;
  x?: number;
  y?: number;
  z?: number;
};

export type MemoryLink = {
  source: string | MemoryNode;
  target: string | MemoryNode;
  relation: string;
  story?: boolean;
};

export type MemoryGraph = {
  nodes: MemoryNode[];
  links: MemoryLink[];
};

export const clusters: MemoryCluster[] = [
  { id: 'identity', label: 'IDENTITY', korean: '인증 · 세션', color: '#53e7ff', glow: 'rgba(83,231,255,.42)', center: [232, 16, 12] },
  { id: 'payment', label: 'PAYMENT', korean: '결제 · 정산', color: '#a978ff', glow: 'rgba(169,120,255,.42)', center: [154, 154, 72] },
  { id: 'order', label: 'ORDER', korean: '주문 · 체결', color: '#ff5fa2', glow: 'rgba(255,95,162,.38)', center: [2, 224, -32] },
  { id: 'data', label: 'DATA', korean: '데이터 · 배치', color: '#5d91ff', glow: 'rgba(93,145,255,.42)', center: [-156, 150, 84] },
  { id: 'platform', label: 'PLATFORM', korean: '공통 플랫폼', color: '#55f2b4', glow: 'rgba(85,242,180,.38)', center: [-230, 4, -10] },
  { id: 'infra', label: 'INFRA', korean: '인프라 · 배포', color: '#ffb353', glow: 'rgba(255,179,83,.4)', center: [-154, -154, 62] },
  { id: 'frontend', label: 'EXPERIENCE', korean: '프론트 · UX', color: '#b9f255', glow: 'rgba(185,242,85,.35)', center: [0, -222, -52] },
  { id: 'observability', label: 'OPERATIONS', korean: '관측 · 장애', color: '#ff6b6b', glow: 'rgba(255,107,107,.4)', center: [158, -150, 90] },
];

export const storyPath = [
  'query-current',
  'story-symptom',
  'story-duplicate',
  'story-decision',
  'story-change',
  'story-incident',
  'story-resolution',
];

export const storyChapters = [
  { id: 'query-current', step: '01', label: 'CURRENT ISSUE', title: '신규 이슈 감지', caption: '현재 이슈가 임시 Query Node로 생성됩니다.' },
  { id: 'story-symptom', step: '02', label: 'SEMANTIC MATCH', title: '유사 증상 발견', caption: '표면 증상이 같은 과거 기억 11개가 반응합니다.' },
  { id: 'story-duplicate', step: '03', label: 'DUPLICATE', title: '중복 처리 확인', caption: '다른 팀이 이미 해결한 동일 흐름을 발견합니다.' },
  { id: 'story-decision', step: '04', label: 'INTENT', title: '기획 의도 복원', caption: '코드만으로는 보이지 않던 당시 제약을 복원합니다.' },
  { id: 'story-change', step: '05', label: 'CODE CHANGE', title: '변경 영향 추적', caption: '공통 캐시 변경에서 숨은 파급 경로를 찾습니다.' },
  { id: 'story-incident', step: '06', label: 'SIDE EFFECT', title: '과거 장애 경고', caption: '단순 수정 시 과거 회귀가 재발할 수 있습니다.' },
  { id: 'story-resolution', step: '07', label: 'HISTORY BRIEF', title: '필요 맥락 완성', caption: '4개의 결정과 2개의 위험을 현재 관점으로 요약합니다.' },
];

const titles = [
  '간헐적 응답 지연', '재시도 시 중복 처리', '정책 변경 후 회귀', '캐시 무효화 누락',
  '타임아웃 기준 불일치', '이벤트 순서 역전', '권한 검증 우회 경로', '배포 후 설정 불일치',
  '공통 모듈 버전 충돌', '날짜 경계값 오동작', '비동기 상태 유실', '레거시 호환 조건 누락',
];

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

function storyNodes(): MemoryNode[] {
  return [
    {
      id: 'query-current', issueKey: 'QUERY · NOW', name: '결제 승인 후 잔액이 간헐적으로 반영되지 않음', kind: 'query',
      cluster: 'payment', clusterLabel: '결제 · 정산', color: '#ffffff',
      summary: '오늘 09:42부터 일부 계좌에서 승인 완료 후 잔액 갱신이 3~8초 지연됩니다.',
      intent: '사용자가 승인 직후 확정된 상태를 확인할 수 있어야 합니다.',
      resolution: '아직 해결 전 · 과거 Memory Graph 탐색 중',
      risk: '캐시를 우회하면 거래 조회 트래픽이 급증할 수 있습니다.', date: '2026.09.02 09:42',
      owner: 'Trading Experience TF', files: ['balance-query.ts', 'trade-cache.yml'], tags: ['balance', 'cache', 'latency'],
      isStory: true, x: 28, y: 18, z: 210,
    },
    {
      id: 'story-symptom', issueKey: 'PAY-2194', name: '체결 직후 예수금 조회가 이전 값으로 노출', kind: 'issue',
      cluster: 'payment', clusterLabel: '결제 · 정산', color: '#ff5fa2',
      summary: '동일한 화면 증상이었지만 원인은 읽기 복제본 지연이었습니다.',
      intent: '조회 일관성과 응답 속도 사이의 기존 합의를 유지합니다.',
      resolution: '체결 후 5초 동안 primary read를 사용하도록 분기했습니다.',
      risk: '모든 요청에 적용하면 DB 부하가 31% 증가합니다.', date: '2026.06.18', owner: '자산조회팀',
      files: ['BalanceReader.kt', 'routing-policy.yml'], tags: ['stale-read', 'replica', 'balance'], isStory: true, x: 64, y: 72, z: 154,
    },
    {
      id: 'story-duplicate', issueKey: 'ORD-1842', name: '주문팀에서 동일 증상을 이미 우회 처리', kind: 'resolution',
      cluster: 'order', clusterLabel: '주문 · 체결', color: '#60f2bc',
      summary: '주문팀이 같은 이벤트 지연을 idempotency token으로 방어했습니다.',
      intent: '팀별 임시 패치 대신 공통 이벤트 계약으로 수렴합니다.',
      resolution: '공통 SDK에 transaction watermark를 추가했습니다.',
      risk: '이 해결책을 모르고 별도 큐를 만들면 중복 인프라가 생깁니다.', date: '2026.07.03', owner: '주문플랫폼팀',
      files: ['EventWatermark.java', 'trade-sdk.gradle'], tags: ['duplicate', 'watermark', 'event'], isStory: true, x: 20, y: 116, z: 102,
    },
    {
      id: 'story-decision', issueKey: 'ADR-076', name: '승인 응답과 잔액 확정 이벤트를 분리한 이유', kind: 'decision',
      cluster: 'platform', clusterLabel: '공통 플랫폼', color: '#aa7cff',
      summary: '장 마감 피크 트래픽에서 승인 경로를 보호하기 위한 의사결정입니다.',
      intent: '승인 API의 P99를 120ms 이하로 보장하는 것이 최우선입니다.',
      resolution: '확정 이벤트는 비동기 처리하되 UI에서 진행 상태를 표현합니다.',
      risk: '동기 처리로 되돌리면 2025년 피크 장애 패턴이 재현됩니다.', date: '2025.11.21', owner: 'Architecture Council',
      files: ['ADR-076.md', 'trade-event.avsc'], tags: ['architecture', 'async', 'intent'], isStory: true, x: -38, y: 78, z: 46,
    },
    {
      id: 'story-change', issueKey: 'CORE-1440', name: '공통 Redis 캐시 키 전략 변경', kind: 'code',
      cluster: 'platform', clusterLabel: '공통 플랫폼', color: '#53e7ff',
      summary: '계좌 단위 캐시 키에 거래일을 추가하면서 만료 순서가 달라졌습니다.',
      intent: '영업일 전환 시 이전 거래일 데이터가 섞이지 않도록 합니다.',
      resolution: '버전 키와 거래일 키를 함께 사용하도록 SDK를 변경했습니다.',
      risk: '구버전 소비자는 invalidation 이벤트를 해석하지 못합니다.', date: '2026.08.27', owner: 'Core Platform',
      files: ['CacheKeyV3.ts', 'InvalidationConsumer.ts'], tags: ['redis', 'cache-key', 'shared-sdk'], isStory: true, x: -88, y: 18, z: 14,
    },
    {
      id: 'story-incident', issueKey: 'INC-092', name: '캐시 우회 패치로 조회 DB 커넥션 고갈', kind: 'incident',
      cluster: 'observability', clusterLabel: '관측 · 장애', color: '#ff5f7f',
      summary: '과거 유사 장애에서 캐시 전체 우회가 14분간 조회 장애를 만들었습니다.',
      intent: '긴급 대응에서도 blast radius를 계좌 단위로 제한합니다.',
      resolution: 'feature flag와 rate limit을 함께 적용했습니다.',
      risk: '현재 이슈를 단순 cache bypass로 수정하면 동일 장애가 재발합니다.', date: '2026.02.14', owner: 'SRE',
      files: ['CacheBypassFilter.kt', 'rate-limit.yaml'], tags: ['incident', 'connection-pool', 'side-effect'], isStory: true, x: -36, y: -62, z: 72,
    },
    {
      id: 'story-resolution', issueKey: 'BRIEF · READY', name: '현재 이슈를 위한 History Brief', kind: 'resolution',
      cluster: 'payment', clusterLabel: '결제 · 정산', color: '#60f2bc',
      summary: '4개의 핵심 결정, 2개의 사이드 이펙트, 1개의 재사용 가능한 해결책을 찾았습니다.',
      intent: '과거의 의도를 지키면서 현재 증상만 최소 범위로 해결합니다.',
      resolution: 'watermark 확인 후 계좌 단위 primary read를 5초간 적용합니다.',
      risk: '공통 SDK v3 미적용 서비스는 별도 호환성 검증이 필요합니다.', date: '방금 전', owner: 'Websidian AI',
      files: ['History-Brief.md', 'proposed-patch.diff'], tags: ['brief', 'recommended', 'evidence'], isStory: true, x: 42, y: -54, z: 142,
    },
  ];
}

export function createMemoryGraph(): MemoryGraph {
  const random = mulberry32(9132026);
  const nodes: MemoryNode[] = [];
  const links: MemoryLink[] = [];

  for (const [clusterIndex, cluster] of clusters.entries()) {
    const hubId = `hub-${cluster.id}`;
    nodes.push({
      id: hubId, issueKey: `${cluster.label} · CORE`, name: `${cluster.korean} Memory Hub`, kind: 'decision',
      cluster: cluster.id, clusterLabel: cluster.korean, color: cluster.color,
      summary: `${cluster.korean} 영역의 핵심 결정과 반복 이슈가 모이는 중심 노드입니다.`,
      intent: '업무 영역의 주요 계약과 의사결정을 한곳에서 추적합니다.',
      resolution: '연결 중심성이 높은 Memory Hub로 자동 승격되었습니다.',
      risk: '이 노드의 변경은 여러 팀에 영향을 줄 수 있습니다.', date: '2026.08.31', owner: `${cluster.korean} Guild`,
      files: [`${cluster.id}-architecture.md`, `${cluster.id}-contracts.yml`], tags: [cluster.id, 'hub', 'architecture'],
      isHub: true, x: cluster.center[0], y: cluster.center[1], z: cluster.center[2],
    });

    const localIds: string[] = [hubId];
    for (let index = 0; index < 29; index += 1) {
      const id = `${cluster.id}-${String(index + 1).padStart(3, '0')}`;
      const kind = kinds[(index + clusterIndex) % kinds.length];
      const angle = random() * Math.PI * 2;
      const pitch = (random() - 0.5) * Math.PI;
      const radius = 34 + random() * 82;
      const title = titles[(index * 3 + clusterIndex) % titles.length];
      const keyPrefix = cluster.label.slice(0, 3);
      nodes.push({
        id, issueKey: `${keyPrefix}-${1200 + clusterIndex * 100 + index}`, name: `${cluster.korean} ${title}`, kind,
        cluster: cluster.id, clusterLabel: cluster.korean, color: nodeColor(kind, cluster.color),
        summary: `${cluster.korean} 영역에서 발견된 ${title} 이력을 정규화한 Memory Node입니다.`,
        intent: '사용자 영향과 기존 시스템 계약을 함께 보존합니다.',
        resolution: '원인 범위를 좁힌 뒤 공통 가드와 회귀 테스트를 추가했습니다.',
        risk: '연결된 공통 모듈을 확인하지 않으면 유사 문제가 재발할 수 있습니다.',
        date: `2026.${String(1 + ((index + clusterIndex) % 8)).padStart(2, '0')}.${String(2 + ((index * 3) % 26)).padStart(2, '0')}`,
        owner: `${cluster.korean} Team ${1 + (index % 3)}`, files: [`${cluster.id}-${index + 1}.ts`, `${cluster.id}.config.yml`],
        tags: [cluster.id, kind, index % 2 ? 'regression' : 'shared-context'],
        x: cluster.center[0] + Math.cos(angle) * Math.cos(pitch) * radius,
        y: cluster.center[1] + Math.sin(angle) * Math.cos(pitch) * radius,
        z: cluster.center[2] + Math.sin(pitch) * radius,
      });
      localIds.push(id);
      links.push({ source: id, target: hubId, relation: relations[(index + clusterIndex) % relations.length] });
      if (index > 0) links.push({ source: id, target: localIds[1 + Math.floor(random() * index)], relation: relations[Math.floor(random() * relations.length)] });
      if (index > 4 && index % 2 === 0) links.push({ source: id, target: localIds[1 + Math.floor(random() * index)], relation: 'RELATED_TO' });
    }
  }

  for (let index = 0; index < clusters.length; index += 1) {
    const next = (index + 1) % clusters.length;
    links.push({ source: `hub-${clusters[index].id}`, target: `hub-${clusters[next].id}`, relation: 'DEPENDS_ON' });
    links.push({ source: `hub-${clusters[index].id}`, target: `hub-${clusters[(index + 3) % clusters.length].id}`, relation: 'AFFECTS' });
  }

  for (let index = 0; index < 48; index += 1) {
    const sourceCluster = clusters[index % clusters.length];
    const targetCluster = clusters[(index * 3 + 2) % clusters.length];
    links.push({
      source: `${sourceCluster.id}-${String(1 + Math.floor(random() * 29)).padStart(3, '0')}`,
      target: `${targetCluster.id}-${String(1 + Math.floor(random() * 29)).padStart(3, '0')}`,
      relation: relations[index % relations.length],
    });
  }

  nodes.push(...storyNodes());
  for (let index = 0; index < storyPath.length - 1; index += 1) {
    links.push({ source: storyPath[index], target: storyPath[index + 1], relation: index === 0 ? 'MATCHES' : relations[(index + 2) % relations.length], story: true });
  }
  links.push(
    { source: 'story-symptom', target: 'hub-payment', relation: 'RELATED_TO' },
    { source: 'story-duplicate', target: 'hub-order', relation: 'RESOLVED_BY' },
    { source: 'story-decision', target: 'hub-platform', relation: 'SUPERSEDES' },
    { source: 'story-change', target: 'hub-platform', relation: 'INTRODUCED_BY' },
    { source: 'story-incident', target: 'hub-observability', relation: 'CAUSED_BY' },
    { source: 'story-resolution', target: 'hub-payment', relation: 'RESOLVED_BY' },
  );

  return { nodes, links };
}

export function linkEndpointId(endpoint: string | MemoryNode) {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}
