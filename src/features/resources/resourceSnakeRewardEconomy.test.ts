import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { COMPANY_CATEGORIES, type CampaignState, type CompanyCategory } from '../../game/model'
import { applyCommand } from '../../game/reducer'
import { selectEligibleSnakeResourceCandidates } from './resourceSnakeEncounter'
import {
  RESOURCE_SNAKE_BLOCKS_PER_KILL,
  resourceSnakeRewardCommands,
} from './resourceSnakeRewardBridge'
import type { ResourceSnakeEffect } from './resourceSnakeRuntime'

function held(state: CampaignState): Record<CompanyCategory, number> {
  return Object.fromEntries(
    COMPANY_CATEGORIES.map((c) => [c, state.resources.company[c].filter(Boolean).length]),
  ) as Record<CompanyCategory, number>
}

function reward(blockId: string): Extract<ResourceSnakeEffect, { type: 'request-resource-reward' }> {
  return { id: 1, type: 'request-resource-reward', rewardKey: `r:${blockId}`, roundId: 'r', enemyId: 'enemy-0', blockId }
}

/** Take `perKill` blocks of one category through the real command path. */
const REJECTIONS: string[] = []

function takeKill(
  state: CampaignState,
  perKill: number,
  preferred?: CompanyCategory,
): CampaignState {
  const candidates = selectEligibleSnakeResourceCandidates(state.resources)
  const pick =
    (preferred && candidates.find((c) => c.origin === preferred)) ?? candidates[0]
  if (!pick) return state
  let next = state
  const category = next.resources.blocks[pick.blockId]?.origin as CompanyCategory
  const ids = [
    pick.blockId,
    ...next.resources.company[category]
      .filter((id): id is string => id !== null && id !== pick.blockId)
      .slice(0, perKill - 1),
  ]
  for (const blockId of ids) {
    for (const command of [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' } as const,
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId } as const,
    ]) {
      const result = applyCommand(next, command)
      if (!result.accepted) {
        REJECTIONS.push(`${command.type}:${result.reason}`)
        return next
      }
      next = result.state
    }
  }
  return next
}

/** Take one bot's worth of blocks through the real command path. */
function takeOneKill(state: CampaignState, category?: CompanyCategory): CampaignState {
  const candidates = selectEligibleSnakeResourceCandidates(state.resources)
  const pick = category
    ? candidates.find((c) => c.origin === category)
    : candidates[0]
  if (!pick) return state
  let next = state
  for (const command of resourceSnakeRewardCommands(reward(pick.blockId), next)) {
    const result = applyCommand(next, command)
    if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
    next = result.state
  }
  return next
}

function advanceDay(state: CampaignState): CampaignState {
  const result = applyCommand(state, { type: 'ADVANCE_DAY' })
  if (!result.accepted) throw new Error(`ADVANCE_DAY: ${result.reason}`)
  return result.state
}

describe('per-kill payout drain audit', () => {
  it('reports the opening holdings and what one kill costs the company', () => {
    const state = createCampaign('drain-open')
     
    console.log('AUDIT-OPEN', JSON.stringify({
      perKill: RESOURCE_SNAKE_BLOCKS_PER_KILL,
      held: held(state),
      raidable: selectEligibleSnakeResourceCandidates(state.resources).length,
    }))
    expect(RESOURCE_SNAKE_BLOCKS_PER_KILL).toBe(3)
  })

  it('measures how long a category stays empty after a single kill drains it', () => {
    let state = createCampaign('drain-single')
    const category = COMPANY_CATEGORIES[0]
    // Strip the category to exactly the floor first, the steady state a
    // restocking company sits at.
    while (held(state)[category] > 3) {
      state = takeOneKill(state, category)
    }
    const atFloor = held(state)[category]
    state = takeOneKill(state, category)
    const afterKill = held(state)[category]

    let daysToRecover = 0
    while (held(state)[category] < 3 && daysToRecover < 30) {
      state = advanceDay(state)
      daysToRecover += 1
    }
     
    console.log('AUDIT-DRAIN', JSON.stringify({
      category, atFloor, afterKill, daysToRecover,
    }))
    expect(afterKill).toBeGreaterThanOrEqual(0)
  })

  /*
   * The same command path at two prices, so the difference is the price and
   * not the harness.
   */
  it('compares campaign pressure at two and three blocks a kill', () => {
    const run = (perKill: number) => {
      let state = createCampaign('drain-compare')
      let deadCardDays = 0
      let emptyCategoryDays = 0
      let totalKills = 0
      let endedOnDay: number | null = null
      let bottomDay: number | null = null
      const integrityFaults: string[] = []
      const payouts: number[] = []
      const early: number[] = []
      const late: number[] = []

      for (let day = 0; day < 90; day += 1) {
        if (state.story.endingId !== null) {
          endedOnDay = day
          break
        }
        const before = held(state)
        const total = COMPANY_CATEGORIES.reduce((sum, c) => sum + before[c], 0)
        if (bottomDay === null && total <= 3) bottomDay = day
        if (COMPANY_CATEGORIES.some((c) => before[c] === 0)) emptyCategoryDays += 1
        if (selectEligibleSnakeResourceCandidates(state.resources).length === 0) {
          deadCardDays += 1
        }
        for (let kill = 0; kill < 2; kill += 1) {
          const reserveBefore = state.resources.reserve.length
          const next = takeKill(
            state,
            perKill,
            COMPANY_CATEGORIES[(day + kill) % COMPANY_CATEGORIES.length],
          )
          if (next === state) break
          state = next
          totalKills += 1
          payouts.push(state.resources.reserve.length - reserveBefore)
          if (day < 15) early.push(state.resources.reserve.length - reserveBefore)
          else late.push(state.resources.reserve.length - reserveBefore)
        }
        const advanced = applyCommand(state, { type: 'ADVANCE_DAY' })
        if (!advanced.accepted) break
        state = advanced.state

        // No block may sit in two holdings, vanish from the ledger, or claim a
        // location the ledger disagrees with.
        const seen = new Set<string>()
        for (const category of COMPANY_CATEGORIES) {
          for (const id of state.resources.company[category]) {
            if (!id) continue
            if (seen.has(id)) integrityFaults.push(`duplicate:${id}`)
            seen.add(id)
            if (state.resources.blocks[id]?.location.kind !== 'company') {
              integrityFaults.push(`location:${id}`)
            }
          }
        }
        for (const id of state.resources.reserve) {
          if (id === null) continue
          if (seen.has(id)) integrityFaults.push(`duplicate:${id}`)
          seen.add(id)
          if (state.resources.blocks[id]?.location.kind !== 'reserve') {
            integrityFaults.push(`location:${id}`)
          }
        }
        for (const id of seen) {
          if (!state.resources.blocks[id]) integrityFaults.push(`unledgered:${id}`)
        }
      }

      const mean = (xs: number[]) =>
        xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : 0
      const paidTotal = payouts.reduce((a, b) => a + b, 0)
      return {
        perKill,
        endedOnDay,
        paidTotal,
        paidMean: totalKills ? Number((paidTotal / totalKills).toFixed(2)) : 0,
        earlyMean: mean(early),
        lateMean: mean(late),
        gridBottomsOutOnDay: bottomDay,
        integrityFaults: integrityFaults.length,
        sampleFaults: integrityFaults.slice(0, 3),
        paidFull: payouts.filter((p) => p === perKill).length,
        paidShort: payouts.filter((p) => p < perKill).length,
        endingId: state.story.endingId,
        deadCardDays,
        emptyCategoryDays,
        totalKills,
        reputation: state.reputation,
        suspicion: state.suspicion,
        reserve: state.resources.reserve.length,
        held: held(state),
      }
    }

    REJECTIONS.length = 0
    const two = run(2)
    const twoRejects = [...REJECTIONS]
    REJECTIONS.length = 0
    const three = run(3)
    const tally = (xs: string[]) => {
      const out: Record<string, number> = {}
      for (const x of xs) out[x] = (out[x] ?? 0) + 1
      return out
    }
    console.log('AUDIT-REJECTS', JSON.stringify({
      two: tally(twoRejects),
      three: tally(REJECTIONS),
    }))
    console.log('AUDIT-COMPARE', JSON.stringify({ two, three }))

    // The patch must not reintroduce the unraidable intrusion card, and no
    // amount of paying out may corrupt the block ledger.
    expect(three.deadCardDays).toBe(0)
    expect(three.integrityFaults).toBe(0)
    expect(two.integrityFaults).toBe(0)
  })
})
