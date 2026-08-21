import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import { SNAKE_DIRECTION_VECTORS } from './resourceSnakeInput'
import type {
  SnakeCommittedPath,
  SnakeEnemyRole,
  SnakeGroupPlan,
  SnakeIntent,
  SnakePlan,
  SnakePlannerActor,
  SnakePlannerSnapshot,
  SnakePlannerTrailDot,
  SnakePlanSample,
  SnakePlanScore,
  SnakePlanSpeedScale,
  SnakePlayerHistorySample,
  SnakePlayerHypotheses,
  SnakeTimedPosition,
  SnakeTrajectoryCandidate,
  SnakeId,
  SnakeVector,
} from './resourceSnakePlannerTypes'
import {
  generateResourceSnakeLightcycleCandidates,
  getResourceSnakeTrajectoryFutureSamples,
  legalResourceSnakeHeadings,
  resourceSnakeTrajectoryPlanToCommittedPath,
  resourceSnakeHeadingFromVector,
  sampleResourceSnakeTrajectoryCommittedPath,
  sampleResourceSnakeTrajectoryPlan,
} from './resourceSnakeTrajectory'

export type {
  SnakeCommittedPath,
  SnakeEnemyRole,
  SnakeGroupPlan,
  SnakeIntent,
  SnakePlan,
  SnakePlannerActor,
  SnakePlannerSnapshot,
  SnakePlannerTrailDot,
  SnakePlanSample,
  SnakePlanScore,
  SnakePlanSpeedScale,
  SnakePlayerHistorySample,
  SnakePlayerHypotheses,
  SnakeTimedPosition,
  SnakeTrajectoryCandidate,
  SnakeId,
  SnakeVector,
} from './resourceSnakePlannerTypes'

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
const TRAIL_SAMPLE_SPACING = 0.32
const PLAYER_HEAD_CLEARANCE = 1.1
const PLAYER_HEAD_REPAIR_CLEARANCE = 1.25
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
const LEGAL_PLAN_SPEED_SCALES: readonly SnakePlanSpeedScale[] = [1, 0.92, 0.5, 0]
const ADAPTIVE_CANDIDATE_BUDGETS = [48, 72, 96] as const
const GROUP_ENDPOINT_SEPARATION = 1.2
const GROUP_EXIT_SECTOR_COUNT = 8
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
  [1_000, 420, 6, 48],
  [1_400, 360, 7, 72],
  [1_600, 320, 8, 72],
  [2_000, 260, 9, 96],
  [2_500, 220, 10, 96],
  [1_400, 260, 10, 48],
  [1_800, 220, 12, 72],
  [2_200, 180, 14, 96],
] as const

function cyanTelegraphMs(profile: SnakePlannerProfile): number {
  if (profile.lookaheadMs === 1_400 && profile.commitMs === 260 && profile.planningHz === 10) {
    return 220
  }
  if (profile.lookaheadMs === 1_800 && profile.commitMs === 220 && profile.planningHz === 12) {
    return 190
  }
  if (profile.lookaheadMs === 2_200 && profile.commitMs === 180 && profile.planningHz === 14) {
    return 160
  }
  return 0
}

interface InternalTrajectoryCandidate extends SnakeTrajectoryCandidate {
  rawPath: SnakeVector[]
  steeringCost: number
  bounds: PathBounds
  rawBounds: PathBounds
  localDirectionCoordinates?: Float64Array
  localRawPathCoordinates?: Float64Array
  transformOrigin?: SnakeVector
  transformCosine?: number
  transformSine?: number
  transformField?: SnakePlannerSnapshot['field']
  pathMaterializedSteps?: number
  pathMaterialized?: boolean
  materialized?: boolean
  segmentDurationsMs?: readonly number[]
  generatedSelfMinimumDistanceSquared?: number
  score: SnakePlanScore
}

type ScoredCandidate = InternalTrajectoryCandidate

interface GroupCandidateConstraints {
  endpointSeparationFrom?: SnakeVector
  endpointSeparation?: number
  exitSectorOrigin?: SnakeVector
  forbiddenExitSector?: number
  offensiveEndpointTarget?: SnakeVector
  preferTopBoundaryTrace?: boolean
  preferredCandidateIndex?: number
  trajectoryOverride?: InternalTrajectoryCandidate
  trajectoryOverrides?: readonly InternalTrajectoryCandidate[]
  emergencyTrajectoryOverrides?: readonly InternalTrajectoryCandidate[]
  trajectoryCorridor?: readonly SnakeVector[]
  trajectoryCorridorRadius?: number
  minimumSpeedScale?: 0.5 | 1
}

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
  occupiedRows: Uint8Array
  occupiedRowPrefix: Int16Array
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
  candidateVisitMarks: Uint32Array
  candidateGeneration: number
  occupancyBaseCache: OccupancyBaseCache | null
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
  playerBaseId: number | null
  enemyLabels: Int32Array | null
  enemyAreas: Int32Array | null
  playerLabels: Int32Array | null
  playerAreas: Int32Array | null
  playerBaselineMemberships: Uint8Array[] | null
  playerBaselineAreas: number[] | null
  singlePlayerBaselineComponent: number
}

const gridWorkspacePool = new Map<string, GridWorkspace[]>()
const trajectoryBufferPool = new Map<string, InternalTrajectoryCandidate[][]>()
const playerHypothesisPool = new Map<number, SnakePlayerHypotheses[]>()
const relevantHistoryPool: SnakePlayerHistorySample[][] = []
const turnRatePool: number[][] = []
interface PlayerBaseCacheRecord {
  id: number
  hash: number
  endpointCoordinates: number[]
  occupancy: Uint8Array
}
interface PlayerReductionCacheRecord {
  count: number
  hash: number
  cells: Int32Array
  value: number
}
interface PlayerReductionCacheSlot {
  records: PlayerReductionCacheRecord[]
  nextReplacement: number
}
const PLAYER_REDUCTION_PATTERNS_PER_CANDIDATE = 16
const PLAYER_BASE_CACHE_RECORD_LIMIT = 4
const playerBaseCacheRecords: PlayerBaseCacheRecord[] = []
const playerReductionCache = new Map<string, PlayerReductionCacheSlot>()
let nextPlayerBaseCacheId = 1
let cachedTrailIndex: TrailSpatialIndex | null = null
let cachedOccupancyBases: OccupancyBaseCache | null = null
let validatedTrailIndexHint: {
  source: readonly SnakePlannerTrailDot[]
  index: TrailSpatialIndex
} | null = null

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function enemyIdValid(value: unknown): value is SnakeId {
  return typeof value === 'string' && /^enemy-(?:0|[1-9]\d*)$/.test(value)
}

function snakeIdValid(value: unknown): value is SnakeId {
  return value === 'player' || enemyIdValid(value)
}

function enemyRoleValid(value: unknown): value is SnakeEnemyRole {
  return value === 'pressure' || value === 'blocker'
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

function groupExitSector(origin: SnakeVector, endpoint: SnakeVector): number {
  const angle = Math.atan2(endpoint.y - origin.y, endpoint.x - origin.x)
  return (
    Math.round(angle / (TWO_PI / GROUP_EXIT_SECTOR_COUNT))
    + GROUP_EXIT_SECTOR_COUNT
  ) % GROUP_EXIT_SECTOR_COUNT
}

function satisfiesGroupCandidateConstraints(
  endpoint: SnakeVector | undefined,
  constraints: GroupCandidateConstraints | undefined,
): boolean {
  if (!constraints) return true
  if (!endpoint) return false
  const separationSatisfied = !constraints.endpointSeparationFrom
    || constraints.endpointSeparation === undefined
    || distance(endpoint, constraints.endpointSeparationFrom) + EPSILON
      >= constraints.endpointSeparation
  const sectorSatisfied = !constraints.exitSectorOrigin
    || constraints.forbiddenExitSector === undefined
    || groupExitSector(constraints.exitSectorOrigin, endpoint)
      !== constraints.forbiddenExitSector
  return separationSatisfied && sectorSatisfied
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

function actorHasInvalidNumber(actor: SnakePlannerActor | null | undefined): boolean {
  try {
    return !actor
      || typeof actor !== 'object'
      || !snakeIdValid(actor.id)
      || (actor.id === 'player' ? actor.role !== null : !enemyRoleValid(actor.role))
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
      || (
        actor.distanceSinceTrailDot !== undefined
        && (
          !finite(actor.distanceSinceTrailDot)
          || actor.distanceSinceTrailDot < 0
          || actor.distanceSinceTrailDot >= TRAIL_SAMPLE_SPACING
        )
      )
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
      && LEGAL_PROFILE_TIERS.some(([lookaheadMs, commitMs, planningHz, candidateCount]) => (
        profile.lookaheadMs === lookaheadMs
        && profile.commitMs === commitMs
        && profile.planningHz === planningHz
        && profile.candidateCount === candidateCount
      ))
  } catch {
    return false
  }
}

function committedPathValid(path: unknown): path is SnakeCommittedPath {
  try {
    if (
      !path
      || typeof path !== 'object'
      || !enemyIdValid((path as SnakeCommittedPath).enemyId)
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
  validatedTrailIndexHint = null
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
      || snapshot.player.id !== 'player'
    ) return false
    for (let index = 0; index < snapshot.enemies.length; index += 1) {
      if (
        actorHasInvalidNumber(snapshot.enemies[index])
        || !enemyIdValid(snapshot.enemies[index].id)
      ) return false
    }
    let trailIndexMatches = !!cachedTrailIndex
      && cachedTrailIndex.dots.length === snapshot.trailDots.length
    for (let index = 0; index < snapshot.trailDots.length; index += 1) {
      const dot = snapshot.trailDots[index]
      if (
        !dot
        || typeof dot !== 'object'
        || !finite(dot.id)
        || !snakeIdValid(dot.ownerId)
        || !coordinateVectorSafe(dot.position)
        || !finite(dot.spawnedAtMs)
        || !finite(dot.expiresAtMs)
        || dot.spawnedAtMs < 0
        || dot.expiresAtMs > MAX_SERIALIZED_TIMESTAMP_MS
        || dot.expiresAtMs < dot.spawnedAtMs
      ) return false
      if (trailIndexMatches) {
        const cached = cachedTrailIndex!.dots[index]
        if (
          cached.id !== dot.id
          || cached.ownerId !== dot.ownerId
          || cached.position.x !== dot.position.x
          || cached.position.y !== dot.position.y
          || cached.spawnedAtMs !== dot.spawnedAtMs
          || cached.expiresAtMs !== dot.expiresAtMs
        ) trailIndexMatches = false
      }
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
    if (trailIndexMatches && cachedTrailIndex) {
      validatedTrailIndexHint = { source: snapshot.trailDots, index: cachedTrailIndex }
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
        distanceSinceTrailDot: actor.distanceSinceTrailDot !== undefined
          && finite(actor.distanceSinceTrailDot)
          ? clamp(actor.distanceSinceTrailDot, 0, TRAIL_SAMPLE_SPACING - EPSILON)
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
        && snakeIdValid(dot.ownerId)
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

function medianSignedTurnRate(snapshot: SnakePlannerSnapshot): number {
  const samples = relevantHistoryPool.pop() ?? []
  const values = turnRatePool.pop() ?? []
  samples.length = 0
  values.length = 0
  try {
    const earliest = snapshot.simulationMs - 2_000
    for (let index = 0; index < snapshot.playerHistory.length; index += 1) {
      const sample = snapshot.playerHistory[index]
      if (sample.simulationMs >= earliest && sample.simulationMs <= snapshot.simulationMs) {
        samples.push(sample)
      }
    }
    samples.sort((left, right) => left.simulationMs - right.simulationMs)
    for (let index = 1; index < samples.length; index += 1) {
      const prior = samples[index - 1]
      const current = samples[index]
      const seconds = (current.simulationMs - prior.simulationMs) / 1_000
      if (
        seconds <= 0
        || magnitude(prior.velocity) <= EPSILON
        || magnitude(current.velocity) <= EPSILON
      ) continue
      values.push(signedAngleDifference(
        Math.atan2(prior.velocity.y, prior.velocity.x),
        Math.atan2(current.velocity.y, current.velocity.x),
      ) / seconds)
    }
    if (values.length === 0) return 0
    values.sort((left, right) => left - right)
    const middle = Math.floor(values.length / 2)
    return values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle]
  } finally {
    samples.length = 0
    values.length = 0
    relevantHistoryPool.push(samples)
    turnRatePool.push(values)
  }
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
  const signedTurnRate = medianSignedTurnRate(snapshot)
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
  speedScale: SnakePlanSpeedScale,
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
  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  const generated = generateResourceSnakeLightcycleCandidates({
    actor: enemy,
    profile,
    telegraphMs: cyanTelegraphMs(profile),
    field,
  })
  const result = acquireTrajectoryBuffer(profile.candidateCount, stepCount)
  for (let candidateIndex = 0; candidateIndex < generated.length; candidateIndex += 1) {
    const source = generated[candidateIndex]
    const candidate = result[candidateIndex]
    candidate.candidateIndex = source.candidateIndex
    candidate.speedScale = source.speedScale
    candidate.steeringCost = source.steeringCost
    candidate.originHeading = source.originHeading
    candidate.attackHeading = source.attackHeading
    candidate.headingChanges = source.headingChanges.map((change) => ({ ...change }))
    candidate.localDirectionCoordinates = undefined
    candidate.localRawPathCoordinates = undefined
    candidate.transformOrigin = undefined
    candidate.transformCosine = undefined
    candidate.transformSine = undefined
    candidate.transformField = undefined
    candidate.pathMaterializedSteps = stepCount
    candidate.pathMaterialized = true
    candidate.materialized = true
    candidate.segmentDurationsMs = undefined
    candidate.generatedSelfMinimumDistanceSquared = undefined
    for (let step = 0; step < stepCount; step += 1) {
      candidate.directions[step].x = source.directions[step].x
      candidate.directions[step].y = source.directions[step].y
      candidate.path[step].x = source.path[step].x
      candidate.path[step].y = source.path[step].y
      candidate.rawPath[step].x = source.rawPath[step].x
      candidate.rawPath[step].y = source.rawPath[step].y
    }
    Object.assign(candidate.bounds, pathBounds(enemy.position, candidate.path))
    Object.assign(candidate.rawBounds, pathBounds(enemy.position, candidate.rawPath))
  }
  return result
}

function materializeCandidatePathThrough(
  candidate: InternalTrajectoryCandidate,
  inclusiveStep: number,
): void {
  if (candidate.pathMaterialized) return
  const localRawPathCoordinates = candidate.localRawPathCoordinates
  const origin = candidate.transformOrigin
  const cosine = candidate.transformCosine
  const sine = candidate.transformSine
  if (!localRawPathCoordinates || !origin || cosine === undefined || sine === undefined) return
  const field = candidate.transformField
  const until = Math.min(candidate.path.length, inclusiveStep + 1)
  const from = candidate.pathMaterializedSteps ?? 0
  for (let step = from; step < until; step += 1) {
    const offset = step * 2
    const localX = localRawPathCoordinates[offset]
    const localY = localRawPathCoordinates[offset + 1]
    const rawX = origin.x + localX * cosine - localY * sine
    const rawY = origin.y + localX * sine + localY * cosine
    candidate.rawPath[step].x = rawX
    candidate.rawPath[step].y = rawY
    candidate.path[step].x = field ? clamp(rawX, field.padding, field.width - field.padding) : rawX
    candidate.path[step].y = field ? clamp(rawY, field.padding, field.height - field.padding) : rawY
  }
  candidate.pathMaterializedSteps = Math.max(from, until)
  candidate.pathMaterialized = candidate.pathMaterializedSteps >= candidate.path.length
}

function materializeCandidatePath(candidate: InternalTrajectoryCandidate): void {
  materializeCandidatePathThrough(candidate, candidate.path.length - 1)
}

function pathFollowsGroupTrajectoryCorridor(
  path: readonly SnakeVector[],
  constraints: GroupCandidateConstraints | undefined,
): boolean {
  const corridor = constraints?.trajectoryCorridor
  if (!corridor) return true
  const comparisonSteps = Math.min(20, path.length, corridor.length)
  if (comparisonSteps === 0) return false
  const radius = constraints?.trajectoryCorridorRadius ?? 0.1
  for (let index = 0; index < comparisonSteps; index += 1) {
    if (distance(path[index], corridor[index]) > radius + EPSILON) return false
  }
  return true
}

function candidateFollowsGroupTrajectoryCorridor(
  candidate: InternalTrajectoryCandidate,
  constraints: GroupCandidateConstraints | undefined,
): boolean {
  if (!constraints?.trajectoryCorridor) return true
  materializeCandidatePathThrough(candidate, 19)
  return pathFollowsGroupTrajectoryCorridor(candidate.path, constraints)
}

function materializeCandidate(candidate: InternalTrajectoryCandidate): void {
  if (candidate.materialized) return
  materializeCandidatePath(candidate)
  const localDirectionCoordinates = candidate.localDirectionCoordinates
  const cosine = candidate.transformCosine
  const sine = candidate.transformSine
  if (!localDirectionCoordinates || cosine === undefined || sine === undefined) return
  for (let step = 0; step < candidate.directions.length; step += 1) {
    const offset = step * 2
    const localX = localDirectionCoordinates[offset]
    const localY = localDirectionCoordinates[offset + 1]
    candidate.directions[step].x = localX * cosine - localY * sine
    candidate.directions[step].y = localX * sine + localY * cosine
  }
  candidate.materialized = true
}

function acquireTrajectoryBuffer(candidateCount: number, stepCount: number): InternalTrajectoryCandidate[] {
  const key = `${candidateCount}:${stepCount}`
  const pooled = trajectoryBufferPool.get(key)?.pop()
  if (pooled) return pooled
  return Array.from({ length: candidateCount }, (_, candidateIndex) => ({
    candidateIndex,
    speedScale: 1,
    directions: Array.from({ length: stepCount }, () => ({ x: 0, y: 0 })),
    path: Array.from({ length: stepCount }, () => ({ x: 0, y: 0 })),
    rawPath: Array.from({ length: stepCount }, () => ({ x: 0, y: 0 })),
    steeringCost: 0,
    bounds: { minimumX: 0, maximumX: 0, minimumY: 0, maximumY: 0 },
    rawBounds: { minimumX: 0, maximumX: 0, minimumY: 0, maximumY: 0 },
    pathMaterializedSteps: 0,
    pathMaterialized: false,
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
          originHeading: candidate.originHeading,
          attackHeading: candidate.attackHeading,
          headingChanges: candidate.headingChanges?.map((change) => ({ ...change })),
        }
      })
    } finally {
      releaseTrajectoryBuffer(candidates)
    }
  } catch {
    return []
  }
}

function planTimelineValid(value: unknown): value is SnakePlan {
  try {
    if (!value || typeof value !== 'object') return false
    const plan = value as SnakePlan
    if (
      !denseArray(plan.path, MAX_PROFILE_LOOKAHEAD_MS / 50)
      || !denseArray(plan.directions, MAX_PROFILE_LOOKAHEAD_MS / 50)
      || !enemyIdValid(plan.enemyId)
      || !enemyRoleValid(plan.role)
      || !INTENTS.includes(plan.intent)
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
      || !LEGAL_PLAN_SPEED_SCALES.includes(plan.speedScale)
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
  return sampleResourceSnakeTrajectoryPlan(plan, atMs)
}

export function getResourceSnakePlanFutureSamples(
  plan: SnakePlan,
  fromMs: number,
): SnakeTimedPosition[] {
  return getResourceSnakeTrajectoryFutureSamples(plan, fromMs)
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
  return resourceSnakeTrajectoryPlanToCommittedPath(plan, fromMs)
}

export function sampleResourceSnakeCommittedPath(
  committed: SnakeCommittedPath,
  atMs: number,
): SnakeTimedPosition | null {
  return sampleResourceSnakeTrajectoryCommittedPath(committed, atMs)
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
  if (validatedTrailIndexHint?.source === snapshot.trailDots) {
    return validatedTrailIndexHint.index
  }
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
  const occupiedRows = new Uint8Array(rows)
  for (let index = 0; index < bucketCounts.length; index += 1) {
    bucketOffsets[index + 1] = bucketOffsets[index] + bucketCounts[index]
    if (bucketCounts[index] > 0) occupiedRows[Math.floor(index / columns)] = 1
  }
  const occupiedRowPrefix = new Int16Array(rows + 1)
  for (let row = 0; row < rows; row += 1) {
    occupiedRowPrefix[row + 1] = occupiedRowPrefix[row] + occupiedRows[row]
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
    occupiedRows,
    occupiedRowPrefix,
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
  const minimumY = clamp(Math.floor((Math.min(start.y, end.y) - radius) / SPATIAL_CELL_SIZE), 0, index.rows - 1)
  const maximumY = clamp(Math.floor((Math.max(start.y, end.y) + radius) / SPATIAL_CELL_SIZE), 0, index.rows - 1)
  if (index.occupiedRowPrefix[maximumY + 1] === index.occupiedRowPrefix[minimumY]) return null
  const minimumX = clamp(Math.floor((Math.min(start.x, end.x) - radius) / SPATIAL_CELL_SIZE), 0, index.columns - 1)
  const maximumX = clamp(Math.floor((Math.max(start.x, end.x) + radius) / SPATIAL_CELL_SIZE), 0, index.columns - 1)
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  let earliest: number | null = null
  for (let y = minimumY; y <= maximumY; y += 1) {
    if (!index.occupiedRows[y]) continue
    for (let x = minimumX; x <= maximumX; x += 1) {
      const bucket = y * index.columns + x
      const bucketEnd = index.bucketOffsets[bucket + 1]
      for (
        let bucketOffset = index.bucketOffsets[bucket];
        bucketOffset < bucketEnd;
        bucketOffset += 1
      ) {
        const dot = index.dots[index.bucketDotIndices[bucketOffset]]
        const offsetX = start.x - dot.position.x
        const offsetY = start.y - dot.position.y
        const radiusDelta = offsetX * offsetX + offsetY * offsetY - radius * radius
        let enter: number
        let exit: number
        if (lengthSquared <= EPSILON) {
          if (radiusDelta > 0) continue
          enter = 0
          exit = 1
        } else {
          const projection = 2 * (offsetX * deltaX + offsetY * deltaY)
          const discriminant = projection * projection - 4 * lengthSquared * radiusDelta
          if (discriminant < 0) continue
          const root = Math.sqrt(discriminant)
          const first = (-projection - root) / (2 * lengthSquared)
          const second = (-projection + root) / (2 * lengthSquared)
          enter = radiusDelta <= 0 ? 0 : Math.max(0, first)
          exit = Math.min(1, second)
          if (
            enter > exit + EPSILON
            || exit < -EPSILON
            || enter > 1 + EPSILON
          ) continue
          enter = clamp(enter, 0, 1)
          exit = clamp(exit, 0, 1)
        }
        const insideStartMs = segmentStartMs + enter * segmentDurationMs
        const insideEndMs = segmentStartMs + exit * segmentDurationMs
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

interface CommittedAllySweepCursor {
  sampleIndex: number
}

function committedSweepPointAt(
  committed: SnakeCommittedPath,
  atMs: number,
  cursor: CommittedAllySweepCursor,
): SnakeVector {
  const samples = committed.samples
  let index = clamp(cursor.sampleIndex, 0, samples.length - 1)
  while (index > 0 && samples[index].atMs > atMs + EPSILON) index -= 1
  while (index + 1 < samples.length && samples[index + 1].atMs <= atMs + EPSILON) index += 1
  cursor.sampleIndex = index
  const lower = samples[index]
  const upper = samples[Math.min(index + 1, samples.length - 1)]
  if (upper.atMs <= lower.atMs + EPSILON || atMs <= lower.atMs + EPSILON) {
    return lower.position
  }
  const fraction = clamp((atMs - lower.atMs) / (upper.atMs - lower.atMs), 0, 1)
  return {
    x: lower.position.x + (upper.position.x - lower.position.x) * fraction,
    y: lower.position.y + (upper.position.y - lower.position.y) * fraction,
  }
}

function sweptCommittedAllyOverlap(
  actorStart: SnakeVector,
  actorEnd: SnakeVector,
  segmentStartMs: number,
  segmentEndMs: number,
  committed: SnakeCommittedPath,
  collisionRadius: number,
  cursor: CommittedAllySweepCursor = { sampleIndex: 0 },
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
  let intervalStartMs = overlapStartMs
  let actorIntervalStart = actorAt(intervalStartMs)
  let allyIntervalStart = committedSweepPointAt(committed, intervalStartMs, cursor)
  let collisionAtMs: number | null = null
  let clearance = Infinity
  while (intervalStartMs < overlapEndMs - EPSILON) {
    const nextSampleAtMs = committed.samples[cursor.sampleIndex + 1]?.atMs ?? Infinity
    const intervalEndMs = Math.min(overlapEndMs, nextSampleAtMs)
    const actorIntervalEnd = actorAt(intervalEndMs)
    const allyIntervalEnd = committedSweepPointAt(committed, intervalEndMs, cursor)
    const collision = movingCircleInterval(
      actorIntervalStart,
      actorIntervalEnd,
      allyIntervalStart,
      allyIntervalEnd,
      collisionRadius,
    )
    if (collision) {
      const atMs = intervalStartMs + collision[0] * (intervalEndMs - intervalStartMs)
      if (atMs < overlapEndMs - EPSILON) {
        collisionAtMs = collisionAtMs === null ? atMs : Math.min(collisionAtMs, atMs)
      }
    }
    clearance = Math.min(
      clearance,
      movingCircleMinimumDistance(
        actorIntervalStart,
        actorIntervalEnd,
        allyIntervalStart,
        allyIntervalEnd,
      ) - collisionRadius,
    )
    if (intervalEndMs <= intervalStartMs + EPSILON) break
    intervalStartMs = intervalEndMs
    actorIntervalStart = actorIntervalEnd
    allyIntervalStart = allyIntervalEnd
  }
  return { collisionAtMs, clearance }
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

function squaredPointSegmentDistance(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): number {
  const deltaX = endX - startX
  const deltaY = endY - startY
  const divisor = deltaX * deltaX + deltaY * deltaY
  const fraction = divisor <= EPSILON
    ? 0
    : clamp(((pointX - startX) * deltaX + (pointY - startY) * deltaY) / divisor, 0, 1)
  const closestX = startX + deltaX * fraction
  const closestY = startY + deltaY * fraction
  const offsetX = pointX - closestX
  const offsetY = pointY - closestY
  return offsetX * offsetX + offsetY * offsetY
}

interface GeneratedTrailSample {
  x: number
  y: number
  spawnedAtMs: number
}

function generatedTrailSamples(
  pathLength: number,
  coordinateX: (index: number) => number,
  coordinateY: (index: number) => number,
  segmentStartMs: (index: number) => number,
  segmentEndMs: (index: number) => number,
  initialDistanceSinceTrailDot: number,
): GeneratedTrailSample[] {
  let distanceSinceTrailDot = clamp(
    initialDistanceSinceTrailDot,
    0,
    TRAIL_SAMPLE_SPACING - EPSILON,
  )
  const samples: GeneratedTrailSample[] = []
  for (let index = 0; index < pathLength; index += 1) {
    const startX = coordinateX(index - 1)
    const startY = coordinateY(index - 1)
    const endX = coordinateX(index)
    const endY = coordinateY(index)
    const deltaX = endX - startX
    const deltaY = endY - startY
    const traveled = Math.hypot(deltaX, deltaY)
    if (traveled <= EPSILON) continue
    const available = distanceSinceTrailDot + traveled
    let remaining = available
    let traveledFromStart = 0
    while (remaining + EPSILON >= TRAIL_SAMPLE_SPACING) {
      const distanceToDot = TRAIL_SAMPLE_SPACING - (remaining - traveled)
      traveledFromStart = Math.max(traveledFromStart, distanceToDot)
      const fraction = clamp(traveledFromStart / traveled, 0, 1)
      const continuousAtMs = segmentStartMs(index)
        + (segmentEndMs(index) - segmentStartMs(index)) * fraction
      const spawnedAtMs = Math.max(
        segmentStartMs(index) + RUNTIME_FIXED_STEP_MS,
        Math.ceil((continuousAtMs - EPSILON) / RUNTIME_FIXED_STEP_MS)
          * RUNTIME_FIXED_STEP_MS,
      )
      samples.push({
        x: startX + deltaX * fraction,
        y: startY + deltaY * fraction,
        spawnedAtMs,
      })
      remaining -= TRAIL_SAMPLE_SPACING
    }
    distanceSinceTrailDot = Math.max(0, remaining)
  }
  return samples
}

function candidateGeneratedSelfCollisionMs(
  candidate: InternalTrajectoryCandidate,
  enemy: SnakePlannerActor,
  stepMs: number,
  maximumSurvivalMs: number,
): number | null {
  // Generated dots are not yet external occupancy: use the required .55
  // runtime reserve here. Applying the low-integrity reserve to the actor's
  // own freshly emitted dot behind it would make every moving trajectory
  // permanently unsafe once that dot reaches 240ms of age.
  const radius = TRAIL_COLLISION_RADIUS
  const radiusSquared = radius * radius
  if (
    !Number.isFinite(maximumSurvivalMs)
    && candidate.generatedSelfMinimumDistanceSquared !== undefined
  ) {
    return candidate.generatedSelfMinimumDistanceSquared <= radiusSquared + EPSILON
      ? SELF_TRAIL_IGNORE_MS
      : null
  }
  const localCoordinates = candidate.generatedSelfMinimumDistanceSquared !== undefined
    ? candidate.localRawPathCoordinates
    : undefined
  const usesLocalCoordinates = !!localCoordinates
  if (!usesLocalCoordinates) materializeCandidatePath(candidate)
  const pathLength = usesLocalCoordinates
    ? localCoordinates.length / 2
    : candidate.path.length
  if (pathLength < 2 || maximumSurvivalMs <= SELF_TRAIL_IGNORE_MS + EPSILON) return null
  const coordinateX = (index: number) => {
    if (index < 0) return usesLocalCoordinates ? 0 : enemy.position.x
    return usesLocalCoordinates ? localCoordinates![index * 2] : candidate.path[index].x
  }
  const coordinateY = (index: number) => {
    if (index < 0) return usesLocalCoordinates ? 0 : enemy.position.y
    return usesLocalCoordinates ? localCoordinates![index * 2 + 1] : candidate.path[index].y
  }
  const segmentStarts: number[] | null = candidate.segmentDurationsMs ? [] : null
  if (segmentStarts) {
    let elapsedMs = 0
    for (const durationMs of candidate.segmentDurationsMs!) {
      segmentStarts.push(elapsedMs)
      elapsedMs += durationMs
    }
  }
  const segmentStartMs = (index: number) => segmentStarts?.[index] ?? index * stepMs
  const segmentEndMs = (index: number) => (
    segmentStartMs(index) + (candidate.segmentDurationsMs?.[index] ?? stepMs)
  )
  const limitedPathLength = Math.min(
    pathLength,
    Math.ceil(maximumSurvivalMs / Math.max(stepMs, EPSILON)),
  )
  const dots = generatedTrailSamples(
    limitedPathLength,
    coordinateX,
    coordinateY,
    segmentStartMs,
    segmentEndMs,
    enemy.distanceSinceTrailDot ?? 0,
  )
  for (let headIndex = 0; headIndex < limitedPathLength; headIndex += 1) {
    const fullHeadStartsAtMs = segmentStartMs(headIndex)
    const headEndsAtMs = Math.min(segmentEndMs(headIndex), maximumSurvivalMs)
    if (headEndsAtMs <= SELF_TRAIL_IGNORE_MS + EPSILON) continue
    const fullHeadDurationMs = segmentEndMs(headIndex) - fullHeadStartsAtMs
    const fullHeadStartX = coordinateX(headIndex - 1)
    const fullHeadStartY = coordinateY(headIndex - 1)
    const fullHeadEndX = coordinateX(headIndex)
    const fullHeadEndY = coordinateY(headIndex)
    const endFraction = clamp(
      (headEndsAtMs - fullHeadStartsAtMs) / Math.max(fullHeadDurationMs, EPSILON),
      0,
      1,
    )
    const headEndX = fullHeadStartX + (fullHeadEndX - fullHeadStartX) * endFraction
    const headEndY = fullHeadStartY + (fullHeadEndY - fullHeadStartY) * endFraction
    for (const dot of dots) {
      const hazardousAtMs = dot.spawnedAtMs + SELF_TRAIL_IGNORE_MS
      if (hazardousAtMs > headEndsAtMs + EPSILON) continue
      const headStartsAtMs = Math.max(fullHeadStartsAtMs, hazardousAtMs)
      const startFraction = clamp(
        (headStartsAtMs - fullHeadStartsAtMs) / Math.max(fullHeadDurationMs, EPSILON),
        0,
        1,
      )
      const headStartX = fullHeadStartX + (fullHeadEndX - fullHeadStartX) * startFraction
      const headStartY = fullHeadStartY + (fullHeadEndY - fullHeadStartY) * startFraction
      if (squaredPointSegmentDistance(
        dot.x,
        dot.y,
        headStartX,
        headStartY,
        headEndX,
        headEndY,
      ) <= radiusSquared + EPSILON) return headStartsAtMs
    }
  }
  return null
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
  const trailRadius = TRAIL_COLLISION_RADIUS + margin
  let checkTrails = trailIndex.dots.length > 0
    && candidateBounds.minimumX <= trailIndex.maximumX + TRAIL_COLLISION_RADIUS + margin
    && candidateBounds.maximumX >= trailIndex.minimumX - TRAIL_COLLISION_RADIUS - margin
    && candidateBounds.minimumY <= trailIndex.maximumY + TRAIL_COLLISION_RADIUS + margin
    && candidateBounds.maximumY >= trailIndex.minimumY - TRAIL_COLLISION_RADIUS - margin
  if (checkTrails) {
    const minimumTrailRow = clamp(
      Math.floor((candidateBounds.minimumY - trailRadius) / SPATIAL_CELL_SIZE),
      0,
      trailIndex.rows - 1,
    )
    const maximumTrailRow = clamp(
      Math.floor((candidateBounds.maximumY + trailRadius) / SPATIAL_CELL_SIZE),
      0,
      trailIndex.rows - 1,
    )
    checkTrails = trailIndex.occupiedRowPrefix[maximumTrailRow + 1]
      !== trailIndex.occupiedRowPrefix[minimumTrailRow]
  }
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
  ) {
    return candidateGeneratedSelfCollisionMs(
      candidate,
      enemy,
      stepMs,
      maximumSurvivalMs,
    ) === null
  }
  const allyCursors = snapshot.committedAllyPaths.length > 0
    ? snapshot.committedAllyPaths.map(() => ({ sampleIndex: 0 }))
    : null
  let start = enemy.position
  let elapsedMs = 0
  for (let pathIndex = 0; pathIndex < candidate.path.length; pathIndex += 1) {
    if (elapsedMs >= maximumSurvivalMs - EPSILON) break
    materializeCandidatePathThrough(candidate, pathIndex)
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
        if (Math.max(outsideAtMs, graceUntilMs) <= segmentStartMs + segmentDurationMs + EPSILON) {
          return false
        }
      }
    }
    const trailCollision = checkTrails ? trailCollisionTime(
      trailIndex,
      enemy.id,
      start,
      end,
      segmentStartMs,
      segmentDurationMs,
      trailRadius,
      graceUntilMs,
    ) : null
    if (trailCollision !== null) {
      return false
    }
    for (let allyIndex = 0; allyIndex < snapshot.committedAllyPaths.length; allyIndex += 1) {
      const committed = snapshot.committedAllyPaths[allyIndex]
      if (committed.enemyId === enemy.id) continue
      const overlap = sweptCommittedAllyOverlap(
        start,
        end,
        segmentStartMs,
        segmentStartMs + segmentDurationMs,
        committed,
        ALLY_COLLISION_RADIUS + margin,
        allyCursors![allyIndex],
      )
      if (overlap && overlap.collisionAtMs !== null) {
        return false
      }
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
          if (collisionAtMs + EPSILON >= playerBothGraceUntilMs) {
            return false
          }
        }
      }
    }
    start = end
    if (fraction < 1 - EPSILON) break
  }
  return candidateGeneratedSelfCollisionMs(
    candidate,
    enemy,
    stepMs,
    maximumSurvivalMs,
  ) === null
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
    candidateVisitMarks: new Uint32Array(size),
    candidateGeneration: 0,
    occupancyBaseCache: null,
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
  return markDiskCoordinates(
    occupancy,
    workspace,
    position.x,
    position.y,
    radius,
    recordedCells,
    recordedCount,
  )
}

function markDiskCoordinates(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  positionX: number,
  positionY: number,
  radius: number,
  recordedCells?: Int32Array,
  recordedCount = 0,
): number {
  const minimumX = Math.max(0, Math.floor((positionX - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumX = Math.min(workspace.width - 1, Math.floor((positionX + radius) / RESOURCE_SNAKE_GRID_SIZE))
  const minimumY = Math.max(0, Math.floor((positionY - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumY = Math.min(workspace.height - 1, Math.floor((positionY + radius) / RESOURCE_SNAKE_GRID_SIZE))
  const expanded = radius + RESOURCE_SNAKE_GRID_SIZE * 0.5
  const squared = expanded * expanded
  for (let y = minimumY; y <= maximumY; y += 1) {
    const centerY = (y + 0.5) * RESOURCE_SNAKE_GRID_SIZE
    for (let x = minimumX; x <= maximumX; x += 1) {
      const centerX = (x + 0.5) * RESOURCE_SNAKE_GRID_SIZE
      const dx = centerX - positionX
      const dy = centerY - positionY
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
  workspace.occupancyBaseCache = null
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
    workspace.occupancyBaseCache = cachedOccupancyBases
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
    playerBaseId: null,
    enemyLabels: null,
    enemyAreas: null,
    playerLabels: null,
    playerAreas: null,
    playerBaselineMemberships: null,
    playerBaselineAreas: null,
    singlePlayerBaselineComponent: 0,
  }
  workspace.occupancyBaseCache = cachedOccupancyBases
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

function prepareEnemyGridComponents(workspace: GridWorkspace): void {
  const cache = workspace.occupancyBaseCache
  if (cache?.enemyLabels && cache.enemyAreas) {
    workspace.enemyLabels.set(cache.enemyLabels)
    workspace.enemyAreas.set(cache.enemyAreas)
    return
  }
  labelGridComponents(workspace, workspace.enemyBase, workspace.enemyLabels, workspace.enemyAreas)
  if (cache) {
    cache.enemyLabels = workspace.enemyLabels.slice()
    cache.enemyAreas = workspace.enemyAreas.slice()
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
  const cache = workspace.occupancyBaseCache
  if (
    cache?.playerLabels
    && cache.playerAreas
    && cache.playerBaselineMemberships
    && cache.playerBaselineAreas
  ) {
    workspace.playerLabels.set(cache.playerLabels)
    workspace.playerAreas.set(cache.playerAreas)
    for (let index = 0; index < workspace.playerBaselineMemberships.length; index += 1) {
      workspace.playerBaselineMemberships[index].set(cache.playerBaselineMemberships[index])
    }
    workspace.singlePlayerBaselineComponent = cache.singlePlayerBaselineComponent
    return cache.playerBaselineAreas
  }
  const remember = (areas: number[]): number[] => {
    if (cache) {
      cache.playerLabels = workspace.playerLabels.slice()
      cache.playerAreas = workspace.playerAreas.slice()
      cache.playerBaselineMemberships = workspace.playerBaselineMemberships.map(
        (membership) => membership.slice(),
      )
      cache.playerBaselineAreas = areas.slice()
      cache.singlePlayerBaselineComponent = workspace.singlePlayerBaselineComponent
    }
    return areas
  }
  workspace.singlePlayerBaselineComponent = 0
  if (origins.length > 0 && origins.every((origin) => (
    origin.x === origins[0].x && origin.y === origins[0].y
  ))) {
    const start = cellIndex(workspace, origins[0])
    if (start === null) return remember(origins.map(() => 0))
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
    return remember(origins.map(() => workspace.playerAreas[workspace.singlePlayerBaselineComponent]))
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
  return remember(baselineAreas)
}

function markCandidateTrail(
  workspace: GridWorkspace,
  path: readonly SnakeVector[],
): number {
  let recordedCount = 0
  for (let index = 0; index + 1 < path.length; index += 1) {
    if (
      index > 0
      && path[index].x === path[index - 1].x
      && path[index].y === path[index - 1].y
    ) continue
    recordedCount = recordCandidateDisk(
      workspace,
      path[index].x,
      path[index].y,
      FUTURE_TRAIL_RADIUS,
      recordedCount,
    )
  }
  return recordedCount
}

function markInternalCandidateTrail(
  workspace: GridWorkspace,
  candidate: InternalTrajectoryCandidate,
): number {
  const localRawPathCoordinates = candidate.localRawPathCoordinates
  const origin = candidate.transformOrigin
  const cosine = candidate.transformCosine
  const sine = candidate.transformSine
  if (!localRawPathCoordinates || !origin || cosine === undefined || sine === undefined) {
    return markCandidateTrail(workspace, candidate.path)
  }
  const field = candidate.transformField
  let recordedCount = 0
  let priorX = Infinity
  let priorY = Infinity
  const stepCount = localRawPathCoordinates.length / 2
  for (let index = 0; index + 1 < stepCount; index += 1) {
    const offset = index * 2
    const localX = localRawPathCoordinates[offset]
    const localY = localRawPathCoordinates[offset + 1]
    const rawX = origin.x + localX * cosine - localY * sine
    const rawY = origin.y + localX * sine + localY * cosine
    const x = field ? clamp(rawX, field.padding, field.width - field.padding) : rawX
    const y = field ? clamp(rawY, field.padding, field.height - field.padding) : rawY
    if (x === priorX && y === priorY) continue
    recordedCount = recordCandidateDisk(
      workspace,
      x,
      y,
      FUTURE_TRAIL_RADIUS,
      recordedCount,
    )
    priorX = x
    priorY = y
  }
  return recordedCount
}

function beginCandidateCells(workspace: GridWorkspace): void {
  workspace.candidateGeneration += 1
  if (workspace.candidateGeneration >= 0xffff_fffe) {
    workspace.candidateVisitMarks.fill(0)
    workspace.candidateGeneration = 1
  }
}

function recordCandidateDisk(
  workspace: GridWorkspace,
  positionX: number,
  positionY: number,
  radius: number,
  recordedCount: number,
): number {
  const minimumX = Math.max(0, Math.floor((positionX - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumX = Math.min(workspace.width - 1, Math.floor((positionX + radius) / RESOURCE_SNAKE_GRID_SIZE))
  const minimumY = Math.max(0, Math.floor((positionY - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumY = Math.min(workspace.height - 1, Math.floor((positionY + radius) / RESOURCE_SNAKE_GRID_SIZE))
  const expanded = radius + RESOURCE_SNAKE_GRID_SIZE * 0.5
  const squared = expanded * expanded
  const generation = workspace.candidateGeneration
  for (let y = minimumY; y <= maximumY; y += 1) {
    const centerY = (y + 0.5) * RESOURCE_SNAKE_GRID_SIZE
    for (let x = minimumX; x <= maximumX; x += 1) {
      const centerX = (x + 0.5) * RESOURCE_SNAKE_GRID_SIZE
      const dx = centerX - positionX
      const dy = centerY - positionY
      if (dx * dx + dy * dy <= squared) {
        const index = y * workspace.width + x
        if (!workspace.playerBase[index] && workspace.candidateVisitMarks[index] !== generation) {
          workspace.candidateVisitMarks[index] = generation
          workspace.candidateCells[recordedCount] = index
          recordedCount += 1
        }
      }
    }
  }
  return recordedCount
}

function playerBaseCacheId(
  workspace: GridWorkspace,
  endpoints: readonly SnakeVector[],
): number {
  const preparedBase = workspace.occupancyBaseCache
  if (preparedBase && preparedBase.playerBaseId !== null) {
    return preparedBase.playerBaseId
  }
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
    if (equal) {
      if (preparedBase) preparedBase.playerBaseId = record.id
      return record.id
    }
  }
  if (playerBaseCacheRecords.length >= PLAYER_BASE_CACHE_RECORD_LIMIT) {
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
  if (preparedBase) preparedBase.playerBaseId = id
  return id
}

function cachedPlayerReduction(
  baseId: number,
  candidateIndex: number | undefined,
  cells: Int32Array,
  count: number,
  hash: number,
): number | null {
  if (candidateIndex === undefined) return null
  const slot = playerReductionCache.get(`${baseId}:${candidateIndex}`)
  if (!slot) return null
  for (const record of slot.records) {
    if (record.count !== count || record.hash !== hash) continue
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
  hash: number,
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
    record = { count: 0, hash: 0, cells: new Int32Array(count), value: 0 }
    slot.records.push(record)
  } else {
    record = slot.records[slot.nextReplacement]
    slot.nextReplacement = (slot.nextReplacement + 1) % slot.records.length
    if (record.cells.length < count) record.cells = new Int32Array(count)
  }
  record.count = count
  record.hash = hash
  record.cells.set(cells.subarray(0, count), 0)
  record.value = value
}

function candidateCellHash(cells: Int32Array, count: number): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < count; index += 1) {
    hash = Math.imul(hash ^ cells[index], 0x01000193)
  }
  return hash >>> 0
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
  materializeCandidatePath(candidate)
  const allyCursors = snapshot.committedAllyPaths.map(() => ({ sampleIndex: 0 }))
  let elapsedMs = 0
  let start = enemy.position
  for (let index = 0; index < candidate.path.length; index += 1) {
    const durationMs = candidate.segmentDurationsMs?.[index] ?? stepMs
    const segmentStartMs = snapshot.simulationMs + elapsedMs
    elapsedMs += durationMs
    const end = candidate.path[index]
    for (let allyIndex = 0; allyIndex < snapshot.committedAllyPaths.length; allyIndex += 1) {
      const committed = snapshot.committedAllyPaths[allyIndex]
      if (committed.enemyId === enemy.id) continue
      const overlap = sweptCommittedAllyOverlap(
        start,
        end,
        segmentStartMs,
        segmentStartMs + durationMs,
        committed,
        0,
        allyCursors[allyIndex],
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
  materializeCandidatePath(candidate)
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
  beginCandidateCells(workspace)
  const candidateCellCount = internalCandidate
    ? markInternalCandidateTrail(workspace, internalCandidate)
    : markCandidateTrail(workspace, candidate.path)
  const cellHash = candidateCellHash(workspace.candidateCells, candidateCellCount)
  const cached = cachedPlayerReduction(
    baseCacheId,
    candidate.candidateIndex,
    workspace.candidateCells,
    candidateCellCount,
    cellHash,
  )
  if (cached !== null) return cached
  workspace.occupancy.set(workspace.playerBase)
  for (let index = 0; index < candidateCellCount; index += 1) {
    workspace.occupancy[workspace.candidateCells[index]] = 1
  }
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
    cellHash,
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
  prepareEnemyGridComponents(workspace)
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
    if (left.survives !== right.survives) return left.survives > right.survives ? 1 : -1
    if (left.reachableArea !== right.reachableArea) return left.reachableArea > right.reachableArea ? 1 : -1
    if (left.allyClearance !== right.allyClearance) return left.allyClearance > right.allyClearance ? 1 : -1
    if (left.playerAreaReduction !== right.playerAreaReduction) {
      return left.playerAreaReduction > right.playerAreaReduction ? 1 : -1
    }
    if (left.cutoffProgress !== right.cutoffProgress) return left.cutoffProgress > right.cutoffProgress ? 1 : -1
    if (left.pressureDistance !== right.pressureDistance) return left.pressureDistance < right.pressureDistance ? 1 : -1
    if (left.steeringCost !== right.steeringCost) return left.steeringCost < right.steeringCost ? 1 : -1
    if (leftCandidateIndex === rightCandidateIndex) return 0
    return leftCandidateIndex < rightCandidateIndex ? 1 : -1
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

function cloneRetainedPlan(
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  authoritativeScore: SnakePlanScore,
  authoritativeCandidateIndex: number,
  authoritativeIntent: SnakeIntent,
  evaluatedCandidates: number,
): SnakePlan {
  return {
    enemyId: enemy.id,
    intent: authoritativeIntent,
    role: enemy.role ?? 'pressure',
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
    candidateIndex: authoritativeCandidateIndex,
    evaluatedCandidates,
    elapsedMs: plan.elapsedMs,
    fallback: plan.fallback,
  }
}

function identifyRetainedCustomCandidate(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  profile: SnakePlannerProfile,
  groupConstraints?: GroupCandidateConstraints,
): number | null {
  const configuredOverrides = [
    ...(groupConstraints?.trajectoryOverrides
      ?? (groupConstraints?.trajectoryOverride ? [groupConstraints.trajectoryOverride] : [])),
    ...(groupConstraints?.emergencyTrajectoryOverrides ?? []),
  ]
  if (
    configuredOverrides.length === 0
    || !configuredOverrides.some((candidate) => (
      candidate.candidateIndex === plan.candidateIndex
    ))
  ) return null
  const recordedPlayerAtPlan = Math.abs(plan.plannedAtMs - snapshot.simulationMs) <= EPSILON
    ? { position: snapshot.player.position, velocity: snapshot.player.velocity }
    : snapshot.playerHistory.find((sample) => (
        Math.abs(sample.simulationMs - plan.plannedAtMs) <= EPSILON
      ))
  // A floor-overload deferral can receive a compact snapshot whose history no
  // longer contains the exact planning boundary. Rebuild from the current
  // player only as an exact-match fallback: the regenerated custom path below
  // must still equal every stored direction and point before it can be reused.
  const playerAtPlan = recordedPlayerAtPlan ?? {
    position: snapshot.player.position,
    velocity: snapshot.player.velocity,
  }
  const originEnemy: SnakePlannerActor = {
    ...enemy,
    position: { ...plan.originPosition },
    velocity: { ...plan.originVelocity },
    maximumSpeedPerSecond: plan.originMaximumSpeedPerSecond,
  }
  const originSnapshot: SnakePlannerSnapshot = {
    ...snapshot,
    simulationMs: plan.plannedAtMs,
    player: {
      ...snapshot.player,
      position: { ...playerAtPlan.position },
      velocity: { ...playerAtPlan.velocity },
    },
    enemies: snapshot.enemies.map((candidate) => (
      candidate.id === enemy.id ? originEnemy : candidate
    )),
    trailDots: snapshot.trailDots.filter((dot) => (
      dot.spawnedAtMs <= plan.plannedAtMs
      && dot.expiresAtMs > plan.plannedAtMs
    )),
    playerHistory: snapshot.playerHistory.filter((sample) => (
      sample.simulationMs <= plan.plannedAtMs
    )),
    committedAllyPaths: [],
  }
  const originConstraints = lateEnclosureConstraints(
    originSnapshot,
    originEnemy,
    profile,
  )
  const custom = [
    ...(originConstraints?.trajectoryOverrides
      ?? (originConstraints?.trajectoryOverride ? [originConstraints.trajectoryOverride] : [])),
    ...(originConstraints?.emergencyTrajectoryOverrides ?? []),
  ].find((candidate) => (
    candidate.candidateIndex === plan.candidateIndex
  ))
  if (
    !custom
    || custom.speedScale !== plan.speedScale
    || custom.path.length !== plan.path.length
    || custom.directions.length !== plan.directions.length
  ) return null
  for (let index = 0; index < plan.path.length; index += 1) {
    if (
      custom.directions[index].x !== plan.directions[index].x
      || custom.directions[index].y !== plan.directions[index].y
      || custom.path[index].x !== plan.path[index].x
      || custom.path[index].y !== plan.path[index].y
    ) return null
  }
  return plan.candidateIndex
}

function identifyRetainedCandidate(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  profile: SnakePlannerProfile,
  field: SnakePlannerSnapshot['field'],
  groupConstraints?: GroupCandidateConstraints,
): number | null {
  const custom = identifyRetainedCustomCandidate(
    snapshot,
    enemy,
    plan,
    profile,
    groupConstraints,
  )
  if (custom !== null) return custom
  const originActor: SnakePlannerActor = {
    ...enemy,
    position: plan.originPosition,
    velocity: plan.originVelocity,
    maximumSpeedPerSecond: plan.originMaximumSpeedPerSecond,
  }
  const candidates = generateInternalCandidates(originActor, profile, field)
  try {
    for (const candidate of candidates) {
      if (candidate.speedScale !== plan.speedScale) continue
      materializeCandidate(candidate)
      let equal = true
      for (let index = 0; index < plan.path.length; index += 1) {
        if (
          candidate.directions[index].x !== plan.directions[index].x
          || candidate.directions[index].y !== plan.directions[index].y
          || candidate.path[index].x !== plan.path[index].x
          || candidate.path[index].y !== plan.path[index].y
        ) {
          equal = false
          break
        }
      }
      if (equal) return candidate.candidateIndex
    }
    return null
  } finally {
    releaseTrajectoryBuffer(candidates)
  }
}

function steeringCostForDirections(
  enemy: SnakePlannerActor,
  directions: readonly SnakeVector[],
  speedScale: SnakePlanSpeedScale,
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
      pathMaterialized: true,
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
  profile: SnakePlannerProfile,
  trailIndex: TrailSpatialIndex,
  authoritativeCandidateIndex: number,
): {
  candidate: InternalTrajectoryCandidate
  score: SnakePlanScore
  generatedSelfSafeThroughNextBoundary: boolean
} | null {
  const retained = retainedCandidateAt(snapshot, enemy, plan)
  if (!retained) return null
  retained.candidate.candidateIndex = authoritativeCandidateIndex
  const timed = createTimedPlayerHypotheses(snapshot, retained.lookaheadMs, plan.stepMs)
  const workspace = acquireGrid(snapshot)
  try {
    const score = evaluateAuthoritativeCandidateScore(
      snapshot,
      enemy,
      retained.candidate,
      timed.hypotheses,
      workspace,
      trailIndex,
      snapshot.simulationMs + retained.lookaheadMs,
      plan.stepMs,
      Math.min(
        retained.lookaheadMs,
        Math.max(0, plan.commitUntilMs - snapshot.simulationMs),
      ),
    )
    const generatedSelfSafeThroughNextBoundary = candidateGeneratedSelfCollisionMs(
        retained.candidate,
        enemy,
        plan.stepMs,
        Math.min(
          retained.lookaheadMs,
          Math.max(
            plan.commitUntilMs - snapshot.simulationMs,
            1_000 / profile.planningHz,
          ),
        ),
      ) === null
    if (!generatedSelfSafeThroughNextBoundary) score.survives = 0
    return {
      candidate: retained.candidate,
      score,
      generatedSelfSafeThroughNextBoundary,
    }
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

let monotonicFallbackMs = 0

function defaultMonotonicClock(): number {
  try {
    const observed = globalThis.performance.now()
    if (finite(observed) && observed >= monotonicFallbackMs) {
      monotonicFallbackMs = observed
      return observed
    }
  } catch {
    // Date.now is used only when the standard monotonic clock is unavailable.
  }
  const observed = Date.now()
  if (finite(observed)) monotonicFallbackMs = Math.max(monotonicFallbackMs, observed)
  return monotonicFallbackMs
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
    enemyId: enemyIdValid(enemyId) ? enemyId : 'enemy-0',
    role: enemyRoleValid(enemy?.role) ? enemy.role : 'pressure',
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
  groupConstraints?: GroupCandidateConstraints,
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
  const initialHeading = enemy.heading ?? resourceSnakeHeadingFromVector(
    finiteVector(enemy.velocity) ? enemy.velocity : { x: 0, y: 0 },
    'south',
  )
  const recoveryHeadings = legalResourceSnakeHeadings(initialHeading)
  const playerPosition = finiteVector(snapshot.player?.position) ? snapshot.player.position : null
  const toPlayer = playerPosition
    ? { x: playerPosition.x - enemy.position.x, y: playerPosition.y - enemy.position.y }
    : null
  const trailIndex = buildTrailIndex(snapshot)
  const hypotheses = acquirePlayerHypotheses(snapshot, stepCount * stepMs, stepMs)
  try {
    const collisionHypotheses = distinctHypothesisPaths(hypotheses)
    const collisionHypothesisBounds = collisionHypotheses.map(
      (path) => pathBounds(snapshot.player.position, path),
    )
    const fullHorizonMs = stepCount * stepMs
    let best: {
      index: number
      direction: SnakeVector
      candidate: InternalTrajectoryCandidate
      safeMs: number
      fullSafe: boolean
      playerSafeMs: number
      clearance: number
      awayAlignment: number
    } | null = null
    for (let index = 0; index < recoveryHeadings.length; index += 1) {
      const heading = recoveryHeadings[index]
      const direction = { ...SNAKE_DIRECTION_VECTORS[heading] }
      const directions = Array.from({ length: stepCount }, () => ({ ...direction }))
      const recoverySpeed = enemy.maximumSpeedPerSecond * 0.92
      const rawPath = directions.map((_, step) => ({
        x: enemy.position.x + direction.x * recoverySpeed * ((step + 1) * stepMs / 1_000),
        y: enemy.position.y + direction.y * recoverySpeed * ((step + 1) * stepMs / 1_000),
      }))
      const path = rawPath.map((point) => ({
        x: clamp(point.x, snapshot.field.padding, snapshot.field.width - snapshot.field.padding),
        y: clamp(point.y, snapshot.field.padding, snapshot.field.height - snapshot.field.padding),
      }))
      if (!satisfiesGroupCandidateConstraints(path.at(-1), groupConstraints)) continue
      const bounds = pathBounds(enemy.position, path)
      const candidate: InternalTrajectoryCandidate = {
        candidateIndex: index,
        speedScale: 0.92,
        directions,
        path,
        rawPath,
        steeringCost: index,
        bounds: { ...bounds },
        rawBounds: pathBounds(enemy.position, rawPath),
        pathMaterialized: true,
        materialized: true,
        originHeading: initialHeading,
        attackHeading: heading,
        headingChanges: [{ offsetMs: 0, heading }],
        score: emptyScore(),
      }
      const fullSafe = candidateSurvives(
        snapshot,
        enemy,
        candidate,
        collisionHypotheses,
        collisionHypothesisBounds,
        trailIndex,
        stepMs,
        fullHorizonMs,
      )
      let safeMs = fullSafe ? fullHorizonMs : 0
      if (!fullSafe) {
        let safeFixedSteps = 0
        let unsafeFixedSteps = Math.ceil(fullHorizonMs / RUNTIME_FIXED_STEP_MS)
        while (safeFixedSteps + 1 < unsafeFixedSteps) {
          const probe = Math.floor((safeFixedSteps + unsafeFixedSteps) / 2)
          if (candidateSurvives(
            snapshot,
            enemy,
            candidate,
            collisionHypotheses,
            collisionHypothesisBounds,
            trailIndex,
            stepMs,
            probe * RUNTIME_FIXED_STEP_MS,
          )) safeFixedSteps = probe
          else unsafeFixedSteps = probe
        }
        safeMs = safeFixedSteps * RUNTIME_FIXED_STEP_MS
      }
      const decisionHorizonMs = Math.min(
        fullHorizonMs,
        Math.max(profile.commitMs, 1_000 / profile.planningHz),
      )
      const playerGraceMs = Math.min(
        enemy.collisionGraceMs,
        snapshot.player.collisionGraceMs,
      )
      const playerRadius = PLAYER_HEAD_CLEARANCE + riskMargin(enemy) * 0.5
      let playerSafeMs = decisionHorizonMs
      let playerClearance = Number.POSITIVE_INFINITY
      for (
        let pathIndex = 0;
        pathIndex < candidate.path.length && pathIndex * stepMs < decisionHorizonMs - EPSILON;
        pathIndex += 1
      ) {
        const segmentStartsAtMs = pathIndex * stepMs
        const segmentDurationMs = Math.min(stepMs, decisionHorizonMs - segmentStartsAtMs)
        const fraction = segmentDurationMs / stepMs
        const enemyStart = pathIndex === 0 ? enemy.position : candidate.path[pathIndex - 1]
        const fullEnemyEnd = candidate.path[pathIndex]
        const enemyEnd = fraction >= 1 - EPSILON ? fullEnemyEnd : {
          x: enemyStart.x + (fullEnemyEnd.x - enemyStart.x) * fraction,
          y: enemyStart.y + (fullEnemyEnd.y - enemyStart.y) * fraction,
        }
        for (const hypothesis of collisionHypotheses) {
          const playerStart = pathIndex === 0 ? snapshot.player.position : hypothesis[pathIndex - 1]
          const fullPlayerEnd = hypothesis[pathIndex]
          const playerEnd = fraction >= 1 - EPSILON ? fullPlayerEnd : {
            x: playerStart.x + (fullPlayerEnd.x - playerStart.x) * fraction,
            y: playerStart.y + (fullPlayerEnd.y - playerStart.y) * fraction,
          }
          playerClearance = Math.min(
            playerClearance,
            movingCircleMinimumDistance(enemyStart, enemyEnd, playerStart, playerEnd)
              - playerRadius,
          )
          const interval = movingCircleInterval(
            enemyStart,
            enemyEnd,
            playerStart,
            playerEnd,
            playerRadius,
          )
          if (interval) {
            const collisionAtMs = segmentStartsAtMs + interval[0] * segmentDurationMs
            if (collisionAtMs + EPSILON >= playerGraceMs) {
              playerSafeMs = Math.min(playerSafeMs, collisionAtMs)
            }
          }
        }
      }
      const safePathIndex = Math.min(
        candidate.path.length - 1,
        Math.max(0, Math.ceil(safeMs / stepMs) - 1),
      )
      const safeEndpoint = candidate.path[safePathIndex] ?? enemy.position
      const decisionPathIndex = Math.min(
        candidate.path.length - 1,
        Math.max(0, Math.ceil(decisionHorizonMs / stepMs) - 1),
      )
      const decisionEndpoint = candidate.path[decisionPathIndex] ?? safeEndpoint
      const decisionAtMs = snapshot.simulationMs + decisionHorizonMs
      const terminalObstacleClearances = snapshot.trailDots.filter((dot) => (
        dot.spawnedAtMs < decisionAtMs
        && dot.expiresAtMs > decisionAtMs
        && (
          dot.ownerId !== enemy.id
          || decisionAtMs - dot.spawnedAtMs >= SELF_TRAIL_IGNORE_MS
        )
      )).map((dot) => (
        distance(decisionEndpoint, dot.position) - TRAIL_COLLISION_RADIUS - riskMargin(enemy)
      ))
      for (const committed of snapshot.committedAllyPaths) {
        if (committed.enemyId === enemy.id) continue
        const ally = committedPointAt(committed, decisionAtMs)
        if (ally) terminalObstacleClearances.push(
          distance(decisionEndpoint, ally) - ALLY_COLLISION_RADIUS - riskMargin(enemy),
        )
      }
      const clearance = Math.min(
        safeEndpoint.x - snapshot.field.padding,
        snapshot.field.width - snapshot.field.padding - safeEndpoint.x,
        safeEndpoint.y - snapshot.field.padding,
        snapshot.field.height - snapshot.field.padding - safeEndpoint.y,
        ...(playerPosition ? [distance(safeEndpoint, playerPosition) - PLAYER_HEAD_CLEARANCE] : []),
        playerClearance,
        ...terminalObstacleClearances,
      )
      const awayAlignment = toPlayer
        ? -(direction.x * toPlayer.x + direction.y * toPlayer.y)
        : 0
      if (
        !best
        || safeMs > best.safeMs + EPSILON
        || (
          Math.abs(safeMs - best.safeMs) <= EPSILON
          && playerSafeMs > best.playerSafeMs + EPSILON
        )
        || (
          Math.abs(safeMs - best.safeMs) <= EPSILON
          && Math.abs(playerSafeMs - best.playerSafeMs) <= EPSILON
          && clearance > best.clearance + EPSILON
        )
        || (
          Math.abs(safeMs - best.safeMs) <= EPSILON
          && Math.abs(playerSafeMs - best.playerSafeMs) <= EPSILON
          && Math.abs(clearance - best.clearance) <= EPSILON
          && awayAlignment > best.awayAlignment + EPSILON
        )
        || (
          Math.abs(safeMs - best.safeMs) <= EPSILON
          && Math.abs(playerSafeMs - best.playerSafeMs) <= EPSILON
          && Math.abs(clearance - best.clearance) <= EPSILON
          && Math.abs(awayAlignment - best.awayAlignment) <= EPSILON
          && index < best.index
        )
      ) {
        best = {
          index,
          direction,
          candidate,
          safeMs,
          fullSafe,
          playerSafeMs,
          clearance,
          awayAlignment,
        }
      }
    }
    if (!best) {
      const heading = recoveryHeadings[0]
      const direction = SNAKE_DIRECTION_VECTORS[heading]
      const recoverySpeed = enemy.maximumSpeedPerSecond * 0.92
      const directions = Array.from({ length: stepCount }, () => ({ ...direction }))
      const path = directions.map((_, step) => ({
        x: enemy.position.x + direction.x * recoverySpeed * ((step + 1) * stepMs / 1_000),
        y: enemy.position.y + direction.y * recoverySpeed * ((step + 1) * stepMs / 1_000),
      }))
      return finalizePlan({
        ...basePlanFields(snapshot, enemyId, enemy),
        intent: 'escape',
        direction: { ...direction },
        speedScale: 0.92,
        commandAtMs: snapshot.simulationMs,
        directions,
        commitUntilMs: snapshot.simulationMs + Math.max(RUNTIME_FIXED_STEP_MS, profile.commitMs),
        path,
        score: emptyScore(),
        candidateIndex: 0,
        evaluatedCandidates: recoveryHeadings.length,
        elapsedMs: elapsedSince(startedAt, clock),
        fallback: true,
        originHeading: initialHeading,
        attackHeading: heading,
        headingChanges: [{ offsetMs: 0, heading }],
      })
    }
    const safeCommitMs = profileIsValid(profile)
      ? Math.min(profile.commitMs, Math.max(RUNTIME_FIXED_STEP_MS, best.safeMs))
      : 0
    return finalizePlan({
      ...basePlanFields(snapshot, enemyId, enemy),
      intent: 'escape',
      direction: { x: rounded(best.direction.x), y: rounded(best.direction.y) },
      speedScale: 0.92,
      commandAtMs: snapshot.simulationMs,
      directions: best.candidate.directions.map((candidateDirection) => ({ ...candidateDirection })),
      commitUntilMs: snapshot.simulationMs + safeCommitMs,
      path: best.candidate.path.map((point) => ({ ...point })),
      score: {
        ...emptyScore(best.fullSafe ? 1 : 0),
        allyClearance: rounded(finite(best.clearance) ? best.clearance : 0),
      },
      candidateIndex: best.index,
      evaluatedCandidates: recoveryHeadings.length,
      elapsedMs: elapsedSince(startedAt, clock),
      fallback: true,
      originHeading: best.candidate.originHeading,
      attackHeading: best.candidate.attackHeading,
      headingChanges: best.candidate.headingChanges?.map((change) => ({ ...change })),
    })
  } finally {
    releasePlayerHypotheses(hypotheses)
  }
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
    || !LEGAL_PLAN_SPEED_SCALES.includes(plan.speedScale)
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
  const allyCursors = snapshot.committedAllyPaths.map(() => ({ sampleIndex: 0 }))
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
    for (let allyIndex = 0; allyIndex < snapshot.committedAllyPaths.length; allyIndex += 1) {
      const committed = snapshot.committedAllyPaths[allyIndex]
      if (committed.enemyId === enemy.id) continue
      const overlap = sweptCommittedAllyOverlap(
        start,
        end,
        segmentStartMs,
        sample.atMs,
        committed,
        ALLY_COLLISION_RADIUS + riskMargin(enemy),
        allyCursors[allyIndex],
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

export function resourceSnakePlanIsNewlyFatal(
  snapshot: SnakePlannerSnapshot,
  plan: SnakePlan,
  fatalWithinMs = COMMIT_FATAL_OVERRIDE_MS,
): boolean {
  try {
    if (!snapshotIsValid(snapshot) || !planTimelineValid(plan)) return true
    const enemy = snapshot.enemies.find((candidate) => candidate.id === plan.enemyId)
    if (!enemy || enemy.integrity <= 0) return true
    const fatalInMs = earliestCertainFatalMs(snapshot, enemy, plan, buildTrailIndex(snapshot))
    return fatalInMs !== null && fatalInMs <= Math.max(0, fatalWithinMs) + EPSILON
  } catch {
    return true
  }
}

function planResourceSnakeEnemyInternal(
  snapshot: unknown,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  previousPlan: SnakePlan | null,
  clock: () => number = defaultMonotonicClock,
  groupConstraints?: GroupCandidateConstraints,
): SnakePlan {
  const startedAt = safeClockValue(clock)
  if (!enemyIdValid(enemyId)) {
    return stoppedPlan(null, 'enemy-0', undefined, startedAt, clock, 'escape', true)
  }
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
    const authoritativeCandidateIndex = identifyRetainedCandidate(
      snapshot,
      enemy,
      previousPlan,
      profile,
      snapshot.field,
      groupConstraints,
    )
    const authoritative = authoritativeCandidateIndex === null
      ? null
      : recomputeRetainedPlanScore(
        snapshot,
        enemy,
         previousPlan,
          profile,
          trailIndex,
        authoritativeCandidateIndex,
      )
    const fatalInMs = authoritative
      ? earliestCertainFatalMs(snapshot, enemy, previousPlan, trailIndex)
      : 0
    if (
      authoritative
      && authoritative.generatedSelfSafeThroughNextBoundary
      && authoritativeCandidateIndex !== null
      && (fatalInMs === null || fatalInMs > COMMIT_FATAL_OVERRIDE_MS + EPSILON)
      && satisfiesGroupCandidateConstraints(previousPlan.path.at(-1), groupConstraints)
      && (
        groupConstraints?.minimumSpeedScale === undefined
        || previousPlan.speedScale >= groupConstraints.minimumSpeedScale
      )
      && (
        !groupConstraints?.trajectoryCorridor
        || previousPlan.candidateIndex === previousPlan.evaluatedCandidates - 1
      )
    ) {
      const sample = sampleResourceSnakePlan(previousPlan, snapshot.simulationMs)
      const retained = cloneRetainedPlan(
        enemy,
        previousPlan,
        authoritative.score,
        authoritativeCandidateIndex,
        deriveIntent(snapshot, enemy, authoritative.candidate),
        profile.candidateCount,
      )
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
  const trajectoryOverrides = groupConstraints?.trajectoryOverrides
    ?? (groupConstraints?.trajectoryOverride ? [groupConstraints.trajectoryOverride] : [])
  const validTrajectoryOverrides = trajectoryOverrides.filter((candidate) => (
    candidate.path.length === profile.lookaheadMs / profile.rolloutStepMs
    && candidate.directions.length === candidate.path.length
  )).slice(-candidates.length)
  const firstReplacementIndex = candidates.length - validTrajectoryOverrides.length
  for (let index = 0; index < validTrajectoryOverrides.length; index += 1) {
    const replacementIndex = firstReplacementIndex + index
    const trajectoryOverride = validTrajectoryOverrides[index]
    trajectoryOverride.candidateIndex = replacementIndex
    candidates[replacementIndex] = trajectoryOverride
  }
  const workspace = acquireGrid(snapshot)
  try {
    const horizonMs = snapshot.simulationMs + profile.lookaheadMs
    prepareOccupancyBases(snapshot, enemy, hypotheses, workspace, horizonMs, trailIndex)
    prepareEnemyGridComponents(workspace)
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
    const evaluateSurvival = (candidate: ScoredCandidate): boolean => {
      if (
        groupConstraints?.minimumSpeedScale !== undefined
        && candidate.speedScale < groupConstraints.minimumSpeedScale
      ) return false
      if (!satisfiesGroupCandidateConstraints(candidate.path.at(-1), groupConstraints)) return false
      if (!candidateFollowsGroupTrajectoryCorridor(candidate, groupConstraints)) return false
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
        return true
      }
      return false
    }
    // The canonical wall consumes the final advertised slot and is evaluated
    // first. Its two repair trajectories replace standard slots only when the
    // canonical path fails the ordinary exact safety/coordination predicate;
    // otherwise those slots remain their authoritative standard templates.
    // Every path evaluated below therefore still consumes exactly one of B.
    const emergencyOverrides = groupConstraints?.emergencyTrajectoryOverrides?.filter((candidate) => (
      candidate.path.length === profile.lookaheadMs / profile.rolloutStepMs
      && candidate.directions.length === candidate.path.length
    )).slice(-Math.max(0, candidates.length - validTrajectoryOverrides.length)) ?? []
    const canonicalCandidate = emergencyOverrides.length > 0
      ? validTrajectoryOverrides.at(-1)
      : undefined
    let canonicalSafe = false
    if (canonicalCandidate) {
      canonicalSafe = evaluateSurvival(canonicalCandidate)
      if (!canonicalSafe) {
        const firstEmergencyIndex = candidates.length
          - validTrajectoryOverrides.length
          - emergencyOverrides.length
        for (let index = 0; index < emergencyOverrides.length; index += 1) {
          const replacementIndex = firstEmergencyIndex + index
          const emergency = emergencyOverrides[index]
          emergency.candidateIndex = replacementIndex
          emergency.score = emptyScore()
          emergency.score.steeringCost = emergency.steeringCost
          candidates[replacementIndex] = emergency
        }
      }
    }
    for (const candidate of scored) {
      if (candidate === canonicalCandidate) continue
      evaluateSurvival(candidate)
    }
    if (contenders.length === 0) {
      return safeFallback(
        snapshot,
        enemyId,
        profile,
        enemy,
        startedAt,
        clock,
        groupConstraints,
      )
    }

    const safeEmergencyContenders = canonicalSafe
      ? []
      : contenders.filter((candidate) => emergencyOverrides.includes(candidate))
    if (safeEmergencyContenders.length > 0) {
      contenders = safeEmergencyContenders
    } else if (
      groupConstraints?.preferredCandidateIndex !== undefined
      && contenders.some((candidate) => (
        candidate.candidateIndex === groupConstraints.preferredCandidateIndex
      ))
    ) {
      contenders = contenders.filter((candidate) => (
        candidate.candidateIndex === groupConstraints.preferredCandidateIndex
      ))
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

    if (groupConstraints?.preferTopBoundaryTrace) {
      let earliestConnectionStep = Number.MAX_SAFE_INTEGER
      for (const candidate of contenders) {
        earliestConnectionStep = Math.min(
          earliestConnectionStep,
          topBoundaryTraceConnectionStep(snapshot, candidate),
        )
      }
      if (earliestConnectionStep < Number.MAX_SAFE_INTEGER) {
        contenders = contenders.filter((candidate) => (
          topBoundaryTraceConnectionStep(snapshot, candidate) === earliestConnectionStep
        ))
      }
      let maximumTraceProgress = 0
      for (const candidate of contenders) {
        maximumTraceProgress = Math.max(
          maximumTraceProgress,
          topBoundaryTraceProgress(snapshot, candidate),
        )
      }
      if (maximumTraceProgress > 0) {
        contenders = contenders.filter((candidate) => (
          topBoundaryTraceProgress(snapshot, candidate) === maximumTraceProgress
        ))
      }
    }

    if (groupConstraints?.offensiveEndpointTarget) {
      let minimumTargetDistance = Infinity
      for (const candidate of contenders) {
        minimumTargetDistance = Math.min(
          minimumTargetDistance,
          distance(
            candidate.path.at(-1) ?? enemy.position,
            groupConstraints.offensiveEndpointTarget,
          ),
        )
      }
      contenders = contenders.filter((candidate) => distance(
        candidate.path.at(-1) ?? enemy.position,
        groupConstraints.offensiveEndpointTarget!,
      ) === minimumTargetDistance)
    }

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
    const telegraphMs = cyanTelegraphMs(profile)
    const attackDirection = winner.attackHeading
      ? SNAKE_DIRECTION_VECTORS[winner.attackHeading]
      : winner.directions[0]
    return finalizePlan({
      ...basePlanFields(snapshot, enemyId, enemy),
      intent: deriveIntent(snapshot, enemy, winner),
      direction: { ...attackDirection },
      speedScale: winner.speedScale,
      commandAtMs: snapshot.simulationMs + telegraphMs,
      directions: winner.directions.map((direction) => ({ ...direction })),
      commitUntilMs: snapshot.simulationMs + telegraphMs + profile.commitMs,
      path: winner.path.map((position) => ({ ...position })),
      score: serializeScore(winner.score),
      candidateIndex: winner.candidateIndex,
      evaluatedCandidates: candidates.length,
      elapsedMs: elapsedSince(startedAt, clock),
      fallback: false,
      originHeading: winner.originHeading,
      attackHeading: winner.attackHeading,
      headingChanges: winner.headingChanges?.map((change) => ({ ...change })),
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

export function planResourceSnakeEnemy(
  snapshot: unknown,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  previousPlan: SnakePlan | null,
  clock: () => number = defaultMonotonicClock,
): SnakePlan {
  return planResourceSnakeEnemyInternal(snapshot, enemyId, profile, previousPlan, clock)
}

function compareEnemyIds(left: SnakePlannerActor, right: SnakePlannerActor): number {
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

function previousCandidateBudget(
  profile: SnakePlannerProfile,
  previousPlans: readonly SnakePlan[],
): 48 | 72 | 96 {
  const legal = previousPlans
    .map((plan) => plan.evaluatedCandidates)
    .filter((count): count is 48 | 72 | 96 => (
      ADAPTIVE_CANDIDATE_BUDGETS.includes(count as 48 | 72 | 96)
      && count <= profile.candidateCount
    ))
  return legal.length > 0 && legal.every((count) => count === legal[0])
    ? legal[0]
    : profile.candidateCount
}

interface AdaptiveCandidateDecision {
  budget: 48 | 72 | 96
  floorOverloaded: boolean
}

function sanitizedTimingHistory(value: unknown): {
  latestValid: number[]
  consecutiveRecovery: boolean
} {
  try {
    if (!Array.isArray(value)) return { latestValid: [], consecutiveRecovery: false }
    const length = value.length
    const numericKeys = Object.keys(value)
      .filter((key) => /^(?:0|[1-9]\d*)$/.test(key))
      .map(Number)
      .filter((index) => Number.isSafeInteger(index) && index >= 0 && index < length)
      .sort((left, right) => right - left)
    const latestValid: number[] = []
    for (const index of numericKeys) {
      const duration = value[index]
      if (finite(duration) && duration >= 0) latestValid.push(duration)
      if (latestValid.length === 31) break
    }
    let consecutiveRecovery = length >= 20
    if (consecutiveRecovery) {
      for (let index = length - 20; index < length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          consecutiveRecovery = false
          break
        }
        const duration = value[index]
        if (!finite(duration) || duration < 0 || duration >= 2.25) {
          consecutiveRecovery = false
          break
        }
      }
    }
    return { latestValid, consecutiveRecovery }
  } catch {
    return { latestValid: [], consecutiveRecovery: false }
  }
}

function adaptiveCandidateBudget(
  profile: SnakePlannerProfile,
  previousPlans: readonly SnakePlan[],
  timingHistoryMs: unknown,
): AdaptiveCandidateDecision {
  const current = previousCandidateBudget(profile, previousPlans)
  const maximumIndex = ADAPTIVE_CANDIDATE_BUDGETS.indexOf(profile.candidateCount)
  let currentIndex = Math.min(
    maximumIndex,
    ADAPTIVE_CANDIDATE_BUDGETS.indexOf(current),
  )
  const timing = sanitizedTimingHistory(timingHistoryMs)
  const durations = timing.latestValid
  let floorOverloaded = false
  if (
    currentIndex < maximumIndex
    && timing.consecutiveRecovery
  ) {
    currentIndex += 1
  } else if (durations.length > 0) {
    const ordered = durations.slice().sort((left, right) => left - right)
    const p95 = ordered[Math.ceil(ordered.length * 0.95) - 1]
    if (p95 > 3) {
      if (currentIndex > 0) currentIndex -= 1
      else floorOverloaded = true
    }
  }
  return { budget: ADAPTIVE_CANDIDATE_BUDGETS[currentIndex], floorOverloaded }
}

function roleOwnersAtPlanningBoundary(
  snapshot: SnakePlannerSnapshot,
  previousPlans: readonly SnakePlan[],
): { pressure: SnakePlannerActor | null; blocker: SnakePlannerActor | null } {
  const enemies = [...snapshot.enemies].sort(compareEnemyIds)
  if (enemies.length === 0) return { pressure: null, blocker: null }
  if (enemies.length === 1) return { pressure: enemies[0], blocker: null }
  const byId = new Map(enemies.map((enemy) => [enemy.id, enemy]))
  const priorPressure = previousPlans.find((plan) => plan.role === 'pressure')
  const priorBlocker = previousPlans.find((plan) => plan.role === 'blocker')
  let pressure = priorPressure ? byId.get(priorPressure.enemyId) : undefined
  let blocker = priorBlocker ? byId.get(priorBlocker.enemyId) : undefined
  if (!pressure || !blocker || pressure.id === blocker.id) {
    pressure = enemies.find((enemy) => enemy.role === 'pressure') ?? enemies[0]
    blocker = enemies.find((enemy) => (
      enemy.id !== pressure!.id && enemy.role === 'blocker'
    )) ?? enemies.find((enemy) => enemy.id !== pressure!.id)!
  }
  const pressurePlan = previousPlans.find((plan) => plan.enemyId === pressure!.id)
  const blockerPlan = previousPlans.find((plan) => plan.enemyId === blocker!.id)
  const pressureHasAreaDisadvantage = !!pressurePlan
    && !!blockerPlan
    && finite(pressurePlan.score.reachableArea)
    && finite(blockerPlan.score.reachableArea)
    && blockerPlan.score.reachableArea > 0
    && pressurePlan.score.reachableArea / blockerPlan.score.reachableArea < 0.55
  const pressureNeedsRelief = pressure.collisionGraceMs > 0 && pressure.integrity <= 20
  if (pressureHasAreaDisadvantage || pressureNeedsRelief) {
    return { pressure: blocker, blocker: pressure }
  }
  return { pressure, blocker }
}

function groupConstraintsAgainst(
  snapshot: SnakePlannerSnapshot,
  plan: SnakePlan,
): GroupCandidateConstraints | undefined {
  const endpoint = plan.path.at(-1)
  return endpoint ? groupConstraintsAgainstEndpoint(snapshot, endpoint) : undefined
}

function groupConstraintsAgainstEndpoint(
  snapshot: SnakePlannerSnapshot,
  endpoint: SnakeVector,
): GroupCandidateConstraints {
  return {
    endpointSeparationFrom: endpoint,
    endpointSeparation: GROUP_ENDPOINT_SEPARATION,
    exitSectorOrigin: snapshot.player.position,
    forbiddenExitSector: groupExitSector(snapshot.player.position, endpoint),
  }
}

function groupMotionConstraints(
  enemy: SnakePlannerActor,
  role: SnakeEnemyRole,
  constraints: GroupCandidateConstraints | undefined,
): GroupCandidateConstraints | undefined {
  if (role !== 'pressure' && magnitude(enemy.velocity) > 0.1) return constraints
  return { ...constraints, minimumSpeedScale: 0.5 }
}

function activeTopBoundaryConnectionAt(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  requiredThroughMs: number,
): number | null {
  let connectedAtMs = Infinity
  for (const dot of snapshot.trailDots) {
    if (
      dot.ownerId === enemy.id
      && dot.spawnedAtMs <= snapshot.simulationMs
      && dot.expiresAtMs > requiredThroughMs + EPSILON
      && dot.position.y <= snapshot.field.padding + 0.8
    ) connectedAtMs = Math.min(connectedAtMs, dot.spawnedAtMs)
  }
  return finite(connectedAtMs) ? connectedAtMs : null
}

function lateEnclosureConstraints(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  coordinationConstraints?: GroupCandidateConstraints,
): GroupCandidateConstraints | undefined {
  if (profile.lookaheadMs < 2_000) return coordinationConstraints
  const activeOwnDots = snapshot.trailDots.filter((dot) => (
    dot.ownerId === enemy.id
    && dot.spawnedAtMs <= snapshot.simulationMs
    && dot.expiresAtMs > snapshot.simulationMs
  ))
  const wallX = snapshot.field.width / 2 + (enemy.id === 'enemy-0' ? 7 : -7)
  const topAnchor = activeOwnDots
    .filter((dot) => (
      dot.position.y <= snapshot.field.padding + 0.75
      && dot.expiresAtMs > snapshot.simulationMs + profile.lookaheadMs + EPSILON
    ))
    .sort((left, right) => (
      Math.abs(left.position.x - enemy.position.x)
        - Math.abs(right.position.x - enemy.position.x)
      || left.position.y - right.position.y
      || left.spawnedAtMs - right.spawnedAtMs
      || left.id - right.id
    ))[0]
  const side = topAnchor
    ? (topAnchor.position.x <= snapshot.field.width / 2 ? -1 : 1)
    : (enemy.id === 'enemy-0' ? -1 : 1)
  const target = topAnchor
    ? {
        x: clamp(topAnchor.position.x + side * 1.5, snapshot.field.padding + 1, snapshot.field.width - snapshot.field.padding - 1),
        y: snapshot.field.height - snapshot.field.padding - 0.9,
      }
    : {
        x: wallX + (wallX > snapshot.field.width / 2 ? 5 : -5),
        y: snapshot.field.padding + 0.7,
  }
  const canonicalTrajectory = lateEnclosureTraceCandidate(
    snapshot,
    enemy,
    profile,
    target,
  )
  const emergencyTrajectoryOverrides = [
    lateEnclosureEmergencyVariant(
      snapshot,
      enemy,
      profile,
      canonicalTrajectory,
      -1,
    ),
    lateEnclosureEmergencyVariant(
      snapshot,
      enemy,
      profile,
      canonicalTrajectory,
      1,
    ),
  ]
  const firstEmergencyIndex = profile.candidateCount
    - emergencyTrajectoryOverrides.length
    - 1
  for (let index = 0; index < emergencyTrajectoryOverrides.length; index += 1) {
    emergencyTrajectoryOverrides[index].candidateIndex = firstEmergencyIndex + index
  }
  canonicalTrajectory.candidateIndex = profile.candidateCount - 1
  return {
    ...coordinationConstraints,
    offensiveEndpointTarget: target,
    preferTopBoundaryTrace: !topAnchor,
    preferredCandidateIndex: profile.candidateCount - 1,
    trajectoryOverride: canonicalTrajectory,
    trajectoryOverrides: [canonicalTrajectory],
    emergencyTrajectoryOverrides,
  }
}

function topBoundaryTraceProgress(
  snapshot: SnakePlannerSnapshot,
  candidate: InternalTrajectoryCandidate,
): number {
  materializeCandidatePath(candidate)
  const path = candidate.path
  const connectionY = snapshot.field.padding + 0.8
  const connectedAt = path.findIndex((point) => point.y <= connectionY)
  if (connectedAt < 0) return 0
  let furthestAfterConnection = path[connectedAt].y
  for (let index = connectedAt + 1; index < path.length; index += 1) {
    furthestAfterConnection = Math.max(furthestAfterConnection, path[index].y)
  }
  return 1 + Math.max(0, furthestAfterConnection - path[connectedAt].y)
}

function topBoundaryTraceConnectionStep(
  snapshot: SnakePlannerSnapshot,
  candidate: InternalTrajectoryCandidate,
): number {
  materializeCandidatePath(candidate)
  const path = candidate.path
  const connectedAt = path.findIndex(
    (point) => point.y <= snapshot.field.padding + 0.8,
  )
  return connectedAt < 0 ? Number.MAX_SAFE_INTEGER : connectedAt
}

function firstPlayerCollisionSegment(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  path: readonly SnakeVector[],
  hypotheses: SnakePlayerHypotheses,
  stepMs: number,
): number {
  const graceUntilMs = snapshot.simulationMs
    + Math.min(enemy.collisionGraceMs, snapshot.player.collisionGraceMs)
  let enemyStart = enemy.position
  for (let index = 0; index < path.length; index += 1) {
    const enemyEnd = path[index]
    const segmentStartsAtMs = snapshot.simulationMs + index * stepMs
    for (const hypothesis of hypotheses.all) {
      const playerStart = index === 0 ? snapshot.player.position : hypothesis[index - 1]
      const playerEnd = hypothesis[index]
      const contact = movingCircleInterval(
        enemyStart,
        enemyEnd,
        playerStart,
        playerEnd,
        PLAYER_HEAD_REPAIR_CLEARANCE + riskMargin(enemy) * 0.5,
      )
      if (
        contact
        && segmentStartsAtMs + contact[1] * stepMs + EPSILON >= graceUntilMs
      ) return index
    }
    enemyStart = enemyEnd
  }
  return -1
}

function firstTrailCollisionSegment(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  path: readonly SnakeVector[],
  stepMs: number,
): number {
  const trailIndex = buildTrailIndex(snapshot)
  let start = enemy.position
  for (let index = 0; index < path.length; index += 1) {
    if (trailCollisionTime(
      trailIndex,
      enemy.id,
      start,
      path[index],
      snapshot.simulationMs + index * stepMs,
      stepMs,
      TRAIL_COLLISION_RADIUS + riskMargin(enemy),
      snapshot.simulationMs + enemy.collisionGraceMs,
    ) !== null) return index
    start = path[index]
  }
  return -1
}

function firstGeneratedTrailCollisionSegment(
  enemy: SnakePlannerActor,
  path: readonly SnakeVector[],
  stepMs: number,
): number {
  const points = [enemy.position, ...path]
  const radius = TRAIL_COLLISION_RADIUS + riskMargin(enemy)
  for (let headIndex = 1; headIndex < points.length; headIndex += 1) {
    const headStartsAtMs = (headIndex - 1) * stepMs
    for (let trailIndex = 1; trailIndex < headIndex; trailIndex += 1) {
      if (
        trailIndex * stepMs
        > headStartsAtMs - SELF_TRAIL_IGNORE_MS + EPSILON
      ) continue
      if (movingCircleInterval(
        points[headIndex - 1],
        points[headIndex],
        points[trailIndex],
        points[trailIndex],
        radius,
      )) return headIndex - 1
    }
  }
  return -1
}

function repairLateEnclosureTail(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  speedScale: SnakePlanSpeedScale,
  originalDirections: readonly SnakeVector[],
  originalPath: readonly SnakeVector[],
  originalRawPath: readonly SnakeVector[],
): { directions: SnakeVector[]; path: SnakeVector[]; rawPath: SnakeVector[] } {
  const hypotheses = acquirePlayerHypotheses(
    snapshot,
    profile.lookaheadMs,
    profile.rolloutStepMs,
  )
  try {
    const riskIndices = [firstPlayerCollisionSegment(
      snapshot,
      enemy,
      originalPath,
      hypotheses,
      profile.rolloutStepMs,
    ), firstTrailCollisionSegment(
      snapshot,
      enemy,
      originalPath,
      profile.rolloutStepMs,
    ), firstGeneratedTrailCollisionSegment(
      enemy,
      originalPath,
      profile.rolloutStepMs,
    )].filter((index) => index >= 0)
    const collisionIndex = riskIndices.length > 0 ? Math.min(...riskIndices) : -1
    const committedPrefixSteps = Math.ceil(profile.commitMs / profile.rolloutStepMs)
    if (collisionIndex < 0) {
      return {
        directions: originalDirections.map((direction) => ({ ...direction })),
        path: originalPath.map((point) => ({ ...point })),
        rawPath: originalRawPath.map((point) => ({ ...point })),
      }
    }
    const planningCadenceMs = 1_000 / profile.planningHz
    const nextFreshPlanningBoundaryMs = Math.ceil(
      profile.commitMs / planningCadenceMs,
    ) * planningCadenceMs
    const requiresPreemptivePrefix = (
      (collisionIndex + 1) * profile.rolloutStepMs
      <= nextFreshPlanningBoundaryMs + EPSILON
    )
    const evasionLeadSteps = Math.ceil(600 / profile.rolloutStepMs)
    const repairStartsAt = requiresPreemptivePrefix
      ? 0
      : Math.max(committedPrefixSteps, collisionIndex - evasionLeadSteps)
    const enclosureRecoveryStartsAt = collisionIndex
      + Math.ceil(SELF_TRAIL_IGNORE_MS / profile.rolloutStepMs)
    const directions = originalDirections.slice(0, repairStartsAt).map(
      (direction) => ({ ...direction }),
    )
    const path = originalPath.slice(0, repairStartsAt).map((point) => ({ ...point }))
    const rawPath = originalRawPath.slice(0, repairStartsAt).map((point) => ({ ...point }))
    const prefix = rolloutDirections(
      enemy.position,
      enemy.velocity,
      enemy.maximumSpeedPerSecond,
      directions,
      speedScale,
      profile.rolloutStepMs,
      snapshot.field,
    )
    let position = path.at(-1) ?? enemy.position
    let velocity = prefix.velocity
    let heading = magnitude(velocity) > EPSILON
      ? Math.atan2(velocity.y, velocity.x)
      : Math.atan2(directions.at(-1)?.y ?? 0, directions.at(-1)?.x ?? 1)
    const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND
      * profile.rolloutStepMs / 1_000
    const margin = riskMargin(enemy)
    for (let index = repairStartsAt; index < originalDirections.length; index += 1) {
      const playerPoints = hypotheses.all.map((hypothesis) => hypothesis[index])
      const playerCenter = playerPoints.reduce((total, point) => ({
        x: total.x + point.x / playerPoints.length,
        y: total.y + point.y / playerPoints.length,
      }), { x: 0, y: 0 })
      const verticalEscape = snapshot.field.height / 2 - position.y
      const recoveringEnclosure = enemy.role === 'blocker'
        && index > enclosureRecoveryStartsAt
      const referencePoint = originalPath[Math.min(
        originalPath.length - 1,
        index + Math.ceil(400 / profile.rolloutStepMs),
      )] ?? originalPath.at(-1) ?? position
      const targetHeading = recoveringEnclosure
        ? Math.atan2(
            referencePoint.y - position.y,
            referencePoint.x - position.x,
          )
        : Math.atan2(
            verticalEscape,
            position.x - playerCenter.x,
          )
      const headings = [
        heading - maximumTurn,
        heading,
        heading + maximumTurn,
        turnToward(heading, targetHeading, maximumTurn),
      ]
      let best: {
        option: number
        heading: number
        direction: SnakeVector
        position: SnakeVector
        rawPosition: SnakeVector
        velocity: SnakeVector
        safety: number
        targetAlignment: number
      } | null = null
      for (let option = 0; option < headings.length; option += 1) {
        const optionHeading = headings[option]
        const direction = { x: Math.cos(optionHeading), y: Math.sin(optionHeading) }
        const rollout = rolloutDirections(
          position,
          velocity,
          enemy.maximumSpeedPerSecond,
          [direction],
          speedScale,
          profile.rolloutStepMs,
          snapshot.field,
        )
        const next = rollout.path[0]
        const rawNext = rollout.rawPath[0]
        const segmentStartsAtMs = snapshot.simulationMs
          + index * profile.rolloutStepMs
        const segmentEndsAtMs = segmentStartsAtMs + profile.rolloutStepMs
        const priorPlayerPoints = hypotheses.all.map((hypothesis) => (
          index === 0 ? snapshot.player.position : hypothesis[index - 1]
        ))
        let safety = Math.min(
          rawNext.x - snapshot.field.padding - margin,
          snapshot.field.width - snapshot.field.padding - margin - rawNext.x,
          rawNext.y - snapshot.field.padding - margin,
          snapshot.field.height - snapshot.field.padding - margin - rawNext.y,
          ...playerPoints.map((point, hypothesisIndex) => (
            movingCircleMinimumDistance(
              position,
              next,
              priorPlayerPoints[hypothesisIndex],
              point,
            ) - PLAYER_HEAD_CLEARANCE - margin * 0.5
          )),
        )
        for (const dot of snapshot.trailDots) {
          if (
            dot.spawnedAtMs >= segmentEndsAtMs
            || dot.expiresAtMs <= segmentStartsAtMs
            || (
              dot.ownerId === enemy.id
              && segmentEndsAtMs - dot.spawnedAtMs
                < SELF_TRAIL_IGNORE_MS - EPSILON
            )
          ) continue
          safety = Math.min(
            safety,
            movingCircleMinimumDistance(
              position,
              next,
              dot.position,
              dot.position,
            ) - TRAIL_COLLISION_RADIUS - margin,
          )
        }
        for (let trailIndex = 0; trailIndex < path.length; trailIndex += 1) {
          const spawnedAtMs = snapshot.simulationMs
            + (trailIndex + 1) * profile.rolloutStepMs
          if (segmentEndsAtMs - spawnedAtMs < SELF_TRAIL_IGNORE_MS - EPSILON) continue
          safety = Math.min(
            safety,
            movingCircleMinimumDistance(
              position,
              next,
              path[trailIndex],
              path[trailIndex],
            ) - TRAIL_COLLISION_RADIUS - margin,
          )
        }
        for (const committed of snapshot.committedAllyPaths) {
          if (committed.enemyId === enemy.id) continue
          const allyStart = committedPointAt(committed, segmentStartsAtMs)
          const allyEnd = committedPointAt(committed, segmentEndsAtMs)
          if (allyStart && allyEnd) safety = Math.min(
            safety,
            movingCircleMinimumDistance(
              position,
              next,
              allyStart,
              allyEnd,
            ) - ALLY_COLLISION_RADIUS - margin,
          )
        }
        const targetAlignment = Math.cos(signedAngleDifference(optionHeading, targetHeading))
        const optionIsSafe = safety >= -EPSILON
        const bestIsSafe = best !== null && best.safety >= -EPSILON
        if (
          !best
          || (
            recoveringEnclosure
            && optionIsSafe
            && !bestIsSafe
          )
          || (
            recoveringEnclosure
            && optionIsSafe === bestIsSafe
            && optionIsSafe
            && targetAlignment > best.targetAlignment + EPSILON
          )
          || (
            (!recoveringEnclosure || (!optionIsSafe && !bestIsSafe))
            && safety > best.safety + EPSILON
          )
          || (
            Math.abs(safety - best.safety) <= EPSILON
            && targetAlignment > best.targetAlignment + EPSILON
          )
          || (
            Math.abs(safety - best.safety) <= EPSILON
            && Math.abs(targetAlignment - best.targetAlignment) <= EPSILON
            && option < best.option
          )
        ) {
          best = {
            option,
            heading: optionHeading,
            direction,
            position: next,
            rawPosition: rawNext,
            velocity: rollout.velocity,
            safety,
            targetAlignment,
          }
        }
      }
      if (!best) break
      directions.push(best.direction)
      path.push(best.position)
      rawPath.push(best.rawPosition)
      position = best.position
      velocity = best.velocity
      heading = best.heading
    }
    return { directions, path, rawPath }
  } finally {
    releasePlayerHypotheses(hypotheses)
  }
}

function immediateLateEnclosureVariant(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  speedScale: SnakePlanSpeedScale,
  referenceDirections: readonly SnakeVector[],
  referencePath: readonly SnakeVector[],
  turnBias: -1 | 1,
): { directions: SnakeVector[]; path: SnakeVector[]; rawPath: SnakeVector[] } {
  const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND
    * profile.rolloutStepMs / 1_000
  const forcedTurnSteps = Math.ceil(300 / profile.rolloutStepMs)
  let position = { ...enemy.position }
  let velocity = { ...enemy.velocity }
  let heading = magnitude(velocity) > EPSILON
    ? Math.atan2(velocity.y, velocity.x)
    : 0
  const directions: SnakeVector[] = []
  const path: SnakeVector[] = []
  const rawPath: SnakeVector[] = []
  for (let index = 0; index < referenceDirections.length; index += 1) {
    const desiredHeading = index < forcedTurnSteps
      ? heading + turnBias * maximumTurn
      : Math.atan2(
          referencePath[Math.min(index, referencePath.length - 1)].y
            - position.y,
          referencePath[Math.min(index, referencePath.length - 1)].x
            - position.x,
        )
    const nextHeading = turnToward(heading, desiredHeading, maximumTurn)
    const direction = { x: Math.cos(nextHeading), y: Math.sin(nextHeading) }
    const step = rolloutDirections(
      position,
      velocity,
      enemy.maximumSpeedPerSecond,
      [direction],
      speedScale,
      profile.rolloutStepMs,
      snapshot.field,
    )
    directions.push(direction)
    path.push(step.path[0])
    rawPath.push(step.rawPath[0])
    position = step.position
    velocity = step.velocity
    heading = nextHeading
  }
  return { directions, path, rawPath }
}

function lateEnclosureEmergencyVariant(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  canonical: InternalTrajectoryCandidate,
  turnBias: -1 | 1,
): InternalTrajectoryCandidate {
  materializeCandidatePath(canonical)
  const repaired = immediateLateEnclosureVariant(
    snapshot,
    enemy,
    profile,
    canonical.speedScale,
    canonical.directions,
    canonical.path,
    turnBias,
  )
  return {
    candidateIndex: canonical.candidateIndex,
    speedScale: canonical.speedScale,
    directions: repaired.directions,
    path: repaired.path,
    rawPath: repaired.rawPath,
    steeringCost: steeringCostForDirections(
      enemy,
      repaired.directions,
      canonical.speedScale,
    ),
    bounds: pathBounds(enemy.position, repaired.path),
    rawBounds: pathBounds(enemy.position, repaired.rawPath),
    pathMaterialized: true,
    materialized: true,
    score: emptyScore(),
  }
}

function lateEnclosureTraceCandidate(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  target: SnakeVector,
  forcedClosingTowardLeft?: boolean,
): InternalTrajectoryCandidate {
  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND
    * profile.rolloutStepMs / 1_000
  let position = { ...enemy.position }
  let velocity = { ...enemy.velocity }
  const activeOwnDots = snapshot.trailDots.filter((dot) => (
    dot.ownerId === enemy.id
    && dot.spawnedAtMs <= snapshot.simulationMs
    && dot.expiresAtMs > snapshot.simulationMs
  ))
  const recentTraceDots = [...activeOwnDots].sort((left, right) => (
    right.spawnedAtMs - left.spawnedAtMs || right.id - left.id
  ))
  let recentTraceHeading: number | undefined
  for (let newerIndex = 0; newerIndex < recentTraceDots.length; newerIndex += 1) {
    const newer = recentTraceDots[newerIndex]
    for (let olderIndex = newerIndex + 1; olderIndex < recentTraceDots.length; olderIndex += 1) {
      const older = recentTraceDots[olderIndex]
      if (newer.spawnedAtMs - older.spawnedAtMs > 600) break
      const delta = {
        x: newer.position.x - older.position.x,
        y: newer.position.y - older.position.y,
      }
      if (magnitude(delta) < 0.24) continue
      recentTraceHeading = Math.atan2(delta.y, delta.x)
      break
    }
    if (recentTraceHeading !== undefined) break
  }
  let heading = magnitude(velocity) > EPSILON
    ? Math.atan2(velocity.y, velocity.x)
    : recentTraceHeading ?? 0
  const topConnectionDot = activeOwnDots
    .filter((dot) => (
      dot.position.y <= snapshot.field.padding + 0.8
      && dot.expiresAtMs > snapshot.simulationMs + profile.lookaheadMs + EPSILON
    ))
    .sort((left, right) => left.spawnedAtMs - right.spawnedAtMs || left.id - right.id)[0]
  const alreadyConnected = topConnectionDot !== undefined
  let capStarted = alreadyConnected
  let predictedConnection = alreadyConnected
  const activePlayerDots = snapshot.trailDots.filter((dot) => (
    dot.ownerId === snapshot.player.id
    && dot.spawnedAtMs <= snapshot.simulationMs
    && dot.expiresAtMs > snapshot.simulationMs
  ))
  const connectorAxisX = alreadyConnected
    ? target.x
    : enemy.position.x + (enemy.id === 'enemy-0' ? 3 : -3)
  const connector = activePlayerDots
    .filter((dot) => (
      dot.position.y > enemy.position.y + 1
      && (profile.lookaheadMs < 2_500
        || distance(enemy.position, snapshot.player.position) < 3
        || snapshot.simulationMs - dot.spawnedAtMs >= 600)
    ))
    .sort((left, right) => (
      right.spawnedAtMs - left.spawnedAtMs
      || Math.abs(left.position.x - connectorAxisX)
        - Math.abs(right.position.x - connectorAxisX)
      || left.position.y - right.position.y
      || right.id - left.id
    ))[0]
  const closingTurnY = connector
    ? connector.position.y - 2.6
    : snapshot.field.height - snapshot.field.padding - 2.6
  const exitSideEvidence = [...activePlayerDots]
    .filter((dot) => Math.abs(dot.position.x - snapshot.field.width / 2) > 0.1)
    .sort((left, right) => (
      left.spawnedAtMs - right.spawnedAtMs || left.id - right.id
    ))[0]
  const closingHeading = exitSideEvidence
    ? (exitSideEvidence.position.x >= snapshot.field.width / 2 ? Math.PI : 0)
    : connectorAxisX >= snapshot.player.position.x ? 0 : Math.PI
  const enteringClosingTurn = position.y >= closingTurnY
  const preferredClosingTowardLeft = closingHeading === Math.PI
  const closingTraceDots = snapshot.trailDots
    .filter((dot) => (
      dot.ownerId === enemy.id
      && dot.spawnedAtMs <= snapshot.simulationMs
      && dot.expiresAtMs > snapshot.simulationMs
      && dot.position.y >= snapshot.field.height / 2 - 1
    ))
    .sort((left, right) => right.spawnedAtMs - left.spawnedAtMs || right.id - left.id)
  let closingTraceDelta: SnakeVector | undefined
  let strongestClosingTraceSpan = 0
  let newestClosingTraceAtMs = -Infinity
  for (let newerIndex = 0; newerIndex < closingTraceDots.length; newerIndex += 1) {
    const newer = closingTraceDots[newerIndex]
    for (let olderIndex = newerIndex + 1; olderIndex < closingTraceDots.length; olderIndex += 1) {
      const older = closingTraceDots[olderIndex]
      if (newer.spawnedAtMs - older.spawnedAtMs > 600) break
      const delta = {
        x: newer.position.x - older.position.x,
        y: newer.position.y - older.position.y,
      }
      const span = Math.abs(delta.x)
      if (
        span >= 0.45
        && span >= Math.abs(delta.y) * 1.25
        && (span > strongestClosingTraceSpan + EPSILON
          || (Math.abs(span - strongestClosingTraceSpan) <= EPSILON
            && newer.spawnedAtMs > newestClosingTraceAtMs))
      ) {
        closingTraceDelta = delta
        strongestClosingTraceSpan = span
        newestClosingTraceAtMs = newer.spawnedAtMs
      }
    }
  }
  const lockedClosingTowardLeft = closingTraceDelta
    && Math.abs(closingTraceDelta.x) >= 0.45
    && Math.abs(closingTraceDelta.x) >= Math.abs(closingTraceDelta.y) * 1.25
    ? closingTraceDelta.x < 0
    : undefined
  const playerBlocksPreferredSide = lockedClosingTowardLeft === undefined
    && predictedConnection
    && enteringClosingTurn
    && distance(enemy.position, snapshot.player.position) < 3
    && (preferredClosingTowardLeft
      ? snapshot.player.position.x < enemy.position.x
      : snapshot.player.position.x > enemy.position.x)
  const closingTowardLeft = forcedClosingTowardLeft
    ?? lockedClosingTowardLeft
    ?? (playerBlocksPreferredSide
      ? !preferredClosingTowardLeft
      : preferredClosingTowardLeft)
  const diagonalTraceFront = topConnectionDot && activeOwnDots
    .filter((dot) => dot.position.y >= topConnectionDot.position.y + 1)
    .sort((left, right) => (
      right.position.y - left.position.y
      || right.spawnedAtMs - left.spawnedAtMs
      || right.id - left.id
    ))[0]
  const diagonalTraceDelta = topConnectionDot && diagonalTraceFront
    ? {
        x: diagonalTraceFront.position.x - topConnectionDot.position.x,
        y: diagonalTraceFront.position.y - topConnectionDot.position.y,
      }
    : undefined
  const incomingTopTraceMaximumY = topConnectionDot
    ? activeOwnDots
        .filter((dot) => dot.spawnedAtMs <= topConnectionDot.spawnedAtMs)
        .reduce((maximumY, dot) => Math.max(maximumY, dot.position.y), topConnectionDot.position.y)
    : -Infinity
  const incomingTopTraceCleared = !topConnectionDot
    || enemy.position.y >= incomingTopTraceMaximumY
      + TRAIL_COLLISION_RADIUS + riskMargin(enemy)
  const directDiagonalWall = alreadyConnected
    && lockedClosingTowardLeft === undefined
    && incomingTopTraceCleared
    && (
    enemy.position.y <= snapshot.field.padding + 3
    || !!(
      diagonalTraceDelta
      && diagonalTraceDelta.y >= 1
      && Math.abs(diagonalTraceDelta.x) >= 0.45
    )
    )
  const enemyToPlayer = {
    x: snapshot.player.position.x - enemy.position.x,
    y: snapshot.player.position.y - enemy.position.y,
  }
  const enemyIsSeparatingFromPlayer = (
    enemy.velocity.x * enemyToPlayer.x + enemy.velocity.y * enemyToPlayer.y
  ) < -EPSILON
  const traceSpeedScale: 0.5 | 1 = predictedConnection
    && enteringClosingTurn
    && distance(enemy.position, snapshot.player.position) < 3
    && !enemyIsSeparatingFromPlayer
    ? 0.5
    : 1
  const currentClosingHeading = closingTowardLeft ? Math.PI : 0
  const anticipateBottomLeg = lockedClosingTowardLeft !== undefined
  const nominalBottomLegX = snapshot.field.width / 2
    + (closingTowardLeft ? -1.6 : 1.6)
  const baseBottomLegX = playerBlocksPreferredSide
    ? closingTowardLeft
      ? Math.min(nominalBottomLegX, enemy.position.x - 2.4)
      : Math.max(nominalBottomLegX, enemy.position.x + 2.4)
    : nominalBottomLegX
  const bottomTurnReserve = enemy.maximumSpeedPerSecond
    / RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND
    + riskMargin(enemy)
    + 1.2
  const bottomTurnY = snapshot.field.height - snapshot.field.padding - bottomTurnReserve
  const bottomCorridorDots = activePlayerDots.filter((dot) => (
    dot.position.y >= Math.min(enemy.position.y, bottomTurnY) - 0.75
    && dot.position.y <= Math.max(enemy.position.y, bottomTurnY) + 0.75
  ))
  const corridorClearance = TRAIL_COLLISION_RADIUS
    + riskMargin(enemy)
    + enemy.maximumSpeedPerSecond / RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND
  const playerSafeBottomLegX = bottomCorridorDots.length === 0
    ? baseBottomLegX
    : closingTowardLeft
      ? Math.min(...bottomCorridorDots.map((dot) => dot.position.x)) - corridorClearance
      : Math.max(...bottomCorridorDots.map((dot) => dot.position.x)) + corridorClearance
  const bottomLegX = clamp(
    closingTowardLeft
      ? Math.min(baseBottomLegX, playerSafeBottomLegX)
      : Math.max(baseBottomLegX, playerSafeBottomLegX),
    snapshot.field.padding + riskMargin(enemy) + 0.2,
    snapshot.field.width - snapshot.field.padding - riskMargin(enemy) - 0.2,
  )
  const anchoredCapTowardLeft = topConnectionDot
    && Math.abs(topConnectionDot.position.x - snapshot.field.width / 2) >= 5
    ? topConnectionDot.position.x < snapshot.field.width / 2
    : !closingTowardLeft
  let bottomLegStarted = predictedConnection && (closingTowardLeft
    ? position.x <= bottomLegX + 0.15
    : position.x >= bottomLegX - 0.15)
  let bottomCapStarted = bottomLegStarted && position.y >= bottomTurnY
  let closingTurnStarted = predictedConnection
    && (enteringClosingTurn || lockedClosingTowardLeft !== undefined)
  const nextFreshPlanningBoundaryMs = Math.ceil(
    profile.commitMs / (1_000 / profile.planningHz),
  ) * (1_000 / profile.planningHz)
  const executedPrefixSteps = Math.ceil(
    nextFreshPlanningBoundaryMs / profile.rolloutStepMs,
  )
  // Recovery follows the authoritative phase of the active wall. Before its
  // closing turn, the wall target identifies the open component. Once the
  // horizontal leg or bottom cap is established, the locked trace direction
  // is the only current-snapshot evidence that does not flip with player bait.
  const anchoredExteriorTowardLeft = topConnectionDot
    && Math.abs(topConnectionDot.position.x - snapshot.field.width / 2) >= 5
    ? topConnectionDot.position.x < snapshot.field.width / 2
    : closingTowardLeft
  const recoveryTowardLeft = alreadyConnected
    ? anchoredExteriorTowardLeft
    : target.x < enemy.position.x
  const recoverySide = recoveryTowardLeft ? -1 : 1
  const recoveryY = closingTurnStarted && !bottomCapStarted
    ? snapshot.field.height - snapshot.field.padding - riskMargin(enemy) - 1.35
    : enemy.position.y
  const recoveryMinimumX = snapshot.field.padding + riskMargin(enemy) + 1
  const recoveryMaximumX = snapshot.field.width
    - snapshot.field.padding
    - riskMargin(enemy)
    - 1
  const recoveryTarget = {
    x: closingTurnStarted && !bottomCapStarted
      ? clamp(
          enemy.position.x + recoverySide * 8,
          recoveryMinimumX,
          recoveryMaximumX,
        )
      : recoverySide < 0 ? recoveryMinimumX : recoveryMaximumX,
    y: clamp(
      recoveryY,
      snapshot.field.padding + riskMargin(enemy) + 1,
      snapshot.field.height - snapshot.field.padding - riskMargin(enemy) - 1,
    ),
  }
  const directions: SnakeVector[] = []
  const path: SnakeVector[] = []
  const rawPath: SnakeVector[] = []
  for (let index = 0; index < stepCount; index += 1) {
    if (
      predictedConnection
      && (directDiagonalWall || anticipateBottomLeg)
      && !bottomLegStarted
      && (closingTowardLeft
        ? position.x <= bottomLegX + 0.15
        : position.x >= bottomLegX - 0.15)
    ) {
      bottomLegStarted = true
      bottomCapStarted = position.y >= bottomTurnY
    }
    let nextHeading: number
    if (predictedConnection) {
      if (bottomCapStarted || (bottomLegStarted && position.y >= bottomTurnY)) {
        bottomCapStarted = true
        nextHeading = anchoredCapTowardLeft
          ? Math.min(heading + maximumTurn, Math.PI)
          : Math.max(heading - maximumTurn, 0)
      } else if (bottomLegStarted) {
        const desired = Math.atan2(bottomTurnY - position.y, bottomLegX - position.x)
        nextHeading = turnToward(heading, desired, maximumTurn)
      } else if (directDiagonalWall) {
        const desired = Math.atan2(bottomTurnY - position.y, bottomLegX - position.x)
        nextHeading = turnToward(heading, desired, maximumTurn)
      } else if (closingTurnStarted || position.y >= closingTurnY) {
        closingTurnStarted = true
        nextHeading = turnToward(heading, currentClosingHeading, maximumTurn)
      } else {
        const descentX = alreadyConnected ? target.x : position.x
        const desired = Math.atan2(closingTurnY - position.y, descentX - position.x)
        nextHeading = turnToward(heading, desired, maximumTurn)
      }
    } else if (!capStarted) {
      nextHeading = turnToward(heading, -Math.PI / 2, maximumTurn)
    } else if (heading < Math.PI / 2 - maximumTurn * 0.5) {
      // Trace a clockwise semicircle whose crown touches the top boundary.
      // The bounded turn is tangent-continuous, so it never reverses through
      // the incoming self trail before descending on the cap's far side.
      nextHeading = heading + maximumTurn
    } else {
      nextHeading = turnToward(heading, Math.PI / 2, maximumTurn)
    }
    if (
      alreadyConnected
      && index >= executedPrefixSteps
      && (
        bottomCapStarted
        || (!bottomLegStarted
          && !directDiagonalWall
          && (closingTurnStarted || incomingTopTraceCleared))
      )
    ) {
      if (bottomCapStarted) {
        const exteriorTarget = {
          x: recoverySide < 0 ? recoveryMinimumX : recoveryMaximumX,
          y: snapshot.field.height
            - snapshot.field.padding
            - riskMargin(enemy)
            - 0.75,
        }
        nextHeading = turnToward(
          heading,
          Math.atan2(
            exteriorTarget.y - position.y,
            exteriorTarget.x - position.x,
          ),
          maximumTurn,
        )
      } else {
        const recoveryDeltaY = closingTurnStarted && !bottomCapStarted
          ? Math.max(0, recoveryTarget.y - position.y)
          : recoveryTarget.y - position.y
        const passedClosingTarget = closingTurnStarted
          && !bottomCapStarted
          && (recoverySide < 0
            ? position.x <= recoveryTarget.x
            : position.x >= recoveryTarget.x)
        const reachedClosingBottom = closingTurnStarted
          && !bottomCapStarted
          && recoveryDeltaY <= EPSILON
        if (passedClosingTarget) {
          nextHeading = recoverySide > 0
            ? Math.min(heading + maximumTurn, Math.PI)
            : Math.max(heading - maximumTurn, 0)
        } else if (reachedClosingBottom) {
          nextHeading = recoverySide > 0
            ? Math.max(heading - maximumTurn, 0)
            : Math.min(heading + maximumTurn, Math.PI)
        } else {
          const recoveryHeading = Math.atan2(
            recoveryDeltaY,
            recoveryTarget.x - position.x,
          )
          nextHeading = turnToward(heading, recoveryHeading, maximumTurn)
        }
      }
    } else if (
      alreadyConnected
      && index < executedPrefixSteps
      && snapshot.committedAllyPaths.length > 0
    ) {
      const atMs = snapshot.simulationMs + (index + 1) * profile.rolloutStepMs
      let closestAlly: SnakeVector | null = null
      let closestDistance = Infinity
      for (const committed of snapshot.committedAllyPaths) {
        if (committed.enemyId === enemy.id) continue
        const ally = committedPointAt(committed, atMs)
          ?? committed.samples.at(-1)?.position
        if (!ally) continue
        const separation = distance(position, ally)
        if (separation < closestDistance) {
          closestDistance = separation
          closestAlly = ally
        }
      }
      if (
        closestAlly
        && closestDistance <= ALLY_COLLISION_RADIUS
          + riskMargin(enemy)
          + enemy.maximumSpeedPerSecond * profile.rolloutStepMs / 1_000
      ) {
        const tangent = { x: Math.cos(nextHeading), y: Math.sin(nextHeading) }
        const away = normalize({
          x: position.x - closestAlly.x,
          y: position.y - closestAlly.y,
        }, tangent)
        const projection = away.x * tangent.x + away.y * tangent.y
        const lateral = normalize({
          x: away.x - tangent.x * projection,
          y: away.y - tangent.y * projection,
        }, { x: 0, y: 0 })
        if (magnitude(lateral) > EPSILON) {
          const repelled = normalize({
            x: tangent.x + lateral.x * 0.5,
            y: tangent.y + lateral.y * 0.5,
          }, tangent)
          nextHeading = turnToward(
            heading,
            Math.atan2(repelled.y, repelled.x),
            maximumTurn,
          )
        }
      }
    }
    const direction = {
      x: Math.cos(nextHeading),
      y: Math.sin(nextHeading),
    }
    directions.push(direction)
    const step = rolloutDirections(
      position,
      velocity,
      enemy.maximumSpeedPerSecond,
      [direction],
      traceSpeedScale,
      profile.rolloutStepMs,
      snapshot.field,
    )
    position = step.position
    velocity = step.velocity
    path.push(step.path[0])
    rawPath.push(step.rawPath[0])
    heading = nextHeading
    if (
      position.y <= snapshot.field.padding + 2.5
      && heading <= -Math.PI / 2 + maximumTurn * 1.5
    ) {
      // Start the tangent before the fastest late-tier snake reaches vertical;
      // waiting one more rollout step carries its swept body through the wall.
      capStarted = true
    }
    if (position.y <= snapshot.field.padding + 0.8) predictedConnection = true
  }
  if (
    forcedClosingTowardLeft === undefined
    && directDiagonalWall
    && enemy.role === 'blocker'
    && enemy.position.y < bottomTurnY - EPSILON
  ) {
    const hypotheses = acquirePlayerHypotheses(
      snapshot,
      profile.lookaheadMs,
      profile.rolloutStepMs,
    )
    let playerCollisionIndex: number
    try {
      playerCollisionIndex = firstPlayerCollisionSegment(
        snapshot,
        enemy,
        path,
        hypotheses,
        profile.rolloutStepMs,
      )
    } finally {
      releasePlayerHypotheses(hypotheses)
    }
    if (playerCollisionIndex >= 0) {
      return lateEnclosureTraceCandidate(
        snapshot,
        enemy,
        profile,
        target,
        !closingTowardLeft,
      )
    }
  }
  const repaired = repairLateEnclosureTail(
    snapshot,
    enemy,
    profile,
    traceSpeedScale,
    directions,
    path,
    rawPath,
  )
  const bounds = pathBounds(enemy.position, repaired.path)
  return {
    candidateIndex: profile.candidateCount - 1,
    speedScale: traceSpeedScale,
    directions: repaired.directions,
    path: repaired.path,
    rawPath: repaired.rawPath,
    steeringCost: steeringCostForDirections(enemy, repaired.directions, traceSpeedScale),
    bounds: { ...bounds },
    rawBounds: pathBounds(enemy.position, repaired.rawPath),
    pathMaterialized: true,
    materialized: true,
    score: emptyScore(),
  }
}

function reservedBlockerCorridor(
  snapshot: SnakePlannerSnapshot,
  blocker: SnakePlannerActor,
  profile: SnakePlannerProfile,
  reserveEnclosureTrace: boolean,
): { commitment: SnakeCommittedPath; endpoint: SnakeVector } {
  const enclosure = reserveEnclosureTrace
    ? lateEnclosureConstraints(snapshot, blocker, profile)
    : undefined
  const path = enclosure?.trajectoryOverride?.path ?? []
  const endpoint = path.at(-1) ?? blocker.position
  const commitUntilMs = snapshot.simulationMs + profile.commitMs
  const samples: SnakeTimedPosition[] = [{
    atMs: snapshot.simulationMs,
    position: { ...blocker.position },
  }]
  let segmentStartAtMs = snapshot.simulationMs
  let segmentStart = blocker.position
  for (let index = 0; index < path.length; index += 1) {
    const segmentEndAtMs = snapshot.simulationMs + (index + 1) * profile.rolloutStepMs
    const segmentEnd = path[index]
    if (segmentEndAtMs < commitUntilMs - EPSILON) {
      samples.push({ atMs: segmentEndAtMs, position: { ...segmentEnd } })
      segmentStartAtMs = segmentEndAtMs
      segmentStart = segmentEnd
      continue
    }
    const fraction = clamp(
      (commitUntilMs - segmentStartAtMs) / (segmentEndAtMs - segmentStartAtMs),
      0,
      1,
    )
    samples.push({
      atMs: commitUntilMs,
      position: {
        x: segmentStart.x + (segmentEnd.x - segmentStart.x) * fraction,
        y: segmentStart.y + (segmentEnd.y - segmentStart.y) * fraction,
      },
    })
    break
  }
  if (samples.at(-1)!.atMs < commitUntilMs - EPSILON) {
    samples.push({ atMs: commitUntilMs, position: { ...segmentStart } })
  }
  return {
    commitment: { enemyId: blocker.id, commitUntilMs, samples },
    endpoint: { ...endpoint },
  }
}

function retainedEnclosureReservation(
  snapshot: SnakePlannerSnapshot,
  blocker: SnakePlannerActor,
  profile: SnakePlannerProfile,
  previousPlan: SnakePlan | null,
  enclosureConstraints: GroupCandidateConstraints | undefined,
): { commitment: SnakeCommittedPath; endpoint: SnakeVector } | null {
  if (
    !previousPlan
    || !reusablePlanValid(snapshot, blocker, profile, previousPlan)
    || identifyRetainedCustomCandidate(
      snapshot,
      blocker,
      previousPlan,
      profile,
      enclosureConstraints,
    ) === null
  ) return null
  const endpoint = previousPlan.path.at(-1)
  const commitment = resourceSnakePlanToCommittedPath(previousPlan, snapshot.simulationMs)
  return endpoint && commitment
    ? { commitment, endpoint: { ...endpoint } }
    : null
}

function groupSnapshotWithCommitment(
  snapshot: SnakePlannerSnapshot,
  plan: SnakePlan,
): SnakePlannerSnapshot {
  const committedAllyPaths = snapshot.committedAllyPaths.filter(
    (committed) => committed.enemyId !== plan.enemyId,
  )
  const commitment = resourceSnakePlanToCommittedPath(plan, snapshot.simulationMs)
  if (commitment) committedAllyPaths.push(commitment)
  return { ...snapshot, committedAllyPaths }
}

function executableGroupPlan(plan: SnakePlan, simulationMs: number): boolean {
  return !!plan.path.at(-1) && resourceSnakePlanToCommittedPath(plan, simulationMs) !== null
}

function executableGroupHoldPlan(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
  startedAt: number,
  clock: () => number,
): SnakePlan {
  return safeFallback(snapshot, enemy.id, profile, enemy, startedAt, clock)
}

export function planResourceSnakeGroup(
  snapshot: SnakePlannerSnapshot,
  profile: SnakePlannerProfile,
  previousPlans: readonly SnakePlan[],
  timingHistoryMs: readonly number[],
  clock: () => number = defaultMonotonicClock,
): SnakeGroupPlan {
  const startedAt = safeClockValue(clock)
  try {
    if (!snapshotIsValid(snapshot) || !profileIsValid(profile)) {
      return {
        plans: [],
        roles: {},
        nextPlanningAtMs: 0,
        candidateBudget: 48,
        elapsedMs: elapsedSince(startedAt, clock),
      }
    }
    const cyanPlanning = cyanTelegraphMs(profile) > 0
    const adaptive: AdaptiveCandidateDecision = cyanPlanning
      ? { budget: profile.candidateCount, floorOverloaded: false }
      : adaptiveCandidateBudget(profile, previousPlans, timingHistoryMs)
    const candidateBudget = adaptive.budget
    const adaptiveProfile = { ...profile, candidateCount: candidateBudget } as SnakePlannerProfile
    const owners = roleOwnersAtPlanningBoundary(snapshot, previousPlans)
    const roles: Record<string, SnakeEnemyRole> = {}
    for (const enemy of [...snapshot.enemies].sort(compareEnemyIds)) {
      roles[enemy.id] = enemy.id === owners.pressure?.id ? 'pressure' : 'blocker'
    }
    const assignedSnapshot: SnakePlannerSnapshot = {
      ...snapshot,
      enemies: snapshot.enemies.map((enemy) => ({ ...enemy, role: roles[enemy.id] })),
    }
    const connectedEnclosureOwner = assignedSnapshot.enemies
      .map((enemy) => ({
        enemy,
        connectedAtMs: activeTopBoundaryConnectionAt(
          assignedSnapshot,
          enemy,
          assignedSnapshot.simulationMs + adaptiveProfile.lookaheadMs,
        ),
      }))
      .filter((entry): entry is { enemy: SnakePlannerActor; connectedAtMs: number } => (
        entry.connectedAtMs !== null
      ))
      .sort((left, right) => (
        left.connectedAtMs - right.connectedAtMs || compareEnemyIds(left.enemy, right.enemy)
      ))[0]?.enemy
    const enclosureOwnerId = !cyanPlanning && adaptiveProfile.lookaheadMs >= 2_000
      ? connectedEnclosureOwner?.id ?? owners.blocker?.id ?? owners.pressure?.id
      : undefined
    const previousFor = (enemyId: SnakeId) => {
      const previous = previousPlans.find((plan) => plan.enemyId === enemyId) ?? null
      const alreadyDeferredAtFloor = adaptive.floorOverloaded
        && candidateBudget === 48
        && previous?.evaluatedCandidates === 48
        && previous.commandAtMs > previous.plannedAtMs + EPSILON
      return alreadyDeferredAtFloor ? null : previous
    }
    const enclosureConstraintsFor = (
      planningSnapshot: SnakePlannerSnapshot,
      enemy: SnakePlannerActor,
      coordinationConstraints?: GroupCandidateConstraints,
    ) => enemy.id === enclosureOwnerId
      ? lateEnclosureConstraints(
          planningSnapshot,
          enemy,
          adaptiveProfile,
          coordinationConstraints,
        )
      : coordinationConstraints
    const plans: SnakePlan[] = []
    if (owners.pressure) {
      const blockerEnclosureConstraints = owners.blocker
        ? enclosureConstraintsFor(assignedSnapshot, owners.blocker)
        : undefined
      const retainedReservation = !cyanPlanning && owners.blocker
        ? retainedEnclosureReservation(
            assignedSnapshot,
            owners.blocker,
            adaptiveProfile,
            previousFor(owners.blocker.id),
            blockerEnclosureConstraints,
          )
        : null
      const reservation = retainedReservation ?? (!cyanPlanning && owners.blocker
        ? reservedBlockerCorridor(
            assignedSnapshot,
            owners.blocker,
            adaptiveProfile,
            enclosureOwnerId === owners.blocker.id,
          )
        : null)
      const pressurePlanningSnapshot = reservation && owners.blocker
        ? {
            ...assignedSnapshot,
            committedAllyPaths: [
              ...assignedSnapshot.committedAllyPaths.filter(
                (commitment) => commitment.enemyId !== owners.blocker?.id,
              ),
              reservation.commitment,
            ],
          }
        : assignedSnapshot
      const pressureConstraints = groupMotionConstraints(
        owners.pressure,
        'pressure',
        enclosureConstraintsFor(
          pressurePlanningSnapshot,
          owners.pressure,
          reservation
            ? groupConstraintsAgainstEndpoint(snapshot, reservation.endpoint)
            : undefined,
        ),
      )
      let pressurePlan = planResourceSnakeEnemyInternal(
        pressurePlanningSnapshot,
        owners.pressure.id,
        adaptiveProfile,
        previousFor(owners.pressure.id),
        clock,
        pressureConstraints,
      )
      if (!executableGroupPlan(pressurePlan, snapshot.simulationMs)) {
        pressurePlan = executableGroupHoldPlan(
          pressurePlanningSnapshot,
          owners.pressure,
          adaptiveProfile,
          startedAt,
          clock,
        )
      }
      if (owners.blocker) {
        const blockerSnapshot = groupSnapshotWithCommitment(assignedSnapshot, pressurePlan)
        const blockerConstraints = groupMotionConstraints(
          owners.blocker,
          'blocker',
          enclosureConstraintsFor(
            blockerSnapshot,
            owners.blocker,
            groupConstraintsAgainst(snapshot, pressurePlan),
          ),
        )
        let blockerPlan = planResourceSnakeEnemyInternal(
          blockerSnapshot,
          owners.blocker.id,
          adaptiveProfile,
          previousFor(owners.blocker.id),
          clock,
          blockerConstraints,
        )
        if (!executableGroupPlan(blockerPlan, snapshot.simulationMs)) {
          blockerPlan = executableGroupHoldPlan(
            blockerSnapshot,
            owners.blocker,
            adaptiveProfile,
            startedAt,
            clock,
          )
        }
        plans.push(pressurePlan, blockerPlan)
      } else {
        plans.push(pressurePlan)
      }
    }
    const cadencePlanningAtMs = snapshot.simulationMs + 1_000 / profile.planningHz
    const earliestExecutableExpiryMs = plans.reduce((earliest, plan) => (
      executableGroupPlan(plan, snapshot.simulationMs)
        ? Math.min(earliest, plan.commitUntilMs)
        : earliest
    ), Number.POSITIVE_INFINITY)
    return {
      plans,
      roles,
      nextPlanningAtMs: Math.min(cadencePlanningAtMs, earliestExecutableExpiryMs),
      candidateBudget,
      elapsedMs: elapsedSince(startedAt, clock),
    }
  } catch {
    return {
      plans: [],
      roles: {},
      nextPlanningAtMs: 0,
      candidateBudget: 48,
      elapsedMs: elapsedSince(startedAt, clock),
    }
  }
}
