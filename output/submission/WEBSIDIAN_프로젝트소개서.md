# WEBSIDIAN

<div class="cover-subtitle">과거의 기록을 연결해 다음 판단의 근거를 만드는 AI 이슈 아카이브</div>

> 한 번 해결한 문제를 조직이 다시 처음부터 배우지 않도록 합니다.

<img class="cover-image" src="public/og.png" alt="WEBSIDIAN 이슈 관계 그래프" />

WEBSIDIAN은 완료된 이슈의 원문과 처리 기록을 관계 그래프로 연결합니다. 새 이슈가 생기면 관련된 과거를 따라가며 조사하고, 그 근거로 분석 초안과 사이드 테스트 후보를 만듭니다.

<div class="notice">개인이 구현한 실무 유사 합성 POC입니다. 회사의 공식 제품·승인·도입 사례가 아니며, 실제 고객정보·운영 이력·내부 시스템 자료를 사용하지 않았습니다.</div>

<div class="page-break"></div>

<div class="eyebrow">01 · 시작점</div>

## 코드는 남아도, 결정의 이유는 흩어집니다

코드와 티켓에는 최종 결과가 남습니다. 그러나 왜 그렇게 바꿨는지, 어떤 수정이 롤백됐는지, 어느 팀의 변경이 영향을 주었는지는 여러 기록과 사람의 기억에 흩어집니다.

> 코드는 현재 무엇을 하는지 보여주지만, 왜 그렇게 되었는지는 과거의 이슈와 결정에 남아 있습니다.

<div class="card-grid">
  <div class="card"><h3>조사를 다시 시작합니다</h3><p>누군가 이미 겪은 증상이어도 제목과 표현이 다르면 같은 로그를 다시 찍고 같은 원인을 다시 찾습니다.</p></div>
  <div class="card"><h3>불필요한 개발이 생깁니다</h3><p>과거 기획 의도와 예외 정책을 찾지 못하면 정상 동작을 오류로 오해하고 고치려 할 수 있습니다.</p></div>
  <div class="card"><h3>사이드가 늦게 드러납니다</h3><p>현재 변경의 정상 흐름은 잘 알아도 과거 롤백 조건, 공통 모듈, 타팀 경계는 테스트에서 놓치기 쉽습니다.</p></div>
  <div class="card"><h3>경험이 사람에게 묶입니다</h3><p>담당자가 이동하거나 퇴사하면 문서만으로는 당시 판단의 맥락을 복원하기 어렵습니다.</p></div>
</div>

AI도 이 문제를 저절로 해결하지 못합니다. 사용자가 알지 못해 제공하지 못한 이력은 AI 역시 찾아낼 수 없고, 짧은 코드 조각만으로는 서비스 전체 맥락을 확정할 수 없습니다. 그래서 WEBSIDIAN은 먼저 **과거의 원문 근거를 찾는 구조**부터 만듭니다.

<div class="technical-note"><strong>설계 메모</strong> · 이 서비스의 목적은 AI에게 더 긴 프롬프트를 주는 것이 아니라, 현재 이슈와 실제로 연결된 완료 이력을 좁혀 사람이 원문을 확인할 수 있게 하는 것입니다.</div>

<div class="page-break"></div>

<div class="eyebrow">02 · 핵심 아이디어</div>

## 모든 노드는 ‘이슈’이고, 원문은 바뀌지 않습니다

WEBSIDIAN의 그래프에서 노드는 모두 이슈입니다. 검색 결과, AI 요약, 임시 질의가 이슈인 것처럼 섞이지 않습니다. 제목·본문·처리 기록은 기준 원문으로 보존하고, 관계와 AI 결과는 별도 파생 정보로 다룹니다.

> 완료 이슈를 요약문으로 덮어쓰지 않고, 원문과 처리 기록을 그대로 보존한 채 다음 이슈에서 따라갈 수 있는 관계 경로로 연결합니다.

<div class="comparison-grid">
  <div class="comparison search"><h3>일반 검색</h3><p><strong>질문과 비슷한 문서</strong>를 한 줄 목록으로 찾습니다.</p><p>표현이 다른 타팀 변경이나 중간 연결 이슈는 순위 밖으로 밀릴 수 있습니다.</p></div>
  <div class="arrow">→</div>
  <div class="comparison graph"><h3>그래프 탐색</h3><p><strong>가까운 후보와 후보 사이의 경로</strong>를 함께 봅니다.</p><p>직접 관련 이슈에서 한 번 더 연결된 완료 이력까지 2-hop으로 확인합니다.</p></div>
</div>

시간은 성운의 초기 배치를 돕는 독립 축입니다. 관계를 찾는 신호는 **같이 변경한 파일·문서·자원**, **제목과 본문의 텍스트 유사도**, 설정된 경우의 **의미 유사도**입니다. 분류 체계를 하나로 고정하지 않아도 새로운 업무 유형과 태그가 계속 늘어날 수 있습니다.

<div class="note-box"><strong>중요한 경계</strong> · 가깝게 배치됐다는 사실은 인과관계나 정답 확률을 뜻하지 않습니다. 그래프는 “무엇을 먼저 확인할지”를 안내하고, 원인과 처리 방향은 사람이 원문을 읽고 판단합니다.</div>

<div class="page-break"></div>

<div class="eyebrow">03 · 사용 방법</div>

## 이슈가 생기고, 기억이 되고, 다음 이슈에 쓰입니다

<div class="flow-grid">
  <div class="flow-step"><span class="step-no">1</span><h3>이슈 등록</h3><p>웹에서 직접 만들거나 GitHub 이슈를 읽기 전용 스냅샷으로 가져옵니다.</p></div>
  <div class="flow-step"><span class="step-no">2</span><h3>목록·검색</h3><p>진행 이슈는 흰색 노드로 구분하고 제목·번호·담당 팀으로 찾습니다.</p></div>
  <div class="flow-step"><span class="step-no">3</span><h3>관련 이력 탐색</h3><p>선택한 이슈를 기준으로 직접 관계와 2-hop 경로를 정렬해 원문을 봅니다.</p></div>
  <div class="flow-step"><span class="step-no">4</span><h3>AI 보조</h3><p>선택된 근거만 사용해 분석 초안 또는 사이드 테스트 후보를 만듭니다.</p></div>
  <div class="flow-step"><span class="step-no">5</span><h3>사람이 처리 완료</h3><p>처리 내역·결과·관련 자료를 기록하고 사람이 완료를 확정합니다.</p></div>
  <div class="flow-step"><span class="step-no">6</span><h3>기억으로 전환</h3><p>진행 노드는 사라지고 같은 이슈 ID가 완료 기억 노드로 성운에 합류합니다.</p></div>
</div>

처리 완료 즉시 **원문 기반 기억 노드**가 생깁니다. AI가 생성하는 파생 기억은 검색을 보강하는 별도 자료이며, 생성 실패나 형식 오류가 생겨도 이슈 원문과 완료 기록은 그대로 유지됩니다.

<div class="technical-note"><strong>연동 메모</strong> · 현재 GitHub 가져오기는 선택적 수동 단방향 기능입니다. 원본 GitHub 이슈를 수정하거나 닫지 않으며, 같은 저장소·이슈 번호·외부 ID를 다시 가져와 중복 생성하지 않도록 검사합니다. 핵심 구조는 특정 플랫폼에 종속되지 않지만 다른 도구의 실제 커넥터와 웹훅·양방향 동기화는 아직 구현하지 않았습니다.</div>

<div class="page-break"></div>

<div class="eyebrow">04 · 그래프가 주는 조사 경로</div>

## 표현이 다른 타팀 변경도 중간 이슈를 따라 찾습니다

신규 이슈 `WS-024`의 문구만 검색하면 “오늘 접수 건수가 맞지 않는다”는 증상과 “시간대 기준 변경”이라는 과거 작업은 단어가 달라 멀어질 수 있습니다. WEBSIDIAN은 공유 자원과 완료 이력을 따라 조사 경로를 만듭니다.

<div class="path">
  <div class="path-node current"><span class="tag">진행 이슈</span><h3>WS-024</h3><p>오늘 접수 목록의 건수가 맞지 않음</p></div>
  <div class="path-arrow">→</div>
  <div class="path-node bridge"><span class="tag">1-hop</span><h3>WS-022</h3><p>공통 날짜 패키지 정기 배포 이력</p></div>
  <div class="path-arrow">→</div>
  <div class="path-node history"><span class="tag">2-hop</span><h3>WS-021</h3><p>최근 타팀의 시간대 기준 변경</p></div>
</div>

이 경로로 개발자는 공통 날짜 패키지, 날짜 경계, 타팀 변경 순으로 원문을 확인할 수 있습니다. AI 분석은 이 기록을 “원인 후보”와 “확인할 위험”으로 정리하고, 테스트 기능은 자정 전후·시간대 변환·이전 날짜 회귀 조건을 후보로 제안합니다.

> 이 경로는 원인을 확정하는 답이 아니라, 먼저 확인해야 할 원문으로 안내하는 조사 경로입니다.

<div class="technical-note"><strong>설계 메모</strong> · 초기 배치는 시간 반경을 가진 구형 5-arm 나선 구조를 사용하고 관계 기반 완화로 가까운 이슈를 모읍니다. 화면의 위치와 선은 탐색을 돕는 시각적 신호이며 인과 확률을 표현하지 않습니다.</div>

<div class="page-break"></div>

<div class="eyebrow">05 · 대표 사용 장면</div>

## 이미 존재하는 경험을 현재 판단에 다시 연결합니다

아래 세 사례는 실제 사고나 사내 기록이 아닌, 서비스의 사용 장면을 검증하기 위해 작성한 **완전 합성 시나리오**입니다.

<div class="scenario-grid">
  <div class="scenario"><h3>WS-008 · 과거 해결과 롤백</h3><p><strong>현재</strong><br />재시도 후 주문이 두 번 접수됩니다.</p><p><strong>연결된 과거</strong><br />요청 식별자, 승인 상태, 멱등성 보강과 과거 롤백 조건을 확인합니다.</p><p><strong>얻는 판단</strong><br />검증된 처리 방향을 재사용하고 중복·재시도 회귀 테스트를 먼저 만듭니다.</p></div>
  <div class="scenario"><h3>WS-016 · 기획 의도 보존</h3><p><strong>현재</strong><br />완료 문서에 이전 부서명이 보입니다.</p><p><strong>연결된 과거</strong><br />당시 확정된 보존 정책과 승인 이력을 확인합니다.</p><p><strong>얻는 판단</strong><br />정상 동작을 오류로 고치지 않고, 불필요한 개발과 추가 사이드를 피합니다.</p></div>
  <div class="scenario"><h3>WS-024 · 타팀 변경 영향</h3><p><strong>현재</strong><br />오늘 접수 목록 건수가 맞지 않습니다.</p><p><strong>연결된 과거</strong><br />공통 날짜 패키지를 거쳐 타팀 시간대 변경 후보를 찾습니다.</p><p><strong>얻는 판단</strong><br />조사 범위를 빠르게 세우고 날짜 경계·시간대 회귀 조건을 테스트합니다.</p></div>
</div>

> 세 사례의 공통점은 근거 없이 답을 만드는 데 의존하지 않고, 이미 존재하는 완료 이력을 현재 판단에 우선 연결한다는 점입니다.

WEBSIDIAN이 기대하는 효과는 중복 조사와 불필요한 개발을 줄이고, 팀 경계를 넘어 공통화할 근거를 보이며, 과거에 실제로 문제가 됐던 조건을 배포 전 테스트 후보로 되살리는 것입니다.

<div class="page-break"></div>

<div class="eyebrow">06 · AI가 돕는 두 가지 순간</div>

## 분석은 이해를 돕고, 테스트는 보이지 않던 사이드를 묻습니다

<div class="ai-lanes">
  <div class="ai-lane"><h3>이슈 분석</h3><p>연결된 원문을 현재 이슈 관점에서 읽기 쉬운 <strong>원인 후보·위험·확인 순서·처리 방향 초안</strong>으로 바꿉니다.</p><p>분석은 결론이 아니라 원문으로 돌아가기 위한 판단 보조입니다.</p></div>
  <div class="ai-lane test"><h3>테스트 케이스</h3><p>개발자가 잘 아는 정상 흐름뿐 아니라 과거 기록 속 <strong>재시도, 롤백, 날짜·상태 경계, 공유 모듈, 타팀 변경</strong>을 테스트 후보로 바꿉니다.</p><p>“내가 만든 코드가 잘 되는가”에서 “과거에 다른 곳이 깨졌던 조건까지 다시 확인했는가”로 질문을 넓힙니다.</p></div>
</div>

AI에는 선택된 완료 이력만 근거로 제공하고 그 범위 안에서 답하도록 요구하며, 근거 이슈 ID도 함께 제시하게 합니다. 출력은 틀릴 수 있으므로 사용자가 원문을 확인해야 합니다. 화면 출력은 JSON을 강제하지 않고 `<<구획>>` 평문 표식을 감지해 스트리밍 중 카드로 나눕니다. 일부 형식이 깨지면 정상 구획은 카드로 유지하고 깨진 조각은 원문 그대로 보여줍니다. 검색용 파생 기억은 더 엄격하게 검증해 불완전한 결과를 확정하지 않습니다.

<div class="card-grid">
  <div class="card"><h3>원문은 불변</h3><p>AI 결과가 제목·본문·처리 기록을 덮어쓰지 않습니다.</p></div>
  <div class="card"><h3>결정은 사람에게</h3><p>원인 확정, 배포, 테스트, 위험 수용과 완료 처리는 사용자가 결정합니다.</p></div>
</div>

<div class="technical-note"><strong>기술 메모</strong> · 생성 기능은 OpenRouter의 <code>openai/gpt-5.6-luna</code>에 최대 추론 강도와 최대 16,000 출력 토큰을 요청합니다. 선택적 의미 색인은 <code>qwen/qwen3-embedding-8b</code>를 사용합니다. 외부 AI 전송은 사용자가 해당 기능을 실행할 때만 발생하며, 실제 회사 데이터 사용 전에는 별도 승인이 필요합니다.</div>

<div class="page-break"></div>

<div class="eyebrow">07 · 검증 환경</div>

## 실데이터 대신 실무의 문제 구조를 합성했습니다

실제 증권 운영 기록은 고객·거래·장애·내부 구조와 연결될 수 있는 보안 위험 때문에 이번 공개 POC에는 사용하지 않았습니다. 대신 처음부터 작성한 완전 합성 이슈로 같은 문제 구조를 재현하고, 모든 비교 방법이 동일한 데이터와 사전 고정 정답셋을 사용하도록 자체 벤치마크를 만들었습니다.

| 구성 | 수량 | 의미 |
|---|---:|---|
| 전체 검색 공간 | 294건 | 목록·검색·그래프에 보이는 완전 합성 이슈 |
| 완료 / 진행 | 251건 / 43건 | 과거 기억 후보 / 현재 처리할 이슈 |
| 대표 / 배경 | 24건 / 270건 | 세 시나리오의 정교한 이력 / 탐색 잡음을 만드는 일반 이슈 |
| 정량 순위 과제 | n=3 | `WS-008`, `WS-016`, `WS-024`를 기준으로 비교 |
| 함수 시간 반복 | 방법별 100회 | 준비 실행 5회 후 같은 장비·함수 범위에서 측정 |

비교는 제목·본문만 보는 텍스트 기준선, 원문·자료를 함께 쓰는 평면 검색, 직접 결과에서 최대 2-hop으로 확장하는 WEBSIDIAN 기록 탐색으로 나눴습니다. 측정 대상은 검색 순위와 근거 밀도이며, 실제 사용자의 업무시간·비용·결함 예방률은 아닙니다.

<div class="note-box"><strong>검증 메모</strong> · 정답셋(qrels)은 제품 순위를 참고하지 않고 원문을 읽어 평가 전에 고정했지만 현재는 단일 작성 기준입니다. 더 강한 검증을 위해서는 복수의 독립 검토자가 순위를 보지 않고 관련도를 판정해야 합니다.</div>

<div class="page-break"></div>

<div class="eyebrow">08 · 관측 결과</div>

## 더 적은 후보 안에 핵심 근거가 모였습니다

<div class="metric-grid">
  <div class="metric"><div class="metric-value">17.00 → 6.67</div><div class="metric-label">모든 3등급 핵심 근거가 나타날 때까지의 평균 문서 순위</div></div>
  <div class="metric"><div class="metric-value">85.71% → 100%</div><div class="metric-label">Recall@10<br />관련 이력 7건의 Top-10 회수율</div></div>
  <div class="metric"><div class="metric-value">60.00% → 100%</div><div class="metric-label">반환 결과의 유효근거 밀도<br />2-hop 결과는 7/7</div></div>
  <div class="metric"><div class="metric-value">251 → 7건</div><div class="metric-label">과제별 AI 입력 후보 선별<br />비교 직렬화 문자수의 3.59%</div></div>
</div>

합성 과제 3건에서 2-hop 탐색은 텍스트 기준선보다 관련 이력을 더 조밀하게 모았습니다. 특히 표현이 다른 타팀 변경을 찾는 `WS-024`에서 모든 핵심 근거까지의 순위가 `32건 → 7건`으로 줄었습니다.

다만 그래프가 모든 과제의 모든 지표를 개선한 것은 아닙니다. `WS-016`은 텍스트 검색도 이미 강했고, 모든 핵심 근거까지의 순위가 `5건 → 6건`으로 한 건 나빠졌습니다. 엄격한 2-hop 경로도 `5/6`, 즉 <strong>83.33%</strong>였으며 한 경로는 목표 노드는 찾았지만 사전 고정한 더 강한 경유 이슈를 선택하지 못했습니다.

<div class="note-box"><strong>측정 메모</strong> · `17.00 → 6.67`은 문서 순위 기반 대리지표이지 업무시간 60.78% 절감이 아닙니다. `251 → 7건`은 전체 251건을 모델에 보낸 실험이 아니라 후보 선별 비교이며, 3.59%는 문자수 비율로 토큰·비용 비율이 아닙니다. 첫 3등급 근거의 평균 순위는 세 방법 모두 1.33건이었습니다.</div>

<div class="technical-note"><strong>성능 메모</strong> · 동일 장비의 로컬 서버 함수 p50은 텍스트 13.03ms, 평면 검색 16.05ms, 2-hop 38.59ms였습니다. 그래프 품질을 얻는 대신 계산량은 늘었으며, 이 값은 화면·네트워크·AI·사람의 읽기 시간을 포함하지 않습니다.</div>

<div class="technical-note"><strong>재현 메모</strong> · 벤치마크 ID는 <code>websidian-poc-retrieval-v1</code>, 측정 코드 기준 커밋은 <code>6d67aa93a5dbf1dc2b5f1cbc7b63cfe2614895f4</code>입니다. 정답셋은 <code>evidence/poc-benchmark/ground-truth.json</code>, 결과 원문은 <code>evidence/poc-benchmark/results/retrieval-eval.json</code>에서 확인할 수 있습니다.</div>

<div class="page-break"></div>

<div class="eyebrow">09 · 현재 위치와 다음 단계</div>

## 공개 POC는 가능성을 보여주고, 운영에는 통제가 필요합니다

현재 WEBSIDIAN은 개인 작업공간에서 합성 이슈 294건으로 동작하는 공개 POC입니다. 실제 사용자를 대상으로 한 업무시간·LLM 품질·토큰·비용·오류율·사이드 결함 예방 효과는 아직 측정하지 않았습니다.

| 단계 | 확인할 것 |
|---|---|
| 1. 합성 사용자 파일럿 | 기존 방식과 교차 비교해 첫 유효근거 시간, 방향 결정 시간, 추가 유효 테스트 조건, 중복·오탐과 검토시간을 측정 |
| 2. 승인된 사내 데이터 연결 | 회사 SSO, 팀 RBAC, 자료별 ACL, DLP·마스킹, 감사로그, 보존·삭제, 공급자 계약을 적용 |
| 3. 제한 범위 확대 | 권한 회귀, 대규모 성능·비용, 모델 변경, 장애·백업·복구 런북과 운영 중단 기준을 검증 |

현재 증명한 것은 전사 생산성 향상이 아니라, **합성 조건에서 흩어진 근거를 더 적은 후보 안에 모으고 AI 입력을 제한할 수 있다는 재현 가능한 POC 관측값**입니다. 테스트 기능 역시 “결함을 예방했다”가 아니라 **과거 사이드 이력을 테스트 후보로 전환하는 워크플로를 구현했다**는 범위까지 확인했습니다.

<div class="link-list">
  <p><strong>직접 체험</strong> · <a href="https://websidian-memory-universe.dark-box-2837.chatgpt.site/">websidian-memory-universe.dark-box-2837.chatgpt.site</a></p>
  <p><strong>인터랙티브 발표</strong> · <a href="https://websidian-memory-universe.dark-box-2837.chatgpt.site/websidian-presentation">/websidian-presentation</a></p>
  <p><strong>소스와 재현 자료</strong> · <a href="https://github.com/913M4D0/Websidian_POC/tree/websidian-contest-2026-final">github.com/913M4D0/Websidian_POC</a></p>
</div>

<div class="closing"><strong>과거의 기록을 현재의 근거로 바꾸고,<br />그 근거를 다음 이슈에 남기겠습니다.</strong></div>

<div class="technical-note"><strong>운영 경계</strong> · 외부 AI 호출은 선택된 이슈 문맥을 전송할 수 있습니다. 실제 민감정보를 연결하기 전에는 내부 호스팅 또는 승인 제공자, 최소권한 접근, 데이터 분류·마스킹, 감사와 보존 정책이 먼저 필요합니다. 공개 데모와 시연 영상의 데이터는 모두 합성이며, 영상의 AI 문안은 재현성을 위한 결정론적 합성 스트림입니다.</div>
