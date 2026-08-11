import { DEMO_PROFILE_02 } from './config'
import type { CampaignState, GameEvent, GameEventType } from './model'

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
  }

  if (day === DEMO_PROFILE_02.calendar.daysPerMonth) {
    const monthly = createTimedEvent(
      next,
      'monthly-evaluation',
      `서비스 ${state.serviceDay}일차 공식 성능 평가`,
    )
    next = { ...next, eventLog: [...next.eventLog, monthly] }
  }

  return next
}

export function advanceOneDay(state: CampaignState): CampaignState {
  return appendPeriodicEvents({
    ...state,
    serviceDay: state.serviceDay + 1,
  })
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

export function enqueueBlockingEvent(state: CampaignState, event: GameEvent): CampaignState {
  const blockingEvent = event.blocking ? event : { ...event, blocking: true as const }
  const eventLog = state.eventLog.some(({ id }) => id === blockingEvent.id)
    ? state.eventLog
    : [...state.eventLog, blockingEvent]

  if (state.activeEvent) {
    return {
      ...state,
      eventQueue: [...state.eventQueue, blockingEvent],
      eventLog,
    }
  }

  return {
    ...state,
    activeEvent: blockingEvent,
    eventLog,
    clock: {
      ...state.clock,
      speed: 0,
      speedBeforeEvent: state.clock.speed,
    },
  }
}

export function resolveActiveEvent(state: CampaignState): CampaignState {
  if (!state.activeEvent) {
    return state
  }

  const [nextEvent, ...remainingEvents] = state.eventQueue

  if (nextEvent) {
    return {
      ...state,
      activeEvent: nextEvent,
      eventQueue: remainingEvents,
    }
  }

  return {
    ...state,
    activeEvent: null,
    eventQueue: [],
    clock: {
      ...state.clock,
      speed: state.clock.speedBeforeEvent ?? 0,
      speedBeforeEvent: null,
    },
  }
}
