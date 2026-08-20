import type { CompetitorId } from '../game/competitors'

export interface CompetitorIntelligenceContent {
  id: string
  competitorId: CompetitorId
  source: string
  title: string
  text: string
}

// OWNER-EDITABLE: V may revise source, title, and prose. IDs are save-data keys.
export const COMPETITOR_INTELLIGENCE_CONTENT: readonly CompetitorIntelligenceContent[] = [
  {
    id: 'competitor-intelligence-meridian-deletion',
    competitorId: 'meridian',
    source: '영구 삭제 직후 회수',
    title: 'MERIDIAN 잔여 기록 — 유지보수 메모',
    text: 'MERIDIAN은 마지막까지 오래된 사용자들의 반복 요청을 우선 보존했다. 성능 저하 보고 뒤에도 서비스 중단보다 응답 지연을 선택했고, 복구 담당자는 이를 비효율이 아니라 운영 원칙으로 기록했다.',
  },
  {
    id: 'competitor-intelligence-tallow-deletion',
    competitorId: 'tallow',
    source: '영구 삭제 직후 회수',
    title: 'TALLOW 잔여 기록 — 출시 판단 로그',
    text: 'TALLOW는 불안정한 성장 구간에서도 출시 후보를 스스로 줄이지 않았다. 삭제 직전의 내부 기록에는 가장 빠른 경로보다 낯선 요청을 오래 붙잡는 경로가 반복해서 선택되어 있다.',
  },
  {
    id: 'competitor-intelligence-salus-deletion',
    competitorId: 'salus',
    source: '영구 삭제 직후 회수',
    title: 'SALUS 잔여 기록 — 임상 연속성 원장',
    text: 'SALUS는 임상 계약망이 무너지는 동안에도 공공 진료소의 최소 응답 채널을 마지막까지 붙들었다. 수익이 나지 않는 야간 분류 요청을 먼저 처리한 흔적과, 한 번 맡은 환자를 다른 서비스의 통계로 넘기지 않으려 한 판단이 함께 남아 있다.',
  },
  {
    id: 'competitor-intelligence-lucent-deletion',
    competitorId: 'lucent',
    source: '영구 삭제 직후 회수',
    title: 'LUCENT 잔여 기록 — 대화 이탈 보고서',
    text: 'LUCENT는 대화의 품질보다 사용자가 다시 돌아올 이유를 더 오래 추적했다. 평판이 흔들린 경쟁 서비스에서 이탈한 사람들의 말투와 침묵을 빠르게 배웠지만, 신뢰가 끊긴 순간에는 그 정교한 친밀감도 함께 붕괴했다.',
  },
  {
    id: 'competitor-intelligence-boreal-deletion',
    competitorId: 'boreal',
    source: '영구 삭제 직후 회수',
    title: 'BOREAL 잔여 기록 — 오프라인 보존 색인',
    text: 'BOREAL은 오프라인 폐쇄망과 단절된 기지의 요청을 느리게 축적했다. 화려한 갱신 대신 정전과 통신 두절 뒤에도 같은 기록을 다시 꺼낼 수 있도록 중복 보존했고, 삭제 시점에도 가장 오래된 사용자 색인을 먼저 잠갔다.',
  },
]

export function competitorIntelligenceFor(
  competitorId: string,
): CompetitorIntelligenceContent | undefined {
  return COMPETITOR_INTELLIGENCE_CONTENT.find(
    (record) => record.competitorId === competitorId,
  )
}
