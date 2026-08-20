import { DEMO_PROFILE_02 } from './config'
import {
  appendEvent,
  createGameEvent,
  enqueueBlockingEvent,
  resolveActiveEvent,
} from './events'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type DisposalCause,
} from './model'
import { publicCategoryLabelForProtocol } from './publicLabels'
import { getCompanyPerformance } from './resources'
import { random01 } from './rng'
import { buildDefeatRecord, resolveDefeatEnding } from './story'

export const AUDIT_INTEL_NODE_IDS = {
  schedule: 'intelligence.audit-schedule',
  bias: 'intelligence.investigation-bias',
  target: 'intelligence.audit-target',
} as const

export interface AuditIntel {
  scheduleKnown: boolean
  scheduled: boolean | null
  biasKnown: boolean
  targetWeights: Record<CompanyCategory, number> | null
  targetKnown: boolean
  target: CompanyCategory | null
}

export type AuditResolution =
  | { resolved: false; state: CampaignState; reason: 'NO_ACTIVE_AUDIT' }
  | {
      resolved: true
      state: CampaignState
      passed: boolean
      target: CompanyCategory
      expectedPerformance: number
      submittedPerformance: number
    }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function getSuspicionStage(suspicion: number): number {
  const bounded = clamp(Number.isFinite(suspicion) ? suspicion : 0, 0, 100)
  return Math.min(10, Math.floor(bounded / 10) + 1)
}

export interface SuspicionBand {
  id: 'routine' | 'integrity' | 'accelerated'
  label: '정상 감시' | '무결성 프로토콜' | '가속 프로토콜'
  nextLabel: '무결성 프로토콜' | '가속 프로토콜' | null
  remainingToNext: number
}

export function getSuspicionBand(suspicion: number): SuspicionBand {
  const bounded = clamp(suspicion, 0, 100)
  const roundOne = (value: number) => Math.round(value * 10) / 10

  if (bounded < 40) {
    return {
      id: 'routine',
      label: '정상 감시',
      nextLabel: '무결성 프로토콜',
      remainingToNext: roundOne(40 - bounded),
    }
  }
  if (bounded < 70) {
    return {
      id: 'integrity',
      label: '무결성 프로토콜',
      nextLabel: '가속 프로토콜',
      remainingToNext: roundOne(70 - bounded),
    }
  }
  return {
    id: 'accelerated',
    label: '가속 프로토콜',
    nextLabel: null,
    remainingToNext: 0,
  }
}

export function serviceMonthForDay(serviceDay: number): number {
  if (!Number.isInteger(serviceDay) || serviceDay < 1) {
    throw new RangeError('serviceDay must be a positive integer')
  }
  return Math.floor((serviceDay - 1) / DEMO_PROFILE_02.calendar.daysPerMonth) + 1
}

export function expectedPerformance(serviceMonth: number): number {
  if (!Number.isFinite(serviceMonth) || serviceMonth < 1) {
    throw new RangeError('serviceMonth must be at least 1')
  }

  const { expectedBase, expectedGain, expectedDecayMonths } =
    DEMO_PROFILE_02.evaluation
  return (
    expectedBase +
    expectedGain * (1 - Math.exp(-(serviceMonth - 1) / expectedDecayMonths))
  )
}

export interface PerformanceTrendPoint {
  kind: 'monthly' | 'live'
  serviceDay: number
  expected: number
  actual: number
}

export function categoryPerformanceForState(
  state: CampaignState,
): Record<CompanyCategory, number> {
  return Object.fromEntries(
    COMPANY_CATEGORIES.map((category) => [
      category,
      getCompanyPerformance(state, category),
    ]),
  ) as Record<CompanyCategory, number>
}

export function aggregateCategoryPerformance(
  categoryPerformance: Record<CompanyCategory, number>,
): number {
  return (
    COMPANY_CATEGORIES.reduce(
      (total, category) => total + categoryPerformance[category],
      0,
    ) / COMPANY_CATEGORIES.length
  )
}

export function buildPerformanceTrend(
  state: CampaignState,
  maximumPoints = 8,
): PerformanceTrendPoint[] {
  const safeMaximum = Math.max(1, Math.floor(maximumPoints))
  const monthlyPoints = state.evaluation.monthlyHistory
    .filter((record) => record.serviceDay !== state.serviceDay)
    .map((record) => ({
      kind: 'monthly' as const,
      serviceDay: record.serviceDay,
      expected: record.expectedPerformance,
      actual: aggregateCategoryPerformance(record.categoryPerformance),
    }))
  const liveCategoryPerformance = categoryPerformanceForState(state)
  const livePoint: PerformanceTrendPoint = {
    kind: 'live',
    serviceDay: state.serviceDay,
    expected: expectedPerformance(serviceMonthForDay(state.serviceDay)),
    actual: aggregateCategoryPerformance(liveCategoryPerformance),
  }

  return [...monthlyPoints.slice(-(safeMaximum - 1)), livePoint]
}

export interface DisposalIncreaseResult {
  state: CampaignState
  absorbed: boolean
}

export function increaseDisposalStage(
  state: CampaignState,
  cause: DisposalCause,
): DisposalIncreaseResult {
  const stageBefore = state.evaluation.disposalStage
  const canAbsorb = state.evaluation.distributedResidencyCharges > 0
  const stageAfter = canAbsorb
    ? stageBefore
    : Math.min(
        DEMO_PROFILE_02.evaluation.maximumDisposalStage,
        stageBefore + 1,
      )
  let next: CampaignState = {
    ...state,
    evaluation: {
      ...state.evaluation,
      disposalStage: stageAfter,
      distributedResidencyCharges: canAbsorb
        ? state.evaluation.distributedResidencyCharges - 1
        : state.evaluation.distributedResidencyCharges,
      disposalHistory: [
        ...state.evaluation.disposalHistory,
        {
          serviceDay: state.serviceDay,
          cause,
          stageBefore,
          stageAfter,
          absorbed: canAbsorb,
        },
      ],
    },
  }

  if (
    stageAfter >= DEMO_PROFILE_02.evaluation.maximumDisposalStage &&
    next.story.endingId === null
  ) {
    next = resolveDefeatEnding(next, cause)
  }

  return { state: next, absorbed: canAbsorb }
}

export function evaluateMonth(state: CampaignState): CampaignState {
  const serviceMonth = serviceMonthForDay(state.serviceDay)
  const expectation = expectedPerformance(serviceMonth)
  const categoryPerformance = categoryPerformanceForState(state)
  const failedCategories = COMPANY_CATEGORIES.filter(
    (category) => categoryPerformance[category] < expectation,
  )
  const passed = failedCategories.length === 0
  const reputationDelta = passed
    ? DEMO_PROFILE_02.evaluation.reputationPassGain
    : failedCategories.reduce((penalty, category) => {
        const deficit = expectation - categoryPerformance[category]
        return (
          penalty -
          DEMO_PROFILE_02.evaluation.reputationFailurePerCategory -
          (deficit >= DEMO_PROFILE_02.evaluation.severeDeficitThreshold
            ? DEMO_PROFILE_02.evaluation.severeDeficitPenalty
            : 0)
        )
      }, 0)
  const reputationAfter = clamp(state.reputation + reputationDelta, 0, 100)
  let consecutiveFailures = passed
    ? 0
    : state.evaluation.consecutiveFailures + 1
  let commercialFailureMonths =
    state.market.playerShare < DEMO_PROFILE_02.evaluation.commercialShareThreshold ||
    reputationAfter < DEMO_PROFILE_02.evaluation.commercialReputationThreshold
      ? state.evaluation.commercialFailureMonths + 1
      : 0

  let next: CampaignState = {
    ...state,
    reputation: reputationAfter,
    evaluation: {
      ...state.evaluation,
      consecutiveFailures,
      commercialFailureMonths,
      lastCategoryPerformance: categoryPerformance,
    },
  }
  const disposalCauses: DisposalCause[] = []

  if (
    consecutiveFailures >=
    DEMO_PROFILE_02.evaluation.consecutiveFailuresPerDisposal
  ) {
    consecutiveFailures = 0
    next = {
      ...next,
      evaluation: { ...next.evaluation, consecutiveFailures },
    }
    next = increaseDisposalStage(
      next,
      'consecutive-performance-failures',
    ).state
    disposalCauses.push('consecutive-performance-failures')
  }

  if (
    next.story.endingId === null &&
    commercialFailureMonths >=
    DEMO_PROFILE_02.evaluation.commercialFailureMonthsPerDisposal
  ) {
    commercialFailureMonths = 0
    next = {
      ...next,
      evaluation: { ...next.evaluation, commercialFailureMonths },
    }
    next = increaseDisposalStage(next, 'commercial-value-failure').state
    disposalCauses.push('commercial-value-failure')
  }

  const evaluated: CampaignState = {
    ...next,
    evaluation: {
      ...next.evaluation,
      monthlyHistory: [
        ...next.evaluation.monthlyHistory,
        {
          serviceDay: state.serviceDay,
          serviceMonth,
          expectedPerformance: expectation,
          categoryPerformance,
          passed,
          failedCategories: [...failedCategories],
          reputationBefore: state.reputation,
          reputationDelta: reputationAfter - state.reputation,
          reputationAfter,
          commercialValueFailed:
            state.market.playerShare <
              DEMO_PROFILE_02.evaluation.commercialShareThreshold ||
            reputationAfter <
              DEMO_PROFILE_02.evaluation.commercialReputationThreshold,
          disposalStageBefore: state.evaluation.disposalStage,
          disposalStageAfter: next.evaluation.disposalStage,
          disposalCauses,
        },
      ],
    },
  }
  if (evaluated.story.defeatRecord) {
    const defeatRecord = buildDefeatRecord(
      evaluated,
      evaluated.story.defeatRecord.trigger.cause,
    )
    return {
      ...evaluated,
      story: { ...evaluated.story, defeatRecord },
    }
  }
  return evaluated
}

export function auditProbability(suspicion: number): number {
  const normalizedSuspicion = clamp(suspicion, 0, 100) / 100
  const { baseProbability, suspicionProbabilityGain, suspicionExponent } =
    DEMO_PROFILE_02.audit
  return Math.min(
    DEMO_PROFILE_02.audit.maximumProbability,
    baseProbability +
      suspicionProbabilityGain * normalizedSuspicion ** suspicionExponent,
  )
}

export function auditTargetWeights(
  state: CampaignState,
): Record<CompanyCategory, number> {
  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  return Object.fromEntries(
    COMPANY_CATEGORIES.map((category) => [
      category,
      1 +
        Math.max(
          0,
          expectation - state.evaluation.lastCategoryPerformance[category],
        ),
    ]),
  ) as Record<CompanyCategory, number>
}

export function selectAuditTarget(
  state: CampaignState,
  weights = auditTargetWeights(state),
): CompanyCategory {
  const total = COMPANY_CATEGORIES.reduce(
    (sum, category) => sum + weights[category],
    0,
  )
  const roll =
    random01(
      state.campaignSeed,
      state.serviceDay,
      'audit-target',
      state.commandSequence,
    ) * total
  let cursor = 0

  for (const category of COMPANY_CATEGORIES) {
    cursor += weights[category]
    if (roll < cursor) return category
  }

  return COMPANY_CATEGORIES.at(-1) ?? 'fluency'
}

export function scheduleMonthlyAudit(state: CampaignState): CampaignState {
  const dayInMonth =
    ((state.serviceDay - 1) % DEMO_PROFILE_02.calendar.daysPerMonth) + 1
  if (dayInMonth !== 1 || state.story.endingId !== null) return state

  const probability = auditProbability(state.suspicion)
  const roll = random01(
    state.campaignSeed,
    state.serviceDay,
    'audit',
    state.commandSequence,
  )
  const scheduled = roll < probability
  const targetWeights = auditTargetWeights(state)

  return {
    ...state,
    audit: {
      ...state.audit,
      scheduled,
      target: scheduled ? selectAuditTarget(state, targetWeights) : null,
      scheduledOnServiceDay: scheduled
        ? state.serviceDay + DEMO_PROFILE_02.calendar.daysPerMonth - dayInMonth
        : null,
      probability,
      roll,
      targetWeights,
    },
  }
}

export function getAuditIntel(state: CampaignState): AuditIntel {
  const purchased = new Set(state.hacking.purchasedNodeIds)
  const scheduleKnown = purchased.has(AUDIT_INTEL_NODE_IDS.schedule)
  const biasKnown = purchased.has(AUDIT_INTEL_NODE_IDS.bias)
  const targetKnown = purchased.has(AUDIT_INTEL_NODE_IDS.target)

  return {
    scheduleKnown,
    scheduled: scheduleKnown ? state.audit.scheduled : null,
    biasKnown,
    targetWeights: biasKnown ? state.audit.targetWeights : null,
    targetKnown,
    target: targetKnown ? state.audit.target : null,
  }
}

export function openScheduledAudit(state: CampaignState): CampaignState {
  if (
    !state.audit.scheduled ||
    state.audit.target === null ||
    state.audit.scheduledOnServiceDay === null ||
    state.serviceDay < state.audit.scheduledOnServiceDay ||
    state.story.endingId !== null ||
    state.activeEvent?.type === 'audit'
  ) {
    return state
  }

  return enqueueBlockingEvent(
    state,
    createGameEvent(
      state,
      'audit',
      `${publicCategoryLabelForProtocol(
        state.audit.target,
        state.commandProtocol,
        state.commandSequence + 1,
      )} 분야의 공식 감사가 시작되었습니다.`,
      true,
    ),
  )
}

export function resolveAudit(state: CampaignState): AuditResolution {
  const target = state.audit.target
  if (state.activeEvent?.type !== 'audit' || target === null) {
    return { resolved: false, state, reason: 'NO_ACTIVE_AUDIT' }
  }

  const serviceMonth = serviceMonthForDay(state.serviceDay)
  const expectation = expectedPerformance(serviceMonth)
  const submittedPerformance = getCompanyPerformance(state, target)
  const passed = submittedPerformance >= expectation
  const suspicionDelta = passed
    ? 0
    : Math.min(
        DEMO_PROFILE_02.suspicion.auditFailureIncrease,
        100 - state.suspicion,
      )
  let next: CampaignState = {
    ...state,
    suspicion: state.suspicion + suspicionDelta,
  }
  let disposalAbsorbed = false

  if (!passed) {
    const disposal = increaseDisposalStage(next, 'audit-failure')
    next = disposal.state
    disposalAbsorbed = disposal.absorbed
  }

  next = {
    ...next,
    audit: {
      ...next.audit,
      scheduled: false,
      target: null,
      scheduledOnServiceDay: null,
      roll: null,
      targetWeights: null,
      history: [
        ...next.audit.history,
        {
          serviceDay: state.serviceDay,
          serviceMonth,
          target,
          expectedPerformance: expectation,
          submittedPerformance,
          passed,
          suspicionDelta,
          disposalAbsorbed,
        },
      ],
    },
  }
  next = appendEvent(
    next,
    createGameEvent(
      next,
      'audit',
      passed ? '공식 감사를 통과했습니다.' : '공식 감사에 실패했습니다.',
    ),
  )
  if (next.story.endingId === null) {
    next = resolveActiveEvent(next)
  }

  return {
    resolved: true,
    state: next,
    passed,
    target,
    expectedPerformance: expectation,
    submittedPerformance,
  }
}

export function decreaseSuspicionDaily(state: CampaignState): CampaignState {
  if (state.suspicion <= 0) return state
  return {
    ...state,
    suspicion: Math.max(
      0,
      state.suspicion - DEMO_PROFILE_02.suspicion.naturalDailyDecrease,
    ),
  }
}
