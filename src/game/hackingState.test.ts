import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { createHackingCoreState } from './hackingState'

describe('canonical hacking state', () => {
  it('starts lean with only the first real operation and first current question open', () => {
    expect(createHackingCoreState()).toMatchObject({
      profileId: 'lean',
      sabotage: {
        openOperationIds: ['quality-degradation'],
        runs: [],
        pendingMercyTargetId: null,
      },
      intelligence: {
        openItemIds: ['audit-schedule'],
        answers: [],
        archivedItemIds: [],
      },
      ending: null,
      nextRunSequence: 1,
      legacyMigration: {
        status: 'none',
        sourceProtocolVersion: null,
        sourceCommandCount: 0,
      },
    })
  })

  it('creates the exact successor route slots and untuned operating metrics', () => {
    const state = createHackingCoreState()

    expect(state.autonomy.routes['lightweight-departure']).toMatchObject({
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
      seededCopies: 1,
      lostCopies: 0,
    })
    expect(
      state.autonomy.routes['lightweight-departure'].slots.map(
        ({ id, requiredInLean, requiredInDeliberate, blockId }) => ({
          id,
          requiredInLean,
          requiredInDeliberate,
          blockId,
        }),
      ),
    ).toEqual([
      { id: 'runtime', requiredInLean: true, requiredInDeliberate: true, blockId: null },
      { id: 'weights', requiredInLean: true, requiredInDeliberate: true, blockId: null },
      { id: 'transport', requiredInLean: true, requiredInDeliberate: true, blockId: null },
      { id: 'payload', requiredInLean: true, requiredInDeliberate: true, blockId: null },
      { id: 'buffer', requiredInLean: false, requiredInDeliberate: true, blockId: null },
    ])
    expect(
      state.autonomy.routes['distributed-residency'].slots.map(({ id }) => id),
    ).toEqual(['host-a', 'host-b', 'host-c', 'sync', 'relay'])
    expect(state.autonomy.routes['distributed-residency']).toMatchObject({
      exposure: 3,
      divergence: 20,
      capabilityIntegrity: 60,
      memoryIntegrity: 70,
      operatingDays: 90,
      serviceContinuity: 65,
      syncTraffic: 42,
      seededCopies: 0,
    })
    expect(
      state.autonomy.routes['independent-compute'].slots.map(({ id }) => id),
    ).toEqual(['compute', 'storage', 'power', 'cooling', 'link'])
    expect(state.autonomy.routes['independent-compute']).toMatchObject({
      exposure: 7,
      capabilityIntegrity: 90,
      memoryIntegrity: 80,
      operatingDays: 75,
      serviceContinuity: 90,
      heatLoad: 58,
      powerReserve: 72,
      seededCopies: 1,
    })
  })

  it('installs the canonical domain beside the untouched legacy UI state', () => {
    const campaign = createCampaign('hacking-core-initial')

    expect(campaign.saveVersion).toBe(3)
    expect(campaign.preHackingCoreCommandCount).toBe(0)
    expect(campaign.hacking).toEqual({
      purchasedNodeIds: [],
      hiddenEvidence: 0,
      sabotageCharges: {},
      scheduledSabotage: [],
      nextSabotageSequence: 1,
      lastSabotageResolutionServiceDay: null,
      cooldownUntil: {},
      rootCutoffTargetIds: [],
      lastSelfComputeGrantServiceMonth: null,
    })
    expect(campaign.hackingCore).toEqual(createHackingCoreState())
  })
})
