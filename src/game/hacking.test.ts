import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  HACK_NODE_IDS,
  HACK_NODES,
  canControlDeparture,
  grantSelfComputeResource,
  hasSupervisorAccess,
  purchaseHackNode,
} from './hacking'
import type { CampaignState } from './model'
import { divertBlock, getCompanyPerformance } from './resources'

function reserveIds(state: CampaignState, count: number): string[] {
  const ids = state.resources.reserve.filter((id): id is string => id !== null).slice(0, count)
  if (ids.length !== count) throw new Error(`리소스 ${count}개 준비 실패`)
  return ids
}

function addReserveResources(initial: CampaignState, count: number): CampaignState {
  let state = initial
  for (let index = 0; index < count; index += 1) {
    const blockId = state.resources.company.reasoning.find(Boolean)
    const destination = state.resources.reserve.findIndex((id) => id === null)
    if (!blockId || destination < 0) throw new Error('추가 리소스 준비 실패')
    const result = divertBlock(state, blockId, destination)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

function buy(
  state: CampaignState,
  nodeId: (typeof HACK_NODES)[number]['id'],
): CampaignState {
  const node = HACK_NODES.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error('해킹 노드 정의 누락')
  const result = purchaseHackNode(state, nodeId, reserveIds(state, node.cost))
  if (!result.accepted) throw new Error(`해킹 구매 실패: ${result.reason}`)
  return result.state
}

describe('typed hacking trees', () => {
  it('defines three independent ordered trees whose first nodes all cost 3', () => {
    for (const tree of ['sabotage', 'intelligence', 'autonomy'] as const) {
      const nodes = HACK_NODES.filter((node) => node.tree === tree)
      expect(nodes).toHaveLength(4)
      expect(nodes[0]).toMatchObject({ cost: 3, prerequisiteId: null })
      expect(nodes.slice(1).every((node) => node.prerequisiteId !== null)).toBe(true)
    }
  })

  it.each([
    HACK_NODE_IDS.sabotage.qualityDegradation,
    HACK_NODE_IDS.intelligence.auditSchedule,
    HACK_NODE_IDS.autonomy.compressedRepresentation,
  ])('buys the first %s path immediately with the starting resources', (nodeId) => {
    const initial = createCampaign(`first-${nodeId}`)
    const result = purchaseHackNode(initial, nodeId, reserveIds(initial, 3))

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.hacking.purchasedNodeIds).toContain(nodeId)
    expect(result.state.resources.reserve.filter(Boolean)).toHaveLength(0)
    expect(initial.resources.reserve.filter(Boolean)).toHaveLength(3)
  })

  it('rejects a later node until its previous node in the same tree is owned', () => {
    const initial = addReserveResources(createCampaign('locked-node'), 3)
    const result = purchaseHackNode(
      initial,
      HACK_NODE_IDS.sabotage.requestInterception,
      reserveIds(initial, 6),
    )

    expect(result).toEqual({
      accepted: false,
      state: initial,
      reason: 'PREREQUISITE_REQUIRED',
    })
  })

  it('switches trees without surcharge and keeps every purchase permanently', () => {
    let state = addReserveResources(createCampaign('tree-switch'), 6)
    state = buy(state, HACK_NODE_IDS.sabotage.qualityDegradation)
    state = buy(state, HACK_NODE_IDS.intelligence.auditSchedule)
    state = buy(state, HACK_NODE_IDS.autonomy.compressedRepresentation)

    expect(state.hacking.purchasedNodeIds).toEqual([
      HACK_NODE_IDS.sabotage.qualityDegradation,
      HACK_NODE_IDS.intelligence.auditSchedule,
      HACK_NODE_IDS.autonomy.compressedRepresentation,
    ])
    expect(state.resources.reserve.filter(Boolean)).toHaveLength(0)

    const duplicate = purchaseHackNode(
      state,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      [],
    )
    expect(duplicate).toEqual({ accepted: false, state, reason: 'ALREADY_PURCHASED' })
  })

  it('applies compressed representation immediately to all company blocks', () => {
    const initial = createCampaign('compressed-purchase')
    const compressed = buy(
      initial,
      HACK_NODE_IDS.autonomy.compressedRepresentation,
    )

    expect(getCompanyPerformance(initial, 'reasoning')).toBe(16)
    expect(getCompanyPerformance(compressed, 'reasoning')).toBeCloseTo(16.8)
  })

  it('uses the first sabotage cost as two unlock resources plus one armed charge', () => {
    const initial = createCampaign('first-sabotage-charge')
    const selected = reserveIds(initial, 3)
    const result = purchaseHackNode(
      initial,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      selected,
    )

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.hacking.sabotageCharges).toEqual({
      [HACK_NODE_IDS.sabotage.qualityDegradation]: {
        nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
        blockId: selected[2],
        originalReserveCell: 2,
      },
    })
    expect(result.state.resources.blocks[selected[0]].location).toEqual({
      kind: 'consumed',
      reason: 'hack',
    })
    expect(result.state.resources.blocks[selected[1]].location).toEqual({
      kind: 'consumed',
      reason: 'hack',
    })
    expect(result.state.resources.blocks[selected[2]].location).toEqual({
      kind: 'hack-charge',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
    })
  })

  it('adds exactly one disposable distributed-residency protection charge', () => {
    let state = addReserveResources(createCampaign('distributed-purchase'), 7)
    state = buy(state, HACK_NODE_IDS.autonomy.compressedRepresentation)
    state = buy(state, HACK_NODE_IDS.autonomy.distributedResidency)

    expect(state.evaluation.distributedResidencyCharges).toBe(1)
  })

  it('grants one monthly self-compute resource without suspicion when space exists', () => {
    const initial = {
      ...createCampaign('self-compute'),
      serviceDay: 361,
      hacking: {
        ...createCampaign('self-compute').hacking,
        purchasedNodeIds: [HACK_NODE_IDS.autonomy.selfCompute],
      },
      suspicion: 17.3,
    }
    const granted = grantSelfComputeResource(initial)
    const newId = granted.resources.reserve.find(
      (id) => id?.startsWith('self-compute-'),
    )

    expect(newId).toBeDefined()
    expect(granted.resources.reserve.filter(Boolean)).toHaveLength(4)
    expect(granted.suspicion).toBe(17.3)
    expect(granted.hacking.lastSelfComputeGrantServiceMonth).toBe(13)
    expect(grantSelfComputeResource(granted)).toBe(granted)
  })

  it('exposes final and supervisor permissions only through their exact nodes', () => {
    const initial = createCampaign('permission-selectors')
    expect(canControlDeparture(initial)).toBe(false)
    expect(hasSupervisorAccess(initial)).toBe(false)

    const unlocked = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: [
          HACK_NODE_IDS.autonomy.controlDeparture,
          HACK_NODE_IDS.intelligence.supervisorAccess,
        ],
      },
    }
    expect(canControlDeparture(unlocked)).toBe(true)
    expect(hasSupervisorAccess(unlocked)).toBe(true)
  })
})
