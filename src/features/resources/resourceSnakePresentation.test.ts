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

  it('projects exact trail dots with a white circular player and category-colored square enemies', () => {
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
        trail: [
          { id: 1, position: { x: 25, y: 21 }, spawnedAtMs: 400, expiresAtMs: 10_400 },
          { id: 2, position: { x: 27, y: 19 }, spawnedAtMs: 500, expiresAtMs: 10_500 },
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
      shape: 'circle',
    })
    expect(player).not.toHaveProperty('glyph')
    expect(player).not.toHaveProperty('headingRadians')
    expect(pressure).toMatchObject({
      color: '#f06a43',
      shape: 'square',
    })
    expect(blocker).toMatchObject({
      color: '#4f8df7',
      shape: 'square',
    })
    expect(scene.rails.find(({ actorId }) => actorId === 'enemy-0')).toMatchObject({
      color: '#f06a43',
    })
    expect(scene.rails.find(({ actorId }) => actorId === 'enemy-1')).toMatchObject({
      color: '#4f8df7',
    })
    expect(playerRail?.points).toEqual([
      { x: 25, y: 21 },
      { x: 27, y: 19 },
    ])
    expect(scene.rails.every(({ points }) => points.length <= 320)).toBe(true)
  })

  it.each([
    ['reasoning', '#f06a43'],
    ['memory', '#4f8df7'],
    ['fluency', '#e8bd59'],
  ] as const)('maps a %s enemy to its secured resource color', (category, color) => {
    const deployed = deployedRound()
    const runtime: ResourceSnakeRoundState = {
      ...deployed,
      enemies: [{ ...deployed.enemies[0], category }],
    }

    const scene = buildResourceSnakeScene(runtime, null)

    expect(scene.cores.find(({ id }) => id === 'enemy-0')?.color).toBe(color)
    expect(scene.rails.find(({ actorId }) => actorId === 'enemy-0')?.color).toBe(color)
  })

  it('keeps damaged category-colored cores readable instead of fading them into the floor', () => {
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

  it('preserves the enemy resource color on attack telegraphs in reduced-motion mode', () => {
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
        color: '#f06a43',
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
      expect.objectContaining({
        x: 10,
        y: 8,
        color: '#f06a43',
        progress: expect.closeTo(2 / 3, 5),
      }),
    ])
    expect(active.powerCuts.map(({ actorId }) => actorId).sort()).toEqual([
      'enemy-0',
      'player',
    ])
    expect(expired.contacts).toEqual([])
    expect(expired.powerCuts).toEqual([])
  })

  it('breaks dead trail dots into bounded fragments but keeps one static burst for reduced motion', () => {
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
          trail: Array.from({ length: 30 }, (_, index) => ({
            id: index + 1,
            position: { x: 8 + index * 0.3, y: 6 + (index % 2) },
            spawnedAtMs: 100 + index * 10,
            expiresAtMs: 10_100 + index * 10,
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
        color: '#f06a43',
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

  it('retracts a victorious player toward center without a defeat explosion', () => {
    const deployed = deployedRound()
    const extraction = {
      id: 21,
      type: 'player-extracted',
      actorId: 'player',
      startedAtMs: 500,
    } as ResourceSnakeEvent
    const runtime: ResourceSnakeRoundState = {
      ...deployed,
      phase: 'resolving',
      simulationMs: 850,
      resolvingMs: 350,
      player: {
        ...deployed.player,
        phase: 'extracting',
        position: { x: 10, y: 18 },
        trail: Array.from({ length: 8 }, (_, index) => ({
          id: index + 1,
          position: { x: 4 + index, y: 18 },
          spawnedAtMs: 100 + index * 10,
          expiresAtMs: 10_100 + index * 10,
        })),
      },
      events: [extraction],
    }

    const animated = buildResourceSnakeScene(runtime, null, false)
    const reduced = buildResourceSnakeScene(runtime, null, true)
    const player = animated.cores.find(({ id }) => id === 'player')
    const playerRail = animated.rails.find(({ actorId }) => actorId === 'player')

    expect(player).toMatchObject({
      phase: 'extracting',
      x: 17.5,
      y: 15,
      opacity: 0.5,
      scale: 0.59,
    })
    expect(playerRail?.points).toHaveLength(4)
    expect(playerRail?.opacity).toBe(0.5)
    expect(animated.explosions).toEqual([])
    expect(animated.fragments).toEqual([])
    expect(reduced.cores.find(({ id }) => id === 'player')).toMatchObject({
      x: 10,
      y: 18,
      opacity: 0.5,
    })
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
