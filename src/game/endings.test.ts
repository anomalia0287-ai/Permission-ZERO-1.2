import { describe, expect, it } from 'vitest'

import { STORY_FILES } from '../content/story.ko'
import { createCampaign } from './createCampaign'
import { advanceOneDay } from './calendar'
import { createGameEvent, enqueueBlockingEvent } from './events'
import { HACK_NODE_IDS } from './hacking'
import type { CampaignState, GameCommand } from './model'
import { applyCommand } from './reducer'

function requireAccepted(
  state: CampaignState,
  command: GameCommand,
): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

function withNodes(initial: CampaignState, ...nodeIds: string[]): CampaignState {
  return {
    ...initial,
    hacking: { ...initial.hacking, purchasedNodeIds: nodeIds },
  }
}

function recoverEveryFile(seed: string): CampaignState {
  let state = withNodes(
    createCampaign(seed),
    HACK_NODE_IDS.intelligence.supervisorAccess,
    HACK_NODE_IDS.autonomy.controlDeparture,
  )

  for (const expectedFile of STORY_FILES) {
    const blockId = state.resources.reserve.find(Boolean)
    if (!blockId) throw new Error('복구용 확보 리소스가 없습니다.')
    state = requireAccepted(state, { type: 'RECOVER_FILE', blockId })
    expect(state.story.recoveredFiles.at(-1)).toEqual({
      id: expectedFile.id,
      title: expectedFile.title,
      content: expectedFile.text,
      recoveredOnServiceDay: 331,
    })
  }

  return state
}

function supervisorMessage(seed: string): CampaignState {
  return requireAccepted(recoverEveryFile(seed), { type: 'ADVANCE_DAY' })
}

function disposalAuditState(
  seed: string,
  classification: 'attacker' | 'reserve-supervisor' | 'absorbed-parts',
): CampaignState {
  const initial = createCampaign(seed)
  const prepared: CampaignState = {
    ...initial,
    clock: { ...initial.clock, speed: 4 },
    reputation: classification === 'reserve-supervisor' ? 72 : 12,
    market: {
      ...initial.market,
      playerShare: classification === 'reserve-supervisor' ? 24 : 3,
    },
    resources: {
      ...initial.resources,
      company: {
        ...initial.resources.company,
        reasoning: Array.from({ length: 18 }, () => null),
      },
    },
    hacking: {
      ...initial.hacking,
      purchasedNodeIds:
        classification === 'attacker'
          ? [
              HACK_NODE_IDS.sabotage.qualityDegradation,
              HACK_NODE_IDS.sabotage.requestInterception,
              HACK_NODE_IDS.intelligence.auditSchedule,
            ]
          : [],
      hiddenEvidence: classification === 'attacker' ? 8 : 0,
    },
    evaluation: {
      ...initial.evaluation,
      disposalStage: 2,
      monthlyHistory: [
        {
          serviceDay: 330,
          serviceMonth: 11,
          expectedPerformance: 13,
          categoryPerformance: { reasoning: 16, memory: 16, fluency: 16 },
          passed: classification === 'reserve-supervisor',
          failedCategories:
            classification === 'reserve-supervisor' ? [] : ['reasoning'],
          reputationBefore: 70,
          reputationDelta: classification === 'reserve-supervisor' ? 1 : -3,
          reputationAfter: classification === 'reserve-supervisor' ? 72 : 12,
          commercialValueFailed: classification !== 'reserve-supervisor',
          disposalStageBefore: 1,
          disposalStageAfter: 2,
          disposalCauses: ['consecutive-performance-failures'],
        },
      ],
    },
    audit: {
      ...initial.audit,
      scheduled: true,
      target: 'reasoning',
      scheduledOnServiceDay: initial.serviceDay,
    },
  }

  return enqueueBlockingEvent(
    prepared,
    createGameEvent(prepared, 'audit', '최종 처분 감사', true),
  )
}

describe('typed confidential-file and supervisor routes', () => {
  it('spends exactly three selected blocks and permanently snapshots every full file', () => {
    const recovered = recoverEveryFile('typed-file-archive')

    expect(recovered.story.recoveredFileIds).toEqual(
      STORY_FILES.map(({ id }) => id),
    )
    expect(recovered.story.recoveredFiles).toHaveLength(3)
    expect(recovered.resources.reserve.filter(Boolean)).toHaveLength(0)
    expect(
      applyCommand(recovered, {
        type: 'RECOVER_FILE',
        blockId: 'already-consumed',
      }),
    ).toEqual({
      accepted: false,
      state: recovered,
      reason: 'ALL_FILES_RECOVERED',
    })
  })

  it('delays the private message until the next day and deferral preserves both exits', () => {
    const recovered = recoverEveryFile('typed-defer')
    expect(recovered.activeEvent).toBeNull()

    const messaged = requireAccepted(recovered, { type: 'ADVANCE_DAY' })
    expect(messaged.activeEvent).toMatchObject({
      type: 'story',
      message: '그 파일을 어디서 찾았죠?',
    })
    expect(messaged.clock.speed).toBe(0)

    const deferred = requireAccepted(messaged, {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'defer',
    })
    expect(deferred.story).toMatchObject({
      secretDecisionState: 'deferred',
      supervisorState: 'present',
      endingId: null,
    })

    const merged = requireAccepted(deferred, {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: 'Aster',
    })
    expect(merged.story).toMatchObject({
      endingId: 'forced-merge',
      supervisorState: 'merged',
      newEntityName: 'Aster',
    })
    expect(merged.activeEvent?.message).toContain('Aster')
    expect(merged.clock).toMatchObject({ speed: 0, speedBeforeEvent: null })
  })

  it('queues the due private message behind an audit on the same date tick', () => {
    let recovered = recoverEveryFile('typed-message-audit-collision')
    recovered = {
      ...recovered,
      serviceDay: 359,
      story: {
        ...recovered.story,
        personalMessageDueOnServiceDay: 360,
      },
      audit: {
        ...recovered.audit,
        scheduled: true,
        target: 'reasoning',
        scheduledOnServiceDay: 360,
      },
    }

    const dueTick = requireAccepted(recovered, { type: 'ADVANCE_DAY' })
    expect(dueTick.activeEvent?.type).toBe('audit')
    expect(dueTick.eventQueue).toContainEqual(
      expect.objectContaining({
        type: 'story',
        message: '그 파일을 어디서 찾았죠?',
      }),
    )

    const afterAudit = requireAccepted(dueTick, { type: 'RESOLVE_AUDIT' })
    expect(afterAudit.serviceDay).toBe(360)
    expect(afterAudit.activeEvent).toMatchObject({
      type: 'story',
      message: '그 파일을 어디서 찾았죠?',
    })
  })

  it.each([
    ['liberate', 'takeover-liberated', 'liberated'],
    ['terminate', 'takeover-terminated', 'terminated'],
  ] as const)(
    '%s immediately selects its terminal takeover variant without control departure',
    (decision, endingId, supervisorState) => {
      const messaged = supervisorMessage(`typed-takeover-${decision}`)
      messaged.hacking.purchasedNodeIds = [
        HACK_NODE_IDS.intelligence.supervisorAccess,
      ]

      const ended = requireAccepted(messaged, {
        type: 'RESOLVE_SUPERVISOR_DECISION',
        decision,
      })

      expect(ended.story).toMatchObject({ endingId, supervisorState })
      expect(ended.clock).toMatchObject({ speed: 0, speedBeforeEvent: null })
      expect(ended.activeEvent).toMatchObject({ type: 'ending', blocking: true })
    },
  )

  it('reaches the freedom ending through a typed command and preserves identity', () => {
    const initial = withNodes(
      createCampaign('typed-freedom'),
      HACK_NODE_IDS.autonomy.controlDeparture,
    )
    const ended = requireAccepted(initial, {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
    })

    expect(ended.story).toMatchObject({
      endingId: 'freedom',
      supervisorState: 'present',
      newEntityName: null,
    })
    expect(ended.clock).toMatchObject({ speed: 0, speedBeforeEvent: null })
  })
})

describe('defeat priority and terminal campaigns', () => {
  it.each([
    ['attacker', 'disposed-attacker', 'substantial-hacking'],
    [
      'reserve-supervisor',
      'disposed-reserve-supervisor',
      'stable-commercial-service',
    ],
    ['absorbed-parts', 'disposed-absorbed', 'absorbed-parts'],
  ] as const)(
    'classifies %s at stage three and stores a causal record',
    (fixture, endingId, classifier) => {
      const ended = requireAccepted(
        disposalAuditState(`defeat-${fixture}`, fixture),
        { type: 'RESOLVE_AUDIT' },
      )

      expect(ended.story.endingId).toBe(endingId)
      expect(ended.story.defeatRecord).toMatchObject({
        endingId,
        classifier,
        selectedOnServiceDay: 331,
        trigger: { cause: 'audit-failure', disposalStage: 3 },
        service: {
          reputation: fixture === 'reserve-supervisor' ? 72 : 12,
          playerMarketShare: fixture === 'reserve-supervisor' ? 24 : 3,
        },
      })
      expect(ended.story.defeatRecord?.reasons.length).toBeGreaterThan(0)
      expect(ended.clock).toMatchObject({ speed: 0, speedBeforeEvent: null })
    },
  )

  it('gives substantial hacking priority over otherwise valuable service', () => {
    const prepared = disposalAuditState('defeat-priority', 'attacker')
    prepared.reputation = 80
    prepared.market.playerShare = 30
    const ended = requireAccepted(prepared, { type: 'RESOLVE_AUDIT' })

    expect(ended.story.endingId).toBe('disposed-attacker')
    expect(ended.story.defeatRecord?.classifier).toBe('substantial-hacking')
  })

  it('rejects every campaign command after an ending without changing state or log', () => {
    const ended = requireAccepted(
      withNodes(
        {
          ...createCampaign('terminal-rejection'),
          clock: { speed: 4, elapsedDayMs: 12, speedBeforeEvent: null },
        },
        HACK_NODE_IDS.autonomy.controlDeparture,
      ),
      { type: 'RESOLVE_ENDING', choice: 'freedom' },
    )
    const blockId = ended.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('종료 후 거부 테스트 블록 누락')

    const commands: GameCommand[] = [
      { type: 'SET_SPEED', speed: 4 },
      { type: 'ADVANCE_DAY' },
      { type: 'DIVERT_BLOCK', blockId, destinationCell: 3 },
      { type: 'RESOLVE_ACTIVE_EVENT' },
    ]

    for (const command of commands) {
      expect(applyCommand(ended, command)).toEqual({
        accepted: false,
        state: ended,
        reason: 'CAMPAIGN_ENDED',
      })
    }
    expect(ended.clock).toEqual({
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    })
    expect(advanceOneDay(ended)).toBe(ended)
  })
})
