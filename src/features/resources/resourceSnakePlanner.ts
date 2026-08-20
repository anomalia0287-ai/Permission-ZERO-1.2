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
  /** Deterministic integrity token for authoritative trajectory/score data. */
  provenance: string
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
  buckets: Array<number[] | undefined>
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
  footprintCounts: Int32Array
  candidateCells: Int32Array
}

const gridWorkspacePool = new Map<string, GridWorkspace[]>()
const localTrajectoryTemplateCache = new Map<string, InternalTrajectoryCandidate[]>()
const trajectoryBufferPool = new Map<string, InternalTrajectoryCandidate[][]>()
const playerHypothesisPool = new Map<number, SnakePlayerHypotheses[]>()
interface PlayerBaseCacheRecord {
  id: number
  hash: number
  endpointCells: number[]
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
const playerBaseCacheRecords: PlayerBaseCacheRecord[] = []
const playerReductionCache = new Map<string, PlayerReductionCacheSlot>()
let nextPlayerBaseCacheId = 1
let cachedTrailIndex: TrailSpatialIndex | null = null

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
  return !!vector && finite(vector.x) && finite(vector.y)
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
  } catch {
    return true
  }
}

function profileIsValid(profile: SnakePlannerProfile): boolean {
  if (!profile || typeof profile !== 'object') return false
  return (profile.candidateCount === 48 || profile.candidateCount === 72 || profile.candidateCount === 96)
    && profile.rolloutStepMs === 50
    && LEGAL_PROFILE_TIERS.some(([lookaheadMs, commitMs, planningHz]) => (
      profile.lookaheadMs === lookaheadMs
      && profile.commitMs === commitMs
      && profile.planningHz === planningHz
    ))
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
        || !finiteVector(sample.position)
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
        || !finiteVector(dot.position)
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
        || !finiteVector(sample.position)
        || !finiteVector(sample.velocity)
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
      || !finite(sourceEnemy.maximumSpeedPerSecond)
      || sourceEnemy.maximumSpeedPerSecond <= 0
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
        && finiteVector(dot.position)
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
  const stepCount = Math.max(0, Math.floor(lookaheadMs / stepMs))
  const origin = snapshot.player.position
  const velocity = snapshot.player.velocity
  const speed = magnitude(velocity)
  const heading = speed > EPSILON ? Math.atan2(velocity.y, velocity.x) : 0
  const signedTurnRate = medianSignedTurnRate(relevantHistory(snapshot))
  let turningX = origin.x
  let turningY = origin.y
  const stepSeconds = stepMs / 1_000
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
    const seconds = (index + 1) * stepSeconds
    result.keepVelocity[index].x = origin.x + velocity.x * seconds
    result.keepVelocity[index].y = origin.y + velocity.y * seconds
    const turningHeading = heading + signedTurnRate * seconds
    turningX += Math.cos(turningHeading) * speed * stepSeconds
    turningY += Math.sin(turningHeading) * speed * stepSeconds
    result.continueMedianTurn[index].x = turningX
    result.continueMedianTurn[index].y = turningY
    const slowingSeconds = Math.min(seconds, 0.1)
    const displacementSeconds = slowingSeconds - slowingSeconds * slowingSeconds / 0.2
    result.decelerate[index].x = origin.x + velocity.x * displacementSeconds
    result.decelerate[index].y = origin.y + velocity.y * displacementSeconds
    result.stayStopped[index].x = origin.x
    result.stayStopped[index].y = origin.y
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
      || !finiteVector(plan.originPosition)
      || !finiteVector(plan.originVelocity)
      || !finite(plan.originMaximumSpeedPerSecond)
      || plan.originMaximumSpeedPerSecond < 0
      || !SPEED_SCALES.includes(plan.speedScale)
    ) return false
    for (let index = 0; index < plan.path.length; index += 1) {
      if (!finiteVector(plan.path[index]) || !finiteVector(plan.directions[index])) return false
    }
    return true
  } catch {
    return false
  }
}

export function sampleResourceSnakePlan(plan: SnakePlan, atMs: number): SnakePlanSample {
  if (!planTimelineValid(plan) || !finite(atMs)) {
    return {
      atMs: finite(atMs) ? atMs : 0,
      cursor: 0,
      direction: { x: 0, y: 0 },
      speedScale: 0,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
    }
  }
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
}

export function getResourceSnakePlanFutureSamples(
  plan: SnakePlan,
  fromMs: number,
): SnakeTimedPosition[] {
  if (!planTimelineValid(plan) || !finite(fromMs)) return []
  const result: SnakeTimedPosition[] = []
  for (let index = 0; index < plan.path.length; index += 1) {
    const atMs = plan.plannedAtMs + (index + 1) * plan.stepMs
    if (atMs > fromMs) result.push({ atMs, position: { ...plan.path[index] } })
  }
  return result
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
}

export function sampleResourceSnakeCommittedPath(
  committed: SnakeCommittedPath,
  atMs: number,
): SnakeTimedPosition | null {
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
  return enter <= exit && exit >= 0 && enter <= 1 ? [enter, exit] : null
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
  const buckets = new Array<number[] | undefined>(columns * rows)
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
    const bucket = buckets[bucketIndex]
    if (bucket) bucket.push(index)
    else buckets[bucketIndex] = [index]
  }
  cachedTrailIndex = {
    columns,
    rows,
    buckets,
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
      const bucket = index.buckets[y * index.columns + x]
      if (!bucket) continue
      for (let bucketIndex = 0; bucketIndex < bucket.length; bucketIndex += 1) {
        const dot = index.dots[bucket[bucketIndex]]
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
  for (let pathIndex = 0; pathIndex < candidate.path.length; pathIndex += 1) {
    const end = candidate.path[pathIndex]
    const rawEnd = candidate.rawPath[pathIndex]
    const segmentStartMs = snapshot.simulationMs + pathIndex * stepMs
    if (checkBoundary) {
      const exit = boundaryExitFraction(start, rawEnd, snapshot, margin)
      if (exit !== null) {
        const outsideAtMs = segmentStartMs + exit * stepMs
        if (Math.max(outsideAtMs, graceUntilMs) <= segmentStartMs + stepMs + EPSILON) return false
      }
    }
    if (checkTrails && trailCollisionTime(
      trailIndex,
      enemy.id,
      start,
      end,
      segmentStartMs,
      stepMs,
      TRAIL_COLLISION_RADIUS + margin,
      graceUntilMs,
    ) !== null) return false
    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const allyStart = committedPointAt(committed, segmentStartMs)
      const allyEnd = committedPointAt(committed, segmentStartMs + stepMs)
      if (allyStart && allyEnd && movingCircleInterval(
        start,
        end,
        allyStart,
        allyEnd,
        ALLY_COLLISION_RADIUS + margin,
      )) return false
    }
    if (checkPlayer) {
      for (const hypothesis of hypothesisPaths) {
        const playerStart = pathIndex === 0 ? snapshot.player.position : hypothesis[pathIndex - 1]
        const playerEnd = hypothesis[pathIndex]
        const interval = movingCircleInterval(
          start,
          end,
          playerStart,
          playerEnd,
          PLAYER_HEAD_CLEARANCE + margin * 0.5,
        )
        if (interval) {
          const collisionAtMs = segmentStartMs + interval[0] * stepMs
          if (collisionAtMs + EPSILON >= playerBothGraceUntilMs) return false
        }
      }
    }
    start = end
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
    footprintCounts: new Int32Array(size + 1),
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

function prepareOccupancyBases(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  hypotheses: SnakePlayerHypotheses,
  workspace: GridWorkspace,
  horizonMs: number,
): void {
  workspace.enemyBase.fill(0)
  workspace.playerBase.fill(0)
  const enemyMargin = riskMargin(enemy)
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
  for (const dot of snapshot.trailDots) {
    if (trailHazardousAt(dot, enemy, snapshot.simulationMs, horizonMs)) {
      markDisk(workspace.enemyBase, workspace, dot.position, TRAIL_COLLISION_RADIUS + enemyMargin)
    }
    if (trailHazardousAt(dot, snapshot.player, snapshot.simulationMs, horizonMs)) {
      markDisk(workspace.playerBase, workspace, dot.position, TRAIL_COLLISION_RADIUS)
    }
  }
  for (const committed of snapshot.committedAllyPaths) {
    const point = committedPointAt(committed, horizonMs)
    if (!point) continue
    markDisk(workspace.enemyBase, workspace, point, ALLY_COLLISION_RADIUS + enemyMargin)
    markDisk(workspace.playerBase, workspace, point, ALLY_COLLISION_RADIUS)
  }
  for (const hypothesis of hypotheses.all) {
    const point = hypothesis.at(-1)
    if (point) markDisk(workspace.enemyBase, workspace, point, PLAYER_HEAD_CLEARANCE + enemyMargin * 0.5)
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

function labelGridComponentsWithFreeOrigins(
  workspace: GridWorkspace,
  occupancy: Uint8Array,
  labels: Int32Array,
  areas: Int32Array,
  origins: readonly SnakeVector[],
): void {
  const cleared = new Int32Array(4)
  let clearedCount = 0
  for (const origin of origins) {
    const index = cellIndex(workspace, origin)
    if (index === null || !occupancy[index]) continue
    let duplicate = false
    for (let prior = 0; prior < clearedCount; prior += 1) {
      if (cleared[prior] === index) duplicate = true
    }
    if (!duplicate) {
      cleared[clearedCount] = index
      clearedCount += 1
      occupancy[index] = 0
    }
  }
  labelGridComponents(workspace, occupancy, labels, areas)
  for (let index = 0; index < clearedCount; index += 1) occupancy[cleared[index]] = 1
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
  const endpointCells = endpoints.map((endpoint) => cellIndex(workspace, endpoint) ?? -1)
  for (const record of playerBaseCacheRecords) {
    if (record.hash !== (hash >>> 0) || record.endpointCells.length !== endpointCells.length) continue
    let equal = true
    for (let index = 0; index < endpointCells.length; index += 1) {
      if (record.endpointCells[index] !== endpointCells[index]) equal = false
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
    endpointCells,
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
  if (slot.records.length < 4) {
    record = { count: 0, cells: new Int32Array(cells.length), value: 0 }
    slot.records.push(record)
  } else {
    record = slot.records[slot.nextReplacement]
    slot.nextReplacement = (slot.nextReplacement + 1) % slot.records.length
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
  for (let index = 0; index < candidate.path.length; index += 1) {
    const atMs = snapshot.simulationMs + (index + 1) * stepMs
    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const point = committedPointAt(committed, atMs)
      if (point) clearance = Math.min(clearance, distance(candidate.path[index], point))
    }
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
  workspace.footprintCounts.fill(0)
  for (let index = 0; index < candidateCellCount; index += 1) {
    const cell = workspace.candidateCells[index]
    if (!workspace.playerBase[cell]) {
      const baselineLabel = workspace.playerLabels[cell]
      if (baselineLabel > 0) workspace.footprintCounts[baselineLabel] += 1
    }
  }
  let playerAreaReduction = Number.MAX_SAFE_INTEGER
  const candidateAreas = [0, 0, 0, 0]
  for (let index = 0; index < hypotheses.all.length; index += 1) {
    const endpoint = hypotheses.all[index].at(-1) ?? snapshot.player.position
    const endpointIndex = cellIndex(workspace, endpoint)
    const baselineLabel = endpointIndex === null ? 0 : workspace.playerLabels[endpointIndex]
    let duplicateIndex = -1
    for (let prior = 0; prior < index; prior += 1) {
      const priorEndpoint = hypotheses.all[prior].at(-1) ?? snapshot.player.position
      if (priorEndpoint.x === endpoint.x && priorEndpoint.y === endpoint.y) duplicateIndex = prior
    }
    const candidateArea = duplicateIndex >= 0
      ? candidateAreas[duplicateIndex]
      : floodExactComponent(workspace, workspace.occupancy, endpoint)
    candidateAreas[index] = candidateArea
    playerAreaReduction = Math.min(
      playerAreaReduction,
      Math.max(0, baselinePlayerAreas[index] - candidateArea - workspace.footprintCounts[baselineLabel]),
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
    )
    const endpoints = hypotheses.all.map(
      (hypothesis) => hypothesis.at(-1) ?? snapshot.player.position,
    )
    labelGridComponentsWithFreeOrigins(
      workspace,
      workspace.playerBase,
      workspace.playerLabels,
      workspace.playerAreas,
      endpoints,
    )
    const baselineAreas = endpoints.map((endpoint) => componentAreaAt(
      workspace,
      endpoint,
      workspace.playerLabels,
      workspace.playerAreas,
    ))
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

type SnakePlanWithoutProvenance = Omit<SnakePlan, 'provenance'>

const provenanceNumberBuffer = new ArrayBuffer(8)
const provenanceNumberView = new DataView(provenanceNumberBuffer)
const provenanceNumberBytes = new Uint8Array(provenanceNumberBuffer)

function computePlanProvenance(plan: SnakePlanWithoutProvenance | SnakePlan): string {
  let primary = 0x811c9dc5
  let secondary = 0x9e3779b9
  const addByte = (value: number) => {
    primary = Math.imul(primary ^ value, 0x01000193) >>> 0
    secondary = Math.imul(secondary ^ value, 0x85ebca6b) >>> 0
  }
  const addNumber = (value: number) => {
    provenanceNumberView.setFloat64(0, value, true)
    for (let index = 0; index < provenanceNumberBytes.length; index += 1) {
      addByte(provenanceNumberBytes[index])
    }
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
  for (let index = 0; index < plan.directions.length; index += 1) {
    addNumber(plan.directions[index].x)
    addNumber(plan.directions[index].y)
  }
  addNumber(plan.commitUntilMs)
  addNumber(plan.path.length)
  for (let index = 0; index < plan.path.length; index += 1) {
    addNumber(plan.path[index].x)
    addNumber(plan.path[index].y)
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

function finalizePlan(plan: SnakePlanWithoutProvenance): SnakePlan {
  return { ...plan, provenance: computePlanProvenance(plan) }
}

function clonePlan(plan: SnakePlan): SnakePlan {
  return {
    ...plan,
    direction: { ...plan.direction },
    originPosition: { ...plan.originPosition },
    originVelocity: { ...plan.originVelocity },
    directions: plan.directions.map((direction) => ({ ...direction })),
    path: plan.path.map((position) => ({ ...position })),
    score: { ...plan.score },
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

function elapsedSince(startedAt: number, clock: () => number): number {
  const endedAt = clock()
  return finite(startedAt) && finite(endedAt) ? rounded(Math.max(0, endedAt - startedAt)) : 0
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
        const allyStart = committedPointAt(committed, atMs)
        const allyEnd = committedPointAt(committed, atMs + stepMs)
        if (!allyStart || !allyEnd) continue
        const collisionRadius = ALLY_COLLISION_RADIUS + riskMargin(enemy)
        if (movingCircleInterval(start, end, allyStart, allyEnd, collisionRadius)) {
          valid = false
          break
        }
        clearance = Math.min(
          clearance,
          movingCircleMinimumDistance(start, end, allyStart, allyEnd) - collisionRadius,
        )
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
    || !plan.score
    || typeof plan.score !== 'object'
    || typeof plan.provenance !== 'string'
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
    || plan.score.survives !== 1
    || !scoreFieldsFinite(plan.score)
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
  if (plan.provenance !== computePlanProvenance(plan)) return false
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
  relativeMs: number,
  stepMs: number,
): SnakeVector {
  if (relativeMs <= 0 || path.length === 0) return snapshot.player.position
  const offset = relativeMs / stepMs
  const lowerSample = Math.floor(offset)
  if (lowerSample <= 0) {
    const fraction = clamp(offset, 0, 1)
    return {
      x: snapshot.player.position.x + (path[0].x - snapshot.player.position.x) * fraction,
      y: snapshot.player.position.y + (path[0].y - snapshot.player.position.y) * fraction,
    }
  }
  const lowerIndex = Math.min(lowerSample - 1, path.length - 1)
  const upperIndex = Math.min(lowerSample, path.length - 1)
  const fraction = clamp(offset - lowerSample, 0, 1)
  return {
    x: path[lowerIndex].x + (path[upperIndex].x - path[lowerIndex].x) * fraction,
    y: path[lowerIndex].y + (path[upperIndex].y - path[lowerIndex].y) * fraction,
  }
}

function earliestCertainFatalMs(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  trailIndex: TrailSpatialIndex,
): number | null {
  const remainingMs = Math.max(0, plan.plannedAtMs + plan.path.length * plan.stepMs - snapshot.simulationMs)
  const hypotheses = predictResourceSnakePlayerHypotheses(snapshot, remainingMs, plan.stepMs)
  const playerFatal = hypotheses.all.map(() => null as number | null)
  const future = getResourceSnakePlanFutureSamples(plan, snapshot.simulationMs)
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
      const allyStart = committedPointAt(committed, segmentStartMs)
      const allyEnd = committedPointAt(committed, sample.atMs)
      const interval = allyStart && allyEnd
        ? movingCircleInterval(start, end, allyStart, allyEnd, ALLY_COLLISION_RADIUS + riskMargin(enemy))
        : null
      if (interval) {
        const fatalMs = segmentStartMs + interval[0] * durationMs - snapshot.simulationMs
        earliest = earliest === null ? fatalMs : Math.min(earliest, fatalMs)
      }
    }
    const relativeStartMs = segmentStartMs - snapshot.simulationMs
    const relativeEndMs = sample.atMs - snapshot.simulationMs
    for (let hypothesisIndex = 0; hypothesisIndex < hypotheses.all.length; hypothesisIndex += 1) {
      if (playerFatal[hypothesisIndex] !== null) continue
      const hypothesis = hypotheses.all[hypothesisIndex]
      const playerStart = hypothesisPointAt(snapshot, hypothesis, relativeStartMs, plan.stepMs)
      const playerEnd = hypothesisPointAt(snapshot, hypothesis, relativeEndMs, plan.stepMs)
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
  const startedAt = clock()
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
    const fatalInMs = earliestCertainFatalMs(snapshot, enemy, previousPlan, trailIndex)
    if (fatalInMs === null || fatalInMs > COMMIT_FATAL_OVERRIDE_MS + EPSILON) {
      const sample = sampleResourceSnakePlan(previousPlan, snapshot.simulationMs)
      const retained = clonePlan(previousPlan)
      retained.direction = { ...sample.direction }
      retained.commandAtMs = snapshot.simulationMs
      retained.elapsedMs = elapsedSince(startedAt, clock)
      retained.provenance = computePlanProvenance(retained)
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
    prepareOccupancyBases(snapshot, enemy, hypotheses, workspace, horizonMs)
    labelGridComponents(workspace, workspace.enemyBase, workspace.enemyLabels, workspace.enemyAreas)
    const hypothesisEndpoints = hypotheses.all.map(
      (hypothesis) => hypothesis.at(-1) ?? snapshot.player.position,
    )
    labelGridComponentsWithFreeOrigins(
      workspace,
      workspace.playerBase,
      workspace.playerLabels,
      workspace.playerAreas,
      hypothesisEndpoints,
    )
    const baselinePlayerAreas: number[] = []
    for (let index = 0; index < hypotheses.all.length; index += 1) {
      const endpoint = hypotheses.all[index].at(-1) ?? snapshot.player.position
      let duplicateIndex = -1
      for (let prior = 0; prior < index; prior += 1) {
        const priorEndpoint = hypotheses.all[prior].at(-1) ?? snapshot.player.position
        if (priorEndpoint.x === endpoint.x && priorEndpoint.y === endpoint.y) {
          duplicateIndex = prior
          break
        }
      }
      if (duplicateIndex >= 0) {
        baselinePlayerAreas.push(baselinePlayerAreas[duplicateIndex])
      } else {
        baselinePlayerAreas.push(componentAreaAt(
          workspace,
          endpoint,
          workspace.playerLabels,
          workspace.playerAreas,
        ))
      }
    }
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
}
