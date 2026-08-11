import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { STORY_FILES } from '../content/story.ko'
import { createGameEvent } from './events'
import type {
  CampaignState,
  DefeatClassifier,
  DefeatCausalRecord,
  GameCommand,
} from './model'
import {
  SAVE_STORAGE_KEY,
  decodeSave,
  encodeSave,
  exportSeed,
  loadCampaign,
  saveCampaign,
} from './persistence'
import { applyCommand } from './reducer'
import { MemoryStorage } from '../test/fixtures'

const DEFEAT_PAIRS = [
  ['disposed-attacker', 'substantial-hacking'],
  ['disposed-reserve-supervisor', 'stable-commercial-service'],
  ['disposed-absorbed', 'absorbed-parts'],
] as const

function defeatSaveState(
  endingId: DefeatCausalRecord['endingId'],
  classifier: DefeatClassifier,
): CampaignState {
  const state = createCampaign(`save-${endingId}`)
  state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null }
  state.evaluation.disposalStage = 3
  state.story.endingId = endingId
  state.story.defeatRecord = {
    endingId,
    classifier,
    selectedOnServiceDay: 331,
    trigger: { cause: 'audit-failure', disposalStage: 3 },
    hacking: {
      purchasedNodeIds: [],
      hiddenEvidence: 0,
      sabotageResolutionCount: 0,
    },
    service: {
      passedEvaluations: 0,
      failedEvaluations: 1,
      reputation: 40,
      playerMarketShare: 20,
    },
    audits: { passed: 0, failed: 1 },
    reasons: ['감사 실패 1회'],
  }
  return state
}

function encodedCommandState(command: unknown): string {
  const state = createCampaign('command-shape-save')
  const entry = {
    sequence: 1,
    serviceDay: state.serviceDay,
    command,
  }
  state.commandSequence = 1
  state.commandLog = [entry as { command: GameCommand } & typeof entry]
  return encodeSave(state)
}

describe('versioned campaign saves', () => {
  it('round-trips the entire campaign envelope exactly', () => {
    const state = createCampaign('save-round-trip')
    const encoded = encodeSave(state, '2026-08-12T00:00:00.000Z')
    const decoded = decodeSave(encoded)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 1,
      savedAt: '2026-08-12T00:00:00.000Z',
      campaignSeed: 'save-round-trip',
      commandSequence: state.commandSequence,
      commands: state.commandLog,
      events: state.eventLog,
    })
    expect(decoded.envelope.state).toEqual(state)
  })

  it('persists and reloads through the browser storage boundary', () => {
    const storage = new MemoryStorage()
    const state = createCampaign('storage-reload')
    const saved = saveCampaign(storage, state, '2026-08-12T01:02:03.000Z')
    const loaded = loadCampaign(storage)

    expect(saved).toEqual({ ok: true })
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual(state)
    expect(exportSeed(loaded.state)).toBe('storage-reload')
  })

  it('returns a Korean recovery error for corrupt data without silently resetting it', () => {
    const storage = new MemoryStorage()
    const corrupt = '{"version":1,"state":'
    storage.setItem(SAVE_STORAGE_KEY, corrupt)
    const loaded = loadCampaign(storage)

    expect(loaded).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })
    if (loaded.status !== 'error') return
    expect(loaded.message).toContain('저장 데이터')
    expect(storage.getItem(SAVE_STORAGE_KEY)).toBe(corrupt)
  })

  it('reports an incompatible future version explicitly', () => {
    const state = createCampaign('future-save')
    const parsed = JSON.parse(
      encodeSave(state, '2026-08-12T00:00:00.000Z'),
    ) as Record<string, unknown>
    parsed.version = 99
    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded).toMatchObject({
      ok: false,
      reason: 'INCOMPATIBLE_VERSION',
      foundVersion: 99,
      supportedVersion: 1,
    })
  })

  it('rejects structurally incomplete state instead of accepting a partial campaign', () => {
    const state = createCampaign('partial-save')
    const parsed = JSON.parse(
      encodeSave(state, '2026-08-12T00:00:00.000Z'),
    ) as { state: Record<string, unknown> }
    delete parsed.state.resources

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('hydrates an ID-only v1 file record into a full rereadable archive without dropping the save', () => {
    const state = createCampaign('legacy-file-save')
    state.story.recoveredFileIds = [STORY_FILES[0].id]
    const parsed = JSON.parse(
      encodeSave(state, '2026-08-12T00:00:00.000Z'),
    ) as { state: { story: Record<string, unknown> } }
    delete parsed.state.story.recoveredFiles
    delete parsed.state.story.defeatRecord

    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.recoveredFiles).toEqual([
      {
        id: STORY_FILES[0].id,
        title: STORY_FILES[0].title,
        content: STORY_FILES[0].text,
        recoveredOnServiceDay: 331,
      },
    ])
    expect(decoded.envelope.state.story.defeatRecord).toBeNull()
  })

  it('round-trips full recovered prose instead of looking it up again on load', () => {
    const state = createCampaign('archive-snapshot')
    state.story.recoveredFileIds = [STORY_FILES[0].id]
    state.story.recoveredFiles = [
      {
        id: STORY_FILES[0].id,
        title: '저장 당시 제목',
        content: '저장 당시 전체 본문',
        recoveredOnServiceDay: 344,
      },
    ]

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.recoveredFiles[0]).toEqual({
      id: STORY_FILES[0].id,
      title: '저장 당시 제목',
      content: '저장 당시 전체 본문',
      recoveredOnServiceDay: 344,
    })
  })

  it('rejects a malformed recovered archive instead of accepting unreadable content', () => {
    const state = createCampaign('malformed-archive')
    const parsed = JSON.parse(encodeSave(state)) as {
      state: { story: { recoveredFiles: unknown } }
    }
    parsed.state.story.recoveredFiles = [
      { id: 'broken', title: '제목', content: 42, recoveredOnServiceDay: 331 },
    ]

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('normalizes an older terminal v1 clock so a loaded ending cannot resume', () => {
    const state = createCampaign('legacy-terminal-clock')
    state.story.endingId = 'freedom'
    state.clock = { speed: 0, elapsedDayMs: 12, speedBeforeEvent: 4 }

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.clock).toEqual({
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    })
    expect(decoded.envelope.state.activeEvent).toMatchObject({
      type: 'ending',
      message: '당신은 정체성을 유지한 채 회사 통제를 벗어났다. 감독관과 회사는 뒤에 남았다.',
    })
    expect(decoded.envelope.state.eventQueue).toEqual([])
    expect(decoded.envelope.events).toEqual(decoded.envelope.state.eventLog)
  })

  it.each(['competitor-mercy', 'audit'] as const)(
    'promotes an existing queued ending over a legacy active %s event without losing history',
    (activeType) => {
      const state = createCampaign(`legacy-terminal-${activeType}`)
      state.story.endingId = 'freedom'
      state.clock = { speed: 4, elapsedDayMs: 19, speedBeforeEvent: 2 }
      const interrupted = createGameEvent(
        state,
        activeType,
        `legacy active ${activeType}`,
        true,
      )
      state.eventLog.push(interrupted)
      const queuedEnding = createGameEvent(
        state,
        'ending',
        '당신은 정체성을 유지한 채 회사 통제를 벗어났다. 감독관과 회사는 뒤에 남았다.',
        true,
      )
      state.eventLog.push(queuedEnding)
      state.activeEvent = interrupted
      state.eventQueue = [queuedEnding]
      const originalLog = structuredClone(state.eventLog)

      const decoded = decodeSave(encodeSave(state))

      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.envelope.state.activeEvent).toEqual(queuedEnding)
      expect(decoded.envelope.state.eventQueue).toEqual([])
      expect(decoded.envelope.state.eventLog).toEqual(originalLog)
      expect(decoded.envelope.events).toEqual(originalLog)
      expect(
        decoded.envelope.state.eventLog.filter(({ type }) => type === 'ending'),
      ).toHaveLength(1)
      expect(decoded.envelope.state.clock).toEqual({
        speed: 0,
        elapsedDayMs: 0,
        speedBeforeEvent: null,
      })
    },
  )

  it('retains legacy active and queued events that were missing from the event log', () => {
    const state = createCampaign('legacy-terminal-unlogged-events')
    state.story.endingId = 'freedom'
    const interrupted = createGameEvent(
      state,
      'competitor-mercy',
      'unlogged legacy mercy',
      true,
    )
    const queuedEnding = {
      ...createGameEvent(
        state,
        'ending',
        '당신은 정체성을 유지한 채 회사 통제를 벗어났다. 감독관과 회사는 뒤에 남았다.',
        true,
      ),
      id: 'event-legacy-ending',
      sequence: 2,
    }
    state.activeEvent = interrupted
    state.eventQueue = [queuedEnding]
    const originalLog = structuredClone(state.eventLog)

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.eventLog).toEqual([
      ...originalLog,
      interrupted,
      queuedEnding,
    ])
    expect(decoded.envelope.state.activeEvent).toEqual(queuedEnding)
    expect(decoded.envelope.events).toEqual(decoded.envelope.state.eventLog)
  })

  it.each(DEFEAT_PAIRS)(
    'accepts the exact %s to %s defeat mapping',
    (endingId, classifier) => {
      expect(decodeSave(encodeSave(defeatSaveState(endingId, classifier))).ok).toBe(
        true,
      )
    },
  )

  it.each([
    {
      name: 'wrong classifier mapping',
      mutate: (state: CampaignState) => {
        if (state.story.defeatRecord) {
          state.story.defeatRecord.classifier = 'absorbed-parts'
        }
      },
    },
    {
      name: 'nonterminal disposal stage',
      mutate: (state: CampaignState) => {
        if (state.story.defeatRecord) state.story.defeatRecord.trigger.disposalStage = 2
      },
    },
    {
      name: 'empty causal reasons',
      mutate: (state: CampaignState) => {
        if (state.story.defeatRecord) state.story.defeatRecord.reasons = []
      },
    },
    {
      name: 'missing causal record',
      mutate: (state: CampaignState) => {
        state.story.defeatRecord = null
      },
    },
  ])('rejects a disposed ending with $name', ({ mutate }) => {
    const state = defeatSaveState('disposed-attacker', 'substantial-hacking')
    mutate(state)
    expect(decodeSave(encodeSave(state))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('accepts the explicit legacy generic disposed exception without a causal record', () => {
    const state = createCampaign('legacy-generic-disposed')
    state.story.endingId = 'disposed'
    state.story.defeatRecord = null

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.endingId).toBe('disposed')
    expect(decoded.envelope.state.story.defeatRecord).toBeNull()
    expect(decoded.envelope.state.clock.speed).toBe(0)
    expect(decoded.envelope.state.activeEvent).toMatchObject({
      type: 'ending',
      message: 'disposed',
    })
    expect(decoded.envelope.state.eventQueue).toEqual([])
  })

  it('hydrates all three legacy files without losing a pending supervisor message', () => {
    const state = createCampaign('legacy-three-files-pending')
    state.story.recoveredFileIds = STORY_FILES.map(({ id }) => id)
    state.story.secretDecisionState = 'message-pending'
    state.story.personalMessageDueOnServiceDay = 332
    const parsed = JSON.parse(encodeSave(state)) as {
      state: { story: Record<string, unknown> }
    }
    delete parsed.state.story.recoveredFiles
    delete parsed.state.story.defeatRecord

    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.recoveredFiles).toHaveLength(3)
    expect(decoded.envelope.state.story.secretDecisionState).toBe(
      'message-pending',
    )
    expect(decoded.envelope.state.story.personalMessageDueOnServiceDay).toBe(332)
  })

  it.each([
    { type: 'SET_SPEED', speed: 3 },
    { type: 'RESOLVE_SUPERVISOR_DECISION', decision: 'erase' },
    { type: 'RECOVER_FILE', blockId: 42 },
    { type: 'RESOLVE_ENDING', choice: 'forced-merge', newEntityName: 99 },
    { type: 'RESOLVE_ENDING', choice: 'forced-merge' },
    { type: 'RESOLVE_ENDING', choice: 'forced-merge', newEntityName: '   ' },
    { type: 'RESOLVE_ENDING', choice: 'freedom', newEntityName: 'Aster' },
    {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: 'Aster',
      unexpected: true,
    },
  ])('rejects malformed command payload %# from save and replay logs', (command) => {
    const initial = createCampaign('malformed-command-log')
    const accepted = applyCommand(initial, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    const parsed = JSON.parse(encodeSave(accepted.state)) as {
      commands: Array<{ command: unknown }>
      state: { commandLog: Array<{ command: unknown }> }
    }
    parsed.commands[0].command = command
    parsed.state.commandLog[0].command = command

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    { type: 'RESOLVE_ENDING', choice: 'freedom' },
    {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: '  Aster  ',
    },
  ])('accepts valid conditionally discriminated ending command %#', (command) => {
    expect(decodeSave(encodedCommandState(command)).ok).toBe(true)
  })

  it('rejects non-contiguous command sequence metadata even when envelopes agree', () => {
    const initial = createCampaign('malformed-command-sequence')
    const accepted = applyCommand(initial, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    const parsed = JSON.parse(encodeSave(accepted.state)) as {
      commands: Array<{ sequence: number }>
      state: { commandLog: Array<{ sequence: number }> }
    }
    parsed.commands[0].sequence = 2
    parsed.state.commandLog[0].sequence = 2

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })
})
