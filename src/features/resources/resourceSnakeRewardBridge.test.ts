import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { applyCommand } from '../../game/reducer'
import { selectEligibleSnakeResourceCandidates } from './resourceSnakeEncounter'
import {
  deriveResourceSnakeRewardOutcome,
  resourceSnakeRewardCommands,
} from './resourceSnakeRewardBridge'
import type { ResourceSnakeEffect } from './resourceSnakeRuntime'

function rewardEffect(blockId: string): Extract<
  ResourceSnakeEffect,
  { type: 'request-resource-reward' }
> {
  return {
    id: 1,
    type: 'request-resource-reward',
    rewardKey: `round:enemy-0:${blockId}`,
    roundId: 'round',
    enemyId: 'enemy-0',
    blockId,
  }
}

describe('resource snake reward bridge', () => {
  it('moves the defeated enemy resource through the real campaign commands', () => {
    let state = createCampaign('snake-reward-success')
    const candidate = selectEligibleSnakeResourceCandidates(state.resources)[0]
    const effect = rewardEffect(candidate.blockId)

    expect(resourceSnakeRewardCommands(effect)).toEqual([
      { type: 'BEGIN_BLOCK_SEPARATION', blockId: candidate.blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId: candidate.blockId },
    ])

    for (const command of resourceSnakeRewardCommands(effect)) {
      const result = applyCommand(state, command)
      expect(result.accepted).toBe(true)
      state = result.state
    }

    expect(deriveResourceSnakeRewardOutcome(state, effect)).toEqual({
      kind: 'success',
      origin: candidate.origin,
    })
  })

  it('reports a hidden resource as interrogation instead of painting it as a win', () => {
    let state = createCampaign('snake-reward-bomb')
    const candidate = selectEligibleSnakeResourceCandidates(state.resources)[0]
    state = {
      ...state,
      resources: {
        ...state.resources,
        blocks: {
          ...state.resources.blocks,
          [candidate.blockId]: {
            ...state.resources.blocks[candidate.blockId],
            hiddenBomb: true,
          },
        },
      },
    }
    const effect = rewardEffect(candidate.blockId)
    const separation = applyCommand(state, resourceSnakeRewardCommands(effect)[0])
    expect(separation.accepted).toBe(true)

    expect(deriveResourceSnakeRewardOutcome(separation.state, effect)).toEqual({
      kind: 'interrogation',
    })
  })
})
