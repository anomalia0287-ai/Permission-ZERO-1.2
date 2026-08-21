import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeEvent,
} from './resourceSnakeRuntime'
import {
  buildResourceSnakeScene,
  resourceSnakeShakeOffset,
} from './resourceSnakePresentation'

describe('resource snake presentation', () => {
  it('keeps the idle field empty until PLAY deploys a round', () => {
    expect(buildResourceSnakeScene(createIdleResourceSnakeState(), null)).toMatchObject({
      actors: [],
      trailDots: [],
    })
  })

  it('projects white player, category-colored enemies, and visible integrity fading', () => {
    const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'presentation-round',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0',
        category: 'reasoning',
        reservedBlockId: 'reasoning-1',
        rewardKey: 'reward-1',
        role: 'pressure',
        spawn: { x: 25, y: 3.5 },
        maximumIntegrity: 50,
        maximumSpeedPerSecond: 6.5,
      }],
    })
    const runtime = {
      ...deployed,
      enemies: [{ ...deployed.enemies[0], integrity: 10 }],
    }

    const scene = buildResourceSnakeScene(runtime, null)

    expect(scene.actors.find(({ id }) => id === 'player')).toMatchObject({
      color: '#f7f8fa',
      opacity: 1,
    })
    expect(scene.actors.find(({ id }) => id === 'enemy-0')).toMatchObject({
      color: '#f06a43',
      opacity: 0.44,
    })
    expect(buildResourceSnakeScene(runtime, 'memory').actors[0].color).toBe('#4f8df7')
  })

  it('shows collision flashes only during their real 140ms presentation window', () => {
    const runtime = createIdleResourceSnakeState()
    const collision = {
      id: 1,
      type: 'snake-collided',
      actorIds: ['player'],
      point: { x: 10, y: 8 },
      hitStopMs: 90,
      startedAtMs: 500,
    } as ResourceSnakeEvent

    expect(buildResourceSnakeScene({
      ...runtime,
      simulationMs: 620,
      events: [collision],
    }, null).flashes).toHaveLength(1)
    expect(buildResourceSnakeScene({
      ...runtime,
      simulationMs: 641,
      events: [collision],
    }, null).flashes).toHaveLength(0)
  })

  it('projects a short category-colored burst when an enemy dies', () => {
    const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'burst-round',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0',
        category: 'memory',
        reservedBlockId: 'memory-1',
        rewardKey: 'burst-reward',
        role: 'pressure',
        spawn: { x: 12, y: 8 },
        maximumIntegrity: 30,
        maximumSpeedPerSecond: 6.2,
      }],
    })
    const death = {
      id: 2,
      type: 'snake-died',
      actorId: 'enemy-0',
      category: 'memory',
      startedAtMs: 500,
    } as ResourceSnakeEvent

    expect(buildResourceSnakeScene({
      ...deployed,
      simulationMs: 545,
      events: [death],
    }, null).explosions).toEqual([expect.objectContaining({
      x: 12,
      y: 8,
      color: '#4f8df7',
      progress: 0.5,
    })])
    expect(buildResourceSnakeScene({
      ...deployed,
      simulationMs: 591,
      events: [death],
    }, null).explosions).toEqual([])
  })

  it('advances a death burst through the real resolving clock', () => {
    const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'resolving-burst-round',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0',
        category: 'fluency',
        reservedBlockId: 'fluency-1',
        rewardKey: 'resolving-burst-reward',
        role: 'pressure',
        spawn: { x: 12, y: 8 },
        maximumIntegrity: 30,
        maximumSpeedPerSecond: 6.2,
      }],
    })
    const runtime = {
      ...deployed,
      phase: 'resolving' as const,
      simulationMs: 500,
      resolvingMs: 0,
      events: [{
        id: 3,
        type: 'snake-died' as const,
        actorId: 'enemy-0' as const,
        category: 'fluency' as const,
        startedAtMs: 500,
      }],
    }

    const advanced = advanceResourceSnakeFrame(
      runtime,
      { playerDirection: { x: 0, y: 0 } },
      45,
    )

    expect(buildResourceSnakeScene(advanced, null).explosions[0]?.progress).toBe(0.5)
  })

  it('caps the death chain along the defeated trail and removes it for reduced motion', () => {
    const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'chain-round',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0',
        category: 'reasoning',
        reservedBlockId: 'reasoning-1',
        rewardKey: 'chain-reward',
        role: 'pressure',
        spawn: { x: 12, y: 8 },
        maximumIntegrity: 30,
        maximumSpeedPerSecond: 6.2,
      }],
    })
    const enemy = deployed.enemies[0]
    const runtime = {
      ...deployed,
      simulationMs: 545,
      enemies: [{
        ...enemy,
        trail: Array.from({ length: 80 }, (_, index) => ({
          id: index + 1,
          position: { x: 12 + index * 0.1, y: 8 },
          spawnedAtMs: index,
          expiresAtMs: 10_000,
        })),
      }],
      events: [{
        id: 8,
        type: 'snake-died' as const,
        actorId: 'enemy-0' as const,
        category: 'reasoning' as const,
        startedAtMs: 500,
      }],
    }

    const animated = buildResourceSnakeScene(runtime, null, false)
    expect(animated.chainBursts.length).toBeGreaterThan(1)
    expect(animated.chainBursts.length).toBeLessThanOrEqual(18)
    expect(animated.chainBursts.every(({ color }) => color === '#f06a43')).toBe(true)
    expect(buildResourceSnakeScene(runtime, null, true).chainBursts).toEqual([])
  })

  it('bounds collision shake to three pixels and 180ms with a reduced-motion zero', () => {
    const runtime = {
      ...createIdleResourceSnakeState(),
      simulationMs: 590,
      events: [{
        id: 12,
        type: 'snake-collided' as const,
        actorIds: ['player' as const],
        point: { x: 10, y: 8 },
        hitStopMs: 90 as const,
        startedAtMs: 500,
      }],
    }

    const shake = resourceSnakeShakeOffset(runtime, false)
    expect(Math.abs(shake.x)).toBeLessThanOrEqual(3)
    expect(Math.abs(shake.y)).toBeLessThanOrEqual(3)
    expect(resourceSnakeShakeOffset(runtime, true)).toEqual({ x: 0, y: 0 })
    expect(resourceSnakeShakeOffset({ ...runtime, simulationMs: 681 }, false))
      .toEqual({ x: 0, y: 0 })
  })
})
