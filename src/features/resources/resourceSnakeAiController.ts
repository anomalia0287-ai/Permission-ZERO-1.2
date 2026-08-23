import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import { SNAKE_DIRECTION_VECTORS, type SnakeDirection8 } from './resourceSnakeInput'
import {
  planResourceSnakeGroup,
  resourceSnakePlanIsNewlyFatal,
} from './resourceSnakePlanner'
import type {
  SnakeGroupPlan,
  SnakePlan,
  SnakePlannerSnapshot,
  SnakeVector,
} from './resourceSnakePlannerTypes'
import type { CyanLightcycleProfile } from './resourceSnakeCyanProfile'
import { nextResourceSnakePlanningAtMs } from './resourceSnakeScheduling'
import { resourceSnakeHeadingFromVector } from './resourceSnakeTrajectory'
import type {
  SnakeEnemyDirectionChange,
  SnakeEnemyRole,
  SnakeEnemyTurnPolicy,
  SnakeId,
} from './resourceSnakeRuntime'
import { RESOURCE_SNAKE_CONFIG } from './resourceSnakeRuntime'

export type ResourceSnakeAiPhase =
  | 'deploy'
  | 'cruise'
  | 'telegraph'
  | 'commit'
  | 'recover'
  | 'defeated'

export interface ResourceSnakeAiEnemyState {
  enemyId: SnakeId
  role: SnakeEnemyRole
  phase: ResourceSnakeAiPhase
  phaseStartedAtMs: number
  plan: SnakePlan | null
  advertisedHeading: SnakeDirection8 | null
  recoveryHeading: SnakeDirection8
  safePlanConfirmations: 0 | 1
}

export interface ResourceSnakeAiControllerState {
  enemies: Record<string, ResourceSnakeAiEnemyState>
  roles: Record<string, SnakeEnemyRole>
  nextPlanningAtMs: number
  timingHistoryMs: number[]
}

export interface ResourceSnakeTelegraph {
  enemyId: SnakeId
  role: SnakeEnemyRole
  originHeading: SnakeDirection8
  attackHeading: SnakeDirection8
  startedAtMs: number
  untilMs: number
  path: SnakeVector[]
}

export interface ResourceSnakeAiControllerResult {
  state: ResourceSnakeAiControllerState
  commands: Record<string, SnakeVector>
  commandSchedules: Record<string, SnakeEnemyDirectionChange[]>
  turnPolicies: Record<string, SnakeEnemyTurnPolicy>
  telegraphs: ResourceSnakeTelegraph[]
  planned: boolean
  observedPlanningMs: number
}

export interface ResourceSnakeAiControllerInput {
  snapshot: SnakePlannerSnapshot
  profile: CyanLightcycleProfile
  active: boolean
}

export interface ResourceSnakeAiControllerDependencies {
  planGroup?: (
    snapshot: SnakePlannerSnapshot,
    profile: SnakePlannerProfile,
    previousPlans: readonly SnakePlan[],
    timingHistoryMs: readonly number[],
  ) => SnakeGroupPlan
  planIsFatal?: (snapshot: SnakePlannerSnapshot, plan: SnakePlan) => boolean
  clock?: () => number
}

const EPSILON = 1e-6

function plannerProfile(profile: CyanLightcycleProfile): SnakePlannerProfile {
  return {
    lookaheadMs: profile.lookaheadMs,
    candidateCount: profile.candidateCount,
    planningHz: profile.planningHz,
    commitMs: profile.commitMs,
    minimumHeadingHoldMs: profile.minimumHeadingHoldMs,
    rolloutStepMs: profile.rolloutStepMs,
  }
}

function actorHeading(
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
): SnakeDirection8 {
  const actor = snapshot.enemies.find((candidate) => candidate.id === enemyId)
  if (actor?.heading) return actor.heading
  return resourceSnakeHeadingFromVector(actor?.velocity ?? { x: 0, y: 0 }, 'south')
}

function headingForPlan(
  plan: SnakePlan,
  fallback: SnakeDirection8,
): SnakeDirection8 {
  return plan.attackHeading
    ?? resourceSnakeHeadingFromVector(plan.direction, fallback)
}

function originHeadingForPlan(
  plan: SnakePlan,
  fallback: SnakeDirection8,
): SnakeDirection8 {
  return plan.originHeading
    ?? resourceSnakeHeadingFromVector(plan.originVelocity, fallback)
}

function initialEnemyState(
  snapshot: SnakePlannerSnapshot,
  enemyId: SnakeId,
  role: SnakeEnemyRole,
): ResourceSnakeAiEnemyState {
  return {
    enemyId,
    role,
    phase: 'deploy',
    phaseStartedAtMs: snapshot.simulationMs,
    plan: null,
    advertisedHeading: null,
    recoveryHeading: actorHeading(snapshot, enemyId),
    safePlanConfirmations: 0,
  }
}

export function createResourceSnakeAiControllerState(
  snapshot: SnakePlannerSnapshot,
): ResourceSnakeAiControllerState {
  const enemies: Record<string, ResourceSnakeAiEnemyState> = {}
  const roles: Record<string, SnakeEnemyRole> = {}
  for (const enemy of snapshot.enemies) {
    const role = enemy.role ?? 'pressure'
    roles[enemy.id] = role
    enemies[enemy.id] = initialEnemyState(snapshot, enemy.id, role)
  }
  return {
    enemies,
    roles,
    nextPlanningAtMs: 0,
    timingHistoryMs: [],
  }
}

function beginTelegraph(
  enemy: ResourceSnakeAiEnemyState,
  plan: SnakePlan,
  atMs: number,
): ResourceSnakeAiEnemyState {
  const originHeading = plan.originHeading ?? enemy.recoveryHeading
  return {
    ...enemy,
    role: plan.role,
    phase: 'telegraph',
    phaseStartedAtMs: atMs,
    plan,
    advertisedHeading: headingForPlan(plan, originHeading),
    recoveryHeading: originHeading,
    safePlanConfirmations: 0,
  }
}

function planReadyForTelegraph(
  snapshot: SnakePlannerSnapshot,
  plan: SnakePlan | null,
  planIsFatal: (snapshot: SnakePlannerSnapshot, plan: SnakePlan) => boolean,
): plan is SnakePlan {
  if (
    !plan
    || plan.fallback
    || plan.score.survives !== 1
    || plan.score.responsePathFloor < 1
  ) return false
  try {
    return !planIsFatal(snapshot, plan)
  } catch {
    return false
  }
}

function planTurnCanCommit(
  snapshot: SnakePlannerSnapshot,
  plan: SnakePlan,
  profile: CyanLightcycleProfile,
): boolean {
  const actor = snapshot.enemies.find((candidate) => candidate.id === plan.enemyId)
  if (!actor) return false
  const currentHeading = actor.heading
    ?? resourceSnakeHeadingFromVector(actor.velocity, 'south')
  const requestedHeading = headingForPlan(plan, currentHeading)
  if (requestedHeading === currentHeading) return true
  const governor = actor.enemyTurnGovernor
  if (!governor) return true
  const atMs = plan.commandAtMs
  if (atMs + EPSILON < governor.lockedUntilMs) return false
  if (
    governor.lastHeadingChangeAtMs !== null
    && atMs - governor.lastHeadingChangeAtMs
      < profile.minimumHeadingHoldMs - EPSILON
  ) return false
  const recentNormalTurns = governor.normalTurnAtMs.filter((turnAtMs) => (
    Number.isFinite(turnAtMs)
    && atMs - turnAtMs
      < RESOURCE_SNAKE_CONFIG.enemyNormalTurnWindowMs - EPSILON
  ))
  if (
    recentNormalTurns.length
    >= RESOURCE_SNAKE_CONFIG.enemyMaximumNormalTurnsPerWindow
  ) return false
  if (
    governor.previousHeading === requestedHeading
    && governor.lastHeadingChangeAtMs !== null
    && atMs - governor.lastHeadingChangeAtMs
      < RESOURCE_SNAKE_CONFIG.enemyReturnHeadingLockMs - EPSILON
  ) return false
  return true
}

function planSafeForRecovery(
  snapshot: SnakePlannerSnapshot,
  plan: SnakePlan | null,
  planIsFatal: (snapshot: SnakePlannerSnapshot, plan: SnakePlan) => boolean,
): plan is SnakePlan {
  if (!plan || plan.directions.length === 0 || plan.path.length === 0) return false
  if (plan.commitUntilMs <= snapshot.simulationMs + EPSILON) return false
  try {
    return !planIsFatal(snapshot, plan)
  } catch {
    return false
  }
}

function timedPhase(
  enemy: ResourceSnakeAiEnemyState,
  atMs: number,
): ResourceSnakeAiEnemyState {
  if (!enemy.plan) return enemy
  if (enemy.phase === 'telegraph' && atMs + EPSILON >= enemy.plan.commandAtMs) {
    return { ...enemy, phase: 'commit', phaseStartedAtMs: enemy.plan.commandAtMs }
  }
  if (enemy.phase === 'commit' && atMs + EPSILON >= enemy.plan.commitUntilMs) {
    return {
      ...enemy,
      phase: 'cruise',
      phaseStartedAtMs: enemy.plan.commitUntilMs,
      plan: null,
      advertisedHeading: null,
      safePlanConfirmations: 0,
    }
  }
  return enemy
}

function headingForPlanAtMs(
  plan: SnakePlan,
  atMs: number,
  fallback: SnakeDirection8,
): SnakeDirection8 {
  let heading = plan.originHeading ?? fallback
  for (const change of plan.headingChanges ?? []) {
    if (plan.plannedAtMs + change.offsetMs > atMs + EPSILON) continue
    heading = change.heading
  }
  return heading
}

function commandForEnemy(
  snapshot: SnakePlannerSnapshot,
  enemy: ResourceSnakeAiEnemyState,
): SnakeVector | null {
  if (enemy.phase === 'defeated') return null
  if (enemy.phase === 'recover') {
    const heading = enemy.plan
      ? headingForPlanAtMs(
          enemy.plan,
          snapshot.simulationMs,
          enemy.recoveryHeading,
        )
      : enemy.recoveryHeading
    const direction = SNAKE_DIRECTION_VECTORS[heading]
    return { x: direction.x * 0.92, y: direction.y * 0.92 }
  }
  if (enemy.phase === 'commit' && enemy.plan) {
    const heading = enemy.advertisedHeading
      ?? headingForPlan(enemy.plan, actorHeading(snapshot, enemy.enemyId))
    return { ...SNAKE_DIRECTION_VECTORS[heading] }
  }
  if (enemy.phase === 'telegraph' && enemy.plan) {
    const heading = enemy.plan.originHeading ?? actorHeading(snapshot, enemy.enemyId)
    return { ...SNAKE_DIRECTION_VECTORS[heading] }
  }
  return { ...SNAKE_DIRECTION_VECTORS[actorHeading(snapshot, enemy.enemyId)] }
}

function commandScheduleForEnemy(
  snapshot: SnakePlannerSnapshot,
  enemy: ResourceSnakeAiEnemyState,
  command: SnakeVector,
): SnakeEnemyDirectionChange[] {
  const schedule: SnakeEnemyDirectionChange[] = [{
    atMs: snapshot.simulationMs,
    direction: { ...command },
  }]
  if (
    (enemy.phase !== 'telegraph' && enemy.phase !== 'commit' && enemy.phase !== 'recover')
    || !enemy.plan
    || !enemy.plan.headingChanges
  ) return schedule
  const horizonMs = enemy.plan.plannedAtMs
    + enemy.plan.path.length * enemy.plan.stepMs
  for (const change of enemy.plan.headingChanges) {
    const atMs = enemy.plan.plannedAtMs + change.offsetMs
    if (
      atMs <= snapshot.simulationMs + EPSILON
      || atMs > horizonMs + EPSILON
    ) continue
    const direction = SNAKE_DIRECTION_VECTORS[change.heading]
    const speedScale = enemy.phase === 'recover' ? 0.92 : enemy.plan.speedScale
    schedule.push({
      atMs,
      direction: {
        x: direction.x * speedScale,
        y: direction.y * speedScale,
      },
    })
  }
  return schedule
}

function telegraphForEnemy(
  enemy: ResourceSnakeAiEnemyState,
): ResourceSnakeTelegraph | null {
  if (enemy.phase !== 'telegraph' || !enemy.plan || !enemy.advertisedHeading) return null
  const originHeading = enemy.plan.originHeading ?? enemy.recoveryHeading
  const prefixSteps = Math.max(
    1,
    Math.ceil((enemy.plan.commandAtMs - enemy.plan.plannedAtMs) / enemy.plan.stepMs),
  )
  return {
    enemyId: enemy.enemyId,
    role: enemy.role,
    originHeading,
    attackHeading: enemy.advertisedHeading,
    startedAtMs: enemy.phaseStartedAtMs,
    untilMs: enemy.plan.commandAtMs,
    path: enemy.plan.path.slice(0, prefixSteps).map((point) => ({ ...point })),
  }
}

export function advanceResourceSnakeAiController(
  state: ResourceSnakeAiControllerState,
  input: ResourceSnakeAiControllerInput,
  dependencies: ResourceSnakeAiControllerDependencies = {},
): ResourceSnakeAiControllerResult {
  const { snapshot, profile, active } = input
  const atMs = snapshot.simulationMs
  const planGroup = dependencies.planGroup ?? planResourceSnakeGroup
  const planIsFatal = dependencies.planIsFatal ?? resourceSnakePlanIsNewlyFatal
  const clock = dependencies.clock ?? (() => performance.now())
  const enemies: Record<string, ResourceSnakeAiEnemyState> = {}
  const roles = { ...state.roles }

  for (const actor of snapshot.enemies) {
    const role = roles[actor.id] ?? actor.role ?? 'pressure'
    roles[actor.id] = role
    let enemy = state.enemies[actor.id] ?? initialEnemyState(snapshot, actor.id, role)
    enemy = { ...enemy, role }
    if (actor.integrity <= 0) {
      enemy = {
        ...enemy,
        phase: 'defeated',
        phaseStartedAtMs: atMs,
        plan: null,
        advertisedHeading: null,
        safePlanConfirmations: 0,
      }
    } else if (active && enemy.phase === 'deploy') {
      enemy = { ...enemy, phase: 'cruise', phaseStartedAtMs: atMs }
    }
    enemies[actor.id] = timedPhase(enemy, atMs)
  }

  const shouldPlan = active && atMs + EPSILON >= state.nextPlanningAtMs
  let observedPlanningMs = 0
  let timingHistoryMs = [...state.timingHistoryMs]
  let nextPlanningAtMs = state.nextPlanningAtMs
  if (shouldPlan) {
    const startedAt = clock()
    const previousPlans = Object.values(enemies)
      .map((enemy) => enemy.plan)
      .filter((plan): plan is SnakePlan => plan !== null)
    const group = planGroup(
      snapshot,
      plannerProfile(profile),
      previousPlans,
      timingHistoryMs,
    )
    nextPlanningAtMs = nextResourceSnakePlanningAtMs(
      atMs,
      profile.planningHz,
      group.plans,
    )
    const endedAt = clock()
    observedPlanningMs = Number.isFinite(endedAt - startedAt)
      ? Math.max(0, endedAt - startedAt)
      : 0
    timingHistoryMs = [...timingHistoryMs, observedPlanningMs].slice(-31)
    for (const [enemyId, role] of Object.entries(group.roles)) roles[enemyId] = role

    for (const actor of snapshot.enemies) {
      let enemy = enemies[actor.id]
      if (!enemy || enemy.phase === 'defeated') continue
      enemy = { ...enemy, role: roles[actor.id] ?? enemy.role }
      const planned = group.plans.find((candidate) => candidate.enemyId === actor.id) ?? null
      if ((enemy.phase === 'telegraph' || enemy.phase === 'commit') && enemy.plan) {
        if (planIsFatal(snapshot, enemy.plan)) {
          const fallbackHeading = actorHeading(snapshot, actor.id)
          const replacementReady = planReadyForTelegraph(snapshot, planned, planIsFatal)
          const recoveryPlan = replacementReady
            || planSafeForRecovery(snapshot, planned, planIsFatal)
            ? planned
            : null
          enemy = {
            ...enemy,
            phase: 'recover',
            phaseStartedAtMs: atMs,
            plan: recoveryPlan,
            advertisedHeading: null,
            recoveryHeading: recoveryPlan
              ? replacementReady
                ? originHeadingForPlan(recoveryPlan, fallbackHeading)
                : headingForPlan(recoveryPlan, fallbackHeading)
              : fallbackHeading,
            safePlanConfirmations: 0,
          }
        }
      } else if (enemy.phase === 'cruise' && planned) {
        if (!planReadyForTelegraph(snapshot, planned, planIsFatal)) {
          const recoveryPlan = planSafeForRecovery(snapshot, planned, planIsFatal)
            ? planned
            : null
          enemy = {
            ...enemy,
            phase: 'recover',
            phaseStartedAtMs: atMs,
            plan: recoveryPlan,
            advertisedHeading: null,
            recoveryHeading: recoveryPlan
              ? headingForPlan(recoveryPlan, actorHeading(snapshot, actor.id))
              : actorHeading(snapshot, actor.id),
            safePlanConfirmations: 0,
          }
        } else if (!planTurnCanCommit(snapshot, planned, profile)) {
          enemy = {
            ...enemy,
            plan: null,
            advertisedHeading: null,
            safePlanConfirmations: 0,
          }
        } else {
          enemy = beginTelegraph(enemy, planned, atMs)
        }
      } else if (enemy.phase === 'recover') {
        const safe = planReadyForTelegraph(snapshot, planned, planIsFatal)
        if (safe && planTurnCanCommit(snapshot, planned, profile)) {
          if (enemy.safePlanConfirmations === 1) {
            enemy = beginTelegraph(enemy, planned, atMs)
          } else {
            enemy = {
              ...enemy,
              plan: planned,
              recoveryHeading: originHeadingForPlan(
                planned,
                actorHeading(snapshot, actor.id),
              ),
              safePlanConfirmations: 1,
            }
          }
        } else {
          const recoveryPlan = planSafeForRecovery(snapshot, planned, planIsFatal)
            ? planned
            : planSafeForRecovery(snapshot, enemy.plan, planIsFatal)
              ? enemy.plan
              : null
          enemy = {
            ...enemy,
            plan: recoveryPlan,
            recoveryHeading: recoveryPlan
              ? headingForPlan(recoveryPlan, actorHeading(snapshot, actor.id))
              : actorHeading(snapshot, actor.id),
            safePlanConfirmations: 0,
          }
        }
      }
      enemies[actor.id] = enemy
    }
  }

  const nextState: ResourceSnakeAiControllerState = {
    enemies,
    roles,
    nextPlanningAtMs,
    timingHistoryMs,
  }
  const commands: Record<string, SnakeVector> = {}
  const commandSchedules: Record<string, SnakeEnemyDirectionChange[]> = {}
  const turnPolicies: Record<string, SnakeEnemyTurnPolicy> = {}
  const telegraphs: ResourceSnakeTelegraph[] = []
  for (const enemy of Object.values(enemies)) {
    turnPolicies[enemy.enemyId] = {
      minimumHeadingHoldMs: profile.minimumHeadingHoldMs,
    }
    const command = commandForEnemy(snapshot, enemy)
    if (command) {
      commands[enemy.enemyId] = command
      commandSchedules[enemy.enemyId] = commandScheduleForEnemy(snapshot, enemy, command)
    }
    const telegraph = telegraphForEnemy(enemy)
    if (telegraph) telegraphs.push(telegraph)
  }
  return {
    state: nextState,
    commands,
    commandSchedules,
    turnPolicies,
    telegraphs,
    planned: shouldPlan,
    observedPlanningMs,
  }
}
