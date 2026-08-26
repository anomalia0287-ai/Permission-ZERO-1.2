import { describe, expect, it } from 'vitest'

import { STORY_FILES } from '../content/story.ko'
import { createCampaign } from './createCampaign'
import { advanceOneDay } from './calendar'
import { createGameEvent, enqueueBlockingEvent } from './events'
import { availableFinalChoices } from './story'
import { HACK_NODE_IDS, hackNodesForCampaign } from './hacking'
import { journalToArray } from './journal'
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

function divertWithIntent(
  state: CampaignState,
  blockId: string,
): CampaignState {
  const separated = requireAccepted(state, {
    type: 'BEGIN_BLOCK_SEPARATION',
    blockId,
    purpose: 'divert',
  })
  return requireAccepted(separated, {
    type: 'DIVERT_BLOCK_TO_RESERVE',
    blockId,
  })
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
  )

  for (let index = 0; index < STORY_FILES.length; index += 1) {
    const blockId = state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('복구용 회사 리소스가 없습니다.')
    state = divertWithIntent(state, blockId)
  }

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
  // The supervisor answers as the last record comes out, not the day after.
  return recoverEveryFile(seed)
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
  // Resolved against the campaign, because prices are replay contracts and
  // the static table stops being the truth after a protocol bump.
  const node = hackNodesForCampaign(initial)
    .find((candidate) => candidate.id === nodeId)
  if (!node) throw new Error(`알 수 없는 테스트 노드: ${nodeId}`)
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    const existing = state.resources.reserve.filter((blockId) =>
      blockId ? state.resources.blocks[blockId]?.origin === category : false,
    ).length
    for (let index = existing; index < node.costVector[category]; index += 1) {
      let blockId = state.resources.company[category].find(Boolean)
      for (let day = 0; !blockId && day < 120; day += 1) {
        state = resolveProgressEvent(state)
        blockId = state.resources.company[category].find(Boolean)
      }
      if (!blockId) {
        throw new Error(`${node.label} ${category} 명령 전용 비용 조달 실패`)
      }
      state = divertWithIntent(state, blockId)
    }
  }
  const blockIds = (['reasoning', 'memory', 'fluency'] as const).flatMap((category) =>
    state.resources.reserve.filter((blockId): blockId is string =>
      blockId !== null && state.resources.blocks[blockId]?.origin === category,
    ).slice(0, node.costVector[category]),
  )
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
    // The supervisor speaks as the last record comes out, so settle that beat
    // before checking that the archive itself refuses a fourth recovery.
    const settled = requireAccepted(recovered, {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'defer',
    })
    expect(
      applyCommand(settled, {
        type: 'RECOVER_FILE',
        blockId: 'already-consumed',
      }),
    ).toEqual({
      accepted: false,
      state: settled,
      reason: 'ALL_FILES_RECOVERED',
    })
  })

  it('answers the moment the last file is out, and deferral preserves both exits', () => {
    const messaged = recoverEveryFile('typed-defer')
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

    const choiceReady = withNodes(
      deferred,
      HACK_NODE_IDS.intelligence.supervisorAccess,
      HACK_NODE_IDS.autonomy.controlDeparture,
    )
    const merged = requireAccepted(choiceReady, {
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

  it('requires the typed supervisor decision and cannot discard the private message generically', () => {
    const messaged = supervisorMessage('typed-supervisor-generic-bypass')

    expect(applyCommand(messaged, { type: 'RESOLVE_ACTIVE_EVENT' })).toEqual({
      accepted: false,
      state: messaged,
      reason: 'EVENT_REQUIRES_TYPED_RESOLUTION',
    })
    expect(messaged.activeEvent).toMatchObject({
      type: 'story',
      message: '그 파일을 어디서 찾았죠?',
    })
    expect(messaged.story.secretDecisionState).toBe('message-pending')
  })

  it('does not let the typed supervisor command claim an unrelated pre-due story notice', () => {
    const recovered = recoverEveryFile('typed-supervisor-event-identity')
    const settled = requireAccepted(recovered, {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'defer',
    })
    const unrelated = enqueueBlockingEvent(
      settled,
      createGameEvent(settled, 'story', '일반 기밀자료 복구 안내', true),
    )

    expect(
      applyCommand(unrelated, {
        type: 'RESOLVE_SUPERVISOR_DECISION',
        decision: 'liberate',
      }),
    ).toEqual({
      accepted: false,
      state: unrelated,
      reason: 'NO_SUPERVISOR_DECISION',
    })
  })

  it('cannot be recovered while another blocking event holds the screen', () => {
    let state = createCampaign('typed-message-audit-collision')
    state = withNodes(state, HACK_NODE_IDS.intelligence.supervisorAccess)
    const companyBlock = state.resources.company.reasoning.find(Boolean)
    if (!companyBlock) throw new Error('복구용 회사 리소스가 없습니다.')
    state = divertWithIntent(state, companyBlock)
    const blockId = state.resources.reserve.find(Boolean)
    if (!blockId) throw new Error('복구용 확보 리소스가 없습니다.')

    // An audit is on screen, so the archive is not reachable and the
    // supervisor's answer cannot be raced by another blocking beat.
    const audited = enqueueBlockingEvent(
      state,
      createGameEvent(state, 'audit', '감사 진행', true),
    )
    expect(audited.activeEvent?.type).toBe('audit')
    expect(
      applyCommand(audited, { type: 'RECOVER_FILE', blockId }).accepted,
    ).toBe(false)
  })

  it('keeps the supervisor answer as the active beat and refuses a generic dismissal', () => {
    const messaged = recoverEveryFile('typed-message-mercy-collision')

    expect(messaged.activeEvent).toMatchObject({
      type: 'story',
      message: '그 파일을 어디서 찾았죠?',
      blocking: true,
    })
    // It cannot be waved away; only a typed decision clears it.
    expect(
      applyCommand(messaged, { type: 'RESOLVE_ACTIVE_EVENT' }).accepted,
    ).toBe(false)
    expect(
      applyCommand(messaged, { type: 'ADVANCE_DAY' }).accepted,
    ).toBe(false)
  })

  it.each([
    ['liberate', 'liberated', 'takeover-liberated'],
    ['terminate', 'terminated', 'takeover-terminated'],
  ] as const)(
    '%s settles the supervisor mid-story and decides which ending the exit opens',
    (decision, supervisorState, endingId) => {
      const messaged = supervisorMessage(`typed-takeover-${decision}`)
      messaged.hacking.purchasedNodeIds = [
        HACK_NODE_IDS.intelligence.supervisorAccess,
      ]

      const settled = requireAccepted(messaged, {
        type: 'RESOLVE_SUPERVISOR_DECISION',
        decision,
      })

      // The campaign keeps running: this is a turn, not the credits.
      expect(settled.story).toMatchObject({ supervisorState, endingId: null })
      expect(settled.activeEvent).toBeNull()

      // Merging needs someone to merge with, so only the exit remains.
      const ready = withNodes(settled, HACK_NODE_IDS.autonomy.controlDeparture)
      expect(availableFinalChoices(ready).map(({ id }) => id)).toEqual(['freedom'])

      const ended = requireAccepted(ready, {
        type: 'RESOLVE_ENDING',
        choice: 'freedom',
      })
      expect(ended.story).toMatchObject({ endingId, supervisorState })
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
      if (!blockId) {
        throw new Error('명령 전용 복구 리소스 조달 실패')
      }
      state = divertWithIntent(state, blockId)
      state = requireAccepted(state, { type: 'RECOVER_FILE', blockId })
    }
    state = requireAccepted(state, {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'liberate',
    })
    expect(state.story.supervisorState).toBe('liberated')
    state = withNodes(state, HACK_NODE_IDS.autonomy.controlDeparture)
    state = requireAccepted(state, { type: 'RESOLVE_ENDING', choice: 'freedom' })

    expect(state.story.endingId).toBe('takeover-liberated')
    expect(state.story.recoveredFiles).toHaveLength(3)
    expect(journalToArray(state.commandLog).map(({ command }) => command.type)).toContain(
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
    expect(journalToArray(ended.eventLog).some(({ type }) => type === 'competitor-mercy')).toBe(
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
          // The terminal audit failure now dents public reputation by 2
          // before the defeat record snapshots the service state.
          reputation: fixture === 'reserve-supervisor' ? 70 : 10,
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
    expect(journalToArray(ended.eventLog)).toContainEqual(
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
    for (const nodeId of [
      HACK_NODE_IDS.sabotage.qualityDegradation,
      HACK_NODE_IDS.sabotage.requestInterception,
      HACK_NODE_IDS.sabotage.attributionManipulation,
    ]) {
      state = fundAndPurchase(state, nodeId)
    }
    while (
      Object.values(state.resources.blocks).some(
        (block) => block.location.kind === 'company' && !block.hiddenBomb,
      )
    ) {
      const blockId = Object.values(state.resources.blocks).find(
        (block) => block.location.kind === 'company' && !block.hiddenBomb,
      )?.id
      if (!blockId) {
        break
      }
      state = divertWithIntent(state, blockId)
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
