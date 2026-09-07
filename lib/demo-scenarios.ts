export const representativeScenarios = {
  'WS-008': '과거 해결·장애 이력 재사용',
  'WS-016': '기획 의도 확인으로 불필요한 개발 방지',
  'WS-024': '타팀 변경에서 파생된 영향 발견',
} as const;

export function demoResolutionDefaults(issueId: string) {
  if (issueId !== 'WS-008') return null;
  return {
    body: 'WS-007에서 파트너 주문 경로가 공통 중복 방지 계약 미적용임을 확인했습니다. WS-001·WS-003의 동일 구매 시도 식별자 유지 방식을 파트너 어댑터에 적용하고, WS-004~006의 장시간 결제 승인 지연 및 롤백 조건을 회귀 시험에 포함했습니다. 연결 지연 뒤 연속 재시도에서도 주문 한 건만 생성되고 완료 후 동일 주문번호가 반환되는 것을 확인했습니다. 기존 중복 주문은 승인 내역과 최종 상태를 대조해 운영 절차로 정리했습니다.',
    outcome: '파트너 주문 재시도 중복 접수 방지 및 장시간 지연 회귀 시험 완료',
    resources:
      'code:/platform/idempotency/execute-once.ts | 공통 중복 처리 방지 모듈 | code\ncode:/partner/orders/submit-order.test.ts | 파트너 주문 재시도 회귀 테스트 | code\ndoc:/commerce/order-retry-contract | 주문 요청 재시도 규약 | document\ndoc:/commerce/incident-20260710 | 7월 10일 주문 장애 대응 기록 | document',
    tags: '파트너, 주문, 접수, 중복방지, 재시도',
  };
}
