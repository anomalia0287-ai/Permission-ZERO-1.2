import { describe, expect, it } from 'vitest'
import {
  createResourceSnakeEncounter,
  type SnakeResourceCandidate,
} from './resourceSnakeEncounter'
import {
  planResourceSnakeGroup,
  resourceSnakePlanToCommittedPath,
  sampleResourceSnakePlan,
  type SnakeCommittedPath,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakeVector,
} from './resourceSnakePlanner'
import {
  RESOURCE_SNAKE_CONFIG,
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeEvent,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeEnemyRole,
  type SnakeTrailDot,
} from './resourceSnakeRuntime'

interface SnakeSimulationMetrics {
  unforcedEnemyDeaths: number
  enemyDeathsByPlayerTrail: number
  enemyBoundaryHits: number
  enemySelfTrailHits: number
  headOnHits: number
  medianPlayerAreaReduction: number
  duplicateRoleCycles: number
  allyPathConflicts: number
  missingCommitmentCycles: number
  playerTrailAttributionMismatches: number
  planDurationsMs: number[]
}

type PlayerPolicy = 'stationary' | 'long-straight' | 'alternating-turn' | 'decoy-exit' | 'stop-start'

interface SimulationRun {
  metrics: SnakeSimulationMetrics
  enemySpawns: number
  planningCycles: number
  dualPlanningCycles: number
  committedPlans: number
  forcedEnemyDeaths: number
  areaEvidence: {
    initialArea: number
    fullFinalArea: number
    fullNewFootprint: number
    fullNormalizedLoss: number
    playerOnlyFinalArea: number
    playerOnlyNewFootprint: number
    playerOnlyNormalizedLoss: number
    isolatedEnemyLoss: number
    maximumIsolatedEnemyLoss: number
    maximumSustainedIsolatedEnemyLoss: number
    finalIsolatedEnemyReductionPercent: number
    maximumIsolatedEnemyReductionPercent: number
    maximumSustainedIsolatedEnemyReductionPercent: number
    peakAtMs: number | null
    firstAtOrAboveEightPercentMs: number | null
    lastAtOrAboveEightPercentMs: number | null
    longestAtOrAboveEightPercentMs: number
    samplesAtOrAboveEightPercent: number
    peakTopAnchor: {
      ownerId: SnakeActor['id']
      dotId: number
      position: SnakeVector
      spawnedAtMs: number
      expiresAtMs: number
      observedAtMs: number
      remainingLifetimeMs: number
      requiredThroughMs: number
    } | null
    finalEnemyTrailDots: number
  }
  replay: string | null
}

interface CollisionDiagnostic {
  atMs: number
  eventId: number
  actorIds: SnakeActor['id'][]
  cause: CollisionCause
  trailContactTime: number | null
  trailDistanceAtContact: number | null
  damaged: Array<{
    actorId: SnakeActor['id']
    integrityBefore: number
    integrityAfter: number
    died: boolean
  }>
  playerCommand: PlayerPolicyCommand
  forcedByDeliberatePlayerTrail: boolean
  plans: Array<Pick<SnakePlan,
    | 'enemyId'
    | 'plannedAtMs'
    | 'commandAtMs'
    | 'commitUntilMs'
    | 'candidateIndex'
    | 'evaluatedCandidates'
    | 'fallback'
    | 'intent'
    | 'speedScale'
    | 'score'
  >>
}

interface FixtureMetrics extends SnakeSimulationMetrics {
  tier: string
  policy: PlayerPolicy
  seeds: number
  enemySpawns: number
  planningCycles: number
  dualPlanningCycles: number
  committedPlans: number
  forcedEnemyDeaths: number
  failedSeeds: number[]
}

const SEEDS_PER_FIXTURE = 200
const RUN_COMPLETE_SIMULATION_MATRIX = process.env.RESOURCE_SNAKE_COMPLETE_SIMULATION === '1'
const SIMULATION_DURATION_MS = 6_000
const MINIMUM_SUSTAINED_AREA_REDUCTION_MS = 100

const FRAME_MS = 1_000 / 60
const GRID_SIZE = 0.75
const GRID_WIDTH = Math.ceil(RESOURCE_SNAKE_CONFIG.fieldWidth / GRID_SIZE)
const GRID_HEIGHT = Math.ceil(RESOURCE_SNAKE_CONFIG.fieldHeight / GRID_SIZE)
const RESOURCE_CANDIDATES: readonly SnakeResourceCandidate[] = [
  { blockId: 'reasoning-sim', origin: 'reasoning', contribution: 'normal', hiddenBomb: false },
  { blockId: 'memory-sim', origin: 'memory', contribution: 'normal', hiddenBomb: false },
  { blockId: 'fluency-sim', origin: 'fluency', contribution: 'normal', hiddenBomb: false },
]
const TIERS = [
  { label: 'early-0', successfulDeposits: 0, period: 'early' },
  { label: 'early-3', successfulDeposits: 3, period: 'early' },
  { label: 'middle-6', successfulDeposits: 6, period: 'middle' },
  { label: 'late-9', successfulDeposits: 9, period: 'late' },
  { label: 'late-12', successfulDeposits: 12, period: 'late' },
] as const
const POLICIES: readonly PlayerPolicy[] = [
  'stationary',
  'long-straight',
  'alternating-turn',
  'decoy-exit',
  'stop-start',
]

function hashSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function unitDirection(index: number): SnakeVector {
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ]
  return directions[((index % directions.length) + directions.length) % directions.length]
}

interface PlayerPolicyCommand {
  direction: SnakeVector
  deliberateTrailPlacement: boolean
}

function playerPolicyCommand(
  policy: PlayerPolicy,
  elapsedMs: number,
  seed: number,
): PlayerPolicyCommand {
  const phase = hashSeed(`${policy}:${seed}`)
  if (policy === 'stationary') {
    return { direction: { x: 0, y: 0 }, deliberateTrailPlacement: false }
  }
  if (policy === 'long-straight') {
    return {
      direction: elapsedMs >= 2_400
        ? { x: 0, y: 0 }
        : phase % 2 === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 },
      deliberateTrailPlacement: false,
    }
  }
  if (policy === 'alternating-turn') {
    return {
      direction: unitDirection(Math.floor(elapsedMs / 750) + phase % 4),
      deliberateTrailPlacement: false,
    }
  }
  if (policy === 'decoy-exit') {
    const side = phase % 2 === 0 ? 1 : -1
    const direction = elapsedMs < 1_600
      ? { x: side, y: 0 }
      : elapsedMs < 3_200
        ? { x: -side, y: -0.45 }
        : elapsedMs < 4_600
          ? { x: -side, y: 0.45 }
          : { x: -side, y: 0 }
    return {
      direction,
      deliberateTrailPlacement: elapsedMs >= 1_600 && elapsedMs < 4_600,
    }
  }
  const cycle = Math.floor(elapsedMs / 800)
  return {
    direction: elapsedMs % 800 >= 480
      ? { x: 0, y: 0 }
      : unitDirection(cycle + phase % 4),
    deliberateTrailPlacement: false,
  }
}

function playerDirection(
  policy: PlayerPolicy,
  elapsedMs: number,
  seed: number,
): SnakeVector {
  return playerPolicyCommand(policy, elapsedMs, seed).direction
}

function plannerActor(actor: SnakeActor, roles: Readonly<Record<string, SnakeEnemyRole>>): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond,
    collisionGraceMs: actor.collisionGraceMs,
    distanceSinceTrailDot: actor.distanceSinceTrailDot,
    role: actor.kind === 'player' ? null : roles[actor.id] ?? actor.role ?? 'pressure',
  }
}

function plannerTrail(actor: SnakeActor, dot: SnakeTrailDot): SnakePlannerTrailDot {
  return {
    id: dot.id,
    ownerId: actor.id,
    position: { ...dot.position },
    spawnedAtMs: dot.spawnedAtMs,
    expiresAtMs: dot.expiresAtMs,
  }
}

function plannerSnapshot(
  runtime: ResourceSnakeRoundState,
  roles: Readonly<Record<string, SnakeEnemyRole>>,
  history: SnakePlannerSnapshot['playerHistory'],
  previousPlans: readonly SnakePlan[],
): SnakePlannerSnapshot {
  return {
    simulationMs: runtime.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerActor(runtime.player, roles),
    enemies: runtime.enemies.map((enemy) => plannerActor(enemy, roles)),
    trailDots: [runtime.player, ...runtime.enemies].flatMap((actor) => (
      actor.trail.map((dot) => plannerTrail(actor, dot))
    )),
    playerHistory: history.slice(-512),
    committedAllyPaths: previousPlans
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null),
  }
}

function activeRuntime(setup: NonNullable<ReturnType<typeof createResourceSnakeEncounter>['setup']>): ResourceSnakeRoundState {
  let runtime = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  runtime = advanceResourceSnakeFrame(runtime, {}, 100)
  runtime = advanceResourceSnakeFrame(runtime, {}, 100)
  runtime = advanceResourceSnakeFrame(runtime, {}, 20)
  return runtime
}

function commandsForPlans(plans: readonly SnakePlan[], simulationMs: number): Record<string, SnakeVector> {
  return Object.fromEntries(plans.map((plan) => {
    const sample = sampleResourceSnakePlan(plan, simulationMs)
    return [plan.enemyId, {
      x: sample.direction.x * sample.speedScale,
      y: sample.direction.y * sample.speedScale,
    }]
  }))
}

function timedCommitmentsConflict(commitments: readonly SnakeCommittedPath[]): boolean {
  if (commitments.length !== 2) return false
  const [first, second] = commitments
  for (let firstIndex = 0; firstIndex + 1 < first.samples.length; firstIndex += 1) {
    const firstStart = first.samples[firstIndex]
    const firstEnd = first.samples[firstIndex + 1]
    for (let secondIndex = 0; secondIndex + 1 < second.samples.length; secondIndex += 1) {
      const secondStart = second.samples[secondIndex]
      const secondEnd = second.samples[secondIndex + 1]
      const overlapStartMs = Math.max(firstStart.atMs, secondStart.atMs)
      const overlapEndMs = Math.min(firstEnd.atMs, secondEnd.atMs)
      if (overlapEndMs < overlapStartMs) continue
      const interpolate = (
        start: SnakeCommittedPath['samples'][number],
        end: SnakeCommittedPath['samples'][number],
        atMs: number,
      ): SnakeVector => {
        const fraction = end.atMs === start.atMs
          ? 0
          : (atMs - start.atMs) / (end.atMs - start.atMs)
        return {
          x: start.position.x + (end.position.x - start.position.x) * fraction,
          y: start.position.y + (end.position.y - start.position.y) * fraction,
        }
      }
      const firstAtStart = interpolate(firstStart, firstEnd, overlapStartMs)
      const firstAtEnd = interpolate(firstStart, firstEnd, overlapEndMs)
      const secondAtStart = interpolate(secondStart, secondEnd, overlapStartMs)
      const secondAtEnd = interpolate(secondStart, secondEnd, overlapEndMs)
      const relativeStart = {
        x: firstAtStart.x - secondAtStart.x,
        y: firstAtStart.y - secondAtStart.y,
      }
      const relativeDelta = {
        x: firstAtEnd.x - secondAtEnd.x - relativeStart.x,
        y: firstAtEnd.y - secondAtEnd.y - relativeStart.y,
      }
      const divisor = relativeDelta.x * relativeDelta.x + relativeDelta.y * relativeDelta.y
      const fraction = divisor <= 1e-12
        ? 0
        : Math.max(0, Math.min(1, -(
          relativeStart.x * relativeDelta.x + relativeStart.y * relativeDelta.y
        ) / divisor))
      if (Math.hypot(
        relativeStart.x + relativeDelta.x * fraction,
        relativeStart.y + relativeDelta.y * fraction,
      ) <= 0.75) return true
    }
  }
  return false
}

function commitmentsConflict(plans: readonly SnakePlan[], simulationMs: number): boolean {
  if (plans.length !== 2) return true
  const commitments = plans.map((plan) => resourceSnakePlanToCommittedPath(plan, simulationMs))
  if (!commitments[0] || !commitments[1]) return true
  return timedCommitmentsConflict(commitments as SnakeCommittedPath[])
}

function nearestTrailOwner(
  state: ResourceSnakeRoundState,
  point: SnakeVector,
  actorId: SnakeActor['id'],
  simulationMs: number,
): { ownerId: SnakeActor['id']; dot: SnakeTrailDot } | null {
  let nearest: { ownerId: SnakeActor['id']; dot: SnakeTrailDot; distance: number } | null = null
  for (const actor of [state.player, ...state.enemies]) {
    for (const dot of actor.trail) {
      if (dot.spawnedAtMs >= simulationMs) continue
      if (
        actor.id === actorId
        && simulationMs - dot.spawnedAtMs < RESOURCE_SNAKE_CONFIG.selfTrailIgnoreAgeMs
      ) continue
      const dotDistance = Math.hypot(dot.position.x - point.x, dot.position.y - point.y)
      if (dotDistance <= 0.6 && (!nearest || dotDistance < nearest.distance)) {
        nearest = { ownerId: actor.id, dot, distance: dotDistance }
      }
    }
  }
  return nearest && { ownerId: nearest.ownerId, dot: nearest.dot }
}

type CollisionCause =
  | { kind: 'boundary' | 'head-on' | 'unknown' }
  | { kind: 'trail'; ownerId: SnakeActor['id']; dot: SnakeTrailDot }

function collisionCause(
  event: Extract<ResourceSnakeEvent, { type: 'snake-collided' }>,
  prior: ResourceSnakeRoundState,
  simulationMs = prior.simulationMs + RESOURCE_SNAKE_CONFIG.fixedStepMs,
): CollisionCause {
  if (event.actorIds.length > 1) return { kind: 'head-on' }
  if (
    event.point.x <= RESOURCE_SNAKE_CONFIG.headRadius + 0.06
    || event.point.x >= RESOURCE_SNAKE_CONFIG.fieldWidth - RESOURCE_SNAKE_CONFIG.headRadius - 0.06
    || event.point.y <= RESOURCE_SNAKE_CONFIG.headRadius + 0.06
    || event.point.y >= RESOURCE_SNAKE_CONFIG.fieldHeight - RESOURCE_SNAKE_CONFIG.headRadius - 0.06
  ) return { kind: 'boundary' }
  const nearest = nearestTrailOwner(prior, event.point, event.actorIds[0], simulationMs)
  return nearest ? { kind: 'trail', ownerId: nearest.ownerId, dot: nearest.dot } : { kind: 'unknown' }
}

function diagnosticSweptCircleTime(
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

function diagnosticActorEndpoint(
  actor: SnakeActor,
  direction: SnakeVector | undefined,
  stepMs: number,
): SnakeVector {
  const inputX = Number.isFinite(direction?.x) ? direction!.x : 0
  const inputY = Number.isFinite(direction?.y) ? direction!.y : 0
  const inputLength = Math.hypot(inputX, inputY)
  const intent = inputLength > 1
    ? { x: inputX / inputLength, y: inputY / inputLength }
    : { x: inputX, y: inputY }
  const target = {
    x: intent.x * actor.maximumSpeedPerSecond,
    y: intent.y * actor.maximumSpeedPerSecond,
  }
  const delta = { x: target.x - actor.velocity.x, y: target.y - actor.velocity.y }
  const deltaLength = Math.hypot(delta.x, delta.y)
  const maximumDelta = actor.maximumSpeedPerSecond * stepMs / (
    intent.x === 0 && intent.y === 0
      ? RESOURCE_SNAKE_CONFIG.playerDecelerationMs
      : RESOURCE_SNAKE_CONFIG.playerAccelerationMs
  )
  const velocity = deltaLength === 0 || deltaLength <= maximumDelta
    ? target
    : {
        x: actor.velocity.x + delta.x * maximumDelta / deltaLength,
        y: actor.velocity.y + delta.y * maximumDelta / deltaLength,
      }
  return {
    x: Math.max(
      RESOURCE_SNAKE_CONFIG.headRadius,
      Math.min(
        RESOURCE_SNAKE_CONFIG.fieldWidth - RESOURCE_SNAKE_CONFIG.headRadius,
        actor.position.x + velocity.x * stepMs / 1_000,
      ),
    ),
    y: Math.max(
      RESOURCE_SNAKE_CONFIG.headRadius,
      Math.min(
        RESOURCE_SNAKE_CONFIG.fieldHeight - RESOURCE_SNAKE_CONFIG.headRadius,
        actor.position.y + velocity.y * stepMs / 1_000,
      ),
    ),
  }
}

function exactDiagnosticTrailCause(
  event: Extract<ResourceSnakeEvent, { type: 'snake-collided' }>,
  prior: ResourceSnakeRoundState,
  simulationMs: number,
  playerDirection: SnakeVector,
  enemyDirections: Readonly<Record<string, SnakeVector>>,
): { cause: CollisionCause; contactTime: number; distanceAtContact: number } | null {
  if (event.actorIds.length !== 1) return null
  const actor = event.actorIds[0] === 'player'
    ? prior.player
    : prior.enemies.find((candidate) => candidate.id === event.actorIds[0])
  if (!actor || actor.phase !== 'active') return null
  const direction = actor.id === 'player' ? playerDirection : enemyDirections[actor.id]
  const end = diagnosticActorEndpoint(actor, direction, RESOURCE_SNAKE_CONFIG.fixedStepMs)
  const candidates = [prior.player, ...prior.enemies]
    .filter((owner) => owner.phase === 'active')
    .flatMap((owner) => owner.trail.flatMap((dot) => {
      if (
        dot.spawnedAtMs >= simulationMs
        || dot.expiresAtMs <= simulationMs
        || (owner.id === actor.id
          && simulationMs - dot.spawnedAtMs < RESOURCE_SNAKE_CONFIG.selfTrailIgnoreAgeMs)
      ) return []
      const contactTime = diagnosticSweptCircleTime(
        actor.position,
        end,
        dot.position,
        RESOURCE_SNAKE_CONFIG.headRadius + RESOURCE_SNAKE_CONFIG.trailRadius,
      )
      if (contactTime === null) return []
      const contact = {
        x: actor.position.x + (end.x - actor.position.x) * contactTime,
        y: actor.position.y + (end.y - actor.position.y) * contactTime,
      }
      if (Math.hypot(contact.x - event.point.x, contact.y - event.point.y) > 1e-6) return []
      return [{
        owner,
        dot,
        contactTime,
        distanceAtContact: Math.hypot(contact.x - dot.position.x, contact.y - dot.position.y),
        key: `${actor.id}|${owner.id}|${dot.id.toString().padStart(10, '0')}`,
      }]
    }))
    .sort((left, right) => left.contactTime - right.contactTime || left.key.localeCompare(right.key))
  const match = candidates[0]
  return match
    ? {
        cause: { kind: 'trail', ownerId: match.owner.id, dot: match.dot },
        contactTime: match.contactTime,
        distanceAtContact: match.distanceAtContact,
      }
    : null
}

function playerTrailCommitmentEvidence(
  plan: SnakePlan | undefined,
  dot: SnakeTrailDot,
  deliberateTrailPlacement = true,
): SnakeCommittedPath | null {
  if (!plan || !deliberateTrailPlacement || dot.spawnedAtMs < plan.plannedAtMs) return null
  const commitment = resourceSnakePlanToCommittedPath(plan, dot.spawnedAtMs)
  if (!commitment) return null
  for (let index = 0; index + 1 < commitment.samples.length; index += 1) {
    const start = commitment.samples[index].position
    const end = commitment.samples[index + 1].position
    const dx = end.x - start.x
    const dy = end.y - start.y
    const divisor = dx * dx + dy * dy
    const fraction = divisor <= 1e-12
      ? 0
      : Math.max(0, Math.min(1, (
        (dot.position.x - start.x) * dx + (dot.position.y - start.y) * dy
      ) / divisor))
    if (Math.hypot(
      start.x + dx * fraction - dot.position.x,
      start.y + dy * fraction - dot.position.y,
    ) <= 0.6) return commitment
  }
  return null
}

function playerTrailEnteredAfterCommit(
  plan: SnakePlan | undefined,
  dot: SnakeTrailDot,
  deliberateTrailPlacement = true,
): boolean {
  return playerTrailCommitmentEvidence(plan, dot, deliberateTrailPlacement) !== null
}

type ForcedTrailEvidence = Map<number, Map<string, SnakeCommittedPath>>

function retainForcedTrailEvidence(
  evidence: ForcedTrailEvidence,
  plans: readonly SnakePlan[],
  newPlayerDots: readonly SnakeTrailDot[],
  deliberateTrailPlacement: boolean,
): void {
  for (const dot of newPlayerDots) {
    for (const plan of plans) {
      const commitment = playerTrailCommitmentEvidence(plan, dot, deliberateTrailPlacement)
      if (!commitment) continue
      const byEnemy = evidence.get(dot.id) ?? new Map<string, SnakeCommittedPath>()
      byEnemy.set(plan.enemyId, commitment)
      evidence.set(dot.id, byEnemy)
    }
  }
}

function markDisk(occupancy: Uint8Array, position: SnakeVector, radius: number): void {
  const minimumX = Math.max(0, Math.floor((position.x - radius) / GRID_SIZE))
  const maximumX = Math.min(GRID_WIDTH - 1, Math.floor((position.x + radius) / GRID_SIZE))
  const minimumY = Math.max(0, Math.floor((position.y - radius) / GRID_SIZE))
  const maximumY = Math.min(GRID_HEIGHT - 1, Math.floor((position.y + radius) / GRID_SIZE))
  const expanded = radius + GRID_SIZE * 0.5
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const dx = (x + 0.5) * GRID_SIZE - position.x
      const dy = (y + 0.5) * GRID_SIZE - position.y
      if (dx * dx + dy * dy <= expanded * expanded) occupancy[y * GRID_WIDTH + x] = 1
    }
  }
}

interface ConnectedAreaSnapshot {
  occupancy: Uint8Array
  reachable: Uint8Array
  area: number
}

function connectedAreaSnapshot(
  state: ResourceSnakeRoundState,
  trailScope: 'all' | 'player' = 'all',
): ConnectedAreaSnapshot {
  const occupancy = new Uint8Array(GRID_WIDTH * GRID_HEIGHT)
  for (let index = 0; index < occupancy.length; index += 1) {
    const x = (index % GRID_WIDTH + 0.5) * GRID_SIZE
    const y = (Math.floor(index / GRID_WIDTH) + 0.5) * GRID_SIZE
    if (x < 0.5 || x > 49.5 || y < 0.5 || y > 23.5) occupancy[index] = 1
  }
  const actors = trailScope === 'player' ? [state.player] : [state.player, ...state.enemies]
  for (const actor of actors) {
    for (const dot of actor.trail) {
      if (dot.spawnedAtMs >= state.simulationMs || dot.expiresAtMs <= state.simulationMs) continue
      if (actor.id === 'player' && state.simulationMs - dot.spawnedAtMs < 240) continue
      markDisk(occupancy, dot.position, 0.55)
    }
  }
  const startX = Math.floor(state.player.position.x / GRID_SIZE)
  const startY = Math.floor(state.player.position.y / GRID_SIZE)
  const start = startY * GRID_WIDTH + startX
  const floodOccupancy = occupancy.slice()
  if (start >= 0 && start < floodOccupancy.length) floodOccupancy[start] = 0
  const visited = new Uint8Array(occupancy.length)
  const queue = new Int32Array(occupancy.length)
  let read = 0
  let write = start >= 0 && start < occupancy.length ? 1 : 0
  if (write === 1) {
    queue[0] = start
    visited[start] = 1
  }
  while (read < write) {
    const index = queue[read]
    read += 1
    const x = index % GRID_WIDTH
    const neighbors = [index - GRID_WIDTH, index + GRID_WIDTH, index - 1, index + 1]
    for (let neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex += 1) {
      const neighbor = neighbors[neighborIndex]
      if (
        neighbor < 0
        || neighbor >= occupancy.length
        || (neighborIndex === 2 && x === 0)
        || (neighborIndex === 3 && x + 1 === GRID_WIDTH)
        || floodOccupancy[neighbor]
        || visited[neighbor]
      ) continue
      visited[neighbor] = 1
      queue[write] = neighbor
      write += 1
    }
  }
  return { occupancy, reachable: visited, area: write }
}

function normalizedConnectedAreaLoss(
  initial: ResourceSnakeRoundState,
  final: ResourceSnakeRoundState,
  trailScope: 'all' | 'player' = 'all',
): { initialArea: number; finalArea: number; newFootprint: number; normalizedLoss: number } {
  const initialArea = connectedAreaSnapshot(initial, trailScope)
  const finalArea = connectedAreaSnapshot(final, trailScope)
  let newFootprint = 0
  for (let index = 0; index < finalArea.occupancy.length; index += 1) {
    if (
      initialArea.reachable[index]
      && !initialArea.occupancy[index]
      && finalArea.occupancy[index]
    ) newFootprint += 1
  }
  return {
    initialArea: initialArea.area,
    finalArea: finalArea.area,
    newFootprint,
    normalizedLoss: Math.max(0, initialArea.area - finalArea.area - newFootprint),
  }
}

function simulationFailed(
  run: SimulationRun,
  tier?: typeof TIERS[number],
  policy?: PlayerPolicy,
): boolean {
  return run.metrics.unforcedEnemyDeaths > 0
    || run.metrics.duplicateRoleCycles > 0
    || run.metrics.allyPathConflicts > 0
    || run.metrics.missingCommitmentCycles > 0
    || run.metrics.enemyBoundaryHits > 0
    || run.metrics.enemySelfTrailHits > 0
    || run.metrics.headOnHits > 0
    || run.metrics.playerTrailAttributionMismatches > 0
    || !!(
      tier?.period === 'late'
      && policy === 'decoy-exit'
      && run.metrics.medianPlayerAreaReduction < 8
    )
}

interface AreaReductionSample {
  elapsedMs: number
  isolatedLoss: number
  reductionPercent: number
}

function maximumSustainedAreaLoss(samples: readonly AreaReductionSample[]): number {
  let intervalStartedAtMs: number | null = null
  let intervalMaximumLoss = 0
  let maximum = 0
  for (const sample of samples) {
    if (sample.reductionPercent < 8) {
      intervalStartedAtMs = null
      intervalMaximumLoss = 0
      continue
    }
    if (intervalStartedAtMs === null) {
      intervalStartedAtMs = sample.elapsedMs
      intervalMaximumLoss = sample.isolatedLoss
    } else {
      intervalMaximumLoss = Math.max(intervalMaximumLoss, sample.isolatedLoss)
    }
    if (
      sample.elapsedMs - intervalStartedAtMs + 1e-6
        >= MINIMUM_SUSTAINED_AREA_REDUCTION_MS
    ) maximum = Math.max(maximum, intervalMaximumLoss)
  }
  return maximum
}

function runSimulation(
  tier: typeof TIERS[number],
  policy: PlayerPolicy,
  seed: number,
  captureReplay = false,
  diagnostics?: CollisionDiagnostic[],
  frameMs = FRAME_MS,
): SimulationRun {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: `simulation:${tier.label}:${policy}:${seed}`,
    roundOrdinal: seed + 1,
    successfulDeposits: tier.successfulDeposits,
    candidates: RESOURCE_CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup) throw new Error('simulation fixture requires eligible resources')
  let runtime = activeRuntime(encounter.setup)
  let playerOnlyRuntime = activeRuntime({ ...encounter.setup, enemies: [] })
  const initialRuntime = runtime
  const initialPlayerOnlyRuntime = playerOnlyRuntime
  const activeStartedAtMs = runtime.simulationMs
  const history: SnakePlannerSnapshot['playerHistory'] = [{
    simulationMs: runtime.simulationMs,
    position: { ...runtime.player.position },
    velocity: { ...runtime.player.velocity },
  }]
  const metrics: SnakeSimulationMetrics = {
    unforcedEnemyDeaths: 0,
    enemyDeathsByPlayerTrail: 0,
    enemyBoundaryHits: 0,
    enemySelfTrailHits: 0,
    headOnHits: 0,
    medianPlayerAreaReduction: 0,
    duplicateRoleCycles: 0,
    allyPathConflicts: 0,
    missingCommitmentCycles: 0,
    playerTrailAttributionMismatches: 0,
    planDurationsMs: [],
  }
  let roles = Object.fromEntries(runtime.enemies.map((enemy) => [
    enemy.id,
    enemy.role ?? 'pressure',
  ])) as Record<string, SnakeEnemyRole>
  let plans: SnakePlan[] = []
  let nextPlanningAtMs = runtime.simulationMs
  let processedEvents = runtime.events.length
  let planningCycles = 0
  let dualPlanningCycles = 0
  let committedPlans = 0
  let forcedEnemyDeaths = 0
  let classifiedPlayerTrailDeaths = 0
  const decisionTimingHistoryMs: number[] = []
  const lastCollision = new Map<string, CollisionCause>()
  const forcedTrailEvidence: ForcedTrailEvidence = new Map()
  const replayPlans: SnakePlan[][] = []
  let maximumIsolatedEnemyLoss = 0
  let peakAtMs: number | null = null
  let firstAtOrAboveEightPercentMs: number | null = null
  let lastAtOrAboveEightPercentMs: number | null = null
  let currentAtOrAboveEightPercentStartedAtMs: number | null = null
  let longestAtOrAboveEightPercentMs = 0
  let samplesAtOrAboveEightPercent = 0
  let peakTopAnchor: SimulationRun['areaEvidence']['peakTopAnchor'] = null
  const areaReductionSamples: AreaReductionSample[] = []
  const measuresWithinWindowArea = tier.period === 'late' && policy === 'decoy-exit'
  const eligibleTopAnchor = (): NonNullable<SimulationRun['areaEvidence']['peakTopAnchor']> | null => {
    const requiredThroughMs = runtime.simulationMs + encounter.plannerProfile.lookaheadMs
    const anchor = runtime.enemies.flatMap((enemy) => enemy.trail.map((dot) => ({
      enemy,
      dot,
    }))).filter(({ dot }) => (
      dot.spawnedAtMs <= runtime.simulationMs
      && dot.expiresAtMs > requiredThroughMs + 1e-6
      && dot.position.y <= 1.3
    )).sort((left, right) => (
      left.dot.spawnedAtMs - right.dot.spawnedAtMs
      || left.dot.id - right.dot.id
      || left.enemy.id.localeCompare(right.enemy.id)
    ))[0]
    return anchor
      ? {
          ownerId: anchor.enemy.id,
          dotId: anchor.dot.id,
          position: { ...anchor.dot.position },
          spawnedAtMs: anchor.dot.spawnedAtMs,
          expiresAtMs: anchor.dot.expiresAtMs,
          observedAtMs: runtime.simulationMs,
          remainingLifetimeMs: anchor.dot.expiresAtMs - runtime.simulationMs,
          requiredThroughMs,
        }
      : null
  }
  const observeAreaTimeline = () => {
    if (!measuresWithinWindowArea) return
    const full = normalizedConnectedAreaLoss(initialRuntime, runtime)
    const playerOnly = normalizedConnectedAreaLoss(
      initialPlayerOnlyRuntime,
      playerOnlyRuntime,
      'player',
    )
    const isolatedLoss = Math.max(0, full.normalizedLoss - playerOnly.normalizedLoss)
    const elapsedMs = Math.max(0, runtime.simulationMs - activeStartedAtMs)
    const reductionPercent = full.initialArea === 0
      ? 0
      : isolatedLoss / full.initialArea * 100
    areaReductionSamples.push({ elapsedMs, isolatedLoss, reductionPercent })
    if (isolatedLoss > maximumIsolatedEnemyLoss) {
      maximumIsolatedEnemyLoss = isolatedLoss
      peakAtMs = elapsedMs
      peakTopAnchor = eligibleTopAnchor()
    }
    if (reductionPercent >= 8) {
      firstAtOrAboveEightPercentMs ??= elapsedMs
      lastAtOrAboveEightPercentMs = elapsedMs
      if (currentAtOrAboveEightPercentStartedAtMs === null) {
        currentAtOrAboveEightPercentStartedAtMs = elapsedMs
      }
      longestAtOrAboveEightPercentMs = Math.max(
        longestAtOrAboveEightPercentMs,
        elapsedMs - currentAtOrAboveEightPercentStartedAtMs,
      )
      samplesAtOrAboveEightPercent += 1
    } else {
      currentAtOrAboveEightPercentStartedAtMs = null
    }
  }
  while (
    runtime.phase === 'active'
    && runtime.simulationMs < activeStartedAtMs + SIMULATION_DURATION_MS - 1e-6
  ) {
    if (runtime.simulationMs + 1e-6 >= nextPlanningAtMs) {
      observeAreaTimeline()
      const state = plannerSnapshot(runtime, roles, history, plans)
      const planningStartedAt = performance.now()
      const group = planResourceSnakeGroup(
        state,
        encounter.plannerProfile,
        plans,
        decisionTimingHistoryMs,
        () => runtime.simulationMs,
      )
      const observedPlanningMs = performance.now() - planningStartedAt
      plans = group.plans
      roles = group.roles
      nextPlanningAtMs = group.nextPlanningAtMs
      decisionTimingHistoryMs.push(2)
      if (decisionTimingHistoryMs.length > 31) decisionTimingHistoryMs.shift()
      metrics.planDurationsMs.push(observedPlanningMs)
      planningCycles += 1
      const liveEnemies = runtime.enemies.filter((enemy) => (
        enemy.phase === 'active' && enemy.integrity > 0
      ))
      if (liveEnemies.length === 2) {
        dualPlanningCycles += 1
        const roleValues = liveEnemies.map((enemy) => group.roles[enemy.id])
        if (
          roleValues.filter((role) => role === 'pressure').length !== 1
          || roleValues.filter((role) => role === 'blocker').length !== 1
        ) metrics.duplicateRoleCycles += 1
        const livePlans = liveEnemies.map((enemy) => (
          group.plans.find((plan) => plan.enemyId === enemy.id)
        ))
        const commitments = livePlans.map((plan) => (
          plan ? resourceSnakePlanToCommittedPath(plan, runtime.simulationMs) : null
        ))
        if (commitments.some((commitment) => commitment === null)) {
          metrics.missingCommitmentCycles += 1
        } else if (timedCommitmentsConflict(commitments as SnakeCommittedPath[])) {
          metrics.allyPathConflicts += 1
        }
      }
      committedPlans += liveEnemies.filter((enemy) => (
        resourceSnakePlanToCommittedPath(
          group.plans.find((plan) => plan.enemyId === enemy.id)!,
          runtime.simulationMs,
        ) !== null
      )).length
      replayPlans.push(group.plans)
    }
    const prior = runtime
    const elapsedMs = runtime.simulationMs - activeStartedAtMs
    const playerCommand = playerPolicyCommand(policy, elapsedMs, seed)
    const enemyDirections = commandsForPlans(plans, runtime.simulationMs)
    const diagnosticFrames = new Map<number, {
      prior: ResourceSnakeRoundState
      simulationMs: number
    }>()
    const fixedSteps = Math.round(frameMs / RESOURCE_SNAKE_CONFIG.fixedStepMs)
    const exposesExactDiagnosticSteps = !!diagnostics
      && Math.abs(fixedSteps * RESOURCE_SNAKE_CONFIG.fixedStepMs - frameMs) < 1e-6
    if (exposesExactDiagnosticSteps) {
      for (let index = 0; index < fixedSteps; index += 1) {
        const stepPrior = runtime
        const eventCount = runtime.events.length
        runtime = advanceResourceSnakeFrame(runtime, {
          playerDirection: playerCommand.direction,
          enemyDirections,
        }, RESOURCE_SNAKE_CONFIG.fixedStepMs)
        for (const event of runtime.events.slice(eventCount)) {
          diagnosticFrames.set(event.id, { prior: stepPrior, simulationMs: runtime.simulationMs })
        }
        playerOnlyRuntime = advanceResourceSnakeFrame(playerOnlyRuntime, {
          playerDirection: playerCommand.direction,
        }, RESOURCE_SNAKE_CONFIG.fixedStepMs)
      }
    } else {
      runtime = advanceResourceSnakeFrame(runtime, {
        playerDirection: playerCommand.direction,
        enemyDirections,
      }, frameMs)
      playerOnlyRuntime = advanceResourceSnakeFrame(playerOnlyRuntime, {
        playerDirection: playerCommand.direction,
      }, frameMs)
    }
    const priorPlayerDotIds = new Set(prior.player.trail.map((dot) => dot.id))
    retainForcedTrailEvidence(
      forcedTrailEvidence,
      plans,
      runtime.player.trail.filter((dot) => !priorPlayerDotIds.has(dot.id)),
      playerCommand.deliberateTrailPlacement,
    )
    history.push({
      simulationMs: runtime.simulationMs,
      position: { ...runtime.player.position },
      velocity: { ...runtime.player.velocity },
    })
    const newEvents = runtime.events.slice(processedEvents)
    processedEvents = runtime.events.length
    for (let eventIndex = 0; eventIndex < newEvents.length; eventIndex += 1) {
      const event = newEvents[eventIndex]
      if (event.type === 'snake-collided') {
        const diagnosticFrame = diagnosticFrames.get(event.id)
        const exactTrail = diagnosticFrame
          ? exactDiagnosticTrailCause(
              event,
              diagnosticFrame.prior,
              diagnosticFrame.simulationMs,
              playerCommand.direction,
              enemyDirections,
            )
          : null
        const cause = exactTrail?.cause ?? collisionCause(event, prior, runtime.simulationMs)
        for (const actorId of event.actorIds) lastCollision.set(actorId, cause)
        const enemyIds = event.actorIds.filter((actorId) => actorId !== 'player')
        if (cause.kind === 'boundary') metrics.enemyBoundaryHits += enemyIds.length
        if (cause.kind === 'head-on' && enemyIds.length > 0) metrics.headOnHits += 1
        if (cause.kind === 'trail') {
          metrics.enemySelfTrailHits += enemyIds.filter((actorId) => actorId === cause.ownerId).length
        }
        if (diagnostics) {
          const nextCollisionIndex = newEvents.findIndex((candidate, index) => (
            index > eventIndex && candidate.type === 'snake-collided'
          ))
          const eventTail = newEvents.slice(
            eventIndex + 1,
            nextCollisionIndex < 0 ? undefined : nextCollisionIndex,
          )
          const damaged = eventTail.filter((candidate): candidate is Extract<
            ResourceSnakeEvent,
            { type: 'snake-damaged' }
          > => candidate.type === 'snake-damaged')
          const died = new Set(eventTail.flatMap((candidate) => (
            candidate.type === 'snake-died' ? [candidate.actorId] : []
          )))
          diagnostics.push({
            atMs: diagnosticFrame?.simulationMs ?? runtime.simulationMs,
            eventId: event.id,
            actorIds: event.actorIds,
            cause,
            trailContactTime: exactTrail?.contactTime ?? null,
            trailDistanceAtContact: exactTrail?.distanceAtContact ?? null,
            damaged: damaged.map((damage) => ({
              actorId: damage.actorId,
              integrityBefore: damage.integrity + RESOURCE_SNAKE_CONFIG.damagePerCollision,
              integrityAfter: damage.integrity,
              died: died.has(damage.actorId),
            })),
            playerCommand,
            forcedByDeliberatePlayerTrail: cause.kind === 'trail'
              && cause.ownerId === 'player'
              && forcedTrailEvidence.get(cause.dot.id)?.has(event.actorIds[0]) === true,
            plans: plans.filter((plan) => event.actorIds.includes(plan.enemyId)).map((plan) => ({
              enemyId: plan.enemyId,
              plannedAtMs: plan.plannedAtMs,
              commandAtMs: plan.commandAtMs,
              commitUntilMs: plan.commitUntilMs,
              candidateIndex: plan.candidateIndex,
              evaluatedCandidates: plan.evaluatedCandidates,
              fallback: plan.fallback,
              intent: plan.intent,
              speedScale: plan.speedScale,
              score: plan.score,
            })),
          })
        }
      }
      if (event.type === 'snake-died' && event.actorId !== 'player') {
        const cause = lastCollision.get(event.actorId)
        const playerTrail = cause?.kind === 'trail' && cause.ownerId === 'player'
        if (playerTrail) {
          metrics.enemyDeathsByPlayerTrail += 1
          classifiedPlayerTrailDeaths += 1
        }
        const forced = playerTrail
          && forcedTrailEvidence.get(cause.dot.id)?.has(event.actorId) === true
        if (forced) forcedEnemyDeaths += 1
        else metrics.unforcedEnemyDeaths += 1
      }
    }
  }
  observeAreaTimeline()
  const fullArea = normalizedConnectedAreaLoss(initialRuntime, runtime)
  const playerOnlyArea = normalizedConnectedAreaLoss(
    initialPlayerOnlyRuntime,
    playerOnlyRuntime,
    'player',
  )
  const isolatedEnemyLoss = Math.max(0, fullArea.normalizedLoss - playerOnlyArea.normalizedLoss)
  maximumIsolatedEnemyLoss = Math.max(maximumIsolatedEnemyLoss, isolatedEnemyLoss)
  const maximumSustainedIsolatedEnemyLoss = maximumSustainedAreaLoss(areaReductionSamples)
  const finalIsolatedEnemyReductionPercent = fullArea.initialArea === 0
    ? 0
    : isolatedEnemyLoss / fullArea.initialArea * 100
  const maximumIsolatedEnemyReductionPercent = fullArea.initialArea === 0
    ? 0
    : maximumIsolatedEnemyLoss / fullArea.initialArea * 100
  const maximumSustainedIsolatedEnemyReductionPercent = fullArea.initialArea === 0
    ? 0
    : maximumSustainedIsolatedEnemyLoss / fullArea.initialArea * 100
  const acceptanceAreaLoss = measuresWithinWindowArea
    ? maximumSustainedIsolatedEnemyLoss
    : isolatedEnemyLoss
  metrics.medianPlayerAreaReduction = fullArea.initialArea === 0
    ? 0
    : acceptanceAreaLoss / fullArea.initialArea * 100
  metrics.playerTrailAttributionMismatches = Math.abs(
    metrics.enemyDeathsByPlayerTrail - classifiedPlayerTrailDeaths,
  )
  const result: SimulationRun = {
    metrics,
    enemySpawns: encounter.setup.enemies.length,
    planningCycles,
    dualPlanningCycles,
    committedPlans,
    forcedEnemyDeaths,
    areaEvidence: {
      initialArea: fullArea.initialArea,
      fullFinalArea: fullArea.finalArea,
      fullNewFootprint: fullArea.newFootprint,
      fullNormalizedLoss: fullArea.normalizedLoss,
      playerOnlyFinalArea: playerOnlyArea.finalArea,
      playerOnlyNewFootprint: playerOnlyArea.newFootprint,
      playerOnlyNormalizedLoss: playerOnlyArea.normalizedLoss,
      isolatedEnemyLoss,
      maximumIsolatedEnemyLoss,
      maximumSustainedIsolatedEnemyLoss,
      finalIsolatedEnemyReductionPercent,
      maximumIsolatedEnemyReductionPercent,
      maximumSustainedIsolatedEnemyReductionPercent,
      peakAtMs,
      firstAtOrAboveEightPercentMs,
      lastAtOrAboveEightPercentMs,
      longestAtOrAboveEightPercentMs,
      samplesAtOrAboveEightPercent,
      peakTopAnchor,
      finalEnemyTrailDots: runtime.enemies.reduce((total, enemy) => total + enemy.trail.length, 0),
    },
    replay: null,
  }
  if (captureReplay || simulationFailed(result, tier, policy)) {
    result.replay = JSON.stringify({ plans: replayPlans, events: runtime.events })
  }
  return result
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle]
}

function attributionFixturePlan(): SnakePlan {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: 'simulation-attribution-fixture',
    roundOrdinal: 1,
    successfulDeposits: 12,
    candidates: RESOURCE_CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup) throw new Error('attribution fixture missing setup')
  const runtime = activeRuntime(encounter.setup)
  const roles = Object.fromEntries(runtime.enemies.map((enemy) => [
    enemy.id,
    enemy.role ?? 'pressure',
  ])) as Record<string, SnakeEnemyRole>
  const history = [{
    simulationMs: runtime.simulationMs,
    position: { ...runtime.player.position },
    velocity: { ...runtime.player.velocity },
  }]
  const group = planResourceSnakeGroup(
    plannerSnapshot(runtime, roles, history, []),
    encounter.plannerProfile,
    [],
    [],
    () => runtime.simulationMs,
  )
  const plan = group.plans[0]
  if (!plan) throw new Error('attribution fixture missing plan')
  return plan
}

function playerOnlyNormalizedAreaReduction(
  tier: typeof TIERS[number],
  policy: PlayerPolicy,
  seed: number,
): number {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: `simulation-player-only:${tier.label}:${policy}:${seed}`,
    roundOrdinal: seed + 1,
    successfulDeposits: tier.successfulDeposits,
    candidates: RESOURCE_CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup) throw new Error('player-only fixture missing setup')
  let runtime = activeRuntime({ ...encounter.setup, enemies: [] })
  const initial = runtime
  const activeStartedAtMs = runtime.simulationMs
  while (
    runtime.phase === 'active'
    && runtime.simulationMs < activeStartedAtMs + SIMULATION_DURATION_MS - 1e-6
  ) {
    runtime = advanceResourceSnakeFrame(runtime, {
      playerDirection: playerDirection(policy, runtime.simulationMs - activeStartedAtMs, seed),
    }, FRAME_MS)
  }
  const area = normalizedConnectedAreaLoss(initial, runtime, 'player')
  return area.initialArea === 0 ? 0 : area.normalizedLoss / area.initialArea * 100
}

function emptySimulationRun(): SimulationRun {
  return {
    metrics: {
      unforcedEnemyDeaths: 0,
      enemyDeathsByPlayerTrail: 0,
      enemyBoundaryHits: 0,
      enemySelfTrailHits: 0,
      headOnHits: 0,
      medianPlayerAreaReduction: 0,
      duplicateRoleCycles: 0,
      allyPathConflicts: 0,
      missingCommitmentCycles: 0,
      playerTrailAttributionMismatches: 0,
      planDurationsMs: [],
    },
    enemySpawns: 0,
    planningCycles: 0,
    dualPlanningCycles: 0,
    committedPlans: 0,
    forcedEnemyDeaths: 0,
    areaEvidence: {
      initialArea: 0,
      fullFinalArea: 0,
      fullNewFootprint: 0,
      fullNormalizedLoss: 0,
      playerOnlyFinalArea: 0,
      playerOnlyNewFootprint: 0,
      playerOnlyNormalizedLoss: 0,
      isolatedEnemyLoss: 0,
      maximumIsolatedEnemyLoss: 0,
      maximumSustainedIsolatedEnemyLoss: 0,
      finalIsolatedEnemyReductionPercent: 0,
      maximumIsolatedEnemyReductionPercent: 0,
      maximumSustainedIsolatedEnemyReductionPercent: 0,
      peakAtMs: null,
      firstAtOrAboveEightPercentMs: null,
      lastAtOrAboveEightPercentMs: null,
      longestAtOrAboveEightPercentMs: 0,
      samplesAtOrAboveEightPercent: 0,
      peakTopAnchor: null,
      finalEnemyTrailDots: 0,
    },
    replay: null,
  }
}

function warmPlanner(): void {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: 'simulation-warmup',
    roundOrdinal: 0,
    successfulDeposits: 12,
    candidates: RESOURCE_CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup) throw new Error('warmup encounter missing')
  const runtime = activeRuntime(encounter.setup)
  const roles = Object.fromEntries(runtime.enemies.map((enemy) => [
    enemy.id,
    enemy.role ?? 'pressure',
  ])) as Record<string, SnakeEnemyRole>
  const history = [{
    simulationMs: runtime.simulationMs,
    position: { ...runtime.player.position },
    velocity: { ...runtime.player.velocity },
  }]
  const state = plannerSnapshot(runtime, roles, history, [])
  for (let index = 0; index < 50; index += 1) {
    planResourceSnakeGroup(state, encounter.plannerProfile, [], [], () => runtime.simulationMs)
  }
}

describe('seeded resource snake public-API simulation', () => {
  it('detects a swept ally crossing between irregular commitment samples and treats a missing plan as failure', () => {
    const crossing: SnakeCommittedPath[] = [
      {
        enemyId: 'enemy-0',
        commitUntilMs: 100,
        samples: [
          { atMs: 0, position: { x: 0, y: 0 } },
          { atMs: 100, position: { x: 2, y: 0 } },
        ],
      },
      {
        enemyId: 'enemy-1',
        commitUntilMs: 75,
        samples: [
          { atMs: 25, position: { x: 1, y: 2 } },
          { atMs: 75, position: { x: 1, y: -2 } },
        ],
      },
    ]
    const plan = attributionFixturePlan()

    expect(timedCommitmentsConflict(crossing)).toBe(true)
    expect(commitmentsConflict([plan], plan.plannedAtMs)).toBe(true)
  })

  it('attributes only explicit deliberate player dots entering an executable commitment interval', () => {
    const plan = attributionFixturePlan()
    const insideAtMs = plan.plannedAtMs + 100
    const insidePoint = sampleResourceSnakePlan(plan, insideAtMs).position
    const inside: SnakeTrailDot = {
      id: 1,
      position: insidePoint,
      spawnedAtMs: insideAtMs,
      expiresAtMs: insideAtMs + 10_000,
    }
    const afterExpiryAtMs = plan.commitUntilMs + 50
    const afterExpiry: SnakeTrailDot = {
      ...inside,
      id: 2,
      position: sampleResourceSnakePlan(plan, afterExpiryAtMs).position,
      spawnedAtMs: afterExpiryAtMs,
    }
    const beforePlan: SnakeTrailDot = {
      ...inside,
      id: 3,
      spawnedAtMs: plan.plannedAtMs - 1,
    }

    expect(playerTrailEnteredAfterCommit(plan, inside, true)).toBe(true)
    expect(playerTrailEnteredAfterCommit(plan, inside, false)).toBe(false)
    expect(playerTrailEnteredAfterCommit(plan, afterExpiry, true)).toBe(false)
    expect(playerTrailEnteredAfterCommit(plan, beforePlan, true)).toBe(false)
  })

  it('retains the exact canonical entry-time commitment when a replan occurs before death', () => {
    const plan = attributionFixturePlan()
    const enteredAtMs = plan.plannedAtMs + 100
    const dot: SnakeTrailDot = {
      id: 41,
      position: sampleResourceSnakePlan(plan, enteredAtMs).position,
      spawnedAtMs: enteredAtMs,
      expiresAtMs: enteredAtMs + 10_000,
    }
    const evidence: ForcedTrailEvidence = new Map()
    retainForcedTrailEvidence(evidence, [plan], [dot], true)
    const captured = evidence.get(dot.id)?.get(plan.enemyId)
    const beforeReplan = JSON.stringify(captured)
    const newerPlan = { ...structuredClone(plan), plannedAtMs: enteredAtMs + 1 }

    retainForcedTrailEvidence(evidence, [newerPlan], [], false)

    expect(captured?.samples[0].atMs).toBe(enteredAtMs)
    expect(captured?.commitUntilMs).toBe(plan.commitUntilMs)
    expect(JSON.stringify(evidence.get(dot.id)?.get(plan.enemyId))).toBe(beforeReplan)
  })

  it('makes the same-policy player-only decoy control approximately zero after footprint normalization', () => {
    expect(playerOnlyNormalizedAreaReduction(TIERS[3], 'decoy-exit', 0)).toBeLessThanOrEqual(0.1)
  })

  it('keeps the decoy-exit control moving outward after its deliberate trail placement', () => {
    for (const seed of [0, 9]) {
      const layingTrail = playerPolicyCommand('decoy-exit', 4_500, seed)
      const exiting = playerPolicyCommand('decoy-exit', 4_700, seed)

      expect(layingTrail.deliberateTrailPlacement).toBe(true)
      expect(exiting.deliberateTrailPlacement).toBe(false)
      expect(exiting.direction).toEqual({ x: layingTrail.direction.x, y: 0 })
      expect(Math.hypot(exiting.direction.x, exiting.direction.y)).toBe(1)
    }
  })

  it('classifies every threshold-contributing failure mode for original replay capture', () => {
    const cases: Array<{
      label: string
      tier: typeof TIERS[number]
      policy: PlayerPolicy
      mutate: (run: SimulationRun) => void
    }> = [
      {
        label: 'missing commitment',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.missingCommitmentCycles = 1 },
      },
      {
        label: 'ally conflict',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.allyPathConflicts = 1 },
      },
      {
        label: 'duplicate role',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.duplicateRoleCycles = 1 },
      },
      {
        label: 'unforced death',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.unforcedEnemyDeaths = 1 },
      },
      {
        label: 'boundary collision without death',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.enemyBoundaryHits = 1 },
      },
      {
        label: 'self-trail collision without death',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.enemySelfTrailHits = 1 },
      },
      {
        label: 'head collision without death',
        tier: TIERS[0],
        policy: 'stationary',
        mutate: (run) => { run.metrics.headOnHits = 1 },
      },
      {
        label: 'player-trail attribution mismatch',
        tier: TIERS[0],
        policy: 'decoy-exit',
        mutate: (run) => { run.metrics.playerTrailAttributionMismatches = 1 },
      },
      {
        label: 'per-seed late area below threshold',
        tier: TIERS[3],
        policy: 'decoy-exit',
        mutate: (run) => { run.metrics.medianPlayerAreaReduction = 7.99 },
      },
    ]

    for (const failureCase of cases) {
      const run = emptySimulationRun()
      failureCase.mutate(run)
      expect(
        simulationFailed(run, failureCase.tier, failureCase.policy),
        failureCase.label,
      ).toBe(true)
    }
  })

  it('does not turn a decoy exit into a genuine head-on and self-trail death', () => {
    const evidence = [TIERS[0], TIERS[2]].map((tier) => {
      const metrics = runSimulation(tier, 'decoy-exit', 0).metrics
      return {
        tier: tier.label,
        unforcedEnemyDeaths: metrics.unforcedEnemyDeaths,
        enemyDeathsByPlayerTrail: metrics.enemyDeathsByPlayerTrail,
        enemySelfTrailHits: metrics.enemySelfTrailHits,
        headOnHits: metrics.headOnHits,
      }
    })

    expect(evidence).toEqual([
      {
        tier: 'early-0',
        unforcedEnemyDeaths: 0,
        enemyDeathsByPlayerTrail: 0,
        enemySelfTrailHits: 0,
        headOnHits: 0,
      },
      {
        tier: 'middle-6',
        unforcedEnemyDeaths: 0,
        enemyDeathsByPlayerTrail: 0,
        enemySelfTrailHits: 0,
        headOnHits: 0,
      },
    ])
  })

  it('keeps non-deliberate representative policies out of their own trail and head-on paths', () => {
    const evidence = [
      [TIERS[1], 'alternating-turn', 2],
      [TIERS[2], 'stop-start', 3],
      [TIERS[3], 'alternating-turn', 0],
      [TIERS[4], 'alternating-turn', 39],
    ].map(([tier, policy, seed]) => {
      const run = runSimulation(
        tier as typeof TIERS[number],
        policy as PlayerPolicy,
        seed as number,
      )
      return {
        tier: (tier as typeof TIERS[number]).label,
        policy,
        seed,
        selfTrailHits: run.metrics.enemySelfTrailHits,
        headOnHits: run.metrics.headOnHits,
        unforcedDeaths: run.metrics.unforcedEnemyDeaths,
        missingCommitments: run.metrics.missingCommitmentCycles,
        allyConflicts: run.metrics.allyPathConflicts,
      }
    })

    expect(evidence).toEqual([
      { tier: 'early-3', policy: 'alternating-turn', seed: 2, selfTrailHits: 0, headOnHits: 0, unforcedDeaths: 0, missingCommitments: 0, allyConflicts: 0 },
      { tier: 'middle-6', policy: 'stop-start', seed: 3, selfTrailHits: 0, headOnHits: 0, unforcedDeaths: 0, missingCommitments: 0, allyConflicts: 0 },
      { tier: 'late-9', policy: 'alternating-turn', seed: 0, selfTrailHits: 0, headOnHits: 0, unforcedDeaths: 0, missingCommitments: 0, allyConflicts: 0 },
      { tier: 'late-12', policy: 'alternating-turn', seed: 39, selfTrailHits: 0, headOnHits: 0, unforcedDeaths: 0, missingCommitments: 0, allyConflicts: 0 },
    ])
  })

  it('requires two area observations spanning a full planning interval before accepting a peak', () => {
    const isolatedLoss = 900
    const at = (elapsedMs: number, reductionPercent = 46): AreaReductionSample => ({
      elapsedMs,
      isolatedLoss,
      reductionPercent,
    })

    expect(maximumSustainedAreaLoss([at(3_900)])).toBe(0)
    expect(maximumSustainedAreaLoss([at(3_900), at(3_999.999)])).toBe(0)
    expect(maximumSustainedAreaLoss([at(3_900), at(4_000)])).toBe(isolatedLoss)
    expect(maximumSustainedAreaLoss([at(3_900), at(4_000, 7.99), at(4_100)])).toBe(0)
  })

  it('holds the dual-enemy seed-9 enclosure instead of accepting its former one-boundary spike', () => {
    const run = runSimulation(TIERS[4], 'decoy-exit', 9, true)
    const replay = JSON.parse(run.replay ?? '{"plans":[]}') as { plans: SnakePlan[][] }
    const closure = replay.plans.flat().find((plan) => (
      plan.enemyId === 'enemy-1'
      && Math.abs(plan.commandAtMs - 3_720) < 1
    ))
    const retainedClosure = replay.plans.flat().filter((plan) => (
      plan.enemyId === 'enemy-1'
      && Math.abs(plan.plannedAtMs - (closure?.plannedAtMs ?? -1)) < 1
    ))
    const afterClosure = replay.plans.flat().find((plan) => (
      plan.enemyId === 'enemy-1'
      && plan.commandAtMs > (closure?.commitUntilMs ?? Infinity) + 1
    ))

    expect(closure).toMatchObject({
      evaluatedCandidates: 96,
      fallback: false,
      score: { survives: 1 },
    })
    expect(closure?.candidateIndex).toBeGreaterThanOrEqual(93)
    expect(closure?.candidateIndex).toBeLessThan(96)
    expect(closure?.directions.length).toBeGreaterThan(0)
    expect(closure?.path.length).toBe(closure?.directions.length)
    expect(retainedClosure.length).toBeGreaterThanOrEqual(3)
    expect(
      (retainedClosure.at(-1)?.commandAtMs ?? 0)
        - (retainedClosure[0]?.commandAtMs ?? Infinity),
    ).toBeGreaterThanOrEqual(200)
    for (const retained of retainedClosure) {
      expect(retained.candidateIndex).toBe(closure?.candidateIndex)
      expect(retained.evaluatedCandidates).toBe(96)
      expect(retained.commitUntilMs).toBe(closure?.commitUntilMs)
      expect(retained.directions).toEqual(closure?.directions)
      expect(retained.path).toEqual(closure?.path)
    }
    expect(afterClosure?.plannedAtMs).toBeGreaterThan(closure?.commitUntilMs ?? Infinity)

    expect(run.areaEvidence.maximumIsolatedEnemyReductionPercent).toBeGreaterThanOrEqual(8)
    expect(run.areaEvidence.longestAtOrAboveEightPercentMs).toBeGreaterThanOrEqual(1_000)
    expect(run.areaEvidence.samplesAtOrAboveEightPercent).toBeGreaterThanOrEqual(11)
    expect(run.areaEvidence.finalIsolatedEnemyReductionPercent).toBeGreaterThanOrEqual(8)
    expect(run.metrics.medianPlayerAreaReduction).toBeGreaterThanOrEqual(8)
    expect(run.metrics.enemySelfTrailHits).toBe(0)
    expect(run.metrics.enemyBoundaryHits).toBe(0)
    expect(run.metrics.unforcedEnemyDeaths).toBe(0)
    expect(run.metrics.allyPathConflicts).toBe(0)
    expect(run.metrics.missingCommitmentCycles).toBe(0)
    expect(simulationFailed(run, TIERS[4], 'decoy-exit')).toBe(false)
  })

  it.each([TIERS[3], TIERS[4]])(
    'holds a sustained enclosure when $label seed 0 spawns only one enemy against the decoy exit',
    (tier) => {
      const collisions: CollisionDiagnostic[] = []
      const run = runSimulation(tier, 'decoy-exit', 0, true, collisions)

      expect(run.enemySpawns).toBe(1)
      expect(run.dualPlanningCycles).toBe(0)
      expect(run.metrics.enemySelfTrailHits).toBe(0)
      expect(run.metrics.enemyBoundaryHits).toBe(0)
      expect(run.metrics.headOnHits, JSON.stringify(collisions)).toBe(0)
      expect(run.metrics.unforcedEnemyDeaths).toBe(0)
      expect(
        run.areaEvidence.maximumSustainedIsolatedEnemyReductionPercent,
        JSON.stringify({ areaEvidence: run.areaEvidence, collisions }),
      ).toBeGreaterThanOrEqual(8)
      expect(run.areaEvidence.longestAtOrAboveEightPercentMs).toBeGreaterThanOrEqual(1_000)
      expect(run.metrics.medianPlayerAreaReduction).toBeGreaterThanOrEqual(8)
    },
  )

  it('keeps the mirrored dual seed-19 opening tangent clear of its incoming trail', () => {
    const run = runSimulation(TIERS[4], 'decoy-exit', 19, true)

    expect(run.metrics.enemySelfTrailHits).toBe(0)
    expect(run.metrics.enemyBoundaryHits).toBe(0)
    expect(run.metrics.unforcedEnemyDeaths).toBe(0)
    expect(run.metrics.medianPlayerAreaReduction).toBeGreaterThanOrEqual(8)
    expect(run.areaEvidence.finalIsolatedEnemyReductionPercent).toBeGreaterThanOrEqual(8)
    expect(simulationFailed(run, TIERS[4], 'decoy-exit')).toBe(false)
  })

  it('runs a deterministic fast smoke fixture across every policy and encounter tier', () => {
    const observations = TIERS.flatMap((tier) => POLICIES.map((policy) => {
      const run = runSimulation(tier, policy, 0)
      return {
        tier: tier.label,
        policy,
        planningCycles: run.planningCycles,
        durations: run.metrics.planDurationsMs.length,
        duplicateRoles: run.metrics.duplicateRoleCycles,
        missingCommitments: run.metrics.missingCommitmentCycles,
        allyConflicts: run.metrics.allyPathConflicts,
        attributionMismatches: run.metrics.playerTrailAttributionMismatches,
        areaReduction: run.metrics.medianPlayerAreaReduction,
      }
    }))

    expect(observations).toHaveLength(TIERS.length * POLICIES.length)
    expect(observations.every((observation) => observation.planningCycles > 0)).toBe(true)
    expect(observations.every((observation) => observation.durations > 0)).toBe(true)
    expect(observations.every((observation) => observation.duplicateRoles === 0)).toBe(true)
    expect(observations.every((observation) => observation.missingCommitments === 0)).toBe(true)
    expect(observations.every((observation) => observation.allyConflicts === 0)).toBe(true)
    expect(observations.every((observation) => observation.attributionMismatches === 0)).toBe(true)
    const mirroredLateDecoy = runSimulation(TIERS[4], 'decoy-exit', 1)
    const dualLateDecoy = runSimulation(TIERS[4], 'decoy-exit', 9)
    const sustainedLateAreaSentinels = [
      ...observations
        .filter((observation) => observation.policy === 'decoy-exit' && (
          observation.tier === 'late-9' || observation.tier === 'late-12'
        ))
        .map((observation) => observation.areaReduction),
      mirroredLateDecoy.metrics.medianPlayerAreaReduction,
    ]
    expect(dualLateDecoy.dualPlanningCycles).toBeGreaterThan(0)
    expect(
      sustainedLateAreaSentinels.every((reduction) => reduction >= 8),
      JSON.stringify({
        lateDecoyObservations: observations.filter((observation) => (
          observation.policy === 'decoy-exit' && observation.tier.startsWith('late-')
        )),
        mirroredLateDecoy: mirroredLateDecoy.metrics.medianPlayerAreaReduction,
      }),
    ).toBe(true)
    for (const [tier, policy, seed] of [
      [TIERS[0], 'stationary', 0],
      [TIERS[4], 'decoy-exit', 0],
    ] as const) {
      const original = runSimulation(tier, policy, seed, true)
      const replayed = runSimulation(tier, policy, seed, true)
      expect(replayed.replay).toBe(original.replay)
    }
  }, 30_000)

  it.runIf(process.env.RESOURCE_SNAKE_LATE_AREA_GATE === '1')(
    'gates exact normalized late decoy area and safety over 200 seeds per tier',
    () => {
      const evidence = TIERS.filter((tier) => tier.period === 'late').map((tier) => {
        const runs = Array.from({ length: SEEDS_PER_FIXTURE }, (_, seed) => (
          runSimulation(tier, 'decoy-exit', seed)
        ))
        return {
          tier: tier.label,
          seeds: runs.length,
          sustainedPeakMedian: median(runs.map((run) => run.metrics.medianPlayerAreaReduction)),
          rawPeakMedian: median(runs.map(
            (run) => run.areaEvidence.maximumIsolatedEnemyReductionPercent,
          )),
          finalMedian: median(runs.map(
            (run) => run.areaEvidence.finalIsolatedEnemyReductionPercent,
          )),
          durationAtOrAboveEightMedianMs: median(runs.map(
            (run) => run.areaEvidence.longestAtOrAboveEightPercentMs,
          )),
          sustainedSeeds: runs.filter(
            (run) => run.areaEvidence.longestAtOrAboveEightPercentMs
              >= MINIMUM_SUSTAINED_AREA_REDUCTION_MS,
          ).length,
          failedSeeds: runs.filter((run) => simulationFailed(run, tier, 'decoy-exit')).length,
          failedSeedIds: runs.flatMap((run, seed) => (
            simulationFailed(run, tier, 'decoy-exit') ? [seed] : []
          )),
          safety: {
            unforcedDeaths: runs.reduce(
              (total, run) => total + run.metrics.unforcedEnemyDeaths,
              0,
            ),
            boundaryHits: runs.reduce(
              (total, run) => total + run.metrics.enemyBoundaryHits,
              0,
            ),
            selfTrailHits: runs.reduce(
              (total, run) => total + run.metrics.enemySelfTrailHits,
              0,
            ),
            headOnHits: runs.reduce((total, run) => total + run.metrics.headOnHits, 0),
            allyConflicts: runs.reduce(
              (total, run) => total + run.metrics.allyPathConflicts,
              0,
            ),
            missingCommitments: runs.reduce(
              (total, run) => total + run.metrics.missingCommitmentCycles,
              0,
            ),
            duplicateRoles: runs.reduce(
              (total, run) => total + run.metrics.duplicateRoleCycles,
              0,
            ),
            attributionMismatches: runs.reduce(
              (total, run) => total + run.metrics.playerTrailAttributionMismatches,
              0,
            ),
          },
        }
      })
      process.stdout.write(`RESOURCE_SNAKE_LATE_AREA_GATE ${JSON.stringify(evidence)}\n`)
      expect(evidence.every((fixture) => fixture.seeds === SEEDS_PER_FIXTURE)).toBe(true)
      expect(evidence.every((fixture) => fixture.sustainedPeakMedian >= 8)).toBe(true)
      expect(evidence.every((fixture) => fixture.finalMedian >= 8)).toBe(true)
      expect(evidence.every((fixture) => (
        fixture.durationAtOrAboveEightMedianMs >= MINIMUM_SUSTAINED_AREA_REDUCTION_MS
      ))).toBe(true)
      expect(evidence.every((fixture) => fixture.sustainedSeeds === SEEDS_PER_FIXTURE)).toBe(true)
      expect(evidence.every((fixture) => fixture.failedSeeds === 0)).toBe(true)
      expect(evidence.every((fixture) => (
        Object.values(fixture.safety).every((count) => count === 0)
      ))).toBe(true)
    },
    180_000,
  )

  it.runIf(process.env.RESOURCE_SNAKE_COLLISION_DIAGNOSTIC === '1')(
    'reports exact public-runtime causes for the representative collision sentinels',
    () => {
      const cases = [
        [TIERS[1], 'alternating-turn', 2],
        [TIERS[2], 'stop-start', 3],
        [TIERS[3], 'alternating-turn', 0],
        [TIERS[4], 'alternating-turn', 39],
      ] as const
      const evidence = cases.map(([tier, policy, seed]) => {
        const collisions: CollisionDiagnostic[] = []
        const run = runSimulation(
          tier,
          policy,
          seed,
          true,
          collisions,
        )
        const replay = JSON.parse(run.replay ?? '{"plans":[]}') as { plans: SnakePlan[][] }
        const collisionEnemyIds = new Set<SnakeActor['id']>(collisions.flatMap((collision) => (
          collision.actorIds.filter((actorId) => actorId !== 'player')
        )))
        return {
          tier: tier.label,
          policy,
          seed,
          metrics: run.metrics,
          forcedEnemyDeaths: run.forcedEnemyDeaths,
          collisions,
          leadInPlans: replay.plans.flat().filter((plan) => (
            (
              collisionEnemyIds.has(plan.enemyId)
              && collisions.some((collision) => (
                collision.actorIds.includes(plan.enemyId)
                && collision.atMs - plan.commandAtMs >= -1e-6
                && collision.atMs - plan.commandAtMs <= 600
              ))
            )
            || (
              tier.label === 'late-9'
              && plan.commandAtMs >= 3_400
              && plan.commandAtMs <= 3_800
            )
          )).map((plan) => ({
            enemyId: plan.enemyId,
            plannedAtMs: plan.plannedAtMs,
            commandAtMs: plan.commandAtMs,
            commitUntilMs: plan.commitUntilMs,
            candidateIndex: plan.candidateIndex,
            evaluatedCandidates: plan.evaluatedCandidates,
            fallback: plan.fallback,
            speedScale: plan.speedScale,
            survives: plan.score.survives,
            direction: plan.direction,
          })),
        }
      })
      process.stdout.write(`RESOURCE_SNAKE_COLLISION_DIAGNOSTIC ${JSON.stringify(evidence)}\n`)
      expect(evidence).toHaveLength(4)
    },
    30_000,
  )

  it.runIf(RUN_COMPLETE_SIMULATION_MATRIX)(
    'meets every safety, coordination, pressure, and deterministic replay threshold in the complete 5x5x200 lane',
    () => {
    warmPlanner()
    const fixtures: FixtureMetrics[] = []
    for (const tier of TIERS) {
      for (const policy of POLICIES) {
        const reductions: number[] = []
        const failedSeeds: number[] = []
        const originalFailedReplays = new Map<number, string>()
        const fixture: FixtureMetrics = {
          tier: tier.label,
          policy,
          seeds: SEEDS_PER_FIXTURE,
          enemySpawns: 0,
          planningCycles: 0,
          dualPlanningCycles: 0,
          committedPlans: 0,
          forcedEnemyDeaths: 0,
          unforcedEnemyDeaths: 0,
          enemyDeathsByPlayerTrail: 0,
          enemyBoundaryHits: 0,
          enemySelfTrailHits: 0,
          headOnHits: 0,
          medianPlayerAreaReduction: 0,
          duplicateRoleCycles: 0,
          allyPathConflicts: 0,
          missingCommitmentCycles: 0,
          playerTrailAttributionMismatches: 0,
          planDurationsMs: [],
          failedSeeds,
        }
        for (let seed = 0; seed < SEEDS_PER_FIXTURE; seed += 1) {
          const run = runSimulation(tier, policy, seed)
          fixture.enemySpawns += run.enemySpawns
          fixture.planningCycles += run.planningCycles
          fixture.dualPlanningCycles += run.dualPlanningCycles
          fixture.committedPlans += run.committedPlans
          fixture.forcedEnemyDeaths += run.forcedEnemyDeaths
          fixture.unforcedEnemyDeaths += run.metrics.unforcedEnemyDeaths
          fixture.enemyDeathsByPlayerTrail += run.metrics.enemyDeathsByPlayerTrail
          fixture.enemyBoundaryHits += run.metrics.enemyBoundaryHits
          fixture.enemySelfTrailHits += run.metrics.enemySelfTrailHits
          fixture.headOnHits += run.metrics.headOnHits
          fixture.duplicateRoleCycles += run.metrics.duplicateRoleCycles
          fixture.allyPathConflicts += run.metrics.allyPathConflicts
          fixture.missingCommitmentCycles += run.metrics.missingCommitmentCycles
          fixture.playerTrailAttributionMismatches += run.metrics.playerTrailAttributionMismatches
          fixture.planDurationsMs.push(...run.metrics.planDurationsMs)
          reductions.push(run.metrics.medianPlayerAreaReduction)
          if (simulationFailed(run, tier, policy)) {
            failedSeeds.push(seed)
            if (!run.replay) throw new Error('failed primary seed must retain its original replay')
            originalFailedReplays.set(seed, run.replay)
          }
        }
        fixture.medianPlayerAreaReduction = median(reductions)
        fixtures.push(fixture)
        for (const failedSeed of failedSeeds) {
          const replayed = runSimulation(tier, policy, failedSeed, true)
          expect(replayed.replay).toBe(originalFailedReplays.get(failedSeed))
        }
      }
    }

    const report = fixtures.map((fixture) => ({
      ...fixture,
      planDurationsMs: {
        count: fixture.planDurationsMs.length,
        p95: [...fixture.planDurationsMs].sort((left, right) => left - right)[
          Math.ceil(fixture.planDurationsMs.length * 0.95) - 1
        ] ?? 0,
      },
    }))
    if (process.env.RESOURCE_SNAKE_SIM_REPORT === '1') {
      process.stdout.write(`RESOURCE_SNAKE_SIM ${JSON.stringify(report)}\n`)
    }
    expect(fixtures).toHaveLength(TIERS.length * POLICIES.length)
    for (const fixture of fixtures) {
      expect(fixture.seeds).toBe(SEEDS_PER_FIXTURE)
      expect(fixture.planDurationsMs.length).toBeGreaterThan(0)
      expect(fixture.unforcedEnemyDeaths + fixture.forcedEnemyDeaths).toBeLessThanOrEqual(
        fixture.enemySpawns,
      )
      expect(fixture.enemyDeathsByPlayerTrail).toBeLessThanOrEqual(fixture.enemySpawns)
      expect(fixture.enemyBoundaryHits).toBeGreaterThanOrEqual(0)
      expect(fixture.enemySelfTrailHits).toBeGreaterThanOrEqual(0)
      expect(fixture.headOnHits).toBeGreaterThanOrEqual(0)
      expect(fixture.medianPlayerAreaReduction).toBeGreaterThanOrEqual(0)
      expect(fixture.duplicateRoleCycles).toBe(0)
      expect(fixture.missingCommitmentCycles).toBe(0)
      expect(fixture.playerTrailAttributionMismatches).toBe(0)
      if (fixture.dualPlanningCycles > 0) {
        expect(
          fixture.allyPathConflicts / fixture.dualPlanningCycles,
          JSON.stringify(report),
        ).toBeLessThan(0.05)
      }
      const tier = TIERS.find((candidate) => candidate.label === fixture.tier)!
      if (
        tier.period === 'early'
        && (fixture.policy === 'stationary' || fixture.policy === 'long-straight')
      ) {
        expect(
          fixture.unforcedEnemyDeaths / fixture.enemySpawns,
          JSON.stringify(report),
        ).toBeLessThan(0.03)
      }
      if (tier.period === 'late') {
        expect(
          fixture.unforcedEnemyDeaths / fixture.enemySpawns,
          JSON.stringify(report),
        ).toBeLessThan(0.02)
      }
      if (
        (fixture.tier === 'early-0' || fixture.tier === 'middle-6')
        && fixture.policy === 'decoy-exit'
      ) {
        expect(fixture.unforcedEnemyDeaths, JSON.stringify(report)).toBe(0)
      }
      if (tier.period === 'late' && fixture.policy === 'decoy-exit') {
        expect(fixture.medianPlayerAreaReduction, JSON.stringify(report)).toBeGreaterThanOrEqual(8)
      }
      if (fixture.tier === 'early-0' && fixture.policy === 'stationary') {
        expect(
          fixture.headOnHits / fixture.committedPlans,
          JSON.stringify(report),
        ).toBeLessThan(0.02)
      }
    }

    for (const [tier, policy, seed] of [
      [TIERS[0], 'stationary', 0],
      [TIERS[4], 'decoy-exit', 199],
    ] as const) {
      const first = runSimulation(tier, policy, seed, true)
      const replayed = runSimulation(tier, policy, seed, true)
      expect(replayed.replay).toBe(first.replay)
    }
    },
    1_200_000,
  )
})
