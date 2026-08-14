import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  HACK_NODE_IDS,
  HACK_NODES,
  canControlDeparture,
  cancelSabotageCharge,
  getHackTreeProgress,
  grantSelfComputeResource,
  hasSupervisorAccess,
  purchaseHackNode,
} from './hacking'
import type { CampaignState } from './model'
import { decodeSave, encodeSave } from './persistence'
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
  it('derives ordered progress, remaining cost, and the terminal payoff for a path', () => {
    const initial = createCampaign('hack-progress')
    expect(getHackTreeProgress(initial, 'sabotage')).toMatchObject({
      purchasedCount: 0,
      totalCount: 4,
      remainingCost: 34,
      complete: false,
      nextNode: {
        id: HACK_NODE_IDS.sabotage.qualityDegradation,
        label: '품질 저하',
        cost: 3,
      },
      finalNode: {
        id: HACK_NODE_IDS.sabotage.rootCutoff,
        label: '근원 차단',
      },
    })

    const complete = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: Object.values(HACK_NODE_IDS.autonomy),
      },
    }
    expect(getHackTreeProgress(complete, 'autonomy')).toMatchObject({
      purchasedCount: 4,
      totalCount: 4,
      remainingCost: 0,
      complete: true,
      nextNode: null,
      finalNode: { id: HACK_NODE_IDS.autonomy.controlDeparture },
    })
  })

  it('defines three independent ordered trees whose first nodes all cost 3', () => {
    for (const tree of ['sabotage', 'intelligence', 'autonomy'] as const) {
      const nodes = HACK_NODES.filter((node) => node.tree === tree)
      expect(nodes).toHaveLength(4)
      expect(nodes[0]).toMatchObject({ cost: 3, prerequisiteId: null })
      expect(nodes.slice(1).every((node) => node.prerequisiteId !== null)).toBe(true)
    }
  })

  it('round-trips the twelve persisted node IDs through the v5 save boundary', () => {
    const persistedNodeIds = [
      'sabotage.quality-degradation',
      'sabotage.request-interception',
      'sabotage.attribution-manipulation',
      'sabotage.root-cutoff',
      'intelligence.audit-schedule',
      'intelligence.investigation-bias',
      'intelligence.audit-target',
      'intelligence.supervisor-access',
      'autonomy.compressed-representation',
      'autonomy.distributed-residency',
      'autonomy.self-compute',
      'autonomy.control-departure',
    ] as const
    const initial = createCampaign('hacking-integration-persistence')

    expect(HACK_NODES.map(({ id }) => id)).toEqual(persistedNodeIds)
    const decoded = decodeSave(
      encodeSave(
        {
          ...initial,
          hacking: {
            ...initial.hacking,
            purchasedNodeIds: [...persistedNodeIds],
          },
        },
        '2026-08-14T00:00:00.000Z',
      ),
    )

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.hacking.purchasedNodeIds).toEqual(
      persistedNodeIds,
    )
  })

  it('preserves the approved per-node costs and 104-block acquisition total', () => {
    expect(HACK_NODES.map(({ tree, cost }) => ({ tree, cost }))).toEqual([
      { tree: 'sabotage', cost: 3 },
      { tree: 'sabotage', cost: 6 },
      { tree: 'sabotage', cost: 10 },
      { tree: 'sabotage', cost: 15 },
      { tree: 'intelligence', cost: 3 },
      { tree: 'intelligence', cost: 6 },
      { tree: 'intelligence', cost: 9 },
      { tree: 'intelligence', cost: 12 },
      { tree: 'autonomy', cost: 3 },
      { tree: 'autonomy', cost: 7 },
      { tree: 'autonomy', cost: 12 },
      { tree: 'autonomy', cost: 18 },
    ])

    const initial = createCampaign('hacking-integration-economy')
    const remainingCosts = (
      ['sabotage', 'intelligence', 'autonomy'] as const
    ).map((tree) => getHackTreeProgress(initial, tree).remainingCost)

    expect(remainingCosts).toEqual([34, 30, 40])
    expect(remainingCosts.reduce((total, cost) => total + cost, 0)).toBe(104)
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

  it('returns the first sabotage charge without refunding its two-block unlock', () => {
    const nodeId = HACK_NODE_IDS.sabotage.qualityDegradation
    const initial = createCampaign('first-sabotage-cancel')
    const selected = reserveIds(initial, 3)
    const purchased = purchaseHackNode(initial, nodeId, selected)
    if (!purchased.accepted) throw new Error(purchased.reason)

    const cancelled = cancelSabotageCharge(purchased.state, nodeId)

    expect(cancelled.accepted).toBe(true)
    if (!cancelled.accepted) return
    expect(cancelled.state.hacking.purchasedNodeIds).toContain(nodeId)
    expect(cancelled.state.hacking.sabotageCharges[nodeId]).toBeUndefined()
    expect(cancelled.state.resources.reserve.filter(Boolean)).toEqual([
      selected[2],
    ])
    expect(cancelled.state.resources.blocks[selected[0]].location).toEqual({
      kind: 'consumed',
      reason: 'hack',
    })
    expect(cancelled.state.resources.blocks[selected[1]].location).toEqual({
      kind: 'consumed',
      reason: 'hack',
    })
    expect(cancelled.state.resources.blocks[selected[2]].location).toEqual({
      kind: 'reserve',
      cellIndex: 2,
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
