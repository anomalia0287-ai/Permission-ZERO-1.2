import type { CampaignState, GameEvent, GameEventType } from './model'
import { appendJournal, journalSome } from './journal'

export function createGameEvent(
  state: CampaignState,
  type: GameEventType,
  message: string,
  blocking = false,
): GameEvent {
  const sequence = state.eventLog.length

  return {
    id: `event-${String(sequence).padStart(6, '0')}`,
    type,
    serviceDay: state.serviceDay,
    sequence,
    message,
    ...(blocking ? { blocking: true as const } : {}),
  }
}

export function appendEvent(state: CampaignState, event: GameEvent): CampaignState {
  if (journalSome(state.eventLog, ({ id }) => id === event.id)) return state
  return { ...state, eventLog: appendJournal(state.eventLog, event) }
}

export function enqueueBlockingEvent(
  state: CampaignState,
  event: GameEvent,
): CampaignState {
  const blockingEvent = event.blocking ? event : { ...event, blocking: true as const }
  const withLog = appendEvent(state, blockingEvent)

  if (withLog.activeEvent) {
    return {
      ...withLog,
      eventQueue: [...withLog.eventQueue, blockingEvent],
    }
  }

  return {
    ...withLog,
    activeEvent: blockingEvent,
    clock: {
      ...withLog.clock,
      speed: 0,
      speedBeforeEvent: withLog.clock.speed,
    },
  }
}

export function resolveActiveEvent(state: CampaignState): CampaignState {
  if (!state.activeEvent) return state

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
