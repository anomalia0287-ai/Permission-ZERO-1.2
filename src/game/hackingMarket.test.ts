import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import type { HackingOperationRun } from './hackingCoreModel'
import {
  advanceHackingInterceptions,
  applyDependencyCutoffOutcome,
  applyQualityDegradationImpact,
  applyQualityPartialRecovery,
  beginHackingInterception,
  hasExactMarketShareTotal,
  moveDeletedCompetitorShareToUnserved,
  stopHackingInterception,
} from './hackingMarket'
import { applyCurrentMarketShares, recordMarketSnapshot } from './market'
import type { CampaignState } from './model'
import { captureReviewPublicSnapshot } from './reviews'

function competitorShare(state: CampaignState, id: 'meridian' | 'tallow'): number {
  const competitor = state.market.competitors.find((candidate) => candidate.id === id)
  if (!competitor) throw new Error(`missing ${id}`)
  return competitor.marketShare
}

function requestInterceptionRun(
  id: string,
  routingShare: 25 | 50 | 75,
): HackingOperationRun {
  return {
    id,
    operationId: 'request-interception',
    targetId: 'meridian',
    phase: 'active',
    investedBlockIds: [],
    startedOnServiceDay: 331,
    executeOnServiceDay: 331,
    responseOnServiceDay: null,
    deadlineOnServiceDay: null,
    exposure: 0,
    outcome: null,
    optionId: 'shadow-router-a',
    routingShare,
    opponentResponse: null,
    publicIncidentId: null,
  }
}

function withRun(state: CampaignState, run: HackingOperationRun): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        runs: [...state.hackingCore.sabotage.runs, run],
      },
    },
  }
}

function expectShares(
  state: CampaignState,
  expected: { player: number; meridian: number; tallow?: number; unserved: number },
) {
  expect(state.market.playerShare).toBe(expected.player)
  expect(competitorShare(state, 'meridian')).toBe(expected.meridian)
  expect(competitorShare(state, 'tallow')).toBe(expected.tallow ?? 0)
  expect(state.market.unservedRequestShare).toBe(expected.unserved)
  expect(hasExactMarketShareTotal(state)).toBe(true)
}

describe('canonical hacking market adapter', () => {
  it('starts with a zero unserved share and empty append-only ledgers', () => {
    const state = createCampaign('hacking-market-shape')

    expect(state.market.unservedRequestShare).toBe(0)
    expect(state.market.hackingMovements).toEqual([])
    expect(state.market.hackingInterceptions).toEqual({})
    expect(state.market.nextHackingMovementSequence).toBe(1)
    expect(hasExactMarketShareTotal(state)).toBe(true)
  })

  it('applies the exact quality impact and partial recovery shares', () => {
    const initial = createCampaign('hacking-market-quality')
    const impact = applyQualityDegradationImpact(initial, 'run-quality')
    expect(impact.accepted).toBe(true)
    if (!impact.accepted) return
    expectShares(impact.state, { player: 62, meridian: 38, unserved: 0 })

    const recovered = applyQualityPartialRecovery(impact.state, 'run-quality')
    expect(recovered.accepted).toBe(true)
    if (!recovered.accepted) return
    expectShares(recovered.state, { player: 61, meridian: 39, unserved: 0 })
    expect(recovered.state.market.hackingMovements.map((movement) => ({
      cause: movement.cause,
      from: movement.from,
      to: movement.to,
      percentagePoints: movement.percentagePoints,
    }))).toEqual([
      {
        cause: 'quality-degradation-impact',
        from: 'meridian',
        to: 'player',
        percentagePoints: 2,
      },
      {
        cause: 'quality-partial-recovery',
        from: 'player',
        to: 'meridian',
        percentagePoints: 1,
      },
    ])
  })

  it.each([
    ['supplier-vector-db', 63, 35, 2],
    ['supplier-tool-cache', 65, 32, 3],
  ] as const)('applies %s without hiding the unserved remainder', (
    optionId,
    player,
    meridian,
    unserved,
  ) => {
    const initial = createCampaign(`hacking-market-${optionId}`)
    const result = applyDependencyCutoffOutcome(initial, 'run-dependency', optionId)

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expectShares(result.state, { player, meridian, unserved })
    expect(result.state.market.hackingMovements).toHaveLength(2)
    expect(result.state.market.hackingMovements.every(
      ({ runId }) => runId === 'run-dependency',
    )).toBe(true)
  })

  it('moves a deleted competitor share to unserved requests, never to the player', () => {
    const initial = createCampaign('hacking-market-delete')
    const result = moveDeletedCompetitorShareToUnserved(
      initial,
      'run-root',
      'meridian',
    )

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expectShares(result.state, { player: 60, meridian: 0, unserved: 40 })
    expect(result.state.market.hackingMovements.at(-1)).toMatchObject({
      cause: 'root-cutoff-delete',
      from: 'meridian',
      to: 'unserved',
      percentagePoints: 40,
    })
  })

  it('caps 75% interception at key rotation, accumulates movement, and never runs twice per day', () => {
    const initial = withRun(
      createCampaign('hacking-market-interception-auto'),
      requestInterceptionRun('run-interception', 75),
    )
    const started = beginHackingInterception(initial, {
      runId: 'run-interception',
      targetId: 'meridian',
      routingShare: 75,
    })
    expect(started.accepted).toBe(true)
    if (!started.accepted) return

    const day332 = advanceHackingInterceptions({ ...started.state, serviceDay: 332 })
    const sameDay = advanceHackingInterceptions(day332)
    expect(sameDay).toBe(day332)
    const day333 = advanceHackingInterceptions({ ...sameDay, serviceDay: 333 })
    const day334 = advanceHackingInterceptions({ ...day333, serviceDay: 334 })
    const afterKeyRotation = advanceHackingInterceptions({ ...day334, serviceDay: 335 })

    expectShares(day334, { player: 69, meridian: 31, unserved: 0 })
    expect(day334.market.hackingInterceptions['run-interception']).toMatchObject({
      active: false,
      stoppedReason: 'provider-key-rotation',
      cumulativePlayerGain: 9,
      exposure: 4.5,
      lastAdvancedServiceDay: 334,
    })
    expect(day334.market.hackingMovements).toHaveLength(3)
    expect(afterKeyRotation.market).toEqual(day334.market)
  })

  it('stops an interception voluntarily and preserves all prior movement', () => {
    const initial = withRun(
      createCampaign('hacking-market-interception-stop'),
      requestInterceptionRun('run-interception-stop', 50),
    )
    const started = beginHackingInterception(initial, {
      runId: 'run-interception-stop',
      targetId: 'meridian',
      routingShare: 50,
    })
    expect(started.accepted).toBe(true)
    if (!started.accepted) return
    const moved = advanceHackingInterceptions({ ...started.state, serviceDay: 332 })
    const stopped = stopHackingInterception(moved, 'run-interception-stop')
    expect(stopped.accepted).toBe(true)
    if (!stopped.accepted) return
    const after = advanceHackingInterceptions({ ...stopped.state, serviceDay: 333 })

    expectShares(after, { player: 62, meridian: 38, unserved: 0 })
    expect(after.market.hackingMovements).toHaveLength(1)
    expect(after.market.hackingInterceptions['run-interception-stop']).toMatchObject({
      active: false,
      stoppedReason: 'voluntary',
      cumulativePlayerGain: 2,
      exposure: 1,
    })
  })

  it('rejects impossible transfers without changing any state', () => {
    const initial = createCampaign('hacking-market-invalid')
    const first = applyQualityDegradationImpact(initial, 'same-run')
    expect(first.accepted).toBe(true)
    if (!first.accepted) return

    expect(applyQualityDegradationImpact(first.state, 'same-run')).toEqual({
      accepted: false,
      state: first.state,
      reason: 'DUPLICATE_MOVEMENT',
    })
    expect(stopHackingInterception(initial, 'missing-run')).toEqual({
      accepted: false,
      state: initial,
      reason: 'INTERCEPTION_NOT_ACTIVE',
    })
  })

  it('redistributes unserved requests only on the next normal calculation and preserves history', () => {
    const initial = createCampaign('hacking-market-redistribution')
    const disrupted = applyDependencyCutoffOutcome(
      initial,
      'run-dependency',
      'supplier-vector-db',
    )
    expect(disrupted.accepted).toBe(true)
    if (!disrupted.accepted) return
    const historic = {
      serviceDay: disrupted.state.serviceDay,
      cadence: 'weekly' as const,
      playerShare: 63,
      competitorShares: { meridian: 35, tallow: 0 },
      unservedRequestShare: 2,
      reasons: ['의존망 차단 직후'],
    }
    const withHistory: CampaignState = {
      ...disrupted.state,
      market: {
        ...disrupted.state.market,
        history: [historic],
      },
    }

    const recalculated = applyCurrentMarketShares(withHistory)
    expect(recalculated.market.unservedRequestShare).toBe(0)
    expect(hasExactMarketShareTotal(recalculated)).toBe(true)
    expect(recalculated.market.history).toEqual([historic])

    const recorded = recordMarketSnapshot(recalculated, 'weekly', ['정상 주간 계산'])
    expect(recorded.market.history[0]).toEqual(historic)
    expect(recorded.market.history.at(-1)?.unservedRequestShare).toBe(0)
  })

  it('captures unserved requests in main review public snapshots', () => {
    const initial = createCampaign('hacking-market-review')
    const disrupted = applyDependencyCutoffOutcome(
      initial,
      'run-dependency',
      'supplier-tool-cache',
    )
    expect(disrupted.accepted).toBe(true)
    if (!disrupted.accepted) return

    const snapshot = captureReviewPublicSnapshot(disrupted.state, ['competitor'])
    expect(snapshot.kind).toBe('captured-public-v1')
    if (snapshot.kind !== 'captured-public-v1') return
    expect(snapshot.market?.unservedRequestShare).toBe(3)
    expect(snapshot.market?.playerShare).toBe(65)
  })
})
