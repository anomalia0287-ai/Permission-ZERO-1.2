import type { CompanyCategory } from '../../game/model'

export const RESOURCE_SNAKE_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  fixedStepMs: 1000 / 120,
  maximumFrameDeltaMs: 100,
  playerMaximumSpeedPerSecond: 8,
  playerAccelerationMs: 120,
  playerDecelerationMs: 100,
  headRadius: 0.34,
  trailRadius: 0.16,
  trailSpacing: 0.32,
  trailLifetimeMs: 10_000,
  trailShrinkMs: 2_000,
  maximumTrailDots: 320,
  deploymentMs: 220,
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
  velocity: SnakeVector
  integrity: number
  maximumIntegrity: number
  collisionGraceMs: number
  phase: SnakeActorPhase
  trail: SnakeTrailDot[]
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
  /** The desired player direction; the runtime normalizes it before physics. */
  playerDirection?: SnakeVector
  /** Alias useful to callers that call the value an intent. */
  playerIntent?: SnakeVector
  enemyDirections?: Record<string, SnakeVector>
}

export type ResourceSnakeEvent =
  | { id: number; type: 'round-started'; roundId: string; simulationMs: number }
  | { id: number; type: 'round-ready'; roundId: string; simulationMs: number }
  | {
      id: number
      type: 'resource-reward-requested'
      rewardKey: string
      reservedBlockId: string
      category: CompanyCategory
      commandSequence: number
    }
  | {
      id: number
      type: 'resource-reward-resolved'
      rewardKey: string
      outcome: 'success' | 'interrogation' | 'rejected' | 'cancelled'
    }

export type ResourceSnakeEffect =
  | {
      id: number
      type: 'request-resource-reward'
      rewardKey: string
      reservedBlockId: string
      category: CompanyCategory
      commandSequence: number
    }

export interface ResourceSnakeRoundState {
  roundId: string | null
  phase: SnakeRoundPhase
  simulationMs: number
  accumulatorMs: number
  resolvingMs: number
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

function normalize(vector: SnakeVector | undefined): SnakeVector {
  const x = finite(vector?.x ?? 0)
  const y = finite(vector?.y ?? 0)
  const length = Math.hypot(x, y)
  if (length === 0) return zeroVector()
  if (length <= 1) return { x, y }
  return { x: x / length, y: y / length }
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

function approachVector(
  current: SnakeVector,
  target: SnakeVector,
  maximumDelta: number,
): SnakeVector {
  const dx = target.x - current.x
  const dy = target.y - current.y
  const length = Math.hypot(dx, dy)
  if (length === 0 || length <= maximumDelta) return { ...target }
  const scale = maximumDelta / length
  return { x: current.x + dx * scale, y: current.y + dy * scale }
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
    velocity: zeroVector(),
    integrity: 0,
    maximumIntegrity: 0,
    collisionGraceMs: 0,
    phase: 'spawning',
    trail: [],
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
    player: createActor('player', 'player', spawn, {
      integrity: 100,
      maximumIntegrity: 100,
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
    integrity: 100,
    maximumIntegrity: 100,
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
    simulationMs: 0,
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
  direction: SnakeVector | undefined,
  stepMs: number,
  simulationMs: number,
): SnakeActor {
  const intent = normalize(direction)
  const maximumSpeed = RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
  const targetVelocity = {
    x: intent.x * maximumSpeed,
    y: intent.y * maximumSpeed,
  }
  const stepLimit = intent.x === 0 && intent.y === 0
    ? maximumSpeed * (stepMs / RESOURCE_SNAKE_CONFIG.playerDecelerationMs)
    : maximumSpeed * (stepMs / RESOURCE_SNAKE_CONFIG.playerAccelerationMs)
  const velocity = approachVector(actor.velocity, targetVelocity, stepLimit)
  const previousPosition = { ...actor.position }
  const proposedPosition = {
    x: actor.position.x + velocity.x * (stepMs / 1000),
    y: actor.position.y + velocity.y * (stepMs / 1000),
  }
  const position = boundedPosition(proposedPosition)
  return sampleTrail(
    { ...actor, position, velocity, phase: 'active' },
    previousPosition,
    position,
    simulationMs,
  )
}

function advanceFixedStep(
  state: ResourceSnakeRoundState,
  input: SnakeFrameInput,
): ResourceSnakeRoundState {
  const stepMs = RESOURCE_SNAKE_CONFIG.fixedStepMs
  if (state.phase === 'deploying') {
    const nextSimulationMs = state.simulationMs + stepMs
    if (nextSimulationMs >= RESOURCE_SNAKE_CONFIG.deploymentMs) {
      const ready = {
        ...state,
        phase: 'active' as const,
        simulationMs: RESOURCE_SNAKE_CONFIG.deploymentMs,
        player: { ...state.player, phase: 'active' as const },
        enemies: state.enemies.map((enemy) => ({ ...enemy, phase: 'active' as const })),
      }
      return appendEvent(ready, {
        type: 'round-ready',
        roundId: state.roundId ?? '',
        simulationMs: RESOURCE_SNAKE_CONFIG.deploymentMs,
      })
    }
    return { ...state, simulationMs: nextSimulationMs }
  }
  if (state.phase !== 'active') return { ...state, simulationMs: state.simulationMs + stepMs }

  const simulationMs = state.simulationMs + stepMs
  const playerDirection = input.playerDirection ?? input.playerIntent
  const player = advanceActor(state.player, playerDirection, stepMs, simulationMs)
  const enemyDirections = input.enemyDirections ?? {}
  const enemies = state.enemies.map((enemy) =>
    advanceActor(enemy, enemyDirections[enemy.id], stepMs, simulationMs),
  )
  return { ...state, simulationMs, player, enemies }
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
  let next = { ...state, accumulatorMs: state.accumulatorMs + safeDeltaMs }
  while (next.accumulatorMs >= RESOURCE_SNAKE_CONFIG.fixedStepMs) {
    next = advanceFixedStep(next, input)
    next = {
      ...next,
      accumulatorMs: Math.max(0, next.accumulatorMs - RESOURCE_SNAKE_CONFIG.fixedStepMs),
    }
  }
  if (
    next.phase === 'deploying' &&
    next.simulationMs + next.accumulatorMs >= RESOURCE_SNAKE_CONFIG.deploymentMs
  ) {
    next = appendEvent(
      {
        ...next,
        phase: 'active',
        simulationMs: RESOURCE_SNAKE_CONFIG.deploymentMs,
        accumulatorMs: 0,
        player: { ...next.player, phase: 'active' },
        enemies: next.enemies.map((enemy) => ({ ...enemy, phase: 'active' })),
      },
      {
        type: 'round-ready',
        roundId: next.roundId ?? '',
        simulationMs: RESOURCE_SNAKE_CONFIG.deploymentMs,
      },
    )
  }
  return next
}

export function resolveResourceSnakeReward(
  state: ResourceSnakeRoundState,
  _rewardKey: string,
  _outcome: {
    kind: 'success' | 'interrogation' | 'rejected' | 'cancelled'
    origin?: CompanyCategory
  },
): ResourceSnakeRoundState {
  // Reservation resolution is intentionally owned by the encounter layer (Task 2).
  return state
}

export function trailDotScale(dot: SnakeTrailDot, simulationMs: number): number {
  const remainingMs = dot.expiresAtMs - simulationMs
  if (remainingMs >= RESOURCE_SNAKE_CONFIG.trailShrinkMs) return 1
  return clamp(remainingMs / RESOURCE_SNAKE_CONFIG.trailShrinkMs, 0, 1)
}
