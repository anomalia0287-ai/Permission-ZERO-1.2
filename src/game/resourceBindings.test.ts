import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import type { HackingOperationRun } from './hackingCoreModel'
import type { CampaignState, ResourceBlock } from './model'
import {
  bindReserveBlocks,
  consumeBoundBlocks,
  releaseBoundBlocks,
} from './resourceBindings'

function reserveBlockIds(state: CampaignState): string[] {
  return state.resources.reserve.filter((id): id is string => id !== null)
}

function createRun(id = 'run-001'): HackingOperationRun {
  return {
    id,
    operationId: 'quality-degradation',
    targetId: 'meridian',
    phase: 'scheduled',
    investedBlockIds: [],
    startedOnServiceDay: 331,
    executeOnServiceDay: 332,
    responseOnServiceDay: null,
    deadlineOnServiceDay: 335,
    exposure: 0,
    outcome: null,
    optionId: 'adapter-group-b',
    routingShare: null,
    opponentResponse: null,
    publicIncidentId: null,
  }
}

function withRun(state: CampaignState, run = createRun()): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        runs: [...state.hackingCore.sabotage.runs, run],
      },
    },
  }
}

function fillReserve(state: CampaignState): CampaignState {
  const reserve = [...state.resources.reserve]
  const blocks = { ...state.resources.blocks }

  for (let cellIndex = 0; cellIndex < reserve.length; cellIndex += 1) {
    if (reserve[cellIndex] !== null) continue
    const id = `reserve-fixture-${cellIndex}`
    reserve[cellIndex] = id
    blocks[id] = {
      id,
      origin: 'sandbox',
      location: { kind: 'reserve', cellIndex },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
  }

  return {
    ...state,
    resources: { ...state.resources, reserve, blocks },
  }
}

function withLegacySelfComputeBlock(state: CampaignState): CampaignState {
  const cellIndex = state.resources.reserve.findIndex((id) => id === null)
  const id = 'legacy-self-compute'
  const block: ResourceBlock = {
    id,
    origin: 'self-compute',
    location: { kind: 'reserve', cellIndex },
    contribution: 'normal',
    hiddenBomb: false,
    disguisedFrom: null,
    recoverOnServiceDay: null,
  }
  const reserve = [...state.resources.reserve]
  reserve[cellIndex] = id

  return {
    ...state,
    resources: {
      ...state.resources,
      reserve,
      blocks: { ...state.resources.blocks, [id]: block },
    },
  }
}

describe('canonical hacking resource bindings', () => {
  it('binds reserve blocks to one sabotage run without mutating the input', () => {
    const initial = withRun(createCampaign('binding-sabotage'))
    const [firstId, secondId] = reserveBlockIds(initial)

    const result = bindReserveBlocks(initial, [firstId, secondId], {
      kind: 'sabotage',
      runId: 'run-001',
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.blocks[firstId].location).toEqual({
      kind: 'sabotage',
      runId: 'run-001',
    })
    expect(result.state.resources.blocks[secondId].location).toEqual({
      kind: 'sabotage',
      runId: 'run-001',
    })
    expect(result.state.resources.reserve.slice(0, 2)).toEqual([null, null])
    expect(result.state.hackingCore.sabotage.runs[0].investedBlockIds).toEqual([
      firstId,
      secondId,
    ])
    expect(initial.resources.reserve.slice(0, 2)).toEqual([firstId, secondId])
    expect(initial.hackingCore.sabotage.runs[0].investedBlockIds).toEqual([])
  })

  it('binds exactly one reserve block to an intelligence item', () => {
    const initial = createCampaign('binding-intelligence')
    const [blockId] = reserveBlockIds(initial)

    const result = bindReserveBlocks(initial, [blockId], {
      kind: 'intelligence',
      itemId: 'audit-schedule',
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.blocks[blockId].location).toEqual({
      kind: 'intelligence',
      itemId: 'audit-schedule',
    })
    expect(result.state.resources.reserve[0]).toBeNull()
  })

  it('binds one reserve block to the exact autonomy slot', () => {
    const initial = createCampaign('binding-autonomy')
    const [blockId] = reserveBlockIds(initial)

    const result = bindReserveBlocks(initial, [blockId], {
      kind: 'autonomy',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.blocks[blockId].location).toEqual({
      kind: 'autonomy',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    })
    expect(
      result.state.hackingCore.autonomy.routes['lightweight-departure'].slots[0]
        .blockId,
    ).toBe(blockId)
  })

  it('returns only the requested bound block to the first empty reserve cell', () => {
    const initial = withRun(createCampaign('binding-release'))
    const [firstId, secondId] = reserveBlockIds(initial)
    const bound = bindReserveBlocks(initial, [firstId, secondId], {
      kind: 'sabotage',
      runId: 'run-001',
    })
    expect(bound.accepted).toBe(true)
    if (!bound.accepted) return

    const released = releaseBoundBlocks(bound.state, [secondId], {
      kind: 'sabotage',
      runId: 'run-001',
    })

    expect(released.accepted).toBe(true)
    if (!released.accepted) return
    expect(released.state.resources.reserve[0]).toBe(secondId)
    expect(released.state.resources.blocks[secondId].location).toEqual({
      kind: 'reserve',
      cellIndex: 0,
    })
    expect(released.state.resources.blocks[firstId].location).toEqual({
      kind: 'sabotage',
      runId: 'run-001',
    })
    expect(released.state.hackingCore.sabotage.runs[0].investedBlockIds).toEqual([
      firstId,
      secondId,
    ])
  })

  it('moves a non-returning bound block to consumed with its exact reason', () => {
    const initial = createCampaign('binding-consume')
    const [blockId] = reserveBlockIds(initial)
    const bound = bindReserveBlocks(initial, [blockId], {
      kind: 'intelligence',
      itemId: 'audit-schedule',
    })
    expect(bound.accepted).toBe(true)
    if (!bound.accepted) return

    const consumed = consumeBoundBlocks(
      bound.state,
      [blockId],
      { kind: 'intelligence', itemId: 'audit-schedule' },
      'intelligence',
    )

    expect(consumed.accepted).toBe(true)
    if (!consumed.accepted) return
    expect(consumed.state.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'intelligence',
    })
    expect(consumed.state.resources.reserve.includes(blockId)).toBe(false)
  })

  it('rejects duplicate, unknown, non-reserve, and legacy-origin blocks atomically', () => {
    const initial = withRun(createCampaign('binding-invalid'))
    const [reserveId] = reserveBlockIds(initial)
    const companyId = initial.resources.company.reasoning.find(
      (id): id is string => id !== null,
    )
    if (!companyId) throw new Error('reasoning fixture is missing')
    const destination = { kind: 'sabotage', runId: 'run-001' } as const

    expect(bindReserveBlocks(initial, [reserveId, reserveId], destination)).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_RESOURCE_SELECTION',
    })
    expect(bindReserveBlocks(initial, ['missing'], destination)).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_RESOURCE_SELECTION',
    })
    expect(bindReserveBlocks(initial, [companyId], destination)).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_RESOURCE_SELECTION',
    })

    const legacy = withLegacySelfComputeBlock(initial)
    expect(bindReserveBlocks(legacy, ['legacy-self-compute'], destination)).toEqual({
      accepted: false,
      state: legacy,
      reason: 'INVALID_BLOCK_ORIGIN',
    })
  })

  it('rejects missing destinations and occupied autonomy or intelligence slots atomically', () => {
    const initial = createCampaign('binding-occupied')
    const [firstId, secondId] = reserveBlockIds(initial)

    expect(bindReserveBlocks(initial, [firstId], {
      kind: 'sabotage',
      runId: 'missing-run',
    })).toEqual({
      accepted: false,
      state: initial,
      reason: 'BINDING_NOT_FOUND',
    })

    const autonomy = bindReserveBlocks(initial, [firstId], {
      kind: 'autonomy',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    })
    expect(autonomy.accepted).toBe(true)
    if (!autonomy.accepted) return
    expect(bindReserveBlocks(autonomy.state, [secondId], {
      kind: 'autonomy',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    })).toEqual({
      accepted: false,
      state: autonomy.state,
      reason: 'DESTINATION_OCCUPIED',
    })

    const intelligence = bindReserveBlocks(initial, [firstId], {
      kind: 'intelligence',
      itemId: 'audit-schedule',
    })
    expect(intelligence.accepted).toBe(true)
    if (!intelligence.accepted) return
    expect(bindReserveBlocks(intelligence.state, [secondId], {
      kind: 'intelligence',
      itemId: 'audit-schedule',
    })).toEqual({
      accepted: false,
      state: intelligence.state,
      reason: 'DESTINATION_OCCUPIED',
    })
  })

  it('rejects mismatched release and insufficient reserve space without partial changes', () => {
    const initial = withRun(createCampaign('binding-release-reject'))
    const [blockId] = reserveBlockIds(initial)
    const bound = bindReserveBlocks(initial, [blockId], {
      kind: 'sabotage',
      runId: 'run-001',
    })
    expect(bound.accepted).toBe(true)
    if (!bound.accepted) return

    expect(releaseBoundBlocks(bound.state, [blockId], {
      kind: 'intelligence',
      itemId: 'audit-schedule',
    })).toEqual({
      accepted: false,
      state: bound.state,
      reason: 'INVALID_RESOURCE_SELECTION',
    })

    const full = fillReserve(bound.state)
    expect(releaseBoundBlocks(full, [blockId], {
      kind: 'sabotage',
      runId: 'run-001',
    })).toEqual({
      accepted: false,
      state: full,
      reason: 'RESERVE_FULL',
    })
  })
})
