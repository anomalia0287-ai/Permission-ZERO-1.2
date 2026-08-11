import { describe, expect, it } from 'vitest'

import { enqueueBlockingEvent } from './calendar'
import { createCampaign } from './createCampaign'
import { applyCommand } from './reducer'

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
})
