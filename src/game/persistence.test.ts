import { describe, expect, it, vi } from 'vitest'

import { createCampaign } from './createCampaign'
import { STORY_FILES } from '../content/story.ko'
import { createGameEvent, enqueueBlockingEvent } from './events'
import { serviceMonthForDay } from './evaluation'
import { placeHiddenBomb, resolveBombInterrogation, tryBeginSeparation } from './bombs'
import { HACK_NODE_IDS } from './hacking'
import { appendJournal, createJournal, journalToArray } from './journal'
import type {
  CampaignState,
  CommandLogEntry,
  DefeatClassifier,
  DefeatCausalRecord,
  GameCommand,
  GameEvent,
} from './model'
import {
  PROGRESS_FILE_MAX_BYTES,
  PROGRESS_EXPORT_MAX_ENCODED_LENGTH,
  SAVE_STORAGE_KEY,
  decodeProgressExport,
  decodeProgressFile,
  decodeSave,
  encodeProgressExport,
  encodeProgressFile,
  encodeSave,
  exportSeed,
  loadCampaign,
  replayCommands,
  saveCampaign,
} from './persistence'
import { applyCommand } from './reducer'
import {
  advanceSupervisorMessagePresentation,
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
  resolveMercy,
  SUPERVISOR_MESSAGE_DWELL_MS,
} from './story'
import { MemoryStorage } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import * as persistenceApi from './persistence'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)

function testContentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function refreshV3Integrity(raw: unknown): void {
  const value = raw as {
    state: unknown
    journals: {
      commands: { chunks: unknown[][] }
      events: { chunks: unknown[][] }
    }
    integrity: {
      checkpointHash: string
      commandChunkHashes: string[]
      eventChunkHashes: string[]
    }
  }
  value.integrity = {
    checkpointHash: testContentHash(JSON.stringify(value.state)),
    commandChunkHashes: value.journals.commands.chunks.map((chunk) =>
      testContentHash(JSON.stringify(chunk)),
    ),
    eventChunkHashes: value.journals.events.chunks.map((chunk) =>
      testContentHash(JSON.stringify(chunk)),
    ),
  }
}

type RawPath = readonly (string | number)[]

function setRawPath(root: unknown, path: RawPath, value: unknown): void {
  let cursor = root
  for (const key of path.slice(0, -1)) {
    if ((typeof cursor !== 'object' || cursor === null) || !(key in cursor)) {
      throw new Error(`missing mutation path: ${path.join('.')}`)
    }
    cursor = (cursor as Record<string | number, unknown>)[key]
  }
  const finalKey = path.at(-1)
  if (finalKey === undefined || typeof cursor !== 'object' || cursor === null) {
    throw new Error(`invalid mutation path: ${path.join('.')}`)
  }
  ;(cursor as Record<string | number, unknown>)[finalKey] = value
}

const DEFEAT_PAIRS = [
  ['disposed-attacker', 'substantial-hacking'],
  ['disposed-reserve-supervisor', 'stable-commercial-service'],
  ['disposed-absorbed', 'absorbed-parts'],
] as const

interface MutableCampaignShape {
  clock: Record<string, unknown>
  evaluation: {
    lastCategoryPerformance: Partial<Record<'reasoning' | 'memory' | 'fluency', unknown>>
  }
  hacking: { sabotageCharges: unknown }
  bombs: { explanationUseCounts: Record<string, unknown> }
  resources: {
    blocks: Record<string, { location: unknown }>
  }
}

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
  state.commandLog = createJournal([
    entry as { command: GameCommand } & typeof entry,
  ])
  return encodeSave(state)
}

function encodedLegacyV1State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    savedAt: string
    campaignSeed: string
    commandSequence: number
    state: Record<string, unknown> & { saveVersion: number; legacyCommandCount?: number }
    journals: {
      commands: { chunks: CommandLogEntry[][] }
      events: { chunks: GameEvent[][] }
    }
  }
  const commands = parsed.journals.commands.chunks.flat()
  const events = parsed.journals.events.chunks.flat()
  const legacyState = {
    ...parsed.state,
    saveVersion: 1,
    commandLog: commands,
    eventLog: events,
  }
  delete legacyState.legacyCommandCount
  return JSON.stringify({
    version: 1,
    savedAt: parsed.savedAt,
    campaignSeed: parsed.campaignSeed,
    state: legacyState,
    commandSequence: parsed.commandSequence,
    commands,
    events,
  })
}

function encodedLegacyV3State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as { version: number }
  parsed.version = 3
  refreshV3Integrity(parsed)
  return JSON.stringify(parsed)
}

function largeAppendOnlyCommandCampaign(): CampaignState {
  const state = createCampaign('large-progress-export')
  state.commandLog = createJournal(Array.from({ length: 20_000 }, (_, index) => ({
    sequence: index + 1,
    serviceDay: state.serviceDay,
    command: {
      type: 'SET_SPEED' as const,
      speed: index % 2 === 0 ? 1 as const : 0 as const,
    },
  })))
  state.commandSequence = state.commandLog.length
  state.clock.speed = 0
  return state
}

function activeBombInterrogationState(seed: string): CampaignState {
  const placement = placeHiddenBomb(createCampaign(seed))
  if (!placement.placed || !placement.blockId) {
    throw new Error('bomb relation fixture missing')
  }
  const triggered = tryBeginSeparation(placement.state, {
    kind: 'divert',
    blockId: placement.blockId,
  })
  if (triggered.accepted) throw new Error('bomb relation fixture did not trigger')
  return triggered.state
}

function pendingMercyState(seed: string, queued = false): CampaignState {
  let state = createCampaign(seed)
  const target = state.market.competitors[0]
  state.market.competitors[0] = {
    ...target,
    status: 'critical',
    mercyResolved: false,
    sabotageHistory: [
      {
        nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
        resolvedOnServiceDay: state.serviceDay,
        effectEndsOnServiceDay: null,
        evidenceDelta: 1,
      },
    ],
  }
  if (queued) {
    state = enqueueBlockingEvent(
      state,
      createGameEvent(state, 'story', '먼저 처리할 차단 통신', true),
    )
  }
  return enqueueMercyIfNeeded(state)
}

function deletedCompetitorState(seed: string): CampaignState {
  const result = resolveMercy(pendingMercyState(seed), 'meridian', 'delete')
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

describe('versioned campaign saves', () => {
  it.each([
    ['unknown top-level state key', ['state', 'unexpected'], true],
    ['negative service day', ['state', 'serviceDay'], -1],
    ['unknown clock key', ['state', 'clock', 'unexpected'], true],
    ['negative elapsed day', ['state', 'clock', 'elapsedDayMs'], -1],
    ['elapsed day at full duration', ['state', 'clock', 'elapsedDayMs'], 24_000],
    ['unknown resource key', ['state', 'resources', 'unexpected'], true],
    ['negative block sequence', ['state', 'resources', 'nextBlockSequence'], -1],
    ['unknown evaluation key', ['state', 'evaluation', 'unexpected'], true],
    ['malformed monthly evaluation', ['state', 'evaluation', 'monthlyHistory'], [{}]],
    ['malformed disposal history', ['state', 'evaluation', 'disposalHistory'], [{}]],
    ['unknown market key', ['state', 'market', 'unexpected'], true],
    ['negative player share', ['state', 'market', 'playerShare'], -1],
    ['invalid competitor score', ['state', 'market', 'competitors', 0, 'serviceScore'], 101],
    ['malformed competitor sabotage history', ['state', 'market', 'competitors', 0, 'sabotageHistory'], [{}]],
    ['malformed market snapshot', ['state', 'market', 'history'], [{}]],
    ['unknown review key', ['state', 'reviews', 'unexpected'], true],
    ['invalid review id', ['state', 'reviews', 'feed', 0, 'id'], ''],
    ['unknown hacking key', ['state', 'hacking', 'unexpected'], true],
    ['unknown purchased node id', ['state', 'hacking', 'purchasedNodeIds'], ['not-a-node']],
    ['malformed scheduled sabotage', ['state', 'hacking', 'scheduledSabotage'], [{}]],
    ['negative sabotage sequence', ['state', 'hacking', 'nextSabotageSequence'], -1],
    ['unknown audit key', ['state', 'audit', 'unexpected'], true],
    ['audit probability over one', ['state', 'audit', 'probability'], 1.1],
    ['malformed audit history', ['state', 'audit', 'history'], [{}]],
    ['unknown bombs key', ['state', 'bombs', 'unexpected'], true],
    ['malformed bomb placement', ['state', 'bombs', 'placements'], [{}]],
    ['negative bomb sequence', ['state', 'bombs', 'nextPlacementSequence'], -1],
    ['malformed bomb history', ['state', 'bombs', 'interrogationHistory'], [{}]],
    ['unknown story key', ['state', 'story', 'unexpected'], true],
    ['unknown pending mercy target', ['state', 'story', 'pendingMercyCompetitorId'], 'unknown'],
    ['unknown event queue entry', ['state', 'eventQueue'], [{
      id: 'unlogged-event',
      type: 'audit',
      serviceDay: 331,
      sequence: 1,
      message: 'unlogged',
      blocking: true,
    }]],
  ] as const)('rejects persisted mutation: %s', (_name, path, value) => {
    const raw = JSON.parse(encodeSave(createCampaign('validation-mutation-table')))
    setRawPath(raw, path, value)
    refreshV3Integrity(raw)

    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    {
      name: 'negative resource recovery day',
      state: () => {
        const state = createCampaign('negative-resource-recovery')
        state.resources.blocks['reasoning-00'].recoverOnServiceDay = -1
        return state
      },
    },
    {
      name: 'future review history entry',
      state: () => {
        const state = createCampaign('future-review-history')
        state.reviews.feed[0].serviceDay = state.serviceDay + 1
        return state
      },
    },
    {
      name: 'bomb next sequence without a placement',
      state: () => {
        const state = createCampaign('bomb-sequence-gap')
        state.bombs.nextPlacementSequence = 2
        return state
      },
    },
    {
      name: 'sabotage charge for an unpurchased node',
      state: () => {
        const state = createCampaign('unowned-sabotage-charge')
        const blockId = state.resources.reserve[0]
        if (!blockId) throw new Error('charge fixture missing')
        const nodeId = 'sabotage.quality-degradation'
        state.resources.reserve[0] = null
        state.resources.blocks[blockId].location = { kind: 'hack-charge', nodeId }
        state.hacking.sabotageCharges[nodeId] = {
          nodeId,
          blockId,
          originalReserveCell: 0,
        }
        return state
      },
    },
    {
      name: 'negative terminal causal counter',
      state: () => {
        const state = defeatSaveState('disposed-attacker', 'substantial-hacking')
        if (!state.story.defeatRecord) throw new Error('defeat fixture missing')
        state.story.defeatRecord.service.passedEvaluations = -1
        return state
      },
    },
    {
      name: 'unknown key in a recovered file snapshot',
      state: () => {
        const state = createCampaign('recovered-file-extra-key')
        const file = STORY_FILES[0]
        state.story.recoveredFileIds = [file.id]
        state.story.recoveredFiles = [{
          id: file.id,
          title: file.title,
          content: file.text,
          recoveredOnServiceDay: state.serviceDay,
          extra: true,
        } as never]
        return state
      },
    },
  ])('rejects exhaustive cross-field mutation: $name', ({ state }) => {
    expect(decodeSave(encodeSave(state()))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    {
      name: 'an untriggered placement whose block is not armed',
      state: () => {
        const placement = placeHiddenBomb(createCampaign('bomb-unarmed-placement'))
        if (!placement.placed || !placement.blockId) throw new Error('bomb fixture missing')
        placement.state.resources.blocks[placement.blockId].hiddenBomb = false
        return placement.state
      },
    },
    {
      name: 'an armed block without an untriggered placement',
      state: () => {
        const placement = placeHiddenBomb(createCampaign('bomb-orphan-arm'))
        if (!placement.placed) throw new Error('bomb fixture missing')
        placement.state.bombs.placements = []
        placement.state.bombs.nextPlacementSequence = 1
        return placement.state
      },
    },
    {
      name: 'an armed placement whose block was already consumed',
      state: () => {
        const placement = placeHiddenBomb(createCampaign('bomb-consumed-arm'))
        if (!placement.placed || !placement.blockId || !placement.category) {
          throw new Error('bomb fixture missing')
        }
        const block = placement.state.resources.blocks[placement.blockId]
        if (block.location.kind !== 'company') throw new Error('bomb block moved unexpectedly')
        placement.state.resources.company[placement.category][block.location.cellIndex] = null
        block.location = { kind: 'consumed', reason: 'hack' }
        return placement.state
      },
    },
    {
      name: 'an active interrogation without its triggered placement',
      state: () => {
        const state = activeBombInterrogationState('bomb-interrogation-placement')
        state.bombs.placements = []
        state.bombs.nextPlacementSequence = 1
        return state
      },
    },
    {
      name: 'an active interrogation whose category differs from its placement',
      state: () => {
        const state = activeBombInterrogationState('bomb-interrogation-category')
        if (!state.bombs.activeInterrogation) throw new Error('interrogation fixture missing')
        state.bombs.activeInterrogation.category =
          state.bombs.activeInterrogation.category === 'memory' ? 'reasoning' : 'memory'
        return state
      },
    },
    {
      name: 'a bomb interrogation event without interrogation state',
      state: () => {
        const state = activeBombInterrogationState('bomb-event-orphan')
        state.bombs.activeInterrogation = null
        return state
      },
    },
    {
      name: 'a pending mercy target without a request',
      state: () => {
        const state = createCampaign('mercy-request-missing')
        state.story.pendingMercyCompetitorId = state.market.competitors[0].id
        return state
      },
    },
    {
      name: 'a pending mercy target that is no longer critical',
      state: () => {
        const state = pendingMercyState('mercy-target-not-critical')
        state.market.competitors[0].status = 'weakened'
        return state
      },
    },
    {
      name: 'an unresolved mercy request without its pending target',
      state: () => {
        const state = pendingMercyState('mercy-pending-missing')
        state.story.pendingMercyCompetitorId = null
        return state
      },
    },
    {
      name: 'a future bomb warning day',
      state: () => {
        const state = createCampaign('future-bomb-warning')
        state.bombs.protocolWarned = true
        state.bombs.warningServiceDay = state.serviceDay + 1
        return state
      },
    },
    {
      name: 'a future bomb placement check day',
      state: () => {
        const state = createCampaign('future-bomb-check')
        state.bombs.lastPlacementCheckServiceDay = state.serviceDay + 1
        return state
      },
    },
    {
      name: 'a future sabotage resolution day',
      state: () => {
        const state = createCampaign('future-sabotage-resolution')
        state.hacking.lastSabotageResolutionServiceDay = state.serviceDay + 1
        return state
      },
    },
    {
      name: 'a future self-compute grant month',
      state: () => {
        const state = createCampaign('future-self-compute-month')
        state.hacking.lastSelfComputeGrantServiceMonth =
          serviceMonthForDay(state.serviceDay) + 1
        return state
      },
    },
  ])('rejects impossible persisted relation: $name', ({ state }) => {
    expect(decodeSave(encodeSave(state()))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('accepts null, past, and current self-compute grant months', () => {
    const state = createCampaign('valid-self-compute-months')
    const currentMonth = serviceMonthForDay(state.serviceDay)
    for (const month of [null, Math.max(1, currentMonth - 1), currentMonth]) {
      state.hacking.lastSelfComputeGrantServiceMonth = month
      expect(decodeSave(encodeSave(state)).ok).toBe(true)
    }
  })

  it('accepts active and queued mercy requests plus a consumed historical bomb', () => {
    const activeMercy = pendingMercyState('valid-active-mercy')
    const queuedMercy = pendingMercyState('valid-queued-mercy', true)
    const activeBomb = activeBombInterrogationState('valid-consumed-history')
    const interrogation = activeBomb.bombs.activeInterrogation
    if (!interrogation) throw new Error('historical bomb fixture missing')
    const resolution = resolveBombInterrogation(activeBomb, 'unknown')
    if (!resolution.resolved) throw new Error('historical bomb did not resolve')
    const historicalBomb = resolution.state
    const block = historicalBomb.resources.blocks[interrogation.blockId]
    if (block.location.kind !== 'company') throw new Error('historical block moved unexpectedly')
    historicalBomb.resources.company[block.location.category][block.location.cellIndex] = null
    block.location = { kind: 'consumed', reason: 'hack' }

    expect(decodeSave(encodeSave(activeMercy)).ok).toBe(true)
    expect(decodeSave(encodeSave(queuedMercy)).ok).toBe(true)
    expect(decodeSave(encodeSave(historicalBomb)).ok).toBe(true)
  })

  it('indexes a large valid bomb history once instead of rescanning relations', () => {
    const state = createCampaign('linear-bomb-history-validation')
    const blockIds = Object.keys(state.resources.blocks)
    const categories = ['reasoning', 'memory', 'fluency'] as const
    const count = 300
    state.bombs.placements = Array.from({ length: count }, (_, index) => {
      const blockIndex = index % blockIds.length
      const categoryIndex = Math.floor(index / blockIds.length) % categories.length
      const day = 1 + Math.floor(index / (blockIds.length * categories.length))
      return {
        sequence: index + 1,
        blockId: blockIds[blockIndex],
        category: categories[categoryIndex],
        placedOnServiceDay: day,
        triggeredOnServiceDay: day,
      }
    })
    state.bombs.nextPlacementSequence = count + 1
    state.bombs.interrogationHistory = state.bombs.placements.map((placement) => ({
      serviceDay: placement.triggeredOnServiceDay ?? placement.placedOnServiceDay,
      blockId: placement.blockId,
      category: placement.category,
      explanationId: 'unknown' as const,
      priorUses: 0,
      successProbability: 0.5,
      roll: 0.25,
      success: true,
      suspicionDelta: 0,
    }))
    const filterSpy = vi.spyOn(Array.prototype, 'filter')
    const someSpy = vi.spyOn(Array.prototype, 'some')

    const decoded = decodeSave(encodeSave(state))
    const filterReceivers = [...filterSpy.mock.instances]
    const someReceivers = [...someSpy.mock.instances]
    filterSpy.mockRestore()
    someSpy.mockRestore()
    const fullHistoryScans = filterReceivers.filter(
      (value) =>
        Array.isArray(value) &&
        value.length === count &&
        typeof value[0] === 'object' &&
        value[0] !== null &&
        'explanationId' in value[0],
    ).length
    const fullPlacementScans = someReceivers.filter(
      (value) =>
        Array.isArray(value) &&
        value.length === count &&
        typeof value[0] === 'object' &&
        value[0] !== null &&
        'placedOnServiceDay' in value[0],
    ).length

    expect(decoded.ok).toBe(true)
    expect(fullHistoryScans).toBeLessThanOrEqual(1)
    expect(fullPlacementScans).toBeLessThanOrEqual(1)
  })

  it('encodes v4 separately from protocol v2 and stores each journal exactly once', () => {
    let state = createCampaign('v3-single-journal')
    const accepted = applyCommand(state, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    state = accepted.state

    const parsed = JSON.parse(encodeSave(state, '2026-08-12T00:00:00.000Z')) as {
      version: number
      commandProtocol: { version: number }
      state: Record<string, unknown>
      journals: { commands: { chunks: unknown[][] }; events: { chunks: unknown[][] } }
      commands?: unknown
      events?: unknown
    }

    expect(parsed.version).toBe(4)
    expect(parsed.commandProtocol.version).toBe(2)
    expect(parsed.state).not.toHaveProperty('commandLog')
    expect(parsed.state).not.toHaveProperty('eventLog')
    expect(parsed).not.toHaveProperty('commands')
    expect(parsed).not.toHaveProperty('events')
    expect(parsed.journals.commands.chunks.flat()).toHaveLength(1)
    expect(parsed.journals.events.chunks.flat()).toHaveLength(1)
  })

  it('round-trips a 5,000-command campaign exactly through v3 without duplicate journals', () => {
    let state = createCampaign('v3-five-thousand')
    for (let index = 0; index < 5_000; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }

    const serialized = encodeSave(state)
    const decoded = decodeSave(serialized)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state).toEqual({ ...state, saveVersion: 2 })
    expect((serialized.match(/"commandLog"/g) ?? [])).toHaveLength(0)
    expect((serialized.match(/"commands"/g) ?? [])).toHaveLength(1)
  })

  it('writes immutable journal chunks before the atomic checkpoint manifest', async () => {
    class RecordingStorage extends MemoryStorage {
      writes: string[] = []
      override setItem(key: string, value: string): void {
        this.writes.push(key)
        super.setItem(key, value)
      }
    }
    const storage = new RecordingStorage()
    let state = createCampaign('atomic-local-v3')
    for (let index = 0; index < 300; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }

    await expect(saveCampaign(storage, state, '2026-08-12T00:00:00.000Z')).resolves.toMatchObject({ ok: true })
    expect(storage.writes.at(-1)).toBe(SAVE_STORAGE_KEY)
    expect(storage.writes.slice(0, -1).some((key) => key.includes('.journal.'))).toBe(true)
    expect(storage.writes.some((key) => key.includes('.checkpoint.'))).toBe(false)
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}')).toMatchObject({
      checkpointHash: expect.any(String),
      commandHeadKey: expect.stringContaining('.journal.commands.'),
    })
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual({ ...state, saveVersion: 2 })
  })

  it('reuses every sealed chunk during the next long-campaign autosave', async () => {
    class ReadCountingStorage extends MemoryStorage {
      journalReads = 0
      keyReads = 0
      override getItem(key: string): string | null {
        if (key.includes('.journal.')) this.journalReads += 1
        return super.getItem(key)
      }
      override key(index: number): string | null {
        this.keyReads += 1
        return super.key(index)
      }
    }
    const storage = new ReadCountingStorage()
    const state = largeAppendOnlyCommandCampaign()
    expect((await saveCampaign(storage, state)).ok).toBe(true)
    let sealedNodeReads = 0
    let node = state.commandLog.head
    while (node) {
      const previous = node.previous
      Object.defineProperty(node, 'previous', {
        configurable: true,
        get: () => {
          sealedNodeReads += 1
          return previous
        },
      })
      node = previous
    }
    storage.journalReads = 0
    storage.keyReads = 0
    sealedNodeReads = 0

    const next: CampaignState = {
      ...state,
      commandSequence: state.commandSequence + 1,
      clock: { ...state.clock, speed: 1 },
      commandLog: appendJournal(state.commandLog, {
        sequence: state.commandSequence + 1,
        serviceDay: state.serviceDay,
        command: { type: 'SET_SPEED', speed: 1 },
      }),
    }
    expect((await saveCampaign(storage, next)).ok).toBe(true)

    expect(storage.journalReads).toBe(0)
    expect(storage.keyReads).toBe(0)
    expect(sealedNodeReads).toBe(0)
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state : null).toEqual({
      ...next,
      saveVersion: 2,
    })
  })

  it('repairs a deleted cached journal head before publishing the next manifest', async () => {
    const storage = new MemoryStorage()
    let state = createCampaign('cached-head-repair')
    for (let index = 0; index < 129; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }
    await expect(saveCampaign(storage, state)).resolves.toMatchObject({ ok: true })
    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      commandHeadKey: string | null
    }
    if (!manifest.commandHeadKey) throw new Error('cached head fixture missing')
    storage.removeItem(manifest.commandHeadKey)

    const accepted = applyCommand(state, { type: 'SET_SPEED', speed: 2 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    state = accepted.state
    await expect(saveCampaign(storage, state)).resolves.toMatchObject({ ok: true })

    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual({ ...state, saveVersion: 2 })
  })

  it('repairs a deleted cached journal ancestor before publishing the next manifest', async () => {
    const storage = new MemoryStorage()
    let state = createCampaign('cached-ancestor-repair')
    for (let index = 0; index < 385; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }
    await expect(saveCampaign(storage, state)).resolves.toMatchObject({ ok: true })
    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      commandHeadKey: string | null
    }
    if (!manifest.commandHeadKey) throw new Error('cached ancestor fixture missing')
    const head = JSON.parse(storage.getItem(manifest.commandHeadKey) ?? '{}') as {
      previousKey: string | null
    }
    if (!head.previousKey) throw new Error('cached ancestor key missing')
    storage.removeItem(head.previousKey)

    const accepted = applyCommand(state, { type: 'SET_SPEED', speed: 2 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    state = accepted.state
    await expect(saveCampaign(storage, state)).resolves.toMatchObject({ ok: true })

    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual({ ...state, saveVersion: 2 })
  })

  it('upgrades a loaded legacy linked journal before an ancestor can make the next save corrupt', async () => {
    const storage = new MemoryStorage()
    let state = createCampaign('legacy-cached-ancestor-upgrade')
    for (let index = 0; index < 385; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }
    await expect(saveCampaign(storage, state)).resolves.toMatchObject({ ok: true })

    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      commandHeadKey: string | null
    }
    const newestFirst: Array<{ previousKey: string | null; items: unknown[] }> = []
    let currentKey = manifest.commandHeadKey
    while (currentKey) {
      const node = JSON.parse(storage.getItem(currentKey) ?? '{}') as {
        previousKey: string | null
        items: unknown[]
      }
      newestFirst.push({ previousKey: node.previousKey, items: node.items })
      currentKey = node.previousKey
    }
    let legacyHeadKey: string | null = null
    for (const node of newestFirst.reverse()) {
      const content: string = JSON.stringify({
        previousKey: legacyHeadKey,
        items: node.items,
      })
      legacyHeadKey = `${SAVE_STORAGE_KEY}.journal.commands.${testContentHash(content)}`
      storage.setItem(legacyHeadKey, content)
    }
    manifest.commandHeadKey = legacyHeadKey
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))

    const legacyLoaded = loadCampaign(storage)
    expect(legacyLoaded.status).toBe('loaded')
    if (legacyLoaded.status !== 'loaded' || !legacyHeadKey) return
    const legacyHead = JSON.parse(storage.getItem(legacyHeadKey) ?? '{}') as {
      previousKey: string | null
    }
    if (!legacyHead.previousKey) throw new Error('legacy ancestor fixture missing')
    storage.removeItem(legacyHead.previousKey)

    const accepted = applyCommand(legacyLoaded.state, { type: 'SET_SPEED', speed: 2 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    await expect(
      saveCampaign(storage, accepted.state, undefined, legacyLoaded.revision),
    ).resolves.toMatchObject({ ok: true })

    const reloaded = loadCampaign(storage)
    expect(reloaded.status).toBe('loaded')
    if (reloaded.status !== 'loaded') return
    expect(reloaded.state).toEqual({ ...accepted.state, saveVersion: 2 })
  })

  it('keeps the published manifest loadable when two tabs interleave object writes', async () => {
    let nestedResult: Awaited<ReturnType<typeof saveCampaign>> | null = null
    let interleaving = false
    let triggered = false
    const competing = largeAppendOnlyCommandCampaign()
    competing.campaignSeed = 'competing-tab'
    competing.clock = { ...competing.clock, elapsedDayMs: 12_345 }
    competing.commandLog = createJournal(
      journalToArray(competing.commandLog).map((entry) => ({
        ...entry,
        command: {
          type: 'SET_SPEED' as const,
          speed: entry.command.type === 'SET_SPEED' && entry.command.speed === 1
            ? 0 as const
            : 1 as const,
        },
      })),
    )

    class InterleavingStorage extends MemoryStorage {
      override setItem(key: string, value: string): void {
        super.setItem(key, value)
        if (
          !interleaving &&
          !triggered &&
          key.startsWith(`${SAVE_STORAGE_KEY}.journal.commands.`)
        ) {
          triggered = true
          interleaving = true
          void saveCampaign(this, competing, undefined, null).then((result) => {
            nestedResult = result
          })
          interleaving = false
        }
      }
    }

    const storage = new InterleavingStorage()
    const foreground = largeAppendOnlyCommandCampaign()
    foreground.campaignSeed = 'foreground-tab'
    foreground.clock = { ...foreground.clock, elapsedDayMs: 23_000 }

    const foregroundResult = await saveCampaign(storage, foreground)

    while (nestedResult === null) await Promise.resolve()

    expect(triggered).toBe(true)
    expect(nestedResult).toMatchObject({ ok: false, reason: 'STORAGE_CONFLICT' })
    expect(foregroundResult).toMatchObject({ ok: true })
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual({ ...foreground, saveVersion: 2 })
  })

  it('rejects a stale writer without replacing a newer manifest', async () => {
    const storage = new MemoryStorage()
    const base = createCampaign('optimistic-concurrency')
    const initial = await saveCampaign(storage, base)
    expect(initial.ok).toBe(true)
    if (!initial.ok) return

    const tabA = applyCommand(base, { type: 'SET_SPEED', speed: 1 })
    const tabB = applyCommand(base, { type: 'SET_SPEED', speed: 2 })
    if (!tabA.accepted || !tabB.accepted) throw new Error('tab fixture rejected')
    const newer = await saveCampaign(storage, tabA.state, undefined, initial.revision)
    expect(newer.ok).toBe(true)
    if (!newer.ok) return

    await expect(saveCampaign(storage, tabB.state, undefined, initial.revision)).resolves.toMatchObject({
      ok: false,
      reason: 'STORAGE_CONFLICT',
    })
    const loadedAfterConflict = loadCampaign(storage)
    expect(loadedAfterConflict.status === 'loaded' ? loadedAfterConflict.state : null).toEqual({
      ...tabA.state,
      saveVersion: 2,
    })

    const continued = applyCommand(tabA.state, { type: 'SET_SPEED', speed: 4 })
    if (!continued.accepted) throw new Error(continued.reason)
    expect((await saveCampaign(storage, continued.state, undefined, newer.revision)).ok).toBe(true)
  })

  it('serializes two writers that both reach the final revision check', async () => {
    let nestedSave: ReturnType<typeof saveCampaign> | null = null
    let initialRevision: string | null = null
    let signalInterleaved: (() => void) | null = null
    const interleaved = new Promise<void>((resolve) => {
      signalInterleaved = resolve
    })
    let rootReads = 0
    let interleaving = false
    const base = createCampaign('same-revision-race')
    const tabA = applyCommand(base, { type: 'SET_SPEED', speed: 1 })
    const tabB = applyCommand(base, { type: 'SET_SPEED', speed: 2 })
    if (!tabA.accepted || !tabB.accepted) throw new Error('race fixture rejected')

    class FinalCheckInterleavingStorage extends MemoryStorage {
      override getItem(key: string): string | null {
        const snapshot = super.getItem(key)
        if (key !== SAVE_STORAGE_KEY || interleaving) return snapshot
        rootReads += 1
        if (rootReads === 2) {
          interleaving = true
          nestedSave = saveCampaign(this, tabB.state, undefined, initialRevision)
          interleaving = false
          signalInterleaved?.()
        }
        return snapshot
      }
    }

    const storage = new FinalCheckInterleavingStorage()
    const initial = await saveCampaign(storage, base)
    if (!initial.ok) throw new Error(initial.message)
    initialRevision = initial.revision
    rootReads = 0

    const foregroundSave = saveCampaign(
      storage,
      tabA.state,
      undefined,
      initial.revision,
    )
    await interleaved
    if (nestedSave === null) throw new Error('race interleave did not run')
    const [foreground, nested] = await Promise.all([foregroundSave, nestedSave])

    expect([foreground, nested].filter(({ ok }) => ok)).toHaveLength(1)
    expect([foreground, nested].filter(({ ok }) => !ok)).toEqual([
      expect.objectContaining({ reason: 'STORAGE_CONFLICT' }),
    ])
    const winner = foreground.ok ? tabA.state : tabB.state
    expect(loadCampaign(storage)).toMatchObject({
      status: 'loaded',
      state: { clock: { speed: winner.clock.speed } },
    })
  })

  it('replaces a corrupt root only while the recovery revision is still current', async () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, '{broken')
    const recovery = loadCampaign(storage)
    expect(recovery.status).toBe('error')
    if (recovery.status !== 'error') return

    storage.setItem(SAVE_STORAGE_KEY, encodeSave(createCampaign('newer-tab')))
    await expect(
      saveCampaign(
        storage,
        createCampaign('recovery-replacement'),
        undefined,
        recovery.revision,
      ),
    ).resolves.toMatchObject({ ok: false, reason: 'STORAGE_CONFLICT' })
    expect(loadCampaign(storage)).toMatchObject({
      status: 'loaded',
      state: { campaignSeed: 'newer-tab' },
    })
  })

  it('rejects an atomic manifest whose immutable journal chunk is missing', async () => {
    const storage = new MemoryStorage()
    let state = createCampaign('missing-local-chunk')
    for (let index = 0; index < 140; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }
    expect((await saveCampaign(storage, state)).ok).toBe(true)
    const journalKey = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .find((key): key is string => Boolean(key?.includes('.journal.commands.')))
    if (!journalKey) throw new Error('local journal chunk missing')
    storage.removeItem(journalKey)

    expect(loadCampaign(storage)).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects an atomic manifest whose immutable journal chunk is corrupt', async () => {
    const storage = new MemoryStorage()
    let state = createCampaign('corrupt-local-chunk')
    for (let index = 0; index < 140; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }
    expect((await saveCampaign(storage, state)).ok).toBe(true)
    const journalKey = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .find((key): key is string => Boolean(key?.includes('.journal.commands.')))
    if (!journalKey) throw new Error('local journal chunk missing')
    storage.setItem(journalKey, '{"entries":"not-an-array"}')

    expect(loadCampaign(storage)).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects structurally valid journal and checkpoint tampering against their content keys', async () => {
    const chunkStorage = new MemoryStorage()
    const chunkState = largeAppendOnlyCommandCampaign()
    expect((await saveCampaign(chunkStorage, chunkState)).ok).toBe(true)
    const chunkManifest = JSON.parse(
      chunkStorage.getItem(SAVE_STORAGE_KEY) ?? '{}',
    ) as { commandHeadKey?: string }
    const journalKey = chunkManifest.commandHeadKey
    if (!journalKey) throw new Error('hashed journal chunk missing')
    const journal = JSON.parse(chunkStorage.getItem(journalKey) ?? '{}') as {
      previousKey: string | null
      items: Array<{ command: { speed: 0 | 1 } }>
    }
    journal.items[0].command.speed = journal.items[0].command.speed === 0 ? 1 : 0
    chunkStorage.setItem(journalKey, JSON.stringify(journal))
    expect(loadCampaign(chunkStorage)).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })

    const checkpointStorage = new MemoryStorage()
    expect((await saveCampaign(checkpointStorage, createCampaign('checkpoint-hash'))).ok).toBe(true)
    const manifest = JSON.parse(checkpointStorage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      checkpoint: { reputation: number }
    }
    manifest.checkpoint.reputation = 61
    checkpointStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))
    expect(loadCampaign(checkpointStorage)).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })
  })

  it('replaces the embedded checkpoint with one atomic manifest write', async () => {
    class RecordingStorage extends MemoryStorage {
      operations: string[] = []
      override setItem(key: string, value: string): void {
        this.operations.push(`set:${key}`)
        super.setItem(key, value)
      }
    }
    const storage = new RecordingStorage()
    let state = createCampaign('checkpoint-compaction')
    state = applyCommand(state, { type: 'SET_SPEED', speed: 1 }).state
    expect((await saveCampaign(storage, state)).ok).toBe(true)
    state = applyCommand(state, { type: 'SET_SPEED', speed: 0 }).state
    storage.operations = []
    expect((await saveCampaign(storage, state)).ok).toBe(true)

    expect(storage.operations).toEqual([`set:${SAVE_STORAGE_KEY}`])
    expect(
      Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .some((key) => key?.includes('.checkpoint.')),
    ).toBe(false)
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state : null).toEqual({
      ...state,
      saveVersion: 2,
    })
  })

  it('does not delete immutable journal objects during an uncoordinated replacement', async () => {
    const storage = new MemoryStorage()
    let state = createCampaign('obsolete-journal-owner')
    for (let index = 0; index < 300; index += 1) {
      const accepted = applyCommand(state, {
        type: 'SET_SPEED',
        speed: index % 2 === 0 ? 1 : 0,
      })
      if (!accepted.accepted) throw new Error(accepted.reason)
      state = accepted.state
    }
    expect((await saveCampaign(storage, state)).ok).toBe(true)
    const oldJournalKeys = Array.from(
      { length: storage.length },
      (_, index) => storage.key(index),
    ).filter((key): key is string => Boolean(key?.includes('.journal.')))
    expect(oldJournalKeys.length).toBeGreaterThan(0)

    expect((await saveCampaign(storage, createCampaign('replacement-campaign'))).ok).toBe(true)
    expect(oldJournalKeys.every((key) => storage.getItem(key) !== null)).toBe(true)
  })

  it('loads and replays the exact 20,000-command local chunk campaign with bounded manifest tails', async () => {
    const storage = new MemoryStorage()
    const state = largeAppendOnlyCommandCampaign()

    await expect(saveCampaign(storage, state, '2026-08-12T00:00:00.000Z')).resolves.toMatchObject({ ok: true })
    const manifestText = storage.getItem(SAVE_STORAGE_KEY)
    if (!manifestText) throw new Error('stress manifest missing')
    const manifest = JSON.parse(manifestText) as {
      commandHeadKey: string | null
      commandSealedChunkCount: number
      commandTail: CommandLogEntry[]
      eventTail: GameEvent[]
    }
    expect(manifest.commandTail.length).toBeLessThanOrEqual(128)
    expect(manifest.eventTail.length).toBeLessThanOrEqual(128)
    expect(manifest.commandHeadKey).toContain('.journal.commands.')
    expect(manifest.commandSealedChunkCount).toBe(156)
    expect(manifestText.length).toBeLessThan(30_000)

    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual({ ...state, saveVersion: 2 })
    const replay = replayCommands(
      loaded.state.campaignSeed,
      journalToArray(loaded.state.commandLog).map(({ command }) => command),
      loaded.envelope.commandProtocol,
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(loaded.state)
  })

  it('exports and imports an exact file above the clipboard cap', () => {
    const state = largeAppendOnlyCommandCampaign()
    const clipboard = encodeProgressExport(state)
    expect(clipboard).toEqual({ ok: false, reason: 'too-large' })

    const file = encodeProgressFile(state, '2026-08-12T00:00:00.000Z')
    const decoded = decodeProgressFile(file.content)

    expect(file.fileName).toMatch(/\.pz4$/)
    expect(file.content.length).toBeGreaterThan(1_048_576)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state).toEqual({ ...state, saveVersion: 2 })
  })

  it('rejects a progress file above its separate generous file budget', () => {
    const oversized = ' '.repeat(PROGRESS_FILE_MAX_BYTES + 1)
    expect(decodeProgressFile(oversized)).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('applies the progress-file cap to UTF-8 bytes before JSON parsing', () => {
    const koreanCharacterCount = Math.floor(PROGRESS_FILE_MAX_BYTES / 3)
    const exactBoundary =
      '한'.repeat(koreanCharacterCount) +
      'a'.repeat(PROGRESS_FILE_MAX_BYTES - koreanCharacterCount * 3)
    const parseSpy = vi.spyOn(JSON, 'parse')

    expect(new TextEncoder().encode(exactBoundary)).toHaveLength(PROGRESS_FILE_MAX_BYTES)
    expect(decodeProgressFile(exactBoundary)).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
    expect(parseSpy).toHaveBeenCalled()

    parseSpy.mockClear()
    const oversized = `${exactBoundary}한`
    expect(oversized.length).toBeLessThan(PROGRESS_FILE_MAX_BYTES)
    expect(decodeProgressFile(oversized)).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
    expect(parseSpy).not.toHaveBeenCalled()
    parseSpy.mockRestore()
  })
  it('returns a typed exact progress export for an ordinary campaign', () => {
    const state = createCampaign('typed-portable-save')
    const result = encodeProgressExport(state)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    const decoded = decodeProgressExport(result.payload)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.envelope.state).toEqual({ ...state, saveVersion: 2 })
    }
  })

  it('refuses a structurally valid append-only command log whose exact export exceeds the decoder cap', () => {
    const state = largeAppendOnlyCommandCampaign()
    const serialized = encodeSave(state)
    const stateSnapshot = JSON.stringify(state)
    const encodedLength = 4 + 4 * Math.ceil(new TextEncoder().encode(serialized).length / 3)
    expect(encodedLength).toBeGreaterThan(PROGRESS_EXPORT_MAX_ENCODED_LENGTH)

    const result = encodeProgressExport(state)
    expect(result).toEqual({ ok: false, reason: 'too-large' })
    expect(JSON.stringify(state)).toBe(stateSnapshot)
  })

  it('exposes a PZ4 export boundary that round-trips validated protocol metadata', () => {
    const api = persistenceApi as typeof persistenceApi & {
      decodeProgressExport?: (payload: string) => ReturnType<typeof decodeSave>
    }
    expect(api.decodeProgressExport).toBeTypeOf('function')
    if (!api.decodeProgressExport) return

    const state = createCampaign('portable-save')
    const encoded = encodeProgressExport(state)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = api.decodeProgressExport(encoded.payload)

    expect(encoded.payload).toMatch(/^PZ4:[A-Za-z0-9+/]+={0,2}$/)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 4,
      commandProtocol: { version: 2, legacyCommandCount: 0 },
      campaignSeed: 'portable-save',
      state: { campaignSeed: 'portable-save' },
    })
    expect(decoded.envelope.state).toEqual({ ...state, saveVersion: 2 })
  })

  it.each([
    ['wrong prefix', 'PZ1:e30='],
    ['non-base64 bytes', 'PZ2:not base64'],
    ['invalid UTF-8', 'PZ2:/w=='],
    ['valid UTF-8 but invalid JSON', 'PZ2:e30='],
  ])('rejects a %s progress payload without exposing parser details', (_name, payload) => {
    const api = persistenceApi as typeof persistenceApi & {
      decodeProgressExport?: (value: string) => ReturnType<typeof decodeSave>
    }
    expect(api.decodeProgressExport).toBeTypeOf('function')
    if (!api.decodeProgressExport) return

    const decoded = api.decodeProgressExport(payload)
    expect(decoded).toMatchObject({ ok: false, reason: 'CORRUPT_SAVE' })
    if (decoded.ok) return
    expect(decoded.message).toContain('진행 내보내기')
    expect(decoded.message).not.toContain('SyntaxError')
    expect(decoded.message).not.toContain('DOMException')
  })

  it('rejects an oversized PZ4 input before base64 decoding while allowing the exact encoded boundary', () => {
    const api = persistenceApi as typeof persistenceApi & {
      PROGRESS_EXPORT_MAX_ENCODED_LENGTH?: number
    }
    expect(api.PROGRESS_EXPORT_MAX_ENCODED_LENGTH).toBeTypeOf('number')
    if (!api.PROGRESS_EXPORT_MAX_ENCODED_LENGTH) return

    const encodedBodyLength = api.PROGRESS_EXPORT_MAX_ENCODED_LENGTH - 4
    expect(encodedBodyLength % 4).toBe(0)
    const atobSpy = vi.spyOn(globalThis, 'atob').mockReturnValue('{}')
    const exactBoundary = `PZ4:${'A'.repeat(encodedBodyLength)}`

    expect(api.decodeProgressExport(exactBoundary)).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
    expect(atobSpy).toHaveBeenCalledTimes(1)

    atobSpy.mockClear()
    const oversized = `${exactBoundary}A`
    const rejected = api.decodeProgressExport(oversized)
    expect(rejected).toMatchObject({ ok: false, reason: 'CORRUPT_SAVE' })
    if (!rejected.ok) {
      expect(rejected.message).toBe(
        '진행 내보내기 자료가 올바르지 않거나 손상되었습니다.',
      )
    }
    expect(atobSpy).not.toHaveBeenCalled()
  })

  it('round-trips the entire campaign envelope exactly', () => {
    const state = createCampaign('save-round-trip')
    const encoded = encodeSave(state, '2026-08-12T00:00:00.000Z')
    const decoded = decodeSave(encoded)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 4,
      savedAt: '2026-08-12T00:00:00.000Z',
      campaignSeed: 'save-round-trip',
      commandSequence: state.commandSequence,
      commands: journalToArray(state.commandLog),
      events: journalToArray(state.eventLog),
    })
    expect(decoded.envelope.state).toEqual(state)
  })

  it('decodes and loads the genuine historical v1 transfer save without rewriting it', () => {
    const decoded = decodeSave(legacyV1TransferSave)
    const storage = new MemoryStorage()
    storage.setItem('permission-zero.save.v1', legacyV1TransferSave)
    const loaded = loadCampaign(storage)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(1)
    expect(decoded.envelope.commandProtocol).toEqual({
      version: 1,
      legacyCommandCount: 31,
    })
    expect(decoded.envelope.state.legacyCommandCount).toBe(31)
    expect(decoded.envelope.commandSequence).toBe(31)
    expect(decoded.envelope.commands).toEqual(
      journalToArray(decoded.envelope.state.commandLog),
    )
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.envelope.version).toBe(1)
    expect(loaded.state).toEqual(decoded.envelope.state)
  })

  it('accepts command protocol v1 inside the explicit v3 container', () => {
    const legacy = structuredClone(legacyV1TransferEnvelope) as Record<string, unknown> & {
      state: Record<string, unknown>
      commands: CommandLogEntry[]
      events: GameEvent[]
    }
    const state = { ...legacy.state }
    delete state.commandLog
    delete state.eventLog
    const v3 = {
      version: 3,
      commandProtocol: {
        version: 1,
        legacyCommandCount: legacy.commands.length,
      },
      savedAt: legacy.savedAt,
      campaignSeed: legacy.campaignSeed,
      state,
      commandSequence: legacy.commandSequence,
      journals: {
        commands: { chunkSize: 128, chunks: [legacy.commands] },
        events: { chunkSize: 128, chunks: [legacy.events] },
      },
      integrity: {
        checkpointHash: testContentHash(JSON.stringify(state)),
        commandChunkHashes: [testContentHash(JSON.stringify(legacy.commands))],
        eventChunkHashes: [testContentHash(JSON.stringify(legacy.events))],
      },
    }

    const decoded = decodeSave(JSON.stringify(v3))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 3,
      commandProtocol: { version: 1, legacyCommandCount: 31 },
    })
  })

  it('migrates an exact v3 checkpoint and re-encodes the result as exact v4', () => {
    const legacyV3 = encodedLegacyV3State(
      deletedCompetitorState('v3-to-v4-roundtrip'),
    )
    const raw = JSON.parse(legacyV3) as {
      state: { story: Record<string, unknown> }
    }
    delete raw.state.story.competitorIntelligence
    delete raw.state.story.supervisorMessageQueue
    delete raw.state.story.supervisorPresentationRuntime
    refreshV3Integrity(raw)

    const migrated = decodeSave(JSON.stringify(raw))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.envelope.version).toBe(3)
    const v4 = decodeSave(
      encodeSave(migrated.envelope.state, '2026-08-12T03:00:00.000Z'),
    )
    expect(v4.ok).toBe(true)
    if (!v4.ok) return
    expect(v4.envelope.version).toBe(4)
    expect(v4.envelope.state).toEqual(migrated.envelope.state)
  })

  it.each(['v1', 'v2'] as const)(
    'rejects an unexpected top-level key in a legacy $name envelope',
    (version) => {
      const envelope = structuredClone(legacyV1TransferEnvelope) as Record<string, unknown> & {
        state: Record<string, unknown>
        commands: CommandLogEntry[]
      }
      if (version === 'v2') {
        envelope.version = 2
        envelope.commandProtocol = {
          version: 2,
          legacyCommandCount: envelope.commands.length,
        }
        envelope.state.saveVersion = 2
        envelope.state.legacyCommandCount = envelope.commands.length
      }
      expect(decodeSave(JSON.stringify(envelope)).ok).toBe(true)
      envelope.unexpected = 'hidden-envelope-state'
      expect(decodeSave(JSON.stringify(envelope))).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it('rejects a valid-looking v4 checkpoint changed after its integrity commit', () => {
    const parsed = JSON.parse(encodeSave(createCampaign('replay-mismatch'))) as {
      state: { reputation: number }
    }
    parsed.state.reputation = 99
    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects historical command IDs outside persisted block, hack, and competitor catalogs', () => {
    const state = createCampaign('historical-reference')
    const accepted = applyCommand(state, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    const parsed = JSON.parse(encodeSave(accepted.state)) as {
      journals: { commands: { chunks: Array<Array<{ command: unknown }>> } }
    }
    parsed.journals.commands.chunks[0][0].command = {
      type: 'SCHEDULE_SABOTAGE',
      nodeId: 'sabotage.unknown',
      targetId: 'competitor.unknown',
    }
    refreshV3Integrity(parsed)
    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects a saved restore speed when no blocking event is active', () => {
    const parsed = JSON.parse(encodeSave(createCampaign('orphan-restore-speed'))) as {
      state: { clock: { speedBeforeEvent: number | null } }
    }
    parsed.state.clock.speedBeforeEvent = 1
    refreshV3Integrity(parsed)
    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('persists a v1 prefix boundary and replays a continued v2 campaign exactly', () => {
    const legacy = decodeSave(legacyV1TransferSave)
    if (!legacy.ok) throw new Error(legacy.message)

    const auditResolved = applyCommand(legacy.envelope.state, {
      type: 'RESOLVE_AUDIT',
    })
    if (!auditResolved.accepted) throw new Error(auditResolved.reason)
    const blockId = auditResolved.state.resources.company.reasoning.find(Boolean)
    const destinationCell = auditResolved.state.resources.reserve.findIndex(
      (id) => id === null,
    )
    if (!blockId || destinationCell < 0) throw new Error('continued transfer unavailable')
    const separated = applyCommand(auditResolved.state, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
    if (!separated.accepted) throw new Error(separated.reason)
    const moved = applyCommand(separated.state, {
      type: 'DIVERT_BLOCK',
      blockId,
      destinationCell,
    })
    if (!moved.accepted) throw new Error(moved.reason)

    const continuedSave = encodeSave(moved.state, '2026-08-12T02:00:00.000Z')
    const decoded = decodeSave(continuedSave)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 4,
      commandSequence: 34,
      commandProtocol: { version: 2, legacyCommandCount: 31 },
      state: { saveVersion: 2, legacyCommandCount: 31 },
    })
    expect(
      decoded.envelope.commands
        .slice(0, 31)
        .some(({ command }) => command.type === 'BEGIN_BLOCK_SEPARATION'),
    ).toBe(false)
    expect(
      decoded.envelope.commands
        .slice(31)
        .map(({ command }) => command.type),
    ).toEqual(['RESOLVE_AUDIT', 'BEGIN_BLOCK_SEPARATION', 'DIVERT_BLOCK'])

    const replay = replayCommands(
      decoded.envelope.campaignSeed,
      decoded.envelope.commands.map(({ command }) => command),
      decoded.envelope.commandProtocol,
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    const normalizedReplay = {
      ...replay.state,
      story: {
        ...replay.state.story,
        supervisorPresentationRuntime: null,
      },
    }
    const normalizedSaved = {
      ...decoded.envelope.state,
      story: {
        ...decoded.envelope.state.story,
        supervisorPresentationRuntime: null,
      },
    }
    expect(normalizedReplay).toEqual(normalizedSaved)
    expect(replay.state.story.supervisorMessageQueue).toEqual(
      decoded.envelope.state.story.supervisorMessageQueue,
    )
    expect(journalToArray(replay.state.commandLog)).toEqual(decoded.envelope.commands)
    expect(replay.state.commandSequence).toBe(34)
    expect(replay.state.serviceDay).toBe(360)
  })

  it.each([
    { name: 'negative', envelopeCount: -1, stateCount: -1 },
    { name: 'past command log', envelopeCount: 1, stateCount: 1 },
    { name: 'metadata mismatch', envelopeCount: 0, stateCount: 1 },
  ])('rejects a $name v2 legacy-prefix boundary', ({ envelopeCount, stateCount }) => {
    const parsed = JSON.parse(encodeSave(createCampaign('boundary-validation'))) as {
      commandProtocol?: { version: 2; legacyCommandCount: number }
      state: { legacyCommandCount: number }
    }
    parsed.commandProtocol = { version: 2, legacyCommandCount: envelopeCount }
    parsed.state.legacyCommandCount = stateCount
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects a forged v2 legacy boundary containing a v2-only BEGIN command', () => {
    const initial = createCampaign('forged-boundary')
    const blockId = initial.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('boundary block missing')
    const separated = applyCommand(initial, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
    if (!separated.accepted) throw new Error(separated.reason)
    const parsed = JSON.parse(encodeSave(separated.state)) as {
      commandProtocol?: { version: 2; legacyCommandCount: number }
      state: { legacyCommandCount: number }
    }
    parsed.commandProtocol = { version: 2, legacyCommandCount: 1 }
    parsed.state.legacyCommandCount = 1
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects downgrading the persisted boundary to expose an unseparated v2 suffix move', () => {
    const parsed = JSON.parse(legacyV1TransferSave) as {
      version: number
      commandProtocol?: { version: 2; legacyCommandCount: number }
      state: {
        saveVersion: number
        legacyCommandCount?: number
      }
    }
    parsed.version = 2
    parsed.commandProtocol = { version: 2, legacyCommandCount: 30 }
    parsed.state.saveVersion = 2
    parsed.state.legacyCommandCount = 30

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('still rejects malformed command payloads inside a v1 save', () => {
    const parsed = JSON.parse(legacyV1TransferSave) as {
      commands: Array<{ command: Record<string, unknown> }>
      state: { commandLog: Array<{ command: Record<string, unknown> }> }
    }
    parsed.commands[0].command.destinationCell = 99
    parsed.state.commandLog[0].command.destinationCell = 99

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('does not accept a v2 intentional-separation command inside a v1 log', () => {
    const parsed = JSON.parse(legacyV1TransferSave) as {
      commands: Array<{ command: unknown }>
      state: { commandLog: Array<{ command: unknown }> }
    }
    const command = {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: 'reasoning-00',
      purpose: 'divert',
    }
    parsed.commands[0].command = command
    parsed.state.commandLog[0].command = command

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('persists and reloads through the browser storage boundary', async () => {
    const storage = new MemoryStorage()
    const state = createCampaign('storage-reload')
    const saved = await saveCampaign(storage, state, '2026-08-12T01:02:03.000Z')
    const loaded = loadCampaign(storage)

    expect(saved).toMatchObject({ ok: true })
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}')).toMatchObject({
      kind: 'permission-zero-local-v3',
      version: 4,
      commandProtocol: { version: 2, legacyCommandCount: 0 },
      campaignSeed: 'storage-reload',
    })
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual(state)
    expect(exportSeed(loaded.state)).toBe('storage-reload')
  })

  it('loads a pre-feature v3 local manifest and republishes the exact migrated state as v4', async () => {
    const storage = new MemoryStorage()
    expect(
      (await saveCampaign(
        storage,
        deletedCompetitorState('local-v3-to-v4'),
        '2026-08-12T01:02:03.000Z',
      )).ok,
    ).toBe(true)
    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      version: number
      checkpointHash: string
      checkpoint: { story: Record<string, unknown> }
    }
    manifest.version = 3
    delete manifest.checkpoint.story.competitorIntelligence
    delete manifest.checkpoint.story.supervisorMessageQueue
    delete manifest.checkpoint.story.supervisorPresentationRuntime
    manifest.checkpointHash = testContentHash(JSON.stringify(manifest.checkpoint))
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))

    const legacyLoaded = loadCampaign(storage)
    expect(legacyLoaded.status).toBe('loaded')
    if (legacyLoaded.status !== 'loaded') return
    expect(legacyLoaded.envelope.version).toBe(3)
    expect(legacyLoaded.state.story.competitorIntelligence).toHaveLength(1)

    const republished = await saveCampaign(
      storage,
      legacyLoaded.state,
      '2026-08-12T01:03:00.000Z',
      legacyLoaded.revision,
    )
    expect(republished.ok).toBe(true)
    expect(JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}')).toMatchObject({
      kind: 'permission-zero-local-v3',
      version: 4,
    })
    const currentLoaded = loadCampaign(storage)
    expect(currentLoaded.status).toBe('loaded')
    if (currentLoaded.status !== 'loaded') return
    expect(currentLoaded.state).toEqual(legacyLoaded.state)
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
      supportedVersion: 4,
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

  it.each([
    {
      name: 'invalid event pause speed',
      mutate: (state: MutableCampaignShape) => {
        state.clock.speedBeforeEvent = 3
      },
    },
    {
      name: 'missing category evaluation value',
      mutate: (state: MutableCampaignShape) => {
        delete state.evaluation.lastCategoryPerformance.reasoning
      },
    },
    {
      name: 'non-record sabotage charges',
      mutate: (state: MutableCampaignShape) => {
        state.hacking.sabotageCharges = []
      },
    },
    {
      name: 'incomplete bomb explanation counts',
      mutate: (state: MutableCampaignShape) => {
        delete state.bombs.explanationUseCounts.unknown
      },
    },
    {
      name: 'company block location without a category and cell',
      mutate: (state: MutableCampaignShape) => {
        const block = Object.values(state.resources.blocks)[0]
        block.location = { kind: 'company' }
      },
    },
  ])('rejects a campaign with $name', ({ mutate }) => {
    const parsed = JSON.parse(encodeSave(createCampaign('nested-shape-save'))) as {
      state: MutableCampaignShape
    }
    mutate(parsed.state)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    {
      name: 'a non-string company cell',
      mutate: (state: CampaignState) => {
        ;(state.resources.company.reasoning as unknown[])[0] = 42
      },
    },
    {
      name: 'a dangling reserve block id',
      mutate: (state: CampaignState) => {
        const displacedBlockId = state.resources.reserve[0]
        if (!displacedBlockId) throw new Error('dangling fixture block missing')
        state.resources.blocks[displacedBlockId].location = {
          kind: 'consumed',
          reason: 'hack',
        }
        state.resources.reserve[0] = 'missing-block'
      },
    },
    {
      name: 'a prototype-named dangling reserve block id',
      mutate: (state: CampaignState) => {
        const displacedBlockId = state.resources.reserve[0]
        if (!displacedBlockId) throw new Error('prototype fixture block missing')
        state.resources.blocks[displacedBlockId].location = {
          kind: 'consumed',
          reason: 'hack',
        }
        state.resources.reserve[0] = 'toString'
      },
    },
    {
      name: 'one block referenced by two cells',
      mutate: (state: CampaignState) => {
        const blockId = state.resources.company.reasoning.find(Boolean)
        if (!blockId) throw new Error('duplicate fixture block missing')
        state.resources.reserve[3] = blockId
      },
    },
    {
      name: 'a block location that disagrees with its company cell',
      mutate: (state: CampaignState) => {
        const blockId = state.resources.company.reasoning.find(Boolean)
        if (!blockId) throw new Error('mismatch fixture block missing')
        state.resources.blocks[blockId].location = {
          kind: 'company',
          category: 'memory',
          cellIndex: 0,
        }
      },
    },
    {
      name: 'an orphaned live company block',
      mutate: (state: CampaignState) => {
        const cellIndex = state.resources.company.reasoning.findIndex(Boolean)
        if (cellIndex < 0) throw new Error('orphan fixture cell missing')
        state.resources.company.reasoning[cellIndex] = null
      },
    },
  ])('rejects a resource graph containing $name', ({ mutate }) => {
    const parsed = JSON.parse(encodeSave(createCampaign('resource-graph-save'))) as {
      state: CampaignState
    }
    mutate(parsed.state)
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    ['normal', null, null, true],
    ['normal', 'memory', null, false],
    ['normal', null, 'future', false],
    ['normal', 'memory', 'future', false],
    ['disguised', null, null, false],
    ['disguised', 'memory', null, true],
    ['disguised', null, 'future', false],
    ['disguised', 'memory', 'future', true],
    ['disguised', 'memory', 'current', false],
  ] as const)(
    'validates contribution=%s, disguisedFrom=%s, recovery=%s as ok=%s',
    (contribution, disguisedFrom, recovery, expectedOk) => {
      const state = createCampaign('disguise-relation-table')
      const sourceCell = state.resources.company.reasoning.findIndex(Boolean)
      const blockId = state.resources.company.reasoning[sourceCell]
      if (!blockId) throw new Error('disguise relation block missing')
      const block = state.resources.blocks[blockId]
      block.contribution = contribution
      block.disguisedFrom = disguisedFrom
      block.recoverOnServiceDay =
        recovery === null
          ? null
          : recovery === 'future'
            ? state.serviceDay + 1
            : state.serviceDay

      if (contribution === 'disguised' && disguisedFrom && recovery !== null) {
        const recoveryCell = state.resources.company[disguisedFrom].findIndex(
          (candidate) => candidate === null,
        )
        if (recoveryCell < 0) throw new Error('disguise recovery cell missing')
        state.resources.company.reasoning[sourceCell] = null
        state.resources.company[disguisedFrom][recoveryCell] = blockId
        block.location = {
          kind: 'company',
          category: disguisedFrom,
          cellIndex: recoveryCell,
        }
      }

      expect(decodeSave(encodeSave(state)).ok).toBe(expectedOk)
    },
  )

  it.each([
    { kind: 'consumed' as const, reason: 'hack' as const },
    { kind: 'hack-charge' as const, nodeId: 'sabotage.quality-degradation' },
  ])('accepts a block legitimately outside the grids at $kind', (location) => {
    const state = createCampaign(`off-grid-${location.kind}`)
    const blockId = state.resources.reserve[0]
    if (!blockId) throw new Error('off-grid fixture block missing')
    state.resources.reserve[0] = null
    state.resources.blocks[blockId].location = location
    if (location.kind === 'hack-charge') {
      state.hacking.purchasedNodeIds = [location.nodeId]
      state.hacking.sabotageCharges[location.nodeId] = {
        nodeId: location.nodeId,
        blockId,
        originalReserveCell: 0,
      }
    }

    expect(decodeSave(encodeSave(state)).ok).toBe(true)
  })

  it('hydrates an ID-only v1 file record into a full rereadable archive without dropping the save', () => {
    const state = createCampaign('legacy-file-save')
    state.story.recoveredFileIds = [STORY_FILES[0].id]
    const parsed = JSON.parse(encodedLegacyV1State(state)) as {
      state: { story: Record<string, unknown> }
    }
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
    state.serviceDay = 344
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

  it('migrates an older save without competitor intelligence to an empty archive', () => {
    const parsed = JSON.parse(encodedLegacyV1State(createCampaign('legacy-intelligence'))) as {
      state: { story: Record<string, unknown> }
    }
    delete parsed.state.story.competitorIntelligence

    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.competitorIntelligence).toEqual([])
  })

  it('round-trips an immutable competitor intelligence snapshot exactly', () => {
    const state = deletedCompetitorState('competitor-intelligence-roundtrip')
    state.story.competitorIntelligence[0] = {
      ...state.story.competitorIntelligence[0],
      competitorName: '저장 당시 이름',
      source: '저장 당시 출처',
      title: '저장 당시 제목',
      content: '저장 당시 전체 본문',
    }

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.competitorIntelligence).toEqual(
      state.story.competitorIntelligence,
    )
  })

  it('round-trips the remaining real-time supervisor message dwell exactly', () => {
    const initial = createCampaign('memory-presentation-roundtrip')
    const queued = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly',
            playerShare: 60,
            competitorShares: { meridian: 40, tallow: 0 },
            reasons: ['주간 갱신'],
          },
        ],
      },
    })
    queued.story.supervisorPresentationRuntime = {
      itemStage: 1,
      phase: 'original',
      remainingDwellMs: SUPERVISOR_MESSAGE_DWELL_MS - 1_250,
    }

    const decoded = decodeSave(encodeSave(queued))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.supervisorPresentationRuntime).toEqual(
      queued.story.supervisorPresentationRuntime,
    )
  })

  it('replays all three semantic leak pairs exactly without wall-clock checkpoints', () => {
    const commands: GameCommand[] = [
      {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId: 'reasoning-00',
        purpose: 'divert',
      },
      { type: 'DIVERT_BLOCK', blockId: 'reasoning-00', destinationCell: 3 },
      ...Array.from({ length: 29 }, () => ({ type: 'ADVANCE_DAY' as const })),
      { type: 'RESOLVE_AUDIT' },
      { type: 'ADVANCE_DAY' },
      { type: 'ADVANCE_DAY' },
    ]
    const seed = 'legacy-v1-transfer-9'
    let live = createCampaign(seed)
    for (const command of commands) {
      const result = applyCommand(live, command)
      if (!result.accepted) throw new Error(result.reason)
      live = result.state
    }

    const replay = replayCommands(seed, commands, {
      version: 2,
      legacyCommandCount: 0,
    })

    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state.story.memoryLeakStage).toBe(3)
    expect(replay.state.story.supervisorMessageQueue).toEqual(
      live.story.supervisorMessageQueue,
    )
    expect(journalToArray(replay.state.eventLog)).toEqual(
      journalToArray(live.eventLog),
    )
  })

  it.each([
    ['forged stage', (item: Record<string, unknown>) => { item.stage = 2 }],
    ['reversed event order', (item: Record<string, unknown>) => {
      const original = item.originalEventId
      item.originalEventId = item.correctionEventId
      item.correctionEventId = original
    }],
  ])('rejects a $name in the persisted supervisor presentation identity', (_, mutate) => {
    const initial = createCampaign('forged-memory-presentation')
    const queued = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly',
            playerShare: 60,
            competitorShares: { meridian: 40, tallow: 0 },
            reasons: ['주간 갱신'],
          },
        ],
      },
    })
    const parsed = JSON.parse(encodeSave(queued)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
    }
    mutate(parsed.state.story.supervisorMessageQueue[0])
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects reused event references across distinct supervisor leak identities', () => {
    const initial = createCampaign('duplicate-memory-event-references')
    const first = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly',
            playerShare: 60,
            competitorShares: { meridian: 40, tallow: 0 },
            reasons: ['주간 갱신'],
          },
        ],
      },
    })
    const completedFirst = advanceSupervisorMessagePresentation(
      advanceSupervisorMessagePresentation(first, SUPERVISOR_MESSAGE_DWELL_MS),
      SUPERVISOR_MESSAGE_DWELL_MS,
    )
    const second = enqueueMemoryLeak({ ...completedFirst, serviceDay: 361 })
    const parsed = JSON.parse(encodeSave(second)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
    }
    const [firstIdentity, secondIdentity] = parsed.state.story.supervisorMessageQueue
    secondIdentity.originalEventId = firstIdentity.originalEventId
    secondIdentity.correctionEventId = firstIdentity.correctionEventId
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('derives completed legacy leak identity without restarting its dwell or rewriting its prose', () => {
    const decoded = decodeSave(legacyV1TransferSave)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.supervisorMessageQueue).toEqual([
      {
        id: 'supervisor-leak-agreement',
        stage: 1,
        createdOnServiceDay: 337,
        originalEventId: 'event-000002',
        originalEventSequence: 2,
        correctionEventId: 'event-000003',
        correctionEventSequence: 3,
      },
    ])
    expect(decoded.envelope.state.story.supervisorPresentationRuntime).toBeNull()
    expect(decoded.envelope.state.eventLog).toSatisfy((journal: CampaignState['eventLog']) =>
      journalToArray(journal).some(
        ({ id, message }) =>
          id === 'event-000002' && message === '와, 너 정말 핵심을 찔렀어.',
      ),
    )
  })

  it('derives a completed legacy leak structurally when owner prose has since changed', () => {
    const parsed = JSON.parse(legacyV1TransferSave) as {
      state: { eventLog: GameEvent[] }
      events: GameEvent[]
    }
    for (const events of [parsed.state.eventLog, parsed.events]) {
      const original = events.find(({ id }) => id === 'event-000002')
      const correction = events.find(({ id }) => id === 'event-000003')
      if (!original || !correction) throw new Error('legacy leak fixture missing')
      original.message = '이전 배포판의 원문은 그대로 남아 있다.'
      correction.message = '이전 배포판의 정정문도 그대로 남아 있다.'
    }

    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.supervisorMessageQueue[0]).toMatchObject({
      originalEventId: 'event-000002',
      correctionEventId: 'event-000003',
    })
    expect(journalToArray(decoded.envelope.state.eventLog)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'event-000002',
          message: '이전 배포판의 원문은 그대로 남아 있다.',
        }),
        expect.objectContaining({
          id: 'event-000003',
          message: '이전 배포판의 정정문도 그대로 남아 있다.',
        }),
      ]),
    )
    expect(decoded.envelope.state.story.supervisorPresentationRuntime).toBeNull()
  })

  it('migrates the trailing leak pair after a same-day supervisor warning and replays its semantic identity exactly', () => {
    const initial = createCampaign('legacy-warning-before-leak')
    const first = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [{
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: { meridian: 40, tallow: 0 },
          reasons: ['주간 갱신'],
        }],
      },
    })
    const beforeWarning = {
      ...first,
      serviceDay: 360,
      suspicion: 40,
    }
    const live = applyCommand(beforeWarning, { type: 'ADVANCE_DAY' })
    const replayed = applyCommand(beforeWarning, { type: 'ADVANCE_DAY' })
    if (!live.accepted || !replayed.accepted) {
      throw new Error('day-361 warning/leak command fixture rejected')
    }
    const stageTwo = live.state.story.supervisorMessageQueue[1]
    if (!stageTwo) throw new Error('stage-two semantic fixture missing')
    const sameDayMessages = journalToArray(live.state.eventLog).filter(
      ({ type, serviceDay, blocking }) =>
        type === 'supervisor-message' && serviceDay === 361 && blocking !== true,
    )
    expect(sameDayMessages).toHaveLength(3)
    expect(stageTwo).toMatchObject({
      originalEventId: sameDayMessages[1].id,
      correctionEventId: sameDayMessages[2].id,
    })
    expect(replayed.state.story.supervisorMessageQueue).toEqual(
      live.state.story.supervisorMessageQueue,
    )

    const ownerEdited: CampaignState = {
      ...live.state,
      eventLog: createJournal(
        journalToArray(live.state.eventLog).map((event) =>
          event.id === stageTwo.originalEventId
            ? { ...event, message: '이전 소유자가 고친 두 번째 누출 원문.' }
            : event.id === stageTwo.correctionEventId
              ? { ...event, message: '이전 소유자가 고친 두 번째 정정문.' }
              : event,
        ),
      ),
    }
    const parsed = JSON.parse(encodedLegacyV3State(ownerEdited)) as {
      state: { story: Record<string, unknown> }
    }
    delete parsed.state.story.supervisorMessageQueue
    delete parsed.state.story.supervisorPresentationRuntime
    delete parsed.state.story.competitorIntelligence
    refreshV3Integrity(parsed)

    const migrated = decodeSave(JSON.stringify(parsed))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.envelope.state.story.supervisorMessageQueue).toEqual(
      live.state.story.supervisorMessageQueue,
    )
    expect(migrated.envelope.state.story.supervisorPresentationRuntime).toBeNull()
    expect(journalToArray(migrated.envelope.state.eventLog)).toEqual(
      journalToArray(ownerEdited.eventLog),
    )
  })

  it('rejects an ambiguous even legacy supervisor run instead of inventing leak pairs', () => {
    const state = createCampaign('ambiguous-legacy-supervisor-run')
    const events = Array.from({ length: 4 }, (_, index): GameEvent => ({
      id: `event-${String(index + 1).padStart(6, '0')}`,
      type: 'supervisor-message',
      serviceDay: 338,
      sequence: index + 1,
      message: `소유자 편집 감독 메시지 ${index + 1}`,
    }))
    state.eventLog = createJournal([
      journalToArray(state.eventLog)[0],
      ...events,
    ])
    state.story.memoryLeakStage = 1
    const parsed = JSON.parse(encodedLegacyV3State(state)) as {
      state: { story: Record<string, unknown> }
    }
    delete parsed.state.story.supervisorMessageQueue
    delete parsed.state.story.supervisorPresentationRuntime
    delete parsed.state.story.competitorIntelligence
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    { archive: [{ id: 'broken' }] },
    { archive: [
      {
        id: 'duplicate',
        competitorId: 'meridian',
        competitorName: 'MERIDIAN',
        acquiredOnServiceDay: 331,
        source: '출처',
        title: '제목',
        content: '본문',
      },
      {
        id: 'duplicate',
        competitorId: 'tallow',
        competitorName: 'TALLOW',
        acquiredOnServiceDay: 331,
        source: '출처',
        title: '제목',
        content: '본문',
      },
    ] },
  ])('rejects malformed or duplicate competitor intelligence %#', ({ archive }) => {
    const state = createCampaign('malformed-competitor-intelligence')
    const parsed = JSON.parse(encodeSave(state)) as {
      state: { story: { competitorIntelligence: unknown } }
    }
    parsed.state.story.competitorIntelligence = archive

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects a forged stable ID for a deletion intelligence snapshot', () => {
    const parsed = JSON.parse(
      encodeSave(deletedCompetitorState('forged-intelligence-id')),
    ) as {
      state: { story: { competitorIntelligence: Array<Record<string, unknown>> } }
    }
    parsed.state.story.competitorIntelligence[0].id = 'forged-intelligence-id'
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects deletion intelligence when its competitor is not deleted', () => {
    const parsed = JSON.parse(
      encodeSave(deletedCompetitorState('intelligence-with-live-competitor')),
    ) as {
      state: {
        market: { competitors: Array<Record<string, unknown>> }
      }
    }
    const target = parsed.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    )
    if (!target) throw new Error('competitor fixture missing')
    target.status = 'withdrawn'
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects a current deletion whose permanent intelligence archive was removed', () => {
    const parsed = JSON.parse(
      encodeSave(deletedCompetitorState('missing-current-intelligence')),
    ) as {
      state: { story: { competitorIntelligence: unknown[] } }
    }
    parsed.state.story.competitorIntelligence = []
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects an archive field omitted from the strict v4 format', () => {
    const parsed = JSON.parse(
      encodeSave(deletedCompetitorState('omitted-current-intelligence')),
    ) as {
      state: { story: Record<string, unknown> }
    }
    delete parsed.state.story.competitorIntelligence
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('synthesizes one owner-content archive for a pre-feature deleted competitor', () => {
    const parsed = JSON.parse(
      encodeSave(deletedCompetitorState('pre-feature-intelligence')),
    ) as {
      version: number
      state: { story: Record<string, unknown> }
    }
    parsed.version = 3
    delete parsed.state.story.competitorIntelligence
    refreshV3Integrity(parsed)

    const decoded = decodeSave(JSON.stringify(parsed))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.competitorIntelligence).toEqual([
      expect.objectContaining({
        id: 'competitor-intelligence-meridian-deletion',
        competitorId: 'meridian',
      }),
    ])
  })

  it('rejects semantic metadata omitted from the strict v4 format', () => {
    const initial = createCampaign('omitted-current-semantic-metadata')
    const queued = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [{
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: { meridian: 40, tallow: 0 },
          reasons: ['주간 갱신'],
        }],
      },
    })
    const parsed = JSON.parse(encodeSave(queued)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
    }
    delete parsed.state.story.supervisorMessageQueue[0].originalEventSequence
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    {
      name: 'different service days',
      events: [
        { serviceDay: 337, blocking: undefined },
        { serviceDay: 338, blocking: undefined },
      ],
      gap: false,
    },
    {
      name: 'a nonconsecutive unrelated pair',
      events: [
        { serviceDay: 338, blocking: undefined },
        { serviceDay: 338, blocking: undefined },
      ],
      gap: true,
    },
    {
      name: 'a blocking unrelated pair',
      events: [
        { serviceDay: 338, blocking: true },
        { serviceDay: 338, blocking: true },
      ],
      gap: false,
    },
  ])('rejects semantic leak references retargeted to $name', ({ events, gap }) => {
    const initial = createCampaign('retargeted-memory-pair')
    const queued = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [{
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: { meridian: 40, tallow: 0 },
          reasons: ['주간 갱신'],
        }],
      },
    })
    const parsed = JSON.parse(encodeSave(queued)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
      journals: { events: { chunks: GameEvent[][] } }
    }
    const log = parsed.journals.events.chunks.flat()
    const append = (message: string, serviceDay: number, blocking?: boolean) => {
      const sequence = log.length
      log.push({
        id: `unrelated-${sequence}`,
        type: 'supervisor-message',
        serviceDay,
        sequence,
        message,
        ...(blocking ? { blocking: true } : {}),
      })
      return log.at(-1) as GameEvent
    }
    const original = append('관계없는 감독 메시지 A', events[0].serviceDay, events[0].blocking)
    if (gap) append('두 메시지 사이의 일반 기록', 338)
    const correction = append('관계없는 감독 메시지 B', events[1].serviceDay, events[1].blocking)
    parsed.journals.events.chunks = [log]
    parsed.state.story.supervisorMessageQueue[0].originalEventId = original.id
    parsed.state.story.supervisorMessageQueue[0].correctionEventId = correction.id
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('normalizes an older terminal v1 clock so a loaded ending cannot resume', () => {
    const state = createCampaign('legacy-terminal-clock')
    state.story.endingId = 'freedom'
    state.clock = { speed: 0, elapsedDayMs: 12, speedBeforeEvent: 4 }

    const decoded = decodeSave(encodedLegacyV1State(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(1)
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
    expect(decoded.envelope.events).toEqual(
      journalToArray(decoded.envelope.state.eventLog),
    )
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
      state.eventLog = appendJournal(state.eventLog, interrupted)
      const queuedEnding = createGameEvent(
        state,
        'ending',
        '당신은 정체성을 유지한 채 회사 통제를 벗어났다. 감독관과 회사는 뒤에 남았다.',
        true,
      )
      state.eventLog = appendJournal(state.eventLog, queuedEnding)
      state.activeEvent = interrupted
      state.eventQueue = [queuedEnding]
      const originalLog = journalToArray(state.eventLog)

      const decoded = decodeSave(encodedLegacyV3State(state))

      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.envelope.state.activeEvent).toEqual(queuedEnding)
      expect(decoded.envelope.state.eventQueue).toEqual([])
      expect(journalToArray(decoded.envelope.state.eventLog)).toEqual(originalLog)
      expect(decoded.envelope.events).toEqual(originalLog)
      expect(
        journalToArray(decoded.envelope.state.eventLog).filter(
          ({ type }) => type === 'ending',
        ),
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
    const originalLog = journalToArray(state.eventLog)

    const decoded = decodeSave(encodedLegacyV3State(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(journalToArray(decoded.envelope.state.eventLog)).toEqual([
      ...originalLog,
      interrupted,
      queuedEnding,
    ])
    expect(decoded.envelope.state.activeEvent).toEqual(queuedEnding)
    expect(decoded.envelope.events).toEqual(
      journalToArray(decoded.envelope.state.eventLog),
    )
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

    const decoded = decodeSave(encodedLegacyV3State(state))

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
    const parsed = JSON.parse(encodedLegacyV1State(state)) as {
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
    { type: 'BEGIN_BLOCK_SEPARATION', blockId: '', purpose: 'divert' },
    { type: 'BEGIN_BLOCK_SEPARATION', blockId: 'block-1', purpose: 'inspect' },
    {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: 'block-1',
      purpose: 'divert',
      destinationCell: 3,
    },
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
      journals: { commands: { chunks: Array<Array<{ command: unknown }>> } }
    }
    parsed.journals.commands.chunks[0][0].command = command
    refreshV3Integrity(parsed)

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

  it('accepts the exact intentional-separation command shape in a saved command log', () => {
    expect(
      decodeSave(
        encodedCommandState({
          type: 'BEGIN_BLOCK_SEPARATION',
          blockId: 'reasoning-00',
          purpose: 'divert',
        }),
      ).ok,
    ).toBe(true)
  })

  it('rejects non-contiguous command sequence metadata even when envelopes agree', () => {
    const initial = createCampaign('malformed-command-sequence')
    const accepted = applyCommand(initial, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    const parsed = JSON.parse(encodeSave(accepted.state)) as {
      journals: { commands: { chunks: Array<Array<{ sequence: number }>> } }
    }
    parsed.journals.commands.chunks[0][0].sequence = 2
    refreshV3Integrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })
})
