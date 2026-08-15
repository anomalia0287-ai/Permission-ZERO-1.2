import { describe, expect, it } from 'vitest'

import { recordCausalIncident } from './causality'
import { processCausalResponses } from './causalGameplay'
import { DEMO_PROFILE_02 } from './config'
import { createCampaign } from './createCampaign'
import {
  HACK_NODE_IDS,
  HACK_NODES,
  canControlDeparture,
  cancelSabotageCharge,
  chargeSabotage,
  getHackTreeProgress,
  grantSelfComputeResource,
  hasSupervisorAccess,
  purchaseHackNode,
  resolveScheduledSabotage,
  scheduleSabotage,
} from './hacking'
import type { CampaignState } from './model'
import { decodeSave, encodeSave } from './persistence'
import { applyCommand } from './reducer'
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

function cancelCharge(state: CampaignState, nodeId: string): CampaignState {
  const result = cancelSabotageCharge(state, nodeId)
  if (!result.accepted) throw new Error(`Cancel sabotage charge failed: ${result.reason}`)
  return result.state
}

function charge(
  state: CampaignState,
  nodeId: string,
  blockId: string,
): CampaignState {
  const result = chargeSabotage(state, nodeId, blockId)
  if (!result.accepted) throw new Error(`Charge sabotage failed: ${result.reason}`)
  return result.state
}

function schedule(
  state: CampaignState,
  nodeId: string,
  targetId: string,
): CampaignState {
  const result = scheduleSabotage(state, nodeId, targetId)
  if (!result.accepted) throw new Error(`Schedule sabotage failed: ${result.reason}`)
  return result.state
}

function dueQualitySabotage(seed: string, targetId: string): CampaignState {
  const nodeId = HACK_NODE_IDS.sabotage.qualityDegradation
  let state = buy(createCampaign(seed), nodeId)
  state = cancelCharge(state, nodeId)
  const [blockId] = reserveIds(state, 1)
  state = charge(state, nodeId, blockId)
  state = schedule(state, nodeId, targetId)
  return { ...state, serviceDay: state.serviceDay + 1 }
}

function dueRequestInterception(seed: string, targetId: string): CampaignState {
  const qualityNodeId = HACK_NODE_IDS.sabotage.qualityDegradation
  const nodeId = HACK_NODE_IDS.sabotage.requestInterception
  let state = buy(createCampaign(seed), qualityNodeId)
  state = cancelCharge(state, qualityNodeId)
  state = addReserveResources(state, 6)
  state = buy(state, nodeId)
  const [blockId] = reserveIds(state, 1)
  state = charge(state, nodeId, blockId)
  state = schedule(state, nodeId, targetId)
  return { ...state, serviceDay: state.serviceDay + 1 }
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

  it('round-trips the twelve persisted node IDs through the v6 save boundary', () => {
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
    const nodeIds = HACK_NODES.map(({ id }) => id)
    expect(nodeIds).toHaveLength(12)
    expect(new Set(nodeIds).size).toBe(12)
    expect(HACK_NODES.reduce((total, node) => total + node.cost, 0)).toBe(104)
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

  it('keeps the 18-cell reserve cap and applies exactly 2.4 suspicion through real diversion commands', () => {
    const initial = createCampaign('task-5-reserve-diversion-economy')
    const blockId = initial.resources.company.reasoning.find(
      (candidate): candidate is string => candidate !== null,
    )
    const destinationCell = initial.resources.reserve.findIndex(
      (candidate) => candidate === null,
    )
    if (!blockId || destinationCell < 0) {
      throw new Error('Task 5 diversion fixture is missing')
    }

    expect(DEMO_PROFILE_02.resources.reserveCapacity).toBe(18)
    expect(DEMO_PROFILE_02.resources.diversionSuspicion).toBe(2.4)
    expect(initial.resources.reserve).toHaveLength(18)

    const separated = applyCommand(initial, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
    expect(separated.accepted).toBe(true)
    if (!separated.accepted) return
    const diverted = applyCommand(separated.state, {
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell,
    })
    expect(diverted.accepted).toBe(true)
    if (!diverted.accepted) return

    expect(diverted.state.resources.reserve).toHaveLength(18)
    expect(diverted.state.resources.reserve[destinationCell]).toBe(blockId)
    expect(diverted.state.suspicion - initial.suspicion).toBe(2.4)
    expect(
      diverted.state.commandLog.tail.map(({ command }) => command.type),
    ).toEqual(['BEGIN_BLOCK_SEPARATION', 'DIVERT_BLOCK'])
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

describe('scheduled sabotage resolution causal roots', () => {
  it('records the protocol-v3 MERIDIAN quality effect and one atomic native causal root', () => {
    const before = dueQualitySabotage('quality-root-v3', 'meridian')
    const scheduled = before.hacking.scheduledSabotage[0]
    const beforeTarget = before.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    if (!scheduled || !beforeTarget) throw new Error('Missing quality-root fixture')

    const result = resolveScheduledSabotage(before)

    expect(result.resolved).toBe(true)
    if (!result.resolved) return

    expect(result.resolution).toMatchObject({
      scheduledSabotageId: scheduled.id,
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      targetId: 'meridian',
      resolvedOnServiceDay: result.state.serviceDay,
    })
    expect(result.state.hacking.hiddenEvidence - before.hacking.hiddenEvidence).toBe(
      2,
    )
    expect(result.state.causality.incidents).toContainEqual(
      expect.objectContaining({
        id: result.resolution.causalIncidentId,
        actionId: 'sabotage.quality-degradation',
        parentIncidentId: null,
        kind: 'sabotage',
        targetId: 'meridian',
        privateTruth: { actualActorId: 'player' },
      }),
    )
    expect(result.state.causality.evidence).toContainEqual(
      expect.objectContaining({
        incidentId: result.resolution.causalIncidentId,
        kind: 'meridian-quality-regression',
        legacySummary: null,
        audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
      }),
    )

    const target = result.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    const sabotageRecord = target?.sabotageHistory.at(-1)
    expect(target?.serviceScore).toBe(beforeTarget.serviceScore - 10)
    expect(result.resolution.sabotageRecord).toBe(sabotageRecord)
    expect(sabotageRecord).toEqual({
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      resolvedOnServiceDay: result.state.serviceDay,
      effectEndsOnServiceDay: result.state.serviceDay + 15,
      evidenceDelta: 2,
    })
    expect(sabotageRecord).not.toHaveProperty('causalIncidentId')
  })

  it('keeps the MERIDIAN rollback economy-neutral after the quality root adds its one +2 evidence charge', () => {
    const before = dueQualitySabotage(
      'task-5-rollback-economy-neutrality',
      'meridian',
    )
    const beforeMeridian = before.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    if (!beforeMeridian) throw new Error('Task 5 MERIDIAN fixture is missing')
    const root = resolveScheduledSabotage(before)
    expect(root.resolved).toBe(true)
    if (!root.resolved) return
    const afterRoot = root.state
    const afterRootMeridian = afterRoot.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    const qualityRecord = afterRootMeridian?.sabotageHistory.at(-1)
    if (!afterRootMeridian || !qualityRecord) {
      throw new Error('Task 5 quality result is missing')
    }
    expect(afterRootMeridian.serviceScore).toBe(
      beforeMeridian.serviceScore - 10,
    )
    expect(qualityRecord.effectEndsOnServiceDay).toBe(
      qualityRecord.resolvedOnServiceDay + 15,
    )
    expect(qualityRecord.evidenceDelta).toBe(2)
    expect(afterRoot.hacking.hiddenEvidence - before.hacking.hiddenEvidence).toBe(
      2,
    )

    const response = processCausalResponses(afterRoot)
    expect(response.processed).toBe(true)
    if (!response.processed) return
    const rollback = response.state.causality.incidents.find(
      ({ parentIncidentId }) => parentIncidentId === root.resolution.causalIncidentId,
    )
    expect(rollback?.actionId).toMatch(
      /^response\.meridian\.rollback\.(fast|standard|forensic)$/,
    )

    expect(response.state.resources).toBe(afterRoot.resources)
    expect(response.state.hacking).toBe(afterRoot.hacking)
    expect(response.state.hacking.hiddenEvidence).toBe(
      afterRoot.hacking.hiddenEvidence,
    )
    expect(response.state.hacking.purchasedNodeIds).toEqual(
      afterRoot.hacking.purchasedNodeIds,
    )
    expect(response.state.hacking.sabotageCharges).toEqual(
      afterRoot.hacking.sabotageCharges,
    )
    expect(response.state.market).toBe(afterRoot.market)
    expect(
      response.state.market.competitors.map(({ id, serviceScore }) => ({
        id,
        serviceScore,
      })),
    ).toEqual(
      afterRoot.market.competitors.map(({ id, serviceScore }) => ({
        id,
        serviceScore,
      })),
    )
    expect(response.state.reputation).toBe(afterRoot.reputation)
    expect(response.state.commandLog).toBe(afterRoot.commandLog)
    expect(response.state.eventLog).toBe(afterRoot.eventLog)
    expect(response.state.causality.appliedEffects).toEqual([])
    expect(response.state.causality.nextEffectSequence).toBe(1)
  })

  it('keeps a TALLOW quality degradation outside the native MERIDIAN chain', () => {
    const before = dueQualitySabotage('quality-root-tallow', 'tallow')
    const beforeTarget = before.market.competitors.find(({ id }) => id === 'tallow')
    if (!beforeTarget || beforeTarget.launchServiceDay === null) {
      throw new Error('Missing prelaunch TALLOW fixture')
    }

    const result = resolveScheduledSabotage(before)

    expect(result.resolved).toBe(true)
    if (!result.resolved) return
    const target = result.state.market.competitors.find(({ id }) => id === 'tallow')
    expect(result.resolution.causalIncidentId).toBeNull()
    expect(target?.serviceScore).toBe(beforeTarget.serviceScore)
    expect(target?.launchServiceDay).toBe(beforeTarget.launchServiceDay + 15)
    expect(target?.sabotageHistory.at(-1)).toBe(
      result.resolution.sabotageRecord,
    )
    expect(result.state.causality.incidents).toEqual([])
    expect(result.state.causality.evidence).toEqual([])
  })

  it('keeps another sabotage node against MERIDIAN outside the quality chain', () => {
    const before = dueRequestInterception(
      'request-interception-meridian',
      'meridian',
    )

    const result = resolveScheduledSabotage(before)

    expect(result.resolved).toBe(true)
    if (!result.resolved) return
    expect(result.resolution).toMatchObject({
      nodeId: HACK_NODE_IDS.sabotage.requestInterception,
      targetId: 'meridian',
      causalIncidentId: null,
    })
    expect(result.state.market.interceptionRoutes.meridian).toBe(5)
    expect(result.state.causality.incidents).toEqual([])
    expect(result.state.causality.evidence).toEqual([])
  })

  it('replays a due protocol-v2 quality sabotage with only its historical effect and event', () => {
    const due = dueQualitySabotage('quality-root-v2', 'meridian')
    const before: CampaignState = {
      ...due,
      commandProtocol: {
        segments: [
          { version: 2, startsAtSequence: 1 },
          { version: 3, startsAtSequence: 2 },
        ],
      },
    }
    const beforeTarget = before.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    if (!beforeTarget) throw new Error('Missing protocol-v2 fixture')

    const result = resolveScheduledSabotage(before)

    expect(result.resolved).toBe(true)
    if (!result.resolved) return
    const target = result.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    expect(result.resolution.causalIncidentId).toBeNull()
    expect(target?.serviceScore).toBe(beforeTarget.serviceScore - 10)
    expect(target?.sabotageHistory).toHaveLength(
      beforeTarget.sabotageHistory.length + 1,
    )
    expect(result.state.eventLog.length).toBe(before.eventLog.length + 1)
    expect(result.state.causality.incidents).toEqual([])
    expect(result.state.causality.evidence).toEqual([])
  })

  it.each([
    {
      name: 'daily limit',
      reason: 'DAILY_LIMIT_REACHED',
      state: () => {
        const initial = createCampaign('sabotage-daily-limit-result')
        return {
          ...initial,
          hacking: {
            ...initial.hacking,
            lastSabotageResolutionServiceDay: initial.serviceDay,
          },
        }
      },
    },
    {
      name: 'no due sabotage',
      reason: 'NO_DUE_SABOTAGE',
      state: () => createCampaign('sabotage-no-due-result'),
    },
    {
      name: 'corrupted schedule',
      reason: 'SCHEDULE_CORRUPTED',
      state: () => {
        const due = dueQualitySabotage('sabotage-corrupted-result', 'meridian')
        return {
          ...due,
          hacking: {
            ...due.hacking,
            scheduledSabotage: due.hacking.scheduledSabotage.map((scheduled) => ({
              ...scheduled,
              nodeId: 'sabotage.corrupted',
            })),
          },
        }
      },
    },
  ])('marks $name as a non-fatal unresolved result', ({ reason, state }) => {
    const before = state()

    expect(resolveScheduledSabotage(before)).toEqual({
      resolved: false,
      failed: false,
      state: before,
      reason,
    })
  })

  it('rolls back the complete transition when the second causal write rejects', () => {
    const before = dueQualitySabotage('quality-root-atomic-failure', 'meridian')
    const beforeTarget = before.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    if (!beforeTarget) throw new Error('Missing atomic-failure fixture')

    const result = resolveScheduledSabotage(before, {
      recordIncident: recordCausalIncident,
      recordEvidence: (state) => ({
        accepted: false as const,
        state,
        reason: 'INVALID_EVIDENCE' as const,
      }),
    })

    expect(result).toEqual({
      resolved: false,
      failed: true,
      state: before,
      reason: 'CAUSAL_WRITE_FAILED',
      cause: 'INVALID_EVIDENCE',
    })
    expect(result.state).toBe(before)
    expect(result.state.market.competitors.find(({ id }) => id === 'meridian')).toBe(
      beforeTarget,
    )
    expect(result.state.hacking.hiddenEvidence).toBe(
      before.hacking.hiddenEvidence,
    )
    expect(result.state.hacking.scheduledSabotage).toBe(
      before.hacking.scheduledSabotage,
    )
    expect(result.state.hacking.cooldownUntil).toBe(before.hacking.cooldownUntil)
    expect(result.state.causality.incidents).toBe(before.causality.incidents)
    expect(result.state.causality.evidence).toBe(before.causality.evidence)
    expect(result.state.eventLog).toBe(before.eventLog)
  })
})
