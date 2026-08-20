import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import type {
  SnakeEnemyRole,
  SnakeId,
  SnakeVector,
} from './resourceSnakeRuntime'

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

export interface SnakePlan {
  enemyId: SnakeId
  intent: SnakeIntent
  role: SnakeEnemyRole
  direction: SnakeVector
  speedScale: 0 | 0.5 | 1
  commitUntilMs: number
  path: SnakeVector[]
  score: SnakePlanScore
  candidateIndex: number
  evaluatedCandidates: number
  elapsedMs: number
  fallback: boolean
}

export const RESOURCE_SNAKE_GRID_SIZE = 0.75

/**
 * A 270°/s cap permits 13.5° per 50ms planner step. This is finite enough to
 * prevent instantaneous reversals while still settling within the runtime's
 * 120ms acceleration window over several authoritative rollout steps.
 */
export const RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND = Math.PI * 1.5

const PLAYER_HEAD_CLEARANCE = 1.1
const TRAIL_COLLISION_RADIUS = 0.55
const ALLY_COLLISION_RADIUS = 0.75
const FUTURE_TRAIL_RADIUS = 0.42
const COMMIT_FATAL_OVERRIDE_MS = 180
const SPEED_SCALES = [1, 0.5, 0] as const
const TWO_PI = Math.PI * 2
const EPSILON = 1e-9

interface PlayerHypotheses {
  keepVelocity: SnakeVector[]
  continueMedianTurn: SnakeVector[]
  decelerate: SnakeVector[]
  stayStopped: SnakeVector[]
  all: SnakeVector[][]
}

interface TrajectoryCandidate {
  candidateIndex: number
  speedScale: 0 | 0.5 | 1
  direction: SnakeVector
  path: SnakeVector[]
  headings: number[]
  steeringCost: number
}

interface ScoredCandidate extends TrajectoryCandidate {
  score: SnakePlanScore
}

interface GridWorkspace {
  width: number
  height: number
  base: Uint8Array
  occupancy: Uint8Array
  visited: Uint8Array
  queue: Int32Array
  depths: Uint16Array
}

const gridWorkspacePool = new Map<string, GridWorkspace[]>()

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function finiteVector(vector: SnakeVector): boolean {
  return finite(vector.x) && finite(vector.y)
}

function length(vector: SnakeVector): number {
  return Math.hypot(vector.x, vector.y)
}

function distance(left: SnakeVector, right: SnakeVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function normalize(vector: SnakeVector, fallback: SnakeVector = { x: 0, y: 0 }): SnakeVector {
  const magnitude = length(vector)
  if (!finite(magnitude) || magnitude <= EPSILON) return { ...fallback }
  return { x: vector.x / magnitude, y: vector.y / magnitude }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(target, current + maximumDelta)
  return Math.max(target, current - maximumDelta)
}

function signedAngleDifference(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function turnToward(current: number, target: number, maximumTurn: number): number {
  return current + clamp(signedAngleDifference(current, target), -maximumTurn, maximumTurn)
}

function rounded(value: number): number {
  if (!finite(value)) return 0
  const result = Math.round(value * 1_000_000) / 1_000_000
  return Object.is(result, -0) ? 0 : result
}

function actorHasInvalidNumber(actor: SnakePlannerActor): boolean {
  return !finiteVector(actor.position)
    || !finiteVector(actor.velocity)
    || !finite(actor.integrity)
    || !finite(actor.maximumIntegrity)
    || !finite(actor.maximumSpeedPerSecond)
    || actor.maximumSpeedPerSecond < 0
    || !finite(actor.collisionGraceMs)
}

function relevantHistory(snapshot: SnakePlannerSnapshot): SnakePlayerHistorySample[] {
  const earliestMs = snapshot.simulationMs - 2_000
  return snapshot.playerHistory
    .filter((sample) => sample.simulationMs >= earliestMs && sample.simulationMs <= snapshot.simulationMs)
    .slice()
    .sort((left, right) => left.simulationMs - right.simulationMs)
}

function snapshotHasInvalidNumber(snapshot: SnakePlannerSnapshot): boolean {
  if (
    !finite(snapshot.simulationMs)
    || !finite(snapshot.field.width)
    || !finite(snapshot.field.height)
    || !finite(snapshot.field.padding)
    || snapshot.field.width <= snapshot.field.padding * 2
    || snapshot.field.height <= snapshot.field.padding * 2
    || snapshot.field.padding < 0
    || actorHasInvalidNumber(snapshot.player)
    || snapshot.enemies.some(actorHasInvalidNumber)
  ) return true

  if (snapshot.trailDots.some((dot) => (
    !finite(dot.id) || !finiteVector(dot.position) || !finite(dot.expiresAtMs)
  ))) return true

  if (relevantHistory(snapshot).some((sample) => (
    !finite(sample.simulationMs) || !finiteVector(sample.position) || !finiteVector(sample.velocity)
  ))) return true

  return snapshot.committedAllyPaths.some((committed) => (
    !finite(committed.startsAtMs)
    || !finite(committed.stepMs)
    || committed.stepMs <= 0
    || !finite(committed.commitUntilMs)
    || committed.path.some((point) => !finiteVector(point))
  ))
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
  const rates: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const prior = samples[index - 1]
    const current = samples[index]
    const elapsedSeconds = (current.simulationMs - prior.simulationMs) / 1_000
    if (elapsedSeconds <= 0 || length(prior.velocity) <= EPSILON || length(current.velocity) <= EPSILON) {
      continue
    }
    const priorHeading = Math.atan2(prior.velocity.y, prior.velocity.x)
    const currentHeading = Math.atan2(current.velocity.y, current.velocity.x)
    rates.push(signedAngleDifference(priorHeading, currentHeading) / elapsedSeconds)
  }
  return median(rates)
}

function predictPlayerHypotheses(
  snapshot: SnakePlannerSnapshot,
  stepCount: number,
  stepMs: number,
): PlayerHypotheses {
  const origin = snapshot.player.position
  const velocity = snapshot.player.velocity
  const speed = length(velocity)
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
    keepVelocity.push({
      x: origin.x + velocity.x * seconds,
      y: origin.y + velocity.y * seconds,
    })

    const turningHeading = heading + signedTurnRate * seconds
    turningPosition = {
      x: turningPosition.x + Math.cos(turningHeading) * speed * stepSeconds,
      y: turningPosition.y + Math.sin(turningHeading) * speed * stepSeconds,
    }
    continueMedianTurn.push(turningPosition)

    const decelerationSeconds = Math.min(seconds, 0.1)
    const displacementSeconds = decelerationSeconds - (decelerationSeconds ** 2) / 0.2
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

function generateCandidates(
  enemy: SnakePlannerActor,
  profile: SnakePlannerProfile,
): TrajectoryCandidate[] {
  const headingCount = profile.candidateCount / SPEED_SCALES.length
  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  const initialSpeed = length(enemy.velocity)
  const initialHeading = initialSpeed > EPSILON
    ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
    : 0
  const maximumStepTurn = RESOURCE_SNAKE_MAX_TURN_RADIANS_PER_SECOND
    * (profile.rolloutStepMs / 1_000)
  const candidates: TrajectoryCandidate[] = []

  for (let headingIndex = 0; headingIndex < headingCount; headingIndex += 1) {
    const targetHeading = initialHeading + (headingIndex / headingCount) * TWO_PI
    for (let speedIndex = 0; speedIndex < SPEED_SCALES.length; speedIndex += 1) {
      const speedScale = SPEED_SCALES[speedIndex]
      const targetSpeed = enemy.maximumSpeedPerSecond * speedScale
      let currentSpeed = initialSpeed
      let currentHeading = initialHeading
      let position = { ...enemy.position }
      let steeringCost = 0
      const path: SnakeVector[] = []
      const headings: number[] = []

      for (let step = 0; step < stepCount; step += 1) {
        const nextHeading = turnToward(currentHeading, targetHeading, maximumStepTurn)
        steeringCost += Math.abs(signedAngleDifference(currentHeading, nextHeading))
        currentHeading = nextHeading
        const responseMs = targetSpeed < currentSpeed ? 100 : 120
        currentSpeed = approach(
          currentSpeed,
          targetSpeed,
          enemy.maximumSpeedPerSecond * (profile.rolloutStepMs / responseMs),
        )
        position = {
          x: position.x + Math.cos(currentHeading) * currentSpeed * (profile.rolloutStepMs / 1_000),
          y: position.y + Math.sin(currentHeading) * currentSpeed * (profile.rolloutStepMs / 1_000),
        }
        path.push(position)
        headings.push(currentHeading)
      }

      candidates.push({
        candidateIndex: headingIndex * SPEED_SCALES.length + speedIndex,
        speedScale,
        direction: {
          x: Math.cos(headings[0] ?? targetHeading),
          y: Math.sin(headings[0] ?? targetHeading),
        },
        path,
        headings,
        steeringCost: steeringCost
          + Math.abs(targetSpeed - initialSpeed) / Math.max(enemy.maximumSpeedPerSecond, EPSILON),
      })
    }
  }
  return candidates
}

function segmentCircleFirstTime(
  start: SnakeVector,
  end: SnakeVector,
  center: SnakeVector,
  radius: number,
): number | null {
  const offsetX = start.x - center.x
  const offsetY = start.y - center.y
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const a = deltaX * deltaX + deltaY * deltaY
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius
  if (c <= 0) return 0
  if (a <= EPSILON) return null
  const b = 2 * (offsetX * deltaX + offsetY * deltaY)
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const time = (-b - Math.sqrt(discriminant)) / (2 * a)
  return time >= 0 && time <= 1 ? time : null
}

function movingCircleFirstTime(
  leftStart: SnakeVector,
  leftEnd: SnakeVector,
  rightStart: SnakeVector,
  rightEnd: SnakeVector,
  radius: number,
): number | null {
  return segmentCircleFirstTime(
    { x: leftStart.x - rightStart.x, y: leftStart.y - rightStart.y },
    { x: leftEnd.x - rightEnd.x, y: leftEnd.y - rightEnd.y },
    { x: 0, y: 0 },
    radius,
  )
}

function boundaryExitFraction(
  start: SnakeVector,
  end: SnakeVector,
  snapshot: SnakePlannerSnapshot,
): number | null {
  const minimumX = snapshot.field.padding
  const maximumX = snapshot.field.width - snapshot.field.padding
  const minimumY = snapshot.field.padding
  const maximumY = snapshot.field.height - snapshot.field.padding
  if (
    start.x < minimumX || start.x > maximumX
    || start.y < minimumY || start.y > maximumY
  ) return 0
  let result: number | null = null
  const consider = (fraction: number) => {
    if (fraction < -EPSILON || fraction > 1 + EPSILON) return
    result = result === null ? clamp(fraction, 0, 1) : Math.min(result, clamp(fraction, 0, 1))
  }
  if (end.x < minimumX) consider((minimumX - start.x) / (end.x - start.x))
  if (end.x > maximumX) consider((maximumX - start.x) / (end.x - start.x))
  if (end.y < minimumY) consider((minimumY - start.y) / (end.y - start.y))
  if (end.y > maximumY) consider((maximumY - start.y) / (end.y - start.y))
  return result
}

function committedPointAt(committed: SnakeCommittedPath, simulationMs: number): SnakeVector | null {
  if (
    committed.path.length === 0
    || !finite(committed.startsAtMs)
    || !finite(committed.stepMs)
    || committed.stepMs <= 0
    || !finite(committed.commitUntilMs)
    || committed.path.some((point) => !finiteVector(point))
    || simulationMs < committed.startsAtMs
    || simulationMs > committed.commitUntilMs
  ) return null
  const pointOffset = (simulationMs - committed.startsAtMs) / committed.stepMs - 1
  if (pointOffset <= 0) return committed.path[0]
  const lowerIndex = Math.min(Math.floor(pointOffset), committed.path.length - 1)
  const upperIndex = Math.min(lowerIndex + 1, committed.path.length - 1)
  const fraction = clamp(pointOffset - lowerIndex, 0, 1)
  const lower = committed.path[lowerIndex]
  const upper = committed.path[upperIndex]
  return {
    x: lower.x + (upper.x - lower.x) * fraction,
    y: lower.y + (upper.y - lower.y) * fraction,
  }
}

function candidateSurvives(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: TrajectoryCandidate,
  hypotheses: PlayerHypotheses,
  stepMs: number,
): boolean {
  let start = enemy.position
  for (let index = 0; index < candidate.path.length; index += 1) {
    const end = candidate.path[index]
    const segmentStartMs = snapshot.simulationMs + index * stepMs
    if (boundaryExitFraction(start, end, snapshot) !== null) return false

    for (const dot of snapshot.trailDots) {
      const collision = segmentCircleFirstTime(start, end, dot.position, TRAIL_COLLISION_RADIUS)
      if (collision === null) continue
      const collisionMs = segmentStartMs + collision * stepMs
      if (dot.expiresAtMs > collisionMs) return false
    }

    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const allyStart = committedPointAt(committed, segmentStartMs)
      const allyEnd = committedPointAt(committed, segmentStartMs + stepMs)
      if (!allyStart || !allyEnd) continue
      if (movingCircleFirstTime(start, end, allyStart, allyEnd, ALLY_COLLISION_RADIUS) !== null) {
        return false
      }
    }

    for (const hypothesis of hypotheses.all) {
      const playerStart = index === 0 ? snapshot.player.position : hypothesis[index - 1]
      const playerEnd = hypothesis[index]
      if (movingCircleFirstTime(start, end, playerStart, playerEnd, PLAYER_HEAD_CLEARANCE) !== null) {
        return false
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
    base: new Uint8Array(size),
    occupancy: new Uint8Array(size),
    visited: new Uint8Array(size),
    queue: new Int32Array(size),
    depths: new Uint16Array(size),
  }
}

function releaseGrid(workspace: GridWorkspace): void {
  const key = `${workspace.width}:${workspace.height}`
  const pool = gridWorkspacePool.get(key) ?? []
  pool.push(workspace)
  gridWorkspacePool.set(key, pool)
}

function cellIndex(workspace: GridWorkspace, position: SnakeVector): number | null {
  const x = Math.floor(position.x / RESOURCE_SNAKE_GRID_SIZE)
  const y = Math.floor(position.y / RESOURCE_SNAKE_GRID_SIZE)
  if (x < 0 || x >= workspace.width || y < 0 || y >= workspace.height) return null
  return y * workspace.width + x
}

function cellCenter(workspace: GridWorkspace, index: number): SnakeVector {
  return {
    x: (index % workspace.width + 0.5) * RESOURCE_SNAKE_GRID_SIZE,
    y: (Math.floor(index / workspace.width) + 0.5) * RESOURCE_SNAKE_GRID_SIZE,
  }
}

function markDisk(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  position: SnakeVector,
  radius: number,
): void {
  const minimumX = Math.max(0, Math.floor((position.x - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumX = Math.min(
    workspace.width - 1,
    Math.floor((position.x + radius) / RESOURCE_SNAKE_GRID_SIZE),
  )
  const minimumY = Math.max(0, Math.floor((position.y - radius) / RESOURCE_SNAKE_GRID_SIZE))
  const maximumY = Math.min(
    workspace.height - 1,
    Math.floor((position.y + radius) / RESOURCE_SNAKE_GRID_SIZE),
  )
  const expandedRadius = radius + RESOURCE_SNAKE_GRID_SIZE * 0.5
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const index = y * workspace.width + x
      if (distance(cellCenter(workspace, index), position) <= expandedRadius) occupancy[index] = 1
    }
  }
}

function prepareBaseOccupancy(
  snapshot: SnakePlannerSnapshot,
  workspace: GridWorkspace,
  hypotheses: PlayerHypotheses,
  horizonMs: number,
): void {
  workspace.base.fill(0)
  for (let index = 0; index < workspace.base.length; index += 1) {
    const center = cellCenter(workspace, index)
    if (
      center.x < snapshot.field.padding
      || center.x > snapshot.field.width - snapshot.field.padding
      || center.y < snapshot.field.padding
      || center.y > snapshot.field.height - snapshot.field.padding
    ) workspace.base[index] = 1
  }
  for (const dot of snapshot.trailDots) {
    if (dot.expiresAtMs > horizonMs) {
      markDisk(workspace.base, workspace, dot.position, TRAIL_COLLISION_RADIUS)
    }
  }
  for (const committed of snapshot.committedAllyPaths) {
    const point = committedPointAt(committed, horizonMs)
    if (point) markDisk(workspace.base, workspace, point, ALLY_COLLISION_RADIUS)
  }
  for (const hypothesis of hypotheses.all) {
    const point = hypothesis.at(-1)
    if (point) markDisk(workspace.base, workspace, point, PLAYER_HEAD_CLEARANCE)
  }
}

function floodReachableArea(
  workspace: GridWorkspace,
  origin: SnakeVector,
  maximumDepth: number,
): number {
  const start = cellIndex(workspace, origin)
  if (start === null) return 0
  workspace.visited.fill(0)
  workspace.occupancy[start] = 0
  let readIndex = 0
  let writeIndex = 1
  let area = 0
  workspace.queue[0] = start
  workspace.depths[0] = 0
  workspace.visited[start] = 1
  while (readIndex < writeIndex) {
    const index = workspace.queue[readIndex]
    const depth = workspace.depths[readIndex]
    readIndex += 1
    area += 1
    if (depth >= maximumDepth) continue
    const x = index % workspace.width
    const neighbors = [
      index - workspace.width,
      index + workspace.width,
      index - 1,
      index + 1,
    ]
    for (let neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex += 1) {
      const neighbor = neighbors[neighborIndex]
      if (neighbor < 0 || neighbor >= workspace.occupancy.length) continue
      if (neighborIndex === 2 && x === 0) continue
      if (neighborIndex === 3 && x === workspace.width - 1) continue
      if (workspace.occupancy[neighbor] || workspace.visited[neighbor]) continue
      workspace.visited[neighbor] = 1
      workspace.queue[writeIndex] = neighbor
      workspace.depths[writeIndex] = depth + 1
      writeIndex += 1
    }
  }
  return area
}

function markCandidateTrail(
  occupancy: Uint8Array,
  workspace: GridWorkspace,
  path: readonly SnakeVector[],
  stepMs: number,
  skipRecentMs: number,
): void {
  const skippedSteps = Math.ceil(skipRecentMs / stepMs)
  const limit = Math.max(0, path.length - skippedSteps)
  for (let index = 0; index < limit; index += 1) {
    markDisk(occupancy, workspace, path[index], FUTURE_TRAIL_RADIUS)
  }
}

function minimumAllyClearance(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: TrajectoryCandidate,
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

function minimumPlayerDistance(
  candidate: TrajectoryCandidate,
  hypotheses: PlayerHypotheses,
): number {
  let minimum = Number.MAX_SAFE_INTEGER
  for (let index = 0; index < candidate.path.length; index += 1) {
    for (const hypothesis of hypotheses.all) {
      minimum = Math.min(minimum, distance(candidate.path[index], hypothesis[index]))
    }
  }
  return minimum
}

function cutoffTarget(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  hypotheses: PlayerHypotheses,
): SnakeVector {
  const predicted = hypotheses.keepVelocity.at(-1) ?? snapshot.player.position
  let escapeDirection = normalize(snapshot.player.velocity)
  if (length(escapeDirection) <= EPSILON) {
    escapeDirection = normalize({
      x: snapshot.player.position.x - enemy.position.x,
      y: snapshot.player.position.y - enemy.position.y,
    }, { x: 1, y: 0 })
  }
  const numericId = Number(enemy.id.split('-')[1] ?? 0)
  const side = enemy.role === 'blocker' || numericId % 2 === 1 ? -1 : 1
  const lateral = { x: -escapeDirection.y * side, y: escapeDirection.x * side }
  return {
    x: predicted.x + escapeDirection.x * 1.5 + lateral.x * 2.25,
    y: predicted.y + escapeDirection.y * 1.5 + lateral.y * 2.25,
  }
}

function scoreCandidate(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  candidate: TrajectoryCandidate,
  hypotheses: PlayerHypotheses,
  profile: SnakePlannerProfile,
  workspace: GridWorkspace,
  baselinePlayerArea: number,
  target: SnakeVector,
): ScoredCandidate {
  const finalPoint = candidate.path.at(-1) ?? enemy.position
  const maximumDepth = Math.max(
    1,
    Math.ceil(enemy.maximumSpeedPerSecond * (profile.lookaheadMs / 1_000) / RESOURCE_SNAKE_GRID_SIZE),
  )
  workspace.occupancy.set(workspace.base)
  const reachableArea = floodReachableArea(workspace, finalPoint, maximumDepth)

  workspace.occupancy.set(workspace.base)
  markCandidateTrail(workspace.occupancy, workspace, candidate.path, profile.rolloutStepMs, 0)
  const predictedPlayer = hypotheses.keepVelocity.at(-1) ?? snapshot.player.position
  const playerArea = floodReachableArea(workspace, predictedPlayer, maximumDepth)
  const survives = candidateSurvives(
    snapshot,
    enemy,
    candidate,
    hypotheses,
    profile.rolloutStepMs,
  ) ? 1 : 0
  const initialTargetDistance = distance(enemy.position, target)

  return {
    ...candidate,
    score: {
      survives,
      reachableArea,
      allyClearance: rounded(minimumAllyClearance(snapshot, enemy, candidate, profile.rolloutStepMs)),
      playerAreaReduction: Math.max(0, baselinePlayerArea - playerArea),
      cutoffProgress: rounded(initialTargetDistance - distance(finalPoint, target)),
      pressureDistance: rounded(minimumPlayerDistance(candidate, hypotheses)),
      steeringCost: rounded(candidate.steeringCost),
    },
  }
}

function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.score.survives !== right.score.survives) {
    return left.score.survives - right.score.survives
  }
  if (left.score.reachableArea !== right.score.reachableArea) {
    return left.score.reachableArea - right.score.reachableArea
  }
  if (left.score.allyClearance !== right.score.allyClearance) {
    return left.score.allyClearance - right.score.allyClearance
  }
  if (left.score.playerAreaReduction !== right.score.playerAreaReduction) {
    return left.score.playerAreaReduction - right.score.playerAreaReduction
  }
  if (left.score.cutoffProgress !== right.score.cutoffProgress) {
    return left.score.cutoffProgress - right.score.cutoffProgress
  }
  if (left.score.pressureDistance !== right.score.pressureDistance) {
    return right.score.pressureDistance - left.score.pressureDistance
  }
  if (left.score.steeringCost !== right.score.steeringCost) {
    return right.score.steeringCost - left.score.steeringCost
  }
  return right.candidateIndex - left.candidateIndex
}

function deriveIntent(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  winner: ScoredCandidate,
): SnakeIntent {
  if (winner.score.survives === 0) return 'escape'
  if (snapshot.committedAllyPaths.some((path) => path.enemyId !== enemy.id)) return 'coordinate'
  if (length(snapshot.player.velocity) <= 0.1 && winner.score.cutoffProgress > 0) return 'cutoff'
  if (winner.score.playerAreaReduction > 0) return 'herd'
  if (winner.score.cutoffProgress > 0) return 'cutoff'
  const initialDistance = distance(enemy.position, snapshot.player.position)
  if (winner.score.pressureDistance < initialDistance) return 'pursue'
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
  if (!finite(startedAt) || !finite(endedAt)) return 0
  return rounded(Math.max(0, endedAt - startedAt))
}

function fallbackClearance(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  direction: SnakeVector,
): { valid: boolean; clearance: number; path: SnakeVector[] } {
  const stepMs = 50
  const stepCount = 8
  const speed = enemy.maximumSpeedPerSecond * 0.5
  let position = { ...enemy.position }
  let clearance = Number.MAX_SAFE_INTEGER
  const path: SnakeVector[] = []
  for (let index = 0; index < stepCount; index += 1) {
    position = {
      x: position.x + direction.x * speed * (stepMs / 1_000),
      y: position.y + direction.y * speed * (stepMs / 1_000),
    }
    if (!finiteVector(position) || boundaryExitFraction(path.at(-1) ?? enemy.position, position, snapshot) !== null) {
      return { valid: false, clearance: 0, path: [] }
    }
    const boundaryClearance = Math.min(
      position.x - snapshot.field.padding,
      snapshot.field.width - snapshot.field.padding - position.x,
      position.y - snapshot.field.padding,
      snapshot.field.height - snapshot.field.padding - position.y,
    )
    clearance = Math.min(clearance, boundaryClearance)
    if (finiteVector(snapshot.player.position)) {
      clearance = Math.min(clearance, distance(position, snapshot.player.position) - PLAYER_HEAD_CLEARANCE)
    }
    for (const dot of snapshot.trailDots) {
      if (!finiteVector(dot.position) || !finite(dot.expiresAtMs)) continue
      if (dot.expiresAtMs > snapshot.simulationMs + (index + 1) * stepMs) {
        clearance = Math.min(clearance, distance(position, dot.position) - TRAIL_COLLISION_RADIUS)
      }
    }
    for (const committed of snapshot.committedAllyPaths) {
      const allyPoint = committedPointAt(committed, snapshot.simulationMs + (index + 1) * stepMs)
      if (allyPoint) clearance = Math.min(clearance, distance(position, allyPoint) - ALLY_COLLISION_RADIUS)
    }
    path.push(position)
  }
  return { valid: finite(clearance) && clearance > 0, clearance, path }
}

function safeFallback(
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  profile: SnakePlannerProfile,
  enemy: SnakePlannerActor | undefined,
  startedAt: number,
  clock: () => number,
): SnakePlan {
  const role = enemy?.role ?? 'pressure'
  const stopped = (): SnakePlan => ({
    enemyId,
    intent: enemy && enemy.integrity <= 0 ? 'defeated' : 'escape',
    role,
    direction: { x: 0, y: 0 },
    speedScale: 0,
    commitUntilMs: finite(snapshot.simulationMs) ? snapshot.simulationMs : 0,
    path: [],
    score: emptyScore(),
    candidateIndex: -1,
    evaluatedCandidates: 8,
    elapsedMs: elapsedSince(startedAt, clock),
    fallback: true,
  })
  if (
    !enemy
    || !finiteVector(enemy.position)
    || !finite(enemy.maximumSpeedPerSecond)
    || enemy.maximumSpeedPerSecond <= 0
    || !finite(snapshot.simulationMs)
    || !finite(snapshot.field.width)
    || !finite(snapshot.field.height)
    || !finite(snapshot.field.padding)
    || snapshot.field.width <= snapshot.field.padding * 2
    || snapshot.field.height <= snapshot.field.padding * 2
  ) return stopped()

  const velocityHeading = finiteVector(enemy.velocity) && length(enemy.velocity) > EPSILON
    ? Math.atan2(enemy.velocity.y, enemy.velocity.x)
    : 0
  const toPlayer = finiteVector(snapshot.player.position)
    ? {
        x: snapshot.player.position.x - enemy.position.x,
        y: snapshot.player.position.y - enemy.position.y,
      }
    : null
  let best: { index: number; direction: SnakeVector; clearance: number; path: SnakeVector[] } | null = null
  for (let index = 0; index < 8; index += 1) {
    const heading = velocityHeading + index * (TWO_PI / 8)
    const direction = { x: Math.cos(heading), y: Math.sin(heading) }
    if (toPlayer && direction.x * toPlayer.x + direction.y * toPlayer.y > EPSILON) continue
    const evaluated = fallbackClearance(snapshot, enemy, direction)
    if (!evaluated.valid) continue
    if (
      !best
      || evaluated.clearance > best.clearance + EPSILON
      || (Math.abs(evaluated.clearance - best.clearance) <= EPSILON && index < best.index)
    ) {
      best = { index, direction, clearance: evaluated.clearance, path: evaluated.path }
    }
  }
  if (!best) return stopped()
  return {
    enemyId,
    intent: 'escape',
    role,
    direction: { x: rounded(best.direction.x), y: rounded(best.direction.y) },
    speedScale: 0.5,
    commitUntilMs: snapshot.simulationMs + profile.commitMs,
    path: best.path.map((point) => ({ x: rounded(point.x), y: rounded(point.y) })),
    score: {
      ...emptyScore(1),
      allyClearance: rounded(best.clearance),
      pressureDistance: finiteVector(snapshot.player.position)
        ? rounded(minimumDistanceFromPath(best.path, snapshot.player.position))
        : 0,
    },
    candidateIndex: best.index,
    evaluatedCandidates: 8,
    elapsedMs: elapsedSince(startedAt, clock),
    fallback: true,
  }
}

function minimumDistanceFromPath(path: readonly SnakeVector[], target: SnakeVector): number {
  let result = Number.MAX_SAFE_INTEGER
  for (const point of path) result = Math.min(result, distance(point, target))
  return result === Number.MAX_SAFE_INTEGER ? 0 : result
}

function earliestCertainFatalMs(
  snapshot: SnakePlannerSnapshot,
  enemy: SnakePlannerActor,
  plan: SnakePlan,
  stepMs: number,
): number | null {
  const hypotheses = predictPlayerHypotheses(snapshot, plan.path.length, stepMs)
  const playerFatalMs: Array<number | null> = hypotheses.all.map(() => null)
  let start = enemy.position
  let earliest: number | null = null
  for (let index = 0; index < plan.path.length; index += 1) {
    const end = plan.path[index]
    if (!finiteVector(end)) return 0
    const segmentStartMs = index * stepMs
    const boundary = boundaryExitFraction(start, end, snapshot)
    if (boundary !== null) {
      const fatalAt = segmentStartMs + boundary * stepMs
      earliest = earliest === null ? fatalAt : Math.min(earliest, fatalAt)
    }
    for (const dot of snapshot.trailDots) {
      const collision = segmentCircleFirstTime(start, end, dot.position, TRAIL_COLLISION_RADIUS)
      if (collision === null) continue
      const relativeMs = segmentStartMs + collision * stepMs
      if (dot.expiresAtMs > snapshot.simulationMs + relativeMs) {
        earliest = earliest === null ? relativeMs : Math.min(earliest, relativeMs)
      }
    }
    for (const committed of snapshot.committedAllyPaths) {
      if (committed.enemyId === enemy.id) continue
      const allyStart = committedPointAt(committed, snapshot.simulationMs + segmentStartMs)
      const allyEnd = committedPointAt(committed, snapshot.simulationMs + segmentStartMs + stepMs)
      if (!allyStart || !allyEnd) continue
      const collision = movingCircleFirstTime(start, end, allyStart, allyEnd, ALLY_COLLISION_RADIUS)
      if (collision !== null) {
        const relativeMs = segmentStartMs + collision * stepMs
        earliest = earliest === null ? relativeMs : Math.min(earliest, relativeMs)
      }
    }
    for (let hypothesisIndex = 0; hypothesisIndex < hypotheses.all.length; hypothesisIndex += 1) {
      if (playerFatalMs[hypothesisIndex] !== null) continue
      const hypothesis = hypotheses.all[hypothesisIndex]
      const playerStart = index === 0 ? snapshot.player.position : hypothesis[index - 1]
      const playerEnd = hypothesis[index]
      const collision = movingCircleFirstTime(
        start,
        end,
        playerStart,
        playerEnd,
        PLAYER_HEAD_CLEARANCE,
      )
      if (collision !== null) playerFatalMs[hypothesisIndex] = segmentStartMs + collision * stepMs
    }
    start = end
  }
  if (playerFatalMs.length > 0 && playerFatalMs.every((fatalMs) => fatalMs !== null)) {
    const unavoidableAtMs = Math.max(...playerFatalMs as number[])
    earliest = earliest === null ? unavoidableAtMs : Math.min(earliest, unavoidableAtMs)
  }
  return earliest
}

function defeatedPlan(
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  enemy: SnakePlannerActor | undefined,
  startedAt: number,
  clock: () => number,
): SnakePlan {
  return {
    enemyId,
    intent: 'defeated',
    role: enemy?.role ?? 'pressure',
    direction: { x: 0, y: 0 },
    speedScale: 0,
    commitUntilMs: finite(snapshot.simulationMs) ? snapshot.simulationMs : 0,
    path: [],
    score: emptyScore(),
    candidateIndex: -1,
    evaluatedCandidates: 0,
    elapsedMs: elapsedSince(startedAt, clock),
    fallback: false,
  }
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
    return defeatedPlan(snapshot, enemyId, enemy, startedAt, clock)
  }
  if (snapshotHasInvalidNumber(snapshot)) {
    return safeFallback(snapshot, enemyId, profile, enemy, startedAt, clock)
  }
  if (
    previousPlan
    && previousPlan.enemyId === enemyId
    && snapshot.simulationMs < previousPlan.commitUntilMs
  ) {
    const fatalInMs = earliestCertainFatalMs(snapshot, enemy, previousPlan, profile.rolloutStepMs)
    if (fatalInMs === null || fatalInMs > COMMIT_FATAL_OVERRIDE_MS + EPSILON) return previousPlan
  }

  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  const hypotheses = predictPlayerHypotheses(snapshot, stepCount, profile.rolloutStepMs)
  const candidates = generateCandidates(enemy, profile)
  const workspace = acquireGrid(snapshot)
  try {
    const horizonMs = snapshot.simulationMs + profile.lookaheadMs
    prepareBaseOccupancy(snapshot, workspace, hypotheses, horizonMs)
    workspace.occupancy.set(workspace.base)
    const maximumDepth = Math.max(
      1,
      Math.ceil(enemy.maximumSpeedPerSecond * (profile.lookaheadMs / 1_000) / RESOURCE_SNAKE_GRID_SIZE),
    )
    const primaryPlayer = hypotheses.keepVelocity.at(-1) ?? snapshot.player.position
    const baselinePlayerArea = floodReachableArea(workspace, primaryPlayer, maximumDepth)
    const target = cutoffTarget(snapshot, enemy, hypotheses)
    let winner: ScoredCandidate | null = null
    for (const candidate of candidates) {
      const scored = scoreCandidate(
        snapshot,
        enemy,
        candidate,
        hypotheses,
        profile,
        workspace,
        baselinePlayerArea,
        target,
      )
      if (!winner || compareCandidates(scored, winner) > 0) winner = scored
    }
    if (!winner || winner.score.survives === 0) {
      return safeFallback(snapshot, enemyId, profile, enemy, startedAt, clock)
    }
    return {
      enemyId,
      intent: deriveIntent(snapshot, enemy, winner),
      role: enemy.role ?? 'pressure',
      direction: {
        x: rounded(winner.direction.x),
        y: rounded(winner.direction.y),
      },
      speedScale: winner.speedScale,
      commitUntilMs: snapshot.simulationMs + profile.commitMs,
      path: winner.path.map((point) => ({ x: rounded(point.x), y: rounded(point.y) })),
      score: winner.score,
      candidateIndex: winner.candidateIndex,
      evaluatedCandidates: candidates.length,
      elapsedMs: elapsedSince(startedAt, clock),
      fallback: false,
    }
  } finally {
    releaseGrid(workspace)
  }
}
