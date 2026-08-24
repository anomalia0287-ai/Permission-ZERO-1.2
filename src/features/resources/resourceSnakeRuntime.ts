import type { CompanyCategory } from '../../game/model'
import {
  advanceSnakeWatchers,
  createSnakeWatchers,
  type SnakeWatcher,
  type SnakeWatcherStrike,
} from './resourceSnakeWatchers'
import {
  SNAKE_DIRECTION_VECTORS,
  consumeResourceSnakeTurn,
  createResourceSnakeInputState,
  flushResourceSnakeChord,
  pressResourceSnakeKey,
  releaseResourceSnakeKey,
  resetPressedSnakeKeys,
  type ResourceSnakeInputState,
  type SnakeDirection8,
} from './resourceSnakeInput'

export const RESOURCE_SNAKE_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  fixedStepMs: 1000 / 120,
  maximumFrameDeltaMs: 100,
  playerMaximumSpeedPerSecond: 12,
  openingSpeedScale: 0.5,
  maximumRoundSpeedScale: 0.75,
  speedRampMs: 30_000,
  minimumLiveSpeedScale: 0.92,
  enemySafetyHorizonMs: 850,
  enemyMinimumHeadingHoldMs: 700,
  enemyNormalTurnWindowMs: 2_000,
  enemyMaximumNormalTurnsPerWindow: 2,
  enemyEmergencyCollisionMs: 300,
  enemyEmergencyReturnCollisionMs: 250,
  enemyEmergencyCooldownMs: 2_000,
  enemyEmergencyLockMs: 900,
  enemyEmergencyCorrectionHoldMs: 350,
  enemyReturnHeadingLockMs: 1_400,
  enemySafetyHysteresisMs: 250,
  enemySafetyClearance: 0.16,
  enemySelfSafetyClearance: 0.32,
  enemyAllySafetyClearance: 0.32,
  headRadius: 0.34,
  trailRadius: 0.16,
  trailSpacing: 0.32,
  trailLifetimeMs: 10_000,
  trailShrinkMs: 2_000,
  maximumTrailDots: 320,
  deploymentMs: 360,
  damagePerCollision: 20,
  collisionGraceMs: 650,
  hitStopMs: 90,
  collisionGapRadius: 0.65,
  selfTrailIgnoreAgeMs: 240,
  deathFlashMs: 90,
  playerExtractionMs: 700,
  roundResolveMs: 820,
  playerMaximumIntegrity: 100,
} as const

const FIXED_STEP_COMPARISON_EPSILON_MS = 1e-9

export type SnakeId = 'player' | `enemy-${number}`
export type SnakeRoundPhase = 'idle' | 'deploying' | 'active' | 'resolving'
export type SnakeActorPhase = 'spawning' | 'active' | 'extracting' | 'exploding' | 'defeated'
export type SnakeEnemyRole = 'pressure' | 'blocker'

export interface SnakeVector {
  x: number
  y: number
}

export interface SnakeTrailDot {
  id: number
  position: SnakeVector
  spawnedAtMs: number
  expiresAtMs: number
}

export interface SnakeActor {
  id: SnakeId
  kind: 'player' | 'enemy'
  category: CompanyCategory | null
  reservedBlockId: string | null
  rewardKey: string | null
  reservationStatus: 'active' | 'pending' | 'resolved' | 'cancelled' | null
  role: SnakeEnemyRole | null
  previousPosition: SnakeVector
  position: SnakeVector
  heading: SnakeDirection8
  velocity: SnakeVector
  integrity: number
  maximumIntegrity: number
  maximumSpeedPerSecond: number
  collisionGraceMs: number
  phase: SnakeActorPhase
  trail: SnakeTrailDot[]
  /** Presentation-only exact turn points. Collision authority remains `trail`. */
  railVertices: SnakeVector[]
  distanceSinceTrailDot: number
  nextTrailDotId: number
  enemyTurnGovernor: SnakeEnemyTurnGovernorState | null
}

export type SnakeEnemyTurnCause = 'normal' | 'emergency' | 'emergency-correction'

export interface SnakeEnemyTurnGovernorState {
  lastHeadingChangeAtMs: number | null
  previousHeading: SnakeDirection8 | null
  normalTurnAtMs: number[]
  lastEmergencyTurnAtMs: number | null
  lockedUntilMs: number
  lastTurnCause: SnakeEnemyTurnCause | null
}

export interface SnakeEnemyTurnPolicy {
  minimumHeadingHoldMs: number
}

export interface SnakeEnemySetup {
  id: `enemy-${number}`
  category: CompanyCategory
  reservedBlockId: string
  rewardKey: string
  role: SnakeEnemyRole
  spawn: SnakeVector
  maximumIntegrity: 30 | 35 | 50 | 65 | 80
  maximumSpeedPerSecond: number
}

export interface SnakeRoundSetup {
  roundId: string
  /** Company watchers on the field, from the campaign's suspicion. */
  watcherCount?: number
  playerSpawn: SnakeVector
  playerMaximumSpeedPerSecond?: number
  enemies: SnakeEnemySetup[]
}

export interface SnakeFrameInput {
  /** Compatibility command; the runtime snaps it to a legal eight-way hard turn. */
  playerDirection?: SnakeVector
  /** Compatibility alias for callers that call the value an intent. */
  playerIntent?: SnakeVector
  /** Enemy vector magnitude may request the bounded 0.92–1 recovery speed scale. */
  enemyDirections?: Record<string, SnakeVector>
  /**
   * Absolute simulation-time AI turns. The fixed-step runtime applies each
   * change on the first step starting at or after `atMs`, so telegraphs are
   * never shortened by a coarse render frame.
   */
  enemyDirectionSchedules?: Record<string, readonly SnakeEnemyDirectionChange[]>
  /** Stage-specific ordinary-turn pacing; safety thresholds remain authoritative. */
  enemyTurnPolicies?: Record<string, SnakeEnemyTurnPolicy>
}

export interface SnakeEnemyDirectionChange {
  atMs: number
  direction: SnakeVector
}

export type ResourceSnakeEvent =
  | { id: number; type: 'round-started'; roundId: string }
  | {
      id: number
      type: 'snake-turn-queued'
      heading: SnakeDirection8
      inputAtMs: number
      startedAtMs: number
    }
  | {
      id: number
      type: 'snake-turn-committed'
      heading: SnakeDirection8
      inputAtMs: number
      startedAtMs: number
    }
  | {
      id: number
      type: 'snake-turn-rejected'
      requestedHeading: SnakeDirection8
      reason: 'reverse' | 'queue-full'
      inputAtMs: number
      startedAtMs: number
    }
  | {
      id: number
      type: 'snake-collided'
      actorIds: SnakeId[]
      collisionKind?: 'boundary' | 'head-head' | 'trail' | 'watcher'
      obstacleOwnerId?: SnakeId
      point: SnakeVector
      hitStopMs: 90
      startedAtMs: number
    }
  | { id: number; type: 'snake-damaged'; actorId: SnakeId; integrity: number; maximumIntegrity: number }
  | { id: number; type: 'snake-died'; actorId: SnakeId; category: CompanyCategory | null; startedAtMs: number }
  | { id: number; type: 'player-extracted'; actorId: 'player'; startedAtMs: number }
  | {
      id: number
      type: 'resource-reward-resolved'
      rewardKey: string
      outcome: 'success' | 'interrogation' | 'rejected' | 'cancelled'
      category: CompanyCategory | null
    }
  | { id: number; type: 'round-won'; roundId: string }
  | { id: number; type: 'player-defeated'; roundId: string }
  | { id: number; type: 'round-ready' }

export type ResourceSnakeEffect =
  | {
      id: number
      type: 'request-resource-reward'
      rewardKey: string
      roundId: string
      enemyId: SnakeId
      blockId: string
    }

export interface ResourceSnakeRoundState {
  roundId: string | null
  watchers: SnakeWatcher[]
  phase: SnakeRoundPhase
  simulationMs: number
  accumulatorMs: number
  resolvingMs: number
  input: ResourceSnakeInputState
  player: SnakeActor
  enemies: SnakeActor[]
  events: ResourceSnakeEvent[]
  effects: ResourceSnakeEffect[]
  nextEventId: number
  nextEffectId: number
}

const zeroVector = (): SnakeVector => ({ x: 0, y: 0 })

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function distance(left: SnakeVector, right: SnakeVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function resourceSnakeRoundSpeedScale(simulationMs: number): number {
  if (simulationMs === Number.POSITIVE_INFINITY) {
    return RESOURCE_SNAKE_CONFIG.maximumRoundSpeedScale
  }
  const activeMs = Math.max(
    0,
    finite(simulationMs) - RESOURCE_SNAKE_CONFIG.deploymentMs,
  )
  const progress = clamp(activeMs / RESOURCE_SNAKE_CONFIG.speedRampMs, 0, 1)
  return RESOURCE_SNAKE_CONFIG.openingSpeedScale
    + (
      RESOURCE_SNAKE_CONFIG.maximumRoundSpeedScale
      - RESOURCE_SNAKE_CONFIG.openingSpeedScale
    ) * progress
}

function boundedPosition(position: SnakeVector): SnakeVector {
  return {
    x: clamp(
      finite(position.x),
      RESOURCE_SNAKE_CONFIG.headRadius,
      RESOURCE_SNAKE_CONFIG.fieldWidth - RESOURCE_SNAKE_CONFIG.headRadius,
    ),
    y: clamp(
      finite(position.y),
      RESOURCE_SNAKE_CONFIG.headRadius,
      RESOURCE_SNAKE_CONFIG.fieldHeight - RESOURCE_SNAKE_CONFIG.headRadius,
    ),
  }
}

const ANGLE_DIRECTIONS = Object.freeze([
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
] as const satisfies readonly SnakeDirection8[])

interface ResolvedMotionCommand {
  heading: SnakeDirection8
  speedScale: number
}

function resolveMotionCommand(
  currentHeading: SnakeDirection8,
  command: SnakeVector | undefined,
  allowRecoverySpeedScale: boolean,
): ResolvedMotionCommand {
  if (
    command === undefined
    || !Number.isFinite(command.x)
    || !Number.isFinite(command.y)
  ) return { heading: currentHeading, speedScale: 1 }

  const magnitude = Math.hypot(command.x, command.y)
  if (magnitude <= 1e-9) return { heading: currentHeading, speedScale: 1 }
  const rawIndex = Math.round(Math.atan2(command.y, command.x) / (Math.PI / 4))
  const directionIndex = ((rawIndex % 8) + 8) % 8
  const requestedHeading = ANGLE_DIRECTIONS[directionIndex]
  const currentVector = SNAKE_DIRECTION_VECTORS[currentHeading]
  const requestedVector = SNAKE_DIRECTION_VECTORS[requestedHeading]
  const exactReverse = (
    currentVector.x * requestedVector.x + currentVector.y * requestedVector.y
  ) < -0.999_999
  if (exactReverse) return { heading: currentHeading, speedScale: 1 }
  return {
    heading: requestedHeading,
    speedScale: allowRecoverySpeedScale
      ? clamp(magnitude, RESOURCE_SNAKE_CONFIG.minimumLiveSpeedScale, 1)
      : 1,
  }
}

function appendRailTurn(
  vertices: readonly SnakeVector[],
  point: SnakeVector,
): SnakeVector[] {
  const next = vertices.map((vertex) => ({ ...vertex }))
  const last = next.at(-1)
  if (last && distance(last, point) <= 1e-9) return next
  if (next.length >= 2) {
    const before = next[next.length - 2]
    const middle = next[next.length - 1]
    const first = { x: middle.x - before.x, y: middle.y - before.y }
    const second = { x: point.x - middle.x, y: point.y - middle.y }
    const cross = first.x * second.y - first.y * second.x
    const dot = first.x * second.x + first.y * second.y
    if (Math.abs(cross) <= 1e-9 && dot >= 0) next.pop()
  }
  next.push({ ...point })
  return next.slice(-RESOURCE_SNAKE_CONFIG.maximumTrailDots)
}

function appendEvent(
  state: ResourceSnakeRoundState,
  event: Record<string, unknown> & { type: ResourceSnakeEvent['type'] },
): ResourceSnakeRoundState {
  const nextEvent = { ...event, id: state.nextEventId } as ResourceSnakeEvent
  return {
    ...state,
    events: [...state.events, nextEvent],
    nextEventId: state.nextEventId + 1,
  }
}

function createActor(
  id: SnakeId,
  kind: 'player' | 'enemy',
  position: SnakeVector,
  details?: Partial<SnakeActor>,
): SnakeActor {
  const safePosition = boundedPosition(position)
  const initialHeading: SnakeDirection8 = kind === 'player' ? 'north' : 'south'
  return {
    id,
    kind,
    category: null,
    reservedBlockId: null,
    rewardKey: null,
    reservationStatus: null,
    role: null,
    previousPosition: { ...safePosition },
    position: safePosition,
    heading: initialHeading,
    velocity: zeroVector(),
    integrity: 0,
    maximumIntegrity: 0,
    maximumSpeedPerSecond: RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    collisionGraceMs: 0,
    phase: 'spawning',
    trail: [],
    railVertices: [{ ...safePosition }],
    distanceSinceTrailDot: 0,
    nextTrailDotId: 1,
    enemyTurnGovernor: kind === 'enemy'
      ? {
          lastHeadingChangeAtMs: null,
          previousHeading: null,
          normalTurnAtMs: [],
          lastEmergencyTurnAtMs: null,
          lockedUntilMs: 0,
          lastTurnCause: null,
        }
      : null,
    ...details,
  }
}

export function createIdleResourceSnakeState(): ResourceSnakeRoundState {
  const spawn = {
    x: RESOURCE_SNAKE_CONFIG.fieldWidth / 2,
    y: RESOURCE_SNAKE_CONFIG.fieldHeight / 2,
  }
  return {
    roundId: null,
    watchers: [],
    phase: 'idle',
    simulationMs: 0,
    accumulatorMs: 0,
    resolvingMs: 0,
    input: createResourceSnakeInputState('north'),
    player: createActor('player', 'player', spawn, {
      integrity: RESOURCE_SNAKE_CONFIG.playerMaximumIntegrity,
      maximumIntegrity: RESOURCE_SNAKE_CONFIG.playerMaximumIntegrity,
      phase: 'active',
    }),
    enemies: [],
    events: [],
    effects: [],
    nextEventId: 1,
    nextEffectId: 1,
  }
}

export function deployResourceSnakeRound(
  state: ResourceSnakeRoundState,
  setup: SnakeRoundSetup,
): ResourceSnakeRoundState {
  const player = createActor('player', 'player', setup.playerSpawn, {
    integrity: RESOURCE_SNAKE_CONFIG.playerMaximumIntegrity,
    maximumIntegrity: RESOURCE_SNAKE_CONFIG.playerMaximumIntegrity,
    maximumSpeedPerSecond:
      setup.playerMaximumSpeedPerSecond ??
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    phase: 'spawning',
  })
  const enemies = setup.enemies.map((enemy) =>
    createActor(enemy.id, 'enemy', enemy.spawn, {
      category: enemy.category,
      reservedBlockId: enemy.reservedBlockId,
      rewardKey: enemy.rewardKey,
      reservationStatus: 'active',
      role: enemy.role,
      integrity: enemy.maximumIntegrity,
      maximumIntegrity: enemy.maximumIntegrity,
      maximumSpeedPerSecond: enemy.maximumSpeedPerSecond,
      phase: 'spawning',
    }),
  )
  const deployed: ResourceSnakeRoundState = {
    ...state,
    roundId: setup.roundId,
    watchers: createSnakeWatchers(setup.watcherCount ?? 0),
    phase: 'deploying',
    simulationMs: 0,
    accumulatorMs: 0,
    resolvingMs: 0,
    input: createResourceSnakeInputState('north'),
    player,
    enemies,
    events: [],
    effects: [],
    nextEventId: 1,
    nextEffectId: 1,
  }
  return appendEvent(deployed, {
    type: 'round-started',
    roundId: setup.roundId,
  })
}

const OPPOSITE_INPUT_HEADING: Readonly<Record<SnakeDirection8, SnakeDirection8>> =
  Object.freeze({
    north: 'south',
    'north-east': 'south-west',
    east: 'west',
    'south-east': 'north-west',
    south: 'north',
    'south-west': 'north-east',
    west: 'east',
    'north-west': 'south-east',
  })

function effectiveInputHeading(inputState: ResourceSnakeInputState): SnakeDirection8 {
  return inputState.queuedTurns.at(-1) ?? inputState.heading
}

function newlyQueuedHeading(
  before: ResourceSnakeInputState,
  after: ResourceSnakeInputState,
): SnakeDirection8 | null {
  if (after.queuedTurns.length <= before.queuedTurns.length) return null
  return after.queuedTurns.at(-1) ?? null
}

function appendQueuedTurnEvent(
  state: ResourceSnakeRoundState,
  heading: SnakeDirection8,
  inputAtMs: number,
): ResourceSnakeRoundState {
  return appendEvent(state, {
    type: 'snake-turn-queued',
    heading,
    inputAtMs,
    startedAtMs: state.simulationMs,
  })
}

export function flushResourceSnakeRuntimeChord(
  state: ResourceSnakeRoundState,
  timestampMs: number,
): ResourceSnakeRoundState {
  const before = state.input
  const after = flushResourceSnakeChord(before, timestampMs)
  if (after === before) return state
  let next = { ...state, input: after }
  const queued = newlyQueuedHeading(before, after)
  if (queued) return appendQueuedTurnEvent(next, queued, after.timestampMs)

  const pending = before.pendingChord
  if (!pending || after.pendingChord !== null) return next
  const effective = effectiveInputHeading(before)
  if (OPPOSITE_INPUT_HEADING[effective] === pending.direction) {
    next = appendEvent(next, {
      type: 'snake-turn-rejected',
      requestedHeading: pending.direction,
      reason: 'reverse',
      inputAtMs: after.timestampMs,
      startedAtMs: state.simulationMs,
    })
  } else if (before.queuedTurns.length >= 2) {
    next = appendEvent(next, {
      type: 'snake-turn-rejected',
      requestedHeading: pending.direction,
      reason: 'queue-full',
      inputAtMs: after.timestampMs,
      startedAtMs: state.simulationMs,
    })
  }
  return next
}

export function pressResourceSnakeRuntimeKey(
  state: ResourceSnakeRoundState,
  key: string,
  timestampMs: number,
  repeat = false,
): ResourceSnakeRoundState {
  let next = flushResourceSnakeRuntimeChord(state, timestampMs)
  const before = next.input
  const after = pressResourceSnakeKey(before, key, timestampMs, repeat)
  if (after === before) return next
  next = { ...next, input: after }
  const queued = newlyQueuedHeading(before, after)
  return queued
    ? appendQueuedTurnEvent(next, queued, after.timestampMs)
    : next
}

export function releaseResourceSnakeRuntimeKey(
  state: ResourceSnakeRoundState,
  key: string,
): ResourceSnakeRoundState {
  const inputState = releaseResourceSnakeKey(state.input, key)
  return inputState === state.input ? state : { ...state, input: inputState }
}

export function resetResourceSnakeRuntimeInput(
  state: ResourceSnakeRoundState,
): ResourceSnakeRoundState {
  const inputState = resetPressedSnakeKeys(state.input)
  return inputState === state.input ? state : { ...state, input: inputState }
}

function sampleTrail(
  actor: SnakeActor,
  previousPosition: SnakeVector,
  position: SnakeVector,
  simulationMs: number,
): SnakeActor {
  const traveled = distance(previousPosition, position)
  if (traveled === 0) {
    return {
      ...actor,
      previousPosition: { ...previousPosition },
      trail: actor.trail.filter((dot) => dot.expiresAtMs > simulationMs),
    }
  }

  let distanceSinceDot = actor.distanceSinceTrailDot + traveled
  const trail = actor.trail.filter((dot) => dot.expiresAtMs > simulationMs)
  const direction = {
    x: (position.x - previousPosition.x) / traveled,
    y: (position.y - previousPosition.y) / traveled,
  }
  let traveledFromStart = 0
  let nextTrailDotId = actor.nextTrailDotId
  while (distanceSinceDot >= RESOURCE_SNAKE_CONFIG.trailSpacing) {
    const distanceToDot = RESOURCE_SNAKE_CONFIG.trailSpacing - (distanceSinceDot - traveled)
    traveledFromStart = Math.max(traveledFromStart, distanceToDot)
    const dotPosition = {
      x: previousPosition.x + direction.x * traveledFromStart,
      y: previousPosition.y + direction.y * traveledFromStart,
    }
    trail.push({
      id: nextTrailDotId,
      position: dotPosition,
      spawnedAtMs: simulationMs,
      expiresAtMs: simulationMs + RESOURCE_SNAKE_CONFIG.trailLifetimeMs,
    })
    nextTrailDotId += 1
    distanceSinceDot -= RESOURCE_SNAKE_CONFIG.trailSpacing
  }
  const cappedTrail = trail.slice(-RESOURCE_SNAKE_CONFIG.maximumTrailDots)
  return {
    ...actor,
    previousPosition: { ...previousPosition },
    trail: cappedTrail,
    distanceSinceTrailDot: distanceSinceDot,
    nextTrailDotId,
  }
}

function advanceActor(
  actor: SnakeActor,
  command: SnakeVector | undefined,
  stepMs: number,
  simulationMs: number,
  allowRecoverySpeedScale: boolean,
): SnakeActor {
  const resolved = resolveMotionCommand(
    actor.heading,
    command,
    allowRecoverySpeedScale,
  )
  const headingVector = SNAKE_DIRECTION_VECTORS[resolved.heading]
  const speed = actor.maximumSpeedPerSecond
    * resolved.speedScale
    * resourceSnakeRoundSpeedScale(simulationMs)
  const velocity = {
    x: headingVector.x * speed,
    y: headingVector.y * speed,
  }
  const previousPosition = { ...actor.position }
  const railVertices = resolved.heading === actor.heading
    ? actor.railVertices
    : appendRailTurn(actor.railVertices, previousPosition)
  const proposedPosition = {
    x: actor.position.x + velocity.x * (stepMs / 1000),
    y: actor.position.y + velocity.y * (stepMs / 1000),
  }
  const position = boundedPosition(proposedPosition)
  return sampleTrail(
    {
      ...actor,
      heading: resolved.heading,
      position,
      railVertices,
      velocity,
      phase: 'active',
    },
    previousPosition,
    position,
    simulationMs,
  )
}

type CollisionKind = 'boundary' | 'head-head' | 'trail' | 'watcher'

interface CollisionCandidate {
  kind: CollisionKind
  contactTime: number
  actorIds: SnakeId[]
  deterministicKey: string
  point: SnakeVector
  normal: SnakeVector
  anchor: SnakeVector
  separationDistance: number
  gapActorIds: SnakeId[]
  obstacleOwnerId?: SnakeId
}

function interpolate(start: SnakeVector, end: SnakeVector, time: number): SnakeVector {
  return {
    x: start.x + (end.x - start.x) * time,
    y: start.y + (end.y - start.y) * time,
  }
}

function sweptCircleTime(
  start: SnakeVector,
  end: SnakeVector,
  center: SnakeVector,
  radius: number,
): number | null {
  const offset = { x: start.x - center.x, y: start.y - center.y }
  const delta = { x: end.x - start.x, y: end.y - start.y }
  const a = delta.x * delta.x + delta.y * delta.y
  const c = offset.x * offset.x + offset.y * offset.y - radius * radius
  if (c <= 0) return 0
  if (a === 0) return null
  const b = 2 * (offset.x * delta.x + offset.y * delta.y)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const time = (-b - Math.sqrt(discriminant)) / (2 * a)
  return time >= 0 && time <= 1 ? time : null
}

function pointSegmentDistance(
  point: SnakeVector,
  start: SnakeVector,
  end: SnakeVector,
): number {
  const delta = { x: end.x - start.x, y: end.y - start.y }
  const lengthSquared = delta.x * delta.x + delta.y * delta.y
  if (lengthSquared <= 1e-12) return distance(point, start)
  const projection = clamp(
    (
      (point.x - start.x) * delta.x
      + (point.y - start.y) * delta.y
    ) / lengthSquared,
    0,
    1,
  )
  return distance(point, {
    x: start.x + delta.x * projection,
    y: start.y + delta.y * projection,
  })
}

interface EnemyHeadingSafety {
  heading: SnakeDirection8
  collisionAtMs: number
  clearance: number
  requestedDistance: number
  currentDistance: number
  directionIndex: number
}

function headingDistance(left: SnakeDirection8, right: SnakeDirection8): number {
  const leftIndex = ANGLE_DIRECTIONS.indexOf(left)
  const rightIndex = ANGLE_DIRECTIONS.indexOf(right)
  const direct = Math.abs(leftIndex - rightIndex)
  return Math.min(direct, ANGLE_DIRECTIONS.length - direct)
}

function enemyHeadingSafety(
  state: ResourceSnakeRoundState,
  actor: SnakeActor,
  heading: SnakeDirection8,
  requestedHeading: SnakeDirection8,
  horizonMs: number = RESOURCE_SNAKE_CONFIG.enemySafetyHorizonMs,
): EnemyHeadingSafety {
  const direction = SNAKE_DIRECTION_VECTORS[heading]
  const speed = actor.maximumSpeedPerSecond
    * resourceSnakeRoundSpeedScale(state.simulationMs)
  const start = actor.position
  const end = {
    x: start.x + direction.x * speed * horizonMs / 1_000,
    y: start.y + direction.y * speed * horizonMs / 1_000,
  }
  const protectedHeadRadius = RESOURCE_SNAKE_CONFIG.headRadius
    + RESOURCE_SNAKE_CONFIG.enemySafetyClearance
  const minimumX = protectedHeadRadius
  const maximumX = RESOURCE_SNAKE_CONFIG.fieldWidth - protectedHeadRadius
  const minimumY = protectedHeadRadius
  const maximumY = RESOURCE_SNAKE_CONFIG.fieldHeight - protectedHeadRadius
  let collisionAtMs = Number.POSITIVE_INFINITY

  const boundaryContact = (
    startAxis: number,
    endAxis: number,
    boundary: number,
    outsideDirection: -1 | 1,
  ) => {
    if (Math.abs(endAxis - startAxis) <= 1e-12) return
    if (
      (outsideDirection < 0 && startAxis <= boundary && endAxis < startAxis)
      || (outsideDirection > 0 && startAxis >= boundary && endAxis > startAxis)
    ) {
      collisionAtMs = 0
      return
    }
    const fraction = (boundary - startAxis) / (endAxis - startAxis)
    if (fraction >= 0 && fraction <= 1) {
      collisionAtMs = Math.min(collisionAtMs, fraction * horizonMs)
    }
  }
  if (end.x < minimumX) boundaryContact(start.x, end.x, minimumX, -1)
  if (end.x > maximumX) boundaryContact(start.x, end.x, maximumX, 1)
  if (end.y < minimumY) boundaryContact(start.y, end.y, minimumY, -1)
  if (end.y > maximumY) boundaryContact(start.y, end.y, maximumY, 1)

  let clearance = Math.min(
    end.x - minimumX,
    maximumX - end.x,
    end.y - minimumY,
    maximumY - end.y,
  )
  const physicalTrailRadius = RESOURCE_SNAKE_CONFIG.headRadius
    + RESOURCE_SNAKE_CONFIG.trailRadius
  for (const owner of [state.player, ...state.enemies]) {
    if (owner.phase !== 'active') continue
    for (const dot of owner.trail) {
      if (dot.spawnedAtMs >= state.simulationMs || dot.expiresAtMs <= state.simulationMs) {
        continue
      }
      const ownTrail = owner.id === actor.id
      const trailRadius = physicalTrailRadius + (
        ownTrail
          ? RESOURCE_SNAKE_CONFIG.enemySelfSafetyClearance
          : owner.kind === 'enemy'
            ? RESOURCE_SNAKE_CONFIG.enemyAllySafetyClearance
            : RESOURCE_SNAKE_CONFIG.enemySafetyClearance
      )
      const startOffset = {
        x: start.x - dot.position.x,
        y: start.y - dot.position.y,
      }
      const startDistance = Math.hypot(startOffset.x, startOffset.y)
      if (
        ownTrail
        && startDistance <= physicalTrailRadius
      ) continue
      const pathDelta = { x: end.x - start.x, y: end.y - start.y }
      const leavingSafetyReserve = (
        startDistance <= trailRadius
        && startDistance > physicalTrailRadius
        && startOffset.x * pathDelta.x + startOffset.y * pathDelta.y >= 0
      )
      const contact = sweptCircleTime(start, end, dot.position, trailRadius)
      if (contact !== null && !leavingSafetyReserve) {
        const contactAtMs = state.simulationMs + contact * horizonMs
        if (
          !ownTrail
          || contactAtMs - dot.spawnedAtMs >= RESOURCE_SNAKE_CONFIG.selfTrailIgnoreAgeMs
        ) collisionAtMs = Math.min(collisionAtMs, contact * horizonMs)
      }
      clearance = Math.min(
        clearance,
        pointSegmentDistance(dot.position, start, end) - trailRadius,
      )
    }
  }

  for (const other of [state.player, ...state.enemies]) {
    if (other.id === actor.id || other.phase !== 'active') continue
    const otherEnd = {
      x: other.position.x + other.velocity.x * horizonMs / 1_000,
      y: other.position.y + other.velocity.y * horizonMs / 1_000,
    }
    const headClearance = other.kind === 'enemy'
      ? RESOURCE_SNAKE_CONFIG.enemyAllySafetyClearance
      : RESOURCE_SNAKE_CONFIG.enemySafetyClearance
    const protectedRadius = RESOURCE_SNAKE_CONFIG.headRadius * 2 + headClearance
    const relativeStart = {
      x: start.x - other.position.x,
      y: start.y - other.position.y,
    }
    const relativeEnd = {
      x: end.x - otherEnd.x,
      y: end.y - otherEnd.y,
    }
    const contact = sweptCircleTime(
      relativeStart,
      relativeEnd,
      zeroVector(),
      protectedRadius,
    )
    if (contact !== null) collisionAtMs = Math.min(collisionAtMs, contact * horizonMs)
    clearance = Math.min(
      clearance,
      pointSegmentDistance(zeroVector(), relativeStart, relativeEnd) - protectedRadius,
    )
  }

  return {
    heading,
    collisionAtMs,
    clearance,
    requestedDistance: headingDistance(heading, requestedHeading),
    currentDistance: headingDistance(heading, actor.heading),
    directionIndex: ANGLE_DIRECTIONS.indexOf(heading),
  }
}

/** Deterministic heading probe shared by diagnostics and higher-level AI validation. */
export function evaluateResourceSnakeEnemyHeadingSafety(
  state: ResourceSnakeRoundState,
  actorId: SnakeId,
  heading: SnakeDirection8,
  horizonMs: number = RESOURCE_SNAKE_CONFIG.enemySafetyHorizonMs,
): Readonly<{ heading: SnakeDirection8; collisionAtMs: number; clearance: number }> | null {
  const actor = state.enemies.find((candidate) => candidate.id === actorId)
  if (!actor || actor.phase !== 'active') return null
  const safety = enemyHeadingSafety(state, actor, heading, heading, horizonMs)
  return {
    heading: safety.heading,
    collisionAtMs: safety.collisionAtMs,
    clearance: safety.clearance,
  }
}

interface EnemyDirectionDecision {
  direction: SnakeVector
  governor: SnakeEnemyTurnGovernorState
}

function enemyTurnGovernor(actor: SnakeActor): SnakeEnemyTurnGovernorState {
  return actor.enemyTurnGovernor ?? {
    lastHeadingChangeAtMs: null,
    previousHeading: null,
    normalTurnAtMs: [],
    lastEmergencyTurnAtMs: null,
    lockedUntilMs: 0,
    lastTurnCause: null,
  }
}

function minimumEnemyHeadingHoldMs(policy: SnakeEnemyTurnPolicy | undefined): number {
  const requested = policy?.minimumHeadingHoldMs
  if (!Number.isFinite(requested)) return RESOURCE_SNAKE_CONFIG.enemyMinimumHeadingHoldMs
  return clamp(requested!, RESOURCE_SNAKE_CONFIG.enemyMinimumHeadingHoldMs, 900)
}

function recentNormalEnemyTurns(
  governor: SnakeEnemyTurnGovernorState,
  atMs: number,
): number[] {
  return governor.normalTurnAtMs.filter((turnAtMs) => (
    Number.isFinite(turnAtMs)
    && atMs - turnAtMs < RESOURCE_SNAKE_CONFIG.enemyNormalTurnWindowMs - 1e-9
  )).slice(-RESOURCE_SNAKE_CONFIG.enemyMaximumNormalTurnsPerWindow)
}

function normalEnemyTurnAllowed(
  actor: SnakeActor,
  governor: SnakeEnemyTurnGovernorState,
  requestedHeading: SnakeDirection8,
  atMs: number,
  policy: SnakeEnemyTurnPolicy | undefined,
): boolean {
  if (requestedHeading === actor.heading) return false
  if (headingDistance(actor.heading, requestedHeading) > 2) return false
  if (atMs + 1e-9 < governor.lockedUntilMs) return false
  if (
    governor.lastHeadingChangeAtMs !== null
    && atMs - governor.lastHeadingChangeAtMs
      < minimumEnemyHeadingHoldMs(policy) - 1e-9
  ) return false
  if (
    recentNormalEnemyTurns(governor, atMs).length
    >= RESOURCE_SNAKE_CONFIG.enemyMaximumNormalTurnsPerWindow
  ) return false
  if (
    governor.previousHeading === requestedHeading
    && governor.lastHeadingChangeAtMs !== null
    && atMs - governor.lastHeadingChangeAtMs
      < RESOURCE_SNAKE_CONFIG.enemyReturnHeadingLockMs - 1e-9
  ) return false
  return true
}

function survivalImprovesByHysteresis(
  currentCollisionAtMs: number,
  candidateCollisionAtMs: number,
): boolean {
  if (candidateCollisionAtMs === Number.POSITIVE_INFINITY) {
    return currentCollisionAtMs !== Number.POSITIVE_INFINITY
  }
  if (currentCollisionAtMs === Number.POSITIVE_INFINITY) return false
  return candidateCollisionAtMs - currentCollisionAtMs
    >= RESOURCE_SNAKE_CONFIG.enemySafetyHysteresisMs - 1e-9
}

function compareEnemyHeadingSafety(
  left: EnemyHeadingSafety,
  right: EnemyHeadingSafety,
): number {
  return (
    Number(right.collisionAtMs === Number.POSITIVE_INFINITY)
      - Number(left.collisionAtMs === Number.POSITIVE_INFINITY)
    || right.collisionAtMs - left.collisionAtMs
    || right.clearance - left.clearance
    || left.requestedDistance - right.requestedDistance
    || left.currentDistance - right.currentDistance
    || left.directionIndex - right.directionIndex
  )
}

function applyEnemyTurn(
  actor: SnakeActor,
  governor: SnakeEnemyTurnGovernorState,
  cause: SnakeEnemyTurnCause,
  atMs: number,
  emergencyLockMs: number = RESOURCE_SNAKE_CONFIG.enemyEmergencyLockMs,
): SnakeEnemyTurnGovernorState {
  const emergencyTurn = cause !== 'normal'
  const normalTurnAtMs = cause === 'normal'
    ? [...recentNormalEnemyTurns(governor, atMs), atMs]
        .slice(-RESOURCE_SNAKE_CONFIG.enemyMaximumNormalTurnsPerWindow)
    : recentNormalEnemyTurns(governor, atMs)
  return {
    lastHeadingChangeAtMs: atMs,
    previousHeading: actor.heading,
    normalTurnAtMs,
    lastEmergencyTurnAtMs: emergencyTurn
      ? atMs
      : governor.lastEmergencyTurnAtMs,
    lockedUntilMs: emergencyTurn
      ? atMs + emergencyLockMs
      : governor.lockedUntilMs,
    lastTurnCause: cause,
  }
}

function enemyDirectionVector(
  heading: SnakeDirection8,
  speedScale: number,
): SnakeVector {
  const direction = SNAKE_DIRECTION_VECTORS[heading]
  return {
    x: direction.x * speedScale,
    y: direction.y * speedScale,
  }
}

function safeEnemyDirection(
  state: ResourceSnakeRoundState,
  actor: SnakeActor,
  command: SnakeVector | undefined,
  policy: SnakeEnemyTurnPolicy | undefined,
): EnemyDirectionDecision {
  const requested = resolveMotionCommand(actor.heading, command, true)
  const governor = enemyTurnGovernor(actor)
  const atMs = state.simulationMs
  const normalSafetyHorizonMs = Math.max(
    RESOURCE_SNAKE_CONFIG.enemySafetyHorizonMs,
    minimumEnemyHeadingHoldMs(policy) + RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs,
  )
  const currentSafety = enemyHeadingSafety(
    state,
    actor,
    actor.heading,
    requested.heading,
    normalSafetyHorizonMs,
  )
  const requestedSafety = enemyHeadingSafety(
    state,
    actor,
    requested.heading,
    requested.heading,
    normalSafetyHorizonMs,
  )
  const emergencyCooldownRemainingMs = governor.lastEmergencyTurnAtMs === null
    ? 0
    : Math.max(
        0,
        governor.lastEmergencyTurnAtMs
          + RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs
          - atMs,
      )
  const emergencyBridgeReactionMs = RESOURCE_SNAKE_CONFIG.fixedStepMs * 4
  const requestedBridgesEmergencyCooldown = (
    emergencyCooldownRemainingMs > 1e-9
    && currentSafety.collisionAtMs
      <= RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs + 1e-9
    && currentSafety.collisionAtMs
      <= emergencyCooldownRemainingMs + emergencyBridgeReactionMs + 1e-9
    && requestedSafety.collisionAtMs
      >= emergencyCooldownRemainingMs
        + emergencyBridgeReactionMs
        - 1e-9
    && survivalImprovesByHysteresis(
      currentSafety.collisionAtMs,
      requestedSafety.collisionAtMs,
    )
  )
  const minimumHoldMs = minimumEnemyHeadingHoldMs(policy)
  const elapsedSinceTurnMs = governor.lastHeadingChangeAtMs === null
    ? Number.POSITIVE_INFINITY
    : atMs - governor.lastHeadingChangeAtMs
  const remainingHoldMs = Math.max(0, minimumHoldMs - elapsedSinceTurnMs)
  const requestedIsAcceptable = requestedSafety.collisionAtMs
    >= normalSafetyHorizonMs - 1e-9
    || requestedBridgesEmergencyCooldown
  const currentClosesBeforeReadableHold = currentSafety.collisionAtMs
    <= remainingHoldMs + RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs + 1e-9
  const heldHeadingNeedsPlannerEscape = (
    elapsedSinceTurnMs < minimumHoldMs - 1e-9
    && currentClosesBeforeReadableHold
  )
  if (
    requestedIsAcceptable
    && normalEnemyTurnAllowed(actor, governor, requested.heading, atMs, policy)
  ) {
    return {
      direction: enemyDirectionVector(requested.heading, requested.speedScale),
      governor: applyEnemyTurn(actor, governor, 'normal', atMs),
    }
  }

  const emergencyImminent = (
    heldHeadingNeedsPlannerEscape
    || currentSafety.collisionAtMs
      <= RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs + 1e-9
  )
  const emergencyAvailable = (
    emergencyImminent
    && atMs + 1e-9 >= governor.lockedUntilMs
    && (
      governor.lastEmergencyTurnAtMs === null
      || atMs - governor.lastEmergencyTurnAtMs
      >= RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs - 1e-9
    )
  )
  const emergencyCorrectionAvailable = (
    emergencyImminent
    && governor.lastTurnCause === 'emergency'
    && governor.lastHeadingChangeAtMs !== null
    && atMs < governor.lockedUntilMs - 1e-9
    && atMs - governor.lastHeadingChangeAtMs
      >= RESOURCE_SNAKE_CONFIG.enemyEmergencyCorrectionHoldMs - 1e-9
  )
  const currentVector = SNAKE_DIRECTION_VECTORS[actor.heading]
  if (!emergencyAvailable && !emergencyCorrectionAvailable) {
    const ordinaryFallback = emergencyImminent
      ? ANGLE_DIRECTIONS
          .filter((heading) => {
            const direction = SNAKE_DIRECTION_VECTORS[heading]
            return heading !== actor.heading
              && currentVector.x * direction.x + currentVector.y * direction.y > -0.999_999
              && normalEnemyTurnAllowed(actor, governor, heading, atMs, policy)
          })
          .map((heading) => enemyHeadingSafety(
            state,
            actor,
            heading,
            requested.heading,
            normalSafetyHorizonMs,
          ))
          .filter((candidate) => (
            candidate.collisionAtMs >= normalSafetyHorizonMs - 1e-9
          ))
          .sort(compareEnemyHeadingSafety)[0]
      : undefined
    if (ordinaryFallback) {
      return {
        direction: enemyDirectionVector(ordinaryFallback.heading, requested.speedScale),
        governor: applyEnemyTurn(actor, governor, 'normal', atMs),
      }
    }
    return {
      direction: enemyDirectionVector(actor.heading, requested.speedScale),
      governor,
    }
  }

  const emergencyTurnLockMs = emergencyCorrectionAvailable
    ? minimumEnemyHeadingHoldMs(policy)
    : RESOURCE_SNAKE_CONFIG.enemyEmergencyLockMs
  // An emergency pivot resets the two-second emergency cooldown. Judge that
  // pivot through the point at which another emergency can actually execute;
  // the shorter lock-plus-trigger window can otherwise approve a lane that
  // becomes fatal while every emergency correction is still unavailable.
  const emergencyProtectedMs = Math.max(
    emergencyTurnLockMs + RESOURCE_SNAKE_CONFIG.enemyEmergencyCollisionMs,
    RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs
      + RESOURCE_SNAKE_CONFIG.fixedStepMs * 4,
  )
  const scoredEmergencyCandidates = ANGLE_DIRECTIONS
    .filter((heading) => {
      if (heading === actor.heading) return false
      const direction = SNAKE_DIRECTION_VECTORS[heading]
      if (currentVector.x * direction.x + currentVector.y * direction.y <= -0.999_999) {
        return false
      }
      const isEmergencyReturn = governor.previousHeading === heading
      if (emergencyCorrectionAvailable && isEmergencyReturn) return false
      return true
    })
    .map((heading) => enemyHeadingSafety(
      state,
      actor,
      heading,
      requested.heading,
      emergencyProtectedMs,
    ))
    .filter((candidate) => survivalImprovesByHysteresis(
      currentSafety.collisionAtMs,
      candidate.collisionAtMs,
    ))
  const emergencyReturnStillLocked = (
    !emergencyCorrectionAvailable
    && currentSafety.collisionAtMs
      > RESOURCE_SNAKE_CONFIG.enemyEmergencyReturnCollisionMs + 1e-9
  )
  const blockedEmergencyReturn = emergencyReturnStillLocked
    ? scoredEmergencyCandidates.find((candidate) => (
        candidate.heading === governor.previousHeading
      ))
    : undefined
  const legalEmergencyCandidates = scoredEmergencyCandidates.filter((candidate) => (
    candidate.heading !== governor.previousHeading || !emergencyReturnStillLocked
  ))
  const bestLegalCollisionAtMs = legalEmergencyCandidates.reduce(
    (best, candidate) => Math.max(best, candidate.collisionAtMs),
    0,
  )
  if (
    blockedEmergencyReturn
    && blockedEmergencyReturn.collisionAtMs >= emergencyProtectedMs - 1e-9
    && bestLegalCollisionAtMs < emergencyProtectedMs - 1e-9
  ) {
    return {
      direction: enemyDirectionVector(actor.heading, requested.speedScale),
      governor,
    }
  }
  const narrowCandidates = legalEmergencyCandidates.filter((candidate) => (
    headingDistance(actor.heading, candidate.heading) <= 2
    || (
      governor.previousHeading === candidate.heading
      && currentSafety.collisionAtMs
        <= RESOURCE_SNAKE_CONFIG.enemyEmergencyReturnCollisionMs + 1e-9
    )
  ))
  const narrowProtected = narrowCandidates.some((candidate) => (
    candidate.collisionAtMs >= emergencyProtectedMs - 1e-9
  ))
  const protectedWideCandidates = legalEmergencyCandidates.filter((candidate) => (
    !emergencyCorrectionAvailable
    && state.enemies.filter((enemy) => enemy.phase === 'active').length === 1
    && headingDistance(actor.heading, candidate.heading) > 2
    && candidate.collisionAtMs >= emergencyProtectedMs - 1e-9
  ))
  const candidates = (
    narrowProtected
      ? narrowCandidates
      : protectedWideCandidates.length > 0
        ? protectedWideCandidates
        : narrowCandidates
  ).sort(compareEnemyHeadingSafety)
  const selected = candidates[0]?.heading
  if (!selected) {
    return {
      direction: enemyDirectionVector(actor.heading, requested.speedScale),
      governor,
    }
  }
  return {
    direction: enemyDirectionVector(selected, requested.speedScale),
    governor: applyEnemyTurn(
      actor,
      governor,
      emergencyCorrectionAvailable ? 'emergency-correction' : 'emergency',
      atMs,
      emergencyTurnLockMs,
    ),
  }
}

function normalizedOrFallback(vector: SnakeVector, fallback: SnakeVector): SnakeVector {
  const length = Math.hypot(vector.x, vector.y)
  return length === 0 ? fallback : { x: vector.x / length, y: vector.y / length }
}

function activeActors(state: ResourceSnakeRoundState): SnakeActor[] {
  return [state.player, ...state.enemies].filter((actor) => actor.phase === 'active')
}

function trailCandidates(
  state: ResourceSnakeRoundState,
  simulationMs: number,
  stepMs: number,
): CollisionCandidate[] {
  const candidates: CollisionCandidate[] = []
  const actors = activeActors(state)
  const segmentStartMs = simulationMs - stepMs
  for (const actor of actors) {
    if (actor.collisionGraceMs > 0) continue
    for (const owner of actors) {
      for (const dot of owner.trail) {
        if (dot.spawnedAtMs >= simulationMs) continue
        const collisionRadius = (
          RESOURCE_SNAKE_CONFIG.headRadius + RESOURCE_SNAKE_CONFIG.trailRadius
        )
        const hazardStartsAtMs = Math.max(
          segmentStartMs,
          owner.id === actor.id
            ? dot.spawnedAtMs + RESOURCE_SNAKE_CONFIG.selfTrailIgnoreAgeMs
            : dot.spawnedAtMs,
        )
        if (hazardStartsAtMs >= simulationMs - 1e-9) continue
        const hazardStartFraction = clamp(
          (hazardStartsAtMs - segmentStartMs) / stepMs,
          0,
          1,
        )
        const hazardStartPosition = interpolate(
          actor.previousPosition,
          actor.position,
          hazardStartFraction,
        )
        // Collision means entering an already hazardous own trail. If a dot
        // matures underneath the head, or the head began this step inside it,
        // let the head exit before a later re-entry can deal damage.
        if (
          owner.id === actor.id
          && distance(hazardStartPosition, dot.position) <= collisionRadius
        ) continue
        const localContactTime = sweptCircleTime(
          hazardStartPosition,
          actor.position,
          dot.position,
          collisionRadius,
        )
        if (localContactTime === null) continue
        const contactTime = hazardStartFraction
          + (1 - hazardStartFraction) * localContactTime
        const point = interpolate(actor.previousPosition, actor.position, contactTime)
        candidates.push({
          kind: 'trail',
          contactTime,
          actorIds: [actor.id],
          deterministicKey: `${actor.id}|${owner.id}|${dot.id.toString().padStart(10, '0')}`,
          point,
          normal: normalizedOrFallback(
            { x: point.x - dot.position.x, y: point.y - dot.position.y },
            normalizedOrFallback(actor.velocity, { x: -1, y: 0 }),
          ),
          anchor: dot.position,
          separationDistance: RESOURCE_SNAKE_CONFIG.headRadius + RESOURCE_SNAKE_CONFIG.trailRadius + 0.04,
          gapActorIds: [owner.id],
          obstacleOwnerId: owner.id,
        })
      }
    }
  }
  return candidates
}

function headHeadCandidates(state: ResourceSnakeRoundState): CollisionCandidate[] {
  const actors = activeActors(state)
  const candidates: CollisionCandidate[] = []
  for (let leftIndex = 0; leftIndex < actors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < actors.length; rightIndex += 1) {
      const left = actors[leftIndex]
      const right = actors[rightIndex]
      if (left.collisionGraceMs > 0 && right.collisionGraceMs > 0) continue
      const relativeStart = {
        x: left.previousPosition.x - right.previousPosition.x,
        y: left.previousPosition.y - right.previousPosition.y,
      }
      const relativeEnd = {
        x: left.position.x - right.position.x,
        y: left.position.y - right.position.y,
      }
      const contactTime = sweptCircleTime(
        relativeStart,
        relativeEnd,
        zeroVector(),
        RESOURCE_SNAKE_CONFIG.headRadius * 2,
      )
      if (contactTime === null) continue
      const leftPoint = interpolate(left.previousPosition, left.position, contactTime)
      const rightPoint = interpolate(right.previousPosition, right.position, contactTime)
      const [first, second] = [left, right].sort((firstActor, secondActor) => (
        firstActor.id.localeCompare(secondActor.id)
      ))
      const firstPoint = first.id === left.id ? leftPoint : rightPoint
      const secondPoint = second.id === right.id ? rightPoint : leftPoint
      candidates.push({
        kind: 'head-head',
        contactTime,
        actorIds: [first.id, second.id],
        deterministicKey: `${first.id}|${second.id}`,
        point: { x: (leftPoint.x + rightPoint.x) / 2, y: (leftPoint.y + rightPoint.y) / 2 },
        normal: normalizedOrFallback(
          { x: firstPoint.x - secondPoint.x, y: firstPoint.y - secondPoint.y },
          normalizedOrFallback(first.velocity, { x: -1, y: 0 }),
        ),
        anchor: zeroVector(),
        separationDistance: RESOURCE_SNAKE_CONFIG.headRadius * 2 + 0.04,
        gapActorIds: [first.id, second.id],
      })
    }
  }
  return candidates
}

function boundaryCandidates(state: ResourceSnakeRoundState, stepMs: number): CollisionCandidate[] {
  const candidates: CollisionCandidate[] = []
  const minimumX = RESOURCE_SNAKE_CONFIG.headRadius
  const maximumX = RESOURCE_SNAKE_CONFIG.fieldWidth - RESOURCE_SNAKE_CONFIG.headRadius
  const minimumY = RESOURCE_SNAKE_CONFIG.headRadius
  const maximumY = RESOURCE_SNAKE_CONFIG.fieldHeight - RESOURCE_SNAKE_CONFIG.headRadius
  for (const actor of activeActors(state)) {
    if (actor.collisionGraceMs > 0) continue
    const rawEnd = {
      x: actor.previousPosition.x + actor.velocity.x * (stepMs / 1000),
      y: actor.previousPosition.y + actor.velocity.y * (stepMs / 1000),
    }
    const axisContacts: Array<{ time: number; normal: SnakeVector; anchor: SnakeVector }> = []
    if (rawEnd.x < minimumX && actor.previousPosition.x >= minimumX) {
      axisContacts.push({ time: (minimumX - actor.previousPosition.x) / (rawEnd.x - actor.previousPosition.x), normal: { x: 1, y: 0 }, anchor: { x: minimumX, y: actor.previousPosition.y } })
    }
    if (rawEnd.x > maximumX && actor.previousPosition.x <= maximumX) {
      axisContacts.push({ time: (maximumX - actor.previousPosition.x) / (rawEnd.x - actor.previousPosition.x), normal: { x: -1, y: 0 }, anchor: { x: maximumX, y: actor.previousPosition.y } })
    }
    if (rawEnd.y < minimumY && actor.previousPosition.y >= minimumY) {
      axisContacts.push({ time: (minimumY - actor.previousPosition.y) / (rawEnd.y - actor.previousPosition.y), normal: { x: 0, y: 1 }, anchor: { x: actor.previousPosition.x, y: minimumY } })
    }
    if (rawEnd.y > maximumY && actor.previousPosition.y <= maximumY) {
      axisContacts.push({ time: (maximumY - actor.previousPosition.y) / (rawEnd.y - actor.previousPosition.y), normal: { x: 0, y: -1 }, anchor: { x: actor.previousPosition.x, y: maximumY } })
    }
    for (const contact of axisContacts) {
      const point = interpolate(actor.previousPosition, rawEnd, contact.time)
      candidates.push({
        kind: 'boundary',
        contactTime: contact.time,
        actorIds: [actor.id],
        deterministicKey: actor.id,
        point,
        normal: contact.normal,
        anchor: point,
        separationDistance: 0.04,
        gapActorIds: [actor.id],
      })
    }
  }
  return candidates
}

function updateActor(state: ResourceSnakeRoundState, actor: SnakeActor): ResourceSnakeRoundState {
  return actor.id === 'player'
    ? { ...state, player: actor }
    : { ...state, enemies: state.enemies.map((enemy) => enemy.id === actor.id ? actor : enemy) }
}

function actorById(state: ResourceSnakeRoundState, actorId: SnakeId): SnakeActor {
  return actorId === 'player'
    ? state.player
    : state.enemies.find((enemy) => enemy.id === actorId) as SnakeActor
}

function appendEffect(
  state: ResourceSnakeRoundState,
  effect: Omit<ResourceSnakeEffect, 'id'>,
): ResourceSnakeRoundState {
  return {
    ...state,
    effects: [...state.effects, { ...effect, id: state.nextEffectId }],
    nextEffectId: state.nextEffectId + 1,
  }
}

function watcherCandidates(
  state: ResourceSnakeRoundState,
  strikes: readonly SnakeWatcherStrike[],
): CollisionCandidate[] {
  return strikes.map((strike) => {
    const away = normalizedOrFallback(
      {
        x: state.player.position.x - strike.point.x,
        y: state.player.position.y - strike.point.y,
      },
      normalizedOrFallback(state.player.velocity, { x: 0, y: -1 }),
    )
    return {
      kind: 'watcher' as const,
      contactTime: 1,
      actorIds: ['player' as SnakeId],
      deterministicKey: `player|${strike.watcherId}`,
      point: { ...strike.point },
      normal: away,
      anchor: { ...strike.point },
      separationDistance: RESOURCE_SNAKE_CONFIG.headRadius + 0.5,
      gapActorIds: ['player' as SnakeId],
    }
  })
}

function resolveCollisions(
  state: ResourceSnakeRoundState,
  stepMs: number,
  watcherStrikes: readonly SnakeWatcherStrike[] = [],
): ResourceSnakeRoundState {
  const candidates = [
    ...boundaryCandidates(state, stepMs),
    ...headHeadCandidates(state),
    ...trailCandidates(state, state.simulationMs, stepMs),
    ...watcherCandidates(state, watcherStrikes),
  ].sort((left, right) => (
    left.contactTime - right.contactTime
    || left.kind.localeCompare(right.kind)
    || left.deterministicKey.localeCompare(right.deterministicKey)
  ))
  let next = state
  for (const candidate of candidates) {
    const damagedIds = candidate.actorIds.filter((actorId) => {
      const actor = actorById(next, actorId)
      return actor.phase === 'active' && actor.collisionGraceMs <= 0
    })
    if (damagedIds.length === 0) continue

    next = appendEvent(next, {
      type: 'snake-collided',
      actorIds: [...candidate.actorIds],
      collisionKind: candidate.kind,
      obstacleOwnerId: candidate.obstacleOwnerId,
      point: candidate.point,
      hitStopMs: RESOURCE_SNAKE_CONFIG.hitStopMs,
      startedAtMs: next.simulationMs,
    })
    for (const gapActorId of candidate.gapActorIds) {
      const actor = actorById(next, gapActorId)
      next = updateActor(next, {
        ...actor,
        trail: actor.trail.filter((dot) => distance(dot.position, candidate.point) > RESOURCE_SNAKE_CONFIG.collisionGapRadius),
      })
    }

    if (candidate.kind === 'head-head') {
      const [leftId, rightId] = candidate.actorIds
      const left = actorById(next, leftId)
      const right = actorById(next, rightId)
      const halfDistance = candidate.separationDistance / 2
      next = updateActor(next, {
        ...left,
        position: boundedPosition({
          x: candidate.point.x + candidate.normal.x * halfDistance,
          y: candidate.point.y + candidate.normal.y * halfDistance,
        }),
      })
      next = updateActor(next, {
        ...right,
        position: boundedPosition({
          x: candidate.point.x - candidate.normal.x * halfDistance,
          y: candidate.point.y - candidate.normal.y * halfDistance,
        }),
      })
    } else {
      for (const actorId of damagedIds) {
        const actor = actorById(next, actorId)
        next = updateActor(next, {
          ...actor,
          position: boundedPosition({
            x: candidate.anchor.x + candidate.normal.x * candidate.separationDistance,
            y: candidate.anchor.y + candidate.normal.y * candidate.separationDistance,
          }),
        })
      }
    }

    for (const actorId of damagedIds) {
      const actor = actorById(next, actorId)
      const integrity = Math.max(0, actor.integrity - RESOURCE_SNAKE_CONFIG.damagePerCollision)
      const enemyTurnGovernor = actor.kind === 'enemy' && actor.enemyTurnGovernor
        ? {
            ...actor.enemyTurnGovernor,
            lastEmergencyTurnAtMs: null,
            lockedUntilMs: next.simulationMs,
          }
        : actor.enemyTurnGovernor
      next = updateActor(next, {
        ...actor,
        integrity,
        collisionGraceMs: RESOURCE_SNAKE_CONFIG.collisionGraceMs,
        enemyTurnGovernor,
      })
      next = appendEvent(next, {
        type: 'snake-damaged',
        actorId,
        integrity,
        maximumIntegrity: actor.maximumIntegrity,
      })
    }

    for (const actorId of damagedIds) {
      const actor = actorById(next, actorId)
      if (actor.integrity > 0) continue
      const died = {
        ...actor,
        phase: 'exploding' as const,
        reservationStatus: actor.kind === 'enemy' && actor.reservationStatus === 'active'
          ? 'pending' as const
          : actor.reservationStatus,
      }
      next = updateActor(next, died)
      next = appendEvent(next, {
        type: 'snake-died',
        actorId: died.id,
        category: died.category,
        startedAtMs: next.simulationMs,
      })
      if (
        died.kind === 'enemy'
        && actor.reservationStatus === 'active'
        && actor.rewardKey
        && actor.reservedBlockId
        && next.roundId
      ) {
        next = appendEffect(next, {
          type: 'request-resource-reward',
          rewardKey: actor.rewardKey,
          roundId: next.roundId,
          enemyId: actor.id,
          blockId: actor.reservedBlockId,
        })
      }
    }
  }

  const playerDied = next.player.phase === 'exploding' || next.player.phase === 'defeated'
  const allEnemiesDefeated = next.enemies.length > 0 && next.enemies.every(
    (enemy) => enemy.phase === 'exploding' || enemy.phase === 'defeated',
  )
  if (playerDied || allEnemiesDefeated) {
    next = { ...next, phase: 'resolving', resolvingMs: 0 }
    if (playerDied) {
      next = appendEvent(next, { type: 'player-defeated', roundId: next.roundId ?? '' })
    } else {
      next = {
        ...next,
        player: {
          ...next.player,
          phase: 'extracting',
          velocity: zeroVector(),
        },
      }
      next = appendEvent(next, {
        type: 'player-extracted',
        actorId: 'player',
        startedAtMs: next.simulationMs,
      })
      next = appendEvent(next, { type: 'round-won', roundId: next.roundId ?? '' })
    }
  }
  return next
}

function synchronizeInputHeading(
  input: ResourceSnakeInputState,
  heading: SnakeDirection8,
): ResourceSnakeInputState {
  if (input.heading === heading) return input
  return Object.freeze({ ...input, heading })
}

function scheduledEnemyDirection(
  input: SnakeFrameInput,
  enemyId: SnakeId,
  simulationMs: number,
): SnakeVector | undefined {
  let selected = input.enemyDirections?.[enemyId]
  let selectedAtMs = Number.NEGATIVE_INFINITY
  const schedule = input.enemyDirectionSchedules?.[enemyId]
  if (!Array.isArray(schedule)) return selected
  for (const change of schedule) {
    if (
      !change
      || !Number.isFinite(change.atMs)
      || change.atMs > simulationMs + FIXED_STEP_COMPARISON_EPSILON_MS
      || !Number.isFinite(change.direction?.x)
      || !Number.isFinite(change.direction?.y)
      || change.atMs < selectedAtMs
    ) continue
    selected = change.direction
    selectedAtMs = change.atMs
  }
  return selected
}

function advanceFixedStep(
  state: ResourceSnakeRoundState,
  input: SnakeFrameInput,
): ResourceSnakeRoundState {
  const stepMs = RESOURCE_SNAKE_CONFIG.fixedStepMs
  if (state.phase !== 'active') return { ...state, simulationMs: state.simulationMs + stepMs }

  const simulationMs = state.simulationMs + stepMs
  let playerInput = synchronizeInputHeading(state.input, state.player.heading)
  let player = state.player
  let committedTurn: SnakeDirection8 | null = null
  if (state.player.phase === 'active') {
    const consumed = consumeResourceSnakeTurn(playerInput)
    committedTurn = consumed.turn
    const playerDirection = consumed.turn === null
      ? input.playerDirection ?? input.playerIntent
      : SNAKE_DIRECTION_VECTORS[consumed.turn]
    player = advanceActor({
      ...state.player,
      collisionGraceMs: Math.max(0, state.player.collisionGraceMs - stepMs),
    }, playerDirection, stepMs, simulationMs, false)
    playerInput = synchronizeInputHeading(consumed.state, player.heading)
  }
  const enemies = state.enemies.map((enemy) => {
    if (enemy.phase !== 'active') return enemy
    const decision = safeEnemyDirection(
      state,
      enemy,
      scheduledEnemyDirection(input, enemy.id, state.simulationMs),
      input.enemyTurnPolicies?.[enemy.id],
    )
    return {
      ...advanceActor({
        ...enemy,
        collisionGraceMs: Math.max(0, enemy.collisionGraceMs - stepMs),
      }, decision.direction, stepMs, simulationMs, true),
      enemyTurnGovernor: decision.governor,
    }
  })
  let stepped: ResourceSnakeRoundState = {
    ...state,
    simulationMs,
    input: playerInput,
    player,
    enemies,
  }
  if (committedTurn !== null) {
    stepped = appendEvent(stepped, {
      type: 'snake-turn-committed',
      heading: committedTurn,
      inputAtMs: playerInput.timestampMs,
      startedAtMs: simulationMs,
    })
  }
  // Watchers move on their own clock and answer only to the intruder; their
  // strikes join the ordinary collision pass so damage, separation, grace,
  // and death all behave exactly as they do for a wall or a trail.
  const surveillance = advanceSnakeWatchers(
    stepped.watchers,
    stepped.player.position,
    stepped.player.velocity,
    stepped.player.phase === 'active',
    simulationMs,
    stepMs,
  )
  stepped = { ...stepped, watchers: surveillance.watchers }
  return resolveCollisions(stepped, stepMs, surveillance.strikes)
}

export function advanceResourceSnakeFrame(
  state: ResourceSnakeRoundState,
  input: SnakeFrameInput,
  deltaMs: number,
): ResourceSnakeRoundState {
  const safeDeltaMs = clamp(
    finite(deltaMs),
    0,
    RESOURCE_SNAKE_CONFIG.maximumFrameDeltaMs,
  )
  if (state.phase === 'resolving') {
    const resolvingMs = state.resolvingMs + safeDeltaMs
    if (resolvingMs >= RESOURCE_SNAKE_CONFIG.roundResolveMs) {
      return createIdleResourceSnakeState()
    }
    return {
      ...state,
      simulationMs: state.simulationMs + safeDeltaMs,
      resolvingMs,
    }
  }
  let next = { ...state, accumulatorMs: state.accumulatorMs + safeDeltaMs }

  if (next.phase === 'deploying') {
    const deploymentRemainingMs = Math.max(
      0,
      RESOURCE_SNAKE_CONFIG.deploymentMs - next.simulationMs,
    )
    if (next.accumulatorMs < deploymentRemainingMs) {
      return {
        ...next,
        simulationMs: next.simulationMs + next.accumulatorMs,
        accumulatorMs: 0,
      }
    }
    next = appendEvent(
      {
        ...next,
        phase: 'active',
        simulationMs: RESOURCE_SNAKE_CONFIG.deploymentMs,
        accumulatorMs: next.accumulatorMs - deploymentRemainingMs,
        player: { ...next.player, phase: 'active' },
        enemies: next.enemies.map((enemy) => ({ ...enemy, phase: 'active' })),
      },
      {
        type: 'round-ready',
      },
    )
  }

  while (
    next.phase === 'active'
    && next.accumulatorMs + FIXED_STEP_COMPARISON_EPSILON_MS
      >= RESOURCE_SNAKE_CONFIG.fixedStepMs
  ) {
    next = advanceFixedStep(next, input)
    next = {
      ...next,
      accumulatorMs: Math.max(0, next.accumulatorMs - RESOURCE_SNAKE_CONFIG.fixedStepMs),
    }
  }
  if (next.phase === 'resolving' && next.accumulatorMs > 0) {
    next = {
      ...next,
      resolvingMs: next.resolvingMs + next.accumulatorMs,
      accumulatorMs: 0,
    }
  }
  return next
}

export function resolveResourceSnakeReward(
  state: ResourceSnakeRoundState,
  rewardKey: string,
  outcome: {
    kind: 'success' | 'interrogation' | 'rejected' | 'cancelled'
    origin?: CompanyCategory
  },
): ResourceSnakeRoundState {
  const enemy = state.enemies.find((candidate) => candidate.rewardKey === rewardKey)
  if (!enemy || enemy.reservationStatus === 'resolved' || enemy.reservationStatus === 'cancelled') {
    return state
  }
  const reservationStatus = outcome.kind === 'cancelled' ? 'cancelled' as const : 'resolved' as const
  return appendEvent(updateActor(state, { ...enemy, reservationStatus }), {
    type: 'resource-reward-resolved',
    rewardKey,
    outcome: outcome.kind,
    category: outcome.origin ?? enemy.category,
  })
}

export function trailDotScale(dot: SnakeTrailDot, simulationMs: number): number {
  const remainingMs = dot.expiresAtMs - simulationMs
  if (remainingMs >= RESOURCE_SNAKE_CONFIG.trailShrinkMs) return 1
  return clamp(remainingMs / RESOURCE_SNAKE_CONFIG.trailShrinkMs, 0, 1)
}
