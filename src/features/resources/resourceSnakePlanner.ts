import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import type { SnakeEnemyRole, SnakeId, SnakeVector } from './resourceSnakeRuntime'

export type { SnakeEnemyRole, SnakeId, SnakeVector } from './resourceSnakeRuntime'

export type SnakeIntent =
  | 'observe'
  | 'pursue'
  | 'cutoff'
  | 'herd'
  | 'escape'
  | 'coordinate'
  | 'defeated'

export interface SnakePlannerActor {
  id: SnakeId
  position: SnakeVector
  velocity: SnakeVector
  integrity: number
  maximumIntegrity: number
  maximumSpeedPerSecond: number
  collisionGraceMs: number
  role: SnakeEnemyRole | null
}

export interface SnakePlannerTrailDot {
  id: number
  ownerId: SnakeId
  position: SnakeVector
  spawnedAtMs: number
  expiresAtMs: number
}

export interface SnakePlayerHistorySample {
  simulationMs: number
  position: SnakeVector
  velocity: SnakeVector
}

export interface SnakeCommittedPath {
  enemyId: SnakeId
  commitUntilMs: number
  samples: SnakeTimedPosition[]
}

export interface SnakePlannerSnapshot {
  simulationMs: number
  field: { width: 50; height: 24; padding: number }
  player: SnakePlannerActor
  enemies: SnakePlannerActor[]
  trailDots: SnakePlannerTrailDot[]
  playerHistory: SnakePlayerHistorySample[]
  committedAllyPaths: SnakeCommittedPath[]
}

export interface SnakePlanScore {
  survives: 0 | 1
  reachableArea: number
  allyClearance: number
  playerAreaReduction: number
  cutoffProgress: number
  pressureDistance: number
  steeringCost: number
}

export interface SnakeTrajectoryCandidate {
  candidateIndex: number
  speedScale: 0 | 0.5 | 1
  directions: SnakeVector[]
  path: SnakeVector[]
}

export interface SnakePlan {
  enemyId: SnakeId
  intent: SnakeIntent
  role: SnakeEnemyRole
  direction: SnakeVector
  speedScale: 0 | 0.5 | 1
  plannedAtMs: number
  commandAtMs: number
  stepMs: 50
  originPosition: SnakeVector
  originVelocity: SnakeVector
  originMaximumSpeedPerSecond: number
  directions: SnakeVector[]
  commitUntilMs: number
  path: SnakeVector[]
  score: SnakePlanScore
  candidateIndex: number
  evaluatedCandidates: number
  elapsedMs: number
  fallback: boolean
}

export interface SnakePlanSample {
  atMs: number
  cursor: number
  direction: SnakeVector
  speedScale: 0 | 0.5 | 1
  position: SnakeVector
  velocity: SnakeVector
}

export interface SnakeTimedPosition {
  atMs: number
  position: SnakeVector
}

export interface SnakePlayerHypotheses {
  keepVelocity: SnakeVector[]
  continueMedianTurn: SnakeVector[]
  decelerate: SnakeVector[]
  stayStopped: SnakeVector[]
  all: SnakeVector[][]
}

export const RESOURCE_SNAKE_GRID_SIZE = 0.75

/**
 * 270°/s is 13.5° per authoritative 50ms planner command. It prevents an
 * instantaneous reversal while allowing the runtime's 120ms acceleration
 * response to settle across several executable commands.
 */
export const RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND = Math.PI * 1.5

const RUNTIME_FIXED_STEP_MS = 1_000 / 120
const RUNTIME_ACCELERATION_MS = 120
const RUNTIME_DECELERATION_MS = 100
const SELF_TRAIL_IGNORE_MS = 240
const PLAYER_HEAD_CLEARANCE = 1.1
const TRAIL_COLLISION_RADIUS = 0.55
const ALLY_COLLISION_RADIUS = 0.75
const FUTURE_TRAIL_RADIUS = 0.42
const COMMIT_FATAL_OVERRIDE_MS = 180
const SPATIAL_CELL_SIZE = 1.5
// Navigation-only reserve: at 25% integrity this keeps roughly one grid cell
// beyond the fixed collision radius. It does not alter collision damage/rules.
const LOW_INTEGRITY_CLEARANCE_RESERVE = 1.75
const TWO_PI = Math.PI * 2
const EPSILON = 1e-9
const SPEED_SCALES = [1, 0.5, 0] as const
const INTENTS: readonly SnakeIntent[] = [
  'observe', 'pursue', 'cutoff', 'herd', 'escape', 'coordinate', 'defeated',
]
const MAX_SERIALIZED_TIMESTAMP_MS = 1_000_000_000
const MAX_PROFILE_LOOKAHEAD_MS = 2_500
// Reserve the maximum derived horizon. Every legal commitment is shorter than
// this horizon, so a snapshot accepted at this ceiling can produce and
// immediately reinject its complete canonical Task 5 occupancy without any
// timestamp crossing the single serialized bound.
const MAX_PLANNING_TIMESTAMP_MS = MAX_SERIALIZED_TIMESTAMP_MS
  - MAX_PROFILE_LOOKAHEAD_MS
const MAX_TRAIL_DOTS = 2_048
const MAX_HISTORY_SAMPLES = 512
const MAX_COMMITTED_PATHS = 8
// Numerical guardrail only: authoritative actors are far below this value.
// Bounding public candidate kinematics prevents finite IEEE-754 inputs from
// overflowing rollout products without adding a user-facing movement rule.
const MAX_ROLLOUT_SPEED_PER_SECOND = 100
const MAX_ROLLOUT_COORDINATE = 1_000_000
const LEGAL_PROFILE_TIERS = [
  [1_000, 420, 6],
  [1_400, 360, 7],
  [1_600, 320, 8],
  [2_000, 260, 9],
  [2_500, 220, 10],
] as const

interface InternalTrajectoryCandidate extends SnakeTrajectoryCandidate {
  rawPath: SnakeVector[]
  steeringCost: number
  bounds: PathBounds
  rawBounds: PathBounds
  localDirections?: readonly SnakeVector[]
  localRawPath?: readonly SnakeVector[]
  transformOrigin?: SnakeVector
  transformCosine?: number
  transformSine?: number
  transformField?: SnakePlannerSnapshot['field']
  materialized?: boolean
  segmentDurationsMs?: readonly number[]
  score: SnakePlanScore
}

type ScoredCandidate = InternalTrajectoryCandidate

interface RolloutResult {
  path: SnakeVector[]
  rawPath: SnakeVector[]
  velocity: SnakeVector
  position: SnakeVector
}

interface TrailSpatialIndex {
  columns: number
  rows: number
  bucketOffsets: Int32Array
  bucketDotIndices: Int32Array
  dots: readonly SnakePlannerTrailDot[]
  minimumX: number
  maximumX: number
  minimumY: number
  maximumY: number
}

interface PathBounds {
  minimumX: number
  maximumX: number
  minimumY: number
  maximumY: number
}

interface GridWorkspace {
  width: number
  height: number
  enemyBase: Uint8Array
  playerBase: Uint8Array
  occupancy: Uint8Array
  queue: Int32Array
  visitMarks: Uint32Array
  generation: number
  enemyLabels: Int32Array
  playerLabels: Int32Array
  enemyAreas: Int32Array
  playerAreas: Int32Array
  playerBaselineMemberships: Uint8Array[]
  singlePlayerBaselineComponent: number
  candidateCells: Int32Array
}

interface OccupancyBaseCache {
  trailIndex: TrailSpatialIndex
  fieldWidth: number
  fieldHeight: number
  fieldPadding: number
  enemyId: SnakeId
  playerId: SnakeId
  enemyMargin: number
  enemyCollisionGraceMs: number
  playerCollisionGraceMs: number
  horizonMs: number
  horizonOffsetMs: number
  trailValidityUntilMs: number
  hypothesisEndpoints: SnakeVector[]
  committedPoints: Array<SnakeVector | null>
  enemyBase: Uint8Array
  playerBase: Uint8Array
}

const gridWorkspacePool = new Map<string, GridWorkspace[]>()
const localTrajectoryTemplateCache = new Map<string, InternalTrajectoryCandidate[]>()
const trajectoryBufferPool = new Map<string, InternalTrajectoryCandidate[][]>()
const playerHypothesisPool = new Map<number, SnakePlayerHypotheses[]>()
interface PlayerBaseCacheRecord {
  id: number
  hash: number
  endpointCoordinates: number[]
  occupancy: Uint8Array
}
interface PlayerReductionCacheRecord {
  count: number
  cells: Int32Array
  value: number
}
interface PlayerReductionCacheSlot {
  records: PlayerReductionCacheRecord[]
  nextReplacement: number
}
const PLAYER_REDUCTION_PATTERNS_PER_CANDIDATE = 16
const playerBaseCacheRecords: PlayerBaseCacheRecord[] = []
const playerReductionCache = new Map<string, PlayerReductionCacheSlot>()
let nextPlayerBaseCacheId = 1
let cachedTrailIndex: TrailSpatialIndex | null = null
let cachedOccupancyBases: OccupancyBaseCache | null = null

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function denseArray(value: unknown, maximumLength: number): value is unknown[] {
  try {
    if (!Array.isArray(value) || value.length > maximumLength) return false
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return false
    }
    return true
  } catch {
    return false
  }
}

function finiteVector(vector: SnakeVector | null | undefined): vector is SnakeVector {
  try {
    return !!vector && finite(vector.x) && finite(vector.y)
  } catch {
    return false
  }
}

function rolloutKinematicsSafe(actor: SnakePlannerActor): boolean {
  try {
    return finiteVector(actor.position)
      && Math.abs(actor.position.x) <= MAX_ROLLOUT_COORDINATE
      && Math.abs(actor.position.y) <= MAX_ROLLOUT_COORDINATE
      && finiteVector(actor.velocity)
      && magnitude(actor.velocity) <= MAX_ROLLOUT_SPEED_PER_SECOND
      && finite(actor.maximumSpeedPerSecond)
      && actor.maximumSpeedPerSecond >= 0
      && actor.maximumSpeedPerSecond <= MAX_ROLLOUT_SPEED_PER_SECOND
  } catch {
    return false
  }
}

function coordinateVectorSafe(vector: SnakeVector): boolean {
  return finiteVector(vector)
    && Math.abs(vector.x) <= MAX_ROLLOUT_COORDINATE
    && Math.abs(vector.y) <= MAX_ROLLOUT_COORDINATE
}

function magnitude(vector: SnakeVector): number {
  return Math.hypot(vector.x, vector.y)
}

function distance(left: SnakeVector, right: SnakeVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function normalize(vector: SnakeVector, fallback: SnakeVector = { x: 0, y: 0 }): SnakeVector {
  const size = magnitude(vector)
  if (!finite(size) || size <= EPSILON) return { ...fallback }
  return { x: vector.x / size, y: vector.y / size }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function rounded(value: number): number {
  const result = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(result, -0) ? 0 : result
}

function signedAngleDifference(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function turnToward(current: number, target: number, maximumTurn: number): number {
  return current + clamp(signedAngleDifference(current, target), -maximumTurn, maximumTurn)
}

function approachVector(current: SnakeVector, target: SnakeVector, maximumDelta: number): SnakeVector {
  const dx = target.x - current.x
  const dy = target.y - current.y
  const size = Math.hypot(dx, dy)
  if (size <= maximumDelta || size <= EPSILON) return { ...target }
  const scale = maximumDelta / size
  return { x: current.x + dx * scale, y: current.y + dy * scale }
}

function actorHasInvalidNumber(actor: SnakePlannerActor | null | undefined): boolean {
  try {
    return !actor
      || typeof actor !== 'object'
      || !finiteVector(actor.position)
      || !finiteVector(actor.velocity)
      || !finite(actor.integrity)
      || !finite(actor.maximumIntegrity)
      || actor.maximumIntegrity < 0
      || !finite(actor.maximumSpeedPerSecond)
      || actor.maximumSpeedPerSecond < 0
      || !finite(actor.collisionGraceMs)
      || actor.collisionGraceMs < 0
      || actor.collisionGraceMs > MAX_SERIALIZED_TIMESTAMP_MS
      || !rolloutKinematicsSafe(actor)
  } catch {
    return true
  }
}

function profileIsValid(profile: SnakePlannerProfile): boolean {
  try {
    if (!profile || typeof profile !== 'object') return false
    return (profile.candidateCount === 48 || profile.candidateCount === 72 || profile.candidateCount === 96)
      && profile.rolloutStepMs === 50
      && LEGAL_PROFILE_TIERS.some(([lookaheadMs, commitMs, planningHz]) => (
        profile.lookaheadMs === lookaheadMs
        && profile.commitMs === commitMs
        && profile.planningHz === planningHz
      ))
  } catch {
    return false
  }
}

function relevantHistory(snapshot: SnakePlannerSnapshot): SnakePlayerHistorySample[] {
  const earliest = snapshot.simulationMs - 2_000
  return snapshot.playerHistory
    .filter((sample) => sample.simulationMs >= earliest && sample.simulationMs <= snapshot.simulationMs)
    .slice()
    .sort((left, right) => left.simulationMs - right.simulationMs)
}

function committedPathValid(path: unknown): path is SnakeCommittedPath {
  try {
    if (
      !path
      || typeof path !== 'object'
      || !finite((path as SnakeCommittedPath).commitUntilMs)
      || (path as SnakeCommittedPath).commitUntilMs < 0
      || (path as SnakeCommittedPath).commitUntilMs > MAX_SERIALIZED_TIMESTAMP_MS
      || !denseArray((path as SnakeCommittedPath).samples, 64)
      || (path as SnakeCommittedPath).samples.length < 2
    ) return false
    let priorMs = -Infinity
    const samples = (path as SnakeCommittedPath).samples
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]
      if (
        !sample
        || typeof sample !== 'object'
        || !finite(sample.atMs)
        || sample.atMs < 0
        || sample.atMs > MAX_SERIALIZED_TIMESTAMP_MS
        || sample.atMs <= priorMs
        || !coordinateVectorSafe(sample.position)
      ) return false
      priorMs = sample.atMs
    }
    return samples.at(-1)?.atMs === (path as SnakeCommittedPath).commitUntilMs
  } catch {
    return false
  }
}

function snapshotIsValid(value: unknown): value is SnakePlannerSnapshot {
  try {
    if (!value || typeof value !== 'object') return false
    const snapshot = value as SnakePlannerSnapshot
    if (
      !finite(snapshot.simulationMs)
      || snapshot.simulationMs < 0
      || snapshot.simulationMs > MAX_PLANNING_TIMESTAMP_MS
      || !snapshot.field
      || typeof snapshot.field !== 'object'
      || snapshot.field.width !== 50
      || snapshot.field.height !== 24
      || !finite(snapshot.field.padding)
      || snapshot.field.padding < 0
      || snapshot.field.padding > 4
      || !denseArray(snapshot.enemies, 2)
      || !denseArray(snapshot.trailDots, MAX_TRAIL_DOTS)
      || !denseArray(snapshot.playerHistory, MAX_HISTORY_SAMPLES)
      || !denseArray(snapshot.committedAllyPaths, MAX_COMMITTED_PATHS)
      || actorHasInvalidNumber(snapshot.player)
    ) return false
    for (let index = 0; index < snapshot.enemies.length; index += 1) {
      if (actorHasInvalidNumber(snapshot.enemies[index])) return false
    }
    for (let index = 0; index < snapshot.trailDots.length; index += 1) {
      const dot = snapshot.trailDots[index]
      if (
        !dot
        || typeof dot !== 'object'
        || !finite(dot.id)
        || !coordinateVectorSafe(dot.position)
        || !finite(dot.spawnedAtMs)
        || !finite(dot.expiresAtMs)
        || dot.spawnedAtMs < 0
        || dot.expiresAtMs > MAX_SERIALIZED_TIMESTAMP_MS
        || dot.expiresAtMs < dot.spawnedAtMs
      ) return false
    }
    for (let index = 0; index < snapshot.playerHistory.length; index += 1) {
      const sample = snapshot.playerHistory[index]
      if (
        !sample
        || typeof sample !== 'object'
        || !finite(sample.simulationMs)
        || sample.simulationMs < 0
        || sample.simulationMs > MAX_SERIALIZED_TIMESTAMP_MS
        || !coordinateVectorSafe(sample.position)
        || !finiteVector(sample.velocity)
        || magnitude(sample.velocity) > MAX_ROLLOUT_SPEED_PER_SECOND
      ) return false
    }
    for (let index = 0; index < snapshot.committedAllyPaths.length; index += 1) {
      if (!committedPathValid(snapshot.committedAllyPaths[index])) return false
    }
    return true
  } catch {
    return false
  }
}

function fallbackSnapshotFromUnknown(
  value: unknown,
  enemyId: SnakeId,
): { snapshot: SnakePlannerSnapshot; enemy: SnakePlannerActor } | null {
  try {
    if (!value || typeof value !== 'object') return null
    const source = value as SnakePlannerSnapshot
    if (
      !finite(source.simulationMs)
      || source.simulationMs < 0
      || source.simulationMs > MAX_PLANNING_TIMESTAMP_MS
      || !source.field
      || typeof source.field !== 'object'
      || source.field.width !== 50
      || source.field.height !== 24
      || !finite(source.field.padding)
      || source.field.padding < 0
      || source.field.padding > 4
      || !denseArray(source.enemies, 2)
      || !denseArray(source.trailDots, MAX_TRAIL_DOTS)
      || !denseArray(source.playerHistory, MAX_HISTORY_SAMPLES)
      || !denseArray(source.committedAllyPaths, MAX_COMMITTED_PATHS)
      || !source.player
      || typeof source.player !== 'object'
      || !finiteVector(source.player.position)
      || Math.abs(source.player.position.x) > MAX_ROLLOUT_COORDINATE
      || Math.abs(source.player.position.y) > MAX_ROLLOUT_COORDINATE
    ) return null
    let sourceEnemy: SnakePlannerActor | undefined
    for (let index = 0; index < source.enemies.length; index += 1) {
      const candidate = source.enemies[index]
      if (candidate?.id === enemyId) sourceEnemy = candidate
    }
    if (
      !sourceEnemy
      || typeof sourceEnemy !== 'object'
      || !finiteVector(sourceEnemy.position)
      || (finiteVector(sourceEnemy.velocity)
        && magnitude(sourceEnemy.velocity) > MAX_ROLLOUT_SPEED_PER_SECOND)
      || !finite(sourceEnemy.maximumSpeedPerSecond)
      || sourceEnemy.maximumSpeedPerSecond <= 0
      || sourceEnemy.maximumSpeedPerSecond > MAX_ROLLOUT_SPEED_PER_SECOND
      || Math.abs(sourceEnemy.position.x) > MAX_ROLLOUT_COORDINATE
      || Math.abs(sourceEnemy.position.y) > MAX_ROLLOUT_COORDINATE
    ) return null
    const sanitizeActor = (
      actor: SnakePlannerActor,
      id: SnakeId,
      role: SnakeEnemyRole | null,
    ): SnakePlannerActor => {
      const maximumIntegrity = finite(actor.maximumIntegrity) && actor.maximumIntegrity > 0
        ? actor.maximumIntegrity
        : 1
      return {
        id,
        position: { ...actor.position },
        velocity: finiteVector(actor.velocity) ? { ...actor.velocity } : { x: 0, y: 0 },
        integrity: finite(actor.integrity) ? clamp(actor.integrity, 0, maximumIntegrity) : maximumIntegrity,
        maximumIntegrity,
        maximumSpeedPerSecond: finite(actor.maximumSpeedPerSecond) && actor.maximumSpeedPerSecond >= 0
          ? actor.maximumSpeedPerSecond
          : 0,
        collisionGraceMs: finite(actor.collisionGraceMs)
          ? clamp(actor.collisionGraceMs, 0, MAX_SERIALIZED_TIMESTAMP_MS)
          : 0,
        role,
      }
    }
    const player = sanitizeActor(source.player, 'player', null)
    const enemy = sanitizeActor(
      sourceEnemy,
      enemyId,
      sourceEnemy.role === 'blocker' ? 'blocker' : 'pressure',
    )
    const trailDots: SnakePlannerTrailDot[] = []
    for (let index = 0; index < source.trailDots.length; index += 1) {
      const dot = source.trailDots[index]
      if (
        dot
        && typeof dot === 'object'
        && finite(dot.id)
        && coordinateVectorSafe(dot.position)
        && finite(dot.spawnedAtMs)
        && finite(dot.expiresAtMs)
        && dot.spawnedAtMs >= 0
        && dot.expiresAtMs >= dot.spawnedAtMs
        && dot.expiresAtMs <= MAX_SERIALIZED_TIMESTAMP_MS
      ) trailDots.push({ ...dot, position: { ...dot.position } })
    }
    const committedAllyPaths: SnakeCommittedPath[] = []
    for (let index = 0; index < source.committedAllyPaths.length; index += 1) {
      const committed = source.committedAllyPaths[index]
      if (committedPathValid(committed)) {
        committedAllyPaths.push({
          enemyId: committed.enemyId,
          commitUntilMs: committed.commitUntilMs,
          samples: committed.samples.map((sample) => ({
            atMs: sample.atMs,
            position: { ...sample.position },
          })),
        })
      }
    }
    return {
      enemy,
      snapshot: {
        simulationMs: source.simulationMs,
        field: { ...source.field },
        player,
        enemies: [enemy],
        trailDots,
        playerHistory: [],
        committedAllyPaths,
      },
    }
  } catch {
    return null
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

function medianSignedTurnRate(samples: readonly SnakePlayerHistorySample[]): number {
  const values: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const prior = samples[index - 1]
    const current = samples[index]
    const seconds = (current.simulationMs - prior.simulationMs) / 1_000
    if (seconds <= 0 || magnitude(prior.velocity) <= EPSILON || magnitude(current.velocity) <= EPSILON) {
      continue
    }
    values.push(signedAngleDifference(
      Math.atan2(prior.velocity.y, prior.velocity.x),
      Math.atan2(current.velocity.y, current.velocity.x),
    ) / seconds)
  }
  return median(values)
}

function createPlayerHypothesisBuffer(stepCount: number): SnakePlayerHypotheses {
  const vectors = () => Array.from({ length: stepCount }, () => ({ x: 0, y: 0 }))
  const keepVelocity = vectors()
  const continueMedianTurn = vectors()
  const decelerate = vectors()
  const stayStopped = vectors()
  return {
    keepVelocity,
    continueMedianTurn,
    decelerate,
    stayStopped,
    all: [keepVelocity, continueMedianTurn, decelerate, stayStopped],
  }
}

function populatePlayerHypotheses(
  snapshot: SnakePlannerSnapshot,
  lookaheadMs: number,
  stepMs: number,
  result: SnakePlayerHypotheses,
): void {
  const stepCount = result.keepVelocity.length
  const origin = snapshot.player.position
  const velocity = snapshot.player.velocity
  const speed = magnitude(velocity)
  const heading = speed > EPSILON ? Math.atan2(velocity.y, velocity.x) : 0
  const signedTurnRate = medianSignedTurnRate(relevantHistory(snapshot))
  let turningX = origin.x
  let turningY = origin.y
  let priorSeconds = 0
  if (speed <= EPSILON) {
    for (let index = 0; index < stepCount; index += 1) {
      for (const path of result.all) {
        path[index].x = origin.x
        path[index].y = origin.y
      }
    }
    return
  }
  for (let index = 0; index < stepCount; index += 1) {
    const seconds = Math.min((index + 1) * stepMs, lookaheadMs) / 1_000
    const deltaSeconds = seconds - priorSeconds
    result.keepVelocity[index].x = origin.x + velocity.x * seconds
    result.keepVelocity[index].y = origin.y + velocity.y * seconds
    const turningHeading = heading + signedTurnRate * seconds
    turningX += Math.cos(turningHeading) * speed * deltaSeconds
    turningY += Math.sin(turningHeading) * speed * deltaSeconds
    result.continueMedianTurn[index].x = turningX
    result.continueMedianTurn[index].y = turningY
    const slowingSeconds = Math.min(seconds, 0.1)
    const displacementSeconds = slowingSeconds - slowingSeconds * slowingSeconds / 0.2
    result.decelerate[index].x = origin.x + velocity.x * displacementSeconds
    result.decelerate[index].y = origin.y + velocity.y * displacementSeconds
    result.stayStopped[index].x = origin.x
    result.stayStopped[index].y = origin.y
    priorSeconds = seconds
  }
}

interface TimedPlayerHypotheses {
  hypotheses: SnakePlayerHypotheses
  sampleTimesMs: number[]
}

function createTimedPlayerHypotheses(
  snapshot: SnakePlannerSnapshot,
  lookaheadMs: number,
  stepMs: number,
): TimedPlayerHypotheses {
  const completedSteps = Math.floor(lookaheadMs / stepMs)
  const hasPartial = lookaheadMs - completedSteps * stepMs > EPSILON
  const sampleCount = completedSteps + (hasPartial ? 1 : 0)
  const hypotheses = createPlayerHypothesisBuffer(sampleCount)
  populatePlayerHypotheses(snapshot, lookaheadMs, stepMs, hypotheses)
  return {
    hypotheses,
    sampleTimesMs: Array.from(
      { length: sampleCount },
      (_, index) => Math.min((index + 1) * stepMs, lookaheadMs),
    ),
  }
}

function acquirePlayerHypotheses(
  snapshot: SnakePlannerSnapshot,
  lookaheadMs: number,
  stepMs: number,
): SnakePlayerHypotheses {
  const stepCount = Math.max(0, Math.floor(lookaheadMs / stepMs))
  const result = playerHypothesisPool.get(stepCount)?.pop() ?? createPlayerHypothesisBuffer(stepCount)
  populatePlayerHypotheses(snapshot, lookaheadMs, stepMs, result)
  return result
}

function releasePlayerHypotheses(hypotheses: SnakePlayerHypotheses): void {
  const stepCount = hypotheses.keepVelocity.length
  const pool = playerHypothesisPool.get(stepCount) ?? []
  pool.push(hypotheses)
  playerHypothesisPool.set(stepCount, pool)
}

export function predictResourceSnakePlayerHypotheses(
  snapshot: unknown,
  lookaheadMs: number,
  stepMs: number,
): SnakePlayerHypotheses {
  try {
    if (
      !snapshotIsValid(snapshot)
      || !finite(lookaheadMs)
      || lookaheadMs < 0
      || lookaheadMs > MAX_PROFILE_LOOKAHEAD_MS
      || stepMs !== 50
      || !Number.isInteger(lookaheadMs / stepMs)
    ) return createPlayerHypothesisBuffer(0)
    const result = createPlayerHypothesisBuffer(Math.max(0, Math.floor(lookaheadMs / stepMs)))
    populatePlayerHypotheses(snapshot, lookaheadMs, stepMs, result)
    return result
  } catch {
    return createPlayerHypothesisBuffer(0)
  }
}

function rolloutDirections(
  originPosition: SnakeVector,
  originVelocity: SnakeVector,
  maximumSpeedPerSecond: number,
  directions: readonly SnakeVector[],
  speedScale: 0 | 0.5 | 1,
  stepMs: number,
  field?: SnakePlannerSnapshot['field'],
): RolloutResult {
  let positionX = originPosition.x
  let positionY = originPosition.y
  let velocityX = originVelocity.x
  let velocityY = originVelocity.y
  const path: SnakeVector[] = []
  const rawPath: SnakeVector[] = []
  const fixedSteps = Math.round(stepMs / RUNTIME_FIXED_STEP_MS)
  for (const direction of directions) {
    let rawX = positionX
    let rawY = positionY
    const targetVelocityX = direction.x * speedScale * maximumSpeedPerSecond
    const targetVelocityY = direction.y * speedScale * maximumSpeedPerSecond
    const responseMs = speedScale === 0 ? RUNTIME_DECELERATION_MS : RUNTIME_ACCELERATION_MS
    const maximumDelta = maximumSpeedPerSecond * (RUNTIME_FIXED_STEP_MS / responseMs)
    for (let fixedStep = 0; fixedStep < fixedSteps; fixedStep += 1) {
      const deltaX = targetVelocityX - velocityX
      const deltaY = targetVelocityY - velocityY
      const deltaSize = Math.hypot(deltaX, deltaY)
      if (deltaSize <= maximumDelta || deltaSize <= EPSILON) {
        velocityX = targetVelocityX
        velocityY = targetVelocityY
      } else {
        const scale = maximumDelta / deltaSize
        velocityX += deltaX * scale
        velocityY += deltaY * scale
      }
      rawX = positionX + velocityX * (RUNTIME_FIXED_STEP_MS / 1_000)
      rawY = positionY + velocityY * (RUNTIME_FIXED_STEP_MS / 1_000)
      positionX = field ? clamp(rawX, field.padding, field.width - field.padding) : rawX
      positionY = field ? clamp(rawY, field.padding, field.height - field.padding) : rawY
    }
    path.push({ x: positionX, y: positionY })
    rawPath.push({ x: rawX, y: rawY })
  }
  return {
    path,
    rawPath,
    velocity: { x: velocityX, y: velocityY },
    position: { x: positionX, y: positionY },
  }
}

function generateInternalCandidates(
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  field?: SnakePlannerSnapshot['field'],
): InternalTrajectoryCandidate[] {
  const headingCount = profile.candidateCount / 3
  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  const initialSpeed = magnitude(enemy.velocity)
  const initialHeading = initialSpeed > EPSILON ? Math.atan2(enemy.velocity.y, enemy.velocity.x) : 0
  // Trigonometric unit vectors can report maximum speed a few ulps above or
  // below the authoritative scalar. Canonicalizing only that numerical noise
  // keeps the local template state-independent without changing a meaningful
  // runtime velocity.
  const templateInitialSpeed = Math.abs(initialSpeed - enemy.maximumSpeedPerSecond) <= EPSILON
    ? enemy.maximumSpeedPerSecond
    : initialSpeed
  const cacheKey = [
    templateInitialSpeed,
    enemy.maximumSpeedPerSecond,
    profile.candidateCount,
    profile.lookaheadMs,
    profile.rolloutStepMs,
  ].join(':')
  let templates = localTrajectoryTemplateCache.get(cacheKey)
  if (!templates) {
    templates = generateLocalTrajectoryTemplates(
      templateInitialSpeed,
      enemy.maximumSpeedPerSecond,
      profile,
      headingCount,
      stepCount,
    )
    if (localTrajectoryTemplateCache.size >= 32) localTrajectoryTemplateCache.clear()
    localTrajectoryTemplateCache.set(cacheKey, templates)
  }
  const cosine = Math.cos(initialHeading)
  const sine = Math.sin(initialHeading)
  const result = acquireTrajectoryBuffer(profile.candidateCount, stepCount)
  for (let candidateIndex = 0; candidateIndex < templates.length; candidateIndex += 1) {
    const template = templates[candidateIndex]
    const candidate = result[candidateIndex]
    candidate.candidateIndex = template.candidateIndex
    candidate.speedScale = template.speedScale
    candidate.steeringCost = template.steeringCost
    candidate.localDirections = template.directions
    candidate.localRawPath = template.rawPath
    candidate.transformOrigin = enemy.position
    candidate.transformCosine = cosine
    candidate.transformSine = sine
    candidate.transformField = field
    candidate.materialized = false
    candidate.segmentDurationsMs = undefined
    transformBounds(template.rawBounds, candidate.rawBounds, enemy.position, cosine, sine)
    candidate.bounds.minimumX = field
      ? clamp(candidate.rawBounds.minimumX, field.padding, field.width - field.padding)
      : candidate.rawBounds.minimumX
    candidate.bounds.maximumX = field
      ? clamp(candidate.rawBounds.maximumX, field.padding, field.width - field.padding)
      : candidate.rawBounds.maximumX
    candidate.bounds.minimumY = field
      ? clamp(candidate.rawBounds.minimumY, field.padding, field.height - field.padding)
      : candidate.rawBounds.minimumY
    candidate.bounds.maximumY = field
      ? clamp(candidate.rawBounds.maximumY, field.padding, field.height - field.padding)
      : candidate.rawBounds.maximumY
    const endpoint = template.rawPath[stepCount - 1]
    const endpointX = enemy.position.x + endpoint.x * cosine - endpoint.y * sine
    const endpointY = enemy.position.y + endpoint.x * sine + endpoint.y * cosine
    candidate.rawPath[stepCount - 1].x = endpointX
    candidate.rawPath[stepCount - 1].y = endpointY
    candidate.path[stepCount - 1].x = field
      ? clamp(endpointX, field.padding, field.width - field.padding)
      : endpointX
    candidate.path[stepCount - 1].y = field
      ? clamp(endpointY, field.padding, field.height - field.padding)
      : endpointY
  }
  return result
}

function transformBounds(
  local: PathBounds,
  result: PathBounds,
  origin: SnakeVector,
  cosine: number,
  sine: number,
): void {
  const firstX = local.minimumX * cosine - local.minimumY * sine
  const firstY = local.minimumX * sine + local.minimumY * cosine
  let minimumX = firstX
  let maximumX = firstX
  let minimumY = firstY
  let maximumY = firstY
  const include = (x: number, y: number) => {
    if (x < minimumX) minimumX = x
    if (x > maximumX) maximumX = x
    if (y < minimumY) minimumY = y
    if (y > maximumY) maximumY = y
  }
  include(local.minimumX * cosine - local.maximumY * sine, local.minimumX * sine + local.maximumY * cosine)
  include(local.maximumX * cosine - local.minimumY * sine, local.maximumX * sine + local.minimumY * cosine)
  include(local.maximumX * cosine - local.maximumY * sine, local.maximumX * sine + local.maximumY * cosine)
  result.minimumX = origin.x + minimumX
  result.maximumX = origin.x + maximumX
  result.minimumY = origin.y + minimumY
  result.maximumY = origin.y + maximumY
}

function materializeCandidate(candidate: InternalTrajectoryCandidate): void {
  if (candidate.materialized) return
  const localDirections = candidate.localDirections
  const localRawPath = candidate.localRawPath
  const origin = candidate.transformOrigin
  const cosine = candidate.transformCosine
  const sine = candidate.transformSine
  if (!localDirections || !localRawPath || !origin || cosine === undefined || sine === undefined) return
  const field = candidate.transformField
  for (let step = 0; step < candidate.path.length; step += 1) {
    const direction = localDirections[step]
    candidate.directions[step].x = direction.x * cosine - direction.y * sine
    candidate.directions[step].y = direction.x * sine + direction.y * cosine
    const point = localRawPath[step]
    const rawX = origin.x + point.x * cosine - point.y * sine
    const rawY = origin.y + point.x * sine + point.y * cosine
    candidate.rawPath[step].x = rawX
    candidate.rawPath[step].y = rawY
    candidate.path[step].x = field ? clamp(rawX, field.padding, field.width - field.padding) : rawX
    candidate.path[step].y = field ? clamp(rawY, field.padding, field.height - field.padding) : rawY
  }
  candidate.materialized = true
}

function acquireTrajectoryBuffer(candidateCount: number, stepCount: number): InternalTrajectoryCandidate[] {
  const key = `${candidateCount}:${stepCount}`
  const pooled = trajectoryBufferPool.get(key)?.pop()
  if (pooled) return pooled
  return Array.from({ length: candidateCount }, (_, candidateIndex) => ({
    candidateIndex,
    speedScale: SPEED_SCALES[candidateIndex % SPEED_SCALES.length],
    directions: Array.from({ length: stepCount }, () => ({ x: 0, y: 0 })),
    path: Array.from({ length: stepCount }, () => ({ x: 0, y: 0 })),
    rawPath: Array.from({ length: stepCount }, () => ({ x: 0, y: 0 })),
    steeringCost: 0,
    bounds: { minimumX: 0, maximumX: 0, minimumY: 0, maximumY: 0 },
    rawBounds: { minimumX: 0, maximumX: 0, minimumY: 0, maximumY: 0 },
    materialized: false,
    score: emptyScore(),
  }))
}

function releaseTrajectoryBuffer(candidates: InternalTrajectoryCandidate[]): void {
  if (candidates.length === 0) return
  const key = `${candidates.length}:${candidates[0].path.length}`
  const pool = trajectoryBufferPool.get(key) ?? []
  pool.push(candidates)
  trajectoryBufferPool.set(key, pool)
}

function generateLocalTrajectoryTemplates(
  initialSpeed: number,
  maximumSpeedPerSecond: number,
  profile: SnakePlannerProfile,
  headingCount: number,
  stepCount: number,
): InternalTrajectoryCandidate[] {
  const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND * profile.rolloutStepMs / 1_000
  const result: InternalTrajectoryCandidate[] = []
  for (let headingIndex = 0; headingIndex < headingCount; headingIndex += 1) {
    const targetHeading = headingIndex / headingCount * TWO_PI
    for (let speedIndex = 0; speedIndex < SPEED_SCALES.length; speedIndex += 1) {
      const speedScale = SPEED_SCALES[speedIndex]
      const directions: SnakeVector[] = []
      let heading = 0
      let steeringCost = Math.abs(
        maximumSpeedPerSecond * speedScale - initialSpeed,
      ) / Math.max(maximumSpeedPerSecond, EPSILON)
      for (let step = 0; step < stepCount; step += 1) {
        const next = turnToward(heading, targetHeading, maximumTurn)
        steeringCost += Math.abs(signedAngleDifference(heading, next))
        heading = next
        directions.push({ x: Math.cos(heading), y: Math.sin(heading) })
      }
      const rollout = rolloutDirections(
        { x: 0, y: 0 },
        { x: initialSpeed, y: 0 },
        maximumSpeedPerSecond,
        directions,
        speedScale,
        profile.rolloutStepMs,
      )
      result.push({
        candidateIndex: headingIndex * 3 + speedIndex,
        speedScale,
        directions,
        path: rollout.path,
        rawPath: rollout.rawPath,
        steeringCost,
        bounds: pathBounds({ x: 0, y: 0 }, rollout.path),
        rawBounds: pathBounds({ x: 0, y: 0 }, rollout.rawPath),
        score: emptyScore(),
      })
    }
  }
  return result
}

export function generateResourceSnakeTrajectoryCandidates(
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
): SnakeTrajectoryCandidate[] {
  try {
    if (actorHasInvalidNumber(enemy) || !profileIsValid(profile)) return []
    const candidates = generateInternalCandidates(enemy, profile)
    try {
      return candidates.map((candidate) => {
        materializeCandidate(candidate)
        return {
          candidateIndex: candidate.candidateIndex,
          speedScale: candidate.speedScale,
          directions: candidate.directions.map((direction) => ({ ...direction })),
          path: candidate.path.map((position) => ({ ...position })),
        }
      })
    } finally {
      releaseTrajectoryBuffer(candidates)
    }
  } catch {
    return []
  }
}

function simulatePlanUntil(plan: SnakePlan, atMs: number): { position: SnakeVector; velocity: SnakeVector } {
  const elapsedMs = clamp(atMs - plan.plannedAtMs, 0, plan.path.length * plan.stepMs)
  const completedFixedSteps = Math.floor((elapsedMs + EPSILON) / RUNTIME_FIXED_STEP_MS)
  let position = { ...plan.originPosition }
  let velocity = { ...plan.originVelocity }
  for (let fixedStep = 0; fixedStep < completedFixedSteps; fixedStep += 1) {
    const elapsedAtStepStart = fixedStep * RUNTIME_FIXED_STEP_MS
    const cursor = Math.min(
      plan.directions.length - 1,
      Math.floor((elapsedAtStepStart + EPSILON) / plan.stepMs),
    )
    const direction = plan.directions[Math.max(0, cursor)] ?? { x: 0, y: 0 }
    const command = { x: direction.x * plan.speedScale, y: direction.y * plan.speedScale }
    const target = {
      x: command.x * plan.originMaximumSpeedPerSecond,
      y: command.y * plan.originMaximumSpeedPerSecond,
    }
    const responseMs = plan.speedScale === 0 ? RUNTIME_DECELERATION_MS : RUNTIME_ACCELERATION_MS
    velocity = approachVector(
      velocity,
      target,
      plan.originMaximumSpeedPerSecond * (RUNTIME_FIXED_STEP_MS / responseMs),
    )
    position = {
      x: position.x + velocity.x * (RUNTIME_FIXED_STEP_MS / 1_000),
      y: position.y + velocity.y * (RUNTIME_FIXED_STEP_MS / 1_000),
    }
  }
  return { position, velocity }
}

function planTimelineValid(value: unknown): value is SnakePlan {
  try {
    if (!value || typeof value !== 'object') return false
    const plan = value as SnakePlan
    if (
      !denseArray(plan.path, MAX_PROFILE_LOOKAHEAD_MS / 50)
      || !denseArray(plan.directions, MAX_PROFILE_LOOKAHEAD_MS / 50)
      || plan.path.length !== plan.directions.length
      || plan.stepMs !== 50
      || !finite(plan.plannedAtMs)
      || plan.plannedAtMs < 0
      || plan.plannedAtMs > MAX_SERIALIZED_TIMESTAMP_MS
      || !finite(plan.commitUntilMs)
      || plan.commitUntilMs < plan.plannedAtMs
      || plan.commitUntilMs > MAX_SERIALIZED_TIMESTAMP_MS
      || !coordinateVectorSafe(plan.originPosition)
      || !finiteVector(plan.originVelocity)
      || magnitude(plan.originVelocity) > MAX_ROLLOUT_SPEED_PER_SECOND
      || !finite(plan.originMaximumSpeedPerSecond)
      || plan.originMaximumSpeedPerSecond < 0
      || plan.originMaximumSpeedPerSecond > MAX_ROLLOUT_SPEED_PER_SECOND
      || !SPEED_SCALES.includes(plan.speedScale)
    ) return false
    for (let index = 0; index < plan.path.length; index += 1) {
      if (
        !coordinateVectorSafe(plan.path[index])
        || !finiteVector(plan.directions[index])
        || Math.abs(magnitude(plan.directions[index]) - 1) > 1e-8
      ) return false
    }
    return true
  } catch {
    return false
  }
}

export function sampleResourceSnakePlan(plan: SnakePlan, atMs: number): SnakePlanSample {
  const safe = (): SnakePlanSample => ({
    atMs: finite(atMs) ? atMs : 0,
    cursor: 0,
    direction: { x: 0, y: 0 },
    speedScale: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  })
  try {
    if (!planTimelineValid(plan) || !finite(atMs)) return safe()
    const cursor = plan.directions.length === 0
      ? 0
      : clamp(Math.floor((atMs - plan.plannedAtMs + EPSILON) / plan.stepMs), 0, plan.directions.length - 1)
    const simulated = simulatePlanUntil(plan, atMs)
    return {
      atMs,
      cursor,
      direction: { ...(plan.directions[cursor] ?? { x: 0, y: 0 }) },
      speedScale: plan.speedScale,
      position: simulated.position,
      velocity: simulated.velocity,
    }
  } catch {
    return safe()
  }
}

export function getResourceSnakePlanFutureSamples(
  plan: SnakePlan,
  fromMs: number,
): SnakeTimedPosition[] {
  try {
    if (!planTimelineValid(plan) || !finite(fromMs)) return []
    const result: SnakeTimedPosition[] = []
    for (let index = 0; index < plan.path.length; index += 1) {
      const atMs = plan.plannedAtMs + (index + 1) * plan.stepMs
      if (atMs > fromMs) result.push({ atMs, position: { ...plan.path[index] } })
    }
    return result
  } catch {
    return []
  }
}

/**
 * Canonical Task 5 conversion. The first sample is the exact current/re-entry
 * position, subsequent samples are absolute-time plan points, and the final
 * sample is exactly the commitment expiry (interpolated when off-grid).
 * Calls at or after that represented expiry return null: a committed path
 * always represents a non-empty future interval and is valid for its sampler.
 */
export function resourceSnakePlanToCommittedPath(
  plan: SnakePlan,
  fromMs?: number,
): SnakeCommittedPath | null {
  try {
    if (!planTimelineValid(plan)) return null
    const requestedFromMs = fromMs ?? plan.plannedAtMs
    const horizonMs = plan.plannedAtMs + plan.path.length * plan.stepMs
    const commitUntilMs = Math.min(plan.commitUntilMs, horizonMs)
    if (!finite(requestedFromMs) || requestedFromMs >= commitUntilMs) return null
    const startsAtMs = clamp(requestedFromMs, plan.plannedAtMs, commitUntilMs)
    const samples: SnakeTimedPosition[] = [{
      atMs: startsAtMs,
      position: { ...sampleResourceSnakePlan(plan, startsAtMs).position },
    }]
    const firstFixedIndex = Math.floor((startsAtMs - plan.plannedAtMs + EPSILON) / RUNTIME_FIXED_STEP_MS) + 1
    const lastFixedIndex = Math.floor((commitUntilMs - plan.plannedAtMs + EPSILON) / RUNTIME_FIXED_STEP_MS)
    for (let fixedIndex = firstFixedIndex; fixedIndex <= lastFixedIndex; fixedIndex += 1) {
      const atMs = plan.plannedAtMs + fixedIndex * RUNTIME_FIXED_STEP_MS
      if (atMs >= commitUntilMs - EPSILON) break
      samples.push({
        atMs,
        position: { ...sampleResourceSnakePlan(plan, atMs).position },
      })
    }
    if (commitUntilMs > startsAtMs) {
      samples.push({
        atMs: commitUntilMs,
        position: { ...sampleResourceSnakePlan(plan, commitUntilMs).position },
      })
    }
    return { enemyId: plan.enemyId, commitUntilMs, samples }
  } catch {
    return null
  }
}

export function sampleResourceSnakeCommittedPath(
  committed: SnakeCommittedPath,
  atMs: number,
): SnakeTimedPosition | null {
  try {
    if (!committedPathValid(committed) || !finite(atMs)) return null
    const first = committed.samples[0]
    const last = committed.samples.at(-1)!
    if (atMs < first.atMs || atMs > last.atMs) return null
    let lowerIndex = 0
    let upperIndex = committed.samples.length - 1
    while (lowerIndex + 1 < upperIndex) {
      const middle = Math.floor((lowerIndex + upperIndex) / 2)
      if (committed.samples[middle].atMs <= atMs) lowerIndex = middle
      else upperIndex = middle
    }
    const lower = committed.samples[lowerIndex]
    const upper = committed.samples[lowerIndex + 1]
    if (Math.abs(lower.atMs - atMs) <= EPSILON || lowerIndex === committed.samples.length - 1) {
      return { atMs, position: { ...lower.position } }
    }
    if (Math.abs(upper.atMs - atMs) <= EPSILON) return { atMs, position: { ...upper.position } }
    // Runtime state changes only on authoritative fixed steps, so off-step
    // samples deliberately hold the latest completed fixed-step position.
    return { atMs, position: { ...lower.position } }
  } catch {
    return null
  }
}

function segmentCircleInterval(
  start: SnakeVector,
  end: SnakeVector,
  center: SnakeVector,
  radius: number,
): [number, number] | null {
  const ox = start.x - center.x
  const oy = start.y - center.y
  const dx = end.x - start.x
  const dy = end.y - start.y
  const a = dx * dx + dy * dy
  const c = ox * ox + oy * oy - radius * radius
  if (a <= EPSILON) return c <= 0 ? [0, 1] : null
  const b = 2 * (ox * dx + oy * dy)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  const enter = c <= 0 ? 0 : Math.max(0, first)
  const exit = Math.min(1, second)
  return enter <= exit + EPSILON && exit >= -EPSILON && enter <= 1 + EPSILON
    ? [clamp(enter, 0, 1), clamp(exit, 0, 1)]
    : null
}

function movingCircleInterval(
  leftStart: SnakeVector,
  leftEnd: SnakeVector,
  rightStart: SnakeVector,
  rightEnd: SnakeVector,
  radius: number,
): [number, number] | null {
  const startX = leftStart.x - rightStart.x
  const startY = leftStart.y - rightStart.y
  const deltaX = leftEnd.x - leftStart.x - (rightEnd.x - rightStart.x)
  const deltaY = leftEnd.y - leftStart.y - (rightEnd.y - rightStart.y)
  const a = deltaX * deltaX + deltaY * deltaY
  const c = startX * startX + startY * startY - radius * radius
  if (a <= EPSILON) return c <= 0 ? [0, 1] : null
  const b = 2 * (startX * deltaX + startY * deltaY)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  const enter = c <= 0 ? 0 : Math.max(0, first)
  const exit = Math.min(1, second)
  return enter <= exit && exit >= 0 && enter <= 1 ? [enter, exit] : null
}

function movingCircleMinimumDistance(
  leftStart: SnakeVector,
  leftEnd: SnakeVector,
  rightStart: SnakeVector,
  rightEnd: SnakeVector,
): number {
  const startX = leftStart.x - rightStart.x
  const startY = leftStart.y - rightStart.y
  const deltaX = leftEnd.x - leftStart.x - (rightEnd.x - rightStart.x)
  const deltaY = leftEnd.y - leftStart.y - (rightEnd.y - rightStart.y)
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  const fraction = lengthSquared <= EPSILON
    ? 0
    : clamp(-(startX * deltaX + startY * deltaY) / lengthSquared, 0, 1)
  return Math.hypot(startX + deltaX * fraction, startY + deltaY * fraction)
}

function boundaryExitFraction(
  start: SnakeVector,
  rawEnd: SnakeVector,
  snapshot: SnakePlannerSnapshot,
  margin: number,
): number | null {
  const minimumX = snapshot.field.padding + margin
  const maximumX = snapshot.field.width - snapshot.field.padding - margin
  const minimumY = snapshot.field.padding + margin
  const maximumY = snapshot.field.height - snapshot.field.padding - margin
  if (start.x < minimumX || start.x > maximumX || start.y < minimumY || start.y > maximumY) return 0
  let result: number | null = null
  const consider = (value: number) => {
    if (value < -EPSILON || value > 1 + EPSILON) return
    const bounded = clamp(value, 0, 1)
    result = result === null ? bounded : Math.min(result, bounded)
  }
  if (rawEnd.x < minimumX) consider((minimumX - start.x) / (rawEnd.x - start.x))
  if (rawEnd.x > maximumX) consider((maximumX - start.x) / (rawEnd.x - start.x))
  if (rawEnd.y < minimumY) consider((minimumY - start.y) / (rawEnd.y - start.y))
  if (rawEnd.y > maximumY) consider((maximumY - start.y) / (rawEnd.y - start.y))
  return result
}

function riskMargin(enemy: SnakePlannerActor): number {
  if (enemy.maximumIntegrity <= 0) return LOW_INTEGRITY_CLEARANCE_RESERVE
  return clamp(1 - enemy.integrity / enemy.maximumIntegrity, 0, 1)
    * LOW_INTEGRITY_CLEARANCE_RESERVE
}

function buildTrailIndex(snapshot: SnakePlannerSnapshot): TrailSpatialIndex {
  const columns = Math.ceil(snapshot.field.width / SPATIAL_CELL_SIZE)
  const rows = Math.ceil(snapshot.field.height / SPATIAL_CELL_SIZE)
  if (
    cachedTrailIndex
    && cachedTrailIndex.columns === columns
    && cachedTrailIndex.rows === rows
    && cachedTrailIndex.dots.length === snapshot.trailDots.length
  ) {
    let equal = true
    for (let index = 0; index < snapshot.trailDots.length; index += 1) {
      const left = cachedTrailIndex.dots[index]
      const right = snapshot.trailDots[index]
      if (
        left.id !== right.id
        || left.ownerId !== right.ownerId
        || left.position.x !== right.position.x
        || left.position.y !== right.position.y
        || left.spawnedAtMs !== right.spawnedAtMs
        || left.expiresAtMs !== right.expiresAtMs
      ) {
        equal = false
        break
      }
    }
    if (equal) return cachedTrailIndex
  }
  const dots = snapshot.trailDots.map((dot) => ({
    ...dot,
    position: { ...dot.position },
  }))
  const bucketCounts = new Int32Array(columns * rows)
  let minimumX = Infinity
  let maximumX = -Infinity
  let minimumY = Infinity
  let maximumY = -Infinity
  for (let index = 0; index < dots.length; index += 1) {
    const dot = dots[index]
    minimumX = Math.min(minimumX, dot.position.x)
    maximumX = Math.max(maximumX, dot.position.x)
    minimumY = Math.min(minimumY, dot.position.y)
    maximumY = Math.max(maximumY, dot.position.y)
    const x = clamp(Math.floor(dot.position.x / SPATIAL_CELL_SIZE), 0, columns - 1)
    const y = clamp(Math.floor(dot.position.y / SPATIAL_CELL_SIZE), 0, rows - 1)
    const bucketIndex = y * columns + x
    bucketCounts[bucketIndex] += 1
  }
  const bucketOffsets = new Int32Array(bucketCounts.length + 1)
  for (let index = 0; index < bucketCounts.length; index += 1) {
    bucketOffsets[index + 1] = bucketOffsets[index] + bucketCounts[index]
  }
  const bucketWrites = bucketOffsets.slice(0, -1)
  const bucketDotIndices = new Int32Array(dots.length)
  for (let index = 0; index < dots.length; index += 1) {
    const dot = dots[index]
    const x = clamp(Math.floor(dot.position.x / SPATIAL_CELL_SIZE), 0, columns - 1)
    const y = clamp(Math.floor(dot.position.y / SPATIAL_CELL_SIZE), 0, rows - 1)
    const bucketIndex = y * columns + x
    bucketDotIndices[bucketWrites[bucketIndex]] = index
    bucketWrites[bucketIndex] += 1
  }
  cachedTrailIndex = {
    columns,
    rows,
    bucketOffsets,
    bucketDotIndices,
    dots,
    minimumX,
    maximumX,
    minimumY,
    maximumY,
  }
  return cachedTrailIndex
}

function trailCollisionTime(
  index: TrailSpatialIndex,
  actorId: SnakeId,
  start: SnakeVector,
  end: SnakeVector,
  segmentStartMs: number,
  segmentDurationMs: number,
  radius: number,
  graceUntilMs: number,
): number | null {
  const minimumX = clamp(Math.floor((Math.min(start.x, end.x) - radius) / SPATIAL_CELL_SIZE), 0, index.columns - 1)
  const maximumX = clamp(Math.floor((Math.max(start.x, end.x) + radius) / SPATIAL_CELL_SIZE), 0, index.columns - 1)
  const minimumY = clamp(Math.floor((Math.min(start.y, end.y) - radius) / SPATIAL_CELL_SIZE), 0, index.rows - 1)
  const maximumY = clamp(Math.floor((Math.max(start.y, end.y) + radius) / SPATIAL_CELL_SIZE), 0, index.rows - 1)
  let earliest: number | null = null
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const bucket = y * index.columns + x
      const bucketEnd = index.bucketOffsets[bucket + 1]
      for (
        let bucketOffset = index.bucketOffsets[bucket];
        bucketOffset < bucketEnd;
        bucketOffset += 1
      ) {
        const dot = index.dots[index.bucketDotIndices[bucketOffset]]
        const interval = segmentCircleInterval(start, end, dot.position, radius)
        if (!interval) continue
        const insideStartMs = segmentStartMs + interval[0] * segmentDurationMs
        const insideEndMs = segmentStartMs + interval[1] * segmentDurationMs
        const ownerReadyMs = dot.ownerId === actorId
          ? dot.spawnedAtMs + SELF_TRAIL_IGNORE_MS
          : dot.spawnedAtMs + EPSILON
        const hazardousAtMs = Math.max(insideStartMs, graceUntilMs, ownerReadyMs)
        if (hazardousAtMs <= insideEndMs + EPSILON && dot.expiresAtMs > hazardousAtMs) {
          earliest = earliest === null ? hazardousAtMs : Math.min(earliest, hazardousAtMs)
        }
      }
    }
  }
  return earliest
}

function committedPointAt(committed: SnakeCommittedPath, atMs: number): SnakeVector | null {
  return sampleResourceSnakeCommittedPath(committed, atMs)?.position ?? null
}

interface SweptCommittedAllyResult {
  collisionAtMs: number | null
  clearance: number
}

function sweptCommittedAllyOverlap(
  actorStart: SnakeVector,
  actorEnd: SnakeVector,
  segmentStartMs: number,
  segmentEndMs: number,
  committed: SnakeCommittedPath,
  collisionRadius: number,
): SweptCommittedAllyResult | null {
  const firstAtMs = committed.samples[0]?.atMs
  if (!finite(firstAtMs) || segmentEndMs <= segmentStartMs + EPSILON) return null
  const overlapStartMs = Math.max(segmentStartMs, firstAtMs)
  const overlapEndMs = Math.min(segmentEndMs, committed.commitUntilMs)
  if (overlapEndMs <= overlapStartMs + EPSILON) return null
  const segmentDurationMs = segmentEndMs - segmentStartMs
  const actorAt = (atMs: number): SnakeVector => {
    const fraction = clamp((atMs - segmentStartMs) / segmentDurationMs, 0, 1)
    return {
      x: actorStart.x + (actorEnd.x - actorStart.x) * fraction,
      y: actorStart.y + (actorEnd.y - actorStart.y) * fraction,
    }
  }
  const clippedActorStart = actorAt(overlapStartMs)
  const clippedActorEnd = actorAt(overlapEndMs)
  const allyStart = committedPointAt(committed, overlapStartMs)
  const allyEnd = committedPointAt(committed, overlapEndMs)
  if (!allyStart || !allyEnd) return null
  const interval = movingCircleInterval(
    clippedActorStart,
    clippedActorEnd,
    allyStart,
    allyEnd,
    collisionRadius,
  )
  return {
    collisionAtMs: interval
      ? overlapStartMs + interval[0] * (overlapEndMs - overlapStartMs)
      : null,
    clearance: movingCircleMinimumDistance(
      clippedActorStart,
      clippedActorEnd,
      allyStart,
      allyEnd,
    ) - collisionRadius,
  }
}

function distinctHypothesisPaths(hypotheses: SnakePlayerHypotheses): SnakeVector[][] {
  const distinct: SnakeVector[][] = []
  outer: for (const path of hypotheses.all) {
    for (const prior of distinct) {
      if (path.length !== prior.length) continue
      let equal = true
      for (let index = 0; index < path.length; index += 1) {
        if (path[index].x !== prior[index].x || path[index].y !== prior[index].y) {
          equal = false
          break
        }
      }
      if (equal) continue outer
    }
    distinct.push(path)
  }
  return distinct
}

function pathBounds(origin: SnakeVector, path: readonly SnakeVector[]): PathBounds {
  let minimumX = origin.x
  let maximumX = origin.x
  let minimumY = origin.y
  let maximumY = origin.y
  for (const point of path) {
    minimumX = Math.min(minimumX, point.x)
    maximumX = Math.max(maximumX, point.x)
    minimumY = Math.min(minimumY, point.y)
    maximumY = Math.max(maximumY, point.y)
  }
  return { minimumX, maximumX, minimumY, maximumY }
}

function boundsOverlap(left: PathBounds, right: PathBounds, radius: number): boolean {
  return left.minimumX <= right.maximumX + radius
    && left.maximumX >= right.minimumX - radius
    && left.minimumY <= right.maximumY + radius
    && left.maximumY >= right.minimumY - radius
}

function candidateSurvives(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: InternalTrajectoryCandidate,
  hypothesisPaths: readonly SnakeVector[][],
  hypothesisBounds: readonly PathBounds[],
  trailIndex: TrailSpatialIndex,
  stepMs: number,
  maximumSurvivalMs = Number.POSITIVE_INFINITY,
): boolean {
  const margin = riskMargin(enemy)
  const graceUntilMs = snapshot.simulationMs + enemy.collisionGraceMs
  const playerBothGraceUntilMs = snapshot.simulationMs
    + Math.min(enemy.collisionGraceMs, snapshot.player.collisionGraceMs)
  const candidateBounds = candidate.bounds
  const rawBounds = candidate.rawBounds
  const minimumX = snapshot.field.padding + margin
  const maximumX = snapshot.field.width - snapshot.field.padding - margin
  const minimumY = snapshot.field.padding + margin
  const maximumY = snapshot.field.height - snapshot.field.padding - margin
  const checkBoundary = rawBounds.minimumX < minimumX
    || rawBounds.maximumX > maximumX
    || rawBounds.minimumY < minimumY
    || rawBounds.maximumY > maximumY
  const trailBounds: PathBounds = {
    minimumX: trailIndex.minimumX,
    maximumX: trailIndex.maximumX,
    minimumY: trailIndex.minimumY,
    maximumY: trailIndex.maximumY,
  }
  const checkTrails = trailIndex.dots.length > 0
    && boundsOverlap(candidateBounds, trailBounds, TRAIL_COLLISION_RADIUS + margin)
  let checkPlayer = false
  for (const bounds of hypothesisBounds) {
    if (boundsOverlap(candidateBounds, bounds, PLAYER_HEAD_CLEARANCE + margin * 0.5)) {
      checkPlayer = true
      break
    }
  }
  if (
    !checkBoundary
    && !checkTrails
    && !checkPlayer
    && snapshot.committedAllyPaths.length === 0
  ) return true
  materializeCandidate(candidate)
  let start = enemy.position
  let elapsedMs = 0
  for (let pathIndex = 0; pathIndex < candidate.path.length; pathIndex += 1) {
    if (elapsedMs >= maximumSurvivalMs - EPSILON) break
    const fullEnd = candidate.path[pathIndex]
    const fullRawEnd = candidate.rawPath[pathIndex]
    const fullDurationMs = candidate.segmentDurationsMs?.[pathIndex] ?? stepMs
    const segmentDurationMs = Math.min(fullDurationMs, maximumSurvivalMs - elapsedMs)
    const fraction = clamp(segmentDurationMs / fullDurationMs, 0, 1)
    const end = fraction >= 1 - EPSILON ? fullEnd : {
      x: start.x + (fullEnd.x - start.x) * fraction,
      y: start.y + (fullEnd.y - start.y) * fraction,
    }
    const rawEnd = fraction >= 1 - EPSILON ? fullRawEnd : {
      x: start.x + (fullRawEnd.x - start.x) * fraction,
      y: start.y + (fullRawEnd.y - start.y) * fraction,
    }
    const segmentStartMs = snapshot.simulationMs + elapsedMs
    elapsedMs += segmentDurationMs
    if (checkBoundary) {
      const exit = boundaryExitFraction(start, rawEnd, snapshot, margin)
      if (exit !== null) {
        const outsideAtMs = segmentStartMs + exit * segmentDurationMs
        if (Math.max(outsideAtMs, graceUntilMs) <= segmentStartMs + segmentDurationMs + EPSILON) return false
      }
    }
    if (checkTrails && trailCollisionTime(
      trailIndex,
      enemy.id,
      start,
      end,
      segmentStartMs,
      segmentDurationMs,
      TRAIL_COLLISION_RADIUS + margin,
      graceUntilMs,
    ) !== null) return false
    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const overlap = sweptCommittedAllyOverlap(
        start,
        end,
        segmentStartMs,
        segmentStartMs + segmentDurationMs,
        committed,
        ALLY_COLLISION_RADIUS + margin,
      )
      if (overlap && overlap.collisionAtMs !== null) return false
    }
    if (checkPlayer) {
      for (const hypothesis of hypothesisPaths) {
        const playerStart = pathIndex === 0 ? snapshot.player.position : hypothesis[pathIndex - 1]
        const fullPlayerEnd = hypothesis[pathIndex]
        const playerEnd = fraction >= 1 - EPSILON ? fullPlayerEnd : {
          x: playerStart.x + (fullPlayerEnd.x - playerStart.x) * fraction,
          y: playerStart.y + (fullPlayerEnd.y - playerStart.y) * fraction,
        }
        const interval = movingCircleInterval(
          start,
          end,
          playerStart,
          playerEnd,
          PLAYER_HEAD_CLEARANCE + margin * 0.5,
        )
        if (interval) {
          const collisionAtMs = segmentStartMs + interval[0] * segmentDurationMs
          if (collisionAtMs + EPSILON >= playerBothGraceUntilMs) return false
        }
      }
    }
    start = end
    if (fraction < 1 - EPSILON) break
  }
  return true
}

function acquireGrid(snapshot: SnakePlannerSnapshot): GridWorkspace {
  const width = Math.ceil(snapshot.field.width / RESOURCE_SNAKE_GRID_SIZE)
  const height = Math.ceil(snapshot.field.height / RESOURCE_SNAKE_GRID_SIZE)
  const key = `${width}:${height}`
  const pooled = gridWorkspacePool.get(key)?.pop()
  if (pooled) return pooled
  const size = width * height
  return {
    width,
    height,
    enemyBase: new Uint8Array(size),
    playerBase: new Uint8Array(size),
    occupancy: new Uint8Array(size),
    queue: new Int32Array(size),
    visitMarks: new Uint32Array(size),
    generation: 0,
    enemyLabels: new Int32Array(size),
    playerLabels: new Int32Array(size),
    enemyAreas: new Int32Array(size + 1),
    playerAreas: new Int32Array(size + 1),
    playerBaselineMemberships: Array.from({ length: 4 }, () => new Uint8Array(size)),
    singlePlayerBaselineComponent: 0,
    candidateCells: new Int32Array(size),
  }
}

function releaseGrid(workspace: GridWorkspace): void {
  const key = `${workspace.width}:${workspace.height}`
  const pool = gridWorkspacePool.get(key) ?? []
  pool.push(workspace)
  gridWorkspacePool.set(key, pool)
}

function markDisk(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  position: SnakeVector,
  radius: number,
  recordedCells?: Int32Array,
  recordedCount = 0,
): number {
  const minimumX = Math.max(0, Math.floor((position.x - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumX = Math.min(workspace.width - 1, Math.floor((position.x + radius) / RESOURCE_SNAKE_GRID_SIZE))
  const minimumY = Math.max(0, Math.floor((position.y - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumY = Math.min(workspace.height - 1, Math.floor((position.y + radius) / RESOURCE_SNAKE_GRID_SIZE))
  const expanded = radius + RESOURCE_SNAKE_GRID_SIZE * 0.5
  const squared = expanded * expanded
  for (let y = minimumY; y <= maximumY; y += 1) {
    const centerY = (y + 0.5) * RESOURCE_SNAKE_GRID_SIZE
    for (let x = minimumX; x <= maximumX; x += 1) {
      const centerX = (x + 0.5) * RESOURCE_SNAKE_GRID_SIZE
      const dx = centerX - position.x
      const dy = centerY - position.y
      if (dx * dx + dy * dy <= squared) {
        const index = y * workspace.width + x
        if (!occupancy[index]) {
          occupancy[index] = 1
          if (recordedCells) {
            recordedCells[recordedCount] = index
            recordedCount += 1
          }
        }
      }
    }
  }
  return recordedCount
}

function trailHazardousAt(
  dot: SnakePlannerTrailDot,
  actor: SnakePlannerActor,
  snapshotMs: number,
  atMs: number,
): boolean {
  if (dot.spawnedAtMs >= atMs || dot.expiresAtMs <= atMs) return false
  if (snapshotMs + actor.collisionGraceMs > atMs) return false
  return dot.ownerId !== actor.id || atMs - dot.spawnedAtMs >= SELF_TRAIL_IGNORE_MS
}

function occupancyBaseCacheMatches(
  cached: OccupancyBaseCache,
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  hypotheses: SnakePlayerHypotheses,
  trailIndex: TrailSpatialIndex,
  horizonMs: number,
  enemyMargin: number,
): boolean {
  if (
    cached.trailIndex !== trailIndex
    || cached.fieldWidth !== snapshot.field.width
    || cached.fieldHeight !== snapshot.field.height
    || cached.fieldPadding !== snapshot.field.padding
    || cached.enemyId !== enemy.id
    || cached.playerId !== snapshot.player.id
    || cached.enemyMargin !== enemyMargin
    || cached.enemyCollisionGraceMs !== enemy.collisionGraceMs
    || cached.playerCollisionGraceMs !== snapshot.player.collisionGraceMs
    || cached.horizonOffsetMs !== horizonMs - snapshot.simulationMs
    || horizonMs < cached.horizonMs
    || horizonMs >= cached.trailValidityUntilMs
    || cached.hypothesisEndpoints.length !== hypotheses.all.length
    || cached.committedPoints.length !== snapshot.committedAllyPaths.length
  ) return false
  for (let index = 0; index < hypotheses.all.length; index += 1) {
    const point = hypotheses.all[index].at(-1)
    const cachedPoint = cached.hypothesisEndpoints[index]
    if (!point || point.x !== cachedPoint.x || point.y !== cachedPoint.y) return false
  }
  for (let index = 0; index < snapshot.committedAllyPaths.length; index += 1) {
    const point = committedPointAt(snapshot.committedAllyPaths[index], horizonMs)
    const cachedPoint = cached.committedPoints[index]
    if (!point || !cachedPoint) {
      if (point !== cachedPoint) return false
    } else if (point.x !== cachedPoint.x || point.y !== cachedPoint.y) return false
  }
  return true
}

function nextTrailHazardTransitionMs(
  dot: SnakePlannerTrailDot,
  actor: SnakePlannerActor,
  snapshotMs: number,
  atMs: number,
): number {
  // With a fixed lookahead offset and grace value, a dot's raster state can
  // change only at its activation or expiry boundary. The cache retains the
  // exact raster only inside that proven half-open interval; changed dot
  // content already produces a distinct TrailSpatialIndex identity.
  if (snapshotMs + actor.collisionGraceMs > atMs || dot.expiresAtMs <= atMs) return Infinity
  const activationMs = dot.ownerId === actor.id
    ? dot.spawnedAtMs + SELF_TRAIL_IGNORE_MS
    : dot.spawnedAtMs
  if (activationMs >= dot.expiresAtMs) return Infinity
  const beforeActivation = dot.ownerId === actor.id
    ? atMs < activationMs
    : atMs <= activationMs
  return beforeActivation ? activationMs : dot.expiresAtMs
}

function prepareOccupancyBases(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  hypotheses: SnakePlayerHypotheses,
  workspace: GridWorkspace,
  horizonMs: number,
  trailIndex: TrailSpatialIndex,
): void {
  const enemyMargin = riskMargin(enemy)
  if (cachedOccupancyBases && occupancyBaseCacheMatches(
    cachedOccupancyBases,
    snapshot,
    enemy,
    hypotheses,
    trailIndex,
    horizonMs,
    enemyMargin,
  )) {
    workspace.enemyBase.set(cachedOccupancyBases.enemyBase)
    workspace.playerBase.set(cachedOccupancyBases.playerBase)
    return
  }
  workspace.enemyBase.fill(0)
  workspace.playerBase.fill(0)
  for (let index = 0; index < workspace.enemyBase.length; index += 1) {
    const x = (index % workspace.width + 0.5) * RESOURCE_SNAKE_GRID_SIZE
    const y = (Math.floor(index / workspace.width) + 0.5) * RESOURCE_SNAKE_GRID_SIZE
    if (
      x < snapshot.field.padding + enemyMargin
      || x > snapshot.field.width - snapshot.field.padding - enemyMargin
      || y < snapshot.field.padding + enemyMargin
      || y > snapshot.field.height - snapshot.field.padding - enemyMargin
    ) workspace.enemyBase[index] = 1
    if (
      x < snapshot.field.padding
      || x > snapshot.field.width - snapshot.field.padding
      || y < snapshot.field.padding
      || y > snapshot.field.height - snapshot.field.padding
    ) workspace.playerBase[index] = 1
  }
  let trailValidityUntilMs = Infinity
  for (let index = 0; index < snapshot.trailDots.length; index += 1) {
    const dot = snapshot.trailDots[index]
    if (trailHazardousAt(dot, enemy, snapshot.simulationMs, horizonMs)) {
      markDisk(workspace.enemyBase, workspace, dot.position, TRAIL_COLLISION_RADIUS + enemyMargin)
    }
    if (trailHazardousAt(dot, snapshot.player, snapshot.simulationMs, horizonMs)) {
      markDisk(workspace.playerBase, workspace, dot.position, TRAIL_COLLISION_RADIUS)
    }
    trailValidityUntilMs = Math.min(
      trailValidityUntilMs,
      nextTrailHazardTransitionMs(dot, enemy, snapshot.simulationMs, horizonMs),
      nextTrailHazardTransitionMs(dot, snapshot.player, snapshot.simulationMs, horizonMs),
    )
  }
  const committedPoints: Array<SnakeVector | null> = []
  for (const committed of snapshot.committedAllyPaths) {
    const point = committedPointAt(committed, horizonMs)
    committedPoints.push(point ? { ...point } : null)
    if (!point) continue
    markDisk(workspace.enemyBase, workspace, point, ALLY_COLLISION_RADIUS + enemyMargin)
    markDisk(workspace.playerBase, workspace, point, ALLY_COLLISION_RADIUS)
  }
  const hypothesisEndpoints: SnakeVector[] = []
  for (const hypothesis of hypotheses.all) {
    const point = hypothesis.at(-1)
    if (point) {
      hypothesisEndpoints.push({ ...point })
      markDisk(workspace.enemyBase, workspace, point, PLAYER_HEAD_CLEARANCE + enemyMargin * 0.5)
    }
  }
  cachedOccupancyBases = {
    trailIndex,
    fieldWidth: snapshot.field.width,
    fieldHeight: snapshot.field.height,
    fieldPadding: snapshot.field.padding,
    enemyId: enemy.id,
    playerId: snapshot.player.id,
    enemyMargin,
    enemyCollisionGraceMs: enemy.collisionGraceMs,
    playerCollisionGraceMs: snapshot.player.collisionGraceMs,
    horizonMs,
    horizonOffsetMs: horizonMs - snapshot.simulationMs,
    trailValidityUntilMs,
    hypothesisEndpoints,
    committedPoints,
    enemyBase: workspace.enemyBase.slice(),
    playerBase: workspace.playerBase.slice(),
  }
}

function cellIndex(workspace: GridWorkspace, position: SnakeVector): number | null {
  const x = Math.floor(position.x / RESOURCE_SNAKE_GRID_SIZE)
  const y = Math.floor(position.y / RESOURCE_SNAKE_GRID_SIZE)
  if (x < 0 || x >= workspace.width || y < 0 || y >= workspace.height) return null
  return y * workspace.width + x
}

/**
 * Labels every exact 4-connected free component. The grid is only 67x32 for
 * the authoritative field, so one allocation-free full pass is both exact
 * and cheaper than repeating finite-depth floods for multiple origins.
 */
function labelGridComponents(
  workspace: GridWorkspace,
  occupancy: Uint8Array,
  labels: Int32Array,
  areas: Int32Array,
): void {
  labels.fill(0)
  areas.fill(0)
  let component = 0
  for (let start = 0; start < occupancy.length; start += 1) {
    if (occupancy[start] || labels[start]) continue
    component += 1
    let read = 0
    let write = 1
    workspace.queue[0] = start
    labels[start] = component
    while (read < write) {
      const index = workspace.queue[read]
      read += 1
      areas[component] += 1
      const x = index % workspace.width
      let neighbor = index - workspace.width
      if (neighbor >= 0 && !occupancy[neighbor] && !labels[neighbor]) {
        labels[neighbor] = component
        workspace.queue[write] = neighbor
        write += 1
      }
      neighbor = index + workspace.width
      if (neighbor < occupancy.length && !occupancy[neighbor] && !labels[neighbor]) {
        labels[neighbor] = component
        workspace.queue[write] = neighbor
        write += 1
      }
      if (x > 0) {
        neighbor = index - 1
        if (!occupancy[neighbor] && !labels[neighbor]) {
          labels[neighbor] = component
          workspace.queue[write] = neighbor
          write += 1
        }
      }
      if (x + 1 < workspace.width) {
        neighbor = index + 1
        if (!occupancy[neighbor] && !labels[neighbor]) {
          labels[neighbor] = component
          workspace.queue[write] = neighbor
          write += 1
        }
      }
    }
  }
}

function componentAreaAt(
  workspace: GridWorkspace,
  origin: SnakeVector,
  labels: Int32Array,
  areas: Int32Array,
): number {
  const index = cellIndex(workspace, origin)
  return index === null ? 0 : areas[labels[index]]
}

function floodExactComponent(
  workspace: GridWorkspace,
  occupancy: Uint8Array,
  origin: SnakeVector,
): number {
  const start = cellIndex(workspace, origin)
  if (start === null) return 0
  const startOccupancy = occupancy[start]
  occupancy[start] = 0
  workspace.generation += 1
  if (workspace.generation >= 0xffff_fffe) {
    workspace.visitMarks.fill(0)
    workspace.generation = 1
  }
  const generation = workspace.generation
  let read = 0
  let write = 1
  workspace.queue[0] = start
  workspace.visitMarks[start] = generation
  while (read < write) {
    const index = workspace.queue[read]
    read += 1
    const x = index % workspace.width
    let neighbor = index - workspace.width
    if (neighbor >= 0 && !occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
      workspace.visitMarks[neighbor] = generation
      workspace.queue[write] = neighbor
      write += 1
    }
    neighbor = index + workspace.width
    if (neighbor < occupancy.length && !occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
      workspace.visitMarks[neighbor] = generation
      workspace.queue[write] = neighbor
      write += 1
    }
    if (x > 0) {
      neighbor = index - 1
      if (!occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
        workspace.visitMarks[neighbor] = generation
        workspace.queue[write] = neighbor
        write += 1
      }
    }
    if (x + 1 < workspace.width) {
      neighbor = index + 1
      if (!occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
        workspace.visitMarks[neighbor] = generation
        workspace.queue[write] = neighbor
        write += 1
      }
    }
  }
  occupancy[start] = startOccupancy
  return write
}

function preparePlayerHypothesisBaselines(
  workspace: GridWorkspace,
  occupancy: Uint8Array,
  origins: readonly SnakeVector[],
): number[] {
  workspace.singlePlayerBaselineComponent = 0
  if (origins.length > 0 && origins.every((origin) => (
    origin.x === origins[0].x && origin.y === origins[0].y
  ))) {
    const start = cellIndex(workspace, origins[0])
    if (start === null) return origins.map(() => 0)
    const startOccupancy = occupancy[start]
    occupancy[start] = 0
    labelGridComponents(
      workspace,
      occupancy,
      workspace.playerLabels,
      workspace.playerAreas,
    )
    occupancy[start] = startOccupancy
    workspace.singlePlayerBaselineComponent = workspace.playerLabels[start]
    return origins.map(() => workspace.playerAreas[workspace.singlePlayerBaselineComponent])
  }
  const baselineAreas: number[] = []
  for (let hypothesisIndex = 0; hypothesisIndex < origins.length; hypothesisIndex += 1) {
    const origin = origins[hypothesisIndex]
    let duplicateIndex = -1
    for (let prior = 0; prior < hypothesisIndex; prior += 1) {
      if (origins[prior].x === origin.x && origins[prior].y === origin.y) {
        duplicateIndex = prior
        break
      }
    }
    const membership = workspace.playerBaselineMemberships[hypothesisIndex]
    if (duplicateIndex >= 0) {
      membership.set(workspace.playerBaselineMemberships[duplicateIndex])
      baselineAreas.push(baselineAreas[duplicateIndex])
      continue
    }
    membership.fill(0)
    const start = cellIndex(workspace, origin)
    if (start === null) {
      baselineAreas.push(0)
      continue
    }
    const startOccupancy = occupancy[start]
    occupancy[start] = 0
    labelGridComponents(
      workspace,
      occupancy,
      workspace.playerLabels,
      workspace.playerAreas,
    )
    occupancy[start] = startOccupancy
    const component = workspace.playerLabels[start]
    baselineAreas.push(workspace.playerAreas[component])
    if (component > 0) {
      for (let cell = 0; cell < membership.length; cell += 1) {
        if (workspace.playerLabels[cell] === component) membership[cell] = 1
      }
    }
  }
  return baselineAreas
}

function markCandidateTrail(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  path: readonly SnakeVector[],
): number {
  let recordedCount = 0
  for (let index = 0; index + 1 < path.length; index += 1) {
    recordedCount = markDisk(
      occupancy,
      workspace,
      path[index],
      FUTURE_TRAIL_RADIUS,
      workspace.candidateCells,
      recordedCount,
    )
  }
  return recordedCount
}

function playerBaseCacheId(
  workspace: GridWorkspace,
  endpoints: readonly SnakeVector[],
): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < workspace.playerBase.length; index += 1) {
    hash ^= workspace.playerBase[index] + index
    hash = Math.imul(hash, 0x01000193)
  }
  const endpointCoordinates = endpoints.flatMap((endpoint) => [endpoint.x, endpoint.y])
  for (const record of playerBaseCacheRecords) {
    if (
      record.hash !== (hash >>> 0)
      || record.endpointCoordinates.length !== endpointCoordinates.length
    ) continue
    let equal = true
    for (let index = 0; index < endpointCoordinates.length; index += 1) {
      if (record.endpointCoordinates[index] !== endpointCoordinates[index]) equal = false
    }
    if (equal) {
      for (let index = 0; index < record.occupancy.length; index += 1) {
        if (record.occupancy[index] !== workspace.playerBase[index]) {
          equal = false
          break
        }
      }
    }
    if (equal) return record.id
  }
  if (playerBaseCacheRecords.length >= 16) {
    playerBaseCacheRecords.length = 0
    playerReductionCache.clear()
  }
  const id = nextPlayerBaseCacheId
  nextPlayerBaseCacheId += 1
  playerBaseCacheRecords.push({
    id,
    hash: hash >>> 0,
    endpointCoordinates,
    occupancy: workspace.playerBase.slice(),
  })
  return id
}

function cachedPlayerReduction(
  baseId: number,
  candidateIndex: number | undefined,
  cells: Int32Array,
  count: number,
): number | null {
  if (candidateIndex === undefined) return null
  const slot = playerReductionCache.get(`${baseId}:${candidateIndex}`)
  if (!slot) return null
  for (const record of slot.records) {
    if (record.count !== count) continue
    let equal = true
    for (let index = 0; index < count; index += 1) {
      if (record.cells[index] !== cells[index]) {
        equal = false
        break
      }
    }
    if (equal) return record.value
  }
  return null
}

function cachePlayerReduction(
  baseId: number,
  candidateIndex: number | undefined,
  cells: Int32Array,
  count: number,
  value: number,
): void {
  if (candidateIndex === undefined) return
  const key = `${baseId}:${candidateIndex}`
  let slot = playerReductionCache.get(key)
  if (!slot) {
    slot = { records: [], nextReplacement: 0 }
    playerReductionCache.set(key, slot)
  }
  let record: PlayerReductionCacheRecord
  if (slot.records.length < PLAYER_REDUCTION_PATTERNS_PER_CANDIDATE) {
    record = { count: 0, cells: new Int32Array(count), value: 0 }
    slot.records.push(record)
  } else {
    record = slot.records[slot.nextReplacement]
    slot.nextReplacement = (slot.nextReplacement + 1) % slot.records.length
    if (record.cells.length < count) record.cells = new Int32Array(count)
  }
  record.count = count
  record.cells.set(cells.subarray(0, count), 0)
  record.value = value
}

function minimumAllyClearance(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: InternalTrajectoryCandidate,
  stepMs: number,
): number {
  let clearance = Math.hypot(snapshot.field.width, snapshot.field.height)
  if (!snapshot.committedAllyPaths.some((committed) => committed.enemyId !== enemy.id)) {
    return clearance
  }
  materializeCandidate(candidate)
  let elapsedMs = 0
  let start = enemy.position
  for (let index = 0; index < candidate.path.length; index += 1) {
    const durationMs = candidate.segmentDurationsMs?.[index] ?? stepMs
    const segmentStartMs = snapshot.simulationMs + elapsedMs
    elapsedMs += durationMs
    const end = candidate.path[index]
    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const overlap = sweptCommittedAllyOverlap(
        start,
        end,
        segmentStartMs,
        segmentStartMs + durationMs,
        committed,
        0,
      )
      if (overlap) clearance = Math.min(clearance, overlap.clearance)
    }
    start = end
  }
  return clearance
}

function robustPressureDistance(
  candidate: InternalTrajectoryCandidate,
  hypotheses: SnakePlayerHypotheses,
): number {
  materializeCandidate(candidate)
  let worst = 0
  for (const hypothesis of hypotheses.all) {
    let closest = Number.MAX_SAFE_INTEGER
    for (let index = 0; index < candidate.path.length; index += 1) {
      closest = Math.min(closest, distance(candidate.path[index], hypothesis[index]))
    }
    worst = Math.max(worst, closest)
  }
  return worst
}

function hypothesisCutoffTargets(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  hypotheses: SnakePlayerHypotheses,
): SnakeVector[] {
  const numericId = Number(enemy.id.split('-')[1] ?? 0)
  const side = enemy.role === 'blocker' || numericId % 2 === 1 ? -1 : 1
  const targets = hypotheses.all.map((hypothesis) => {
    const predicted = hypothesis.at(-1) ?? snapshot.player.position
    const prior = hypothesis.length > 1 ? hypothesis[hypothesis.length - 2] : snapshot.player.position
    let escape = normalize({ x: predicted.x - prior.x, y: predicted.y - prior.y })
    if (magnitude(escape) <= EPSILON) {
      escape = normalize({
        x: snapshot.player.position.x - enemy.position.x,
        y: snapshot.player.position.y - enemy.position.y,
      }, { x: 1, y: 0 })
    }
    const lateral = { x: -escape.y * side, y: escape.x * side }
    const lateralLead = Math.max(2.25, distance(enemy.position, predicted) * 0.35)
    return {
      x: predicted.x + escape.x * 1.5 + lateral.x * lateralLead,
      y: predicted.y + escape.y * 1.5 + lateral.y * lateralLead,
    }
  })
  return targets.filter((target, index) => targets.findIndex((prior) => (
    prior.x === target.x && prior.y === target.y
  )) === index)
}

function robustCutoffProgress(
  enemy: SnakePlannerActor,
  finalPoint: SnakeVector,
  targets: readonly SnakeVector[],
): number {
  let worst = Number.MAX_SAFE_INTEGER
  for (const target of targets) {
    worst = Math.min(worst, distance(enemy.position, target) - distance(finalPoint, target))
  }
  return worst === Number.MAX_SAFE_INTEGER ? 0 : worst
}

function playerAreaReductionForCandidate(
  snapshot: SnakePlannerSnapshot,
  candidate: {
    path: readonly SnakeVector[]
    candidateIndex?: number
  },
  hypotheses: SnakePlayerHypotheses,
  workspace: GridWorkspace,
  baselinePlayerAreas: readonly number[],
  baseCacheId: number,
): number {
  const internalCandidate = 'rawPath' in candidate
    ? candidate as InternalTrajectoryCandidate
    : undefined
  if (internalCandidate) materializeCandidate(internalCandidate)
  workspace.occupancy.set(workspace.playerBase)
  const candidateCellCount = markCandidateTrail(workspace.occupancy, workspace, candidate.path)
  const cached = cachedPlayerReduction(
    baseCacheId,
    candidate.candidateIndex,
    workspace.candidateCells,
    candidateCellCount,
  )
  if (cached !== null) return cached
  // Normalize only the raw footprint within each hypothesis' original
  // component. This prevents stopping/painting cells from being rewarded,
  // while preserving every genuine connectivity difference of the exact
  // full-component metric.
  let playerAreaReduction = Number.MAX_SAFE_INTEGER
  const candidateAreas = [0, 0, 0, 0]
  const candidateFootprints = [0, 0, 0, 0]
  for (let index = 0; index < hypotheses.all.length; index += 1) {
    const endpoint = hypotheses.all[index].at(-1) ?? snapshot.player.position
    let duplicateIndex = -1
    for (let prior = 0; prior < index; prior += 1) {
      const priorEndpoint = hypotheses.all[prior].at(-1) ?? snapshot.player.position
      if (priorEndpoint.x === endpoint.x && priorEndpoint.y === endpoint.y) duplicateIndex = prior
    }
    const candidateArea = duplicateIndex >= 0
      ? candidateAreas[duplicateIndex]
      : floodExactComponent(workspace, workspace.occupancy, endpoint)
    candidateAreas[index] = candidateArea
    let footprint = duplicateIndex >= 0 ? candidateFootprints[duplicateIndex] : 0
    if (duplicateIndex < 0) {
      const membership = workspace.playerBaselineMemberships[index]
      for (let cellIndex = 0; cellIndex < candidateCellCount; cellIndex += 1) {
        const cell = workspace.candidateCells[cellIndex]
        const inBaseline = workspace.singlePlayerBaselineComponent > 0
          ? workspace.playerLabels[cell] === workspace.singlePlayerBaselineComponent
          : membership[cell] === 1
        if (!workspace.playerBase[cell] && inBaseline) footprint += 1
      }
    }
    candidateFootprints[index] = footprint
    playerAreaReduction = Math.min(
      playerAreaReduction,
      Math.max(0, baselinePlayerAreas[index] - candidateArea - footprint),
    )
  }
  const result = playerAreaReduction === Number.MAX_SAFE_INTEGER ? 0 : playerAreaReduction
  cachePlayerReduction(
    baseCacheId,
    candidate.candidateIndex,
    workspace.candidateCells,
    candidateCellCount,
    result,
  )
  return result
}

function evaluateAuthoritativeCandidateScore(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: InternalTrajectoryCandidate,
  hypotheses: SnakePlayerHypotheses,
  workspace: GridWorkspace,
  trailIndex: TrailSpatialIndex,
  horizonMs: number,
  stepMs: number,
  survivalLookaheadMs = Number.POSITIVE_INFINITY,
): SnakePlanScore {
  prepareOccupancyBases(snapshot, enemy, hypotheses, workspace, horizonMs, trailIndex)
  labelGridComponents(workspace, workspace.enemyBase, workspace.enemyLabels, workspace.enemyAreas)
  const endpoints = hypotheses.all.map(
    (hypothesis) => hypothesis.at(-1) ?? snapshot.player.position,
  )
  const baselineAreas = preparePlayerHypothesisBaselines(
    workspace,
    workspace.playerBase,
    endpoints,
  )
  const collisionHypotheses = distinctHypothesisPaths(hypotheses)
  const collisionBounds = collisionHypotheses.map(
    (path) => pathBounds(snapshot.player.position, path),
  )
  const score = candidate.score
  score.steeringCost = candidate.steeringCost
  score.survives = candidateSurvives(
    snapshot,
    enemy,
    candidate,
    collisionHypotheses,
    collisionBounds,
    trailIndex,
    stepMs,
    survivalLookaheadMs,
  ) ? 1 : 0
  const endpoint = candidate.path.at(-1) ?? enemy.position
  score.reachableArea = componentAreaAt(
    workspace,
    endpoint,
    workspace.enemyLabels,
    workspace.enemyAreas,
  )
  score.allyClearance = minimumAllyClearance(snapshot, enemy, candidate, stepMs)
  score.playerAreaReduction = playerAreaReductionForCandidate(
    snapshot,
    candidate,
    hypotheses,
    workspace,
    baselineAreas,
    playerBaseCacheId(workspace, endpoints),
  )
  score.cutoffProgress = robustCutoffProgress(
    enemy,
    endpoint,
    hypothesisCutoffTargets(snapshot, enemy, hypotheses),
  )
  score.pressureDistance = robustPressureDistance(candidate, hypotheses)
  return serializeScore(score)
}

/**
 * Pure diagnostic/evaluation seam for Task 5 and tests that need to evaluate
 * a specific public trajectory against the planner's exact connectivity
 * metric without depending on which candidate wins the full lexicographic
 * comparison.
 */
export function measureResourceSnakePlayerAreaReduction(
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  path: readonly SnakeVector[],
): number {
  try {
  if (
    !profileIsValid(profile)
    || !snapshotIsValid(snapshot)
    || !denseArray(path, MAX_PROFILE_LOOKAHEAD_MS / 50)
    || path.length !== profile.lookaheadMs / profile.rolloutStepMs
  ) return 0
  for (let index = 0; index < path.length; index += 1) {
    if (!finiteVector(path[index])) return 0
  }
  const enemy = snapshot.enemies.find((candidate) => candidate.id === enemyId)
  if (!enemy) return 0
  const hypotheses = acquirePlayerHypotheses(
    snapshot,
    profile.lookaheadMs,
    profile.rolloutStepMs,
  )
  const workspace = acquireGrid(snapshot)
  try {
    prepareOccupancyBases(
      snapshot,
      enemy,
      hypotheses,
      workspace,
      snapshot.simulationMs + profile.lookaheadMs,
      buildTrailIndex(snapshot),
    )
    const endpoints = hypotheses.all.map(
      (hypothesis) => hypothesis.at(-1) ?? snapshot.player.position,
    )
    const baselineAreas = preparePlayerHypothesisBaselines(
      workspace,
      workspace.playerBase,
      endpoints,
    )
    const baseCacheId = playerBaseCacheId(workspace, endpoints)
    return playerAreaReductionForCandidate(
      snapshot,
      { path },
      hypotheses,
      workspace,
      baselineAreas,
      baseCacheId,
    )
  } finally {
    releaseGrid(workspace)
    releasePlayerHypotheses(hypotheses)
  }
  } catch {
    return 0
  }
}

function retainMaximum(
  candidates: readonly ScoredCandidate[],
  value: (candidate: ScoredCandidate) => number,
): ScoredCandidate[] {
  let maximum = -Infinity
  for (const candidate of candidates) maximum = Math.max(maximum, value(candidate))
  return candidates.filter((candidate) => value(candidate) === maximum)
}

export function compareSnakePlanScores(
  left: SnakePlanScore,
  leftCandidateIndex: number,
  right: SnakePlanScore,
  rightCandidateIndex: number,
): number {
  try {
    if (
      !scoreFieldsFinite(left)
      || !scoreFieldsFinite(right)
      || !Number.isInteger(leftCandidateIndex)
      || !Number.isInteger(rightCandidateIndex)
    ) return 0
    if (left.survives !== right.survives) return left.survives - right.survives
    if (left.reachableArea !== right.reachableArea) return left.reachableArea - right.reachableArea
    if (left.allyClearance !== right.allyClearance) return left.allyClearance - right.allyClearance
    if (left.playerAreaReduction !== right.playerAreaReduction) {
      return left.playerAreaReduction - right.playerAreaReduction
    }
    if (left.cutoffProgress !== right.cutoffProgress) return left.cutoffProgress - right.cutoffProgress
    if (left.pressureDistance !== right.pressureDistance) return right.pressureDistance - left.pressureDistance
    if (left.steeringCost !== right.steeringCost) return right.steeringCost - left.steeringCost
    return rightCandidateIndex - leftCandidateIndex
  } catch {
    return 0
  }
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  return compareSnakePlanScores(left.score, left.candidateIndex, right.score, right.candidateIndex)
}

function serializeScore(score: SnakePlanScore): SnakePlanScore {
  return {
    survives: score.survives,
    reachableArea: score.reachableArea,
    allyClearance: rounded(score.allyClearance),
    playerAreaReduction: score.playerAreaReduction,
    cutoffProgress: rounded(score.cutoffProgress),
    pressureDistance: rounded(score.pressureDistance),
    steeringCost: rounded(score.steeringCost),
  }
}

function finalizePlan(plan: SnakePlan): SnakePlan {
  return plan
}

function clonePlan(plan: SnakePlan, authoritativeScore: SnakePlanScore): SnakePlan {
  return {
    enemyId: plan.enemyId,
    intent: plan.intent,
    role: plan.role,
    direction: { ...plan.direction },
    speedScale: plan.speedScale,
    plannedAtMs: plan.plannedAtMs,
    commandAtMs: plan.commandAtMs,
    stepMs: plan.stepMs,
    originPosition: { ...plan.originPosition },
    originVelocity: { ...plan.originVelocity },
    originMaximumSpeedPerSecond: plan.originMaximumSpeedPerSecond,
    directions: plan.directions.map((direction) => ({ ...direction })),
    commitUntilMs: plan.commitUntilMs,
    path: plan.path.map((position) => ({ ...position })),
    score: { ...authoritativeScore },
    candidateIndex: plan.candidateIndex,
    evaluatedCandidates: plan.evaluatedCandidates,
    elapsedMs: plan.elapsedMs,
    fallback: plan.fallback,
  }
}

function steeringCostForDirections(
  enemy: SnakePlannerActor,
  directions: readonly SnakeVector[],
  speedScale: 0 | 0.5 | 1,
): number {
  const initialSpeed = magnitude(enemy.velocity)
  let result = Math.abs(
    enemy.maximumSpeedPerSecond * speedScale - initialSpeed,
  ) / Math.max(enemy.maximumSpeedPerSecond, EPSILON)
  let priorHeading = initialSpeed > EPSILON
    ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
    : 0
  for (const direction of directions) {
    const heading = Math.atan2(direction.y, direction.x)
    result += Math.abs(signedAngleDifference(priorHeading, heading))
    priorHeading = heading
  }
  return result
}

function retainedCandidateAt(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
): { candidate: InternalTrajectoryCandidate; lookaheadMs: number } | null {
  const planHorizonMs = plan.plannedAtMs + plan.path.length * plan.stepMs
  const lookaheadMs = planHorizonMs - snapshot.simulationMs
  if (!finite(lookaheadMs) || lookaheadMs <= 0) return null
  const completedSteps = Math.floor(lookaheadMs / plan.stepMs)
  const hasPartial = lookaheadMs - completedSteps * plan.stepMs > EPSILON
  const segmentDurationsMs = Array.from(
    { length: completedSteps + (hasPartial ? 1 : 0) },
    (_, index) => Math.min((index + 1) * plan.stepMs, lookaheadMs)
      - Math.min(index * plan.stepMs, lookaheadMs),
  )
  const directions: SnakeVector[] = []
  const path: SnakeVector[] = []
  let elapsedMs = 0
  for (const durationMs of segmentDurationsMs) {
    const segmentStartMs = snapshot.simulationMs + elapsedMs
    directions.push({ ...sampleResourceSnakePlan(plan, segmentStartMs).direction })
    elapsedMs += durationMs
    const atMs = snapshot.simulationMs + elapsedMs
    const planOffset = (atMs - plan.plannedAtMs) / plan.stepMs
    const exactIndex = Math.round(planOffset) - 1
    const exact = Math.abs(planOffset - Math.round(planOffset)) <= EPSILON
      && exactIndex >= 0
      && exactIndex < plan.path.length
    path.push(exact
      ? { ...plan.path[exactIndex] }
      : { ...sampleResourceSnakePlan(plan, atMs).position })
  }
  const bounds = pathBounds(enemy.position, path)
  return {
    lookaheadMs,
    candidate: {
      candidateIndex: plan.candidateIndex,
      speedScale: plan.speedScale,
      directions,
      path,
      rawPath: path.map((point) => ({ ...point })),
      steeringCost: steeringCostForDirections(enemy, directions, plan.speedScale),
      bounds: { ...bounds },
      rawBounds: { ...bounds },
      materialized: true,
      segmentDurationsMs,
      score: emptyScore(),
    },
  }
}

function recomputeRetainedPlanScore(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  trailIndex: TrailSpatialIndex,
): SnakePlanScore | null {
  const retained = retainedCandidateAt(snapshot, enemy, plan)
  if (!retained) return null
  const timed = createTimedPlayerHypotheses(snapshot, retained.lookaheadMs, plan.stepMs)
  const workspace = acquireGrid(snapshot)
  try {
    return evaluateAuthoritativeCandidateScore(
      snapshot,
      enemy,
      retained.candidate,
      timed.hypotheses,
      workspace,
      trailIndex,
      snapshot.simulationMs + retained.lookaheadMs,
      plan.stepMs,
      Math.min(retained.lookaheadMs, plan.commitUntilMs - snapshot.simulationMs),
    )
  } finally {
    releaseGrid(workspace)
  }
}

function deriveIntent(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  winner: ScoredCandidate,
): SnakeIntent {
  if (winner.score.survives === 0) return 'escape'
  if (snapshot.committedAllyPaths.some((path) => path.enemyId !== enemy.id)) return 'coordinate'
  if (magnitude(snapshot.player.velocity) <= 0.1 && winner.score.cutoffProgress > 0) return 'cutoff'
  if (winner.score.playerAreaReduction > 0) return 'herd'
  if (winner.score.cutoffProgress > 0) return 'cutoff'
  if (winner.score.pressureDistance < distance(enemy.position, snapshot.player.position)) return 'pursue'
  return 'observe'
}

function emptyScore(survives: 0 | 1 = 0): SnakePlanScore {
  return {
    survives,
    reachableArea: 0,
    allyClearance: 0,
    playerAreaReduction: 0,
    cutoffProgress: 0,
    pressureDistance: 0,
    steeringCost: 0,
  }
}

function safeClockValue(clock: unknown): number {
  try {
    if (typeof clock !== 'function') return 0
    const value = clock()
    return finite(value) ? value : 0
  } catch {
    return 0
  }
}

function elapsedSince(startedAt: number, clock: () => number): number {
  const endedAt = safeClockValue(clock)
  if (!finite(startedAt) || !finite(endedAt)) return 0
  const delta = endedAt - startedAt
  if (!finite(delta) || delta <= 0) return 0
  return rounded(Math.min(delta, MAX_SERIALIZED_TIMESTAMP_MS))
}

function basePlanFields(
  snapshot: SnakePlannerSnapshot | null,
  enemyId: SnakeId,
  enemy: SnakePlannerActor | undefined,
): Pick<SnakePlan,
  'enemyId' | 'role' | 'plannedAtMs' | 'stepMs' | 'originPosition' | 'originVelocity'
  | 'originMaximumSpeedPerSecond'> {
  const simulationMs = snapshot && finite(snapshot.simulationMs) ? snapshot.simulationMs : 0
  return {
    enemyId,
    role: enemy?.role ?? 'pressure',
    plannedAtMs: simulationMs,
    stepMs: 50,
    originPosition: finiteVector(enemy?.position ?? { x: 0, y: 0 })
      ? { ...(enemy?.position ?? { x: 0, y: 0 }) }
      : { x: 0, y: 0 },
    originVelocity: finiteVector(enemy?.velocity ?? { x: 0, y: 0 })
      ? { ...(enemy?.velocity ?? { x: 0, y: 0 }) }
      : { x: 0, y: 0 },
    originMaximumSpeedPerSecond: finite(enemy?.maximumSpeedPerSecond ?? 0)
      ? Math.max(0, enemy?.maximumSpeedPerSecond ?? 0)
      : 0,
  }
}

function stoppedPlan(
  snapshot: SnakePlannerSnapshot | null,
  enemyId: SnakeId,
  enemy: SnakePlannerActor | undefined,
  startedAt: number,
  clock: () => number,
  intent: SnakeIntent,
  fallback: boolean,
): SnakePlan {
  const simulationMs = snapshot && finite(snapshot.simulationMs) ? snapshot.simulationMs : 0
  return finalizePlan({
    ...basePlanFields(snapshot, enemyId, enemy),
    intent,
    direction: { x: 0, y: 0 },
    speedScale: 0,
    commandAtMs: simulationMs,
    directions: [],
    commitUntilMs: simulationMs,
    path: [],
    score: emptyScore(),
    candidateIndex: -1,
    evaluatedCandidates: fallback ? 8 : 0,
    elapsedMs: elapsedSince(startedAt, clock),
    fallback,
  })
}

function safeFallback(
  snapshot: SnakePlannerSnapshot | null,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  enemy: SnakePlannerActor | undefined,
  startedAt: number,
  clock: () => number,
): SnakePlan {
  if (
    !snapshot
    || !enemy
    || !finite(snapshot.simulationMs)
    || snapshot.simulationMs < 0
    || snapshot.simulationMs > MAX_PLANNING_TIMESTAMP_MS
    || !finiteVector(enemy.position)
    || !finite(enemy.maximumSpeedPerSecond)
    || enemy.maximumSpeedPerSecond <= 0
  ) return stoppedPlan(snapshot, enemyId, enemy, startedAt, clock, 'escape', true)

  const stepMs = 50
  const stepCount = profileIsValid(profile) ? profile.lookaheadMs / stepMs : 8
  const initialHeading = finiteVector(enemy.velocity) && magnitude(enemy.velocity) > EPSILON
    ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
    : 0
  const playerPosition = finiteVector(snapshot.player?.position) ? snapshot.player.position : null
  const toPlayer = playerPosition
    ? { x: playerPosition.x - enemy.position.x, y: playerPosition.y - enemy.position.y }
    : null
  const trailIndex = buildTrailIndex(snapshot)
  let best: { index: number; direction: SnakeVector; path: SnakeVector[]; clearance: number } | null = null
  for (let index = 0; index < 8; index += 1) {
    const heading = initialHeading + index * TWO_PI / 8
    const direction = { x: Math.cos(heading), y: Math.sin(heading) }
    if (toPlayer && direction.x * toPlayer.x + direction.y * toPlayer.y > EPSILON) continue
    const directions = Array.from({ length: stepCount }, () => direction)
    const rollout = rolloutDirections(
      enemy.position,
      finiteVector(enemy.velocity) ? enemy.velocity : { x: 0, y: 0 },
      enemy.maximumSpeedPerSecond,
      directions,
      0.5,
      stepMs,
      snapshot.field,
    )
    let start = enemy.position
    let clearance = Number.MAX_SAFE_INTEGER
    let valid = true
    for (let pathIndex = 0; pathIndex < rollout.path.length; pathIndex += 1) {
      const end = rollout.path[pathIndex]
      const atMs = snapshot.simulationMs + pathIndex * stepMs
      if (boundaryExitFraction(start, rollout.rawPath[pathIndex], snapshot, riskMargin(enemy)) !== null) {
        valid = false
        break
      }
      if (trailCollisionTime(
        trailIndex,
        enemy.id,
        start,
        end,
        atMs,
        stepMs,
        TRAIL_COLLISION_RADIUS + riskMargin(enemy),
        snapshot.simulationMs + enemy.collisionGraceMs,
      ) !== null) {
        valid = false
        break
      }
      for (const committed of Array.isArray(snapshot.committedAllyPaths)
        ? snapshot.committedAllyPaths
        : []) {
        if (committed.enemyId === enemy.id || !committedPathValid(committed)) continue
        const collisionRadius = ALLY_COLLISION_RADIUS + riskMargin(enemy)
        const overlap = sweptCommittedAllyOverlap(
          start,
          end,
          atMs,
          atMs + stepMs,
          committed,
          collisionRadius,
        )
        if (overlap && overlap.collisionAtMs !== null) {
          valid = false
          break
        }
        if (overlap) clearance = Math.min(clearance, overlap.clearance)
      }
      if (!valid) break
      clearance = Math.min(
        clearance,
        end.x - snapshot.field.padding,
        snapshot.field.width - snapshot.field.padding - end.x,
        end.y - snapshot.field.padding,
        snapshot.field.height - snapshot.field.padding - end.y,
      )
      if (playerPosition) {
        clearance = Math.min(clearance, distance(end, playerPosition) - PLAYER_HEAD_CLEARANCE)
      }
      start = end
    }
    if (!valid || !finite(clearance) || clearance <= 0) continue
    if (!best || clearance > best.clearance + EPSILON || (
      Math.abs(clearance - best.clearance) <= EPSILON && index < best.index
    )) best = { index, direction, path: rollout.path, clearance }
  }
  if (!best) return stoppedPlan(snapshot, enemyId, enemy, startedAt, clock, 'escape', true)
  const directions = Array.from({ length: best.path.length }, () => ({ ...best.direction }))
  return finalizePlan({
    ...basePlanFields(snapshot, enemyId, enemy),
    intent: 'escape',
    direction: { x: rounded(best.direction.x), y: rounded(best.direction.y) },
    speedScale: 0.5,
    commandAtMs: snapshot.simulationMs,
    directions,
    commitUntilMs: snapshot.simulationMs + (profileIsValid(profile) ? profile.commitMs : 0),
    path: best.path,
    score: { ...emptyScore(1), allyClearance: rounded(best.clearance) },
    candidateIndex: best.index,
    evaluatedCandidates: 8,
    elapsedMs: elapsedSince(startedAt, clock),
    fallback: true,
  })
}

function scoreFieldsFinite(score: SnakePlanScore): boolean {
  return (score.survives === 0 || score.survives === 1)
    && finite(score.reachableArea)
    && finite(score.allyClearance)
    && finite(score.playerAreaReduction)
    && finite(score.cutoffProgress)
    && finite(score.pressureDistance)
    && finite(score.steeringCost)
}

function reusablePlanValid(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  plan: SnakePlan,
): boolean {
  try {
  if (
    !plan
    || typeof plan !== 'object'
    || !denseArray(plan.path, MAX_PROFILE_LOOKAHEAD_MS / 50)
    || !denseArray(plan.directions, MAX_PROFILE_LOOKAHEAD_MS / 50)
  ) return false
  const expectedLength = profile.lookaheadMs / profile.rolloutStepMs
  if (
    plan.enemyId !== enemy.id
    || plan.role !== (enemy.role ?? 'pressure')
    || !INTENTS.includes(plan.intent)
    || plan.intent === 'defeated'
    || plan.fallback
    || !finiteVector(plan.direction)
    || !SPEED_SCALES.includes(plan.speedScale)
    || !finite(plan.plannedAtMs)
    || plan.plannedAtMs > snapshot.simulationMs + EPSILON
    || !finite(plan.commandAtMs)
    || plan.commandAtMs < plan.plannedAtMs
    || plan.commandAtMs > snapshot.simulationMs + EPSILON
    || plan.stepMs !== profile.rolloutStepMs
    || !finiteVector(plan.originPosition)
    || !finiteVector(plan.originVelocity)
    || !finite(plan.originMaximumSpeedPerSecond)
    || Math.abs(plan.originMaximumSpeedPerSecond - enemy.maximumSpeedPerSecond) > EPSILON
    || !finite(plan.commitUntilMs)
    || Math.abs(plan.commitUntilMs - (plan.plannedAtMs + profile.commitMs)) > EPSILON
    || snapshot.simulationMs >= plan.commitUntilMs
    || plan.path.length !== expectedLength
    || plan.directions.length !== expectedLength
    || !Number.isInteger(plan.candidateIndex)
    || plan.candidateIndex < 0
    || plan.candidateIndex >= profile.candidateCount
    || !Number.isInteger(plan.evaluatedCandidates)
    || plan.evaluatedCandidates !== profile.candidateCount
    || !finite(plan.elapsedMs)
    || plan.elapsedMs < 0
  ) return false
  let priorHeading = magnitude(plan.originVelocity) > EPSILON
    ? Math.atan2(plan.originVelocity.y, plan.originVelocity.x)
    : 0
  const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND * plan.stepMs / 1_000
  for (let index = 0; index < plan.directions.length; index += 1) {
    const direction = plan.directions[index]
    if (!finiteVector(plan.path[index])) return false
    if (!finiteVector(direction) || Math.abs(magnitude(direction) - 1) > 1e-8) return false
    const heading = Math.atan2(direction.y, direction.x)
    if (Math.abs(signedAngleDifference(priorHeading, heading)) > maximumTurn + 1e-10) return false
    priorHeading = heading
  }
  const regenerated = rolloutDirections(
    plan.originPosition,
    plan.originVelocity,
    plan.originMaximumSpeedPerSecond,
    plan.directions,
    plan.speedScale,
    plan.stepMs,
    snapshot.field,
  )
  for (let index = 0; index < plan.path.length; index += 1) {
    if (distance(plan.path[index], regenerated.path[index]) > 1e-8) return false
  }
  const commanded = sampleResourceSnakePlan(plan, plan.commandAtMs)
  if (distance(commanded.direction, plan.direction) > 1e-8) return false
  const current = sampleResourceSnakePlan(plan, snapshot.simulationMs)
  if (distance(current.position, enemy.position) > 1e-6) return false
  if (distance(current.velocity, enemy.velocity) > 1e-6) return false
  return true
  } catch {
    return false
  }
}

function hypothesisPointAt(
  snapshot: SnakePlannerSnapshot,
  path: readonly SnakeVector[],
  sampleTimesMs: readonly number[],
  relativeMs: number,
): SnakeVector {
  if (relativeMs <= 0 || path.length === 0) return snapshot.player.position
  let upperIndex = 0
  while (upperIndex < sampleTimesMs.length && sampleTimesMs[upperIndex] < relativeMs - EPSILON) {
    upperIndex += 1
  }
  if (upperIndex === 0) {
    const fraction = clamp(relativeMs / sampleTimesMs[0], 0, 1)
    return {
      x: snapshot.player.position.x + (path[0].x - snapshot.player.position.x) * fraction,
      y: snapshot.player.position.y + (path[0].y - snapshot.player.position.y) * fraction,
    }
  }
  if (upperIndex >= path.length) return path[path.length - 1]
  const lowerIndex = upperIndex - 1
  const durationMs = sampleTimesMs[upperIndex] - sampleTimesMs[lowerIndex]
  const fraction = clamp((relativeMs - sampleTimesMs[lowerIndex]) / durationMs, 0, 1)
  return {
    x: path[lowerIndex].x + (path[upperIndex].x - path[lowerIndex].x) * fraction,
    y: path[lowerIndex].y + (path[upperIndex].y - path[lowerIndex].y) * fraction,
  }
}

function plannedPathPointAt(plan: SnakePlan, atMs: number): SnakeVector {
  const offset = clamp(
    (atMs - plan.plannedAtMs) / plan.stepMs,
    0,
    plan.path.length,
  )
  const completed = Math.floor(offset)
  if (completed >= plan.path.length) return { ...(plan.path.at(-1) ?? plan.originPosition) }
  const start = completed === 0 ? plan.originPosition : plan.path[completed - 1]
  const end = plan.path[completed]
  const fraction = offset - completed
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  }
}

function earliestCertainFatalMs(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  trailIndex: TrailSpatialIndex,
): number | null {
  const planHorizonMs = plan.plannedAtMs + plan.path.length * plan.stepMs
  const remainingMs = Math.min(
    COMMIT_FATAL_OVERRIDE_MS,
    plan.commitUntilMs - snapshot.simulationMs,
    planHorizonMs - snapshot.simulationMs,
  )
  if (!finite(remainingMs) || remainingMs <= 0) return null
  const timed = createTimedPlayerHypotheses(snapshot, remainingMs, plan.stepMs)
  const playerFatal = timed.hypotheses.all.map(() => null as number | null)
  const untilMs = snapshot.simulationMs + remainingMs
  const future = getResourceSnakePlanFutureSamples(plan, snapshot.simulationMs)
    .filter((sample) => sample.atMs < untilMs - EPSILON)
  future.push({
    atMs: untilMs,
    position: plannedPathPointAt(plan, untilMs),
  })
  let start = enemy.position
  let segmentStartMs = snapshot.simulationMs
  let earliest: number | null = null
  for (const sample of future) {
    const durationMs = sample.atMs - segmentStartMs
    const end = sample.position
    const boundary = boundaryExitFraction(start, end, snapshot, riskMargin(enemy))
    if (boundary !== null) {
      const atMs = segmentStartMs + boundary * durationMs
      const fatalMs = Math.max(atMs, snapshot.simulationMs + enemy.collisionGraceMs) - snapshot.simulationMs
      earliest = earliest === null ? fatalMs : Math.min(earliest, fatalMs)
    }
    const trailAtMs = trailCollisionTime(
      trailIndex,
      enemy.id,
      start,
      end,
      segmentStartMs,
      durationMs,
      TRAIL_COLLISION_RADIUS + riskMargin(enemy),
      snapshot.simulationMs + enemy.collisionGraceMs,
    )
    if (trailAtMs !== null) {
      const fatalMs = trailAtMs - snapshot.simulationMs
      earliest = earliest === null ? fatalMs : Math.min(earliest, fatalMs)
    }
    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const overlap = sweptCommittedAllyOverlap(
        start,
        end,
        segmentStartMs,
        sample.atMs,
        committed,
        ALLY_COLLISION_RADIUS + riskMargin(enemy),
      )
      if (overlap && overlap.collisionAtMs !== null) {
        const fatalMs = overlap.collisionAtMs - snapshot.simulationMs
        earliest = earliest === null ? fatalMs : Math.min(earliest, fatalMs)
      }
    }
    const relativeStartMs = segmentStartMs - snapshot.simulationMs
    const relativeEndMs = sample.atMs - snapshot.simulationMs
    for (
      let hypothesisIndex = 0;
      hypothesisIndex < timed.hypotheses.all.length;
      hypothesisIndex += 1
    ) {
      if (playerFatal[hypothesisIndex] !== null) continue
      const hypothesis = timed.hypotheses.all[hypothesisIndex]
      const playerStart = hypothesisPointAt(
        snapshot,
        hypothesis,
        timed.sampleTimesMs,
        relativeStartMs,
      )
      const playerEnd = hypothesisPointAt(
        snapshot,
        hypothesis,
        timed.sampleTimesMs,
        relativeEndMs,
      )
      const interval = movingCircleInterval(
        start,
        end,
        playerStart,
        playerEnd,
        PLAYER_HEAD_CLEARANCE + riskMargin(enemy) * 0.5,
      )
      if (interval) playerFatal[hypothesisIndex] = relativeStartMs + interval[0] * durationMs
    }
    start = end
    segmentStartMs = sample.atMs
  }
  if (playerFatal.length > 0 && playerFatal.every((value) => value !== null)) {
    const unavoidable = Math.max(...playerFatal as number[])
    earliest = earliest === null ? unavoidable : Math.min(earliest, unavoidable)
  }
  return earliest
}

export function planResourceSnakeEnemy(
  snapshot: unknown,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  previousPlan: SnakePlan | null,
  clock: () => number = () => 0,
): SnakePlan {
  const startedAt = safeClockValue(clock)
  try {
  if (!snapshotIsValid(snapshot)) {
    const sanitized = fallbackSnapshotFromUnknown(snapshot, enemyId)
    return safeFallback(
      sanitized?.snapshot ?? null,
      enemyId,
      profile,
      sanitized?.enemy,
      startedAt,
      clock,
    )
  }
  const enemy = snapshot.enemies.find((candidate) => candidate.id === enemyId)
  if (!profileIsValid(profile)) {
    return safeFallback(snapshot, enemyId, profile, enemy, startedAt, clock)
  }
  if (!enemy || enemy.integrity <= 0) {
    return stoppedPlan(snapshot, enemyId, enemy, startedAt, clock, 'defeated', false)
  }
  const trailIndex = buildTrailIndex(snapshot)
  if (previousPlan && reusablePlanValid(snapshot, enemy, profile, previousPlan)) {
    const authoritativeScore = recomputeRetainedPlanScore(snapshot, enemy, previousPlan, trailIndex)
    const fatalInMs = authoritativeScore
      ? earliestCertainFatalMs(snapshot, enemy, previousPlan, trailIndex)
      : 0
    if (
      authoritativeScore
      && (fatalInMs === null || fatalInMs > COMMIT_FATAL_OVERRIDE_MS + EPSILON)
    ) {
      const sample = sampleResourceSnakePlan(previousPlan, snapshot.simulationMs)
      const retained = clonePlan(previousPlan, authoritativeScore)
      retained.direction = { ...sample.direction }
      retained.commandAtMs = snapshot.simulationMs
      retained.elapsedMs = elapsedSince(startedAt, clock)
      return retained
    }
  }

  const hypotheses = acquirePlayerHypotheses(
    snapshot,
    profile.lookaheadMs,
    profile.rolloutStepMs,
  )
  const collisionHypotheses = distinctHypothesisPaths(hypotheses)
  const collisionHypothesisBounds = collisionHypotheses.map(
    (path) => pathBounds(snapshot.player.position, path),
  )
  const candidates = generateInternalCandidates(enemy, profile, snapshot.field)
  const workspace = acquireGrid(snapshot)
  try {
    const horizonMs = snapshot.simulationMs + profile.lookaheadMs
    prepareOccupancyBases(snapshot, enemy, hypotheses, workspace, horizonMs, trailIndex)
    labelGridComponents(workspace, workspace.enemyBase, workspace.enemyLabels, workspace.enemyAreas)
    const hypothesisEndpoints = hypotheses.all.map(
      (hypothesis) => hypothesis.at(-1) ?? snapshot.player.position,
    )
    const baselinePlayerAreas = preparePlayerHypothesisBaselines(
      workspace,
      workspace.playerBase,
      hypothesisEndpoints,
    )
    const baseCacheId = playerBaseCacheId(workspace, hypothesisEndpoints)
    const targets = hypothesisCutoffTargets(snapshot, enemy, hypotheses)
    const scored: ScoredCandidate[] = candidates
    for (let index = 0; index < scored.length; index += 1) {
      const score = scored[index].score
      score.survives = 0
      score.reachableArea = 0
      score.allyClearance = 0
      score.playerAreaReduction = 0
      score.cutoffProgress = 0
      score.pressureDistance = 0
      score.steeringCost = scored[index].steeringCost
    }

    // Evaluate in the score's exact lexicographic order. Once a candidate has
    // lost a higher-priority component, no lower-priority computation can make
    // it win; this preserves exact comparison while avoiding redundant floods.
    let contenders: ScoredCandidate[] = []
    for (const candidate of scored) {
      if (candidateSurvives(
        snapshot,
        enemy,
        candidate,
        collisionHypotheses,
        collisionHypothesisBounds,
        trailIndex,
        profile.rolloutStepMs,
      )) {
        candidate.score.survives = 1
        contenders.push(candidate)
      }
    }
    if (contenders.length === 0) {
      return safeFallback(snapshot, enemyId, profile, enemy, startedAt, clock)
    }

    for (const candidate of contenders) {
      const endpoint = candidate.path.at(-1) ?? enemy.position
      candidate.score.reachableArea = componentAreaAt(
        workspace,
        endpoint,
        workspace.enemyLabels,
        workspace.enemyAreas,
      )
    }
    contenders = retainMaximum(contenders, (candidate) => candidate.score.reachableArea)

    for (const candidate of contenders) {
      candidate.score.allyClearance = minimumAllyClearance(
        snapshot,
        enemy,
        candidate,
        profile.rolloutStepMs,
      )
    }
    contenders = retainMaximum(contenders, (candidate) => candidate.score.allyClearance)

    for (const candidate of contenders) {
      candidate.score.playerAreaReduction = playerAreaReductionForCandidate(
        snapshot,
        candidate,
        hypotheses,
        workspace,
        baselinePlayerAreas,
        baseCacheId,
      )
    }
    contenders = retainMaximum(contenders, (candidate) => candidate.score.playerAreaReduction)

    for (const candidate of contenders) {
      candidate.score.cutoffProgress = robustCutoffProgress(
        enemy,
        candidate.path.at(-1) ?? enemy.position,
        targets,
      )
    }
    contenders = retainMaximum(contenders, (candidate) => candidate.score.cutoffProgress)

    for (const candidate of contenders) {
      candidate.score.pressureDistance = robustPressureDistance(candidate, hypotheses)
    }
    let minimumPressure = Infinity
    for (const candidate of contenders) {
      minimumPressure = Math.min(minimumPressure, candidate.score.pressureDistance)
    }
    contenders = contenders.filter((candidate) => candidate.score.pressureDistance === minimumPressure)

    let minimumSteering = Infinity
    for (const candidate of contenders) {
      minimumSteering = Math.min(minimumSteering, candidate.score.steeringCost)
    }
    contenders = contenders.filter((candidate) => candidate.score.steeringCost === minimumSteering)
    const winner = contenders.reduce((best, candidate) => (
      compareCandidates(candidate, best) > 0 ? candidate : best
    ))
    materializeCandidate(winner)
    return finalizePlan({
      ...basePlanFields(snapshot, enemyId, enemy),
      intent: deriveIntent(snapshot, enemy, winner),
      direction: { ...winner.directions[0] },
      speedScale: winner.speedScale,
      commandAtMs: snapshot.simulationMs,
      directions: winner.directions.map((direction) => ({ ...direction })),
      commitUntilMs: snapshot.simulationMs + profile.commitMs,
      path: winner.path.map((position) => ({ ...position })),
      score: serializeScore(winner.score),
      candidateIndex: winner.candidateIndex,
      evaluatedCandidates: candidates.length,
      elapsedMs: elapsedSince(startedAt, clock),
      fallback: false,
    })
  } finally {
    releaseGrid(workspace)
    releaseTrajectoryBuffer(candidates)
    releasePlayerHypotheses(hypotheses)
  }
  } catch {
    return stoppedPlan(null, enemyId, undefined, startedAt, clock, 'escape', true)
  }
}
