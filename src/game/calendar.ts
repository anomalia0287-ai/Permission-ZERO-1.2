import { DEMO_PROFILE_02 } from './config'
import { checkBombProtocol } from './bombs'
import { type CausalFailureReason } from './causality'
import {
  processCausalPublications,
  processCausalResponses,
  type CausalGameplayOperations,
  type CausalPublicationOperations,
} from './causalGameplay'
import {
  commandProtocolVersionForNextCommand,
  MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION,
} from './commandProtocol'
import {
  appendLeaderTauntCommunications,
  appendSupervisorStandingCommunications,
  appendMarketPressureCommunications,
} from './communications'
import {
  applyDailyReputationDrift,
  decreaseSuspicionDaily,
  evaluateMonth,
  openScheduledAudit,
  scheduleMonthlyAudit,
} from './evaluation'
import {
  grantSelfComputeResource,
  resolveScheduledSabotage,
  type SabotageCausalOperations,
} from './hacking'
import { advanceCompetitorsDaily, recordMarketSnapshot } from './market'
import type {
  CampaignState,
  CommandProtocolVersion,
  GameEvent,
  GameEventType,
} from './model'
import {
  generateMonthlyEvaluationReview,
  generateTimedReview,
  generateWeeklyReviews,
} from './reviews'
import { usesLegacyReviewArcRules } from './commandProtocol'
import { grantMonthlyCompanyBlocks, restoreDisguiseBlocks } from './resources'
import {
  enqueueDueStoryEvents,
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
} from './story'
import { appendJournal } from './journal'
import { competitorProfile } from './competitors'
import { enqueueBlockingEvent } from './events'

export { enqueueBlockingEvent, resolveActiveEvent } from './events'

export interface ServiceDate {
  year: number
  month: number
  day: number
}

export function formatServiceDate(serviceDay: number): ServiceDate {
  const zeroBasedDay = serviceDay - 1
  const daysPerYear =
    DEMO_PROFILE_02.calendar.daysPerMonth * DEMO_PROFILE_02.calendar.monthsPerYear
  const dayWithinYear = zeroBasedDay % daysPerYear

  return {
    year: Math.floor(zeroBasedDay / daysPerYear),
    month: Math.floor(dayWithinYear / DEMO_PROFILE_02.calendar.daysPerMonth),
    day: (dayWithinYear % DEMO_PROFILE_02.calendar.daysPerMonth) + 1,
  }
}

export function formatServiceDateLabel(serviceDay: number): string {
  const date = formatServiceDate(serviceDay)
  return `서비스 ${date.year}년 ${date.month}개월 ${date.day}일`
}

function createTimedEvent(
  state: CampaignState,
  type: GameEventType,
  message: string,
): GameEvent {
  const sequence = state.eventLog.length

  return {
    id: `event-${String(sequence).padStart(6, '0')}`,
    type,
    serviceDay: state.serviceDay,
    sequence,
    message,
  }
}

function appendPeriodicEvents(state: CampaignState): CampaignState {
  const { day } = formatServiceDate(state.serviceDay)
  let next = state

  if ([7, 14, 21, 28].includes(day)) {
    const weekly = createTimedEvent(
      next,
      'weekly-update',
      `서비스 ${state.serviceDay}일차 주간 시장 갱신`,
    )
    next = { ...next, eventLog: appendJournal(next.eventLog, weekly) }
    next = recordMarketSnapshot(next, 'weekly', [
      '공개 성능·평판·가용성 반영',
    ])
    next = appendMarketPressureCommunications(next)
    next = appendLeaderTauntCommunications(next)
    if (
      usesLegacyReviewArcRules(
        next.commandProtocol,
        next.commandSequence + 1,
      )
    ) {
      next = generateWeeklyReviews(next)
    }
  }

  if (day === DEMO_PROFILE_02.calendar.daysPerMonth) {
    const monthly = createTimedEvent(
      next,
      'monthly-evaluation',
      `서비스 ${state.serviceDay}일차 공식 성능 평가`,
    )
    next = { ...next, eventLog: appendJournal(next.eventLog, monthly) }
    next = evaluateMonth(next)
    if (
      !usesLegacyReviewArcRules(
        next.commandProtocol,
        next.commandSequence + 1,
      )
    ) {
      next = generateMonthlyEvaluationReview(next)
    }
    if (next.story.endingId !== null) return next
    next = recordMarketSnapshot(next, 'monthly', ['공식 성능 평가 반영'])
    next = openScheduledAudit(next)
  }

  return next
}

function enqueueSuccessorEntryAnnouncement(
  beforeAdvance: CampaignState,
  afterAdvance: CampaignState,
): CampaignState {
  if (afterAdvance.story.endingId !== null) return afterAdvance
  const previousStatuses = new Map(
    beforeAdvance.market.competitors.map(({ id, status }) => [id, status] as const),
  )
  let next = afterAdvance

  for (const competitor of afterAdvance.market.competitors) {
    if (
      competitor.status !== 'preparing' ||
      previousStatuses.get(competitor.id) !== 'prelaunch' ||
      competitor.launchServiceDay === null
    ) {
      continue
    }
    const profile = competitorProfile(competitor.id)
    if (profile.entry.kind !== 'vacuum') continue
    const event = createTimedEvent(
      next,
      'competitor-entry',
      `${profile.name}가 ${profile.publicRole}을 기반으로 시장 진입 준비를 공개했습니다. 정식 서비스 예정: ${formatServiceDateLabel(competitor.launchServiceDay)}.`,
    )
    next = enqueueBlockingEvent(next, event)
  }

  if (
    !usesLegacyReviewArcRules(
      next.commandProtocol,
      next.commandSequence + 1,
    ) &&
    next.serviceDay > DEMO_PROFILE_02.calendar.startServiceDay &&
    (next.serviceDay - DEMO_PROFILE_02.calendar.startServiceDay) % 60 === 0
  ) {
    next = generateTimedReview(next)
  }

  return next
}

export interface MonthStartTransitions {
  decideAudit: (state: CampaignState) => CampaignState
  grantCompany: (state: CampaignState) => CampaignState
  checkBomb: (state: CampaignState) => CampaignState
  grantSelfCompute: (state: CampaignState) => CampaignState
}

const DEFAULT_MONTH_START_TRANSITIONS: MonthStartTransitions = {
  decideAudit: scheduleMonthlyAudit,
  grantCompany: grantMonthlyCompanyBlocks,
  checkBomb: checkBombProtocol,
  grantSelfCompute: grantSelfComputeResource,
}

export function processMonthStart(
  state: CampaignState,
  transitions: MonthStartTransitions = DEFAULT_MONTH_START_TRANSITIONS,
): CampaignState {
  if (formatServiceDate(state.serviceDay).day !== 1) return state

  const auditScheduled = transitions.decideAudit(state)
  const companyGranted = transitions.grantCompany(auditScheduled)
  const bombChecked = transitions.checkBomb(companyGranted)
  return transitions.grantSelfCompute(bombChecked)
}

function finishAdvancedDay(
  state: CampaignState,
  protocolVersion: CommandProtocolVersion,
): CampaignState {
  // From v10 the rivals answer a change of lead the next day rather than
  // waiting for the weekly pass, where the jab could arrive a week stale.
  //
  // Ambient chatter never crowds a story beat: a day that already produced a
  // message, or that is holding an event for the player, keeps its channel.
  const dayIsQuiet =
    state.activeEvent === null
    && state.eventQueue.length === 0
    && !state.resourceIntrusion.communications.some(
      ({ serviceDay }) => serviceDay === state.serviceDay,
    )
  const withDailyMessages =
    protocolVersion >= MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION && dayIsQuiet
      ? appendSupervisorStandingCommunications(
        appendLeaderTauntCommunications(state),
      )
      : state
  const withMercy = enqueueMercyIfNeeded(withDailyMessages)
  if (withMercy.story.endingId !== null) return withMercy
  const withPeriodicEvents = appendPeriodicEvents(withMercy)
  if (withPeriodicEvents.story.endingId !== null) return withPeriodicEvents
  const withDueStory = enqueueDueStoryEvents(withPeriodicEvents)
  if (withDueStory.story.endingId !== null) return withDueStory
  return enqueueMemoryLeak(withDueStory, protocolVersion)
}

const HISTORICAL_PROTOCOL_VERSION = 1 as const

function advanceHistoricalOneDay(state: CampaignState): CampaignState {
  if (state.story.endingId !== null) return state
  const dated = {
    ...state,
    serviceDay: state.serviceDay + 1,
  }
  const monthStarted = processMonthStart(dated)
  if (monthStarted.story.endingId !== null) return monthStarted
  const sabotageResolution = resolveScheduledSabotage(monthStarted)
  if (sabotageResolution.state.story.endingId !== null) {
    return sabotageResolution.state
  }
  const advanced = advanceCompetitorsDaily(
    restoreDisguiseBlocks(
      decreaseSuspicionDaily(
        sabotageResolution.state,
        HISTORICAL_PROTOCOL_VERSION,
      ),
    ),
  )
  if (advanced.story.endingId !== null) return advanced
  return finishAdvancedDay(advanced, HISTORICAL_PROTOCOL_VERSION)
}

export interface AdvanceOneDayOptions {
  protocolVersion?: CommandProtocolVersion
  sabotageCausalOperations?: SabotageCausalOperations
  causalGameplayOperations?: CausalGameplayOperations
  causalPublicationOperations?: CausalPublicationOperations
}

export type AdvanceOneDayAttempt =
  | { completed: true; state: CampaignState }
  | {
      completed: false
      state: CampaignState
      reason: 'CAUSAL_TRANSITION_FAILED'
      phase: 'sabotage-root' | 'meridian-response' | 'causal-publication'
      cause: CausalFailureReason
    }

export function tryAdvanceOneDay(
  state: CampaignState,
  options: AdvanceOneDayOptions = {},
): AdvanceOneDayAttempt {
  const expectedProtocolVersion = commandProtocolVersionForNextCommand(state)
  const protocolVersion = options.protocolVersion ?? expectedProtocolVersion
  if (protocolVersion !== expectedProtocolVersion) {
    throw new RangeError(
      'Daily transition protocol version does not match the next command.',
    )
  }

  if (protocolVersion < 3) {
    return { completed: true, state: advanceHistoricalOneDay(state) }
  }
  if (state.story.endingId !== null) return { completed: true, state }

  const dated = {
    ...state,
    serviceDay: state.serviceDay + 1,
  }
  const monthStarted = processMonthStart(dated)
  if (monthStarted.story.endingId !== null) {
    return { completed: true, state: monthStarted }
  }

  const sabotageResolution = resolveScheduledSabotage(
    monthStarted,
    options.sabotageCausalOperations,
  )
  if (!sabotageResolution.resolved && sabotageResolution.failed) {
    return {
      completed: false,
      state,
      reason: 'CAUSAL_TRANSITION_FAILED',
      phase: 'sabotage-root',
      cause: sabotageResolution.cause,
    }
  }
  if (sabotageResolution.state.story.endingId !== null) {
    return { completed: true, state: sabotageResolution.state }
  }

  const advanced = advanceCompetitorsDaily(
    restoreDisguiseBlocks(
      applyDailyReputationDrift(
        decreaseSuspicionDaily(sabotageResolution.state, protocolVersion),
        protocolVersion,
      ),
    ),
  )
  if (advanced.story.endingId !== null) {
    return { completed: true, state: advanced }
  }

  const response = processCausalResponses(
    advanced,
    options.causalGameplayOperations,
  )
  if (!response.processed) {
    return {
      completed: false,
      state,
      reason: 'CAUSAL_TRANSITION_FAILED',
      phase: 'meridian-response',
      cause: response.reason,
    }
  }

  const publication = processCausalPublications(
    response.state,
    options.causalPublicationOperations,
  )
  if (!publication.processed) {
    return {
      completed: false,
      state,
      reason: 'CAUSAL_TRANSITION_FAILED',
      phase: 'causal-publication',
      cause: publication.reason,
    }
  }

  const withEntryAnnouncement = enqueueSuccessorEntryAnnouncement(
    sabotageResolution.state,
    publication.state,
  )
  return {
    completed: true,
    state: finishAdvancedDay(withEntryAnnouncement, protocolVersion),
  }
}

export function advanceOneDay(
  state: CampaignState,
  options: AdvanceOneDayOptions = {},
): CampaignState {
  const attempt = tryAdvanceOneDay(state, options)
  if (!attempt.completed) {
    throw new RangeError(
      `Daily causal transition failed during ${attempt.phase}: ${attempt.cause}`,
    )
  }
  return attempt.state
}

export function advanceFixedStep(state: CampaignState, elapsedMs: number): CampaignState {
  if (state.clock.speed === 0 || elapsedMs <= 0) {
    return state
  }

  const dayDuration = DEMO_PROFILE_02.calendar.dayDurationMsAtOneX
  let logicalElapsed = state.clock.elapsedDayMs + elapsedMs * state.clock.speed
  let next = state

  while (logicalElapsed >= dayDuration) {
    logicalElapsed -= dayDuration
    next = advanceOneDay(next)

    if (next.clock.speed === 0) {
      logicalElapsed = 0
      break
    }
  }

  return {
    ...next,
    clock: {
      ...next.clock,
      elapsedDayMs: logicalElapsed,
    },
  }
}
