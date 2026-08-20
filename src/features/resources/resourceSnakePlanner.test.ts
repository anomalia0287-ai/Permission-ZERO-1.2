import { describe, expect, it } from 'vitest'
import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import {
  RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND,
  planResourceSnakeEnemy,
  type SnakeCommittedPath,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakePlayerHistorySample,
  type SnakeVector,
} from './resourceSnakePlanner'

const PROFILE_48: SnakePlannerProfile = {
  lookaheadMs: 1_000,
  candidateCount: 48,
  planningHz: 6,
  commitMs: 420,
  rolloutStepMs: 50,
}

const PROFILE_72: SnakePlannerProfile = {
  lookaheadMs: 1_400,
  candidateCount: 72,
  planningHz: 7,
  commitMs: 360,
  rolloutStepMs: 50,
}

const PROFILE_96: SnakePlannerProfile = {
  lookaheadMs: 2_000,
  candidateCount: 96,
  planningHz: 9,
  commitMs: 260,
  rolloutStepMs: 50,
}

function actor(
  id: SnakePlannerActor['id'],
  position: SnakeVector,
  velocity: SnakeVector,
  overrides: Partial<SnakePlannerActor> = {},
): SnakePlannerActor {
  return {
    id,
    position,
    velocity,
    integrity: 50,
    maximumIntegrity: 50,
    maximumSpeedPerSecond: id === 'player' ? 8 : 6.5,
    collisionGraceMs: 0,
    role: id === 'player' ? null : 'pressure',
    ...overrides,
  }
}

function history(
  simulationMs: number,
  position: SnakeVector,
  velocity: SnakeVector,
): SnakePlayerHistorySample[] {
  return [
    { simulationMs: simulationMs - 1_500, position: { ...position }, velocity: { ...velocity } },
    { simulationMs: simulationMs - 1_000, position: { ...position }, velocity: { ...velocity } },
    { simulationMs: simulationMs - 500, position: { ...position }, velocity: { ...velocity } },
    { simulationMs, position: { ...position }, velocity: { ...velocity } },
  ]
}

function snapshot(overrides: Partial<SnakePlannerSnapshot> = {}): SnakePlannerSnapshot {
  const simulationMs = overrides.simulationMs ?? 5_000
  const player = overrides.player ?? actor('player', { x: 30, y: 12 }, { x: 0, y: 0 })
  return {
    simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player,
    enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 })],
    trailDots: [],
    playerHistory: history(simulationMs, player.position, player.velocity),
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

function observableTuple(plan: SnakePlan) {
  return {
    direction: plan.direction,
    path: plan.path,
    intent: plan.intent,
    score: plan.score,
    candidateIndex: plan.candidateIndex,
    evaluatedCandidates: plan.evaluatedCandidates,
    fallback: plan.fallback,
  }
}

function minimumDistance(points: readonly SnakeVector[], target: SnakeVector): number {
  return Math.min(...points.map((point) => Math.hypot(point.x - target.x, point.y - target.y)))
}

function trailWall(
  x: number,
  fromY: number,
  toY: number,
  expiresAtMs: number,
  omitted: (y: number) => boolean = () => false,
): SnakePlannerTrailDot[] {
  const dots: SnakePlannerTrailDot[] = []
  let id = 1
  for (let y = fromY; y <= toY; y += 0.5) {
    if (omitted(y)) continue
    dots.push({ id, ownerId: 'player', position: { x, y }, expiresAtMs })
    id += 1
  }
  return dots
}

function horizontalTrailWall(
  y: number,
  fromX: number,
  toX: number,
  expiresAtMs: number,
): SnakePlannerTrailDot[] {
  const dots: SnakePlannerTrailDot[] = []
  let id = 1_000
  for (let x = fromX; x <= toX; x += 0.5) {
    dots.push({ id, ownerId: 'player', position: { x, y }, expiresAtMs })
    id += 1
  }
  return dots
}

function previousPlan(path: SnakeVector[], commitUntilMs = 1_500): SnakePlan {
  return {
    enemyId: 'enemy-0',
    intent: 'cutoff',
    role: 'pressure',
    direction: { x: 1, y: 0 },
    speedScale: 1,
    commitUntilMs,
    path,
    score: {
      survives: 1,
      reachableArea: 300,
      allyClearance: 20,
      playerAreaReduction: 4,
      cutoffProgress: 3,
      pressureDistance: 5,
      steeringCost: 0,
    },
    candidateIndex: 0,
    evaluatedCandidates: 48,
    elapsedMs: 0,
    fallback: false,
  }
}

describe('planResourceSnakeEnemy', () => {
  it('uses only serializable observations from the last 2,000ms without mutating them', () => {
    const base = snapshot({
      playerHistory: [
        { simulationMs: 2_500, position: { x: 2, y: 2 }, velocity: { x: -8, y: 0 } },
        ...history(5_000, { x: 30, y: 12 }, { x: 0, y: 0 }),
      ],
    })
    const before = JSON.stringify(base)
    const frozen = deepFreeze(base)
    const withFutureLeft = {
      ...frozen,
      futureScriptedInput: [{ simulationMs: 5_050, direction: { x: -1, y: 0 } }],
    } as SnakePlannerSnapshot
    const withFutureRightAndDifferentOldSample = {
      ...frozen,
      playerHistory: [
        { simulationMs: 2_500, position: { x: 48, y: 22 }, velocity: { x: 8, y: 0 } },
        ...frozen.playerHistory.slice(1),
      ],
      futureScriptedInput: [{ simulationMs: 5_050, direction: { x: 1, y: 0 } }],
    } as SnakePlannerSnapshot

    const left = planResourceSnakeEnemy(withFutureLeft, 'enemy-0', PROFILE_48, null, () => 10)
    const right = planResourceSnakeEnemy(
      withFutureRightAndDifferentOldSample,
      'enemy-0',
      PROFILE_48,
      null,
      () => 10,
    )

    expect(observableTuple(left)).toEqual(observableTuple(right))
    expect(JSON.stringify(base)).toBe(before)
    expect(() => JSON.stringify(left)).not.toThrow()
  })

  it.each([
    [PROFILE_48, 48],
    [PROFILE_72, 72],
    [PROFILE_96, 96],
  ] as const)('evaluates the exact heading-by-speed budget and limits every rollout turn', (profile, count) => {
    const state = snapshot()
    const plan = planResourceSnakeEnemy(state, 'enemy-0', profile, null, () => 0)
    const positions = [state.enemies[0].position, ...plan.path]
    let priorHeading = Math.atan2(state.enemies[0].velocity.y, state.enemies[0].velocity.x)

    expect(plan.evaluatedCandidates).toBe(count)
    expect(plan.path).toHaveLength(profile.lookaheadMs / 50)
    for (let index = 1; index < positions.length; index += 1) {
      const dx = positions[index].x - positions[index - 1].x
      const dy = positions[index].y - positions[index - 1].y
      if (Math.hypot(dx, dy) < 1e-9) continue
      const heading = Math.atan2(dy, dx)
      const turn = Math.abs(Math.atan2(Math.sin(heading - priorHeading), Math.cos(heading - priorHeading)))
      expect(turn).toBeLessThanOrEqual(RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND * 0.05 + 1e-9)
      priorHeading = heading
    }
  })

  it('cuts laterally around a stationary player instead of pursuing head-on', () => {
    const state = snapshot({
      player: actor('player', { x: 18, y: 12 }, { x: 0, y: 0 }),
      enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 })],
      playerHistory: history(5_000, { x: 18, y: 12 }, { x: 0, y: 0 }),
    })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_72, null, () => 0)
    const finalPoint = plan.path.at(-1)!

    expect(plan.intent).toBe('cutoff')
    expect(Math.abs(plan.direction.y)).toBeGreaterThan(0.05)
    expect(Math.abs(finalPoint.y - state.player.position.y)).toBeGreaterThan(1)
    expect(minimumDistance(plan.path, state.player.position)).toBeGreaterThan(1.1)
  })

  it('takes the corridor whose blocking tail expires before arrival and rejects the persistent one', () => {
    const simulationMs = 5_000
    const wall = trailWall(
      14,
      0.5,
      23.5,
      simulationMs + 4_000,
      (y) => Math.abs(y - 7) <= 1.5 || Math.abs(y - 17) <= 1.5,
    )
    const expiringUpperGate = trailWall(14, 5.5, 8.5, simulationMs + 300)
    const persistentLowerGate = trailWall(14, 15.5, 18.5, simulationMs + 4_000)
    const rearWall = trailWall(7, 0.5, 23.5, simulationMs + 4_000)
    const player = actor('player', { x: 35, y: 7 }, { x: 0, y: 0 })
    const state = snapshot({
      simulationMs,
      player,
      enemies: [actor('enemy-0', { x: 9, y: 12 }, { x: 5, y: 0 })],
      trailDots: [...rearWall, ...wall, ...expiringUpperGate, ...persistentLowerGate],
      playerHistory: history(simulationMs, player.position, player.velocity),
    })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96, null, () => 0)
    const allPersistentPlan = planResourceSnakeEnemy({
      ...state,
      trailDots: state.trailDots.map((dot) => (
        dot.expiresAtMs === simulationMs + 300
          ? { ...dot, expiresAtMs: simulationMs + 4_000 }
          : dot
      )),
    }, 'enemy-0', PROFILE_96, null, () => 0)
    const pointNearestWall = plan.path.reduce((best, point) => (
      Math.abs(point.x - 14) < Math.abs(best.x - 14) ? point : best
    ))

    expect(plan.fallback).toBe(false)
    expect(Math.max(...plan.path.map((point) => point.x))).toBeGreaterThan(
      Math.max(...allPersistentPlan.path.map((point) => point.x)) + 2,
    )
    expect(pointNearestWall.y).toBeLessThan(10)
    expect(pointNearestWall.y).not.toBeGreaterThan(15)
  })

  it('escapes a narrow pocket when a closer attack would leave less reachable area', () => {
    const simulationMs = 5_000
    const pocketWall = [
      ...horizontalTrailWall(4.5, 6.5, 11, simulationMs + 4_000),
      ...horizontalTrailWall(10.5, 6.5, 11, simulationMs + 4_000),
      ...trailWall(11, 4.5, 10.5, simulationMs + 4_000),
    ]
    const player = actor('player', { x: 8, y: 9 }, { x: 0, y: 0 })
    const state = snapshot({
      simulationMs,
      player,
      enemies: [actor('enemy-0', { x: 8, y: 7 }, { x: 0, y: -6.5 })],
      trailDots: pocketWall,
      playerHistory: history(simulationMs, player.position, player.velocity),
    })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_72, null, () => 0)
    const towardPlayer = { x: 0, y: 1 }

    expect(plan.score.survives).toBe(1)
    expect(plan.score.reachableArea).toBeGreaterThan(100)
    expect(plan.direction.x * towardPlayer.x + plan.direction.y * towardPlayer.y).toBeLessThan(0)
    expect(Math.min(...plan.path.map((point) => point.x))).toBeLessThan(6.5)
  })

  it('retains a committed plan across a player reversal while the route remains safe', () => {
    const kept = previousPlan([
      { x: 11, y: 12 },
      { x: 12, y: 12 },
      { x: 13, y: 12 },
      { x: 14, y: 12 },
    ])
    const player = actor('player', { x: 30, y: 12 }, { x: -8, y: 0 })
    const state = snapshot({
      simulationMs: 1_000,
      player,
      playerHistory: [
        { simulationMs: 0, position: { x: 22, y: 12 }, velocity: { x: 8, y: 0 } },
        { simulationMs: 950, position: { x: 30.4, y: 12 }, velocity: { x: 8, y: 0 } },
        { simulationMs: 1_000, position: { x: 30, y: 12 }, velocity: { x: -8, y: 0 } },
      ],
    })

    expect(planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, kept, () => 0)).toBe(kept)
  })

  it('replans at the exact <=180ms certain-fatal boundary, but not at 181ms', () => {
    const state = snapshot({
      simulationMs: 1_000,
      enemies: [actor('enemy-0', { x: 46, y: 12 }, { x: 6.5, y: 0 })],
    })
    const pathPrefix = [
      { x: 47, y: 12 },
      { x: 48, y: 12 },
      { x: 49, y: 12 },
    ]
    const fatalAt180 = previousPlan([...pathPrefix, { x: 49.833333333333336, y: 12 }])
    const fatalAt181 = previousPlan([...pathPrefix, { x: 49.806451612903224, y: 12 }])

    expect(planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, fatalAt180, () => 0)).not.toBe(fatalAt180)
    expect(planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, fatalAt181, () => 0)).toBe(fatalAt181)
  })

  it('overrides a commitment when all four player hypotheses make a head collision unavoidable', () => {
    const player = actor('player', { x: 13.6, y: 12 }, { x: 0, y: 0 })
    const state = snapshot({
      simulationMs: 1_000,
      player,
      playerHistory: history(1_000, player.position, player.velocity),
    })
    const fatal = previousPlan([
      { x: 11, y: 12 },
      { x: 12, y: 12 },
      { x: 13, y: 12 },
      { x: 14, y: 12 },
    ])

    expect(planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, fatal, () => 0)).not.toBe(fatal)
  })

  it('returns a stable full plan tuple for identical snapshots and observable histories', () => {
    const state = snapshot()
    const first = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96, null, () => 4)
    const second = planResourceSnakeEnemy(structuredClone(state), 'enemy-0', PROFILE_96, null, () => 4)

    expect(observableTuple(first)).toEqual(observableTuple(second))
  })

  it('treats committed ally paths as dynamic occupancy rather than choosing the same lane', () => {
    const allyPath: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      startsAtMs: 5_000,
      stepMs: 50,
      commitUntilMs: 6_000,
      path: Array.from({ length: 20 }, (_, index) => ({ x: 14 + index * 0.325, y: 12 })),
    }
    const state = snapshot({ committedAllyPaths: [allyPath] })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const simultaneousClearances = plan.path.map((point, index) => {
      const allyPoint = allyPath.path[Math.min(index, allyPath.path.length - 1)]
      return Math.hypot(point.x - allyPoint.x, point.y - allyPoint.y)
    })

    expect(plan.intent).toBe('coordinate')
    expect(Math.min(...simultaneousClearances)).toBeGreaterThan(0.75)
  })

  it('uses max-clearance deceleration for invalid numbers and never defaults toward the player', () => {
    const invalid = snapshot({
      player: actor('player', { x: 20, y: 12 }, { x: 0, y: 0 }),
      enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: Number.NaN, y: 0 })],
    })

    const plan = planResourceSnakeEnemy(invalid, 'enemy-0', PROFILE_48, null, () => 0)
    const towardPlayer = { x: 10, y: 0 }

    expect(plan.fallback).toBe(true)
    expect(plan.speedScale).toBe(0.5)
    expect(plan.direction.x * towardPlayer.x + plan.direction.y * towardPlayer.y).toBeLessThanOrEqual(0)
    expect(JSON.stringify(plan)).not.toContain('null')
    expect(JSON.stringify(plan)).not.toContain('NaN')
  })

  it('returns a stopped finite fallback only when all eight clearance headings are invalid', () => {
    const invalid = snapshot({
      field: { width: Number.NaN as 50, height: 24, padding: 0.5 },
    })

    const plan = planResourceSnakeEnemy(invalid, 'enemy-0', PROFILE_48, null, () => 0)

    expect(plan.fallback).toBe(true)
    expect(plan.direction).toEqual({ x: 0, y: 0 })
    expect(plan.speedScale).toBe(0)
  })

  it('sanitizes malformed committed-path numbers without throwing from fallback clearance', () => {
    const invalid = snapshot({
      committedAllyPaths: [{
        enemyId: 'enemy-1',
        startsAtMs: 5_000,
        stepMs: Number.NaN,
        commitUntilMs: 6_000,
        path: [{ x: 14, y: 12 }],
      }],
    })

    const plan = planResourceSnakeEnemy(invalid, 'enemy-0', PROFILE_48, null, () => 0)

    expect(plan.fallback).toBe(true)
    expect(plan.speedScale).toBe(0.5)
    expect(() => JSON.stringify(plan)).not.toThrow()
  })
})
