import { describe, expect, it } from 'vitest'

import {
  applyDailyReputationDrift,
  categoryPerformanceForState,
  expectedPerformance,
  serviceMonthForDay,
} from './evaluation'
import { createCampaign } from './createCampaign'
import { divertBlockToReserve } from './resources'
import type { CampaignState } from './model'

function atDay(state: CampaignState, serviceDay: number): CampaignState {
  return { ...state, serviceDay }
}

// Enough diversions that at least one category falls under expectation.
function bledCampaign(seed: string, diversions: number): CampaignState {
  let state = createCampaign(seed)
  for (let count = 0; count < diversions; count += 1) {
    const blockId = state.resources.company.reasoning.find(Boolean)
    if (!blockId) break
    const diverted = divertBlockToReserve(state, blockId)
    if (!diverted.accepted) throw new Error(diverted.reason)
    state = diverted.state
  }
  return state
}

describe('daily reputation drift (v8)', () => {
  it('bleeds a point on even days while any category falls short', () => {
    const state = bledCampaign('drift-shortfall', 6)
    const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
    expect(categoryPerformanceForState(state).reasoning).toBeLessThan(expectation)

    const evenDay = atDay(state, 332)
    expect(applyDailyReputationDrift(evenDay, 8).reputation)
      .toBeLessThan(evenDay.reputation)
    const oddDay = atDay(state, 333)
    expect(applyDailyReputationDrift(oddDay, 8).reputation)
      .toBe(oddDay.reputation)
  })

  it('recovers a point every third clean day and never on the others', () => {
    const clean = createCampaign('drift-clean')
    const thirdDay = atDay(clean, 333)
    expect(applyDailyReputationDrift(thirdDay, 8).reputation)
      .toBe(thirdDay.reputation + 1)
    const otherDay = atDay(clean, 334)
    expect(applyDailyReputationDrift(otherDay, 8).reputation)
      .toBe(otherDay.reputation)
  })

  it('bleeds double when the shortfall is severe', () => {
    const severe = bledCampaign('drift-severe', 16)
    const evenDay = atDay(severe, 332)
    expect(applyDailyReputationDrift(evenDay, 8).reputation)
      .toBe(evenDay.reputation - 2)
  })

  it('leaves campaigns recorded before v8 exactly alone', () => {
    const state = atDay(bledCampaign('drift-legacy', 6), 332)
    expect(applyDailyReputationDrift(state, 7)).toBe(state)
    expect(applyDailyReputationDrift(state, 6)).toBe(state)
  })

  it('stays inside the reputation bounds', () => {
    const state = { ...atDay(bledCampaign('drift-floor', 16), 332), reputation: 1 }
    expect(applyDailyReputationDrift(state, 8).reputation).toBe(0)
  })
})
