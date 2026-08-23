import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  HACK_NODES,
  selectExpansionCostResources,
} from './hacking'
import type { CampaignState, CompanyCategory } from './model'
import { divertBlockToReserve } from './resources'

function reserveInOrder(
  initial: CampaignState,
  categories: readonly CompanyCategory[],
): CampaignState {
  let state = initial
  for (const category of categories) {
    const blockId = state.resources.company[category]
      .find((candidate): candidate is string => candidate !== null)
    if (!blockId) throw new Error(`missing ${category}`)
    const result = divertBlockToReserve(state, blockId)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

describe('one-click expansion resource selection', () => {
  it('selects the oldest exact colored vector in reserve order', () => {
    const node = HACK_NODES.find(({ id }) => id === 'autonomy.compressed-representation')
    if (!node) throw new Error('stage 3 missing')
    const state = reserveInOrder(createCampaign('auto-spend-order'), [
      'fluency', 'reasoning', 'memory', 'reasoning', 'fluency',
    ])

    const selected = selectExpansionCostResources(state, node)
    expect(selected).toEqual([
      state.resources.reserve[1],
      state.resources.reserve[0],
    ])
  })

  it('returns null when one required color is missing and excludes synthetic origins', () => {
    const node = HACK_NODES.find(({ id }) => id === 'autonomy.compressed-representation')
    if (!node) throw new Error('stage 3 missing')
    const state = reserveInOrder(createCampaign('auto-spend-missing'), ['reasoning'])
    state.resources.blocks.synthetic = {
      id: 'synthetic',
      origin: 'self-compute',
      location: { kind: 'reserve' },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
    state.resources.reserve.push('synthetic')

    expect(selectExpansionCostResources(state, node)).toBeNull()
  })
})
