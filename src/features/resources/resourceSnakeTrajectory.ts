import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import {
  SNAKE_DIRECTION_VECTORS,
  type SnakeDirection8,
} from './resourceSnakeInput'
import type {
  SnakeCommittedPath,
  SnakeHeadingChange,
  SnakePlan,
  SnakePlanSample,
  SnakePlannerActor,
  SnakeTimedPosition,
  SnakeTrajectoryCandidate,
  SnakeVector,
} from './resourceSnakePlannerTypes'
import { RESOURCE_SNAKE_CONFIG } from './resourceSnakeRuntime'

const CLOCKWISE_HEADINGS = Object.freeze([
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const satisfies readonly SnakeDirection8[])

const LEGAL_RELATIVE_OFFSETS = Object.freeze([0, -1, 1, -2, 2, -3, 3] as const)
const PLANNED_RELATIVE_OFFSETS = Object.freeze([0, -1, 1, -2, 2] as const)
const FUTURE_TURN_OFFSETS = Object.freeze([-1, 1, -2, 2] as const)
const EPSILON = 1e-9
const RUNTIME_FIXED_STEP_MS = 1_000 / 120
const MAX_PLAN_SAMPLES = 50
const MAX_TIMESTAMP_MS = 1_000_000_000

export interface ResourceSnakeLightcycleTrajectoryCandidate extends SnakeTrajectoryCandidate {
  speedScale: 0.92 | 1
  originHeading: SnakeDirection8
  attackHeading: SnakeDirection8
  headingChanges: SnakeHeadingChange[]
  rawPath: SnakeVector[]
  steeringCost: number
}

export interface GenerateResourceSnakeLightcycleCandidatesInput {
  actor: SnakePlannerActor
  profile: SnakePlannerProfile
  telegraphMs: number
  plannedAtMs?: number
  speedScale?: 0.92 | 1
  field?: {
    width: number
    height: number
    padding: number
  }
}

function earliestNormalTurnOffsetMs(
  actor: SnakePlannerActor,
  attackHeading: SnakeDirection8,
  profile: SnakePlannerProfile,
  telegraphMs: number,
  plannedAtMs: number | undefined,
): number {
  if (!Number.isFinite(plannedAtMs) || attackHeading === actorHeading(actor)) {
    return telegraphMs
  }
  const governor = actor.enemyTurnGovernor
  if (!governor) return telegraphMs
  let earliestAtMs = plannedAtMs! + telegraphMs
  earliestAtMs = Math.max(earliestAtMs, governor.lockedUntilMs)
  if (governor.lastHeadingChangeAtMs !== null) {
    const minimumHoldMs = Number.isFinite(profile.minimumHeadingHoldMs)
      ? profile.minimumHeadingHoldMs!
      : RESOURCE_SNAKE_CONFIG.enemyMinimumHeadingHoldMs
    earliestAtMs = Math.max(
      earliestAtMs,
      governor.lastHeadingChangeAtMs + minimumHoldMs,
    )
    if (governor.previousHeading === attackHeading) {
      earliestAtMs = Math.max(
        earliestAtMs,
        governor.lastHeadingChangeAtMs
          + RESOURCE_SNAKE_CONFIG.enemyReturnHeadingLockMs,
      )
    }
  }
  const normalTurns = governor.normalTurnAtMs
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  while (true) {
    const recent = normalTurns.filter((turnAtMs) => (
      turnAtMs <= earliestAtMs + EPSILON
      && earliestAtMs - turnAtMs
        < RESOURCE_SNAKE_CONFIG.enemyNormalTurnWindowMs - EPSILON
    ))
    if (recent.length < RESOURCE_SNAKE_CONFIG.enemyMaximumNormalTurnsPerWindow) break
    earliestAtMs = Math.max(
      earliestAtMs,
      recent[0] + RESOURCE_SNAKE_CONFIG.enemyNormalTurnWindowMs,
    )
  }
  return rounded(Math.max(telegraphMs, earliestAtMs - plannedAtMs!))
}

function clockwiseIndex(heading: SnakeDirection8): number {
  return CLOCKWISE_HEADINGS.indexOf(heading)
}

function headingAtOffset(
  heading: SnakeDirection8,
  offset: number,
): SnakeDirection8 {
  const index = clockwiseIndex(heading)
  return CLOCKWISE_HEADINGS[(index + offset + CLOCKWISE_HEADINGS.length) % CLOCKWISE_HEADINGS.length]
}

function finiteVector(vector: SnakeVector): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y)
}

function rounded(value: number): number {
  const result = Math.round(value * 1_000_000_000_000) / 1_000_000_000_000
  return Object.is(result, -0) ? 0 : result
}

function clamped(
  position: SnakeVector,
  field: GenerateResourceSnakeLightcycleCandidatesInput['field'],
): SnakeVector {
  if (!field) return { ...position }
  return {
    x: Math.max(field.padding, Math.min(field.width - field.padding, position.x)),
    y: Math.max(field.padding, Math.min(field.height - field.padding, position.y)),
  }
}

function vectorForHeading(heading: SnakeDirection8): SnakeVector {
  return { ...SNAKE_DIRECTION_VECTORS[heading] }
}

export function resourceSnakeHeadingFromVector(
  vector: SnakeVector,
  fallback: SnakeDirection8,
): SnakeDirection8 {
  if (!finiteVector(vector)) return fallback
  const magnitude = Math.hypot(vector.x, vector.y)
  if (magnitude <= EPSILON) return fallback
  const normalized = { x: vector.x / magnitude, y: vector.y / magnitude }
  let best = fallback
  let bestAlignment = -Infinity
  for (const heading of CLOCKWISE_HEADINGS) {
    const candidate = SNAKE_DIRECTION_VECTORS[heading]
    const alignment = normalized.x * candidate.x + normalized.y * candidate.y
    if (alignment > bestAlignment + EPSILON) {
      best = heading
      bestAlignment = alignment
    }
  }
  return best
}

export function legalResourceSnakeHeadings(
  originHeading: SnakeDirection8,
): SnakeDirection8[] {
  return LEGAL_RELATIVE_OFFSETS.map((offset) => headingAtOffset(originHeading, offset))
}

function actorHeading(actor: SnakePlannerActor): SnakeDirection8 {
  if (actor.heading && CLOCKWISE_HEADINGS.includes(actor.heading)) return actor.heading
  return resourceSnakeHeadingFromVector(
    actor.velocity,
    actor.id === 'player' ? 'north' : 'south',
  )
}

function steeringCost(changes: readonly SnakeHeadingChange[]): number {
  let cost = 0
  for (let index = 1; index < changes.length; index += 1) {
    const before = clockwiseIndex(changes[index - 1].heading)
    const after = clockwiseIndex(changes[index].heading)
    const clockwise = (after - before + 8) % 8
    cost += Math.min(clockwise, 8 - clockwise) * (Math.PI / 4)
  }
  return rounded(cost)
}

function candidateHeadingChanges(
  actor: SnakePlannerActor,
  originHeading: SnakeDirection8,
  attackHeading: SnakeDirection8,
  profile: SnakePlannerProfile,
  telegraphMs: number,
  plannedAtMs: number | undefined,
  candidateIndex: number,
): SnakeHeadingChange[] {
  const branchIndex = Math.floor(candidateIndex / PLANNED_RELATIVE_OFFSETS.length)
  const futureTurnOffset = FUTURE_TURN_OFFSETS[branchIndex % FUTURE_TURN_OFFSETS.length]
  const delayVariant = Math.floor(branchIndex / FUTURE_TURN_OFFSETS.length)
  const futureHeading = headingAtOffset(attackHeading, futureTurnOffset)
  const advertisedTurnAtMs = earliestNormalTurnOffsetMs(
    actor,
    attackHeading,
    profile,
    telegraphMs,
    plannedAtMs,
  )
  const minimumHeadingHoldMs = profile.minimumHeadingHoldMs
  const projectedTurnSeparationMs = Number.isFinite(minimumHeadingHoldMs)
    ? Math.max(profile.commitMs, minimumHeadingHoldMs!)
    : profile.commitMs
  const futureTurnAtMs = advertisedTurnAtMs
    + projectedTurnSeparationMs
    + delayVariant * 200
  const changes: SnakeHeadingChange[] = [{ offsetMs: 0, heading: originHeading }]
  if (attackHeading !== originHeading || advertisedTurnAtMs > 0) {
    changes.push({ offsetMs: advertisedTurnAtMs, heading: attackHeading })
  }
  changes.push({ offsetMs: futureTurnAtMs, heading: futureHeading })
  return changes
}

function rolloutCandidate(
  actor: SnakePlannerActor,
  profile: SnakePlannerProfile,
  speedScale: 0.92 | 1,
  headingChanges: readonly SnakeHeadingChange[],
  field: GenerateResourceSnakeLightcycleCandidatesInput['field'],
): Pick<ResourceSnakeLightcycleTrajectoryCandidate, 'directions' | 'path' | 'rawPath'> {
  const speed = actor.maximumSpeedPerSecond * speedScale
  const directions: SnakeVector[] = []
  const path: SnakeVector[] = []
  const rawPath: SnakeVector[] = []
  let x = actor.position.x
  let y = actor.position.y
  let elapsedMs = 0
  let activeHeading = headingChanges[0].heading
  let changeIndex = 1

  const integrate = (durationMs: number) => {
    const direction = SNAKE_DIRECTION_VECTORS[activeHeading]
    x += direction.x * speed * (durationMs / 1_000)
    y += direction.y * speed * (durationMs / 1_000)
  }

  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  for (let step = 0; step < stepCount; step += 1) {
    const stepEndMs = (step + 1) * profile.rolloutStepMs
    while (
      changeIndex < headingChanges.length
      && headingChanges[changeIndex].offsetMs <= elapsedMs + EPSILON
    ) {
      activeHeading = headingChanges[changeIndex].heading
      changeIndex += 1
    }
    directions.push(vectorForHeading(activeHeading))
    while (
      changeIndex < headingChanges.length
      && headingChanges[changeIndex].offsetMs < stepEndMs - EPSILON
    ) {
      const change = headingChanges[changeIndex]
      integrate(Math.max(0, change.offsetMs - elapsedMs))
      elapsedMs = change.offsetMs
      activeHeading = change.heading
      changeIndex += 1
    }
    integrate(Math.max(0, stepEndMs - elapsedMs))
    elapsedMs = stepEndMs
    const raw = { x: rounded(x), y: rounded(y) }
    rawPath.push(raw)
    path.push(clamped(raw, field))
  }
  return { directions, path, rawPath }
}

export function generateResourceSnakeLightcycleCandidates(
  input: GenerateResourceSnakeLightcycleCandidatesInput,
): ResourceSnakeLightcycleTrajectoryCandidate[] {
  const { actor, profile } = input
  if (
    !actor
    || !finiteVector(actor.position)
    || !finiteVector(actor.velocity)
    || !Number.isFinite(actor.maximumSpeedPerSecond)
    || actor.maximumSpeedPerSecond <= 0
    || !Number.isFinite(input.telegraphMs)
    || input.telegraphMs < 0
    || !Number.isInteger(profile.lookaheadMs / profile.rolloutStepMs)
    || profile.candidateCount <= 0
  ) return []

  const originHeading = actorHeading(actor)
  const attackHeadings = PLANNED_RELATIVE_OFFSETS.map((offset) => (
    headingAtOffset(originHeading, offset)
  ))
  const speedScale = input.speedScale ?? 1
  return Array.from({ length: profile.candidateCount }, (_, candidateIndex) => {
    const attackHeading = attackHeadings[candidateIndex % attackHeadings.length]
    const headingChanges = candidateHeadingChanges(
      actor,
      originHeading,
      attackHeading,
      profile,
      input.telegraphMs,
      input.plannedAtMs,
      candidateIndex,
    )
    const rollout = rolloutCandidate(
      actor,
      profile,
      speedScale,
      headingChanges,
      input.field,
    )
    return {
      candidateIndex,
      speedScale,
      originHeading,
      attackHeading,
      headingChanges: headingChanges.map((change) => ({ ...change })),
      directions: rollout.directions,
      path: rollout.path,
      rawPath: rollout.rawPath,
      steeringCost: steeringCost(headingChanges),
    }
  })
}

function planTimelineValid(plan: SnakePlan): boolean {
  if (
    !plan
    || typeof plan !== 'object'
    || !Array.isArray(plan.path)
    || !Array.isArray(plan.directions)
    || plan.path.length === 0
    || plan.path.length > MAX_PLAN_SAMPLES
    || plan.path.length !== plan.directions.length
    || plan.stepMs !== 50
    || !Number.isFinite(plan.plannedAtMs)
    || !Number.isFinite(plan.commandAtMs)
    || !Number.isFinite(plan.commitUntilMs)
    || plan.plannedAtMs < 0
    || plan.commandAtMs < plan.plannedAtMs
    || plan.commitUntilMs < plan.commandAtMs
    || plan.commitUntilMs > MAX_TIMESTAMP_MS
    || !finiteVector(plan.originPosition)
    || !finiteVector(plan.originVelocity)
    || !Number.isFinite(plan.originMaximumSpeedPerSecond)
    || plan.originMaximumSpeedPerSecond < 0
    || ![0, 0.5, 0.92, 1].includes(plan.speedScale)
  ) return false
  if (plan.path.some((point) => !finiteVector(point))) return false
  if (plan.directions.some((direction) => (
    !finiteVector(direction) || Math.abs(Math.hypot(direction.x, direction.y) - 1) > 1e-8
  ))) return false
  let previousOffsetMs = -Infinity
  for (const change of plan.headingChanges ?? []) {
    if (
      !Number.isFinite(change.offsetMs)
      || change.offsetMs < 0
      || change.offsetMs <= previousOffsetMs
      || !Object.prototype.hasOwnProperty.call(SNAKE_DIRECTION_VECTORS, change.heading)
    ) return false
    previousOffsetMs = change.offsetMs
  }
  return true
}

function activePlanHeading(
  plan: SnakePlan,
  elapsedMs: number,
): SnakeDirection8 | null {
  let active = plan.originHeading ?? plan.headingChanges?.[0]?.heading ?? null
  for (const change of plan.headingChanges ?? []) {
    if (change.offsetMs > elapsedMs + EPSILON) break
    active = change.heading
  }
  return active
}

function sampleDiscretePosition(
  plan: SnakePlan,
  elapsedMs: number,
): { position: SnakeVector; velocity: SnakeVector } {
  const headingChanges = plan.headingChanges
  if (!headingChanges || headingChanges.length === 0) {
    const offset = Math.max(0, Math.min(plan.path.length, elapsedMs / plan.stepMs))
    const completed = Math.floor(offset)
    const position = completed >= plan.path.length
      ? { ...plan.path.at(-1)! }
      : (() => {
          const start = completed === 0 ? plan.originPosition : plan.path[completed - 1]
          const end = plan.path[completed]
          const fraction = offset - completed
          return {
            x: start.x + (end.x - start.x) * fraction,
            y: start.y + (end.y - start.y) * fraction,
          }
        })()
    const cursor = Math.min(
      plan.directions.length - 1,
      Math.max(0, Math.floor(elapsedMs / plan.stepMs)),
    )
    const direction = plan.directions[cursor]
    const speed = plan.originMaximumSpeedPerSecond * plan.speedScale
    return {
      position,
      velocity: { x: direction.x * speed, y: direction.y * speed },
    }
  }

  const boundedElapsedMs = Math.max(
    0,
    Math.min(elapsedMs, plan.path.length * plan.stepMs),
  )
  let position = { ...plan.originPosition }
  let heading = headingChanges[0].heading
  let cursorMs = 0
  const speed = plan.originMaximumSpeedPerSecond * plan.speedScale
  for (let index = 1; index < headingChanges.length; index += 1) {
    const change = headingChanges[index]
    if (change.offsetMs > boundedElapsedMs + EPSILON) break
    const direction = SNAKE_DIRECTION_VECTORS[heading]
    const durationMs = Math.max(0, change.offsetMs - cursorMs)
    position = {
      x: position.x + direction.x * speed * durationMs / 1_000,
      y: position.y + direction.y * speed * durationMs / 1_000,
    }
    cursorMs = change.offsetMs
    heading = change.heading
  }
  const direction = SNAKE_DIRECTION_VECTORS[heading]
  const remainingMs = Math.max(0, boundedElapsedMs - cursorMs)
  return {
    position: {
      x: position.x + direction.x * speed * remainingMs / 1_000,
      y: position.y + direction.y * speed * remainingMs / 1_000,
    },
    velocity: { x: direction.x * speed, y: direction.y * speed },
  }
}

export function sampleResourceSnakeTrajectoryPlan(
  plan: SnakePlan,
  atMs: number,
): SnakePlanSample {
  const safe = (): SnakePlanSample => ({
    atMs: Number.isFinite(atMs) ? atMs : 0,
    cursor: 0,
    direction: { x: 0, y: 0 },
    speedScale: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  })
  try {
    if (!planTimelineValid(plan) || !Number.isFinite(atMs)) return safe()
    const elapsedMs = Math.max(0, atMs - plan.plannedAtMs)
    const cursor = Math.min(
      plan.directions.length - 1,
      Math.max(0, Math.floor((atMs - plan.plannedAtMs + EPSILON) / plan.stepMs)),
    )
    const heading = activePlanHeading(plan, elapsedMs)
    const simulated = sampleDiscretePosition(plan, elapsedMs)
    return {
      atMs,
      cursor,
      direction: heading
        ? vectorForHeading(heading)
        : { ...plan.directions[cursor] },
      speedScale: plan.speedScale,
      position: simulated.position,
      velocity: simulated.velocity,
    }
  } catch {
    return safe()
  }
}

export function getResourceSnakeTrajectoryFutureSamples(
  plan: SnakePlan,
  fromMs: number,
): SnakeTimedPosition[] {
  try {
    if (!planTimelineValid(plan) || !Number.isFinite(fromMs)) return []
    return plan.path.flatMap((position, index) => {
      const atMs = plan.plannedAtMs + (index + 1) * plan.stepMs
      return atMs > fromMs ? [{ atMs, position: { ...position } }] : []
    })
  } catch {
    return []
  }
}

export function resourceSnakeTrajectoryPlanToCommittedPath(
  plan: SnakePlan,
  fromMs?: number,
): SnakeCommittedPath | null {
  try {
    if (!planTimelineValid(plan)) return null
    const requestedFromMs = fromMs ?? plan.plannedAtMs
    const horizonMs = plan.plannedAtMs + plan.path.length * plan.stepMs
    const commitUntilMs = Math.min(plan.commitUntilMs, horizonMs)
    if (!Number.isFinite(requestedFromMs) || requestedFromMs >= commitUntilMs) return null
    const startsAtMs = Math.max(plan.plannedAtMs, Math.min(commitUntilMs, requestedFromMs))
    const sampleTimes = [startsAtMs, commitUntilMs]
    const firstFixedIndex = Math.floor(
      (startsAtMs - plan.plannedAtMs + EPSILON) / RUNTIME_FIXED_STEP_MS,
    ) + 1
    const lastFixedIndex = Math.floor(
      (commitUntilMs - plan.plannedAtMs + EPSILON) / RUNTIME_FIXED_STEP_MS,
    )
    for (let fixedIndex = firstFixedIndex; fixedIndex <= lastFixedIndex; fixedIndex += 1) {
      const atMs = plan.plannedAtMs + fixedIndex * RUNTIME_FIXED_STEP_MS
      if (atMs >= commitUntilMs - EPSILON) break
      sampleTimes.push(atMs)
    }
    for (const change of plan.headingChanges ?? []) {
      const atMs = plan.plannedAtMs + change.offsetMs
      if (atMs > startsAtMs + EPSILON && atMs < commitUntilMs - EPSILON) {
        sampleTimes.push(atMs)
      }
    }
    sampleTimes.sort((left, right) => left - right)
    const samples = sampleTimes
      .filter((atMs, index) => (
        index === 0 || Math.abs(atMs - sampleTimes[index - 1]) > EPSILON
      ))
      .map((atMs) => ({
        atMs,
        position: sampleResourceSnakeTrajectoryPlan(plan, atMs).position,
      }))
    return { enemyId: plan.enemyId, commitUntilMs, samples }
  } catch {
    return null
  }
}

function committedPathValid(path: SnakeCommittedPath): boolean {
  if (
    !path
    || typeof path !== 'object'
    || !Array.isArray(path.samples)
    || path.samples.length < 2
    || path.samples.length > 64
    || !Number.isFinite(path.commitUntilMs)
  ) return false
  let priorMs = -Infinity
  for (const sample of path.samples) {
    if (
      !sample
      || !Number.isFinite(sample.atMs)
      || sample.atMs <= priorMs
      || !finiteVector(sample.position)
    ) return false
    priorMs = sample.atMs
  }
  return Math.abs(path.samples.at(-1)!.atMs - path.commitUntilMs) <= EPSILON
}

export function sampleResourceSnakeTrajectoryCommittedPath(
  committed: SnakeCommittedPath,
  atMs: number,
): SnakeTimedPosition | null {
  try {
    if (!committedPathValid(committed) || !Number.isFinite(atMs)) return null
    const first = committed.samples[0]
    const last = committed.samples.at(-1)!
    if (atMs < first.atMs - EPSILON || atMs > last.atMs + EPSILON) return null
    let lowerIndex = 0
    let upperIndex = committed.samples.length - 1
    while (lowerIndex + 1 < upperIndex) {
      const middle = Math.floor((lowerIndex + upperIndex) / 2)
      if (committed.samples[middle].atMs <= atMs) lowerIndex = middle
      else upperIndex = middle
    }
    const lower = committed.samples[lowerIndex]
    if (Math.abs(lower.atMs - atMs) <= EPSILON || lowerIndex === committed.samples.length - 1) {
      return { atMs, position: { ...lower.position } }
    }
    const upper = committed.samples[lowerIndex + 1]
    const fraction = (atMs - lower.atMs) / (upper.atMs - lower.atMs)
    return {
      atMs,
      position: {
        x: lower.position.x + (upper.position.x - lower.position.x) * fraction,
        y: lower.position.y + (upper.position.y - lower.position.y) * fraction,
      },
    }
  } catch {
    return null
  }
}
