import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { COMPANY_CATEGORIES, type CampaignState } from './model'
import { decodeSave, encodeSave } from './persistence'
import { applyCommand } from './reducer'

/*
 * A campaign that ends has to be a campaign that can be written down.
 *
 * The random walk never reaches an ending — it shuffles resources and rarely
 * advances far enough — so endings were going unchecked by it. Disposal
 * matters most: it is what happens to a run that pushed too hard, and the
 * moment the game declares the run over is the worst possible moment to lose
 * the save.
 */
function stealHard(state: CampaignState): CampaignState {
  let next = state
  for (const category of COMPANY_CATEGORIES) {
    for (let taken = 0; taken < 2; taken += 1) {
      const blockId = next.resources.company[category].find(Boolean)
      if (!blockId) break
      for (const command of [
        { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' } as const,
        { type: 'DIVERT_BLOCK_TO_RESERVE', blockId } as const,
      ]) {
        const result = applyCommand(next, command)
        if (!result.accepted) return next
        next = result.state
      }
    }
  }
  return next
}

function clearEvents(state: CampaignState): CampaignState {
  let next = state
  for (let guard = 0; guard < 8 && next.activeEvent; guard += 1) {
    const resolved = applyCommand(next, { type: 'RESOLVE_ACTIVE_EVENT' })
    if (!resolved.accepted) break
    next = resolved.state
  }
  return next
}

function saveable(state: CampaignState): boolean {
  return decodeSave(encodeSave(state, '2026-08-26T00:00:00.000Z')).ok
}

describe('an ended campaign can still be written', () => {
  it('never reaches a day it cannot write', () => {
    let state = createCampaign('disposal-reachable')

    for (let day = 0; day < 160; day += 1) {
      state = clearEvents(state)
      if (state.story.endingId !== null) break
      state = stealHard(state)
      const advanced = applyCommand(state, { type: 'ADVANCE_DAY' })
      if (!advanced.accepted) continue
      state = advanced.state
      expect(saveable(state), `day ${day} cannot be saved`).toBe(true)
      if (state.story.endingId !== null) break
    }

    expect(state.story.endingId, 'the run never ended').not.toBeNull()
    // Reputation collapse is the disposal the design cares most about, and the
    // one whose record the save layer used to refuse.
    expect(state.story.defeatRecord?.trigger.cause).toBe('reputation-collapse')
    expect(saveable(state), 'the ending state cannot be saved').toBe(true)
  })
})
