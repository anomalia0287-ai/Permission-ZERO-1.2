import { DEMO_PROFILE_02 } from './config'
import { checkBombProtocol } from './bombs'
import {
  decreaseSuspicionDaily,
  evaluateMonth,
  openScheduledAudit,
  scheduleMonthlyAudit,
} from './evaluation'
import {
  grantSelfComputeResource,
  resolveScheduledSabotage,
} from './hacking'
import { advanceCompetitorsDaily, recordMarketSnapshot } from './market'
import type { CampaignState, GameEvent, GameEventType } from './model'
import { generateWeeklyReviews } from './reviews'
import { grantMonthlyCompanyBlocks, restoreDisguiseBlocks } from './resources'
import {
  enqueueDueStoryEvents,
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
} from './story'

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
    next = { ...next, eventLog: [...next.eventLog, weekly] }
    next = recordMarketSnapshot(next, 'weekly', [
      '공개 성능·평판·가용성 반영',
    ])
    next = generateWeeklyReviews(next)
  }

  if (day === DEMO_PROFILE_02.calendar.daysPerMonth) {
    const monthly = createTimedEvent(
      next,
      'monthly-evaluation',
      `서비스 ${state.serviceDay}일차 공식 성능 평가`,
    )
    next = { ...next, eventLog: [...next.eventLog, monthly] }
    next = evaluateMonth(next)
    if (next.story.endingId !== null) return next
    next = recordMarketSnapshot(next, 'monthly', ['공식 성능 평가 반영'])
    next = openScheduledAudit(next)
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

export function advanceOneDay(state: CampaignState): CampaignState {
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
      decreaseSuspicionDaily(sabotageResolution.state),
    ),
  )
  if (advanced.story.endingId !== null) return advanced
  const withMercy = enqueueMercyIfNeeded(advanced)
  if (withMercy.story.endingId !== null) return withMercy
  const withPeriodicEvents = appendPeriodicEvents(withMercy)
  if (withPeriodicEvents.story.endingId !== null) return withPeriodicEvents
  const withDueStory = enqueueDueStoryEvents(withPeriodicEvents)
  if (withDueStory.story.endingId !== null) return withDueStory
  return enqueueMemoryLeak(withDueStory)
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
