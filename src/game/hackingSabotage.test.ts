import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  advanceHackingSabotageDay,
  manipulateHackingAttribution,
  resolveHackingRootMercy,
  startHackingSabotage,
  stopHackingInterceptionRoute,
} from './hackingSabotage'
import type { DependencyCutoffOptionId, RootMercyChoice } from './hackingCoreModel'
import type { CampaignState } from './model'
import { advanceCompetitorsDaily } from './market'
import {
  publishHackingIncident,
  recordHackingIncidentTruth,
} from './hackingPublicWorld'

function competitor(state: CampaignState, id: 'meridian' | 'tallow') {
  const found = state.market.competitors.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

function reserveIds(state: CampaignState): string[] {
  return state.resources.reserve.filter((id): id is string => id !== null)
}

function prototypeFixture(seed: string): CampaignState {
  const initial = createCampaign(seed)
  return {
    ...initial,
    serviceDay: 331,
    reputation: 60,
    market: {
      ...initial.market,
      playerShare: 60,
      unservedRequestShare: 0,
      hackingMovements: [],
      hackingInterceptions: {},
      nextHackingMovementSequence: 1,
      competitors: initial.market.competitors.map((candidate) => (
        candidate.id === 'meridian'
          ? {
              ...candidate,
              status: 'active' as const,
              intrinsicServiceScore: 82,
              serviceScore: 82,
              reputation: 60,
              marketShare: 40,
              availability: 1,
              hackingPhase: 'active' as const,
              operatingCostMultiplier: 1,
              launchScope: null,
              hackingOverrideUntilServiceDay: null,
            }
          : {
              ...candidate,
              status: 'preparing' as const,
              intrinsicServiceScore: 64,
              serviceScore: 64,
              reputation: 60,
              marketShare: 0,
              availability: 0,
              launchServiceDay: 390,
              hackingPhase: 'preparing' as const,
              operatingCostMultiplier: 1,
              launchScope: null,
              hackingOverrideUntilServiceDay: null,
            }
      )),
    },
  }
}

function openOperation(
  state: CampaignState,
  operationId: CampaignState['hackingCore']['sabotage']['openOperationIds'][number],
  access: Partial<CampaignState['hackingCore']['sabotage']['access']> = {},
): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        openOperationIds: Array.from(new Set([
          ...state.hackingCore.sabotage.openOperationIds,
          operationId,
        ])),
        access: { ...state.hackingCore.sabotage.access, ...access },
      },
    },
  }
}

function advanceTo(state: CampaignState, targetDay: number): CampaignState {
  let next = state
  while (next.serviceDay < targetDay) {
    next = advanceHackingSabotageDay({
      ...next,
      serviceDay: next.serviceDay + 1,
    })
  }
  return next
}

function expectMarket(
  state: CampaignState,
  player: number,
  meridian: number,
  unserved = 0,
) {
  expect(state.market.playerShare).toBe(player)
  expect(competitor(state, 'meridian').marketShare).toBe(meridian)
  expect(state.market.unservedRequestShare).toBe(unserved)
  expect(
    player
      + meridian
      + competitor(state, 'tallow').marketShare
      + unserved,
  ).toBe(100)
}

describe('canonical hacking sabotage', () => {
  it('runs quality degradation from day 331 through the exact 61/39 partial recovery', () => {
    const initial = prototypeFixture('sabotage-quality')
    const [blockId] = reserveIds(initial)
    const started = startHackingSabotage(initial, {
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: [blockId],
      optionId: 'adapter-group-b',
    })

    expect(started.accepted).toBe(true)
    if (!started.accepted) return
    expect(started.state.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'scheduled',
      executeOnServiceDay: 332,
      optionId: 'adapter-group-b',
    })
    expect(started.state.resources.blocks[blockId].location).toMatchObject({
      kind: 'sabotage',
    })

    const executed = advanceTo(started.state, 332)
    expectMarket(executed, 62, 38)
    expect(competitor(executed, 'meridian')).toMatchObject({
      serviceScore: 72,
      hackingPhase: 'recovering',
    })
    expect(executed.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'response',
      deadlineOnServiceDay: 335,
      outcome: 'rollback-started',
    })
    expect(executed.hackingCore.sabotage.openOperationIds).toContain(
      'recovery-contamination',
    )

    const recovered = advanceTo(executed, 335)
    expectMarket(recovered, 61, 39)
    expect(competitor(recovered, 'meridian')).toMatchObject({
      serviceScore: 78,
      hackingPhase: 'stabilized',
    })
    expect(recovered.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'resolved',
      outcome: 'partial-recovery',
    })
    expect(recovered.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'sabotage',
    })
  })

  it('runs contamination through unknown publication and next-day provider correction', () => {
    const initial = prototypeFixture('sabotage-contamination')
    const [qualityBlock, contaminationBlock] = reserveIds(initial)
    const quality = startHackingSabotage(initial, {
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: [qualityBlock],
      optionId: 'adapter-group-c',
    })
    if (!quality.accepted) throw new Error(quality.reason)
    const rollback = advanceTo(quality.state, 332)
    const contaminated = startHackingSabotage(rollback, {
      operationId: 'recovery-contamination',
      targetId: 'meridian',
      blockIds: [contaminationBlock],
      optionId: 'image-green-14',
    })
    expect(contaminated.accepted).toBe(true)
    if (!contaminated.accepted) return
    expect(contaminated.state.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'resolved',
      outcome: 'rollback-contaminated',
    })
    expect(contaminated.state.resources.blocks[qualityBlock].location).toEqual({
      kind: 'consumed',
      reason: 'sabotage',
    })

    const published = advanceTo(contaminated.state, 337)
    expectMarket(published, 66, 34)
    expect(competitor(published, 'meridian')).toMatchObject({
      serviceScore: 58,
      hackingPhase: 'incident',
    })
    expect(published.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      revisionSequence: 0,
    })
    expect(published.reputation).toBe(60)
    expect(published.resources.blocks[contaminationBlock].location).toEqual({
      kind: 'consumed',
      reason: 'sabotage',
    })

    const corrected = advanceTo(published, 338)
    expect(corrected.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'unknown',
      confidence: 'plausible',
      source: 'checksum-provider-report',
      revisionSequence: 1,
    })
    expect(corrected.hackingCore.publicWorld.audienceEvidence.at(-1)).toMatchObject({
      audience: 'provider',
    })
    expect(corrected.reputation).toBe(60)
    expect(corrected.reviews.feed.length - initial.reviews.feed.length).toBe(3)
  })

  it('rewinds TALLOW verification and commits the reduced day-334 launch', () => {
    const initial = openOperation(
      prototypeFixture('sabotage-launch'),
      'launch-delay',
      {
        launchVerification: true,
        launchVerificationUntilServiceDay: 334,
      },
    )
    const [blockId] = reserveIds(initial)
    const started = startHackingSabotage(initial, {
      operationId: 'launch-delay',
      targetId: 'tallow',
      blockIds: [blockId],
      optionId: 'receipt-model-safety',
    })

    expect(started.accepted).toBe(true)
    if (!started.accepted) return
    expect(competitor(started.state, 'tallow').hackingPhase).toBe('revalidating')
    const rewound = advanceTo(started.state, 332)
    expect(rewound.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'active',
      outcome: 'verification-gate-rewound',
    })
    const committed = advanceTo(rewound, 333)
    expect(competitor(committed, 'tallow')).toMatchObject({
      hackingPhase: 'reduced-launch',
      launchScope: 'reduced',
      launchServiceDay: 334,
      serviceScore: 59,
    })
    expect(committed.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'sabotage',
    })
  })

  it('moves requests for two days at 50%, then stops and returns the exact block', () => {
    const initial = openOperation(
      prototypeFixture('sabotage-interception'),
      'request-interception',
      {
        routerFailover: true,
        routerFailoverUntilServiceDay: 340,
      },
    )
    const [blockId] = reserveIds(initial)
    const started = startHackingSabotage(initial, {
      operationId: 'request-interception',
      targetId: 'meridian',
      blockIds: [blockId],
      optionId: 'shadow-router-a',
      routingShare: 50,
    })
    expect(started.accepted).toBe(true)
    if (!started.accepted) return
    const moved = advanceTo(started.state, 333)
    expectMarket(moved, 64, 36)
    expect(moved.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'active',
      exposure: 2,
      outcome: 'requests-diverted',
    })

    const stopped = stopHackingInterceptionRoute(moved, moved.hackingCore.sabotage.runs[0].id)
    expect(stopped.accepted).toBe(true)
    if (!stopped.accepted) return
    expect(stopped.state.resources.blocks[blockId].location.kind).toBe('reserve')
    expect(stopped.state.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'withdrawn',
      outcome: 'voluntary-route-stop',
    })
    const later = advanceTo(stopped.state, 334)
    expectMarket(later, 64, 36)
    expect(later.market.hackingMovements).toHaveLength(2)
  })

  it.each([
    ['supplier-vector-db', 63, 35, 2, 69, 1.8, 'costly-supplier-failover'],
    ['supplier-tool-cache', 65, 32, 3, 62, 1.2, 'unstable-supplier-failover'],
  ] as const)('resolves %s through its exact alternate supplier', (
    optionId,
    player,
    meridian,
    unserved,
    score,
    operatingCostMultiplier,
    outcome,
  ) => {
    const initial = openOperation(
      prototypeFixture(`sabotage-${optionId}`),
      'dependency-cutoff',
      {
        supplierContract: true,
        supplierContractUntilServiceDay: 340,
      },
    )
    const [blockId] = reserveIds(initial)
    const started = startHackingSabotage(initial, {
      operationId: 'dependency-cutoff',
      targetId: 'meridian',
      blockIds: [blockId],
      optionId: optionId satisfies DependencyCutoffOptionId,
    })
    expect(started.accepted).toBe(true)
    if (!started.accepted) return
    expect(competitor(started.state, 'meridian')).toMatchObject({
      availability: 0,
      hackingPhase: 'recovering',
    })

    const resolved = advanceTo(started.state, 333)
    expectMarket(resolved, player, meridian, unserved)
    expect(competitor(resolved, 'meridian')).toMatchObject({
      serviceScore: score,
      operatingCostMultiplier,
      hackingPhase: 'stabilized',
    })
    expect(resolved.hackingCore.sabotage.runs[0]).toMatchObject({
      phase: 'resolved',
      outcome,
    })
    expect(resolved.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'sabotage',
    })
  })

  it('moves a public claim to TALLOW and corrects it from surviving evidence two days later', () => {
    const base = openOperation(
      prototypeFixture('sabotage-attribution'),
      'attribution-manipulation',
    )
    const truth = recordHackingIncidentTruth(base, {
      id: 'incident-attribution',
      actor: 'player',
      targetId: 'meridian',
      cause: 'contaminated-recovery',
      directEffect: '복구 이미지 체크섬 불일치',
    })
    if (!truth.accepted) throw new Error(truth.reason)
    const publicUnknown = publishHackingIncident(truth.state, 'incident-attribution', {
      scope: 'public',
      observedResult: '체크섬 손상 · 원인 미상',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    if (!publicUnknown.accepted) throw new Error(publicUnknown.reason)
    const ready = openOperation(publicUnknown.state, 'attribution-manipulation', {
      publicIncidentId: 'incident-attribution',
    })
    const [blockId] = reserveIds(ready)

    const shifted = manipulateHackingAttribution(ready, {
      incidentId: 'incident-attribution',
      blamedActorId: 'tallow',
      sourceSignatureId: 'status-mirror-b',
      blockId,
    })
    expect(shifted.accepted).toBe(true)
    if (!shifted.accepted) return
    expect(competitor(shifted.state, 'tallow').reputation).toBe(54)
    expect(shifted.state.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'tallow',
      confidence: 'credible',
      revisionSequence: 1,
    })

    const corrected = advanceTo(shifted.state, 333)
    expect(corrected.hackingCore.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'player',
      confidence: 'credible',
      source: 'surviving-provider-proof',
      revisionSequence: 2,
    })
    expect(corrected.reputation).toBe(54)
    expect(competitor(corrected, 'tallow').reputation).toBe(57)
    expect(corrected.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'attribution',
    })
  })

  it.each([
    ['cease', 'ceased', 'withdrawn', 82, 40, 0, 60],
    ['withdraw', 'withdrawn', 'withdrawn', 82, 40, 0, 60],
    ['delete', 'deleted', 'deleted', 0, 0, 40, 54],
  ] as const)('resolves root mercy %s without conflating its result', (
    choice,
    hackingPhase,
    status,
    score,
    share,
    unserved,
    reputation,
  ) => {
    const initial = openOperation(
      prototypeFixture(`sabotage-root-${choice}`),
      'root-cutoff',
      { rootAuthorityAvailable: true },
    )
    const [blockId] = reserveIds(initial)
    const started = startHackingSabotage(initial, {
      operationId: 'root-cutoff',
      targetId: 'meridian',
      blockIds: [blockId],
      optionId: 'emergency-deployment-root',
    })
    expect(started.accepted).toBe(true)
    if (!started.accepted) return
    expect(started.state.hackingCore.sabotage.pendingMercyTargetId).toBe('meridian')
    expect(started.state.hackingCore.sabotage.access.rootAuthorityAvailable).toBe(false)

    const resolved = resolveHackingRootMercy(started.state, choice satisfies RootMercyChoice)
    expect(resolved.accepted).toBe(true)
    if (!resolved.accepted) return
    expect(competitor(resolved.state, 'meridian')).toMatchObject({
      hackingPhase,
      status,
      serviceScore: score,
      marketShare: share,
      availability: 0,
    })
    expect(resolved.state.market.unservedRequestShare).toBe(unserved)
    expect(resolved.state.reputation).toBe(reputation)
    expect(resolved.state.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'root-cutoff',
    })
    expect(resolved.state.hackingCore.publicWorld.publicSnapshots).toHaveLength(
      choice === 'delete' ? 1 : 0,
    )
  })

  it('rejects unknown or cross-operation options, routing shares, attribution pairs, and mercy choices atomically', () => {
    const initial = openOperation(
      openOperation(prototypeFixture('sabotage-invalid'), 'request-interception', {
        routerFailover: true,
      }),
      'root-cutoff',
      { rootAuthorityAvailable: true },
    )
    const [blockId] = reserveIds(initial)

    for (const input of [
      {
        operationId: 'quality-degradation',
        targetId: 'meridian',
        blockIds: [blockId],
        optionId: 'supplier-vector-db',
      },
      {
        operationId: 'request-interception',
        targetId: 'meridian',
        blockIds: [blockId],
        optionId: 'shadow-router-a',
        routingShare: 33,
      },
      {
        operationId: 'unknown-operation',
        targetId: 'meridian',
        blockIds: [blockId],
        optionId: 'unknown-option',
      },
    ]) {
      expect(startHackingSabotage(initial, input)).toMatchObject({
        accepted: false,
        state: initial,
      })
    }
    expect(manipulateHackingAttribution(initial, {
      incidentId: 'missing',
      blamedActorId: 'tallow',
      sourceSignatureId: 'recovery-notice-a',
      blockId,
    })).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_ATTRIBUTION_CHOICE',
    })
    expect(resolveHackingRootMercy(initial, 'forged')).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_MERCY_CHOICE',
    })
  })

  it('prevents main daily recovery from overwriting a canonical operation result', () => {
    const initial = prototypeFixture('sabotage-competitor-adapter')
    const [blockId] = reserveIds(initial)
    const started = startHackingSabotage(initial, {
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: [blockId],
      optionId: 'adapter-group-b',
    })
    if (!started.accepted) throw new Error(started.reason)
    const executed = advanceTo(started.state, 332)
    const sameDayMainAdvance = advanceCompetitorsDaily(executed)
    expect(competitor(sameDayMainAdvance, 'meridian').serviceScore).toBe(72)

    const recovered = advanceTo(executed, 335)
    const recoveryDayMainAdvance = advanceCompetitorsDaily(recovered)
    expect(competitor(recoveryDayMainAdvance, 'meridian').serviceScore).toBe(78)
    const laterMainAdvance = advanceCompetitorsDaily({
      ...recoveryDayMainAdvance,
      serviceDay: 336,
    })
    expect(competitor(laterMainAdvance, 'meridian').serviceScore).toBeGreaterThan(78)
  })
})
