import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  advanceFixedStep,
  enqueueBlockingEvent,
  formatServiceDate,
  resolveActiveEvent,
} from './calendar'
import { applyCommand } from './reducer'
import type { GameEvent, TimeSpeed } from './model'

function withSpeed(speed: TimeSpeed) {
  const result = applyCommand(createCampaign('clock-seed'), {
    type: 'SET_SPEED',
    speed,
  })

  if (!result.accepted) {
    throw new Error(`속도 설정 실패: ${result.reason}`)
  }

  return result.state
}

function blockingEvent(id: string): GameEvent {
  return {
    id,
    type: 'audit',
    serviceDay: 331,
    sequence: Number(id.slice(-1)),
    message: `감사 사건 ${id}`,
    blocking: true,
  }
}

describe('fixed campaign calendar', () => {
  it('does not advance while paused', () => {
    const paused = createCampaign('clock-seed')

    expect(advanceFixedStep(paused, 120_000)).toBe(paused)
    expect(paused.serviceDay).toBe(331)
  })

  it.each([
    [1, 24_000],
    [2, 12_000],
    [4, 6_000],
  ] satisfies Array<[TimeSpeed, number]>) (
    'advances one day after the correct %sx real duration',
    (speed, elapsedMs) => {
      const advanced = advanceFixedStep(withSpeed(speed), elapsedMs)

      expect(advanced.serviceDay).toBe(332)
      expect(advanced.clock.elapsedDayMs).toBe(0)
    },
  )

  it('produces the same result across different frame partitions', () => {
    const oneFrame = advanceFixedStep(withSpeed(1), 24_000)
    let manyFrames = withSpeed(1)

    for (let frame = 0; frame < 240; frame += 1) {
      manyFrames = advanceFixedStep(manyFrames, 100)
    }

    expect(manyFrames).toEqual(oneFrame)
  })

  it('records a weekly update on service day 337', () => {
    const advanced = advanceFixedStep(withSpeed(4), 6 * 6_000)

    expect(formatServiceDate(advanced.serviceDay)).toEqual({ year: 0, month: 11, day: 7 })
    expect(advanced.eventLog.at(-1)).toMatchObject({
      type: 'weekly-update',
      serviceDay: 337,
    })
  })

  it('records the monthly evaluation on day 30 before rollover', () => {
    const advanced = advanceFixedStep(withSpeed(4), 29 * 6_000)

    expect(formatServiceDate(advanced.serviceDay)).toEqual({ year: 0, month: 11, day: 30 })
    expect(advanced.eventLog).toContainEqual(
      expect.objectContaining({
        type: 'monthly-evaluation',
        serviceDay: 360,
      }),
    )
    expect(advanced.evaluation.monthlyHistory).toHaveLength(1)
  })

  it('applies natural suspicion decrease once per logical day', () => {
    const running = {
      ...withSpeed(1),
      suspicion: 2.4,
    }
    const advanced = advanceFixedStep(running, 24_000)

    expect(advanced.suspicion).toBeCloseTo(2.363)
  })

  it('opens a due audit after evaluation and discards high-speed time backlog', () => {
    const running = {
      ...withSpeed(4),
      serviceDay: 359,
      audit: {
        ...withSpeed(4).audit,
        scheduled: true,
        target: 'reasoning' as const,
        scheduledOnServiceDay: 360,
      },
    }
    const advanced = advanceFixedStep(running, 60_000)

    expect(advanced.serviceDay).toBe(360)
    expect(advanced.evaluation.monthlyHistory).toHaveLength(1)
    expect(advanced.activeEvent).toMatchObject({ type: 'audit', blocking: true })
    expect(advanced.clock.speed).toBe(0)
    expect(advanced.clock.speedBeforeEvent).toBe(4)
    expect(advanced.clock.elapsedDayMs).toBe(0)
  })
})

describe('blocking event queue', () => {
  it('shows one event at a time and restores the prior speed after the queue', () => {
    const running = withSpeed(2)
    const firstQueued = enqueueBlockingEvent(running, blockingEvent('audit-1'))
    const secondQueued = enqueueBlockingEvent(firstQueued, blockingEvent('audit-2'))

    expect(secondQueued.clock.speed).toBe(0)
    expect(secondQueued.clock.speedBeforeEvent).toBe(2)
    expect(secondQueued.activeEvent?.id).toBe('audit-1')
    expect(secondQueued.eventQueue.map(({ id }) => id)).toEqual(['audit-2'])

    const afterFirst = resolveActiveEvent(secondQueued)
    expect(afterFirst.activeEvent?.id).toBe('audit-2')
    expect(afterFirst.clock.speed).toBe(0)

    const afterSecond = resolveActiveEvent(afterFirst)
    expect(afterSecond.activeEvent).toBeNull()
    expect(afterSecond.eventQueue).toEqual([])
    expect(afterSecond.clock.speed).toBe(2)
    expect(afterSecond.clock.speedBeforeEvent).toBeNull()
  })

  it('remains paused when the player was paused before the event', () => {
    const paused = createCampaign('clock-seed')
    const queued = enqueueBlockingEvent(paused, blockingEvent('audit-1'))

    expect(resolveActiveEvent(queued).clock.speed).toBe(0)
  })
})
