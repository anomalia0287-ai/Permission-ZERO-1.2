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
  flushResourceSnakeRuntimeChord,
  pressResourceSnakeRuntimeKey,
  releaseResourceSnakeRuntimeKey,
  RESOURCE_SNAKE_CONFIG,
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

const ACTIVE_SIMULATION_MS = 1_150
const EPSILON = 1e-8

function emptyMetrics(): SimulationMetrics {
  return {
    cases: 0,
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
): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    heading: actor.heading,
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond,
    collisionGraceMs: actor.collisionGraceMs,
    distanceSinceTrailDot: actor.distanceSinceTrailDot,
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
    player: plannerActor(runtime.player, roles),
    enemies: runtime.enemies.map((enemy) => plannerActor(enemy, roles)),
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

function spaceMaximizingHeading(runtime: ResourceSnakeRoundState, seed: number): SnakeDirection8 {
  const current = SNAKE_DIRECTION_VECTORS[runtime.player.heading]
  const hazards = [runtime.player, ...runtime.enemies].flatMap((actor) => (
    actor.trail.map((dot) => dot.position)
  ))
  let bestHeading = runtime.player.heading
  let bestScore = -Infinity
  for (let index = 0; index < ALL_HEADINGS.length; index += 1) {
    const heading = ALL_HEADINGS[index]
    const direction = SNAKE_DIRECTION_VECTORS[heading]
    if (current.x * direction.x + current.y * direction.y < -0.999_999) continue
    let score = Infinity
    for (let step = 1; step <= 5; step += 1) {
      const sample = {
        x: runtime.player.position.x + direction.x * step * 1.2,
        y: runtime.player.position.y + direction.y * step * 1.2,
      }
      score = Math.min(score, wallClearance(sample))
      for (const hazard of hazards) {
        score = Math.min(score, Math.hypot(sample.x - hazard.x, sample.y - hazard.y) - 0.5)
      }
    }
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
  if (wallClearance(event.point) <= 0.08) return 'boundary'
  if (event.actorIds.length >= 2) return enemyIds.length >= 2 ? 'ally' : null
  const enemyId = enemyIds[0]
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
  for (const collision of collisions) {
    const kind = classifyCollision(collision, prior)
    if (kind === 'boundary') metrics.unforcedBoundaryCollisions += 1
    else if (kind === 'self') metrics.unforcedSelfCollisions += 1
    else if (kind === 'ally') metrics.unforcedAllyCollisions += 1
    if (!collision.actorIds.some((actorId) => damaged.has(actorId))) {
      metrics.collisionBypasses += 1
    }
    if (diagnostics && diagnostics.length < 12) diagnostics.push(JSON.stringify({
      atMs: next.simulationMs,
      issue: 'collision',
      kind,
      actorIds: collision.actorIds,
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
    if (
      !plan
      || plan.commandAtMs - plan.plannedAtMs < 160
      || plan.commitUntilMs <= plan.commandAtMs
      || plan.path.length === 0
    ) metrics.telegraphViolations += 1
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
  const turnIntervalMs = 230 + (testCase.seed % 4) * 15
  const activeStartedAtMs = runtime.simulationMs

  while (
    runtime.phase === 'active'
    && runtime.simulationMs - activeStartedAtMs < ACTIVE_SIMULATION_MS - EPSILON
  ) {
    const activeElapsedMs = runtime.simulationMs - activeStartedAtMs
    if (activeElapsedMs + EPSILON >= nextTurnAtMs && turnIndex < 4) {
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
        || telegraph.untilMs - telegraph.startedAtMs < 160
      ) metrics.telegraphViolations += 1
    }

    const traceKey = `${testCase.stage}:${testCase.policy}:${testCase.seed}`
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
      })),
      proposed: (observedGroup as SnakeGroupPlan | null)?.plans.map((plan) => ({
        enemyId: plan.enemyId,
        plannedAtMs: plan.plannedAtMs,
        commandAtMs: plan.commandAtMs,
        commitUntilMs: plan.commitUntilMs,
        attackHeading: plan.attackHeading,
      })),
    }))

    const remainingMs = ACTIVE_SIMULATION_MS - activeElapsedMs
    const deltaMs = frameDelta(testCase.seed, frameIndex, remainingMs)
    const prior = runtime
    runtime = advanceResourceSnakeFrame(runtime, {
      enemyDirections: controlled.commands,
      enemyDirectionSchedules: controlled.commandSchedules,
    }, deltaMs)
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

  if (runtime.phase !== 'active') metrics.prematureRoundEnds += 1
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
      const testCase = VALIDATION_CASES.find((entry) => (
        `${entry.stage}:${entry.policy}:${entry.seed}` === requested
      ))
      expect(testCase).toBeDefined()
      const metrics = emptyMetrics()
      const diagnostics: string[] = []
      runSimulationCase(testCase!, metrics, [], [], diagnostics)
      process.stdout.write(`RESOURCE_SNAKE_CYAN_CASE ${JSON.stringify({
        testCase,
        metrics,
        diagnostics,
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

describe('cyan lightcycle 750-case acceptance simulation', () => {
  it('enumerates exactly three stages by five policies by fifty seeds', () => {
    expect(VALIDATION_CASES).toHaveLength(750)
    expect(new Set(VALIDATION_CASES.map((entry) => (
      `${entry.stage}:${entry.policy}:${entry.seed}`
    ))).size).toBe(750)
  })

  it('keeps every hunter fast, readable, deterministic, and collision-authoritative', {
    timeout: 180_000,
  }, () => {
    const metrics = emptyMetrics()
    const cellCounts: Record<string, number> = {}
    const firstPlans = new Map<string, string>()
    const singleEnemyPlanningMs: number[] = []
    const dualEnemyPlanningMs: number[] = []

    for (const testCase of VALIDATION_CASES) {
      const fingerprint = runSimulationCase(
        testCase,
        metrics,
        singleEnemyPlanningMs,
        dualEnemyPlanningMs,
      )
      const cell = `${testCase.stage}:${testCase.policy}`
      cellCounts[cell] = (cellCounts[cell] ?? 0) + 1
      const futureInputKey = `${testCase.stage}:${testCase.seed}`
      const priorFingerprint = firstPlans.get(futureInputKey)
      if (priorFingerprint === undefined) firstPlans.set(futureInputKey, fingerprint)
      else if (priorFingerprint !== fingerprint) metrics.futureInputReads += 1
    }

    const report = {
      ...metrics,
      cells: Object.keys(cellCounts).length,
      minimumCellCount: Math.min(...Object.values(cellCounts)),
      maximumCellCount: Math.max(...Object.values(cellCounts)),
      futureInputBaselines: firstPlans.size,
      singleEnemyPlanningSamples: singleEnemyPlanningMs.length,
      singleEnemyPlanningP95Ms: percentile95(singleEnemyPlanningMs),
      dualEnemyPlanningSamples: dualEnemyPlanningMs.length,
      dualEnemyPlanningP95Ms: percentile95(dualEnemyPlanningMs),
    }
    process.stdout.write(`RESOURCE_SNAKE_CYAN_SIMULATION ${JSON.stringify(report)}\n`)

    expect(report.cases).toBe(750)
    expect(report.cells).toBe(15)
    expect(report.minimumCellCount).toBe(50)
    expect(report.maximumCellCount).toBe(50)
    expect(report.futureInputBaselines).toBe(150)
    expect(report).toMatchObject({
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
      unsafeRecoveries: 0,
      collisionBypasses: 0,
      futureInputReads: 0,
      roleSeparationViolations: 0,
      prematureRoundEnds: 0,
    })
    expect(report.singleEnemyPlanningP95Ms).toBeLessThanOrEqual(3)
    // The dedicated external gate is the one-enemy 96-candidate planner. A
    // coordinated dual call contains two planners plus reservation work and
    // remains separately bounded well below a frame-long task.
    expect(report.dualEnemyPlanningP95Ms).toBeLessThanOrEqual(8)
  })
})
