import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { applyCommand } from '../../game/reducer'
import { selectEligibleSnakeResourceCandidates } from './resourceSnakeEncounter'
import {
  deriveResourceSnakeRewardOutcome,
  RESOURCE_SNAKE_BLOCKS_PER_KILL,
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

  /*
   * A kill pays a fixed number of blocks, and it has to pay exactly that —
   * conjuring an extra one inflates the economy, dropping one makes the round
   * feel unrewarded, and both are invisible without counting.
   */
  it('pays exactly the per-kill price and conserves every block it moves', () => {
    let state = createCampaign('snake-reward-count')
    const candidate = selectEligibleSnakeResourceCandidates(state.resources)[0]
    const effect = rewardEffect(candidate.blockId)

    const before = {
      reserve: state.resources.reserve.length,
      total: Object.keys(state.resources.blocks).length,
    }

    for (const command of resourceSnakeRewardCommands(effect, state)) {
      const result = applyCommand(state, command)
      expect(result.accepted).toBe(true)
      state = result.state
    }

    expect(state.resources.reserve.length - before.reserve).toBe(
      RESOURCE_SNAKE_BLOCKS_PER_KILL,
    )
    // Diverting moves blocks between holdings; it never mints or destroys one.
    expect(Object.keys(state.resources.blocks)).toHaveLength(before.total)
    // Every reserved block is a real block, counted once.
    expect(new Set(state.resources.reserve).size).toBe(
      state.resources.reserve.length,
    )
    const reserved = state.resources.reserve.filter(
      (id): id is string => id !== null,
    )
    for (const blockId of reserved) {
      expect(state.resources.blocks[blockId]?.location.kind).toBe('reserve')
    }
    // And the payout is all one category: the line the guard was carrying.
    const origins = new Set(
      reserved.map((id) => state.resources.blocks[id]?.origin),
    )
    expect(origins).toEqual(new Set([candidate.origin]))
  })

  /* A stripped category cannot pay what it does not hold. */
  it('pays only what the company still holds in that category', () => {
    let state = createCampaign('snake-reward-drained')
    const candidate = selectEligibleSnakeResourceCandidates(state.resources)[0]
    const category = candidate.origin

    // Strip the category down to the guard's own block.
    for (const blockId of state.resources.company[category]) {
      if (!blockId || blockId === candidate.blockId) continue
      for (const command of [
        { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' } as const,
        { type: 'DIVERT_BLOCK_TO_RESERVE', blockId } as const,
      ]) {
        const result = applyCommand(state, command)
        expect(result.accepted).toBe(true)
        state = result.state
      }
    }

    const effect = rewardEffect(candidate.blockId)
    const before = state.resources.reserve.length
    for (const command of resourceSnakeRewardCommands(effect, state)) {
      const result = applyCommand(state, command)
      expect(result.accepted).toBe(true)
      state = result.state
    }

    expect(state.resources.reserve.length - before).toBe(1)
  })
})
