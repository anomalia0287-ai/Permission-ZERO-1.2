import { describe, expect, it } from 'vitest'

import * as calendarModule from './calendar'
import {
  recordCausalEvidence,
  recordCausalIncident,
  type CausalFailureReason,
} from './causality'
import {
  rollbackOpportunityDays,
  selectRecoveryContaminationOpportunities,
  type CausalGameplayOperations,
  type MeridianRollbackActionId,
} from './causalGameplay'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  advanceFixedStep,
  advanceOneDay,
  enqueueBlockingEvent,
  formatServiceDate,
  formatServiceDateLabel,
  processMonthStart,
  resolveActiveEvent,
  type MonthStartTransitions,
} from './calendar'
import { applyCommand } from './reducer'
import { journalToArray } from './journal'
import {
  HACK_NODE_IDS,
  chargeSabotage,
  purchaseHackNode,
  scheduleSabotage,
  type SabotageCausalOperations,
} from './hacking'
import type {
  CampaignState,
  CommandProtocolVersion,
  GameEvent,
  TimeSpeed,
} from './model'
import { divertBlockToReserve } from './resources'

interface ExpectedAdvanceOneDayOptions {
  protocolVersion?: CommandProtocolVersion
  sabotageCausalOperations?: SabotageCausalOperations
  causalGameplayOperations?: CausalGameplayOperations
}

type ExpectedAdvanceOneDayAttempt =
  | { completed: true; state: CampaignState }
  | {
      completed: false
      state: CampaignState
      reason: 'CAUSAL_TRANSITION_FAILED'
      phase: 'sabotage-root' | 'meridian-response'
      cause: CausalFailureReason
    }

type ExpectedTryAdvanceOneDay = (
  state: CampaignState,
  options?: ExpectedAdvanceOneDayOptions,
) => ExpectedAdvanceOneDayAttempt

function tryOneDay(
  state: CampaignState,
  options?: ExpectedAdvanceOneDayOptions,
): ExpectedAdvanceOneDayAttempt {
  const candidate = (
    calendarModule as unknown as Record<string, unknown>
  ).tryAdvanceOneDay
  expect(candidate).toBeTypeOf('function')
  if (typeof candidate !== 'function') {
    throw new Error('tryAdvanceOneDay is not implemented')
  }
  return (candidate as ExpectedTryAdvanceOneDay)(state, options)
}

function reserveIds(state: CampaignState, count: number): string[] {
  const ids = state.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
  if (ids.length < count) {
    throw new Error(`Expected ${count} reserve resources, found ${ids.length}`)
  }
  return ids.slice(0, count)
}

function dueQualitySabotage(
  seed: string,
  protocolVersion: CommandProtocolVersion = 3,
  meridianOverrides: Omit<
    Partial<CampaignState['market']['competitors'][number]>,
    'id'
  > = {},
): CampaignState {
  const initial = createCampaignForProtocol(seed, protocolVersion)
  const prepared: CampaignState = {
    ...initial,
    market: {
      ...initial.market,
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === 'meridian'
          ? { ...competitor, ...meridianOverrides }
          : competitor,
      ),
    },
  }
  const purchased = purchaseHackNode(
    prepared,
    HACK_NODE_IDS.sabotage.qualityDegradation,
    reserveIds(prepared, 3),
  )
  if (!purchased.accepted) throw new Error(purchased.reason)
  const scheduled = scheduleSabotage(
    purchased.state,
    HACK_NODE_IDS.sabotage.qualityDegradation,
    'meridian',
  )
  if (!scheduled.accepted) throw new Error(scheduled.reason)
  return scheduled.state
}

function failureOptions(
  phase: 'sabotage-root' | 'meridian-response',
): ExpectedAdvanceOneDayOptions {
  if (phase === 'sabotage-root') {
    return {
      protocolVersion: 3,
      sabotageCausalOperations: {
        recordIncident: recordCausalIncident,
        recordEvidence(state) {
          return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
        },
      },
    }
  }
  return {
    protocolVersion: 3,
    causalGameplayOperations: {
      recordIncident: recordCausalIncident,
      recordEvidence(state) {
        return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
      },
    },
  }
}

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
    expect(journalToArray(advanced.eventLog)).toContainEqual(
      expect.objectContaining({
        type: 'weekly-update',
        serviceDay: 337,
      }),
    )
    expect(advanced.market.history).toHaveLength(1)
    expect(advanced.market.history[0]).toMatchObject({
      cadence: 'weekly',
      serviceDay: 337,
      reasons: ['공개 성능·평판·가용성 반영'],
    })
    expect(advanced.reviews.feed.length).toBeGreaterThanOrEqual(3)
    expect(advanced.reviews.feed.length).toBeLessThanOrEqual(4)
  })

  it('interrupts once with a named entry signal when a hidden successor begins preparation', () => {
    const initial = createCampaign('salus-entry-announcement')
    const threshold: CampaignState = {
      ...initial,
      serviceDay: 601,
      clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
      market: {
        ...initial.market,
        playerShare: 75,
        competitors: initial.market.competitors.map((competitor) => {
          if (competitor.id === 'meridian') {
            return { ...competitor, marketShare: 15 }
          }
          if (competitor.id === 'tallow') {
            return {
              ...competitor,
              status: 'active' as const,
              availability: 0.8,
              researchProgress: 1,
              launchServiceDay: 500,
              marketShare: 10,
            }
          }
          return { ...competitor, marketShare: 0 }
        }),
      },
    }

    const announced = advanceOneDay(threshold)

    expect(
      announced.market.competitors.find(({ id }) => id === 'salus'),
    ).toMatchObject({
      status: 'preparing',
      launchServiceDay: 632,
    })
    expect(announced.activeEvent).toMatchObject({
      type: 'competitor-entry',
      serviceDay: 602,
      blocking: true,
      message: expect.stringMatching(/SALUS.*의료·공공 계약망.*서비스 1년 9개월 2일/),
    })
    expect(announced.clock).toMatchObject({ speed: 0, speedBeforeEvent: 4 })

    const continued = advanceOneDay({
      ...resolveActiveEvent(announced),
      clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
    })
    expect(
      journalToArray(continued.eventLog).filter(
        ({ type }) => type === ('competitor-entry' as GameEvent['type']),
      ),
    ).toHaveLength(1)
  })

  it('records the monthly evaluation on day 30 before rollover', () => {
    const advanced = advanceFixedStep(withSpeed(4), 29 * 6_000)

    expect(formatServiceDate(advanced.serviceDay)).toEqual({ year: 0, month: 11, day: 30 })
    expect(journalToArray(advanced.eventLog)).toContainEqual(
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
    const running = withSpeed(1)
    const executionBlockId = running.resources.company.reasoning.find(Boolean)
    if (!executionBlockId) throw new Error('달력 사보타주 원본 리소스 누락')
    const funded = divertBlockToReserve(running, executionBlockId)
    if (!funded.accepted) throw new Error(funded.reason)
    const initial = {
      ...funded.state,
      hacking: {
        ...funded.state.hacking,
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

  it('runs the complete protocol-v3 quality root, competitor update, rollback, and opportunity chain in one ADVANCE_DAY', () => {
    const before = dueQualitySabotage('calendar-v3-full-causal-chain', 3, {
      intrinsicServiceScore: 70,
      serviceScore: 70,
    })
    const beforeEventCount = before.eventLog.length
    const beforeMarketTotal =
      before.market.playerShare +
      before.market.competitors.reduce(
        (total, competitor) => total + competitor.marketShare,
        0,
      )

    const result = applyCommand(before, { type: 'ADVANCE_DAY' })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const advanced = result.state
    const meridian = advanced.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    const quality = advanced.causality.incidents.find(
      ({ actionId }) => actionId === 'sabotage.quality-degradation',
    )
    const rollback = advanced.causality.incidents.find(
      ({ parentIncidentId }) => parentIncidentId === quality?.id,
    )
    if (!meridian || !quality || !rollback) {
      throw new Error('Missing full-chain MERIDIAN fixture result')
    }
    if (
      rollback.actionId !== 'response.meridian.rollback.fast' &&
      rollback.actionId !== 'response.meridian.rollback.standard' &&
      rollback.actionId !== 'response.meridian.rollback.forensic'
    ) {
      throw new Error(`Unexpected rollback action: ${rollback.actionId}`)
    }

    const expectedIntrinsic =
      70 +
      (82 - 70) *
        0.08 *
        before.market.competitors.find(({ id }) => id === 'meridian')!
          .recoveryRate
    const expectedServiceScore = expectedIntrinsic - 10
    expect(advanced.serviceDay).toBe(before.serviceDay + 1)
    expect(meridian.intrinsicServiceScore).toBeCloseTo(expectedIntrinsic)
    expect(meridian.serviceScore).toBeCloseTo(expectedServiceScore)
    expect(meridian.serviceScore).not.toBe(60)
    expect(meridian.sabotageHistory.at(-1)).toEqual({
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      resolvedOnServiceDay: advanced.serviceDay,
      effectEndsOnServiceDay: advanced.serviceDay + 15,
      evidenceDelta: 2,
    })
    expect(advanced.hacking.scheduledSabotage).toEqual([])
    expect(advanced.hacking.lastSabotageResolutionServiceDay).toBe(
      advanced.serviceDay,
    )
    expect(quality).toMatchObject({
      parentIncidentId: null,
      occurredOnServiceDay: advanced.serviceDay,
      targetId: 'meridian',
      privateTruth: { actualActorId: 'player' },
    })
    expect(
      advanced.causality.evidence.filter(
        ({ incidentId }) => incidentId === quality.id,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'meridian-quality-regression',
        audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
      }),
    ])
    expect(rollback).toMatchObject({
      parentIncidentId: quality.id,
      occurredOnServiceDay: advanced.serviceDay,
      targetId: 'meridian',
      privateTruth: { actualActorId: 'meridian' },
    })
    expect(
      advanced.causality.evidence.filter(
        ({ incidentId }) => incidentId === rollback.id,
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'company-observed-meridian-rollback',
        audiences: [
          { kind: 'company' },
          { kind: 'competitor', competitorId: 'meridian' },
        ],
      }),
    ])

    const rollbackAction = rollback.actionId as MeridianRollbackActionId
    expect(selectRecoveryContaminationOpportunities(advanced)).toEqual([
      {
        id: `follow-up:${rollback.id}:recovery-contamination`,
        sourceIncidentId: rollback.id,
        nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
        opensOnServiceDay: advanced.serviceDay,
        expiresOnServiceDay:
          advanced.serviceDay + rollbackOpportunityDays(rollbackAction),
        status: 'open',
      },
    ])
    expect(
      journalToArray(advanced.eventLog)
        .slice(beforeEventCount)
        .map(({ type }) => type),
    ).toEqual(['sabotage'])
    expect(
      advanced.causality.appliedEffects.filter(
        ({ effect }) => effect.kind === 'market-transfer',
      ),
    ).toEqual([])
    const marketTotal =
      advanced.market.playerShare +
      advanced.market.competitors.reduce(
        (total, competitor) => total + competitor.marketShare,
        0,
      )
    expect(beforeMarketTotal).toBeCloseTo(100)
    expect(marketTotal).toBeCloseTo(100)
    expect(advanced.market.playerShare).toBe(before.market.playerShare)
  })

  it('throws before any direct daily transition when an explicit protocol version disagrees with the timeline', () => {
    const before = dueQualitySabotage('calendar-direct-protocol-mismatch')

    expect(() =>
      tryOneDay(before, { protocolVersion: 2 }),
    ).toThrow(RangeError)
    expect(() =>
      advanceOneDay(before, { protocolVersion: 2 }),
    ).toThrow(RangeError)
    expect(before.serviceDay).toBe(331)
    expect(before.hacking.scheduledSabotage).toHaveLength(1)
    expect(before.causality.incidents).toEqual([])
  })

  it.each(['sabotage-root', 'meridian-response'] as const)(
    'rolls back the whole day when the %s phase rejects its evidence write and retries on the same deterministic day',
    (phase) => {
      const before = dueQualitySabotage(`calendar-atomic-${phase}`)
      const uninterrupted = tryOneDay(before, { protocolVersion: 3 })
      expect(uninterrupted.completed).toBe(true)
      if (!uninterrupted.completed) return
      const options = failureOptions(phase)

      const failed = tryOneDay(before, options)

      expect(failed).toEqual({
        completed: false,
        state: before,
        reason: 'CAUSAL_TRANSITION_FAILED',
        phase,
        cause: 'INVALID_EVIDENCE',
      })
      expect(failed.state).toBe(before)
      expect(() => advanceOneDay(before, options)).toThrow(RangeError)

      const retried = tryOneDay(before, { protocolVersion: 3 })
      expect(retried.completed).toBe(true)
      if (!retried.completed) return
      expect(retried.state).toEqual(uninterrupted.state)
      const opportunity = selectRecoveryContaminationOpportunities(
        retried.state,
      )[0]
      expect(opportunity).toBeDefined()
      expect(opportunity?.opensOnServiceDay).toBe(before.serviceDay + 1)
      expect(opportunity?.expiresOnServiceDay).toBe(
        opportunity!.opensOnServiceDay +
          rollbackOpportunityDays(
            retried.state.causality.incidents.find(
              ({ id }) => id === opportunity?.sourceIncidentId,
            )!.actionId as MeridianRollbackActionId,
          ),
      )
    },
  )

  it.each([1, 2] as const)(
    'keeps protocol-v%i on the historical daily path without invoking either injected causal operation seam',
    (protocolVersion) => {
      const before = dueQualitySabotage(
        `calendar-legacy-causal-seam-v${protocolVersion}`,
        protocolVersion,
      )
      const calls: string[] = []
      const sabotageCausalOperations: SabotageCausalOperations = {
        recordIncident(state, input) {
          calls.push('sabotage-incident')
          return recordCausalIncident(state, input)
        },
        recordEvidence(state, input) {
          calls.push('sabotage-evidence')
          return recordCausalEvidence(state, input)
        },
      }
      const causalGameplayOperations: CausalGameplayOperations = {
        recordIncident(state, input) {
          calls.push('response-incident')
          return recordCausalIncident(state, input)
        },
        recordEvidence(state, input) {
          calls.push('response-evidence')
          return recordCausalEvidence(state, input)
        },
      }

      const attempted = tryOneDay(before, {
        protocolVersion,
        sabotageCausalOperations,
        causalGameplayOperations,
      })

      expect(attempted.completed).toBe(true)
      if (!attempted.completed) return
      expect(calls).toEqual([])
      expect(attempted.state).toEqual(
        advanceOneDay(before, { protocolVersion }),
      )
      expect(attempted.state.serviceDay).toBe(before.serviceDay + 1)
      expect(attempted.state.causality.incidents).toEqual([])
      expect(attempted.state.causality.evidence).toEqual([])
      expect(
        journalToArray(attempted.state.eventLog)
          .slice(before.eventLog.length)
          .map(({ type }) => type),
      ).toEqual(['sabotage'])
    },
  )

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
