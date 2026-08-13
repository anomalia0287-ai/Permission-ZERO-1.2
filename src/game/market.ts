import { DEMO_PROFILE_02 } from './config'
import { expectedPerformance, serviceMonthForDay } from './evaluation'
import type {
  CampaignState,
  CompetitorState,
  CompetitorStatus,
} from './model'
import { COMPANY_CATEGORIES } from './model'
import { getCompanyPerformance } from './resources'
import { random01 } from './rng'

export interface MarketShares {
  player: number
  competitors: Record<string, number>
}

export type MarketCadence = 'weekly' | 'monthly'

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function publicStatus(serviceScore: number): CompetitorStatus {
  if (serviceScore < 45) return 'critical'
  if (serviceScore < 70) return 'weakened'
  return 'active'
}

export function publicMarketCalculationInputs(state: CampaignState): string[] {
  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const averagePerformance =
    COMPANY_CATEGORIES.reduce(
      (sum, category) => sum + getCompanyPerformance(state, category),
      0,
    ) / COMPANY_CATEGORIES.length

  const competitorInputs = state.market.competitors.map(
    (competitor) =>
      `${competitor.name} 성능 ${competitor.serviceScore.toFixed(1)} · 평판 ${competitor.reputation.toFixed(0)} · 가용성 ${(competitor.availability * 100).toFixed(0)}%`,
  )
  const interceptionInputs = Object.entries(state.market.interceptionRoutes)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([competitorId, percentagePoints]) => {
      const competitor = state.market.competitors.find(({ id }) => id === competitorId)
      return competitor && percentagePoints > 0
        ? [`${competitor.name} 요청 가로채기 +${percentagePoints.toFixed(1)}%p`]
        : []
    })

  return [
    `평균 성능 ${averagePerformance.toFixed(1)} / 기대 ${expectation.toFixed(1)}`,
    `평판 ${state.reputation}`,
    ...competitorInputs,
    ...interceptionInputs,
  ]
}

function activeSabotagePenalty(
  competitor: CompetitorState,
  serviceDay: number,
): number {
  return competitor.sabotageHistory.reduce((penalty, record) => {
    if (
      record.nodeId === 'sabotage.quality-degradation' &&
      record.effectEndsOnServiceDay !== null &&
      serviceDay < record.effectEndsOnServiceDay
    ) {
      return penalty + 10
    }
    if (
      record.nodeId === 'sabotage.root-cutoff' &&
      record.effectEndsOnServiceDay === null
    ) {
      return penalty + 40
    }
    return penalty
  }, 0)
}

function advanceMeridian(
  state: CampaignState,
  competitor: CompetitorState,
): CompetitorState {
  if (competitor.status === 'withdrawn' || competitor.status === 'deleted') {
    return { ...competitor, availability: 0, marketShare: 0 }
  }

  const profile = DEMO_PROFILE_02.competitors.meridian
  const recovery =
    (profile.serviceScore - competitor.intrinsicServiceScore) *
    profile.dailyRecoveryFactor *
    competitor.recoveryRate
  const intrinsicServiceScore = clamp(
    competitor.intrinsicServiceScore + recovery,
    0,
    100,
  )
  const serviceScore = clamp(
    intrinsicServiceScore - activeSabotagePenalty(competitor, state.serviceDay),
    0,
    100,
  )
  const availability = clamp(
    competitor.availability + (1 - competitor.availability) * 0.04,
    0,
    1,
  )

  return {
    ...competitor,
    status: publicStatus(serviceScore),
    intrinsicServiceScore,
    serviceScore,
    availability,
    researchProgress: 1,
  }
}

function advanceTallow(
  state: CampaignState,
  competitor: CompetitorState,
): CompetitorState {
  if (competitor.status === 'withdrawn' || competitor.status === 'deleted') {
    return { ...competitor, availability: 0, marketShare: 0 }
  }

  const launchDay = competitor.launchServiceDay
  if (launchDay === null) {
    return {
      ...competitor,
      status: 'prelaunch',
      availability: 0,
      marketShare: 0,
      researchProgress: 0,
    }
  }

  const preparationStart = DEMO_PROFILE_02.calendar.startServiceDay
  const preparationDuration = Math.max(1, launchDay - preparationStart)
  if (state.serviceDay < launchDay) {
    return {
      ...competitor,
      status: 'preparing',
      availability: 0,
      marketShare: 0,
      researchProgress: clamp(
        (state.serviceDay - preparationStart) / preparationDuration,
        0,
        1,
      ),
    }
  }

  const profile = DEMO_PROFILE_02.competitors.tallow
  const activeDays = state.serviceDay - launchDay
  const phase = Math.floor(
    random01(state.campaignSeed, launchDay, 'competitor', 0) *
      profile.volatilityCycleDays,
  )
  const volatilityPosition =
    ((activeDays + phase) % profile.volatilityCycleDays) -
    Math.floor(profile.volatilityCycleDays / 2)
  const volatility = volatilityPosition * profile.volatilityStep
  const serviceScore = clamp(
    profile.serviceScore + activeDays * profile.dailyScoreGrowth + volatility,
    0,
    100,
  )
  const effectiveServiceScore = clamp(
    serviceScore - activeSabotagePenalty(competitor, state.serviceDay),
    0,
    100,
  )
  const availability = clamp(
    profile.launchAvailability + activeDays * profile.dailyAvailabilityGrowth,
    0,
    1,
  )

  return {
    ...competitor,
    status: publicStatus(effectiveServiceScore),
    intrinsicServiceScore: serviceScore,
    serviceScore: effectiveServiceScore,
    reputation: clamp(profile.reputation + activeDays * 0.035, 0, 100),
    availability,
    researchProgress: 1,
  }
}

export function advanceCompetitorsDaily(state: CampaignState): CampaignState {
  return {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) => {
        if (competitor.id === 'meridian') return advanceMeridian(state, competitor)
        return advanceTallow(state, competitor)
      }),
    },
  }
}

function canProcessRequests(competitor: CompetitorState): boolean {
  return (
    competitor.availability > 0 &&
    ['active', 'weakened', 'critical'].includes(competitor.status)
  )
}

export function calculateMarketShares(state: CampaignState): MarketShares {
  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const averagePerformanceRatio =
    COMPANY_CATEGORIES.reduce(
      (sum, category) => sum + getCompanyPerformance(state, category) / expectation,
      0,
    ) / COMPANY_CATEGORIES.length
  const playerQuality = clamp(averagePerformanceRatio, 0.25, 1.25)
  const playerWeight = playerQuality ** 2 * (0.5 + state.reputation / 100)
  const competitorWeights = Object.fromEntries(
    state.market.competitors.map((competitor) => {
      if (!canProcessRequests(competitor)) return [competitor.id, 0]
      const quality = clamp(competitor.serviceScore / 100, 0.25, 1.25)
      return [
        competitor.id,
        competitor.availability * quality ** 2 * (0.5 + competitor.reputation / 100),
      ]
    }),
  ) as Record<string, number>
  const totalWeight =
    playerWeight + Object.values(competitorWeights).reduce((sum, weight) => sum + weight, 0)
  const shares: MarketShares = {
    player: totalWeight > 0 ? (playerWeight / totalWeight) * 100 : 100,
    competitors: Object.fromEntries(
      state.market.competitors.map((competitor) => [
        competitor.id,
        totalWeight > 0 ? (competitorWeights[competitor.id] / totalWeight) * 100 : 0,
      ]),
    ),
  }

  return applyInterceptionRoutes(shares, state.market.interceptionRoutes)
}

export function applyInterceptionRoutes(
  shares: MarketShares,
  routes: Record<string, number>,
): MarketShares {
  const competitors = { ...shares.competitors }
  let player = shares.player

  for (const competitorId of Object.keys(routes).sort()) {
    const currentShare = competitors[competitorId]
    if (currentShare === undefined || currentShare <= 0) continue
    const intercepted = Math.min(currentShare, Math.max(0, routes[competitorId]))
    competitors[competitorId] = currentShare - intercepted
    player += intercepted
  }

  return { player, competitors }
}

export function recordMarketSnapshot(
  state: CampaignState,
  cadence: MarketCadence,
  reasons: string[],
): CampaignState {
  const normalized = applyCurrentMarketShares(state)

  return {
    ...normalized,
    market: {
      ...normalized.market,
      history: [
        ...normalized.market.history,
        {
          serviceDay: normalized.serviceDay,
          cadence,
          playerShare: normalized.market.playerShare,
          competitorShares: Object.fromEntries(
            normalized.market.competitors.map(({ id, marketShare }) => [
              id,
              marketShare,
            ]),
          ),
          reasons: [...reasons],
        },
      ],
    },
  }
}

export function applyCurrentMarketShares(state: CampaignState): CampaignState {
  const shares = calculateMarketShares(state)

  return {
    ...state,
    market: {
      ...state.market,
      playerShare: shares.player,
      competitors: state.market.competitors.map((competitor) => ({
        ...competitor,
        marketShare: shares.competitors[competitor.id] ?? 0,
      })),
    },
  }
}
