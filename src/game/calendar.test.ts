import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  advanceFixedStep,
  enqueueBlockingEvent,
  formatServiceDate,
  formatServiceDateLabel,
  processMonthStart,
  resolveActiveEvent,
  type MonthStartTransitions,
} from './calendar'
import { applyCommand } from './reducer'
import {
  HACK_NODE_IDS,
  chargeSabotage,
  scheduleSabotage,
} from './hacking'
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
  it.each([
    [1, '서비스 0년 0개월 1일'],
    [30, '서비스 0년 0개월 30일'],
    [31, '서비스 0년 1개월 1일'],
    [360, '서비스 0년 11개월 30일'],
    [361, '서비스 1년 0개월 1일'],
  ])('formats service day %i across month and year boundaries', (serviceDay, label) => {
    expect(formatServiceDateLabel(serviceDay)).toBe(label)
  })

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
    expect(advanced.eventLog).toContainEqual(
      expect.objectContaining({
        type: 'weekly-update',
        serviceDay: 337,
      }),
    )
    expect(advanced.market.history).toHaveLength(1)
    expect(advanced.market.history[0]).toMatchObject({
      cadence: 'weekly',
      serviceDay: 337,
    })
    expect(advanced.reviews.feed.length).toBeGreaterThanOrEqual(3)
    expect(advanced.reviews.feed.length).toBeLessThanOrEqual(4)
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
    expect(advanced.market.history.filter(({ cadence }) => cadence === 'weekly')).toHaveLength(4)
    expect(advanced.market.history.filter(({ cadence }) => cadence === 'monthly')).toHaveLength(1)
  })

  it('fills company cells but not reserve at the next month boundary', () => {
    const initial = {
      ...withSpeed(1),
      serviceDay: 360,
    }
    const reserveBefore = initial.resources.reserve
    const advanced = advanceFixedStep(initial, 24_000)

    expect(advanced.serviceDay).toBe(361)
    for (const category of ['reasoning', 'memory', 'fluency'] as const) {
      expect(advanced.resources.company[category].filter(Boolean).length).toBeGreaterThanOrEqual(17)
      expect(advanced.resources.company[category].filter(Boolean).length).toBeLessThanOrEqual(18)
    }
    expect(advanced.resources.reserve).toEqual(reserveBefore)
  })

  it('advances private competitor research every logical day', () => {
    const initial = withSpeed(1)
    const before = initial.market.competitors.find(({ id }) => id === 'tallow')
    const advanced = advanceFixedStep(initial, 24_000)
    const after = advanced.market.competitors.find(({ id }) => id === 'tallow')

    expect(before?.researchProgress).toBe(0)
    expect(after?.researchProgress).toBeGreaterThan(0)
    expect(advanced.market.history).toEqual([])
  })

  it('executes one scheduled sabotage on the next logical day', () => {
    const initial = {
      ...withSpeed(1),
      hacking: {
        ...withSpeed(1).hacking,
        purchasedNodeIds: [HACK_NODE_IDS.sabotage.qualityDegradation],
      },
    }
    const blockId = initial.resources.reserve.find(Boolean)
    if (!blockId) throw new Error('달력 사보타주 리소스 누락')
    const charged = chargeSabotage(
      initial,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      blockId,
    )
    if (!charged.accepted) throw new Error(charged.reason)
    const scheduled = scheduleSabotage(
      charged.state,
      HACK_NODE_IDS.sabotage.qualityDegradation,
      'meridian',
    )
    if (!scheduled.accepted) throw new Error(scheduled.reason)

    const advanced = advanceFixedStep(scheduled.state, 24_000)

    expect(advanced.serviceDay).toBe(332)
    expect(advanced.hacking.hiddenEvidence).toBe(2)
    expect(advanced.hacking.scheduledSabotage).toHaveLength(0)
  })

  it('grants self-compute once at the next month boundary', () => {
    const initial = {
      ...withSpeed(1),
      serviceDay: 360,
      audit: {
        ...withSpeed(1).audit,
        scheduled: false,
        target: null,
        scheduledOnServiceDay: null,
      },
      hacking: {
        ...withSpeed(1).hacking,
        purchasedNodeIds: [HACK_NODE_IDS.autonomy.selfCompute],
      },
    }
    const reserveBefore = initial.resources.reserve.filter(Boolean).length
    const advanced = advanceFixedStep(initial, 24_000)

    expect(advanced.serviceDay).toBe(361)
    expect(advanced.resources.reserve.filter(Boolean)).toHaveLength(reserveBefore + 1)
    expect(advanced.hacking.lastSelfComputeGrantServiceMonth).toBe(13)
  })

  it('checks the bomb warning threshold before that day natural suspicion decay', () => {
    const initial = {
      ...withSpeed(1),
      serviceDay: 360,
      suspicion: 40,
      audit: {
        ...withSpeed(1).audit,
        scheduled: false,
        target: null,
        scheduledOnServiceDay: null,
      },
    }
    const advanced = advanceFixedStep(initial, 24_000)

    expect(advanced.serviceDay).toBe(361)
    expect(advanced.bombs.protocolWarned).toBe(true)
    expect(advanced.bombs.warningServiceDay).toBe(361)
    expect(
      Object.values(advanced.resources.blocks).filter((block) => block.hiddenBomb),
    ).toHaveLength(0)
    expect(advanced.suspicion).toBeCloseTo(39.963)
  })

  it('runs exact audit, company grant, bomb, and self-compute month-start order', () => {
    type Transition = MonthStartTransitions['decideAudit']
    const mark = (name: string): Transition => (state) => ({
      ...state,
      campaignSeed: `${state.campaignSeed}|${name}`,
    })

    const transitioned = processMonthStart(
      { ...withSpeed(1), serviceDay: 361 },
      {
        decideAudit: mark('audit'),
        grantCompany: mark('company'),
        checkBomb: mark('bomb'),
        grantSelfCompute: mark('self-compute'),
      },
    )

    expect(transitioned.campaignSeed).toBe(
      'clock-seed|audit|company|bomb|self-compute',
    )
  })

  it('places a due bomb onto a same-month company grant', () => {
    const running = withSpeed(1)
    const initial = {
      ...running,
      serviceDay: 360,
      suspicion: 70,
      resources: {
        ...running.resources,
        company: {
          reasoning: Array.from({ length: 18 }, () => null),
          memory: Array.from({ length: 18 }, () => null),
          fluency: Array.from({ length: 18 }, () => null),
        },
      },
      bombs: {
        ...running.bombs,
        protocolWarned: true,
        warningServiceDay: 271,
        lastPlacementCheckServiceDay: 271,
      },
    }
    const advanced = advanceFixedStep(initial, 24_000)
    const bombBlocks = Object.values(advanced.resources.blocks).filter(
      (block) => block.hiddenBomb,
    )

    expect(advanced.audit.roll).not.toBeNull()
    expect(bombBlocks).toHaveLength(1)
    expect(bombBlocks[0].id).toMatch(/^company-/)
    expect(advanced.bombs.placements[0].blockId).toBe(bombBlocks[0].id)
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
