import type { SnakeEnemyRole } from './resourceSnakeRuntime'

export type SnakeDoctrine = 'readable-hunter'
export type CyanEncounterStage = 'cyan-intro' | 'cyan-advanced' | 'cyan-dual-role'

export interface CyanLightcycleProfile {
  readonly doctrine: SnakeDoctrine
  readonly stage: CyanEncounterStage
  readonly planningHz: 10 | 12 | 14
  readonly lookaheadMs: 1_400 | 1_800 | 2_200
  readonly telegraphMs: 160 | 190 | 220
  readonly commitMs: 180 | 220 | 260
  readonly candidateCount: 48 | 72 | 96
  readonly minimumHeadingHoldMs: 700 | 800 | 900
  readonly rolloutStepMs: 50
  readonly recoverySpeedScale: 0.92
}

const INTRO_PROFILE: CyanLightcycleProfile = Object.freeze({
  doctrine: 'readable-hunter',
  stage: 'cyan-intro',
  planningHz: 10,
  lookaheadMs: 1_400,
  telegraphMs: 220,
  commitMs: 260,
  candidateCount: 48,
  minimumHeadingHoldMs: 900,
  rolloutStepMs: 50,
  recoverySpeedScale: 0.92,
})

const ADVANCED_PROFILE: CyanLightcycleProfile = Object.freeze({
  doctrine: 'readable-hunter',
  stage: 'cyan-advanced',
  planningHz: 12,
  lookaheadMs: 1_800,
  telegraphMs: 190,
  commitMs: 220,
  candidateCount: 72,
  minimumHeadingHoldMs: 800,
  rolloutStepMs: 50,
  recoverySpeedScale: 0.92,
})

const DUAL_ROLE_PROFILE: CyanLightcycleProfile = Object.freeze({
  doctrine: 'readable-hunter',
  stage: 'cyan-dual-role',
  planningHz: 14,
  lookaheadMs: 2_200,
  telegraphMs: 160,
  commitMs: 180,
  candidateCount: 96,
  minimumHeadingHoldMs: 700,
  rolloutStepMs: 50,
  recoverySpeedScale: 0.92,
})

export const CYAN_LIGHTCYCLE_PROFILES: readonly CyanLightcycleProfile[] =
  Object.freeze([INTRO_PROFILE, ADVANCED_PROFILE, DUAL_ROLE_PROFILE])

const PROFILE_BY_STAGE: Readonly<Record<CyanEncounterStage, CyanLightcycleProfile>> =
  Object.freeze({
    'cyan-intro': INTRO_PROFILE,
    'cyan-advanced': ADVANCED_PROFILE,
    'cyan-dual-role': DUAL_ROLE_PROFILE,
  })

const ENEMY_SPEEDS: Readonly<
  Record<CyanEncounterStage, Readonly<Record<SnakeEnemyRole, number>>>
> = Object.freeze({
  'cyan-intro': Object.freeze({ pressure: 11.6, blocker: 11.2 }),
  'cyan-advanced': Object.freeze({ pressure: 12.2, blocker: 11.8 }),
  'cyan-dual-role': Object.freeze({ pressure: 12.2, blocker: 11.8 }),
})

export function cyanEncounterStageForProgress(
  successfulDeposits: number,
): CyanEncounterStage {
  const progress = Number.isFinite(successfulDeposits)
    ? Math.max(0, Math.floor(successfulDeposits))
    : 0
  if (progress < 6) return 'cyan-intro'
  if (progress < 12) return 'cyan-advanced'
  return 'cyan-dual-role'
}

export function cyanLightcycleProfile(
  stage: CyanEncounterStage,
): CyanLightcycleProfile {
  return PROFILE_BY_STAGE[stage]
}

export function cyanEnemySpeed(
  stage: CyanEncounterStage,
  role: SnakeEnemyRole,
): number {
  return ENEMY_SPEEDS[stage][role]
}
