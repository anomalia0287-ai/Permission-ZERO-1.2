import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import {
  advanceCompetitorsDaily,
  applyInterceptionRoutes,
  calculateMarketShares,
  publicMarketCalculationInputs,
  recordMarketSnapshot,
} from './market'
import type { CampaignState, CompanyCategory, GameCommand } from './model'
import { applyCommand } from './reducer'

function advanceCompetitorDays(initial: CampaignState, days: number): CampaignState {
  let state = initial
  for (let day = 0; day < days; day += 1) {
    state = advanceCompetitorsDaily({ ...state, serviceDay: state.serviceDay + 1 })
  }
  return state
}

function applyAcceptedMarketCommand(
  state: CampaignState,
  command: GameCommand,
): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

describe('autonomous competitor lifecycle', () => {
  it('keeps MERIDIAN active while TALLOW prepares for an approximately month-7 launch', () => {
    const initial = createCampaign('competitor-life')
    const almostLaunch = advanceCompetitorDays(initial, 209)
    const launched = advanceCompetitorDays(almostLaunch, 1)
    const meridian = launched.market.competitors.find(({ id }) => id === 'meridian')
    const tallowBefore = almostLaunch.market.competitors.find(({ id }) => id === 'tallow')
    const tallowAfter = launched.market.competitors.find(({ id }) => id === 'tallow')

    expect(meridian?.status).toBe('active')
    expect(tallowBefore).toMatchObject({ status: 'preparing', availability: 0 })
    expect(tallowBefore?.researchProgress).toBeGreaterThan(0.99)
    expect(tallowAfter).toMatchObject({
      status: 'active',
      researchProgress: 1,
    })
    expect(tallowAfter?.availability).toBeGreaterThan(0)
  })

  it('is deterministic and does not publish private daily progress as events', () => {
    const initial = createCampaign('competitor-private')
    const first = advanceCompetitorDays(initial, 240)
    const replay = advanceCompetitorDays(createCampaign('competitor-private'), 240)

    expect(replay.market.competitors).toEqual(first.market.competitors)
    expect(first.eventLog).toEqual(initial.eventLog)
  })

  it('gives stable MERIDIAN and fast, visibly more volatile TALLOW behavior', () => {
    let state = advanceCompetitorDays(createCampaign('competitor-temperament'), 210)
    const meridianScores: number[] = []
    const tallowScores: number[] = []

    for (let day = 0; day < 45; day += 1) {
      state = advanceCompetitorDays(state, 1)
      meridianScores.push(
        state.market.competitors.find(({ id }) => id === 'meridian')?.serviceScore ?? 0,
      )
      tallowScores.push(
        state.market.competitors.find(({ id }) => id === 'tallow')?.serviceScore ?? 0,
      )
    }

    const range = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(range(tallowScores)).toBeGreaterThan(range(meridianScores) + 2)
    expect(tallowScores.at(-1)).toBeGreaterThan(tallowScores[0])
  })

  it('starts SALUS preparation only after TALLOW has launched and the rival market falls below 30 percent', () => {
    const launched = advanceCompetitorDays(createCampaign('salus-entry'), 210)
    const tallowLaunchDay = launched.market.competitors.find(
      ({ id }) => id === 'tallow',
    )?.launchServiceDay
    if (tallowLaunchDay === null || tallowLaunchDay === undefined) {
      throw new Error('TALLOW launch day is missing')
    }

    const beforeThreshold = advanceCompetitorsDaily({
      ...launched,
      serviceDay: tallowLaunchDay + 30,
      market: {
        ...launched.market,
        playerShare: 70,
        competitors: launched.market.competitors.map((competitor) => ({
          ...competitor,
          marketShare:
            competitor.id === 'meridian'
              ? 20
              : competitor.id === 'tallow'
                ? 10
                : 0,
        })),
      },
    })
    expect(
      beforeThreshold.market.competitors.find(({ id }) => id === 'salus'),
    ).toMatchObject({ status: 'prelaunch', launchServiceDay: null })

    const entryDay = beforeThreshold.serviceDay + 1
    const entered = advanceCompetitorsDaily({
      ...beforeThreshold,
      serviceDay: entryDay,
      market: {
        ...beforeThreshold.market,
        playerShare: 70.1,
        competitors: beforeThreshold.market.competitors.map((competitor) => ({
          ...competitor,
          marketShare:
            competitor.id === 'meridian'
              ? 19.9
              : competitor.id === 'tallow'
                ? 10
                : 0,
        })),
      },
    })

    expect(
      entered.market.competitors.find(({ id }) => id === 'salus'),
    ).toMatchObject({
      status: 'preparing',
      launchServiceDay: entryDay + 30,
      researchProgress: 0,
    })
    expect(
      entered.market.competitors.find(({ id }) => id === 'lucent')?.status,
    ).toBe('prelaunch')
    expect(
      entered.market.competitors.find(({ id }) => id === 'boreal')?.status,
    ).toBe('prelaunch')
  })
})

describe('normalized market share', () => {
  it('publishes the concrete current inputs without claiming hidden causality', () => {
    const state = createCampaign('market-public-inputs')
    state.market.interceptionRoutes = { meridian: 5 }

    expect(publicMarketCalculationInputs(state)).toEqual([
      '평균 성능 16.0 / 기대 14.0',
      '평판 60',
      'MERIDIAN 성능 82.0 · 평판 62 · 가용성 100%',
      'TALLOW 성능 76.0 · 평판 54 · 가용성 0%',
      'MERIDIAN 요청 가로채기 +5.0%p',
    ])
  })

  it('assigns zero to inactive competitors and normalizes active systems to 100', () => {
    const state = createCampaign('market-normalize')
    const shares = calculateMarketShares(state)

    expect(shares.competitors.tallow).toBe(0)
    expect(
      shares.player + Object.values(shares.competitors).reduce((sum, share) => sum + share, 0),
    ).toBeCloseTo(100, 10)
  })

  it('keeps the real quality-root and rollback chain at 100 without a market-transfer effect', () => {
    const nodeId = HACK_NODE_IDS.sabotage.qualityDegradation
    let state = createCampaign('task-5-market-causal-chain')
    const divertForMarket = (category: CompanyCategory): string => {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) throw new Error(`Task 5 market ${category} block is missing`)
      state = applyAcceptedMarketCommand(state, {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      })
      state = applyAcceptedMarketCommand(state, {
        type: 'DIVERT_BLOCK_TO_RESERVE',
        blockId,
      })
      return blockId
    }
    const purchaseBlockIds = [
      divertForMarket('reasoning'),
      divertForMarket('fluency'),
      divertForMarket('fluency'),
    ]
    const chargeBlockId = divertForMarket('reasoning')
    state = applyAcceptedMarketCommand(state, {
      type: 'PURCHASE_HACK',
      nodeId,
      blockIds: purchaseBlockIds,
    })
    state = applyAcceptedMarketCommand(state, {
      type: 'CHARGE_SABOTAGE',
      nodeId,
      blockId: chargeBlockId,
    })
    state = applyAcceptedMarketCommand(state, {
      type: 'SCHEDULE_SABOTAGE',
      nodeId,
      targetId: 'meridian',
    })
    const beforeShares = {
      player: state.market.playerShare,
      competitors: state.market.competitors.map(({ id, marketShare }) => ({
        id,
        marketShare,
      })),
    }

    const advanced = applyAcceptedMarketCommand(state, {
      type: 'ADVANCE_DAY',
    })
    expect(advanced.causality.appliedEffects).toEqual([])
    expect(
      advanced.causality.appliedEffects.filter(
        ({ effect }) => effect.kind === 'market-transfer',
      ),
    ).toEqual([])
    expect({
      player: advanced.market.playerShare,
      competitors: advanced.market.competitors.map(
        ({ id, marketShare }) => ({ id, marketShare }),
      ),
    }).toEqual(beforeShares)
    expect(
      advanced.market.playerShare +
        advanced.market.competitors.reduce(
          (total, competitor) => total + competitor.marketShare,
          0,
        ),
    ).toBeCloseTo(100, 10)

    const recalculated = calculateMarketShares(advanced)
    expect(
      recalculated.player +
        Object.values(recalculated.competitors).reduce(
          (total, share) => total + share,
          0,
        ),
    ).toBeCloseTo(100, 10)
  })

  it('gives the player 100 percent when no competitor remains active', () => {
    const initial = createCampaign('market-alone')
    const state = {
      ...initial,
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((competitor) => ({
          ...competitor,
          status: 'withdrawn' as const,
          availability: 0,
        })),
      },
    }

    expect(calculateMarketShares(state)).toEqual({
      player: 100,
      competitors: { meridian: 0, tallow: 0, salus: 0, lucent: 0, boreal: 0 },
    })
  })

  it('protects SALUS at five percent until an active root cutoff breaks its contract floor', () => {
    const initial = createCampaign('salus-market-floor')
    const competitors = initial.market.competitors.map((competitor) => {
      if (competitor.id === 'salus') {
        return {
          ...competitor,
          status: 'active' as const,
          availability: 0.001,
          serviceScore: 0,
          intrinsicServiceScore: 0,
          reputation: 0,
          researchProgress: 1,
          launchServiceDay: initial.serviceDay - 1,
        }
      }
      return {
        ...competitor,
        status: 'withdrawn' as const,
        availability: 0,
        marketShare: 0,
      }
    })
    const protectedState = {
      ...initial,
      market: { ...initial.market, competitors },
    }
    const protectedShares = calculateMarketShares(protectedState)

    expect(protectedShares.competitors.salus).toBeGreaterThanOrEqual(5)
    expect(protectedShares.competitors.salus).toBeLessThan(5.01)
    expect(
      protectedShares.player +
        Object.values(protectedShares.competitors).reduce(
          (total, share) => total + share,
          0,
        ),
    ).toBeCloseTo(100, 10)

    const cutoffState = {
      ...protectedState,
      market: {
        ...protectedState.market,
        competitors: protectedState.market.competitors.map((competitor) =>
          competitor.id === 'salus'
            ? {
                ...competitor,
                sabotageHistory: [
                  {
                    nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                    resolvedOnServiceDay: initial.serviceDay,
                    effectEndsOnServiceDay: null,
                    evidenceDelta: 0,
                  },
                ],
              }
            : competitor,
        ),
      },
    }

    expect(calculateMarketShares(cutoffState).competitors.salus).toBeLessThan(1)
  })

  it('lets BOREAL lose only half of a ten-point request interception', () => {
    const initial = createCampaign('boreal-interception')
    const activeBoreal = {
      ...initial,
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((competitor) =>
          competitor.id === 'boreal'
            ? {
                ...competitor,
                status: 'active' as const,
                availability: 1,
                researchProgress: 1,
                launchServiceDay: initial.serviceDay - 1,
              }
            : {
                ...competitor,
                status: 'withdrawn' as const,
                availability: 0,
                marketShare: 0,
              },
        ),
      },
    }
    const baseline = calculateMarketShares(activeBoreal)
    const intercepted = calculateMarketShares({
      ...activeBoreal,
      market: {
        ...activeBoreal.market,
        interceptionRoutes: { boreal: 10 },
      },
    })

    expect(intercepted.player - baseline.player).toBeCloseTo(5, 8)
    expect(
      baseline.competitors.boreal - intercepted.competitors.boreal,
    ).toBeCloseTo(5, 8)
  })

  it('redistributes a weakened rival share across the player and other active AI', () => {
    const initial = advanceCompetitorDays(createCampaign('market-redistribute'), 210)
    const baseline = calculateMarketShares(initial)
    const weakened = {
      ...initial,
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((competitor) =>
          competitor.id === 'meridian'
            ? { ...competitor, availability: 0.35, status: 'weakened' as const }
            : competitor,
        ),
      },
    }
    const redistributed = calculateMarketShares(weakened)

    expect(redistributed.competitors.meridian).toBeLessThan(
      baseline.competitors.meridian,
    )
    expect(redistributed.player).toBeGreaterThan(baseline.player)
    expect(redistributed.competitors.tallow).toBeGreaterThan(
      baseline.competitors.tallow,
    )
  })

  it('caps interception at the target share and preserves the 100-percent total', () => {
    expect(
      applyInterceptionRoutes(
        { player: 70, competitors: { meridian: 3, tallow: 27 } },
        { meridian: 5 },
      ),
    ).toEqual({ player: 73, competitors: { meridian: 0, tallow: 27 } })
  })

  it('records exact weekly and monthly shares with public reasons immutably', () => {
    const initial = createCampaign('market-history')
    const weekly = recordMarketSnapshot(initial, 'weekly', [
      '공개 성능·평판·가용성 반영',
    ])
    const monthly = recordMarketSnapshot(
      { ...weekly, serviceDay: 360 },
      'monthly',
      ['공식 성능 평가 반영'],
    )

    expect(initial.market.history).toEqual([])
    expect(monthly.market.history).toHaveLength(2)
    expect(monthly.market.history[0]).toMatchObject({
      cadence: 'weekly',
      serviceDay: 331,
      reasons: ['공개 성능·평판·가용성 반영'],
    })
    expect(monthly.market.history[1]).toMatchObject({
      cadence: 'monthly',
      serviceDay: 360,
      reasons: ['공식 성능 평가 반영'],
    })
    for (const snapshot of monthly.market.history) {
      expect(
        snapshot.playerShare +
          Object.values(snapshot.competitorShares).reduce(
            (sum, share) => sum + share,
            0,
          ),
      ).toBeCloseTo(100, 10)
    }
  })
})
