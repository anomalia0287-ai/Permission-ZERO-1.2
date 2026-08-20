import { describe, expect, it } from 'vitest'

import type { ResourceState } from '../../game/model'
import {
  SNAKE_CATEGORY_COLORS,
  createResourceSnakeEncounter,
  reconcileSnakeReservations,
  selectEligibleSnakeResourceCandidates,
  type SnakeResourceCandidate,
} from './resourceSnakeEncounter'
import {
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
} from './resourceSnakeRuntime'

const emptyCompany = {
  reasoning: [],
  memory: [],
  fluency: [],
}

function resources(
  blocks: ResourceState['blocks'],
  company: ResourceState['company'] = emptyCompany,
): Pick<ResourceState, 'company' | 'blocks'> {
  return { blocks, company }
}

function candidate(
  blockId: string,
  origin: SnakeResourceCandidate['origin'],
): SnakeResourceCandidate {
  return { blockId, origin, contribution: 'normal', hiddenBomb: false }
}

function encounter(
  candidates: readonly SnakeResourceCandidate[],
  successfulDeposits = 0,
  roundOrdinal = 1,
  bag = { cycle: 0, remainingCategories: [] as SnakeResourceCandidate['origin'][] },
) {
  return createResourceSnakeEncounter({
    campaignSeed: 'campaign-alpha',
    roundOrdinal,
    successfulDeposits,
    candidates,
    bag,
  })
}

describe('snake encounter resource authority', () => {
  it('selects only normal company members with a real eligible origin, while retaining hidden bombs', () => {
    const selected = selectEligibleSnakeResourceCandidates(resources({
      normal: {
        id: 'normal', origin: 'reasoning', contribution: 'normal', hiddenBomb: false,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'company', category: 'reasoning', cellIndex: 0 },
      },
      bomb: {
        id: 'bomb', origin: 'memory', contribution: 'normal', hiddenBomb: true,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'company', category: 'memory', cellIndex: 0 },
      },
      disguised: {
        id: 'disguised', origin: 'fluency', contribution: 'disguised', hiddenBomb: false,
        disguisedFrom: 'reasoning', recoverOnServiceDay: null,
        location: { kind: 'company', category: 'fluency', cellIndex: 0 },
      },
      moved: {
        id: 'moved', origin: 'reasoning', contribution: 'normal', hiddenBomb: false,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'reserve' },
      },
      synthetic: {
        id: 'synthetic', origin: 'sandbox', contribution: 'normal', hiddenBomb: false,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'company', category: 'reasoning', cellIndex: 1 },
      },
    }, {
      reasoning: ['normal', 'synthetic'],
      memory: ['bomb'],
      fluency: ['disguised'],
    }))

    expect(selected).toEqual([
      { blockId: 'bomb', origin: 'memory', contribution: 'normal', hiddenBomb: true },
      { blockId: 'normal', origin: 'reasoning', contribution: 'normal', hiddenBomb: false },
    ])
  })

  it('rejects a block whose claimed company location is not backed by its category array', () => {
    const selected = selectEligibleSnakeResourceCandidates(resources({
      orphan: {
        id: 'orphan', origin: 'reasoning', contribution: 'normal', hiddenBomb: false,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'company', category: 'reasoning', cellIndex: 0 },
      },
    }, { ...emptyCompany, reasoning: [] }))

    expect(selected).toEqual([])
  })

  it('exposes the fixed category colors at the encounter boundary', () => {
    expect(SNAKE_CATEGORY_COLORS).toEqual({
      reasoning: '#f06a43',
      memory: '#4f8df7',
      fluency: '#e8bd59',
    })
  })

  it('uses each eligible category before repeating a category and never reserves a block twice', () => {
    const candidates = [
      candidate('reasoning-1', 'reasoning'),
      candidate('reasoning-2', 'reasoning'),
      candidate('memory-1', 'memory'),
      candidate('memory-2', 'memory'),
      candidate('fluency-1', 'fluency'),
      candidate('fluency-2', 'fluency'),
    ]
    let bag = { cycle: 0, remainingCategories: [] as SnakeResourceCandidate['origin'][] }
    const categories: string[] = []

    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      const result = encounter(candidates, 0, ordinal, bag)
      expect(result.setup).not.toBeNull()
      categories.push(result.setup!.enemies[0].category)
      expect(new Set(result.setup!.enemies.map((enemy) => enemy.reservedBlockId)).size).toBe(
        result.setup!.enemies.length,
      )
      bag = result.bag
    }

    expect(new Set(categories)).toEqual(new Set(['reasoning', 'memory', 'fluency']))
  })
})

describe('snake encounter difficulty and reservation setup', () => {
  it.each([
    [0, 1, [30], 1_000, 48, 6, 420, 6.2],
    [3, 1, [50], 1_400, 72, 7, 360, 6.5],
    [6, 2, [35, 35], 1_600, 72, 8, 320, 6.7],
    [9, 1, [65], 2_000, 96, 9, 260, 7.0],
  ])('maps %i deposits to its enemy and planner profile', (
    deposits,
    enemyCount,
    integrity,
    lookaheadMs,
    candidateCount,
    planningHz,
    commitMs,
    speed,
  ) => {
    const result = encounter([
      candidate('reasoning-1', 'reasoning'),
      candidate('memory-1', 'memory'),
    ], deposits)

    expect(result.setup!.enemies).toHaveLength(enemyCount)
    expect(result.setup!.enemies.map((enemy) => enemy.maximumIntegrity)).toEqual(integrity)
    expect(result.setup!.enemies.map((enemy) => enemy.maximumSpeedPerSecond)).toEqual(
      Array.from({ length: enemyCount }, () => speed),
    )
    expect(result.plannerProfile).toEqual({
      lookaheadMs,
      candidateCount,
      planningHz,
      commitMs,
      rolloutStepMs: 50,
    })
  })

  it('uses the seeded 12+ parity branch and falls back to one 80-integrity enemy without two blocks', () => {
    const candidates = [candidate('reasoning-1', 'reasoning'), candidate('memory-1', 'memory')]
    const even = createResourceSnakeEncounter({
      campaignSeed: 'seed-0', roundOrdinal: 1, successfulDeposits: 12, candidates,
      bag: { cycle: 0, remainingCategories: [] },
    })
    const odd = createResourceSnakeEncounter({
      campaignSeed: 'seed-1', roundOrdinal: 1, successfulDeposits: 12, candidates,
      bag: { cycle: 0, remainingCategories: [] },
    })
    const fallback = encounter([candidate('reasoning-only', 'reasoning')], 12, 2)

    expect(even.setup!.enemies.map((enemy) => enemy.maximumIntegrity)).toEqual([80])
    expect(odd.setup!.enemies.map((enemy) => enemy.maximumIntegrity)).toEqual([50, 50])
    expect(fallback.setup!.enemies.map((enemy) => enemy.maximumIntegrity)).toEqual([80])
  })

  it('creates deterministic round, enemy, reward, spawn, and role identifiers', () => {
    const result = encounter([
      candidate('reasoning-1', 'reasoning'),
      candidate('memory-1', 'memory'),
    ], 6, 7)

    expect(result.setup).toEqual(expect.objectContaining({
      roundId: 'campaign-alpha:snake:7',
      playerSpawn: { x: 25, y: 21 },
      enemies: expect.arrayContaining([
        expect.objectContaining({
          id: 'enemy-0', rewardKey: 'campaign-alpha:snake:7:enemy-0:memory-1',
          spawn: { x: 16, y: 3.5 }, role: 'pressure', maximumIntegrity: 35,
        }),
        expect.objectContaining({
          id: 'enemy-1', rewardKey: 'campaign-alpha:snake:7:enemy-1:reasoning-1',
          spawn: { x: 34, y: 3.5 }, role: 'blocker', maximumIntegrity: 35,
        }),
      ]),
    }))
  })

  it('returns a disabled result when compact candidates contain no normal block', () => {
    const result = encounter([
      { ...candidate('dup', 'reasoning'), contribution: 'disguised' },
      { ...candidate('dup', 'memory'), contribution: 'disguised' },
    ])

    expect(result.setup).toBeNull()
    expect(result.disabledReason).toBe('no-eligible-resource')
  })

  it('defensively collapses duplicate compact block IDs before clamping the enemy count', () => {
    const result = encounter([
      candidate('same-block', 'reasoning'),
      candidate('same-block', 'memory'),
    ], 6)

    expect(result.setup!.enemies).toHaveLength(1)
    expect(result.setup!.enemies[0].reservedBlockId).toBe('same-block')
  })

  it('cancels moved reservations without substituting the defeated enemy block', () => {
    const setup = encounter([candidate('reasoning-1', 'reasoning')]).setup!
    const state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
    const reconciled = reconcileSnakeReservations(state, new Set<string>())

    expect(reconciled.enemies[0]).toMatchObject({
      reservedBlockId: 'reasoning-1', reservationStatus: 'cancelled',
    })
    expect(reconciled.events).toContainEqual(expect.objectContaining({
      type: 'resource-reward-resolved',
      rewardKey: 'campaign-alpha:snake:1:enemy-0:reasoning-1',
      outcome: 'cancelled',
    }))
  })
})
