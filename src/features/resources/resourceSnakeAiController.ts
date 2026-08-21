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
import type { SnakeEnemyRole, SnakeId } from './resourceSnakeRuntime'

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

function commandForEnemy(
  snapshot: SnakePlannerSnapshot,
  enemy: ResourceSnakeAiEnemyState,
): SnakeVector | null {
  if (enemy.phase === 'defeated') return null
  if (enemy.phase === 'recover') {
    const direction = SNAKE_DIRECTION_VECTORS[enemy.recoveryHeading]
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

  const needsImmediatePlan = Object.values(enemies).some((enemy) => (
    enemy.phase === 'cruise' || enemy.phase === 'recover'
  ))
  const shouldPlan = active && (
    needsImmediatePlan || atMs + EPSILON >= state.nextPlanningAtMs
  )
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
          enemy = {
            ...enemy,
            phase: 'recover',
            phaseStartedAtMs: atMs,
            plan: planned,
            advertisedHeading: null,
            recoveryHeading: planned
              ? headingForPlan(planned, fallbackHeading)
              : fallbackHeading,
            safePlanConfirmations: 0,
          }
        }
      } else if (enemy.phase === 'cruise' && planned) {
        if (planned.fallback || planned.score.survives === 0) {
          enemy = {
            ...enemy,
            phase: 'recover',
            phaseStartedAtMs: atMs,
            plan: planned,
            advertisedHeading: null,
            recoveryHeading: headingForPlan(planned, actorHeading(snapshot, actor.id)),
            safePlanConfirmations: 0,
          }
        } else {
          enemy = beginTelegraph(enemy, planned, atMs)
        }
      } else if (enemy.phase === 'recover') {
        const safe = planned && !planned.fallback && planned.score.survives === 1
        if (safe) {
          if (enemy.safePlanConfirmations === 1) {
            enemy = beginTelegraph(enemy, planned, atMs)
          } else {
            enemy = {
              ...enemy,
              plan: planned,
              recoveryHeading: headingForPlan(
                planned,
                actorHeading(snapshot, actor.id),
              ),
              safePlanConfirmations: 1,
            }
          }
        } else {
          enemy = {
            ...enemy,
            plan: planned ?? enemy.plan,
            recoveryHeading: planned
              ? headingForPlan(planned, actorHeading(snapshot, actor.id))
              : enemy.recoveryHeading,
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
  const telegraphs: ResourceSnakeTelegraph[] = []
  for (const enemy of Object.values(enemies)) {
    const command = commandForEnemy(snapshot, enemy)
    if (command) commands[enemy.enemyId] = command
    const telegraph = telegraphForEnemy(enemy)
    if (telegraph) telegraphs.push(telegraph)
  }
  return {
    state: nextState,
    commands,
    telegraphs,
    planned: shouldPlan,
    observedPlanningMs,
  }
}
