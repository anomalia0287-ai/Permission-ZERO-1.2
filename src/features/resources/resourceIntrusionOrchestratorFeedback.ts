import type { CompanyCategory } from '../../game/model'
import type {
  ResourceIntrusionDiversionOutcome,
  ResourceIntrusionEvent,
  SequencedResourceIntrusionEvent,
} from './resourceIntrusionOrchestrator'

export type ResourceIntrusionFeedback =
  | { eventId: number; type: 'moved' }
  | { eventId: number; type: 'guard-activated'; category: CompanyCategory }
  | { eventId: number; type: 'guard-aiming'; guardId: string }
  | { eventId: number; type: 'guard-fired'; guardId: string }
  | { eventId: number; type: 'guard-destroyed'; guardId: string }
  | { eventId: number; type: 'core-unlocked'; category: CompanyCategory }
  | {
      eventId: number
      type: 'core-encoding-started'
      blockId: string
      category: CompanyCategory
    }
  | {
      eventId: number
      type: 'core-encoded'
      blockId: string
      category: CompanyCategory
    }
  | { eventId: number; type: 'player-damaged'; health: number }
  | { eventId: number; type: 'player-repaired'; health: number }
  | { eventId: number; type: 'player-destroyed' }
  | { eventId: number; type: 'player-reconstructed' }
  | { eventId: number; type: 'deposit-started'; blockId: string }
  | {
      eventId: number
      type: 'deposit-resolved'
      blockId: string
      outcome: ResourceIntrusionDiversionOutcome['kind']
    }
  | { eventId: number; type: 'radar-warning' }
  | { eventId: number; type: 'radar-head-detected' }
  | { eventId: number; type: 'radar-trail-cleared' }

export interface ResourceIntrusionFeedbackBatch {
  feedback: readonly ResourceIntrusionFeedback[]
  lastHandledEventId: number
}

function feedbackForEvent(
  id: number,
  event: ResourceIntrusionEvent,
): ResourceIntrusionFeedback | null {
  switch (event.type) {
    case 'player-moved':
      return { eventId: id, type: 'moved' }
    case 'warning-started':
      return { eventId: id, type: 'guard-activated', category: event.category }
    case 'guard-aiming':
      return { eventId: id, type: 'guard-aiming', guardId: event.guardId }
    case 'guard-fired':
      return { eventId: id, type: 'guard-fired', guardId: event.guardId }
    case 'guard-destroyed':
      return { eventId: id, type: 'guard-destroyed', guardId: event.guardId }
    case 'core-unlocked':
      return { eventId: id, type: 'core-unlocked', category: event.category }
    case 'core-encoding-started':
      return {
        eventId: id,
        type: 'core-encoding-started',
        blockId: event.blockId,
        category: event.category,
      }
    case 'core-encoded':
      return {
        eventId: id,
        type: 'core-encoded',
        blockId: event.blockId,
        category: event.category,
      }
    case 'player-damaged':
      return { eventId: id, type: 'player-damaged', health: event.health }
    case 'player-repaired':
      return { eventId: id, type: 'player-repaired', health: event.health }
    case 'player-destroyed':
      return { eventId: id, type: 'player-destroyed' }
    case 'player-reconstructed':
      return { eventId: id, type: 'player-reconstructed' }
    case 'deposit-requested':
      return { eventId: id, type: 'deposit-started', blockId: event.blockId }
    case 'deposit-confirmed':
      return {
        eventId: id,
        type: 'deposit-resolved',
        blockId: event.blockId,
        outcome: 'success',
      }
    case 'deposit-rejected':
      return {
        eventId: id,
        type: 'deposit-resolved',
        blockId: event.blockId,
        outcome: event.outcome,
      }
    case 'radar-head-detected':
      return { eventId: id, type: 'radar-head-detected' }
    case 'radar-warning-started':
      return { eventId: id, type: 'radar-warning' }
    case 'radar-trail-cleared':
      return { eventId: id, type: 'radar-trail-cleared' }
    default:
      return null
  }
}

export function feedbackFromResourceIntrusionEvents(
  events: readonly SequencedResourceIntrusionEvent[],
  lastHandledEventId: number,
): ResourceIntrusionFeedbackBatch {
  let nextLastHandledEventId = lastHandledEventId
  const feedback: ResourceIntrusionFeedback[] = []
  for (const { id, event } of events) {
    if (id <= lastHandledEventId) continue
    nextLastHandledEventId = Math.max(nextLastHandledEventId, id)
    const mapped = feedbackForEvent(id, event)
    if (mapped) feedback.push(mapped)
  }
  return { feedback, lastHandledEventId: nextLastHandledEventId }
}
