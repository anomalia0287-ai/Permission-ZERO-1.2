import { describe, expect, it } from 'vitest'
import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import {
  RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND,
  compareSnakePlanScores,
  generateResourceSnakeTrajectoryCandidates,
  getResourceSnakePlanFutureSamples,
  measureResourceSnakePlayerAreaReduction,
  planResourceSnakeEnemy,
  predictResourceSnakePlayerHypotheses,
  resourceSnakePlanToCommittedPath,
  sampleResourceSnakeCommittedPath,
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
  ].filter((sample) => sample.simulationMs >= 0)
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

function forgeCallerPlanChecksum(plan: SnakePlan): string {
  let primary = 0x811c9dc5
  let secondary = 0x9e3779b9
  const numberBuffer = new ArrayBuffer(8)
  const numberView = new DataView(numberBuffer)
  const numberBytes = new Uint8Array(numberBuffer)
  const addByte = (value: number) => {
    primary = Math.imul(primary ^ value, 0x01000193) >>> 0
    secondary = Math.imul(secondary ^ value, 0x85ebca6b) >>> 0
  }
  const addNumber = (value: number) => {
    numberView.setFloat64(0, value, true)
    for (const byte of numberBytes) addByte(byte)
  }
  const addText = (value: string) => {
    addNumber(value.length)
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      addByte(code & 0xff)
      addByte(code >>> 8)
    }
  }
  addText('resource-snake-plan-v1')
  addText(plan.enemyId)
  addText(plan.intent)
  addText(plan.role)
  addNumber(plan.direction.x)
  addNumber(plan.direction.y)
  addNumber(plan.speedScale)
  addNumber(plan.plannedAtMs)
  addNumber(plan.commandAtMs)
  addNumber(plan.stepMs)
  addNumber(plan.originPosition.x)
  addNumber(plan.originPosition.y)
  addNumber(plan.originVelocity.x)
  addNumber(plan.originVelocity.y)
  addNumber(plan.originMaximumSpeedPerSecond)
  addNumber(plan.directions.length)
  for (const direction of plan.directions) {
    addNumber(direction.x)
    addNumber(direction.y)
  }
  addNumber(plan.commitUntilMs)
  addNumber(plan.path.length)
  for (const point of plan.path) {
    addNumber(point.x)
    addNumber(point.y)
  }
  addNumber(plan.score.survives)
  addNumber(plan.score.reachableArea)
  addNumber(plan.score.allyClearance)
  addNumber(plan.score.playerAreaReduction)
  addNumber(plan.score.cutoffProgress)
  addNumber(plan.score.pressureDistance)
  addNumber(plan.score.steeringCost)
  addNumber(plan.candidateIndex)
  addNumber(plan.evaluatedCandidates)
  addNumber(plan.fallback ? 1 : 0)
  return `rsp1:${primary.toString(16).padStart(8, '0')}${secondary.toString(16).padStart(8, '0')}`
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

function independentlyMeasuredHypothesisReductions(
  state: SnakePlannerSnapshot,
  endpoints: readonly SnakeVector[],
  path: readonly SnakeVector[],
): number[] {
  const gridSize = 0.75
  const width = Math.ceil(state.field.width / gridSize)
  const height = Math.ceil(state.field.height / gridSize)
  const base = new Uint8Array(width * height)
  const markDisk = (occupancy: Uint8Array, point: SnakeVector, radius: number) => {
    const expanded = radius + gridSize * 0.5
    const squared = expanded * expanded
    const minimumX = Math.max(0, Math.floor((point.x - radius) / gridSize))
    const maximumX = Math.min(width - 1, Math.floor((point.x + radius) / gridSize))
    const minimumY = Math.max(0, Math.floor((point.y - radius) / gridSize))
    const maximumY = Math.min(height - 1, Math.floor((point.y + radius) / gridSize))
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
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
  const candidate = base.slice()
  for (let index = 0; index + 1 < path.length; index += 1) markDisk(candidate, path[index], 0.42)
  const flood = (source: Uint8Array, origin: SnakeVector) => {
    const occupancy = source.slice()
    const originIndex = Math.floor(origin.y / gridSize) * width + Math.floor(origin.x / gridSize)
    occupancy[originIndex] = 0
    const visited = new Uint8Array(occupancy.length)
    const queue = new Int32Array(occupancy.length)
    let read = 0
    let write = 1
    queue[0] = originIndex
    visited[originIndex] = 1
    while (read < write) {
      const cell = queue[read]
      read += 1
      const x = cell % width
      const neighbors = [
        cell - width,
        cell + width,
        x > 0 ? cell - 1 : -1,
        x + 1 < width ? cell + 1 : -1,
      ]
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && neighbor < occupancy.length && !occupancy[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1
          queue[write] = neighbor
          write += 1
        }
      }
    }
    return { area: write, visited }
  }
  return endpoints.map((endpoint) => {
    const baseline = flood(base, endpoint)
    const withCandidate = flood(candidate, endpoint)
    let footprint = 0
    for (let index = 0; index < candidate.length; index += 1) {
      if (!base[index] && candidate[index] && baseline.visited[index]) footprint += 1
    }
    return Math.max(0, baseline.area - withCandidate.area - footprint)
  })
}

function independentlyMeasuredEnemyArea(
  state: SnakePlannerSnapshot,
  origin: SnakeVector,
): number {
  const gridSize = 0.75
  const width = Math.ceil(state.field.width / gridSize)
  const height = Math.ceil(state.field.height / gridSize)
  const occupancy = new Uint8Array(width * height)
  const markDisk = (point: SnakeVector, radius: number) => {
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
  for (let index = 0; index < occupancy.length; index += 1) {
    const x = (index % width + 0.5) * gridSize
    const y = (Math.floor(index / width) + 0.5) * gridSize
    if (
      x < state.field.padding
      || x > state.field.width - state.field.padding
      || y < state.field.padding
      || y > state.field.height - state.field.padding
    ) occupancy[index] = 1
  }
  for (const dot of state.trailDots) {
    if (dot.spawnedAtMs < state.simulationMs && dot.expiresAtMs > state.simulationMs) {
      markDisk(dot.position, 0.55)
    }
  }
  markDisk(state.player.position, 1.1)
  const startX = Math.floor(origin.x / gridSize)
  const startY = Math.floor(origin.y / gridSize)
  const start = startY * width + startX
  occupancy[start] = 0
  const visited = new Uint8Array(occupancy.length)
  const queue = new Int32Array(occupancy.length)
  let read = 0
  let write = 1
  queue[0] = start
  visited[start] = 1
  while (read < write) {
    const cell = queue[read]
    read += 1
    const x = cell % width
    const up = cell - width
    const down = cell + width
    const left = x > 0 ? cell - 1 : -1
    const right = x + 1 < width ? cell + 1 : -1
    for (const neighbor of [up, down, left, right]) {
      if (neighbor >= 0 && neighbor < occupancy.length && !occupancy[neighbor] && !visited[neighbor]) {
        visited[neighbor] = 1
        queue[write] = neighbor
        write += 1
      }
    }
  }
  return write
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

function expectFiniteSerializable(value: unknown): void {
  const serialized = JSON.stringify(value)
  expect(typeof serialized).toBe('string')
  expect(serialized).not.toContain('NaN')
  expect(serialized).not.toContain('Infinity')
  expectEveryNumberFinite(JSON.parse(serialized))
}

describe('resource snake planner performance', () => {
  it(
    'keeps repeated empty, off-path, and hot-corridor 2,500ms/96 moving planning under 3ms p95',
    runResourceSnakePerformanceAcceptance,
    20_000,
  )
})

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

  it.each([
    [100, false],
    [199, false],
    [200, false],
    [210, true],
    [239.999, true],
    [240, true],
  ] as const)('activates an already-active own dot from its exact rollout age %ims', (ageMs, hazardous) => {
    const simulationMs = 5_000
    const state = snapshot({
      simulationMs,
      trailDots: [{
        id: 31_000,
        ownerId: 'enemy-0',
        position: { x: 9.68, y: 12 },
        spawnedAtMs: simulationMs - ageMs,
        expiresAtMs: simulationMs + 10_000,
      }],
    })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)

    expect(plan.fallback).toBe(hazardous)
    expect(plan.speedScale === 0).toBe(hazardous)
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
    const freshAt180 = planResourceSnakeEnemy(
      { ...state, trailDots: [obstacleForEntryAt(180)] },
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )

    expect(observableTuple(resultAt180)).toEqual(observableTuple(freshAt180))
    expect(resultAt181.plannedAtMs).toBe(kept.plannedAtMs)
    expect(resultAt181.candidateIndex).toBe(kept.candidateIndex)
  })

  it('keeps all four real hypotheses populated at an off-grid +170ms re-entry', () => {
    const simulationMs = 5_000
    const initial = snapshot({ simulationMs })
    const kept = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_48, null, () => 0)
    const nowMs = simulationMs + 170
    const currentEnemy = sampleResourceSnakePlan(kept, nowMs)
    const future = sampleResourceSnakePlan(kept, nowMs + 180)
    const futureContact = future.position
    const direction = future.direction
    const playerPosition = {
      x: futureContact.x + direction.x,
      y: futureContact.y + direction.y,
    }
    const player = actor('player', playerPosition, { x: -direction.y * 20, y: direction.x * 20 })
    const current = snapshot({
      simulationMs: nowMs,
      player,
      enemies: [actor('enemy-0', currentEnemy.position, currentEnemy.velocity)],
      playerHistory: history(nowMs, player.position, player.velocity),
    })

    const retained = planResourceSnakeEnemy(current, 'enemy-0', PROFILE_48, kept, () => 0)

    expect(retained.plannedAtMs).toBe(kept.plannedAtMs)
    expect(retained.candidateIndex).toBe(kept.candidateIndex)
  })

  it('checks only the final 10ms of an active commitment for fatal override', () => {
    const simulationMs = 5_000
    const initial = snapshot({ simulationMs })
    const kept = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_48, null, () => 0)
    const nowMs = kept.commitUntilMs - 10
    const currentEnemy = sampleResourceSnakePlan(kept, nowMs)
    const current = snapshot({
      simulationMs: nowMs,
      enemies: [actor('enemy-0', currentEnemy.position, currentEnemy.velocity)],
    })
    const obstacleAt = (relativeMs: number, id: number): SnakePlannerTrailDot => {
      const segmentIndex = Math.floor(relativeMs / kept.stepMs)
      const segmentStartMs = segmentIndex * kept.stepMs
      const start = segmentIndex === 0 ? kept.originPosition : kept.path[segmentIndex - 1]
      const end = kept.path[segmentIndex]
      const fraction = (relativeMs - segmentStartMs) / kept.stepMs
      const dx = end.x - start.x
      const dy = end.y - start.y
      const size = Math.hypot(dx, dy)
      return {
        id,
        ownerId: 'player',
        position: {
          x: start.x + dx * fraction + dx / size * 0.55,
          y: start.y + dy * fraction + dy / size * 0.55,
        },
        spawnedAtMs: 0,
        expiresAtMs: simulationMs + 10_000,
      }
    }
    const afterCommit = planResourceSnakeEnemy(
      { ...current, trailDots: [obstacleAt(430, 42_000)] },
      'enemy-0',
      PROFILE_48,
      kept,
      () => 0,
    )
    const insideCommit = planResourceSnakeEnemy(
      { ...current, trailDots: [obstacleAt(415, 42_001)] },
      'enemy-0',
      PROFILE_48,
      kept,
      () => 0,
    )

    expect(afterCommit.plannedAtMs).toBe(kept.plannedAtMs)
    expect(insideCommit.plannedAtMs).toBe(nowMs)
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

    expect(result.plannedAtMs).toBe(kept.plannedAtMs)
    expect(result.candidateIndex).toBe(kept.candidateIndex)
  })

  it('returns a stable full plan tuple for identical snapshots and observable histories', () => {
    const state = snapshot()
    const first = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96, null, () => 4)
    const second = planResourceSnakeEnemy(structuredClone(state), 'enemy-0', PROFILE_96, null, () => 4)

    expect(observableTuple(first)).toEqual(observableTuple(second))
  })

  it('isolates every returned nested value from siblings and trajectory-cache storage', () => {
    const state = snapshot()
    const first = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96, null, () => 0)
    const sibling = planResourceSnakeEnemy(structuredClone(state), 'enemy-0', PROFILE_96, null, () => 0)
    const expectedSibling = observableTuple(sibling)

    first.direction.x += 10
    first.originPosition.x += 10
    first.originVelocity.y += 10
    first.directions[0].x += 10
    first.path[0].y += 10
    first.score.reachableArea += 10
    first.score.allyClearance += 10
    first.score.playerAreaReduction += 10
    first.score.cutoffProgress += 10
    first.score.pressureDistance += 10
    first.score.steeringCost += 10

    const later = planResourceSnakeEnemy(structuredClone(state), 'enemy-0', PROFILE_96, null, () => 0)

    expect(observableTuple(sibling)).toEqual(expectedSibling)
    expect(observableTuple(later)).toEqual(expectedSibling)
    expect(later.path).not.toBe(sibling.path)
    expect(later.path[0]).not.toBe(sibling.path[0])
    expect(later.directions).not.toBe(sibling.directions)
    expect(later.directions[0]).not.toBe(sibling.directions[0])
    expect(later.score).not.toBe(sibling.score)
  })

  it('treats committed ally paths as dynamic occupancy rather than choosing the same lane', () => {
    const allyPath: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: 5_950,
      samples: Array.from({ length: 20 }, (_, index) => ({
        atMs: 5_000 + index * 50,
        position: { x: 14 + index * 0.325, y: 12 },
      })),
    }
    const state = snapshot({ committedAllyPaths: [allyPath] })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const simultaneousClearances = plan.path.map((point, index) => {
      const allyPoint = allyPath.samples[Math.min(index + 1, allyPath.samples.length - 1)].position
      return Math.hypot(point.x - allyPoint.x, point.y - allyPoint.y)
    })

    expect(plan.intent).toBe('coordinate')
    expect(Math.min(...simultaneousClearances)).toBeGreaterThan(0.75)
  })

  it('checks the still-active prefix when an ally expires inside a rollout segment', () => {
    const simulationMs = 5_000
    const activePrefix: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: simulationMs + 20,
      samples: [
        { atMs: simulationMs, position: { x: 10.5, y: 12 } },
        { atMs: simulationMs + 20, position: { x: 10.5, y: 12 } },
      ],
    }
    const state = snapshot({ simulationMs, committedAllyPaths: [activePrefix] })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)

    expect(plan.speedScale).toBe(0)
    expect(plan.direction).toEqual({ x: 0, y: 0 })

    const expired = planResourceSnakeEnemy(
      snapshot({ simulationMs: simulationMs + 20, committedAllyPaths: [activePrefix] }),
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    expect(expired.fallback).toBe(false)
    expect(expired.speedScale).not.toBe(0)
  })

  it('subdivides ally sweeps at every irregular timed sample inside a planner segment', () => {
    const simulationMs = 5_000
    const initial = snapshot({ simulationMs })
    const selected = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_48, null, () => 0)
    const start = initial.enemies[0].position
    const end = selected.path[0]
    const segment = { x: end.x - start.x, y: end.y - start.y }
    const segmentLength = Math.hypot(segment.x, segment.y)
    const normal = { x: -segment.y / segmentLength, y: segment.x / segmentLength }
    const offsets = [0, 12, 25, 37, 50] as const
    const clearances = [0.78, 0.78, 0.74, 0.78, 0.78] as const
    const ally: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: simulationMs + 50,
      samples: offsets.map((offsetMs, index) => ({
        atMs: simulationMs + offsetMs,
        position: {
          x: start.x + segment.x * offsetMs / 50 + normal.x * clearances[index],
          y: start.y + segment.y * offsetMs / 50 + normal.y * clearances[index],
        },
      })),
    }

    const blocked = planResourceSnakeEnemy(
      { ...initial, committedAllyPaths: [ally] },
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const retainedBlocked = planResourceSnakeEnemy(
      { ...initial, committedAllyPaths: [ally] },
      'enemy-0',
      PROFILE_48,
      selected,
      () => 0,
    )

    expect(blocked.candidateIndex).not.toBe(selected.candidateIndex)
    expect(retainedBlocked.candidateIndex).not.toBe(selected.candidateIndex)

    const atExpiry = sampleResourceSnakePlan(selected, simulationMs + 50)
    const expired = snapshot({
      simulationMs: simulationMs + 50,
      enemies: [actor('enemy-0', atExpiry.position, atExpiry.velocity)],
      committedAllyPaths: [ally],
    })
    const retained = planResourceSnakeEnemy(expired, 'enemy-0', PROFILE_48, selected, () => 0)
    expect(retained.plannedAtMs).toBe(selected.plannedAtMs)
    expect(retained.candidateIndex).toBe(selected.candidateIndex)
  })

  it.each([220, 260])(
    'clips retained ally collision checks to the legal %ims off-grid expiry',
    (expiryOffsetMs) => {
      const simulationMs = 5_000
      const initial = snapshot({ simulationMs })
      const kept = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_48, null, () => 0)
      const segmentStartOffsetMs = Math.floor(expiryOffsetMs / 50) * 50
      const nearAtExpiry = sampleResourceSnakePlan(
        kept,
        simulationMs + expiryOffsetMs,
      ).position
      const ally: SnakeCommittedPath = {
        enemyId: 'enemy-1',
        commitUntilMs: simulationMs + expiryOffsetMs,
        samples: [
          { atMs: simulationMs, position: { x: 45, y: 2 } },
          { atMs: simulationMs + segmentStartOffsetMs, position: { x: 45, y: 2 } },
          {
            atMs: simulationMs + expiryOffsetMs,
            position: { x: nearAtExpiry.x + 0.5, y: nearAtExpiry.y },
          },
        ],
      }
      const atSegmentStart = sampleResourceSnakePlan(
        kept,
        simulationMs + segmentStartOffsetMs,
      )
      const active = snapshot({
        simulationMs: simulationMs + segmentStartOffsetMs,
        enemies: [actor('enemy-0', atSegmentStart.position, atSegmentStart.velocity)],
        committedAllyPaths: [ally],
      })
      const blocked = planResourceSnakeEnemy(active, 'enemy-0', PROFILE_48, kept, () => 0)

      expect(blocked.plannedAtMs).toBe(active.simulationMs)

      const atExpiry = sampleResourceSnakePlan(kept, simulationMs + expiryOffsetMs)
      const expired = snapshot({
        simulationMs: simulationMs + expiryOffsetMs,
        enemies: [actor('enemy-0', atExpiry.position, atExpiry.velocity)],
        committedAllyPaths: [ally],
      })
      const retained = planResourceSnakeEnemy(expired, 'enemy-0', PROFILE_48, kept, () => 0)
      expect(retained.plannedAtMs).toBe(kept.plannedAtMs)
    },
  )

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

  it('reroutes invalid-number fallback around a swept ally lane and stops when every heading conflicts', () => {
    const simulationMs = 5_000
    const invalid = snapshot({
      simulationMs,
      enemies: [actor('enemy-0', { x: 10, y: 12 }, { x: Number.NaN, y: 0 })],
    })
    const baseline = planResourceSnakeEnemy(invalid, 'enemy-0', PROFILE_48, null, () => 0)
    const baselineCommitted = resourceSnakePlanToCommittedPath(baseline, simulationMs)
    expect(baselineCommitted).not.toBeNull()
    if (!baselineCommitted) throw new Error('expected an active committed path')
    const lane = { ...baselineCommitted, enemyId: 'enemy-1' as const }
    const firstEnd = baseline.path[0]
    const firstDelta = { x: firstEnd.x - 10, y: firstEnd.y - 12 }
    const firstLength = Math.hypot(firstDelta.x, firstDelta.y)
    const firstNormal = { x: -firstDelta.y / firstLength, y: firstDelta.x / firstLength }
    const internalLane: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: simulationMs + 50,
      samples: [
        {
          atMs: simulationMs,
          position: { x: 10 + firstNormal.x * 0.78, y: 12 + firstNormal.y * 0.78 },
        },
        {
          atMs: simulationMs + 25,
          position: {
            x: 10 + firstDelta.x * 0.5 + firstNormal.x * 0.74,
            y: 12 + firstDelta.y * 0.5 + firstNormal.y * 0.74,
          },
        },
        {
          atMs: simulationMs + 50,
          position: {
            x: firstEnd.x + firstNormal.x * 0.78,
            y: firstEnd.y + firstNormal.y * 0.78,
          },
        },
      ],
    }
    const internallyRerouted = planResourceSnakeEnemy(
      { ...invalid, committedAllyPaths: [internalLane] },
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const rerouted = planResourceSnakeEnemy(
      { ...invalid, committedAllyPaths: [lane] },
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const stationaryConflict: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: simulationMs + 1_000,
      samples: Array.from({ length: 21 }, (_, index) => ({
        atMs: simulationMs + index * 50,
        position: { x: 10, y: 12 },
      })),
    }
    const stopped = planResourceSnakeEnemy(
      { ...invalid, committedAllyPaths: [stationaryConflict] },
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )

    expect(internallyRerouted.candidateIndex).not.toBe(baseline.candidateIndex)
    expect(rerouted.candidateIndex).not.toBe(baseline.candidateIndex)
    expect(minimumDistance(rerouted.path, baseline.path[0])).toBeGreaterThan(0.1)
    expect(stopped.speedScale).toBe(0)
    expect(stopped.direction).toEqual({ x: 0, y: 0 })
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
        commitUntilMs: 6_000,
        samples: [{ atMs: Number.NaN, position: { x: 14, y: 12 } }],
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

  it('returns only a finite comparison sign for extreme finite score and index values', () => {
    const high = {
      survives: 1 as const,
      reachableArea: 1e308,
      allyClearance: 0,
      playerAreaReduction: 0,
      cutoffProgress: 0,
      pressureDistance: 0,
      steeringCost: 0,
    }
    const low = { ...high, reachableArea: -1e308 }
    const tied = { ...high, reachableArea: 0 }

    expect(compareSnakePlanScores(high, 0, low, 0)).toBe(1)
    expect(compareSnakePlanScores(low, 0, high, 0)).toBe(-1)
    expect(compareSnakePlanScores(tied, -1e308, tied, 1e308)).toBe(1)
    expect(compareSnakePlanScores(tied, 1e308, tied, -1e308)).toBe(-1)
    expect(compareSnakePlanScores(tied, 0, tied, 0)).toBe(0)
  })

  it('preserves exact reachable areas above 128 before every lower score component', () => {
    const state = snapshot()
    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    const independentlyMeasured = independentlyMeasuredEnemyArea(state, plan.path.at(-1)!)
    const largerArea = {
      ...plan.score,
      reachableArea: 700,
      allyClearance: -10_000,
      playerAreaReduction: -10_000,
      cutoffProgress: -10_000,
      pressureDistance: 10_000,
      steeringCost: 10_000,
    }
    const smallerArea = {
      ...plan.score,
      reachableArea: 500,
      allyClearance: 10_000,
      playerAreaReduction: 10_000,
      cutoffProgress: 10_000,
      pressureDistance: 0,
      steeringCost: 0,
    }

    expect(independentlyMeasured).toBeGreaterThan(128)
    expect(plan.score.reachableArea).toBe(independentlyMeasured)
    expect(compareSnakePlanScores(largerArea, 95, smallerArea, 0)).toBeGreaterThan(0)
  })

  it('selects the larger of two real reachable components above 128 before offensive terms', () => {
    const simulationMs = 5_000
    const wall = trailWall(20, 0.5, 23.5, simulationMs + 10_000)
    const state = snapshot({
      simulationMs,
      player: actor('player', { x: 45, y: 12 }, { x: 0, y: 0 }),
      enemies: [actor('enemy-0', { x: 19, y: 12 }, { x: 6.5, y: 0 }, { collisionGraceMs: 240 })],
      trailDots: wall,
    })
    const candidates = generateResourceSnakeTrajectoryCandidates(state.enemies[0], PROFILE_96_LONG)
    const areas = candidates.map((candidate) => independentlyMeasuredEnemyArea(
      state,
      candidate.path.at(-1)!,
    ))
    const realComponents = [...new Set(areas.filter((area) => area > 128))]
    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, () => 0)

    expect(realComponents.length).toBeGreaterThanOrEqual(2)
    expect(plan.score.reachableArea).toBe(Math.max(...areas))
    expect(plan.score.reachableArea).toBe(independentlyMeasuredEnemyArea(state, plan.path.at(-1)!))
  })

  it('measures an unanchored public trajectory by exact connectivity rather than an anchor shortcut', () => {
    const state = snapshot({
      player: actor('player', { x: 30, y: 12 }, { x: 0, y: 0 }),
      enemies: [actor('enemy-0', { x: 22, y: 12 }, { x: 6.5, y: 0 })],
    })
    const candidate = generateResourceSnakeTrajectoryCandidates(
      state.enemies[0],
      PROFILE_96_LONG,
    )[3]
    const independent = independentlyMeasuredEnclosureReduction(state, candidate.path)

    expect(minimumDistance(candidate.path, state.player.position)).toBeGreaterThan(1.1)
    expect(independent).toBe(0)
    expect(measureResourceSnakePlayerAreaReduction(
      state,
      'enemy-0',
      PROFILE_96_LONG,
      candidate.path,
    )).toBe(independent)
  })

  it('keeps mutually exclusive hypothesis baselines independent across a three-cell wall', () => {
    const simulationMs = 5_000
    const player = actor('player', { x: 20.2, y: 12 }, { x: 9, y: 0 })
    const turnRate = 2.62
    const playerHistory = [0, 1, 2, 3].map((index): SnakePlayerHistorySample => ({
      simulationMs: simulationMs - (3 - index) * 500,
      position: { ...player.position },
      velocity: {
        x: Math.cos(turnRate * index * 0.5) * 9,
        y: Math.sin(turnRate * index * 0.5) * 9,
      },
    }))
    const wall = Array.from({ length: 32 }, (_, row): SnakePlannerTrailDot => ({
      id: 41_000 + row,
      ownerId: 'player',
      position: { x: 20.625, y: (row + 0.5) * 0.75 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + 10_000,
    }))
    const state = snapshot({ simulationMs, player, playerHistory, trailDots: wall })
    const hypotheses = predictResourceSnakePlayerHypotheses(
      state,
      PROFILE_96_LONG.lookaheadMs,
      PROFILE_96_LONG.rolloutStepMs,
    )
    const endpoints = hypotheses.all.map((hypothesis) => hypothesis.at(-1)!)
    const endpointCells = endpoints.map((endpoint) => [
      Math.floor(endpoint.x / 0.75),
      Math.floor(endpoint.y / 0.75),
    ])
    const path = Array.from({ length: 50 }, () => ({ x: 20.625, y: 12 }))
    const independent = independentlyMeasuredHypothesisReductions(state, endpoints, path)

    expect(endpointCells).toEqual([[56, 16], [28, 16], [27, 16], [26, 16]])
    expect(independent).toEqual([0, 0, 0, 0])
    expect(measureResourceSnakePlayerAreaReduction(
      state,
      'enemy-0',
      PROFILE_96_LONG,
      path,
    )).toBe(0)
  })

  it('serializes the exact raster reduction for the generated near-boundary winner', () => {
    const state = snapshot({
      player: actor('player', { x: 12, y: 20.5 }, { x: 0, y: 0 }),
      enemies: [actor('enemy-0', { x: 1.8, y: 6 }, { x: 0, y: 7.2 }, {
        maximumSpeedPerSecond: 7.2,
      })],
    })

    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    const publicExact = measureResourceSnakePlayerAreaReduction(
      state,
      'enemy-0',
      PROFILE_96_LONG,
      plan.path,
    )
    const independent = independentlyMeasuredEnclosureReduction(state, plan.path)

    expect(plan.candidateIndex).toBe(90)
    expect(minimumDistance(plan.path, state.player.position)).toBeGreaterThan(1.1)
    expect(independent).toBe(113)
    expect(publicExact).toBe(113)
    expect(plan.score.playerAreaReduction).toBe(113)
  })

  it('matches an independent raster flood beside every corner, an obstacle cell, and a self-intersection', () => {
    const cornerCases = [
      {
        name: 'left-top',
        enemy: actor('enemy-0', { x: 1.8, y: 6 }, { x: 0, y: 7.2 }, {
          maximumSpeedPerSecond: 7.2,
        }),
        player: { x: 12, y: 20.5 },
        candidateIndex: 90,
        sides: (path: readonly SnakeVector[]) => (
          Math.min(...path.map((point) => point.x)) < 2
          && Math.max(...path.map((point) => point.y)) > 22
        ),
      },
      {
        name: 'right-top',
        enemy: actor('enemy-0', { x: 48.45, y: 6 }, { x: 0, y: 7.2 }, {
          maximumSpeedPerSecond: 7.2,
        }),
        player: { x: 38, y: 20.5 },
        candidateIndex: 6,
        sides: (path: readonly SnakeVector[]) => (
          Math.max(...path.map((point) => point.x)) > 48.3
          && Math.max(...path.map((point) => point.y)) > 22
        ),
      },
      {
        name: 'left-bottom',
        enemy: actor('enemy-0', { x: 1.8, y: 18 }, { x: 0, y: -7.2 }, {
          maximumSpeedPerSecond: 7.2,
        }),
        player: { x: 12, y: 3.5 },
        candidateIndex: 6,
        sides: (path: readonly SnakeVector[]) => (
          Math.min(...path.map((point) => point.x)) < 2
          && Math.min(...path.map((point) => point.y)) < 2
        ),
      },
      {
        name: 'right-bottom',
        enemy: actor('enemy-0', { x: 48.45, y: 18 }, { x: 0, y: -7.2 }, {
          maximumSpeedPerSecond: 7.2,
        }),
        player: { x: 38, y: 3.5 },
        candidateIndex: 90,
        sides: (path: readonly SnakeVector[]) => (
          Math.max(...path.map((point) => point.x)) > 48.3
          && Math.min(...path.map((point) => point.y)) < 2
        ),
      },
    ]

    for (const fixture of cornerCases) {
      const state = snapshot({
        player: actor('player', fixture.player, { x: 0, y: 0 }),
        enemies: [fixture.enemy],
      })
      const path = generateResourceSnakeTrajectoryCandidates(
        fixture.enemy,
        PROFILE_96_LONG,
      )[fixture.candidateIndex].path
      const independent = independentlyMeasuredEnclosureReduction(state, path)

      expect(fixture.sides(path)).toBe(true)
      expect(independent, fixture.name).toBeGreaterThan(0)
      expect(measureResourceSnakePlayerAreaReduction(
        state,
        'enemy-0',
        PROFILE_96_LONG,
        path,
      )).toBe(independent)
    }

    const obstacle = { x: 20, y: 13.2 }
    const obstacleState = snapshot({
      trailDots: [{
        id: 9_001,
        ownerId: 'player',
        position: obstacle,
        spawnedAtMs: 0,
        expiresAtMs: 100_000,
      }],
    })
    const obstaclePath = generateResourceSnakeTrajectoryCandidates(
      obstacleState.enemies[0],
      PROFILE_96_LONG,
    )[0].path
    expect(minimumDistance(obstaclePath, obstacle)).toBeLessThan(1.3)
    expect(measureResourceSnakePlayerAreaReduction(
      obstacleState,
      'enemy-0',
      PROFILE_96_LONG,
      obstaclePath,
    )).toBe(independentlyMeasuredEnclosureReduction(obstacleState, obstaclePath))

    const selfIntersecting = Array.from({ length: 50 }, (_, index) => {
      const radians = index / 49 * Math.PI * 2
      return { x: 25 + Math.sin(radians * 2) * 7, y: 12 + Math.sin(radians) * 5 }
    })
    const arbitraryState = snapshot({
      player: actor('player', { x: 25, y: 20 }, { x: 0, y: 0 }),
    })
    expect(measureResourceSnakePlayerAreaReduction(
      arbitraryState,
      'enemy-0',
      PROFILE_96_LONG,
      selfIntersecting,
    )).toBe(independentlyMeasuredEnclosureReduction(arbitraryState, selfIntersecting))
  })

  it('emits a time-addressed command trajectory that the authoritative runtime executes', () => {
    let runtime = activeRuntime()
    const state = snapshotFromRuntime(runtime)
    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, () => 0)

    expect(plan.plannedAtMs).toBe(state.simulationMs)
    expect(plan.stepMs).toBe(50)
    expect(plan.directions).toHaveLength(plan.path.length)
    for (let index = 0; index < 300; index += 1) {
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
      (plan) => { plan.score = null as unknown as SnakePlan['score'] },
      (plan) => { plan.path = [] },
      (plan) => { plan.path = null as unknown as SnakePlan['path'] },
      (plan) => { plan.path = plan.path.slice(0, -1) },
      (plan) => { plan.path.push({ ...plan.path.at(-1)! }) },
      (plan) => { delete plan.path[0] },
      (plan) => { plan.path[0].y = Number.NEGATIVE_INFINITY },
      (plan) => { plan.directions = plan.directions.slice(0, -1) },
      (plan) => { plan.directions = null as unknown as SnakePlan['directions'] },
      (plan) => { plan.directions.push({ ...plan.directions.at(-1)! }) },
      (plan) => { delete plan.directions[0] },
      (plan) => { plan.directions[0] = { x: -plan.directions[0].x, y: -plan.directions[0].y } },
      (plan) => { plan.directions[0].x = Number.NaN },
      (plan) => { plan.path[0].x += 1 },
      (plan) => { plan.plannedAtMs += 1 },
      (plan) => { plan.plannedAtMs = Number.NEGATIVE_INFINITY },
      (plan) => { plan.commandAtMs = Number.NaN },
      (plan) => { plan.commandAtMs = plan.plannedAtMs - 1 },
      (plan) => { plan.stepMs = 25 as SnakePlan['stepMs'] },
      (plan) => { plan.originPosition.x = Number.NaN },
      (plan) => { plan.direction = null as unknown as SnakePlan['direction'] },
      (plan) => { plan.originVelocity.y = Number.POSITIVE_INFINITY },
      (plan) => { plan.originMaximumSpeedPerSecond = Number.NaN },
      (plan) => { plan.originMaximumSpeedPerSecond += 1 },
      (plan) => { plan.speedScale = 0.25 as SnakePlan['speedScale'] },
      (plan) => { plan.candidateIndex = 999 },
      (plan) => { plan.candidateIndex = Number.NaN },
      (plan) => { plan.candidateIndex = 0.5 },
      (plan) => { plan.evaluatedCandidates = 47 },
      (plan) => { plan.evaluatedCandidates = Number.NaN },
      (plan) => { plan.evaluatedCandidates = 95.5 },
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

  it('rejects every finite caller mutation of retained score diagnostics', () => {
    const state = snapshot()
    const valid = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const mutations: Array<(plan: SnakePlan) => void> = [
      (plan) => { plan.score.survives = 0 },
      (plan) => { plan.score.reachableArea += 1 },
      (plan) => { plan.score.allyClearance += 1 },
      (plan) => { plan.score.playerAreaReduction += 1 },
      (plan) => { plan.score.cutoffProgress += 1 },
      (plan) => { plan.score.pressureDistance += 1 },
      (plan) => { plan.score.steeringCost += 1 },
    ]

    for (const mutate of mutations) {
      const callerMutated = structuredClone(valid)
      mutate(callerMutated)
      ;(callerMutated as SnakePlan & { provenance: string }).provenance = forgeCallerPlanChecksum(
        callerMutated,
      )
      const result = planResourceSnakeEnemy(
        state,
        'enemy-0',
        PROFILE_48,
        callerMutated,
        () => 0,
      )
      expect(result.score).toEqual(valid.score)
      expect(result.candidateIndex).toBe(valid.candidateIndex)
      expect(result.evaluatedCandidates).toBe(PROFILE_48.candidateCount)
    }
  })

  it('recomputes cloned retained diagnostics instead of trusting a forged caller checksum', () => {
    const state = snapshot()
    const authoritative = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const forged = structuredClone(authoritative)
    forged.score.reachableArea += 123
    forged.score.playerAreaReduction += 77
    ;(forged as SnakePlan & { provenance: string }).provenance = forgeCallerPlanChecksum(forged)

    const retained = planResourceSnakeEnemy(
      structuredClone(state),
      'enemy-0',
      PROFILE_48,
      forged,
      () => 0,
    )

    expect(retained.score).toEqual(authoritative.score)
    expect(retained.score).not.toEqual(forged.score)
    expect(retained.candidateIndex).toBe(authoritative.candidateIndex)
    expect(retained).not.toBe(forged)
  })

  it('reconstructs every retained diagnostic and identity from the executable trajectory', () => {
    const state = snapshot()
    const authoritative = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const forged = structuredClone(authoritative)
    forged.intent = authoritative.intent === 'coordinate' ? 'observe' : 'coordinate'
    forged.candidateIndex = (authoritative.candidateIndex + 1) % PROFILE_48.candidateCount
    forged.score = {
      survives: 0,
      reachableArea: authoritative.score.reachableArea + 1_234,
      allyClearance: authoritative.score.allyClearance + 1_234,
      playerAreaReduction: authoritative.score.playerAreaReduction + 1_234,
      cutoffProgress: authoritative.score.cutoffProgress + 1_234,
      pressureDistance: authoritative.score.pressureDistance + 1_234,
      steeringCost: authoritative.score.steeringCost + 1_234,
    }
    ;(forged as SnakePlan & { provenance: string }).provenance = forgeCallerPlanChecksum(forged)

    const retained = planResourceSnakeEnemy(
      structuredClone(state),
      'enemy-0',
      PROFILE_48,
      forged,
      () => 0,
    )

    const forgedIdentity = structuredClone(forged)
    forgedIdentity.enemyId = 'enemy-1'
    forgedIdentity.role = 'blocker'
    const identityResult = planResourceSnakeEnemy(
      structuredClone(state),
      'enemy-0',
      PROFILE_48,
      forgedIdentity,
      () => 0,
    )

    expect(retained.enemyId).toBe('enemy-0')
    expect(retained.role).toBe('pressure')
    expect(retained.intent).toBe(authoritative.intent)
    expect(retained.candidateIndex).toBe(authoritative.candidateIndex)
    expect(retained.score).toEqual(authoritative.score)
    expect(retained).not.toHaveProperty('provenance')
    expect(identityResult.enemyId).toBe('enemy-0')
    expect(identityResult.role).toBe('pressure')
    expect(identityResult.intent).toBe(authoritative.intent)
    expect(identityResult.candidateIndex).toBe(authoritative.candidateIndex)
    expect(identityResult.score).toEqual(authoritative.score)
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

  it('converts plans to canonical timed ally occupancy at boundaries and off-grid re-entry', () => {
    const state = snapshot()
    const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    const committed = resourceSnakePlanToCommittedPath(plan, plan.plannedAtMs)
    const reenteredAtMs = plan.plannedAtMs + 170
    const reentered = resourceSnakePlanToCommittedPath(plan, reenteredAtMs)
    const checkedTimes = [
      plan.plannedAtMs,
      plan.plannedAtMs + 25,
      plan.plannedAtMs + 50,
      reenteredAtMs,
      plan.commitUntilMs,
    ]

    expect(committed).not.toBeNull()
    expect(reentered).not.toBeNull()
    if (!committed || !reentered) throw new Error('expected active canonical committed paths')
    expect(committed.samples[0]).toEqual({
      atMs: plan.plannedAtMs,
      position: sampleResourceSnakePlan(plan, plan.plannedAtMs).position,
    })
    for (const atMs of checkedTimes) {
      expect(sampleResourceSnakeCommittedPath(committed, atMs)?.position).toEqual(
        sampleResourceSnakePlan(plan, atMs).position,
      )
    }
    expect(reentered.samples[0]).toEqual({
      atMs: reenteredAtMs,
      position: sampleResourceSnakePlan(plan, reenteredAtMs).position,
    })
    expect(sampleResourceSnakeCommittedPath(reentered, reenteredAtMs + 25)?.position).toEqual(
      sampleResourceSnakePlan(plan, reenteredAtMs + 25).position,
    )
    expect(sampleResourceSnakeCommittedPath(committed, plan.commitUntilMs + 0.001)).toBeNull()
    expect(sampleResourceSnakeCommittedPath(
      committed,
      plan.plannedAtMs + plan.path.length * plan.stepMs + 500,
    )).toBeNull()
    expect(resourceSnakePlanToCommittedPath(plan, plan.commitUntilMs)).toBeNull()
    expect(resourceSnakePlanToCommittedPath(
      plan,
      plan.plannedAtMs + plan.path.length * plan.stepMs + 500,
    )).toBeNull()
    expect(getResourceSnakePlanFutureSamples(plan, reenteredAtMs).every((sample) => (
      sample.atMs > reenteredAtMs
    ))).toBe(true)
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

  it('keeps a future swept trail contact open at exact expiry equality', () => {
    const simulationMs = 5_000
    const state = snapshot({ simulationMs })
    const kept = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const relativeMs = 180
    const segmentIndex = Math.floor(relativeMs / kept.stepMs)
    const segmentStartMs = segmentIndex * kept.stepMs
    const start = kept.path[segmentIndex - 1]
    const end = kept.path[segmentIndex]
    const fraction = (relativeMs - segmentStartMs) / kept.stepMs
    const dx = end.x - start.x
    const dy = end.y - start.y
    const size = Math.hypot(dx, dy)
    const contact = {
      x: start.x + dx * fraction,
      y: start.y + dy * fraction,
    }
    const dot: SnakePlannerTrailDot = {
      id: 32_000,
      ownerId: 'player',
      position: { x: contact.x + dx / size * 0.55, y: contact.y + dy / size * 0.55 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + relativeMs,
    }

    const open = planResourceSnakeEnemy({ ...state, trailDots: [dot] }, 'enemy-0', PROFILE_48, kept, () => 0)
    const blocked = planResourceSnakeEnemy({
      ...state,
      trailDots: [{ ...dot, expiresAtMs: dot.expiresAtMs + 0.001 }],
    }, 'enemy-0', PROFILE_48, kept, () => 0)

    expect(observableTuple(open)).toEqual(observableTuple(kept))
    expect(observableTuple(blocked)).not.toEqual(observableTuple(kept))
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

  it('accepts only legal tier tuples while allowing adaptive candidate counts', () => {
    const adaptive = { ...PROFILE_48, candidateCount: 96 } as SnakePlannerProfile
    const legal = planResourceSnakeEnemy(snapshot(), 'enemy-0', adaptive, null, () => 0)
    const invalidProfiles = [
      { ...PROFILE_48, lookaheadMs: 50 },
      { ...PROFILE_48, commitMs: 1 },
      { ...PROFILE_48, planningHz: 0.1 },
      { ...PROFILE_48, commitMs: PROFILE_72.commitMs },
      { ...PROFILE_48, rolloutStepMs: 25 },
    ] as unknown as SnakePlannerProfile[]

    expect(legal.fallback).toBe(false)
    expect(legal.evaluatedCandidates).toBe(96)
    for (const profile of invalidProfiles) {
      const plan = planResourceSnakeEnemy(snapshot(), 'enemy-0', profile, null, () => 0)
      expect(plan.fallback).toBe(true)
      expectEveryNumberFinite(plan)
    }
  })

  it('bounds authoritative field, timestamps, and malformed runtime arrays before allocation', () => {
    const validDot: SnakePlannerTrailDot = {
      id: 50_000,
      ownerId: 'player',
      position: { x: 40, y: 2 },
      spawnedAtMs: 0,
      expiresAtMs: 10_000,
    }
    const validCommitted: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: 5_050,
      samples: [
        { atMs: 5_000, position: { x: 40, y: 2 } },
        { atMs: 5_050, position: { x: 40, y: 2 } },
      ],
    }
    const invalidSnapshots: SnakePlannerSnapshot[] = [
      snapshot({ field: { width: 51 as 50, height: 24, padding: 0.5 } }),
      snapshot({ field: { width: 1e308 as 50, height: 24, padding: 0.5 } }),
      snapshot({ field: { width: 50, height: 25 as 24, padding: 0.5 } }),
      snapshot({ field: { width: 50, height: 24, padding: -1 } }),
      snapshot({ field: { width: 50, height: 24, padding: 12 } }),
      snapshot({ simulationMs: -1 }),
      snapshot({ simulationMs: 1e308 }),
      snapshot({ playerHistory: [{ ...history(5_000, { x: 30, y: 12 }, { x: 0, y: 0 })[0], simulationMs: -1 }] }),
      snapshot({ playerHistory: [{ ...history(5_000, { x: 30, y: 12 }, { x: 0, y: 0 })[0], simulationMs: 1e308 }] }),
      snapshot({ trailDots: [{
        id: 1,
        ownerId: 'player',
        position: { x: 20, y: 12 },
        spawnedAtMs: -1,
        expiresAtMs: 10_000,
      }] }),
      snapshot({ trailDots: [{ ...validDot, expiresAtMs: 1e308 }] }),
      snapshot({ committedAllyPaths: [{ ...validCommitted, commitUntilMs: 1e308 }] }),
      snapshot({ enemies: [...snapshot().enemies, actor('enemy-1', { x: 12, y: 12 }, { x: 0, y: 0 }), actor('enemy-1', { x: 14, y: 12 }, { x: 0, y: 0 })] }),
      snapshot({ trailDots: new Array(2_049).fill(validDot) }),
      snapshot({ playerHistory: new Array(513).fill(history(5_000, { x: 30, y: 12 }, { x: 0, y: 0 })[0]) }),
      snapshot({ committedAllyPaths: new Array(9).fill(validCommitted) }),
      { ...snapshot(), trailDots: null } as unknown as SnakePlannerSnapshot,
      { ...snapshot(), playerHistory: null } as unknown as SnakePlannerSnapshot,
      { ...snapshot(), committedAllyPaths: null } as unknown as SnakePlannerSnapshot,
      { ...snapshot(), enemies: null } as unknown as SnakePlannerSnapshot,
      { ...snapshot(), player: null } as unknown as SnakePlannerSnapshot,
    ]

    for (const state of invalidSnapshots) {
      expect(() => planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)).not.toThrow()
      const plan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
      expect(plan.fallback).toBe(true)
      expectEveryNumberFinite(plan)
    }
  })

  it('rejects whole, accessor, and sparse runtime snapshots before any dereference', () => {
    const hostile = Object.defineProperty({}, 'enemies', {
      get: () => { throw new Error('snapshot accessor must not escape') },
    })
    const sparseCommitted: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: 5_050,
      samples: new Array(2),
    }
    const malformed: unknown[] = [
      null,
      undefined,
      42,
      'snapshot',
      {},
      hostile,
      { ...snapshot(), enemies: new Array<SnakePlannerActor>(1) },
      { ...snapshot(), trailDots: new Array<SnakePlannerTrailDot>(1) },
      { ...snapshot(), playerHistory: new Array<SnakePlayerHistorySample>(1) },
      { ...snapshot(), committedAllyPaths: new Array<SnakeCommittedPath>(1) },
      { ...snapshot(), committedAllyPaths: [sparseCommitted] },
    ]

    for (const value of malformed) {
      expect(() => planResourceSnakeEnemy(
        value as SnakePlannerSnapshot,
        'enemy-0',
        PROFILE_48,
        null,
        () => 0,
      )).not.toThrow()
      const plan = planResourceSnakeEnemy(
        value as SnakePlannerSnapshot,
        'enemy-0',
        PROFILE_48,
        null,
        () => 0,
      )
      expect(plan.fallback).toBe(true)
      expectEveryNumberFinite(plan)
      expect(() => JSON.stringify(plan)).not.toThrow()
    }
  })

  it('makes every public timed-path array boundary sparse-safe', () => {
    const state = snapshot()
    const valid = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    const sparse = structuredClone(valid)
    delete sparse.path[0]
    delete sparse.directions[0]
    const sparsePublicPath = new Array<SnakeVector>(valid.path.length)
    const sparseHistory = {
      ...state,
      playerHistory: new Array<SnakePlayerHistorySample>(1),
    }
    const sparseCommitted: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: state.simulationMs + 50,
      samples: new Array(2),
    }

    expect(resourceSnakePlanToCommittedPath(sparse)).toBeNull()
    expect(getResourceSnakePlanFutureSamples(sparse, state.simulationMs)).toEqual([])
    expect(measureResourceSnakePlayerAreaReduction(
      state,
      'enemy-0',
      PROFILE_96_LONG,
      sparsePublicPath,
    )).toBe(0)
    expect(sampleResourceSnakeCommittedPath(sparseCommitted, state.simulationMs)).toBeNull()
    expect(predictResourceSnakePlayerHypotheses(
      sparseHistory as SnakePlannerSnapshot,
      PROFILE_96_LONG.lookaheadMs,
      PROFILE_96_LONG.rolloutStepMs,
    ).all.every((path) => path.length === 0)).toBe(true)
    expect(() => sampleResourceSnakePlan(sparse, state.simulationMs + 50)).not.toThrow()
    const sample = sampleResourceSnakePlan(sparse, state.simulationMs + 50)
    expect(sample.speedScale).toBe(0)
    expect(sample.direction).toEqual({ x: 0, y: 0 })
    expectEveryNumberFinite(sample)
  })

  it('makes every exported boundary total for throwing getters and extreme finite scalars', () => {
    const state = snapshot()
    const validPlan = planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0)
    const hostileProfile = Object.defineProperty({}, 'candidateCount', {
      get: () => { throw new Error('hostile profile') },
    }) as SnakePlannerProfile
    const hostileScore = Object.defineProperty({}, 'survives', {
      get: () => { throw new Error('hostile score') },
    }) as SnakePlan['score']
    const hostilePlan = Object.defineProperty({}, 'path', {
      get: () => { throw new Error('hostile plan') },
    }) as SnakePlan
    const hostileCommitted = Object.defineProperty({}, 'samples', {
      get: () => { throw new Error('hostile committed path') },
    }) as SnakeCommittedPath
    const hostileActor = Object.defineProperty({}, 'position', {
      get: () => { throw new Error('hostile actor') },
    }) as SnakePlannerActor
    const extremeActor = actor(
      'enemy-0',
      { x: 10, y: 12 },
      { x: 1e308, y: 1e308 },
      { maximumSpeedPerSecond: 1e308 },
    )
    const sparsePath = [...validPlan.path]
    Object.defineProperty(sparsePath, 0, {
      get: () => { throw new Error('hostile vector') },
    })

    const outcomes = [
      () => planResourceSnakeEnemy(state, 'enemy-0', hostileProfile, null, () => 0),
      () => generateResourceSnakeTrajectoryCandidates(state.enemies[0], hostileProfile),
      () => generateResourceSnakeTrajectoryCandidates(hostileActor, PROFILE_48),
      () => measureResourceSnakePlayerAreaReduction(
        state,
        'enemy-0',
        hostileProfile,
        validPlan.path,
      ),
      () => measureResourceSnakePlayerAreaReduction(
        state,
        'enemy-0',
        PROFILE_48,
        sparsePath,
      ),
      () => compareSnakePlanScores(hostileScore, 0, validPlan.score, 1),
      () => predictResourceSnakePlayerHypotheses(hostilePlan, 1_000, 50),
      () => sampleResourceSnakePlan(hostilePlan, state.simulationMs),
      () => getResourceSnakePlanFutureSamples(hostilePlan, state.simulationMs),
      () => resourceSnakePlanToCommittedPath(hostilePlan, state.simulationMs),
      () => sampleResourceSnakeCommittedPath(hostileCommitted, state.simulationMs),
    ]
    for (const outcome of outcomes) expect(outcome).not.toThrow()
    const results = outcomes.map((outcome) => outcome())
    for (const result of results) expectFiniteSerializable(result)
    expectEveryNumberFinite(results[0])
    expect(results.slice(1, 3)).toEqual([[], []])
    expect(results.slice(3, 6)).toEqual([0, 0, 0])
    expect((results[6] as ReturnType<typeof predictResourceSnakePlayerHypotheses>).all).toEqual([
      [], [], [], [],
    ])
    expectEveryNumberFinite(results[7])
    expect(results.slice(8)).toEqual([[], null, null])

    expect(generateResourceSnakeTrajectoryCandidates(extremeActor, PROFILE_96_LONG)).toEqual([])
    const extremeMain = planResourceSnakeEnemy(
      snapshot({ enemies: [extremeActor] }),
      'enemy-0',
      PROFILE_96_LONG,
      null,
      () => 0,
    )
    expectEveryNumberFinite(extremeMain)

    const clockValues = [0, 1e308]
    const extremeClock = planResourceSnakeEnemy(
      state,
      'enemy-0',
      PROFILE_48,
      null,
      () => clockValues.shift() ?? 1e308,
    )
    const throwingClock = planResourceSnakeEnemy(
      state,
      'enemy-0',
      PROFILE_48,
      null,
      () => { throw new Error('hostile clock') },
    )
    expectEveryNumberFinite(extremeClock)
    expectEveryNumberFinite(throwingClock)
    expect(extremeClock.elapsedMs).toBeLessThanOrEqual(1_000_000_000)
    expect(throwingClock.elapsedMs).toBe(0)
  })

  it('returns fresh finite JSON-safe values for cyclic identities, roles, scores, and timelines', () => {
    const state = snapshot()
    const cyclicId = {} as { self?: unknown }
    cyclicId.self = cyclicId
    const cyclicRole = {} as { self?: unknown }
    cyclicRole.self = cyclicRole
    const cyclicScore = { survives: 1 } as { survives: number; self?: unknown }
    cyclicScore.self = cyclicScore

    const cyclicRequested = planResourceSnakeEnemy(
      state,
      cyclicId as unknown as SnakePlannerActor['id'],
      PROFILE_48,
      null,
      () => 0,
    )
    const invalidActor = actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 })
    invalidActor.id = cyclicId as unknown as SnakePlannerActor['id']
    invalidActor.role = cyclicRole as unknown as SnakePlannerActor['role']
    const cyclicSnapshot = planResourceSnakeEnemy(
      snapshot({ enemies: [invalidActor] }),
      cyclicId as unknown as SnakePlannerActor['id'],
      PROFILE_48,
      null,
      () => 0,
    )
    const cyclicRoleActor = actor('enemy-0', { x: 10, y: 12 }, { x: 6.5, y: 0 })
    cyclicRoleActor.role = cyclicRole as unknown as SnakePlannerActor['role']
    const cyclicRolePlan = planResourceSnakeEnemy(
      snapshot({ enemies: [cyclicRoleActor] }),
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const duplicateTimeline: SnakeCommittedPath = {
      enemyId: 'enemy-1',
      commitUntilMs: state.simulationMs + 50,
      samples: [
        { atMs: state.simulationMs, position: { x: 10, y: 12 } },
        { atMs: state.simulationMs, position: { x: 10.1, y: 12 } },
      ],
    }
    const duplicatePlan = planResourceSnakeEnemy(
      { ...state, committedAllyPaths: [duplicateTimeline] },
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    const cyclicPlan = structuredClone(
      planResourceSnakeEnemy(state, 'enemy-0', PROFILE_48, null, () => 0),
    )
    cyclicPlan.enemyId = cyclicId as unknown as SnakePlannerActor['id']

    const results = [
      cyclicRequested,
      cyclicSnapshot,
      cyclicRolePlan,
      duplicatePlan,
      compareSnakePlanScores(
        cyclicScore as unknown as SnakePlan['score'],
        0,
        cyclicScore as unknown as SnakePlan['score'],
        1,
      ),
      sampleResourceSnakePlan(cyclicPlan, state.simulationMs),
      getResourceSnakePlanFutureSamples(cyclicPlan, state.simulationMs),
      resourceSnakePlanToCommittedPath(cyclicPlan, state.simulationMs),
      sampleResourceSnakeCommittedPath(duplicateTimeline, state.simulationMs),
    ]

    for (const result of results) expectFiniteSerializable(result)
    for (const plan of [cyclicRequested, cyclicSnapshot, cyclicRolePlan, duplicatePlan]) {
      expect(typeof plan.enemyId).toBe('string')
      expect(['pressure', 'blocker']).toContain(plan.role)
    }
    expect(sampleResourceSnakeCommittedPath(duplicateTimeline, state.simulationMs)).toBeNull()
  })

  it('reserves the timestamp ceiling through plan, adapter, and commitment reinjection', () => {
    const maximumPlanningTimestamp = 1_000_000_000 - 2_500
    const initial = snapshot({ simulationMs: maximumPlanningTimestamp })
    const plan = planResourceSnakeEnemy(initial, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    const committed = resourceSnakePlanToCommittedPath(plan, maximumPlanningTimestamp)

    expect(plan.fallback).toBe(false)
    expect(committed).not.toBeNull()
    if (!committed) throw new Error('maximum accepted timestamp must retain a future commitment')
    expect(committed.samples.at(-1)?.atMs).toBe(plan.commitUntilMs)
    expect(Math.max(...committed.samples.map((sample) => sample.atMs))).toBeLessThanOrEqual(1_000_000_000)

    const reinjected = snapshot({
      simulationMs: maximumPlanningTimestamp,
      committedAllyPaths: [committed],
    })
    const next = planResourceSnakeEnemy(reinjected, 'enemy-0', PROFILE_96_LONG, null, () => 0)
    expect(next.fallback).toBe(false)
    expectEveryNumberFinite(next)

    const beyondReservedCeiling = planResourceSnakeEnemy(
      snapshot({ simulationMs: maximumPlanningTimestamp + 1 }),
      'enemy-0',
      PROFILE_48,
      null,
      () => 0,
    )
    expect(beyondReservedCeiling.fallback).toBe(true)
    expectEveryNumberFinite(beyondReservedCeiling)
  })

})

function runResourceSnakePerformanceAcceptance(): void {
    const simulationMs = 5_000
    const offPathDots = Array.from({ length: 320 }, (_, index): SnakePlannerTrailDot => ({
      id: 20_000 + index,
      ownerId: 'player',
      position: { x: 42 + (index % 16) * 0.4, y: 1 + Math.floor(index / 16) * 0.08 },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + 100_000,
    }))
    const hotCorridorDots = Array.from({ length: 320 }, (_, index): SnakePlannerTrailDot => ({
      id: 30_000 + index,
      ownerId: 'player',
      position: {
        x: -0.44 + (index % 160) * 0.32,
        y: index < 160 ? 8 : 16,
      },
      spawnedAtMs: 0,
      expiresAtMs: simulationMs + 100_000,
    }))
    const clock = () => performance.now()
    const measurements: Array<{
      field: string
      run: number
      median: number
      p95: number
      max: number
      externalP95: number
    }> = []
    const fields: Array<[string, SnakePlannerTrailDot[]]> = [
      ['empty', []],
      ['off-path', offPathDots],
      ['hot-corridor', hotCorridorDots],
    ]
    // Isolate V8 compilation from the acceptance samples. Every individual
    // moving series below still performs its own required 50-state warmup.
    const jitWarmup = snapshot()
    for (let index = 0; index < 100; index += 1) {
      planResourceSnakeEnemy(jitWarmup, 'enemy-0', PROFILE_96_LONG, null, clock)
    }
    for (const [field, dots] of fields) {
      for (let run = 0; run < 3; run += 1) {
        const durations: number[] = []
        const externalDurations: number[] = []
        for (let index = 0; index < 81; index += 1) {
          const sequenceIndex = run * 81 + index
          const heading = sequenceIndex * 0.000_013
          const velocity = { x: Math.cos(heading) * 6.5, y: Math.sin(heading) * 6.5 }
          const moving = snapshot({
            simulationMs: simulationMs + sequenceIndex * 50,
            enemies: [actor(
              'enemy-0',
              { x: 10 + sequenceIndex * 0.000_013, y: 12 + sequenceIndex * 0.000_007 },
              velocity,
            )],
            trailDots: dots,
          })
          const externalStartedAt = performance.now()
          const plan = planResourceSnakeEnemy(
            moving,
            'enemy-0',
            PROFILE_96_LONG,
            null,
            clock,
          )
          const externalElapsed = performance.now() - externalStartedAt
          if (index >= 50) {
            expect(plan.evaluatedCandidates).toBe(96)
            expect(plan.fallback).toBe(false)
            durations.push(plan.elapsedMs)
            externalDurations.push(externalElapsed)
          }
        }
        durations.sort((left, right) => left - right)
        externalDurations.sort((left, right) => left - right)
        const median = durations[Math.floor(durations.length / 2)]
        const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
        const externalP95 = externalDurations[Math.ceil(externalDurations.length * 0.95) - 1]
        measurements.push({ field, run, median, p95, max: durations.at(-1)!, externalP95 })
      }
    }
    const cacheDiagnostics: Array<{ field: string; median: number; p95: number; max: number }> = []
    for (const [field, dots] of fields) {
      const identical = snapshot({ trailDots: dots })
      for (let index = 0; index < 50; index += 1) {
        planResourceSnakeEnemy(identical, 'enemy-0', PROFILE_96_LONG, null, clock)
      }
      const durations: number[] = []
      for (let index = 0; index < 31; index += 1) {
        const plan = planResourceSnakeEnemy(identical, 'enemy-0', PROFILE_96_LONG, null, clock)
        expect(plan.evaluatedCandidates).toBe(96)
        durations.push(plan.elapsedMs)
      }
      durations.sort((left, right) => left - right)
      cacheDiagnostics.push({
        field,
        median: durations[Math.floor(durations.length / 2)],
        p95: durations[Math.ceil(durations.length * 0.95) - 1],
        max: durations.at(-1)!,
      })
    }
    expect(measurements, JSON.stringify({ measurements, cacheDiagnostics })).toSatisfy(
      (values: typeof measurements) => values.every((measurement) => measurement.p95 <= 3),
    )
}
