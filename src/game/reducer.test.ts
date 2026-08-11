import { describe, expect, it } from 'vitest'

import { enqueueBlockingEvent } from './calendar'
import { createCampaign } from './createCampaign'
import { applyCommand } from './reducer'
import { placeHiddenBomb } from './bombs'

describe('applyCommand', () => {
  it('logs an accepted speed command with a monotonic sequence', () => {
    const initial = createCampaign('command-seed')
    const result = applyCommand(initial, { type: 'SET_SPEED', speed: 4 })

    expect(result).toMatchObject({ accepted: true })
    if (!result.accepted) return

    expect(result.state.clock.speed).toBe(4)
    expect(result.state.commandSequence).toBe(1)
    expect(result.state.commandLog).toEqual([
      {
        sequence: 1,
        serviceDay: 331,
        command: { type: 'SET_SPEED', speed: 4 },
      },
    ])
    expect(initial.clock.speed).toBe(0)
  })

  it('rejects an attempt to resume time during a blocking event', () => {
    const eventState = enqueueBlockingEvent(createCampaign('command-seed'), {
      id: 'audit-1',
      type: 'audit',
      serviceDay: 331,
      sequence: 1,
      message: '감사 대상 확인',
      blocking: true,
    })
    const result = applyCommand(eventState, { type: 'SET_SPEED', speed: 1 })

    expect(result).toEqual({
      accepted: false,
      state: eventState,
      reason: 'BLOCKING_EVENT_ACTIVE',
    })
    expect(result.state.commandSequence).toBe(0)
  })

  it('routes a valid diversion through the append-only command log', () => {
    const initial = createCampaign('command-diversion')
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('명령 전용 블록 누락')
    const result = applyCommand(initial, {
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell: 3,
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.reserve[3]).toBe(blockId)
    expect(result.state.commandLog.at(-1)?.command).toEqual({
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell: 3,
    })
  })

  it('records a bomb-triggering attempt even though the physical move is canceled', () => {
    const placement = placeHiddenBomb({
      ...createCampaign('command-bomb'),
      serviceDay: 541,
    })
    if (!placement.placed || !placement.blockId) throw new Error('명령 폭탄 배치 실패')
    const result = applyCommand(placement.state, {
      type: 'DIVERT_BLOCK',
      blockId: placement.blockId,
      destinationCell: 3,
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.reserve[3]).toBeNull()
    expect(result.state.activeEvent?.type).toBe('bomb-interrogation')
    expect(result.state.commandSequence).toBe(1)
  })

  it('rejects resource mutation while a blocking event is active', () => {
    const initial = createCampaign('command-blocked-mutation')
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('차단 명령 블록 누락')
    const busy = enqueueBlockingEvent(initial, {
      id: 'busy-audit',
      type: 'audit',
      serviceDay: 331,
      sequence: 1,
      message: '감사 진행 중',
      blocking: true,
    })

    expect(
      applyCommand(busy, {
        type: 'DIVERT_BLOCK',
        blockId,
        destinationCell: 3,
      }),
    ).toEqual({
      accepted: false,
      state: busy,
      reason: 'BLOCKING_EVENT_ACTIVE',
    })
  })
})
