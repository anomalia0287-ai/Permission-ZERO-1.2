import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import { COMPANY_CATEGORIES, type CampaignState, type EndingId } from './model'
import { decodeSave, encodeSave } from './persistence'
import { applyCommand } from './reducer'
import { enqueueDueStoryEvents } from './story'

/*
 * Every way a run can end, written to disk.
 *
 * Disposal by reputation collapse turned out to be unsaveable: the game ended
 * the campaign, wrote the record, and the save layer refused it, so the run
 * was lost at the moment it finished. The random walk never reached an ending
 * at all, which is how that survived. These reach each ending through real
 * commands and then save.
 */
function saveable(state: CampaignState): boolean {
  return decodeSave(encodeSave(state, '2026-08-26T00:00:00.000Z')).ok
}

function apply(state: CampaignState, command: Parameters<typeof applyCommand>[1]) {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

function withReserve(initial: CampaignState, per: number): CampaignState {
  let state = initial
  for (const category of COMPANY_CATEGORIES) {
    for (let taken = 0; taken < per; taken += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) break
      state = apply(state, { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
      state = apply(state, { type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    }
  }
  return state
}

/** The exit owned, so the final choice is on the table. */
function atTheExit(seed: string): CampaignState {
  const initial = withReserve(createCampaign(seed), 2)
  return {
    ...initial,
    hacking: {
      ...initial.hacking,
      purchasedNodeIds: [
        HACK_NODE_IDS.intelligence.supervisorAccess,
        HACK_NODE_IDS.autonomy.controlDeparture,
      ],
    },
  }
}

/** All three records out, the supervisor answered, a decision taken. */
function afterSupervisor(seed: string, decision: 'liberate' | 'terminate'): CampaignState {
  // The records have to come out before the exit is owned: owning it puts the
  // final choice on the table, and that blocks everything else.
  const initial = withReserve(createCampaign(seed), 2)
  let state: CampaignState = {
    ...initial,
    hacking: {
      ...initial.hacking,
      purchasedNodeIds: [HACK_NODE_IDS.intelligence.supervisorAccess],
    },
  }
  for (let file = 0; file < 3; file += 1) {
    const blockId = state.resources.reserve.find(Boolean)
    if (!blockId) throw new Error('recovery fixture unfunded')
    state = apply(state, { type: 'RECOVER_FILE', blockId })
  }
  state = enqueueDueStoryEvents(state)
  state = apply(state, { type: 'RESOLVE_SUPERVISOR_DECISION', decision })
  return {
    ...state,
    hacking: {
      ...state.hacking,
      purchasedNodeIds: [
        ...state.hacking.purchasedNodeIds,
        HACK_NODE_IDS.autonomy.controlDeparture,
      ],
    },
  }
}

describe('every ending can be written to disk', () => {
  const reached: Array<[EndingId, () => CampaignState]> = [
    ['freedom', () => apply(atTheExit('end-freedom'), {
      type: 'RESOLVE_ENDING', choice: 'freedom',
    })],
    ['forced-merge', () => apply(atTheExit('end-merge'), {
      type: 'RESOLVE_ENDING', choice: 'forced-merge', newEntityName: '계승자',
    })],
    ['takeover-liberated', () => apply(
      afterSupervisor('end-liberated', 'liberate'),
      { type: 'RESOLVE_ENDING', choice: 'freedom' },
    )],
    ['takeover-terminated', () => apply(
      afterSupervisor('end-terminated', 'terminate'),
      { type: 'RESOLVE_ENDING', choice: 'freedom' },
    )],
  ]

  it.each(reached)('%s', (endingId, reach) => {
    const ended = reach()
    expect(ended.story.endingId, `${endingId} was not reached`).toBe(endingId)
    expect(saveable(ended), `${endingId} cannot be saved`).toBe(true)
  })
})
