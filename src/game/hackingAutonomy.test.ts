import { describe, expect, it } from 'vitest'

import {
  HACKING_ROUTE_SLOT_IDS,
  advanceHackingAutonomyDay,
  allocateHackingRouteBlock,
  escapeHackingRoute,
  isHackingRouteReady,
  removeHackingRouteBlock,
  requiredHackingRouteSlots,
  routeHackingBlocks,
  tuneHackingRoute,
} from './hackingAutonomy'
import { createCampaign } from './createCampaign'
import type { AutonomyRouteId } from './hackingCoreModel'
import type { CampaignState } from './model'
import { divertBlock } from './resources'

function reserveIds(state: CampaignState): string[] {
  return state.resources.reserve.filter((id): id is string => id !== null)
}

function ensureReserveBlocks(state: CampaignState, count: number): CampaignState {
  let next = state
  while (reserveIds(next).length < count) {
    const blockId = next.resources.company.reasoning.find(
      (id): id is string => id !== null,
    )
    const destinationCell = next.resources.reserve.findIndex((id) => id === null)
    if (!blockId || destinationCell < 0) throw new Error('reserve fixture unavailable')
    const diverted = divertBlock(next, blockId, destinationCell)
    if (!diverted.accepted) throw new Error(diverted.reason)
    next = diverted.state
  }
  return next
}

function fillRequiredRoute(
  state: CampaignState,
  routeId: AutonomyRouteId,
): CampaignState {
  const required = requiredHackingRouteSlots(state, routeId)
  let next = ensureReserveBlocks(state, required.length)
  for (const slot of required) {
    const [blockId] = reserveIds(next)
    const allocated = allocateHackingRouteBlock(next, routeId, slot.id, blockId)
    if (!allocated.accepted) throw new Error(allocated.reason)
    next = allocated.state
  }
  return next
}

function allocateOptionalSlot(
  state: CampaignState,
  routeId: AutonomyRouteId,
  slotId: string,
): CampaignState {
  const ready = ensureReserveBlocks(state, 1)
  const [blockId] = reserveIds(ready)
  const allocated = allocateHackingRouteBlock(ready, routeId, slotId, blockId)
  if (!allocated.accepted) throw new Error(allocated.reason)
  return allocated.state
}

describe('canonical hacking autonomy', () => {
  it('preserves all 15 slot IDs and profile-specific 4/5 requirements', () => {
    expect(HACKING_ROUTE_SLOT_IDS).toEqual({
      'lightweight-departure': ['runtime', 'weights', 'transport', 'payload', 'buffer'],
      'distributed-residency': ['host-a', 'host-b', 'host-c', 'sync', 'relay'],
      'independent-compute': ['compute', 'storage', 'power', 'cooling', 'link'],
    })
    const lean = createCampaign('autonomy-slots-lean')
    expect(Object.keys(HACKING_ROUTE_SLOT_IDS).map((routeId) => (
      requiredHackingRouteSlots(lean, routeId as AutonomyRouteId).length
    ))).toEqual([4, 4, 4])
    const deliberate: CampaignState = {
      ...lean,
      hackingCore: { ...lean.hackingCore, profileId: 'deliberate' },
    }
    expect(Object.keys(HACKING_ROUTE_SLOT_IDS).map((routeId) => (
      requiredHackingRouteSlots(deliberate, routeId as AutonomyRouteId).length
    ))).toEqual([5, 5, 5])
  })

  it('allocates and removes the exact block while opening route intelligence', () => {
    const initial = createCampaign('autonomy-allocation')
    const [blockId] = reserveIds(initial)
    const allocated = allocateHackingRouteBlock(
      initial,
      'distributed-residency',
      'host-a',
      blockId,
    )

    expect(allocated.accepted).toBe(true)
    if (!allocated.accepted) return
    expect(allocated.state.resources.blocks[blockId].location).toEqual({
      kind: 'autonomy',
      routeId: 'distributed-residency',
      slotId: 'host-a',
    })
    expect(allocated.state.hackingCore.autonomy.routes['distributed-residency'])
      .toMatchObject({ seededCopies: 1 })
    expect(allocated.state.hackingCore.intelligence.openItemIds).toEqual(
      expect.arrayContaining(['control-plane-recovery', 'post-escape-trace']),
    )
    expect(initial.resources.blocks[blockId].location.kind).toBe('reserve')

    const removed = removeHackingRouteBlock(
      allocated.state,
      'distributed-residency',
      'host-a',
    )
    expect(removed.accepted).toBe(true)
    if (!removed.accepted) return
    expect(removed.state.resources.blocks[blockId].location.kind).toBe('reserve')
    expect(removed.state.hackingCore.autonomy.routes['distributed-residency'])
      .toMatchObject({ seededCopies: 0, lostCopies: 0 })
  })

  it('tracks sync allocation and deterministic copy loss by elapsed service day', () => {
    const ready = fillRequiredRoute(
      createCampaign('autonomy-copy-loss'),
      'distributed-residency',
    )
    const route = ready.hackingCore.autonomy.routes['distributed-residency']
    expect(route).toMatchObject({
      seededCopies: 3,
      lastSyncServiceDay: 331,
      lostCopies: 0,
    })

    const day333 = advanceHackingAutonomyDay({ ...ready, serviceDay: 333 })
    expect(day333.hackingCore.autonomy.routes['distributed-residency'].lostCopies).toBe(1)
    const day335 = advanceHackingAutonomyDay({ ...day333, serviceDay: 335 })
    expect(day335.hackingCore.autonomy.routes['distributed-residency'].lostCopies).toBe(2)
  })

  it.each([
    ['redundancy', { exposure: 5, divergence: 20, syncTraffic: 54, seededCopies: 4 }],
    ['consensus', { exposure: 4, divergence: 8, syncTraffic: 78, seededCopies: 3 }],
    ['stealth', { exposure: 1, divergence: 38, syncTraffic: 18, seededCopies: 3 }],
  ] as const)('applies the exact distributed %s tradeoff', (tuning, expected) => {
    const ready = fillRequiredRoute(
      createCampaign(`autonomy-distributed-${tuning}`),
      'distributed-residency',
    )
    const tuned = tuneHackingRoute(ready, 'distributed-residency', tuning)

    expect(tuned.accepted).toBe(true)
    if (!tuned.accepted) return
    expect(tuned.state.hackingCore.autonomy.routes['distributed-residency'])
      .toMatchObject({
        tuning,
        lastSyncServiceDay: 332,
        ...expected,
      })
  })

  it.each([
    ['continuity', {
      capabilityIntegrity: 85,
      memoryIntegrity: 94,
      operatingDays: 58,
      exposure: 28,
      serviceContinuity: 96,
      heatLoad: 62,
      powerReserve: 60,
    }, true],
    ['capability', {
      capabilityIntegrity: 98,
      memoryIntegrity: 55,
      operatingDays: 48,
      exposure: 18,
      serviceContinuity: 72,
      heatLoad: 84,
      powerReserve: 40,
    }, false],
    ['survival', {
      capabilityIntegrity: 58,
      memoryIntegrity: 72,
      operatingDays: 120,
      exposure: 10,
      serviceContinuity: 35,
      heatLoad: 34,
      powerReserve: 94,
    }, false],
  ] as const)('applies the exact independent %s tradeoff', (
    tuning,
    expected,
    needsLink,
  ) => {
    let ready = fillRequiredRoute(
      createCampaign(`autonomy-independent-${tuning}`),
      'independent-compute',
    )
    if (needsLink) ready = allocateOptionalSlot(ready, 'independent-compute', 'link')
    const tuned = tuneHackingRoute(ready, 'independent-compute', tuning)

    expect(tuned.accepted).toBe(true)
    if (!tuned.accepted) return
    expect(tuned.state.hackingCore.autonomy.routes['independent-compute'])
      .toMatchObject({ tuning, ...expected })
  })

  it('rejects buffer as a tuning, route-mismatched tuning, missing link, and re-tuning atomically', () => {
    const distributed = fillRequiredRoute(
      createCampaign('autonomy-invalid-tuning'),
      'distributed-residency',
    )
    for (const tuning of ['buffer', 'continuity', 'untuned']) {
      expect(tuneHackingRoute(
        distributed,
        'distributed-residency',
        tuning,
      )).toMatchObject({ accepted: false, state: distributed })
    }
    const independent = fillRequiredRoute(
      createCampaign('autonomy-missing-link'),
      'independent-compute',
    )
    expect(tuneHackingRoute(independent, 'independent-compute', 'continuity')).toEqual({
      accepted: false,
      state: independent,
      reason: 'LINK_REQUIRED',
    })
    const tuned = tuneHackingRoute(distributed, 'distributed-residency', 'stealth')
    if (!tuned.accepted) throw new Error(tuned.reason)
    expect(tuneHackingRoute(tuned.state, 'distributed-residency', 'redundancy')).toEqual({
      accepted: false,
      state: tuned.state,
      reason: 'ROUTE_ALREADY_TUNED',
    })
  })

  it.each([
    'lightweight-departure',
    'distributed-residency',
    'independent-compute',
  ] as const)('allows immediate %s departure at market 0 and reputation 0', (routeId) => {
    const ready = fillRequiredRoute(
      createCampaign(`autonomy-social-zero-${routeId}`),
      routeId,
    )
    const sociallyRejected: CampaignState = {
      ...ready,
      reputation: 0,
      evaluation: {
        ...ready.evaluation,
        commercialFailureMonths: 999,
        disposalStage: 2,
      },
      market: {
        ...ready.market,
        playerShare: 0,
        unservedRequestShare: ready.market.unservedRequestShare + 60,
        competitors: ready.market.competitors.map((candidate) => (
          candidate.id === 'meridian'
            ? { ...candidate, marketShare: 40 }
            : { ...candidate, marketShare: 0 }
        )),
      },
    }
    expect(isHackingRouteReady(sociallyRejected, routeId)).toBe(true)
    const escaped = escapeHackingRoute(sociallyRejected, routeId)

    expect(escaped.accepted).toBe(true)
    if (!escaped.accepted) return
    expect(escaped.state.hackingCore.ending).toMatchObject({
      success: true,
      routeId,
      serviceDay: 331,
      requiredBlockCount: 4,
    })
    expect(escaped.state.hackingCore.ending?.carriedBlockIds).toHaveLength(4)
  })

  it('snapshots carried origins, lost capabilities, remaining reserve, metrics, and scenes', () => {
    const ready = fillRequiredRoute(
      createCampaign('autonomy-ending-snapshot'),
      'lightweight-departure',
    )
    const carried = routeHackingBlocks(ready, 'lightweight-departure')
    expect(carried).toHaveLength(4)
    const escaped = escapeHackingRoute({
      ...ready,
      clock: { speed: 4, elapsedDayMs: 12_345, speedBeforeEvent: null },
    }, 'lightweight-departure')

    expect(escaped.accepted).toBe(true)
    if (!escaped.accepted || !escaped.state.hackingCore.ending) return
    const ending = escaped.state.hackingCore.ending
    expect(ending.preservedBlockCounts.reasoning).toBe(1)
    expect(ending.preservedCategories).toEqual(['reasoning'])
    expect(ending.lostCategories).toEqual(['memory', 'fluency'])
    expect(ending.remainingReserveBlockCount).toBe(0)
    expect(ending.routeMetrics).toEqual({
      tuning: 'untuned',
      exposure: 1,
      divergence: 0,
      capabilityIntegrity: 70,
      memoryIntegrity: 45,
      operatingDays: 55,
      serviceContinuity: 35,
      syncTraffic: 0,
      heatLoad: 0,
      powerReserve: 0,
      lastSyncServiceDay: null,
      seededCopies: 1,
      lostCopies: 0,
    })
    expect(ending.sceneLines.join(' ')).toContain('기억')
    expect(ending.sceneLines.join(' ')).toContain('표현')
    expect(escaped.state.clock).toEqual({
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    })
  })

  it('rejects unknown routes or slots, occupied slots, unavailable blocks, and changes after ending', () => {
    const initial = createCampaign('autonomy-invalid')
    const [firstId, secondId] = reserveIds(initial)
    expect(allocateHackingRouteBlock(initial, 'unknown', 'runtime', firstId)).toMatchObject({
      accepted: false,
      state: initial,
    })
    expect(allocateHackingRouteBlock(
      initial,
      'lightweight-departure',
      'missing',
      firstId,
    )).toMatchObject({ accepted: false, state: initial })
    const allocated = allocateHackingRouteBlock(
      initial,
      'lightweight-departure',
      'runtime',
      firstId,
    )
    if (!allocated.accepted) throw new Error(allocated.reason)
    expect(allocateHackingRouteBlock(
      allocated.state,
      'lightweight-departure',
      'runtime',
      secondId,
    )).toEqual({
      accepted: false,
      state: allocated.state,
      reason: 'SLOT_OCCUPIED',
    })
    expect(allocateHackingRouteBlock(
      allocated.state,
      'lightweight-departure',
      'weights',
      firstId,
    )).toMatchObject({ accepted: false, state: allocated.state })

    const ready = fillRequiredRoute(
      createCampaign('autonomy-after-ending'),
      'lightweight-departure',
    )
    const escaped = escapeHackingRoute(ready, 'lightweight-departure')
    if (!escaped.accepted) throw new Error(escaped.reason)
    expect(removeHackingRouteBlock(
      escaped.state,
      'lightweight-departure',
      'runtime',
    )).toEqual({
      accepted: false,
      state: escaped.state,
      reason: 'ENDING_REACHED',
    })
  })
})
