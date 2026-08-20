import { describe, expect, it } from 'vitest'

import {
  createResourceIntrusionRuntime,
  type IntrusionFieldResource,
} from './resourceIntrusionRuntime'
import { deriveResourceIntrusionFeedback } from './resourceIntrusionFeedback'

const reasoningResource: IntrusionFieldResource = {
  blockId: 'reasoning-a',
  origin: 'reasoning',
  contribution: 'normal',
}

describe('deriveResourceIntrusionFeedback', () => {
  it('emits movement only when the logical player coordinate changes', () => {
    const previous = createResourceIntrusionRuntime('feedback-movement', [])
    const moved = {
      ...previous,
      player: { x: previous.player.x + 1, y: previous.player.y },
    }

    expect(deriveResourceIntrusionFeedback(previous, moved)).toEqual([
      { type: 'moved' },
    ])
    expect(deriveResourceIntrusionFeedback(previous, previous)).toEqual([])
  })

  it('emits compression, disabled-resource, damage, and reconstruction semantics', () => {
    const idle = createResourceIntrusionRuntime(
      'feedback-combat',
      [reasoningResource],
    )
    const actor = idle.combat.actors.get(reasoningResource.blockId)!
    const compressed = {
      ...idle,
      combat: {
        ...idle.combat,
        compressionSequence: 1,
        lastCompression: {
          sequence: 1,
          polygon: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 1, y: 5 }],
          hitBlockIds: [reasoningResource.blockId],
          startedAtMs: 10,
        },
        actors: new Map(idle.combat.actors).set(reasoningResource.blockId, {
          ...actor,
          health: 0,
          phase: 'salvage' as const,
        }),
        playerHealth: 2,
      },
    }

    expect(deriveResourceIntrusionFeedback(idle, compressed)).toEqual([
      { type: 'compression-resolved', hitCount: 1 },
      { type: 'resource-disabled', blockId: reasoningResource.blockId },
      { type: 'player-damaged', health: 2 },
    ])

    const reconstructed = {
      ...compressed,
      combat: {
        ...compressed.combat,
        playerHealth: 3,
        respawnCount: 1,
      },
    }
    expect(deriveResourceIntrusionFeedback(compressed, reconstructed)).toEqual([
      { type: 'player-disabled' },
    ])
  })

  it('emits a distinct automatic salvage collection event', () => {
    const idle = createResourceIntrusionRuntime(
      'feedback-salvage',
      [reasoningResource],
    )
    const carrying = { ...idle, carriedBlockId: reasoningResource.blockId }

    expect(deriveResourceIntrusionFeedback(idle, carrying)).toEqual([
      { type: 'salvage-collected', blockId: reasoningResource.blockId },
    ])
  })

  it('emits deposit-started when a carried block enters diversion', () => {
    const idle = createResourceIntrusionRuntime('feedback-deposit-start', [])
    const carrying = { ...idle, carriedBlockId: 'reasoning-a' }
    const pending = {
      ...carrying,
      carriedBlockId: null,
      pendingDiversion: { blockId: 'reasoning-a', commandSequence: 7 },
    }

    expect(deriveResourceIntrusionFeedback(carrying, pending)).toEqual([
      { type: 'deposit-started' },
    ])
  })

  it('emits the resolved diversion outcome once pending diversion clears', () => {
    const idle = createResourceIntrusionRuntime('feedback-deposit-resolve', [])
    const pending = {
      ...idle,
      pendingDiversion: { blockId: 'reasoning-a', commandSequence: 7 },
    }
    const resolved = { ...pending, pendingDiversion: null }

    expect(
      deriveResourceIntrusionFeedback(
        pending,
        resolved,
        { kind: 'success', origin: 'reasoning' },
      ),
    ).toEqual([{ type: 'deposit-resolved', outcome: 'success' }])
  })

  it.each(['interrogation', 'rejected'] as const)(
    'preserves the %s diversion outcome instead of reporting success',
    (kind) => {
      const idle = createResourceIntrusionRuntime(`feedback-${kind}`, [])
      const pending = {
        ...idle,
        pendingDiversion: { blockId: 'reasoning-a', commandSequence: 7 },
      }
      const resolved = { ...pending, pendingDiversion: null }

      expect(
        deriveResourceIntrusionFeedback(pending, resolved, { kind }),
      ).toEqual([{ type: 'deposit-resolved', outcome: kind }])
    },
  )
})
