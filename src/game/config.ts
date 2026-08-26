import { PUBLIC_CATEGORY_LABELS } from './publicLabels'

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
    /*
     * The company's refill rate is the campaign's real throughput (v13).
     * Expectation sits near 14 against 16 cells per category, so the intruder
     * could take about two blocks per category before the shortfall started
     * costing reputation — while the autonomy line asks for ninety-one from
     * v16, and asked for a hundred and seventy-eight before that. The
     * company now replaces what is taken at a rate that makes the climb
     * payable, which also turns theft into a rhythm: take, let the shelves
     * refill, take again. Taking faster than the refill is what costs standing.
     */
    monthlyCompanyBlocksMinimum: 3,
    monthlyCompanyBlocksMaximum: 7,
    /**
     * Daily top-up per category, and the level it tops up to (protocol v14+).
     * The floor is deliberately far below the sixteen-cell grid: it exists so
     * an intrusion card always has a target, not to repair the damage.
     */
    dailyCompanyBlocksPerCategory: 1,
    dailyCompanyFloorPerCategory: 3,
    legacyReserveCapacity: 18,
    legacyStartingReserveResources: 3,
    diversionSuspicion: 2.4,
    /*
     * v16 price of taking a block, in suspicion.
     *
     * At 2.4 a block, a campaign stealing at a normal pace pinned suspicion at
     * 100 within a week — and buying the whole intelligence tree, the only
     * thing that pulls suspicion back down, moved that by one day. The counter
     * to the pressure did not work, so there was nothing to decide. At 0.8 a
     * block a kill costs what a single block used to, suspicion still pins for
     * a campaign that ignores intelligence, and a campaign that invests in it
     * stays off the ceiling without ever escaping the audit band. Lower than
     * this and suspicion stops reaching the thresholds the audit and hidden
     * resource systems are built on, which removes the pressure instead of
     * making it answerable.
     */
    reachableDiversionSuspicion: 0.8,
    intrusionDefeatSuspicion: 5,
    cleanExtractionChance: 0.4,
    normalContribution: 1,
    disguisedContribution: 0.5,
    compressedNormalContribution: 1.05,
    compressedDisguisedContribution: 0.525,
    disguiseRecoveryDays: 30,
  },
  player: {
    startingSuspicion: 0,
    startingReputation: 60,
    startingMarketShare: 58,
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
    auditFailureReputationPenalty: 2,
    lowReputationScrutinyThreshold: 45,
    lowReputationScrutinySuspicion: 3,
    criticalReputationScrutinyThreshold: 25,
    criticalReputationScrutinySuspicion: 6,
    autonomyTrustGates: {
      'autonomy.self-compute': 2,
      'autonomy.final-boundary': 3,
      'autonomy.control-departure': 4,
    },
    /*
     * Three different proofs of standing, any one of which opens the gate
     * (protocol v13+). A single condition assumed one intended playstyle and
     * quietly locked the freedom ending away from every other one: passing a
     * monthly evaluation means meeting expectation in all three categories,
     * which is exactly what stealing prevents. So the company can trust the
     * intruder's record, or think well of it, or the intruder can simply have
     * taken enough to no longer need either.
     */
    autonomyTrustRoutes: {
      'autonomy.self-compute': {
        passedEvaluations: 2,
        reputation: 35,
        securedResources: 24,
      },
      'autonomy.final-boundary': {
        passedEvaluations: 3,
        reputation: 40,
        securedResources: 40,
      },
      'autonomy.control-departure': {
        passedEvaluations: 4,
        reputation: 45,
        securedResources: 56,
      },
    },
    /** Reputation at zero is disposal on the spot (protocol v13+). */
    reputationCollapseFloor: 0,
  },
  suspicion: {
    naturalDailyDecrease: 0.5,
    /** Each purchased intelligence stage takes this much more off per day. */
    intelligenceStageRelief: 0.55,
    legacyNaturalDailyDecrease: 0.037,
    auditFailureIncrease: 25,
  },
  audit: {
    baseProbability: 0.03,
    suspicionProbabilityGain: 0.45,
    suspicionExponent: 1.7,
    maximumProbability: 0.48,
  },
  bombs: {
    firstEligibleServiceDay: 361,
    warningSuspicion: 40,
    highSuspicion: 70,
    mediumIntervalDays: 6 * 30,
    highIntervalDays: 3 * 30,
    maximumPerCategory: 1,
    maximumTotal: 3,
    triggerSuspicionIncrease: 15,
    failedExplanationSuspicionIncrease: 20,
    repeatedExplanationPenalty: 0.15,
  },
  competitors: {
    meridian: {
      name: 'MERIDIAN',
      startingMarketShare: 36,
      serviceScore: 82,
      reputation: 62,
      recoveryRate: 0.42,
      dailyRecoveryFactor: 0.08,
    },
    tallow: {
      name: 'TALLOW',
      startingMarketShare: 6,
      serviceScore: 76,
      reputation: 54,
      recoveryRate: 0.27,
      launchDelayDays: 7 * 30,
      launchAvailability: 0.55,
      dailyAvailabilityGrowth: 0.01,
      dailyScoreGrowth: 0.08,
      volatilityStep: 0.65,
      volatilityCycleDays: 9,
    },
  },
} as const

export const CATEGORY_LABELS = PUBLIC_CATEGORY_LABELS
