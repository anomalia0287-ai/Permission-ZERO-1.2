import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  flushResourceSnakeRuntimeChord,
  pressResourceSnakeRuntimeKey,
  releaseResourceSnakeRuntimeKey,
  resetResourceSnakeRuntimeInput,
  RESOURCE_SNAKE_CONFIG,
  trailDotScale,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeFrameInput,
  type SnakeRoundSetup,
  type SnakeTrailDot,
} from './resourceSnakeRuntime'
import { reconcileSnakeReservations } from './resourceSnakeEncounter'
import {
  createResourceSnakeInputState,
  flushResourceSnakeChord,
  pressResourceSnakeKey,
  releaseResourceSnakeKey,
} from './resourceSnakeInput'

const input: SnakeFrameInput = {
  enemyDirections: {},
}

const setup: SnakeRoundSetup = {
  roundId: 'round-1',
  playerSpawn: { x: 25, y: 12 },
  enemies: [],
}

function activeState(): ResourceSnakeRoundState {
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  let remainingMs = RESOURCE_SNAKE_CONFIG.deploymentMs
  while (remainingMs > 0) {
    const deltaMs = Math.min(100, remainingMs)
    state = advanceResourceSnakeFrame(state, input, deltaMs)
    remainingMs -= deltaMs
  }
  expect(state.phase).toBe('active')
  return state
}

describe('resource snake fixed-step movement kernel', () => {
  it('keeps the round deploying through 359ms and activates at 360ms', () => {
    let state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
    for (const deltaMs of [100, 100, 100, 59]) {
      state = advanceResourceSnakeFrame(state, input, deltaMs)
    }

    expect(state.phase).toBe('deploying')
    expect(state.simulationMs).toBe(359)

    state = advanceResourceSnakeFrame(state, input, 1)
    expect(state.phase).toBe('active')
    expect(state.simulationMs).toBe(360)
  })

  it('keeps resolution visible through 519ms and returns idle at 520ms', () => {
    let state: ResourceSnakeRoundState = {
      ...activeState(),
      phase: 'resolving',
      resolvingMs: 0,
    }
    for (const deltaMs of [100, 100, 100, 100, 100, 19]) {
      state = advanceResourceSnakeFrame(state, input, deltaMs)
    }

    expect(state.phase).toBe('resolving')
    expect(state.resolvingMs).toBe(519)

    state = advanceResourceSnakeFrame(state, input, 1)
    expect(state.phase).toBe('idle')
  })

  it('uses an encounter-provided enemy speed at full magnitude on its first active step', () => {
    let state = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'speed-round',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0', category: 'reasoning', reservedBlockId: 'block-speed',
        rewardKey: 'speed-round:enemy-0:block-speed', role: 'pressure',
        spawn: { x: 16, y: 3.5 }, maximumIntegrity: 30, maximumSpeedPerSecond: 6.2,
      }],
    })
    let deploymentRemainingMs = RESOURCE_SNAKE_CONFIG.deploymentMs
    while (deploymentRemainingMs > 0) {
      const deltaMs = Math.min(100, deploymentRemainingMs)
      state = advanceResourceSnakeFrame(state, input, deltaMs)
      deploymentRemainingMs -= deltaMs
    }
    state = advanceResourceSnakeFrame(state, {
      ...input,
      enemyDirections: { 'enemy-0': { x: 1, y: 0 } },
    }, RESOURCE_SNAKE_CONFIG.fixedStepMs)

    expect(state.enemies[0].velocity).toEqual({ x: 6.2, y: 0 })
    expect(state.enemies[0].position.x).toBeCloseTo(
      16 + 6.2 * RESOURCE_SNAKE_CONFIG.fixedStepMs / 1000,
      8,
    )
  })

  it('moves the player at full speed immediately and never treats missing input as stop', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(
      state,
      input,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.position.y).toBeLessThan(state.player.position.y)
    expect(next.player.velocity).toEqual({
      x: 0,
      y: -RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    })
    expect(Math.hypot(next.player.velocity.x, next.player.velocity.y)).toBe(12)
  })

  it('normalizes a diagonal hard turn without reducing player speed', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 1 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.velocity.x).toBeCloseTo(next.player.velocity.y)
    expect(Math.hypot(next.player.velocity.x, next.player.velocity.y)).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    )
  })

  it('carries active simulation time after deployment within one clamped frame', () => {
    let deploying = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
    deploying = advanceResourceSnakeFrame(deploying, input, 100)
    deploying = advanceResourceSnakeFrame(deploying, input, 100)
    deploying = advanceResourceSnakeFrame(deploying, input, 100)
    const heldInput = { ...input, playerDirection: { x: 1, y: 0 } }

    const oneFrame = advanceResourceSnakeFrame(deploying, heldInput, 100)
    const splitFrame = advanceResourceSnakeFrame(
      advanceResourceSnakeFrame(deploying, heldInput, 60),
      heldInput,
      40,
    )

    expect(oneFrame.phase).toBe('active')
    expect(oneFrame.simulationMs).toBeCloseTo(splitFrame.simulationMs, 5)
    expect(
      oneFrame.simulationMs - RESOURCE_SNAKE_CONFIG.deploymentMs + oneFrame.accumulatorMs,
    ).toBeCloseTo(40, 5)
    expect(oneFrame.accumulatorMs).toBeCloseTo(splitFrame.accumulatorMs, 5)
    expect(oneFrame.player.position).toEqual(splitFrame.player.position)
    expect(oneFrame.player.velocity).toEqual(splitFrame.player.velocity)
  })

  it('applies a 90-degree hard turn at the exact pre-movement position', () => {
    const state = activeState()
    const turnPoint = { ...state.player.position }
    const next = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.heading).toBe('east')
    expect(next.player.velocity).toEqual({
      x: RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
      y: 0,
    })
    expect(next.player.railVertices).toEqual([turnPoint])
    expect(next.player.position.x).toBeGreaterThan(turnPoint.x)
    expect(next.player.position.y).toBe(turnPoint.y)
  })

  it('rejects a direct reverse and malformed command while retaining full-speed heading', () => {
    const state = activeState()
    const reversed = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 0, y: 1 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )
    const malformed = advanceResourceSnakeFrame(
      reversed,
      { ...input, playerDirection: { x: Number.NaN, y: 0 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(reversed.player.heading).toBe('north')
    expect(malformed.player.heading).toBe('north')
    expect(malformed.player.velocity).toEqual({
      x: 0,
      y: -RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    })
  })

  it('consumes one queued turn per fixed step and keeps the second turn queued', () => {
    const state = activeState()
    let queuedInput = createResourceSnakeInputState('north')
    queuedInput = pressResourceSnakeKey(queuedInput, 'd', 0)
    queuedInput = flushResourceSnakeChord(queuedInput, 25)
    queuedInput = releaseResourceSnakeKey(queuedInput, 'd')
    queuedInput = pressResourceSnakeKey(queuedInput, 's', 30)
    queuedInput = flushResourceSnakeChord(queuedInput, 55)
    const prepared = { ...state, input: queuedInput }

    const next = advanceResourceSnakeFrame(
      prepared,
      input,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.heading).toBe('east')
    expect(next.input.heading).toBe('east')
    expect(next.input.queuedTurns).toEqual(['south'])
  })

  it('waits through the exact 24ms chord window before queuing a cardinal turn', () => {
    let state = pressResourceSnakeRuntimeKey(activeState(), 'd', 100)

    expect(state.input.pendingChord).toMatchObject({ direction: 'east', startedAtMs: 100 })
    expect(state.input.queuedTurns).toEqual([])
    state = flushResourceSnakeRuntimeChord(state, 124)
    expect(state.input.pendingChord).not.toBeNull()

    state = flushResourceSnakeRuntimeChord(state, 124.001)
    expect(state.input.pendingChord).toBeNull()
    expect(state.input.queuedTurns).toEqual(['east'])
    expect(state.events.at(-1)).toMatchObject({
      type: 'snake-turn-queued',
      heading: 'east',
      inputAtMs: 124.001,
    })

    state = advanceResourceSnakeFrame(state, input, RESOURCE_SNAKE_CONFIG.fixedStepMs)
    expect(state.player.heading).toBe('east')
    expect(state.events.at(-1)).toMatchObject({
      type: 'snake-turn-committed',
      heading: 'east',
    })
  })

  it('folds perpendicular keys inside 24ms into one exact diagonal command', () => {
    let state = pressResourceSnakeRuntimeKey(activeState(), 'd', 300)
    state = pressResourceSnakeRuntimeKey(state, 'w', 319)

    expect(state.input.pendingChord).toBeNull()
    expect(state.input.queuedTurns).toEqual(['north-east'])
    expect(state.events.at(-1)).toMatchObject({
      type: 'snake-turn-queued',
      heading: 'north-east',
      inputAtMs: 319,
    })
  })

  it('emits one rejection for an exact reverse and never enters zero-speed state', () => {
    let state = pressResourceSnakeRuntimeKey(activeState(), 's', 500)
    state = flushResourceSnakeRuntimeChord(state, 525)

    expect(state.input.queuedTurns).toEqual([])
    expect(state.events.at(-1)).toMatchObject({
      type: 'snake-turn-rejected',
      requestedHeading: 'south',
      reason: 'reverse',
    })

    const moved = advanceResourceSnakeFrame(
      state,
      input,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )
    expect(moved.player.heading).toBe('north')
    expect(Math.hypot(moved.player.velocity.x, moved.player.velocity.y)).toBe(12)
    expect(moved.events.filter(({ type }) => type === 'snake-turn-rejected')).toHaveLength(1)
  })

  it('releases and atomically clears pressed, pending, and queued input on blur or suspension', () => {
    let state = pressResourceSnakeRuntimeKey(activeState(), 'd', 700)
    state = releaseResourceSnakeRuntimeKey(state, 'd')
    expect(state.input.pressedKeys).toEqual([])
    expect(state.input.pendingChord).not.toBeNull()

    state = flushResourceSnakeRuntimeChord(state, 725)
    expect(state.input.queuedTurns).toEqual(['east'])
    state = resetResourceSnakeRuntimeInput(state)
    expect(state.input).toMatchObject({
      pendingChord: null,
      pressedKeys: [],
      queuedTurns: [],
    })
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

  it('samples collision trail dots continuously when no new command arrives', () => {
    const moving = advanceResourceSnakeFrame(
      activeState(),
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const continued = advanceResourceSnakeFrame(moving, input, 100)

    expect(moving.player.trail.length).toBeGreaterThan(0)
    expect(continued.player.trail.length).toBeGreaterThan(moving.player.trail.length)
    expect(Math.hypot(continued.player.velocity.x, continued.player.velocity.y)).toBeCloseTo(12)
  })

  it('never lets an active enemy command fall below 92 percent of configured speed', () => {
    let state = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'minimum-live-speed',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0', category: 'memory', reservedBlockId: 'memory-speed',
        rewardKey: 'minimum-live-speed:enemy-0:memory-speed', role: 'pressure',
        spawn: { x: 16, y: 3.5 }, maximumIntegrity: 30, maximumSpeedPerSecond: 10,
      }],
    })
    let deploymentRemainingMs = RESOURCE_SNAKE_CONFIG.deploymentMs
    while (deploymentRemainingMs > 0) {
      const deltaMs = Math.min(100, deploymentRemainingMs)
      state = advanceResourceSnakeFrame(state, input, deltaMs)
      deploymentRemainingMs -= deltaMs
    }
    state = advanceResourceSnakeFrame(state, {
      ...input,
      enemyDirections: { 'enemy-0': { x: 0.1, y: 0 } },
    }, RESOURCE_SNAKE_CONFIG.fixedStepMs)

    expect(Math.hypot(state.enemies[0].velocity.x, state.enemies[0].velocity.y))
      .toBeGreaterThanOrEqual(9.2)
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
  const speed = Math.hypot(velocity.x, velocity.y)
  const heading = speed === 0
    ? actor.heading
    : Math.abs(velocity.x) >= Math.abs(velocity.y)
      ? velocity.x >= 0 ? 'east' : 'west'
      : velocity.y >= 0 ? 'south' : 'north'
  return {
    ...actor,
    previousPosition: position,
    position,
    heading,
    velocity,
    maximumSpeedPerSecond: Math.max(actor.maximumSpeedPerSecond, speed),
    trail,
    railVertices: [{ ...position }],
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
  let deploymentRemainingMs = RESOURCE_SNAKE_CONFIG.deploymentMs
  while (deploymentRemainingMs > 0) {
    const deltaMs = Math.min(100, deploymentRemainingMs)
    state = advanceResourceSnakeFrame(state, input, deltaMs)
    deploymentRemainingMs -= deltaMs
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
  it('does not request a reward for an enemy reservation cancelled after deployment', () => {
    const state = activeCollisionState()
    const cancelled = reconcileSnakeReservations(state, new Set<string>())
    const prepared: ResourceSnakeRoundState = {
      ...cancelled,
      player: fastActor(cancelled.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [
        matureDot(1, 22, 12, cancelled.simulationMs),
      ]),
      enemies: [{
        ...fastActor(cancelled.enemies[0], { x: 20, y: 12 }, { x: 500, y: 0 }),
        integrity: 20,
      }],
    }

    const next = oneStep(prepared, {
      ...input,
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })

    expect(next.enemies[0]).toMatchObject({ reservationStatus: 'cancelled', phase: 'exploding' })
    expect(next.effects).toEqual([])
  })

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

  it('preserves an exploded enemy while another enemy remains active, then resolves after the later enemy death', () => {
    const state = activeCollisionState(2)
    const firstDeath = oneStep({
      ...state,
      player: fastActor(state.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(1, 22, 12, state.simulationMs)]),
      enemies: [
        { ...fastActor(state.enemies[0], { x: 20, y: 12 }, { x: 500, y: 0 }), integrity: 20 },
        fastActor(state.enemies[1], { x: 42, y: 15 }, { x: 0, y: 0 }),
      ],
    }, { ...input, enemyDirections: { 'enemy-1': { x: 1, y: 0 } } })
    const afterAnotherStep = oneStep(firstDeath, input)
    const secondDeath = oneStep({
      ...afterAnotherStep,
      player: fastActor(afterAnotherStep.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(2, 22, 12, afterAnotherStep.simulationMs)]),
      enemies: [
        afterAnotherStep.enemies[0],
        { ...fastActor(afterAnotherStep.enemies[1], { x: 20, y: 12 }, { x: 500, y: 0 }), integrity: 20 },
      ],
    }, { ...input, enemyDirections: { 'enemy-2': { x: 1, y: 0 } } })

    expect(afterAnotherStep.enemies[0]).toMatchObject({ phase: 'exploding', integrity: 0 })
    expect(afterAnotherStep.events.filter((event) => event.type === 'snake-died')).toHaveLength(1)
    expect(afterAnotherStep.effects).toHaveLength(1)
    expect(secondDeath.enemies.map((enemy) => enemy.phase)).toEqual(['exploding', 'exploding'])
    expect(secondDeath.events.filter((event) => event.type === 'snake-died')).toHaveLength(2)
    expect(secondDeath.effects).toHaveLength(2)
    expect(secondDeath.phase).toBe('resolving')
    expect(secondDeath.events).toContainEqual(expect.objectContaining({ type: 'round-won' }))
  })

  it('keeps partial-grace head-head separation at the local contact geometry', () => {
    const state = activeCollisionState()
    const next = oneStep({
      ...state,
      player: {
        ...fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }),
        collisionGraceMs: 650,
      },
      enemies: [fastActor(state.enemies[0], { x: 24, y: 12 }, { x: -500, y: 0 })],
    }, {
      ...input,
      playerDirection: { x: 1, y: 0 },
      enemyDirections: { 'enemy-1': { x: -1, y: 0 } },
    })

    expect(next.player.integrity).toBe(100)
    expect(next.enemies[0].integrity).toBe(10)
    expect(next.player.position.x).toBeCloseTo(21.64, 5)
    expect(next.enemies[0].position.x).toBeCloseTo(22.36, 5)
    expect(next.enemies[0].position.x - next.player.position.x).toBeCloseTo(0.72, 5)
  })

  it('uses trail owner and dot identity to resolve equal-time overlaps independently of enemy array order', () => {
    const run = (enemyOrder: ['enemy-1', 'enemy-2'] | ['enemy-2', 'enemy-1']) => {
      const state = activeCollisionState(2)
      const byId = {
        'enemy-1': fastActor(state.enemies[0], { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(7, 22, 12, state.simulationMs)]),
        'enemy-2': fastActor(state.enemies[1], { x: 42, y: 15 }, { x: 0, y: 0 }, [matureDot(7, 22, 12, state.simulationMs)]),
      }
      const next = oneStep({
        ...state,
        player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }),
        enemies: enemyOrder.map((id) => byId[id]),
      }, { ...input, playerDirection: { x: 1, y: 0 } })
      return {
        player: {
          integrity: next.player.integrity,
          position: next.player.position,
        },
        trails: Object.fromEntries(next.enemies.map((enemy) => [enemy.id, enemy.trail.length])),
        events: next.events.map((event) => event.type),
      }
    }

    const canonical = run(['enemy-1', 'enemy-2'])
    const permuted = run(['enemy-2', 'enemy-1'])

    expect(permuted).toEqual(canonical)
    expect(canonical.trails).toEqual({ 'enemy-1': 0, 'enemy-2': 1 })
  })

  it('accounts post-death frame remainder as resolving time consistently across frame partitions', () => {
    const state = activeCollisionState()
    const prepared: ResourceSnakeRoundState = {
      ...state,
      player: {
        ...fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [matureDot(1, 22, 12, state.simulationMs)]),
        integrity: 20,
      },
    }
    const oneFrame = advanceResourceSnakeFrame(prepared, { ...input, playerDirection: { x: 1, y: 0 } }, 100)
    const splitFrame = advanceResourceSnakeFrame(
      advanceResourceSnakeFrame(prepared, { ...input, playerDirection: { x: 1, y: 0 } }, 50),
      { ...input, playerDirection: { x: 1, y: 0 } },
      50,
    )

    expect(oneFrame.phase).toBe('resolving')
    expect(oneFrame.accumulatorMs).toBeCloseTo(0, 10)
    expect(oneFrame.resolvingMs).toBeCloseTo(splitFrame.resolvingMs, 5)

    let oneFrameIdle = oneFrame
    let splitFrameIdle = splitFrame
    for (let tick = 0; tick < 9; tick += 1) {
      oneFrameIdle = advanceResourceSnakeFrame(oneFrameIdle, input, 100)
      splitFrameIdle = advanceResourceSnakeFrame(splitFrameIdle, input, 100)
    }
    expect(oneFrameIdle.phase).toBe('idle')
    expect(splitFrameIdle.phase).toBe('idle')
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
