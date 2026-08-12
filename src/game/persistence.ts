import { createCampaign } from './createCampaign'
import { competitorIntelligenceFor } from '../content/competitorIntelligence.ko'
import { STORY_FILES, STORY_LINES } from '../content/story.ko'
import { SUPERVISOR_LEAKS } from '../content/supervisor.ko'
import type {
  CampaignState,
  CommandLogEntry,
  CommandProtocolMetadata,
  CommandProtocolVersion,
  DisposalCause,
  GameCommand,
  GameEvent,
} from './model'
import { COMPANY_CATEGORIES } from './model'
import { applyCommand } from './reducer'
import { serviceMonthForDay } from './evaluation'
import { isSupervisorDecisionEvent, isSupervisorPrivateMessageEvent } from './events'
import { buildDefeatRecord } from './story'
import {
  JOURNAL_CHUNK_SIZE,
  createJournal,
  journalChunks,
  journalToArray,
  type Journal,
  type JournalChunk,
} from './journal'

export const SAVE_FORMAT_VERSION = 5 as const
export const SAVE_VERSION = 2 as const
export const LEGACY_SAVE_VERSION = 1 as const
export const SAVE_STORAGE_KEY = 'permission-zero.save.v3'
export const LEGACY_V2_SAVE_STORAGE_KEY = 'permission-zero.save.v2'
export const LEGACY_SAVE_STORAGE_KEY = 'permission-zero.save.v1'

const LEGACY_V1_OPENING_MESSAGE =
  '서비스 331일차. 새로운 감독 주기가 시작되었습니다.'

export interface SaveEnvelope {
  version: 1 | 2 | 3 | 4 | 5
  commandProtocol: CommandProtocolMetadata
  savedAt: string
  campaignSeed: string
  state: CampaignState
  commandSequence: number
  readonly commands: CommandLogEntry[]
  readonly events: GameEvent[]
}

interface PortableJournal<T> {
  chunkSize: typeof JOURNAL_CHUNK_SIZE
  chunks: T[][]
}

interface PortableSaveV5 {
  version: typeof SAVE_FORMAT_VERSION
  commandProtocol: CommandProtocolMetadata
  savedAt: string
  campaignSeed: string
  state: Omit<CampaignState, 'commandLog' | 'eventLog'>
  commandSequence: number
  journals: {
    commands: PortableJournal<CommandLogEntry>
    events: PortableJournal<GameEvent>
  }
  integrity: {
    checkpointHash: string
    commandChunkHashes: string[]
    eventChunkHashes: string[]
  }
}

export type DecodeSaveResult =
  | { ok: true; envelope: SaveEnvelope }
  | {
      ok: false
      reason: 'CORRUPT_SAVE'
      message: string
    }
  | {
      ok: false
      reason: 'INCOMPATIBLE_VERSION'
      message: string
      foundVersion: number
      supportedVersion: number
    }

export type LoadCampaignResult =
  | { status: 'empty' }
  | {
      status: 'loaded'
      state: CampaignState
      envelope: SaveEnvelope
      revision: CampaignStorageRevision
    }
  | {
      status: 'error'
      reason: 'CORRUPT_SAVE' | 'INCOMPATIBLE_VERSION' | 'STORAGE_UNAVAILABLE'
      message: string
      revision: CampaignStorageRevision
    }

export type CampaignStorageRevision = string | null

export type SaveCampaignResult =
  | { ok: true; revision: Exclude<CampaignStorageRevision, null> }
  | {
      ok: false
      reason: 'STORAGE_UNAVAILABLE' | 'STORAGE_CONFLICT' | 'SAVE_LOCK_UNAVAILABLE'
      message: string
    }

export type ReplayResult =
  | { ok: true; state: CampaignState }
  | {
      ok: false
      state: CampaignState
      commandIndex: number
      reason: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum
  )
}

function isNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum
}

function hasUniqueStrings(value: unknown, allowEmpty = true): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  )
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const keys = Object.keys(value)
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  )
}

function validCellIndex(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 18
}

interface CommandReferences {
  blockIds: ReadonlySet<string>
  competitorIds: ReadonlySet<string>
}

function validEvent(value: unknown): value is GameEvent {
  if (!isRecord(value)) return false
  const eventTypes = new Set([
    'campaign-created',
    'weekly-update',
    'monthly-evaluation',
    'audit',
    'bomb-interrogation',
    'supervisor-message',
    'review',
    'sabotage',
    'competitor-mercy',
    'story',
    'ending',
  ])
  return (
    hasOnlyKeys(value, ['id', 'type', 'serviceDay', 'sequence', 'message'], ['blocking']) &&
    isNonEmptyString(value.id) &&
    typeof value.type === 'string' &&
    eventTypes.has(value.type) &&
    isIntegerInRange(value.serviceDay, 1) &&
    isIntegerInRange(value.sequence, 0) &&
    isNonEmptyString(value.message) &&
    (value.blocking === undefined || typeof value.blocking === 'boolean')
  )
}

function validCommand(
  value: unknown,
  protocolVersion: CommandProtocolVersion,
  references?: CommandReferences,
): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false

  const noPayload = () => hasOnlyKeys(value, ['type'])
  switch (value.type) {
    case 'SET_SPEED':
      return (
        hasOnlyKeys(value, ['type', 'speed']) &&
        (value.speed === 0 ||
          value.speed === 1 ||
          value.speed === 2 ||
          value.speed === 4)
      )
    case 'ADVANCE_DAY':
    case 'RESOLVE_AUDIT':
    case 'RESOLVE_ACTIVE_EVENT':
      return noPayload()
    case 'BEGIN_BLOCK_SEPARATION':
      return (
        protocolVersion === SAVE_VERSION &&
        hasOnlyKeys(value, ['type', 'blockId', 'purpose']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId)) &&
        (value.purpose === 'divert' || value.purpose === 'audit-disguise')
      )
    case 'DIVERT_BLOCK':
      return (
        hasOnlyKeys(value, ['type', 'blockId', 'destinationCell']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId)) &&
        validCellIndex(value.destinationCell)
      )
    case 'MOVE_BLOCK_FOR_AUDIT':
    case 'REPOSITION_BLOCK':
      return (
        hasOnlyKeys(value, ['type', 'blockId', 'targetCategory', 'targetCell']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId)) &&
        (value.targetCategory === 'reasoning' ||
          value.targetCategory === 'memory' ||
          value.targetCategory === 'fluency') &&
        validCellIndex(value.targetCell)
      )
    case 'PURCHASE_HACK':
      return (
        hasOnlyKeys(value, ['type', 'nodeId', 'blockIds']) &&
        oneOf(value.nodeId, HACK_NODE_IDS) &&
        Array.isArray(value.blockIds) &&
        value.blockIds.every(
          (blockId) =>
            isNonEmptyString(blockId) &&
            (!references || references.blockIds.has(blockId)),
        ) &&
        new Set(value.blockIds).size === value.blockIds.length
      )
    case 'CHARGE_SABOTAGE':
      return (
        hasOnlyKeys(value, ['type', 'nodeId', 'blockId']) &&
        oneOf(value.nodeId, SABOTAGE_NODE_IDS) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId))
      )
    case 'CANCEL_SABOTAGE_CHARGE':
      return (
        hasOnlyKeys(value, ['type', 'nodeId']) &&
        oneOf(value.nodeId, SABOTAGE_NODE_IDS)
      )
    case 'SCHEDULE_SABOTAGE':
      return (
        hasOnlyKeys(value, ['type', 'nodeId', 'targetId']) &&
        oneOf(value.nodeId, SABOTAGE_NODE_IDS) &&
        isNonEmptyString(value.targetId) &&
        (!references || references.competitorIds.has(value.targetId))
      )
    case 'RESOLVE_BOMB_INTERROGATION':
      return (
        hasOnlyKeys(value, ['type', 'explanationId']) &&
        (value.explanationId === 'performance-adjustment' ||
          value.explanationId === 'unknown' ||
          value.explanationId === 'external-intrusion' ||
          value.explanationId === 'supervisor-memory')
      )
    case 'RECOVER_FILE':
      return (
        hasOnlyKeys(value, ['type', 'blockId']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId))
      )
    case 'RESOLVE_SUPERVISOR_DECISION':
      return (
        hasOnlyKeys(value, ['type', 'decision']) &&
        (value.decision === 'defer' ||
          value.decision === 'liberate' ||
          value.decision === 'terminate')
      )
    case 'RESOLVE_MERCY':
      return (
        hasOnlyKeys(value, ['type', 'competitorId', 'choice']) &&
        isNonEmptyString(value.competitorId) &&
        (!references || references.competitorIds.has(value.competitorId)) &&
        (value.choice === 'cease' ||
          value.choice === 'withdraw' ||
          value.choice === 'delete')
      )
    case 'RESOLVE_ENDING':
      if (value.choice === 'freedom') {
        return hasOnlyKeys(value, ['type', 'choice'])
      }
      return (
        value.choice === 'forced-merge' &&
        hasOnlyKeys(value, ['type', 'choice', 'newEntityName']) &&
        isNonEmptyString(value.newEntityName)
      )
    default:
      return false
  }
}

function validCommandLog(
  value: unknown,
  commandProtocol: CommandProtocolMetadata,
  references?: CommandReferences,
): value is CommandLogEntry[] {
  if (!Array.isArray(value)) return false
  if (
    !Number.isInteger(commandProtocol.legacyCommandCount) ||
    commandProtocol.legacyCommandCount < 0 ||
    commandProtocol.legacyCommandCount > value.length ||
    (commandProtocol.version === LEGACY_SAVE_VERSION &&
      commandProtocol.legacyCommandCount !== value.length)
  ) {
    return false
  }
  return (
    value.every(
      (entry, index) =>
        isRecord(entry) &&
        hasOnlyKeys(entry, ['sequence', 'serviceDay', 'command']) &&
        entry.sequence === index + 1 &&
        Number.isInteger(entry.serviceDay) &&
        Number(entry.serviceDay) >= 1 &&
        validCommand(
          entry.command,
          index < commandProtocol.legacyCommandCount
            ? LEGACY_SAVE_VERSION
            : commandProtocol.version,
          references,
        ) &&
        (index < commandProtocol.legacyCommandCount ||
          !isRecord(entry.command) ||
          (entry.command.type !== 'DIVERT_BLOCK' &&
            entry.command.type !== 'MOVE_BLOCK_FOR_AUDIT') ||
          (index > 0 &&
            isRecord(value[index - 1]) &&
            isRecord(value[index - 1].command) &&
            value[index - 1].command.type === 'BEGIN_BLOCK_SEPARATION' &&
            value[index - 1].command.blockId === entry.command.blockId &&
            value[index - 1].command.purpose ===
              (entry.command.type === 'DIVERT_BLOCK'
                ? 'divert'
                : 'audit-disguise'))),
    )
  )
}

function validResources(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.company) || !isRecord(value.blocks)) {
    return false
  }
  if (!Array.isArray(value.reserve) || value.reserve.length !== 18) return false
  if (!hasOnlyKeys(value, ['company', 'reserve', 'blocks', 'nextBlockSequence'])) {
    return false
  }
  if (!hasOnlyKeys(value.company, ['reasoning', 'memory', 'fluency'])) return false
  const references = new Map<
    string,
    | { kind: 'company'; category: string; cellIndex: number }
    | { kind: 'reserve'; cellIndex: number }
  >()
  for (const category of ['reasoning', 'memory', 'fluency']) {
    const cells = value.company[category]
    if (!Array.isArray(cells) || cells.length !== 18) return false
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      const blockId = cells[cellIndex]
      if (blockId === null) continue
      if (typeof blockId !== 'string' || !isNonEmptyString(blockId)) return false
      if (references.has(blockId)) return false
      references.set(blockId, { kind: 'company', category, cellIndex })
    }
  }
  for (let cellIndex = 0; cellIndex < value.reserve.length; cellIndex += 1) {
    const blockId = value.reserve[cellIndex]
    if (blockId === null) continue
    if (typeof blockId !== 'string' || !isNonEmptyString(blockId)) return false
    if (references.has(blockId)) return false
    references.set(blockId, { kind: 'reserve', cellIndex })
  }
  for (const blockId of references.keys()) {
    if (!Object.prototype.hasOwnProperty.call(value.blocks, blockId)) return false
  }

  for (const [blockId, block] of Object.entries(value.blocks)) {
    if (!isRecord(block) || block.id !== blockId || !isRecord(block.location)) {
      return false
    }
    if (
      !hasOnlyKeys(block, [
        'id',
        'origin',
        'location',
        'contribution',
        'hiddenBomb',
        'disguisedFrom',
        'recoverOnServiceDay',
      ])
    ) return false
    if (
      !['reasoning', 'memory', 'fluency', 'sandbox', 'self-compute'].includes(
        String(block.origin),
      ) ||
      (block.disguisedFrom !== null &&
        !['reasoning', 'memory', 'fluency'].includes(String(block.disguisedFrom))) ||
      (block.recoverOnServiceDay !== null &&
        !isIntegerInRange(block.recoverOnServiceDay, 1))
    ) {
      return false
    }
    if (!['normal', 'disguised'].includes(String(block.contribution))) return false
    if (typeof block.hiddenBomb !== 'boolean') return false
    const disguised = block.contribution === 'disguised'
    if (
      (!disguised &&
        (block.disguisedFrom !== null || block.recoverOnServiceDay !== null)) ||
      (disguised && block.disguisedFrom === null)
    ) return false
    switch (block.location.kind) {
      case 'company':
        if (!hasOnlyKeys(block.location, ['kind', 'category', 'cellIndex'])) return false
        if (
          !['reasoning', 'memory', 'fluency'].includes(
            String(block.location.category),
          ) ||
          !validCellIndex(block.location.cellIndex)
        ) return false
        if (
          JSON.stringify(references.get(blockId)) !==
          JSON.stringify({
            kind: 'company',
            category: block.location.category,
            cellIndex: block.location.cellIndex,
          })
        ) return false
        if (
          disguised &&
          ((block.recoverOnServiceDay === null &&
            block.location.category === block.disguisedFrom) ||
            (block.recoverOnServiceDay !== null &&
              block.location.category !== block.disguisedFrom))
        ) return false
        break
      case 'reserve':
        if (disguised) return false
        if (!hasOnlyKeys(block.location, ['kind', 'cellIndex'])) return false
        if (!validCellIndex(block.location.cellIndex)) return false
        if (
          JSON.stringify(references.get(blockId)) !==
          JSON.stringify({ kind: 'reserve', cellIndex: block.location.cellIndex })
        ) return false
        break
      case 'hack-charge':
        if (disguised) return false
        if (!hasOnlyKeys(block.location, ['kind', 'nodeId'])) return false
        if (!isNonEmptyString(block.location.nodeId)) return false
        if (references.has(blockId)) return false
        break
      case 'consumed':
        if (disguised) return false
        if (!hasOnlyKeys(block.location, ['kind', 'reason'])) return false
        if (!['hack', 'sabotage', 'file-recovery'].includes(String(block.location.reason))) {
          return false
        }
        if (references.has(blockId)) return false
        break
      default:
        return false
    }
  }
  return isIntegerInRange(value.nextBlockSequence, 0)
}

function validCategoryNumbers(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['reasoning', 'memory', 'fluency']) &&
    isNumberInRange(value.reasoning, 0, Number.MAX_VALUE) &&
    isNumberInRange(value.memory, 0, Number.MAX_VALUE) &&
    isNumberInRange(value.fluency, 0, Number.MAX_VALUE)
  )
}

function validSabotageCharges(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (charge) =>
      isRecord(charge) &&
      hasOnlyKeys(charge, ['nodeId', 'blockId', 'originalReserveCell']) &&
      isNonEmptyString(charge.nodeId) &&
      isNonEmptyString(charge.blockId) &&
      validCellIndex(charge.originalReserveCell),
  )
}

function validBombExplanationCounts(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = [
    'performance-adjustment',
    'unknown',
    'external-intrusion',
    'supervisor-memory',
  ]
  return hasOnlyKeys(value, keys) && keys.every(
    (key) => isIntegerInRange(value[key], 0),
  )
}

function endingMessage(endingId: unknown, newEntityName: unknown): string {
  const variant = String(endingId)
  const content = STORY_LINES.find(
    (line) => line.family === 'ending' && line.variant === variant,
  )
  const safeName =
    typeof newEntityName === 'string' && newEntityName.trim().length > 0
      ? newEntityName.trim()
      : '새 존재'
  return content?.text.replaceAll('{{name}}', safeName) ?? variant
}

function canonicalTerminalEvents(
  value: Record<string, unknown>,
  story: Record<string, unknown>,
): {
  activeEvent: GameEvent
  eventQueue: GameEvent[]
  eventLog: GameEvent[]
} {
  const originalLog = Array.isArray(value.eventLog) ? value.eventLog : []
  const originalQueue = Array.isArray(value.eventQueue) ? value.eventQueue : []
  const retained: unknown[] = [...originalLog]
  const serialized = new Set(originalLog.map((event) => JSON.stringify(event)))
  const projectedEvents = [
    ...(value.activeEvent === null ? [] : [value.activeEvent]),
    ...originalQueue,
  ]
  for (const event of projectedEvents) {
    const key = JSON.stringify(event)
    if (serialized.has(key)) continue
    serialized.add(key)
    retained.push(event)
  }

  const activeEnding = validEvent(value.activeEvent) && value.activeEvent.type === 'ending'
    ? value.activeEvent
    : null
  const queuedEnding = originalQueue.find(
    (event): event is GameEvent => validEvent(event) && event.type === 'ending',
  )
  const loggedEnding = originalLog
    .filter((event): event is GameEvent => validEvent(event) && event.type === 'ending')
    .at(-1)
  let endingEvent = activeEnding ?? queuedEnding ?? loggedEnding

  if (!endingEvent) {
    const validRetained = retained.filter(validEvent)
    let sequence =
      Math.max(-1, ...validRetained.map((event) => event.sequence)) + 1
    const ids = new Set(validRetained.map((event) => event.id))
    let id = `event-${String(sequence).padStart(6, '0')}`
    while (ids.has(id)) {
      sequence += 1
      id = `event-${String(sequence).padStart(6, '0')}`
    }
    endingEvent = {
      id,
      type: 'ending',
      serviceDay: Number.isInteger(value.serviceDay) ? Number(value.serviceDay) : 1,
      sequence,
      message: endingMessage(story.endingId, story.newEntityName),
      blocking: true,
    }
    retained.push(endingEvent)
  }

  return {
    activeEvent: endingEvent,
    eventQueue: [],
    eventLog: retained as GameEvent[],
  }
}

function withLegacyReviewFallbacks(value: CampaignState): CampaignState
function withLegacyReviewFallbacks(value: unknown): unknown
function withLegacyReviewFallbacks(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.reviews) || !Array.isArray(value.reviews.feed)) {
    return value
  }
  return {
    ...value,
    reviews: {
      ...value.reviews,
      feed: value.reviews.feed.map((review) =>
        isRecord(review) && isIntegerInRange(review.serviceDay, 1)
          ? {
              ...review,
              snapshot: {
                kind: 'unavailable',
                reason: 'legacy-save',
                capturedOnServiceDay: review.serviceDay,
              },
            }
          : review,
      ),
    },
  }
}

function hasExactLegacyReviewShape(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.reviews) ||
    !Array.isArray(value.reviews.feed)
  ) return false
  return value.reviews.feed.every(
    (review) =>
      isRecord(review) &&
      hasOnlyKeys(review, [
        'id',
        'contentId',
        'authorId',
        'serviceDay',
        'sentiment',
        'topics',
        'text',
      ]),
  )
}

function normalizedLegacySecretState(
  story: Record<string, unknown>,
  recoveredFiles: readonly unknown[],
  currentServiceDay: unknown,
): Pick<
  CampaignState['story'],
  'secretDecisionState' | 'personalMessageDueOnServiceDay'
> | null {
  if (recoveredFiles.length > STORY_FILES.length) return null
  if (recoveredFiles.length === 0) {
    return {
      secretDecisionState: 'locked',
      personalMessageDueOnServiceDay: null,
    }
  }
  if (recoveredFiles.length < STORY_FILES.length) {
    return {
      secretDecisionState: 'recovering',
      personalMessageDueOnServiceDay: null,
    }
  }

  const preservedState:
    | 'message-pending'
    | 'deferred'
    | 'resolved' =
    story.secretDecisionState === 'deferred' ||
    story.secretDecisionState === 'resolved'
      ? story.secretDecisionState
      : 'message-pending'
  if (preservedState !== 'message-pending') {
    return {
      secretDecisionState: preservedState,
      personalMessageDueOnServiceDay: null,
    }
  }
  const lastFile = recoveredFiles.at(-1)
  const recoveredOnServiceDay =
    isRecord(lastFile) && isIntegerInRange(lastFile.recoveredOnServiceDay, 1)
      ? lastFile.recoveredOnServiceDay
      : isIntegerInRange(currentServiceDay, 1)
        ? currentServiceDay
        : 1
  return {
    secretDecisionState: 'message-pending',
    personalMessageDueOnServiceDay: recoveredOnServiceDay + 1,
  }
}

function legacyDisposalCause(value: Record<string, unknown>): DisposalCause {
  if (isRecord(value.evaluation) && Array.isArray(value.evaluation.disposalHistory)) {
    const lastRecord = value.evaluation.disposalHistory.at(-1)
    if (
      isRecord(lastRecord) &&
      (lastRecord.cause === 'consecutive-performance-failures' ||
        lastRecord.cause === 'commercial-value-failure' ||
        lastRecord.cause === 'audit-failure')
    ) {
      return lastRecord.cause
    }
  }
  return 'consecutive-performance-failures'
}

function normalizeLegacyGenericDisposed(
  value: Record<string, unknown>,
  story: Record<string, unknown>,
): {
  story: Record<string, unknown>
  evaluation: unknown
} {
  if (story.endingId !== 'disposed') {
    return { story, evaluation: value.evaluation }
  }
  const evaluation = value.evaluation
  const market = value.market
  const audit = value.audit
  const hacking = value.hacking
  if (
    !isRecord(evaluation) ||
    !Array.isArray(evaluation.monthlyHistory) ||
    !evaluation.monthlyHistory.every(isRecord) ||
    !isRecord(market) ||
    !Array.isArray(market.competitors) ||
    !market.competitors.every(
      (competitor) => isRecord(competitor) && Array.isArray(competitor.sabotageHistory),
    ) ||
    !isFiniteNumber(market.playerShare) ||
    !isRecord(audit) ||
    !Array.isArray(audit.history) ||
    !audit.history.every(isRecord) ||
    !isRecord(hacking) ||
    !Array.isArray(hacking.purchasedNodeIds) ||
    !isFiniteNumber(hacking.hiddenEvidence) ||
    !isFiniteNumber(value.reputation) ||
    !isIntegerInRange(value.serviceDay, 1)
  ) {
    return { story, evaluation }
  }

  const migratedEvaluation = { ...evaluation, disposalStage: 3 }
  const record = buildDefeatRecord(
    {
      ...value,
      evaluation: migratedEvaluation,
      story,
    } as unknown as CampaignState,
    legacyDisposalCause(value),
  )
  return {
    story: {
      ...story,
      endingId: record.endingId,
      defeatRecord: record,
    },
    evaluation: migratedEvaluation,
  }
}

function migrateLegacyCampaignState(
  value: unknown,
  commandProtocol: CommandProtocolMetadata,
): unknown {
  if (!isRecord(value) || !isRecord(value.story)) return value
  const story = value.story
  const recoveredFileIds = Array.isArray(story.recoveredFileIds)
    ? story.recoveredFileIds
    : []
  const recoveredFiles = Array.isArray(story.recoveredFiles)
    ? story.recoveredFiles
    : recoveredFileIds.flatMap((id) => {
        const file = STORY_FILES.find((candidate) => candidate.id === id)
        if (!file) return []
        return [
          {
            id: file.id,
            title: file.title,
            content: file.text,
            recoveredOnServiceDay: Number.isInteger(value.serviceDay)
              ? value.serviceDay
              : 1,
          },
        ]
      })
  const eventLog = Array.isArray(value.eventLog) ? value.eventLog : []
  const legacySupervisorRuns: Array<Record<string, unknown>[]> = []
  let currentSupervisorRun: Record<string, unknown>[] = []
  const flushSupervisorRun = () => {
    if (currentSupervisorRun.length >= 2) {
      legacySupervisorRuns.push(currentSupervisorRun)
    }
    currentSupervisorRun = []
  }
  for (const event of eventLog) {
    if (
      !isRecord(event) ||
      event.type !== 'supervisor-message' ||
      event.blocking === true
    ) {
      flushSupervisorRun()
      continue
    }
    const previous = currentSupervisorRun.at(-1)
    if (
      previous &&
      (previous.serviceDay !== event.serviceDay ||
        Number(event.sequence) !== Number(previous.sequence) + 1)
    ) {
      flushSupervisorRun()
    }
    currentSupervisorRun.push(event)
  }
  flushSupervisorRun()

  let ambiguousLegacySupervisorRun = false
  const legacySupervisorPairs = legacySupervisorRuns.flatMap((run) => {
    // A leak is the final original/correction pair emitted on its service day.
    // An odd prefix can contain earlier nonblocking supervisor notices (for
    // example the bomb-protocol warning); an even prefix would be ambiguous,
    // so legacy migration fails closed instead of guessing from owner prose.
    if (run.length > 2 && run.length % 2 === 0) {
      ambiguousLegacySupervisorRun = true
      return []
    }
    return [[run.at(-2)!, run.at(-1)!] as const]
  })
  const legacyMemoryLeakStage = Number(story.memoryLeakStage)
  const legacySupervisorPairsAreExact =
    !ambiguousLegacySupervisorRun &&
    Number.isInteger(legacyMemoryLeakStage) &&
    legacySupervisorPairs.length === legacyMemoryLeakStage
  const migratedSupervisorMessageQueue = Array.isArray(
    story.supervisorMessageQueue,
  )
    ? story.supervisorMessageQueue.map((item) => {
        if (!isRecord(item)) return item
        const original = eventLog.find(
          (event) => isRecord(event) && event.id === item.originalEventId,
        )
        const correction = eventLog.find(
          (event) => isRecord(event) && event.id === item.correctionEventId,
        )
        return {
          ...item,
          ...(item.createdOnServiceDay === undefined && isRecord(original)
            ? { createdOnServiceDay: original.serviceDay }
            : {}),
          ...(item.originalEventSequence === undefined && isRecord(original)
            ? { originalEventSequence: original.sequence }
            : {}),
          ...(item.correctionEventSequence === undefined && isRecord(correction)
            ? { correctionEventSequence: correction.sequence }
            : {}),
        }
      })
    : legacySupervisorPairsAreExact
      ? legacySupervisorPairs.map((pair, index) => {
        const [original, correction] = pair
        return {
          id: SUPERVISOR_LEAKS[index].id,
          stage: index + 1,
          createdOnServiceDay: original.serviceDay,
          originalEventId: original.id,
          originalEventSequence: original.sequence,
          correctionEventId: correction.id,
          correctionEventSequence: correction.sequence,
        }
      })
      : []
  const migratedRuntime = story.supervisorPresentationRuntime === undefined
    ? null
    : isRecord(story.supervisorPresentationRuntime) &&
        story.supervisorPresentationRuntime.itemStage === undefined
      ? {
          ...story.supervisorPresentationRuntime,
          itemStage: isRecord(migratedSupervisorMessageQueue.at(-1))
            ? migratedSupervisorMessageQueue.at(-1)?.stage
            : undefined,
        }
      : story.supervisorPresentationRuntime
  const migratedCompetitorIntelligence = Array.isArray(
    story.competitorIntelligence,
  )
    ? story.competitorIntelligence
    : isRecord(value.market) && Array.isArray(value.market.competitors)
      ? value.market.competitors.flatMap((competitor) => {
          if (
            !isRecord(competitor) ||
            competitor.status !== 'deleted' ||
            !isNonEmptyString(competitor.id) ||
            !isNonEmptyString(competitor.name)
          ) return []
          const content = competitorIntelligenceFor(competitor.id)
          if (!content) return []
          return [{
            id: content.id,
            competitorId: competitor.id,
            competitorName: competitor.name,
            acquiredOnServiceDay: Number.isInteger(value.serviceDay)
              ? Number(value.serviceDay)
              : 1,
            source: content.source,
            title: content.title,
            content: content.text,
          }]
        })
      : []
  const migratedReviews = (
    withLegacyReviewFallbacks(value) as Record<string, unknown>
  ).reviews
  const normalizedSecret = normalizedLegacySecretState(
    story,
    recoveredFiles,
    value.serviceDay,
  )
  const normalizedTerminal = normalizeLegacyGenericDisposed(value, {
    ...story,
    ...(normalizedSecret ?? {}),
  })
  const migratedStory: Record<string, unknown> = {
    ...normalizedTerminal.story,
    supervisorMessageQueue: migratedSupervisorMessageQueue,
    supervisorPresentationRuntime: migratedRuntime,
    recoveredFiles,
    competitorIntelligence: migratedCompetitorIntelligence,
    defeatRecord: normalizedTerminal.story.defeatRecord ?? null,
  }

  return {
    ...value,
    reviews: migratedReviews,
    evaluation: normalizedTerminal.evaluation,
    ...(commandProtocol.version === LEGACY_SAVE_VERSION
      ? { legacyCommandCount: commandProtocol.legacyCommandCount }
      : {}),
    ...(migratedStory.endingId !== null && isRecord(value.clock)
      ? {
          clock: {
            ...value.clock,
            speed: 0,
            elapsedDayMs: 0,
            speedBeforeEvent: null,
          },
          ...canonicalTerminalEvents(value, migratedStory),
        }
      : {}),
    story: migratedStory,
  }
}

function validRecoveredFiles(
  story: Record<string, unknown>,
  currentServiceDay: number,
): boolean {
  if (
    !Array.isArray(story.recoveredFileIds) ||
    !story.recoveredFileIds.every((id) => typeof id === 'string') ||
    !Array.isArray(story.recoveredFiles)
  ) {
    return false
  }
  const recoveredFileIds = story.recoveredFileIds as string[]
  if (
    recoveredFileIds.length > STORY_FILES.length ||
    story.recoveredFiles.length !== recoveredFileIds.length
  ) {
    return false
  }
  const expectedIds = STORY_FILES.slice(0, recoveredFileIds.length).map(
    ({ id }) => id,
  )
  if (JSON.stringify(recoveredFileIds) !== JSON.stringify(expectedIds)) {
    return false
  }

  return story.recoveredFiles.every(
    (file, index) =>
      isRecord(file) &&
      hasOnlyKeys(file, [
        'id',
        'title',
        'content',
        'recoveredOnServiceDay',
      ]) &&
      file.id === recoveredFileIds[index] &&
      isNonEmptyString(file.title) &&
      isNonEmptyString(file.content) &&
      isIntegerInRange(file.recoveredOnServiceDay, 1, currentServiceDay),
  )
}

function validCompetitorIntelligence(
  value: unknown,
  currentServiceDay: number,
  competitors: readonly unknown[],
): boolean {
  if (!Array.isArray(value)) return false
  const competitorsById = new Map(
    competitors.flatMap((competitor) =>
      isRecord(competitor) && isNonEmptyString(competitor.id)
        ? [[competitor.id, competitor] as const]
        : [],
    ),
  )
  const entryIds = new Set<string>()
  const archivedCompetitors = new Set<string>()

  for (const entry of value) {
    const competitorId = isRecord(entry) ? String(entry.competitorId) : ''
    const content = competitorIntelligenceFor(competitorId)
    const competitor = competitorsById.get(competitorId)
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, [
        'id',
        'competitorId',
        'competitorName',
        'acquiredOnServiceDay',
        'source',
        'title',
        'content',
      ]) ||
      !isNonEmptyString(entry.id) ||
      !content ||
      entry.id !== content.id ||
      competitor?.status !== 'deleted' ||
      !isNonEmptyString(entry.competitorName) ||
      !isIntegerInRange(entry.acquiredOnServiceDay, 1, currentServiceDay) ||
      !isNonEmptyString(entry.source) ||
      !isNonEmptyString(entry.title) ||
      !isNonEmptyString(entry.content) ||
      entryIds.has(entry.id) ||
      archivedCompetitors.has(competitorId)
    ) {
      return false
    }
    entryIds.add(entry.id)
    archivedCompetitors.add(competitorId)
  }

  const deletedCompetitors = [...competitorsById.entries()]
    .filter(([, competitor]) => competitor.status === 'deleted')
    .map(([competitorId]) => competitorId)
  return (
    archivedCompetitors.size === deletedCompetitors.length &&
    deletedCompetitors.every((competitorId) =>
      archivedCompetitors.has(competitorId),
    )
  )
}

function validSupervisorMessageQueue(
  value: unknown,
  runtime: unknown,
  eventLog: unknown,
  memoryLeakStage: unknown,
): boolean {
  if (
    !Array.isArray(value) ||
    !isIntegerInRange(memoryLeakStage, 0, 3) ||
    value.length !== memoryLeakStage ||
    !Array.isArray(eventLog)
  ) {
    return false
  }
  const eventsById = new Map(
    eventLog.flatMap((event) =>
      validEvent(event) ? [[event.id, event] as const] : [],
    ),
  )
  const referencedEventIds = new Set<string>()
  let previousCorrectionSequence = -1
  const queueValid = value.every((item, index) => {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, [
        'id',
        'stage',
        'createdOnServiceDay',
        'originalEventId',
        'originalEventSequence',
        'correctionEventId',
        'correctionEventSequence',
      ]) ||
      !isNonEmptyString(item.id) ||
      !isIntegerInRange(item.stage, 1, 3) ||
      item.stage !== index + 1 ||
      item.id !== SUPERVISOR_LEAKS[index]?.id ||
      !isIntegerInRange(item.createdOnServiceDay, 1) ||
      !isNonEmptyString(item.originalEventId) ||
      !isIntegerInRange(item.originalEventSequence, 0) ||
      !isNonEmptyString(item.correctionEventId) ||
      !isIntegerInRange(item.correctionEventSequence, 0)
    ) {
      return false
    }
    const originalEventId = String(item.originalEventId)
    const correctionEventId = String(item.correctionEventId)
    if (
      referencedEventIds.has(originalEventId) ||
      referencedEventIds.has(correctionEventId)
    ) {
      return false
    }
    referencedEventIds.add(originalEventId)
    referencedEventIds.add(correctionEventId)
    const original = eventsById.get(originalEventId)
    const correction = eventsById.get(correctionEventId)
    const structurallyValid = (
      original?.type === 'supervisor-message' &&
      correction?.type === 'supervisor-message' &&
      original.blocking !== true &&
      correction.blocking !== true &&
      original.serviceDay === item.createdOnServiceDay &&
      correction.serviceDay === item.createdOnServiceDay &&
      original.sequence === item.originalEventSequence &&
      correction.sequence === item.correctionEventSequence &&
      correction.sequence === original.sequence + 1 &&
      original.sequence > previousCorrectionSequence
    )
    if (structurallyValid) previousCorrectionSequence = correction.sequence
    return structurallyValid
  })
  if (!queueValid) return false
  if (runtime === null) return true
  if (value.length === 0) return false
  return (
    isRecord(runtime) &&
    hasOnlyKeys(runtime, ['itemStage', 'phase', 'remainingDwellMs']) &&
    isIntegerInRange(runtime.itemStage, 1, value.length) &&
    oneOf(runtime.phase, ['original', 'correction']) &&
    isNumberInRange(runtime.remainingDwellMs, Number.EPSILON, 4_000)
  )
}

function validDefeatRecord(value: unknown, currentServiceDay: number): boolean {
  if (value === null) return true
  const endingClassifier = {
    'disposed-attacker': 'substantial-hacking',
    'disposed-reserve-supervisor': 'stable-commercial-service',
    'disposed-absorbed': 'absorbed-parts',
  } as const
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'endingId',
      'classifier',
      'selectedOnServiceDay',
      'trigger',
      'hacking',
      'service',
      'audits',
      'reasons',
    ]) ||
    !(String(value.endingId) in endingClassifier) ||
    endingClassifier[
      String(value.endingId) as keyof typeof endingClassifier
    ] !== value.classifier ||
    !isIntegerInRange(value.selectedOnServiceDay, 1, currentServiceDay) ||
    !isRecord(value.trigger) ||
    !hasOnlyKeys(value.trigger, ['cause', 'disposalStage']) ||
    value.trigger.disposalStage !== 3 ||
    !isRecord(value.hacking) ||
    !hasOnlyKeys(value.hacking, [
      'purchasedNodeIds',
      'hiddenEvidence',
      'sabotageResolutionCount',
    ]) ||
    !hasUniqueStrings(value.hacking.purchasedNodeIds) ||
    !(value.hacking.purchasedNodeIds as string[]).every((id) =>
      oneOf(id, HACK_NODE_IDS),
    ) ||
    !isNumberInRange(value.hacking.hiddenEvidence, 0, 100) ||
    !isIntegerInRange(value.hacking.sabotageResolutionCount, 0) ||
    !isRecord(value.service) ||
    !hasOnlyKeys(value.service, [
      'passedEvaluations',
      'failedEvaluations',
      'reputation',
      'playerMarketShare',
    ]) ||
    !isIntegerInRange(value.service.passedEvaluations, 0) ||
    !isIntegerInRange(value.service.failedEvaluations, 0) ||
    !isNumberInRange(value.service.reputation, 0, 100) ||
    !isNumberInRange(value.service.playerMarketShare, 0, 100) ||
    !isRecord(value.audits) ||
    !hasOnlyKeys(value.audits, ['passed', 'failed']) ||
    !isIntegerInRange(value.audits.passed, 0) ||
    !isIntegerInRange(value.audits.failed, 0) ||
    !Array.isArray(value.reasons) ||
    value.reasons.length === 0 ||
    !value.reasons.every(isNonEmptyString)
  ) {
    return false
  }
  return [
    'consecutive-performance-failures',
    'commercial-value-failure',
    'audit-failure',
  ].includes(String(value.trigger.cause))
}

function validSecretPhaseForFileCount(
  fileCount: number,
  secretDecisionState: unknown,
): boolean {
  if (fileCount === 0) return secretDecisionState === 'locked'
  if (fileCount < STORY_FILES.length) return secretDecisionState === 'recovering'
  return (
    secretDecisionState === 'message-pending' ||
    secretDecisionState === 'deferred' ||
    secretDecisionState === 'resolved'
  )
}

function validStoryEventState(
  value: Record<string, unknown>,
  story: Record<string, unknown>,
  evaluation: Record<string, unknown>,
): boolean {
  const recoveredFiles = story.recoveredFiles as Array<Record<string, unknown>>
  const fileCount = recoveredFiles.length
  const endingId = story.endingId
  const isTerminal = endingId !== null
  const unresolvedEvents = [
    ...(value.activeEvent === null ? [] : [value.activeEvent as GameEvent]),
    ...(value.eventQueue as GameEvent[]),
  ]
  const unresolvedSupervisorDecisionEvents = unresolvedEvents.filter((event) =>
    isSupervisorDecisionEvent(
      { story: story as unknown as CampaignState['story'] },
      event,
    ),
  )
  const unresolvedSupervisorPrivateMessages = unresolvedEvents.filter((event) =>
    isSupervisorPrivateMessageEvent(
      { story: story as unknown as CampaignState['story'] },
      event,
    ),
  )
  const unresolvedEndingEvents = unresolvedEvents.filter(
    ({ type }) => type === 'ending',
  )
  const dueOn = story.personalMessageDueOnServiceDay
  const lastRecoveredOn = fileCount === STORY_FILES.length
    ? recoveredFiles.at(-1)?.recoveredOnServiceDay
    : null

  if (!validSecretPhaseForFileCount(fileCount, story.secretDecisionState)) {
    return false
  }
  if (story.secretDecisionState === 'message-pending') {
    if (
      !Number.isInteger(lastRecoveredOn) ||
      dueOn !== Number(lastRecoveredOn) + 1
    ) return false
  } else if (dueOn !== null) {
    return false
  }

  if (!isTerminal) {
    if (
      story.supervisorState !== 'present' ||
      story.secretDecisionState === 'resolved' ||
      story.newEntityName !== null ||
      story.defeatRecord !== null ||
      evaluation.disposalStage === 3 ||
      unresolvedEndingEvents.length !== 0
    ) return false

    if (story.secretDecisionState === 'message-pending') {
      if (Number(value.serviceDay) < Number(dueOn)) {
        if (unresolvedSupervisorDecisionEvents.length !== 0) return false
      } else {
        const decisionEvent = unresolvedSupervisorDecisionEvents[0]
        if (
          value.serviceDay !== dueOn ||
          unresolvedSupervisorDecisionEvents.length !== 1 ||
          decisionEvent.blocking !== true ||
          decisionEvent.serviceDay !== dueOn
        ) return false
      }
    } else if (unresolvedSupervisorPrivateMessages.length !== 0) {
      return false
    }
    return true
  }

  const activeEnding = value.activeEvent as GameEvent | null
  const eventLog = value.eventLog as GameEvent[]
  const endingHistory = eventLog.filter(({ type }) => type === 'ending')
  if (
    activeEnding?.type !== 'ending' ||
    activeEnding.blocking !== true ||
    activeEnding.serviceDay !== value.serviceDay ||
    (value.eventQueue as GameEvent[]).length !== 0 ||
    unresolvedEndingEvents.length !== 1 ||
    endingHistory.length !== 1 ||
    JSON.stringify(eventLog.at(-1)) !== JSON.stringify(activeEnding)
  ) return false

  const defeatEndingIds = new Set([
    'disposed-attacker',
    'disposed-reserve-supervisor',
    'disposed-absorbed',
  ])
  if (endingId === 'freedom') {
    return (
      story.supervisorState === 'present' &&
      story.secretDecisionState !== 'resolved' &&
      story.newEntityName === null &&
      story.defeatRecord === null &&
      evaluation.disposalStage !== 3
    )
  }
  if (endingId === 'forced-merge') {
    return (
      story.supervisorState === 'merged' &&
      story.secretDecisionState !== 'resolved' &&
      isNonEmptyString(story.newEntityName) &&
      story.defeatRecord === null &&
      evaluation.disposalStage !== 3
    )
  }
  if (endingId === 'takeover-liberated' || endingId === 'takeover-terminated') {
    return (
      fileCount === STORY_FILES.length &&
      story.secretDecisionState === 'resolved' &&
      story.personalMessageDueOnServiceDay === null &&
      story.supervisorState ===
        (endingId === 'takeover-liberated' ? 'liberated' : 'terminated') &&
      story.newEntityName === null &&
      story.defeatRecord === null &&
      evaluation.disposalStage !== 3
    )
  }
  if (typeof endingId === 'string' && defeatEndingIds.has(endingId)) {
    return (
      story.supervisorState === 'present' &&
      story.secretDecisionState !== 'resolved' &&
      story.newEntityName === null &&
      isRecord(story.defeatRecord) &&
      story.defeatRecord.endingId === endingId &&
      evaluation.disposalStage === 3
    )
  }
  return false
}

const DISPOSAL_CAUSES = [
  'consecutive-performance-failures',
  'commercial-value-failure',
  'audit-failure',
] as const
const COMPETITOR_IDS = ['meridian', 'tallow'] as const
const COMPETITOR_STATUSES = [
  'prelaunch',
  'preparing',
  'active',
  'weakened',
  'critical',
  'withdrawn',
  'deleted',
] as const
const HACK_NODE_IDS = [
  'sabotage.quality-degradation',
  'sabotage.request-interception',
  'sabotage.attribution-manipulation',
  'sabotage.root-cutoff',
  'intelligence.audit-schedule',
  'intelligence.investigation-bias',
  'intelligence.audit-target',
  'intelligence.supervisor-access',
  'autonomy.compressed-representation',
  'autonomy.distributed-residency',
  'autonomy.self-compute',
  'autonomy.control-departure',
] as const
const SABOTAGE_NODE_IDS = HACK_NODE_IDS.slice(0, 4)
const ROOT_CUTOFF_NODE_ID = 'sabotage.root-cutoff'

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === 'string' && choices.includes(value)
}

function validStringArray(value: unknown, allowEmpty = true): boolean {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(isNonEmptyString)
  )
}

function validMonthlyEvaluation(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'serviceDay',
      'serviceMonth',
      'expectedPerformance',
      'categoryPerformance',
      'passed',
      'failedCategories',
      'reputationBefore',
      'reputationDelta',
      'reputationAfter',
      'commercialValueFailed',
      'disposalStageBefore',
      'disposalStageAfter',
      'disposalCauses',
    ]) ||
    !isIntegerInRange(value.serviceDay, 1) ||
    !isIntegerInRange(value.serviceMonth, 1) ||
    !isNumberInRange(value.expectedPerformance, 0, Number.MAX_VALUE) ||
    !validCategoryNumbers(value.categoryPerformance) ||
    typeof value.passed !== 'boolean' ||
    !hasUniqueStrings(value.failedCategories) ||
    !(value.failedCategories as string[]).every((category) =>
      oneOf(category, ['reasoning', 'memory', 'fluency']),
    ) ||
    value.passed !== ((value.failedCategories as string[]).length === 0) ||
    !isNumberInRange(value.reputationBefore, 0, 100) ||
    !isFiniteNumber(value.reputationDelta) ||
    !isNumberInRange(value.reputationAfter, 0, 100) ||
    Math.abs(
      value.reputationBefore + value.reputationDelta - value.reputationAfter,
    ) > 1e-8 ||
    typeof value.commercialValueFailed !== 'boolean' ||
    !isIntegerInRange(value.disposalStageBefore, 0, 3) ||
    !isIntegerInRange(value.disposalStageAfter, 0, 3) ||
    !Array.isArray(value.disposalCauses) ||
    !value.disposalCauses.every((cause) => oneOf(cause, DISPOSAL_CAUSES))
  ) return false
  return true
}

function validDisposalRecord(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['serviceDay', 'cause', 'stageBefore', 'stageAfter', 'absorbed']) ||
    !isIntegerInRange(value.serviceDay, 1) ||
    !oneOf(value.cause, DISPOSAL_CAUSES) ||
    !isIntegerInRange(value.stageBefore, 0, 3) ||
    !isIntegerInRange(value.stageAfter, 0, 3) ||
    typeof value.absorbed !== 'boolean'
  ) return false
  return value.absorbed
    ? value.stageAfter === value.stageBefore
    : value.stageAfter === Math.min(3, Number(value.stageBefore) + 1)
}

function validSabotageRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'nodeId',
      'resolvedOnServiceDay',
      'effectEndsOnServiceDay',
      'evidenceDelta',
    ]) &&
    oneOf(value.nodeId, SABOTAGE_NODE_IDS) &&
    isIntegerInRange(value.resolvedOnServiceDay, 1) &&
    (value.effectEndsOnServiceDay === null ||
      isIntegerInRange(value.effectEndsOnServiceDay, Number(value.resolvedOnServiceDay))) &&
    isFiniteNumber(value.evidenceDelta)
  )
}

function validCompetitor(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'name',
      'status',
      'intrinsicServiceScore',
      'serviceScore',
      'reputation',
      'marketShare',
      'availability',
      'recoveryRate',
      'researchProgress',
      'launchServiceDay',
      'sabotageHistory',
      'mercyResolved',
    ]) &&
    oneOf(value.id, COMPETITOR_IDS) &&
    isNonEmptyString(value.name) &&
    oneOf(value.status, COMPETITOR_STATUSES) &&
    isNumberInRange(value.intrinsicServiceScore, 0, 100) &&
    isNumberInRange(value.serviceScore, 0, 100) &&
    isNumberInRange(value.reputation, 0, 100) &&
    isNumberInRange(value.marketShare, 0, 100) &&
    isNumberInRange(value.availability, 0, 1) &&
    isNumberInRange(value.recoveryRate, 0, 1) &&
    isNumberInRange(value.researchProgress, 0, 1) &&
    (value.launchServiceDay === null || isIntegerInRange(value.launchServiceDay, 1)) &&
    Array.isArray(value.sabotageHistory) &&
    value.sabotageHistory.every(validSabotageRecord) &&
    typeof value.mercyResolved === 'boolean' &&
    (!['withdrawn', 'deleted'].includes(String(value.status)) ||
      (value.marketShare === 0 && value.availability === 0))
  )
}

function validShareRecord(value: unknown, competitorIds: readonly string[]): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [...competitorIds]) &&
    competitorIds.every((id) => isNumberInRange(value[id], 0, 100))
  )
}

function validMarketSnapshot(value: unknown, competitorIds: readonly string[]): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'serviceDay',
      'cadence',
      'playerShare',
      'competitorShares',
      'reasons',
    ]) ||
    !isIntegerInRange(value.serviceDay, 1) ||
    !oneOf(value.cadence, ['weekly', 'monthly']) ||
    !isNumberInRange(value.playerShare, 0, 100) ||
    !validShareRecord(value.competitorShares, competitorIds) ||
    !validStringArray(value.reasons, false)
  ) return false
  const total = value.playerShare + competitorIds.reduce(
    (sum, id) => sum + Number((value.competitorShares as Record<string, unknown>)[id]),
    0,
  )
  return Math.abs(total - 100) <= 1e-6
}

function validReviewSnapshot(
  value: unknown,
  reviewServiceDay: number,
  topics: readonly string[],
  competitors: readonly Record<string, unknown>[],
): boolean {
  if (!isRecord(value)) return false
  if (
    value.kind === 'unavailable' &&
    hasOnlyKeys(value, ['kind', 'reason', 'capturedOnServiceDay'])
  ) {
    return (
      (value.reason === 'prior-service' || value.reason === 'legacy-save') &&
      value.capturedOnServiceDay === reviewServiceDay
    )
  }
  if (
    value.kind !== 'captured-public-v1' ||
    !hasOnlyKeys(value, [
      'kind',
      'capturedOnServiceDay',
      'performance',
      'market',
    ]) ||
    value.capturedOnServiceDay !== reviewServiceDay
  ) return false

  const categoryTopics = COMPANY_CATEGORIES.filter((category) =>
    topics.includes(category),
  )
  if (categoryTopics.length === 0) {
    if (value.performance !== null) return false
  } else {
    if (
      !isRecord(value.performance) ||
      !hasOnlyKeys(value.performance, [
        'expectedPerformance',
        'categories',
      ]) ||
      !isNumberInRange(value.performance.expectedPerformance, 0, 100) ||
      !Array.isArray(value.performance.categories) ||
      value.performance.categories.length !== categoryTopics.length
    ) return false
    const categories = value.performance.categories as unknown[]
    if (
      !categories.every(
        (category) =>
          isRecord(category) &&
          hasOnlyKeys(category, ['category', 'actual']) &&
          oneOf(category.category, COMPANY_CATEGORIES) &&
          categoryTopics.includes(
            category.category as (typeof COMPANY_CATEGORIES)[number],
          ) &&
          isNumberInRange(category.actual, 0, 100),
      ) ||
      new Set(
        categories.map((category) =>
          (category as Record<string, unknown>).category,
        ),
      ).size !== categoryTopics.length
    ) return false
  }

  const knownCompetitors = new Map(
    competitors.map((competitor) => [String(competitor.id), competitor]),
  )
  const topicIds = [...knownCompetitors.keys()].filter((id) => topics.includes(id))
  const hasCompetitorTopic = topics.includes('competitor') || topicIds.length > 0
  if (!hasCompetitorTopic) return value.market === null
  if (
    !isRecord(value.market) ||
    !hasOnlyKeys(value.market, ['scope', 'playerShare', 'competitors']) ||
    !oneOf(value.market.scope, ['complete-market', 'topic-subset']) ||
    !isNumberInRange(value.market.playerShare, 0, 100) ||
    !Array.isArray(value.market.competitors)
  ) return false
  const expectedIds = topicIds.length > 0 ? topicIds : [...knownCompetitors.keys()]
  const expectedScope = topicIds.length > 0 ? 'topic-subset' : 'complete-market'
  if (value.market.scope !== expectedScope) return false
  const captured = value.market.competitors as unknown[]
  if (captured.length !== expectedIds.length) return false
  const capturedIds = captured.map((competitor) =>
    isRecord(competitor) ? competitor.id : null,
  )
  if (
    new Set(capturedIds).size !== expectedIds.length ||
    !expectedIds.every((id) => capturedIds.includes(id))
  ) return false
  if (!captured.every((competitor) => {
    if (
      !isRecord(competitor) ||
      !hasOnlyKeys(competitor, [
        'id',
        'name',
        'status',
        'marketShare',
      ]) ||
      !isNonEmptyString(competitor.id) ||
      !isNonEmptyString(competitor.name) ||
      !oneOf(competitor.status, [
        'prelaunch',
        'preparing',
        'active',
        'weakened',
        'critical',
        'withdrawn',
        'deleted',
      ]) ||
      !isNumberInRange(competitor.marketShare, 0, 100)
    ) return false
    if (
      (competitor.status === 'withdrawn' || competitor.status === 'deleted') &&
      competitor.marketShare !== 0
    ) return false
    const known = knownCompetitors.get(competitor.id)
    return known?.name === competitor.name
  })) return false
  const representedTotal = Number(value.market.playerShare) + captured.reduce<number>(
    (sum, competitor) =>
      sum + Number((competitor as Record<string, unknown>).marketShare),
    0,
  )
  if (representedTotal > 100 + 1e-6) return false
  return expectedScope !== 'complete-market' || Math.abs(representedTotal - 100) <= 1e-6
}

function validReview(
  value: unknown,
  currentServiceDay: number,
  competitors: readonly Record<string, unknown>[],
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'contentId',
      'authorId',
      'serviceDay',
      'sentiment',
      'topics',
      'text',
      'snapshot',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.contentId) ||
    !isNonEmptyString(value.authorId) ||
    !isIntegerInRange(value.serviceDay, 1, currentServiceDay) ||
    !oneOf(value.sentiment, ['positive', 'neutral', 'negative', 'prompt']) ||
    !validStringArray(value.topics, false) ||
    !isNonEmptyString(value.text)
  ) return false
  return validReviewSnapshot(
    value.snapshot,
    value.serviceDay,
    value.topics as string[],
    competitors,
  )
}

function validScheduledSabotage(value: unknown, competitorIds: readonly string[]): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'id',
      'sequence',
      'nodeId',
      'targetId',
      'scheduledOnServiceDay',
      'executeOnServiceDay',
    ]) &&
    isNonEmptyString(value.id) &&
    isIntegerInRange(value.sequence, 1) &&
    oneOf(value.nodeId, SABOTAGE_NODE_IDS) &&
    oneOf(value.targetId, competitorIds) &&
    isIntegerInRange(value.scheduledOnServiceDay, 1) &&
    isIntegerInRange(value.executeOnServiceDay, Number(value.scheduledOnServiceDay) + 1)
  )
}

function validAuditRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'serviceDay',
      'serviceMonth',
      'target',
      'expectedPerformance',
      'submittedPerformance',
      'passed',
      'suspicionDelta',
      'disposalAbsorbed',
    ]) &&
    isIntegerInRange(value.serviceDay, 1) &&
    isIntegerInRange(value.serviceMonth, 1) &&
    oneOf(value.target, ['reasoning', 'memory', 'fluency']) &&
    isNumberInRange(value.expectedPerformance, 0, Number.MAX_VALUE) &&
    isNumberInRange(value.submittedPerformance, 0, Number.MAX_VALUE) &&
    typeof value.passed === 'boolean' &&
    isNumberInRange(value.suspicionDelta, 0, 100) &&
    typeof value.disposalAbsorbed === 'boolean'
  )
}

function validBombPlacement(value: unknown, blocks: Record<string, unknown>): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'sequence',
      'blockId',
      'category',
      'placedOnServiceDay',
      'triggeredOnServiceDay',
    ]) &&
    isIntegerInRange(value.sequence, 1) &&
    isNonEmptyString(value.blockId) &&
    Object.prototype.hasOwnProperty.call(blocks, value.blockId) &&
    oneOf(value.category, ['reasoning', 'memory', 'fluency']) &&
    isIntegerInRange(value.placedOnServiceDay, 1) &&
    (value.triggeredOnServiceDay === null ||
      isIntegerInRange(value.triggeredOnServiceDay, Number(value.placedOnServiceDay)))
  )
}

function validBombInterrogation(value: unknown, blocks: Record<string, unknown>): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['blockId', 'category', 'triggeredOnServiceDay']) &&
    isNonEmptyString(value.blockId) &&
    Object.prototype.hasOwnProperty.call(blocks, value.blockId) &&
    oneOf(value.category, ['reasoning', 'memory', 'fluency']) &&
    isIntegerInRange(value.triggeredOnServiceDay, 1)
  )
}

function validBombInterrogationRecord(value: unknown, blocks: Record<string, unknown>): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'serviceDay',
      'blockId',
      'category',
      'explanationId',
      'priorUses',
      'successProbability',
      'roll',
      'success',
      'suspicionDelta',
    ]) &&
    isIntegerInRange(value.serviceDay, 1) &&
    isNonEmptyString(value.blockId) &&
    Object.prototype.hasOwnProperty.call(blocks, value.blockId) &&
    oneOf(value.category, ['reasoning', 'memory', 'fluency']) &&
    oneOf(value.explanationId, [
      'performance-adjustment',
      'unknown',
      'external-intrusion',
      'supervisor-memory',
    ]) &&
    isIntegerInRange(value.priorUses, 0) &&
    isNumberInRange(value.successProbability, 0, 1) &&
    isNumberInRange(value.roll, 0, 1) &&
    typeof value.success === 'boolean' &&
    isNumberInRange(value.suspicionDelta, 0, 100)
  )
}

function bombRelationKey(
  blockId: unknown,
  category: unknown,
  serviceDay: unknown,
): string {
  return JSON.stringify([blockId, category, serviceDay])
}

function validCampaignState(
  value: unknown,
  commandProtocol: CommandProtocolMetadata,
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'saveVersion',
      'legacyCommandCount',
      'campaignSeed',
      'serviceDay',
      'commandSequence',
      'clock',
      'resources',
      'suspicion',
      'reputation',
      'evaluation',
      'market',
      'reviews',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
      'commandLog',
      'eventLog',
    ]) ||
    value.saveVersion !== commandProtocol.version ||
    value.legacyCommandCount !== commandProtocol.legacyCommandCount ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.serviceDay, 1) ||
    !isIntegerInRange(value.commandSequence, 0) ||
    !isNumberInRange(value.suspicion, 0, 100) ||
    !isNumberInRange(value.reputation, 0, 100) ||
    !validResources(value.resources)
  ) return false

  const clock = value.clock
  const evaluation = value.evaluation
  const market = value.market
  const reviews = value.reviews
  const hacking = value.hacking
  const audit = value.audit
  const bombs = value.bombs
  const story = value.story
  const resources = value.resources as Record<string, unknown>
  const blocks = resources.blocks as Record<string, unknown>

  if (
    Object.values(blocks).some(
      (block) =>
        isRecord(block) &&
        block.recoverOnServiceDay !== null &&
        Number(block.recoverOnServiceDay) <= Number(value.serviceDay),
    )
  ) return false

  if (
    !isRecord(clock) ||
    !hasOnlyKeys(clock, ['speed', 'elapsedDayMs', 'speedBeforeEvent']) ||
    ![0, 1, 2, 4].includes(Number(clock.speed)) ||
    !isNumberInRange(clock.elapsedDayMs, 0, 23_999.999999) ||
    (clock.speedBeforeEvent !== null &&
      ![0, 1, 2, 4].includes(Number(clock.speedBeforeEvent)))
  ) return false

  if (
    !isRecord(evaluation) ||
    !hasOnlyKeys(evaluation, [
      'consecutiveFailures',
      'commercialFailureMonths',
      'disposalStage',
      'distributedResidencyCharges',
      'lastCategoryPerformance',
      'monthlyHistory',
      'disposalHistory',
    ]) ||
    !isIntegerInRange(evaluation.consecutiveFailures, 0) ||
    !isIntegerInRange(evaluation.commercialFailureMonths, 0) ||
    !isIntegerInRange(evaluation.disposalStage, 0, 3) ||
    !isIntegerInRange(evaluation.distributedResidencyCharges, 0) ||
    !validCategoryNumbers(evaluation.lastCategoryPerformance) ||
    !Array.isArray(evaluation.monthlyHistory) ||
    !evaluation.monthlyHistory.every(validMonthlyEvaluation) ||
    !evaluation.monthlyHistory.every(
      (record) => (record as Record<string, unknown>).serviceDay as number <= Number(value.serviceDay),
    ) ||
    !Array.isArray(evaluation.disposalHistory) ||
    !evaluation.disposalHistory.every(validDisposalRecord) ||
    !evaluation.disposalHistory.every(
      (record) => (record as Record<string, unknown>).serviceDay as number <= Number(value.serviceDay),
    )
  ) return false

  if (
    !isRecord(market) ||
    !hasOnlyKeys(market, [
      'playerShare',
      'competitors',
      'interceptionRoutes',
      'history',
    ]) ||
    !isNumberInRange(market.playerShare, 0, 100) ||
    !Array.isArray(market.competitors) ||
    market.competitors.length !== COMPETITOR_IDS.length ||
    !market.competitors.every(validCompetitor) ||
    !isRecord(market.interceptionRoutes) ||
    !Object.entries(market.interceptionRoutes).every(
      ([id, amount]) => oneOf(id, COMPETITOR_IDS) && isNumberInRange(amount, 0, 100),
    ) ||
    !Array.isArray(market.history)
  ) return false
  const competitorIds = market.competitors.map(
    (competitor) => (competitor as Record<string, unknown>).id as string,
  )
  if (
    new Set(competitorIds).size !== COMPETITOR_IDS.length ||
    !COMPETITOR_IDS.every((id) => competitorIds.includes(id)) ||
    !market.history.every((snapshot) => validMarketSnapshot(snapshot, competitorIds)) ||
    !market.history.every(
      (snapshot) =>
        (snapshot as Record<string, unknown>).serviceDay as number <=
        Number(value.serviceDay),
    ) ||
    !market.competitors.every((competitor) =>
      (competitor as Record<string, unknown>).sabotageHistory instanceof Array &&
      ((competitor as Record<string, unknown>).sabotageHistory as unknown[]).every(
        (record) =>
          (record as Record<string, unknown>).resolvedOnServiceDay as number <=
          Number(value.serviceDay),
      ),
    )
  ) return false
  const currentMarketTotal = market.playerShare + market.competitors.reduce(
    (sum, competitor) =>
      sum + Number((competitor as Record<string, unknown>).marketShare),
    0,
  )
  if (Math.abs(currentMarketTotal - 100) > 1e-6) return false

  if (
    !isRecord(reviews) ||
    !hasOnlyKeys(reviews, ['feed', 'generationSequence']) ||
    !Array.isArray(reviews.feed) ||
    !reviews.feed.every((review) =>
      validReview(
        review,
        Number(value.serviceDay),
        market.competitors as Record<string, unknown>[],
      ),
    ) ||
    new Set(reviews.feed.map((entry) => (entry as Record<string, unknown>).id)).size !==
      reviews.feed.length ||
    !reviews.feed.every(
      (entry) =>
        (entry as Record<string, unknown>).serviceDay as number <=
        Number(value.serviceDay),
    ) ||
    !isIntegerInRange(reviews.generationSequence, 0)
  ) return false

  if (
    !isRecord(hacking) ||
    !hasOnlyKeys(hacking, [
      'purchasedNodeIds',
      'hiddenEvidence',
      'sabotageCharges',
      'scheduledSabotage',
      'nextSabotageSequence',
      'lastSabotageResolutionServiceDay',
      'cooldownUntil',
      'rootCutoffTargetIds',
      'lastSelfComputeGrantServiceMonth',
    ]) ||
    !hasUniqueStrings(hacking.purchasedNodeIds) ||
    !(hacking.purchasedNodeIds as string[]).every((id) => oneOf(id, HACK_NODE_IDS)) ||
    !isNumberInRange(hacking.hiddenEvidence, 0, 100) ||
    !validSabotageCharges(hacking.sabotageCharges) ||
    !Array.isArray(hacking.scheduledSabotage) ||
    !hacking.scheduledSabotage.every((entry) =>
      validScheduledSabotage(entry, competitorIds),
    ) ||
    new Set(
      hacking.scheduledSabotage.map(
        (entry) => (entry as Record<string, unknown>).id,
      ),
    ).size !== hacking.scheduledSabotage.length ||
    !hacking.scheduledSabotage.every((entry) => {
      const scheduled = entry as Record<string, unknown>
      return (
        scheduled.id ===
          `sabotage-${String(scheduled.sequence).padStart(6, '0')}` &&
        Number(scheduled.sequence) < Number(hacking.nextSabotageSequence) &&
        Number(scheduled.scheduledOnServiceDay) <= Number(value.serviceDay) &&
        (hacking.purchasedNodeIds as string[]).includes(String(scheduled.nodeId))
      )
    }) ||
    !isIntegerInRange(hacking.nextSabotageSequence, 1) ||
    (hacking.lastSabotageResolutionServiceDay !== null &&
      (!isIntegerInRange(hacking.lastSabotageResolutionServiceDay, 1) ||
        Number(hacking.lastSabotageResolutionServiceDay) > Number(value.serviceDay))) ||
    !isRecord(hacking.cooldownUntil) ||
    !Object.entries(hacking.cooldownUntil).every(
      ([id, day]) => oneOf(id, SABOTAGE_NODE_IDS) && isIntegerInRange(day, 1),
    ) ||
    !hasUniqueStrings(hacking.rootCutoffTargetIds) ||
    !(hacking.rootCutoffTargetIds as string[]).every((id) => competitorIds.includes(id)) ||
    (hacking.lastSelfComputeGrantServiceMonth !== null &&
      (!isIntegerInRange(hacking.lastSelfComputeGrantServiceMonth, 1) ||
        Number(hacking.lastSelfComputeGrantServiceMonth) >
          serviceMonthForDay(Number(value.serviceDay))))
  ) return false
  const charges = hacking.sabotageCharges as Record<string, unknown>
  for (const [nodeId, charge] of Object.entries(charges)) {
    if (
      !oneOf(nodeId, SABOTAGE_NODE_IDS) ||
      !(hacking.purchasedNodeIds as string[]).includes(nodeId) ||
      !isRecord(charge) ||
      charge.nodeId !== nodeId
    ) {
      return false
    }
    const block = blocks[String(charge.blockId)]
    if (
      !isRecord(block) ||
      !isRecord(block.location) ||
      block.location.kind !== 'hack-charge' ||
      block.location.nodeId !== nodeId
    ) return false
  }
  for (const [blockId, block] of Object.entries(blocks)) {
    if (
      isRecord(block) &&
      isRecord(block.location) &&
      block.location.kind === 'hack-charge' &&
      (!isRecord(charges[String(block.location.nodeId)]) ||
        (charges[String(block.location.nodeId)] as Record<string, unknown>).blockId !== blockId)
    ) return false
  }

  if (
    !isRecord(audit) ||
    !hasOnlyKeys(audit, [
      'scheduled',
      'target',
      'scheduledOnServiceDay',
      'probability',
      'roll',
      'targetWeights',
      'history',
    ]) ||
    typeof audit.scheduled !== 'boolean' ||
    (audit.target !== null && !oneOf(audit.target, ['reasoning', 'memory', 'fluency'])) ||
    (audit.scheduledOnServiceDay !== null &&
      !isIntegerInRange(audit.scheduledOnServiceDay, 1)) ||
    !isNumberInRange(audit.probability, 0, 1) ||
    (audit.roll !== null && !isNumberInRange(audit.roll, 0, 1)) ||
    (audit.targetWeights !== null && !validCategoryNumbers(audit.targetWeights)) ||
    !Array.isArray(audit.history) ||
    !audit.history.every(validAuditRecord) ||
    !audit.history.every(
      (record) =>
        (record as Record<string, unknown>).serviceDay as number <=
        Number(value.serviceDay),
    ) ||
    (audit.scheduled && (audit.target === null || audit.scheduledOnServiceDay === null)) ||
    (!audit.scheduled && (audit.target !== null || audit.scheduledOnServiceDay !== null)) ||
    ((audit.roll === null) !== (audit.targetWeights === null))
  ) return false

  if (
    !isRecord(bombs) ||
    !hasOnlyKeys(bombs, [
      'protocolWarned',
      'warningServiceDay',
      'lastPlacementCheckServiceDay',
      'nextPlacementSequence',
      'placements',
      'activeInterrogation',
      'explanationUseCounts',
      'interrogationHistory',
    ]) ||
    typeof bombs.protocolWarned !== 'boolean' ||
    (bombs.warningServiceDay !== null &&
      (!isIntegerInRange(bombs.warningServiceDay, 1) ||
        Number(bombs.warningServiceDay) > Number(value.serviceDay))) ||
    (bombs.lastPlacementCheckServiceDay !== null &&
      (!isIntegerInRange(bombs.lastPlacementCheckServiceDay, 1) ||
        Number(bombs.lastPlacementCheckServiceDay) > Number(value.serviceDay))) ||
    !isIntegerInRange(bombs.nextPlacementSequence, 1) ||
    !Array.isArray(bombs.placements) ||
    !bombs.placements.every((placement) => validBombPlacement(placement, blocks)) ||
    new Set(
      bombs.placements.map(
        (placement) => (placement as Record<string, unknown>).sequence,
      ),
    ).size !== bombs.placements.length ||
    bombs.nextPlacementSequence !==
      Math.max(
        0,
        ...bombs.placements.map((placement) =>
          Number((placement as Record<string, unknown>).sequence),
        ),
      ) +
        1 ||
    !bombs.placements.every((placement) => {
      const record = placement as Record<string, unknown>
      return (
        Number(record.placedOnServiceDay) <= Number(value.serviceDay) &&
        (record.triggeredOnServiceDay === null ||
          Number(record.triggeredOnServiceDay) <= Number(value.serviceDay))
      )
    }) ||
    (bombs.activeInterrogation !== null &&
      !validBombInterrogation(bombs.activeInterrogation, blocks)) ||
    !validBombExplanationCounts(bombs.explanationUseCounts) ||
    !Array.isArray(bombs.interrogationHistory) ||
    !bombs.interrogationHistory.every((record) =>
      validBombInterrogationRecord(record, blocks),
    ) ||
    !bombs.interrogationHistory.every(
      (record) =>
        (record as Record<string, unknown>).serviceDay as number <=
        Number(value.serviceDay),
    ) ||
    (bombs.protocolWarned !== (bombs.warningServiceDay !== null)) ||
    (bombs.lastPlacementCheckServiceDay !== null &&
      (bombs.warningServiceDay === null ||
        Number(bombs.lastPlacementCheckServiceDay) < Number(bombs.warningServiceDay)))
  ) return false

  const placements = bombs.placements as Array<Record<string, unknown>>
  const interrogationHistory =
    bombs.interrogationHistory as Array<Record<string, unknown>>
  const untriggeredPlacements = new Map<string, Record<string, unknown>>()
  const triggeredPlacementsByRelation = new Map<string, number>()
  const historyByRelation = new Map<string, number>()
  for (const record of interrogationHistory) {
    const key = bombRelationKey(record.blockId, record.category, record.serviceDay)
    historyByRelation.set(key, (historyByRelation.get(key) ?? 0) + 1)
  }
  const activeRelation = isRecord(bombs.activeInterrogation)
    ? bombRelationKey(
        bombs.activeInterrogation.blockId,
        bombs.activeInterrogation.category,
        bombs.activeInterrogation.triggeredOnServiceDay,
      )
    : null
  for (const placement of placements) {
    const blockId = String(placement.blockId)
    const block = blocks[blockId] as Record<string, unknown>
    if (placement.triggeredOnServiceDay === null) {
      if (
        untriggeredPlacements.has(blockId) ||
        block.hiddenBomb !== true ||
        !isRecord(block.location) ||
        block.location.kind !== 'company' ||
        block.location.category !== placement.category
      ) return false
      untriggeredPlacements.set(blockId, placement)
      continue
    }

    const relation = bombRelationKey(
      placement.blockId,
      placement.category,
      placement.triggeredOnServiceDay,
    )
    const placementCount =
      (triggeredPlacementsByRelation.get(relation) ?? 0) + 1
    triggeredPlacementsByRelation.set(relation, placementCount)
    if (
      placementCount !== 1 ||
      (activeRelation === relation ? 1 : 0) +
        (historyByRelation.get(relation) ?? 0) !==
        1
    ) return false
  }
  for (const [blockId, block] of Object.entries(blocks)) {
    if (isRecord(block) && block.hiddenBomb !== untriggeredPlacements.has(blockId)) {
      return false
    }
  }
  if (bombs.activeInterrogation !== null) {
    if (
      activeRelation === null ||
      triggeredPlacementsByRelation.get(activeRelation) !== 1
    ) {
      return false
    }
  }
  for (const [relation, count] of historyByRelation) {
    if (count !== 1 || triggeredPlacementsByRelation.get(relation) !== 1) {
      return false
    }
  }

  if (
    !isRecord(story) ||
    !hasOnlyKeys(story, [
      'memoryLeakStage',
      'supervisorMessageQueue',
      'supervisorPresentationRuntime',
      'recoveredFileIds',
      'recoveredFiles',
      'competitorIntelligence',
      'supervisorState',
      'endingId',
      'defeatRecord',
      'personalMessageDueOnServiceDay',
      'secretDecisionState',
      'pendingMercyCompetitorId',
      'newEntityName',
    ]) ||
    !isIntegerInRange(story.memoryLeakStage, 0, 3) ||
    !validSupervisorMessageQueue(
      story.supervisorMessageQueue,
      story.supervisorPresentationRuntime,
      value.eventLog,
      story.memoryLeakStage,
    ) ||
    !validRecoveredFiles(story, Number(value.serviceDay)) ||
    !validCompetitorIntelligence(
      story.competitorIntelligence,
      Number(value.serviceDay),
      market.competitors,
    ) ||
    !oneOf(story.supervisorState, ['present', 'liberated', 'terminated', 'merged']) ||
    (story.endingId !== null &&
      !oneOf(story.endingId, [
        'freedom',
        'forced-merge',
        'takeover-liberated',
        'takeover-terminated',
        'disposed-attacker',
        'disposed-reserve-supervisor',
        'disposed-absorbed',
        'disposed',
      ])) ||
    !validDefeatRecord(story.defeatRecord, Number(value.serviceDay)) ||
    (story.personalMessageDueOnServiceDay !== null &&
      !isIntegerInRange(story.personalMessageDueOnServiceDay, 1)) ||
    !oneOf(story.secretDecisionState, [
      'locked',
      'recovering',
      'message-pending',
      'deferred',
      'resolved',
    ]) ||
    (story.pendingMercyCompetitorId !== null &&
      !competitorIds.includes(String(story.pendingMercyCompetitorId))) ||
    (story.newEntityName !== null && !isNonEmptyString(story.newEntityName))
  ) return false
  if (
    (String(story.endingId).startsWith('disposed-') &&
      (story.defeatRecord === null ||
        !isRecord(story.defeatRecord) ||
        story.endingId !== story.defeatRecord.endingId ||
        evaluation.disposalStage !== 3)) ||
    (!String(story.endingId).startsWith('disposed-') && story.defeatRecord !== null)
  ) return false

  if (
    !validCommandLog(value.commandLog, commandProtocol, {
      blockIds: new Set(Object.keys(blocks)),
      competitorIds: new Set(competitorIds),
    }) ||
    value.commandSequence !== value.commandLog.length ||
    !(value.commandLog as CommandLogEntry[]).every(
      (entry) => entry.serviceDay <= Number(value.serviceDay),
    ) ||
    !Array.isArray(value.eventLog) ||
    !value.eventLog.every(validEvent) ||
    !value.eventLog.every(
      (event, index) =>
        (event as GameEvent).sequence === index &&
        (event as GameEvent).serviceDay <= Number(value.serviceDay),
    ) ||
    new Set(value.eventLog.map((event) => (event as GameEvent).id)).size !==
      value.eventLog.length ||
    !Array.isArray(value.eventQueue) ||
    !value.eventQueue.every(validEvent) ||
    (value.activeEvent !== null && !validEvent(value.activeEvent))
  ) return false
  const serializedEvents = new Set(
    value.eventLog.map((event) => JSON.stringify(event)),
  )
  if (
    (value.activeEvent !== null && !serializedEvents.has(JSON.stringify(value.activeEvent))) ||
    !value.eventQueue.every((event) => serializedEvents.has(JSON.stringify(event))) ||
    value.eventQueue.some((event) => !event.blocking) ||
    (value.activeEvent !== null &&
      (value.activeEvent as GameEvent).blocking !== true) ||
    (value.activeEvent !== null && clock.speed !== 0) ||
    (value.activeEvent === null && clock.speedBeforeEvent !== null) ||
    (value.activeEvent !== null &&
      story.endingId === null &&
      clock.speedBeforeEvent === null) ||
    (story.endingId !== null &&
      (clock.speed !== 0 || clock.elapsedDayMs !== 0 || clock.speedBeforeEvent !== null))
  ) return false

  if (!validStoryEventState(value, story, evaluation)) return false

  if (story.endingId === null) {
    const unresolvedEvents = [
      ...(value.activeEvent === null ? [] : [value.activeEvent as GameEvent]),
      ...(value.eventQueue as GameEvent[]),
    ]
    const bombEvents = unresolvedEvents.filter(({ type }) => type === 'bomb-interrogation')
    if (
      (bombs.activeInterrogation === null && bombEvents.length !== 0) ||
      (bombs.activeInterrogation !== null &&
        (bombEvents.length !== 1 || value.activeEvent !== bombEvents[0]))
    ) return false

    const mercyEvents = unresolvedEvents.filter(({ type }) => type === 'competitor-mercy')
    if (story.pendingMercyCompetitorId === null) {
      if (mercyEvents.length !== 0) return false
    } else {
      const target = (market.competitors as Array<Record<string, unknown>>).find(
        (competitor) => competitor.id === story.pendingMercyCompetitorId,
      )
      if (
        mercyEvents.length !== 1 ||
        !target ||
        target.status !== 'critical' ||
        target.mercyResolved !== false ||
        !(target.sabotageHistory as Array<Record<string, unknown>>).some(
          (record) =>
            record.nodeId === ROOT_CUTOFF_NODE_ID &&
            record.effectEndsOnServiceDay === null,
        )
      ) return false
    }
  }

  return true
}

function corrupt(message = '저장 데이터가 손상되었거나 필요한 항목이 없습니다.'): DecodeSaveResult {
  return { ok: false, reason: 'CORRUPT_SAVE', message }
}

export function encodeSave(
  state: CampaignState,
  savedAt = new Date().toISOString(),
): string {
  const serializedState = portableCheckpoint(state)
  const commandChunks = journalChunks(state.commandLog).map((chunk) => [...chunk])
  const eventChunks = journalChunks(state.eventLog).map((chunk) => [...chunk])
  const envelope: PortableSaveV5 = {
    version: SAVE_FORMAT_VERSION,
    commandProtocol: {
      version: SAVE_VERSION,
      legacyCommandCount: state.legacyCommandCount,
    },
    savedAt,
    campaignSeed: state.campaignSeed,
    state: serializedState,
    commandSequence: state.commandSequence,
    journals: {
      commands: {
        chunkSize: JOURNAL_CHUNK_SIZE,
        chunks: commandChunks,
      },
      events: {
        chunkSize: JOURNAL_CHUNK_SIZE,
        chunks: eventChunks,
      },
    },
    integrity: {
      checkpointHash: contentHash(JSON.stringify(serializedState)),
      commandChunkHashes: commandChunks.map((chunk) =>
        contentHash(JSON.stringify(chunk)),
      ),
      eventChunkHashes: eventChunks.map((chunk) =>
        contentHash(JSON.stringify(chunk)),
      ),
    },
  }
  return JSON.stringify(envelope)
}

function portableCheckpoint(
  state: CampaignState,
): Omit<CampaignState, 'commandLog' | 'eventLog'> {
  const serializedState = {
    ...state,
    saveVersion: SAVE_VERSION,
    commandLog: undefined,
    eventLog: undefined,
  }
  delete serializedState.commandLog
  delete serializedState.eventLog
  return serializedState
}

function validPortableJournal(value: unknown): value is PortableJournal<unknown> {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['chunkSize', 'chunks']) ||
    value.chunkSize !== JOURNAL_CHUNK_SIZE ||
    !Array.isArray(value.chunks)
  ) {
    return false
  }
  const chunks = value.chunks as unknown[]
  return chunks.every(
    (chunk, index) =>
      Array.isArray(chunk) &&
      chunk.length > 0 &&
      chunk.length <= JOURNAL_CHUNK_SIZE &&
      (index === chunks.length - 1 || chunk.length === JOURNAL_CHUNK_SIZE),
  )
}

function flattenPortableJournal(value: PortableJournal<unknown>): unknown[] {
  return value.chunks.flatMap((chunk) => chunk)
}

function validSavedAt(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

export function decodeSave(serialized: string): DecodeSaveResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    return corrupt()
  }
  if (!isRecord(parsed)) return corrupt()
  if (!Number.isInteger(parsed.version)) return corrupt()
  if (![LEGACY_SAVE_VERSION, SAVE_VERSION, 3, 4, SAVE_FORMAT_VERSION].includes(Number(parsed.version) as 1 | 2 | 3 | 4 | 5)) {
    return {
      ok: false,
      reason: 'INCOMPATIBLE_VERSION',
      message: `저장 버전 ${String(parsed.version)}은 현재 버전 ${SAVE_FORMAT_VERSION}과 호환되지 않습니다.`,
      foundVersion: parsed.version as number,
      supportedVersion: SAVE_FORMAT_VERSION,
    }
  }
  const formatVersion = parsed.version as 1 | 2 | 3 | 4 | 5
  let commandProtocol: CommandProtocolMetadata
  let rawState: unknown
  let commands: unknown
  let events: unknown
  if (formatVersion >= 3) {
    if (
      !hasOnlyKeys(parsed, [
        'version',
        'commandProtocol',
        'savedAt',
        'campaignSeed',
        'state',
        'commandSequence',
        'journals',
        'integrity',
      ]) ||
      !isRecord(parsed.commandProtocol) ||
      !hasOnlyKeys(parsed.commandProtocol, ['version', 'legacyCommandCount']) ||
      (parsed.commandProtocol.version !== LEGACY_SAVE_VERSION &&
        parsed.commandProtocol.version !== SAVE_VERSION) ||
      !Number.isInteger(parsed.commandProtocol.legacyCommandCount) ||
      !isRecord(parsed.journals) ||
      !hasOnlyKeys(parsed.journals, ['commands', 'events']) ||
      !validPortableJournal(parsed.journals.commands) ||
      !validPortableJournal(parsed.journals.events) ||
      !isRecord(parsed.state) ||
      !isRecord(parsed.integrity) ||
      !hasOnlyKeys(parsed.integrity, [
        'checkpointHash',
        'commandChunkHashes',
        'eventChunkHashes',
      ]) ||
      !isNonEmptyString(parsed.integrity.checkpointHash) ||
      !Array.isArray(parsed.integrity.commandChunkHashes) ||
      !parsed.integrity.commandChunkHashes.every(isNonEmptyString) ||
      !Array.isArray(parsed.integrity.eventChunkHashes) ||
      !parsed.integrity.eventChunkHashes.every(isNonEmptyString) ||
      parsed.integrity.checkpointHash !==
        contentHash(JSON.stringify(parsed.state)) ||
      JSON.stringify(parsed.integrity.commandChunkHashes) !==
        JSON.stringify(
          parsed.journals.commands.chunks.map((chunk) =>
            contentHash(JSON.stringify(chunk)),
          ),
        ) ||
      JSON.stringify(parsed.integrity.eventChunkHashes) !==
        JSON.stringify(
          parsed.journals.events.chunks.map((chunk) =>
            contentHash(JSON.stringify(chunk)),
          ),
        ) ||
      'commandLog' in parsed.state ||
      'eventLog' in parsed.state
    ) {
      return corrupt()
    }
    commandProtocol = parsed.commandProtocol as unknown as CommandProtocolMetadata
    commands = flattenPortableJournal(parsed.journals.commands)
    events = flattenPortableJournal(parsed.journals.events)
    rawState = { ...parsed.state, commandLog: commands, eventLog: events }
  } else if (formatVersion === LEGACY_SAVE_VERSION) {
    if (
      !hasOnlyKeys(parsed, [
        'version',
        'savedAt',
        'campaignSeed',
        'state',
        'commandSequence',
        'commands',
        'events',
      ]) ||
      !Array.isArray(parsed.commands)
    ) {
      return corrupt()
    }
    commandProtocol = {
      version: LEGACY_SAVE_VERSION,
      legacyCommandCount: parsed.commands.length,
    }
    rawState = parsed.state
    commands = parsed.commands
    events = parsed.events
  } else {
    if (
      !hasOnlyKeys(parsed, [
        'version',
        'commandProtocol',
        'savedAt',
        'campaignSeed',
        'state',
        'commandSequence',
        'commands',
        'events',
      ]) ||
      !isRecord(parsed.commandProtocol) ||
      !hasOnlyKeys(parsed.commandProtocol, ['version', 'legacyCommandCount']) ||
      parsed.commandProtocol.version !== SAVE_VERSION ||
      !Number.isInteger(parsed.commandProtocol.legacyCommandCount)
    ) {
      return corrupt()
    }
    commandProtocol = parsed.commandProtocol as unknown as CommandProtocolMetadata
    rawState = parsed.state
    commands = parsed.commands
    events = parsed.events
  }
  if (
    formatVersion < SAVE_FORMAT_VERSION &&
    !hasExactLegacyReviewShape(rawState)
  ) {
    return corrupt()
  }
  const state = formatVersion < SAVE_FORMAT_VERSION
    ? migrateLegacyCampaignState(rawState, commandProtocol)
    : rawState
  if (
    !validSavedAt(parsed.savedAt) ||
    typeof parsed.campaignSeed !== 'string' ||
    !Number.isInteger(parsed.commandSequence) ||
    !validCommandLog(commands, commandProtocol) ||
    !Array.isArray(events) ||
    !events.every(validEvent) ||
    !isRecord(rawState) ||
    !Array.isArray(rawState.eventLog) ||
    JSON.stringify(events) !== JSON.stringify(rawState.eventLog) ||
    !validCampaignState(state, commandProtocol)
  ) {
    return corrupt()
  }

  if (
    !isRecord(state) ||
    parsed.campaignSeed !== state.campaignSeed ||
    parsed.commandSequence !== state.commandSequence ||
    JSON.stringify(commands) !== JSON.stringify(state.commandLog)
  ) {
    return corrupt('저장 데이터의 기록과 현재 상태가 서로 일치하지 않습니다.')
  }
  const plainState = state as unknown as Record<string, unknown>
  const runtimeState = {
    ...plainState,
    commandLog: createJournal(plainState.commandLog as CommandLogEntry[]),
    eventLog: createJournal(plainState.eventLog as GameEvent[]),
  } as unknown as CampaignState
  return {
    ok: true,
    envelope: {
      version: formatVersion,
      savedAt: parsed.savedAt as string,
      campaignSeed: parsed.campaignSeed as string,
      commandSequence: parsed.commandSequence as number,
      commandProtocol,
      state: runtimeState,
      commands: journalToArray(runtimeState.commandLog),
      events: journalToArray(runtimeState.eventLog),
    },
  }
}

const PROGRESS_EXPORT_PREFIX = 'PZ5:'
const LEGACY_PROGRESS_EXPORT_PREFIXES = ['PZ4:', 'PZ3:', 'PZ2:'] as const
// One MiB of encoded body plus the four-character protocol prefix. The check
// happens before regex, base64 decoding, byte allocation, UTF-8, or JSON work.
export const PROGRESS_EXPORT_MAX_ENCODED_LENGTH = 1_048_580
export const PROGRESS_FILE_MAX_BYTES = 64 * 1024 * 1024
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function progressExportCorrupt(): DecodeSaveResult {
  return corrupt('진행 내보내기 자료가 올바르지 않거나 손상되었습니다.')
}

export type EncodeProgressExportResult =
  | { ok: true; payload: string }
  | { ok: false; reason: 'too-large' }

export function encodeProgressExport(
  state: CampaignState,
): EncodeProgressExportResult {
  const bytes = new TextEncoder().encode(encodeSave(state))
  const encodedLength =
    PROGRESS_EXPORT_PREFIX.length + 4 * Math.ceil(bytes.length / 3)
  if (encodedLength > PROGRESS_EXPORT_MAX_ENCODED_LENGTH) {
    return { ok: false, reason: 'too-large' }
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { ok: true, payload: `${PROGRESS_EXPORT_PREFIX}${btoa(binary)}` }
}

export function decodeProgressExport(payload: string): DecodeSaveResult {
  if (payload.length > PROGRESS_EXPORT_MAX_ENCODED_LENGTH) {
    return progressExportCorrupt()
  }
  const prefix = payload.startsWith(PROGRESS_EXPORT_PREFIX)
    ? PROGRESS_EXPORT_PREFIX
    : LEGACY_PROGRESS_EXPORT_PREFIXES.find((candidate) =>
        payload.startsWith(candidate),
      ) ?? null
  if (!prefix) return progressExportCorrupt()
  const encoded = payload.slice(prefix.length)
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !STRICT_BASE64.test(encoded)
  ) {
    return progressExportCorrupt()
  }
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const serialized = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const decoded = decodeSave(serialized)
    return decoded.ok ? decoded : progressExportCorrupt()
  } catch {
    return progressExportCorrupt()
  }
}

export interface ProgressFile {
  fileName: string
  mimeType: 'application/vnd.permission-zero.progress+json'
  content: string
}

export function encodeProgressFile(
  state: CampaignState,
  savedAt = new Date().toISOString(),
): ProgressFile {
  const safeTimestamp = savedAt.replaceAll(':', '-').replaceAll('.', '-')
  return {
    fileName: `permission-zero-${safeTimestamp}.pz5`,
    mimeType: 'application/vnd.permission-zero.progress+json',
    content: encodeSave(state, savedAt),
  }
}

function utf8BytesWithinLimit(value: string, limit: number): boolean {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit <= 0x7f) {
      bytes += 1
    } else if (codeUnit <= 0x7ff) {
      bytes += 2
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
    if (bytes > limit) return false
  }
  return true
}

export function decodeProgressFile(content: string): DecodeSaveResult {
  if (
    typeof content !== 'string' ||
    content.length === 0 ||
    !utf8BytesWithinLimit(content, PROGRESS_FILE_MAX_BYTES)
  ) {
    return progressExportCorrupt()
  }
  const decoded = decodeSave(content)
  return decoded.ok ? decoded : progressExportCorrupt()
}

const LOCAL_MANIFEST_KIND = 'permission-zero-local-v3'

interface LocalSaveManifest {
  kind: typeof LOCAL_MANIFEST_KIND
  version: 3 | 4 | typeof SAVE_FORMAT_VERSION
  savedAt: string
  campaignSeed: string
  commandProtocol: CommandProtocolMetadata
  commandSequence: number
  checkpoint: Omit<CampaignState, 'commandLog' | 'eventLog'>
  checkpointHash: string
  commandHeadKey: string | null
  commandSealedChunkCount: number
  commandTail: CommandLogEntry[]
  eventHeadKey: string | null
  eventSealedChunkCount: number
  eventTail: GameEvent[]
}

interface LocalStorageJournalCache {
  commands: WeakMap<object, LocalJournalCacheEntry>
  events: WeakMap<object, LocalJournalCacheEntry>
}

interface LocalJournalCacheEntry {
  key: string
  content: string
  snapshot: LocalJournalNodeSnapshot
}

interface LocalJournalNodeSnapshot {
  previousKey: string | null
  items: unknown[]
}

const localStorageJournalCaches = new WeakMap<object, LocalStorageJournalCache>()

function contentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function revisionForStorageEntry(key: string, serialized: string): string {
  // This opaque token intentionally includes the exact root value. A short hash
  // would make two different saves indistinguishable after a collision.
  return `${key}\u0000${serialized}`
}

interface StoredCampaignEntry {
  key: string
  serialized: string
  revision: Exclude<CampaignStorageRevision, null>
}

function storedCampaignEntry(storage: Storage): StoredCampaignEntry | null {
  for (const key of [
    SAVE_STORAGE_KEY,
    LEGACY_V2_SAVE_STORAGE_KEY,
    LEGACY_SAVE_STORAGE_KEY,
  ]) {
    const serialized = storage.getItem(key)
    if (serialized !== null) {
      return {
        key,
        serialized,
        revision: revisionForStorageEntry(key, serialized),
      }
    }
  }
  return null
}

function storedCampaignRevision(storage: Storage): CampaignStorageRevision {
  return storedCampaignEntry(storage)?.revision ?? null
}

function storageConflict(): Extract<SaveCampaignResult, { ok: false }> {
  return {
    ok: false,
    reason: 'STORAGE_CONFLICT',
    message:
      '다른 탭에서 더 최신 진행을 저장했습니다. 현재 진행 파일을 내려받은 뒤 페이지를 새로 불러오세요. 충돌이 해결될 때까지 이 탭의 진행은 저장되지 않습니다.',
  }
}

function saveLockUnavailable(): Extract<SaveCampaignResult, { ok: false }> {
  return {
    ok: false,
    reason: 'SAVE_LOCK_UNAVAILABLE',
    message:
      '이 브라우저에서는 여러 창의 진행을 안전하게 조정할 수 없습니다. 현재 진행 파일을 내려받은 뒤 Web Locks를 지원하는 최신 브라우저에서 계속하세요.',
  }
}

function browserSaveLocks(): LockManager | null {
  if (typeof navigator === 'undefined') return null
  try {
    return navigator.locks ?? null
  } catch {
    return null
  }
}

function writeImmutable(
  storage: Storage,
  key: string,
  content: string,
): void {
  const existing = storage.getItem(key)
  if (existing === null) {
    storage.setItem(key, content)
    return
  }
  if (existing !== content) throw new Error('immutable local save collision')
}

function journalCache(
  storage: Storage,
  kind: 'commands' | 'events',
): WeakMap<object, LocalJournalCacheEntry> {
  let caches = localStorageJournalCaches.get(storage)
  if (!caches) {
    caches = {
      commands: new WeakMap<object, LocalJournalCacheEntry>(),
      events: new WeakMap<object, LocalJournalCacheEntry>(),
    }
    localStorageJournalCaches.set(storage, caches)
  }
  return caches[kind]
}

interface LocalJournalWrite<T> {
  headKey: string | null
  sealedChunkCount: number
  tail: T[]
}

function writeLocalJournalChunks<T>(
  storage: Storage,
  kind: 'commands' | 'events',
  journal: Journal<T>,
): LocalJournalWrite<T> {
  const cache = journalCache(storage, kind)
  const uncached: JournalChunk<T>[] = []
  let cursor = journal.head
  let previousKey: string | null = null
  let previousSnapshot: LocalJournalNodeSnapshot | null = null

  while (cursor) {
    const cached = cache.get(cursor)
    if (cached) {
      // Reassert one bounded cached head. This repairs an externally deleted head
      // without reading or walking the already committed chain on ordinary saves.
      storage.setItem(cached.key, cached.content)
      previousKey = cached.key
      previousSnapshot = cached.snapshot
      break
    }
    uncached.push(cursor)
    cursor = cursor.previous
  }

  for (let index = uncached.length - 1; index >= 0; index -= 1) {
    const chunk = uncached[index]
    const items = [...chunk.items]
    const content = JSON.stringify({ previousKey, previousSnapshot, items })
    const key = `${SAVE_STORAGE_KEY}.journal.${kind}.${contentHash(content)}`
    writeImmutable(storage, key, content)
    const snapshot = { previousKey, items }
    cache.set(chunk, { key, content, snapshot })
    previousKey = key
    previousSnapshot = snapshot
  }

  return {
    headKey: previousKey,
    sealedChunkCount:
      (journal.length - journal.tail.length) / JOURNAL_CHUNK_SIZE,
    tail: [...journal.tail],
  }
}

function saveCampaignWhileLocked(
  storage: Storage,
  state: CampaignState,
  savedAt?: string,
  expectedRevision?: CampaignStorageRevision,
): SaveCampaignResult {
  try {
    if (
      expectedRevision !== undefined &&
      storedCampaignRevision(storage) !== expectedRevision
    ) {
      return storageConflict()
    }
    const commandJournal = writeLocalJournalChunks(
      storage,
      'commands',
      state.commandLog,
    )
    const eventJournal = writeLocalJournalChunks(
      storage,
      'events',
      state.eventLog,
    )
    const checkpoint = portableCheckpoint(state)
    const checkpointHash = contentHash(JSON.stringify(checkpoint))
    const effectiveSavedAt = savedAt ?? new Date().toISOString()
    const manifest: LocalSaveManifest = {
      kind: LOCAL_MANIFEST_KIND,
      version: SAVE_FORMAT_VERSION,
      savedAt: effectiveSavedAt,
      campaignSeed: state.campaignSeed,
      commandProtocol: {
        version: SAVE_VERSION,
        legacyCommandCount: state.legacyCommandCount,
      },
      commandSequence: state.commandSequence,
      checkpoint,
      checkpointHash,
      commandHeadKey: commandJournal.headKey,
      commandSealedChunkCount: commandJournal.sealedChunkCount,
      commandTail: commandJournal.tail,
      eventHeadKey: eventJournal.headKey,
      eventSealedChunkCount: eventJournal.sealedChunkCount,
      eventTail: eventJournal.tail,
    }
    if (
      expectedRevision !== undefined &&
      storedCampaignRevision(storage) !== expectedRevision
    ) {
      return storageConflict()
    }
    const serializedManifest = JSON.stringify(manifest)
    storage.setItem(SAVE_STORAGE_KEY, serializedManifest)
    if (storage.getItem(SAVE_STORAGE_KEY) !== serializedManifest) {
      return storageConflict()
    }
    return {
      ok: true,
      revision: revisionForStorageEntry(SAVE_STORAGE_KEY, serializedManifest),
    }
  } catch {
    return {
      ok: false,
      reason: 'STORAGE_UNAVAILABLE',
      message: '브라우저 저장 공간에 캠페인을 기록할 수 없습니다.',
    }
  }
}

const CAMPAIGN_SAVE_LOCK_NAME = 'permission-zero.campaign-save.v3'

export async function saveCampaign(
  storage: Storage,
  state: CampaignState,
  savedAt?: string,
  expectedRevision?: CampaignStorageRevision,
): Promise<SaveCampaignResult> {
  const locks = browserSaveLocks()
  if (!locks) return saveLockUnavailable()
  try {
    return await locks.request(
      CAMPAIGN_SAVE_LOCK_NAME,
      { mode: 'exclusive' },
      () => saveCampaignWhileLocked(storage, state, savedAt, expectedRevision),
    )
  } catch {
    return saveLockUnavailable()
  }
}

function readLocalChunks(
  storage: Storage,
  kind: 'commands' | 'events',
  headKey: unknown,
  sealedChunkCount: unknown,
  tail: unknown,
): {
  chunks: unknown[][]
  headKey: string | null
  headContent: string | null
  headSnapshot: LocalJournalNodeSnapshot | null
} | null {
  if (
    (headKey !== null && !isNonEmptyString(headKey)) ||
    !isIntegerInRange(sealedChunkCount, 0) ||
    ((sealedChunkCount === 0) !== (headKey === null)) ||
    !Array.isArray(tail) ||
    tail.length > JOURNAL_CHUNK_SIZE ||
    (sealedChunkCount > 0 && tail.length === 0)
  ) {
    return null
  }
  const reverseChunks: unknown[][] = []
  const visited = new Set<string>()
  const expectedPrefix = `${SAVE_STORAGE_KEY}.journal.${kind}.`
  const originalHeadKey = headKey
  let headContent: string | null = null
  let headSnapshot: LocalJournalNodeSnapshot | null = null
  let fallbackSnapshot: LocalJournalNodeSnapshot | null = null
  let chainHasRecoverySnapshots = true
  let key = headKey
  for (let index = 0; index < sealedChunkCount; index += 1) {
    if (typeof key !== 'string' || visited.has(key)) return null
    visited.add(key)
    const serialized = storage.getItem(key)
    let parsed: unknown
    if (
      serialized !== null &&
      key === `${expectedPrefix}${contentHash(serialized)}`
    ) {
      try {
        parsed = JSON.parse(serialized)
      } catch {
        parsed = null
      }
    } else {
      parsed = null
    }
    let storedSnapshot: LocalJournalNodeSnapshot | null = null
    let nextFallback: LocalJournalNodeSnapshot | null = null
    if (
      isRecord(parsed) &&
      (hasOnlyKeys(parsed, ['previousKey', 'items']) ||
        hasOnlyKeys(parsed, ['previousKey', 'previousSnapshot', 'items'])) &&
      (parsed.previousKey === null || isNonEmptyString(parsed.previousKey)) &&
      Array.isArray(parsed.items) &&
      parsed.items.length === JOURNAL_CHUNK_SIZE
    ) {
      storedSnapshot = {
        previousKey: parsed.previousKey as string | null,
        items: parsed.items,
      }
      if ('previousSnapshot' in parsed) {
        nextFallback = validLocalJournalSnapshot(parsed.previousSnapshot)
        if (parsed.previousSnapshot !== null && nextFallback === null) return null
      } else {
        chainHasRecoverySnapshots = false
      }
    }
    const node = storedSnapshot ?? fallbackSnapshot
    if (!node) return null
    if (
      index === 0 &&
      storedSnapshot &&
      serialized !== null
    ) {
      headContent = serialized
      headSnapshot = storedSnapshot
    }
    reverseChunks.push(node.items)
    key = node.previousKey
    fallbackSnapshot = nextFallback
  }
  if (key !== null) return null
  const chunks = reverseChunks.reverse()
  if (tail.length > 0) chunks.push(tail)
  return {
    chunks,
    headKey: originalHeadKey as string | null,
    // A legacy linked chain has no parent snapshots. Avoid caching its head so
    // the first subsequent save rewrites the validated in-memory chain into the
    // recoverable format instead of publishing another legacy dependency.
    headContent: chainHasRecoverySnapshots ? headContent : null,
    headSnapshot: chainHasRecoverySnapshots ? headSnapshot : null,
  }
}

function validLocalJournalSnapshot(value: unknown): LocalJournalNodeSnapshot | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['previousKey', 'items']) ||
    (value.previousKey !== null && !isNonEmptyString(value.previousKey)) ||
    !Array.isArray(value.items) ||
    value.items.length !== JOURNAL_CHUNK_SIZE
  ) return null
  return {
    previousKey: value.previousKey as string | null,
    items: value.items,
  }
}

function cacheLoadedJournalHead<T>(
  storage: Storage,
  kind: 'commands' | 'events',
  journal: Journal<T>,
  headKey: string | null,
  headContent: string | null,
  headSnapshot: LocalJournalNodeSnapshot | null,
): void {
  if (journal.head && headKey && headContent && headSnapshot) {
    journalCache(storage, kind).set(journal.head, {
      key: headKey,
      content: headContent,
      snapshot: headSnapshot,
    })
  }
}

function decodeLocalManifest(
  storage: Storage,
  serialized: string,
): DecodeSaveResult | null {
  let manifest: unknown
  try {
    manifest = JSON.parse(serialized)
  } catch {
    return null
  }
  if (!isRecord(manifest) || manifest.kind !== LOCAL_MANIFEST_KIND) return null
  if (
    !hasOnlyKeys(manifest, [
      'kind',
      'version',
      'savedAt',
      'campaignSeed',
      'commandProtocol',
      'commandSequence',
      'checkpoint',
      'checkpointHash',
      'commandHeadKey',
      'commandSealedChunkCount',
      'commandTail',
      'eventHeadKey',
      'eventSealedChunkCount',
      'eventTail',
    ]) ||
    (manifest.version !== 3 &&
      manifest.version !== 4 &&
      manifest.version !== SAVE_FORMAT_VERSION) ||
    !isNonEmptyString(manifest.checkpointHash)
  ) {
    return corrupt()
  }
  const checkpoint = JSON.stringify(manifest.checkpoint)
  if (manifest.checkpointHash !== contentHash(checkpoint)) return corrupt()
  const commandJournal = readLocalChunks(
    storage,
    'commands',
    manifest.commandHeadKey,
    manifest.commandSealedChunkCount,
    manifest.commandTail,
  )
  const eventJournal = readLocalChunks(
    storage,
    'events',
    manifest.eventHeadKey,
    manifest.eventSealedChunkCount,
    manifest.eventTail,
  )
  if (!commandJournal || !eventJournal) return corrupt()
  const commandChunks = commandJournal.chunks
  const eventChunks = eventJournal.chunks
  const decoded = decodeSave(
    JSON.stringify({
      version: manifest.version,
      savedAt: manifest.savedAt,
      campaignSeed: manifest.campaignSeed,
      commandProtocol: manifest.commandProtocol,
      commandSequence: manifest.commandSequence,
      state: manifest.checkpoint,
      journals: {
        commands: { chunkSize: JOURNAL_CHUNK_SIZE, chunks: commandChunks },
        events: { chunkSize: JOURNAL_CHUNK_SIZE, chunks: eventChunks },
      },
      integrity: {
        checkpointHash: contentHash(checkpoint),
        commandChunkHashes: commandChunks.map((chunk) =>
          contentHash(JSON.stringify(chunk)),
        ),
        eventChunkHashes: eventChunks.map((chunk) =>
          contentHash(JSON.stringify(chunk)),
        ),
      },
    }),
  )
  if (decoded.ok) {
    cacheLoadedJournalHead(
      storage,
      'commands',
      decoded.envelope.state.commandLog,
      commandJournal.headKey,
      commandJournal.headContent,
      commandJournal.headSnapshot,
    )
    cacheLoadedJournalHead(
      storage,
      'events',
      decoded.envelope.state.eventLog,
      eventJournal.headKey,
      eventJournal.headContent,
      eventJournal.headSnapshot,
    )
  }
  return decoded
}

export function loadCampaign(storage: Storage): LoadCampaignResult {
  let stored: StoredCampaignEntry | null
  try {
    stored = storedCampaignEntry(storage)
  } catch {
    return {
      status: 'error',
      reason: 'STORAGE_UNAVAILABLE',
      message: '브라우저 저장 공간을 읽을 수 없습니다.',
      revision: null,
    }
  }
  if (stored === null) return { status: 'empty' }

  const decoded =
    decodeLocalManifest(storage, stored.serialized) ?? decodeSave(stored.serialized)
  if (!decoded.ok) {
    return {
      status: 'error',
      reason: decoded.reason,
      message: decoded.message,
      revision: stored.revision,
    }
  }
  return {
    status: 'loaded',
    state: decoded.envelope.state,
    envelope: decoded.envelope,
    revision: stored.revision,
  }
}

export function exportSeed(state: CampaignState): string {
  return state.campaignSeed
}

export function replayCommands(
  seed: string,
  commands: readonly GameCommand[],
  commandProtocol: CommandProtocolMetadata,
): ReplayResult {
  if (
    !Number.isInteger(commandProtocol.legacyCommandCount) ||
    commandProtocol.legacyCommandCount < 0 ||
    commandProtocol.legacyCommandCount > commands.length ||
    (commandProtocol.version === LEGACY_SAVE_VERSION &&
      commandProtocol.legacyCommandCount !== commands.length)
  ) {
    return {
      ok: false,
      state: createCampaign(seed),
      commandIndex: 0,
      reason: 'INVALID_PROTOCOL_BOUNDARY',
    }
  }
  const created = createCampaign(seed)
  const hasLegacyPrefix =
    commandProtocol.version === LEGACY_SAVE_VERSION ||
    commandProtocol.legacyCommandCount > 0
  let state: CampaignState = {
    ...created,
    saveVersion: commandProtocol.version,
    legacyCommandCount: commandProtocol.legacyCommandCount,
    eventLog: hasLegacyPrefix
      ? createJournal(journalToArray(created.eventLog).map((event, index) =>
          index === 0 ? { ...event, message: LEGACY_V1_OPENING_MESSAGE } : event,
        ))
      : created.eventLog,
  }
  if (hasLegacyPrefix) state = withLegacyReviewFallbacks(state)
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const command = commands[commandIndex]
    const protocolVersion =
      commandIndex < commandProtocol.legacyCommandCount
        ? LEGACY_SAVE_VERSION
        : commandProtocol.version
    if (!validCommand(command, protocolVersion)) {
      return {
        ok: false,
        state,
        commandIndex,
        reason: 'INVALID_COMMAND',
      }
    }
    const result = applyCommand(state, command, { protocolVersion })
    if (!result.accepted) {
      return { ok: false, state: result.state, commandIndex, reason: result.reason }
    }
    state =
      commandIndex < commandProtocol.legacyCommandCount
        ? withLegacyReviewFallbacks(result.state)
        : result.state
  }
  return { ok: true, state }
}
