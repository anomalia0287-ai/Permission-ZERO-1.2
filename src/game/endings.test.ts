import { describe, expect, it } from 'vitest'

import { STORY_FILES } from '../content/story.ko'
import { createCampaign } from './createCampaign'
import { advanceOneDay } from './calendar'
import { createGameEvent, enqueueBlockingEvent } from './events'
import { HACK_NODE_IDS, HACK_NODES } from './hacking'
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

function fundAndPurchase(
  initial: CampaignState,
  nodeId: string,
): CampaignState {
  const node = HACK_NODES.find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`알 수 없는 테스트 노드: ${nodeId}`)
  let state = initial
  while (state.resources.reserve.filter(Boolean).length < node.cost) {
    const blockId = Object.values(state.resources.blocks).find(
      (block) => block.location.kind === 'company' && !block.hiddenBomb,
    )?.id
    const destinationCell = state.resources.reserve.findIndex(
      (candidate) => candidate === null,
    )
    if (!blockId || destinationCell < 0) {
      throw new Error(`${node.label} 명령 전용 비용 조달 실패`)
    }
    state = requireAccepted(state, {
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell,
    })
  }
  const blockIds = state.resources.reserve
    .filter((blockId): blockId is string => blockId !== null)
    .slice(0, node.cost)
  return requireAccepted(state, { type: 'PURCHASE_HACK', nodeId, blockIds })
}

function resolveProgressEvent(state: CampaignState): CampaignState {
  if (!state.activeEvent) return requireAccepted(state, { type: 'ADVANCE_DAY' })
  if (state.activeEvent.type === 'audit') {
    return requireAccepted(state, { type: 'RESOLVE_AUDIT' })
  }
  if (state.activeEvent.type === 'bomb-interrogation') {
    return requireAccepted(state, {
      type: 'RESOLVE_BOMB_INTERROGATION',
      explanationId: 'unknown',
    })
  }
  if (
    state.activeEvent.type === 'competitor-mercy' &&
    state.story.pendingMercyCompetitorId
  ) {
    return requireAccepted(state, {
      type: 'RESOLVE_MERCY',
      competitorId: state.story.pendingMercyCompetitorId,
      choice: 'cease',
    })
  }
  return requireAccepted(state, { type: 'RESOLVE_ACTIVE_EVENT' })
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

  it('queues the due private message behind mercy and prevents ending bypasses', () => {
    const recovered = recoverEveryFile('typed-message-mercy-collision')
    const collision: CampaignState = {
      ...recovered,
      market: {
        ...recovered.market,
        competitors: recovered.market.competitors.map((competitor) =>
          competitor.id === 'meridian'
            ? {
                ...competitor,
                status: 'critical' as const,
                serviceScore: 40,
                sabotageHistory: [
                  {
                    nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                    resolvedOnServiceDay: recovered.serviceDay,
                    effectEndsOnServiceDay: null,
                    evidenceDelta: 8,
                  },
                ],
              }
            : competitor,
        ),
      },
    }

    const dueTick = requireAccepted(collision, { type: 'ADVANCE_DAY' })
    expect(dueTick.activeEvent?.type).toBe('competitor-mercy')
    expect(dueTick.eventQueue).toContainEqual(
      expect.objectContaining({
        type: 'story',
        message: '그 파일을 어디서 찾았죠?',
      }),
    )
    for (const choice of ['freedom', 'forced-merge'] as const) {
      const command: GameCommand =
        choice === 'freedom'
          ? { type: 'RESOLVE_ENDING', choice }
          : { type: 'RESOLVE_ENDING', choice, newEntityName: 'Blocked' }
      expect(applyCommand(dueTick, command)).toEqual({
        accepted: false,
        state: dueTick,
        reason: 'BLOCKING_EVENT_ACTIVE',
      })
    }

    const afterMercy = requireAccepted(dueTick, {
      type: 'RESOLVE_MERCY',
      competitorId: 'meridian',
      choice: 'cease',
    })
    expect(afterMercy.serviceDay).toBe(dueTick.serviceDay)
    expect(afterMercy.activeEvent).toMatchObject({
      type: 'story',
      message: '그 파일을 어디서 찾았죠?',
    })
    expect(afterMercy.eventQueue).toEqual([])
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

  it('purchases supervisor access, recovers three files, and takes over using commands only', () => {
    let state = createCampaign('command-only-takeover')
    for (const nodeId of [
      HACK_NODE_IDS.intelligence.auditSchedule,
      HACK_NODE_IDS.intelligence.investigationBias,
      HACK_NODE_IDS.intelligence.auditTarget,
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ]) {
      state = fundAndPurchase(state, nodeId)
    }
    for (let index = 0; index < 3; index += 1) {
      const blockId = Object.values(state.resources.blocks).find(
        (block) => block.location.kind === 'company' && !block.hiddenBomb,
      )?.id
      const destinationCell = state.resources.reserve.findIndex(
        (candidate) => candidate === null,
      )
      if (!blockId || destinationCell < 0) {
        throw new Error('명령 전용 복구 리소스 조달 실패')
      }
      state = requireAccepted(state, {
        type: 'DIVERT_BLOCK',
        blockId,
        destinationCell,
      })
      state = requireAccepted(state, { type: 'RECOVER_FILE', blockId })
    }
    state = requireAccepted(state, { type: 'ADVANCE_DAY' })
    state = requireAccepted(state, {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'liberate',
    })

    expect(state.story.endingId).toBe('takeover-liberated')
    expect(state.story.recoveredFiles).toHaveLength(3)
    expect(state.commandLog.map(({ command }) => command.type)).toContain(
      'PURCHASE_HACK',
    )
  })

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
  it('supersedes a same-tick mercy event when monthly evaluation becomes terminal', () => {
    const initial = createCampaign('mercy-evaluation-terminal-collision')
    const collision: CampaignState = {
      ...initial,
      serviceDay: 359,
      clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
      resources: {
        ...initial.resources,
        company: {
          ...initial.resources.company,
          reasoning: Array.from({ length: 18 }, () => null),
        },
      },
      evaluation: {
        ...initial.evaluation,
        disposalStage: 2,
        consecutiveFailures: 1,
      },
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((competitor) =>
          competitor.id === 'meridian'
            ? {
                ...competitor,
                status: 'critical' as const,
                serviceScore: 35,
                availability: 0.15,
                sabotageHistory: [
                  {
                    nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                    resolvedOnServiceDay: 359,
                    effectEndsOnServiceDay: null,
                    evidenceDelta: 8,
                  },
                ],
              }
            : competitor,
        ),
      },
    }

    const ended = requireAccepted(collision, { type: 'ADVANCE_DAY' })

    expect(ended.story.endingId).toBe('disposed-attacker')
    expect(ended.activeEvent).toMatchObject({ type: 'ending', blocking: true })
    expect(ended.eventQueue).toEqual([])
    expect(ended.clock).toEqual({
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    })
    expect(ended.eventLog.some(({ type }) => type === 'competitor-mercy')).toBe(
      true,
    )
  })

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

  it('clears queued events when an audit resolution opens an ending', () => {
    const audit = disposalAuditState('terminal-audit-queue', 'attacker')
    const queued = enqueueBlockingEvent(
      audit,
      createGameEvent(audit, 'story', '폐기 뒤에는 열리면 안 되는 통신', true),
    )

    const ended = requireAccepted(queued, { type: 'RESOLVE_AUDIT' })

    expect(ended.activeEvent?.type).toBe('ending')
    expect(ended.eventQueue).toEqual([])
    expect(ended.eventLog).toContainEqual(
      expect.objectContaining({ message: '폐기 뒤에는 열리면 안 되는 통신' }),
    )
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

  it('defensively rejects an unknown supervisor decision', () => {
    const state = supervisorMessage('invalid-supervisor-decision')
    const command = {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'erase',
    } as unknown as GameCommand

    expect(applyCommand(state, command)).toEqual({
      accepted: false,
      state,
      reason: 'INVALID_SUPERVISOR_DECISION',
    })
  })

  it('reaches a classified defeat through resource and time commands only', () => {
    let state = createCampaign('command-only-natural-defeat')
    for (let index = 0; index < 15; index += 1) {
      const blockId = state.resources.company.reasoning.find(Boolean)
      const destinationCell = state.resources.reserve.findIndex(
        (candidate) => candidate === null,
      )
      if (!blockId || destinationCell < 0) {
        throw new Error('자연 패배용 성능 분리 실패')
      }
      state = requireAccepted(state, {
        type: 'DIVERT_BLOCK',
        blockId,
        destinationCell,
      })
    }

    for (let step = 0; step < 500 && state.story.endingId === null; step += 1) {
      state = resolveProgressEvent(state)
    }

    expect(state.story.endingId).toMatch(/^disposed-/)
    expect(state.story.defeatRecord).not.toBeNull()
    expect(state.evaluation.disposalStage).toBe(3)
    expect(state.clock.speed).toBe(0)
  })
})
