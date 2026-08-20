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
  startsAtMs: number
  stepMs: number
  commitUntilMs: number
  path: SnakeVector[]
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
// About 72 square world-units of local maneuvering room is already an ample
// escape surface. Saturation keeps one-cell open-field edge clipping from
// outranking cutoff behavior while real pockets remain strictly smaller.
const REACHABLE_AREA_SATURATION_CELLS = 128
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

interface InternalTrajectoryCandidate extends SnakeTrajectoryCandidate {
  rawPath: SnakeVector[]
  steeringCost: number
}

interface ScoredCandidate extends InternalTrajectoryCandidate {
  score: SnakePlanScore
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
  buckets: Array<number[] | undefined>
  dots: readonly SnakePlannerTrailDot[]
}

interface GridWorkspace {
  width: number
  height: number
  enemyBase: Uint8Array
  playerBase: Uint8Array
  occupancy: Uint8Array
  visitMarks: Uint32Array
  queue: Int32Array
  depths: Uint16Array
  generation: number
}

const gridWorkspacePool = new Map<string, GridWorkspace[]>()
let cachedTrajectoryKey = ''
let cachedTrajectories: InternalTrajectoryCandidate[] | null = null

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function finiteVector(vector: SnakeVector): boolean {
  return finite(vector.x) && finite(vector.y)
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

function actorHasInvalidNumber(actor: SnakePlannerActor): boolean {
  return !finiteVector(actor.position)
    || !finiteVector(actor.velocity)
    || !finite(actor.integrity)
    || !finite(actor.maximumIntegrity)
    || actor.maximumIntegrity < 0
    || !finite(actor.maximumSpeedPerSecond)
    || actor.maximumSpeedPerSecond < 0
    || !finite(actor.collisionGraceMs)
    || actor.collisionGraceMs < 0
}

function profileIsValid(profile: SnakePlannerProfile): boolean {
  return (profile.candidateCount === 48 || profile.candidateCount === 72 || profile.candidateCount === 96)
    && finite(profile.lookaheadMs)
    && profile.lookaheadMs > 0
    && finite(profile.rolloutStepMs)
    && profile.rolloutStepMs === 50
    && profile.lookaheadMs % profile.rolloutStepMs === 0
    && finite(profile.commitMs)
    && profile.commitMs > 0
    && finite(profile.planningHz)
    && profile.planningHz > 0
}

function relevantHistory(snapshot: SnakePlannerSnapshot): SnakePlayerHistorySample[] {
  const earliest = snapshot.simulationMs - 2_000
  return snapshot.playerHistory
    .filter((sample) => sample.simulationMs >= earliest && sample.simulationMs <= snapshot.simulationMs)
    .slice()
    .sort((left, right) => left.simulationMs - right.simulationMs)
}

function committedPathValid(path: SnakeCommittedPath): boolean {
  return finite(path.startsAtMs)
    && finite(path.stepMs)
    && path.stepMs > 0
    && finite(path.commitUntilMs)
    && path.commitUntilMs >= path.startsAtMs
    && path.path.every(finiteVector)
}

function snapshotHasInvalidNumber(snapshot: SnakePlannerSnapshot): boolean {
  if (
    !finite(snapshot.simulationMs)
    || !finite(snapshot.field.width)
    || !finite(snapshot.field.height)
    || !finite(snapshot.field.padding)
    || snapshot.field.padding < 0
    || snapshot.field.width <= snapshot.field.padding * 2
    || snapshot.field.height <= snapshot.field.padding * 2
    || actorHasInvalidNumber(snapshot.player)
    || snapshot.enemies.some(actorHasInvalidNumber)
  ) return true
  if (snapshot.trailDots.some((dot) => (
    !finite(dot.id)
    || !finiteVector(dot.position)
    || !finite(dot.spawnedAtMs)
    || !finite(dot.expiresAtMs)
    || dot.expiresAtMs < dot.spawnedAtMs
  ))) return true
  if (relevantHistory(snapshot).some((sample) => (
    !finite(sample.simulationMs) || !finiteVector(sample.position) || !finiteVector(sample.velocity)
  ))) return true
  return snapshot.committedAllyPaths.some((path) => !committedPathValid(path))
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

export function predictResourceSnakePlayerHypotheses(
  snapshot: SnakePlannerSnapshot,
  lookaheadMs: number,
  stepMs: number,
): SnakePlayerHypotheses {
  const stepCount = Math.max(0, Math.floor(lookaheadMs / stepMs))
  const origin = snapshot.player.position
  const velocity = snapshot.player.velocity
  const speed = magnitude(velocity)
  const heading = speed > EPSILON ? Math.atan2(velocity.y, velocity.x) : 0
  const signedTurnRate = medianSignedTurnRate(relevantHistory(snapshot))
  const keepVelocity: SnakeVector[] = []
  const continueMedianTurn: SnakeVector[] = []
  const decelerate: SnakeVector[] = []
  const stayStopped: SnakeVector[] = []
  let turningPosition = { ...origin }
  const stepSeconds = stepMs / 1_000
  for (let index = 1; index <= stepCount; index += 1) {
    const seconds = index * stepSeconds
    keepVelocity.push({ x: origin.x + velocity.x * seconds, y: origin.y + velocity.y * seconds })
    const turningHeading = heading + signedTurnRate * seconds
    turningPosition = {
      x: turningPosition.x + Math.cos(turningHeading) * speed * stepSeconds,
      y: turningPosition.y + Math.sin(turningHeading) * speed * stepSeconds,
    }
    continueMedianTurn.push(turningPosition)
    const slowingSeconds = Math.min(seconds, 0.1)
    const displacementSeconds = slowingSeconds - slowingSeconds * slowingSeconds / 0.2
    decelerate.push({
      x: origin.x + velocity.x * displacementSeconds,
      y: origin.y + velocity.y * displacementSeconds,
    })
    stayStopped.push({ ...origin })
  }
  return {
    keepVelocity,
    continueMedianTurn,
    decelerate,
    stayStopped,
    all: [keepVelocity, continueMedianTurn, decelerate, stayStopped],
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
  const cacheKey = [
    enemy.position.x,
    enemy.position.y,
    enemy.velocity.x,
    enemy.velocity.y,
    enemy.maximumSpeedPerSecond,
    profile.candidateCount,
    profile.lookaheadMs,
    profile.rolloutStepMs,
    field?.width ?? 0,
    field?.height ?? 0,
    field?.padding ?? 0,
  ].join(':')
  if (cacheKey === cachedTrajectoryKey && cachedTrajectories) return cachedTrajectories
  const headingCount = profile.candidateCount / 3
  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  const initialSpeed = magnitude(enemy.velocity)
  const initialHeading = initialSpeed > EPSILON ? Math.atan2(enemy.velocity.y, enemy.velocity.x) : 0
  const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND * profile.rolloutStepMs / 1_000
  const result: InternalTrajectoryCandidate[] = []
  for (let headingIndex = 0; headingIndex < headingCount; headingIndex += 1) {
    const targetHeading = initialHeading + headingIndex / headingCount * TWO_PI
    for (let speedIndex = 0; speedIndex < SPEED_SCALES.length; speedIndex += 1) {
      const speedScale = SPEED_SCALES[speedIndex]
      const directions: SnakeVector[] = []
      let heading = initialHeading
      let steeringCost = Math.abs(
        enemy.maximumSpeedPerSecond * speedScale - initialSpeed,
      ) / Math.max(enemy.maximumSpeedPerSecond, EPSILON)
      for (let step = 0; step < stepCount; step += 1) {
        const next = turnToward(heading, targetHeading, maximumTurn)
        steeringCost += Math.abs(signedAngleDifference(heading, next))
        heading = next
        directions.push({ x: Math.cos(heading), y: Math.sin(heading) })
      }
      const rollout = rolloutDirections(
        enemy.position,
        enemy.velocity,
        enemy.maximumSpeedPerSecond,
        directions,
        speedScale,
        profile.rolloutStepMs,
        field,
      )
      result.push({
        candidateIndex: headingIndex * 3 + speedIndex,
        speedScale,
        directions,
        path: rollout.path,
        rawPath: rollout.rawPath,
        steeringCost,
      })
    }
  }
  cachedTrajectoryKey = cacheKey
  cachedTrajectories = result
  return result
}

export function generateResourceSnakeTrajectoryCandidates(
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
): SnakeTrajectoryCandidate[] {
  if (actorHasInvalidNumber(enemy) || !profileIsValid(profile)) return []
  return generateInternalCandidates(enemy, profile).map((candidate) => ({
    candidateIndex: candidate.candidateIndex,
    speedScale: candidate.speedScale,
    directions: candidate.directions.map((direction) => ({ ...direction })),
    path: candidate.path.map((position) => ({ ...position })),
  }))
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

export function sampleResourceSnakePlan(plan: SnakePlan, atMs: number): SnakePlanSample {
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
  const result: SnakeTimedPosition[] = []
  for (let index = 0; index < plan.path.length; index += 1) {
    const atMs = plan.plannedAtMs + (index + 1) * plan.stepMs
    if (atMs > fromMs) result.push({ atMs, position: { ...plan.path[index] } })
  }
  return result
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
  const buckets = new Array<number[] | undefined>(columns * rows)
  for (let index = 0; index < snapshot.trailDots.length; index += 1) {
    const dot = snapshot.trailDots[index]
    const x = clamp(Math.floor(dot.position.x / SPATIAL_CELL_SIZE), 0, columns - 1)
    const y = clamp(Math.floor(dot.position.y / SPATIAL_CELL_SIZE), 0, rows - 1)
    const bucketIndex = y * columns + x
    const bucket = buckets[bucketIndex]
    if (bucket) bucket.push(index)
    else buckets[bucketIndex] = [index]
  }
  return { columns, rows, buckets, dots: snapshot.trailDots }
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
  if (!committedPathValid(committed) || committed.path.length === 0) return null
  if (atMs < committed.startsAtMs || atMs > committed.commitUntilMs) return null
  const offset = (atMs - committed.startsAtMs) / committed.stepMs - 1
  if (offset <= 0) return committed.path[0]
  const lowerIndex = Math.min(Math.floor(offset), committed.path.length - 1)
  const upperIndex = Math.min(lowerIndex + 1, committed.path.length - 1)
  const fraction = clamp(offset - lowerIndex, 0, 1)
  const lower = committed.path[lowerIndex]
  const upper = committed.path[upperIndex]
  return {
    x: lower.x + (upper.x - lower.x) * fraction,
    y: lower.y + (upper.y - lower.y) * fraction,
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

function candidateSurvives(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: InternalTrajectoryCandidate,
  hypothesisPaths: readonly SnakeVector[][],
  trailIndex: TrailSpatialIndex,
  stepMs: number,
): boolean {
  const margin = riskMargin(enemy)
  const graceUntilMs = snapshot.simulationMs + enemy.collisionGraceMs
  const playerBothGraceUntilMs = snapshot.simulationMs
    + Math.min(enemy.collisionGraceMs, snapshot.player.collisionGraceMs)
  let start = enemy.position
  for (let pathIndex = 0; pathIndex < candidate.path.length; pathIndex += 1) {
    const end = candidate.path[pathIndex]
    const rawEnd = candidate.rawPath[pathIndex]
    const segmentStartMs = snapshot.simulationMs + pathIndex * stepMs
    const exit = boundaryExitFraction(start, rawEnd, snapshot, margin)
    if (exit !== null) {
      const outsideAtMs = segmentStartMs + exit * stepMs
      if (Math.max(outsideAtMs, graceUntilMs) <= segmentStartMs + stepMs + EPSILON) return false
    }
    if (trailCollisionTime(
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
    visitMarks: new Uint32Array(size),
    queue: new Int32Array(size),
    depths: new Uint16Array(size),
    generation: 0,
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
): void {
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
      if (dx * dx + dy * dy <= squared) occupancy[y * workspace.width + x] = 1
    }
  }
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

function floodReachableArea(
  workspace: GridWorkspace,
  origin: SnakeVector,
  maximumDepth: number,
  saturationArea = Number.MAX_SAFE_INTEGER,
): number {
  const start = cellIndex(workspace, origin)
  if (start === null) return 0
  const startOccupancy = workspace.occupancy[start]
  workspace.occupancy[start] = 0
  workspace.generation += 1
  if (workspace.generation === 0xffffffff) {
    workspace.visitMarks.fill(0)
    workspace.generation = 1
  }
  const generation = workspace.generation
  let read = 0
  let write = 1
  let area = 0
  workspace.queue[0] = start
  workspace.depths[0] = 0
  workspace.visitMarks[start] = generation
  while (read < write) {
    const index = workspace.queue[read]
    const depth = workspace.depths[read]
    read += 1
    area += 1
    if (area >= saturationArea) {
      workspace.occupancy[start] = startOccupancy
      return saturationArea
    }
    if (depth >= maximumDepth) continue
    const x = index % workspace.width
    let neighbor = index - workspace.width
    if (neighbor >= 0 && !workspace.occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
      workspace.visitMarks[neighbor] = generation
      workspace.queue[write] = neighbor
      workspace.depths[write] = depth + 1
      write += 1
    }
    neighbor = index + workspace.width
    if (neighbor < workspace.occupancy.length && !workspace.occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
      workspace.visitMarks[neighbor] = generation
      workspace.queue[write] = neighbor
      workspace.depths[write] = depth + 1
      write += 1
    }
    if (x > 0) {
      neighbor = index - 1
      if (!workspace.occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
        workspace.visitMarks[neighbor] = generation
        workspace.queue[write] = neighbor
        workspace.depths[write] = depth + 1
        write += 1
      }
    }
    if (x + 1 < workspace.width) {
      neighbor = index + 1
      if (!workspace.occupancy[neighbor] && workspace.visitMarks[neighbor] !== generation) {
        workspace.visitMarks[neighbor] = generation
        workspace.queue[write] = neighbor
        workspace.depths[write] = depth + 1
        write += 1
      }
    }
  }
  workspace.occupancy[start] = startOccupancy
  return area
}

function markCandidateTrail(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  path: readonly SnakeVector[],
): void {
  for (let index = 0; index + 1 < path.length; index += 1) {
    markDisk(occupancy, workspace, path[index], FUTURE_TRAIL_RADIUS)
  }
}

function diskTouchesOccupancy(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  position: SnakeVector,
  radius: number,
): boolean {
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
      if (dx * dx + dy * dy <= squared && occupancy[y * workspace.width + x]) return true
    }
  }
  return false
}

function minimumAllyClearance(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: InternalTrajectoryCandidate,
  stepMs: number,
): number {
  let clearance = Math.hypot(snapshot.field.width, snapshot.field.height)
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
  return hypotheses.all.map((hypothesis) => {
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
  candidate: InternalTrajectoryCandidate,
  hypotheses: SnakePlayerHypotheses,
  workspace: GridWorkspace,
  baselinePlayerAreas: readonly number[],
  maximumDepth: number,
): number {
  // Candidate trails are open, monotone-turn paths. Unless separated parts of
  // that path anchor into existing occupancy, they cannot split a 4-connected
  // component. Treating their own occupied footprint as "enclosure" made
  // harmless open-field motion look offensive and required needless floods.
  let firstAnchor = -1
  let lastAnchor = -1
  for (let index = 0; index + 1 < candidate.path.length; index += 1) {
    if (diskTouchesOccupancy(
      workspace.playerBase,
      workspace,
      candidate.path[index],
      FUTURE_TRAIL_RADIUS,
    )) {
      if (firstAnchor < 0) firstAnchor = index
      lastAnchor = index
    }
  }
  if (firstAnchor < 0 || lastAnchor - firstAnchor < 2) return 0

  workspace.occupancy.set(workspace.playerBase)
  markCandidateTrail(workspace.occupancy, workspace, candidate.path)
  let candidateFootprint = 0
  for (let index = 0; index < workspace.occupancy.length; index += 1) {
    if (!workspace.playerBase[index] && workspace.occupancy[index]) candidateFootprint += 1
  }
  let playerAreaReduction = Number.MAX_SAFE_INTEGER
  const candidateAreas: number[] = []
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
    const candidateArea = duplicateIndex >= 0
      ? candidateAreas[duplicateIndex]
      : floodReachableArea(workspace, endpoint, maximumDepth)
    candidateAreas.push(candidateArea)
    playerAreaReduction = Math.min(
      playerAreaReduction,
      Math.max(0, baselinePlayerAreas[index] - candidateArea - candidateFootprint),
    )
  }
  return playerAreaReduction === Number.MAX_SAFE_INTEGER ? 0 : playerAreaReduction
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
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  enemy: SnakePlannerActor | undefined,
): Pick<SnakePlan,
  'enemyId' | 'role' | 'plannedAtMs' | 'stepMs' | 'originPosition' | 'originVelocity'
  | 'originMaximumSpeedPerSecond'> {
  return {
    enemyId,
    role: enemy?.role ?? 'pressure',
    plannedAtMs: finite(snapshot.simulationMs) ? snapshot.simulationMs : 0,
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
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  enemy: SnakePlannerActor | undefined,
  startedAt: number,
  clock: () => number,
  intent: SnakeIntent,
  fallback: boolean,
): SnakePlan {
  return {
    ...basePlanFields(snapshot, enemyId, enemy),
    intent,
    direction: { x: 0, y: 0 },
    speedScale: 0,
    commandAtMs: finite(snapshot.simulationMs) ? snapshot.simulationMs : 0,
    directions: [],
    commitUntilMs: finite(snapshot.simulationMs) ? snapshot.simulationMs : 0,
    path: [],
    score: emptyScore(),
    candidateIndex: -1,
    evaluatedCandidates: fallback ? 8 : 0,
    elapsedMs: elapsedSince(startedAt, clock),
    fallback,
  }
}

function safeFallback(
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  enemy: SnakePlannerActor | undefined,
  startedAt: number,
  clock: () => number,
): SnakePlan {
  if (
    !enemy
    || !finite(snapshot.simulationMs)
    || !finite(snapshot.field.width)
    || !finite(snapshot.field.height)
    || !finite(snapshot.field.padding)
    || snapshot.field.width <= snapshot.field.padding * 2
    || snapshot.field.height <= snapshot.field.padding * 2
    || !finiteVector(enemy.position)
    || !finite(enemy.maximumSpeedPerSecond)
    || enemy.maximumSpeedPerSecond <= 0
  ) return stoppedPlan(snapshot, enemyId, enemy, startedAt, clock, 'escape', true)

  const stepMs = 50
  const stepCount = profileIsValid(profile) ? profile.lookaheadMs / stepMs : 8
  const initialHeading = finiteVector(enemy.velocity) && magnitude(enemy.velocity) > EPSILON
    ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
    : 0
  const toPlayer = finiteVector(snapshot.player.position)
    ? { x: snapshot.player.position.x - enemy.position.x, y: snapshot.player.position.y - enemy.position.y }
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
      clearance = Math.min(
        clearance,
        end.x - snapshot.field.padding,
        snapshot.field.width - snapshot.field.padding - end.x,
        end.y - snapshot.field.padding,
        snapshot.field.height - snapshot.field.padding - end.y,
      )
      if (finiteVector(snapshot.player.position)) {
        clearance = Math.min(clearance, distance(end, snapshot.player.position) - PLAYER_HEAD_CLEARANCE)
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
  return {
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
    || !plan.path.every(finiteVector)
    || !plan.directions.every((direction) => finiteVector(direction) && Math.abs(magnitude(direction) - 1) <= 1e-8)
    || !finite(plan.candidateIndex)
    || plan.candidateIndex < 0
    || plan.candidateIndex >= profile.candidateCount
    || plan.evaluatedCandidates !== profile.candidateCount
    || !finite(plan.elapsedMs)
    || plan.elapsedMs < 0
  ) return false
  let priorHeading = magnitude(plan.originVelocity) > EPSILON
    ? Math.atan2(plan.originVelocity.y, plan.originVelocity.x)
    : 0
  const maximumTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND * plan.stepMs / 1_000
  for (const direction of plan.directions) {
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
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  previousPlan: SnakePlan | null,
  clock: () => number = () => 0,
): SnakePlan {
  const startedAt = clock()
  const enemy = snapshot.enemies.find((candidate) => candidate.id === enemyId)
  if (!enemy || enemy.integrity <= 0) {
    return stoppedPlan(snapshot, enemyId, enemy, startedAt, clock, 'defeated', false)
  }
  if (!profileIsValid(profile) || snapshotHasInvalidNumber(snapshot)) {
    return safeFallback(snapshot, enemyId, profile, enemy, startedAt, clock)
  }
  const trailIndex = buildTrailIndex(snapshot)
  if (previousPlan && reusablePlanValid(snapshot, enemy, profile, previousPlan)) {
    const fatalInMs = earliestCertainFatalMs(snapshot, enemy, previousPlan, trailIndex)
    if (fatalInMs === null || fatalInMs > COMMIT_FATAL_OVERRIDE_MS + EPSILON) {
      const sample = sampleResourceSnakePlan(previousPlan, snapshot.simulationMs)
      return {
        ...previousPlan,
        direction: sample.direction,
        commandAtMs: snapshot.simulationMs,
        elapsedMs: elapsedSince(startedAt, clock),
      }
    }
  }

  const hypotheses = predictResourceSnakePlayerHypotheses(
    snapshot,
    profile.lookaheadMs,
    profile.rolloutStepMs,
  )
  const collisionHypotheses = distinctHypothesisPaths(hypotheses)
  const candidates = generateInternalCandidates(enemy, profile, snapshot.field)
  const workspace = acquireGrid(snapshot)
  try {
    const horizonMs = snapshot.simulationMs + profile.lookaheadMs
    prepareOccupancyBases(snapshot, enemy, hypotheses, workspace, horizonMs)
    const maximumDepth = Math.max(
      1,
      Math.ceil(enemy.maximumSpeedPerSecond * profile.lookaheadMs / 1_000 / RESOURCE_SNAKE_GRID_SIZE),
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
        workspace.occupancy.set(workspace.playerBase)
        baselinePlayerAreas.push(floodReachableArea(workspace, endpoint, maximumDepth))
      }
    }
    const targets = hypothesisCutoffTargets(snapshot, enemy, hypotheses)
    const scored = candidates.map((candidate): ScoredCandidate => ({
      ...candidate,
      score: {
        ...emptyScore(),
        steeringCost: candidate.steeringCost,
      },
    }))

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

    workspace.occupancy.set(workspace.enemyBase)
    for (const candidate of contenders) {
      const endpoint = candidate.path.at(-1) ?? enemy.position
      candidate.score.reachableArea = floodReachableArea(
        workspace,
        endpoint,
        maximumDepth,
        REACHABLE_AREA_SATURATION_CELLS,
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
        maximumDepth,
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
    return {
      ...basePlanFields(snapshot, enemyId, enemy),
      intent: deriveIntent(snapshot, enemy, winner),
      direction: { ...winner.directions[0] },
      speedScale: winner.speedScale,
      commandAtMs: snapshot.simulationMs,
      directions: winner.directions,
      commitUntilMs: snapshot.simulationMs + profile.commitMs,
      path: winner.path,
      score: serializeScore(winner.score),
      candidateIndex: winner.candidateIndex,
      evaluatedCandidates: candidates.length,
      elapsedMs: elapsedSince(startedAt, clock),
      fallback: false,
    }
  } finally {
    releaseGrid(workspace)
  }
}
