import { describe, expect, it } from 'vitest'

import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import { SNAKE_DIRECTION_VECTORS } from './resourceSnakeInput'
import {
  compareSnakePlanScores,
  generateResourceSnakeTrajectoryCandidates,
  getResourceSnakePlanFutureSamples,
  measureResourceSnakePlayerAreaReduction,
  planResourceSnakeEnemy,
  planResourceSnakeGroup,
  predictResourceSnakePlayerHypotheses,
  resourceSnakePlanIsNewlyFatal,
  resourceSnakePlanToCommittedPath,
  sampleResourceSnakeCommittedPath,
  sampleResourceSnakePlan,
  type SnakePlan,
  type SnakePlanScore,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakePlayerHistorySample,
  type SnakeVector,
} from './resourceSnakePlanner'

const INTRO_PROFILE: SnakePlannerProfile = {
  lookaheadMs: 1_400,
  candidateCount: 48,
  planningHz: 10,
  commitMs: 260,
  rolloutStepMs: 50,
}

const ADVANCED_PROFILE: SnakePlannerProfile = {
  lookaheadMs: 1_800,
  candidateCount: 72,
  planningHz: 12,
  commitMs: 220,
  rolloutStepMs: 50,
}

const DUAL_PROFILE: SnakePlannerProfile = {
  lookaheadMs: 2_200,
  candidateCount: 96,
  planningHz: 14,
  commitMs: 180,
  rolloutStepMs: 50,
}

const PROFILES = [INTRO_PROFILE, ADVANCED_PROFILE, DUAL_PROFILE] as const

function actor(
  id: SnakePlannerActor['id'],
  position: SnakeVector,
  heading: SnakePlannerActor['heading'],
  overrides: Partial<SnakePlannerActor> = {},
): SnakePlannerActor {
  const direction = heading ? SNAKE_DIRECTION_VECTORS[heading] : { x: 0, y: 0 }
  const maximumSpeedPerSecond = id === 'player' ? 12 : 11.8
  return {
    id,
    position,
    heading,
    velocity: {
      x: direction.x * maximumSpeedPerSecond,
      y: direction.y * maximumSpeedPerSecond,
    },
    integrity: id === 'player' ? 100 : 50,
    maximumIntegrity: id === 'player' ? 100 : 50,
    maximumSpeedPerSecond,
    collisionGraceMs: 0,
    distanceSinceTrailDot: 0,
    role: id === 'player' ? null : id === 'enemy-0' ? 'pressure' : 'blocker',
    ...overrides,
  }
}

function snapshot(overrides: Partial<SnakePlannerSnapshot> = {}): SnakePlannerSnapshot {
  const simulationMs = overrides.simulationMs ?? 5_000
  const player = overrides.player ?? actor('player', { x: 30, y: 18 }, 'north')
  return {
    simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player,
    enemies: [actor('enemy-0', { x: 10, y: 12 }, 'east', {
      maximumSpeedPerSecond: 12.2,
      velocity: { x: 12.2, y: 0 },
    })],
    trailDots: [],
    playerHistory: [
      {
        simulationMs: simulationMs - 100,
        position: { x: player.position.x, y: player.position.y + 1.2 },
        velocity: { ...player.velocity },
      },
      { simulationMs, position: { ...player.position }, velocity: { ...player.velocity } },
    ],
    committedAllyPaths: [],
    ...overrides,
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

function minimumPathDistance(left: readonly SnakeVector[], right: readonly SnakeVector[]): number {
  let minimum = Infinity
  for (const first of left) {
    for (const second of right) {
      minimum = Math.min(minimum, Math.hypot(first.x - second.x, first.y - second.y))
    }
  }
  return minimum
}

function openPlan(profile: SnakePlannerProfile = DUAL_PROFILE): SnakePlan {
  const plan = planResourceSnakeEnemy(snapshot(), 'enemy-0', profile, null, () => 0)
  if (plan.fallback) throw new Error(`open fixture unexpectedly used fallback: ${JSON.stringify(plan)}`)
  return plan
}

describe('cyan eight-direction trajectory candidates', () => {
  it.each(PROFILES)('emits exactly $candidateCount deterministic full-speed candidates', (profile) => {
    const enemy = snapshot().enemies[0]
    const first = generateResourceSnakeTrajectoryCandidates(enemy, profile)
    const second = generateResourceSnakeTrajectoryCandidates(enemy, profile)

    expect(first).toEqual(second)
    expect(first).toHaveLength(profile.candidateCount)
    expect(first.map((candidate) => candidate.candidateIndex)).toEqual(
      Array.from({ length: profile.candidateCount }, (_, index) => index),
    )
    expect(first.every((candidate) => candidate.speedScale === 1)).toBe(true)
    expect(new Set(first.map((candidate) => JSON.stringify(candidate.headingChanges))).size)
      .toBe(profile.candidateCount)
    expect(first.every((candidate) => (
      candidate.path.length === profile.lookaheadMs / profile.rolloutStepMs
      && candidate.directions.length === candidate.path.length
    ))).toBe(true)
  })

  it('uses only exact octants and never inserts a direct reverse', () => {
    const canonical = Object.values(SNAKE_DIRECTION_VECTORS)
    const candidates = generateResourceSnakeTrajectoryCandidates(snapshot().enemies[0], DUAL_PROFILE)

    for (const candidate of candidates) {
      let prior = SNAKE_DIRECTION_VECTORS.east
      for (const direction of candidate.directions) {
        expect(canonical).toContainEqual(direction)
        expect(prior.x * direction.x + prior.y * direction.y).toBeGreaterThan(-0.999_999)
        prior = direction
      }
      expect(candidate.attackHeading).not.toBe('west')
    }
  })

  it('returns isolated candidate structures and never mutates the actor', () => {
    const enemy = deepFreeze(structuredClone(snapshot().enemies[0]))
    const before = JSON.stringify(enemy)
    const first = generateResourceSnakeTrajectoryCandidates(enemy, DUAL_PROFILE)
    const canonical = generateResourceSnakeTrajectoryCandidates(enemy, DUAL_PROFILE)
    first[0].path[0].x = 999
    first[0].directions[0].x = 999
    first[0].headingChanges![0].offsetMs = 999

    expect(generateResourceSnakeTrajectoryCandidates(enemy, DUAL_PROFILE)).toEqual(canonical)
    expect(JSON.stringify(enemy)).toBe(before)
  })

  it('rejects malformed actors and cross-wired profiles without throwing', () => {
    const malformed = { ...snapshot().enemies[0], maximumSpeedPerSecond: Number.NaN }
    const invalidProfile = { ...DUAL_PROFILE, candidateCount: 72 } as SnakePlannerProfile

    expect(generateResourceSnakeTrajectoryCandidates(malformed, DUAL_PROFILE)).toEqual([])
    expect(generateResourceSnakeTrajectoryCandidates(snapshot().enemies[0], invalidProfile)).toEqual([])
  })
})

describe('cyan planner decisions', () => {
  it.each([
    [INTRO_PROFILE, 220, 260],
    [ADVANCED_PROFILE, 190, 220],
    [DUAL_PROFILE, 160, 180],
  ] as const)('plans the production tier with a stable telegraph and commit', (
    profile,
    telegraphMs,
    commitMs,
  ) => {
    const plan = openPlan(profile)

    expect(plan.fallback).toBe(false)
    expect(plan.speedScale).toBe(1)
    expect(plan.evaluatedCandidates).toBe(profile.candidateCount)
    expect(plan.commandAtMs - plan.plannedAtMs).toBe(telegraphMs)
    expect(plan.commitUntilMs - plan.commandAtMs).toBe(commitMs)
    expect(plan.originHeading).toBe('east')
    expect(plan.attackHeading).not.toBe('west')
    expect(plan.direction).toEqual(SNAKE_DIRECTION_VECTORS[plan.attackHeading!])
    expect(plan.score.survives).toBe(1)
  })

  it('holds the origin direction until commandAtMs and applies the advertised heading exactly', () => {
    const plan = openPlan()
    const before = sampleResourceSnakePlan(plan, plan.commandAtMs - 0.001)
    const atCommit = sampleResourceSnakePlan(plan, plan.commandAtMs)
    const after = sampleResourceSnakePlan(plan, plan.commandAtMs + 50)

    expect(before.direction).toEqual(SNAKE_DIRECTION_VECTORS.east)
    expect(atCommit.direction).toEqual(plan.direction)
    expect(after.direction).toEqual(plan.direction)
    expect(Math.hypot(atCommit.velocity.x, atCommit.velocity.y)).toBeCloseTo(12.2, 10)
  })

  it('is deterministic, cache isolated, and leaves a deeply frozen snapshot untouched', () => {
    const state = deepFreeze(snapshot())
    const before = JSON.stringify(state)
    const first = planResourceSnakeEnemy(state, 'enemy-0', DUAL_PROFILE, null, () => 0)
    const second = planResourceSnakeEnemy(state, 'enemy-0', DUAL_PROFILE, null, () => 0)
    const canonical = structuredClone(second)
    first.path[0].x = 999
    first.directions[0].x = 999

    expect(planResourceSnakeEnemy(state, 'enemy-0', DUAL_PROFILE, null, () => 0))
      .toEqual(canonical)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('uses a maximum-clearance legal 0.92 recovery instead of a zero command', () => {
    const malformed = {
      ...snapshot(),
      trailDots: [{ malformed: true }],
    } as unknown as SnakePlannerSnapshot
    const plan = planResourceSnakeEnemy(malformed, 'enemy-0', DUAL_PROFILE, null, () => 0)

    expect(plan.fallback).toBe(true)
    expect(plan.speedScale).toBe(0.92)
    expect(plan.directions.length).toBeGreaterThan(0)
    expect(Math.hypot(plan.direction.x, plan.direction.y)).toBeCloseTo(1, 12)
    expect(plan.attackHeading).not.toBe('west')
    const attack = SNAKE_DIRECTION_VECTORS[plan.attackHeading!]
    expect(SNAKE_DIRECTION_VECTORS.east.x * attack.x
      + SNAKE_DIRECTION_VECTORS.east.y * attack.y).toBeGreaterThanOrEqual(0)
  })

  it('marks a newly occupied committed prefix fatal but keeps the open plan stable', () => {
    const plan = openPlan()
    const open = snapshot()
    const hazard: SnakePlannerTrailDot = {
      id: 999,
      ownerId: 'player',
      position: { ...plan.path[0] },
      spawnedAtMs: open.simulationMs - 1_000,
      expiresAtMs: open.simulationMs + 5_000,
    }

    expect(resourceSnakePlanIsNewlyFatal(open, plan)).toBe(false)
    expect(resourceSnakePlanIsNewlyFatal({ ...open, trailDots: [hazard] }, plan)).toBe(true)
  })

  it('invalidates a same-length trail index when a cached dot moves into the committed prefix', () => {
    const open = snapshot()
    const plan = planResourceSnakeEnemy(open, 'enemy-0', DUAL_PROFILE, null, () => 0)
    const harmless: SnakePlannerTrailDot = {
      id: 7_001,
      ownerId: 'player',
      position: { x: 48, y: 22 },
      spawnedAtMs: open.simulationMs - 1_000,
      expiresAtMs: open.simulationMs + 5_000,
    }
    const hazard: SnakePlannerTrailDot = {
      ...harmless,
      position: { ...plan.path[0] },
    }

    expect(resourceSnakePlanIsNewlyFatal({ ...open, trailDots: [harmless] }, plan)).toBe(false)
    expect(resourceSnakePlanIsNewlyFatal({ ...open, trailDots: [hazard] }, plan)).toBe(true)
  })

  it('chooses a safe octant around a persistent wall rather than predicted suicide', () => {
    const state = snapshot()
    const wall = Array.from({ length: 18 }, (_, index): SnakePlannerTrailDot => ({
      id: 2_000 + index,
      ownerId: 'player',
      position: { x: 13, y: 4 + index * 0.5 },
      spawnedAtMs: 0,
      expiresAtMs: 20_000,
    }))
    const plan = planResourceSnakeEnemy(
      { ...state, trailDots: wall },
      'enemy-0',
      DUAL_PROFILE,
      null,
      () => 0,
    )

    expect(plan.score.survives).toBe(1)
    expect(plan.fallback).toBe(false)
    expect(plan.attackHeading).not.toBe('east')
    expect(plan.score.selfEscape).toBeGreaterThan(0)
    expect(plan.score.responsePathFloor).toBeGreaterThan(0)
    expect(Number.isFinite(plan.score.intersectionLead)).toBe(true)
    expect(minimumPathDistance(plan.path.slice(0, 8), wall.map((dot) => dot.position)))
      .toBeGreaterThan(0.5)
  })

  it('retains at least one advertised player response path in an open intersection', () => {
    const plan = planResourceSnakeEnemy(snapshot({
      player: actor('player', { x: 26, y: 12 }, 'north'),
      enemies: [actor('enemy-0', { x: 12, y: 12 }, 'east', {
        role: 'pressure',
        maximumSpeedPerSecond: 12.2,
        velocity: { x: 12.2, y: 0 },
      })],
    }), 'enemy-0', DUAL_PROFILE, null, () => 0)

    expect(plan).toMatchObject({ fallback: false, score: { survives: 1 } })
    expect(plan.score.selfEscape).toBeGreaterThan(0)
    expect(plan.score.responsePathFloor).toBeGreaterThanOrEqual(1)
  })

  it('does not rasterize its own superseded commitment as an ally obstacle', () => {
    const initial = snapshot({
      simulationMs: 360,
      player: actor('player', { x: 25, y: 21 }, 'north', {
        velocity: { x: 0, y: 0 },
      }),
      enemies: [actor('enemy-0', { x: 25, y: 3.5 }, 'south', {
        role: 'pressure',
        maximumSpeedPerSecond: 12.2,
        velocity: { x: 0, y: 0 },
      })],
      playerHistory: [],
    })
    const priorPlan = planResourceSnakeGroup(
      initial,
      ADVANCED_PROFILE,
      [],
      [],
      () => 0,
    ).plans[0]
    const state = snapshot({
      simulationMs: 443.3333333333333,
      player: actor('player', { x: 25, y: 20 }, 'north'),
      enemies: [actor('enemy-0', { x: 25, y: 4.52 }, 'south', {
        role: 'pressure',
        maximumSpeedPerSecond: 12.2,
        velocity: { x: 0, y: 12.2 },
      })],
      trailDots: [
        { id: 9_000, ownerId: 'player' as const, position: { x: 25, y: 20.68 }, spawnedAtMs: 393.3333333333333, expiresAtMs: 10_000 },
        { id: 9_001, ownerId: 'player' as const, position: { x: 25, y: 20.36 }, spawnedAtMs: 426.6666666666667, expiresAtMs: 10_000 },
        { id: 9_005, ownerId: 'player' as const, position: { x: 25, y: 20.04 }, spawnedAtMs: 443.3333333333333, expiresAtMs: 10_000 },
        { id: 9_002, ownerId: 'enemy-0' as const, position: { x: 25, y: 3.82 }, spawnedAtMs: 393.3333333333333, expiresAtMs: 10_000 },
        { id: 9_003, ownerId: 'enemy-0' as const, position: { x: 25, y: 4.14 }, spawnedAtMs: 418.3333333333333, expiresAtMs: 10_000 },
        { id: 9_004, ownerId: 'enemy-0' as const, position: { x: 25, y: 4.46 }, spawnedAtMs: 443.3333333333333, expiresAtMs: 10_000 },
      ],
      playerHistory: [
        { simulationMs: 360, position: { x: 25, y: 21 }, velocity: { x: 0, y: 0 } },
        { simulationMs: 385, position: { x: 25, y: 20.7 }, velocity: { x: 0, y: -12 } },
        { simulationMs: 410, position: { x: 25, y: 20.4 }, velocity: { x: 0, y: -12 } },
        { simulationMs: 443.3333333333333, position: { x: 25, y: 20 }, velocity: { x: 0, y: -12 } },
      ],
    })
    const baseline = planResourceSnakeGroup(
      state,
      ADVANCED_PROFILE,
      [priorPlan],
      [],
      () => 0,
    ).plans[0]
    expect(baseline.score.responsePathFloor).toBeGreaterThan(0)
    const ownCommitment = resourceSnakePlanToCommittedPath(priorPlan, state.simulationMs)
    expect(ownCommitment).not.toBeNull()

    const withSupersededSelf = planResourceSnakeGroup({
      ...state,
      committedAllyPaths: [ownCommitment!],
    }, ADVANCED_PROFILE, [priorPlan], [], () => 0).plans[0]

    expect(withSupersededSelf).toMatchObject({
      fallback: baseline.fallback,
      candidateIndex: baseline.candidateIndex,
      attackHeading: baseline.attackHeading,
      score: baseline.score,
    })
  })

  it('does not call a separating head contact fatal while mutual grace is active', () => {
    const state = snapshot({
      simulationMs: 8_000,
      player: actor('player', { x: 24.8, y: 12 }, 'west', {
        velocity: { x: -12, y: 0 },
        collisionGraceMs: 650,
      }),
      enemies: [actor('enemy-0', { x: 25.4, y: 12 }, 'east', {
        role: 'pressure',
        maximumSpeedPerSecond: 12.2,
        velocity: { x: 12.2, y: 0 },
        collisionGraceMs: 650,
      })],
      playerHistory: [],
    })
    const separating = planResourceSnakeEnemy(
      state,
      'enemy-0',
      ADVANCED_PROFILE,
      null,
      () => 0,
    )

    expect(separating).toMatchObject({ fallback: false, score: { survives: 1 } })
    expect(resourceSnakePlanIsNewlyFatal(state, separating)).toBe(false)
  })

  it('recovers out of a conservative head-clearance overlap without physical contact', () => {
    const state = snapshot({
      simulationMs: 8_500,
      player: actor('player', { x: 23.4444, y: 11.8189 }, 'north-west'),
      enemies: [actor('enemy-0', { x: 22.5393, y: 12.2618 }, 'south-east', {
        role: 'pressure',
        maximumSpeedPerSecond: 12.2,
        velocity: {
          x: SNAKE_DIRECTION_VECTORS['south-east'].x * 12.2,
          y: SNAKE_DIRECTION_VECTORS['south-east'].y * 12.2,
        },
      })],
      playerHistory: [],
    })
    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      INTRO_PROFILE,
      null,
      () => 0,
    )

    expect(Math.hypot(
      state.player.position.x - state.enemies[0].position.x,
      state.player.position.y - state.enemies[0].position.y,
    )).toBeGreaterThan(0.68)
    expect(recovery).toMatchObject({
      intent: 'escape',
      fallback: false,
      speedScale: 0.92,
    })
    expect(resourceSnakePlanIsNewlyFatal(state, recovery)).toBe(false)
  })

  it('treats leaving an overlapping mature self dot as a valid escape path', () => {
    const simulationMs = 9_000
    const state = snapshot({
      simulationMs,
      player: actor('player', { x: 32, y: 18 }, 'north'),
      enemies: [actor('enemy-0', { x: 10.51, y: 10 }, 'north', {
        role: 'pressure',
        maximumSpeedPerSecond: 6.1,
        velocity: { x: 0, y: -6.1 },
      })],
      trailDots: [{
        id: 1,
        ownerId: 'enemy-0',
        position: { x: 10, y: 10 },
        spawnedAtMs: simulationMs - 1_000,
        expiresAtMs: simulationMs + 9_000,
      }],
      playerHistory: [],
    })

    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      INTRO_PROFILE,
      null,
      () => 0,
    )

    expect(recovery).toMatchObject({
      fallback: false,
      score: { survives: 1 },
    })
    expect(resourceSnakePlanIsNewlyFatal(state, recovery)).toBe(false)
  })

  it('does not ignore a mature self dot inside navigation reserve when moving toward it', () => {
    const simulationMs = 9_250
    const state = snapshot({
      simulationMs,
      player: actor('player', { x: 42, y: 19 }, 'west'),
      enemies: [actor('enemy-0', { x: 10, y: 10 }, 'east', {
        role: 'pressure',
        integrity: 25,
        maximumIntegrity: 50,
        maximumSpeedPerSecond: 6.1,
        velocity: { x: 6.1, y: 0 },
      })],
      trailDots: [{
        id: 1,
        ownerId: 'enemy-0',
        position: { x: 10.8, y: 10 },
        spawnedAtMs: simulationMs - 1_000,
        expiresAtMs: simulationMs + 9_000,
      }],
      playerHistory: [],
    })

    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      INTRO_PROFILE,
      null,
      () => 0,
    )

    expect(recovery.intent).toBe('escape')
    expect(recovery.path[0].x).toBeLessThanOrEqual(state.enemies[0].position.x)
    expect(resourceSnakePlanIsNewlyFatal(state, recovery)).toBe(false)
  })

  it('does not invent an immediate collision while escaping a cluster of own dots already under the head', () => {
    const simulationMs = 9_500
    const enemyPosition = { x: 20, y: 12 }
    const state = snapshot({
      simulationMs,
      player: actor('player', { x: 42, y: 19 }, 'west'),
      enemies: [actor('enemy-0', enemyPosition, 'south-east', {
        role: 'pressure',
        maximumSpeedPerSecond: 6.1,
        velocity: {
          x: SNAKE_DIRECTION_VECTORS['south-east'].x * 6.1,
          y: SNAKE_DIRECTION_VECTORS['south-east'].y * 6.1,
        },
      })],
      trailDots: [
        { x: 19.75, y: 12 },
        { x: 20.25, y: 12 },
        { x: 20, y: 11.75 },
        { x: 20, y: 12.25 },
      ].map((position, index) => ({
        id: index + 1,
        ownerId: 'enemy-0' as const,
        position,
        spawnedAtMs: simulationMs - 1_000 - index * 50,
        expiresAtMs: simulationMs + 9_000,
      })),
      playerHistory: [],
    })

    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      INTRO_PROFILE,
      null,
      () => 0,
    )

    expect(recovery.directions.length).toBeGreaterThan(0)
    expect(recovery.path.length).toBeGreaterThan(0)
    expect(recovery.commitUntilMs).toBeGreaterThan(simulationMs)
    expect(recovery).toMatchObject({ fallback: false, score: { survives: 1 } })
    expect(resourceSnakePlanIsNewlyFatal(state, recovery)).toBe(false)
  })

  it('can move out of planner reserve around a physically non-overlapping player dot', () => {
    const simulationMs = 11_535
    const state = snapshot({
      simulationMs,
      player: actor('player', { x: 28.46, y: 17.97 }, 'north'),
      enemies: [actor('enemy-0', { x: 42.17, y: 20.216 }, 'west', {
        role: 'pressure',
        maximumSpeedPerSecond: 6.1,
        velocity: { x: -6.1, y: 0 },
      })],
      trailDots: [{
        id: 1,
        ownerId: 'player',
        position: { x: 42.183, y: 19.694 },
        spawnedAtMs: simulationMs - 5_000,
        expiresAtMs: simulationMs + 5_000,
      }],
      playerHistory: [],
    })

    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      INTRO_PROFILE,
      null,
      () => 0,
    )

    expect(recovery).toMatchObject({ fallback: false, score: { survives: 1 } })
    expect(resourceSnakePlanIsNewlyFatal(state, recovery)).toBe(false)
  })

  it('recovers inward from the runtime boundary inside the planner reserve', () => {
    const state = snapshot({
      simulationMs: 9_000,
      player: actor('player', { x: 18, y: 18 }, 'south'),
      enemies: [actor('enemy-0', { x: 17.34, y: 0.3667 }, 'north', {
        role: 'pressure',
        maximumSpeedPerSecond: 12.2,
        velocity: { x: 0, y: -12.2 },
      })],
      playerHistory: [],
    })
    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      DUAL_PROFILE,
      null,
      () => 0,
    )

    expect(recovery).toMatchObject({
      intent: 'escape',
      fallback: false,
      speedScale: 0.92,
    })
    expect(recovery.attackHeading).not.toBe('north')
    expect(resourceSnakePlanIsNewlyFatal(state, recovery)).toBe(false)
  })

  it('does not emit a 135-degree recovery that the runtime governor must reject', () => {
    const simulationMs = 45_068.33333333501
    const state = snapshot({
      simulationMs,
      player: actor('player', { x: 30, y: 8 }, 'west'),
      enemies: [actor('enemy-0', { x: 37.835188393042536, y: 19.004120750380594 }, 'east', {
        role: 'pressure',
        integrity: 10,
        maximumIntegrity: 30,
        maximumSpeedPerSecond: 8.7,
        velocity: { x: 8.7, y: 0 },
        enemyTurnGovernor: {
          lastHeadingChangeAtMs: 43_101.66666666777,
          previousHeading: 'north-east',
          normalTurnAtMs: [],
          lastEmergencyTurnAtMs: 43_101.66666666777,
          lockedUntilMs: 44_001.66666666777,
          lastTurnCause: 'emergency-correction',
        },
      })],
      trailDots: [
        { x: 38.98059530933988, y: 18.754813834083215 },
        { x: 38.754321139360194, y: 18.98108800406291 },
        { x: 38.5280469693805, y: 19.207362174042608 },
        { x: 38.3017727994008, y: 19.4336363440223 },
        { x: 38.075498629421105, y: 19.659910514001997 },
        { x: 37.84922445944141, y: 19.886184683981693 },
      ].map((position, index) => ({
        id: 900 + index,
        ownerId: 'enemy-0' as const,
        position,
        spawnedAtMs: simulationMs - 4_800 + index * 40,
        expiresAtMs: simulationMs + 5_200 + index * 40,
      })),
      playerHistory: [],
    })

    const recovery = planResourceSnakeEnemy(
      state,
      'enemy-0',
      INTRO_PROFILE,
      null,
      () => 0,
    )
    const origin = SNAKE_DIRECTION_VECTORS.east
    const attack = SNAKE_DIRECTION_VECTORS[recovery.attackHeading!]

    expect(recovery.intent).toBe('escape')
    expect(origin.x * attack.x + origin.y * attack.y).toBeGreaterThanOrEqual(0)
  })
})

describe('cyan group coordination', () => {
  function dualSnapshot(): SnakePlannerSnapshot {
    return snapshot({
      player: actor('player', { x: 25, y: 21 }, 'north'),
      enemies: [
        actor('enemy-0', { x: 16, y: 3.5 }, 'south', {
          role: 'pressure', maximumSpeedPerSecond: 12.2,
          velocity: { x: 0, y: 12.2 },
        }),
        actor('enemy-1', { x: 34, y: 3.5 }, 'south', {
          role: 'blocker', maximumSpeedPerSecond: 11.8,
          velocity: { x: 0, y: 11.8 },
        }),
      ],
    })
  }

  it('plans pressure first, then blocker against pressure occupancy on one shared cadence', () => {
    const state = dualSnapshot()
    const group = planResourceSnakeGroup(state, DUAL_PROFILE, [], [], () => 0)

    expect(group.plans.map((plan) => plan.enemyId)).toEqual(['enemy-0', 'enemy-1'])
    expect(group.roles).toEqual({ 'enemy-0': 'pressure', 'enemy-1': 'blocker' })
    expect(group.candidateBudget).toBe(96)
    expect(group.nextPlanningAtMs).toBeCloseTo(state.simulationMs + 1_000 / 14, 9)
    expect(group.plans.every((plan) => (
      plan.speedScale === 1
      && !plan.fallback
      && plan.score.survives === 1
      && plan.evaluatedCandidates === 96
    ))).toBe(true)
  })

  it('keeps role endpoints and committed paths separated', () => {
    const state = dualSnapshot()
    const group = planResourceSnakeGroup(state, DUAL_PROFILE, [], [], () => 0)
    const [pressure, blocker] = group.plans
    const endpointDistance = Math.hypot(
      pressure.path.at(-1)!.x - blocker.path.at(-1)!.x,
      pressure.path.at(-1)!.y - blocker.path.at(-1)!.y,
    )
    const pressureCommitment = resourceSnakePlanToCommittedPath(pressure)
    const blockerCommitment = resourceSnakePlanToCommittedPath(blocker)

    expect(endpointDistance).toBeGreaterThanOrEqual(1.2)
    expect(pressureCommitment).not.toBeNull()
    expect(blockerCommitment).not.toBeNull()
    expect(minimumPathDistance(
      pressureCommitment!.samples.map((sample) => sample.position),
      blockerCommitment!.samples.map((sample) => sample.position),
    )).toBeGreaterThan(0.75)
    const endpointSector = (plan: SnakePlan) => {
      const endpoint = plan.path.at(-1)!
      return `${Math.floor(endpoint.x / 10)}:${Math.floor(endpoint.y / 6)}`
    }
    expect(endpointSector(pressure)).not.toBe(endpointSector(blocker))
    expect(pressure.attackHeading).not.toBe(blocker.attackHeading)
  })

  it('accepts an authoritative 120Hz commitment longer than the old 64-sample cap', () => {
    const state = dualSnapshot()
    const sampleCount = 96
    const samples = Array.from({ length: sampleCount }, (_, index) => ({
      atMs: state.simulationMs + index * (1_000 / 120),
      position: { x: 16, y: 3.5 + index * 0.01 },
    }))
    const commitment = {
      enemyId: 'enemy-0' as const,
      commitUntilMs: samples.at(-1)!.atMs,
      samples,
    }

    const group = planResourceSnakeGroup({
      ...state,
      committedAllyPaths: [commitment],
    }, DUAL_PROFILE, [], [], () => 0)

    expect(group.plans.map((plan) => plan.enemyId)).toEqual(['enemy-0', 'enemy-1'])
  })

  it('reassigns the sole surviving enemy to pressure at the next planning boundary', () => {
    const survivingBlocker = actor('enemy-1', { x: 34, y: 8 }, 'south', {
      role: 'blocker', maximumSpeedPerSecond: 11.8,
      velocity: { x: 0, y: 11.8 },
    })
    const state = snapshot({ enemies: [survivingBlocker] })
    const group = planResourceSnakeGroup(state, DUAL_PROFILE, [], [], () => 0)

    expect(group.roles).toEqual({ 'enemy-1': 'pressure' })
    expect(group.plans).toHaveLength(1)
    expect(group.plans[0]).toMatchObject({ enemyId: 'enemy-1', role: 'pressure' })
  })

  it('never returns a stopped group hold when ordinary planning is forced into recovery', () => {
    const state = dualSnapshot()
    const malformed = {
      ...state,
      trailDots: [{ malformed: true }],
    } as unknown as SnakePlannerSnapshot
    const enemyPlan = planResourceSnakeEnemy(
      malformed,
      'enemy-0',
      DUAL_PROFILE,
      null,
      () => 0,
    )

    expect(enemyPlan.speedScale).toBe(0.92)
    expect(Math.hypot(enemyPlan.direction.x, enemyPlan.direction.y)).toBeCloseTo(1, 12)
  })
})

describe('planner prediction, scoring, and timed occupancy', () => {
  it('builds four present-state-only player hypotheses over the exact horizon', () => {
    const state = snapshot()
    const hypotheses = predictResourceSnakePlayerHypotheses(state, 2_200, 50)

    expect(hypotheses.all).toHaveLength(4)
    expect(hypotheses.all.every((path) => path.length === 44)).toBe(true)
    expect(hypotheses.keepVelocity[0]).toEqual({ x: 30, y: 17.4 })
    expect(hypotheses.stayStopped.every((point) => (
      point.x === state.player.position.x && point.y === state.player.position.y
    ))).toBe(true)
    expect(predictResourceSnakePlayerHypotheses({}, 2_200, 50).all.every(
      (path) => path.length === 0,
    )).toBe(true)
  })

  it('keeps median-turn prediction identical for chronological and shuffled history', () => {
    const state = snapshot()
    const history: SnakePlayerHistorySample[] = [
      { simulationMs: 3_000, position: { x: 28, y: 18 }, velocity: { x: 12, y: 0 } },
      { simulationMs: 4_000, position: { x: 29, y: 18 }, velocity: { x: 8.485, y: -8.485 } },
      { simulationMs: 5_000, position: { x: 30, y: 18 }, velocity: { x: 0, y: -12 } },
    ]

    const chronological = predictResourceSnakePlayerHypotheses({
      ...state,
      playerHistory: history,
    }, 2_200, 50)
    const shuffled = predictResourceSnakePlayerHypotheses({
      ...state,
      playerHistory: [history[2], history[0], history[1]],
    }, 2_200, 50)

    expect(shuffled.continueMedianTurn).toEqual(chronological.continueMedianTurn)
  })

  it('converts a plan into exact future samples and canonical committed occupancy', () => {
    const plan = openPlan()
    const fromMs = plan.plannedAtMs + 50
    const future = getResourceSnakePlanFutureSamples(plan, fromMs)
    const committed = resourceSnakePlanToCommittedPath(plan, fromMs)

    expect(future.every((sample) => sample.atMs > fromMs)).toBe(true)
    expect(committed?.samples[0]).toEqual({
      atMs: fromMs,
      position: sampleResourceSnakePlan(plan, fromMs).position,
    })
    expect(committed?.samples.at(-1)?.atMs).toBe(plan.commitUntilMs)
    for (const atMs of [fromMs, fromMs + 50, plan.commandAtMs, plan.commitUntilMs]) {
      expect(sampleResourceSnakeCommittedPath(committed!, atMs)?.position)
        .toEqual(sampleResourceSnakePlan(plan, atMs).position)
    }
    expect(resourceSnakePlanToCommittedPath(plan, plan.commitUntilMs)).toBeNull()
  })

  it('keeps lexicographic safety and space ahead of offensive tie breakers', () => {
    const base: SnakePlanScore = {
      survives: 1,
      selfEscape: 6,
      responsePathFloor: 4,
      reachableArea: 100,
      allyClearance: 5,
      intersectionLead: 3,
      playerAreaReduction: 4,
      cutoffProgress: 3,
      pressureDistance: 2,
      steeringCost: 1,
    }

    expect(compareSnakePlanScores(base, 2, { ...base, survives: 0 }, 1)).toBe(1)
    expect(compareSnakePlanScores(base, 2, { ...base, selfEscape: 5 }, 1)).toBe(1)
    expect(compareSnakePlanScores(base, 2, { ...base, responsePathFloor: 3 }, 1)).toBe(1)
    expect(compareSnakePlanScores(base, 2, { ...base, reachableArea: 99 }, 1)).toBe(1)
    expect(compareSnakePlanScores(base, 2, { ...base, intersectionLead: 2 }, 1)).toBe(1)
    expect(compareSnakePlanScores(base, 2, { ...base, steeringCost: 2 }, 1)).toBe(1)
    expect(compareSnakePlanScores(base, 1, base, 2)).toBe(1)
  })

  it('measures candidate enclosure without accepting malformed paths', () => {
    const state = snapshot()
    const candidate = generateResourceSnakeTrajectoryCandidates(
      state.enemies[0],
      INTRO_PROFILE,
    )[0]
    const measured = measureResourceSnakePlayerAreaReduction(
      state,
      'enemy-0',
      INTRO_PROFILE,
      candidate.path,
    )

    expect(measured).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(measured)).toBe(true)
    expect(measureResourceSnakePlayerAreaReduction(
      state,
      'enemy-0',
      INTRO_PROFILE,
      [{ x: Number.NaN, y: 0 }],
    )).toBe(0)
  })

  it('fails closed and remains serializable for malformed public timeline inputs', () => {
    const malformed = {} as SnakePlan
    const sample = sampleResourceSnakePlan(malformed, Number.NaN)

    expect(sample).toEqual({
      atMs: 0,
      cursor: 0,
      direction: { x: 0, y: 0 },
      speedScale: 0,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
    })
    expect(getResourceSnakePlanFutureSamples(malformed, 0)).toEqual([])
    expect(resourceSnakePlanToCommittedPath(malformed)).toBeNull()
    expect(sampleResourceSnakeCommittedPath({} as never, 0)).toBeNull()
    expect(() => JSON.stringify(sample)).not.toThrow()
  })
})

describe.runIf(process.env.RESOURCE_SNAKE_PERF_ACCEPTANCE === '1')(
  'cyan external planner performance',
  () => {
    it('keeps the 96-candidate external p95 at or below 3ms', () => {
      for (let index = 0; index < 50; index += 1) {
        planResourceSnakeEnemy(snapshot({ simulationMs: 5_000 + index * 50 }), (
          'enemy-0'
        ), DUAL_PROFILE, null)
      }
      const durations: number[] = []
      for (let index = 0; index < 31; index += 1) {
        const state = snapshot({ simulationMs: 8_000 + index * 50 })
        const startedAt = performance.now()
        const plan = planResourceSnakeEnemy(state, 'enemy-0', DUAL_PROFILE, null)
        durations.push(performance.now() - startedAt)
        expect(plan).toMatchObject({
          fallback: false,
          evaluatedCandidates: 96,
          speedScale: 1,
        })
      }
      durations.sort((left, right) => left - right)
      const evidence = {
        samples: durations.length,
        p50: durations[Math.floor(durations.length * 0.5)],
        p95: durations[Math.ceil(durations.length * 0.95) - 1],
        maximum: durations.at(-1),
      }
      if (process.env.RESOURCE_SNAKE_PERF_REPORT === '1') {
        process.stdout.write(`RESOURCE_SNAKE_CYAN_PERF ${JSON.stringify(evidence)}\n`)
      }
      expect(evidence.p95, JSON.stringify(evidence)).toBeLessThanOrEqual(3)
    })
  },
)
