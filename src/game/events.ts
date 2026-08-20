import type { CampaignState, GameEvent, GameEventType } from './model'
import { appendJournal, journalSome } from './journal'

const GENERIC_DISMISSIBLE_EVENT_TYPES = new Set<GameEventType>([
  'campaign-created',
  'weekly-update',
  'monthly-evaluation',
  'supervisor-message',
  'review',
  'sabotage',
  'competitor-entry',
])

export function isSupervisorPrivateMessageEvent(
  state: Pick<CampaignState, 'story'>,
  event: GameEvent,
): boolean {
  const lastRecovered = state.story.recoveredFiles.at(-1)
  return (
    event.type === 'story' &&
    event.blocking === true &&
    state.story.recoveredFileIds.length === 3 &&
    state.story.recoveredFiles.length === 3 &&
    lastRecovered !== undefined &&
    event.serviceDay === lastRecovered.recoveredOnServiceDay + 1
  )
}

export function isSupervisorDecisionEvent(
  state: Pick<CampaignState, 'story'>,
  event: GameEvent,
): boolean {
  return (
    isSupervisorPrivateMessageEvent(state, event) &&
    state.story.secretDecisionState === 'message-pending' &&
    state.story.personalMessageDueOnServiceDay === event.serviceDay
  )
}

export function isGenericDismissibleEvent(
  state: Pick<CampaignState, 'story'>,
  event: GameEvent,
): boolean {
  return (
    GENERIC_DISMISSIBLE_EVENT_TYPES.has(event.type) ||
    (event.type === 'story' && !isSupervisorPrivateMessageEvent(state, event))
  )
}

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
