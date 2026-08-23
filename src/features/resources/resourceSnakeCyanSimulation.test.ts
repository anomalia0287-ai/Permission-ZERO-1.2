import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeAiController,
  createResourceSnakeAiControllerState,
  type ResourceSnakeAiControllerState,
} from './resourceSnakeAiController'
import {
  createResourceSnakeEncounter,
  type SnakeResourceCandidate,
} from './resourceSnakeEncounter'
import {
  SNAKE_DIRECTION_VECTORS,
  type SnakeDirection8,
} from './resourceSnakeInput'
import {
  planResourceSnakeGroup,
  resourceSnakePlanIsNewlyFatal,
  resourceSnakePlanToCommittedPath,
  type SnakeGroupPlan,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakePlayerHistorySample,
  type SnakeVector,
} from './resourceSnakePlanner'
import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  evaluateResourceSnakeEnemyHeadingSafety,
  flushResourceSnakeRuntimeChord,
  pressResourceSnakeRuntimeKey,
  releaseResourceSnakeRuntimeKey,
  RESOURCE_SNAKE_CONFIG,
  resourceSnakeRoundSpeedScale,
  type ResourceSnakeEvent,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeEnemyRole,
  type SnakeId,
} from './resourceSnakeRuntime'
import type { CyanEncounterStage } from './resourceSnakeCyanProfile'

type PlayerPolicy =
  | 'straight'
  | 'clockwise'
  | 'counter-clockwise'
  | 'alternating'
  | 'space-maximizer'

interface CyanSimulationCase {
  stage: CyanEncounterStage
  successfulDeposits: 0 | 6 | 12
  policy: PlayerPolicy
  seed: number
}

interface SimulationMetrics {
  cases: number
  completedDurationCases: number
  observedActiveSimulationMs: number
  enemyDeathStopLagMs: number
  enemyDeaths: number
  enemySelfDeaths: number
  enemyBoundaryDeaths: number
  enemyAllyDeaths: number
  playerCausedEnemyDeaths: number
  unknownEnemyDeaths: number
  playerDeaths: number
  duplicateReservations: number
  unforcedBoundaryCollisions: number
  unforcedSelfCollisions: number
  unforcedAllyCollisions: number
  zeroSpeedSamples: number
  zeroCommands: number
  missingPlans: number
  missingCommitments: number
  missingTelegraphs: number
  telegraphViolations: number
  responsePathViolations: number
  predictedSuicides: number
  fallbacks: number
  recoveryTransitions: number
  unsafeRecoveries: number
  collisionBypasses: number
  futureInputReads: number
  roleSeparationViolations: number
  prematureRoundEnds: number
}

const STAGES = Object.freeze([
  Object.freeze({ stage: 'cyan-intro', successfulDeposits: 0 }),
  Object.freeze({ stage: 'cyan-advanced', successfulDeposits: 6 }),
  Object.freeze({ stage: 'cyan-dual-role', successfulDeposits: 12 }),
] as const)

const POLICIES = Object.freeze([
  'straight',
  'clockwise',
  'counter-clockwise',
  'alternating',
  'space-maximizer',
] as const satisfies readonly PlayerPolicy[])

const VALIDATION_CASES: readonly CyanSimulationCase[] = Object.freeze(
  STAGES.flatMap(({ stage, successfulDeposits }) => (
    Array.from({ length: 50 }, (_, seed) => (
      POLICIES.map((policy) => ({ stage, successfulDeposits, policy, seed }))
    )).flat()
  )),
)

const SUSTAINED_CASES: readonly CyanSimulationCase[] = Object.freeze(
  STAGES.flatMap(({ stage, successfulDeposits }) => (
    Array.from({ length: 5 }, (_, seed) => ({
      stage,
      successfulDeposits,
      policy: 'space-maximizer' as const,
      seed,
    }))
  )),
)

const LONG_SURVIVAL_CASES: readonly CyanSimulationCase[] = Object.freeze(
  Array.from({ length: 50 }, (_, seed) => {
    const { stage, successfulDeposits } = STAGES[seed % STAGES.length]
    return {
      stage,
      successfulDeposits,
      policy: 'space-maximizer' as const,
      seed,
    }
  }),
)

const CANDIDATES = Object.freeze([
  { blockId: 'reasoning-a', origin: 'reasoning', contribution: 'normal', hiddenBomb: false },
  { blockId: 'reasoning-b', origin: 'reasoning', contribution: 'normal', hiddenBomb: false },
  { blockId: 'memory-a', origin: 'memory', contribution: 'normal', hiddenBomb: false },
  { blockId: 'memory-b', origin: 'memory', contribution: 'normal', hiddenBomb: false },
  { blockId: 'fluency-a', origin: 'fluency', contribution: 'normal', hiddenBomb: false },
  { blockId: 'fluency-b', origin: 'fluency', contribution: 'normal', hiddenBomb: false },
] as const satisfies readonly SnakeResourceCandidate[])

const HEADING_KEYS: Readonly<Record<SnakeDirection8, readonly string[]>> = Object.freeze({
  north: Object.freeze(['w']),
  'north-east': Object.freeze(['w', 'd']),
  east: Object.freeze(['d']),
  'south-east': Object.freeze(['s', 'd']),
  south: Object.freeze(['s']),
  'south-west': Object.freeze(['s', 'a']),
  west: Object.freeze(['a']),
  'north-west': Object.freeze(['w', 'a']),
})

const CLOCKWISE_HEADINGS = Object.freeze([
  'north-east',
  'east',
  'south-east',
  'south',
] as const satisfies readonly SnakeDirection8[])

const COUNTER_CLOCKWISE_HEADINGS = Object.freeze([
  'north-west',
  'west',
  'south-west',
  'south',
] as const satisfies readonly SnakeDirection8[])

const ALL_HEADINGS = Object.freeze(Object.keys(
  SNAKE_DIRECTION_VECTORS,
) as SnakeDirection8[])

const ACTIVE_SIMULATION_MS = 12_000
const LONG_SURVIVAL_SIMULATION_MS = 80_000
const LONG_SURVIVAL_PLAYER_TURN_INTERVAL_MS = 750
const SURVIVAL_VALIDATION_PLAYER_INTEGRITY = 1_000_000
const EPSILON = 1e-8

function emptyMetrics(): SimulationMetrics {
  return {
    cases: 0,
    completedDurationCases: 0,
    observedActiveSimulationMs: 0,
    enemyDeathStopLagMs: 0,
    enemyDeaths: 0,
    enemySelfDeaths: 0,
    enemyBoundaryDeaths: 0,
    enemyAllyDeaths: 0,
    playerCausedEnemyDeaths: 0,
    unknownEnemyDeaths: 0,
    playerDeaths: 0,
    duplicateReservations: 0,
    unforcedBoundaryCollisions: 0,
    unforcedSelfCollisions: 0,
    unforcedAllyCollisions: 0,
    zeroSpeedSamples: 0,
    zeroCommands: 0,
    missingPlans: 0,
    missingCommitments: 0,
    missingTelegraphs: 0,
    telegraphViolations: 0,
    responsePathViolations: 0,
    predictedSuicides: 0,
    fallbacks: 0,
    recoveryTransitions: 0,
    unsafeRecoveries: 0,
    collisionBypasses: 0,
    futureInputReads: 0,
    roleSeparationViolations: 0,
    prematureRoundEnds: 0,
  }
}

function rolesForRuntime(runtime: ResourceSnakeRoundState): Record<string, SnakeEnemyRole> {
  return Object.fromEntries(runtime.enemies.map((enemy) => (
    [enemy.id, enemy.role ?? 'pressure']
  )))
}

function plannerActor(
  actor: SnakeActor,
  roles: Readonly<Record<string, SnakeEnemyRole>>,
  simulationMs: number,
): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    heading: actor.heading,
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond
      * resourceSnakeRoundSpeedScale(simulationMs),
    collisionGraceMs: actor.collisionGraceMs,
    distanceSinceTrailDot: actor.distanceSinceTrailDot,
    enemyTurnGovernor: actor.enemyTurnGovernor
      ? {
          ...actor.enemyTurnGovernor,
          normalTurnAtMs: [...actor.enemyTurnGovernor.normalTurnAtMs],
        }
      : null,
    role: actor.kind === 'player'
      ? null
      : roles[actor.id] ?? actor.role ?? 'pressure',
  }
}

function plannerTrailDots(runtime: ResourceSnakeRoundState): SnakePlannerTrailDot[] {
  return [runtime.player, ...runtime.enemies].flatMap((actor) => (
    actor.trail.map((dot) => ({
      id: dot.id,
      ownerId: actor.id,
      position: { ...dot.position },
      spawnedAtMs: dot.spawnedAtMs,
      expiresAtMs: dot.expiresAtMs,
    }))
  ))
}

function plannerSnapshot(
  runtime: ResourceSnakeRoundState,
  history: readonly SnakePlayerHistorySample[],
  controller: ResourceSnakeAiControllerState | null,
  roles: Readonly<Record<string, SnakeEnemyRole>>,
): SnakePlannerSnapshot {
  const previousPlans = controller
    ? Object.values(controller.enemies)
        .map((enemy) => enemy.plan)
        .filter((plan): plan is SnakePlan => plan !== null)
    : []
  return {
    simulationMs: runtime.simulationMs,
    field: {
      width: RESOURCE_SNAKE_CONFIG.fieldWidth,
      height: RESOURCE_SNAKE_CONFIG.fieldHeight,
      padding: 0.5,
    },
    player: plannerActor(runtime.player, roles, runtime.simulationMs),
    enemies: runtime.enemies.map((enemy) => plannerActor(enemy, roles, runtime.simulationMs)),
    trailDots: plannerTrailDots(runtime),
    playerHistory: history.slice(-240),
    committedAllyPaths: previousPlans
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null),
  }
}

function deployActive(setup: NonNullable<ReturnType<typeof createResourceSnakeEncounter>['setup']>) {
  let runtime = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  for (const deltaMs of [100, 100, 100, 60]) {
    runtime = advanceResourceSnakeFrame(runtime, { enemyDirections: {} }, deltaMs)
  }
  return runtime
}

function queueHeading(
  runtime: ResourceSnakeRoundState,
  heading: SnakeDirection8,
  timestampMs: number,
): ResourceSnakeRoundState {
  const keys = HEADING_KEYS[heading]
  let next = runtime
  for (let index = 0; index < keys.length; index += 1) {
    next = pressResourceSnakeRuntimeKey(next, keys[index], timestampMs + index * 12)
  }
  next = flushResourceSnakeRuntimeChord(next, timestampMs + 25)
  for (const key of keys) next = releaseResourceSnakeRuntimeKey(next, key)
  return next
}

function wallClearance(position: SnakeVector): number {
  return Math.min(
    position.x - RESOURCE_SNAKE_CONFIG.headRadius,
    RESOURCE_SNAKE_CONFIG.fieldWidth - RESOURCE_SNAKE_CONFIG.headRadius - position.x,
    position.y - RESOURCE_SNAKE_CONFIG.headRadius,
    RESOURCE_SNAKE_CONFIG.fieldHeight - RESOURCE_SNAKE_CONFIG.headRadius - position.y,
  )
}

function pointToSegmentDistance(
  point: SnakeVector,
  start: SnakeVector,
  end: SnakeVector,
): number {
  const delta = { x: end.x - start.x, y: end.y - start.y }
  const lengthSquared = delta.x * delta.x + delta.y * delta.y
  const fraction = lengthSquared <= EPSILON
    ? 0
    : Math.max(0, Math.min(1, (
        (point.x - start.x) * delta.x
        + (point.y - start.y) * delta.y
      ) / lengthSquared))
  return Math.hypot(
    point.x - (start.x + delta.x * fraction),
    point.y - (start.y + delta.y * fraction),
  )
}

function spaceMaximizingHeading(runtime: ResourceSnakeRoundState, seed: number): SnakeDirection8 {
  const current = SNAKE_DIRECTION_VECTORS[runtime.player.heading]
  const actors = [runtime.player, ...runtime.enemies]
  const speed = runtime.player.maximumSpeedPerSecond
    * resourceSnakeRoundSpeedScale(runtime.simulationMs)
  const projectionStepMs = 100
  const projectionSteps = 12
  let bestHeading = runtime.player.heading
  let bestScore = -Infinity
  for (let index = 0; index < ALL_HEADINGS.length; index += 1) {
    const heading = ALL_HEADINGS[index]
    const direction = SNAKE_DIRECTION_VECTORS[heading]
    if (current.x * direction.x + current.y * direction.y < -0.999_999) continue
    let minimumClearance = Infinity
    let safeSteps = 0
    let prior = runtime.player.position
    for (let step = 1; step <= projectionSteps; step += 1) {
      const atMs = runtime.simulationMs + step * projectionStepMs
      const sample = {
        x: runtime.player.position.x + direction.x * speed * step * projectionStepMs / 1_000,
        y: runtime.player.position.y + direction.y * speed * step * projectionStepMs / 1_000,
      }
      let stepClearance = wallClearance(sample)
      for (const owner of actors) {
        for (const dot of owner.trail) {
          if (dot.spawnedAtMs >= atMs || dot.expiresAtMs <= atMs) continue
          if (
            owner.id === 'player'
            && atMs - dot.spawnedAtMs < RESOURCE_SNAKE_CONFIG.selfTrailIgnoreAgeMs
          ) continue
          const priorOffset = {
            x: prior.x - dot.position.x,
            y: prior.y - dot.position.y,
          }
          const movingOut = priorOffset.x * direction.x + priorOffset.y * direction.y >= 0
          if (
            owner.id === 'player'
            && Math.hypot(priorOffset.x, priorOffset.y)
              <= RESOURCE_SNAKE_CONFIG.headRadius + RESOURCE_SNAKE_CONFIG.trailRadius
            && movingOut
          ) continue
          stepClearance = Math.min(
            stepClearance,
            pointToSegmentDistance(dot.position, prior, sample)
              - RESOURCE_SNAKE_CONFIG.headRadius
              - RESOURCE_SNAKE_CONFIG.trailRadius,
          )
        }
      }
      for (const enemy of runtime.enemies.filter((actor) => actor.phase === 'active')) {
        const elapsedSeconds = step * projectionStepMs / 1_000
        const enemyPosition = {
          x: enemy.position.x + enemy.velocity.x * elapsedSeconds,
          y: enemy.position.y + enemy.velocity.y * elapsedSeconds,
        }
        stepClearance = Math.min(
          stepClearance,
          Math.hypot(sample.x - enemyPosition.x, sample.y - enemyPosition.y)
            - RESOURCE_SNAKE_CONFIG.headRadius * 2,
        )
      }
      minimumClearance = Math.min(minimumClearance, stepClearance)
      if (stepClearance <= 0) break
      safeSteps += 1
      prior = sample
    }
    let score = safeSteps * 100 + minimumClearance
    const stableTieBreak = ((index + seed) % ALL_HEADINGS.length) * 1e-6
    const straightBias = heading === runtime.player.heading ? 1e-4 : 0
    score += stableTieBreak + straightBias
    if (score > bestScore) {
      bestScore = score
      bestHeading = heading
    }
  }
  return bestHeading
}

function policyHeading(
  policy: PlayerPolicy,
  runtime: ResourceSnakeRoundState,
  turnIndex: number,
  seed: number,
): SnakeDirection8 | null {
  if (policy === 'straight') return null
  if (policy === 'clockwise') return CLOCKWISE_HEADINGS[Math.min(turnIndex, 3)]
  if (policy === 'counter-clockwise') return COUNTER_CLOCKWISE_HEADINGS[Math.min(turnIndex, 3)]
  if (policy === 'alternating') {
    return (turnIndex + seed) % 2 === 0 ? 'north-east' : 'north-west'
  }
  return spaceMaximizingHeading(runtime, seed)
}

function frameDelta(seed: number, frameIndex: number, remainingMs: number): number {
  const palette = [25, 40, 55, 30, 75, 50, 35, 65] as const
  const selected = palette[(seed * 5 + frameIndex * 3) % palette.length]
  return Math.min(selected, remainingMs)
}

function firstPlanFingerprint(group: SnakeGroupPlan): string {
  return JSON.stringify([...group.plans]
    .sort((left, right) => left.enemyId.localeCompare(right.enemyId))
    .map((plan) => ({
      enemyId: plan.enemyId,
      role: plan.role,
      candidateIndex: plan.candidateIndex,
      originHeading: plan.originHeading,
      attackHeading: plan.attackHeading,
      direction: plan.direction,
      endpoint: plan.path.at(-1),
      score: plan.score,
    })))
}

function endpointSector(plan: SnakePlan): string {
  const endpoint = plan.path.at(-1) ?? plan.originPosition
  return `${Math.floor(endpoint.x / 10)}:${Math.floor(endpoint.y / 6)}`
}

function classifyCollision(
  event: Extract<ResourceSnakeEvent, { type: 'snake-collided' }>,
  prior: ResourceSnakeRoundState,
): 'boundary' | 'self' | 'ally' | null {
  const enemyIds = event.actorIds.filter((actorId) => actorId !== 'player')
  if (enemyIds.length === 0) return null
  if (event.collisionKind === 'boundary' || wallClearance(event.point) <= 0.08) {
    return 'boundary'
  }
  if (event.collisionKind === 'head-head' || event.actorIds.length >= 2) {
    return enemyIds.length >= 2 ? 'ally' : null
  }
  const enemyId = enemyIds[0]
  if (event.collisionKind === 'trail' && event.obstacleOwnerId !== undefined) {
    if (event.obstacleOwnerId === enemyId) return 'self'
    return event.obstacleOwnerId === 'player' ? null : 'ally'
  }
  const enemy = prior.enemies.find((candidate) => candidate.id === enemyId)
  const collisionRadius = (
    RESOURCE_SNAKE_CONFIG.headRadius + RESOURCE_SNAKE_CONFIG.trailRadius + 0.08
  )
  if (enemy?.trail.some((dot) => Math.hypot(
    dot.position.x - event.point.x,
    dot.position.y - event.point.y,
  ) <= collisionRadius)) return 'self'
  const allyTrail = prior.enemies.some((candidate) => (
    candidate.id !== enemyId
    && candidate.trail.some((dot) => Math.hypot(
      dot.position.x - event.point.x,
      dot.position.y - event.point.y,
    ) <= collisionRadius)
  ))
  return allyTrail ? 'ally' : null
}

function classifyEnemyDeath(
  actorId: SnakeId,
  collisions: readonly Extract<ResourceSnakeEvent, { type: 'snake-collided' }>[],
  prior: ResourceSnakeRoundState,
): 'self' | 'boundary' | 'ally' | 'player' | 'unknown' {
  const collision = [...collisions].reverse().find((candidate) => (
    candidate.actorIds.includes(actorId)
  ))
  if (!collision) return 'unknown'
  const autonomousKind = classifyCollision(collision, prior)
  if (autonomousKind) return autonomousKind
  if (
    collision.actorIds.includes('player')
    || collision.obstacleOwnerId === 'player'
  ) return 'player'
  return 'unknown'
}

function observeNewEvents(
  prior: ResourceSnakeRoundState,
  next: ResourceSnakeRoundState,
  metrics: SimulationMetrics,
  diagnostics?: string[],
  diagnosticContext?: Readonly<{
    commands: Readonly<Record<string, SnakeVector>>
    commandSchedules: Readonly<Record<string, readonly { atMs: number; direction: SnakeVector }[]>>
    controller: ResourceSnakeAiControllerState
    snapshot: SnakePlannerSnapshot
  }>,
): void {
  const events = next.events.slice(prior.events.length)
  const collisions = events.filter((event): event is Extract<
    ResourceSnakeEvent,
    { type: 'snake-collided' }
  > => event.type === 'snake-collided')
  const damaged = new Set(events
    .filter((event): event is Extract<ResourceSnakeEvent, { type: 'snake-damaged' }> => (
      event.type === 'snake-damaged'
    ))
    .map((event) => event.actorId))
  for (const death of events.filter((event): event is Extract<
    ResourceSnakeEvent,
    { type: 'snake-died' }
  > => event.type === 'snake-died' && event.actorId !== 'player')) {
    const cause = classifyEnemyDeath(death.actorId, collisions, prior)
    if (cause === 'self') metrics.enemySelfDeaths += 1
    else if (cause === 'boundary') metrics.enemyBoundaryDeaths += 1
    else if (cause === 'ally') metrics.enemyAllyDeaths += 1
    else if (cause === 'player') metrics.playerCausedEnemyDeaths += 1
    else metrics.unknownEnemyDeaths += 1
    diagnostics?.push(JSON.stringify({
      atMs: next.simulationMs,
      issue: 'enemy-death',
      actorId: death.actorId,
      cause,
    }))
  }
  for (const collision of collisions) {
    const kind = classifyCollision(collision, prior)
    if (kind === 'boundary') metrics.unforcedBoundaryCollisions += 1
    else if (kind === 'self') metrics.unforcedSelfCollisions += 1
    else if (kind === 'ally') metrics.unforcedAllyCollisions += 1
    if (!collision.actorIds.some((actorId) => damaged.has(actorId))) {
      metrics.collisionBypasses += 1
    }
    if (diagnostics) diagnostics.push(JSON.stringify({
      atMs: next.simulationMs,
      issue: 'collision',
      kind,
      actorIds: collision.actorIds,
      collisionKind: collision.collisionKind,
      obstacleOwnerId: collision.obstacleOwnerId,
      point: collision.point,
      actors: collision.actorIds.map((actorId) => {
        const actor = actorId === 'player'
          ? prior.player
          : prior.enemies.find((candidate) => candidate.id === actorId)
        const ai = diagnosticContext?.controller.enemies[actorId]
        return {
          actorId,
          position: actor?.position,
          velocity: actor?.velocity,
          heading: actor?.heading,
          enemyTurnGovernor: actor?.enemyTurnGovernor,
          collisionGraceMs: actor?.collisionGraceMs,
          command: diagnosticContext?.commands[actorId],
          commandSchedule: diagnosticContext?.commandSchedules[actorId],
          aiPhase: ai?.phase,
          plan: ai?.plan && {
            plannedAtMs: ai.plan.plannedAtMs,
            commitUntilMs: ai.plan.commitUntilMs,
            attackHeading: ai.plan.attackHeading,
            fallback: ai.plan.fallback,
            newlyFatal: diagnosticContext
              ? resourceSnakePlanIsNewlyFatal(diagnosticContext.snapshot, ai.plan)
              : undefined,
          },
          headingSafety: actor?.kind === 'enemy'
            ? ALL_HEADINGS.map((heading) => (
                evaluateResourceSnakeEnemyHeadingSafety(prior, actor.id, heading)
              ))
            : undefined,
          nearbyTrails: actor && [prior.player, ...prior.enemies].flatMap((owner) => (
            owner.trail
              .filter((dot) => Math.hypot(
                dot.position.x - collision.point.x,
                dot.position.y - collision.point.y,
              ) < 1)
              .map((dot) => ({
                ownerId: owner.id,
                id: dot.id,
                position: dot.position,
                spawnedAtMs: dot.spawnedAtMs,
                ageMs: prior.simulationMs - dot.spawnedAtMs,
              }))
          )),
        }
      }),
    }))
  }
}

function observePlanGroup(
  snapshot: SnakePlannerSnapshot,
  group: SnakeGroupPlan,
  expectedEnemyIds: readonly SnakeId[],
  metrics: SimulationMetrics,
  checkRoleSeparation: boolean,
  diagnostics?: string[],
): void {
  const plansByEnemy = new Map(group.plans.map((plan) => [plan.enemyId, plan]))
  for (const enemyId of expectedEnemyIds) {
    const plan = plansByEnemy.get(enemyId)
    if (!plan) {
      metrics.missingPlans += 1
      if (diagnostics && diagnostics.length < 24) diagnostics.push(JSON.stringify({
        atMs: snapshot.simulationMs,
        issue: 'missing-plan',
        expectedEnemyId: enemyId,
        snapshotEnemyIds: snapshot.enemies.map((enemy) => enemy.id),
        actors: [snapshot.player, ...snapshot.enemies].map((actor) => ({
          id: actor.id,
          role: actor.role,
          position: actor.position,
          velocity: actor.velocity,
          integrity: actor.integrity,
          maximumIntegrity: actor.maximumIntegrity,
          maximumSpeedPerSecond: actor.maximumSpeedPerSecond,
          collisionGraceMs: actor.collisionGraceMs,
          distanceSinceTrailDot: actor.distanceSinceTrailDot,
        })),
        trailDotCount: snapshot.trailDots.length,
        playerHistoryCount: snapshot.playerHistory.length,
        committedAllyPaths: snapshot.committedAllyPaths,
        returnedPlans: group.plans.map((candidate) => ({
          enemyId: candidate.enemyId,
          fallback: candidate.fallback,
          intent: candidate.intent,
          pathLength: candidate.path.length,
          commitUntilMs: candidate.commitUntilMs,
        })),
        roles: group.roles,
      }))
      continue
    }
    if (plan.fallback) metrics.fallbacks += 1
    if (
      diagnostics
      && diagnostics.length < 12
      && plan.fallback
    ) diagnostics.push(JSON.stringify({
      atMs: snapshot.simulationMs,
      issue: 'plan',
      enemyId,
      fallback: plan.fallback,
      intent: plan.intent,
      phasePosition: snapshot.enemies.find((enemy) => enemy.id === enemyId)?.position,
      playerPosition: snapshot.player.position,
      playerHeading: snapshot.player.heading,
      attackHeading: plan.attackHeading,
      score: plan.score,
    }))
  }
  if (checkRoleSeparation && expectedEnemyIds.length === 2 && group.plans.length === 2) {
    const [first, second] = [...group.plans].sort(
      (left, right) => left.enemyId.localeCompare(right.enemyId),
    )
    if (
      endpointSector(first) === endpointSector(second)
      || !first.attackHeading
      || !second.attackHeading
      || first.attackHeading === second.attackHeading
    ) metrics.roleSeparationViolations += 1
  }
}

function observeAdoptedControllerPlans(
  snapshot: SnakePlannerSnapshot,
  prior: ResourceSnakeAiControllerState,
  next: ResourceSnakeAiControllerState,
  metrics: SimulationMetrics,
  diagnostics?: string[],
  proposedGroup?: SnakeGroupPlan | null,
): void {
  for (const enemy of Object.values(next.enemies)) {
    const priorEnemy = prior.enemies[enemy.enemyId]
    const enteredTelegraph = enemy.phase === 'telegraph' && (
      priorEnemy?.phase !== 'telegraph'
      || priorEnemy.plan?.plannedAtMs !== enemy.plan?.plannedAtMs
      || priorEnemy.plan?.candidateIndex !== enemy.plan?.candidateIndex
    )
    const enteredRecovery = enemy.phase === 'recover' && priorEnemy?.phase !== 'recover'
    if (enteredRecovery) {
      metrics.recoveryTransitions += 1
      const commandable = !!enemy.plan
        && enemy.plan.directions.length > 0
        && enemy.plan.commitUntilMs > snapshot.simulationMs
      if (!commandable) {
        metrics.unsafeRecoveries += 1
        if (diagnostics && diagnostics.length < 12) diagnostics.push(JSON.stringify({
          atMs: snapshot.simulationMs,
          issue: 'unsafe-recovery',
          enemyId: enemy.enemyId,
          enemyPosition: snapshot.enemies.find((actor) => actor.id === enemy.enemyId)?.position,
          enemyHeading: snapshot.enemies.find((actor) => actor.id === enemy.enemyId)?.heading,
          playerPosition: snapshot.player.position,
          nearbyTrails: snapshot.trailDots.filter((dot) => {
            const position = snapshot.enemies.find((actor) => actor.id === enemy.enemyId)?.position
            return position
              ? Math.hypot(dot.position.x - position.x, dot.position.y - position.y) < 1.5
              : false
          }).map((dot) => ({
            ownerId: dot.ownerId,
            id: dot.id,
            position: dot.position,
            ageMs: snapshot.simulationMs - dot.spawnedAtMs,
          })),
          priorPhase: priorEnemy?.phase,
          priorPlan: priorEnemy?.plan && {
            plannedAtMs: priorEnemy.plan.plannedAtMs,
            commitUntilMs: priorEnemy.plan.commitUntilMs,
            attackHeading: priorEnemy.plan.attackHeading,
          },
          proposedPlan: proposedGroup?.plans.find((plan) => (
            plan.enemyId === enemy.enemyId
          )) && (() => {
            const plan = proposedGroup.plans.find((candidate) => (
              candidate.enemyId === enemy.enemyId
            ))!
            return {
              plannedAtMs: plan.plannedAtMs,
              commitUntilMs: plan.commitUntilMs,
              attackHeading: plan.attackHeading,
              fallback: plan.fallback,
              survives: plan.score.survives,
              responsePathFloor: plan.score.responsePathFloor,
              newlyFatal: resourceSnakePlanIsNewlyFatal(snapshot, plan),
            }
          })(),
        }))
      }
    }
    if (!enteredTelegraph) continue
    const plan = enemy.plan
    const newlyFatal = !plan || resourceSnakePlanIsNewlyFatal(snapshot, plan)
    if (!plan || plan.fallback || plan.score.survives !== 1 || newlyFatal) {
      metrics.predictedSuicides += 1
    }
    if (!plan || plan.score.responsePathFloor < 1) metrics.responsePathViolations += 1
    const telegraphDurationMs = plan
      ? plan.commandAtMs - plan.plannedAtMs
      : Number.NEGATIVE_INFINITY
    const telegraphInvalid = (
      !plan
      || telegraphDurationMs < 160 - EPSILON
      || plan.commitUntilMs <= plan.commandAtMs
      || plan.path.length === 0
    )
    if (telegraphInvalid) {
      metrics.telegraphViolations += 1
      if (diagnostics && diagnostics.length < 12) diagnostics.push(JSON.stringify({
        atMs: snapshot.simulationMs,
        issue: 'telegraph-violation',
        enemyId: enemy.enemyId,
        priorPhase: priorEnemy?.phase,
        plannedAtMs: plan?.plannedAtMs,
        commandAtMs: plan?.commandAtMs,
        telegraphDurationMs,
        phaseStartedAtMs: enemy.phaseStartedAtMs,
        visibleDurationMs: plan ? plan.commandAtMs - enemy.phaseStartedAtMs : null,
        commitUntilMs: plan?.commitUntilMs,
        pathLength: plan?.path.length ?? 0,
      }))
    }
    if (
      diagnostics
      && diagnostics.length < 12
      && (!plan || plan.score.responsePathFloor < 1 || newlyFatal)
    ) diagnostics.push(JSON.stringify({
      atMs: snapshot.simulationMs,
      issue: 'adopted-plan',
      enemyId: enemy.enemyId,
      newlyFatal,
      phasePosition: snapshot.enemies.find((actor) => actor.id === enemy.enemyId)?.position,
      playerPosition: snapshot.player.position,
      score: plan?.score,
    }))
  }
}

function observeMotion(
  runtime: ResourceSnakeRoundState,
  simulationAdvanced: boolean,
  commands: Readonly<Record<string, SnakeVector>>,
  metrics: SimulationMetrics,
): void {
  for (const enemy of runtime.enemies.filter((actor) => actor.phase === 'active')) {
    const command = commands[enemy.id]
    if (!command || Math.hypot(command.x, command.y) < 0.92 - EPSILON) {
      metrics.zeroCommands += 1
    }
  }
  if (!simulationAdvanced) return
  for (const actor of [runtime.player, ...runtime.enemies].filter(
    (candidate) => candidate.phase === 'active',
  )) {
    const minimumSpeed = actor.maximumSpeedPerSecond
      * (actor.kind === 'enemy' ? RESOURCE_SNAKE_CONFIG.minimumLiveSpeedScale : 1)
      * resourceSnakeRoundSpeedScale(runtime.simulationMs)
    if (
      !Number.isFinite(actor.velocity.x)
      || !Number.isFinite(actor.velocity.y)
      || Math.hypot(actor.velocity.x, actor.velocity.y) < minimumSpeed - EPSILON
    ) metrics.zeroSpeedSamples += 1
  }
}

function runSimulationCase(
  testCase: CyanSimulationCase,
  metrics: SimulationMetrics,
  singleEnemyPlanningMs: number[],
  dualEnemyPlanningMs: number[],
  diagnostics?: string[],
  activeSimulationMs = ACTIVE_SIMULATION_MS,
  protectPlayerForSurvivalValidation = false,
  playerTurnIntervalMs?: number,
  suppressPlayerTrailForSurvivalValidation = false,
  stopOnFirstEnemyDeath = false,
): string {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: `cyan-validation-${testCase.seed}`,
    roundOrdinal: testCase.seed,
    successfulDeposits: testCase.successfulDeposits,
    candidates: CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup || encounter.stage !== testCase.stage) {
    throw new Error(`invalid validation setup: ${JSON.stringify(testCase)}`)
  }
  const reserved = encounter.setup.enemies.map((enemy) => enemy.reservedBlockId)
  const rewardKeys = encounter.setup.enemies.map((enemy) => enemy.rewardKey)
  if (new Set(reserved).size !== reserved.length) metrics.duplicateReservations += 1
  if (new Set(rewardKeys).size !== rewardKeys.length) metrics.duplicateReservations += 1

  let runtime = deployActive(encounter.setup)
  if (protectPlayerForSurvivalValidation) {
    // The long-run gate isolates enemy survival. A durable player keeps an
    // enemy victory from ending the observation before the required 45s;
    // enemy damage, collision authority, integrity, and death remain untouched.
    runtime = {
      ...runtime,
      player: {
        ...runtime.player,
        integrity: SURVIVAL_VALIDATION_PLAYER_INTEGRITY,
        maximumIntegrity: SURVIVAL_VALIDATION_PLAYER_INTEGRITY,
      },
    }
  }
  let roles = rolesForRuntime(runtime)
  const history: SnakePlayerHistorySample[] = [{
    simulationMs: runtime.simulationMs,
    position: { ...runtime.player.position },
    velocity: { ...runtime.player.velocity },
  }]
  let snapshot = plannerSnapshot(runtime, history, null, roles)
  let controller = createResourceSnakeAiControllerState(snapshot)
  const committed = new Set<SnakeId>()
  const telegraphed = new Set<SnakeId>()
  let fingerprint = ''
  let turnIndex = 0
  let frameIndex = 0
  let nextTurnAtMs = 240 + (testCase.seed % 5) * 10
  const turnIntervalMs = playerTurnIntervalMs ?? (230 + (testCase.seed % 4) * 15)
  const activeStartedAtMs = runtime.simulationMs

  while (
    runtime.phase === 'active'
    && runtime.simulationMs - activeStartedAtMs < activeSimulationMs - EPSILON
    && (
      !stopOnFirstEnemyDeath
      || runtime.enemies.every((enemy) => (
        enemy.phase === 'active' && enemy.integrity > 0
      ))
    )
  ) {
    const activeElapsedMs = runtime.simulationMs - activeStartedAtMs
    if (
      activeElapsedMs + EPSILON >= nextTurnAtMs
      && (testCase.policy === 'space-maximizer' || turnIndex < 4)
    ) {
      const heading = policyHeading(testCase.policy, runtime, turnIndex, testCase.seed)
      if (heading) {
        runtime = queueHeading(
          runtime,
          heading,
          10_000 + testCase.seed * 100 + runtime.simulationMs,
        )
      }
      turnIndex += 1
      nextTurnAtMs += turnIntervalMs
    }

    snapshot = plannerSnapshot(runtime, history, controller, roles)
    let observedGroup: SnakeGroupPlan | null = null
    const priorController = controller
    const controlled = advanceResourceSnakeAiController(controller, {
      snapshot,
      profile: encounter.cyanProfile,
      active: true,
    }, {
      planGroup: (planningSnapshot, profile, previousPlans, timingHistoryMs) => {
        observedGroup = planResourceSnakeGroup(
          planningSnapshot,
          profile,
          previousPlans,
          timingHistoryMs,
        )
        return observedGroup
      },
    })
    controller = controlled.state
    roles = controlled.state.roles
    observeAdoptedControllerPlans(
      snapshot,
      priorController,
      controlled.state,
      metrics,
      diagnostics,
      observedGroup,
    )
    if (controlled.planned) {
      const timings = runtime.enemies.length === 1
        ? singleEnemyPlanningMs
        : dualEnemyPlanningMs
      timings.push(controlled.observedPlanningMs)
      if (!observedGroup) {
        metrics.missingPlans += runtime.enemies.length
      } else {
        const firstGroup = fingerprint.length === 0
        if (firstGroup) fingerprint = firstPlanFingerprint(observedGroup)
        observePlanGroup(
          snapshot,
          observedGroup,
          runtime.enemies.map((enemy) => enemy.id),
          metrics,
          firstGroup,
          diagnostics,
        )
      }
    }
    for (const enemy of Object.values(controller.enemies)) {
      if (enemy.phase === 'commit') committed.add(enemy.enemyId)
    }
    for (const telegraph of controlled.telegraphs) {
      telegraphed.add(telegraph.enemyId)
      if (
        telegraph.path.length === 0
        || telegraph.untilMs - telegraph.startedAtMs < 160 - EPSILON
      ) metrics.telegraphViolations += 1
    }

    const traceKey = `${testCase.stage}:${testCase.policy}:${testCase.seed}`
    if (
      diagnostics
      && process.env.RESOURCE_SNAKE_CYAN_CASE_DIAGNOSTIC === traceKey
      && controlled.planned
      && (() => {
        const fromMs = Number(process.env.RESOURCE_SNAKE_CYAN_CASE_TRACE_FROM_MS)
        const toMs = Number(process.env.RESOURCE_SNAKE_CYAN_CASE_TRACE_TO_MS)
        return (!Number.isFinite(fromMs) || snapshot.simulationMs >= fromMs)
          && (!Number.isFinite(toMs) || snapshot.simulationMs <= toMs)
      })()
    ) diagnostics.push(JSON.stringify({
      atMs: snapshot.simulationMs,
      issue: 'planning-cycle',
      nextPlanningAtMs: controlled.state.nextPlanningAtMs,
      enemies: Object.values(controlled.state.enemies).map((enemy) => ({
        enemyId: enemy.enemyId,
        phase: enemy.phase,
        recoveryHeading: enemy.recoveryHeading,
        safePlanConfirmations: enemy.safePlanConfirmations,
        plan: enemy.plan && {
          plannedAtMs: enemy.plan.plannedAtMs,
          commandAtMs: enemy.plan.commandAtMs,
          commitUntilMs: enemy.plan.commitUntilMs,
          originHeading: enemy.plan.originHeading,
          attackHeading: enemy.plan.attackHeading,
          headingChanges: enemy.plan.headingChanges,
          endpoint: enemy.plan.path.at(-1),
          score: enemy.plan.score,
          fallback: enemy.plan.fallback,
        },
      })),
      snapshotEnemies: snapshot.enemies.map((enemy) => ({
        enemyId: enemy.id,
        position: enemy.position,
        velocity: enemy.velocity,
        heading: enemy.heading,
        integrity: enemy.integrity,
        enemyTurnGovernor: enemy.enemyTurnGovernor,
      })),
      trailDotCount: snapshot.trailDots.length,
      commands: controlled.commands,
      commandSchedules: controlled.commandSchedules,
      proposed: (observedGroup as SnakeGroupPlan | null)?.plans.map((plan) => ({
        enemyId: plan.enemyId,
        plannedAtMs: plan.plannedAtMs,
        commandAtMs: plan.commandAtMs,
        commitUntilMs: plan.commitUntilMs,
        originHeading: plan.originHeading,
        attackHeading: plan.attackHeading,
        headingChanges: plan.headingChanges,
        endpoint: plan.path.at(-1),
        score: plan.score,
        fallback: plan.fallback,
      })),
    }))
    if (
      diagnostics
      && process.env.RESOURCE_SNAKE_CYAN_CASE_DIAGNOSTIC === traceKey
      && snapshot.simulationMs >= 1_250
      && diagnostics.length < 10
    ) diagnostics.push(JSON.stringify({
      atMs: snapshot.simulationMs,
      issue: 'boundary-trace',
      prior: Object.values(priorController.enemies).map((enemy) => ({
        enemyId: enemy.enemyId,
        phase: enemy.phase,
        commitUntilMs: enemy.plan?.commitUntilMs,
      })),
      next: Object.values(controlled.state.enemies).map((enemy) => ({
        enemyId: enemy.enemyId,
        phase: enemy.phase,
        plannedAtMs: enemy.plan?.plannedAtMs,
        commandAtMs: enemy.plan?.commandAtMs,
        commitUntilMs: enemy.plan?.commitUntilMs,
        attackHeading: enemy.plan?.attackHeading,
      })),
      planned: controlled.planned,
      nextPlanningAtMs: controlled.state.nextPlanningAtMs,
      commands: controlled.commands,
      commandSchedules: controlled.commandSchedules,
      actors: snapshot.enemies.map((enemy) => ({
        enemyId: enemy.id,
        position: enemy.position,
        velocity: enemy.velocity,
        heading: enemy.heading,
        enemyTurnGovernor: enemy.enemyTurnGovernor,
      })),
      proposed: (observedGroup as SnakeGroupPlan | null)?.plans.map((plan) => ({
        enemyId: plan.enemyId,
        plannedAtMs: plan.plannedAtMs,
        commandAtMs: plan.commandAtMs,
        commitUntilMs: plan.commitUntilMs,
        attackHeading: plan.attackHeading,
      })),
    }))

    const remainingMs = activeSimulationMs - activeElapsedMs
    const deltaMs = frameDelta(testCase.seed, frameIndex, remainingMs)
    const prior = runtime
    const frameInput = {
      enemyDirections: controlled.commands,
      enemyDirectionSchedules: controlled.commandSchedules,
      enemyTurnPolicies: controlled.turnPolicies,
    }
    const suppressValidationPlayerTrail = () => {
      if (!suppressPlayerTrailForSurvivalValidation) return
      runtime = {
        ...runtime,
        player: {
          ...runtime.player,
          trail: [],
          railVertices: [{ ...runtime.player.position }],
          distanceSinceTrailDot: 0,
        },
      }
    }
    if (stopOnFirstEnemyDeath) {
      // Preserve the controller's outer-frame command and schedule, but expose
      // each authoritative 120 Hz physics step so the case stops on the exact
      // first step that produces an enemy death rather than after the rest of
      // the presentation frame has already advanced.
      let remainingFrameMs = deltaMs
      while (
        remainingFrameMs > EPSILON
        && runtime.phase === 'active'
        && runtime.enemies.every((enemy) => (
          enemy.phase === 'active' && enemy.integrity > 0
        ))
      ) {
        const stepDeltaMs = Math.min(
          remainingFrameMs,
          RESOURCE_SNAKE_CONFIG.fixedStepMs,
        )
        runtime = advanceResourceSnakeFrame(runtime, frameInput, stepDeltaMs)
        suppressValidationPlayerTrail()
        remainingFrameMs -= stepDeltaMs
      }
    } else {
      runtime = advanceResourceSnakeFrame(runtime, frameInput, deltaMs)
      suppressValidationPlayerTrail()
    }
    if (
      diagnostics
      && process.env.RESOURCE_SNAKE_CYAN_CASE_DIAGNOSTIC === traceKey
    ) {
      for (const enemy of runtime.enemies) {
        const priorEnemy = prior.enemies.find((candidate) => candidate.id === enemy.id)
        if (
          !priorEnemy
          || priorEnemy.heading === enemy.heading
          || !enemy.enemyTurnGovernor
        ) continue
        const nearbyTrails = [prior.player, ...prior.enemies]
          .flatMap((owner) => owner.trail.map((dot) => ({
            ownerId: owner.id,
            ...dot,
            distance: Math.hypot(
              dot.position.x - priorEnemy.position.x,
              dot.position.y - priorEnemy.position.y,
            ),
          })))
          .sort((left, right) => left.distance - right.distance)
          .slice(0, 20)
        diagnostics.push(JSON.stringify({
          atMs: enemy.enemyTurnGovernor.lastHeadingChangeAtMs,
          observedAtMs: runtime.simulationMs,
          issue: 'heading-change',
          actorId: enemy.id,
          cause: enemy.enemyTurnGovernor.lastTurnCause,
          from: priorEnemy.heading,
          to: enemy.heading,
          priorPosition: priorEnemy.position,
          nextPosition: enemy.position,
          maximumSpeedPerSecond: enemy.maximumSpeedPerSecond,
          requestedCommand: controlled.commands[enemy.id],
          requestedSchedule: controlled.commandSchedules[enemy.id],
          controller: controlled.state.enemies[enemy.id],
          governorBefore: priorEnemy.enemyTurnGovernor,
          governorAfter: enemy.enemyTurnGovernor,
          headingSafetyBefore: ALL_HEADINGS.map((heading) => (
            evaluateResourceSnakeEnemyHeadingSafety(prior, enemy.id, heading)
          )),
          cooldownHeadingSafetyBefore: ALL_HEADINGS.map((heading) => (
            evaluateResourceSnakeEnemyHeadingSafety(
              prior,
              enemy.id,
              heading,
              RESOURCE_SNAKE_CONFIG.enemyEmergencyCooldownMs
                + RESOURCE_SNAKE_CONFIG.fixedStepMs * 4,
            )
          )),
          nearbyTrails,
        }))
      }
    }
    observeNewEvents(prior, runtime, metrics, diagnostics, {
      commands: controlled.commands,
      commandSchedules: controlled.commandSchedules,
      controller: controlled.state,
      snapshot,
    })
    observeMotion(
      runtime,
      runtime.simulationMs > prior.simulationMs + EPSILON,
      controlled.commands,
      metrics,
    )
    history.push({
      simulationMs: runtime.simulationMs,
      position: { ...runtime.player.position },
      velocity: { ...runtime.player.velocity },
    })
    if (history.length > 240) history.shift()
    frameIndex += 1
  }

  const activeElapsedMs = Math.max(0, runtime.simulationMs - activeStartedAtMs)
  const completedDuration = activeElapsedMs + EPSILON >= activeSimulationMs
  if (completedDuration) metrics.completedDurationCases += 1
  metrics.observedActiveSimulationMs += completedDuration
    ? activeSimulationMs
    : Math.min(activeSimulationMs, activeElapsedMs)

  if (stopOnFirstEnemyDeath) {
    const firstEnemyDeathAtMs = runtime.events
      .filter((event): event is Extract<ResourceSnakeEvent, { type: 'snake-died' }> => (
        event.type === 'snake-died' && event.actorId !== 'player'
      ))
      .reduce((earliest, event) => Math.min(earliest, event.startedAtMs), Infinity)
    if (Number.isFinite(firstEnemyDeathAtMs)) {
      metrics.enemyDeathStopLagMs += Math.max(
        0,
        runtime.simulationMs - firstEnemyDeathAtMs,
      )
    }
  }

  const deathActorIds = new Set(runtime.events.flatMap((event) => (
    event.type === 'snake-died' ? [event.actorId] : []
  )))
  metrics.enemyDeaths += runtime.enemies.filter((enemy) => (
    deathActorIds.has(enemy.id) || enemy.integrity <= 0
  )).length
  if (deathActorIds.has('player') || runtime.player.integrity <= 0) {
    metrics.playerDeaths += 1
  }

  if (runtime.phase !== 'active') {
    metrics.prematureRoundEnds += 1
    diagnostics?.push(JSON.stringify({
      atMs: runtime.simulationMs,
      issue: 'premature-round-end',
      phase: runtime.phase,
      player: {
        phase: runtime.player.phase,
        integrity: runtime.player.integrity,
      },
      enemies: runtime.enemies.map((enemy) => ({
        id: enemy.id,
        phase: enemy.phase,
        integrity: enemy.integrity,
      })),
      lastEvents: runtime.events.slice(-8),
    }))
  }
  for (const enemy of encounter.setup.enemies) {
    if (!committed.has(enemy.id)) metrics.missingCommitments += 1
    if (!telegraphed.has(enemy.id)) metrics.missingTelegraphs += 1
  }
  metrics.cases += 1
  return fingerprint
}

function percentile95(values: readonly number[]): number {
  if (values.length === 0) return Infinity
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_DIAGNOSTIC === '1')(
  'cyan lightcycle focused diagnostics',
  () => {
    it('reports one representative seed per stage and policy', { timeout: 60_000 }, () => {
      const reports = STAGES.flatMap(({ stage, successfulDeposits }) => (
        POLICIES.map((policy) => {
          const metrics = emptyMetrics()
          const diagnostics: string[] = []
          const singleEnemyPlanningMs: number[] = []
          const dualEnemyPlanningMs: number[] = []
          runSimulationCase(
            { stage, successfulDeposits, policy, seed: 0 },
            metrics,
            singleEnemyPlanningMs,
            dualEnemyPlanningMs,
            diagnostics,
          )
          return { stage, policy, metrics, diagnostics }
        })
      ))
      process.stdout.write(`RESOURCE_SNAKE_CYAN_DIAGNOSTIC ${JSON.stringify(reports)}\n`)
      expect(reports).toHaveLength(15)
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_COLLISION_DIAGNOSTIC === '1')(
  'cyan lightcycle collision diagnostics',
  () => {
    it('keeps the two reproduced head contacts out of self and ally faults', () => {
      const reports = [13, 29].map((seed) => {
        const metrics = emptyMetrics()
        const diagnostics: string[] = []
        runSimulationCase(
          { stage: 'cyan-intro', successfulDeposits: 0, policy: 'alternating', seed },
          metrics,
          [],
          [],
          diagnostics,
        )
        return { seed, metrics, diagnostics }
      })
      process.stdout.write(`RESOURCE_SNAKE_CYAN_COLLISIONS ${JSON.stringify(reports)}\n`)
      expect(reports.map(({ metrics }) => ({
        self: metrics.unforcedSelfCollisions,
        ally: metrics.unforcedAllyCollisions,
        boundary: metrics.unforcedBoundaryCollisions,
        bypass: metrics.collisionBypasses,
        fallback: metrics.fallbacks,
        unsafeRecovery: metrics.unsafeRecoveries,
      }))).toEqual([
        { self: 0, ally: 0, boundary: 0, bypass: 0, fallback: 0, unsafeRecovery: 0 },
        { self: 0, ally: 0, boundary: 0, bypass: 0, fallback: 0, unsafeRecovery: 0 },
      ])
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_RECOVERY_DIAGNOSTIC === '1')(
  'cyan lightcycle recovery diagnostics',
  () => {
    it('replays the five fixed unsafe or boundary recovery cases', () => {
      const fixedCases = [
        { stage: 'cyan-intro', successfulDeposits: 0, policy: 'alternating', seed: 11 },
        { stage: 'cyan-intro', successfulDeposits: 0, policy: 'alternating', seed: 12 },
        { stage: 'cyan-intro', successfulDeposits: 0, policy: 'alternating', seed: 35 },
        { stage: 'cyan-dual-role', successfulDeposits: 12, policy: 'counter-clockwise', seed: 2 },
        { stage: 'cyan-dual-role', successfulDeposits: 12, policy: 'counter-clockwise', seed: 4 },
      ] as const satisfies readonly CyanSimulationCase[]
      const reports = fixedCases.map((testCase) => {
        const metrics = emptyMetrics()
        const diagnostics: string[] = []
        runSimulationCase(testCase, metrics, [], [], diagnostics)
        return { testCase, metrics, diagnostics }
      })
      process.stdout.write(`RESOURCE_SNAKE_CYAN_RECOVERIES ${JSON.stringify(reports)}\n`)
      expect(reports.map(({ metrics }) => ({
        boundary: metrics.unforcedBoundaryCollisions,
        self: metrics.unforcedSelfCollisions,
        ally: metrics.unforcedAllyCollisions,
        fallback: metrics.fallbacks,
        unsafeRecovery: metrics.unsafeRecoveries,
      }))).toEqual(Array.from({ length: 5 }, () => ({
        boundary: 0,
        self: 0,
        ally: 0,
        fallback: 0,
        unsafeRecovery: 0,
      })))
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_BOUNDARY_STAGE)(
  'cyan lightcycle boundary diagnostics',
  () => {
    it('reports only boundary-failing cases in one requested stage', { timeout: 90_000 }, () => {
      const requestedStage = process.env.RESOURCE_SNAKE_CYAN_BOUNDARY_STAGE
      const reports = VALIDATION_CASES
        .filter((testCase) => testCase.stage === requestedStage)
        .flatMap((testCase) => {
          const metrics = emptyMetrics()
          const diagnostics: string[] = []
          runSimulationCase(testCase, metrics, [], [], diagnostics)
          return (
            metrics.unforcedBoundaryCollisions
            + metrics.unforcedSelfCollisions
            + metrics.unforcedAllyCollisions
          ) > 0
            ? [{ testCase, metrics, diagnostics }]
            : []
        })
      process.stdout.write(`RESOURCE_SNAKE_CYAN_BOUNDARIES ${JSON.stringify({
        requestedStage,
        casesRun: VALIDATION_CASES.filter((entry) => entry.stage === requestedStage).length,
        reports,
      })}\n`)
      expect(reports.every(({ metrics }) => metrics.collisionBypasses === 0)).toBe(true)
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_CASE_DIAGNOSTIC)(
  'cyan lightcycle single-case diagnostics',
  () => {
    it('traces one requested case around its boundary approach', () => {
      const requested = process.env.RESOURCE_SNAKE_CYAN_CASE_DIAGNOSTIC!
      const testCase = [...VALIDATION_CASES, ...LONG_SURVIVAL_CASES].find((entry) => (
        `${entry.stage}:${entry.policy}:${entry.seed}` === requested
      ))
      expect(testCase).toBeDefined()
      const metrics = emptyMetrics()
      const diagnostics: string[] = []
      const requestedDurationMs = Number(
        process.env.RESOURCE_SNAKE_CYAN_CASE_DURATION_MS ?? ACTIVE_SIMULATION_MS,
      )
      const requestedPlayerTurnIntervalMs = Number(
        process.env.RESOURCE_SNAKE_CYAN_CASE_PLAYER_TURN_INTERVAL_MS,
      )
      runSimulationCase(
        testCase!,
        metrics,
        [],
        [],
        diagnostics,
        Number.isFinite(requestedDurationMs) && requestedDurationMs > 0
          ? requestedDurationMs
          : ACTIVE_SIMULATION_MS,
        process.env.RESOURCE_SNAKE_CYAN_CASE_PROTECT_PLAYER === '1',
        Number.isFinite(requestedPlayerTurnIntervalMs) && requestedPlayerTurnIntervalMs > 0
          ? requestedPlayerTurnIntervalMs
          : undefined,
        process.env.RESOURCE_SNAKE_CYAN_CASE_SUPPRESS_PLAYER_TRAIL === '1',
        process.env.RESOURCE_SNAKE_CYAN_CASE_STOP_ON_DEATH === '1',
      )
      const parsedDiagnostics = diagnostics.map(
        (entry) => JSON.parse(entry) as Record<string, unknown>,
      )
      const collisionTimes = parsedDiagnostics
        .filter((entry) => entry.issue === 'collision')
        .map((entry) => Number(entry.atMs))
        .filter(Number.isFinite)
      const deathTimes = parsedDiagnostics
        .filter((entry) => entry.issue === 'enemy-death')
        .map((entry) => Number(entry.atMs))
        .filter(Number.isFinite)
      const deathActorIds = new Set(parsedDiagnostics
        .filter((entry) => entry.issue === 'enemy-death')
        .map((entry) => String(entry.actorId)))
      const deathOnly = process.env.RESOURCE_SNAKE_CYAN_CASE_DEATH_ONLY === '1'
      const requestedLookbackMs = Number(
        process.env.RESOURCE_SNAKE_CYAN_CASE_LOOKBACK_MS ?? 1_200,
      )
      const headingChangeLookbackMs = Number.isFinite(requestedLookbackMs)
        && requestedLookbackMs > 0
        ? requestedLookbackMs
        : 1_200
      const relevantCollisionTimes = deathOnly ? deathTimes : collisionTimes
      const reportedDiagnostics = process.env.RESOURCE_SNAKE_CYAN_CASE_COMPACT === '1'
        ? parsedDiagnostics
            .filter((entry) => (
              entry.issue === 'enemy-death'
              || entry.issue === 'missing-plan'
              || (
                entry.issue === 'collision'
                && (
                  !deathOnly
                  || relevantCollisionTimes.some((atMs) => (
                    atMs >= Number(entry.atMs)
                    && atMs - Number(entry.atMs) <= headingChangeLookbackMs
                  ))
                )
              )
              || entry.issue === 'premature-round-end'
              || (
                entry.issue === 'planning-cycle'
                && relevantCollisionTimes.some((collisionAtMs) => (
                  collisionAtMs >= Number(entry.atMs)
                  && collisionAtMs - Number(entry.atMs) <= headingChangeLookbackMs
                ))
              )
              || (
                entry.issue === 'heading-change'
                && (!deathOnly || deathActorIds.has(String(entry.actorId)))
                && relevantCollisionTimes.some((collisionAtMs) => (
                  collisionAtMs >= Number(entry.observedAtMs)
                  && collisionAtMs - Number(entry.observedAtMs) <= headingChangeLookbackMs
                ))
              )
            ))
            .map((entry) => {
              const compactSafety = (value: unknown) => (
                Array.isArray(value)
                  ? value
                      .filter((candidate): candidate is Record<string, unknown> => (
                        candidate !== null && typeof candidate === 'object'
                      ))
                      .map((candidate) => ({
                        heading: candidate.heading,
                        collisionAtMs: candidate.collisionAtMs,
                        clearance: candidate.clearance,
                      }))
                  : undefined
              )
              if (entry.issue === 'collision') {
                return {
                  atMs: entry.atMs,
                  issue: entry.issue,
                  kind: entry.kind,
                  actorIds: entry.actorIds,
                  collisionKind: entry.collisionKind,
                  obstacleOwnerId: entry.obstacleOwnerId,
                  point: entry.point,
                  actors: Array.isArray(entry.actors)
                    ? entry.actors.map((value) => {
                        const actor = value as Record<string, unknown>
                        return {
                          actorId: actor.actorId,
                          position: actor.position,
                          heading: actor.heading,
                          enemyTurnGovernor: actor.enemyTurnGovernor,
                          command: actor.command,
                          aiPhase: actor.aiPhase,
                          plan: actor.plan,
                          headingSafety: compactSafety(actor.headingSafety),
                          nearbyTrails: actor.nearbyTrails,
                        }
                      })
                    : undefined,
                }
              }
              if (entry.issue !== 'heading-change') return entry
              return {
                atMs: entry.atMs,
                observedAtMs: entry.observedAtMs,
                issue: entry.issue,
                actorId: entry.actorId,
                cause: entry.cause,
                from: entry.from,
                to: entry.to,
                priorPosition: entry.priorPosition,
                nextPosition: entry.nextPosition,
                requestedCommand: entry.requestedCommand,
                requestedSchedule: entry.requestedSchedule,
                controller: entry.controller && (() => {
                  const controller = entry.controller as Record<string, unknown>
                  const plan = controller.plan as Record<string, unknown> | null | undefined
                  return {
                    phase: controller.phase,
                    recoveryHeading: controller.recoveryHeading,
                    advertisedHeading: controller.advertisedHeading,
                    safePlanConfirmations: controller.safePlanConfirmations,
                    plan: plan && {
                      plannedAtMs: plan.plannedAtMs,
                      commandAtMs: plan.commandAtMs,
                      commitUntilMs: plan.commitUntilMs,
                      originHeading: plan.originHeading,
                      attackHeading: plan.attackHeading,
                      headingChanges: plan.headingChanges,
                      fallback: plan.fallback,
                    },
                  }
                })(),
                governorBefore: entry.governorBefore,
                governorAfter: entry.governorAfter,
                headingSafetyBefore: compactSafety(entry.headingSafetyBefore),
                cooldownHeadingSafetyBefore: compactSafety(
                  entry.cooldownHeadingSafetyBefore,
                ),
              }
            })
        : diagnostics
      process.stdout.write(`RESOURCE_SNAKE_CYAN_CASE ${JSON.stringify({
        testCase,
        metrics,
        diagnostics: reportedDiagnostics,
      })}\n`)
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_SCHEDULE_REGRESSION === '1')(
  'cyan lightcycle scheduled-turn regressions',
  () => {
    it('keeps all twelve reproduced dual-role paths off the top boundary', () => {
      const fixedCases = [6, 14, 22, 30, 38, 46].flatMap((seed) => ([
        { stage: 'cyan-dual-role', successfulDeposits: 12, policy: 'clockwise', seed },
        { stage: 'cyan-dual-role', successfulDeposits: 12, policy: 'alternating', seed },
      ] as const)) satisfies readonly CyanSimulationCase[]
      const reports = fixedCases.map((testCase) => {
        const metrics = emptyMetrics()
        const diagnostics: string[] = []
        runSimulationCase(testCase, metrics, [], [], diagnostics)
        return { testCase, metrics, diagnostics }
      })
      process.stdout.write(`RESOURCE_SNAKE_CYAN_SCHEDULE_REGRESSIONS ${JSON.stringify(reports)}\n`)
      expect(reports.map(({ metrics }) => ({
        boundary: metrics.unforcedBoundaryCollisions,
        self: metrics.unforcedSelfCollisions,
        ally: metrics.unforcedAllyCollisions,
      }))).toEqual(Array.from({ length: 12 }, () => ({
        boundary: 0,
        self: 0,
        ally: 0,
      })))
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_SELF_REGRESSION === '1')(
  'cyan lightcycle recovery-origin regressions',
  () => {
    it('keeps all five reproduced intro recoveries off their own mature rail', () => {
      const fixedCases = [2, 10, 18, 26, 42].map((seed) => ({
        stage: 'cyan-intro',
        successfulDeposits: 0,
        policy: 'alternating',
        seed,
      } as const satisfies CyanSimulationCase))
      const reports = fixedCases.map((testCase) => {
        const metrics = emptyMetrics()
        const diagnostics: string[] = []
        runSimulationCase(testCase, metrics, [], [], diagnostics)
        return { testCase, metrics, diagnostics }
      })
      process.stdout.write(`RESOURCE_SNAKE_CYAN_SELF_REGRESSIONS ${JSON.stringify(reports)}\n`)
      expect(reports.map(({ metrics }) => ({
        boundary: metrics.unforcedBoundaryCollisions,
        self: metrics.unforcedSelfCollisions,
        ally: metrics.unforcedAllyCollisions,
      }))).toEqual(Array.from({ length: 5 }, () => ({
        boundary: 0,
        self: 0,
        ally: 0,
      })))
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_LONG_ACCEPTANCE === '1')(
  'cyan lightcycle 50-seed death-capped survival acceptance',
  () => {
    it('runs 50 unique seeds until first enemy death or 80 simulated seconds', {
      timeout: 1_200_000,
    }, () => {
      expect(LONG_SURVIVAL_CASES).toHaveLength(50)
      expect(new Set(LONG_SURVIVAL_CASES.map((entry) => entry.seed)).size).toBe(50)

      const metrics = emptyMetrics()
      const stageCounts: Record<string, number> = {}
      const policyCounts: Record<string, number> = {}
      const caseFailures: Array<{
        testCase: CyanSimulationCase
        completedDurationCases: number
        observedActiveSimulationMs: number
        enemyDeaths: number
        enemySelfDeaths: number
        enemyBoundaryDeaths: number
        enemyAllyDeaths: number
        playerCausedEnemyDeaths: number
        unknownEnemyDeaths: number
        playerDeaths: number
        zeroSpeedSamples: number
        zeroCommands: number
        collisionBypasses: number
        unsafeRecovery: number
        missingPlans: number
        telegraphViolations: number
        prematureRoundEnds: number
      }> = []
      const caseCollisionObservations: Array<{
        testCase: CyanSimulationCase
        self: number
        ally: number
        boundary: number
      }> = []

      for (const testCase of LONG_SURVIVAL_CASES) {
        const before = { ...metrics }
        runSimulationCase(
          testCase,
          metrics,
          [],
          [],
          undefined,
          LONG_SURVIVAL_SIMULATION_MS,
          true,
          LONG_SURVIVAL_PLAYER_TURN_INTERVAL_MS,
          true,
          true,
        )
        const failure = {
          testCase,
          completedDurationCases: metrics.completedDurationCases - before.completedDurationCases,
          observedActiveSimulationMs:
            metrics.observedActiveSimulationMs - before.observedActiveSimulationMs,
          enemyDeaths: metrics.enemyDeaths - before.enemyDeaths,
          enemySelfDeaths: metrics.enemySelfDeaths - before.enemySelfDeaths,
          enemyBoundaryDeaths: metrics.enemyBoundaryDeaths - before.enemyBoundaryDeaths,
          enemyAllyDeaths: metrics.enemyAllyDeaths - before.enemyAllyDeaths,
          playerCausedEnemyDeaths:
            metrics.playerCausedEnemyDeaths - before.playerCausedEnemyDeaths,
          unknownEnemyDeaths: metrics.unknownEnemyDeaths - before.unknownEnemyDeaths,
          playerDeaths: metrics.playerDeaths - before.playerDeaths,
          zeroSpeedSamples: metrics.zeroSpeedSamples - before.zeroSpeedSamples,
          zeroCommands: metrics.zeroCommands - before.zeroCommands,
          collisionBypasses: metrics.collisionBypasses - before.collisionBypasses,
          unsafeRecovery: metrics.unsafeRecoveries - before.unsafeRecoveries,
          missingPlans: metrics.missingPlans - before.missingPlans,
          telegraphViolations: metrics.telegraphViolations - before.telegraphViolations,
          prematureRoundEnds: metrics.prematureRoundEnds - before.prematureRoundEnds,
        }
        if (
          failure.completedDurationCases !== 1
          || failure.observedActiveSimulationMs !== LONG_SURVIVAL_SIMULATION_MS
          || failure.enemyDeaths > 0
          || failure.playerDeaths > 0
          || failure.zeroSpeedSamples > 0
          || failure.zeroCommands > 0
          || failure.collisionBypasses > 0
          || failure.unsafeRecovery > 0
          || failure.missingPlans > 0
          || failure.telegraphViolations > 0
          || failure.prematureRoundEnds > 0
        ) {
          caseFailures.push(failure)
        }
        const collisionObservation = {
          testCase,
          self: metrics.unforcedSelfCollisions - before.unforcedSelfCollisions,
          ally: metrics.unforcedAllyCollisions - before.unforcedAllyCollisions,
          boundary: metrics.unforcedBoundaryCollisions - before.unforcedBoundaryCollisions,
        }
        if (
          collisionObservation.self > 0
          || collisionObservation.ally > 0
          || collisionObservation.boundary > 0
        ) caseCollisionObservations.push(collisionObservation)
        stageCounts[testCase.stage] = (stageCounts[testCase.stage] ?? 0) + 1
        policyCounts[testCase.policy] = (policyCounts[testCase.policy] ?? 0) + 1
      }

      const report = {
        maximumDurationMsPerSeed: LONG_SURVIVAL_SIMULATION_MS,
        maximumTotalSimulatedMs:
          LONG_SURVIVAL_CASES.length * LONG_SURVIVAL_SIMULATION_MS,
        stopOnFirstEnemyDeath: true,
        protectedPlayer: true,
        playerTrailSuppressed: true,
        ...metrics,
        stageCounts,
        policyCounts,
        caseFailures,
        caseCollisionObservations,
      }
      process.stdout.write(`RESOURCE_SNAKE_CYAN_LONG_ACCEPTANCE ${JSON.stringify(report)}\n`)

      expect(report).toMatchObject({
        maximumDurationMsPerSeed: 80_000,
        maximumTotalSimulatedMs: 4_000_000,
        stopOnFirstEnemyDeath: true,
        protectedPlayer: true,
        playerTrailSuppressed: true,
        cases: 50,
        completedDurationCases: 50,
        observedActiveSimulationMs: 4_000_000,
        enemyDeathStopLagMs: 0,
        enemyDeaths: 0,
        playerDeaths: 0,
        stageCounts: {
          'cyan-intro': 17,
          'cyan-advanced': 17,
          'cyan-dual-role': 16,
        },
        policyCounts: {
          'space-maximizer': 50,
        },
        duplicateReservations: 0,
        zeroSpeedSamples: 0,
        zeroCommands: 0,
        missingPlans: 0,
        missingCommitments: 0,
        missingTelegraphs: 0,
        telegraphViolations: 0,
        responsePathViolations: 0,
        predictedSuicides: 0,
        fallbacks: 0,
        unsafeRecoveries: 0,
        collisionBypasses: 0,
        futureInputReads: 0,
        roleSeparationViolations: 0,
        prematureRoundEnds: 0,
      })
      expect(caseFailures).toHaveLength(0)
    })
  },
)

describe.runIf(process.env.RESOURCE_SNAKE_CYAN_LONG_PREFLIGHT === '1')(
  'cyan lightcycle long-survival preflight diagnostics',
  () => {
    it('samples the 80-second death-capped gate at every fifth seed', { timeout: 300_000 }, () => {
      const cases = LONG_SURVIVAL_CASES.filter((_, index) => index % 5 === 0)
      const aggregate = emptyMetrics()
      const reports = cases.map((testCase) => {
        const metrics = emptyMetrics()
        runSimulationCase(
          testCase,
          metrics,
          [],
          [],
          undefined,
          LONG_SURVIVAL_SIMULATION_MS,
          true,
          LONG_SURVIVAL_PLAYER_TURN_INTERVAL_MS,
          true,
          true,
        )
        for (const key of Object.keys(aggregate) as Array<keyof SimulationMetrics>) {
          aggregate[key] += metrics[key]
        }
        return { testCase, metrics }
      })
      const failures = reports.filter(({ metrics }) => (
        metrics.completedDurationCases !== 1
        || metrics.observedActiveSimulationMs !== LONG_SURVIVAL_SIMULATION_MS
        || metrics.enemyDeaths > 0
        || metrics.playerDeaths > 0
        || metrics.unforcedBoundaryCollisions > 0
        || metrics.unforcedSelfCollisions > 0
        || metrics.unforcedAllyCollisions > 0
        || metrics.zeroSpeedSamples > 0
        || metrics.zeroCommands > 0
        || metrics.missingPlans > 0
        || metrics.unsafeRecoveries > 0
        || metrics.prematureRoundEnds > 0
      )).map(({ testCase, metrics }) => ({
        testCase,
        completed: metrics.completedDurationCases,
        observedMs: metrics.observedActiveSimulationMs,
        enemyDeaths: metrics.enemyDeaths,
        enemySelfDeaths: metrics.enemySelfDeaths,
        enemyBoundaryDeaths: metrics.enemyBoundaryDeaths,
        enemyAllyDeaths: metrics.enemyAllyDeaths,
        playerCausedEnemyDeaths: metrics.playerCausedEnemyDeaths,
        unknownEnemyDeaths: metrics.unknownEnemyDeaths,
        playerDeaths: metrics.playerDeaths,
        boundary: metrics.unforcedBoundaryCollisions,
        self: metrics.unforcedSelfCollisions,
        ally: metrics.unforcedAllyCollisions,
        missingPlans: metrics.missingPlans,
        unsafeRecoveries: metrics.unsafeRecoveries,
        prematureRoundEnds: metrics.prematureRoundEnds,
      }))
      process.stdout.write(`RESOURCE_SNAKE_CYAN_LONG_PREFLIGHT ${JSON.stringify({
        durationMsPerSeed: LONG_SURVIVAL_SIMULATION_MS,
        aggregate,
        failures,
      })}\n`)
      expect(reports).toHaveLength(10)
    })
  },
)

describe('cyan lightcycle sustained acceptance simulation', () => {
  it('records a protected observation as completed without confusing collisions with deaths', () => {
    const metrics = emptyMetrics()
    runSimulationCase(
      { stage: 'cyan-intro', successfulDeposits: 0, policy: 'space-maximizer', seed: 0 },
      metrics,
      [],
      [],
      undefined,
      100,
      true,
    )

    expect(metrics).toMatchObject({
      cases: 1,
      completedDurationCases: 1,
      observedActiveSimulationMs: 100,
      enemyDeaths: 0,
      playerDeaths: 0,
    })
  })

  it('covers five twelve-second runs in each encounter stage', () => {
    expect(SUSTAINED_CASES).toHaveLength(15)
    expect(new Set(SUSTAINED_CASES.map((entry) => (
      `${entry.stage}:${entry.policy}:${entry.seed}`
    ))).size).toBe(15)
  })

  it('keeps every hunter fast, readable, deterministic, and collision-authoritative', {
    timeout: 180_000,
  }, () => {
    const metrics = emptyMetrics()
    const cellCounts: Record<string, number> = {}
    const caseFailures: Array<{
      testCase: CyanSimulationCase
      self: number
      ally: number
      boundary: number
      unsafeRecovery: number
      missingPlans: number
      telegraphViolations: number
      prematureRoundEnds: number
    }> = []
    const singleEnemyPlanningMs: number[] = []
    const dualEnemyPlanningMs: number[] = []

    for (const testCase of SUSTAINED_CASES) {
      const before = { ...metrics }
      runSimulationCase(
        testCase,
        metrics,
        singleEnemyPlanningMs,
        dualEnemyPlanningMs,
        undefined,
        ACTIVE_SIMULATION_MS,
      )
      const failure = {
        testCase,
        self: metrics.unforcedSelfCollisions - before.unforcedSelfCollisions,
        ally: metrics.unforcedAllyCollisions - before.unforcedAllyCollisions,
        boundary: metrics.unforcedBoundaryCollisions - before.unforcedBoundaryCollisions,
        unsafeRecovery: metrics.unsafeRecoveries - before.unsafeRecoveries,
        missingPlans: metrics.missingPlans - before.missingPlans,
        telegraphViolations: metrics.telegraphViolations - before.telegraphViolations,
        prematureRoundEnds: metrics.prematureRoundEnds - before.prematureRoundEnds,
      }
      if (Object.values(failure).some((value) => typeof value === 'number' && value > 0)) {
        caseFailures.push(failure)
      }
      const cell = testCase.stage
      cellCounts[cell] = (cellCounts[cell] ?? 0) + 1
    }

    const report = {
      ...metrics,
      cells: Object.keys(cellCounts).length,
      minimumCellCount: Math.min(...Object.values(cellCounts)),
      maximumCellCount: Math.max(...Object.values(cellCounts)),
      singleEnemyPlanningSamples: singleEnemyPlanningMs.length,
      singleEnemyPlanningP95Ms: percentile95(singleEnemyPlanningMs),
      dualEnemyPlanningSamples: dualEnemyPlanningMs.length,
      dualEnemyPlanningP95Ms: percentile95(dualEnemyPlanningMs),
      caseFailures,
    }
    process.stdout.write(`RESOURCE_SNAKE_CYAN_SIMULATION ${JSON.stringify(report)}\n`)

    expect(report.cases).toBe(15)
    expect(report.cells).toBe(3)
    expect(report.minimumCellCount).toBe(5)
    expect(report.maximumCellCount).toBe(5)
    expect(report.singleEnemyPlanningSamples).toBeGreaterThan(0)
    expect(report.dualEnemyPlanningSamples).toBe(0)
    expect(report).toMatchObject({
      duplicateReservations: 0,
      completedDurationCases: 15,
      observedActiveSimulationMs: 180_000,
      enemyDeaths: 0,
      playerDeaths: 0,
      unforcedBoundaryCollisions: 0,
      unforcedSelfCollisions: 0,
      unforcedAllyCollisions: 0,
      zeroSpeedSamples: 0,
      zeroCommands: 0,
      missingPlans: 0,
      missingCommitments: 0,
      missingTelegraphs: 0,
      telegraphViolations: 0,
      responsePathViolations: 0,
      predictedSuicides: 0,
      fallbacks: 0,
      unsafeRecoveries: 0,
      collisionBypasses: 0,
      futureInputReads: 0,
      roleSeparationViolations: 0,
      prematureRoundEnds: 0,
    })
    if (process.env.RESOURCE_SNAKE_PERF_ACCEPTANCE === '1') {
      expect(report.singleEnemyPlanningP95Ms).toBeLessThanOrEqual(3)
      // The approved first-release encounter has exactly one resource bot.
      // Restore a measured dual-bot budget when multi-bot rounds are enabled.
    }
  })
})
