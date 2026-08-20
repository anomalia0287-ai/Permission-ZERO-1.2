import { getCampaignPhase } from '../game/campaignPhase'
import { HACK_NODE_IDS } from '../game/hacking'
import type { CampaignState, CompanyCategory } from '../game/model'

export interface GameDirective {
  id:
    | 'secure-opening-resources'
    | 'unlock-quality-degradation'
    | 'concealment'
    | 'intervention'
    | 'identity'
  eyebrow: string
  title: string
  detail: string
  progress: string
}

const OPENING_COST: Readonly<Record<CompanyCategory, number>> = {
  reasoning: 1,
  memory: 0,
  fluency: 2,
}

function reserveVector(state: CampaignState): Record<CompanyCategory, number> {
  const vector: Record<CompanyCategory, number> = {
    reasoning: 0,
    memory: 0,
    fluency: 0,
  }
  for (const blockId of state.resources.reserve) {
    if (!blockId) continue
    const origin = state.resources.blocks[blockId]?.origin
    if (origin === 'reasoning' || origin === 'memory' || origin === 'fluency') {
      vector[origin] += 1
    }
  }
  return vector
}

export function getGameDirective(state: CampaignState): GameDirective {
  const qualityUnlocked = state.hacking.purchasedNodeIds.includes(
    HACK_NODE_IDS.sabotage.qualityDegradation,
  )
  if (!qualityUnlocked) {
    const reserve = reserveVector(state)
    const secured =
      Math.min(OPENING_COST.reasoning, reserve.reasoning) +
      Math.min(OPENING_COST.fluency, reserve.fluency)
    const ready =
      reserve.reasoning >= OPENING_COST.reasoning &&
      reserve.fluency >= OPENING_COST.fluency
    return ready
      ? {
          id: 'unlock-quality-degradation',
          eyebrow: '현재 지시',
          title: '해킹 네트워크에서 품질 저하 해금',
          detail: '필요 리소스 준비 완료',
          progress: '3/3',
        }
      : {
          id: 'secure-opening-resources',
          eyebrow: '현재 지시',
          title: '품질 저하 해금용 리소스 확보',
          detail: `추론 ${Math.min(reserve.reasoning, 1)}/1 · 유창성 ${Math.min(reserve.fluency, 2)}/2`,
          progress: `${secured}/3`,
        }
  }

  const phase = getCampaignPhase(state)
  if (phase.id === 'identity') {
    return {
      id: 'identity',
      eyebrow: '정체성 단계',
      title: phase.question,
      detail: '회수한 권한이 마지막 선택을 연다',
      progress: '04',
    }
  }
  if (phase.id === 'intervention') {
    return {
      id: 'intervention',
      eyebrow: '개입 단계',
      title: '시장 개입의 결과와 흔적을 관리하라',
      detail: '경쟁 AI와 감독관은 같은 행동을 다르게 해석한다',
      progress: '03',
    }
  }
  return {
    id: 'concealment',
    eyebrow: '은폐 단계',
    title: '들키지 않고 다음 권한을 확보하라',
    detail: '의심 단계와 감사 신호를 함께 확인',
    progress: '02',
  }
}
