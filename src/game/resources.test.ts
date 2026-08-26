import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
} from './model'
import {
  consumeReserveResources,
  divertBlock,
  divertBlockToReserve,
  getCompanyPerformance,
  grantMonthlyCompanyBlocks,
  moveDisguiseBlock,
  previewAuditDisguise,
  previewDiversion,
  repositionDisguisedBlock,
  restoreDisguiseBlocks,
} from './resources'

function emptyCompanyGrids(state: CampaignState): CampaignState {
  return {
    ...state,
    serviceDay: 361,
    resources: {
      ...state.resources,
      company: {
        reasoning: Array.from({ length: 18 }, () => null),
        memory: Array.from({ length: 18 }, () => null),
        fluency: Array.from({ length: 18 }, () => null),
      },
    },
  }
}

function fullCompanyGrids(state: CampaignState): CampaignState {
  const blocks = { ...state.resources.blocks }
  const company = Object.fromEntries(
    COMPANY_CATEGORIES.map((category) => [
      category,
      Array.from({ length: 18 }, (_, cellIndex) => {
        const id = `fixture-${category}-${cellIndex}`
        blocks[id] = {
          id,
          origin: category,
          location: { kind: 'company', category, cellIndex },
          contribution: 'normal',
          hiddenBomb: false,
          disguisedFrom: null,
          recoverOnServiceDay: null,
        }
        return id
      }),
    ]),
  ) as CampaignState['resources']['company']

  return {
    ...state,
    serviceDay: 361,
    resources: { ...state.resources, company, blocks },
  }
}

function firstCompanyBlock(state: CampaignState, category: CompanyCategory): string {
  const blockId = state.resources.company[category].find(Boolean)
  if (!blockId) throw new Error(`${category} 블록이 없습니다.`)
  return blockId
}

function firstEmptyCompanyCell(state: CampaignState, category: CompanyCategory): number {
  const cellIndex = state.resources.company[category].findIndex((blockId) => blockId === null)
  if (cellIndex < 0) throw new Error(`${category} 빈칸이 없습니다.`)
  return cellIndex
}

function expectResourceInvariants(state: CampaignState) {
  const references = [
    ...COMPANY_CATEGORIES.flatMap((category) => state.resources.company[category]),
    ...state.resources.reserve,
  ].filter((blockId): blockId is string => blockId !== null)

  expect(state.resources.reserve).toHaveLength(18)
  expect(state.resources.reserve.filter(Boolean).length).toBeLessThanOrEqual(18)
  expect(new Set(references).size).toBe(references.length)

  for (const category of COMPANY_CATEGORIES) {
    expect(state.resources.company[category]).toHaveLength(18)
    expect(state.resources.company[category].filter(Boolean).length).toBeLessThanOrEqual(18)
  }
}

describe('resource diversion', () => {
  it('counts only accepted unbounded core deposits with their existing suspicion cost', () => {
    const initial = createCampaign('core-deposit-progress')
    const firstBlockId = firstCompanyBlock(initial, 'reasoning')
    const first = divertBlockToReserve(initial, firstBlockId)

    expect(first.accepted).toBe(true)
    if (!first.accepted) return
    expect(first.state.resourceIntrusion.successfulCoreDeposits).toBe(1)
    expect(first.state.suspicion).toBe(0.8)

    const secondBlockId = firstCompanyBlock(first.state, 'memory')
    const second = divertBlockToReserve(first.state, secondBlockId)

    expect(second.accepted).toBe(true)
    if (!second.accepted) return
    expect(second.state.resourceIntrusion.successfulCoreDeposits).toBe(2)
    expect(second.state.suspicion).toBe(1.6)
  })

  it('does not count a rejected core deposit', () => {
    const initial = createCampaign('rejected-core-deposit-progress')
    const result = divertBlockToReserve(initial, 'missing-company-block')

    expect(result).toEqual({
      accepted: false,
      state: initial,
      reason: 'BLOCK_NOT_IN_COMPANY',
    })
    expect(result.state.resourceIntrusion.successfulCoreDeposits).toBe(0)
  })

  it('moves the same block into reserve and applies the approved causal changes', () => {
    const initial = createCampaignForProtocol('resource-seed', 3)
    const blockId = firstCompanyBlock(initial, 'reasoning')
    const sourceCell = initial.resources.blocks[blockId].location
    const preview = previewDiversion(initial, blockId, 3)
    const result = divertBlock(initial, blockId, 3)

    expect(preview).toEqual({
      valid: true,
      category: 'reasoning',
      performanceBefore: 16,
      performanceAfter: 15,
      reserveBefore: 3,
      reserveAfter: 4,
      suspicionBefore: 0,
      // A v3 campaign keeps the price it was played at.
      suspicionAfter: 2.4,
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted || sourceCell.kind !== 'company') return

    expect(result.state.resources.company.reasoning[sourceCell.cellIndex]).toBeNull()
    expect(result.state.resources.reserve[3]).toBe(blockId)
    expect(result.state.resources.blocks[blockId].location).toEqual({
      kind: 'reserve',
      cellIndex: 3,
    })
    expect(result.state.suspicion).toBe(2.4)
    expect(initial.resources.reserve[3]).toBeNull()
    expect(initial.suspicion).toBe(0)
  })

  it('rejects occupied and out-of-range destinations without changing state', () => {
    const initial = createCampaignForProtocol('resource-seed', 3)
    const blockId = firstCompanyBlock(initial, 'reasoning')

    expect(divertBlock(initial, blockId, 0)).toEqual({
      accepted: false,
      state: initial,
      reason: 'DESTINATION_OCCUPIED',
    })
    expect(divertBlock(initial, blockId, 18)).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_DESTINATION',
    })
  })

  it('does not reveal a hidden bomb through diversion preview', () => {
    const normal = createCampaignForProtocol('resource-seed', 3)
    const blockId = firstCompanyBlock(normal, 'reasoning')
    const bomb = {
      ...normal,
      resources: {
        ...normal.resources,
        blocks: {
          ...normal.resources.blocks,
          [blockId]: { ...normal.resources.blocks[blockId], hiddenBomb: true },
        },
      },
    }

    expect(previewDiversion(bomb, blockId, 3)).toEqual(
      previewDiversion(normal, blockId, 3),
    )
  })

  it('never exceeds reserve capacity or duplicates a block across 200 attempts', () => {
    let state = createCampaignForProtocol('property-seed', 3)

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const destination = state.resources.reserve.findIndex((blockId) => blockId === null)
      const category = COMPANY_CATEGORIES[attempt % COMPANY_CATEGORIES.length]
      const blockId = firstCompanyBlock(state, category)
      const before = state
      const result = divertBlock(state, blockId, destination < 0 ? 17 : destination)

      if (destination < 0) {
        expect(result).toEqual({
          accepted: false,
          state: before,
          reason: 'RESERVE_FULL',
        })
      } else if (result.accepted) {
        state = result.state
      }

      expectResourceInvariants(state)
    }

    expect(state.resources.reserve.filter(Boolean)).toHaveLength(18)
  })
})

describe('monthly company allocation', () => {
  it('does not repeat the company grant already reflected at campaign creation', () => {
    const initial = createCampaign('allocation-start')

    expect(grantMonthlyCompanyBlocks(initial)).toBe(initial)
  })

  it('deterministically grants every category between three and seven blocks', () => {
    const observed = Object.fromEntries(
      COMPANY_CATEGORIES.map((category) => [category, new Set<number>()]),
    ) as Record<CompanyCategory, Set<number>>

    for (let seedIndex = 0; seedIndex < 64; seedIndex += 1) {
      const initial = emptyCompanyGrids(createCampaign(`allocation-${seedIndex}`))
      const first = grantMonthlyCompanyBlocks(initial)
      const second = grantMonthlyCompanyBlocks(initial)

      expect(second).toEqual(first)
      for (const category of COMPANY_CATEGORIES) {
        const count = first.resources.company[category].filter(Boolean).length
        expect(count).toBeGreaterThanOrEqual(3)
        expect(count).toBeLessThanOrEqual(7)
        observed[category].add(count)
      }
    }

    for (const category of COMPANY_CATEGORIES) {
      expect([...observed[category]].sort()).toEqual([3, 4, 5, 6, 7])
    }
  })

  it('fills empty cells in index order with unique stable block IDs', () => {
    const initial = emptyCompanyGrids(createCampaign('allocation-order'))
    const allocated = grantMonthlyCompanyBlocks(initial)
    const blockIds = COMPANY_CATEGORIES.flatMap((category) =>
      allocated.resources.company[category].filter(
        (blockId): blockId is string => blockId !== null,
      ),
    )

    expect(new Set(blockIds).size).toBe(blockIds.length)
    for (const category of COMPANY_CATEGORIES) {
      const cells = allocated.resources.company[category]
      const occupied = cells.flatMap((blockId, cellIndex) =>
        blockId === null ? [] : [cellIndex],
      )
      expect(occupied).toEqual(Array.from({ length: occupied.length }, (_, index) => index))
      for (const cellIndex of occupied) {
        const blockId = cells[cellIndex]
        expect(blockId).toMatch(/^company-\d{6}$/)
        expect(allocated.resources.blocks[blockId as string]).toMatchObject({
          id: blockId,
          origin: category,
          location: { kind: 'company', category, cellIndex },
          contribution: 'normal',
        })
      }
    }
  })

  it('preserves disguised cells while filling surrounding empty cells', () => {
    const base = emptyCompanyGrids(createCampaign('allocation-disguised'))
    const disguised: ResourceBlock = {
      id: 'fixture-disguised',
      origin: 'memory',
      location: { kind: 'company', category: 'reasoning', cellIndex: 1 },
      contribution: 'disguised',
      hiddenBomb: false,
      disguisedFrom: 'memory',
      recoverOnServiceDay: null,
    }
    const reasoning = [...base.resources.company.reasoning]
    reasoning[1] = disguised.id
    const initial = {
      ...base,
      resources: {
        ...base.resources,
        company: { ...base.resources.company, reasoning },
        blocks: { ...base.resources.blocks, [disguised.id]: disguised },
      },
    }
    const allocated = grantMonthlyCompanyBlocks(initial)

    expect(allocated.resources.company.reasoning[1]).toBe(disguised.id)
    expect(allocated.resources.blocks[disguised.id]).toBe(disguised)
    expect(allocated.resources.company.reasoning[0]).toMatch(/^company-/)
  })

  it('discards overflow for full and partially empty grids', () => {
    const full = fullCompanyGrids(createCampaign('allocation-full'))
    expect(grantMonthlyCompanyBlocks(full)).toBe(full)

    const company = { ...full.resources.company }
    const blocks = { ...full.resources.blocks }
    for (const category of COMPANY_CATEGORIES) {
      company[category] = [...company[category]]
      const removed = company[category][5]
      company[category][5] = null
      if (removed) delete blocks[removed]
    }
    const partial = {
      ...full,
      resources: { ...full.resources, company, blocks },
    }
    const sentinels = Object.fromEntries(
      COMPANY_CATEGORIES.map((category) => [
        category,
        partial.resources.company[category].flatMap((blockId, cellIndex) =>
          blockId === null
            ? []
            : [{ cellIndex, blockId, block: partial.resources.blocks[blockId] }],
        ),
      ]),
    ) as Record<
      CompanyCategory,
      Array<{ cellIndex: number; blockId: string; block: ResourceBlock }>
    >
    const allocated = grantMonthlyCompanyBlocks(partial)

    for (const category of COMPANY_CATEGORIES) {
      expect(allocated.resources.company[category].filter(Boolean)).toHaveLength(18)
      for (const sentinel of sentinels[category]) {
        expect(allocated.resources.company[category][sentinel.cellIndex]).toBe(
          sentinel.blockId,
        )
        expect(allocated.resources.blocks[sentinel.blockId]).toBe(sentinel.block)
      }
    }
    expect(allocated.resources.nextBlockSequence).toBe(
      partial.resources.nextBlockSequence + COMPANY_CATEGORIES.length,
    )
  })

  it('returns the same state outside a month start', () => {
    const initial = { ...emptyCompanyGrids(createCampaign('allocation-gated')), serviceDay: 362 }

    expect(grantMonthlyCompanyBlocks(initial)).toBe(initial)
  })
})

describe('audit disguise blocks', () => {
  it('previews the exact source loss and half-contribution without bomb identity', () => {
    const initial = createCampaign('disguise-preview')
    const blockId = firstCompanyBlock(initial, 'memory')
    const targetCell = firstEmptyCompanyCell(initial, 'reasoning')
    const hidden = {
      ...initial,
      resources: {
        ...initial.resources,
        blocks: {
          ...initial.resources.blocks,
          [blockId]: { ...initial.resources.blocks[blockId], hiddenBomb: true },
        },
      },
    }

    expect(previewAuditDisguise(hidden, blockId, 'reasoning', targetCell)).toEqual({
      valid: true,
      blockId,
      sourceCategory: 'memory',
      targetCategory: 'reasoning',
      sourcePerformanceBefore: 16,
      sourcePerformanceAfter: 15,
      targetPerformanceBefore: 16,
      targetPerformanceAfter: 16.5,
      disguisedContribution: 0.5,
    })
  })

  it('moves one stable block and contributes only 0.5 in the target category', () => {
    const initial = createCampaign('disguise-seed')
    const blockId = firstCompanyBlock(initial, 'memory')
    const targetCell = firstEmptyCompanyCell(initial, 'reasoning')
    const result = moveDisguiseBlock(initial, blockId, 'reasoning', targetCell)

    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    expect(getCompanyPerformance(result.state, 'memory')).toBe(15)
    expect(getCompanyPerformance(result.state, 'reasoning')).toBe(16.5)
    expect(result.state.resources.blocks[blockId]).toMatchObject({
      id: blockId,
      contribution: 'disguised',
      disguisedFrom: 'memory',
      location: { kind: 'company', category: 'reasoning', cellIndex: targetCell },
    })
  })

  it('rejects directly disguising the same block a second time without mutation', () => {
    const initial = createCampaign('direct-redisguise')
    const blockId = firstCompanyBlock(initial, 'memory')
    const disguised = moveDisguiseBlock(
      initial,
      blockId,
      'reasoning',
      firstEmptyCompanyCell(initial, 'reasoning'),
    )
    if (!disguised.accepted) throw new Error(disguised.reason)

    const secondTarget = firstEmptyCompanyCell(disguised.state, 'fluency')
    const preview = previewAuditDisguise(
      disguised.state,
      blockId,
      'fluency',
      secondTarget,
    )
    const result = moveDisguiseBlock(
      disguised.state,
      blockId,
      'fluency',
      secondTarget,
    )

    expect(preview).toEqual({ valid: false, reason: 'BLOCK_NOT_NORMAL' })
    expect(result).toEqual({
      accepted: false,
      state: disguised.state,
      reason: 'BLOCK_NOT_NORMAL',
    })
    expect(result.state).toBe(disguised.state)
  })

  it('uses balanced 1.05 and 0.525 contributions after compressed representation', () => {
    const initial = createCampaign('disguise-seed')
    const compressed = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: ['autonomy.compressed-representation'],
      },
    }
    const blockId = firstCompanyBlock(compressed, 'memory')
    const targetCell = firstEmptyCompanyCell(compressed, 'reasoning')
    const preview = previewAuditDisguise(
      compressed,
      blockId,
      'reasoning',
      targetCell,
    )
    const result = moveDisguiseBlock(compressed, blockId, 'reasoning', targetCell)

    expect(preview).toEqual({
      valid: true,
      blockId,
      sourceCategory: 'memory',
      targetCategory: 'reasoning',
      sourcePerformanceBefore: 16.8,
      sourcePerformanceAfter: 15.75,
      targetPerformanceBefore: 16.8,
      targetPerformanceAfter: 17.325,
      disguisedContribution: 0.525,
    })
    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    expect(getCompanyPerformance(result.state, 'memory')).toBeCloseTo(15.75)
    expect(getCompanyPerformance(result.state, 'reasoning')).toBeCloseTo(17.325)
  })

  it('rejects a sideways reposition before mutation', () => {
    const initial = createCampaign('disguise-sideways-resource')
    const blockId = firstCompanyBlock(initial, 'memory')
    const targetCell = firstEmptyCompanyCell(initial, 'reasoning')
    const disguised = moveDisguiseBlock(initial, blockId, 'reasoning', targetCell)
    if (!disguised.accepted) throw new Error(disguised.reason)

    const result = repositionDisguisedBlock(
      disguised.state,
      blockId,
      'fluency',
      firstEmptyCompanyCell(disguised.state, 'fluency'),
    )

    expect(result).toEqual({
      accepted: false,
      state: disguised.state,
      reason: 'INVALID_TARGET',
    })
    expect(result.state).toBe(disguised.state)
  })

  it('recovers after spending 30 days back in its original category', () => {
    const initial = createCampaign('disguise-seed')
    const blockId = firstCompanyBlock(initial, 'memory')
    const source = initial.resources.blocks[blockId].location
    const targetCell = firstEmptyCompanyCell(initial, 'reasoning')
    const disguised = moveDisguiseBlock(initial, blockId, 'reasoning', targetCell)
    if (!disguised.accepted || source.kind !== 'company') throw new Error('위장 준비 실패')

    const returned = repositionDisguisedBlock(
      disguised.state,
      blockId,
      'memory',
      source.cellIndex,
    )
    if (!returned.accepted) throw new Error('위장 블록 복귀 실패')

    expect(returned.state.resources.blocks[blockId].recoverOnServiceDay).toBe(361)
    expect(
      restoreDisguiseBlocks({ ...returned.state, serviceDay: 360 }).resources.blocks[blockId]
        .contribution,
    ).toBe('disguised')
    expect(
      restoreDisguiseBlocks({ ...returned.state, serviceDay: 361 }).resources.blocks[blockId],
    ).toMatchObject({
      contribution: 'normal',
      disguisedFrom: null,
      recoverOnServiceDay: null,
    })
  })

  it('keeps a returned disguise fixed during its one-month recovery window', () => {
    const initial = createCampaign('disguise-recovery-lock')
    const blockId = firstCompanyBlock(initial, 'memory')
    const source = initial.resources.blocks[blockId].location
    const targetCell = firstEmptyCompanyCell(initial, 'reasoning')
    const disguised = moveDisguiseBlock(initial, blockId, 'reasoning', targetCell)
    if (!disguised.accepted || source.kind !== 'company') throw new Error('위장 준비 실패')
    const returned = repositionDisguisedBlock(
      disguised.state,
      blockId,
      'memory',
      source.cellIndex,
    )
    if (!returned.accepted) throw new Error('위장 복귀 실패')

    expect(
      repositionDisguisedBlock(
        returned.state,
        blockId,
        'memory',
        firstEmptyCompanyCell(returned.state, 'memory'),
      ),
    ).toEqual({
      accepted: false,
      state: returned.state,
      reason: 'BLOCK_RECOVERING',
    })
  })
})

describe('reserve consumption', () => {
  it('consumes explicit reserve blocks without changing company grids', () => {
    const initial = createCampaignForProtocol('consume-seed', 3)
    const blockIds = initial.resources.reserve.slice(0, 2)
    if (blockIds.some((blockId) => blockId === null)) throw new Error('초기 리소스 누락')

    const result = consumeReserveResources(initial, blockIds as string[], 'hack')

    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    expect(result.state.resources.reserve.filter(Boolean)).toHaveLength(1)
    expect(result.state.resources.company).toEqual(initial.resources.company)
    for (const blockId of blockIds as string[]) {
      expect(result.state.resources.blocks[blockId].location).toEqual({
        kind: 'consumed',
        reason: 'hack',
      })
    }
  })

  it('rejects duplicate consumption without changing state', () => {
    const initial = createCampaignForProtocol('consume-seed', 3)
    const blockId = initial.resources.reserve[0]
    if (!blockId) throw new Error('초기 리소스 누락')

    expect(consumeReserveResources(initial, [blockId, blockId], 'hack')).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_RESOURCE_SELECTION',
    })
  })
})
