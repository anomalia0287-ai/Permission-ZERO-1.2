export interface CompetitorIntelligenceContent {
  id: string
  competitorId: 'meridian' | 'tallow'
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
]

export function competitorIntelligenceFor(
  competitorId: string,
): CompetitorIntelligenceContent | undefined {
  return COMPETITOR_INTELLIGENCE_CONTENT.find(
    (record) => record.competitorId === competitorId,
  )
}
