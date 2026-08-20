import type { CompanyCategory } from '../../game/model'
import type {
  IntrusionPoint,
  IntrusionRect,
} from './resourceIntrusionRuntime'

const REFERENCE_PLAYER_SPEED_PER_MS = 1 / 72
const EPSILON = 1e-9

export const RESOURCE_TRON_COMBAT_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  fieldPadding: 0.5,
  trailActiveMs: 1_500,
  trailFadeMs: 250,
  trailCollisionRadius: 0.16,
  guardRadius: 0.34,
  playerRadius: 0.42,
  minimumGuardSpeedRatio: 0.65,
  maximumGuardSpeedRatio: 0.85,
  patrolSpeedPerMs: REFERENCE_PLAYER_SPEED_PER_MS * 0.66,
  pursuitSpeedPerMs: REFERENCE_PLAYER_SPEED_PER_MS * 0.78,
  tutorialPursuitSpeedPerMs: REFERENCE_PLAYER_SPEED_PER_MS * 0.7,
  cooldownSpeedPerMs: REFERENCE_PLAYER_SPEED_PER_MS * 0.74,
  aimMs: 480,
  cooldownMs: 320,
  initiativeDelayMs: [0, 600, 1_200] as const,
  perGuardShotIntervalMs: 1_800,
  globalShotGapMs: 600,
  attackRange: 14,
  attackRecheckMs: 160,
  separationDistance: 0.88,
  projectileSpeedPerMs: 8 / 1_000,
  projectileRadius: 0.18,
  projectileLifetimeMs: 3_500,
  maximumProjectiles: 12,
  maximumHealth: 100,
  damagePerProjectile: 10,
  repairAmount: 10,
  repairDelayMs: 300,
  repairIntervalMs: 750,
  collapseMs: 180,
  reconstructionMs: 2_500,
  resumeGraceMs: 400,
} as const

export type ResourceGuardPhase =
  | 'patrolling'
  | 'pursuing'
  | 'aiming'
  | 'cooldown'
  | 'destroyed'

export interface ResourceGuard {
  id: string
  category: CompanyCategory
  position: IntrusionPoint
  previousPosition: IntrusionPoint
  spawnPosition: IntrusionPoint
  patrolWaypoints: readonly IntrusionPoint[]
  phase: ResourceGuardPhase
  phaseElapsedMs: number
  phaseDurationMs: number
  lockedAimDirection: IntrusionPoint | null
  lastShotAtMs: number | null
  initiative: 0 | 1 | 2
  actionSequence: number
}

export interface ResourceGuardSpawn {
  id: string
  category: CompanyCategory
  position: IntrusionPoint
  initiative: 0 | 1 | 2
  mode?: 'combat' | 'patrol'
  patrolWaypoints?: readonly IntrusionPoint[]
}

export interface ResourceTrailSegment {
  id: number
  from: IntrusionPoint
  to: IntrusionPoint
  createdAtMs: number
}

export interface ResourceProjectile {
  id: number
  sourceGuardId: string
  previousPosition: IntrusionPoint
  position: IntrusionPoint
  direction: IntrusionPoint
  speedPerMs: number
  ageMs: number
  lifetimeMs: number
}

export type ResourceTrailPhase = 'active' | 'fading'
export type ResourcePlayerPhase = 'active' | 'collapsing' | 'reconstructing'

export interface ResourceCombatState {
  elapsedMs: number
  guards: ReadonlyMap<string, ResourceGuard>
  projectiles: readonly ResourceProjectile[]
  nextProjectileId: number
  lastGlobalShotAtMs: number | null
  trail: readonly ResourceTrailSegment[]
  nextTrailSegmentId: number
  trailSuppressedMs: number
  playerHealth: number
  playerInvulnerableMs: number
  repairDelayMs: number
  repairIntervalMs: number
  reconstructionMs: number | null
  resumeGraceMs: number
}

export interface ResourcePlayerMovement {
  from: IntrusionPoint
  to: IntrusionPoint
  valid: boolean
  safeArea: IntrusionRect
}

export interface AdvanceResourceCombatInput {
  deltaMs: number
  previousPlayer: IntrusionPoint
  player: IntrusionPoint
  playerVelocity: IntrusionPoint
  opaqueBase: IntrusionRect
  guardedSafeArea: IntrusionRect
  combatActive: boolean
  patrolActive: boolean
  tutorialEncounter: boolean
}

export type ResourceCombatEvent =
  | { type: 'trail-created'; segmentId: number }
  | { type: 'trail-cleared'; reason: 'safe-area' | 'suppressed' | 'resume' | 'destroyed' }
  | { type: 'guard-aiming'; guardId: string }
  | { type: 'guard-fired'; guardId: string; projectileId: number }
  | { type: 'guard-destroyed'; guardId: string }
  | {
      type: 'player-damaged'
      health: number
      guardId: string
      projectileId: number
    }
  | { type: 'player-repaired'; health: number }
  | { type: 'player-destroyed' }
  | { type: 'player-reconstructed' }

export interface ResourceCombatTransition {
  state: ResourceCombatState
  events: readonly ResourceCombatEvent[]
}

interface TimeInterval {
  start: number
  end: number
}

interface AdvancedGuard {
  guard: ResourceGuard
  events: readonly ResourceCombatEvent[]
  readyToFire: boolean
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function copyPoint(point: IntrusionPoint): IntrusionPoint {
  return { x: point.x, y: point.y }
}

function add(
  point: IntrusionPoint,
  vector: IntrusionPoint,
  scale = 1,
): IntrusionPoint {
  return {
    x: point.x + vector.x * scale,
    y: point.y + vector.y * scale,
  }
}

function subtract(left: IntrusionPoint, right: IntrusionPoint): IntrusionPoint {
  return { x: left.x - right.x, y: left.y - right.y }
}

function dot(left: IntrusionPoint, right: IntrusionPoint): number {
  return left.x * right.x + left.y * right.y
}

function length(vector: IntrusionPoint): number {
  return Math.hypot(vector.x, vector.y)
}

function normalize(vector: IntrusionPoint): IntrusionPoint {
  const magnitude = length(vector)
  return magnitude <= EPSILON
    ? { x: 0, y: 0 }
    : { x: vector.x / magnitude, y: vector.y / magnitude }
}

function lerp(
  from: IntrusionPoint,
  to: IntrusionPoint,
  progress: number,
): IntrusionPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function pointInsideRect(point: IntrusionPoint, rect: IntrusionRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function pointToSegmentDistance(
  point: IntrusionPoint,
  from: IntrusionPoint,
  to: IntrusionPoint,
): number {
  const segment = subtract(to, from)
  const segmentLengthSquared = dot(segment, segment)
  if (segmentLengthSquared <= EPSILON) return length(subtract(point, from))
  const progress = clamp(
    dot(subtract(point, from), segment) / segmentLengthSquared,
    0,
    1,
  )
  return length(subtract(point, lerp(from, to, progress)))
}

function intersectIntervals(
  left: TimeInterval,
  right: TimeInterval,
): TimeInterval | null {
  const start = Math.max(left.start, right.start)
  const end = Math.min(left.end, right.end)
  return start <= end + EPSILON ? { start, end } : null
}

function linearRangeInterval(
  initial: number,
  velocity: number,
  minimum: number,
  maximum: number,
): TimeInterval | null {
  if (Math.abs(velocity) <= EPSILON) {
    return initial >= minimum - EPSILON && initial <= maximum + EPSILON
      ? { start: 0, end: 1 }
      : null
  }
  const first = (minimum - initial) / velocity
  const second = (maximum - initial) / velocity
  const interval = {
    start: Math.max(0, Math.min(first, second)),
    end: Math.min(1, Math.max(first, second)),
  }
  return interval.start <= interval.end + EPSILON ? interval : null
}

function movingPointCircleContactTime(
  from: IntrusionPoint,
  to: IntrusionPoint,
  center: IntrusionPoint,
  radius: number,
): number | null {
  const offset = subtract(from, center)
  const velocity = subtract(to, from)
  const radiusSquared = radius * radius
  if (dot(offset, offset) <= radiusSquared + EPSILON) return 0
  const quadratic = dot(velocity, velocity)
  if (quadratic <= EPSILON) return null
  const linear = 2 * dot(offset, velocity)
  const constant = dot(offset, offset) - radiusSquared
  const discriminant = linear * linear - 4 * quadratic * constant
  if (discriminant < 0) return null
  const squareRoot = Math.sqrt(discriminant)
  const first = (-linear - squareRoot) / (2 * quadratic)
  const second = (-linear + squareRoot) / (2 * quadratic)
  if (first >= -EPSILON && first <= 1 + EPSILON) return clamp(first, 0, 1)
  if (second >= -EPSILON && second <= 1 + EPSILON) return clamp(second, 0, 1)
  return null
}

function movingCircleContactTime(
  firstFrom: IntrusionPoint,
  firstTo: IntrusionPoint,
  secondFrom: IntrusionPoint,
  secondTo: IntrusionPoint,
  combinedRadius: number,
): number | null {
  return movingPointCircleContactTime(
    subtract(firstFrom, secondFrom),
    subtract(firstTo, secondTo),
    { x: 0, y: 0 },
    Math.max(0, combinedRadius),
  )
}

/** Returns the earliest normalized contact time for a moving point and segment. */
export function segmentContactTime(
  a0: IntrusionPoint,
  a1: IntrusionPoint,
  b0: IntrusionPoint,
  b1: IntrusionPoint,
  combinedRadius: number,
): number | null {
  const radius = Math.max(0, combinedRadius)
  if (pointToSegmentDistance(a0, b0, b1) <= radius + EPSILON) return 0

  const candidates: number[] = []
  const firstEndpoint = movingPointCircleContactTime(a0, a1, b0, radius)
  const secondEndpoint = movingPointCircleContactTime(a0, a1, b1, radius)
  if (firstEndpoint !== null) candidates.push(firstEndpoint)
  if (secondEndpoint !== null) candidates.push(secondEndpoint)

  const staticSegment = subtract(b1, b0)
  const staticLength = length(staticSegment)
  if (staticLength > EPSILON) {
    const tangent = {
      x: staticSegment.x / staticLength,
      y: staticSegment.y / staticLength,
    }
    const normal = { x: -tangent.y, y: tangent.x }
    const offset = subtract(a0, b0)
    const velocity = subtract(a1, a0)
    const tangentInterval = linearRangeInterval(
      dot(offset, tangent),
      dot(velocity, tangent),
      0,
      staticLength,
    )
    const normalInterval = linearRangeInterval(
      dot(offset, normal),
      dot(velocity, normal),
      -radius,
      radius,
    )
    if (tangentInterval && normalInterval) {
      const stripInterval = intersectIntervals(tangentInterval, normalInterval)
      if (stripInterval) candidates.push(clamp(stripInterval.start, 0, 1))
    }
  }

  return candidates
    .filter((candidate) =>
      pointToSegmentDistance(lerp(a0, a1, candidate), b0, b1) <= radius + 1e-7,
    )
    .sort((left, right) => left - right)[0] ?? null
}

function segmentRectInterval(
  from: IntrusionPoint,
  to: IntrusionPoint,
  rect: IntrusionRect,
): TimeInterval | null {
  const velocity = subtract(to, from)
  const horizontal = linearRangeInterval(
    from.x,
    velocity.x,
    rect.x,
    rect.x + rect.width,
  )
  const vertical = linearRangeInterval(
    from.y,
    velocity.y,
    rect.y,
    rect.y + rect.height,
  )
  return horizontal && vertical ? intersectIntervals(horizontal, vertical) : null
}

function constrainToField(point: IntrusionPoint): IntrusionPoint {
  return {
    x: clamp(
      point.x,
      RESOURCE_TRON_COMBAT_CONFIG.fieldPadding,
      RESOURCE_TRON_COMBAT_CONFIG.fieldWidth -
        RESOURCE_TRON_COMBAT_CONFIG.fieldPadding,
    ),
    y: clamp(
      point.y,
      RESOURCE_TRON_COMBAT_CONFIG.fieldPadding,
      RESOURCE_TRON_COMBAT_CONFIG.fieldHeight -
        RESOURCE_TRON_COMBAT_CONFIG.fieldPadding,
    ),
  }
}

function pushOutsideRect(
  point: IntrusionPoint,
  rect: IntrusionRect,
): IntrusionPoint {
  if (!pointInsideRect(point, rect)) return point
  const candidates = [
    { distance: Math.abs(point.x - rect.x), point: { x: rect.x - 1e-4, y: point.y } },
    {
      distance: Math.abs(point.x - (rect.x + rect.width)),
      point: { x: rect.x + rect.width + 1e-4, y: point.y },
    },
    { distance: Math.abs(point.y - rect.y), point: { x: point.x, y: rect.y - 1e-4 } },
    {
      distance: Math.abs(point.y - (rect.y + rect.height)),
      point: { x: point.x, y: rect.y + rect.height + 1e-4 },
    },
  ].sort((left, right) => left.distance - right.distance)
  return constrainToField(candidates[0].point)
}

function constrainGuardMovement(
  from: IntrusionPoint,
  desired: IntrusionPoint,
  guardedSafeArea: IntrusionRect,
): IntrusionPoint {
  const safeFrom = pushOutsideRect(constrainToField(from), guardedSafeArea)
  const safeDesired = constrainToField(desired)
  const intersection = segmentRectInterval(safeFrom, safeDesired, guardedSafeArea)
  if (!intersection) return safeDesired
  if (pointInsideRect(safeDesired, guardedSafeArea) || intersection.start < 1) {
    const progress = clamp(intersection.start - 1e-5, 0, 1)
    return pushOutsideRect(lerp(safeFrom, safeDesired, progress), guardedSafeArea)
  }
  return safeDesired
}

function createGuard(spawn: ResourceGuardSpawn): ResourceGuard {
  const position = copyPoint(spawn.position)
  const patrolling = spawn.mode === 'patrol'
  return {
    id: spawn.id,
    category: spawn.category,
    position,
    previousPosition: copyPoint(position),
    spawnPosition: copyPoint(position),
    patrolWaypoints: (spawn.patrolWaypoints ?? [position]).map(copyPoint),
    phase: patrolling ? 'patrolling' : 'pursuing',
    phaseElapsedMs: 0,
    phaseDurationMs: patrolling
      ? 0
      : RESOURCE_TRON_COMBAT_CONFIG.initiativeDelayMs[spawn.initiative],
    lockedAimDirection: null,
    lastShotAtMs: null,
    initiative: spawn.initiative,
    actionSequence: 0,
  }
}

export function createResourceCombatState(
  guardSpawns: readonly ResourceGuardSpawn[] = [],
): ResourceCombatState {
  return {
    elapsedMs: 0,
    guards: new Map(
      [...guardSpawns]
        .sort((left, right) =>
          left.initiative - right.initiative || left.id.localeCompare(right.id),
        )
        .map((spawn) => [spawn.id, createGuard(spawn)]),
    ),
    projectiles: [],
    nextProjectileId: 1,
    lastGlobalShotAtMs: null,
    trail: [],
    nextTrailSegmentId: 1,
    trailSuppressedMs: 0,
    playerHealth: RESOURCE_TRON_COMBAT_CONFIG.maximumHealth,
    playerInvulnerableMs: 0,
    repairDelayMs: 0,
    repairIntervalMs: 0,
    reconstructionMs: null,
    resumeGraceMs: 0,
  }
}

export function synchronizeResourceCombatGuards(
  state: ResourceCombatState,
  guardSpawns: readonly ResourceGuardSpawn[],
): ResourceCombatState {
  const guards = new Map<string, ResourceGuard>()
  for (const spawn of [...guardSpawns].sort((left, right) =>
    left.initiative - right.initiative || left.id.localeCompare(right.id),
  )) {
    const current = state.guards.get(spawn.id)
    if (!current) {
      guards.set(spawn.id, createGuard(spawn))
      continue
    }

    const patrolWaypoints = (spawn.patrolWaypoints ?? [spawn.position]).map(copyPoint)
    if (current.phase === 'destroyed') {
      guards.set(spawn.id, {
        ...current,
        category: spawn.category,
        spawnPosition: copyPoint(spawn.position),
        patrolWaypoints,
      })
      continue
    }

    const shouldPatrol = spawn.mode === 'patrol'
    const leavingPatrol = !shouldPatrol && current.phase === 'patrolling'
    guards.set(spawn.id, {
      ...current,
      category: spawn.category,
      spawnPosition: copyPoint(spawn.position),
      patrolWaypoints,
      phase: shouldPatrol ? 'patrolling' : leavingPatrol ? 'pursuing' : current.phase,
      phaseElapsedMs: shouldPatrol || leavingPatrol ? 0 : current.phaseElapsedMs,
      phaseDurationMs: shouldPatrol
        ? 0
        : leavingPatrol
          ? RESOURCE_TRON_COMBAT_CONFIG.initiativeDelayMs[spawn.initiative]
          : current.phaseDurationMs,
      lockedAimDirection: shouldPatrol || leavingPatrol
        ? null
        : current.lockedAimDirection,
    })
  }
  return { ...state, guards }
}

export function resetResourceCombatEncounter(
  state: ResourceCombatState,
  guardSpawns: readonly ResourceGuardSpawn[],
): ResourceCombatState {
  const reset = createResourceCombatState(guardSpawns)
  return {
    ...reset,
    elapsedMs: state.elapsedMs,
    nextTrailSegmentId: state.nextTrailSegmentId,
    nextProjectileId: state.nextProjectileId ?? 1,
    playerHealth: state.playerHealth,
    playerInvulnerableMs: state.playerInvulnerableMs,
    reconstructionMs: state.reconstructionMs,
    resumeGraceMs: state.resumeGraceMs,
  }
}

export function getResourceTrailPhase(
  segment: ResourceTrailSegment,
  elapsedMs: number,
): ResourceTrailPhase | null {
  const age = Math.max(0, elapsedMs - segment.createdAtMs)
  if (age < RESOURCE_TRON_COMBAT_CONFIG.trailActiveMs) return 'active'
  if (
    age <
    RESOURCE_TRON_COMBAT_CONFIG.trailActiveMs +
      RESOURCE_TRON_COMBAT_CONFIG.trailFadeMs
  ) {
    return 'fading'
  }
  return null
}

export function getResourcePlayerPhase(
  state: ResourceCombatState,
): ResourcePlayerPhase {
  if (state.reconstructionMs === null) return 'active'
  const reconstructionElapsedMs =
    RESOURCE_TRON_COMBAT_CONFIG.reconstructionMs - state.reconstructionMs
  return reconstructionElapsedMs < RESOURCE_TRON_COMBAT_CONFIG.collapseMs
    ? 'collapsing'
    : 'reconstructing'
}

function clearTrail(
  state: ResourceCombatState,
  reason: Extract<ResourceCombatEvent, { type: 'trail-cleared' }>['reason'],
): ResourceCombatTransition {
  if (state.trail.length === 0) return { state, events: [] }
  return {
    state: { ...state, trail: [] },
    events: [{ type: 'trail-cleared', reason }],
  }
}

export function suppressResourceCombatTrail(
  state: ResourceCombatState,
  durationMs: number,
): ResourceCombatState {
  return {
    ...state,
    trail: [],
    trailSuppressedMs: Math.max(state.trailSuppressedMs, finiteDuration(durationMs)),
  }
}

export function applyResourceCombatResumeGrace(
  state: ResourceCombatState,
): ResourceCombatState {
  return {
    ...state,
    trail: [],
    resumeGraceMs: RESOURCE_TRON_COMBAT_CONFIG.resumeGraceMs,
  }
}

export function recordResourceCombatMovement(
  state: ResourceCombatState,
  movement: ResourcePlayerMovement,
): ResourceCombatTransition {
  if (
    !movement.valid ||
    state.reconstructionMs !== null ||
    (movement.from.x === movement.to.x && movement.from.y === movement.to.y)
  ) {
    return { state, events: [] }
  }

  const fromInside = pointInsideRect(movement.from, movement.safeArea)
  const toInside = pointInsideRect(movement.to, movement.safeArea)
  const safeIntersection = segmentRectInterval(
    movement.from,
    movement.to,
    movement.safeArea,
  )
  let trail = state.trail
  const events: ResourceCombatEvent[] = []
  let trailFrom = movement.from

  if (toInside) return clearTrail(state, 'safe-area')
  if (safeIntersection) {
    if (trail.length > 0) {
      trail = []
      events.push({ type: 'trail-cleared', reason: 'safe-area' })
    }
    if (fromInside || safeIntersection.start < safeIntersection.end) {
      trailFrom = lerp(
        movement.from,
        movement.to,
        clamp(safeIntersection.end + 1e-5, 0, 1),
      )
    }
  }

  if (state.trailSuppressedMs > 0) {
    return {
      state: trail === state.trail ? state : { ...state, trail },
      events,
    }
  }
  if (length(subtract(movement.to, trailFrom)) <= EPSILON) {
    return {
      state: trail === state.trail ? state : { ...state, trail },
      events,
    }
  }

  const segment: ResourceTrailSegment = {
    id: state.nextTrailSegmentId,
    from: copyPoint(trailFrom),
    to: copyPoint(movement.to),
    createdAtMs: state.elapsedMs,
  }
  events.push({ type: 'trail-created', segmentId: segment.id })
  return {
    state: {
      ...state,
      trail: [...trail, segment],
      nextTrailSegmentId: state.nextTrailSegmentId + 1,
    },
    events,
  }
}

function moveGuardToward(
  guard: ResourceGuard,
  target: IntrusionPoint,
  movementDistance: number,
  guardedSafeArea: IntrusionRect,
): ResourceGuard {
  const direction = normalize(subtract(target, guard.position))
  return {
    ...guard,
    position: constrainGuardMovement(
      guard.position,
      add(guard.position, direction, movementDistance),
      guardedSafeArea,
    ),
  }
}

function firstTrailObstacle(
  from: IntrusionPoint,
  to: IntrusionPoint,
  trail: readonly ResourceTrailSegment[],
  elapsedMs: number,
): ResourceTrailSegment | null {
  const collisionRadius =
    RESOURCE_TRON_COMBAT_CONFIG.guardRadius +
    RESOURCE_TRON_COMBAT_CONFIG.trailCollisionRadius +
    0.12
  let earliest: { segment: ResourceTrailSegment; time: number } | null = null
  for (const segment of trail) {
    if (getResourceTrailPhase(segment, elapsedMs) !== 'active') continue
    const contact = segmentContactTime(from, to, segment.from, segment.to, collisionRadius)
    if (contact === null) continue
    if (!earliest || contact < earliest.time) earliest = { segment, time: contact }
  }
  return earliest?.segment ?? null
}

function moveGuardWithTrailAwareness(
  guard: ResourceGuard,
  target: IntrusionPoint,
  movementDistance: number,
  guardedSafeArea: IntrusionRect,
  trail: readonly ResourceTrailSegment[],
  elapsedMs: number,
): ResourceGuard {
  const direct = moveGuardToward(guard, target, movementDistance, guardedSafeArea)
  const obstacle = firstTrailObstacle(guard.position, direct.position, trail, elapsedMs)
  if (!obstacle) return direct

  const tangent = normalize(subtract(obstacle.to, obstacle.from))
  const fallback = normalize({
    x: -(target.y - guard.position.y),
    y: target.x - guard.position.x,
  })
  const routeAxis = length(tangent) > EPSILON ? tangent : fallback
  const preferredSign = guard.initiative === 1
    ? -1
    : guard.initiative === 2
      ? 1
      : guard.actionSequence % 2 === 0
        ? 1
        : -1
  const candidates = [preferredSign, -preferredSign]
    .map((sign) => constrainGuardMovement(
      guard.position,
      add(guard.position, routeAxis, movementDistance * sign),
      guardedSafeArea,
    ))
    .filter((candidate) =>
      firstTrailObstacle(guard.position, candidate, trail, elapsedMs) === null,
    )
    .sort((left, right) =>
      length(subtract(left, target)) - length(subtract(right, target)),
    )

  return candidates[0] ? { ...guard, position: candidates[0] } : guard
}

function canStartAim(
  guard: ResourceGuard,
  input: AdvanceResourceCombatInput,
  absoluteTimeMs: number,
): boolean {
  if (length(subtract(input.player, guard.position)) > RESOURCE_TRON_COMBAT_CONFIG.attackRange) {
    return false
  }
  if (segmentRectInterval(guard.position, input.player, input.guardedSafeArea)) {
    return false
  }
  return guard.lastShotAtMs === null ||
    absoluteTimeMs - guard.lastShotAtMs >= RESOURCE_TRON_COMBAT_CONFIG.perGuardShotIntervalMs
}

function movePatrollingGuard(
  current: ResourceGuard,
  deltaMs: number,
  guardedSafeArea: IntrusionRect,
): ResourceGuard {
  const waypoints = current.patrolWaypoints.length > 0
    ? current.patrolWaypoints
    : [current.spawnPosition]
  let guard = { ...current, previousPosition: copyPoint(current.position) }
  let movement = RESOURCE_TRON_COMBAT_CONFIG.patrolSpeedPerMs * deltaMs
  let transitions = 0
  while (movement > EPSILON && transitions <= waypoints.length) {
    const target = waypoints[(guard.actionSequence + 1) % waypoints.length]
    const remaining = length(subtract(target, guard.position))
    if (remaining <= 0.12) {
      guard = { ...guard, actionSequence: guard.actionSequence + 1 }
      transitions += 1
      continue
    }
    const step = Math.min(movement, remaining)
    const moved = moveGuardToward(guard, target, step, guardedSafeArea)
    const actual = length(subtract(moved.position, guard.position))
    guard = moved
    movement -= actual
    if (step >= remaining - EPSILON) {
      guard = { ...guard, actionSequence: guard.actionSequence + 1 }
      transitions += 1
    }
    if (actual <= EPSILON) break
  }
  return guard
}

function advanceGuard(
  current: ResourceGuard,
  deltaMs: number,
  input: AdvanceResourceCombatInput,
  trail: readonly ResourceTrailSegment[],
  startElapsedMs: number,
): AdvancedGuard {
  if (current.phase === 'destroyed') {
    return {
      guard: { ...current, previousPosition: copyPoint(current.position) },
      events: [],
      readyToFire: false,
    }
  }
  if (current.phase === 'patrolling') {
    return {
      guard: input.patrolActive
        ? movePatrollingGuard(current, deltaMs, input.guardedSafeArea)
        : { ...current, previousPosition: copyPoint(current.position) },
      events: [],
      readyToFire: false,
    }
  }
  if (!input.combatActive) {
    return {
      guard: { ...current, previousPosition: copyPoint(current.position) },
      events: [],
      readyToFire: false,
    }
  }

  let guard: ResourceGuard = {
    ...current,
    previousPosition: copyPoint(current.position),
  }
  let remainingMs = deltaMs
  let transitions = 0
  const events: ResourceCombatEvent[] = []

  while (remainingMs > EPSILON && transitions < 8) {
    const untilBoundary = Math.max(0, guard.phaseDurationMs - guard.phaseElapsedMs)
    const absoluteTimeMs = startElapsedMs + (deltaMs - remainingMs)

    if (untilBoundary <= EPSILON) {
      if (guard.phase === 'pursuing') {
        if (canStartAim(guard, input, absoluteTimeMs)) {
          const aimDirection = normalize(subtract(input.player, guard.position))
          guard = {
            ...guard,
            phase: 'aiming',
            phaseElapsedMs: 0,
            phaseDurationMs: RESOURCE_TRON_COMBAT_CONFIG.aimMs,
            lockedAimDirection: length(aimDirection) > EPSILON
              ? aimDirection
              : { x: 0, y: 1 },
            actionSequence: guard.actionSequence + 1,
          }
          events.push({ type: 'guard-aiming', guardId: guard.id })
        } else {
          const individualWait = guard.lastShotAtMs === null
            ? 0
            : Math.max(
                0,
                guard.lastShotAtMs +
                  RESOURCE_TRON_COMBAT_CONFIG.perGuardShotIntervalMs -
                  absoluteTimeMs,
              )
          guard = {
            ...guard,
            phaseElapsedMs: 0,
            phaseDurationMs: Math.max(
              RESOURCE_TRON_COMBAT_CONFIG.attackRecheckMs,
              individualWait,
            ),
            lockedAimDirection: null,
          }
        }
      } else if (guard.phase === 'aiming') {
        return { guard, events, readyToFire: true }
      } else if (guard.phase === 'cooldown') {
        guard = {
          ...guard,
          phase: 'pursuing',
          phaseElapsedMs: 0,
          phaseDurationMs: RESOURCE_TRON_COMBAT_CONFIG.attackRecheckMs,
          lockedAimDirection: null,
        }
      }
      transitions += 1
      continue
    }

    const stepMs = Math.min(remainingMs, untilBoundary)
    if (guard.phase === 'pursuing' || guard.phase === 'cooldown') {
      const speed = guard.phase === 'cooldown'
        ? RESOURCE_TRON_COMBAT_CONFIG.cooldownSpeedPerMs
        : input.tutorialEncounter
          ? RESOURCE_TRON_COMBAT_CONFIG.tutorialPursuitSpeedPerMs
          : RESOURCE_TRON_COMBAT_CONFIG.pursuitSpeedPerMs
      guard = moveGuardWithTrailAwareness(
        guard,
        input.player,
        speed * stepMs,
        input.guardedSafeArea,
        trail,
        absoluteTimeMs,
      )
    }
    guard = { ...guard, phaseElapsedMs: guard.phaseElapsedMs + stepMs }
    remainingMs -= stepMs
  }

  if (
    guard.phase === 'aiming' &&
    guard.phaseElapsedMs >= guard.phaseDurationMs - EPSILON
  ) {
    return { guard, events, readyToFire: true }
  }
  return { guard, events, readyToFire: false }
}

function separateGuards(
  guards: ReadonlyMap<string, ResourceGuard>,
  guardedSafeArea: IntrusionRect,
): ReadonlyMap<string, ResourceGuard> {
  const ordered = [...guards.values()].sort((left, right) =>
    left.initiative - right.initiative || left.id.localeCompare(right.id),
  )
  const positions = new Map(ordered.map((guard) => [guard.id, copyPoint(guard.position)]))

  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    const left = ordered[leftIndex]
    if (left.phase === 'destroyed') continue
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const right = ordered[rightIndex]
      if (right.phase === 'destroyed') continue
      const leftPosition = positions.get(left.id)!
      const rightPosition = positions.get(right.id)!
      const difference = subtract(rightPosition, leftPosition)
      const distance = length(difference)
      if (distance >= RESOURCE_TRON_COMBAT_CONFIG.separationDistance) continue
      const direction = distance <= EPSILON
        ? { x: left.initiative === 1 ? -1 : 1, y: 0 }
        : { x: difference.x / distance, y: difference.y / distance }
      const correction = (RESOURCE_TRON_COMBAT_CONFIG.separationDistance - distance) / 2
      positions.set(left.id, pushOutsideRect(
        constrainToField(add(leftPosition, direction, -correction)),
        guardedSafeArea,
      ))
      positions.set(right.id, pushOutsideRect(
        constrainToField(add(rightPosition, direction, correction)),
        guardedSafeArea,
      ))
    }
  }

  return new Map(ordered.map((guard) => [
    guard.id,
    { ...guard, position: positions.get(guard.id)! },
  ]))
}

function capGuardTravel(
  guards: ReadonlyMap<string, ResourceGuard>,
  deltaMs: number,
): ReadonlyMap<string, ResourceGuard> {
  const maximumDistance =
    REFERENCE_PLAYER_SPEED_PER_MS *
    RESOURCE_TRON_COMBAT_CONFIG.maximumGuardSpeedRatio *
    deltaMs
  const capped = new Map<string, ResourceGuard>()
  for (const guard of guards.values()) {
    const movement = subtract(guard.position, guard.previousPosition)
    const movementDistance = length(movement)
    if (guard.phase === 'destroyed' || movementDistance <= maximumDistance + EPSILON) {
      capped.set(guard.id, guard)
      continue
    }
    capped.set(guard.id, {
      ...guard,
      position: add(guard.previousPosition, normalize(movement), maximumDistance),
    })
  }
  return capped
}

function activeTrailContact(
  guard: ResourceGuard,
  trail: readonly ResourceTrailSegment[],
  startElapsedMs: number,
  deltaMs: number,
): number | null {
  let earliest: number | null = null
  for (const segment of trail) {
    const contact = segmentContactTime(
      guard.previousPosition,
      guard.position,
      segment.from,
      segment.to,
      RESOURCE_TRON_COMBAT_CONFIG.guardRadius +
        RESOURCE_TRON_COMBAT_CONFIG.trailCollisionRadius,
    )
    if (contact === null) continue
    const contactElapsedMs = startElapsedMs + contact * deltaMs
    if (
      contactElapsedMs - segment.createdAtMs >=
      RESOURCE_TRON_COMBAT_CONFIG.trailActiveMs
    ) {
      continue
    }
    if (contactElapsedMs < segment.createdAtMs - EPSILON) continue
    earliest = earliest === null ? contact : Math.min(earliest, contact)
  }
  return earliest
}

function advanceProjectiles(
  projectiles: readonly ResourceProjectile[],
  deltaMs: number,
  input: AdvanceResourceCombatInput,
  playerProtected: boolean,
  events: ResourceCombatEvent[],
  startingHealth: number,
): { projectiles: ResourceProjectile[]; playerHealth: number } {
  const survivors: ResourceProjectile[] = []
  let playerHealth = startingHealth
  const playerSafe = pointInsideRect(input.player, input.guardedSafeArea)

  for (const current of projectiles) {
    const ageMs = current.ageMs + deltaMs
    const previousPosition = copyPoint(current.position)
    const position = add(
      current.position,
      current.direction,
      current.speedPerMs * deltaMs,
    )
    if (ageMs >= current.lifetimeMs) continue
    if (
      position.x < -1 ||
      position.x > RESOURCE_TRON_COMBAT_CONFIG.fieldWidth + 1 ||
      position.y < -1 ||
      position.y > RESOURCE_TRON_COMBAT_CONFIG.fieldHeight + 1
    ) {
      continue
    }

    const advanced = { ...current, previousPosition, position, ageMs }
    const contact = playerSafe || playerProtected
      ? null
      : movingCircleContactTime(
          previousPosition,
          position,
          input.previousPlayer,
          input.player,
          RESOURCE_TRON_COMBAT_CONFIG.projectileRadius +
            RESOURCE_TRON_COMBAT_CONFIG.playerRadius,
        )
    if (contact === null || playerHealth <= 0) {
      survivors.push(advanced)
      continue
    }

    playerHealth = Math.max(
      0,
      playerHealth - RESOURCE_TRON_COMBAT_CONFIG.damagePerProjectile,
    )
    events.push({
      type: 'player-damaged',
      health: playerHealth,
      guardId: current.sourceGuardId,
      projectileId: current.id,
    })
  }

  return { projectiles: survivors, playerHealth }
}

function repairPlayer(
  state: ResourceCombatState,
  input: AdvanceResourceCombatInput,
  deltaMs: number,
  events: ResourceCombatEvent[],
): ResourceCombatState {
  const inOpaqueBase = pointInsideRect(input.player, input.opaqueBase)
  if (
    !inOpaqueBase ||
    state.reconstructionMs !== null ||
    state.playerHealth >= RESOURCE_TRON_COMBAT_CONFIG.maximumHealth
  ) {
    return state.repairDelayMs === 0 && state.repairIntervalMs === 0
      ? state
      : { ...state, repairDelayMs: 0, repairIntervalMs: 0 }
  }

  let remainingMs = deltaMs
  let repairDelayMs = state.repairDelayMs
  let repairIntervalMs = state.repairIntervalMs
  let playerHealth = state.playerHealth

  if (repairDelayMs < RESOURCE_TRON_COMBAT_CONFIG.repairDelayMs) {
    const delayStep = Math.min(
      remainingMs,
      RESOURCE_TRON_COMBAT_CONFIG.repairDelayMs - repairDelayMs,
    )
    repairDelayMs += delayStep
    remainingMs -= delayStep
  }
  if (repairDelayMs >= RESOURCE_TRON_COMBAT_CONFIG.repairDelayMs && remainingMs > 0) {
    repairIntervalMs += remainingMs
    while (
      repairIntervalMs >= RESOURCE_TRON_COMBAT_CONFIG.repairIntervalMs &&
      playerHealth < RESOURCE_TRON_COMBAT_CONFIG.maximumHealth
    ) {
      repairIntervalMs -= RESOURCE_TRON_COMBAT_CONFIG.repairIntervalMs
      playerHealth = Math.min(
        RESOURCE_TRON_COMBAT_CONFIG.maximumHealth,
        playerHealth + RESOURCE_TRON_COMBAT_CONFIG.repairAmount,
      )
      events.push({ type: 'player-repaired', health: playerHealth })
    }
  }
  if (playerHealth >= RESOURCE_TRON_COMBAT_CONFIG.maximumHealth) repairIntervalMs = 0
  return { ...state, playerHealth, repairDelayMs, repairIntervalMs }
}

export function advanceResourceCombatState(
  current: ResourceCombatState,
  input: AdvanceResourceCombatInput,
): ResourceCombatTransition {
  const deltaMs = finiteDuration(input.deltaMs)
  if (deltaMs <= 0) return { state: current, events: [] }

  const elapsedMs = current.elapsedMs + deltaMs
  const events: ResourceCombatEvent[] = []
  let state: ResourceCombatState = {
    ...current,
    elapsedMs,
    projectiles: current.projectiles ?? [],
    nextProjectileId: current.nextProjectileId ?? 1,
    lastGlobalShotAtMs: current.lastGlobalShotAtMs ?? null,
    trail: current.trail.filter(
      (segment) => getResourceTrailPhase(segment, elapsedMs) !== null,
    ),
    trailSuppressedMs: Math.max(0, current.trailSuppressedMs - deltaMs),
    playerInvulnerableMs: 0,
    resumeGraceMs: Math.max(0, current.resumeGraceMs - deltaMs),
  }

  if (current.reconstructionMs !== null) {
    const reconstructionMs = Math.max(0, current.reconstructionMs - deltaMs)
    if (reconstructionMs > 0) {
      return {
        state: {
          ...state,
          trail: [],
          projectiles: [],
          reconstructionMs,
          repairDelayMs: 0,
          repairIntervalMs: 0,
        },
        events,
      }
    }
    state = {
      ...state,
      trail: [],
      projectiles: [],
      playerHealth: RESOURCE_TRON_COMBAT_CONFIG.maximumHealth,
      reconstructionMs: null,
      repairDelayMs: 0,
      repairIntervalMs: 0,
      resumeGraceMs: RESOURCE_TRON_COMBAT_CONFIG.resumeGraceMs,
    }
    events.push({ type: 'player-reconstructed' })
    return { state, events }
  }

  const projectileStep = advanceProjectiles(
    state.projectiles,
    deltaMs,
    input,
    current.resumeGraceMs > 0,
    events,
    state.playerHealth,
  )
  state = {
    ...state,
    projectiles: projectileStep.projectiles,
    playerHealth: projectileStep.playerHealth,
    repairDelayMs: projectileStep.playerHealth < current.playerHealth
      ? 0
      : state.repairDelayMs,
    repairIntervalMs: projectileStep.playerHealth < current.playerHealth
      ? 0
      : state.repairIntervalMs,
  }

  if (state.playerHealth === 0) {
    if (state.trail.length > 0) events.push({ type: 'trail-cleared', reason: 'destroyed' })
    state = {
      ...state,
      trail: [],
      projectiles: [],
      reconstructionMs: RESOURCE_TRON_COMBAT_CONFIG.reconstructionMs,
      repairDelayMs: 0,
      repairIntervalMs: 0,
    }
    events.push({ type: 'player-destroyed' })
    return { state, events }
  }

  const guards = new Map<string, ResourceGuard>()
  const readyToFire = new Set<string>()
  for (const guard of [...state.guards.values()].sort((left, right) =>
    left.initiative - right.initiative || left.id.localeCompare(right.id),
  )) {
    const advanced = advanceGuard(
      guard,
      deltaMs,
      input,
      current.trail,
      current.elapsedMs,
    )
    guards.set(guard.id, advanced.guard)
    if (advanced.readyToFire) readyToFire.add(guard.id)
    events.push(...advanced.events)
  }
  const spaced = input.combatActive || input.patrolActive
    ? capGuardTravel(separateGuards(guards, input.guardedSafeArea), deltaMs)
    : guards

  const nextGuards = new Map(spaced)
  for (const guard of [...nextGuards.values()]) {
    if (guard.phase === 'destroyed') continue
    const contact = activeTrailContact(guard, current.trail, current.elapsedMs, deltaMs)
    if (contact === null) continue
    nextGuards.set(guard.id, {
      ...guard,
      position: lerp(guard.previousPosition, guard.position, contact),
      phase: 'destroyed',
      phaseElapsedMs: 0,
      phaseDurationMs: 0,
      lockedAimDirection: null,
    })
    readyToFire.delete(guard.id)
    events.push({ type: 'guard-destroyed', guardId: guard.id })
  }

  const projectiles = [...state.projectiles]
  let nextProjectileId = state.nextProjectileId
  let lastGlobalShotAtMs = state.lastGlobalShotAtMs
  for (const guardId of readyToFire) {
    const guard = nextGuards.get(guardId)
    if (!guard || guard.phase !== 'aiming') continue
    const individualReady = guard.lastShotAtMs === null ||
      elapsedMs - guard.lastShotAtMs >= RESOURCE_TRON_COMBAT_CONFIG.perGuardShotIntervalMs
    const globalReady = lastGlobalShotAtMs === null ||
      elapsedMs - lastGlobalShotAtMs >= RESOURCE_TRON_COMBAT_CONFIG.globalShotGapMs
    const capacityReady = projectiles.length < RESOURCE_TRON_COMBAT_CONFIG.maximumProjectiles

    if (individualReady && globalReady && capacityReady && input.combatActive) {
      const direction = guard.lockedAimDirection ?? normalize(subtract(input.player, guard.position))
      const safeDirection = length(direction) > EPSILON ? normalize(direction) : { x: 0, y: 1 }
      const origin = add(
        guard.position,
        safeDirection,
        RESOURCE_TRON_COMBAT_CONFIG.guardRadius +
          RESOURCE_TRON_COMBAT_CONFIG.projectileRadius +
          0.08,
      )
      const projectile: ResourceProjectile = {
        id: nextProjectileId,
        sourceGuardId: guard.id,
        previousPosition: copyPoint(origin),
        position: copyPoint(origin),
        direction: safeDirection,
        speedPerMs: RESOURCE_TRON_COMBAT_CONFIG.projectileSpeedPerMs,
        ageMs: 0,
        lifetimeMs: RESOURCE_TRON_COMBAT_CONFIG.projectileLifetimeMs,
      }
      projectiles.push(projectile)
      nextProjectileId += 1
      lastGlobalShotAtMs = elapsedMs
      nextGuards.set(guard.id, {
        ...guard,
        phase: 'cooldown',
        phaseElapsedMs: 0,
        phaseDurationMs: RESOURCE_TRON_COMBAT_CONFIG.cooldownMs,
        lockedAimDirection: null,
        lastShotAtMs: elapsedMs,
      })
      events.push({
        type: 'guard-fired',
        guardId: guard.id,
        projectileId: projectile.id,
      })
      continue
    }

    const individualWait = guard.lastShotAtMs === null
      ? 0
      : Math.max(
          0,
          guard.lastShotAtMs +
            RESOURCE_TRON_COMBAT_CONFIG.perGuardShotIntervalMs -
            elapsedMs,
        )
    const globalWait = lastGlobalShotAtMs === null
      ? 0
      : Math.max(
          0,
          lastGlobalShotAtMs + RESOURCE_TRON_COMBAT_CONFIG.globalShotGapMs - elapsedMs,
        )
    nextGuards.set(guard.id, {
      ...guard,
      phase: 'pursuing',
      phaseElapsedMs: 0,
      phaseDurationMs: Math.max(
        RESOURCE_TRON_COMBAT_CONFIG.attackRecheckMs,
        individualWait,
        globalWait,
      ),
      lockedAimDirection: null,
    })
  }

  state = {
    ...state,
    guards: nextGuards,
    projectiles,
    nextProjectileId,
    lastGlobalShotAtMs,
  }
  state = repairPlayer(state, input, deltaMs, events)
  return { state, events }
}
