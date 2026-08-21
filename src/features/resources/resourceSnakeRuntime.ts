import type { CompanyCategory } from '../../game/model'
import {
  SNAKE_DIRECTION_VECTORS,
  consumeResourceSnakeTurn,
  createResourceSnakeInputState,
  type ResourceSnakeInputState,
  type SnakeDirection8,
} from './resourceSnakeInput'

export const RESOURCE_SNAKE_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  fixedStepMs: 1000 / 120,
  maximumFrameDeltaMs: 100,
  playerMaximumSpeedPerSecond: 12,
  minimumLiveSpeedScale: 0.92,
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
  roundResolveMs: 520,
  playerMaximumIntegrity: 100,
} as const

export type SnakeId = 'player' | `enemy-${number}`
export type SnakeRoundPhase = 'idle' | 'deploying' | 'active' | 'resolving'
export type SnakeActorPhase = 'spawning' | 'active' | 'exploding' | 'defeated'
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
  playerSpawn: SnakeVector
  enemies: SnakeEnemySetup[]
}

export interface SnakeFrameInput {
  /** Compatibility command; the runtime snaps it to a legal eight-way hard turn. */
  playerDirection?: SnakeVector
  /** Compatibility alias for callers that call the value an intent. */
  playerIntent?: SnakeVector
  /** Enemy vector magnitude may request the bounded 0.92–1 recovery speed scale. */
  enemyDirections?: Record<string, SnakeVector>
}

export type ResourceSnakeEvent =
  | { id: number; type: 'round-started'; roundId: string }
  | {
      id: number
      type: 'snake-collided'
      actorIds: SnakeId[]
      point: SnakeVector
      hitStopMs: 90
      startedAtMs: number
    }
  | { id: number; type: 'snake-damaged'; actorId: SnakeId; integrity: number; maximumIntegrity: number }
  | { id: number; type: 'snake-died'; actorId: SnakeId; category: CompanyCategory | null; startedAtMs: number }
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
  const speed = actor.maximumSpeedPerSecond * resolved.speedScale
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

type CollisionKind = 'boundary' | 'head-head' | 'trail'

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
): CollisionCandidate[] {
  const candidates: CollisionCandidate[] = []
  const actors = activeActors(state)
  for (const actor of actors) {
    if (actor.collisionGraceMs > 0) continue
    for (const owner of actors) {
      for (const dot of owner.trail) {
        if (dot.spawnedAtMs >= simulationMs) continue
        const collisionRadius = (
          RESOURCE_SNAKE_CONFIG.headRadius + RESOURCE_SNAKE_CONFIG.trailRadius
        )
        if (
          owner.id === actor.id
          && simulationMs - dot.spawnedAtMs < RESOURCE_SNAKE_CONFIG.selfTrailIgnoreAgeMs
        ) continue
        // A freshly safe self dot can age into hazard range while the head is
        // stopped on top of it. Collision means entering a trail, not a trail
        // becoming active underneath an unmoving head; wait until the head has
        // exited before allowing a later swept re-entry to damage it.
        if (
          owner.id === actor.id
          && distance(actor.previousPosition, dot.position) <= collisionRadius
        ) continue
        const contactTime = sweptCircleTime(
          actor.previousPosition,
          actor.position,
          dot.position,
          collisionRadius,
        )
        if (contactTime === null) continue
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

function resolveCollisions(state: ResourceSnakeRoundState, stepMs: number): ResourceSnakeRoundState {
  const candidates = [
    ...boundaryCandidates(state, stepMs),
    ...headHeadCandidates(state),
    ...trailCandidates(state, state.simulationMs),
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
      next = updateActor(next, {
        ...actor,
        integrity,
        collisionGraceMs: RESOURCE_SNAKE_CONFIG.collisionGraceMs,
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
    next = appendEvent(next, playerDied
      ? { type: 'player-defeated', roundId: next.roundId ?? '' }
      : { type: 'round-won', roundId: next.roundId ?? '' })
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

function advanceFixedStep(
  state: ResourceSnakeRoundState,
  input: SnakeFrameInput,
): ResourceSnakeRoundState {
  const stepMs = RESOURCE_SNAKE_CONFIG.fixedStepMs
  if (state.phase !== 'active') return { ...state, simulationMs: state.simulationMs + stepMs }

  const simulationMs = state.simulationMs + stepMs
  let playerInput = synchronizeInputHeading(state.input, state.player.heading)
  let player = state.player
  if (state.player.phase === 'active') {
    const consumed = consumeResourceSnakeTurn(playerInput)
    const playerDirection = consumed.turn === null
      ? input.playerDirection ?? input.playerIntent
      : SNAKE_DIRECTION_VECTORS[consumed.turn]
    player = advanceActor({
      ...state.player,
      collisionGraceMs: Math.max(0, state.player.collisionGraceMs - stepMs),
    }, playerDirection, stepMs, simulationMs, false)
    playerInput = synchronizeInputHeading(consumed.state, player.heading)
  }
  const enemyDirections = input.enemyDirections ?? {}
  const enemies = state.enemies.map((enemy) =>
    enemy.phase === 'active'
      ? advanceActor({
        ...enemy,
        collisionGraceMs: Math.max(0, enemy.collisionGraceMs - stepMs),
      }, enemyDirections[enemy.id], stepMs, simulationMs, true)
      : enemy,
  )
  return resolveCollisions({
    ...state,
    simulationMs,
    input: playerInput,
    player,
    enemies,
  }, stepMs)
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
    && next.accumulatorMs >= RESOURCE_SNAKE_CONFIG.fixedStepMs
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
