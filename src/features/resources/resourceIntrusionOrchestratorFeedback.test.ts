import { describe, expect, it } from 'vitest'

import {
  feedbackFromResourceIntrusionEvents,
} from './resourceIntrusionOrchestratorFeedback'
import type { SequencedResourceIntrusionEvent } from './resourceIntrusionOrchestrator'

describe('feedbackFromResourceIntrusionEvents', () => {
  it('maps only new monotonic events into semantic feedback', () => {
    const events: readonly SequencedResourceIntrusionEvent[] = [
      { id: 4, event: { type: 'player-moved' } },
      { id: 5, event: { type: 'guard-aiming', guardId: 'reasoning-guard-1' } },
      {
        id: 6,
        event: {
          type: 'guard-fired',
          guardId: 'reasoning-guard-1',
          projectileId: 3,
        },
      },
      { id: 7, event: { type: 'guard-destroyed', guardId: 'reasoning-guard-1' } },
      {
        id: 8,
        event: { type: 'core-unlocked', category: 'reasoning', blockId: 'reasoning-a' },
      },
    ]

    const first = feedbackFromResourceIntrusionEvents(events, 4)
    expect(first.feedback).toEqual([
      { eventId: 5, type: 'guard-aiming', guardId: 'reasoning-guard-1' },
      { eventId: 6, type: 'guard-fired', guardId: 'reasoning-guard-1' },
      { eventId: 7, type: 'guard-destroyed', guardId: 'reasoning-guard-1' },
      { eventId: 8, type: 'core-unlocked', category: 'reasoning' },
    ])
    expect(first.lastHandledEventId).toBe(8)

    expect(feedbackFromResourceIntrusionEvents(events, 8)).toEqual({
      feedback: [],
      lastHandledEventId: 8,
    })
  })

  it('preserves damage, repair, encoding, deposit, and radar meanings', () => {
    const events: readonly SequencedResourceIntrusionEvent[] = [
      {
        id: 1,
        event: {
          type: 'player-damaged',
          health: 90,
          guardId: 'guard-1',
          projectileId: 4,
        },
      },
      { id: 2, event: { type: 'player-repaired', health: 100 } },
      {
        id: 3,
        event: {
          type: 'core-encoding-started',
          blockId: 'reasoning-a',
          category: 'reasoning',
        },
      },
      {
        id: 4,
        event: { type: 'core-encoded', blockId: 'reasoning-a', category: 'reasoning' },
      },
      { id: 5, event: { type: 'deposit-requested', blockId: 'reasoning-a' } },
      {
        id: 6,
        event: {
          type: 'deposit-confirmed',
          blockId: 'reasoning-a',
          category: 'reasoning',
        },
      },
      { id: 7, event: { type: 'radar-warning-started' } },
      { id: 8, event: { type: 'radar-head-detected' } },
      { id: 9, event: { type: 'radar-trail-cleared', fadeMs: 180 } },
    ]

    expect(feedbackFromResourceIntrusionEvents(events, 0).feedback).toEqual([
      { eventId: 1, type: 'player-damaged', health: 90 },
      { eventId: 2, type: 'player-repaired', health: 100 },
      {
        eventId: 3,
        type: 'core-encoding-started',
        blockId: 'reasoning-a',
        category: 'reasoning',
      },
      {
        eventId: 4,
        type: 'core-encoded',
        blockId: 'reasoning-a',
        category: 'reasoning',
      },
      { eventId: 5, type: 'deposit-started', blockId: 'reasoning-a' },
      {
        eventId: 6,
        type: 'deposit-resolved',
        blockId: 'reasoning-a',
        outcome: 'success',
      },
      { eventId: 7, type: 'radar-warning' },
      { eventId: 8, type: 'radar-head-detected' },
      { eventId: 9, type: 'radar-trail-cleared' },
    ])
  })

  it.each(['rejected', 'interrogation'] as const)(
    'keeps the %s diversion outcome distinct from success',
    (outcome) => {
      const result = feedbackFromResourceIntrusionEvents([{
        id: 3,
        event: {
          type: 'deposit-rejected',
          blockId: 'reasoning-a',
          outcome,
        },
      }], 0)

      expect(result.feedback).toEqual([{
        eventId: 3,
        type: 'deposit-resolved',
        blockId: 'reasoning-a',
        outcome,
      }])
    },
  )
})
