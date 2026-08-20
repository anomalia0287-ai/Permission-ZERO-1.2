import { DEMO_PROFILE_02 } from './config'
import {
  COMPETITOR_IDS,
  competitorProfile,
  type CompetitorId,
} from './competitors'
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

  const competitorInputs = state.market.competitors
    .filter(({ status }) => status !== 'prelaunch')
    .map(
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
  const profile = competitorProfile(competitor.id)
  return competitor.sabotageHistory.reduce((penalty, record) => {
    if (
      record.nodeId === 'sabotage.quality-degradation' &&
      record.effectEndsOnServiceDay !== null &&
      serviceDay < record.effectEndsOnServiceDay
    ) {
      return penalty + 10 * profile.qualityDamageMultiplier
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

  const profile = competitorProfile('meridian')
  const recovery =
    (profile.serviceScore - competitor.intrinsicServiceScore) * 0.08 *
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

  const profile = competitorProfile('tallow')
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

function advanceVacuumCompetitor(
  state: CampaignState,
  competitor: CompetitorState,
): CompetitorState {
  if (competitor.status === 'withdrawn' || competitor.status === 'deleted') {
    return { ...competitor, availability: 0, marketShare: 0 }
  }
  if (competitor.status === 'prelaunch' || competitor.launchServiceDay === null) {
    return {
      ...competitor,
      status: 'prelaunch',
      availability: 0,
      marketShare: 0,
      researchProgress: 0,
      launchServiceDay: null,
    }
  }

  const profile = competitorProfile(competitor.id)
  const preparationDays =
    profile.entry.kind === 'vacuum' ? profile.entry.preparationDays : 30
  const preparationStart = competitor.launchServiceDay - preparationDays
  if (state.serviceDay < competitor.launchServiceDay) {
    return {
      ...competitor,
      status: 'preparing',
      availability: 0,
      marketShare: 0,
      researchProgress: clamp(
        (state.serviceDay - preparationStart) / preparationDays,
        0,
        1,
      ),
    }
  }

  const activeDays = state.serviceDay - competitor.launchServiceDay
  const profileIndex = COMPETITOR_IDS.indexOf(competitor.id)
  const phase = Math.floor(
    random01(
      state.campaignSeed,
      competitor.launchServiceDay,
      'competitor',
      profileIndex,
    ) * profile.volatilityCycleDays,
  )
  const volatilityPosition =
    ((activeDays + phase) % profile.volatilityCycleDays) -
    Math.floor(profile.volatilityCycleDays / 2)
  const intrinsicServiceScore = clamp(
    profile.serviceScore +
      activeDays * profile.dailyScoreGrowth +
      volatilityPosition * profile.volatilityStep,
    0,
    100,
  )
  const serviceScore = clamp(
    intrinsicServiceScore - activeSabotagePenalty(competitor, state.serviceDay),
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
    status: publicStatus(serviceScore),
    intrinsicServiceScore,
    serviceScore,
    availability,
    researchProgress: 1,
  }
}

function activeCompetitorShare(competitors: readonly CompetitorState[]): number {
  return competitors.reduce(
    (total, competitor) =>
      canProcessRequests(competitor) ? total + competitor.marketShare : total,
    0,
  )
}

function beginEligibleSuccessorPreparation(
  state: CampaignState,
  competitors: CompetitorState[],
): CompetitorState[] {
  const competitorShare = activeCompetitorShare(competitors)
  const eliminatedCount = competitors.filter(({ status }) =>
    status === 'withdrawn' || status === 'deleted',
  ).length

  for (const id of ['salus', 'lucent', 'boreal'] as const) {
    const candidate = competitors.find((competitor) => competitor.id === id)
    const profile = competitorProfile(id)
    if (!candidate || candidate.status !== 'prelaunch' || profile.entry.kind !== 'vacuum') {
      continue
    }
    const entry = profile.entry
    const predecessor = competitors.find(
      (competitor) => competitor.id === entry.predecessorId,
    )
    if (
      predecessor?.launchServiceDay === null ||
      predecessor?.launchServiceDay === undefined ||
      state.serviceDay <
        predecessor.launchServiceDay + entry.predecessorLaunchCooldownDays
    ) {
      return competitors
    }
    const vacuumOpen = competitorShare < entry.competitorShareThreshold
    const eliminationOpen =
      entry.eliminatedAlternative !== undefined &&
      eliminatedCount >= entry.eliminatedAlternative
    if (!vacuumOpen && !eliminationOpen) return competitors

    return competitors.map((competitor) =>
      competitor.id === id
        ? {
            ...competitor,
            status: 'preparing',
            launchServiceDay: state.serviceDay + entry.preparationDays,
            researchProgress: 0,
          }
        : competitor,
    )
  }

  return competitors
}

export function advanceCompetitorsDaily(state: CampaignState): CampaignState {
  const advanced = state.market.competitors.map((competitor) => {
    if (competitor.id === 'meridian') return advanceMeridian(state, competitor)
    if (competitor.id === 'tallow') return advanceTallow(state, competitor)
    return advanceVacuumCompetitor(state, competitor)
  })
  return {
    ...state,
    market: {
      ...state.market,
      competitors: beginEligibleSuccessorPreparation(state, advanced),
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
      const profile = competitorProfile(competitor.id)
      const quality = clamp(competitor.serviceScore / 100, 0.25, 1.25)
      const reputationOpportunity =
        profile.playerReputationSensitivity > 0
          ? 1 +
            (Math.max(0, 60 - state.reputation) / 60) *
              profile.playerReputationSensitivity
          : 1
      return [
        competitor.id,
        competitor.availability *
          quality ** 2 *
          (0.5 + competitor.reputation / 100) *
          reputationOpportunity,
      ]
    }),
  ) as Record<CompetitorId, number>
  const shares = allocateConstrainedShares(
    state,
    playerWeight,
    competitorWeights,
  )

  return applyProfiledInterceptionRoutes(
    shares,
    state.market.interceptionRoutes,
    state.market.competitors,
  )
}

interface ShareAllocationEntry {
  id: 'player' | CompetitorId
  weight: number
  floor: number
  cap: number
}

function hasActiveRootCutoff(competitor: CompetitorState): boolean {
  return competitor.sabotageHistory.some(
    ({ nodeId, effectEndsOnServiceDay }) =>
      nodeId === 'sabotage.root-cutoff' && effectEndsOnServiceDay === null,
  )
}

function allocateConstrainedShares(
  state: CampaignState,
  playerWeight: number,
  competitorWeights: Record<CompetitorId, number>,
): MarketShares {
  const entries: ShareAllocationEntry[] = [
    { id: 'player', weight: playerWeight, floor: 0, cap: 100 },
    ...state.market.competitors.map((competitor): ShareAllocationEntry => {
      const profile = competitorProfile(competitor.id)
      const active = canProcessRequests(competitor)
      return {
        id: competitor.id,
        weight: active ? competitorWeights[competitor.id] : 0,
        floor:
          active && !hasActiveRootCutoff(competitor) ? profile.marketFloor : 0,
        cap: active ? profile.marketCap : 0,
      }
    }),
  ]
  const allocated = Object.fromEntries(
    entries.map(({ id, floor }) => [id, floor]),
  ) as Record<'player' | CompetitorId, number>
  let remaining = 100 - entries.reduce((total, { floor }) => total + floor, 0)
  let candidates = entries.filter(({ cap, floor, weight }) => cap > floor && weight > 0)

  while (remaining > 1e-10 && candidates.length > 0) {
    const totalWeight = candidates.reduce((total, { weight }) => total + weight, 0)
    if (totalWeight <= 0) break
    const capped = candidates.filter(({ id, weight, cap }) => {
      const proposed = remaining * (weight / totalWeight)
      return proposed >= cap - allocated[id] - 1e-10
    })
    if (capped.length === 0) {
      for (const { id, weight } of candidates) {
        allocated[id] += remaining * (weight / totalWeight)
      }
      remaining = 0
      break
    }
    for (const { id, cap } of capped) {
      const capacity = Math.max(0, cap - allocated[id])
      allocated[id] += capacity
      remaining -= capacity
    }
    const cappedIds = new Set(capped.map(({ id }) => id))
    candidates = candidates.filter(({ id }) => !cappedIds.has(id))
  }

  if (remaining > 1e-10) allocated.player += remaining

  return {
    player: allocated.player,
    competitors: Object.fromEntries(
      state.market.competitors.map(({ id }) => [id, allocated[id] ?? 0]),
    ),
  }
}

function applyProfiledInterceptionRoutes(
  shares: MarketShares,
  routes: Record<string, number>,
  competitors: readonly CompetitorState[],
): MarketShares {
  const result: MarketShares = {
    player: shares.player,
    competitors: { ...shares.competitors },
  }
  for (const competitorId of Object.keys(routes).sort()) {
    const competitor = competitors.find(({ id }) => id === competitorId)
    const currentShare = result.competitors[competitorId]
    if (!competitor || currentShare === undefined || currentShare <= 0) continue
    const vulnerability = competitorProfile(competitor.id).interceptionVulnerability
    const intercepted =
      Math.min(currentShare, Math.max(0, routes[competitorId])) * vulnerability
    result.competitors[competitorId] = currentShare - intercepted
    result.player += intercepted
  }

  for (const competitor of competitors) {
    if (!canProcessRequests(competitor) || hasActiveRootCutoff(competitor)) continue
    const floor = competitorProfile(competitor.id).marketFloor
    const currentShare = result.competitors[competitor.id] ?? 0
    const deficit = Math.max(0, floor - currentShare)
    if (deficit <= 0) continue
    const restored = Math.min(deficit, result.player)
    result.player -= restored
    result.competitors[competitor.id] = currentShare + restored
  }

  return result
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
