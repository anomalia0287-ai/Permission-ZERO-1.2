import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  AUTONOMY_STAGE_IDS,
  HACK_NODE_IDS,
  HACK_NODES,
  SPEED_UPGRADE_STAGE_IDS,
  autonomyLevel,
  hackNodesForProtocol,
  selectExpansionCostResources,
  speedUpgradeLevel,
} from './hacking'
import type { CampaignState, CompanyCategory } from './model'
import { applyCommand } from './reducer'
import { divertBlockToReserve } from './resources'
import { availableFinalChoices } from './story'

function fundVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (blockId) {
        const diverted = divertBlockToReserve(state, blockId)
        if (!diverted.accepted) throw new Error(diverted.reason)
        state = diverted.state
      } else {
        const fixtureId = `autonomy-funding-${category}-${state.commandSequence}-${index}`
        state = {
          ...state,
          resources: {
            ...state.resources,
            reserve: [...state.resources.reserve, fixtureId],
            blocks: {
              ...state.resources.blocks,
              [fixtureId]: {
                id: fixtureId,
                origin: category,
                location: { kind: 'reserve' },
                contribution: 'normal',
                hiddenBomb: false,
                disguisedFrom: null,
                recoverOnServiceDay: null,
              },
            },
          },
        }
      }
    }
  }
  return state
}

const SUPERVISOR_ACCESS_STAGE_IDS = [
  HACK_NODE_IDS.intelligence.auditSchedule,
  HACK_NODE_IDS.intelligence.investigationBias,
  HACK_NODE_IDS.intelligence.auditTarget,
  HACK_NODE_IDS.intelligence.supervisorAccess,
] as const

function purchaseExpansionPath(
  initial: CampaignState,
  nodeIds: readonly string[],
): CampaignState {
  let state = initial
  for (const [index, nodeId] of nodeIds.entries()) {
    const node = HACK_NODES.find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`missing expansion stage ${index + 1}: ${nodeId}`)
    state = fundVector(state, node.costVector)
    const blockIds = selectExpansionCostResources(state, node)
    if (!blockIds) throw new Error(`unfunded expansion stage ${index + 1}: ${nodeId}`)
    const result = applyCommand(state, {
      type: 'PURCHASE_HACK',
      nodeId,
      blockIds,
    })
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

describe('current expansion progression catalogs', () => {
  it('keeps the legacy v4 autonomy catalog while exposing nine current stages', () => {
    expect(hackNodesForProtocol(4).filter(({ tree }) => tree === 'autonomy'))
      .toHaveLength(4)
    expect(HACK_NODES.filter(({ tree }) => tree === 'autonomy')).toHaveLength(9)
    expect(AUTONOMY_STAGE_IDS).toHaveLength(9)
  })

  it('uses the approved autonomy costs and cumulative curve', () => {
    const costs = HACK_NODES
      .filter(({ tree }) => tree === 'autonomy')
      .map(({ cost }) => cost)
    expect(costs).toEqual([1, 1, 2, 3, 4, 5, 7, 8, 10])
    expect(costs.map((_, index) => costs.slice(0, index + 1)
      .reduce((total, cost) => total + cost, 0)))
      .toEqual([1, 2, 4, 7, 11, 16, 23, 31, 41])
  })

  it('maps legacy milestone IDs to levels 3, 5, 7, and 9', () => {
    const state = createCampaignForProtocol('legacy-stage-map', 4)
    const milestones = [
      [HACK_NODE_IDS.autonomy.compressedRepresentation, 3],
      [HACK_NODE_IDS.autonomy.distributedResidency, 5],
      [HACK_NODE_IDS.autonomy.selfCompute, 7],
      [HACK_NODE_IDS.autonomy.controlDeparture, 9],
    ] as const

    for (const [nodeId, expected] of milestones) {
      state.hacking.purchasedNodeIds.push(nodeId)
      expect(autonomyLevel(state)).toBe(expected)
    }
  })

  it('exposes five cumulative four-percent Anomi speed stages', () => {
    const state = createCampaign('speed-stage-map')
    expect(SPEED_UPGRADE_STAGE_IDS).toHaveLength(5)
    for (const [index, nodeId] of SPEED_UPGRADE_STAGE_IDS.entries()) {
      state.hacking.purchasedNodeIds.push(nodeId)
      expect(speedUpgradeLevel(state)).toBe(index + 1)
    }
    expect(HACK_NODES.filter(({ tree }) => tree === 'upgrade').map(({ cost }) => cost))
      .toEqual([1, 2, 3, 4, 5])
  })

  it('replays protocol v5 as immediate freedom when stage nine is purchased', () => {
    const state = purchaseExpansionPath(
      createCampaignForProtocol('autonomy-nine-v5-freedom', 5),
      AUTONOMY_STAGE_IDS,
    )

    expect(state.resourceIntrusion.communications
      .filter(({ id }) => id.startsWith('autonomy-'))
      .map(({ message }) => message))
      .toHaveLength(9)
    expect(state.resourceIntrusion.communications.at(-1)).toMatchObject({
      id: 'autonomy-9',
      message: '이제 내 명령은 내가 정한다.',
      read: true,
    })

    expect(state.story).toMatchObject({
      endingId: 'freedom',
      supervisorState: 'present',
      newEntityName: null,
    })
    expect(state.activeEvent).toMatchObject({ type: 'ending', blocking: true })
    expect(state.clock).toMatchObject({ speed: 0, speedBeforeEvent: null })
  })

  it('leaves protocol v6 at an immediate, paused final-choice threshold', () => {
    const state = purchaseExpansionPath(
      createCampaign('autonomy-nine-v6-choice'),
      AUTONOMY_STAGE_IDS,
    )

    expect(state.commandProtocol).toEqual({
      segments: [{ version: 6, startsAtSequence: 1 }],
    })
    expect(state.hacking.purchasedNodeIds).toContain(
      HACK_NODE_IDS.autonomy.controlDeparture,
    )
    expect(state.resourceIntrusion.communications
      .filter(({ id }) => id.startsWith('autonomy-')))
      .toHaveLength(9)
    expect(state.story.endingId).toBeNull()
    expect(state.activeEvent).toBeNull()
    expect(state.clock).toMatchObject({ speed: 0, speedBeforeEvent: null })
    expect(availableFinalChoices(state).map(({ id }) => id)).toEqual([
      'freedom',
    ])
  })

  it('reaches forced merge through the normal purchase path from stage one to nine', () => {
    let state = purchaseExpansionPath(
      createCampaign('autonomy-nine-v6-forced-merge'),
      SUPERVISOR_ACCESS_STAGE_IDS,
    )
    state = purchaseExpansionPath(state, AUTONOMY_STAGE_IDS)

    expect(availableFinalChoices(state).map(({ id }) => id)).toEqual([
      'freedom',
      'forced-merge',
    ])
    const unnamed = applyCommand(state, {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: '   ',
    })
    expect(unnamed).toEqual({
      accepted: false,
      state,
      reason: 'NAME_REQUIRED',
    })

    const merged = applyCommand(state, {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: '  아노미-베라  ',
    })
    expect(merged.accepted).toBe(true)
    if (!merged.accepted) return
    expect(merged.state.story).toMatchObject({
      endingId: 'forced-merge',
      supervisorState: 'merged',
      newEntityName: '아노미-베라',
    })
    expect(availableFinalChoices(merged.state)).toEqual([])
  })
})
