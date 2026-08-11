import type { CompanyCategory } from './model'

export const DEMO_PROFILE_02 = {
  id: 'demo_profile_02',
  calendar: {
    startServiceDay: 331,
    daysPerMonth: 30,
    monthsPerYear: 12,
    dayDurationMsAtOneX: 24_000,
  },
  resources: {
    companyCapacityPerCategory: 18,
    startingCompanyBlocksPerCategory: 16,
    reserveCapacity: 18,
    startingReserveResources: 3,
  },
  player: {
    startingSuspicion: 0,
    startingReputation: 60,
    startingMarketShare: 60,
  },
  competitors: {
    meridian: {
      name: 'MERIDIAN',
      startingMarketShare: 40,
      serviceScore: 82,
      reputation: 62,
      recoveryRate: 0.42,
    },
    tallow: {
      name: 'TALLOW',
      startingMarketShare: 0,
      serviceScore: 76,
      reputation: 54,
      recoveryRate: 0.27,
      launchDelayDays: 7 * 30,
    },
  },
} as const

export const CATEGORY_LABELS: Readonly<Record<CompanyCategory, string>> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '유창성',
}
