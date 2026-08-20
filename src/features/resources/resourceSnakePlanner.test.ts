import { describe, expect, it } from 'vitest'
import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import {
  RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND,
  compareSnakePlanScores,
  generateResourceSnakeTrajectoryCandidates,
  getResourceSnakePlanFutureSamples,
  planResourceSnakeEnemy,
  predictResourceSnakePlayerHypotheses,
  sampleResourceSnakePlan,
  type SnakeCommittedPath,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakePlayerHistorySample,
  type SnakeVector,
} from './resourceSnakePlanner'
import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeRoundState,
  type SnakeActor,
} from './resourceSnakeRuntime'

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

const PROFILE_72_LONG: SnakePlannerProfile = {
  lookaheadMs: 1_600,
  candidateCount: 72,
  planningHz: 8,
  commitMs: 320,
  rolloutStepMs: 50,
}

const PROFILE_96_LONG: SnakePlannerProfile = {
  lookaheadMs: 2_500,
  candidateCount: 96,
  planningHz: 10,
  commitMs: 220,
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
  return structuredClone(plan)
}

function minimumDistance(points: readonly SnakeVector[], target: SnakeVector): number {
  return Math.min(...points.map((point) => Math.hypot(point.x - target.x, point.y - target.y)))
}

function independentlyMeasuredEnclosureReduction(
  state: SnakePlannerSnapshot,
  path: readonly SnakeVector[],
): number {
  const gridSize = 0.75
  const width = Math.ceil(state.field.width / gridSize)
  const height = Math.ceil(state.field.height / gridSize)
  const base = new Uint8Array(width * height)
  const markDisk = (occupancy: Uint8Array, point: SnakeVector, radius: number) => {
    const expanded = radius + gridSize * 0.5
    const squared = expanded * expanded
    const minX = Math.max(0, Math.floor((point.x - radius) / gridSize))
    const maxX = Math.min(width - 1, Math.floor((point.x + radius) / gridSize))
    const minY = Math.max(0, Math.floor((point.y - radius) / gridSize))
    const maxY = Math.min(height - 1, Math.floor((point.y + radius) / gridSize))
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = (x + 0.5) * gridSize - point.x
        const dy = (y + 0.5) * gridSize - point.y
        if (dx * dx + dy * dy <= squared) occupancy[y * width + x] = 1
      }
    }
  }
  for (let index = 0; index < base.length; index += 1) {
    const x = (index % width + 0.5) * gridSize
    const y = (Math.floor(index / width) + 0.5) * gridSize
    if (
      x < state.field.padding
      || x > state.field.width - state.field.padding
      || y < state.field.padding
      || y > state.field.height - state.field.padding
    ) base[index] = 1
  }
  for (const dot of state.trailDots) {
    if (dot.spawnedAtMs < state.simulationMs && dot.expiresAtMs > state.simulationMs) {
      markDisk(base, dot.position, 0.55)
    }
  }
  const flood = (occupancy: Uint8Array) => {
    const originX = Math.floor(state.player.position.x / gridSize)
    const originY = Math.floor(state.player.position.y / gridSize)
    const origin = originY * width + originX
    occupancy[origin] = 0
    const visited = new Uint8Array(occupancy.length)
    const queue = new Int32Array(occupancy.length)
    let read = 0
    let write = 1
    queue[0] = origin
    visited[origin] = 1
    while (read < write) {
      const cell = queue[read]
      read += 1
      const x = cell % width
      const neighbors = [cell - width, cell + width, x > 0 ? cell - 1 : -1, x + 1 < width ? cell + 1 : -1]
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && neighbor < occupancy.length && !occupancy[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1
          queue[write] = neighbor
          write += 1
        }
      }
    }
    return write
  }
  const baselineArea = flood(base.slice())
  const candidate = base.slice()
  for (let index = 0; index + 1 < path.length; index += 1) markDisk(candidate, path[index], 0.42)
  let footprint = 0
  for (let index = 0; index < base.length; index += 1) {
    if (!base[index] && candidate[index]) footprint += 1
  }
  return Math.max(0, baselineArea - flood(candidate) - footprint)
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
    dots.push({ id, ownerId: 'player', position: { x, y }, spawnedAtMs: 0, expiresAtMs })
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
    dots.push({ id, ownerId: 'player', position: { x, y }, spawnedAtMs: 0, expiresAtMs })
    id += 1
  }
  return dots
}

function plannerActorFromRuntime(value: SnakeActor): SnakePlannerActor {
  return {
    id: value.id,
    position: { ...value.position },
    velocity: { ...value.velocity },
    integrity: value.integrity,
    maximumIntegrity: value.maximumIntegrity,
    maximumSpeedPerSecond: value.maximumSpeedPerSecond,
    collisionGraceMs: value.collisionGraceMs,
    role: value.role,
  }
}

function activeRuntime(): ResourceSnakeRoundState {
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), {
    roundId: 'planner-integration',
    playerSpawn: { x: 40, y: 12 },
    enemies: [{
      id: 'enemy-0',
      category: 'reasoning',
      reservedBlockId: 'reasoning-1',
      rewardKey: 'planner-integration:enemy-0:reasoning-1',
      role: 'pressure',
      spawn: { x: 10, y: 12 },
      maximumIntegrity: 50,
      maximumSpeedPerSecond: 6.5,
    }],
  })
  state = advanceResourceSnakeFrame(state, {}, 100)
  state = advanceResourceSnakeFrame(state, {}, 100)
  return advanceResourceSnakeFrame(state, {}, 20)
}

function snapshotFromRuntime(state: ResourceSnakeRoundState): SnakePlannerSnapshot {
  const player = plannerActorFromRuntime(state.player)
  return {
    simulationMs: state.simulationMs,
    field: { width: 50, height: 24, padding: 0.34 },
    player,
    enemies: state.enemies.map(plannerActorFromRuntime),
    trailDots: [state.player, ...state.enemies].flatMap((owner) => owner.trail.map((dot) => ({
      id: dot.id,
      ownerId: owner.id,
      position: { ...dot.position },
      spawnedAtMs: dot.spawnedAtMs,
      expiresAtMs: dot.expiresAtMs,
    }))),
    playerHistory: history(state.simulationMs, player.position, player.velocity),
    committedAllyPaths: [],
  }
}

function commandVector(plan: SnakePlan, simulationMs: number): SnakeVector {
  const sample = sampleResourceSnakePlan(plan, simulationMs)
  return {
    x: sample.direction.x * sample.speedScale,
    y: sample.direction.y * sample.speedScale,
  }
}

function advanceRuntimeWithPlan(
  initial: ResourceSnakeRoundState,
  plan: SnakePlan,
  elapsedMs: number,
): ResourceSnakeRoundState {
  const targetMs = initial.simulationMs + elapsedMs
  const fixedStepMs = 1_000 / 120
  let runtime = initial
  while (runtime.simulationMs + 1e-9 < targetMs) {
    runtime = advanceResourceSnakeFrame(runtime, {
      enemyDirections: { 'enemy-0': commandVector(plan, runtime.simulationMs) },
    }, fixedStepMs)
  }
  return runtime
}

function expectEveryNumberFinite(value: unknown): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value)).toBe(true)
    return
  }
  if (Array.isArray(value)) {
    for (const child of value) expectEveryNumberFinite(child)
    return
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) expectEveryNumberFinite(child)
  }
}

describe('planResourceSnakeEnemy', () => {
  it('ignores only its own newest runtime-shaped trail dot for exactly 240ms', () => {
    const simulationMs = 5_000
    const ownDot = {
      id: 1,
      ownerId: 'enemy-0' as const,
      position: { x: 9.68, y: 12 },
      spawnedAtMs: simulationMs,
      expiresAtMs: simulationMs + 10_000,
    }
    const recent = snapshot({ simulationMs, trailDots: [ownDot] })
    const old = snapshot({
      simulationMs,
      trailDots: [{ ...ownDot, spawnedAtMs: simulationMs - 240 }],
    })

    const moving = planResourceSnakeEnemy(recent, 'enemy-0', PROFILE_48, null, () => 0)
    const hazardous = planResourceSnakeEnemy(old, 'enemy-0', PROFILE_48, null, () => 0)

    expect(moving.fallback).toBe(false)
    expect(moving.speedScale).not.toBe(0)
    expect(moving.path.length).toBeGreaterThan(0)
    expect(hazardous.fallback).toBe(true)
    expect(hazardous.speedScale).toBe(0)
  })
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
    const baseline = snapshot({ simulationMs: 1_000 })
    const kept = planResourceSnakeEnemy(baseline, 'enemy-0', PROFILE_48, null, () => 0)
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

    const retained = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, kept, () => 0)
    expect(retained.plannedAtMs).toBe(kept.plannedAtMs)
    expect(retained.candidateIndex).toBe(kept.candidateIndex)
  })

  it('replans at the exact <=180ms certain-fatal boundary, but not at 181ms', () => {
    const state = snapshot({ simulationMs: 1_000 })
    const kept = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const obstacleForEntryAt = (relativeMs: number): SnakePlannerTrailDot => {
      const segmentIndex = Math.floor(relativeMs / kept.stepMs)
      const segmentStartMs = segmentIndex * kept.stepMs
      const start = segmentIndex === 0 ? kept.originPosition : kept.path[segmentIndex - 1]
      const end = kept.path[segmentIndex]
      const fraction = (relativeMs - segmentStartMs) / kept.stepMs
      const contact = {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      }
      const dx = end.x - start.x
      const dy = end.y - start.y
      const magnitude = Math.hypot(dx, dy)
      const direction = { x: dx / magnitude, y: dy / magnitude }
      return {
        id: 4_000 + relativeMs,
        ownerId: 'player',
        position: { x: contact.x + direction.x * 0.55, y: contact.y + direction.y * 0.55 },
        spawnedAtMs: 0,
        expiresAtMs: 10_000,
      }
    }
    const resultAt180 = planResourceSnakeEnemy(
      { ...state, trailDots: [obstacleForEntryAt(180)] },
      'enemy-0',
      PROFILE_48,
      kept,
      () => 0,
    )
    const resultAt181 = planResourceSnakeEnemy(
      { ...state, trailDots: [obstacleForEntryAt(181)] },
      'enemy-0',
      PROFILE_48,
      kept,
      () => 0,
    )

    expect(observableTuple(resultAt180)).not.toEqual(observableTuple(kept))
    expect(observableTuple(resultAt181)).toEqual(observableTuple(kept))
  })

  it('overrides a commitment when all four player hypotheses make a head collision unavoidable', () => {
    const safe = snapshot({ simulationMs: 1_000 })
    const kept = planResourceSnakeEnemy(safe, 'enemy-0', PROFILE_48, null, () => 0)
    const contact = sampleResourceSnakePlan(kept, kept.plannedAtMs + 150).position
    const after = sampleResourceSnakePlan(kept, kept.plannedAtMs + 151).position
    const dx = after.x - contact.x
    const dy = after.y - contact.y
    const magnitude = Math.hypot(dx, dy)
    const playerPosition = {
      x: contact.x + dx / magnitude * 1.1,
      y: contact.y + dy / magnitude * 1.1,
    }
    const player = actor('player', playerPosition, { x: 0, y: 0 })
    const fatal = {
      ...safe,
      player,
      playerHistory: history(1_000, player.position, player.velocity),
    }
    const result = planResourceSnakeEnemy(fatal, 'enemy-0', PROFILE_48, kept, () => 0)

    expect(observableTuple(result)).not.toEqual(observableTuple(kept))
  })

  it('retains a commitment when only the keep/turn hypotheses collide', () => {
    const safe = snapshot({ simulationMs: 1_000 })
    const kept = planResourceSnakeEnemy(safe, 'enemy-0', PROFILE_48, null, () => 0)
    const contact = sampleResourceSnakePlan(kept, kept.plannedAtMs + 150).position
    const player = actor('player', { x: contact.x + 3, y: contact.y }, { x: -20, y: 0 })
    const optionalCollision = {
      ...safe,
      player,
      playerHistory: history(1_000, player.position, player.velocity),
    }

    const result = planResourceSnakeEnemy(optionalCollision, 'enemy-0', PROFILE_48, kept, () => 0)

    expect(observableTuple(result)).toEqual(observableTuple(kept))
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

  it.each([
    [PROFILE_48, 16, 20],
    [PROFILE_72, 24, 28],
    [PROFILE_72_LONG, 24, 32],
    [PROFILE_96, 32, 40],
    [PROFILE_96_LONG, 32, 50],
  ] as const)(
    'exposes every distinct heading-speed rollout, including the 1,600ms and 2,500ms horizons',
    (profile, headingCount, pathLength) => {
      const enemy = snapshot().enemies[0]
      const candidates = generateResourceSnakeTrajectoryCandidates(enemy, profile)
      const tuples = new Set(candidates.map((candidate) => (
        `${candidate.directions.at(-1)!.x.toFixed(8)}:${candidate.directions.at(-1)!.y.toFixed(8)}:${candidate.speedScale}`
      )))

      expect(candidates).toHaveLength(headingCount * 3)
      expect(tuples.size).toBe(headingCount * 3)
      expect(candidates.map((candidate) => candidate.candidateIndex)).toEqual(
        Array.from({ length: headingCount * 3 }, (_, index) => index),
      )
      for (const candidate of candidates) {
        expect(candidate.path).toHaveLength(pathLength)
        expect(candidate.directions).toHaveLength(pathLength)
        let priorHeading = Math.atan2(enemy.velocity.y, enemy.velocity.x)
        for (const direction of candidate.directions) {
          const heading = Math.atan2(direction.y, direction.x)
          const turn = Math.abs(Math.atan2(
            Math.sin(heading - priorHeading),
            Math.cos(heading - priorHeading),
          ))
          expect(turn).toBeLessThanOrEqual(
            RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND * 0.05 + 1e-12,
          )
          priorHeading = heading
        }
      }
    },
  )

  it('publishes independently distinguishable keep, signed-turn, 100ms-decelerate, and stopped hypotheses', () => {
    const simulationMs = 5_000
    const player = actor('player', { x: 20, y: 12 }, { x: 0, y: 8 })
    const state = snapshot({
      simulationMs,
      player,
      playerHistory: [
        { simulationMs: 4_000, position: { x: 20, y: 4 }, velocity: { x: 8, y: 0 } },
        { simulationMs, position: player.position, velocity: player.velocity },
      ],
    })

    const hypotheses = predictResourceSnakePlayerHypotheses(state, 100, 50)
    const expectedTurnHeading = Math.PI / 2 + Math.PI / 2 * 0.05

    expect(hypotheses.keepVelocity[1]).toEqual({ x: 20, y: 12.8 })
    expect(hypotheses.decelerate[1].x).toBeCloseTo(20, 12)
    expect(hypotheses.decelerate[1].y).toBeCloseTo(12.4, 12)
    expect(hypotheses.stayStopped[1]).toEqual({ x: 20, y: 12 })
    expect(hypotheses.continueMedianTurn[0].x).toBeCloseTo(
      20 + Math.cos(expectedTurnHeading) * 0.4,
      12,
    )
    expect(hypotheses.continueMedianTurn[0].y).toBeCloseTo(
      12 + Math.sin(expectedTurnHeading) * 0.4,
      12,
    )
    expect(new Set(hypotheses.all.map((path) => JSON.stringify(path)))).toHaveLength(4)
  })

  it('compares raw sub-micro-unit higher-priority advantages before every lower-priority term', () => {
    const higherPriority = {
      survives: 1 as const,
      reachableArea: 100,
      allyClearance: 10.0000001,
      playerAreaReduction: 0,
      cutoffProgress: -100,
      pressureDistance: 100,
      steeringCost: 100,
    }
    const lowerPriority = {
      survives: 1 as const,
      reachableArea: 100,
      allyClearance: 10,
      playerAreaReduction: 10_000,
      cutoffProgress: 10_000,
      pressureDistance: 0,
      steeringCost: 0,
    }

    expect(compareSnakePlanScores(higherPriority, 99, lowerPriority, 0)).toBeGreaterThan(0)
  })

  it('emits a time-addressed command trajectory that the authoritative runtime executes', () => {
    let runtime = activeRuntime()
    const state = snapshotFromRuntime(runtime)
    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96, null, () => 0)

    expect(plan.plannedAtMs).toBe(state.simulationMs)
    expect(plan.stepMs).toBe(50)
    expect(plan.directions).toHaveLength(plan.path.length)
    for (let index = 0; index < 30; index += 1) {
      runtime = advanceResourceSnakeFrame(runtime, {
        enemyDirections: { 'enemy-0': commandVector(plan, runtime.simulationMs) },
      }, 1_000 / 120)
      const actual = runtime.enemies[0].position
      const predicted = sampleResourceSnakePlan(plan, runtime.simulationMs).position
      expect(actual.x).toBeCloseTo(predicted.x, 8)
      expect(actual.y).toBeCloseTo(predicted.y, 8)
    }
    const future = getResourceSnakePlanFutureSamples(plan, plan.plannedAtMs + 100)
    expect(future[0].atMs).toBe(plan.plannedAtMs + 150)
    expect(future.every((sample) => sample.atMs > plan.plannedAtMs + 100)).toBe(true)
  })

  it.each([50, 100, 170])('advances a retained commitment command from the %ims cursor', (requestedMs) => {
    let runtime = activeRuntime()
    const initial = snapshotFromRuntime(runtime)
    const plan = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_48, null, () => 0)
    runtime = advanceRuntimeWithPlan(runtime, plan, requestedMs)
    const current = snapshotFromRuntime(runtime)
    const clockValues = [20, 23]
    const retained = planResourceSnakeEnemy(
      current,
      'enemy-0',
      PROFILE_48,
      plan,
      () => clockValues.shift() ?? 23,
    )
    const expected = sampleResourceSnakePlan(plan, current.simulationMs)

    expect(retained.plannedAtMs).toBe(plan.plannedAtMs)
    expect(retained.candidateIndex).toBe(plan.candidateIndex)
    expect(retained.direction.x).toBeCloseTo(expected.direction.x, 12)
    expect(retained.direction.y).toBeCloseTo(expected.direction.y, 12)
    expect(retained.elapsedMs).toBe(3)
  })

  it('validates every previous-plan field and executable trajectory before reuse', () => {
    const state = snapshot()
    const valid = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const expectedLength = PROFILE_48.lookaheadMs / PROFILE_48.rolloutStepMs
    const mutations: Array<(plan: SnakePlan) => void> = [
      (plan) => { plan.enemyId = 'enemy-1' },
      (plan) => { plan.direction.x = Number.NaN },
      (plan) => { plan.direction.y = Number.POSITIVE_INFINITY },
      (plan) => { plan.elapsedMs = Number.POSITIVE_INFINITY },
      (plan) => { plan.commitUntilMs = Number.NaN },
      (plan) => { plan.commitUntilMs += 1 },
      (plan) => { plan.intent = 'invalid' as SnakePlan['intent'] },
      (plan) => { plan.role = 'blocker' },
      (plan) => { plan.fallback = true },
      (plan) => { plan.score.survives = 0 },
      (plan) => { plan.score.reachableArea = Number.NaN },
      (plan) => { plan.score.allyClearance = Number.NaN },
      (plan) => { plan.score.playerAreaReduction = Number.NaN },
      (plan) => { plan.score.cutoffProgress = Number.NaN },
      (plan) => { plan.score.pressureDistance = Number.NaN },
      (plan) => { plan.score.steeringCost = Number.NaN },
      (plan) => { plan.path = [] },
      (plan) => { plan.path = plan.path.slice(0, -1) },
      (plan) => { plan.path.push({ ...plan.path.at(-1)! }) },
      (plan) => { plan.path[0].y = Number.NEGATIVE_INFINITY },
      (plan) => { plan.directions = plan.directions.slice(0, -1) },
      (plan) => { plan.directions.push({ ...plan.directions.at(-1)! }) },
      (plan) => { plan.directions[0] = { x: -plan.directions[0].x, y: -plan.directions[0].y } },
      (plan) => { plan.directions[0].x = Number.NaN },
      (plan) => { plan.path[0].x += 1 },
      (plan) => { plan.plannedAtMs += 1 },
      (plan) => { plan.plannedAtMs = Number.NEGATIVE_INFINITY },
      (plan) => { plan.commandAtMs = Number.NaN },
      (plan) => { plan.commandAtMs = plan.plannedAtMs - 1 },
      (plan) => { plan.stepMs = 25 as SnakePlan['stepMs'] },
      (plan) => { plan.originPosition.x = Number.NaN },
      (plan) => { plan.originVelocity.y = Number.POSITIVE_INFINITY },
      (plan) => { plan.originMaximumSpeedPerSecond = Number.NaN },
      (plan) => { plan.originMaximumSpeedPerSecond += 1 },
      (plan) => { plan.speedScale = 0.25 as SnakePlan['speedScale'] },
      (plan) => { plan.candidateIndex = 999 },
      (plan) => { plan.candidateIndex = Number.NaN },
      (plan) => { plan.evaluatedCandidates = 47 },
      (plan) => { plan.evaluatedCandidates = Number.NaN },
    ]

    for (const mutate of mutations) {
      const malformed = structuredClone(valid)
      mutate(malformed)
      const result = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, malformed, () => 0)
      expect(result).not.toBe(malformed)
      expect(result.path).toHaveLength(expectedLength)
      expect(result.directions).toHaveLength(expectedLength)
      expect(result.score.survives).toBe(1)
      expect(result.role).toBe('pressure')
      expectEveryNumberFinite(result)
    }
  })

  it('uses only future path samples for fatal checks after commitment re-entry', () => {
    let runtime = activeRuntime()
    const initial = snapshotFromRuntime(runtime)
    const plan = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_48, null, () => 0)
    runtime = advanceRuntimeWithPlan(runtime, plan, 200)
    const current = snapshotFromRuntime(runtime)
    const pastOnly = {
      id: 8_000,
      ownerId: 'player' as const,
      position: { ...plan.path[0] },
      spawnedAtMs: 0,
      expiresAtMs: current.simulationMs + 10_000,
    }
    const withPastHazard = { ...current, trailDots: [...current.trailDots, pastOnly] }

    const retained = planResourceSnakeEnemy(withPastHazard, 'enemy-0', PROFILE_48, plan, () => 0)

    expect(retained.plannedAtMs).toBe(plan.plannedAtMs)
    expect(retained.candidateIndex).toBe(plan.candidateIndex)
  })

  it('keeps a trail open when expiresAtMs equals the exact collision time', () => {
    const simulationMs = 5_000
    const dot = {
      id: 7_000,
      ownerId: 'player' as const,
      position: { x: 10, y: 12 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs,
    }
    const open = planResourceSnakeEnemy(
      snapshot({ simulationMs, trailDots: [dot] }),
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const blocked = planResourceSnakeEnemy(
      snapshot({ simulationMs, trailDots: [{ ...dot, expiresAtMs: simulationMs + 0.001 }] }),
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )

    expect(open.fallback).toBe(false)
    expect(blocked.fallback).toBe(true)
  })

  it('uses collision grace only until its exact remaining time, then resumes hazard avoidance', () => {
    const simulationMs = 5_000
    const dot = {
      id: 6_000,
      ownerId: 'player' as const,
      position: { x: 10, y: 12 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + 10_000,
    }
    const noGrace = snapshot({ simulationMs, trailDots: [dot] })
    const grace = snapshot({
      simulationMs,
      trailDots: [dot],
      enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 }, { collisionGraceMs: 100 })],
    })
    const recovered = snapshot({
      simulationMs: simulationMs + 100,
      trailDots: [{ ...dot, expiresAtMs: simulationMs + 10_000 }],
    })

    expect(planResourceSnakeEnemy(grace, 'enemy-0', PROFILE_48, null, () => 0).speedScale).not.toBe(0)
    expect(planResourceSnakeEnemy(noGrace, 'enemy-0', PROFILE_48, null, () => 0).speedScale).toBe(0)
    expect(planResourceSnakeEnemy(recovered, 'enemy-0', PROFILE_48, null, () => 0).speedScale).toBe(0)
  })

  it('gives low-integrity enemies a measurably safer trail clearance without permanent escape', () => {
    const simulationMs = 5_000
    const commonEnemy = actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 }, {
      integrity: 80,
      maximumIntegrity: 80,
    })
    const openHigh = planResourceSnakeEnemy(
      snapshot({ enemies: [commonEnemy] }),
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const pathPoint = openHigh.path[5]
    const pathPrior = openHigh.path[4]
    const dx = pathPoint.x - pathPrior.x
    const dy = pathPoint.y - pathPrior.y
    const size = Math.hypot(dx, dy)
    const obstacle = {
      id: 9_000,
      ownerId: 'player' as const,
      position: { x: pathPoint.x - dy / size * 0.62, y: pathPoint.y + dx / size * 0.62 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + 10_000,
    }
    const highState = snapshot({
      simulationMs,
      trailDots: [obstacle],
      enemies: [commonEnemy],
    })
    const lowState = snapshot({
      ...highState,
      enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 }, {
        integrity: 20,
        maximumIntegrity: 80,
      })],
    })
    const high = planResourceSnakeEnemy(highState, 'enemy-0', PROFILE_48, null, () => 0)
    const low = planResourceSnakeEnemy(lowState, 'enemy-0', PROFILE_48, null, () => 0)
    const highClearance = minimumDistance(high.path, obstacle.position)
    const lowClearance = minimumDistance(low.path, obstacle.position)
    const openLow = planResourceSnakeEnemy(snapshot({
      enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 }, {
        integrity: 20,
        maximumIntegrity: 80,
      })],
    }), 'enemy-0', PROFILE_48, null, () => 0)

    expect(lowClearance).toBeGreaterThan(highClearance + 0.1)
    expect(openLow.intent).not.toBe('escape')
    expect(openLow.fallback).toBe(false)
  })

  it('produces robust positive enclosure and a lateral cutoff for a farther stationary player', () => {
    const simulationMs = 5_000
    const wall = trailWall(25, 0.5, 23.5, simulationMs + 10_000, (y) => Math.abs(y - 12) < 3.25)
    const enclosedState = snapshot({
      simulationMs,
      player: actor('player', { x: 18, y: 12 }, { x: 0, y: 0 }),
      enemies: [actor('enemy-0', { x: 25, y: 9.5 }, { x: 0, y: 6.5 })],
      trailDots: wall,
      playerHistory: history(simulationMs, { x: 18, y: 12 }, { x: 0, y: 0 }),
    })
    const enclosure = planResourceSnakeEnemy(enclosedState, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    const independentReduction = independentlyMeasuredEnclosureReduction(enclosedState, enclosure.path)
    const farState = snapshot({
      player: actor('player', { x: 30, y: 12 }, { x: 0, y: 0 }),
      playerHistory: history(5_000, { x: 30, y: 12 }, { x: 0, y: 0 }),
    })
    const lateral = planResourceSnakeEnemy(farState, 'enemy-0', PROFILE_72, null, () => 0)

    expect(enclosure.score.playerAreaReduction).toBeGreaterThan(0)
    expect(independentReduction).toBeGreaterThan(0)
    expect(['herd', 'cutoff']).toContain(enclosure.intent)
    const playerVector = {
      x: farState.player.position.x - farState.enemies[0].position.x,
      y: farState.player.position.y - farState.enemies[0].position.y,
    }
    const lateralComponent = Math.abs(
      lateral.direction.x * playerVector.y - lateral.direction.y * playerVector.x,
    ) / Math.hypot(playerVector.x, playerVector.y)
    expect(lateral.intent).toBe('cutoff')
    expect(lateralComponent).toBeGreaterThan(0.05)
    expect(lateral.path.at(-1)!.x).toBeGreaterThan(farState.enemies[0].position.x + 2)
    expect(Math.abs(lateral.path.at(-1)!.y - farState.player.position.y)).toBeGreaterThan(0.75)
    expect(minimumDistance(lateral.path, farState.player.position)).toBeGreaterThan(1.1)
  })

  it('returns finite safe fallback output for an invalid planner profile', () => {
    const invalidProfile = {
      ...PROFILE_96,
      rolloutStepMs: 0,
      candidateCount: 95,
      lookaheadMs: Number.NaN,
    } as unknown as SnakePlannerProfile
    const plan = planResourceSnakeEnemy(snapshot(), 'enemy-0', invalidProfile, null, () => 0)

    expect(plan.fallback).toBe(true)
    expectEveryNumberFinite(plan)
  })

  it('keeps warmed empty and 320-dot 2,500ms/96 planning under the 3ms p95 budget', () => {
    const simulationMs = 5_000
    const trailDots = Array.from({ length: 320 }, (_, index): SnakePlannerTrailDot => ({
      id: 20_000 + index,
      ownerId: 'player',
      position: { x: 42 + (index % 16) * 0.4, y: 1 + Math.floor(index / 16) * 0.08 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + 10_000,
    }))
    const clock = () => performance.now()
    for (const state of [snapshot({ simulationMs }), snapshot({ simulationMs, trailDots })]) {
      for (let index = 0; index < 50; index += 1) {
        planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, clock)
      }
      const durations = Array.from({ length: 31 }, () => (
        planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, clock).elapsedMs
      )).sort((left, right) => left - right)
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1]

      expect(p95).toBeLessThanOrEqual(3)
    }
  }, 10_000)
})
