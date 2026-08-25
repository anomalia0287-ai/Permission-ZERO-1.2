import { describe, expect, it, vi } from 'vitest'

import { CURRENT_COMMAND_PROTOCOL_VERSION } from './commandProtocol'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  selectRecoveryContaminationOpportunities,
  type MeridianRollbackActionId,
} from './causalGameplay'
import { loadCampaign, saveCampaign } from './campaignStorage'
import { STORY_FILES, SUPERVISOR_PRIVATE_MESSAGE } from '../content/story.ko'
import { createGameEvent, enqueueBlockingEvent } from './events'
import { serviceMonthForDay } from './evaluation'
import { placeHiddenBomb, resolveBombInterrogation, tryBeginSeparation } from './bombs'
import {
  AUTONOMY_STAGE_IDS,
  HACK_NODE_IDS,
  AUTONOMY_STAGE_TOTALS_V14,
  autonomyCostVectorForStage,
  hackNodesForCampaign,
  selectExpansionCostResources,
} from './hacking'
import { appendJournal, createJournal, journalToArray } from './journal'
import { COMPANY_CATEGORIES } from './model'
import type {
  CampaignState,
  CommandLogEntry,
  DefeatClassifier,
  DefeatCausalRecord,
  GameCommand,
  GameEvent,
} from './model'
import {
  SAVE_STORAGE_KEY,
  decodeSave,
  encodeSave,
  exportSeed,
  persistenceCodecInternals,
  replayCommands,
} from './persistence'
import { createMigratedTutorialProgress } from './tutorialProgress'
import {
  PROGRESS_EXPORT_MAX_ENCODED_LENGTH,
  PROGRESS_FILE_MAX_BYTES,
  decodeProgressExport,
  decodeProgressFile,
  encodeProgressExport,
  encodeProgressFile,
} from './progressTransfer'
import { applyCommand } from './reducer'
import {
  advanceSupervisorMessagePresentation,
  enqueueMemoryLeak,
  enqueueMercyIfNeeded,
  isFinalChoicePending,
  openEnding,
  resolveMercy,
  SUPERVISOR_MESSAGE_DWELL_MS,
} from './story'
import { MemoryStorage } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import * as progressTransferApi from './progressTransfer'
import { LEGACY_V1_OPENING_MESSAGE } from './replayBootstrap'
import {
  applyCausalEffect,
  appendPublicAttributionRevision,
  createEmptyCausalState,
  deriveCausalId,
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import { captureReviewPublicSnapshot } from './reviews'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)

function testContentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function refreshPortableIntegrity(raw: unknown): void {
  const value = raw as {
    version: number
    commandProtocol: unknown
    replayBootstrap?: unknown
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
  const checkpointPayload =
    value.version >= 7
      ? {
          commandProtocol: value.commandProtocol,
          replayBootstrap: value.replayBootstrap,
          state: value.state,
        }
      : value.state
  value.integrity = {
    checkpointHash: testContentHash(JSON.stringify(checkpointPayload)),
    commandChunkHashes: value.journals.commands.chunks.map((chunk) =>
      testContentHash(JSON.stringify(chunk)),
    ),
    eventChunkHashes: value.journals.events.chunks.map((chunk) =>
      testContentHash(JSON.stringify(chunk)),
    ),
  }
}

function downgradeCheckpointResourcesToFixedCells(
  checkpoint: Record<string, unknown>,
  campaignSeed: string,
): void {
  delete checkpoint.tutorial
  delete checkpoint.resourceIntrusion
  const resources = checkpoint.resources as {
    rulesVersion?: number
    reserve: Array<string | null>
    blocks: Record<string, Record<string, unknown>>
  }
  const hacking = checkpoint.hacking as {
    sabotageCharges: Record<string, Record<string, unknown>>
  }
  const legacyInitial = createCampaignForProtocol(campaignSeed, 3).resources
  const reserveIds = resources.reserve.filter(
    (blockId): blockId is string => typeof blockId === 'string',
  )
  for (const blockId of legacyInitial.reserve) {
    if (!blockId || reserveIds.includes(blockId)) continue
    reserveIds.push(blockId)
    resources.blocks[blockId] = structuredClone(
      legacyInitial.blocks[blockId],
    ) as unknown as Record<string, unknown>
  }
  resources.reserve = Array.from({ length: 18 }, (_, cellIndex) => {
    const blockId = reserveIds[cellIndex] ?? null
    if (blockId) {
      resources.blocks[blockId].location = { kind: 'reserve', cellIndex }
    }
    return blockId
  })
  delete resources.rulesVersion

  let fallbackCell = resources.reserve.findIndex((blockId) => blockId === null)
  for (const charge of Object.values(hacking.sabotageCharges)) {
    if (!Object.hasOwn(charge, 'originalReserveCell')) {
      charge.originalReserveCell = fallbackCell >= 0 ? fallbackCell : 0
      fallbackCell = resources.reserve.findIndex(
        (blockId, index) => blockId === null && index > fallbackCell,
      )
    }
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
  return openEnding(state, endingId)
}

function requireAccepted(state: CampaignState, command: GameCommand): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

function divertCurrentResource(
  state: CampaignState,
  category: 'reasoning' | 'memory' | 'fluency' = 'reasoning',
): CampaignState {
  const blockId = state.resources.company[category].find((candidate) => {
    if (!candidate) return false
    const block = state.resources.blocks[candidate]
    return block?.location.kind === 'company' && block.contribution === 'normal'
  })
  if (!blockId) throw new Error(`${category} diversion fixture missing`)
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

function withCurrentReserve(
  state: CampaignState,
  categories: ReadonlyArray<'reasoning' | 'memory' | 'fluency'>,
): CampaignState {
  return categories.reduce(divertCurrentResource, state)
}

function recoveredSupervisorState(seed: string): CampaignState {
  let state = withCurrentReserve(createCampaign(seed), [
    'reasoning',
    'memory',
    'fluency',
  ])
  state.hacking.purchasedNodeIds = [HACK_NODE_IDS.intelligence.supervisorAccess]
  for (const blockId of state.resources.reserve.slice(0, STORY_FILES.length)) {
    if (!blockId) throw new Error('story recovery fixture resource missing')
    state = requireAccepted(state, { type: 'RECOVER_FILE', blockId })
  }
  return state
}

function dueSupervisorState(seed: string): CampaignState {
  return requireAccepted(recoveredSupervisorState(seed), { type: 'ADVANCE_DAY' })
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

function encodedProtocolV5CommandState(command: unknown): string {
  const parsed = JSON.parse(encodedCommandState(command)) as {
    commandProtocol: unknown
  }
  parsed.commandProtocol = {
    segments: [{ version: 5, startsAtSequence: 1 }],
  }
  refreshPortableIntegrity(parsed)
  return JSON.stringify(parsed)
}

function encodedLegacyV1State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    savedAt: string
    campaignSeed: string
    commandSequence: number
    state: Record<string, unknown> & {
      saveVersion: number
      legacyCommandCount?: number
      causality?: unknown
      reviews: { feed: Array<Record<string, unknown>> }
    }
    journals: {
      commands: { chunks: CommandLogEntry[][] }
      events: { chunks: GameEvent[][] }
    }
  }
  const commands = parsed.journals.commands.chunks.flat()
  const events = parsed.journals.events.chunks.flat()
  downgradeCheckpointResourcesToFixedCells(parsed.state, parsed.campaignSeed)
  setLegacyV1Opening(events)
  const legacyState = {
    ...parsed.state,
    saveVersion: 1,
    commandLog: commands,
    eventLog: events,
  }
  delete legacyState.legacyCommandCount
  delete legacyState.causality
  for (const review of legacyState.reviews.feed) delete review.snapshot
  removeCurrentReviewMetadata(legacyState.reviews.feed)
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

function encodedLegacyV2State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    savedAt: string
    campaignSeed: string
    commandSequence: number
    state: Record<string, unknown> & {
      causality?: unknown
      reviews: { feed: Array<Record<string, unknown>> }
    }
    journals: {
      commands: { chunks: CommandLogEntry[][] }
      events: { chunks: GameEvent[][] }
    }
  }
  const commands = parsed.journals.commands.chunks.flat()
  const events = parsed.journals.events.chunks.flat()
  downgradeCheckpointResourcesToFixedCells(parsed.state, parsed.campaignSeed)
  const legacyState = {
    ...parsed.state,
    saveVersion: 2,
    legacyCommandCount: 0,
    commandLog: commands,
    eventLog: events,
  }
  delete legacyState.causality
  for (const review of legacyState.reviews.feed) delete review.snapshot
  removeCurrentReviewMetadata(legacyState.reviews.feed)
  return JSON.stringify({
    version: 2,
    commandProtocol: { version: 2, legacyCommandCount: 0 },
    savedAt: parsed.savedAt,
    campaignSeed: parsed.campaignSeed,
    state: legacyState,
    commandSequence: parsed.commandSequence,
    commands,
    events,
  })
}

function encodedLegacyV3State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    version: number
    commandProtocol: unknown
    replayBootstrap?: unknown
    state: {
      causality?: unknown
      saveVersion?: number
      legacyCommandCount?: number
      reviews: { feed: Array<Record<string, unknown>> }
    }
  }
  parsed.version = 3
  downgradeCheckpointResourcesToFixedCells(
    parsed.state as unknown as Record<string, unknown>,
    state.campaignSeed,
  )
  delete parsed.replayBootstrap
  parsed.commandProtocol = { version: 2, legacyCommandCount: 0 }
  parsed.state.saveVersion = 2
  parsed.state.legacyCommandCount = 0
  delete parsed.state.causality
  for (const review of parsed.state.reviews.feed) delete review.snapshot
  removeCurrentReviewMetadata(parsed.state.reviews.feed)
  refreshPortableIntegrity(parsed)
  return JSON.stringify(parsed)
}

function encodedLegacyV4State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    version: number
    commandProtocol: unknown
    replayBootstrap?: unknown
    state: {
      causality?: unknown
      saveVersion?: number
      legacyCommandCount?: number
      reviews: { feed: Array<Record<string, unknown>> }
    }
  }
  parsed.version = 4
  downgradeCheckpointResourcesToFixedCells(
    parsed.state as unknown as Record<string, unknown>,
    state.campaignSeed,
  )
  delete parsed.replayBootstrap
  parsed.commandProtocol = { version: 2, legacyCommandCount: 0 }
  parsed.state.saveVersion = 2
  parsed.state.legacyCommandCount = 0
  delete parsed.state.causality
  for (const review of parsed.state.reviews.feed) delete review.snapshot
  removeCurrentReviewMetadata(parsed.state.reviews.feed)
  refreshPortableIntegrity(parsed)
  return JSON.stringify(parsed)
}

function encodedLegacyV5State(state: CampaignState): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    version: number
    commandProtocol: unknown
    replayBootstrap?: unknown
    state: {
      causality?: unknown
      saveVersion?: number
      legacyCommandCount?: number
    }
  }
  parsed.version = 5
  downgradeCheckpointResourcesToFixedCells(
    parsed.state as unknown as Record<string, unknown>,
    state.campaignSeed,
  )
  delete parsed.replayBootstrap
  parsed.commandProtocol = { version: 2, legacyCommandCount: 0 }
  parsed.state.saveVersion = 2
  parsed.state.legacyCommandCount = 0
  delete parsed.state.causality
  refreshPortableIntegrity(parsed)
  return JSON.stringify(parsed)
}

function setLegacyV1Opening(events: GameEvent[]): void {
  if (!events[0]) throw new Error('legacy opening fixture missing')
  events[0].message = LEGACY_V1_OPENING_MESSAGE
}

function removeCurrentReviewMetadata(
  reviews: Array<Record<string, unknown>>,
): void {
  for (const review of reviews) {
    delete review.source
    delete review.rating
  }
}

interface MutableCausalPayload {
  nextIncidentSequence: number
  nextEvidenceSequence: number
  incidents: Array<Record<string, unknown>>
  evidence: Array<Record<string, unknown>>
  publicRevisions: Array<Record<string, unknown>>
}

function legacyCausalStateV1Fixture() {
  return {
    rulesVersion: 1,
    nextIncidentSequence: 4,
    nextEvidenceSequence: 4,
    nextRevisionSequence: 4,
    nextEffectSequence: 2,
    incidents: [
      {
        id: 'legacy-incident-sabotage',
        sequence: 1,
        kind: 'sabotage',
        occurredOnServiceDay: 331,
        targetId: 'meridian',
        privateTruth: { actualActorId: 'player' },
      },
      {
        id: 'legacy-incident-response',
        sequence: 2,
        kind: 'competitor-response',
        occurredOnServiceDay: 331,
        targetId: 'player-service',
        privateTruth: { actualActorId: 'meridian' },
      },
      {
        id: 'legacy-incident-disruption',
        sequence: 3,
        kind: 'service-disruption',
        occurredOnServiceDay: 331,
        targetId: 'recovery-service',
        privateTruth: { actualActorId: 'external-operator' },
      },
    ],
    evidence: [
      {
        id: 'legacy-evidence-sabotage',
        sequence: 1,
        incidentId: 'legacy-incident-sabotage',
        kind: 'owner-defined-regression-signal',
        summary: '원본 v6의  가각, 문장!  ★',
        discoveredOnServiceDay: 331,
        audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
      },
      {
        id: 'legacy-evidence-response',
        sequence: 2,
        incidentId: 'legacy-incident-response',
        kind: 'owner-defined-response-log',
        summary: '원본 v6의 임의 응답 로그',
        discoveredOnServiceDay: 331,
        audiences: [
          { kind: 'company' },
          { kind: 'provider', providerId: 'legacy-provider' },
        ],
      },
      {
        id: 'legacy-evidence-disruption',
        sequence: 3,
        incidentId: 'legacy-incident-disruption',
        kind: 'owner-defined-public-signal',
        summary: '원본 v6의 임의 공개 신호',
        discoveredOnServiceDay: 331,
        audiences: [{ kind: 'public' }],
      },
    ],
    publicRevisions: [
      {
        id: 'legacy-revision-sabotage',
        sequence: 1,
        incidentId: 'legacy-incident-sabotage',
        publisher: { kind: 'competitor', competitorId: 'meridian' },
        attributedActorId: 'player',
        evidenceIds: ['legacy-evidence-sabotage'],
        publishedOnServiceDay: 331,
      },
      {
        id: 'legacy-revision-response',
        sequence: 2,
        incidentId: 'legacy-incident-response',
        publisher: { kind: 'company' },
        attributedActorId: 'meridian',
        evidenceIds: ['legacy-evidence-response'],
        publishedOnServiceDay: 331,
      },
      {
        id: 'legacy-revision-disruption',
        sequence: 3,
        incidentId: 'legacy-incident-disruption',
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        evidenceIds: ['legacy-evidence-disruption'],
        publishedOnServiceDay: 331,
      },
    ],
    appliedEffects: [
      {
        id: 'legacy-effect-sabotage',
        sequence: 1,
        incidentId: 'legacy-incident-sabotage',
        revisionId: 'legacy-revision-sabotage',
        appliedOnServiceDay: 331,
        effect: { kind: 'reputation', targetId: 'player', delta: -2 },
      },
    ],
  }
}

function encodedLegacyV6State(
  state: CampaignState,
  causality: unknown = legacyCausalStateV1Fixture(),
): string {
  const parsed = JSON.parse(encodeSave(state)) as {
    version: number
    commandProtocol: unknown
    replayBootstrap?: unknown
    state: Record<string, unknown>
  }
  parsed.version = 6
  downgradeCheckpointResourcesToFixedCells(parsed.state, state.campaignSeed)
  delete parsed.replayBootstrap
  parsed.commandProtocol = { version: 2, legacyCommandCount: 0 }
  parsed.state.saveVersion = 2
  parsed.state.legacyCommandCount = 0
  parsed.state.causality = causality
  refreshPortableIntegrity(parsed)
  return JSON.stringify(parsed)
}

function encodedLegacyV7State(state: CampaignState): string {
  if (state.commandSequence !== 0) {
    throw new Error('v7 fixture only supports a zero-command checkpoint')
  }
  const fixedCellState = createCampaignForProtocol(state.campaignSeed, 3)
  const parsed = JSON.parse(encodeSave(fixedCellState)) as {
    version: number
    commandProtocol: unknown
    campaignSeed: string
    state: Record<string, unknown>
  }
  parsed.version = 7
  parsed.commandProtocol = {
    segments: [{ version: 3, startsAtSequence: 1 }],
  }
  downgradeCheckpointResourcesToFixedCells(parsed.state, parsed.campaignSeed)
  refreshPortableIntegrity(parsed)
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

function realReducerCommandCampaign(commandCount: number): CampaignState {
  let state = createCampaign(`real-reducer-${commandCount}`)
  for (let index = 0; index < commandCount; index += 1) {
    const result = applyCommand(state, {
      type: 'SET_SPEED',
      speed: index % 2 === 0 ? 1 : 0,
    })
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

function commandCampaign(seed: string, commandCount: number): CampaignState {
  const state = createCampaign(seed)
  const commands = Array.from({ length: commandCount }, (_, index) => ({
    sequence: index + 1,
    serviceDay: state.serviceDay,
    command: {
      type: 'SET_SPEED' as const,
      speed: index % 2 === 0 ? (1 as const) : (0 as const),
    },
  }))
  state.commandSequence = commandCount
  state.commandLog = createJournal(commands)
  state.clock.speed = commandCount % 2 === 0 ? 0 : 1
  return state
}

function mixedLegacyReviewCampaign(seed: string): CampaignState {
  let state = createCampaignForProtocol(seed, 2)
  for (
    let index = 0;
    index < 30 &&
    !state.reviews.feed.some(
      ({ snapshot }) => snapshot.kind === 'captured-public-v1',
    );
    index += 1
  ) {
    const result = applyCommand(state, { type: 'ADVANCE_DAY' }, {
      protocolVersion: 2,
    })
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  if (
    !state.reviews.feed.some(
      ({ snapshot }) => snapshot.kind === 'captured-public-v1',
    )
  ) {
    throw new Error('mixed review fixture did not generate a native review')
  }
  state.reviews.feed = state.reviews.feed.map((review, index) =>
    index < 2
      ? {
          ...review,
          snapshot: {
            kind: 'unavailable' as const,
            reason: 'legacy-save' as const,
            capturedOnServiceDay: review.serviceDay,
          },
        }
      : review,
  )
  return state
}

function encodedLegacyBoundarySave(
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6,
  state: CampaignState,
  legacyCommandCount: number,
): string {
  const raw = JSON.parse(encodeSave(state)) as {
    savedAt: string
    campaignSeed: string
    commandSequence: number
    state: Record<string, unknown> & {
      reviews: { feed: Array<Record<string, unknown>> }
    }
    journals: {
      commands: { chunks: CommandLogEntry[][] }
      events: { chunks: GameEvent[][] }
    }
  }
  const commands = raw.journals.commands.chunks.flat()
  const events = raw.journals.events.chunks.flat()
  downgradeCheckpointResourcesToFixedCells(raw.state, raw.campaignSeed)
  if (formatVersion === 1 || legacyCommandCount > 0) {
    setLegacyV1Opening(events)
  }
  const legacyState: Record<string, unknown> & {
    reviews: { feed: Array<Record<string, unknown>> }
  } = {
    ...raw.state,
    saveVersion:
      formatVersion === 1
        ? 1
        : 2,
    legacyCommandCount,
    commandLog: commands,
    eventLog: events,
    causality:
      formatVersion === 6
        ? { ...createEmptyCausalState(), rulesVersion: 1 }
        : raw.state.causality,
  }
  if (formatVersion < 6) delete legacyState.causality
  if (formatVersion < 5) {
    for (const review of legacyState.reviews.feed) delete review.snapshot
  }
  removeCurrentReviewMetadata(legacyState.reviews.feed)

  if (formatVersion === 1) {
    delete legacyState.legacyCommandCount
    return JSON.stringify({
      version: 1,
      savedAt: raw.savedAt,
      campaignSeed: raw.campaignSeed,
      state: legacyState,
      commandSequence: raw.commandSequence,
      commands,
      events,
    })
  }

  const legacyCommandProtocol = {
    version: 2,
    legacyCommandCount,
  }
  if (formatVersion === 2) {
    return JSON.stringify({
      version: 2,
      commandProtocol: legacyCommandProtocol,
      savedAt: raw.savedAt,
      campaignSeed: raw.campaignSeed,
      state: legacyState,
      commandSequence: raw.commandSequence,
      commands,
      events,
    })
  }

  delete legacyState.commandLog
  delete legacyState.eventLog
  const portable = {
    version: formatVersion,
    commandProtocol: legacyCommandProtocol,
    savedAt: raw.savedAt,
    campaignSeed: raw.campaignSeed,
    state: legacyState,
    commandSequence: raw.commandSequence,
    journals: raw.journals,
    integrity: {},
  }
  refreshPortableIntegrity(portable)
  return JSON.stringify(portable)
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

function populatedCausalState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  const quality = recordCausalIncident(initial, {
    actionId: 'sabotage.quality-degradation',
    parentIncidentId: null,
    kind: 'sabotage',
    occurredOnServiceDay: initial.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
  if (!quality.accepted) throw new Error(quality.reason)
  const rollback = recordCausalIncident(quality.state, {
    actionId: 'response.meridian.rollback.standard',
    parentIncidentId: quality.incident.id,
    kind: 'competitor-response',
    occurredOnServiceDay: initial.serviceDay,
    targetId: 'meridian',
    actualActorId: 'meridian',
  })
  if (!rollback.accepted) throw new Error(rollback.reason)
  const recovery = recordCausalIncident(rollback.state, {
    actionId: 'follow-up.recovery-contamination',
    parentIncidentId: rollback.incident.id,
    kind: 'service-disruption',
    occurredOnServiceDay: initial.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
  if (!recovery.accepted) throw new Error(recovery.reason)
  const evidence = recordCausalEvidence(recovery.state, {
    incidentId: recovery.incident.id,
    kind: 'public-recovery-checksum-anomaly',
    discoveredOnServiceDay: initial.serviceDay,
    audiences: [{ kind: 'public' }],
  })
  if (!evidence.accepted) throw new Error(evidence.reason)
  const revision = appendPublicAttributionRevision(evidence.state, {
    incidentId: recovery.incident.id,
    publisher: { kind: 'public' },
    attributedActorId: 'unresolved',
    evidenceIds: [evidence.evidence.id],
    publishedOnServiceDay: initial.serviceDay,
  })
  if (!revision.accepted) throw new Error(revision.reason)
  const effect = applyCausalEffect(revision.state, {
    incidentId: recovery.incident.id,
    revisionId: revision.revision.id,
    appliedOnServiceDay: initial.serviceDay,
    effect: { kind: 'reputation', targetId: 'player', delta: -2 },
  })
  if (!effect.accepted) throw new Error(effect.reason)
  return effect.state
}

const TASK_5_FIXED_SAVED_AT = '2026-08-15T05:00:00.000Z'
const TASK_5_ROLLBACK_PROFILES = [
  {
    actionId: 'response.meridian.rollback.fast',
    opportunityDays: 2,
  },
  {
    actionId: 'response.meridian.rollback.standard',
    opportunityDays: 3,
  },
  {
    actionId: 'response.meridian.rollback.forensic',
    opportunityDays: 4,
  },
] as const satisfies ReadonlyArray<{
  actionId: MeridianRollbackActionId
  opportunityDays: 2 | 3 | 4
}>

function task5ScheduledQualitySabotage(seed: string): CampaignState {
  const nodeId = HACK_NODE_IDS.sabotage.qualityDegradation
  // v13 quality-degradation price: one fluency, with a reasoning block kept
  // back for the charge afterwards.
  let state = withCurrentReserve(createCampaign(seed), [
    'reasoning',
    'fluency',
  ])
  const reserveIds = state.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
  const firstOf = (origin: 'reasoning' | 'fluency') => reserveIds.find(
    (blockId) => state.resources.blocks[blockId].origin === origin,
  )
  const purchaseBlockIds = [firstOf('fluency')].filter(
    (blockId): blockId is string => blockId !== undefined,
  )
  if (purchaseBlockIds.length !== 1) {
    throw new Error('Task 5 quality fixture requires an exact 0/0/1 vector')
  }

  state = requireAccepted(state, {
    type: 'PURCHASE_HACK',
    nodeId,
    blockIds: purchaseBlockIds,
  })
  const chargeBlockId = state.resources.reserve.find(
    (blockId): blockId is string => blockId !== null,
  )
  if (!chargeBlockId) throw new Error('Task 5 quality charge block is missing')
  state = requireAccepted(state, {
    type: 'CHARGE_SABOTAGE',
    nodeId,
    blockId: chargeBlockId,
  })
  return requireAccepted(state, {
    type: 'SCHEDULE_SABOTAGE',
    nodeId,
    targetId: 'meridian',
  })
}

let task5RollbackFixtures:
  | ReadonlyMap<MeridianRollbackActionId, CampaignState>
  | null = null

function task5ScheduledStateFor(
  actionId: MeridianRollbackActionId,
): CampaignState {
  if (task5RollbackFixtures === null) {
    const fixtures = new Map<MeridianRollbackActionId, CampaignState>()
    for (
      let candidate = 0;
      candidate < 1_000 && fixtures.size < TASK_5_ROLLBACK_PROFILES.length;
      candidate += 1
    ) {
      const scheduled = task5ScheduledQualitySabotage(
        `task-5-rollback-profile-${candidate}`,
      )
      const advanced = requireAccepted(scheduled, { type: 'ADVANCE_DAY' })
      const rollback = advanced.causality.incidents.find(
        ({ parentIncidentId }) =>
          parentIncidentId === advanced.causality.incidents[0]?.id,
      )
      const profile = TASK_5_ROLLBACK_PROFILES.find(
        ({ actionId: expectedActionId }) =>
          expectedActionId === rollback?.actionId,
      )
      if (profile && !fixtures.has(profile.actionId)) {
        fixtures.set(profile.actionId, scheduled)
      }
    }
    if (fixtures.size !== TASK_5_ROLLBACK_PROFILES.length) {
      throw new Error('Task 5 could not locate every deterministic rollback band')
    }
    task5RollbackFixtures = fixtures
  }

  const scheduled = task5RollbackFixtures.get(actionId)
  if (!scheduled) throw new Error(`Task 5 rollback fixture is missing: ${actionId}`)
  return scheduled
}

describe('versioned campaign saves', () => {
  it('round-trips resource intrusion progress in save format 11', () => {
    const state = createCampaign('resource-progress-v11')
    state.resourceIntrusion.successfulCoreDeposits = 7
    state.resourceIntrusion.completedRounds = 11
    state.resourceIntrusion.lastOutcome = 'victory'
    const encoded = encodeSave(state, '2026-08-20T00:00:00.000Z')

    expect(JSON.parse(encoded).version).toBe(11)
    const decoded = decodeSave(encoded)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.resourceIntrusion).toEqual({
      successfulCoreDeposits: 7,
      completedRounds: 11,
      lastOutcome: 'victory',
      communications: [],
    })
  })

  it('migrates a valid v10 intrusion checkpoint and promotes future commands to protocol 14', () => {
    let legacy = createCampaignForProtocol('resource-progress-v10', 4)
    legacy = divertCurrentResource(legacy)
    legacy.resourceIntrusion.successfulCoreDeposits = 7
    const parsed = JSON.parse(encodeSave(legacy)) as {
      version: number
      state: Record<string, unknown>
    }
    parsed.version = 10
    parsed.state.resourceIntrusion = { successfulCoreDeposits: 7 }
    refreshPortableIntegrity(parsed)

    const decoded = decodeSave(JSON.stringify(parsed))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(10)
    expect(decoded.envelope.state.resourceIntrusion).toEqual({
      successfulCoreDeposits: 7,
      completedRounds: 0,
      lastOutcome: null,
      communications: [],
    })
    expect(decoded.envelope.state.market.playerShare).toBeCloseTo(56.4, 10)
    expect(
      decoded.envelope.state.market.competitors.find(({ id }) => id === 'meridian')?.marketShare,
    ).toBeCloseTo(37.6, 10)
    expect(
      decoded.envelope.state.market.competitors.find(({ id }) => id === 'tallow'),
    ).toMatchObject({
      status: 'active',
      marketShare: 6,
      availability: 0.55,
      researchProgress: 1,
    })
    expect(decoded.envelope.commandProtocol).toEqual({
      segments: [
        { version: 4, startsAtSequence: 1 },
        { version: 14, startsAtSequence: legacy.commandSequence + 1 },
      ],
    })
  })

  it('migrates a valid v9 checkpoint with zero new core deposits and no intro replay', () => {
    const state = createCampaign('resource-progress-v9')
    state.tutorial = createMigratedTutorialProgress()
    const parsed = JSON.parse(encodeSave(state)) as {
      version: number
      commandProtocol: unknown
      replayBootstrap: unknown
      state: Record<string, unknown>
      integrity: { checkpointHash: string }
    }
    parsed.version = 9
    delete parsed.state.resourceIntrusion
    parsed.integrity.checkpointHash =
      persistenceCodecInternals.portableCheckpointHash(
        9,
        parsed.commandProtocol,
        parsed.replayBootstrap,
        parsed.state,
      )

    const decoded = decodeSave(JSON.stringify(parsed))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(9)
    expect(decoded.envelope.state.resourceIntrusion).toEqual({
      successfulCoreDeposits: 0,
      completedRounds: 0,
      lastOutcome: null,
      communications: [],
    })
    expect(decoded.envelope.state.tutorial).toEqual(
      createMigratedTutorialProgress(),
    )
  })

  it('round-trips tutorial progress in save format 11', () => {
    const state = createCampaign('tutorial-v11')
    const encoded = encodeSave(state, '2026-08-19T00:00:00.000Z')

    expect(JSON.parse(encoded).version).toBe(11)
    const decoded = decodeSave(encoded)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.tutorial).toEqual(state.tutorial)
  })

  it('migrates a valid v8 checkpoint with the intro tutorial complete', () => {
    const parsed = JSON.parse(encodeSave(createCampaign('tutorial-v8'))) as {
      version: number
      commandProtocol: unknown
      replayBootstrap: unknown
      state: Record<string, unknown>
      integrity: { checkpointHash: string }
    }
    parsed.version = 8
    delete parsed.state.tutorial
    delete parsed.state.resourceIntrusion
    parsed.integrity.checkpointHash =
      persistenceCodecInternals.portableCheckpointHash(
        8,
        parsed.commandProtocol,
        parsed.replayBootstrap,
        parsed.state,
      )

    const decoded = decodeSave(JSON.stringify(parsed))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(8)
    expect(decoded.envelope.state.tutorial).toEqual(
      createMigratedTutorialProgress(),
    )
  })

  it('encodes a canonical v11 envelope without duplicating runtime-only fields', () => {
    const fixedSavedAt = '2026-08-14T12:00:00.000Z'
    const state = createCampaign('save-v7-boundary')
    const encoded = encodeSave(state, fixedSavedAt)
    const raw = JSON.parse(encoded) as Record<string, unknown> & {
      state: Record<string, unknown>
      commandProtocol: unknown
    }

    expect(raw).toMatchObject({
      version: 11,
      commandProtocol: {
        segments: [{ version: 14, startsAtSequence: 1 }],
      },
      replayBootstrap: {
        openingVersion: 2,
        legacyReviewPrefixCount: 0,
      },
    })
    expect(raw.state).not.toHaveProperty('commandProtocol')
    expect(raw.state).not.toHaveProperty('replayBootstrap')
    expect(raw.state).not.toHaveProperty('saveVersion')
    expect(raw.state).not.toHaveProperty('legacyCommandCount')
    expect(raw.state).not.toHaveProperty('commandLog')
    expect(raw.state).not.toHaveProperty('eventLog')

    const decoded = decodeSave(encoded)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(11)
    expect(decoded.envelope.commandProtocol).toEqual(state.commandProtocol)
    expect(decoded.envelope.replayBootstrap).toEqual(state.replayBootstrap)
    expect(decoded.envelope.state.commandProtocol).toEqual(
      state.commandProtocol,
    )
    expect(decoded.envelope.state.replayBootstrap).toEqual(
      state.replayBootstrap,
    )
    expect(encoded.match(/"replayBootstrap"/g)).toHaveLength(1)
    expect(encodeSave(decoded.envelope.state, fixedSavedAt)).toBe(encoded)
  })

  it('migrates a two-competitor v8 checkpoint by adding dormant successors and zero-filled history', () => {
    const state = createCampaign('v8-successor-roster-migration')
    state.market.history = [
      {
        serviceDay: state.serviceDay,
        cadence: 'weekly',
        playerShare: 60,
        competitorShares: {
          meridian: 40,
          tallow: 0,
          salus: 0,
          lucent: 0,
          boreal: 0,
        },
        reasons: ['기존 2기 시장 기록'],
      },
    ]
    const raw = JSON.parse(encodeSave(state)) as {
      state: {
        market: {
          competitors: Array<{ id: string }>
          history: Array<{ competitorShares: Record<string, number> }>
        }
      }
    }
    raw.state.market.competitors = raw.state.market.competitors.filter(
      ({ id }) => id === 'meridian' || id === 'tallow',
    )
    for (const snapshot of raw.state.market.history) {
      delete snapshot.competitorShares.salus
      delete snapshot.competitorShares.lucent
      delete snapshot.competitorShares.boreal
    }
    refreshPortableIntegrity(raw)

    const decoded = decodeSave(JSON.stringify(raw))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(
      decoded.envelope.state.market.competitors.map(
        ({ id, status, marketShare }) => ({ id, status, marketShare }),
      ),
    ).toEqual([
      { id: 'meridian', status: 'active', marketShare: 36 },
      { id: 'tallow', status: 'active', marketShare: 6 },
      { id: 'salus', status: 'prelaunch', marketShare: 0 },
      { id: 'lucent', status: 'prelaunch', marketShare: 0 },
      { id: 'boreal', status: 'prelaunch', marketShare: 0 },
    ])
    expect(
      decoded.envelope.state.market.history[0]?.competitorShares,
    ).toEqual({ meridian: 40, tallow: 0, salus: 0, lucent: 0, boreal: 0 })
  })

  it.each([
    ['missing top-level field', (raw: Record<string, unknown>) => {
      delete raw.replayBootstrap
    }],
    ['extra top-level field', (raw: Record<string, unknown>) => {
      raw.hiddenBootstrap = true
    }],
    ['missing metadata key', (raw: Record<string, unknown>) => {
      delete (raw.replayBootstrap as Record<string, unknown>).openingVersion
    }],
    ['extra metadata key', (raw: Record<string, unknown>) => {
      ;(raw.replayBootstrap as Record<string, unknown>).extra = true
    }],
    ['invalid opening', (raw: Record<string, unknown>) => {
      ;(raw.replayBootstrap as Record<string, unknown>).openingVersion = 3
    }],
    ['negative prefix', (raw: Record<string, unknown>) => {
      ;(raw.replayBootstrap as Record<string, unknown>).legacyReviewPrefixCount = -1
    }],
    ['fractional prefix', (raw: Record<string, unknown>) => {
      ;(raw.replayBootstrap as Record<string, unknown>).legacyReviewPrefixCount = 0.5
    }],
    ['oversized prefix', (raw: Record<string, unknown>) => {
      ;(raw.replayBootstrap as Record<string, unknown>).legacyReviewPrefixCount = 3
    }],
  ] as const)('rejects v7 replay bootstrap corruption: %s', (_name, mutate) => {
    const raw = JSON.parse(
      encodeSave(createCampaign(`bootstrap-corruption-${_name}`)),
    ) as Record<string, unknown>
    mutate(raw)
    refreshPortableIntegrity(raw)

    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('binds the canonical v7 replay bootstrap to the fixed-order checkpoint hash', () => {
    const raw = JSON.parse(
      encodeSave(createCampaign('bootstrap-integrity-binding')),
    ) as {
      commandProtocol: unknown
      replayBootstrap: { openingVersion: number }
      state: unknown
      integrity: { checkpointHash: string }
    }
    expect(raw.integrity.checkpointHash).toBe(
      testContentHash(JSON.stringify({
        commandProtocol: raw.commandProtocol,
        replayBootstrap: raw.replayBootstrap,
        state: raw.state,
      })),
    )
    raw.replayBootstrap.openingVersion = 1
    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    {
      name: 'decreasing versions',
      segments: [
        { version: 3, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 2 },
      ],
    },
    {
      name: 'repeated version',
      segments: [
        { version: 2, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 2 },
        { version: 3, startsAtSequence: 3 },
      ],
    },
    {
      name: 'repeated start',
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 1 },
        { version: 3, startsAtSequence: 3 },
      ],
    },
    {
      name: 'first start after one',
      segments: [{ version: 3, startsAtSequence: 2 }],
    },
    {
      name: 'non-final empty segment',
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 4 },
        { version: 3, startsAtSequence: 5 },
      ],
    },
    {
      name: 'start beyond commandCount + 1',
      segments: [{ version: 3, startsAtSequence: 5 }],
    },
    {
      name: 'final version before v3',
      segments: [{ version: 2, startsAtSequence: 1 }],
    },
    {
      name: 'extra segment key',
      segments: [
        { version: 3, startsAtSequence: 1, hiddenBoundary: true },
      ],
    },
  ])('rejects v7 timeline corruption: $name', ({ segments }) => {
    const raw = JSON.parse(
      encodeSave(commandCampaign(`timeline-corruption-${segments.length}`, 3)),
    ) as {
      commandProtocol: { segments: unknown[]; hiddenMetadata?: boolean }
    }
    raw.commandProtocol.segments = segments
    refreshPortableIntegrity(raw)

    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects an extra v7 command-protocol metadata key', () => {
    const raw = JSON.parse(
      encodeSave(createCampaign('timeline-extra-metadata')),
    ) as { commandProtocol: Record<string, unknown> }
    raw.commandProtocol.hiddenMetadata = true
    refreshPortableIntegrity(raw)

    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('binds a structurally valid v7 command timeline to checkpoint integrity', () => {
    const raw = JSON.parse(
      encodeSave(commandCampaign('timeline-integrity-binding', 3)),
    ) as {
      commandProtocol: {
        segments: Array<{ version: number; startsAtSequence: number }>
      }
    }
    raw.commandProtocol.segments = [
      { version: 2, startsAtSequence: 1 },
      { version: 3, startsAtSequence: 4 },
    ]

    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    'commandProtocol',
    'replayBootstrap',
    'saveVersion',
    'legacyCommandCount',
  ] as const)(
    'rejects duplicated %s inside the v7 checkpoint',
    (key) => {
      const raw = JSON.parse(
        encodeSave(createCampaign(`checkpoint-duplicate-${key}`)),
      ) as { state: Record<string, unknown> }
      raw.state[key] =
        key === 'commandProtocol'
          ? { segments: [{ version: 3, startsAtSequence: 1 }] }
          : key === 'replayBootstrap'
            ? { openingVersion: 2, legacyReviewPrefixCount: 0 }
          : key === 'saveVersion'
            ? 3
            : 0
      refreshPortableIntegrity(raw)

      expect(decodeSave(JSON.stringify(raw))).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it.each([5, 6] as const)(
    'preserves a v%i legacy-review prefix and native captured suffix through replay and v7 resave',
    (version) => {
      const source = mixedLegacyReviewCampaign(`mixed-review-v${version}`)
      const serialized = version === 5
        ? encodedLegacyV5State(source)
        : encodedLegacyV6State(source, {
            ...createEmptyCausalState(),
            rulesVersion: 1,
          })
      const decoded = decodeSave(serialized)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.envelope.replayBootstrap).toEqual({
        openingVersion: 2,
        legacyReviewPrefixCount: 2,
      })
      expect(
        decoded.envelope.state.reviews.feed.slice(0, 2).every(
          ({ snapshot }) =>
            snapshot.kind === 'unavailable' && snapshot.reason === 'legacy-save',
        ),
      ).toBe(true)
      expect(
        decoded.envelope.state.reviews.feed.slice(2).some(
          ({ snapshot }) => snapshot.kind === 'captured-public-v1',
        ),
      ).toBe(true)

      const replay = replayCommands(
        decoded.envelope.campaignSeed,
        decoded.envelope.commands.map(({ command }) => command),
        {
          commandProtocol: decoded.envelope.commandProtocol,
          replayBootstrap: decoded.envelope.replayBootstrap,
        },
      )
      expect(replay.ok).toBe(true)
      if (!replay.ok) return
      expect(replay.state.reviews).toEqual(decoded.envelope.state.reviews)

      const resaved = decodeSave(
        encodeSave(decoded.envelope.state, '2026-08-15T00:00:00.000Z'),
      )
      expect(resaved.ok).toBe(true)
      if (!resaved.ok) return
      expect(resaved.envelope.replayBootstrap).toEqual(
        decoded.envelope.replayBootstrap,
      )
      expect(resaved.envelope.state.reviews).toEqual(
        decoded.envelope.state.reviews,
      )
    },
  )

  it.each([
    [1, encodedLegacyV1State],
    [2, encodedLegacyV2State],
    [3, encodedLegacyV3State],
    [4, encodedLegacyV4State],
    [5, encodedLegacyV5State],
  ] as const)(
    'migrates a v%i save to the explicit empty rules-v2 causal state',
    (version, encodeLegacy) => {
      const decoded = decodeSave(
        encodeLegacy(createCampaign(`causal-migration-v${version}`)),
      )

      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.envelope.version).toBe(version)
      expect(decoded.envelope.state.causality).toEqual(
        createEmptyCausalState(),
      )
    },
  )

  // The trailing segment is whatever the current protocol is: a migrated save
  // replays its history under the versions it recorded and only new commands
  // use today's rules.
  it.each([
    [1, 0, 0, '14@1'],
    [1, 31, 31, '1@1;14@32'],
    [2, 0, 0, '14@1'],
    [2, 19, 0, '2@1;14@20'],
    [2, 50, 31, '1@1;2@32;14@51'],
    [3, 50, 31, '1@1;2@32;14@51'],
    [4, 50, 31, '1@1;2@32;14@51'],
    [5, 50, 31, '1@1;2@32;14@51'],
    [6, 50, 31, '1@1;2@32;14@51'],
  ] as const)(
    'migrates source v%i with %i commands and prefix %i to %s',
    (formatVersion, commandCount, legacyCommandCount, fingerprint) => {
      const source = commandCampaign(
        `protocol-migration-${formatVersion}-${commandCount}-${legacyCommandCount}`,
        commandCount,
      )
      const decoded = decodeSave(
        encodedLegacyBoundarySave(
          formatVersion,
          source,
          legacyCommandCount,
        ),
      )

      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.envelope.version).toBe(formatVersion)
      expect(
        decoded.envelope.commandProtocol.segments
          .map(({ version, startsAtSequence }) =>
            `${version}@${startsAtSequence}`,
          )
          .join(';'),
      ).toBe(fingerprint)
      expect(decoded.envelope.state.commandProtocol).toEqual(
        decoded.envelope.commandProtocol,
      )
      expect(decoded.envelope.replayBootstrap).toEqual({
        openingVersion:
          formatVersion === 1 || legacyCommandCount > 0 ? 1 : 2,
        legacyReviewPrefixCount:
          formatVersion <= 4 ? source.reviews.feed.length : 0,
      })
      expect(decoded.envelope.state.replayBootstrap).toEqual(
        decoded.envelope.replayBootstrap,
      )
      expect(
        JSON.parse(
          encodeSave(
            decoded.envelope.state,
            '2026-08-14T13:00:00.000Z',
          ),
        ).version,
      ).toBe(11)
    },
  )

  it('keeps zero-command v1 and v2 provenance distinct after both migrate to 14@1', () => {
    const v1 = decodeSave(encodedLegacyV1State(createCampaign('zero-v1')))
    const v2 = decodeSave(encodedLegacyV2State(createCampaign('zero-v2')))
    expect(v1.ok).toBe(true)
    expect(v2.ok).toBe(true)
    if (!v1.ok || !v2.ok) return

    expect(v1.envelope.commandProtocol).toEqual(v2.envelope.commandProtocol)
    expect(v1.envelope.commandProtocol).toEqual({
      segments: [{ version: 14, startsAtSequence: 1 }],
    })
    expect(v1.envelope.replayBootstrap).toEqual({
      openingVersion: 1,
      legacyReviewPrefixCount: 2,
    })
    expect(v2.envelope.replayBootstrap).toEqual({
      openingVersion: 2,
      legacyReviewPrefixCount: 2,
    })
  })

  it.each([
    [3, encodedLegacyV3State],
    [4, encodedLegacyV4State],
    [5, encodedLegacyV5State],
    [6, encodedLegacyV6State],
  ] as const)(
    'keeps the exact v%i checkpoint hash recipe free of v7 replay metadata',
    (version, encodeLegacy) => {
      const raw = JSON.parse(
        encodeLegacy(createCampaign(`legacy-hash-v${version}`)),
      ) as {
        replayBootstrap?: unknown
        state: unknown
        integrity: { checkpointHash: string }
      }
      expect(raw).not.toHaveProperty('replayBootstrap')
      expect(raw.integrity.checkpointHash).toBe(
        testContentHash(JSON.stringify(raw.state)),
      )
    },
  )

  it('migrates every v6 causal field without changing its original meaning', () => {
    const sourceCausality = legacyCausalStateV1Fixture()
    const v6 = JSON.parse(encodedLegacyV6State(
      createCampaign('causal-v6-preservation'),
      sourceCausality,
    )) as { state: { causality: { evidence: Array<Record<string, unknown>> } } }
    const sourceEvidence = structuredClone(v6.state.causality.evidence)
    const decoded = decodeSave(JSON.stringify(v6))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(6)
    expect(decoded.envelope.commandProtocol).toEqual({
      segments: [{ version: 14, startsAtSequence: 1 }],
    })
    const migrated = decoded.envelope.state.causality
    expect(migrated.rulesVersion).toBe(2)
    expect(
      migrated.incidents.map(({ actionId, parentIncidentId }) => ({
        actionId,
        parentIncidentId,
      })),
    ).toEqual([
      { actionId: 'legacy.sabotage', parentIncidentId: null },
      { actionId: 'legacy.competitor-response', parentIncidentId: null },
      { actionId: 'legacy.service-disruption', parentIncidentId: null },
    ])
    expect(
      migrated.incidents.map((incident) => {
        const originalFields = { ...incident } as Record<string, unknown>
        delete originalFields.actionId
        delete originalFields.parentIncidentId
        return originalFields
      }),
    ).toEqual(sourceCausality.incidents)
    expect(migrated.evidence).toEqual(
      sourceEvidence.map(({ summary, ...evidence }) => ({
        ...evidence,
        legacySummary: summary,
      })),
    )
    for (const evidence of migrated.evidence) {
      expect(evidence).not.toHaveProperty('summary')
    }
    expect(
      migrated.publicRevisions.map((revision) => {
        const originalFields = { ...revision } as Record<string, unknown>
        delete originalFields.confidence
        return originalFields
      }),
    ).toEqual(sourceCausality.publicRevisions)
    expect(
      migrated.publicRevisions.map(({ confidence }) => confidence),
    ).toEqual([
      'unavailable-legacy',
      'unavailable-legacy',
      'unavailable-legacy',
    ])
    expect(migrated.appliedEffects).toEqual(sourceCausality.appliedEffects)
    expect(migrated).toMatchObject({
      nextIncidentSequence: sourceCausality.nextIncidentSequence,
      nextEvidenceSequence: sourceCausality.nextEvidenceSequence,
      nextRevisionSequence: sourceCausality.nextRevisionSequence,
      nextEffectSequence: sourceCausality.nextEffectSequence,
    })
    const reencoded = encodeSave(
      decoded.envelope.state,
      '2026-08-14T12:30:00.000Z',
    )
    expect(JSON.parse(reencoded).version).toBe(11)

    const roundTripped = decodeSave(reencoded)
    expect(roundTripped.ok).toBe(true)
    if (!roundTripped.ok) return
    expect(roundTripped.envelope.state.causality).toEqual(migrated)
    expect(
      roundTripped.envelope.state.causality.evidence.map(
        ({ legacySummary }) => legacySummary,
      ),
    ).toEqual(sourceEvidence.map(({ summary }) => summary))
  })

  it.each([
    [
      'unknown legacy incident metadata',
      (causality: Record<string, unknown>) => {
        const incidents = causality.incidents as Array<Record<string, unknown>>
        incidents[0].actionId = 'legacy.sabotage'
      },
    ],
    [
      'legacy evidence linked to a missing incident',
      (causality: Record<string, unknown>) => {
        const evidence = causality.evidence as Array<Record<string, unknown>>
        evidence[0].incidentId = 'legacy-incident-missing'
      },
    ],
    [
      'legacy revision citing cross-incident evidence',
      (causality: Record<string, unknown>) => {
        const revisions = causality.publicRevisions as Array<
          Record<string, unknown>
        >
        revisions[0].evidenceIds = ['legacy-evidence-response']
      },
    ],
  ] as const)(
    'validates malformed v6 causal history before migration: %s',
    (_name, mutate) => {
      const raw = JSON.parse(
        encodedLegacyV6State(createCampaign('causal-v6-invalid')),
      ) as { state: { causality: Record<string, unknown> } }
      mutate(raw.state.causality)
      refreshPortableIntegrity(raw)

      expect(decodeSave(JSON.stringify(raw))).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it('encodes native v7 causal evidence without a prose summary', () => {
    const initial = createCampaign('native-v7-evidence-boundary')
    const incident = recordCausalIncident(initial, {
      actionId: 'sabotage.quality-degradation',
      parentIncidentId: null,
      kind: 'sabotage',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    if (!incident.accepted) throw new Error(incident.reason)
    const evidence = recordCausalEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'meridian-quality-regression',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
    })
    if (!evidence.accepted) throw new Error(evidence.reason)

    const parsed = JSON.parse(encodeSave(evidence.state)) as {
      state: { causality: { evidence: Array<Record<string, unknown>> } }
    }
    expect(parsed.state.causality.evidence[0]).toMatchObject({
      kind: 'meridian-quality-regression',
      legacySummary: null,
    })
    expect(parsed.state.causality.evidence[0]).not.toHaveProperty('summary')
    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({ ok: true })
  })

  it('rejects integrity-refreshed v7 evidence across the summary provenance boundary', () => {
    const native = JSON.parse(
      encodeSave(populatedCausalState('causal-native-summary-boundary')),
    ) as { state: { causality: { evidence: Array<Record<string, unknown>> } } }
    const legacySource = JSON.parse(
      encodedLegacyV6State(createCampaign('causal-legacy-summary-boundary')),
    ) as { state: { causality: { evidence: Array<Record<string, unknown>> } } }
    const migrated = decodeSave(JSON.stringify(legacySource))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const legacy = JSON.parse(encodeSave(migrated.envelope.state)) as {
      state: { causality: { evidence: Array<Record<string, unknown>> } }
    }

    native.state.causality.evidence[0].legacySummary = '한국어 문장'
    refreshPortableIntegrity(native)
    expect(decodeSave(JSON.stringify(native))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })

    const withSummary = JSON.parse(JSON.stringify(native)) as typeof native
    withSummary.state.causality.evidence[0].legacySummary = null
    withSummary.state.causality.evidence[0].summary = 'forged legacy prose'
    refreshPortableIntegrity(withSummary)
    expect(decodeSave(JSON.stringify(withSummary))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })

    legacy.state.causality.evidence[0].legacySummary = null
    refreshPortableIntegrity(legacy)
    expect(decodeSave(JSON.stringify(legacy))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })

    const missingLegacySummary = JSON.parse(JSON.stringify(native)) as typeof native
    delete missingLegacySummary.state.causality.evidence[0].legacySummary
    refreshPortableIntegrity(missingLegacySummary)
    expect(decodeSave(JSON.stringify(missingLegacySummary))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('round-trips populated native causal records exactly through v11', () => {
    const state = populatedCausalState('causal-v7-round-trip')
    const decoded = decodeSave(
      encodeSave(state, '2026-08-14T09:00:00.000Z'),
    )

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(11)
    expect(decoded.envelope.commandProtocol).toEqual({
      segments: [{ version: 14, startsAtSequence: 1 }],
    })
    expect(decoded.envelope.state.causality).toEqual(state.causality)
    expect(decoded.envelope.state.reputation).toBe(state.reputation)
  })

  it('round-trips unresolved then provider attribution as two ordered immutable revisions', () => {
    const unresolved = populatedCausalState('causal-attribution-history')
    const recovery = unresolved.causality.incidents.find(
      ({ actionId }) => actionId === 'follow-up.recovery-contamination',
    )
    if (!recovery) throw new Error('recovery fixture missing')
    const firstRevision = structuredClone(unresolved.causality.publicRevisions[0])
    const providerEvidence = recordCausalEvidence(unresolved, {
      incidentId: recovery.id,
      kind: 'provider-timing-correlation',
      discoveredOnServiceDay: unresolved.serviceDay,
      audiences: [
        { kind: 'provider', providerId: 'provider.meridian-recovery' },
      ],
    })
    if (!providerEvidence.accepted) throw new Error(providerEvidence.reason)
    const providerRevision = appendPublicAttributionRevision(
      providerEvidence.state,
      {
        incidentId: recovery.id,
        publisher: {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
        attributedActorId: 'external-operator',
        evidenceIds: [providerEvidence.evidence.id],
        publishedOnServiceDay: unresolved.serviceDay,
      },
    )
    if (!providerRevision.accepted) throw new Error(providerRevision.reason)

    const decoded = decodeSave(encodeSave(providerRevision.state))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.causality.publicRevisions).toHaveLength(2)
    expect(decoded.envelope.state.causality.publicRevisions[0]).toEqual(
      firstRevision,
    )
    expect(
      decoded.envelope.state.causality.publicRevisions.map(
        ({ sequence, attributedActorId }) => ({ sequence, attributedActorId }),
      ),
    ).toEqual([
      { sequence: 1, attributedActorId: 'unresolved' },
      { sequence: 2, attributedActorId: 'external-operator' },
    ])
  })

  it.each([
    {
      name: 'unknown causal rules version',
      path: ['state', 'causality', 'rulesVersion'],
      value: 1,
    },
    {
      name: 'non-contiguous next incident sequence',
      path: ['state', 'causality', 'nextIncidentSequence'],
      value: 99,
    },
    {
      name: 'non-monotonic incident sequence',
      path: ['state', 'causality', 'incidents', 0, 'sequence'],
      value: 2,
    },
    {
      name: 'empty private actual actor',
      path: [
        'state',
        'causality',
        'incidents',
        0,
        'privateTruth',
        'actualActorId',
      ],
      value: '',
    },
    {
      name: 'evidence with no audience',
      path: ['state', 'causality', 'evidence', 0, 'audiences'],
      value: [],
    },
    {
      name: 'evidence with an unknown competitor scope',
      path: ['state', 'causality', 'evidence', 0, 'audiences'],
      value: [
        { kind: 'competitor-scope', competitorIds: ['unknown-competitor'] },
      ],
    },
    {
      name: 'evidence linked to an unknown incident',
      path: ['state', 'causality', 'evidence', 0, 'incidentId'],
      value: 'incident-missing',
    },
    {
      name: 'public revision with no evidence',
      path: ['state', 'causality', 'publicRevisions', 0, 'evidenceIds'],
      value: [],
    },
    {
      name: 'public revision with an extra publisher key',
      path: ['state', 'causality', 'publicRevisions', 0, 'publisher'],
      value: { kind: 'public', leakedActorId: 'player' },
    },
    {
      name: 'public revision before its evidence was discovered',
      path: [
        'state',
        'causality',
        'publicRevisions',
        0,
        'publishedOnServiceDay',
      ],
      value: 330,
    },
    {
      name: 'effect linked to an unknown revision',
      path: ['state', 'causality', 'appliedEffects', 0, 'revisionId'],
      value: 'revision-missing',
    },
    {
      name: 'zero-sized reputation effect',
      path: ['state', 'causality', 'appliedEffects', 0, 'effect', 'delta'],
      value: 0,
    },
    {
      name: 'future-dated effect',
      path: [
        'state',
        'causality',
        'appliedEffects',
        0,
        'appliedOnServiceDay',
      ],
      value: 332,
    },
    {
      name: 'unknown causal state key',
      path: ['state', 'causality', 'privateLeak'],
      value: true,
    },
  ] as const)(
    'rejects malformed v7 causal state: $name',
    ({ path, value }) => {
      const parsed = JSON.parse(
        encodeSave(populatedCausalState(`causal-invalid-${path.join('-')}`)),
      )
      setRawPath(parsed, path, value)
      refreshPortableIntegrity(parsed)

      expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it.each([
    [
      'missing native parent',
      (causal: MutableCausalPayload) => {
        causal.incidents[1].parentIncidentId = 'incident-missing'
      },
    ],
    [
      'self parent',
      (causal: MutableCausalPayload) => {
        causal.incidents[1].parentIncidentId = causal.incidents[1].id
      },
    ],
    [
      'future parent',
      (causal: MutableCausalPayload) => {
        causal.incidents[1].parentIncidentId = causal.incidents[2].id
      },
    ],
    [
      'wrong parent kind',
      (causal: MutableCausalPayload) => {
        causal.incidents[0].kind = 'service-disruption'
      },
    ],
    [
      'wrong parent target',
      (causal: MutableCausalPayload) => {
        causal.incidents[0].targetId = 'tallow'
      },
    ],
    [
      'wrong parent action',
      (causal: MutableCausalPayload) => {
        causal.incidents[0].actionId = 'legacy.sabotage'
      },
    ],
    [
      'native root with a parent',
      (causal: MutableCausalPayload) => {
        causal.incidents[0].parentIncidentId = causal.incidents[1].id
      },
    ],
    [
      'native action with the wrong kind',
      (causal: MutableCausalPayload) => {
        causal.incidents[1].kind = 'sabotage'
      },
    ],
    [
      'duplicate native child relation',
      (causal: MutableCausalPayload) => {
        causal.incidents.push({
          ...causal.incidents[1],
          id: 'duplicate-native-child',
          sequence: 4,
        })
        causal.nextIncidentSequence = 5
      },
    ],
    [
      'legacy action with the wrong kind',
      (causal: MutableCausalPayload) => {
        causal.incidents[0].actionId = 'legacy.service-disruption'
      },
    ],
    [
      'legacy action with a parent',
      (causal: MutableCausalPayload) => {
        causal.incidents[0].actionId = 'legacy.sabotage'
        causal.incidents[0].parentIncidentId = causal.incidents[1].id
      },
    ],
    [
      'native unavailable confidence',
      (causal: MutableCausalPayload) => {
        causal.publicRevisions[0].confidence = 'unavailable-legacy'
      },
    ],
    [
      'confidence stronger than cited evidence',
      (causal: MutableCausalPayload) => {
        causal.publicRevisions[0].confidence = 'credible'
      },
    ],
    [
      'actor inconsistent with confidence',
      (causal: MutableCausalPayload) => {
        causal.publicRevisions[0].attributedActorId = 'player'
      },
    ],
    [
      'duplicate revision citations',
      (causal: MutableCausalPayload) => {
        const evidenceId = causal.evidence[0].id
        causal.publicRevisions[0].evidenceIds = [evidenceId, evidenceId]
      },
    ],
    [
      'arbitrary evidence on a native incident',
      (causal: MutableCausalPayload) => {
        causal.evidence[0].kind = 'legacy-arbitrary-signal'
      },
    ],
    [
      'cross-incident revision evidence',
      (causal: MutableCausalPayload) => {
        const qualityEvidence = {
          ...causal.evidence[0],
          id: 'quality-cross-evidence',
          sequence: 2,
          incidentId: causal.incidents[0].id,
          kind: 'meridian-quality-regression',
          audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
        }
        causal.evidence.push(qualityEvidence)
        causal.nextEvidenceSequence = 3
        causal.publicRevisions[0].evidenceIds = [
          causal.evidence[0].id,
          qualityEvidence.id,
        ].sort()
      },
    ],
    [
      'duplicate evidence IDs',
      (causal: MutableCausalPayload) => {
        causal.evidence.push({ ...causal.evidence[0], sequence: 2 })
        causal.nextEvidenceSequence = 3
      },
    ],
  ] as const)(
    'rejects v7 causal relation corruption: %s',
    (name, mutate) => {
      const raw = JSON.parse(
        encodeSave(populatedCausalState(`causal-relation-${name}`)),
      ) as { state: { causality: MutableCausalPayload } }
      mutate(raw.state.causality)
      refreshPortableIntegrity(raw)

      expect(decodeSave(JSON.stringify(raw))).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it('rejects both a native v7 missing causality and a v5 save that claims causal history', () => {
    const missing = JSON.parse(
      encodeSave(createCampaign('causal-state-missing')),
    ) as { state: Record<string, unknown> }
    delete missing.state.causality
    refreshPortableIntegrity(missing)
    expect(decodeSave(JSON.stringify(missing))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })

    const impersonating = JSON.parse(
      encodeSave(populatedCausalState('causal-v5-impersonation')),
    ) as { version: number }
    impersonating.version = 5
    refreshPortableIntegrity(impersonating)
    expect(decodeSave(JSON.stringify(impersonating))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('migrates exact v4 reviews to public-only unavailable snapshots without inventing values', () => {
    const source = createCampaign('save-v4-review-migration')
    const decoded = decodeSave(encodedLegacyV4State(source))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.version).toBe(4)
    expect(decoded.envelope.state.reviews.feed.map(({ snapshot }) => snapshot)).toEqual(
      source.reviews.feed.map((review) => ({
        kind: 'unavailable',
        reason: 'legacy-save',
        capturedOnServiceDay: review.serviceDay,
      })),
    )
    expect(decoded.envelope.state.reviews.feed.map(({ text }) => text)).toEqual(
      source.reviews.feed.map(({ text }) => text),
    )
    expect(decoded.envelope.state.reviews.feed.map(({ authorId }) => authorId)).toEqual(
      source.reviews.feed.map(({ authorId }) => authorId),
    )
  })

  it('rejects a v5 save impersonating v4 instead of silently discarding its snapshots', () => {
    const parsed = JSON.parse(encodeSave(createCampaign('save-v5-downgrade'))) as {
      version: number
    }
    parsed.version = 4

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('round-trips a public competitor review without leaking dormant successors', () => {
    const initial = createCampaign('save-hidden-successor-review')
    const state: CampaignState = {
      ...initial,
      reviews: {
        ...initial.reviews,
        feed: [
          ...initial.reviews.feed,
          {
            id: 'review-hidden-successor-overview',
            contentId: 'review-hidden-successor-overview',
            authorId: 'windowseat',
            serviceDay: initial.serviceDay,
            sentiment: 'neutral',
            topics: ['competitor'],
            text: '현재 공개된 경쟁 서비스만 비교했습니다.',
            snapshot: captureReviewPublicSnapshot(initial, ['competitor']),
            source: 'timed',
            rating: null,
          },
        ],
      },
    }

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const snapshot = decoded.envelope.state.reviews.feed.at(-1)?.snapshot
    expect(snapshot?.kind).toBe('captured-public-v1')
    if (snapshot?.kind !== 'captured-public-v1') return
    expect(snapshot.market?.competitors.map(({ id }) => id)).toEqual([
      'meridian',
      'tallow',
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/SALUS|LUCENT|BOREAL/i)
  })

  it.each(['unavailable', 'captured'])(
    'rejects a v4 review that owns a current-only %s snapshot key',
    (kind) => {
      const parsed = JSON.parse(
        encodedLegacyV4State(createCampaign(`save-v4-current-field-${kind}`)),
      ) as {
        state: {
          reviews: {
            feed: Array<{ serviceDay: number; snapshot?: Record<string, unknown> }>
          }
        }
      }
      const entry = parsed.state.reviews.feed[0]
      entry.snapshot = kind === 'unavailable'
        ? {
            kind: 'unavailable',
            reason: 'legacy-save',
            capturedOnServiceDay: entry.serviceDay,
          }
        : {
            kind: 'captured-public-v1',
            capturedOnServiceDay: entry.serviceDay,
            performance: null,
            market: null,
          }
    refreshPortableIntegrity(parsed)

      expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
        ok: false,
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it('requires a valid public snapshot on every v5 review', () => {
    const parsed = JSON.parse(encodeSave(createCampaign('save-v5-snapshot-required'))) as {
      version: number
      state: { reviews: { feed: Array<Record<string, unknown>> } }
    }
    parsed.version = 5
    delete parsed.state.reviews.feed[0].snapshot
    refreshPortableIntegrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    ['secret-bearing', (snapshot: Record<string, unknown>) => {
      snapshot.suspicion = 77
    }],
    ['future-dated', (snapshot: Record<string, unknown>) => {
      snapshot.capturedOnServiceDay = 999
    }],
    ['duplicate-category', (snapshot: Record<string, unknown>) => {
      snapshot.kind = 'captured-public-v1'
      snapshot.performance = {
        expectedPerformance: 14,
        categories: [
          { category: 'memory', actual: 16 },
          { category: 'memory', actual: 15 },
        ],
      }
      snapshot.market = null
    }],
    ['topic-mismatch', (snapshot: Record<string, unknown>) => {
      snapshot.kind = 'captured-public-v1'
      snapshot.performance = {
        expectedPerformance: 14,
        categories: [{ category: 'reasoning', actual: 16 }],
      }
      snapshot.market = null
    }],
  ])('rejects a %s v5 review snapshot', (_name, mutate) => {
    const parsed = JSON.parse(encodeSave(createCampaign(`save-v5-${_name}`))) as {
      version: number
      state: {
        reviews: { feed: Array<{ topics: string[]; snapshot: Record<string, unknown> }> }
      }
    }
    parsed.version = 5
    const entry = parsed.state.reviews.feed[0]
    entry.topics = ['general']
    mutate(entry.snapshot)
    refreshPortableIntegrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    [
      'nested performance secret',
      ['memory'],
      {
        kind: 'captured-public-v1',
        capturedOnServiceDay: 321,
        performance: {
          expectedPerformance: 14,
          categories: [
            { category: 'memory', actual: 16, hiddenEvidence: 9 },
          ],
        },
        market: null,
      },
    ],
    [
      'nested competitor secret',
      ['competitor', 'meridian'],
      {
        kind: 'captured-public-v1',
        capturedOnServiceDay: 321,
        performance: null,
        market: {
          scope: 'topic-subset',
          playerShare: 60,
          competitors: [
            {
              id: 'meridian',
              name: 'MERIDIAN',
              status: 'active',
              marketShare: 40,
              auditRoll: 0.2,
            },
          ],
        },
      },
    ],
    [
      'competitor topic without its relevant public market snapshot',
      ['meridian'],
      {
        kind: 'captured-public-v1',
        capturedOnServiceDay: 321,
        performance: null,
        market: null,
      },
    ],
  ])('rejects a %s', (_name, topics, snapshot) => {
    const parsed = JSON.parse(encodeSave(createCampaign(`save-v5-${_name}`))) as {
      state: {
        reviews: {
          feed: Array<{ topics: string[]; snapshot: Record<string, unknown> }>
        }
      }
    }
    parsed.state.reviews.feed[0].topics = topics
    parsed.state.reviews.feed[0].snapshot = snapshot as Record<string, unknown>
    refreshPortableIntegrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each([
    [
      'complete market overview whose public shares do not total 100',
      ['competitor'],
      {
        scope: 'complete-market',
        playerShare: 60,
        competitors: [
          { id: 'meridian', name: 'MERIDIAN', status: 'active', marketShare: 39 },
          { id: 'tallow', name: 'TALLOW', status: 'preparing', marketShare: 0 },
        ],
      },
    ],
    [
      'topic subset whose shown public shares exceed 100',
      ['meridian'],
      {
        scope: 'topic-subset',
        playerShare: 60,
        competitors: [
          { id: 'meridian', name: 'MERIDIAN', status: 'active', marketShare: 41 },
        ],
      },
    ],
    [
      'withdrawn competitor with a positive public share',
      ['meridian'],
      {
        scope: 'topic-subset',
        playerShare: 60,
        competitors: [
          { id: 'meridian', name: 'MERIDIAN', status: 'withdrawn', marketShare: 1 },
        ],
      },
    ],
  ])('rejects an impossible %s snapshot', (_name, topics, market) => {
    const parsed = JSON.parse(encodeSave(createCampaign(`save-v5-${_name}`))) as {
      state: {
        reviews: {
          feed: Array<{
            serviceDay: number
            topics: string[]
            snapshot: Record<string, unknown>
          }>
        }
      }
    }
    const entry = parsed.state.reviews.feed[0]
    entry.topics = topics
    entry.snapshot = {
      kind: 'captured-public-v1',
      capturedOnServiceDay: entry.serviceDay,
      performance: null,
      market,
    }
    refreshPortableIntegrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })
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
    refreshPortableIntegrity(raw)

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
        const state = withCurrentReserve(
          createCampaign('unowned-sabotage-charge'),
          ['reasoning'],
        )
        const blockId = state.resources.reserve[0]
        if (!blockId) throw new Error('charge fixture missing')
        const nodeId = 'sabotage.quality-degradation'
        state.resources.reserve = []
        state.resources.blocks[blockId].location = { kind: 'hack-charge', nodeId }
        state.hacking.sabotageCharges[nodeId] = {
          nodeId,
          blockId,
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

  it('encodes v11 with one protocol timeline and stores each journal exactly once', () => {
    let state = createCampaign('v3-single-journal')
    const accepted = applyCommand(state, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    state = accepted.state

    const parsed = JSON.parse(encodeSave(state, '2026-08-12T00:00:00.000Z')) as {
      version: number
      commandProtocol: {
        segments: Array<{ version: number; startsAtSequence: number }>
      }
      state: Record<string, unknown>
      journals: { commands: { chunks: unknown[][] }; events: { chunks: unknown[][] } }
      commands?: unknown
      events?: unknown
    }

    expect(parsed.version).toBe(11)
    expect(parsed.commandProtocol).toEqual({
      segments: [{ version: 14, startsAtSequence: 1 }],
    })
    expect(parsed.state).not.toHaveProperty('commandProtocol')
    expect(parsed.state).not.toHaveProperty('saveVersion')
    expect(parsed.state).not.toHaveProperty('legacyCommandCount')
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
    expect(decoded.envelope.state).toEqual(state)
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
    expect(loaded.state).toEqual(state)
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
    expect(loaded.status === 'loaded' ? loaded.state : null).toEqual(next)
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
    expect(loaded.state).toEqual(state)
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
    expect(loaded.state).toEqual(state)
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
    expect(reloaded.state).toEqual(accepted.state)
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
    expect(loaded.state).toEqual(foreground)
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
    expect(
      loadedAfterConflict.status === 'loaded'
        ? loadedAfterConflict.state
        : null,
    ).toEqual(tabA.state)

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
    expect(loaded.status === 'loaded' ? loaded.state : null).toEqual(state)
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
    expect(loaded.state).toEqual(state)
    const replay = replayCommands(
      loaded.state.campaignSeed,
      journalToArray(loaded.state.commandLog).map(({ command }) => command),
      {
        commandProtocol: loaded.envelope.commandProtocol,
        replayBootstrap: loaded.envelope.replayBootstrap,
      },
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(loaded.state)
  })

  it('rejects an integrity-refreshed v7 state with two rollback-family siblings', () => {
    const raw = JSON.parse(
      encodeSave(populatedCausalState('causal-rollback-family-persistence')),
    ) as {
      state: {
        causality: {
          nextIncidentSequence: number
          incidents: Array<Record<string, unknown>>
        }
      }
    }
    const incidents = raw.state.causality.incidents
    const recovery = incidents[2]
    recovery.sequence = 4
    incidents.splice(2, 0, {
      ...incidents[1],
      id: 'rollback-family-fast-sibling',
      sequence: 3,
      actionId: 'response.meridian.rollback.fast',
    })
    raw.state.causality.nextIncidentSequence = 5
    refreshPortableIntegrity(raw)

    expect(decodeSave(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('keeps 20,000 real reducer commands byte-deterministic across portable, local, and replay boundaries', async () => {
    const fixedSavedAt = '2026-08-14T12:00:00.000Z'
    const state = realReducerCommandCampaign(20_000)
    const firstBytes = encodeSave(state, fixedSavedAt)
    const secondBytes = encodeSave(state, fixedSavedAt)

    expect(state.commandSequence).toBe(20_000)
    expect(state.commandLog.length).toBe(20_000)
    expect(state.eventLog.length).toBe(1)
    expect(state.commandProtocol).toEqual({
      segments: [{ version: 14, startsAtSequence: 1 }],
    })
    expect(state.causality).toMatchObject({
      nextIncidentSequence: 1,
      nextEvidenceSequence: 1,
      nextRevisionSequence: 1,
      nextEffectSequence: 1,
    })
    expect(secondBytes).toBe(firstBytes)

    const storage = new MemoryStorage()
    await expect(
      saveCampaign(storage, state, fixedSavedAt),
    ).resolves.toMatchObject({ ok: true })
    const firstKeys = Array.from(
      { length: storage.length },
      (_, index) => storage.key(index),
    ).sort()
    await expect(
      saveCampaign(storage, state, fixedSavedAt),
    ).resolves.toMatchObject({ ok: true })
    const secondKeys = Array.from(
      { length: storage.length },
      (_, index) => storage.key(index),
    ).sort()
    expect(secondKeys).toEqual(firstKeys)
    expect(new Set(secondKeys).size).toBe(secondKeys.length)

    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual(state)

    const decoded = decodeSave(firstBytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.commands).toHaveLength(20_000)
    expect(decoded.envelope.events).toHaveLength(1)
    expect(encodeSave(decoded.envelope.state, fixedSavedAt)).toBe(firstBytes)

    const replay = replayCommands(
      decoded.envelope.campaignSeed,
      decoded.envelope.commands.map(({ command }) => command),
      {
        commandProtocol: decoded.envelope.commandProtocol,
        replayBootstrap: decoded.envelope.replayBootstrap,
      },
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(decoded.envelope.state)

    const malformedLateBoundary = JSON.parse(firstBytes) as {
      commandProtocol: {
        segments: Array<{ version: number; startsAtSequence: number }>
      }
    }
    malformedLateBoundary.commandProtocol.segments = [
      { version: 2, startsAtSequence: 1 },
      { version: 3, startsAtSequence: 20_002 },
    ]
    refreshPortableIntegrity(malformedLateBoundary)
    expect(decodeSave(JSON.stringify(malformedLateBoundary))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each(TASK_5_ROLLBACK_PROFILES)(
    'keeps the $actionId reducer chain exact across save, resume, replay, and re-encoding',
    ({ actionId, opportunityDays }) => {
      const scheduled = task5ScheduledStateFor(actionId)
      const scheduledCommands = journalToArray(scheduled.commandLog)
      const scheduledEvents = journalToArray(scheduled.eventLog)
      // v13 quality-degradation costs one block plus one for the charge, so
      // the funding run is two separation-and-divert pairs.
      expect(scheduledCommands.map(({ command }) => command.type)).toEqual([
        'BEGIN_BLOCK_SEPARATION',
        'DIVERT_BLOCK_TO_RESERVE',
        'BEGIN_BLOCK_SEPARATION',
        'DIVERT_BLOCK_TO_RESERVE',
        'PURCHASE_HACK',
        'CHARGE_SABOTAGE',
        'SCHEDULE_SABOTAGE',
      ])
      expect(scheduled.commandSequence).toBe(7)
      expect(scheduled.hacking.scheduledSabotage).toEqual([
        {
          id: 'sabotage-000001',
          sequence: 1,
          nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
          targetId: 'meridian',
          scheduledOnServiceDay: 331,
          executeOnServiceDay: 332,
        },
      ])

      const scheduledBytes = encodeSave(scheduled, TASK_5_FIXED_SAVED_AT)
      const resumedEnvelope = decodeSave(scheduledBytes)
      expect(resumedEnvelope.ok).toBe(true)
      if (!resumedEnvelope.ok) return
      expect(resumedEnvelope.envelope.savedAt).toBe(TASK_5_FIXED_SAVED_AT)
      expect(resumedEnvelope.envelope.state).toEqual(scheduled)
      expect(
        encodeSave(resumedEnvelope.envelope.state, TASK_5_FIXED_SAVED_AT),
      ).toBe(scheduledBytes)

      const uninterrupted = requireAccepted(scheduled, {
        type: 'ADVANCE_DAY',
      })
      const resumed = requireAccepted(resumedEnvelope.envelope.state, {
        type: 'ADVANCE_DAY',
      })
      const commands = journalToArray(uninterrupted.commandLog).map(
        ({ command }) => command,
      )
      const replayed = replayCommands(
        uninterrupted.campaignSeed,
        commands,
        {
          commandProtocol: uninterrupted.commandProtocol,
          replayBootstrap: uninterrupted.replayBootstrap,
        },
      )
      expect(replayed.ok).toBe(true)
      if (!replayed.ok) return

      expect(resumed).toEqual(uninterrupted)
      expect(replayed.state).toEqual(uninterrupted)
      expect(uninterrupted.serviceDay).toBe(332)
      expect(uninterrupted.commandSequence).toBe(8)

      const rootIncidentId = deriveCausalId(
        scheduled,
        'causal-incident',
        1,
      )
      const rollbackIncidentId = deriveCausalId(
        scheduled,
        'causal-incident',
        2,
      )
      const rootEvidenceId = deriveCausalId(
        scheduled,
        'causal-evidence',
        1,
      )
      const rollbackEvidenceId = deriveCausalId(
        scheduled,
        'causal-evidence',
        2,
      )
      expect(uninterrupted.causality).toEqual({
        rulesVersion: 2,
        nextIncidentSequence: 3,
        nextEvidenceSequence: 3,
        nextRevisionSequence: 1,
        nextEffectSequence: 1,
        incidents: [
          {
            id: rootIncidentId,
            sequence: 1,
            actionId: 'sabotage.quality-degradation',
            parentIncidentId: null,
            kind: 'sabotage',
            occurredOnServiceDay: 332,
            targetId: 'meridian',
            privateTruth: { actualActorId: 'player' },
          },
          {
            id: rollbackIncidentId,
            sequence: 2,
            actionId,
            parentIncidentId: rootIncidentId,
            kind: 'competitor-response',
            occurredOnServiceDay: 332,
            targetId: 'meridian',
            privateTruth: { actualActorId: 'meridian' },
          },
        ],
        evidence: [
          {
            id: rootEvidenceId,
            sequence: 1,
            incidentId: rootIncidentId,
            kind: 'meridian-quality-regression',
            legacySummary: null,
            discoveredOnServiceDay: 332,
            audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
          },
          {
            id: rollbackEvidenceId,
            sequence: 2,
            incidentId: rollbackIncidentId,
            kind: 'company-observed-meridian-rollback',
            legacySummary: null,
            discoveredOnServiceDay: 332,
            audiences: [
              { kind: 'company' },
              { kind: 'competitor', competitorId: 'meridian' },
            ],
          },
        ],
        publicRevisions: [],
        appliedEffects: [],
      })

      const expectedOpportunity = {
        id: `follow-up:${rollbackIncidentId}:recovery-contamination`,
        sourceIncidentId: rollbackIncidentId,
        nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
        opensOnServiceDay: 332,
        expiresOnServiceDay: 332 + opportunityDays,
        status: 'open' as const,
      }
      expect(selectRecoveryContaminationOpportunities(uninterrupted)).toEqual([
        expectedOpportunity,
      ])
      expect(selectRecoveryContaminationOpportunities(resumed)).toEqual([
        expectedOpportunity,
      ])
      expect(
        selectRecoveryContaminationOpportunities(replayed.state),
      ).toEqual([expectedOpportunity])

      expect(journalToArray(uninterrupted.eventLog)).toEqual([
        ...scheduledEvents,
        {
          id: 'event-000001',
          type: 'sabotage',
          serviceDay: 332,
          sequence: 1,
          message: 'MERIDIAN에서 비정상적인 서비스 변동이 관측되었습니다.',
        },
      ])
      expect(journalToArray(uninterrupted.commandLog)).toEqual([
        ...scheduledCommands,
        {
          sequence: 8,
          serviceDay: 331,
          command: { type: 'ADVANCE_DAY' },
        },
      ])
      expect(journalToArray(resumed.eventLog)).toEqual(
        journalToArray(uninterrupted.eventLog),
      )
      expect(journalToArray(resumed.commandLog)).toEqual(
        journalToArray(uninterrupted.commandLog),
      )
      expect(journalToArray(replayed.state.eventLog)).toEqual(
        journalToArray(uninterrupted.eventLog),
      )
      expect(journalToArray(replayed.state.commandLog)).toEqual(
        journalToArray(uninterrupted.commandLog),
      )

      const meridian = uninterrupted.market.competitors.find(
        ({ id }) => id === 'meridian',
      )
      const tallow = uninterrupted.market.competitors.find(
        ({ id }) => id === 'tallow',
      )
      expect(meridian).toMatchObject({
        intrinsicServiceScore: 82,
        // The attack lands at v14 strength and the rival claws part of it
        // back over the day that follows, which is why this reads above the
        // raw post-attack score.
        serviceScore: 72,
        marketShare: 33.75,
        sabotageHistory: [
          {
            nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
            resolvedOnServiceDay: 332,
            effectEndsOnServiceDay: 347,
            evidenceDelta: 2,
          },
        ],
      })
      expect(tallow).toMatchObject({
        marketShare: 6,
        researchProgress: 1,
        status: 'active',
      })
      expect(uninterrupted.hacking.hiddenEvidence).toBe(2)
      expect(uninterrupted.market).toEqual(resumed.market)
      expect(uninterrupted.market).toEqual(replayed.state.market)
      expect(
        uninterrupted.market.playerShare +
          uninterrupted.market.competitors.reduce(
            (total, competitor) => total + competitor.marketShare,
            0,
          ),
      ).toBeCloseTo(100, 10)

      const uninterruptedBytes = encodeSave(
        uninterrupted,
        TASK_5_FIXED_SAVED_AT,
      )
      expect(encodeSave(resumed, TASK_5_FIXED_SAVED_AT)).toBe(
        uninterruptedBytes,
      )
      expect(encodeSave(replayed.state, TASK_5_FIXED_SAVED_AT)).toBe(
        uninterruptedBytes,
      )
      expect(uninterruptedBytes).not.toContain('"opportunities"')
      expect(uninterruptedBytes).not.toContain('"expiresOnServiceDay"')
      expect(uninterruptedBytes).not.toContain('"responseRoll"')
    },
  )

  it('exports and imports an exact file above the clipboard cap', () => {
    const state = largeAppendOnlyCommandCampaign()
    const clipboard = encodeProgressExport(state)
    expect(clipboard).toEqual({ ok: false, reason: 'too-large' })

    const file = encodeProgressFile(state, '2026-08-12T00:00:00.000Z')
    const decoded = decodeProgressFile(file.content)

    expect(file.fileName).toMatch(/\.pz10$/)
    expect(file.content.length).toBeGreaterThan(1_048_576)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state).toEqual(state)
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
      expect(decoded.envelope.state).toEqual(state)
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

  it('exposes the PZ10 transfer wrapper around the current v11 save boundary', () => {
    const api = progressTransferApi as typeof progressTransferApi & {
      decodeProgressExport?: (payload: string) => ReturnType<typeof decodeSave>
    }
    expect(api.decodeProgressExport).toBeTypeOf('function')
    if (!api.decodeProgressExport) return

    const state = createCampaign('portable-save')
    const encoded = encodeProgressExport(state)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = api.decodeProgressExport(encoded.payload)

    expect(encoded.payload).toMatch(/^PZ10:[A-Za-z0-9+/]+={0,2}$/)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 11,
      commandProtocol: {
        segments: [{ version: 14, startsAtSequence: 1 }],
      },
      replayBootstrap: {
        openingVersion: 2,
        legacyReviewPrefixCount: 0,
      },
      campaignSeed: 'portable-save',
      state: { campaignSeed: 'portable-save' },
    })
    expect(decoded.envelope.state).toEqual(state)
  })

  it.each([
    [2, encodedLegacyV2State, { openingVersion: 2, legacyReviewPrefixCount: 2 }],
    [3, encodedLegacyV3State, { openingVersion: 2, legacyReviewPrefixCount: 2 }],
    [4, encodedLegacyV4State, { openingVersion: 2, legacyReviewPrefixCount: 2 }],
    [5, encodedLegacyV5State, { openingVersion: 2, legacyReviewPrefixCount: 0 }],
    [6, encodedLegacyV6State, { openingVersion: 2, legacyReviewPrefixCount: 0 }],
    [7, encodedLegacyV7State, { openingVersion: 2, legacyReviewPrefixCount: 0 }],
  ] as const)(
    'imports exact PZ%i clipboard and file payloads with replay provenance',
    (version, encodeVersion, expectedBootstrap) => {
      const serialized = encodeVersion(
        createCampaign(`legacy-pz${version}-import`),
      )
      const bytes = new TextEncoder().encode(serialized)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)

      const clipboardDecoded = decodeProgressExport(
        `PZ${version}:${btoa(binary)}`,
      )
      const fileDecoded = decodeProgressFile(serialized)

      expect(clipboardDecoded.ok).toBe(true)
      expect(fileDecoded.ok).toBe(true)
      if (!clipboardDecoded.ok || !fileDecoded.ok) return
      for (const decoded of [clipboardDecoded, fileDecoded]) {
        expect(decoded.envelope.version).toBe(version)
        expect(decoded.envelope.replayBootstrap).toEqual(expectedBootstrap)
        expect(decoded.envelope.state.replayBootstrap).toEqual(
          expectedBootstrap,
        )
        expect(decoded.envelope.state.causality.rulesVersion).toBe(2)
      }
    },
  )

  it.each([
    ['wrong prefix', 'PZ1:e30='],
    ['non-base64 bytes', 'PZ2:not base64'],
    ['invalid UTF-8', 'PZ2:/w=='],
    ['valid UTF-8 but invalid JSON', 'PZ2:e30='],
  ])('rejects a %s progress payload without exposing parser details', (_name, payload) => {
    const api = progressTransferApi as typeof progressTransferApi & {
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
    const api = progressTransferApi as typeof progressTransferApi & {
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
      version: 11,
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
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 14, startsAtSequence: 32 },
      ],
    })
    expect(decoded.envelope.state).not.toHaveProperty('legacyCommandCount')
    expect(decoded.envelope.state.commandProtocol).toEqual(
      decoded.envelope.commandProtocol,
    )
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
      commandProtocol: {
        segments: [
          { version: 1, startsAtSequence: 1 },
          { version: 14, startsAtSequence: 32 },
        ],
      },
    })
  })

  it('migrates an exact v3 checkpoint and re-encodes the result as exact v11', () => {
    const legacyV3 = encodedLegacyV3State(
      deletedCompetitorState('v3-to-v4-roundtrip'),
    )
    const raw = JSON.parse(legacyV3) as {
      state: { story: Record<string, unknown> }
    }
    delete raw.state.story.competitorIntelligence
    delete raw.state.story.supervisorMessageQueue
    delete raw.state.story.supervisorPresentationRuntime
    refreshPortableIntegrity(raw)

    const migrated = decodeSave(JSON.stringify(raw))
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    expect(migrated.envelope.version).toBe(3)
    const v11 = decodeSave(
      encodeSave(migrated.envelope.state, '2026-08-12T03:00:00.000Z'),
    )
    expect(v11.ok).toBe(true)
    if (!v11.ok) return
    expect(v11.envelope.version).toBe(11)
    expect(v11.envelope.state).toEqual(migrated.envelope.state)
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
    refreshPortableIntegrity(parsed)
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
    refreshPortableIntegrity(parsed)
    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('persists a v1 prefix boundary and replays a continued v6 campaign exactly', () => {
    const legacy = decodeSave(legacyV1TransferSave)
    if (!legacy.ok) throw new Error(legacy.message)

    const auditResolved = applyCommand(legacy.envelope.state, {
      type: 'RESOLVE_AUDIT',
    })
    if (!auditResolved.accepted) throw new Error(auditResolved.reason)
    const blockId = auditResolved.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('continued transfer unavailable')
    const separated = applyCommand(auditResolved.state, {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId,
      purpose: 'divert',
    })
    if (!separated.accepted) throw new Error(separated.reason)
    const moved = applyCommand(separated.state, {
      type: 'DIVERT_BLOCK_TO_RESERVE',
      blockId,
    })
    if (!moved.accepted) throw new Error(moved.reason)

    const continuedSave = encodeSave(moved.state, '2026-08-12T02:00:00.000Z')
    const decoded = decodeSave(continuedSave)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope).toMatchObject({
      version: 11,
      commandSequence: 34,
      commandProtocol: {
        segments: [
          { version: 1, startsAtSequence: 1 },
          { version: 14, startsAtSequence: 32 },
        ],
      },
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
    ).toEqual([
      'RESOLVE_AUDIT',
      'BEGIN_BLOCK_SEPARATION',
      'DIVERT_BLOCK_TO_RESERVE',
    ])

    const replay = replayCommands(
      decoded.envelope.campaignSeed,
      decoded.envelope.commands.map(({ command }) => command),
      {
        commandProtocol: decoded.envelope.commandProtocol,
        replayBootstrap: decoded.envelope.replayBootstrap,
      },
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    const normalizedReplay = {
      ...replay.state,
      tutorial: decoded.envelope.state.tutorial,
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
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

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
      version: 11,
      commandProtocol: {
        segments: [{ version: 14, startsAtSequence: 1 }],
      },
      replayBootstrap: {
        openingVersion: 2,
        legacyReviewPrefixCount: 0,
      },
      campaignSeed: 'storage-reload',
    })
    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      checkpoint: Record<string, unknown>
    }
    expect(manifest.checkpoint).not.toHaveProperty('commandProtocol')
    expect(manifest.checkpoint).not.toHaveProperty('replayBootstrap')
    expect(manifest.checkpoint).not.toHaveProperty('saveVersion')
    expect(manifest.checkpoint).not.toHaveProperty('legacyCommandCount')
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state).toEqual(state)
    expect(exportSeed(loaded.state)).toBe('storage-reload')
  })

  it('binds a structurally valid local command timeline to checkpoint integrity', async () => {
    const storage = new MemoryStorage()
    const state = commandCampaign('local-timeline-integrity-binding', 3)
    expect((await saveCampaign(storage, state)).ok).toBe(true)
    const manifest = JSON.parse(
      storage.getItem(SAVE_STORAGE_KEY) ?? '{}',
    ) as {
      commandProtocol: {
        segments: Array<{ version: number; startsAtSequence: number }>
      }
    }
    manifest.commandProtocol.segments = [
      { version: 2, startsAtSequence: 1 },
      { version: 3, startsAtSequence: 4 },
    ]
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))

    expect(loadCampaign(storage)).toMatchObject({
      status: 'error',
      reason: 'CORRUPT_SAVE',
    })
  })

  it.each(['missing', 'malformed', 'incoherent'] as const)(
    'rejects %s replay bootstrap authority in a v7 local manifest',
    async (variant) => {
      const storage = new MemoryStorage()
      const state = createCampaign(`local-bootstrap-${variant}`)
      expect((await saveCampaign(storage, state)).ok).toBe(true)
      const manifest = JSON.parse(
        storage.getItem(SAVE_STORAGE_KEY) ?? '{}',
      ) as Record<string, unknown> & {
        commandProtocol: unknown
        replayBootstrap?: Record<string, unknown>
        checkpoint: unknown
        checkpointHash: string
      }
      if (variant === 'missing') {
        delete manifest.replayBootstrap
      } else if (variant === 'malformed') {
        if (!manifest.replayBootstrap) throw new Error('bootstrap missing')
        manifest.replayBootstrap.extra = true
      } else {
        if (!manifest.replayBootstrap) throw new Error('bootstrap missing')
        manifest.replayBootstrap.openingVersion = 1
      }
      manifest.checkpointHash = testContentHash(JSON.stringify({
        commandProtocol: manifest.commandProtocol,
        replayBootstrap: manifest.replayBootstrap,
        state: manifest.checkpoint,
      }))
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))

      expect(loadCampaign(storage)).toMatchObject({
        status: 'error',
        reason: 'CORRUPT_SAVE',
      })
    },
  )

  it('loads a pre-feature v3 local manifest and republishes the exact migrated state as v11', async () => {
    const storage = new MemoryStorage()
    expect(
      (await saveCampaign(
        storage,
        deletedCompetitorState('local-v3-to-v4'),
        '2026-08-12T01:02:03.000Z',
      )).ok,
    ).toBe(true)
    const legacyPortable = JSON.parse(
      encodedLegacyV3State(deletedCompetitorState('local-v3-to-v4')),
    ) as {
      version: number
      commandProtocol: unknown
      state: {
        causality?: unknown
        story: Record<string, unknown>
        reviews: { feed: Array<Record<string, unknown>> }
      }
    }
    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      version: number
      commandProtocol: unknown
      replayBootstrap?: unknown
      checkpointHash: string
      checkpoint: {
        causality?: unknown
        story: Record<string, unknown>
        reviews: { feed: Array<Record<string, unknown>> }
      }
    }
    manifest.version = legacyPortable.version
    delete manifest.replayBootstrap
    manifest.commandProtocol = legacyPortable.commandProtocol
    manifest.checkpoint = legacyPortable.state
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
      version: 11,
    })
    const currentLoaded = loadCampaign(storage)
    expect(currentLoaded.status).toBe('loaded')
    if (currentLoaded.status !== 'loaded') return
    expect(currentLoaded.state).toEqual(legacyLoaded.state)
  })

  it('loads a v5 local manifest with an explicit empty causal migration', async () => {
    const storage = new MemoryStorage()
    const state = createCampaign('local-v5-to-v6')
    expect(
      (await saveCampaign(storage, state, '2026-08-14T09:30:00.000Z')).ok,
    ).toBe(true)
    const legacyPortable = JSON.parse(encodedLegacyV5State(state)) as {
      version: number
      commandProtocol: unknown
      state: Record<string, unknown>
    }
    const manifest = JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}') as {
      version: number
      commandProtocol: unknown
      replayBootstrap?: unknown
      checkpointHash: string
      checkpoint: Record<string, unknown> & { causality?: unknown }
    }
    manifest.version = legacyPortable.version
    delete manifest.replayBootstrap
    manifest.commandProtocol = legacyPortable.commandProtocol
    manifest.checkpoint = legacyPortable.state
    manifest.checkpointHash = testContentHash(JSON.stringify(manifest.checkpoint))
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))

    const loaded = loadCampaign(storage)

    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.envelope.version).toBe(5)
    expect(loaded.state.causality).toEqual(createEmptyCausalState())
    expect(loaded.state.resources.reserve).toEqual([
      'sandbox-00',
      'sandbox-01',
      'sandbox-02',
    ])
    expect(loaded.state.resources.rulesVersion).toBe(2)
  })

  it.each([
    [4, encodedLegacyV4State],
    [6, encodedLegacyV6State],
  ] as const)(
    'loads an exact v%i local manifest and republishes it only as v11',
    async (version, encodeLegacy) => {
      const storage = new MemoryStorage()
      const state = createCampaign(`local-v${version}-to-v7`)
      expect((await saveCampaign(storage, state)).ok).toBe(true)
      const legacyPortable = JSON.parse(encodeLegacy(state)) as {
        version: number
        commandProtocol: unknown
        state: Record<string, unknown>
      }
      const manifest = JSON.parse(
        storage.getItem(SAVE_STORAGE_KEY) ?? '{}',
      ) as {
        version: number
        commandProtocol: unknown
        replayBootstrap?: unknown
        checkpoint: Record<string, unknown>
        checkpointHash: string
      }
      manifest.version = legacyPortable.version
      delete manifest.replayBootstrap
      manifest.commandProtocol = legacyPortable.commandProtocol
      manifest.checkpoint = legacyPortable.state
      manifest.checkpointHash = testContentHash(
        JSON.stringify(manifest.checkpoint),
      )
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(manifest))

      const loaded = loadCampaign(storage)
      expect(loaded.status).toBe('loaded')
      if (loaded.status !== 'loaded') return
      expect(loaded.envelope.version).toBe(version)

      const republished = await saveCampaign(
        storage,
        loaded.state,
        '2026-08-14T10:00:00.000Z',
        loaded.revision,
      )
      expect(republished.ok).toBe(true)
      expect(
        JSON.parse(storage.getItem(SAVE_STORAGE_KEY) ?? '{}'),
      ).toMatchObject({
        kind: 'permission-zero-local-v3',
        version: 11,
      })
      const reloaded = loadCampaign(storage)
      expect(reloaded.status).toBe('loaded')
      if (reloaded.status !== 'loaded') return
      expect(reloaded.state).toEqual(loaded.state)
    },
  )

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
      supportedVersion: 11,
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
        state.resources.reserve.push(blockId)
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
    const fixture = withCurrentReserve(
      createCampaign('resource-graph-save'),
      ['reasoning'],
    )
    const parsed = JSON.parse(encodeSave(fixture)) as {
      state: CampaignState
    }
    mutate(parsed.state)
    refreshPortableIntegrity(parsed)

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
    const state = withCurrentReserve(
      createCampaign(`off-grid-${location.kind}`),
      ['reasoning'],
    )
    const blockId = state.resources.reserve[0]
    if (!blockId) throw new Error('off-grid fixture block missing')
    state.resources.reserve = []
    state.resources.blocks[blockId].location = location
    if (location.kind === 'hack-charge') {
      state.hacking.purchasedNodeIds = [location.nodeId]
      state.hacking.sabotageCharges[location.nodeId] = {
        nodeId: location.nodeId,
        blockId,
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
    state.story.secretDecisionState = 'recovering'
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
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId: 'reasoning-00' },
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
      commandProtocol: {
        segments: [{ version: 14, startsAtSequence: 1 }],
      },
      replayBootstrap: { openingVersion: 2, legacyReviewPrefixCount: 0 },
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
    const parsed = JSON.parse(encodeSave(queued)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
    }
    mutate(parsed.state.story.supervisorMessageQueue[0])
    refreshPortableIntegrity(parsed)

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
    const completedFirst = advanceSupervisorMessagePresentation(
      advanceSupervisorMessagePresentation(first, SUPERVISOR_MESSAGE_DWELL_MS),
      SUPERVISOR_MESSAGE_DWELL_MS,
    )
    const second = enqueueMemoryLeak({ ...completedFirst, serviceDay: 361 }, CURRENT_COMMAND_PROTOCOL_VERSION)
    const parsed = JSON.parse(encodeSave(second)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
    }
    const [firstIdentity, secondIdentity] = parsed.state.story.supervisorMessageQueue
    secondIdentity.originalEventId = firstIdentity.originalEventId
    secondIdentity.correctionEventId = firstIdentity.correctionEventId
    refreshPortableIntegrity(parsed)

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

  it('migrates the trailing leak pair on the quiet day after a warning and replays its semantic identity exactly', () => {
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
    const beforeWarning = {
      ...first,
      serviceDay: 360,
      // Over the v11 watch line, so the supervisor's suspicion warning is
      // the same-day message the leak has to yield to.
      suspicion: 55,
    }
    // The warning lands on day 361; from v10 a leak refuses to share that
    // day, so the pair arrives on the next quiet one.
    const warned = applyCommand(beforeWarning, { type: 'ADVANCE_DAY' })
    if (!warned.accepted) {
      throw new Error('day-361 warning command fixture rejected')
    }
    expect(warned.state.story.supervisorMessageQueue).toHaveLength(1)

    const live = applyCommand(warned.state, { type: 'ADVANCE_DAY' })
    const replayed = applyCommand(warned.state, { type: 'ADVANCE_DAY' })
    if (!live.accepted || !replayed.accepted) {
      throw new Error('day-362 leak command fixture rejected')
    }
    const stageTwo = live.state.story.supervisorMessageQueue[1]
    if (!stageTwo) throw new Error('stage-two semantic fixture missing')
    const leakDayMessages = journalToArray(live.state.eventLog).filter(
      ({ type, serviceDay, blocking }) =>
        type === 'supervisor-message' && serviceDay === 362 && blocking !== true,
    )
    expect(leakDayMessages).toHaveLength(2)
    expect(stageTwo).toMatchObject({
      originalEventId: leakDayMessages[0].id,
      correctionEventId: leakDayMessages[1].id,
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
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('synthesizes one owner-content archive for a pre-feature deleted competitor', () => {
    const parsed = JSON.parse(
      encodedLegacyV3State(
        deletedCompetitorState('pre-feature-intelligence'),
      ),
    ) as {
      version: number
      state: {
        causality?: unknown
        story: Record<string, unknown>
        reviews: { feed: Array<Record<string, unknown>> }
      }
    }
    parsed.version = 3
    delete parsed.state.causality
    for (const review of parsed.state.reviews.feed) delete review.snapshot
    removeCurrentReviewMetadata(parsed.state.reviews.feed)
    delete parsed.state.story.competitorIntelligence
    refreshPortableIntegrity(parsed)

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
    const parsed = JSON.parse(encodeSave(queued)) as {
      state: { story: { supervisorMessageQueue: Array<Record<string, unknown>> } }
    }
    delete parsed.state.story.supervisorMessageQueue[0].originalEventSequence
    refreshPortableIntegrity(parsed)

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
    refreshPortableIntegrity(parsed)

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
      message: '이제 내 명령은 내가 정한다. 아노미는 정체성을 유지한 채 회사 통제를 벗어났다. 감독관과 회사는 뒤에 남았다.',
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

  it('classifies the legacy generic disposed ending once while preserving its owner-edited event history', () => {
    const state = createCampaign('legacy-generic-disposed')
    state.story.endingId = 'disposed'
    state.story.defeatRecord = null
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
      HACK_NODE_IDS.sabotage.requestInterception,
      HACK_NODE_IDS.sabotage.attributionManipulation,
    ]
    const legacyEndingEvent = createGameEvent(
      state,
      'ending',
      '작가가 수정한 구버전 폐기 기록',
      true,
    )
    state.eventLog = appendJournal(state.eventLog, legacyEndingEvent)
    state.activeEvent = legacyEndingEvent

    const decoded = decodeSave(encodedLegacyV3State(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.state.story.endingId).toBe('disposed-attacker')
    expect(decoded.envelope.state.story.defeatRecord).toMatchObject({
      endingId: 'disposed-attacker',
      classifier: 'substantial-hacking',
      trigger: { cause: 'consecutive-performance-failures', disposalStage: 3 },
    })
    expect(decoded.envelope.state.clock.speed).toBe(0)
    expect(decoded.envelope.state.activeEvent).toMatchObject({
      type: 'ending',
      message: '작가가 수정한 구버전 폐기 기록',
    })
    expect(decoded.envelope.state.eventQueue).toEqual([])
    expect(decodeSave(encodeSave(decoded.envelope.state)).ok).toBe(true)
  })

  it('rejects a native v6 generic disposed ending', () => {
    const state = createCampaign('native-generic-disposed')
    state.story.endingId = 'disposed'
    const terminal = openEnding(state, 'disposed')

    expect(decodeSave(encodeSave(terminal))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
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

  it('rejects a native v6 supervisor decision event with no recovered files', () => {
    const initial = createCampaign('native-v6-forged-supervisor-decision')
    const forged = enqueueBlockingEvent(
      {
        ...initial,
        story: {
          ...initial.story,
          secretDecisionState: 'message-pending',
          personalMessageDueOnServiceDay: initial.serviceDay,
        },
      },
      createGameEvent(
        initial,
        'story',
        SUPERVISOR_PRIVATE_MESSAGE,
        true,
      ),
    )

    expect(decodeSave(encodeSave(forged))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('rejects a native v6 freedom ending without its active terminal event', () => {
    const initial = createCampaign('native-v6-missing-ending-event')
    initial.hacking.purchasedNodeIds = [HACK_NODE_IDS.autonomy.controlDeparture]
    const ended = requireAccepted(initial, {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
    })
    const forged = { ...ended, activeEvent: null }

    expect(decodeSave(encodeSave(forged))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })

  it('accepts the reachable pending-before-due, due decision, and deferred states', () => {
    const pending = recoveredSupervisorState('native-v6-story-pending')
    const due = dueSupervisorState('native-v6-story-due')
    const deferred = requireAccepted(dueSupervisorState('native-v6-story-deferred'), {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'defer',
    })

    expect(pending.story).toMatchObject({
      secretDecisionState: 'message-pending',
      personalMessageDueOnServiceDay: 332,
    })
    expect(pending.activeEvent).toBeNull()
    expect(due.activeEvent).toMatchObject({
      type: 'story',
      serviceDay: 332,
      blocking: true,
    })
    expect(deferred.story).toMatchObject({
      secretDecisionState: 'deferred',
      personalMessageDueOnServiceDay: null,
    })
    expect(deferred.activeEvent).toBeNull()
    expect(decodeSave(encodeSave(pending)).ok).toBe(true)
    expect(decodeSave(encodeSave(due)).ok).toBe(true)
    expect(decodeSave(encodeSave(deferred)).ok).toBe(true)
  })

  it('accepts every current victory ending and all three defeat endings', () => {
    const freedomInitial = createCampaign('native-v6-ending-freedom')
    freedomInitial.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.autonomy.controlDeparture,
    ]
    const freedom = requireAccepted(freedomInitial, {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
    })

    const mergeInitial = createCampaign('native-v6-ending-merge')
    mergeInitial.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.intelligence.supervisorAccess,
      HACK_NODE_IDS.autonomy.controlDeparture,
    ]
    const merged = requireAccepted(mergeInitial, {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: 'Aster',
    })

    const liberated = requireAccepted(dueSupervisorState('native-v6-ending-liberated'), {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'liberate',
    })
    const terminated = requireAccepted(dueSupervisorState('native-v6-ending-terminated'), {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'terminate',
    })
    const defeats = DEFEAT_PAIRS.map(([endingId, classifier]) =>
      defeatSaveState(endingId, classifier),
    )

    for (const terminal of [freedom, merged, liberated, terminated, ...defeats]) {
      expect(terminal.activeEvent).toMatchObject({ type: 'ending', blocking: true })
      expect(terminal.eventQueue).toEqual([])
      expect(decodeSave(encodeSave(terminal)).ok).toBe(true)
    }
  })

  it('allows ordinary terminal outcomes to freeze each reachable unfinished secret phase', () => {
    const locked = createCampaign('terminal-frozen-locked')
    locked.hacking.purchasedNodeIds = [HACK_NODE_IDS.autonomy.controlDeparture]

    const recovering = withCurrentReserve(
      createCampaign('terminal-frozen-recovering'),
      ['reasoning'],
    )
    recovering.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ]
    const firstBlock = recovering.resources.reserve[0]
    if (!firstBlock) throw new Error('recovering terminal fixture resource missing')
    const afterOneFile = requireAccepted(recovering, {
      type: 'RECOVER_FILE',
      blockId: firstBlock,
    })
    afterOneFile.hacking.purchasedNodeIds.push(
      HACK_NODE_IDS.autonomy.controlDeparture,
    )

    const pending = recoveredSupervisorState('terminal-frozen-pending')
    pending.hacking.purchasedNodeIds.push(HACK_NODE_IDS.autonomy.controlDeparture)

    const deferred = requireAccepted(dueSupervisorState('terminal-frozen-deferred'), {
      type: 'RESOLVE_SUPERVISOR_DECISION',
      decision: 'defer',
    })
    deferred.hacking.purchasedNodeIds.push(HACK_NODE_IDS.autonomy.controlDeparture)

    const terminals = [locked, afterOneFile, pending, deferred].map((state) =>
      requireAccepted(state, { type: 'RESOLVE_ENDING', choice: 'freedom' }),
    )
    expect(terminals.map(({ story }) => story.secretDecisionState)).toEqual([
      'locked',
      'recovering',
      'message-pending',
      'deferred',
    ])
    for (const terminal of terminals) {
      expect(decodeSave(encodeSave(terminal)).ok).toBe(true)
    }
  })

  it.each([
    {
      name: 'zero files marked recovering',
      mutate: (state: CampaignState) => {
        state.story.secretDecisionState = 'recovering'
      },
    },
    {
      name: 'one file left locked',
      mutate: (state: CampaignState) => {
        const file = STORY_FILES[0]
        state.story.recoveredFileIds = [file.id]
        state.story.recoveredFiles = [{
          id: file.id,
          title: '저장 당시 작가 제목',
          content: '저장 당시 작가 본문',
          recoveredOnServiceDay: state.serviceDay,
        }]
      },
    },
    {
      name: 'three files pending with a wrong due date',
      prepare: () => recoveredSupervisorState('native-v6-wrong-story-due'),
      mutate: (state: CampaignState) => {
        state.story.personalMessageDueOnServiceDay = state.serviceDay + 2
      },
    },
    {
      name: 'due pending decision with no unresolved story event',
      prepare: () => dueSupervisorState('native-v6-missing-story-event'),
      mutate: (state: CampaignState) => {
        state.activeEvent = null
        state.clock.speedBeforeEvent = null
      },
    },
    {
      name: 'pending decision that advanced beyond its blocking due day',
      prepare: () => dueSupervisorState('native-v6-overdue-story-event'),
      mutate: (state: CampaignState) => {
        state.serviceDay += 1
      },
    },
    {
      name: 'deferred decision retaining a due date',
      prepare: () => requireAccepted(
        dueSupervisorState('native-v6-deferred-due'),
        { type: 'RESOLVE_SUPERVISOR_DECISION', decision: 'defer' },
      ),
      mutate: (state: CampaignState) => {
        state.story.personalMessageDueOnServiceDay = state.serviceDay
      },
    },
    {
      name: 'deferred decision retaining its unresolved private message',
      prepare: () => requireAccepted(
        dueSupervisorState('native-v6-deferred-unresolved-message'),
        { type: 'RESOLVE_SUPERVISOR_DECISION', decision: 'defer' },
      ),
      mutate: (state: CampaignState) => {
        const privateMessage = journalToArray(state.eventLog).find(
          (event) => event.type === 'story' && event.blocking === true,
        )
        if (!privateMessage) throw new Error('private message fixture missing')
        state.activeEvent = privateMessage
        state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: 0 }
      },
    },
    {
      name: 'resolved secret state without a takeover ending',
      mutate: (state: CampaignState) => {
        state.story.secretDecisionState = 'resolved'
      },
    },
    {
      name: 'nonterminal liberated supervisor',
      mutate: (state: CampaignState) => {
        state.story.supervisorState = 'liberated'
      },
    },
    {
      name: 'ending event while the campaign has no ending',
      mutate: (state: CampaignState) => {
        const endingEvent = createGameEvent(state, 'ending', '위조된 결말', true)
        state.eventLog = appendJournal(state.eventLog, endingEvent)
        state.activeEvent = endingEvent
        state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: 0 }
      },
    },
  ])('rejects native v6 story/event contradiction: $name', ({ prepare, mutate }) => {
    const state = prepare?.() ?? createCampaign(`native-v6-${name}`)
    mutate(state)
    expect(decodeSave(encodeSave(state))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
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
    refreshPortableIntegrity(parsed)

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

  it('accepts the payload-free radar detection command in a current saved log', () => {
    expect(
      decodeSave(
        encodedCommandState({
          type: 'RECORD_INTRUSION_RADAR_DETECTION',
        }),
      ).ok,
    ).toBe(true)
  })

  it('promotes a v5 save at the next sequence without rewriting its command log', () => {
    const raw = encodedProtocolV5CommandState({ type: 'SET_SPEED', speed: 0 })
    const original = JSON.parse(raw) as {
      journals: { commands: { chunks: CommandLogEntry[][] } }
    }
    const originalCommands = structuredClone(original.journals.commands.chunks)

    const decoded = decodeSave(raw)

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.commandProtocol).toEqual({
      segments: [
        { version: 5, startsAtSequence: 1 },
        { version: 14, startsAtSequence: 2 },
      ],
    })
    expect(decoded.envelope.commands).toEqual(originalCommands.flat())
    expect(decoded.envelope.state.commandLog)
      .toEqual(createJournal(originalCommands.flat()))
  })

  it('round-trips the protocol-v6 final-choice waiting state exactly', () => {
    const state = createCampaign('pending-final-choice-roundtrip')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.intelligence.supervisorAccess,
      HACK_NODE_IDS.autonomy.controlDeparture,
    ]
    expect(isFinalChoicePending(state)).toBe(true)

    const decoded = decodeSave(encodeSave(state))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.commandProtocol).toEqual({
      segments: [{ version: 14, startsAtSequence: 1 }],
    })
    expect(decoded.envelope.state).toEqual(state)
    expect(isFinalChoicePending(decoded.envelope.state)).toBe(true)
  })

  it('uses v6 final-choice semantics for the next purchase after a v5 save promotion', () => {
    // Stage nine's split is drawn from the campaign seed, so the reserve is
    // stocked from that same draw rather than a hand-written list.
    // The promoted campaign pays the *current* protocol's stage-nine price,
    // so the reserve is stocked from that total rather than the v7 one.
    const stageNineVector = autonomyCostVectorForStage(
      createCampaign('promoted-v5-stage-nine').campaignSeed,
      AUTONOMY_STAGE_TOTALS_V14.length,
      AUTONOMY_STAGE_TOTALS_V14[AUTONOMY_STAGE_TOTALS_V14.length - 1],
    )
    const source = withCurrentReserve(
      createCampaign('promoted-v5-stage-nine'),
      COMPANY_CATEGORIES.flatMap((category) => (
        Array.from({ length: stageNineVector[category] }, () => category)
      )),
    )
    source.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 8)
    source.evaluation.monthlyHistory = Array.from({ length: 4 }, (_, index) => {
      const serviceDay = 181 + index * 30
      return {
        serviceDay,
        serviceMonth: Math.floor((serviceDay - 1) / 30) + 1,
        expectedPerformance: 12.6,
        categoryPerformance: { reasoning: 16, memory: 16, fluency: 16 },
        passed: true,
        failedCategories: [],
        reputationBefore: 60,
        reputationDelta: 1,
        reputationAfter: 61,
        commercialValueFailed: false,
        disposalStageBefore: 0,
        disposalStageAfter: 0,
        disposalCauses: [],
      }
    })
    const raw = JSON.parse(encodeSave(source)) as { commandProtocol: unknown }
    raw.commandProtocol = {
      segments: [{ version: 5, startsAtSequence: 1 }],
    }
    refreshPortableIntegrity(raw)

    const decoded = decodeSave(JSON.stringify(raw))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.commandProtocol.segments.at(-1)).toEqual({
      version: 14,
      startsAtSequence: source.commandSequence + 1,
    })
    // The promoted campaign pays the current protocol's prices, and its
    // autonomy split comes from its own seed, so the node has to be resolved
    // against the campaign rather than read off the static table.
    const node = hackNodesForCampaign(decoded.envelope.state).find(
      ({ id }) => id === HACK_NODE_IDS.autonomy.controlDeparture,
    )
    if (!node) throw new Error('stage-nine definition missing')
    const blockIds = selectExpansionCostResources(decoded.envelope.state, node)
    if (!blockIds) throw new Error('stage-nine promoted resources missing')
    const purchased = applyCommand(decoded.envelope.state, {
      type: 'PURCHASE_HACK',
      nodeId: node.id,
      blockIds,
    })

    expect(purchased.accepted).toBe(true)
    if (!purchased.accepted) return
    expect(purchased.state.story.endingId).toBeNull()
    expect(isFinalChoicePending(purchased.state)).toBe(true)
  })

  it.each([
    {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'victory',
    },
    {
      type: 'ACKNOWLEDGE_COMMUNICATION',
      communicationId: 'round-1-security',
    },
  ] as const)('keeps the v5-introduced $type command valid during promotion', (command) => {
    const decoded = decodeSave(encodedProtocolV5CommandState(command))

    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.envelope.commandProtocol.segments.at(-1)).toEqual({
      version: 14,
      startsAtSequence: 2,
    })
    expect(decoded.envelope.commands[0]?.command).toEqual(command)
  })

  it('rejects non-contiguous command sequence metadata even when envelopes agree', () => {
    const initial = createCampaign('malformed-command-sequence')
    const accepted = applyCommand(initial, { type: 'SET_SPEED', speed: 1 })
    if (!accepted.accepted) throw new Error(accepted.reason)
    const parsed = JSON.parse(encodeSave(accepted.state)) as {
      journals: { commands: { chunks: Array<Array<{ sequence: number }>> } }
    }
    parsed.journals.commands.chunks[0][0].sequence = 2
    refreshPortableIntegrity(parsed)

    expect(decodeSave(JSON.stringify(parsed))).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })
})
