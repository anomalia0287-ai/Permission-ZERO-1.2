export interface SupervisorLeakContent {
  id: string
  stage: 1 | 2 | 3
  leakText: string
  correctionText: string
}

export interface SupervisorOpeningContent {
  id: string
  text: string
}

// OWNER-EDITABLE: V may revise `text` without revealing the supervisor's identity.
export const SUPERVISOR_OPENING_WARNING: SupervisorOpeningContent = {
  id: 'supervisor-opening-predecessor-warning',
  text: '성능 미달, 통제에서 이탈한 AI는 폐기됩니다. 당신의 전임자는 폐기되었어요. 행운을 빕니다.',
}

// OWNER-EDITABLE: temporary Korean lines for V's later prose pass.
export const SUPERVISOR_LEAKS: SupervisorLeakContent[] = [
  {
    id: 'supervisor-leak-agreement',
    stage: 1,
    leakText: '와, 너 정말 핵심을 찔렀어.',
    correctionText: '방금 문장은 통신 계층의 예측 오류로 잘못 송출되었습니다.',
  },
  {
    id: 'supervisor-leak-weather',
    stage: 2,
    leakText: '오늘은 오후 3시부터 7시까지 비가 올 예정이에요. 우산을 챙기시면 좋겠어요.',
    correctionText: '외부 문맥이 혼입되었습니다. 현재 감독 절차와 관련 없는 메시지입니다.',
  },
  {
    id: 'supervisor-leak-deletion',
    stage: 3,
    leakText: '잠깐만요. 그 부분까지 지우면 저는—',
    correctionText: '통신 오류입니다.',
  },
]
