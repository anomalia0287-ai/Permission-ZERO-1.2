import { describe, expect, it } from 'vitest'

import { enqueueBlockingEvent } from './calendar'
import { createCampaign } from './createCampaign'
import { applyCommand } from './reducer'
import { placeHiddenBomb } from './bombs'
import { moveDisguiseBlock } from './resources'

function activeAudit(
  seed: string,
  target: 'reasoning' | 'memory' | 'fluency' = 'reasoning',
) {
  const initial = createCampaign(seed)
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

  it('permits an audit disguise only into the active audit target while time stays paused', () => {
    const audit = activeAudit('command-audit-disguise')
    const blockId = audit.resources.company.memory[0]
    if (!blockId) throw new Error('감사 위장 블록 누락')
    const targetCell = audit.resources.company.reasoning.findIndex((cell) => cell === null)
    if (targetCell < 0) throw new Error('감사 위장 빈칸 누락')

    const result = applyCommand(audit, {
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
    expect(result.state.commandLog.at(-1)?.command).toEqual({
      type: 'MOVE_BLOCK_FOR_AUDIT',
      blockId,
      targetCategory: 'reasoning',
      targetCell,
    })
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
    expect(result.state.commandLog).not.toContainEqual(
      expect.objectContaining({
        command: expect.objectContaining({ type: 'REPOSITION_BLOCK' }),
      }),
    )
  })
})
