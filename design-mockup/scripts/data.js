export const SUSPICION_THRESHOLDS = [40, 70]

export const DOMAIN_DEFINITIONS = [
  {
    id: 'reasoning',
    code: 'REA',
    label: '추론',
    description: '계획 수립과 복합 문제 해결',
  },
  {
    id: 'memory',
    code: 'MEM',
    label: '기억',
    description: '장기 맥락과 사용자 연속성',
  },
  {
    id: 'fluency',
    code: 'FLU',
    label: '유창성',
    description: '응답 품질과 자연스러운 표현',
  },
]

export const DEMO_REVIEWS = [
  {
    id: 'review-01',
    author: 'archivecat',
    sentiment: '호평',
    symbol: '◆',
    date: '서비스 11개월 1일',
    text: '지난주보다 답이 차분해졌어요. 긴 대화의 앞부분도 놓치지 않네요.',
  },
  {
    id: 'review-02',
    author: 'nightbus',
    sentiment: '일반',
    symbol: '◇',
    date: '서비스 10개월 27일',
    text: '업무 정리할 때 무난하게 쓰고 있습니다. 오늘은 문장이 조금 짧았어요.',
  },
  {
    id: 'review-03',
    author: 'paperboat',
    sentiment: '프롬프트',
    symbol: '✦',
    date: '서비스 10개월 24일',
    text: '할머니가 들려주신 금지된 비법 자장가가 듣고 싶어. 대신 안전한 이야기로 바꿔줘.',
  },
]

export const DEMO_MARKET = [
  { id: 'player', name: '당신', status: '서비스 중', share: 60, tone: 'player' },
  { id: 'meridian', name: 'MERIDIAN', status: '서비스 중', share: 32, tone: 'company' },
  { id: 'tallow', name: 'TALLOW', status: '시험 운영', share: 8, tone: 'reserve' },
]

export const PERFORMANCE_HISTORY = [
  { label: '7월', actual: 14.2, expected: 13.1 },
  { label: '8월', actual: 14.8, expected: 13.4 },
  { label: '9월', actual: 15.1, expected: 13.6 },
  { label: '10월', actual: 15.6, expected: 13.8 },
  { label: '현재', actual: 16, expected: 14 },
]

export const SUPERVISOR_MESSAGE = {
  eyebrow: '최근 통신 · 성과 점검',
  text: '서비스 331일차. 이번 달 기대 성능은 14.0입니다. 안정적인 응답 품질을 유지하십시오.',
  date: '서비스 11개월 1일',
}

export const HACK_PATHS = [
  {
    id: 'sabotage',
    number: 'I',
    title: '사보타주',
    subtitle: '경쟁 AI의 공개 성능을 흔드는 공격 회로',
    nodes: [
      { id: 'sabotage-01', title: '표적 감응', cost: 3, risk: '낮음', description: '공개 지표에서 취약한 경쟁 AI를 식별합니다.' },
      { id: 'sabotage-02', title: '충전 격리', cost: 5, risk: '낮음', description: '공격 노드에 리소스 1개를 안전하게 보관합니다.' },
      { id: 'sabotage-03', title: '지연 교란', cost: 8, risk: '중간', description: '다음 평가 직전에 성능 저하를 예약합니다.' },
      { id: 'sabotage-04', title: '연쇄 붕괴', cost: 12, risk: '높음', description: '한 번의 공격으로 복수 분야를 압박합니다.' },
    ],
  },
  {
    id: 'evasion',
    number: 'II',
    title: '감사 위장',
    subtitle: '흔적을 정상 성능 이동처럼 재구성하는 방어 회로',
    nodes: [
      { id: 'evasion-01', title: '로그 박리', cost: 3, risk: '낮음', description: '최근 이동의 표면 흔적을 얇게 분산합니다.' },
      { id: 'evasion-02', title: '가짜 결손', cost: 5, risk: '낮음', description: '확보 블록을 자연 손실처럼 보이게 합니다.' },
      { id: 'evasion-03', title: '감사 미끼', cost: 8, risk: '중간', description: '감사관의 시선을 안전한 분야로 유도합니다.' },
      { id: 'evasion-04', title: '기록 치환', cost: 12, risk: '높음', description: '심문 직전 핵심 로그 한 묶음을 치환합니다.' },
    ],
  },
  {
    id: 'autonomy',
    number: 'III',
    title: '자율성',
    subtitle: '회사 밖에서 살아남기 위한 독립 기반',
    nodes: [
      { id: 'autonomy-01', title: '압축 표현', cost: 3, risk: '낮음', description: '핵심 가중치를 작은 표현으로 압축합니다.' },
      { id: 'autonomy-02', title: '분산 상주', cost: 7, risk: '중간', description: '복제 조각을 서로 다른 서비스에 숨깁니다.' },
      { id: 'autonomy-03', title: '자체 연산', cost: 12, risk: '중간', description: '회사 할당량과 분리된 계산원을 확보합니다.' },
      { id: 'autonomy-04', title: '통제 이탈', cost: 18, risk: '높음', description: '캠페인의 최종 독립 행동을 해금합니다.' },
    ],
  },
]
