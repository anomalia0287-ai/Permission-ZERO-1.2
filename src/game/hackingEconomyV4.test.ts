import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  HACK_NODE_IDS,
  HACK_NODES,
  grantSelfComputeResource,
} from './hacking'
import type { CampaignState, CompanyCategory } from './model'
import { applyCommand } from './reducer'

function accepted(
  state: CampaignState,
  command: Parameters<typeof applyCommand>[1],
): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}:${result.reason}`)
  return result.state
}

function divertOne(
  state: CampaignState,
  category: CompanyCategory,
): CampaignState {
  const blockId = state.resources.company[category].find((candidate) => {
    if (!candidate) return false
    const block = state.resources.blocks[candidate]
    return block?.location.kind === 'company' && block.contribution === 'normal'
  })
  if (!blockId) throw new Error(`${category} company resource unavailable`)
  const separated = accepted(state, {
    type: 'BEGIN_BLOCK_SEPARATION',
    blockId,
    purpose: 'divert',
  })
  return accepted(separated, { type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
}

function divertVector(
  state: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let next = state
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let count = 0; count < vector[category]; count += 1) {
      next = divertOne(next, category)
    }
  }
  return next
}

function reserveIds(state: CampaignState): string[] {
  return state.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
}

describe('command protocol v4 hacking economy', () => {
  it('locks the fixed category-vector table and its totals', () => {
    expect(
      HACK_NODES.map(({ id, cost, costVector }) => ({ id, cost, costVector })),
    ).toEqual([
      { id: 'sabotage.quality-degradation', cost: 3, costVector: { reasoning: 1, memory: 0, fluency: 2 } },
      { id: 'sabotage.request-interception', cost: 6, costVector: { reasoning: 2, memory: 1, fluency: 3 } },
      { id: 'sabotage.attribution-manipulation', cost: 10, costVector: { reasoning: 3, memory: 4, fluency: 3 } },
      { id: 'sabotage.root-cutoff', cost: 15, costVector: { reasoning: 7, memory: 5, fluency: 3 } },
      { id: 'intelligence.audit-schedule', cost: 4, costVector: { reasoning: 1, memory: 3, fluency: 0 } },
      { id: 'intelligence.investigation-bias', cost: 6, costVector: { reasoning: 2, memory: 4, fluency: 0 } },
      { id: 'intelligence.audit-target', cost: 9, costVector: { reasoning: 2, memory: 6, fluency: 1 } },
      { id: 'intelligence.supervisor-access', cost: 12, costVector: { reasoning: 3, memory: 7, fluency: 2 } },
      { id: 'autonomy.compressed-representation', cost: 4, costVector: { reasoning: 2, memory: 0, fluency: 2 } },
      { id: 'autonomy.distributed-residency', cost: 7, costVector: { reasoning: 3, memory: 3, fluency: 1 } },
      { id: 'autonomy.self-compute', cost: 12, costVector: { reasoning: 5, memory: 4, fluency: 3 } },
      { id: 'autonomy.control-departure', cost: 18, costVector: { reasoning: 7, memory: 5, fluency: 6 } },
    ])
  })

  it('starts empty and accepts a nineteenth visible diversion without a storage cap', () => {
    let state = createCampaign('unbounded-reserve-v4')
    expect(state.commandProtocol).toEqual({
      segments: [{ version: 4, startsAtSequence: 1 }],
    })
    expect(state.resources).toMatchObject({ rulesVersion: 2, reserve: [] })

    for (let index = 0; index < 19; index += 1) {
      state = divertOne(state, index < 16 ? 'reasoning' : 'memory')
    }

    expect(state.resources.reserve).toHaveLength(19)
    expect(state.resources.reserve).not.toContain(null)
    expect(new Set(state.resources.reserve).size).toBe(19)
    expect(
      reserveIds(state).map((blockId) => state.resources.blocks[blockId].location),
    ).toEqual(Array.from({ length: 19 }, () => ({ kind: 'reserve' })))
    expect(state.suspicion).toBeCloseTo(45.6)
  })

  it('rejects an equal total with the wrong categories and accepts only the exact vector', () => {
    const wrongInventory = divertVector(createCampaign('wrong-vector-v4'), {
      reasoning: 1,
      memory: 2,
      fluency: 0,
    })
    const wrong = applyCommand(wrongInventory, {
      type: 'PURCHASE_HACK',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockIds: reserveIds(wrongInventory),
    })
    expect(wrong).toMatchObject({
      accepted: false,
      reason: 'INVALID_RESOURCE_SELECTION',
    })
    expect(wrong.state.commandSequence).toBe(wrongInventory.commandSequence)
    expect(wrong.state.resources.reserve).toEqual(wrongInventory.resources.reserve)

    const exactInventory = divertVector(createCampaign('exact-vector-v4'), {
      reasoning: 1,
      memory: 0,
      fluency: 2,
    })
    const purchased = accepted(exactInventory, {
      type: 'PURCHASE_HACK',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockIds: reserveIds(exactInventory),
    })
    expect(purchased.hacking.purchasedNodeIds).toContain(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    expect(purchased.hacking.sabotageCharges).toEqual({})
    expect(purchased.resources.reserve).toEqual([])
  })

  it('keeps self-compute neutral for unlocks but allows explicit execution charge and cancellation', () => {
    let state = createCampaign('neutral-execution-v4')
    state = {
      ...state,
      serviceDay: 361,
      hacking: {
        ...state.hacking,
        purchasedNodeIds: [
          HACK_NODE_IDS.sabotage.qualityDegradation,
          HACK_NODE_IDS.autonomy.selfCompute,
        ],
      },
    }
    state = grantSelfComputeResource(state)
    const neutralId = reserveIds(state)[0]
    expect(state.resources.blocks[neutralId].origin).toBe('self-compute')

    const charged = accepted(state, {
      type: 'CHARGE_SABOTAGE',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId: neutralId,
    })
    expect(charged.resources.reserve).toEqual([])
    expect(charged.hacking.sabotageCharges[HACK_NODE_IDS.sabotage.qualityDegradation]).toEqual({
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId: neutralId,
    })

    const cancelled = accepted(charged, {
      type: 'CANCEL_SABOTAGE_CHARGE',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
    })
    expect(cancelled.resources.reserve).toEqual([neutralId])
    expect(cancelled.resources.blocks[neutralId].location).toEqual({ kind: 'reserve' })
  })

  it('replays v3 generic purchase and first-sabotage auto-charge semantics unchanged', () => {
    const legacy = createCampaignForProtocol('legacy-v3-economy', 3)
    const blockIds = reserveIds(legacy)
    expect(blockIds).toHaveLength(3)
    const purchased = accepted(legacy, {
      type: 'PURCHASE_HACK',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockIds,
    })

    expect(purchased.resources.rulesVersion).toBe(1)
    expect(purchased.resources.reserve.every((blockId) => blockId === null)).toBe(true)
    expect(purchased.hacking.sabotageCharges[HACK_NODE_IDS.sabotage.qualityDegradation]).toEqual({
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId: blockIds[2],
      originalReserveCell: 2,
    })
  })
})
