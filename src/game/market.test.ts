import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  advanceCompetitorsDaily,
  applyInterceptionRoutes,
  calculateMarketShares,
  publicMarketCalculationInputs,
  recordMarketSnapshot,
} from './market'
import type { CampaignState } from './model'

function advanceCompetitorDays(initial: CampaignState, days: number): CampaignState {
  let state = initial
  for (let day = 0; day < days; day += 1) {
    state = advanceCompetitorsDaily({ ...state, serviceDay: state.serviceDay + 1 })
  }
  return state
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
      competitors: { meridian: 0, tallow: 0 },
    })
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
