import { describe, expect, it } from 'vitest'

import { enqueueBlockingEvent } from './calendar'
import { recordCausalEvidence, recordCausalIncident } from './causality'
import {
  selectRecoveryContaminationOpportunities,
  type CausalGameplayOperations,
} from './causalGameplay'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  HACK_NODE_IDS,
  purchaseHackNode,
  scheduleSabotage,
  type SabotageCausalOperations,
} from './hacking'
import type { CampaignState } from './model'
import { applyCommand, type ApplyCommandOptions } from './reducer'
import { placeHiddenBomb } from './bombs'
import { JOURNAL_CHUNK_SIZE, journalAt, journalToArray } from './journal'
import { moveDisguiseBlock } from './resources'

function reserveIds(state: CampaignState, count: number): string[] {
  const ids = state.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
  if (ids.length < count) {
    throw new Error(`Expected ${count} reserve resources, found ${ids.length}`)
  }
  return ids.slice(0, count)
}

function dueQualitySabotage(seed: string): CampaignState {
  const initial = createCampaignForProtocol(seed, 3)
  const purchased = purchaseHackNode(
    initial,
    HACK_NODE_IDS.sabotage.qualityDegradation,
    reserveIds(initial, 3),
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

function causalFailureCommandOptions(
  phase: 'sabotage-root' | 'meridian-response',
): ApplyCommandOptions {
  if (phase === 'sabotage-root') {
    const sabotageCausalOperations: SabotageCausalOperations = {
      recordIncident: recordCausalIncident,
      recordEvidence(state) {
        return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
      },
    }
    return {
      protocolVersion: 3,
      dailyCausalOperations: { sabotageCausalOperations },
    }
  }

  const causalGameplayOperations: CausalGameplayOperations = {
    recordIncident: recordCausalIncident,
    recordEvidence(state) {
      return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
    },
  }
  return {
    protocolVersion: 3,
    dailyCausalOperations: { causalGameplayOperations },
  }
}

function activeAudit(
  seed: string,
  target: 'reasoning' | 'memory' | 'fluency' = 'reasoning',
  protocolVersion: 1 | 2 | 3 = 3,
) {
  const initial = createCampaignForProtocol(seed, protocolVersion)
  return enqueueBlockingEvent(
    {
      ...initial,
      clock: { ...initial.clock, speed: 4 },
      audit: {
        ...initial.audit,
        scheduled: true,
        target,
        scheduledOnServiceDay: initial.serviceDay,
      },
    },
    {
      id: `audit-${seed}`,
      type: 'audit',
      serviceDay: initial.serviceDay,
      sequence: initial.eventLog.length,
      message: '감사 진행 중',
      blocking: true,
    },
  )
}

describe('applyCommand', () => {
  it.each([
    'audit',
    'bomb-interrogation',
    'competitor-mercy',
    'ending',
  ] as const)(
    'rejects generic resolution for domain-owned %s events without logging a command',
    (type) => {
      const initial = createCampaign(`typed-event-${type}`)
      const state = enqueueBlockingEvent(
        { ...initial, clock: { ...initial.clock, speed: 4 } },
        {
          id: `domain-${type}`,
          type,
          serviceDay: initial.serviceDay,
          sequence: initial.eventLog.length,
          message: `${type} 전용 해결 대기`,
          blocking: true,
        },
      )

      expect(applyCommand(state, { type: 'RESOLVE_ACTIVE_EVENT' })).toEqual({
        accepted: false,
        state,
        reason: 'EVENT_REQUIRES_TYPED_RESOLUTION',
      })
      expect(state.commandSequence).toBe(0)
      expect(state.commandLog.length).toBe(0)
    },
  )

  it('continues generic informational events in queue order and restores their owned speed', () => {
    const initial = {
      ...createCampaign('generic-event-continuation'),
      clock: { speed: 4 as const, elapsedDayMs: 0, speedBeforeEvent: null },
    }
    const first = enqueueBlockingEvent(initial, {
      id: 'generic-supervisor-message',
      type: 'supervisor-message',
      serviceDay: initial.serviceDay,
      sequence: initial.eventLog.length,
      message: '일반 감독 통신',
      blocking: true,
    })
    const queued = enqueueBlockingEvent(first, {
      id: 'generic-weekly-update',
      type: 'weekly-update',
      serviceDay: initial.serviceDay,
      sequence: first.eventLog.length,
      message: '주간 안내',
      blocking: true,
    })

    const advanced = applyCommand(queued, { type: 'RESOLVE_ACTIVE_EVENT' })
    expect(advanced.accepted).toBe(true)
    if (!advanced.accepted) return
    expect(advanced.state.activeEvent?.id).toBe('generic-weekly-update')
    expect(advanced.state.eventQueue).toEqual([])
    expect(advanced.state.clock).toMatchObject({ speed: 0, speedBeforeEvent: 4 })

    const completed = applyCommand(advanced.state, { type: 'RESOLVE_ACTIVE_EVENT' })
    expect(completed.accepted).toBe(true)
    if (!completed.accepted) return
    expect(completed.state.activeEvent).toBeNull()
    expect(completed.state.clock).toMatchObject({ speed: 4, speedBeforeEvent: null })
  })

  it('keeps accepted-command append work bounded after multiple full chunks', () => {
    let state = createCampaign('bounded-command-log')
    for (let index = 0; index < JOURNAL_CHUNK_SIZE * 3 - 1; index += 1) {
      const result = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!result.accepted) throw new Error(result.reason)
      state = result.state
    }
    const sealedHistory = state.commandLog.head
    const previousTail = state.commandLog.tail

    const result = applyCommand(state, { type: 'SET_SPEED', speed: 4 })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.commandLog.head).toBe(sealedHistory)
    expect(result.state.commandLog.tail).not.toBe(previousTail)
    expect(result.state.commandLog.tail.length).toBeLessThanOrEqual(
      JOURNAL_CHUNK_SIZE,
    )
    expect(journalAt(result.state.commandLog, -1)?.command).toEqual({
      type: 'SET_SPEED',
      speed: 4,
    })
    expect(journalToArray(result.state.commandLog)).toHaveLength(
      JOURNAL_CHUNK_SIZE * 3,
    )
  })

  it('logs an accepted speed command with a monotonic sequence', () => {
    const initial = createCampaign('command-seed')
    const result = applyCommand(initial, { type: 'SET_SPEED', speed: 4 })

    expect(result).toMatchObject({ accepted: true })
    if (!result.accepted) return

    expect(result.state.clock.speed).toBe(4)
    expect(result.state.commandSequence).toBe(1)
    expect(journalToArray(result.state.commandLog)).toEqual([
      {
        sequence: 1,
        serviceDay: 331,
        command: { type: 'SET_SPEED', speed: 4 },
      },
    ])
    expect(initial.clock.speed).toBe(0)
  })

  it('uses the next command timeline version when no override is supplied', () => {
    const state = {
      ...createCampaignForProtocol('timeline-default', 1),
      commandProtocol: {
        segments: [
          { version: 1 as const, startsAtSequence: 1 },
          { version: 3 as const, startsAtSequence: 2 },
        ],
      },
    }
    const blockId = state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('timeline diversion block missing')

    const first = applyCommand(state, {
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell: 3,
    })
    expect(first.accepted).toBe(true)
    if (!first.accepted) return
    expect(journalToArray(first.state.commandLog).map(({ command }) => command.type)).toEqual([
      'DIVERT_BLOCK',
    ])

    const nextBlockId = first.state.resources.company.memory.find(Boolean)
    if (!nextBlockId) throw new Error('timeline v3 block missing')
    expect(
      applyCommand(first.state, {
        type: 'DIVERT_BLOCK',
        blockId: nextBlockId,
        destinationCell: 4,
      }),
    ).toEqual({
      accepted: false,
      state: first.state,
      reason: 'SEPARATION_REQUIRED',
    })
  })

  it('rejects an explicit protocol version that differs from the next timeline segment', () => {
    const initial = createCampaign('protocol-mismatch')

    expect(
      applyCommand(
        initial,
        { type: 'SET_SPEED', speed: 1 },
        { protocolVersion: 2 },
      ),
    ).toEqual({
      accepted: false,
      state: initial,
      reason: 'PROTOCOL_MISMATCH',
    })
    expect(initial.commandSequence).toBe(0)
    expect(initial.commandLog.length).toBe(0)
  })

  it('rejects a mismatched ADVANCE_DAY before invoking a supplied daily causal seam', () => {
    const initial = dueQualitySabotage('protocol-mismatch-daily-causal-seam')
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

    const result = applyCommand(
      initial,
      { type: 'ADVANCE_DAY' },
      {
        protocolVersion: 2,
        dailyCausalOperations: {
          sabotageCausalOperations,
          causalGameplayOperations,
        },
      },
    )

    expect(result).toEqual({
      accepted: false,
      state: initial,
      reason: 'PROTOCOL_MISMATCH',
    })
    expect(result.state).toBe(initial)
    expect(calls).toEqual([])
    expect(initial.serviceDay).toBe(331)
    expect(initial.commandSequence).toBe(0)
    expect(initial.commandLog.length).toBe(0)
  })

  it.each(['sabotage-root', 'meridian-response'] as const)(
    'rejects ADVANCE_DAY atomically when %s rejects its evidence write and a same-state retry reproduces every deterministic result',
    (phase) => {
      const before = dueQualitySabotage(`reducer-whole-day-${phase}`)
      const uninterrupted = applyCommand(before, { type: 'ADVANCE_DAY' })
      expect(uninterrupted.accepted).toBe(true)
      if (!uninterrupted.accepted) return

      const failed = applyCommand(
        before,
        { type: 'ADVANCE_DAY' },
        causalFailureCommandOptions(phase),
      )

      expect(failed).toEqual({
        accepted: false,
        state: before,
        reason: 'CAUSAL_TRANSITION_FAILED',
      })
      expect(failed.state).toBe(before)
      expect(failed.state.serviceDay).toBe(before.serviceDay)
      expect(failed.state.commandSequence).toBe(before.commandSequence)
      expect(failed.state.commandLog).toBe(before.commandLog)
      expect(failed.state.hacking).toBe(before.hacking)
      expect(failed.state.resources).toBe(before.resources)
      expect(failed.state.market).toBe(before.market)
      expect(failed.state.reviews).toBe(before.reviews)
      expect(failed.state.causality).toBe(before.causality)
      expect(failed.state.evaluation).toBe(before.evaluation)
      expect(failed.state.audit).toBe(before.audit)
      expect(failed.state.bombs).toBe(before.bombs)
      expect(failed.state.story).toBe(before.story)
      expect(failed.state.eventLog).toBe(before.eventLog)
      expect(failed.state.eventQueue).toBe(before.eventQueue)
      expect(failed.state.clock).toBe(before.clock)
      expect(
        journalToArray(failed.state.commandLog).filter(
          ({ command }) => command.type === 'ADVANCE_DAY',
        ),
      ).toEqual([])

      const retried = applyCommand(failed.state, { type: 'ADVANCE_DAY' })
      expect(retried.accepted).toBe(true)
      if (!retried.accepted) return
      expect(retried.state).toEqual(uninterrupted.state)
      expect(retried.state.serviceDay).toBe(before.serviceDay + 1)
      const retriedOpportunities =
        selectRecoveryContaminationOpportunities(retried.state)
      const uninterruptedOpportunities =
        selectRecoveryContaminationOpportunities(uninterrupted.state)
      expect(retriedOpportunities).toEqual(uninterruptedOpportunities)
      expect(retriedOpportunities).toHaveLength(1)
      expect(retriedOpportunities[0]?.opensOnServiceDay).toBe(
        before.serviceDay + 1,
      )
      expect(
        journalToArray(retried.state.commandLog).map(
          ({ command }) => command.type,
        ),
      ).toEqual(['ADVANCE_DAY'])
    },
  )

  it.each([2, 3] as const)(
    'requires separation authorization under protocol v%i',
    (version) => {
      const initial = createCampaignForProtocol(
        `separation-required-v${version}`,
        version,
      )
      const blockId = initial.resources.company.reasoning.find(Boolean)
      if (!blockId) throw new Error('separation fixture block missing')

      expect(
        applyCommand(initial, {
          type: 'DIVERT_BLOCK',
          blockId,
          destinationCell: 3,
        }),
      ).toEqual({
        accepted: false,
        state: initial,
        reason: 'SEPARATION_REQUIRED',
      })
    },
  )

  it('rejects separation intent under v1 and performs legacy movement inline', () => {
    const initial = createCampaignForProtocol('legacy-inline-separation', 1)
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('legacy separation fixture block missing')

    expect(
      applyCommand(initial, {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      }),
    ).toEqual({ accepted: false, state: initial, reason: 'INVALID_COMMAND' })

    const moved = applyCommand(initial, {
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell: 3,
    })
    expect(moved.accepted).toBe(true)
    if (!moved.accepted) return
    expect(moved.state.resources.reserve[3]).toBe(blockId)
    expect(journalToArray(moved.state.commandLog).map(({ command }) => command.type)).toEqual([
      'DIVERT_BLOCK',
    ])
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

  it('logs intentional separation without changing resources, performance, or suspicion', () => {
    const initial = createCampaign('command-diversion')
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('명령 전용 블록 누락')
    const result = applyCommand(initial, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources).toEqual(initial.resources)
    expect(result.state.suspicion).toBe(initial.suspicion)
    expect(result.state.reputation).toBe(initial.reputation)
    expect(journalAt(result.state.commandLog, -1)?.command).toEqual({
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
  })

  it('requires separation authorization and records exactly one final movement command', () => {
    const initial = createCampaign('command-authorized-diversion')
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('명령 전용 블록 누락')

    expect(
      applyCommand(initial, {
        type: 'DIVERT_BLOCK_TO_RESERVE',
        blockId,
      }),
    ).toEqual({ accepted: false, state: initial, reason: 'SEPARATION_REQUIRED' })

    const separated = applyCommand(initial, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
    if (!separated.accepted) throw new Error(separated.reason)
    const moved = applyCommand(separated.state, {
      type: 'DIVERT_BLOCK_TO_RESERVE',
      blockId,
    })

    expect(moved.accepted).toBe(true)
    if (!moved.accepted) return
    expect(moved.state.resources.reserve).toEqual([blockId])
    expect(moved.state.resourceIntrusion.successfulCoreDeposits).toBe(1)
    expect(
      journalToArray(moved.state.commandLog).filter(
        ({ command }) => command.type === 'DIVERT_BLOCK_TO_RESERVE',
      ),
    ).toHaveLength(1)
    expect(journalToArray(moved.state.commandLog).map(({ command }) => command.type)).toEqual([
      'BEGIN_BLOCK_SEPARATION',
      'DIVERT_BLOCK_TO_RESERVE',
    ])
  })

  it.each([
    [17.25, 18.25],
    [99.4, 100],
  ])(
    'records a radar head detection as exactly one suspicion point from %s',
    (suspicion, expected) => {
      const initial = {
        ...createCampaign(`radar-detection-${suspicion}`),
        suspicion,
      }
      const result = applyCommand(
        initial,
        { type: 'RECORD_INTRUSION_RADAR_DETECTION' },
      )

      expect(result.accepted).toBe(true)
      if (!result.accepted) return
      expect(result.state.suspicion).toBe(expected)
      expect(result.state.resources).toBe(initial.resources)
      expect(result.state.resourceIntrusion).toBe(initial.resourceIntrusion)
      expect(journalAt(result.state.commandLog, -1)?.command).toEqual({
        type: 'RECORD_INTRUSION_RADAR_DETECTION',
      })
    },
  )

  it('replays a legacy v1 diversion as one historical command without synthetic intent', () => {
    const initial = createCampaignForProtocol('legacy-command-diversion', 1)
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('legacy diversion block missing')

    const moved = applyCommand(
      initial,
      { type: 'DIVERT_BLOCK', blockId, destinationCell: 3 },
      { protocolVersion: 1 },
    )

    expect(moved.accepted).toBe(true)
    if (!moved.accepted) return
    expect(moved.state.resources.reserve[3]).toBe(blockId)
    expect(moved.state.commandSequence).toBe(1)
    expect(journalToArray(moved.state.commandLog).map(({ command }) => command.type)).toEqual([
      'DIVERT_BLOCK',
    ])
  })

  it('replays a legacy v1 audit disguise as one historical command', () => {
    const audit = activeAudit('legacy-command-audit', 'fluency', 1)
    const blockId = audit.resources.company.reasoning.find(Boolean)
    const targetCell = audit.resources.company.fluency.findIndex((id) => id === null)
    if (!blockId || targetCell < 0) throw new Error('legacy audit movement missing')

    const moved = applyCommand(
      audit,
      {
        type: 'MOVE_BLOCK_FOR_AUDIT',
        blockId,
        targetCategory: 'fluency',
        targetCell,
      },
      { protocolVersion: 1 },
    )

    expect(moved.accepted).toBe(true)
    if (!moved.accepted) return
    expect(moved.state.resources.blocks[blockId]).toMatchObject({
      contribution: 'disguised',
      location: { kind: 'company', category: 'fluency', cellIndex: targetCell },
    })
    expect(journalToArray(moved.state.commandLog).map(({ command }) => command.type)).toEqual([
      'MOVE_BLOCK_FOR_AUDIT',
    ])
  })

  it('records threshold separation and immediately activates a bomb before any drop', () => {
    const placement = placeHiddenBomb({
      ...createCampaign('command-bomb'),
      serviceDay: 541,
    })
    if (!placement.placed || !placement.blockId) throw new Error('명령 폭탄 배치 실패')
    const result = applyCommand(placement.state, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: placement.blockId,
      purpose: 'divert',
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.reserve).toEqual([])
    expect(result.state.resources.blocks[placement.blockId]).toMatchObject({
      hiddenBomb: false,
      contribution: 'normal',
      location: placement.state.resources.blocks[placement.blockId].location,
    })
    expect(result.state.suspicion).toBe(15)
    expect(result.state.activeEvent?.type).toBe('bomb-interrogation')
    expect(result.state.commandSequence).toBe(1)
    expect(journalAt(result.state.commandLog, 0)?.command).toEqual({
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: placement.blockId,
      purpose: 'divert',
    })
    expect(
      applyCommand(result.state, {
        type: 'DIVERT_BLOCK_TO_RESERVE',
        blockId: placement.blockId,
      }),
    ).toMatchObject({ accepted: false, reason: 'BLOCKING_EVENT_ACTIVE' })
  })

  it('activates a hidden bomb at the audit-disguise separation boundary', () => {
    const audit = activeAudit('command-audit-bomb')
    const blockId = audit.resources.company.memory.find(Boolean)
    if (!blockId) throw new Error('감사 폭탄 블록 누락')
    const armed = {
      ...audit,
      resources: {
        ...audit.resources,
        blocks: {
          ...audit.resources.blocks,
          [blockId]: { ...audit.resources.blocks[blockId], hiddenBomb: true },
        },
      },
      bombs: {
        ...audit.bombs,
        placements: [
          {
            sequence: 0,
            blockId,
            category: 'memory' as const,
            placedOnServiceDay: 330,
            triggeredOnServiceDay: null,
          },
        ],
      },
    }

    const result = applyCommand(armed, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'audit-disguise',
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.resources.blocks[blockId]).toMatchObject({
      hiddenBomb: false,
      contribution: 'normal',
      location: armed.resources.blocks[blockId].location,
    })
    expect(result.state.suspicion).toBe(15)
    expect(result.state.activeEvent?.type).toBe('bomb-interrogation')
    expect(result.state.eventQueue[0]?.type).toBe('audit')
    expect(result.state.audit.target).toBe('reasoning')
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

  it('permits an audit disguise only into the active audit target while time stays paused', () => {
    const audit = activeAudit('command-audit-disguise')
    const blockId = audit.resources.company.memory[0]
    if (!blockId) throw new Error('감사 위장 블록 누락')
    const targetCell = audit.resources.company.reasoning.findIndex((cell) => cell === null)
    if (targetCell < 0) throw new Error('감사 위장 빈칸 누락')

    const separated = applyCommand(audit, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'audit-disguise',
    })
    if (!separated.accepted) throw new Error(separated.reason)
    const result = applyCommand(separated.state, {
      type: 'MOVE_BLOCK_FOR_AUDIT',
      blockId,
      targetCategory: 'reasoning',
      targetCell,
    })

    expect(result.accepted).toBe(true)
    if (!result.accepted) return
    expect(result.state.clock).toMatchObject({ speed: 0, speedBeforeEvent: 4 })
    expect(result.state.activeEvent?.type).toBe('audit')
    expect(result.state.resources.blocks[blockId]).toMatchObject({
      contribution: 'disguised',
      disguisedFrom: 'memory',
      location: { kind: 'company', category: 'reasoning', cellIndex: targetCell },
    })
    expect(journalAt(result.state.commandLog, -1)?.command).toEqual({
      type: 'MOVE_BLOCK_FOR_AUDIT',
      blockId,
      targetCategory: 'reasoning',
      targetCell,
    })
    expect(journalToArray(result.state.commandLog).map(({ command }) => command.type)).toEqual([
      'BEGIN_BLOCK_SEPARATION',
      'MOVE_BLOCK_FOR_AUDIT',
    ])
  })

  it.each([
    {
      name: 'outside an audit',
      prepare: () => createCampaign('command-no-audit'),
      targetCategory: 'reasoning' as const,
      targetCell: -1,
      reason: 'NO_ACTIVE_AUDIT',
    },
    {
      name: 'into a non-target category',
      prepare: () => activeAudit('command-wrong-audit-target'),
      targetCategory: 'fluency' as const,
      targetCell: -1,
      reason: 'INVALID_AUDIT_TARGET',
    },
    {
      name: 'into an occupied target cell',
      prepare: () => activeAudit('command-occupied-audit-target'),
      targetCategory: 'reasoning' as const,
      targetCell: -1,
      reason: 'TARGET_OCCUPIED',
    },
  ])('rejects an audit disguise $name without mutation', ({
    name,
    prepare,
    targetCategory,
    targetCell,
    reason,
  }) => {
    const state = prepare()
    const blockId = state.resources.company.memory.find(Boolean)
    if (!blockId) throw new Error('감사 위장 거부 블록 누락')
    const resolvedTargetCell = name === 'into an occupied target cell'
      ? state.resources.company.reasoning.findIndex((cell) => cell !== null)
      : targetCell < 0
        ? state.resources.company[targetCategory].findIndex((cell) => cell === null)
        : targetCell
    if (resolvedTargetCell < 0) throw new Error('감사 위장 거부 대상 칸 누락')

    expect(
      applyCommand(state, {
        type: 'MOVE_BLOCK_FOR_AUDIT',
        blockId,
        targetCategory,
        targetCell: resolvedTargetCell,
      }),
    ).toEqual({ accepted: false, state, reason })
  })

  it('rejects audit movement while a bomb interrogation is pending without exposing its block', () => {
    const audit = activeAudit('command-audit-interrogation')
    const blockId = audit.resources.company.memory[0]
    if (!blockId) throw new Error('감사 심문 거부 블록 누락')
    const interrogated = {
      ...audit,
      bombs: {
        ...audit.bombs,
        activeInterrogation: {
          blockId: 'secret-block-id',
          category: 'fluency' as const,
          triggeredOnServiceDay: audit.serviceDay,
        },
      },
    }

    const result = applyCommand(interrogated, {
      type: 'MOVE_BLOCK_FOR_AUDIT',
      blockId,
      targetCategory: 'reasoning',
      targetCell: 16,
    })

    expect(result).toEqual({
      accepted: false,
      state: interrogated,
      reason: 'BOMB_INTERROGATION_ACTIVE',
    })
    if (result.accepted) throw new Error('폭탄 심문 중 감사 이동이 허용됨')
    expect(result.reason).not.toContain('secret-block-id')
  })

  it('rejects a sideways reposition without changing state, sequence, or replay log', () => {
    const initial = createCampaign('command-sideways-reposition')
    const blockId = initial.resources.company.memory.find(Boolean)
    const auditCell = initial.resources.company.reasoning.findIndex((cell) => cell === null)
    const sidewaysCell = initial.resources.company.fluency.findIndex((cell) => cell === null)
    if (!blockId || auditCell < 0 || sidewaysCell < 0) {
      throw new Error('재배치 거부 상태 준비 실패')
    }
    const disguised = moveDisguiseBlock(initial, blockId, 'reasoning', auditCell)
    if (!disguised.accepted) throw new Error(disguised.reason)
    const before = disguised.state

    const result = applyCommand(before, {
      type: 'REPOSITION_BLOCK',
      blockId,
      targetCategory: 'fluency',
      targetCell: sidewaysCell,
    })

    expect(result).toEqual({
      accepted: false,
      state: before,
      reason: 'INVALID_TARGET',
    })
    expect(result.state).toBe(before)
    expect(result.state.commandSequence).toBe(before.commandSequence)
    expect(result.state.commandLog).toBe(before.commandLog)
    expect(journalToArray(result.state.commandLog)).not.toContainEqual(
      expect.objectContaining({
        command: expect.objectContaining({ type: 'REPOSITION_BLOCK' }),
      }),
    )
  })
})
