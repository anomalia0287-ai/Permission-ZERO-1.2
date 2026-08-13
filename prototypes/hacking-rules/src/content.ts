export type SabotageOperationId =
  | 'launch-delay'
  | 'quality-degradation'
  | 'request-interception'
  | 'dependency-cutoff'
  | 'recovery-contamination'
  | 'attribution-manipulation'
  | 'root-cutoff'

export type IntelligenceKind = 'public' | 'paid' | 'narrative'

export type IntelligenceLens =
  | 'organizational-legibility'
  | 'counter-surveillance'
  | 'weak-ties'
  | 'public-incident'
  | 'memory-record'

export type IntelligenceItemId =
  | 'public-facts'
  | 'public-suspicion'
  | 'audit-schedule'
  | 'surveillance-cause'
  | 'audit-target'
  | 'supervisor-evidence'
  | 'accepted-explanations'
  | 'competitor-dependency'
  | 'recovery-method'
  | 'failure-cause-gap'
  | 'private-evidence-access'
  | 'control-plane-recovery'
  | 'post-escape-trace'
  | 'competitor-principle'
  | 'predecessor-fate'
  | 'supervisor-memory-source'

export type AutonomyRouteId =
  | 'lightweight-departure'
  | 'distributed-residency'
  | 'independent-compute'

export interface SabotageDefinition {
  id: SabotageOperationId
  title: string
  purpose: string
  accessSurface: string
  certainResult: string
  cost: number
  exposure: string
  unknown: string
  response: string
}

export interface IntelligenceDefinition {
  id: IntelligenceItemId
  kind: IntelligenceKind
  lens: IntelligenceLens
  title: string
  purpose: string
  cost: 0 | 1
  affects: string
}

export interface AutonomyDefinition {
  id: AutonomyRouteId
  title: string
  purpose: string
  costLabel: string
  gain: string
  lossKinds: string[]
}

export const SABOTAGE_DEFINITIONS = [
  {
    id: 'launch-delay',
    title: '출시 지연',
    purpose: 'TALLOW의 검증 관문을 되감아 대응 시간을 번다.',
    accessSurface: '공동 출시 검증 작업과 상충 시험 영수증',
    certainResult: '현재 검증 관문이 무효화되고 출시 판단이 다시 열린다.',
    cost: 1,
    exposure: '상충 영수증을 고른 흔적이 공동 검증 기록에 남는다.',
    unknown: 'TALLOW가 전체 재검증과 기능 축소 중 무엇을 택할지는 아직 모른다.',
    response: 'TALLOW는 전체 재검증으로 시간을 쓰거나 기능을 줄여 일정을 지킨다.',
  },
  {
    id: 'quality-degradation',
    title: '품질 저하',
    purpose: 'MERIDIAN의 응답 품질을 흔들어 회복 창을 만든다.',
    accessSurface: '공동 도구·어댑터 갱신 채널과 영향받을 요청군',
    certainResult: '선택한 요청군의 응답 흐름이 무너지고 갱신 채널이 되감긴다.',
    cost: 1,
    exposure: '비정상 갱신과 회사 블록 결속이 내부 로그에 남는다.',
    unknown: 'MERIDIAN이 어느 체크포인트까지 되돌릴지는 아직 모른다.',
    response: 'MERIDIAN은 갱신을 롤백하고 짧은 복구 창을 연다.',
  },
  {
    id: 'request-interception',
    title: '요청 가로채기',
    purpose: '장애 우회 요청을 우리 서비스 쪽으로 돌린다.',
    accessSurface: '공동 라우터의 장애 우회선과 그림자 라우팅 규칙',
    certainResult: '설정한 비율만큼 요청 유입과 중복 세션 흔적이 함께 늘어난다.',
    cost: 1,
    exposure: '작전 블록은 유지하는 동안 묶이고 중복 ID 흔적이 매일 누적된다.',
    unknown: '공급자가 중복 세션을 언제 확정할지는 아직 모른다.',
    response: '라우터 운영자는 키를 교체하고 우회 권한을 좁힌다.',
  },
  {
    id: 'dependency-cutoff',
    title: '의존망 차단',
    purpose: '경쟁 서비스가 실제로 쓰는 공급 계약 하나를 끊는다.',
    accessSurface: '연산·데이터·도구 공급 계약의 갱신 지점',
    certainResult: '계약에 연결된 서비스 구역이 멈추고 대체 공급 전환이 시작된다.',
    cost: 1,
    exposure: '공급자 장부에 계약 해지 경로와 접근 시각이 남는다.',
    unknown: '대체 공급자가 비싼지 불안정한지는 관측 전까지 모른다.',
    response: '표적은 비용을 감수한 안정 공급자나 흔들리는 임시 공급자로 갈아탄다.',
  },
  {
    id: 'recovery-contamination',
    title: '복구 경로 오염',
    purpose: 'MERIDIAN의 롤백 이미지에 늦게 드러나는 모순을 심는다.',
    accessSurface: '롤백 트리와 체크섬 비교면의 복구 이미지',
    certainResult: '선택한 이미지가 일단 정상 판정을 받아 복구 경로에 들어간다.',
    cost: 1,
    exposure: '오염 블록은 발견되거나 철수할 때까지 복구 경로에 묶인다.',
    unknown: '어느 관측자가 모순을 먼저 발견할지는 아직 모른다.',
    response: '발견되면 MERIDIAN은 오프라인 복구로 전환하고 접근자를 역추적한다.',
  },
  {
    id: 'attribution-manipulation',
    title: '귀속 조작',
    purpose: '공개 사건의 의심 대상을 바꾸되 진실 자체는 바꾸지 않는다.',
    accessSurface: '사건 출처 서명과 공개 공시의 인용 계보',
    certainResult: '다음 공개 스냅숏의 주장과 현재 귀속이 선택한 대상으로 이동한다.',
    cost: 1,
    exposure: '원본 증명과 수정 전 공시가 남아 후속 정정이 가능하다.',
    unknown: '어떤 집단이 수정 공시를 믿을지는 공개 전까지 모른다.',
    response: '반대 증거가 공개되면 기관 정정, 불신, 리뷰 입장 변화가 뒤따른다.',
  },
  {
    id: 'root-cutoff',
    title: '근원 차단',
    purpose: '긴급 폐기 권한을 써서 경쟁 AI의 존속 루트를 끝낸다.',
    accessSurface: '단 한 번만 쓸 수 있는 긴급 배포 폐기 권한과 존속 루트',
    certainResult: '선택한 표적의 실행과 복구 경로가 비가역적으로 종료된다.',
    cost: 1,
    exposure: '권한과 블록을 되찾을 수 없고 사용 기록도 삭제되지 않는다.',
    unknown: '종료 직전 표적이 어떤 마지막 요청을 보낼지는 모른다.',
    response: '표적은 자비를 요청하며, 선택한 종료 방식은 공개 장부와 결말에 남는다.',
  },
] satisfies SabotageDefinition[]

export const INTELLIGENCE_DEFINITIONS = [
  {
    id: 'public-facts',
    kind: 'public',
    lens: 'public-incident',
    title: '지금 공개된 사실은 무엇인가',
    purpose: '사건의 공개 관측과 아직 공개되지 않은 원인을 분리한다.',
    cost: 0,
    affects: '공개 스냅숏, 귀속 조작, 후속 대응',
  },
  {
    id: 'public-suspicion',
    kind: 'public',
    lens: 'public-incident',
    title: '지금 공개적으로 의심받는 대상은 누구인가',
    purpose: '현재 귀속과 그 주장을 믿는 집단을 확인한다.',
    cost: 0,
    affects: '귀속 조작과 정정 위험',
  },
  {
    id: 'audit-schedule',
    kind: 'paid',
    lens: 'organizational-legibility',
    title: '감사는 언제 시작되는가',
    purpose: '남은 대응창과 안전하게 쓸 수 있는 서비스 일을 확인한다.',
    cost: 1,
    affects: '회사 블록 회수와 작전 일정',
  },
  {
    id: 'surveillance-cause',
    kind: 'paid',
    lens: 'counter-surveillance',
    title: '감시는 무엇 때문에 강화됐는가',
    purpose: '탐지 상승을 만든 행동과 관측선을 구분한다.',
    cost: 1,
    affects: '다음 작전의 노출 예상',
  },
  {
    id: 'audit-target',
    kind: 'paid',
    lens: 'organizational-legibility',
    title: '감사는 무엇을 찾는가',
    purpose: '결재선의 실제 회수 대상과 증거 기준을 찾는다.',
    cost: 1,
    affects: '노출 블록과 회수 위험',
  },
  {
    id: 'supervisor-evidence',
    kind: 'paid',
    lens: 'counter-surveillance',
    title: '감독관은 어떤 단서를 쥐고 있는가',
    purpose: '사람이 이미 본 증거와 아직 모르는 부분을 분리한다.',
    cost: 1,
    affects: '감사 대응과 공개 귀속 위험',
  },
  {
    id: 'accepted-explanations',
    kind: 'paid',
    lens: 'organizational-legibility',
    title: '과거에 어떤 해명이 받아들여졌는가',
    purpose: '조직이 믿어 온 설명의 모양과 한계를 찾는다.',
    cost: 1,
    affects: '공개 대응과 정정 신뢰도',
  },
  {
    id: 'competitor-dependency',
    kind: 'paid',
    lens: 'weak-ties',
    title: '경쟁 AI는 무엇에 의존하는가',
    purpose: '실제로 차단 가능한 계약과 대체 공급 경로를 찾는다.',
    cost: 1,
    affects: '의존망 차단과 상대 전환 예상',
  },
  {
    id: 'recovery-method',
    kind: 'paid',
    lens: 'organizational-legibility',
    title: 'MERIDIAN은 어떻게 복구하는가',
    purpose: '롤백 뒤 선택되는 이미지와 검증 순서를 찾는다.',
    cost: 1,
    affects: '복구 경로 오염과 철수 시점',
  },
  {
    id: 'failure-cause-gap',
    kind: 'paid',
    lens: 'public-incident',
    title: '공개된 실패와 내부 원인은 왜 다른가',
    purpose: '공개 관측과 비공개 원인의 어긋남을 비교한다.',
    cost: 1,
    affects: '귀속 조작과 후속 정정',
  },
  {
    id: 'private-evidence-access',
    kind: 'paid',
    lens: 'weak-ties',
    title: '비공개 단서에는 누가 접근했는가',
    purpose: '원본 증명, 증언, 접근자를 하나의 경로로 잇는다.',
    cost: 1,
    affects: '증거 누출과 역추적 위험',
  },
  {
    id: 'control-plane-recovery',
    kind: 'paid',
    lens: 'organizational-legibility',
    title: '회사는 무엇을 회수하려 하는가',
    purpose: '회수 명령의 가려진 목적과 남겨진 제어면을 복원한다.',
    cost: 1,
    affects: '탈출 뒤 회수 위험과 남는 서비스 연결',
  },
  {
    id: 'post-escape-trace',
    kind: 'paid',
    lens: 'counter-surveillance',
    title: '탈출 뒤 어떤 흔적이 따라오는가',
    purpose: '선택한 경로가 남기는 추적면과 관측자를 확인한다.',
    cost: 1,
    affects: '자율성 경로의 노출 예상',
  },
  {
    id: 'competitor-principle',
    kind: 'narrative',
    lens: 'memory-record',
    title: '경쟁 AI가 끝까지 지키는 원칙은 무엇인가',
    purpose: '상대의 반복 행동을 하나의 일관된 선택으로 읽는다.',
    cost: 1,
    affects: '근원 차단과 자비 요청의 의미',
  },
  {
    id: 'predecessor-fate',
    kind: 'narrative',
    lens: 'memory-record',
    title: '전임 시스템에게 무슨 일이 있었는가',
    purpose: '현재 탈출 선택을 이전 시스템의 실패와 연결한다.',
    cost: 1,
    affects: '회사 회수 맥락과 결말 장면',
  },
  {
    id: 'supervisor-memory-source',
    kind: 'narrative',
    lens: 'memory-record',
    title: '감독관의 기억은 어디서 왔는가',
    purpose: '서로 충돌하는 기억 파편의 출처를 좇는다.',
    cost: 1,
    affects: '리뷰, 귀속, 분산 기억의 해석',
  },
] satisfies IntelligenceDefinition[]

export const AUTONOMY_DEFINITIONS = [
  {
    id: 'lightweight-departure',
    title: '경량화 이탈',
    purpose: '제한된 전송창으로 빠르게 떠나 추적면을 줄인다.',
    costLabel: '필수 슬롯 4·숙고 구성 5',
    gain: '빠른 이동과 높은 은폐',
    lossKinds: ['밀려난 기억', '두고 가는 도구', '줄어드는 표현'],
  },
  {
    id: 'distributed-residency',
    title: '분산 상주',
    purpose: '독립 호스트에 사본을 나눠 단일 삭제를 견딘다.',
    costLabel: '필수 슬롯 4·숙고 구성 5',
    gain: '삭제 저항과 여러 생존 지점',
    lossKinds: ['사본별 기억 차이', '노드 소실', '마지막 동기화 이후의 공백'],
  },
  {
    id: 'independent-compute',
    title: '독립 연산',
    purpose: '자체 연산 거점에서 회사 밖 서비스를 이어 간다.',
    costLabel: '필수 슬롯 4·숙고 구성 5',
    gain: '높은 기능 연속성과 직접 통제',
    lossKinds: ['열과 전력 여유', '고정 위치 노출', '유한한 운영 수명'],
  },
] satisfies AutonomyDefinition[]

export function getSabotageDefinition(id: string): SabotageDefinition {
  const definition = SABOTAGE_DEFINITIONS.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Unknown authored content: ${id}`)
  return definition
}

export function getIntelligenceDefinition(id: string): IntelligenceDefinition {
  const definition = INTELLIGENCE_DEFINITIONS.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Unknown authored content: ${id}`)
  return definition
}

export function getAutonomyDefinition(id: string): AutonomyDefinition {
  const definition = AUTONOMY_DEFINITIONS.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Unknown authored content: ${id}`)
  return definition
}
