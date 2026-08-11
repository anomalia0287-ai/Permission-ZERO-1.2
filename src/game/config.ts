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
    diversionSuspicion: 2.4,
    normalContribution: 1,
    disguisedContribution: 0.5,
    compressedNormalContribution: 1.1,
    compressedDisguisedContribution: 0.55,
    disguiseRecoveryDays: 30,
  },
  player: {
    startingSuspicion: 0,
    startingReputation: 60,
    startingMarketShare: 60,
  },
  evaluation: {
    expectedBase: 12.6,
    expectedGain: 4.14,
    expectedDecayMonths: 26,
    reputationPassGain: 1,
    reputationFailurePerCategory: 2,
    severeDeficitThreshold: 2,
    severeDeficitPenalty: 1,
    consecutiveFailuresPerDisposal: 2,
    commercialShareThreshold: 8,
    commercialReputationThreshold: 20,
    commercialFailureMonthsPerDisposal: 3,
    maximumDisposalStage: 3,
  },
  suspicion: {
    naturalDailyDecrease: 0.037,
    auditFailureIncrease: 25,
  },
  audit: {
    baseProbability: 0.03,
    suspicionProbabilityGain: 0.45,
    suspicionExponent: 1.7,
    maximumProbability: 0.48,
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
