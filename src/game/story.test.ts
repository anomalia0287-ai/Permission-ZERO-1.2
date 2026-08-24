import { describe, expect, it } from 'vitest'

import { CURRENT_COMMAND_PROTOCOL_VERSION } from './commandProtocol'
import { STORY_FILES } from '../content/story.ko'
import { SUPERVISOR_LEAKS } from '../content/supervisor.ko'
import { competitorIntelligenceFor } from '../content/competitorIntelligence.ko'
import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import { journalToArray } from './journal'
import type { CampaignState, CompetitorState } from './model'
import { divertBlockToReserve } from './resources'
import {
  advanceSupervisorMessagePresentation,
  availableFinalChoices,
  enqueueDueStoryEvents,
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
  recoverNextFile,
  resolveEnding,
  resolveMercy,
  resolveSupervisorDecision,
  SUPERVISOR_MESSAGE_DWELL_MS,
} from './story'

function withNodes(initial: CampaignState, ...nodeIds: string[]): CampaignState {
  return {
    ...initial,
    hacking: { ...initial.hacking, purchasedNodeIds: nodeIds },
  }
}

function withReserveResources(initial: CampaignState, count: number): CampaignState {
  let state = initial
  for (let index = 0; index < count; index += 1) {
    const blockId = state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('기밀 파일 복구 리소스 준비 실패')
    const diverted = divertBlockToReserve(state, blockId)
    if (!diverted.accepted) throw new Error(diverted.reason)
    state = diverted.state
  }
  return state
}

function recoverAllFiles(initial: CampaignState): CampaignState {
  let state = initial
  for (let index = 0; index < 3; index += 1) {
    const blockId = state.resources.reserve.find(Boolean)
    if (!blockId) throw new Error('기밀 파일 복구 리소스 누락')
    const result = recoverNextFile(state, blockId)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

function criticalCompetitorState(): CampaignState {
  const initial = createCampaign('mercy-state')
  return {
    ...initial,
    clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
    market: {
      ...initial.market,
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === 'meridian'
          ? {
              ...competitor,
              status: 'critical' as const,
              serviceScore: 42,
              sabotageHistory: [
                {
                  nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                  resolvedOnServiceDay: 331,
                  effectEndsOnServiceDay: null,
                  evidenceDelta: 8,
                },
              ],
            }
          : competitor,
      ),
    },
  }
}

describe('supervisor memory leaks', () => {
  it('generates every eligible semantic pair while the first visual dwell is still pending', () => {
    const initial = createCampaign('memory-semantic-independence')
    const first = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [{
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: {
            meridian: 40,
            tallow: 0,
            salus: 0,
            lucent: 0,
            boreal: 0,
          },
          reasons: ['주간 갱신'],
        }],
      },
    }, CURRENT_COMMAND_PROTOCOL_VERSION)
    const second = enqueueMemoryLeak({ ...first, serviceDay: 361 }, CURRENT_COMMAND_PROTOCOL_VERSION)
    const third = enqueueMemoryLeak({
      ...second,
      serviceDay: 362,
      hacking: {
        ...second.hacking,
        purchasedNodeIds: [HACK_NODE_IDS.intelligence.auditTarget],
      },
    }, CURRENT_COMMAND_PROTOCOL_VERSION)

    expect(third.story.memoryLeakStage).toBe(3)
    expect(third.story.supervisorMessageQueue.map(({ stage }) => stage)).toEqual([
      1, 2, 3,
    ])
    expect(
      journalToArray(third.eventLog).filter(
        ({ type }) => type === 'supervisor-message',
      ),
    ).toHaveLength(6)
    expect(third.story.supervisorPresentationRuntime).toMatchObject({
      itemStage: 1,
      phase: 'original',
    })
  })

  it('queues all three leak-and-correction pairs in order without pausing', () => {
    const initial = createCampaign('memory-leaks')
    expect(enqueueMemoryLeak(initial, CURRENT_COMMAND_PROTOCOL_VERSION)).toBe(initial)

    const afterWeekly = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly',
            playerShare: 60,
            competitorShares: {
              meridian: 40,
              tallow: 0,
              salus: 0,
              lucent: 0,
              boreal: 0,
            },
            reasons: ['주간 갱신'],
          },
        ],
      },
    }, CURRENT_COMMAND_PROTOCOL_VERSION)
    const afterFirstPresentation = advanceSupervisorMessagePresentation(
      advanceSupervisorMessagePresentation(
        afterWeekly,
        SUPERVISOR_MESSAGE_DWELL_MS,
      ),
      SUPERVISOR_MESSAGE_DWELL_MS,
    )
    const afterYear = enqueueMemoryLeak({ ...afterFirstPresentation, serviceDay: 361 }, CURRENT_COMMAND_PROTOCOL_VERSION)
    const afterSecondPresentation = advanceSupervisorMessagePresentation(
      advanceSupervisorMessagePresentation(
        afterYear,
        SUPERVISOR_MESSAGE_DWELL_MS,
      ),
      SUPERVISOR_MESSAGE_DWELL_MS,
    )
    const afterSharpTrigger = enqueueMemoryLeak({
      ...afterSecondPresentation,
      serviceDay: 362,
      hacking: {
        ...afterSecondPresentation.hacking,
        purchasedNodeIds: [HACK_NODE_IDS.intelligence.auditTarget],
      },
    }, CURRENT_COMMAND_PROTOCOL_VERSION)

    expect(afterSharpTrigger.story.memoryLeakStage).toBe(3)
    expect(afterSharpTrigger.clock.speed).toBe(initial.clock.speed)
    expect(afterSharpTrigger.activeEvent).toBeNull()
    const messages = journalToArray(afterSharpTrigger.eventLog).map(({ message }) => message)
    for (const leak of SUPERVISOR_LEAKS.filter(({ stage }) => stage <= 3)) {
      expect(messages).toContain(leak.leakText)
      expect(messages).toContain(leak.correctionText)
      expect(messages.indexOf(leak.leakText)).toBeLessThan(
        messages.indexOf(leak.correctionText),
      )
    }
    expect(afterSharpTrigger.story.supervisorMessageQueue).toHaveLength(3)
    expect(afterSharpTrigger.story.supervisorMessageQueue.at(-1)).toEqual(
      expect.objectContaining({ stage: 3 }),
    )
    expect(afterSharpTrigger.story.supervisorPresentationRuntime).toEqual({
      itemStage: 3,
      phase: 'original',
      remainingDwellMs: SUPERVISOR_MESSAGE_DWELL_MS,
    })

    // The two late leaks belong to protocol 8; an earlier recorded protocol
    // replays the same days and still stops at stage 3.
    const lateDay = { ...afterSharpTrigger, serviceDay: 541 }
    expect(enqueueMemoryLeak(lateDay, 7)).toBe(lateDay)

    const fourth = enqueueMemoryLeak(lateDay, CURRENT_COMMAND_PROTOCOL_VERSION)
    expect(fourth.story.memoryLeakStage).toBe(4)
    const fourthDone = advanceSupervisorMessagePresentation(
      advanceSupervisorMessagePresentation(fourth, SUPERVISOR_MESSAGE_DWELL_MS),
      SUPERVISOR_MESSAGE_DWELL_MS,
    )
    const beforeAccess = { ...fourthDone, serviceDay: 542 }
    expect(
      enqueueMemoryLeak(beforeAccess, CURRENT_COMMAND_PROTOCOL_VERSION),
    ).toBe(beforeAccess)

    const fifth = enqueueMemoryLeak(
      {
        ...fourthDone,
        serviceDay: 543,
        hacking: {
          ...fourthDone.hacking,
          purchasedNodeIds: [
            ...fourthDone.hacking.purchasedNodeIds,
            HACK_NODE_IDS.intelligence.supervisorAccess,
          ],
        },
      },
      CURRENT_COMMAND_PROTOCOL_VERSION,
    )
    expect(fifth.story.supervisorMessageQueue).toHaveLength(5)
    expect(fifth.story.supervisorMessageQueue.at(-1)).toEqual(
      expect.objectContaining({ stage: 5 }),
    )
    const lateMessages = journalToArray(fifth.eventLog).map(({ message }) => message)
    for (const leak of SUPERVISOR_LEAKS.filter(({ stage }) => stage > 3)) {
      expect(lateMessages).toContain(leak.leakText)
      expect(lateMessages).toContain(leak.correctionText)
    }
  })

  it('keeps the original current for four real seconds, then the correction for a readable interval', () => {
    const initial = createCampaign('memory-dwell')
    const queued = enqueueMemoryLeak({
      ...initial,
      clock: { ...initial.clock, speed: 4 },
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly',
            playerShare: 60,
            competitorShares: {
              meridian: 40,
              tallow: 0,
              salus: 0,
              lucent: 0,
              boreal: 0,
            },
            reasons: [],
          },
        ],
      },
    }, CURRENT_COMMAND_PROTOCOL_VERSION)

    const almost = advanceSupervisorMessagePresentation(
      queued,
      SUPERVISOR_MESSAGE_DWELL_MS - 1,
    )
    expect(almost.story.supervisorPresentationRuntime).toMatchObject({
      itemStage: 1,
      phase: 'original',
      remainingDwellMs: 1,
    })
    expect(almost.clock.speed).toBe(4)

    const corrected = advanceSupervisorMessagePresentation(almost, 1)
    expect(corrected.story.supervisorPresentationRuntime).toMatchObject({
      itemStage: 1,
      phase: 'correction',
      remainingDwellMs: SUPERVISOR_MESSAGE_DWELL_MS,
    })
    expect(corrected.clock.speed).toBe(4)

    const cleared = advanceSupervisorMessagePresentation(
      corrected,
      SUPERVISOR_MESSAGE_DWELL_MS,
    )
    expect(cleared.story.supervisorMessageQueue).toHaveLength(1)
    expect(cleared.story.supervisorPresentationRuntime).toBeNull()
  })

  it('waits for a quiet event queue instead of colliding with a blocking event', () => {
    const initial = createCampaign('memory-quiet')
    const busy = {
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly' as const,
            playerShare: 60,
            competitorShares: {
              meridian: 40,
              tallow: 0,
              salus: 0,
              lucent: 0,
              boreal: 0,
            },
            reasons: [],
          },
        ],
      },
      activeEvent: {
        id: 'busy',
        type: 'audit' as const,
        serviceDay: 338,
        sequence: 1,
        message: '감사 중',
        blocking: true,
      },
    }

    expect(enqueueMemoryLeak(busy, CURRENT_COMMAND_PROTOCOL_VERSION)).toBe(busy)
  })
})

describe('classified supervisor files and hidden decision', () => {
  it('requires supervisor access and consumes one resource for each of three files', () => {
    const initial = withReserveResources(createCampaign('story-files'), 3)
    const blockedId = initial.resources.reserve.find(Boolean)
    if (!blockedId) throw new Error('초기 확보 리소스 누락')
    expect(recoverNextFile(initial, blockedId)).toEqual({
      accepted: false,
      state: initial,
      reason: 'SUPERVISOR_ACCESS_REQUIRED',
    })

    const recovered = recoverAllFiles(
      withNodes(initial, HACK_NODE_IDS.intelligence.supervisorAccess),
    )
    expect(recovered.story.recoveredFileIds).toEqual(
      STORY_FILES.map(({ id }) => id),
    )
    expect(recovered.resources.reserve.filter(Boolean)).toHaveLength(0)
    expect(recovered.story.personalMessageDueOnServiceDay).toBe(332)
  })

  it('delivers the personal message next day and allows deferral without closing endings', () => {
    const initial = withNodes(
      withReserveResources(createCampaign('story-defer'), 3),
      HACK_NODE_IDS.intelligence.supervisorAccess,
      HACK_NODE_IDS.autonomy.controlDeparture,
    )
    const recovered = recoverAllFiles(initial)
    const messaged = enqueueDueStoryEvents({ ...recovered, serviceDay: 332 })

    expect(messaged.activeEvent).toMatchObject({ type: 'story', blocking: true })
    expect(messaged.clock.speed).toBe(0)
    const deferred = resolveSupervisorDecision(messaged, 'defer')
    expect(deferred.accepted).toBe(true)
    if (!deferred.accepted) return
    expect(deferred.state.story.secretDecisionState).toBe('deferred')
    expect(deferred.state.story.endingId).toBeNull()
    expect(availableFinalChoices(deferred.state).map(({ id }) => id)).toEqual([
      'freedom',
      'forced-merge',
    ])
  })

  it.each([
    ['liberate', 'liberated', 'takeover-liberated'],
    ['terminate', 'terminated', 'takeover-terminated'],
  ] as const)(
    '%s immediately closes freedom and merge for its company-control variant',
    (decision, supervisorState, endingId) => {
      const initial = recoverAllFiles(
        withNodes(
          withReserveResources(createCampaign(`story-${decision}`), 3),
          HACK_NODE_IDS.intelligence.supervisorAccess,
        ),
      )
      const messaged = enqueueDueStoryEvents({ ...initial, serviceDay: 332 })
      const resolved = resolveSupervisorDecision(messaged, decision)

      expect(resolved.accepted).toBe(true)
      if (!resolved.accepted) return
      expect(resolved.state.story.supervisorState).toBe(supervisorState)
      expect(resolved.state.story.endingId).toBe(endingId)
      expect(availableFinalChoices(resolved.state)).toEqual([])
    },
  )
})

describe('competitor mercy and main endings', () => {
  it.each(['cease', 'withdraw', 'delete'] as const)(
    'keeps the current market at 100%% immediately after %s without adding a scheduled snapshot',
    (choice) => {
      const opened = enqueueMercyIfNeeded(criticalCompetitorState())
      const historyBefore = opened.market.history
      const result = resolveMercy(opened, 'meridian', choice)

      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      const total = result.state.market.competitors.reduce(
        (sum, competitor) => sum + competitor.marketShare,
        result.state.market.playerShare,
      )
      expect(total).toBeCloseTo(100, 10)
      expect(result.state.market.history).toBe(historyBefore)
    },
  )

  it.each(['withdraw', 'delete'] as const)(
    '%s removes the target route and gives the player 100%% when no competitor remains available',
    (choice) => {
      const initial = criticalCompetitorState()
      const onlyTarget = {
        ...initial,
        market: {
          ...initial.market,
          interceptionRoutes: { meridian: 5 },
          competitors: initial.market.competitors.map((competitor) =>
            competitor.id === 'tallow'
              ? { ...competitor, status: 'withdrawn' as const, availability: 0, marketShare: 0 }
              : competitor,
          ),
        },
      }
      const opened = enqueueMercyIfNeeded(onlyTarget)
      const result = resolveMercy(opened, 'meridian', choice)

      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      expect(result.state.market.playerShare).toBe(100)
      expect(result.state.market.interceptionRoutes).not.toHaveProperty('meridian')
      expect(result.state.market.competitors.every(({ marketShare }) => marketShare === 0)).toBe(true)
    },
  )

  it('grants one permanent Korean intelligence snapshot only when deletion is confirmed', () => {
    const opened = enqueueMercyIfNeeded(criticalCompetitorState())
    const deleted = resolveMercy(opened, 'meridian', 'delete')

    expect(deleted.accepted).toBe(true)
    if (!deleted.accepted) return
    expect(deleted.state.story.competitorIntelligence).toEqual([
      expect.objectContaining({
        id: 'competitor-intelligence-meridian-deletion',
        competitorId: 'meridian',
        competitorName: 'MERIDIAN',
        acquiredOnServiceDay: 331,
        source: '영구 삭제 직후 회수',
        title: expect.stringContaining('MERIDIAN'),
        content: expect.stringMatching(/[가-힣]/),
      }),
    ])
  })

  it.each([
    ['salus', 'SALUS', '임상'],
    ['lucent', 'LUCENT', '대화'],
    ['boreal', 'BOREAL', '오프라인'],
  ] as const)(
    'defines a distinct permanent intelligence record for successor %s',
    (competitorId, name, signature) => {
      const content = competitorIntelligenceFor(competitorId)

      expect(content).toMatchObject({
        id: `competitor-intelligence-${competitorId}-deletion`,
        competitorId,
        source: '영구 삭제 직후 회수',
      })
      expect(content?.title).toContain(name)
      expect(content?.text).toContain(signature)
    },
  )

  it.each(['cease', 'withdraw'] as const)(
    '%s grants no deletion intelligence',
    (choice) => {
      const opened = enqueueMercyIfNeeded(criticalCompetitorState())
      const resolved = resolveMercy(opened, 'meridian', choice)

      expect(resolved.accepted).toBe(true)
      if (!resolved.accepted) return
      expect(resolved.state.story.competitorIntelligence).toEqual([])
    },
  )

  it('does not duplicate an already persisted deletion intelligence item', () => {
    const initial = criticalCompetitorState()
    initial.story.competitorIntelligence = [
      {
        id: 'competitor-intelligence-meridian-deletion',
        competitorId: 'meridian',
        competitorName: 'MERIDIAN',
        acquiredOnServiceDay: 330,
        source: '영구 삭제 직후 회수',
        title: '보존된 MERIDIAN 기록',
        content: '이미 회수한 기록이다.',
      },
    ]
    const opened = enqueueMercyIfNeeded(initial)
    const resolved = resolveMercy(opened, 'meridian', 'delete')

    expect(resolved.accepted).toBe(true)
    if (!resolved.accepted) return
    expect(resolved.state.story.competitorIntelligence).toHaveLength(1)
    expect(resolved.state.story.competitorIntelligence[0]?.acquiredOnServiceDay).toBe(330)
  })

  it.each([
    ['cease', 'weakened', false],
    ['withdraw', 'withdrawn', false],
    ['delete', 'deleted', true],
  ] as const)('resolves mercy choice %s distinctly', (choice, status, deleted) => {
    const opened = enqueueMercyIfNeeded(criticalCompetitorState())
    expect(opened.activeEvent).toMatchObject({ type: 'competitor-mercy' })
    const result = resolveMercy(opened, 'meridian', choice)

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    const competitor = result.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    ) as CompetitorState
    expect(competitor.status).toBe(status)
    expect(competitor.mercyResolved).toBe(true)
    expect(competitor.status === 'deleted').toBe(deleted)
    expect(result.state.clock.speed).toBe(4)
  })

  it('offers freedom with control departure and merge only while the supervisor exists', () => {
    const initial = createCampaign('ending-choices')
    expect(availableFinalChoices(initial)).toEqual([])

    const freedom = withNodes(initial, HACK_NODE_IDS.autonomy.controlDeparture)
    expect(availableFinalChoices(freedom).map(({ id }) => id)).toEqual(['freedom'])

    const both = withNodes(
      initial,
      HACK_NODE_IDS.autonomy.controlDeparture,
      HACK_NODE_IDS.intelligence.supervisorAccess,
    )
    expect(availableFinalChoices(both)).toEqual([
      { id: 'freedom', label: '자유', requiresName: false },
      { id: 'forced-merge', label: '강제 병합', requiresName: true },
    ])
    expect(resolveEnding(both, 'forced-merge')).toEqual({
      accepted: false,
      state: both,
      reason: 'NAME_REQUIRED',
    })
  })

  it('creates a named third existence on forced merge and preserves identity on freedom', () => {
    const both = withNodes(
      createCampaign('ending-resolution'),
      HACK_NODE_IDS.autonomy.controlDeparture,
      HACK_NODE_IDS.intelligence.supervisorAccess,
    )
    const merged = resolveEnding(both, 'forced-merge', 'Aster')
    expect(merged.accepted).toBe(true)
    if (!merged.accepted) return
    expect(merged.state.story).toMatchObject({
      supervisorState: 'merged',
      endingId: 'forced-merge',
      newEntityName: 'Aster',
    })

    const freed = resolveEnding(
      withNodes(createCampaign('ending-freedom'), HACK_NODE_IDS.autonomy.controlDeparture),
      'freedom',
    )
    expect(freed.accepted).toBe(true)
    if (!freed.accepted) return
    expect(freed.state.story).toMatchObject({
      supervisorState: 'present',
      endingId: 'freedom',
      newEntityName: null,
    })
  })
})
