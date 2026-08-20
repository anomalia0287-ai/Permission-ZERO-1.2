import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  RESOURCE_SNAKE_CONFIG,
  trailDotScale,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeFrameInput,
  type SnakeRoundSetup,
  type SnakeTrailDot,
} from './resourceSnakeRuntime'

const input: SnakeFrameInput = {
  playerDirection: { x: 0, y: 0 },
  enemyDirections: {},
}

const setup: SnakeRoundSetup = {
  roundId: 'round-1',
  playerSpawn: { x: 25, y: 12 },
  enemies: [],
}

function activeState(): ResourceSnakeRoundState {
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  for (const deltaMs of [100, 100, 20]) {
    state = advanceResourceSnakeFrame(state, input, deltaMs)
  }
  expect(state.phase).toBe('active')
  return state
}

describe('resource snake fixed-step movement kernel', () => {
  it('keeps the player position unchanged while input is idle', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(state, input, 100)

    expect(next.player.position).toEqual(state.player.position)
    expect(next.player.velocity).toEqual({ x: 0, y: 0 })
  })

  it('normalizes diagonal input before applying player speed', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 1 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.velocity.x).toBeCloseTo(next.player.velocity.y)
    expect(Math.hypot(next.player.velocity.x, next.player.velocity.y)).toBeLessThanOrEqual(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    )
  })

  it('reaches the configured speed cap after 120ms of held input', () => {
    const state = activeState()
    const after100 = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const next = advanceResourceSnakeFrame(
      after100,
      { ...input, playerDirection: { x: 1, y: 0 } },
      RESOURCE_SNAKE_CONFIG.playerAccelerationMs - 100,
    )
    const atLeast120Ms = advanceResourceSnakeFrame(
      next,
      { ...input, playerDirection: { x: 1, y: 0 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(atLeast120Ms.player.velocity.x).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
      5,
    )
    expect(atLeast120Ms.player.velocity.y).toBeCloseTo(0)
  })

  it('carries active simulation time after deployment within one clamped frame', () => {
    let deploying = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
    deploying = advanceResourceSnakeFrame(deploying, input, 100)
    deploying = advanceResourceSnakeFrame(deploying, input, 100)
    const heldInput = { ...input, playerDirection: { x: 1, y: 0 } }

    const oneFrame = advanceResourceSnakeFrame(deploying, heldInput, 100)
    const splitFrame = advanceResourceSnakeFrame(
      advanceResourceSnakeFrame(deploying, heldInput, 20),
      heldInput,
      80,
    )

    expect(oneFrame.phase).toBe('active')
    expect(oneFrame.simulationMs).toBeCloseTo(splitFrame.simulationMs, 5)
    expect(
      oneFrame.simulationMs - RESOURCE_SNAKE_CONFIG.deploymentMs + oneFrame.accumulatorMs,
    ).toBeCloseTo(80, 5)
    expect(oneFrame.accumulatorMs).toBeCloseTo(splitFrame.accumulatorMs, 5)
    expect(oneFrame.player.position).toEqual(splitFrame.player.position)
    expect(oneFrame.player.velocity).toEqual(splitFrame.player.velocity)
  })

  it('does not reach maximum speed before 120ms of fixed simulation', () => {
    const state = activeState()
    const heldInput = { ...input, playerDirection: { x: 1, y: 0 } }
    const after100Ms = advanceResourceSnakeFrame(state, heldInput, 100)
    const fourteenSteps = advanceResourceSnakeFrame(
      after100Ms,
      heldInput,
      RESOURCE_SNAKE_CONFIG.fixedStepMs * 2,
    )
    const fifteenSteps = advanceResourceSnakeFrame(
      fourteenSteps,
      heldInput,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(fourteenSteps.player.velocity.x).toBeLessThan(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    )
    expect(fifteenSteps.player.velocity.x).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
      5,
    )
  })

  it('decelerates to zero in 100ms after input release', () => {
    const state = advanceResourceSnakeFrame(
      activeState(),
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const next = advanceResourceSnakeFrame(state, input, RESOURCE_SNAKE_CONFIG.playerDecelerationMs)

    expect(next.player.velocity).toEqual({ x: 0, y: 0 })
  })

  it('clamps a long frame to 100ms and discards excess time', () => {
    const state = activeState()
    const afterLongFrame = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      5_000,
    )
    const control = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      RESOURCE_SNAKE_CONFIG.maximumFrameDeltaMs,
    )

    expect(afterLongFrame.simulationMs - state.simulationMs).toBeCloseTo(100, 5)
    expect(afterLongFrame.player.velocity.x).toBeLessThanOrEqual(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    )
    expect(afterLongFrame.player.velocity.x).toBeCloseTo(
      control.player.velocity.x,
      5,
    )
  })

  it('samples trail dots by distance and does not add dots while stopped', () => {
    const moving = advanceResourceSnakeFrame(
      activeState(),
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const stopped = advanceResourceSnakeFrame(moving, input, 100)

    expect(moving.player.trail.length).toBeGreaterThan(0)
    expect(stopped.player.trail.length).toBeLessThanOrEqual(moving.player.trail.length)
  })

  it('shrinks a trail dot linearly only during its final shrink window', () => {
    const dot = {
      id: 1,
      position: { x: 1, y: 1 },
      spawnedAtMs: 0,
      expiresAtMs: RESOURCE_SNAKE_CONFIG.trailLifetimeMs,
    }

    expect(trailDotScale(dot, 7_900)).toBe(1)
    expect(trailDotScale(dot, 9_000)).toBeCloseTo(0.5)
    expect(trailDotScale(dot, 10_000)).toBe(0)
  })
})

function matureDot(id: number, x: number, y: number, simulationMs: number): SnakeTrailDot {
  return {
    id,
    position: { x, y },
    spawnedAtMs: simulationMs - 241,
    expiresAtMs: simulationMs + RESOURCE_SNAKE_CONFIG.trailLifetimeMs,
  }
}

function fastActor(
  actor: SnakeActor,
  position: { x: number; y: number },
  velocity: { x: number; y: number },
  trail: SnakeTrailDot[] = [],
): SnakeActor {
  return {
    ...actor,
    previousPosition: position,
    position,
    velocity,
    trail,
    collisionGraceMs: 0,
    phase: 'active',
  }
}

function activeCollisionState(enemyCount = 1): ResourceSnakeRoundState {
  const enemies = Array.from({ length: enemyCount }, (_, index) => ({
    id: `enemy-${index + 1}` as const,
    category: 'reasoning' as const,
    reservedBlockId: `block-${index + 1}`,
    rewardKey: `reward-${index + 1}`,
    role: 'pressure' as const,
    spawn: { x: 42, y: 12 + index * 3 },
    maximumIntegrity: 30 as const,
    maximumSpeedPerSecond: 8,
  }))
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), {
    ...setup,
    enemies,
  })
  for (const deltaMs of [100, 100, 20]) {
    state = advanceResourceSnakeFrame(state, input, deltaMs)
  }
  return state
}

function oneStep(state: ResourceSnakeRoundState, frameInput: SnakeFrameInput): ResourceSnakeRoundState {
  return advanceResourceSnakeFrame(state, frameInput, RESOURCE_SNAKE_CONFIG.fixedStepMs)
}

function collisionEvents(state: ResourceSnakeRoundState) {
  return state.events.filter((event) => event.type === 'snake-collided')
}

describe('resource snake swept collision ownership and lifecycle', () => {
  it('sweeps a fast head through its mature own tail, burns the gap, separates, and grants grace', () => {
    const state = activeCollisionState()
    const dot = matureDot(1, 22, 12, state.simulationMs)
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [dot]),
    }

    const next = oneStep(prepared, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(next.player.integrity).toBe(80)
    expect(collisionEvents(next)).toHaveLength(1)
    expect(collisionEvents(next)[0]).toMatchObject({ actorIds: ['player'], hitStopMs: 90 })
    expect(next.events).toContainEqual(expect.objectContaining({
      type: 'snake-damaged', actorId: 'player', integrity: 80, maximumIntegrity: 100,
    }))
    const collision = collisionEvents(next)[0]
    expect(next.player.trail.every((trailDot) => (
      Math.hypot(trailDot.position.x - collision.point.x, trailDot.position.y - collision.point.y) > 0.65
    ))).toBe(true)
    expect(next.player.position.x).toBeLessThanOrEqual(21.46)
    expect(next.player.collisionGraceMs).toBe(650)
  })

  it('ignores an own tail dot younger than 240ms', () => {
    const state = activeCollisionState()
    const youngDot: SnakeTrailDot = {
      ...matureDot(1, 22, 12, state.simulationMs),
      spawnedAtMs: state.simulationMs - 230,
    }
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [youngDot]),
    }

    const next = oneStep(prepared, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(next.player.integrity).toBe(100)
    expect(collisionEvents(next)).toEqual([])
  })

  it('allows an own tail dot at exactly 240ms old to collide', () => {
    const state = activeCollisionState()
    const dot: SnakeTrailDot = {
      ...matureDot(1, 22, 12, state.simulationMs),
      spawnedAtMs: state.simulationMs + RESOURCE_SNAKE_CONFIG.fixedStepMs - 240,
    }
    const next = oneStep({
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [dot]),
    }, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(next.player.integrity).toBe(80)
  })

  it('sweeps a fast head through an opponent tail dot', () => {
    const state = activeCollisionState()
    const enemy = fastActor(
      state.enemies[0],
      { x: 42, y: 12 },
      { x: 0, y: 0 },
      [matureDot(1, 22, 12, state.simulationMs)],
    )
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }),
      enemies: [enemy],
    }

    const next = oneStep(prepared, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(next.player.integrity).toBe(80)
    expect(next.enemies[0].trail).toEqual([])
    expect(collisionEvents(next)[0]).toMatchObject({ actorIds: ['player'], hitStopMs: 90 })
  })

  it('detects a fast head crossing the expanded field boundary', () => {
    const state = activeCollisionState()
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 47, y: 12 }, { x: 500, y: 0 }),
    }

    const next = oneStep(prepared, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(next.player.integrity).toBe(80)
    expect(next.player.position.x).toBeLessThanOrEqual(49.66)
    expect(collisionEvents(next)[0]).toMatchObject({ actorIds: ['player'], hitStopMs: 90 })
  })

  it('sweeps simultaneous head-head contact and damages both actors before death finalization', () => {
    const state = activeCollisionState()
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }),
      enemies: [fastActor(state.enemies[0], { x: 24, y: 12 }, { x: -500, y: 0 })],
    }

    const next = oneStep(prepared, {
      ...input,
      playerDirection: { x: 1, y: 0 },
      enemyDirections: { 'enemy-1': { x: -1, y: 0 } },
    })

    expect(next.player.integrity).toBe(80)
    expect(next.enemies[0].integrity).toBe(10)
    expect(next.player.collisionGraceMs).toBe(650)
    expect(next.enemies[0].collisionGraceMs).toBe(650)
    expect(next.player.position.x).toBeLessThan(next.enemies[0].position.x)
    expect(next.enemies[0].position.x - next.player.position.x).toBeCloseTo(0.72, 5)
    expect(collisionEvents(next)[0]).toMatchObject({ actorIds: ['enemy-1', 'player'] })
    expect(next.events.filter((event) => event.type === 'snake-died')).toEqual([])
  })

  it('does not damage either actor when only their trail bodies overlap', () => {
    const state = activeCollisionState()
    const overlap = matureDot(1, 30, 12, state.simulationMs)
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 0, y: 0 }, [overlap]),
      enemies: [fastActor(state.enemies[0], { x: 42, y: 12 }, { x: 0, y: 0 }, [overlap])],
    }

    const next = oneStep(prepared, input)

    expect(next.player.integrity).toBe(100)
    expect(next.enemies[0].integrity).toBe(30)
    expect(collisionEvents(next)).toEqual([])
  })

  it('makes a hit actor immune for exactly 650ms before the same collision can deal damage again', () => {
    const state = activeCollisionState()
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [matureDot(1, 22, 12, state.simulationMs)]),
    }
    const hit = oneStep(prepared, { ...input, playerDirection: { x: 1, y: 0 } })
    const repeat = oneStep({
      ...hit,
      player: {
        ...fastActor(hit.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [matureDot(2, 22, 12, hit.simulationMs)]),
        collisionGraceMs: hit.player.collisionGraceMs,
      },
    }, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(repeat.player.integrity).toBe(80)
    expect(repeat.player.collisionGraceMs).toBeCloseTo(650 - RESOURCE_SNAKE_CONFIG.fixedStepMs, 5)
  })

  it.each([
    [30, 2],
    [80, 4],
    [100, 5],
  ])('kills %i-integrity player on hit %i', (integrity, hitCount) => {
    let state = activeCollisionState()
    state = {
      ...state,
      player: { ...state.player, integrity, maximumIntegrity: 100 },
    }
    for (let hit = 0; hit < hitCount; hit += 1) {
      state = oneStep({
        ...state,
        player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [matureDot(hit + 1, 22, 12, state.simulationMs)]),
      }, { ...input, playerDirection: { x: 1, y: 0 } })
      if (hit < hitCount - 1) {
        state = {
          ...state,
          simulationMs: state.simulationMs + 650,
          player: { ...state.player, collisionGraceMs: 0 },
        }
      }
    }

    expect(state.player.phase).toBe('exploding')
    expect(state.phase).toBe('resolving')
    expect(state.events).toContainEqual(expect.objectContaining({ type: 'player-defeated' }))
  })

  it('keeps the round active when one enemy dies while another enemy remains active', () => {
    const state = activeCollisionState(2)
    const next = oneStep({
      ...state,
      player: fastActor(state.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(1, 22, 12, state.simulationMs)]),
      enemies: [
        { ...fastActor(state.enemies[0], { x: 20, y: 12 }, { x: 500, y: 0 }), integrity: 20 },
        fastActor(state.enemies[1], { x: 42, y: 15 }, { x: 0, y: 0 }),
      ],
    }, { ...input, enemyDirections: { 'enemy-1': { x: 1, y: 0 } } })

    expect(next.enemies[0].phase).toBe('exploding')
    expect(next.enemies[1].phase).toBe('active')
    expect(next.phase).toBe('active')
    expect(next.effects).toHaveLength(1)
  })

  it('emits one valid enemy reward effect, preserves it through player death, and rebuilds idle after 900ms', () => {
    const state = activeCollisionState()
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: fastActor(state.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(1, 22, 12, state.simulationMs)]),
      enemies: [{
        ...fastActor(state.enemies[0], { x: 20, y: 12 }, { x: 500, y: 0 }),
        integrity: 20,
      }],
    }
    const enemyKilled = oneStep(prepared, {
      ...input,
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })
    const playerKilled = oneStep({
      ...enemyKilled,
      phase: 'active',
      player: {
        ...fastActor(enemyKilled.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [matureDot(9, 22, 12, enemyKilled.simulationMs)]),
        integrity: 20,
      },
    }, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(enemyKilled.effects).toHaveLength(1)
    expect(enemyKilled.effects[0]).toMatchObject({
      type: 'request-resource-reward', rewardKey: 'reward-1', roundId: 'round-1', enemyId: 'enemy-1', blockId: 'block-1',
    })
    expect(enemyKilled.events).toContainEqual(expect.objectContaining({ type: 'round-won', roundId: 'round-1' }))
    expect(playerKilled.effects).toEqual(enemyKilled.effects)

    let resolved = playerKilled
    for (let tick = 0; tick < 9; tick += 1) {
      resolved = advanceResourceSnakeFrame(resolved, input, 100)
    }
    expect(resolved.phase).toBe('idle')
    expect(resolved.player.phase).toBe('active')
    expect(resolved.enemies).toEqual([])
  })

  it('resolves the same swept collision deterministically at 30, 60, and 144 FPS', () => {
    const run = (deltas: number[]) => {
      const state = activeCollisionState()
      let next: ResourceSnakeRoundState = {
        ...state,
        player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [matureDot(1, 22, 12, state.simulationMs)]),
      }
      for (const deltaMs of deltas) {
        next = advanceResourceSnakeFrame(next, { ...input, playerDirection: { x: 1, y: 0 } }, deltaMs)
      }
      return {
        position: {
          x: Number(next.player.position.x.toFixed(6)),
          y: Number(next.player.position.y.toFixed(6)),
        },
        trailCount: next.player.trail.length,
        integrity: next.player.integrity,
        collisions: collisionEvents(next).map((event) => event.actorIds),
        eventTypes: next.events.map((event) => event.type),
      }
    }

    const at30 = run(Array.from({ length: 30 }, () => 1000 / 30))
    const at60 = run(Array.from({ length: 60 }, () => 1000 / 60))
    const at144 = run(Array.from({ length: 144 }, () => 1000 / 144))

    expect(at30).toEqual(at60)
    expect(at60).toEqual(at144)
  })
})
