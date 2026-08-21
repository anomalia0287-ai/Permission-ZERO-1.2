import { describe, expect, it } from 'vitest'

import type { ResourceSnakeTelegraph } from './resourceSnakeAiController'
import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeEvent,
  type ResourceSnakeRoundState,
} from './resourceSnakeRuntime'
import {
  buildResourceSnakeScene,
  RESOURCE_SNAKE_PALETTE,
  resourceSnakeShakeOffset,
} from './resourceSnakePresentation'

function deployedRound(): ResourceSnakeRoundState {
  return deployResourceSnakeRound(createIdleResourceSnakeState(), {
    roundId: 'presentation-round',
    playerSpawn: { x: 25, y: 21 },
    enemies: [
      {
        id: 'enemy-0',
        category: 'reasoning',
        reservedBlockId: 'reasoning-1',
        rewardKey: 'reward-1',
        role: 'pressure',
        spawn: { x: 13, y: 3.5 },
        maximumIntegrity: 50,
        maximumSpeedPerSecond: 12.2,
      },
      {
        id: 'enemy-1',
        category: 'memory',
        reservedBlockId: 'memory-1',
        rewardKey: 'reward-2',
        role: 'blocker',
        spawn: { x: 37, y: 3.5 },
        maximumIntegrity: 50,
        maximumSpeedPerSecond: 11.8,
      },
    ],
  })
}

describe('resource snake presentation', () => {
  it('keeps the idle industrial field free of phantom cores and rails', () => {
    expect(buildResourceSnakeScene(createIdleResourceSnakeState(), null)).toMatchObject({
      cores: [],
      rails: [],
      telegraphs: [],
      contacts: [],
      fragments: [],
      powerCuts: [],
    })
  })

  it('projects exact continuous rail vertices and heading-oriented angular cores', () => {
    const deployed = deployedRound()
    const runtime: ResourceSnakeRoundState = {
      ...deployed,
      phase: 'active',
      simulationMs: 720,
      player: {
        ...deployed.player,
        phase: 'active',
        position: { x: 29, y: 17 },
        heading: 'north-east',
        railVertices: [
          { x: 25, y: 21 },
          { x: 27, y: 21 },
          { x: 27, y: 19 },
        ],
      },
      enemies: deployed.enemies.map((enemy, index) => ({
        ...enemy,
        phase: 'active' as const,
        heading: index === 0 ? 'south-west' as const : 'east' as const,
      })),
    }

    const scene = buildResourceSnakeScene(runtime, 'memory')
    const player = scene.cores.find(({ id }) => id === 'player')
    const pressure = scene.cores.find(({ id }) => id === 'enemy-0')
    const blocker = scene.cores.find(({ id }) => id === 'enemy-1')
    const playerRail = scene.rails.find(({ actorId }) => actorId === 'player')

    expect(player).toMatchObject({
      color: RESOURCE_SNAKE_PALETTE.player,
      silhouette: 'operator',
      glyph: '00',
    })
    expect(player?.headingRadians).toBeCloseTo(-Math.PI / 4, 8)
    expect(pressure).toMatchObject({
      color: RESOURCE_SNAKE_PALETTE.cyan,
      silhouette: 'pressure',
      glyph: 'P',
    })
    expect(blocker).toMatchObject({
      color: RESOURCE_SNAKE_PALETTE.cyan,
      silhouette: 'blocker',
      glyph: 'B',
    })
    expect(playerRail?.points).toEqual([
      { x: 25, y: 21 },
      { x: 27, y: 21 },
      { x: 27, y: 19 },
      { x: 29, y: 17 },
    ])
    expect(scene.rails.every(({ points }) => points.length >= 2)).toBe(true)
  })

  it('keeps damaged cyan cores readable instead of fading them into the floor', () => {
    const deployed = deployedRound()
    const runtime: ResourceSnakeRoundState = {
      ...deployed,
      enemies: deployed.enemies.map((enemy, index) => (
        index === 0 ? { ...enemy, integrity: 5 } : enemy
      )),
    }

    const pressure = buildResourceSnakeScene(runtime, null).cores
      .find(({ id }) => id === 'enemy-0')

    expect(pressure?.integrityRatio).toBe(0.1)
    expect(pressure?.opacity).toBeGreaterThanOrEqual(0.62)
  })

  it('preserves the exact cyan attack telegraph in reduced-motion mode', () => {
    const runtime = { ...deployedRound(), phase: 'active' as const, simulationMs: 500 }
    const telegraph: ResourceSnakeTelegraph = {
      enemyId: 'enemy-0',
      role: 'pressure',
      originHeading: 'south',
      attackHeading: 'south-west',
      startedAtMs: 440,
      untilMs: 620,
      path: [
        { x: 13, y: 4.5 },
        { x: 13, y: 5.5 },
        { x: 12, y: 6.5 },
      ],
    }

    const animated = buildResourceSnakeScene(runtime, null, false, [telegraph])
    const reduced = buildResourceSnakeScene(runtime, null, true, [telegraph])

    expect(animated.telegraphs).toEqual([
      expect.objectContaining({
        id: 'telegraph:enemy-0:440',
        enemyId: 'enemy-0',
        role: 'pressure',
        points: telegraph.path,
        progress: expect.closeTo(1 / 3, 5),
        attackHeadingRadians: expect.closeTo(3 * Math.PI / 4, 8),
        animated: true,
      }),
    ])
    expect(reduced.telegraphs).toEqual([
      expect.objectContaining({
        points: telegraph.path,
        animated: false,
      }),
    ])
  })

  it('gives contact and rail power-cut signals finite presentation windows', () => {
    const deployed = deployedRound()
    const collision = {
      id: 4,
      type: 'snake-collided',
      actorIds: ['player', 'enemy-0'],
      point: { x: 10, y: 8 },
      hitStopMs: 90,
      startedAtMs: 500,
    } as ResourceSnakeEvent

    const active = buildResourceSnakeScene({
      ...deployed,
      simulationMs: 620,
      events: [collision],
    }, null)
    const expired = buildResourceSnakeScene({
      ...deployed,
      simulationMs: 761,
      events: [collision],
    }, null)

    expect(active.contacts).toEqual([
      expect.objectContaining({ x: 10, y: 8, progress: expect.closeTo(2 / 3, 5) }),
    ])
    expect(active.powerCuts.map(({ actorId }) => actorId).sort()).toEqual([
      'enemy-0',
      'player',
    ])
    expect(expired.contacts).toEqual([])
    expect(expired.powerCuts).toEqual([])
  })

  it('breaks a dead rail into bounded fragments but substitutes a static glyph for reduced motion', () => {
    const deployed = deployedRound()
    const death = {
      id: 9,
      type: 'snake-died',
      actorId: 'enemy-0',
      category: 'reasoning',
      startedAtMs: 500,
    } as ResourceSnakeEvent
    const enemy = deployed.enemies[0]
    const runtime = {
      ...deployed,
      simulationMs: 740,
      enemies: [
        {
          ...enemy,
          railVertices: Array.from({ length: 30 }, (_, index) => ({
            x: 8 + index * 0.3,
            y: 6 + (index % 2),
          })),
        },
        deployed.enemies[1],
      ],
      events: [death],
    }

    const animated = buildResourceSnakeScene(runtime, null, false)
    const reduced = buildResourceSnakeScene(runtime, null, true)

    expect(animated.explosions).toEqual([
      expect.objectContaining({
        actorId: 'enemy-0',
        color: RESOURCE_SNAKE_PALETTE.cyan,
        progress: expect.closeTo(4 / 7, 5),
      }),
    ])
    expect(animated.fragments.length).toBeGreaterThan(4)
    expect(animated.fragments.length).toBeLessThanOrEqual(18)
    expect(reduced.fragments).toEqual([])
    expect(reduced.explosions).toHaveLength(1)
    expect(buildResourceSnakeScene({ ...runtime, simulationMs: 921 }, null).explosions)
      .toEqual([])
  })

  it('advances a death signal through the real resolving clock', () => {
    const deployed = deployedRound()
    const runtime: ResourceSnakeRoundState = {
      ...deployed,
      phase: 'resolving' as const,
      simulationMs: 500,
      resolvingMs: 0,
      events: [{
        id: 12,
        type: 'snake-died' as const,
        actorId: 'enemy-0' as const,
        category: 'fluency' as const,
        startedAtMs: 500,
      }],
    }

    const advanced = [100, 100, 10].reduce<ResourceSnakeRoundState>(
      (current, deltaMs) => advanceResourceSnakeFrame(
        current,
        { playerDirection: { x: 0, y: 0 } },
        deltaMs,
      ),
      runtime,
    )

    expect(buildResourceSnakeScene(advanced, null).explosions[0]?.progress).toBe(0.5)
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
