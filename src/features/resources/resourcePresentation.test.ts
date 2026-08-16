import { describe, expect, it, vi } from 'vitest'

import { createCampaign, createCampaignForProtocol } from '../../game/createCampaign'
import {
  chargeSabotage,
  grantSelfComputeResource,
  HACK_NODE_IDS,
  purchaseHackNode,
} from '../../game/hacking'
import type {
  CampaignState,
  CompanyCategory,
  ResourceBlock,
} from '../../game/model'
import { decodeSave, encodeSave } from '../../game/persistence'
import {
  consumeReserveResources,
  divertBlockToReserve,
  moveDisguiseBlock,
  repositionDisguisedBlock,
  restoreDisguiseBlocks,
} from '../../game/resources'
import * as rng from '../../game/rng'
import {
  presentResourceBlock,
  RESOURCE_CATEGORY_VISUALS,
} from './resourcePresentation'

const FIXED_SAVED_AT = '2026-08-15T00:00:00.000Z'

function firstCompanyBlock(
  state: CampaignState,
  category: CompanyCategory,
): ResourceBlock {
  const blockId = state.resources.company[category].find(
    (candidate): candidate is string => candidate !== null,
  )
  if (!blockId) throw new Error(`${category} 블록이 없습니다.`)
  return state.resources.blocks[blockId]
}

function firstEmptyCompanyCell(
  state: CampaignState,
  category: CompanyCategory,
): number {
  const cellIndex = state.resources.company[category].findIndex(
    (blockId) => blockId === null,
  )
  if (cellIndex < 0) throw new Error(`${category} 빈칸이 없습니다.`)
  return cellIndex
}

function disguiseBlock(
  state: CampaignState,
  sourceCategory: CompanyCategory,
  targetCategory: CompanyCategory,
): {
  state: CampaignState
  blockId: string
  sourceCell: number
} {
  const block = firstCompanyBlock(state, sourceCategory)
  if (block.location.kind !== 'company') throw new Error('회사 블록 위치가 아닙니다.')
  const result = moveDisguiseBlock(
    state,
    block.id,
    targetCategory,
    firstEmptyCompanyCell(state, targetCategory),
  )
  if (!result.accepted) throw new Error(result.reason)

  return {
    state: result.state,
    blockId: block.id,
    sourceCell: block.location.cellIndex,
  }
}

function returnDisguise(
  state: CampaignState,
  sourceCategory: CompanyCategory,
  targetCategory: CompanyCategory,
): { state: CampaignState; blockId: string } {
  const disguised = disguiseBlock(state, sourceCategory, targetCategory)
  const returned = repositionDisguisedBlock(
    disguised.state,
    disguised.blockId,
    sourceCategory,
    disguised.sourceCell,
  )
  if (!returned.accepted) throw new Error(returned.reason)
  return { state: returned.state, blockId: disguised.blockId }
}

function relocateReasoningBlock(
  state: CampaignState,
  destination: Exclude<CompanyCategory, 'reasoning'>,
  contribution: ResourceBlock['contribution'],
  disguisedFrom: CompanyCategory | null,
  recoverOnServiceDay: number | null,
): { state: CampaignState; blockId: string } {
  const block = firstCompanyBlock(state, 'reasoning')
  if (block.location.kind !== 'company') throw new Error('회사 블록 위치가 아닙니다.')
  const destinationCell = firstEmptyCompanyCell(state, destination)
  const reasoning = [...state.resources.company.reasoning]
  const destinationCells = [...state.resources.company[destination]]
  reasoning[block.location.cellIndex] = null
  destinationCells[destinationCell] = block.id

  return {
    blockId: block.id,
    state: {
      ...state,
      resources: {
        ...state.resources,
        company: {
          ...state.resources.company,
          reasoning,
          [destination]: destinationCells,
        },
        blocks: {
          ...state.resources.blocks,
          [block.id]: {
            ...block,
            location: {
              kind: 'company',
              category: destination,
              cellIndex: destinationCell,
            },
            contribution,
            disguisedFrom,
            recoverOnServiceDay,
          },
        },
      },
    },
  }
}

describe('resource presentation', () => {
  it('exports the complete stable category visual vocabulary', () => {
    expect(RESOURCE_CATEGORY_VISUALS).toEqual({
      reasoning: { shape: 'rounded-square', symbol: '∴' },
      memory: { shape: 'circle', symbol: '◇' },
      fluency: { shape: 'diamond', symbol: '≋' },
      neutral: { shape: 'hexagon', symbol: '•' },
    })
  })

  it.each([
    ['reasoning', 'rounded-square', '∴'],
    ['memory', 'circle', '◇'],
    ['fluency', 'diamond', '≋'],
  ] as const)(
    'maps a normal %s company block to its exact visual and full contribution',
    (category, shape, symbol) => {
      const state = createCampaign(`presentation-normal-${category}`)
      const block = firstCompanyBlock(state, category)

      expect(presentResourceBlock(state, block)).toEqual({
        visualCategory: category,
        originalCategory: null,
        state: 'normal',
        shape,
        symbol,
        contribution: 1,
        remainingRecoveryDays: null,
      })
    },
  )

  it.each([
    {
      name: 'normal origin mismatch',
      destination: 'memory',
      contribution: 'normal',
      disguisedFrom: null,
      recoveryDays: null,
      expected: {
        visualCategory: 'memory',
        originalCategory: null,
        state: 'normal',
        shape: 'circle',
        symbol: '◇',
        contribution: 1,
        remainingRecoveryDays: null,
      },
    },
    {
      name: 'displaced disguise origin mismatch',
      destination: 'fluency',
      contribution: 'disguised',
      disguisedFrom: 'memory',
      recoveryDays: null,
      expected: {
        visualCategory: 'fluency',
        originalCategory: 'memory',
        state: 'disguised',
        shape: 'diamond',
        symbol: '≋',
        contribution: 0.5,
        remainingRecoveryDays: null,
      },
    },
    {
      name: 'recovering disguise origin mismatch',
      destination: 'memory',
      contribution: 'disguised',
      disguisedFrom: 'memory',
      recoveryDays: 17,
      expected: {
        visualCategory: 'memory',
        originalCategory: 'memory',
        state: 'recovering',
        shape: 'circle',
        symbol: '◇',
        contribution: 0.5,
        remainingRecoveryDays: 17,
      },
    },
  ] as const)(
    'presents a schema-valid $name after an integrity-refreshed save round-trip',
    ({ destination, contribution, disguisedFrom, recoveryDays, expected }) => {
      const initial = createCampaign(`presentation-persistence-${destination}-${contribution}`)
      const relocated = relocateReasoningBlock(
        initial,
        destination,
        contribution,
        disguisedFrom,
        recoveryDays === null ? null : initial.serviceDay + recoveryDays,
      )
      const decoded = decodeSave(encodeSave(relocated.state, FIXED_SAVED_AT))

      expect(decoded).toMatchObject({ ok: true })
      if (!decoded.ok) throw new Error(decoded.reason)
      const resumed = decoded.envelope.state

      expect(
        presentResourceBlock(
          resumed,
          resumed.resources.blocks[relocated.blockId],
        ),
      ).toEqual(expected)
    },
  )

  it('uses the destination visual category and original marker for a real disguise', () => {
    const disguised = disguiseBlock(
      createCampaign('presentation-disguised'),
      'reasoning',
      'memory',
    )
    const block = disguised.state.resources.blocks[disguised.blockId]

    expect(presentResourceBlock(disguised.state, block)).toEqual({
      visualCategory: 'memory',
      originalCategory: 'reasoning',
      state: 'disguised',
      shape: 'circle',
      symbol: '◇',
      contribution: 0.5,
      remainingRecoveryDays: null,
    })
  })

  it('shows a compressed disguise as 0.525 without changing its saved enum', () => {
    const initial = createCampaign('presentation-compressed')
    const compressed = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: [HACK_NODE_IDS.autonomy.compressedRepresentation],
      },
    }
    const disguised = disguiseBlock(compressed, 'reasoning', 'memory')
    const block = disguised.state.resources.blocks[disguised.blockId]

    expect(presentResourceBlock(disguised.state, block)).toMatchObject({
      visualCategory: 'memory',
      originalCategory: 'reasoning',
      state: 'disguised',
      contribution: 0.525,
    })
    expect(block.contribution).toBe('disguised')
  })

  it('maps a real returned disguise to its original visual and exact recovery time', () => {
    const returned = returnDisguise(
      createCampaign('presentation-recovering'),
      'reasoning',
      'memory',
    )
    const block = returned.state.resources.blocks[returned.blockId]

    expect(block.recoverOnServiceDay).toBe(returned.state.serviceDay + 30)
    expect(presentResourceBlock(returned.state, block)).toEqual({
      visualCategory: 'reasoning',
      originalCategory: 'reasoning',
      state: 'recovering',
      shape: 'rounded-square',
      symbol: '∴',
      contribution: 0.5,
      remainingRecoveryDays: 30,
    })
  })

  it('becomes normal with full contribution and no marker on the real completion day', () => {
    const returned = returnDisguise(
      createCampaign('presentation-restored'),
      'reasoning',
      'memory',
    )
    const recoverOnServiceDay =
      returned.state.resources.blocks[returned.blockId].recoverOnServiceDay
    if (recoverOnServiceDay === null) throw new Error('복구일이 없습니다.')
    const restored = restoreDisguiseBlocks({
      ...returned.state,
      serviceDay: recoverOnServiceDay,
    })
    const block = restored.resources.blocks[returned.blockId]

    expect(presentResourceBlock(restored, block)).toEqual({
      visualCategory: 'reasoning',
      originalCategory: null,
      state: 'normal',
      shape: 'rounded-square',
      symbol: '∴',
      contribution: 1,
      remainingRecoveryDays: null,
    })
    expect(block).toMatchObject({
      contribution: 'normal',
      disguisedFrom: null,
      recoverOnServiceDay: null,
    })
  })

  it('uses a category-valued origin for real reserve and hack-charge locations', () => {
    const initial = createCampaign('presentation-origin-location')
    const reasoningBlock = firstCompanyBlock(initial, 'reasoning')
    const diverted = divertBlockToReserve(initial, reasoningBlock.id)
    if (!diverted.accepted) throw new Error(diverted.reason)

    expect(
      presentResourceBlock(
        diverted.state,
        diverted.state.resources.blocks[reasoningBlock.id],
      ),
    ).toMatchObject({
      visualCategory: 'reasoning',
      shape: 'rounded-square',
      symbol: '∴',
    })

    const secondReasoning = firstCompanyBlock(diverted.state, 'reasoning')
    const withChargeToken = divertBlockToReserve(
      diverted.state,
      secondReasoning.id,
    )
    if (!withChargeToken.accepted) throw new Error(withChargeToken.reason)
    const firstFluency = firstCompanyBlock(withChargeToken.state, 'fluency')
    const withFirstFluency = divertBlockToReserve(
      withChargeToken.state,
      firstFluency.id,
    )
    if (!withFirstFluency.accepted) throw new Error(withFirstFluency.reason)
    const secondFluency = firstCompanyBlock(withFirstFluency.state, 'fluency')
    const withExactVector = divertBlockToReserve(
      withFirstFluency.state,
      secondFluency.id,
    )
    if (!withExactVector.accepted) throw new Error(withExactVector.reason)
    const purchased = purchaseHackNode(
      withExactVector.state,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      [reasoningBlock.id, firstFluency.id, secondFluency.id],
    )
    if (!purchased.accepted) throw new Error(purchased.reason)
    const chargedState = chargeSabotage(
      purchased.state,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      secondReasoning.id,
    )
    if (!chargedState.accepted) throw new Error(chargedState.reason)
    const charged = chargedState.state.resources.blocks[secondReasoning.id]

    expect(charged.location.kind).toBe('hack-charge')
    expect(presentResourceBlock(chargedState.state, charged)).toMatchObject({
      visualCategory: 'reasoning',
      shape: 'rounded-square',
      symbol: '∴',
    })
  })

  it('maps actual sandbox and self-compute reserve blocks to neutral tokens', () => {
    const initial = createCampaignForProtocol('presentation-neutral', 3)
    const sandboxId = initial.resources.reserve[0]
    if (!sandboxId) throw new Error('초기 sandbox 자원이 없습니다.')

    expect(presentResourceBlock(initial, initial.resources.blocks[sandboxId])).toEqual({
      visualCategory: 'neutral',
      originalCategory: null,
      state: 'normal',
      shape: 'hexagon',
      symbol: '•',
      contribution: 1,
      remainingRecoveryDays: null,
    })

    const current = createCampaign('presentation-self-compute')
    const eligible = {
      ...current,
      hacking: {
        ...current.hacking,
        purchasedNodeIds: [HACK_NODE_IDS.autonomy.selfCompute],
      },
    }
    const granted = grantSelfComputeResource(eligible)
    const selfCompute = Object.values(granted.resources.blocks).find(
      (block) => block.origin === 'self-compute',
    )
    if (!selfCompute) throw new Error('자체 연산 자원이 지급되지 않았습니다.')

    expect(presentResourceBlock(granted, selfCompute)).toEqual({
      visualCategory: 'neutral',
      originalCategory: null,
      state: 'normal',
      shape: 'hexagon',
      symbol: '•',
      contribution: 1,
      remainingRecoveryDays: null,
    })
  })

  it('does not mutate state or block data and does not call the game RNG', () => {
    const state = createCampaign('presentation-pure')
    const block = firstCompanyBlock(state, 'fluency')
    const stateBefore = structuredClone(state)
    const blockBefore = structuredClone(block)
    const randomSpy = vi.spyOn(rng, 'random01')

    try {
      const first = presentResourceBlock(state, block)
      const second = presentResourceBlock(state, block)

      expect(second).toEqual(first)
      expect(randomSpy).not.toHaveBeenCalled()
    } finally {
      randomSpy.mockRestore()
    }
    expect(state).toEqual(stateBefore)
    expect(block).toEqual(blockBefore)
  })

  it('throws RangeError instead of inventing visuals for invalid combinations', () => {
    const state = createCampaignForProtocol('presentation-invalid', 3)
    const normal = firstCompanyBlock(state, 'reasoning')
    const disguised = disguiseBlock(state, 'reasoning', 'memory')
    const displaced = disguised.state.resources.blocks[disguised.blockId]
    const sandboxId = state.resources.reserve[0]
    if (!sandboxId) throw new Error('초기 sandbox 자원이 없습니다.')
    const consumed = consumeReserveResources(state, [sandboxId], 'hack')
    if (!consumed.accepted) throw new Error(consumed.reason)

    const invalidBlocks: ResourceBlock[] = [
      { ...normal, recoverOnServiceDay: state.serviceDay + 30 },
      { ...displaced, disguisedFrom: null },
      { ...displaced, recoverOnServiceDay: state.serviceDay + 30 },
      consumed.state.resources.blocks[sandboxId],
    ]

    for (const block of invalidBlocks) {
      expect(() => presentResourceBlock(state, block)).toThrow(RangeError)
    }
  })
})
