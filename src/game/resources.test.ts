import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { COMPANY_CATEGORIES, type CampaignState, type CompanyCategory } from './model'
import {
  consumeReserveResources,
  divertBlock,
  getCompanyPerformance,
  moveDisguiseBlock,
  previewDiversion,
  repositionDisguisedBlock,
  restoreDisguiseBlocks,
} from './resources'

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
  it('moves the same block into reserve and applies the approved causal changes', () => {
    const initial = createCampaign('resource-seed')
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
    const initial = createCampaign('resource-seed')
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
    const normal = createCampaign('resource-seed')
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
    let state = createCampaign('property-seed')

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

describe('audit disguise blocks', () => {
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

  it('uses 1.1 and 0.55 contributions after compressed representation', () => {
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
    const result = moveDisguiseBlock(compressed, blockId, 'reasoning', targetCell)

    expect(result.accepted).toBe(true)
    if (!result.accepted) return

    expect(getCompanyPerformance(result.state, 'memory')).toBeCloseTo(16.5)
    expect(getCompanyPerformance(result.state, 'reasoning')).toBeCloseTo(18.15)
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
})

describe('reserve consumption', () => {
  it('consumes explicit reserve blocks without changing company grids', () => {
    const initial = createCampaign('consume-seed')
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
    const initial = createCampaign('consume-seed')
    const blockId = initial.resources.reserve[0]
    if (!blockId) throw new Error('초기 리소스 누락')

    expect(consumeReserveResources(initial, [blockId, blockId], 'hack')).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_RESOURCE_SELECTION',
    })
  })
})
