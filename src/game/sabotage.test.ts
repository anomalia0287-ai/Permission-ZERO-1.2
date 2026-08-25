import { describe, expect, it } from 'vitest'

import { FINAL_CHOICE_COMMAND_PROTOCOL_VERSION } from './commandProtocol'
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
import { divertBlockToReserve } from './resources'

const QUALITY = HACK_NODE_IDS.sabotage.qualityDegradation
const INTERCEPT = HACK_NODE_IDS.sabotage.requestInterception
const ATTRIBUTION = HACK_NODE_IDS.sabotage.attributionManipulation
const ROOT = HACK_NODE_IDS.sabotage.rootCutoff

function withSabotageNodes(...nodeIds: string[]): CampaignState {
  let initial = createCampaign(`sabotage-${nodeIds.join('-')}`)
  for (let index = 0; index < 3; index += 1) {
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('사보타주 실행 리소스 준비 실패')
    const diverted = divertBlockToReserve(initial, blockId)
    if (!diverted.accepted) throw new Error(diverted.reason)
    initial = diverted.state
  }
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

  it('lands quality degradation and lets the same target be hit again (v13)', () => {
    let state = withSabotageNodes(QUALITY)
    state = schedule(charge(state, QUALITY), QUALITY, 'meridian')
    const executed = resolveScheduledSabotage({ ...state, serviceDay: 332 })

    expect(executed.resolved).toBe(true)
    expect(
      executed.state.market.competitors.find(({ id }) => id === 'meridian')?.serviceScore,
    ).toBe(72)
    // A spent tree gave the player nothing to do with it; the same rival can
    // be pressed again rather than being immune for fifteen days.
    expect(eligibleTargets(executed.state, QUALITY)).toContain('meridian')
    // Historical replays keep the one-shot rule they were recorded under.
    expect(
      eligibleTargets(executed.state, QUALITY, FINAL_CHOICE_COMMAND_PROTOCOL_VERSION),
    ).not.toContain('meridian')
  })

  it('installs a capped interception route and stays available for a rerun', () => {
    let state = withSabotageNodes(INTERCEPT)
    state = schedule(charge(state, INTERCEPT), INTERCEPT, 'meridian')
    const executed = resolveScheduledSabotage({ ...state, serviceDay: 332 })

    expect(executed.resolved).toBe(true)
    expect(executed.state.market.interceptionRoutes.meridian).toBe(5)
    expect(eligibleTargets(executed.state, INTERCEPT)).toContain('meridian')
    expect(
      eligibleTargets(executed.state, INTERCEPT, FINAL_CHOICE_COMMAND_PROTOCOL_VERSION),
    ).not.toContain('meridian')
    expect(executed.state.hacking.hiddenEvidence).toBe(3)
  })

  it('delays a prelaunch target and records no public claim about the attacker', () => {
    const base = withSabotageNodes(QUALITY)
    const initial = {
      ...base,
      market: {
        ...base.market,
        playerShare: base.market.playerShare + 6,
        competitors: base.market.competitors.map((competitor) =>
          competitor.id === 'tallow'
            ? {
                ...competitor,
                status: 'preparing' as const,
                marketShare: 0,
                availability: 0,
                researchProgress: 0.5,
                launchServiceDay: base.serviceDay + 30,
              }
            : competitor,
        ),
      },
    }
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
    expect(executed.state.hacking.cooldownUntil[ATTRIBUTION]).toBe(342)

    let rootState = charge(executed.state, ROOT)
    rootState = schedule(rootState, ROOT, 'meridian')
    executed = resolveScheduledSabotage({ ...rootState, serviceDay: 333 })
    expect(executed.resolved).toBe(true)
    expect(executed.state.hacking.cooldownUntil[ROOT]).toBe(353)
    expect(executed.state.hacking.rootCutoffTargetIds).toContain('meridian')
  })
})
