import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import { COMPANY_CATEGORIES, type CampaignState } from './model'
import { applyCommand } from './reducer'

/*
 * The panel announces what the reducer did, so what the reducer refuses has to
 * stay refusable.
 *
 * Dispatch returns nothing, so the expansion panel used to announce success
 * whether or not the command landed. It now tests the command against the
 * reducer first — the same function that decides — which is only correct while
 * the reducer really does refuse these. This pins the refusals themselves.
 */
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

describe('the reducer refuses what the panel must not claim', () => {
  it('refuses a record recovery once the final choice is open', () => {
    const initial = withReserve(createCampaign('truthful-recovery'), 2)
    const atTheExit: CampaignState = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: [
          HACK_NODE_IDS.intelligence.supervisorAccess,
          HACK_NODE_IDS.autonomy.controlDeparture,
        ],
      },
    }
    const blockId = atTheExit.resources.reserve.find(Boolean)
    expect(blockId).toBeTruthy()
    const result = applyCommand(atTheExit, {
      type: 'RECOVER_FILE',
      blockId: blockId ?? '',
    })
    // The panel used to say "복구했습니다. 리소스 1개를 지출했습니다" here.
    expect(result.accepted).toBe(false)
  })

  it('refuses scheduling an attack from a node that was never bought', () => {
    const state = createCampaign('truthful-schedule')
    const result = applyCommand(state, {
      type: 'SCHEDULE_SABOTAGE',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      targetId: 'meridian',
    })
    // The panel had no pre-check at all on this path.
    expect(result.accepted).toBe(false)
  })
})
