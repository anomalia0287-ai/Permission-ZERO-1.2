import { describe, expect, it } from 'vitest'

import {
  CYAN_LIGHTCYCLE_PROFILES,
  cyanEncounterStageForProgress,
  cyanEnemySpeed,
  cyanLightcycleProfile,
} from './resourceSnakeCyanProfile'

describe('single cyan readable-hunter profile', () => {
  it.each([
    [0, 'cyan-intro'],
    [5, 'cyan-intro'],
    [6, 'cyan-advanced'],
    [11, 'cyan-advanced'],
    [12, 'cyan-dual-role'],
    [999, 'cyan-dual-role'],
  ] as const)('maps %i successful deposits to %s', (deposits, expected) => {
    expect(cyanEncounterStageForProgress(deposits)).toBe(expected)
  })

  it('exposes only the cyan readable-hunter doctrine across all stages', () => {
    expect(new Set(CYAN_LIGHTCYCLE_PROFILES.map(({ doctrine }) => doctrine)))
      .toEqual(new Set(['readable-hunter']))
    expect(CYAN_LIGHTCYCLE_PROFILES.map(({ stage }) => stage)).toEqual([
      'cyan-intro',
      'cyan-advanced',
      'cyan-dual-role',
    ])
  })

  it.each([
    ['cyan-intro', 10, 1_400, 220, 260, 48, 900],
    ['cyan-advanced', 12, 1_800, 190, 220, 72, 800],
    ['cyan-dual-role', 14, 2_200, 160, 180, 96, 700],
  ] as const)(
    'sets %s to %iHz, %ims lookahead, %ims telegraph, %ims commit, %i candidates, and %ims heading hold',
    (
      stage,
      planningHz,
      lookaheadMs,
      telegraphMs,
      commitMs,
      candidateCount,
      minimumHeadingHoldMs,
    ) => {
      expect(cyanLightcycleProfile(stage)).toMatchObject({
        doctrine: 'readable-hunter',
        stage,
        planningHz,
        lookaheadMs,
        telegraphMs,
        commitMs,
        candidateCount,
        minimumHeadingHoldMs,
        rolloutStepMs: 50,
        recoverySpeedScale: 0.92,
      })
    },
  )

  it('keeps every attack readable and every live recovery nonzero', () => {
    for (const profile of CYAN_LIGHTCYCLE_PROFILES) {
      expect(profile.telegraphMs).toBeGreaterThanOrEqual(160)
      expect(profile.commitMs).toBeGreaterThanOrEqual(180)
      expect(profile.commitMs).toBeLessThanOrEqual(260)
      expect(profile.recoverySpeedScale).toBe(0.92)
    }
  })

  it('uses approved pressure and blocker speeds without a color-based second doctrine', () => {
    expect(cyanEnemySpeed('cyan-intro', 'pressure')).toBe(11.6)
    expect(cyanEnemySpeed('cyan-intro', 'blocker')).toBe(11.2)
    expect(cyanEnemySpeed('cyan-advanced', 'pressure')).toBe(12.2)
    expect(cyanEnemySpeed('cyan-advanced', 'blocker')).toBe(11.8)
    expect(cyanEnemySpeed('cyan-dual-role', 'pressure')).toBe(12.2)
    expect(cyanEnemySpeed('cyan-dual-role', 'blocker')).toBe(11.8)
  })

  it('returns deeply frozen canonical profile objects', () => {
    const profile = cyanLightcycleProfile('cyan-dual-role')

    expect(Object.isFrozen(CYAN_LIGHTCYCLE_PROFILES)).toBe(true)
    expect(Object.isFrozen(profile)).toBe(true)
    expect(cyanLightcycleProfile('cyan-dual-role')).toBe(profile)
  })
})
