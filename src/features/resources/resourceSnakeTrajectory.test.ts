import { describe, expect, it } from 'vitest'

import type { SnakePlannerProfile } from './resourceSnakeEncounter'
import { SNAKE_DIRECTION_VECTORS } from './resourceSnakeInput'
import type { SnakePlannerActor } from './resourceSnakePlannerTypes'
import {
  generateResourceSnakeLightcycleCandidates,
  legalResourceSnakeHeadings,
  resourceSnakeHeadingFromVector,
} from './resourceSnakeTrajectory'

const PROFILES = [
  { lookaheadMs: 1_400, candidateCount: 48, planningHz: 10, commitMs: 260, rolloutStepMs: 50 },
  { lookaheadMs: 1_800, candidateCount: 72, planningHz: 12, commitMs: 220, rolloutStepMs: 50 },
  { lookaheadMs: 2_200, candidateCount: 96, planningHz: 14, commitMs: 180, rolloutStepMs: 50 },
] as const satisfies readonly SnakePlannerProfile[]

function enemy(overrides: Partial<SnakePlannerActor> = {}): SnakePlannerActor {
  return {
    id: 'enemy-0',
    position: { x: 10, y: 10 },
    velocity: { x: 12, y: 0 },
    heading: 'east',
    integrity: 50,
    maximumIntegrity: 50,
    maximumSpeedPerSecond: 12,
    collisionGraceMs: 0,
    distanceSinceTrailDot: 0,
    role: 'pressure',
    ...overrides,
  }
}

const canonicalVectors = Object.values(SNAKE_DIRECTION_VECTORS)

function isCanonicalVector(vector: { x: number; y: number }): boolean {
  return canonicalVectors.some((candidate) => (
    candidate.x === vector.x && candidate.y === vector.y
  ))
}

describe('eight-direction lightcycle trajectories', () => {
  it('orders the seven legal headings deterministically and excludes only the exact reverse', () => {
    expect(legalResourceSnakeHeadings('east')).toEqual([
      'east', 'north-east', 'south-east', 'north', 'south', 'north-west', 'south-west',
    ])
    expect(resourceSnakeHeadingFromVector({ x: 0.2, y: -4 }, 'south')).toBe('north')
    expect(resourceSnakeHeadingFromVector({ x: Number.NaN, y: 1 }, 'west')).toBe('west')
  })

  it.each(PROFILES)('generates exactly $candidateCount distinct, full-speed legal candidates', (profile) => {
    const candidates = generateResourceSnakeLightcycleCandidates({
      actor: enemy(),
      profile,
      telegraphMs: profile.planningHz === 10 ? 220 : profile.planningHz === 12 ? 190 : 160,
    })

    expect(candidates).toHaveLength(profile.candidateCount)
    expect(new Set(candidates.map((candidate) => JSON.stringify(candidate.headingChanges))).size)
      .toBe(profile.candidateCount)
    for (const candidate of candidates) {
      expect(candidate.speedScale).toBe(1)
      expect(candidate.path).toHaveLength(profile.lookaheadMs / profile.rolloutStepMs)
      expect(candidate.rawPath).toHaveLength(candidate.path.length)
      expect(candidate.directions.every(isCanonicalVector)).toBe(true)
      expect(candidate.headingChanges[0]).toEqual({ offsetMs: 0, heading: 'east' })
      for (let index = 1; index < candidate.headingChanges.length; index += 1) {
        const before = SNAKE_DIRECTION_VECTORS[candidate.headingChanges[index - 1].heading]
        const after = SNAKE_DIRECTION_VECTORS[candidate.headingChanges[index].heading]
        expect(before.x * after.x + before.y * after.y).toBeGreaterThan(-0.999_999)
      }
    }
  })

  it('holds the origin heading through the advertised prefix before applying the attack heading', () => {
    const profile = PROFILES[2]
    const candidate = generateResourceSnakeLightcycleCandidates({
      actor: enemy(),
      profile,
      telegraphMs: 160,
    }).find((entry) => entry.attackHeading === 'north')!

    expect(candidate.headingChanges.slice(0, 2)).toEqual([
      { offsetMs: 0, heading: 'east' },
      { offsetMs: 160, heading: 'north' },
    ])
    expect(candidate.path[0]).toEqual({ x: 10.6, y: 10 })
    expect(candidate.path[1]).toEqual({ x: 11.2, y: 10 })
    expect(candidate.path[2]).toEqual({ x: 11.8, y: 10 })
    expect(candidate.path[3].x).toBeCloseTo(11.92, 10)
    expect(candidate.path[3].y).toBeCloseTo(9.52, 10)
  })

  it('returns cache-isolated deterministic structures', () => {
    const input = { actor: enemy(), profile: PROFILES[0], telegraphMs: 220 } as const
    const first = generateResourceSnakeLightcycleCandidates(input)
    const canonical = JSON.stringify(first)
    first[0].path[0].x = 999
    first[0].directions[0].x = 999
    first[0].headingChanges[0].offsetMs = 999

    expect(JSON.stringify(generateResourceSnakeLightcycleCandidates(input))).toBe(canonical)
  })

  it('uses the bounded nonzero recovery scale without changing heading legality', () => {
    const [candidate] = generateResourceSnakeLightcycleCandidates({
      actor: enemy(),
      profile: PROFILES[0],
      telegraphMs: 0,
      speedScale: 0.92,
    })

    expect(candidate.speedScale).toBe(0.92)
    expect(Math.hypot(
      candidate.path[0].x - 10,
      candidate.path[0].y - 10,
    )).toBeCloseTo(12 * 0.92 * 0.05, 10)
  })
})
