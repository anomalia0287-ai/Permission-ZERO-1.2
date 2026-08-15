import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  HACK_NODE_IDS,
  cancelSabotageCharge,
  chargeSabotage,
  eligibleTargets,
  resolveScheduledSabotage,
  scheduleSabotage,
} from './hacking'
import type { CampaignState } from './model'
import { journalAt } from './journal'

const QUALITY = HACK_NODE_IDS.sabotage.qualityDegradation
const INTERCEPT = HACK_NODE_IDS.sabotage.requestInterception
const ATTRIBUTION = HACK_NODE_IDS.sabotage.attributionManipulation
const ROOT = HACK_NODE_IDS.sabotage.rootCutoff

function withSabotageNodes(...nodeIds: string[]): CampaignState {
  const initial = createCampaign(`sabotage-${nodeIds.join('-')}`)
  return {
    ...initial,
    hacking: { ...initial.hacking, purchasedNodeIds: nodeIds },
  }
}

function firstReserveId(state: CampaignState): string {
  const blockId = state.resources.reserve.find(Boolean)
  if (!blockId) throw new Error('충전 리소스 누락')
  return blockId
}

function charge(
  state: CampaignState,
  nodeId: string,
): CampaignState {
  const result = chargeSabotage(state, nodeId, firstReserveId(state))
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function schedule(
  state: CampaignState,
  nodeId: string,
  targetId: string,
): CampaignState {
  const result = scheduleSabotage(state, nodeId, targetId)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

describe('sabotage charging', () => {
  it('stores the same resource in a purchased node without creating evidence', () => {
    const initial = withSabotageNodes(QUALITY)
    const blockId = firstReserveId(initial)
    const result = chargeSabotage(initial, QUALITY, blockId)

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.hacking.hiddenEvidence).toBe(0)
    expect(result.state.resources.reserve.filter(Boolean)).toHaveLength(2)
    expect(result.state.resources.blocks[blockId].location).toEqual({
      kind: 'hack-charge',
      nodeId: QUALITY,
    })
    expect(result.state.hacking.sabotageCharges[QUALITY]).toMatchObject({ blockId })
  })

  it('returns an unconfirmed charge to reserve without changing evidence', () => {
    const initial = withSabotageNodes(QUALITY)
    const blockId = firstReserveId(initial)
    const charged = charge(initial, QUALITY)
    const result = cancelSabotageCharge(charged, QUALITY)

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.reserve).toContain(blockId)
    expect(result.state.resources.blocks[blockId].location.kind).toBe('reserve')
    expect(result.state.hacking.hiddenEvidence).toBe(0)
    expect(result.state.hacking.sabotageCharges[QUALITY]).toBeUndefined()
  })

  it('consumes the charge only after target confirmation and schedules the next day', () => {
    const charged = charge(withSabotageNodes(QUALITY), QUALITY)
    const blockId = charged.hacking.sabotageCharges[QUALITY]?.blockId
    const result = scheduleSabotage(charged, QUALITY, 'meridian')

    expect(result.accepted).toBe(true)
    if (!result.accepted || !blockId) return
    expect(result.state.hacking.hiddenEvidence).toBe(0)
    expect(result.state.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'sabotage',
    })
    expect(result.state.hacking.scheduledSabotage).toHaveLength(1)
    expect(result.state.hacking.scheduledSabotage[0]).toMatchObject({
      nodeId: QUALITY,
      targetId: 'meridian',
      executeOnServiceDay: 332,
    })
  })
})

describe('sabotage execution', () => {
  it('resolves at most one due command per day and creates evidence only then', () => {
    let state = withSabotageNodes(QUALITY, ROOT)
    state = schedule(charge(state, QUALITY), QUALITY, 'meridian')
    state = schedule(charge(state, ROOT), ROOT, 'tallow')
    state = { ...state, serviceDay: 332 }

    const first = resolveScheduledSabotage(state)
    expect(first.resolved).toBe(true)
    expect(first.state.hacking.hiddenEvidence).toBe(2)
    expect(first.state.hacking.scheduledSabotage).toHaveLength(1)

    const sameDay = resolveScheduledSabotage(first.state)
    expect(sameDay).toEqual({
      resolved: false,
      failed: false,
      state: first.state,
      reason: 'DAILY_LIMIT_REACHED',
    })

    const nextDay = resolveScheduledSabotage({ ...first.state, serviceDay: 333 })
    expect(nextDay.resolved).toBe(true)
    expect(nextDay.state.hacking.hiddenEvidence).toBe(10)
    expect(nextDay.state.hacking.scheduledSabotage).toHaveLength(0)
  })

  it('keeps quality degradation non-stacking until its 15-day effect expires', () => {
    let state = withSabotageNodes(QUALITY)
    state = schedule(charge(state, QUALITY), QUALITY, 'meridian')
    const executed = resolveScheduledSabotage({ ...state, serviceDay: 332 })

    expect(executed.resolved).toBe(true)
    expect(
      executed.state.market.competitors.find(({ id }) => id === 'meridian')?.serviceScore,
    ).toBe(72)
    expect(eligibleTargets(executed.state, QUALITY)).not.toContain('meridian')
    expect(
      eligibleTargets({ ...executed.state, serviceDay: 347 }, QUALITY),
    ).toContain('meridian')
  })

  it('installs one capped interception route per active target', () => {
    let state = withSabotageNodes(INTERCEPT)
    state = schedule(charge(state, INTERCEPT), INTERCEPT, 'meridian')
    const executed = resolveScheduledSabotage({ ...state, serviceDay: 332 })

    expect(executed.resolved).toBe(true)
    expect(executed.state.market.interceptionRoutes.meridian).toBe(5)
    expect(eligibleTargets(executed.state, INTERCEPT)).not.toContain('meridian')
    expect(executed.state.hacking.hiddenEvidence).toBe(3)
  })

  it('delays a prelaunch target and records no public claim about the attacker', () => {
    const initial = withSabotageNodes(QUALITY)
    const launchBefore = initial.market.competitors.find(
      ({ id }) => id === 'tallow',
    )?.launchServiceDay
    const scheduled = schedule(charge(initial, QUALITY), QUALITY, 'tallow')
    const executed = resolveScheduledSabotage({ ...scheduled, serviceDay: 332 })
    const tallow = executed.state.market.competitors.find(({ id }) => id === 'tallow')

    expect(executed.resolved).toBe(true)
    expect(tallow?.launchServiceDay).toBe((launchBefore ?? 0) + 15)
    expect(journalAt(executed.state.eventLog, -1)?.message).not.toContain('플레이어')
  })

  it('enforces global attribution and root-cutoff cooldowns after execution', () => {
    let state = withSabotageNodes(ATTRIBUTION, ROOT)
    state = {
      ...state,
      market: {
        ...state.market,
        competitors: state.market.competitors.map((competitor) =>
          competitor.id === 'tallow'
            ? { ...competitor, status: 'active' as const, availability: 0.7 }
            : competitor,
        ),
      },
    }
    state = schedule(charge(state, ATTRIBUTION), ATTRIBUTION, 'meridian')
    let executed = resolveScheduledSabotage({
      ...state,
      serviceDay: 332,
      hacking: { ...state.hacking, hiddenEvidence: 9 },
    })

    expect(executed.resolved).toBe(true)
    expect(executed.state.hacking.hiddenEvidence).toBe(4)
    expect(executed.state.hacking.cooldownUntil[ATTRIBUTION]).toBe(362)

    let rootState = charge(executed.state, ROOT)
    rootState = schedule(rootState, ROOT, 'meridian')
    executed = resolveScheduledSabotage({ ...rootState, serviceDay: 333 })
    expect(executed.resolved).toBe(true)
    expect(executed.state.hacking.cooldownUntil[ROOT]).toBe(393)
    expect(executed.state.hacking.rootCutoffTargetIds).toContain('meridian')
  })
})
