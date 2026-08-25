import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  evaluateResourceSnakeEnemyHeadingSafety,
  flushResourceSnakeRuntimeChord,
  pressResourceSnakeRuntimeKey,
  releaseResourceSnakeRuntimeKey,
  resetResourceSnakeRuntimeInput,
  RESOURCE_SNAKE_CONFIG,
  resourceSnakeRoundSpeedScale,
  trailDotScale,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeFrameInput,
  type SnakeRoundSetup,
  type SnakeTrailDot,
} from './resourceSnakeRuntime'
import { reconcileSnakeReservations } from './resourceSnakeEncounter'
import {
  SNAKE_DIRECTION_VECTORS,
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

describe('company surveillance units on the field', () => {
  function mixedSetup(surveillance: boolean): SnakeRoundSetup {
    return {
      ...setup,
      roundId: 'watched-round',
      playerSpawn: { x: 40, y: 20 },
      enemies: [
        {
          id: 'enemy-0',
          category: 'reasoning',
          reservedBlockId: 'block-0',
          rewardKey: 'watched-round:enemy-0:block-0',
          role: 'pressure',
          spawn: { x: 14, y: 4 },
          maximumIntegrity: 50,
          maximumSpeedPerSecond: 7,
        },
        {
          id: 'enemy-8',
          category: null,
          reservedBlockId: null,
          rewardKey: null,
          role: 'pressure',
          spawn: { x: 8, y: 12 },
          maximumIntegrity: 30,
          maximumSpeedPerSecond: 7,
          surveillance,
        },
      ],
    }
  }

  function activeMixedState(surveillance: boolean): ResourceSnakeRoundState {
    let state = deployResourceSnakeRound(createIdleResourceSnakeState(), mixedSetup(surveillance))
    let remainingMs = RESOURCE_SNAKE_CONFIG.deploymentMs
    while (remainingMs > 0) {
      const deltaMs = Math.min(100, remainingMs)
      state = advanceResourceSnakeFrame(state, input, deltaMs)
      remainingMs -= deltaMs
    }
    expect(state.phase).toBe('active')
    return state
  }

  /**
   * Drives the surveillance unit east across the arena and the security bot
   * south through the line it leaves, so the two divisions' paths cross.
   */
  function runCrossing(
    initial: ResourceSnakeRoundState,
    frames: number,
  ): ResourceSnakeRoundState {
    let state = initial
    for (let frame = 0; frame < frames; frame += 1) {
      if (state.phase !== 'active') break
      state = advanceResourceSnakeFrame(
        state,
        {
          enemyDirections: {
            'enemy-0': { x: 0, y: 1 },
            'enemy-8': { x: 1, y: 0 },
          },
          playerDirection: { x: 0, y: -1 },
        },
        16,
      )
    }
    return state
  }

  function pairDamage(state: ResourceSnakeRoundState): number {
    return state.events.filter((event) => {
      if (event.type !== 'snake-collided') return false
      const pair = event.actorIds.includes('enemy-0') || event.actorIds.includes('enemy-8')
      if (!pair) return false
      if (event.actorIds.includes('player')) return false
      if (event.collisionKind === 'boundary') return false
      return (
        (event.actorIds.includes('enemy-0') && event.actorIds.includes('enemy-8'))
        || event.obstacleOwnerId === 'enemy-0'
        || event.obstacleOwnerId === 'enemy-8'
      )
    }).length
  }

  it('never trades damage between surveillance and security divisions', () => {
    // Same geometry, only the division flag differs. Against an ordinary
    // bot's trail the safety governor swerves the security bot away from the
    // line; against a surveillance trail there is no hazard to dodge, so it
    // sails straight through it, untouched in both directions.
    const contested = runCrossing(activeMixedState(false), 500)
    const contestedSecurity = contested.enemies.find(({ id }) => id === 'enemy-0')
    expect(contestedSecurity && contestedSecurity.position.y < 12).toBe(true)

    const truce = runCrossing(activeMixedState(true), 500)
    expect(pairDamage(truce)).toBe(0)
    const security = truce.enemies.find(({ id }) => id === 'enemy-0')
    const surveillance = truce.enemies.find(({ id }) => id === 'enemy-8')
    expect(security && security.position.y > 14).toBe(true)
    expect(security?.integrity).toBe(security?.maximumIntegrity)
    expect(surveillance?.integrity).toBe(surveillance?.maximumIntegrity)
  })

  it('still hurts the intruder: the truce is company-internal only', () => {
    // The player walks north through the trail the surveillance unit laid.
    let state = activeMixedState(true)
    for (let frame = 0; frame < 500; frame += 1) {
      if (state.phase !== 'active') break
      state = advanceResourceSnakeFrame(
        state,
        {
          enemyDirections: { 'enemy-8': { x: 1, y: 0 } },
          playerDirection: { x: -1, y: 0 },
        },
        16,
      )
      if (state.player.integrity < RESOURCE_SNAKE_CONFIG.playerMaximumIntegrity) break
    }
    expect(state.player.integrity).toBeLessThan(
      RESOURCE_SNAKE_CONFIG.playerMaximumIntegrity,
    )
  })

  it('carries no reservation and can never yield a reward', () => {
    const state = activeMixedState(true)
    const surveillance = state.enemies.find(({ id }) => id === 'enemy-8')
    expect(surveillance?.surveillance).toBe(true)
    expect(surveillance?.category).toBeNull()
    expect(surveillance?.rewardKey).toBeNull()
    expect(surveillance?.reservedBlockId).toBeNull()
    expect(surveillance?.reservationStatus).toBeNull()
  })

  it('ends the round on the security kills alone, escorts notwithstanding', () => {
    const state = activeMixedState(true)
    const guardsDown: ResourceSnakeRoundState = {
      ...state,
      enemies: state.enemies.map((enemy) => (
        enemy.surveillance ? enemy : { ...enemy, phase: 'defeated' as const }
      )),
    }
    const settled = advanceResourceSnakeFrame(guardsDown, input, 16)
    expect(settled.phase).toBe('resolving')
    expect(settled.events.some((event) => event.type === 'round-won')).toBe(true)
  })

  it('replays the same watched round identically', () => {
    const first = runCrossing(activeMixedState(true), 380)
    const second = runCrossing(activeMixedState(true), 380)
    expect(second.enemies).toEqual(first.enemies)
    expect(second.player.integrity).toBe(first.player.integrity)
  })
})

describe('resource snake fixed-step movement kernel', () => {
  it('ramps one shared round speed from 50 percent to 75 percent over thirty seconds', () => {
    expect(resourceSnakeRoundSpeedScale(0)).toBe(0.5)
    expect(resourceSnakeRoundSpeedScale(RESOURCE_SNAKE_CONFIG.deploymentMs)).toBe(0.5)
    expect(resourceSnakeRoundSpeedScale(
      RESOURCE_SNAKE_CONFIG.deploymentMs + 15_000,
    )).toBe(0.625)
    expect(resourceSnakeRoundSpeedScale(
      RESOURCE_SNAKE_CONFIG.deploymentMs + 30_000,
    )).toBe(0.75)
    expect(resourceSnakeRoundSpeedScale(Number.POSITIVE_INFINITY)).toBe(0.75)
  })

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

  it('keeps victory extraction visible through 819ms and returns idle at 820ms', () => {
    let state: ResourceSnakeRoundState = {
      ...activeState(),
      phase: 'resolving',
      resolvingMs: 0,
    }
    for (const deltaMs of [100, 100, 100, 100, 100, 100, 100, 100, 19]) {
      state = advanceResourceSnakeFrame(state, input, deltaMs)
    }

    expect(state.phase).toBe('resolving')
    expect(state.resolvingMs).toBe(RESOURCE_SNAKE_CONFIG.roundResolveMs - 1)

    state = advanceResourceSnakeFrame(state, input, 1)
    expect(state.phase).toBe('idle')
  })

  it('applies the opening round scale to encounter-provided enemy speed', () => {
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

    const expectedSpeed = 6.2 * resourceSnakeRoundSpeedScale(state.simulationMs)
    expect(state.enemies[0].velocity.x).toBeCloseTo(expectedSpeed, 8)
    expect(state.enemies[0].velocity.y).toBe(0)
    expect(state.enemies[0].position.x).toBeCloseTo(
      16 + expectedSpeed * RESOURCE_SNAKE_CONFIG.fixedStepMs / 1000,
      8,
    )
  })

  it('applies absolute enemy turns on fixed steps independent of frame partition', () => {
    let state = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'scheduled-enemy-turn',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0', category: 'reasoning', reservedBlockId: 'scheduled-block',
        rewardKey: 'scheduled-enemy-turn:enemy-0:scheduled-block', role: 'pressure',
        spawn: { x: 16, y: 3.5 }, maximumIntegrity: 30, maximumSpeedPerSecond: 12,
      }],
    })
    for (const deltaMs of [100, 100, 100, 60]) {
      state = advanceResourceSnakeFrame(state, input, deltaMs)
    }
    const stepMs = RESOURCE_SNAKE_CONFIG.fixedStepMs
    const scheduledInput: SnakeFrameInput = {
      enemyDirections: { 'enemy-0': { x: 1, y: 0 } },
      enemyDirectionSchedules: {
        'enemy-0': [
          { atMs: state.simulationMs, direction: { x: 1, y: 0 } },
          { atMs: state.simulationMs + 700, direction: { x: 1, y: 1 } },
        ],
      },
    }
    let coarse = state
    for (let index = 0; index < 8; index += 1) {
      coarse = advanceResourceSnakeFrame(coarse, scheduledInput, 100)
    }
    let split = state
    for (let index = 0; index < 96; index += 1) {
      split = advanceResourceSnakeFrame(split, scheduledInput, stepMs)
    }

    expect(coarse.enemies[0].heading).toBe('south-east')
    expect(split.enemies[0].heading).toBe('south-east')
    expect(split.enemies[0].position.x).toBeCloseTo(coarse.enemies[0].position.x, 10)
    expect(split.enemies[0].position.y).toBeCloseTo(coarse.enemies[0].position.y, 10)
    expect(split.enemies[0].trail).toEqual(coarse.enemies[0].trail)
  })

  it('moves the player at opening round speed and never treats missing input as stop', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(
      state,
      input,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.position.y).toBeLessThan(state.player.position.y)
    const expectedSpeed = RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
      * resourceSnakeRoundSpeedScale(next.simulationMs)
    expect(next.player.velocity.x).toBe(0)
    expect(next.player.velocity.y).toBeCloseTo(-expectedSpeed, 8)
    expect(Math.hypot(next.player.velocity.x, next.player.velocity.y)).toBeCloseTo(expectedSpeed, 8)
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
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(next.simulationMs),
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
    expect(next.player.velocity.x).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(next.simulationMs),
      8,
    )
    expect(next.player.velocity.y).toBe(0)
    expect(next.player.railVertices).toEqual([turnPoint])
    expect(next.player.position.x).toBeGreaterThan(turnPoint.x)
    expect(next.player.position.y).toBe(turnPoint.y)
  })

  it('rejects a direct reverse and malformed command while retaining live heading', () => {
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
    expect(malformed.player.velocity.x).toBe(0)
    expect(malformed.player.velocity.y).toBeCloseTo(
      -RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(malformed.simulationMs),
      8,
    )
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
    expect(Math.hypot(moved.player.velocity.x, moved.player.velocity.y)).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(moved.simulationMs),
      8,
    )
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
    expect(Math.hypot(continued.player.velocity.x, continued.player.velocity.y)).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(continued.simulationMs),
      8,
    )
  })

  it('never lets an active enemy command fall below 92 percent of round-scaled speed', () => {
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
      .toBeGreaterThanOrEqual(9.2 * resourceSnakeRoundSpeedScale(state.simulationMs))
  })

  it('holds an ordinary enemy heading for at least 700ms before accepting another turn', () => {
    let state = openEnemyTurnState()
    state = oneStep(state, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })
    expect(state.enemies[0].heading).toBe('east')

    for (let index = 0; index < 83; index += 1) {
      state = oneStep(state, {
        enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
      })
    }
    expect(state.enemies[0].heading).toBe('east')

    state = oneStep(state, {
      enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
    })
    expect(state.enemies[0].heading).toBe('north')
  })

  it('rejects a 135-degree ordinary turn so planned cyan bends stay readable', () => {
    const state = openEnemyTurnState()

    const next = oneStep(state, {
      enemyDirections: { 'enemy-1': { x: -1, y: -1 } },
    })

    expect(next.enemies[0].heading).toBe('south')
    expect(next.enemies[0].enemyTurnGovernor!.lastHeadingChangeAtMs).toBeNull()
  })

  it('rejects an ordinary heading that cannot survive its hold plus emergency reaction window', () => {
    const state = openEnemyTurnState()
    const eastbound = fastActor(
      state.enemies[0],
      { x: 25, y: 9.9 },
      { x: 20, y: 0 },
    )

    const next = oneStep({ ...state, enemies: [eastbound] }, {
      enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 900 } },
    })

    expect(next.enemies[0].heading).toBe('east')
  })

  it('does not panic before a legal planned turn that still has emergency reaction margin', () => {
    const state = openEnemyTurnState()
    const simulationMs = state.simulationMs
    const eastbound = {
      ...fastActor(
        state.enemies[0],
        { x: 40.4, y: 12 },
        { x: 20, y: 0 },
      ),
      collisionGraceMs: 10_000,
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: simulationMs - 400,
        previousHeading: 'north' as const,
        normalTurnAtMs: [simulationMs - 400],
        lastEmergencyTurnAtMs: null,
        lockedUntilMs: 0,
        lastTurnCause: 'normal' as const,
      },
    }
    const prepared = { ...state, enemies: [eastbound] }
    const collisionAtMs = evaluateResourceSnakeEnemyHeadingSafety(
      prepared,
      'enemy-1',
      'east',
      1_200,
    )!.collisionAtMs

    expect(collisionAtMs).toBeGreaterThan(800)
    expect(collisionAtMs).toBeLessThan(1_200)

    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 900 } },
    })

    expect(next.enemies[0].heading).toBe('east')
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('normal')
  })

  it('does not accept a merely less-fatal ordinary heading inside its protected window', () => {
    const state = openEnemyTurnState()
    const eastbound = fastActor(
      state.enemies[0],
      { x: 45, y: 9 },
      { x: 20, y: 0 },
    )

    const next = oneStep({ ...state, enemies: [eastbound] }, {
      enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 900 } },
    })

    expect(next.enemies[0].heading).toBe('east')
  })

  it('reserves half a trail spacing around projected enemy paths', () => {
    const state = openEnemyTurnState()
    const prepared = {
      ...state,
      player: {
        ...state.player,
        trail: [matureDot(77, 28, 12.6, state.simulationMs)],
      },
    }

    expect(
      evaluateResourceSnakeEnemyHeadingSafety(prepared, 'enemy-1', 'east')?.collisionAtMs,
    ).toBeLessThan(Number.POSITIVE_INFINITY)
  })

  it('reserves one full trail spacing around an ally trail in a dual encounter', () => {
    const state = activeCollisionState(2)
    const pressure = fastActor(state.enemies[0], { x: 10, y: 10 }, { x: 20, y: 0 })
    const blocker = fastActor(
      state.enemies[1],
      { x: 42, y: 15 },
      { x: 0, y: 0 },
      [matureDot(78, 13, 10.75, state.simulationMs)],
    )

    expect(evaluateResourceSnakeEnemyHeadingSafety({
      ...state,
      enemies: [pressure, blocker],
    }, 'enemy-1', 'east')?.collisionAtMs).toBeLessThan(Number.POSITIVE_INFINITY)
  })

  it('projects a moving player head instead of rating a head-on lane as safe', () => {
    const state = openEnemyTurnState()
    const simulationMs = 45_101.666_666_668_35
    const prepared = {
      ...state,
      simulationMs,
      player: fastActor(
        state.player,
        { x: 34.322_670_069_887_92, y: 16.278_936_899_929_04 },
        { x: 12, y: 0 },
      ),
      enemies: [fastActor(
        state.enemies[0],
        { x: 37.139_181_590_082_764, y: 16.840_727_553_340_347 },
        { x: -8.7, y: 0 },
      )],
    }

    const west = evaluateResourceSnakeEnemyHeadingSafety(
      prepared,
      'enemy-1',
      'west',
      1_200,
    )!

    expect(west.collisionAtMs).toBeLessThan(400)
  })

  it('reserves one full trail spacing before crossing an older self trail', () => {
    const state = openEnemyTurnState()
    const enemy = fastActor(
      state.enemies[0],
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      [matureDot(79, 13, 10.75, state.simulationMs)],
    )

    expect(evaluateResourceSnakeEnemyHeadingSafety({
      ...state,
      enemies: [enemy],
    }, 'enemy-1', 'east')?.collisionAtMs).toBeLessThan(Number.POSITIVE_INFINITY)
  })

  it('accepts no more than two ordinary enemy turns in a rolling two-second window', () => {
    let state = openEnemyTurnState()
    let previousHeading = state.enemies[0].heading
    const turnTimes: number[] = []

    for (let index = 0; index < 240; index += 1) {
      const direction = index % 2 === 0
        ? { x: 1, y: 0 }
        : { x: 0, y: -1 }
      state = oneStep(state, {
        enemyDirections: { 'enemy-1': direction },
      })
      const heading = state.enemies[0].heading
      if (heading !== previousHeading) {
        turnTimes.push(state.simulationMs)
        previousHeading = heading
      }
    }

    expect(turnTimes).toHaveLength(2)
  })

  it('blocks an ordinary A-to-B-to-A head shake for 1.4 seconds', () => {
    let state = openEnemyTurnState()
    state = oneStep(state, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })
    for (let index = 0; index < 84; index += 1) {
      state = oneStep(state, {
        enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
      })
    }
    expect(state.enemies[0].heading).toBe('north')

    for (let index = 0; index < 167; index += 1) {
      state = oneStep(state, {
        enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
      })
    }
    expect(state.enemies[0].heading).toBe('north')

    state = oneStep(state, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })
    expect(state.enemies[0].heading).toBe('east')
  })

  it('waits for the 250ms ABA emergency gate when the prior heading is the only exit', () => {
    const state = openEnemyTurnState()
    const northwestbound = {
      ...fastActor(
        state.enemies[0],
        { x: 8, y: 2.4 },
        { x: -14.142_135_623_7, y: -14.142_135_623_7 },
      ),
      heading: 'north-west' as const,
      collisionGraceMs: 10_000,
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: state.simulationMs - 700,
        previousHeading: 'east' as const,
        normalTurnAtMs: [state.simulationMs - 700],
        lastEmergencyTurnAtMs: null,
        lockedUntilMs: 0,
        lastTurnCause: 'normal' as const,
      },
    }
    const southObstacle = matureDot(
      87,
      northwestbound.position.x,
      northwestbound.position.y + 2.8,
      state.simulationMs,
    )
    let next = oneStep({
      ...state,
      player: { ...state.player, trail: [southObstacle] },
      enemies: [northwestbound],
    }, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })

    expect(next.enemies[0].heading).toBe('north-west')

    for (let step = 0; step < 8 && next.enemies[0].heading === 'north-west'; step += 1) {
      next = oneStep(next, {
        enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
      })
    }

    expect(next.enemies[0].heading).toBe('east')
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('emergency')
  })

  it('permits only one autonomous emergency turn inside two seconds', () => {
    const state = openEnemyTurnState()
    const northbound = fastActor(
      state.enemies[0],
      { x: 25, y: 0.4 },
      { x: 0, y: -20 },
    )
    const first = oneStep({ ...state, enemies: [northbound] }, {
      enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
    })
    expect(first.enemies[0].heading).not.toBe('north')

    const enemy = first.enemies[0]
    const emergencyDirection = SNAKE_DIRECTION_VECTORS[enemy.heading]
    const obstacle = matureDot(
      91,
      enemy.position.x + emergencyDirection.x * 0.75,
      enemy.position.y + emergencyDirection.y * 0.75,
      first.simulationMs,
    )
    const prepared = {
      ...first,
      player: { ...first.player, trail: [obstacle] },
    }
    const second = oneStep(prepared, {
      enemyDirections: { 'enemy-1': emergencyDirection },
    })

    expect(second.enemies[0].heading).toBe(enemy.heading)
    expect(second.enemies[0].integrity).toBe(enemy.integrity)
  })

  it('keeps one emergency pivot within ninety degrees of the current heading', () => {
    const state = openEnemyTurnState()
    const northbound = {
      ...fastActor(
        state.enemies[0],
        { x: 25, y: 0.4 },
        { x: 0, y: -20 },
      ),
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: 0,
        previousHeading: null,
        normalTurnAtMs: [200, 300],
        lastEmergencyTurnAtMs: null,
        lockedUntilMs: 0,
        lastTurnCause: 'normal' as const,
      },
    }

    const next = oneStep({ ...state, enemies: [northbound] }, {
      enemyDirections: { 'enemy-1': { x: -1, y: 1 } },
    })

    expect(['west', 'north-west', 'north-east', 'east']).toContain(
      next.enemies[0].heading,
    )
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('emergency')
  })

  it('permits a wide emergency pivot only when it survives the full protected window', () => {
    const state = openEnemyTurnState()
    const eastbound = {
      ...fastActor(state.enemies[0], { x: 49, y: 22.5 }, { x: 20, y: 0 }),
      collisionGraceMs: 10_000,
    }
    const northObstacle = matureDot(
      88,
      eastbound.position.x,
      eastbound.position.y - 2,
      state.simulationMs,
    )

    const next = oneStep({
      ...state,
      player: { ...state.player, trail: [northObstacle] },
      enemies: [eastbound],
    }, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })

    expect(next.enemies[0].heading).toBe('north-west')
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('emergency')
    expect(
      next.enemies[0].enemyTurnGovernor!.lockedUntilMs
        - next.enemies[0].enemyTurnGovernor!.lastHeadingChangeAtMs!,
    ).toBe(900)
  })

  it('does not choose an emergency lane that closes before its own cooldown ends', () => {
    const state = openEnemyTurnState()
    const simulationMs = 45_000
    const northbound = {
      ...fastActor(state.enemies[0], { x: 12, y: 12 }, { x: 0, y: -10 }),
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: simulationMs - 100,
        previousHeading: 'south' as const,
        normalTurnAtMs: [simulationMs - 300, simulationMs - 100],
        lastEmergencyTurnAtMs: null,
        lockedUntilMs: 0,
        lastTurnCause: 'normal' as const,
      },
    }
    const prepared = {
      ...state,
      simulationMs,
      player: {
        ...state.player,
        trail: [matureDot(97, 12, 10.5, simulationMs)],
      },
      enemies: [northbound],
    }
    const cooldownHorizonMs = RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs
      + RESOURCE_SNAKE_CONFIG.fixedStepMs * 4
    const westSafety = evaluateResourceSnakeEnemyHeadingSafety(
      prepared,
      'enemy-1',
      'west',
      cooldownHorizonMs,
    )!

    expect(westSafety.collisionAtMs).toBeLessThan(cooldownHorizonMs)
    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: -1, y: 0 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 900 } },
    })

    expect(next.enemies[0].heading).not.toBe('west')
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('emergency')
    expect(evaluateResourceSnakeEnemyHeadingSafety(
      prepared,
      'enemy-1',
      next.enemies[0].heading,
      cooldownHorizonMs,
    )?.collisionAtMs).toBe(Number.POSITIVE_INFINITY)
  })

  it('permits one non-ABA correction when an emergency heading becomes fatal during lock', () => {
    const state = openEnemyTurnState()
    const eastbound = {
      ...fastActor(state.enemies[0], { x: 25, y: 12 }, { x: 20, y: 0 }),
      collisionGraceMs: 10_000,
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: state.simulationMs - 350,
        previousHeading: 'north' as const,
        normalTurnAtMs: [200, 300],
        lastEmergencyTurnAtMs: state.simulationMs - 350,
        lockedUntilMs: state.simulationMs + 550,
        lastTurnCause: 'emergency' as const,
      },
    }
    const eastObstacle = matureDot(
      89,
      eastbound.position.x + 2.5,
      eastbound.position.y,
      state.simulationMs,
    )
    const first = oneStep({
      ...state,
      player: { ...state.player, trail: [eastObstacle] },
      enemies: [eastbound],
    }, {
      enemyDirections: { 'enemy-1': { x: 0, y: 1 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 800 } },
    })

    expect(first.enemies[0].heading).not.toBe('east')
    expect(first.enemies[0].heading).not.toBe('north')
    expect(first.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('emergency-correction')
    expect(
      first.enemies[0].enemyTurnGovernor!.lockedUntilMs
        - first.enemies[0].enemyTurnGovernor!.lastHeadingChangeAtMs!,
    ).toBe(800)

    const enemy = first.enemies[0]
    const correctionHeading = enemy.heading
    const correctionDirection = SNAKE_DIRECTION_VECTORS[correctionHeading]
    const correctionObstacle = matureDot(
      90,
      enemy.position.x + correctionDirection.x * 0.75,
      enemy.position.y + correctionDirection.y * 0.75,
      first.simulationMs,
    )
    const second = oneStep({
      ...first,
      player: { ...first.player, trail: [correctionObstacle] },
    }, {
      enemyDirections: { 'enemy-1': { x: -1, y: 0 } },
    })

    expect(second.enemies[0].heading).toBe(correctionHeading)
    expect(second.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('emergency-correction')
  })

  it('spends an available ordinary turn when emergency cooldown leaves the held heading fatal', () => {
    const state = openEnemyTurnState()
    const westbound = {
      ...fastActor(state.enemies[0], { x: 25, y: 12 }, { x: -20, y: 0 }),
      collisionGraceMs: 10_000,
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: state.simulationMs - 800,
        previousHeading: 'south' as const,
        normalTurnAtMs: [],
        lastEmergencyTurnAtMs: state.simulationMs - 800,
        lockedUntilMs: state.simulationMs,
        lastTurnCause: 'emergency-correction' as const,
      },
    }
    const obstacle = matureDot(
      91,
      westbound.position.x - 2.5,
      westbound.position.y,
      state.simulationMs,
    )

    const next = oneStep({
      ...state,
      player: { ...state.player, trail: [obstacle] },
      enemies: [westbound],
    }, {
      enemyDirections: { 'enemy-1': { x: -1, y: 0 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 800 } },
    })

    expect(next.enemies[0].heading).not.toBe('west')
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('normal')
  })

  it('accepts a planner escape that safely bridges the final emergency-cooldown gap', () => {
    const state = openEnemyTurnState()
    const simulationMs = 45_068.333_333_335_01
    const eastbound = fastActor(
      state.enemies[0],
      { x: 49, y: 9 },
      { x: 20, y: 0 },
    )
    const safetySnapshot = {
      ...state,
      simulationMs,
      enemies: [eastbound],
    }
    const protectedHorizonMs = 900 + RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs
    const northSafety = evaluateResourceSnakeEnemyHeadingSafety(
      safetySnapshot,
      'enemy-1',
      'north',
      protectedHorizonMs,
    )!
    const reactionMarginMs = RESOURCE_SNAKE_CONFIG.fixedStepMs * 5
    const emergencyCooldownRemainingMs = northSafety.collisionAtMs - reactionMarginMs
    const prepared = {
      ...safetySnapshot,
      enemies: [{
        ...eastbound,
        enemyTurnGovernor: {
          lastHeadingChangeAtMs: simulationMs - 900,
          previousHeading: 'south' as const,
          normalTurnAtMs: [simulationMs - 900],
          lastEmergencyTurnAtMs: simulationMs - (
            RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs
              - emergencyCooldownRemainingMs
          ),
          lockedUntilMs: simulationMs - 500,
          lastTurnCause: 'normal' as const,
        },
      }],
    }

    expect(emergencyCooldownRemainingMs).toBeGreaterThan(0)
    expect(northSafety.collisionAtMs - emergencyCooldownRemainingMs)
      .toBeCloseTo(reactionMarginMs)
    expect(northSafety.collisionAtMs).toBeLessThan(protectedHorizonMs)

    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: 0, y: -0.92 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 900 } },
    })

    expect(next.enemies[0].heading).toBe('north')
    expect(next.enemies[0].enemyTurnGovernor!.lastTurnCause).toBe('normal')
  })

  it('waits for a robust emergency pivot when the held lane outlives the cooldown', () => {
    const state = openEnemyTurnState()
    const simulationMs = 45_000
    const emergencyCooldownRemainingMs = 50
    const westbound = {
      ...fastActor(state.enemies[0], { x: 3.82, y: 9 }, { x: -20, y: 0 }),
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: simulationMs - 900,
        previousHeading: 'north' as const,
        normalTurnAtMs: [simulationMs - 900],
        lastEmergencyTurnAtMs: simulationMs - (
          RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs
            - emergencyCooldownRemainingMs
        ),
        lockedUntilMs: simulationMs - 500,
        lastTurnCause: 'normal' as const,
      },
    }
    const prepared = {
      ...state,
      simulationMs,
      enemies: [westbound],
    }
    const protectedHorizonMs = 900 + RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs
    const westSafety = evaluateResourceSnakeEnemyHeadingSafety(
      prepared,
      'enemy-1',
      'west',
      protectedHorizonMs,
    )!
    const southSafety = evaluateResourceSnakeEnemyHeadingSafety(
      prepared,
      'enemy-1',
      'south',
      protectedHorizonMs,
    )!

    expect(westSafety.collisionAtMs).toBeGreaterThan(
      emergencyCooldownRemainingMs + RESOURCE_SNAKE_CONFIG.fixedStepMs * 4,
    )
    expect(westSafety.collisionAtMs).toBeLessThanOrEqual(
      RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs,
    )
    expect(southSafety.collisionAtMs).toBeLessThan(protectedHorizonMs)
    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: 0, y: 0.92 } },
      enemyTurnPolicies: { 'enemy-1': { minimumHeadingHoldMs: 900 } },
    })

    expect(next.enemies[0].heading).toBe('west')
    expect(next.enemies[0].enemyTurnGovernor!.lastHeadingChangeAtMs)
      .toBe(westbound.enemyTurnGovernor.lastHeadingChangeAtMs)
  })

  it('turns an enemy away from an immediate wall instead of letting it kill itself', () => {
    const state = activeCollisionState()
    const enemy = fastActor(
      state.enemies[0],
      { x: 18, y: 0.4 },
      { x: 0, y: -20 },
    )
    const prepared = { ...state, enemies: [enemy] }

    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: 0, y: -1 } },
    })

    expect(next.enemies[0].integrity).toBe(enemy.integrity)
    expect(next.enemies[0].heading).not.toBe('north')
    expect(collisionEvents(next).filter(({ actorIds }) => (
      actorIds.includes('enemy-1')
    ))).toEqual([])
  })

  it('turns an enemy away from its mature trail instead of consuming integrity', () => {
    const state = activeCollisionState()
    const enemy = fastActor(
      state.enemies[0],
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      [matureDot(1, 10.55, 10, state.simulationMs)],
    )
    const prepared = { ...state, enemies: [enemy] }

    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })

    expect(next.enemies[0].integrity).toBe(enemy.integrity)
    expect(next.enemies[0].heading).not.toBe('east')
    expect(collisionEvents(next).filter(({ actorIds }) => (
      actorIds.includes('enemy-1')
    ))).toEqual([])
  })

  it('does not re-enter a mature self dot immediately after leaving its radius', () => {
    const state = activeCollisionState()
    const enemy = {
      ...fastActor(
        state.enemies[0],
        { x: 10.51, y: 10 },
        { x: 0, y: -20 },
        [matureDot(1, 10, 10, state.simulationMs)],
      ),
      previousPosition: { x: 10.49, y: 10 },
    }
    const prepared = { ...state, enemies: [enemy] }

    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: -1, y: 0 } },
    })

    expect(next.enemies[0].integrity).toBe(enemy.integrity)
    expect(next.enemies[0].heading).not.toBe('west')
    expect(collisionEvents(next).filter(({ actorIds }) => (
      actorIds.includes('enemy-1')
    ))).toEqual([])
  })

  it('turns an enemy away from the player trail while another route remains open', () => {
    const state = activeCollisionState()
    const enemy = fastActor(
      state.enemies[0],
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    )
    const prepared = {
      ...state,
      player: {
        ...state.player,
        trail: [matureDot(1, 10.55, 10, state.simulationMs)],
      },
      enemies: [enemy],
    }

    const next = oneStep(prepared, {
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })

    expect(next.enemies[0].integrity).toBe(enemy.integrity)
    expect(next.enemies[0].heading).not.toBe('east')
    expect(collisionEvents(next).filter(({ actorIds }) => (
      actorIds.includes('enemy-1')
    ))).toEqual([])
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

function openEnemyTurnState(): ResourceSnakeRoundState {
  const state = activeCollisionState()
  return {
    ...state,
    player: {
      ...fastActor(state.player, { x: 5, y: 20 }, { x: 0, y: -12 }),
      collisionGraceMs: 10_000,
    },
    enemies: [{
      ...fastActor(state.enemies[0], { x: 25, y: 12 }, { x: 0, y: 8 }),
      collisionGraceMs: 10_000,
    }],
  }
}

describe('resource snake swept collision ownership and lifecycle', () => {
  it('does not request a reward for an enemy reservation cancelled after deployment', () => {
    const state = activeCollisionState()
    const cancelled = reconcileSnakeReservations(state, new Set<string>())
    const prepared: ResourceSnakeRoundState = {
      ...cancelled,
      player: fastActor(cancelled.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [
        // Lifecycle assertions need a collision the safety governor cannot
        // legally steer around; crossing a remote dot is now intentionally avoidable.
        matureDot(1, 20, 12, cancelled.simulationMs),
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

  it('does not retroactively collide when a self dot matures after entry in the same step', () => {
    const state = activeCollisionState()
    const dot: SnakeTrailDot = {
      ...matureDot(1, 22, 12, state.simulationMs),
      spawnedAtMs: state.simulationMs + RESOURCE_SNAKE_CONFIG.fixedStepMs - 240,
    }
    const next = oneStep({
      ...state,
      player: fastActor(state.player, { x: 20, y: 12 }, { x: 500, y: 0 }, [dot]),
    }, { ...input, playerDirection: { x: 1, y: 0 } })

    expect(next.player.integrity).toBe(100)
    expect(collisionEvents(next)).toEqual([])
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
      player: fastActor(state.player, { x: 48, y: 12 }, { x: 500, y: 0 }),
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

  it('releases an enemy safety lock after impact so cooldown cannot force a second hit', () => {
    const state = activeCollisionState()
    const enemy = {
      ...fastActor(state.enemies[0], { x: 20, y: 12 }, { x: 500, y: 0 }),
      enemyTurnGovernor: {
        lastHeadingChangeAtMs: state.simulationMs,
        previousHeading: 'south' as const,
        normalTurnAtMs: [],
        lastEmergencyTurnAtMs: state.simulationMs,
        lockedUntilMs: state.simulationMs + 900,
        lastTurnCause: 'emergency' as const,
      },
    }
    const next = oneStep({
      ...state,
      player: {
        ...state.player,
        trail: [matureDot(1, 22, 12, state.simulationMs)],
      },
      enemies: [enemy],
    }, {
      ...input,
      enemyDirections: { 'enemy-1': { x: 1, y: 0 } },
    })

    expect(next.enemies[0].integrity).toBe(10)
    expect(next.enemies[0].enemyTurnGovernor).toMatchObject({
      lastEmergencyTurnAtMs: null,
      lockedUntilMs: next.simulationMs,
    })

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
      player: fastActor(state.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(1, 20, 12, state.simulationMs)]),
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
      player: fastActor(state.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(1, 20, 12, state.simulationMs)]),
      enemies: [
        { ...fastActor(state.enemies[0], { x: 20, y: 12 }, { x: 500, y: 0 }), integrity: 20 },
        fastActor(state.enemies[1], { x: 42, y: 15 }, { x: 0, y: 0 }),
      ],
    }, { ...input, enemyDirections: { 'enemy-1': { x: 1, y: 0 } } })
    const afterAnotherStep = oneStep(firstDeath, input)
    const secondDeath = oneStep({
      ...afterAnotherStep,
      player: fastActor(afterAnotherStep.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(2, 20, 12, afterAnotherStep.simulationMs)]),
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
    expect(secondDeath.player).toMatchObject({
      phase: 'extracting',
      velocity: { x: 0, y: 0 },
    })
    expect(secondDeath.events).toContainEqual(expect.objectContaining({
      type: 'player-extracted',
      actorId: 'player',
      startedAtMs: secondDeath.simulationMs,
    }))
    expect(secondDeath.events).not.toContainEqual(expect.objectContaining({
      type: 'snake-died',
      actorId: 'player',
    }))
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
      player: fastActor(state.player, { x: 42, y: 12 }, { x: 0, y: 0 }, [matureDot(1, 20, 12, state.simulationMs)]),
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
