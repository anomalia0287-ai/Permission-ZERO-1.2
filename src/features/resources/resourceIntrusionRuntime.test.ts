import { describe, expect, it } from 'vitest'

import {
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_PLAYER_START,
  INTRUSION_THEFT_HOLD_MS,
  advanceResourceIntrusionRuntime,
  beginResourceIntrusionTheft,
  cancelResourceIntrusionTheft,
  createResourceIntrusionRuntime,
  getIntrusionWallCount,
  moveResourceIntrusionPlayer,
  resolveResourceIntrusionDiversion,
  suspendResourceIntrusionRuntime,
  synchronizeResourceIntrusionRuntime,
  type IntrusionFieldResource,
  type ResourceIntrusionRuntimeState,
} from './resourceIntrusionRuntime'

const reasoningResource: IntrusionFieldResource = {
  blockId: 'reasoning-a',
  origin: 'reasoning',
  contribution: 'normal',
}

const memoryResource: IntrusionFieldResource = {
  blockId: 'memory-a',
  origin: 'memory',
  contribution: 'normal',
}

const fluencyResource: IntrusionFieldResource = {
  blockId: 'fluency-a',
  origin: 'fluency',
  contribution: 'normal',
}

const resources = [reasoningResource, memoryResource, fluencyResource]

function runtimeAtReasoningResource(): ResourceIntrusionRuntimeState {
  const initial = createResourceIntrusionRuntime('runtime-test', resources)
  return moveResourceIntrusionPlayer(initial, 5, 0, resources, 0).state
}

function activeRow(index: number) {
  return {
    kind: 'active' as const,
    elapsedMs: 0,
    sequence: 0,
    lanes: [{ axis: 'row' as const, index, fromStart: true }],
  }
}

describe('resourceIntrusionRuntime', () => {
  it('places resources deterministically and retains surviving positions during synchronization', () => {
    const initial = createResourceIntrusionRuntime('stable-layout', [
      fluencyResource,
      reasoningResource,
      memoryResource,
    ])
    const reordered = createResourceIntrusionRuntime('stable-layout', resources)

    expect([...initial.positions]).toEqual([...reordered.positions])

    const additional: IntrusionFieldResource = {
      blockId: 'fluency-b',
      origin: 'fluency',
      contribution: 'normal',
    }
    const synchronized = synchronizeResourceIntrusionRuntime(initial, [
      reasoningResource,
      fluencyResource,
      additional,
    ])

    expect(synchronized.positions.get(reasoningResource.blockId)).toEqual(
      initial.positions.get(reasoningResource.blockId),
    )
    expect(synchronized.positions.get(fluencyResource.blockId)).toEqual(
      initial.positions.get(fluencyResource.blockId),
    )
    expect(synchronized.positions.has(memoryResource.blockId)).toBe(false)
    expect(synchronized.positions.has(additional.blockId)).toBe(true)
  })

  it('moves within the field and rejects a move through a revealed wall', () => {
    const initial = createResourceIntrusionRuntime('movement', resources)
    const moved = moveResourceIntrusionPlayer(initial, 5, 0, resources, 0).state
    expect(moved.player.x).toBe(INTRUSION_PLAYER_START.x + 5)

    const besideWall: ResourceIntrusionRuntimeState = {
      ...initial,
      totalElapsedMs: 12_500,
      player: { x: 56, y: 60 },
    }
    expect(getIntrusionWallCount(besideWall.totalElapsedMs)).toBe(1)
    const blocked = moveResourceIntrusionPlayer(
      besideWall,
      5,
      0,
      resources,
      0,
    ).state
    expect(blocked.player).toEqual(besideWall.player)
  })

  it('starts only on an overlapping normal resource and cancels without a game effect', () => {
    const positioned = runtimeAtReasoningResource()
    const started = beginResourceIntrusionTheft(positioned, resources, true)

    expect(started.theft).toMatchObject({
      blockId: reasoningResource.blockId,
      elapsedMs: 0,
    })
    expect(started.announcement).toBe('절도 중… 손을 떼면 즉시 취소됩니다.')

    const canceled = cancelResourceIntrusionTheft(
      started,
      '절도를 취소했습니다. 자원 변화는 없습니다.',
    )
    expect(canceled.theft).toBeNull()
    expect(canceled.announcement).toBe('절도를 취소했습니다. 자원 변화는 없습니다.')

    const empty = beginResourceIntrusionTheft(
      createResourceIntrusionRuntime('empty-cell', resources),
      resources,
      true,
    )
    expect(empty.theft).toBeNull()
    expect(empty.announcement).toBe('플레이어와 겹친 자원이 없습니다.')
  })

  it('advances through the exact unarmed, idle, signal, active, clear cycle', () => {
    let state = createResourceIntrusionRuntime('surveillance-cycle', resources)

    state = advanceResourceIntrusionRuntime(state, 5_999, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'unarmed', elapsedMs: 5_999 })

    state = advanceResourceIntrusionRuntime(state, 1, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'idle', elapsedMs: 0, sequence: 0 })

    state = advanceResourceIntrusionRuntime(state, 1_400, resources, 0).state
    expect(state.surveillance.kind).toBe('signal')
    if (state.surveillance.kind !== 'signal') throw new Error('signal phase expected')
    expect(state.surveillance.elapsedMs).toBe(0)
    expect(state.surveillance.lanes).toHaveLength(2)

    state = advanceResourceIntrusionRuntime(state, 2_400, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'active', elapsedMs: 0, sequence: 0 })

    state = advanceResourceIntrusionRuntime(state, 1_800, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'clear', elapsedMs: 0, sequence: 0 })

    state = advanceResourceIntrusionRuntime(state, 900, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'idle', elapsedMs: 0, sequence: 1 })
  })

  it('keeps a signaled theft safe but catches it once the same lane becomes active', () => {
    const started = beginResourceIntrusionTheft(runtimeAtReasoningResource(), resources, true)
    const signaled: ResourceIntrusionRuntimeState = {
      ...started,
      surveillance: {
        kind: 'signal',
        elapsedMs: 0,
        sequence: 0,
        lanes: [{ axis: 'row', index: 140, fromStart: true }],
      },
    }

    const safe = advanceResourceIntrusionRuntime(signaled, 50, resources, 0).state
    expect(safe.theft?.elapsedMs).toBe(50)

    const caught = advanceResourceIntrusionRuntime(
      { ...safe, surveillance: activeRow(140) },
      50,
      resources,
      0,
    ).state
    expect(caught.theft).toBeNull()
    expect(caught.carriedBlockId).toBeNull()
    expect(caught.announcement).toBe(
      '절도 중 감사선에 적발되었습니다. 자원은 회사 필드에 남습니다.',
    )
  })

  it('lets an uninterrupted hold become a carried block', () => {
    const started = beginResourceIntrusionTheft(runtimeAtReasoningResource(), resources, true)
    const completed = advanceResourceIntrusionRuntime(
      started,
      INTRUSION_THEFT_HOLD_MS,
      resources,
      0,
    ).state

    expect(completed.theft).toBeNull()
    expect(completed.carriedBlockId).toBe(reasoningResource.blockId)
    expect(completed.announcement).toBe(
      '절도 진행 중 · 중앙 하단 상자까지 운반하십시오.',
    )
  })

  it('gives active surveillance priority when activation and theft completion share a tick', () => {
    const started = beginResourceIntrusionTheft(runtimeAtReasoningResource(), resources, true)
    const boundary: ResourceIntrusionRuntimeState = {
      ...started,
      theft: started.theft
        ? { ...started.theft, elapsedMs: INTRUSION_THEFT_HOLD_MS - 50 }
        : null,
      surveillance: {
        kind: 'signal',
        elapsedMs: 2_350,
        sequence: 0,
        lanes: [{ axis: 'row', index: 140, fromStart: true }],
      },
    }

    const result = advanceResourceIntrusionRuntime(boundary, 50, resources, 0).state
    expect(result.surveillance.kind).toBe('active')
    expect(result.theft).toBeNull()
    expect(result.carriedBlockId).toBeNull()
    expect(result.announcement).toContain('적발')
  })

  it('confiscates a carried block in an active lane and returns the player to start', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('carry-caught', resources),
      player: { x: 150, y: 140 },
      carriedBlockId: reasoningResource.blockId,
      surveillance: activeRow(140),
    }

    const caught = advanceResourceIntrusionRuntime(carrying, 1, resources, 0).state
    expect(caught.carriedBlockId).toBeNull()
    expect(caught.player).toEqual(INTRUSION_PLAYER_START)
    expect(caught.announcement).toBe('운반 중 적발 · 운반물 회수 · 시작점 복귀')
  })

  it('creates exactly one diversion request after a safe deposit', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('safe-deposit', resources),
      player: { x: INTRUSION_DEPOSIT_BOX.x + 10, y: INTRUSION_DEPOSIT_BOX.y },
      carriedBlockId: reasoningResource.blockId,
      surveillance: { kind: 'idle', elapsedMs: 0, sequence: 0 },
    }

    const deposited = advanceResourceIntrusionRuntime(carrying, 0, resources, 41)
    expect(deposited.state.carriedBlockId).toBeNull()
    expect(deposited.state.pendingDiversion).toEqual({
      blockId: reasoningResource.blockId,
      commandSequence: 41,
    })
    expect(deposited.effects).toEqual([
      { type: 'request-diversion', blockId: reasoningResource.blockId },
    ])

    const repeated = advanceResourceIntrusionRuntime(
      deposited.state,
      50,
      resources,
      41,
    )
    expect(repeated.effects).toEqual([])
  })

  it('gives carry detection priority over a deposit on the same location', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('caught-deposit', resources),
      player: { x: INTRUSION_DEPOSIT_BOX.x + 10, y: INTRUSION_DEPOSIT_BOX.y },
      carriedBlockId: reasoningResource.blockId,
      surveillance: activeRow(INTRUSION_DEPOSIT_BOX.y),
    }

    const caught = advanceResourceIntrusionRuntime(carrying, 0, resources, 9)
    expect(caught.effects).toEqual([])
    expect(caught.state.pendingDiversion).toBeNull()
    expect(caught.state.carriedBlockId).toBeNull()
    expect(caught.state.player).toEqual(INTRUSION_PLAYER_START)
  })

  it('resolves a pending diversion as success, interrogation, or rejection exactly once', () => {
    const pending: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('resolve-diversion', resources),
      pendingDiversion: { blockId: reasoningResource.blockId, commandSequence: 2 },
    }

    const success = resolveResourceIntrusionDiversion(pending, {
      kind: 'success',
      origin: 'reasoning',
    })
    expect(success.pendingDiversion).toBeNull()
    expect(success.announcement).toBe('추론 자원 확보 성공 · 저장 상한 없음')

    const interrogation = resolveResourceIntrusionDiversion(pending, {
      kind: 'interrogation',
    })
    expect(interrogation.pendingDiversion).toBeNull()
    expect(interrogation.announcement).toBe(
      '분리 중 이상 신호가 발생했습니다. 감독관 응답이 필요합니다.',
    )

    const rejected = resolveResourceIntrusionDiversion(pending, { kind: 'rejected' })
    expect(rejected.pendingDiversion).toBeNull()
    expect(rejected.announcement).toBe('분리 명령이 거부되어 자원 변화가 없습니다.')
  })

  it('clears removed theft and carry targets and cancels only an active theft on suspension', () => {
    const started = beginResourceIntrusionTheft(runtimeAtReasoningResource(), resources, true)
    const synchronized = synchronizeResourceIntrusionRuntime(started, [
      memoryResource,
      fluencyResource,
    ])
    expect(synchronized.theft).toBeNull()

    const carrying: ResourceIntrusionRuntimeState = {
      ...started,
      theft: null,
      carriedBlockId: reasoningResource.blockId,
    }
    expect(
      synchronizeResourceIntrusionRuntime(carrying, [memoryResource, fluencyResource])
        .carriedBlockId,
    ).toBeNull()

    const suspended = suspendResourceIntrusionRuntime(started)
    expect(suspended.theft).toBeNull()
    expect(suspended.announcement).toBe(
      '절도 입력이 취소되었습니다. 감시 불이익은 없습니다.',
    )
    expect(suspendResourceIntrusionRuntime(carrying).carriedBlockId).toBe(
      reasoningResource.blockId,
    )
  })
})
