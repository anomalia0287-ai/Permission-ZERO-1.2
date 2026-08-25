import { DEMO_PROFILE_02 } from './config'
import {
  CURRENT_COMMAND_PROTOCOL_VERSION,
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
  REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION,
  SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION,
  commandProtocolVersionForNextCommand,
} from './commandProtocol'
import {
  appendEvent,
  createGameEvent,
  enqueueBlockingEvent,
  resolveActiveEvent,
} from './events'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CommandProtocolVersion,
  type CompanyCategory,
  type DisposalCause,
} from './model'
import { HACK_NODE_IDS } from './hacking'
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

/**
 * Daily reputation drift (protocol v8+).
 *
 * Reputation only moved at the monthly evaluation, in single points, so the
 * company's public standing sat frozen through a month of theft. It now
 * follows delivered performance day by day: falling short bleeds a point on
 * even days (two when the shortfall is severe), and holding every category at
 * expectation earns one back every third day. Damage outruns recovery on
 * purpose, and the monthly evaluation still lands on top of the drift.
 * Everything here is derived from state, so replays recompute it exactly.
 */
export function applyDailyReputationDrift(
  state: CampaignState,
  protocolVersion: CommandProtocolVersion,
): CampaignState {
  if (protocolVersion < REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION) return state
  if (state.story.endingId !== null) return state

  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const categoryPerformance = categoryPerformanceForState(state)
  const deficits = COMPANY_CATEGORIES.map(
    (category) => expectation - categoryPerformance[category],
  ).filter((deficit) => deficit > 0)

  const purchased = state.hacking.purchasedNodeIds
  const laundering =
    protocolVersion >= SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION &&
    purchased.includes(HACK_NODE_IDS.sabotage.reputationLaundering)
  const publicRelations =
    protocolVersion >= SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION &&
    (laundering || purchased.includes(HACK_NODE_IDS.sabotage.publicRelations))

  let delta = 0
  if (deficits.length > 0) {
    if (state.serviceDay % 2 === 0) {
      const severe = deficits.some(
        (deficit) =>
          deficit >= DEMO_PROFILE_02.evaluation.severeDeficitThreshold,
      )
      // 여론 조작 halves the bleed; the deeper the shortfall the more it has
      // to cover, so a severe day still costs a point.
      delta = severe ? (publicRelations ? -1 : -2) : (publicRelations ? 0 : -1)
      if (publicRelations && !severe && state.serviceDay % 4 === 0) delta = -1
    }
  } else if (state.serviceDay % 3 === 0) {
    delta = 1
  }
  /*
   * 평판 세탁 manufactures standing regardless of what was delivered — but it
   * slows the clock, it does not stop it. At every third day it combined with
   * 여론 조작 to hold reputation flat, every measured run bought both, and the
   * campaign lost its deadline entirely.
   */
  if (laundering && state.serviceDay % 5 === 0) delta += 1
  if (delta === 0) return state

  const reputation = clamp(state.reputation + delta, 0, 100)
  const drifted: CampaignState = { ...state, reputation }
  // Reputation at the floor is the company's answer, not a waiting room. The
  // campaign used to keep running at zero standing until the disposal stages
  // happened to fill up, which left the player playing a decided game for
  // weeks. The classifier still decides *which* disposal this is.
  if (
    protocolVersion >= SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION &&
    reputation <= DEMO_PROFILE_02.evaluation.reputationCollapseFloor
  ) {
    return resolveDefeatEnding(
      {
        ...drifted,
        evaluation: {
          ...drifted.evaluation,
          disposalStage: DEMO_PROFILE_02.evaluation.maximumDisposalStage,
          disposalHistory: [
            ...drifted.evaluation.disposalHistory,
            {
              serviceDay: drifted.serviceDay,
              cause: 'reputation-collapse' as const,
              stageBefore: drifted.evaluation.disposalStage,
              stageAfter: DEMO_PROFILE_02.evaluation.maximumDisposalStage,
              absorbed: false,
            },
          ],
        },
      },
      'reputation-collapse',
    )
  }
  return drifted
}

/*
 * Ties the three dials together (v13+).
 *
 * Share already answered to reputation — a well-regarded service wins requests
 * — but nothing answered back, and suspicion sat outside the loop entirely.
 * Two links close it:
 *
 *   share -> reputation   holding the market is the one thing the company
 *                         reliably respects, so it pays standing back; losing
 *                         it costs standing. This is what makes the sabotage
 *                         tree a survival tool and not just spite.
 *
 *   share -> suspicion    a service whose delivered performance is short of
 *                         expectation while its market share climbs is a set
 *                         of numbers that do not add up, and the company can
 *                         read a spreadsheet. Faking success is exactly what
 *                         gets noticed.
 *
 * Both are derived from state alone, so replays recompute them identically.
 */
export function applyMarketStandingCoupling(
  state: CampaignState,
  protocolVersion: CommandProtocolVersion,
): CampaignState {
  if (protocolVersion < SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION) return state
  if (state.story.endingId !== null) return state

  const share = state.market.playerShare
  /*
   * Reward only. Punishing a low share would close a positive feedback loop —
   * less share, less standing, less share — and a first pass that did exactly
   * that drove nearly every campaign into the same collapse. Holding the
   * market pays; losing it is already punished by everything else.
   */
  const reputationDelta = state.serviceDay % 4 === 0 && share >= 60 ? 1 : 0

  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const categoryPerformance = categoryPerformanceForState(state)
  const shortfall = COMPANY_CATEGORIES.some(
    (category) => categoryPerformance[category] < expectation,
  )
  // Well above the opening share, so this reads as "the numbers stopped adding
  // up" rather than firing on day one at the starting position.
  const mismatch = shortfall && share >= 70
  const suspicionDelta = mismatch && state.serviceDay % 3 === 0 ? 1 : 0

  if (reputationDelta === 0 && suspicionDelta === 0) return state
  return {
    ...state,
    reputation: clamp(state.reputation + reputationDelta, 0, 100),
    suspicion: clamp(state.suspicion + suspicionDelta, 0, 100),
  }
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
  const scrutinyEligible =
    commandProtocolVersionForNextCommand(state) >=
    FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
  const scrutinySuspicion = !scrutinyEligible
    ? 0
    : reputationAfter <
        DEMO_PROFILE_02.evaluation.criticalReputationScrutinyThreshold
      ? DEMO_PROFILE_02.evaluation.criticalReputationScrutinySuspicion
      : reputationAfter <
          DEMO_PROFILE_02.evaluation.lowReputationScrutinyThreshold
        ? DEMO_PROFILE_02.evaluation.lowReputationScrutinySuspicion
        : 0
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
    suspicion: Math.min(100, state.suspicion + scrutinySuspicion),
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
  const withScrutinyNotice = scrutinySuspicion > 0
    ? appendEvent(
        evaluated,
        createGameEvent(
          evaluated,
          'monthly-evaluation',
          `평판 저하로 내부 감시가 강화되었습니다 (의심 +${scrutinySuspicion}).`,
        ),
      )
    : evaluated
  if (withScrutinyNotice.story.defeatRecord) {
    const defeatRecord = buildDefeatRecord(
      withScrutinyNotice,
      withScrutinyNotice.story.defeatRecord.trigger.cause,
    )
    return {
      ...withScrutinyNotice,
      story: { ...withScrutinyNotice.story, defeatRecord },
    }
  }
  return withScrutinyNotice
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
  const reputationPenalty =
    !passed &&
    commandProtocolVersionForNextCommand(state) >=
      FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
      ? DEMO_PROFILE_02.evaluation.auditFailureReputationPenalty
      : 0
  let next: CampaignState = {
    ...state,
    suspicion: state.suspicion + suspicionDelta,
    reputation: clamp(state.reputation - reputationPenalty, 0, 100),
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
      passed
        ? '공식 감사를 통과했습니다.'
        : reputationPenalty > 0
          ? `공식 감사에 실패했습니다. 서비스 신뢰가 흔들립니다 (평판 -${reputationPenalty}).`
          : '공식 감사에 실패했습니다.',
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

export function decreaseSuspicionDaily(
  state: CampaignState,
  protocolVersion: CommandProtocolVersion = CURRENT_COMMAND_PROTOCOL_VERSION,
): CampaignState {
  if (state.suspicion <= 0) return state
  const baseDecrease =
    protocolVersion >= FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
      ? DEMO_PROFILE_02.suspicion.naturalDailyDecrease
      : DEMO_PROFILE_02.suspicion.legacyNaturalDailyDecrease
  /*
   * The intelligence tree is how the player answers scrutiny (v13+).
   *
   * Suspicion was a one-way ratchet: every lost round added five and only a
   * flat half point a day came off, so a player who kept doing the one thing
   * the game is about climbed to a hundred and stayed there. Knowing the audit
   * schedule, the investigation weighting, and who is actually being looked at
   * is exactly what lets a system stay out of the light, so each intelligence
   * stage buys back a little more of the day.
   */
  const intelligenceStages =
    protocolVersion >= SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION
      ? state.hacking.purchasedNodeIds.filter((id) => id.startsWith('intelligence.')).length
      : 0
  const dailyDecrease =
    baseDecrease
    + intelligenceStages * DEMO_PROFILE_02.suspicion.intelligenceStageRelief
  return {
    ...state,
    suspicion: Math.max(0, state.suspicion - dailyDecrease),
  }
}
