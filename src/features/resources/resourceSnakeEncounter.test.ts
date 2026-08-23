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

  it('rejects a block when its ID is present at a different company cell than its location', () => {
    const selected = selectEligibleSnakeResourceCandidates(resources({
      misplaced: {
        id: 'misplaced', origin: 'reasoning', contribution: 'normal', hiddenBomb: false,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'company', category: 'reasoning', cellIndex: 1 },
      },
    }, { ...emptyCompany, reasoning: ['misplaced', null] }))

    expect(selected).toEqual([])
  })

  it('rejects a resource block whose record key does not match its claimed ID', () => {
    const selected = selectEligibleSnakeResourceCandidates(resources({
      staleKey: {
        id: 'claimed-id', origin: 'reasoning', contribution: 'normal', hiddenBomb: false,
        disguisedFrom: null, recoverOnServiceDay: null,
        location: { kind: 'company', category: 'reasoning', cellIndex: 0 },
      },
    }, { ...emptyCompany, reasoning: ['claimed-id'] }))

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

  it('consumes only one category from an incoming bag because each round has one bot', () => {
    const result = createResourceSnakeEncounter({
      campaignSeed: 'seed-3',
      roundOrdinal: 1,
      successfulDeposits: 12,
      candidates: [
        candidate('r1', 'reasoning'),
        candidate('r2', 'reasoning'),
        candidate('m1', 'memory'),
      ],
      bag: { cycle: 1, remainingCategories: ['reasoning'] },
    })

    expect(result.setup!.enemies.map((enemy) => enemy.category)).toEqual(['reasoning'])
    expect(result.bag).toEqual({ cycle: 1, remainingCategories: [] })
  })

  it.each(['memory', 'reasoning', 'fluency'] as const)(
    'reserves only the explicitly selected %s category',
    (targetCategory) => {
      const candidates = [
        candidate('memory-1', 'memory'),
        candidate('memory-2', 'memory'),
        candidate('reasoning-1', 'reasoning'),
        candidate('reasoning-2', 'reasoning'),
        candidate('fluency-1', 'fluency'),
        candidate('fluency-2', 'fluency'),
      ]
      const input = {
        campaignSeed: 'selected-target',
        roundOrdinal: 4,
        successfulDeposits: 0,
        completedRounds: 4,
        targetCategory,
        bag: { cycle: 2, remainingCategories: ['reasoning', 'memory'] as SnakeResourceCandidate['origin'][] },
      }
      const first = createResourceSnakeEncounter({ ...input, candidates })
      const second = createResourceSnakeEncounter({
        ...input,
        candidates: [...candidates].reverse(),
      })

      expect(first.setup?.enemies).toHaveLength(1)
      expect(first.setup?.enemies[0].category).toBe(targetCategory)
      expect(second.setup?.enemies[0].reservedBlockId)
        .toBe(first.setup?.enemies[0].reservedBlockId)
      expect(first.bag).toEqual(input.bag)
    },
  )

  it('returns no setup when the explicitly selected category has no candidate', () => {
    const result = createResourceSnakeEncounter({
      campaignSeed: 'missing-selected-target',
      roundOrdinal: 0,
      successfulDeposits: 0,
      targetCategory: 'memory',
      candidates: [candidate('reasoning-only', 'reasoning')],
      bag: { cycle: 0, remainingCategories: [] },
    })

    expect(result.setup).toBeNull()
    expect(result.disabledReason).toBe('no-eligible-resource')
  })
})

describe('snake encounter difficulty and reservation setup', () => {
  it.each([
    [0, 'cyan-intro', [30], 1_400, 48, 10, 220, 260, 900],
    [6, 'cyan-advanced', [65], 1_800, 72, 12, 190, 220, 800],
    [12, 'cyan-dual-role', [50], 2_200, 96, 14, 160, 180, 700],
  ] as const)('maps %i deposits to %s and its cyan profile', (
    deposits,
    stage,
    integrity,
    lookaheadMs,
    candidateCount,
    planningHz,
    telegraphMs,
    commitMs,
    minimumHeadingHoldMs,
  ) => {
    const result = encounter([
      candidate('reasoning-1', 'reasoning'),
      candidate('memory-1', 'memory'),
    ], deposits)

    expect(result.setup!.enemies).toHaveLength(1)
    expect(result.setup!.enemies.map((enemy) => enemy.maximumIntegrity)).toEqual(integrity)
    expect(result.setup!.enemies.map((enemy) => enemy.maximumSpeedPerSecond)).toEqual([9])
    expect(result.stage).toBe(stage)
    expect(result.doctrine).toBe('readable-hunter')
    expect(result.cyanProfile).toMatchObject({
      stage,
      doctrine: 'readable-hunter',
      lookaheadMs,
      candidateCount,
      planningHz,
      telegraphMs,
      commitMs,
      rolloutStepMs: 50,
      recoverySpeedScale: 0.92,
    })
    expect(result.plannerProfile).toEqual({
      lookaheadMs,
      candidateCount,
      planningHz,
      commitMs,
      minimumHeadingHoldMs,
      rolloutStepMs: 50,
    })
  })

  it('always deploys one bot even at 12+ deposits', () => {
    const candidates = [candidate('reasoning-1', 'reasoning'), candidate('memory-1', 'memory')]
    const firstSeed = createResourceSnakeEncounter({
      campaignSeed: 'seed-0', roundOrdinal: 1, successfulDeposits: 12, candidates,
      bag: { cycle: 0, remainingCategories: [] },
    })
    const secondSeed = createResourceSnakeEncounter({
      campaignSeed: 'seed-1', roundOrdinal: 1, successfulDeposits: 12, candidates,
      bag: { cycle: 0, remainingCategories: [] },
    })
    const fallback = createResourceSnakeEncounter({
      campaignSeed: 'seed-1', roundOrdinal: 1, successfulDeposits: 12,
      candidates: [candidate('reasoning-only', 'reasoning')],
      bag: { cycle: 0, remainingCategories: [] },
    })

    for (const result of [firstSeed, secondSeed]) {
      expect(result.setup).toMatchObject({
        playerSpawn: { x: 25, y: 21 },
        enemies: [
          { maximumIntegrity: 50, maximumSpeedPerSecond: 9, spawn: { x: 25, y: 3.5 }, role: 'pressure' },
        ],
      })
      expect(result.stage).toBe('cyan-dual-role')
    }
    expect(fallback.setup).toMatchObject({
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        maximumIntegrity: 50, maximumSpeedPerSecond: 9,
        spawn: { x: 25, y: 3.5 }, role: 'pressure',
      }],
    })
  })

  it.each([
    [0, 9],
    [10, 10],
    [20, 11],
    [30, 12],
    [35, 12.5],
    [200, 12.5],
  ])('uses completed-round speed %i -> %f regardless of resource color', (completedRounds, speed) => {
    for (const origin of ['reasoning', 'memory', 'fluency'] as const) {
      const result = createResourceSnakeEncounter({
        campaignSeed: `speed-${origin}`,
        roundOrdinal: completedRounds,
        successfulDeposits: 99,
        completedRounds,
        candidates: [candidate(`${origin}-1`, origin)],
        bag: { cycle: 0, remainingCategories: [] },
      })
      expect(result.setup?.enemies[0].maximumSpeedPerSecond).toBe(speed)
    }
  })

  it('passes the five-stage player speed upgrade into the runtime setup only', () => {
    const result = createResourceSnakeEncounter({
      campaignSeed: 'player-speed-upgrade',
      roundOrdinal: 4,
      successfulDeposits: 4,
      completedRounds: 4,
      speedUpgradeLevel: 5,
      candidates: [candidate('reasoning-1', 'reasoning')],
      bag: { cycle: 0, remainingCategories: [] },
    })

    expect(result.setup?.playerMaximumSpeedPerSecond).toBe(14.4)
    expect(result.setup?.enemies[0].maximumSpeedPerSecond).toBe(9.4)
  })

  it('creates deterministic round, enemy, reward, spawn, and role identifiers', () => {
    const result = encounter([
      candidate('reasoning-1', 'reasoning'),
      candidate('memory-1', 'memory'),
    ], 12, 7)

    expect(result.setup).toEqual(expect.objectContaining({
      roundId: 'campaign-alpha:snake:7',
      playerSpawn: { x: 25, y: 21 },
      enemies: expect.arrayContaining([
        expect.objectContaining({
          id: 'enemy-0', rewardKey: 'campaign-alpha:snake:7:enemy-0:memory-1',
          spawn: { x: 25, y: 3.5 }, role: 'pressure', maximumIntegrity: 50,
          maximumSpeedPerSecond: 9,
        }),
      ]),
    }))
    expect(result.setup!.enemies).toHaveLength(1)
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
    ], 12)

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

  it('removes a pending reservation reward exactly once and remains cancelled after reconciliation', () => {
    const setup = encounter([candidate('reasoning-1', 'reasoning')]).setup!
    const state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
    const pending = {
      ...state,
      enemies: state.enemies.map((enemy) => ({ ...enemy, reservationStatus: 'pending' as const })),
      effects: [{
        id: 1,
        type: 'request-resource-reward' as const,
        rewardKey: 'campaign-alpha:snake:1:enemy-0:reasoning-1',
        roundId: 'campaign-alpha:snake:1',
        enemyId: 'enemy-0' as const,
        blockId: 'reasoning-1',
      }],
    }

    const cancelled = reconcileSnakeReservations(pending, new Set<string>())
    const repeated = reconcileSnakeReservations(cancelled, new Set<string>())

    expect(cancelled.effects).toEqual([])
    expect(cancelled.enemies[0].reservationStatus).toBe('cancelled')
    expect(cancelled.events.filter((event) => event.type === 'resource-reward-resolved')).toHaveLength(1)
    expect(repeated).toBe(cancelled)
    expect(repeated.enemies[0].reservationStatus).toBe('cancelled')
    expect(repeated.effects).toEqual([])
  })
})
