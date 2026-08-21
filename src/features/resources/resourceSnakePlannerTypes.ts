import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import type { SnakeDirection8 } from './resourceSnakeInput'
import type {
  SnakeEnemyRole,
  SnakeId,
  SnakeVector,
} from './resourceSnakeRuntime'

export type {
  SnakeDirection8,
  SnakeEnemyRole,
  SnakeId,
  SnakePlannerProfile,
  SnakeVector,
}

export type SnakeIntent =
  | 'observe'
  | 'pursue'
  | 'cutoff'
  | 'herd'
  | 'escape'
  | 'coordinate'
  | 'defeated'

export type SnakePlanSpeedScale = 0 | 0.5 | 0.92 | 1

export interface SnakePlannerActor {
  id: SnakeId
  position: SnakeVector
  velocity: SnakeVector
  /** Runtime heading is authoritative when velocity is temporarily unavailable. */
  heading?: SnakeDirection8
  integrity: number
  maximumIntegrity: number
  maximumSpeedPerSecond: number
  collisionGraceMs: number
  distanceSinceTrailDot?: number
  role: SnakeEnemyRole | null
}

export interface SnakePlannerTrailDot {
  id: number
  ownerId: SnakeId
  position: SnakeVector
  spawnedAtMs: number
  expiresAtMs: number
}

export interface SnakePlayerHistorySample {
  simulationMs: number
  position: SnakeVector
  velocity: SnakeVector
}

export interface SnakeTimedPosition {
  atMs: number
  position: SnakeVector
}

export interface SnakeCommittedPath {
  enemyId: SnakeId
  commitUntilMs: number
  samples: SnakeTimedPosition[]
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

export interface SnakeHeadingChange {
  /** Milliseconds from the plan's authoritative planning boundary. */
  offsetMs: number
  heading: SnakeDirection8
}

export interface SnakeTrajectoryCandidate {
  candidateIndex: number
  speedScale: SnakePlanSpeedScale
  directions: SnakeVector[]
  path: SnakeVector[]
  originHeading?: SnakeDirection8
  attackHeading?: SnakeDirection8
  headingChanges?: SnakeHeadingChange[]
}

export interface SnakePlan {
  enemyId: SnakeId
  intent: SnakeIntent
  role: SnakeEnemyRole
  direction: SnakeVector
  speedScale: SnakePlanSpeedScale
  plannedAtMs: number
  commandAtMs: number
  stepMs: 50
  originPosition: SnakeVector
  originVelocity: SnakeVector
  originMaximumSpeedPerSecond: number
  directions: SnakeVector[]
  commitUntilMs: number
  path: SnakeVector[]
  score: SnakePlanScore
  candidateIndex: number
  evaluatedCandidates: number
  elapsedMs: number
  fallback: boolean
  originHeading?: SnakeDirection8
  attackHeading?: SnakeDirection8
  headingChanges?: SnakeHeadingChange[]
}

export interface SnakeGroupPlan {
  plans: SnakePlan[]
  roles: Record<string, SnakeEnemyRole>
  nextPlanningAtMs: number
  candidateBudget: number
  elapsedMs: number
}

export interface SnakePlanSample {
  atMs: number
  cursor: number
  direction: SnakeVector
  speedScale: SnakePlanSpeedScale
  position: SnakeVector
  velocity: SnakeVector
}

export interface SnakePlayerHypotheses {
  keepVelocity: SnakeVector[]
  continueMedianTurn: SnakeVector[]
  decelerate: SnakeVector[]
  stayStopped: SnakeVector[]
  all: SnakeVector[][]
}
