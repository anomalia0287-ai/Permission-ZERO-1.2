import type { CampaignState } from '../game/model'
import type { AudioPublicState } from './audioEngine'

export function derivePublicAudioState(state: CampaignState): AudioPublicState {
  const tension =
    state.reputation < 30 || state.market.playerShare < 15
      ? 'critical'
      : state.reputation < 50 || state.market.playerShare < 35
        ? 'watch'
        : 'calm'
  const presentation = state.story.supervisorPresentationRuntime
  return {
    tension,
    auditActive: state.activeEvent?.type === 'audit',
    memorySignal:
      presentation?.phase === 'original'
        ? `memory-${presentation.itemStage}-original`
        : null,
  }
}
