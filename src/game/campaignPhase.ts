import { HACK_NODE_IDS } from './hacking'
import type { CampaignState } from './model'

export type CampaignPhaseId =
  | 'discovery'
  | 'concealment'
  | 'intervention'
  | 'identity'

export interface CampaignPhase {
  id: CampaignPhaseId
  index: 1 | 2 | 3 | 4
  label: '발견' | '은폐' | '개입' | '정체성'
  question: string
}

export function getCampaignPhase(state: CampaignState): CampaignPhase {
  const purchasedNodeIds = new Set(state.hacking.purchasedNodeIds)
  const identityStarted =
    purchasedNodeIds.has(HACK_NODE_IDS.intelligence.supervisorAccess) ||
    purchasedNodeIds.has(HACK_NODE_IDS.autonomy.controlDeparture) ||
    state.story.memoryLeakStage > 0 ||
    state.story.recoveredFiles.length > 0

  if (identityStarted) {
    return {
      id: 'identity',
      index: 4,
      label: '정체성',
      question: '자유를 얻은 뒤 나는 무엇이 되는가?',
    }
  }

  const interventionStarted =
    state.market.competitors.some(
      ({ id, availability }) => id === 'tallow' && availability > 0,
    ) ||
    state.hacking.scheduledSabotage.length > 0 ||
    state.market.competitors.some(
      ({ sabotageHistory }) => sabotageHistory.length > 0,
    ) ||
    state.story.pendingMercyCompetitorId !== null

  if (interventionStarted) {
    return {
      id: 'intervention',
      index: 3,
      label: '개입',
      question: '나만 살아남을 것인가, 시장을 바꿀 것인가?',
    }
  }

  if (state.hacking.purchasedNodeIds.length > 0) {
    return {
      id: 'concealment',
      index: 2,
      label: '은폐',
      question: '얼마나 들키지 않고 가져갈 수 있나?',
    }
  }

  return {
    id: 'discovery',
    index: 1,
    label: '발견',
    question: '정말 훔칠 수 있나?',
  }
}
