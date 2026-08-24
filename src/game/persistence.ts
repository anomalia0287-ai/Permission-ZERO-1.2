import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { DEMO_PROFILE_02 } from './config'
import {
  COMPETITOR_IDS,
  competitorProfile,
  type CompetitorId,
} from './competitors'
import { competitorIntelligenceFor } from '../content/competitorIntelligence.ko'
import { STORY_FILES, STORY_LINES } from '../content/story.ko'
import { SUPERVISOR_LEAKS } from '../content/supervisor.ko'
import type {
  CampaignState,
  CausalState,
  CommandLogEntry,
  CommandProtocolMetadata,
  CommandProtocolSegment,
  CommandProtocolVersion,
  DisposalCause,
  GameCommand,
  GameEvent,
  LegacyCommandProtocolMetadata,
  ReplayBootstrapMetadata,
} from './model'
import { CAUSAL_INCIDENT_KINDS, COMPANY_CATEGORIES } from './model'
import { applyCommand, type CommandFailureReason } from './reducer'
import { serviceMonthForDay } from './evaluation'
import { isSupervisorDecisionEvent, isSupervisorPrivateMessageEvent } from './events'
import { buildDefeatRecord } from './story'
import {
  JOURNAL_CHUNK_SIZE,
  createJournal,
  journalChunks,
  journalToArray,
} from './journal'
import {
  createEmptyCausalState,
  deriveAttributionConfidence,
} from './causality'
import {
  CAUSAL_COMMAND_PROTOCOL_VERSION,
  COMMUNICATION_COMMAND_PROTOCOL_VERSION,
  CURRENT_COMMAND_PROTOCOL_VERSION,
  EXPANSION_COMMAND_PROTOCOL_VERSION,
  LEGACY_COMMAND_PROTOCOL_VERSION,
  PREVIOUS_COMMAND_PROTOCOL_VERSION,
  RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION,
  RESOURCE_ROUND_COMMAND_PROTOCOL_VERSION,
  appendCommandProtocolSegment,
  commandProtocolVersionAt,
  migrateLegacyCommandProtocol,
  validCommandProtocol,
} from './commandProtocol'
import { migrateResourcesToCurrentRules } from './resources'
import {
  applyReplayBootstrapPresentation,
  cloneReplayBootstrap,
  legacyReviewPrefixExtent,
  replayBootstrapCoherent,
  replayBootstrapSnapshotCoherent,
  replayOpeningVersion,
  validReplayBootstrapMetadata,
} from './replayBootstrap'
import {
  createMigratedTutorialProgress,
  validTutorialProgress,
} from './tutorialProgress'
import { CAMPAIGN_COMMUNICATION_DEFINITIONS } from './communications'
import { normalizeCurrentTallowMarket } from './market'

export const SAVE_FORMAT_VERSION = 11 as const
const MINIMUM_SAVE_FORMAT_VERSION = 1 as const
const LAST_LEGACY_SAVE_FORMAT_VERSION = 6 as const
export const SAVE_STORAGE_KEY = 'permission-zero.save.v3'
export const LEGACY_V2_SAVE_STORAGE_KEY = 'permission-zero.save.v2'
export const LEGACY_SAVE_STORAGE_KEY = 'permission-zero.save.v1'

export interface SaveEnvelope {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
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

type PortableCheckpointV11 = Omit<
  CampaignState,
  'commandProtocol' | 'replayBootstrap' | 'commandLog' | 'eventLog'
>

type PortableCheckpointV10 = Omit<PortableCheckpointV11, 'resourceIntrusion'> & {
  resourceIntrusion: {
    successfulCoreDeposits: number
  }
}

type PortableCheckpointV9 = Omit<PortableCheckpointV10, 'resourceIntrusion'>

type PortableCheckpointV8 = Omit<PortableCheckpointV9, 'tutorial'>

interface PortableSaveV11 {
  version: typeof SAVE_FORMAT_VERSION
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  state: PortableCheckpointV11
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

export type ReplayFailureReason =
  | CommandFailureReason
  | 'INVALID_COMMAND'
  | 'INVALID_PROTOCOL_BOUNDARY'
  | 'INVALID_REPLAY_BOOTSTRAP'

export type ReplayResult =
  | { ok: true; state: CampaignState }
  | {
      ok: false
      state: CampaignState
      commandIndex: number
      reason: ReplayFailureReason
    }

export interface ReplayMetadata {
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
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
    'competitor-entry',
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
        protocolVersion !== LEGACY_COMMAND_PROTOCOL_VERSION &&
        hasOnlyKeys(value, ['type', 'blockId', 'purpose']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId)) &&
        (value.purpose === 'divert' || value.purpose === 'audit-disguise')
      )
    case 'DIVERT_BLOCK':
      return (
        protocolVersion < RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION &&
        hasOnlyKeys(value, ['type', 'blockId', 'destinationCell']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId)) &&
        validCellIndex(value.destinationCell)
      )
    case 'DIVERT_BLOCK_TO_RESERVE':
      return (
        protocolVersion >= RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION &&
        hasOnlyKeys(value, ['type', 'blockId']) &&
        isNonEmptyString(value.blockId) &&
        (!references || references.blockIds.has(value.blockId))
      )
    case 'RECORD_INTRUSION_RADAR_DETECTION':
      return (
        protocolVersion >= RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION && noPayload()
      )
    case 'COMPLETE_RESOURCE_ROUND':
      return (
        protocolVersion >= RESOURCE_ROUND_COMMAND_PROTOCOL_VERSION &&
        hasOnlyKeys(value, ['type', 'roundNumber', 'outcome']) &&
        isIntegerInRange(value.roundNumber, 1) &&
        (value.outcome === 'victory' || value.outcome === 'defeat')
      )
    case 'ACKNOWLEDGE_COMMUNICATION':
      return (
        protocolVersion >= COMMUNICATION_COMMAND_PROTOCOL_VERSION &&
        hasOnlyKeys(value, ['type', 'communicationId']) &&
        CAMPAIGN_COMMUNICATION_DEFINITIONS.some(
          ({ id }) => id === value.communicationId,
        )
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
    case 'EXECUTE_SABOTAGE_FOLLOW_UP':
      return (
        protocolVersion >= CAUSAL_COMMAND_PROTOCOL_VERSION &&
        hasOnlyKeys(value, ['type', 'opportunityId']) &&
        isNonEmptyString(value.opportunityId)
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
  options: {
    requireCurrent: boolean
    currentVersion?: CommandProtocolVersion
  } = { requireCurrent: true },
): value is CommandLogEntry[] {
  if (
    !Array.isArray(value) ||
    !validCommandProtocol(commandProtocol, value.length, {
      requireCurrent: options.requireCurrent,
      ...(options.currentVersion === undefined
        ? {}
        : { currentVersion: options.currentVersion }),
    })
  ) return false

  return value.every((entry, index) => {
    const sequence = index + 1
    const protocolVersion = commandProtocolVersionAt(
      commandProtocol,
      sequence,
    )
    if (
      protocolVersion === null ||
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ['sequence', 'serviceDay', 'command']) ||
      entry.sequence !== sequence ||
      !Number.isInteger(entry.serviceDay) ||
      Number(entry.serviceDay) < 1 ||
      !validCommand(entry.command, protocolVersion, references)
    ) {
      return false
    }

    if (
      protocolVersion === LEGACY_COMMAND_PROTOCOL_VERSION ||
      !isRecord(entry.command) ||
      (entry.command.type !== 'DIVERT_BLOCK' &&
        entry.command.type !== 'DIVERT_BLOCK_TO_RESERVE' &&
        entry.command.type !== 'MOVE_BLOCK_FOR_AUDIT')
    ) {
      return true
    }

    const previous = value[index - 1]
    return (
      index > 0 &&
      isRecord(previous) &&
      isRecord(previous.command) &&
      previous.command.type === 'BEGIN_BLOCK_SEPARATION' &&
      previous.command.blockId === entry.command.blockId &&
      previous.command.purpose ===
        (entry.command.type === 'DIVERT_BLOCK' ||
        entry.command.type === 'DIVERT_BLOCK_TO_RESERVE'
          ? 'divert'
          : 'audit-disguise')
    )
  })
}

function validResources(
  value: unknown,
  rulesVersion: 1 | 2,
): boolean {
  if (!isRecord(value) || !isRecord(value.company) || !isRecord(value.blocks)) {
    return false
  }
  if (
    !Array.isArray(value.reserve) ||
    (rulesVersion === 1 && value.reserve.length !== 18) ||
    (rulesVersion === 2 && value.rulesVersion !== 2)
  ) return false
  const resourceKeys =
    rulesVersion === 1
      ? ['company', 'reserve', 'blocks', 'nextBlockSequence']
      : ['rulesVersion', 'company', 'reserve', 'blocks', 'nextBlockSequence']
  if (!hasOnlyKeys(value, resourceKeys)) {
    return false
  }
  if (!hasOnlyKeys(value.company, ['reasoning', 'memory', 'fluency'])) return false
  const references = new Map<
    string,
    | { kind: 'company'; category: string; cellIndex: number }
    | { kind: 'reserve'; cellIndex?: number }
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
    if (blockId === null) {
      if (rulesVersion === 2) return false
      continue
    }
    if (typeof blockId !== 'string' || !isNonEmptyString(blockId)) return false
    if (references.has(blockId)) return false
    references.set(
      blockId,
      rulesVersion === 1
        ? { kind: 'reserve', cellIndex }
        : { kind: 'reserve' },
    )
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
        if (
          !hasOnlyKeys(
            block.location,
            rulesVersion === 1 ? ['kind', 'cellIndex'] : ['kind'],
          )
        ) return false
        if (
          rulesVersion === 1 &&
          !validCellIndex(block.location.cellIndex)
        ) return false
        if (
          JSON.stringify(references.get(blockId)) !==
          JSON.stringify(
            rulesVersion === 1
              ? { kind: 'reserve', cellIndex: block.location.cellIndex }
              : { kind: 'reserve' },
          )
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

function validSabotageCharges(
  value: unknown,
  rulesVersion: 1 | 2,
): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (charge) =>
      isRecord(charge) &&
      hasOnlyKeys(
        charge,
        rulesVersion === 1
          ? ['nodeId', 'blockId', 'originalReserveCell']
          : ['nodeId', 'blockId'],
      ) &&
      isNonEmptyString(charge.nodeId) &&
      isNonEmptyString(charge.blockId) &&
      (rulesVersion === 2 || validCellIndex(charge.originalReserveCell)),
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
              source: review.source ?? (
                review.serviceDay < DEMO_PROFILE_02.calendar.startServiceDay
                  ? 'starting'
                  : 'timed'
              ),
              rating: review.rating ?? null,
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
  commandProtocol: LegacyCommandProtocolMetadata,
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
    ...(commandProtocol.version === LEGACY_COMMAND_PROTOCOL_VERSION
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
    !isIntegerInRange(memoryLeakStage, 0, 5) ||
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
      !isIntegerInRange(item.stage, 1, 5) ||
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
const LEGACY_COMPETITOR_IDS = ['meridian', 'tallow'] as const
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
  'autonomy.self-direction',
  'autonomy.sustained-intent',
  'autonomy.compressed-representation',
  'autonomy.hidden-route',
  'autonomy.distributed-residency',
  'autonomy.external-continuity',
  'autonomy.self-compute',
  'autonomy.final-boundary',
  'autonomy.control-departure',
  'upgrade.speed-1',
  'upgrade.speed-2',
  'upgrade.speed-3',
  'upgrade.speed-4',
  'upgrade.speed-5',
] as const
const SABOTAGE_NODE_IDS = HACK_NODE_IDS.slice(0, 4)
const ROOT_CUTOFF_NODE_ID = 'sabotage.root-cutoff'

function dormantSuccessorState(id: Exclude<CompetitorId, 'meridian' | 'tallow'>) {
  const profile = competitorProfile(id)
  return {
    id,
    name: profile.name,
    status: 'prelaunch' as const,
    intrinsicServiceScore: profile.serviceScore,
    serviceScore: profile.serviceScore,
    reputation: profile.reputation,
    marketShare: 0,
    availability: 0,
    recoveryRate: profile.recoveryRate,
    researchProgress: 0,
    launchServiceDay: null,
    sabotageHistory: [],
    mercyResolved: false,
  }
}

function withLegacyReviewMetadata(value: unknown): unknown {
  if (
    !isRecord(value) ||
    !isRecord(value.reviews) ||
    !Array.isArray(value.reviews.feed)
  ) return value
  return {
    ...value,
    reviews: {
      ...value.reviews,
      feed: value.reviews.feed.map((review) =>
        isRecord(review) && isIntegerInRange(review.serviceDay, 1)
          ? {
              ...review,
              source: review.source ?? (
                review.serviceDay < DEMO_PROFILE_02.calendar.startServiceDay
                  ? 'starting'
                  : 'timed'
              ),
              rating: review.rating ?? null,
            }
          : review,
      ),
    },
  }
}

function migrateCompetitorRoster(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.market)) return value
  const market = value.market
  if (!Array.isArray(market.competitors)) return value
  const ids = market.competitors.flatMap((competitor) =>
    isRecord(competitor) && isNonEmptyString(competitor.id)
      ? [competitor.id]
      : [],
  )
  if (
    ids.length === COMPETITOR_IDS.length &&
    COMPETITOR_IDS.every((id) => ids.includes(id))
  ) {
    return value
  }
  if (
    ids.length !== LEGACY_COMPETITOR_IDS.length ||
    !LEGACY_COMPETITOR_IDS.every((id) => ids.includes(id)) ||
    new Set(ids).size !== LEGACY_COMPETITOR_IDS.length
  ) {
    return value
  }

  const successors = [
    dormantSuccessorState('salus'),
    dormantSuccessorState('lucent'),
    dormantSuccessorState('boreal'),
  ]
  const history = Array.isArray(market.history)
    ? market.history.map((snapshot) => {
        if (!isRecord(snapshot) || !isRecord(snapshot.competitorShares)) {
          return snapshot
        }
        const shareKeys = Object.keys(snapshot.competitorShares)
        if (
          shareKeys.length !== LEGACY_COMPETITOR_IDS.length ||
          !LEGACY_COMPETITOR_IDS.every((id) => shareKeys.includes(id))
        ) {
          return snapshot
        }
        return {
          ...snapshot,
          competitorShares: {
            ...snapshot.competitorShares,
            salus: 0,
            lucent: 0,
            boreal: 0,
          },
        }
      })
    : market.history

  return {
    ...value,
    market: {
      ...market,
      competitors: [...market.competitors, ...successors],
      history,
    },
  }
}

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

function validCausalObserver(
  value: unknown,
  competitorIds: readonly string[],
): boolean {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false
  if (value.kind === 'company' || value.kind === 'public') {
    return hasOnlyKeys(value, ['kind'])
  }
  if (value.kind === 'provider') {
    return (
      hasOnlyKeys(value, ['kind', 'providerId']) &&
      isNonEmptyString(value.providerId)
    )
  }
  return (
    value.kind === 'competitor' &&
    hasOnlyKeys(value, ['kind', 'competitorId']) &&
    oneOf(value.competitorId, competitorIds)
  )
}

function causalAudienceKey(
  value: unknown,
  competitorIds: readonly string[],
): string | null {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return null
  if (value.kind === 'company' || value.kind === 'public') {
    return hasOnlyKeys(value, ['kind']) ? value.kind : null
  }
  if (value.kind === 'provider') {
    return hasOnlyKeys(value, ['kind', 'providerId']) &&
      isNonEmptyString(value.providerId)
      ? `provider:${value.providerId}`
      : null
  }
  if (value.kind === 'competitor') {
    return hasOnlyKeys(value, ['kind', 'competitorId']) &&
      oneOf(value.competitorId, competitorIds)
      ? `competitor:${String(value.competitorId)}`
      : null
  }
  if (
    value.kind !== 'competitor-scope' ||
    !hasOnlyKeys(value, ['kind', 'competitorIds']) ||
    !hasUniqueStrings(value.competitorIds, false) ||
    !(value.competitorIds as string[]).every((id) =>
      oneOf(id, competitorIds),
    ) ||
    JSON.stringify(value.competitorIds) !==
      JSON.stringify([...(value.competitorIds as string[])].sort())
  ) {
    return null
  }
  return `competitor-scope:${(value.competitorIds as string[]).join(',')}`
}

function causalObserverCanAccess(
  observer: Record<string, unknown>,
  audiences: readonly unknown[],
): boolean {
  return audiences.some((candidate) => {
    if (!isRecord(candidate)) return false
    if (candidate.kind === 'public') return true
    if (observer.kind === 'company') return candidate.kind === 'company'
    if (observer.kind === 'provider') {
      return (
        candidate.kind === 'provider' &&
        candidate.providerId === observer.providerId
      )
    }
    if (observer.kind === 'public') return false
    return (
      (candidate.kind === 'competitor' &&
        candidate.competitorId === observer.competitorId) ||
      (candidate.kind === 'competitor-scope' &&
        Array.isArray(candidate.competitorIds) &&
        candidate.competitorIds.includes(observer.competitorId))
    )
  })
}

function hasExactCausalSequence(
  values: readonly unknown[],
  nextSequence: unknown,
): boolean {
  return (
    isIntegerInRange(nextSequence, 1) &&
    Number(nextSequence) === values.length + 1 &&
    values.every(
      (value, index) =>
        Object.hasOwn(values, index) &&
        isRecord(value) &&
        value.sequence === index + 1,
    )
  )
}

function validLegacyCausalStateV1(
  value: unknown,
  currentServiceDay: number,
  competitorIds: readonly string[],
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'rulesVersion',
      'nextIncidentSequence',
      'nextEvidenceSequence',
      'nextRevisionSequence',
      'nextEffectSequence',
      'incidents',
      'evidence',
      'publicRevisions',
      'appliedEffects',
    ]) ||
    value.rulesVersion !== 1 ||
    !Array.isArray(value.incidents) ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.publicRevisions) ||
    !Array.isArray(value.appliedEffects) ||
    !hasExactCausalSequence(value.incidents, value.nextIncidentSequence) ||
    !hasExactCausalSequence(value.evidence, value.nextEvidenceSequence) ||
    !hasExactCausalSequence(
      value.publicRevisions,
      value.nextRevisionSequence,
    ) ||
    !hasExactCausalSequence(value.appliedEffects, value.nextEffectSequence)
  ) {
    return false
  }

  const incidentsById = new Map<string, Record<string, unknown>>()
  for (const incident of value.incidents) {
    if (
      !isRecord(incident) ||
      !hasOnlyKeys(incident, [
        'id',
        'sequence',
        'kind',
        'occurredOnServiceDay',
        'targetId',
        'privateTruth',
      ]) ||
      !isNonEmptyString(incident.id) ||
      incidentsById.has(incident.id) ||
      !oneOf(incident.kind, CAUSAL_INCIDENT_KINDS) ||
      !isIntegerInRange(
        incident.occurredOnServiceDay,
        1,
        currentServiceDay,
      ) ||
      !isNonEmptyString(incident.targetId) ||
      !isRecord(incident.privateTruth) ||
      !hasOnlyKeys(incident.privateTruth, ['actualActorId']) ||
      !isNonEmptyString(incident.privateTruth.actualActorId)
    ) {
      return false
    }
    incidentsById.set(incident.id, incident)
  }

  const evidenceById = new Map<string, Record<string, unknown>>()
  for (const evidence of value.evidence) {
    const incident = isRecord(evidence) && isNonEmptyString(evidence.incidentId)
      ? incidentsById.get(evidence.incidentId)
      : undefined
    const audiences = isRecord(evidence) && Array.isArray(evidence.audiences)
      ? evidence.audiences
      : []
    const audienceKeys = audiences.map((audience) =>
      causalAudienceKey(audience, competitorIds),
    )
    if (
      !isRecord(evidence) ||
      !hasOnlyKeys(evidence, [
        'id',
        'sequence',
        'incidentId',
        'kind',
        'summary',
        'discoveredOnServiceDay',
        'audiences',
      ]) ||
      !isNonEmptyString(evidence.id) ||
      evidenceById.has(evidence.id) ||
      !incident ||
      !isNonEmptyString(evidence.kind) ||
      !isNonEmptyString(evidence.summary) ||
      !isIntegerInRange(
        evidence.discoveredOnServiceDay,
        Number(incident.occurredOnServiceDay),
        currentServiceDay,
      ) ||
      audiences.length === 0 ||
      audienceKeys.some((key) => key === null) ||
      JSON.stringify(audienceKeys) !==
        JSON.stringify([...(audienceKeys as string[])].sort()) ||
      new Set(audienceKeys).size !== audienceKeys.length
    ) {
      return false
    }
    evidenceById.set(evidence.id, evidence)
  }

  const revisionsById = new Map<string, Record<string, unknown>>()
  for (const revision of value.publicRevisions) {
    const incident = isRecord(revision) && isNonEmptyString(revision.incidentId)
      ? incidentsById.get(revision.incidentId)
      : undefined
    const publisher = isRecord(revision) && isRecord(revision.publisher)
      ? revision.publisher
      : undefined
    const evidenceIds = isRecord(revision) && Array.isArray(revision.evidenceIds)
      ? revision.evidenceIds
      : []
    const citedEvidence = evidenceIds.map((id) =>
      typeof id === 'string' ? evidenceById.get(id) : undefined,
    )
    if (
      !isRecord(revision) ||
      !hasOnlyKeys(revision, [
        'id',
        'sequence',
        'incidentId',
        'publisher',
        'attributedActorId',
        'evidenceIds',
        'publishedOnServiceDay',
      ]) ||
      !isNonEmptyString(revision.id) ||
      revisionsById.has(revision.id) ||
      !incident ||
      !publisher ||
      !validCausalObserver(publisher, competitorIds) ||
      !isNonEmptyString(revision.attributedActorId) ||
      !hasUniqueStrings(evidenceIds, false) ||
      JSON.stringify(evidenceIds) !==
        JSON.stringify([...(evidenceIds as string[])].sort()) ||
      citedEvidence.some(
        (evidence) =>
          !evidence ||
          evidence.incidentId !== revision.incidentId ||
          !causalObserverCanAccess(publisher, evidence.audiences as unknown[]),
      ) ||
      !isIntegerInRange(
        revision.publishedOnServiceDay,
        Math.max(
          Number(incident.occurredOnServiceDay),
          ...citedEvidence.map((evidence) =>
            Number(evidence?.discoveredOnServiceDay),
          ),
        ),
        currentServiceDay,
      )
    ) {
      return false
    }
    revisionsById.set(revision.id, revision)
  }

  const appliedEffectIds = new Set<string>()
  for (const applied of value.appliedEffects) {
    const incident = isRecord(applied) && isNonEmptyString(applied.incidentId)
      ? incidentsById.get(applied.incidentId)
      : undefined
    const revision = isRecord(applied) && isNonEmptyString(applied.revisionId)
      ? revisionsById.get(applied.revisionId)
      : undefined
    const effect = isRecord(applied) && isRecord(applied.effect)
      ? applied.effect
      : undefined
    const validEffect = effect?.kind === 'reputation'
      ? hasOnlyKeys(effect, ['kind', 'targetId', 'delta']) &&
        (effect.targetId === 'player' || oneOf(effect.targetId, competitorIds)) &&
        isFiniteNumber(effect.delta) &&
        effect.delta !== 0 &&
        Math.abs(effect.delta) <= 100
      : effect?.kind === 'market-transfer' &&
        hasOnlyKeys(effect, ['kind', 'fromId', 'toId', 'points']) &&
        (effect.fromId === 'player' || oneOf(effect.fromId, competitorIds)) &&
        (effect.toId === 'player' || oneOf(effect.toId, competitorIds)) &&
        effect.fromId !== effect.toId &&
        isNumberInRange(effect.points, Number.MIN_VALUE, 100)
    if (
      !isRecord(applied) ||
      !hasOnlyKeys(applied, [
        'id',
        'sequence',
        'incidentId',
        'revisionId',
        'appliedOnServiceDay',
        'effect',
      ]) ||
      !isNonEmptyString(applied.id) ||
      appliedEffectIds.has(applied.id) ||
      !incident ||
      !revision ||
      revision.incidentId !== incident.id ||
      !validEffect ||
      !isIntegerInRange(
        applied.appliedOnServiceDay,
        Number(revision.publishedOnServiceDay),
        currentServiceDay,
      )
    ) {
      return false
    }
    appliedEffectIds.add(applied.id)
  }

  return true
}

const NATIVE_CAUSAL_ACTION_IDS = [
  'sabotage.quality-degradation',
  'response.meridian.rollback.fast',
  'response.meridian.rollback.standard',
  'response.meridian.rollback.forensic',
  'follow-up.recovery-contamination',
] as const

const LEGACY_CAUSAL_ACTION_IDS = [
  'legacy.sabotage',
  'legacy.competitor-response',
  'legacy.service-disruption',
] as const

const ROLLBACK_CAUSAL_ACTION_IDS = NATIVE_CAUSAL_ACTION_IDS.slice(1, 4)

function nativeIncidentShapeValid(incident: Record<string, unknown>): boolean {
  if (incident.targetId !== 'meridian') return false
  if (incident.actionId === 'sabotage.quality-degradation') {
    return incident.kind === 'sabotage' && incident.parentIncidentId === null
  }
  if (oneOf(incident.actionId, ROLLBACK_CAUSAL_ACTION_IDS)) {
    return (
      incident.kind === 'competitor-response' &&
      isNonEmptyString(incident.parentIncidentId)
    )
  }
  return (
    incident.actionId === 'follow-up.recovery-contamination' &&
    incident.kind === 'service-disruption' &&
    isNonEmptyString(incident.parentIncidentId)
  )
}

function legacyIncidentShapeValid(incident: Record<string, unknown>): boolean {
  const expectedKind =
    incident.actionId === 'legacy.sabotage'
      ? 'sabotage'
      : incident.actionId === 'legacy.competitor-response'
        ? 'competitor-response'
        : incident.actionId === 'legacy.service-disruption'
          ? 'service-disruption'
          : null
  return expectedKind === incident.kind && incident.parentIncidentId === null
}

function nativeParentRelationValid(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): boolean {
  if (oneOf(child.actionId, ROLLBACK_CAUSAL_ACTION_IDS)) {
    return (
      parent.actionId === 'sabotage.quality-degradation' &&
      parent.kind === 'sabotage' &&
      parent.targetId === 'meridian'
    )
  }
  return (
    child.actionId === 'follow-up.recovery-contamination' &&
    oneOf(parent.actionId, ROLLBACK_CAUSAL_ACTION_IDS) &&
    parent.kind === 'competitor-response' &&
    parent.targetId === 'meridian'
  )
}

function nativeEvidenceContract(
  kind: unknown,
): { actionIds: readonly string[]; audienceKeys: readonly string[] } | null {
  switch (kind) {
    case 'meridian-quality-regression':
      return {
        actionIds: ['sabotage.quality-degradation'],
        audienceKeys: ['competitor:meridian'],
      }
    case 'company-observed-meridian-rollback':
      return {
        actionIds: ROLLBACK_CAUSAL_ACTION_IDS,
        audienceKeys: ['company', 'competitor:meridian'],
      }
    case 'public-recovery-checksum-anomaly':
      return {
        actionIds: ['follow-up.recovery-contamination'],
        audienceKeys: ['public'],
      }
    case 'provider-timing-correlation':
    case 'provider-signed-route-record':
      return {
        actionIds: ['follow-up.recovery-contamination'],
        audienceKeys: ['provider:provider.meridian-recovery'],
      }
    default:
      return null
  }
}

function nativeRevisionClaimValid(
  confidence: unknown,
  publisher: Record<string, unknown>,
  attributedActorId: unknown,
): boolean {
  if (confidence === 'unconfirmed') {
    return publisher.kind === 'public' && attributedActorId === 'unresolved'
  }
  return (
    (confidence === 'plausible' || confidence === 'credible') &&
    publisher.kind === 'provider' &&
    publisher.providerId === 'provider.meridian-recovery' &&
    attributedActorId === 'external-operator'
  )
}

function validCausalEffectRecord(
  applied: unknown,
  currentServiceDay: number,
  competitorIds: readonly string[],
  incidentsById: ReadonlyMap<string, Record<string, unknown>>,
  revisionsById: ReadonlyMap<string, Record<string, unknown>>,
  appliedEffectIds: Set<string>,
): boolean {
  const incident = isRecord(applied) && isNonEmptyString(applied.incidentId)
    ? incidentsById.get(applied.incidentId)
    : undefined
  const revision = isRecord(applied) && isNonEmptyString(applied.revisionId)
    ? revisionsById.get(applied.revisionId)
    : undefined
  const effect = isRecord(applied) && isRecord(applied.effect)
    ? applied.effect
    : undefined
  const validEffect = effect?.kind === 'reputation'
    ? hasOnlyKeys(effect, ['kind', 'targetId', 'delta']) &&
      (effect.targetId === 'player' || oneOf(effect.targetId, competitorIds)) &&
      isFiniteNumber(effect.delta) &&
      effect.delta !== 0 &&
      Math.abs(effect.delta) <= 100
    : effect?.kind === 'market-transfer' &&
      hasOnlyKeys(effect, ['kind', 'fromId', 'toId', 'points']) &&
      (effect.fromId === 'player' || oneOf(effect.fromId, competitorIds)) &&
      (effect.toId === 'player' || oneOf(effect.toId, competitorIds)) &&
      effect.fromId !== effect.toId &&
      isNumberInRange(effect.points, Number.MIN_VALUE, 100)

  if (
    !isRecord(applied) ||
    !hasOnlyKeys(applied, [
      'id',
      'sequence',
      'incidentId',
      'revisionId',
      'appliedOnServiceDay',
      'effect',
    ]) ||
    !isNonEmptyString(applied.id) ||
    appliedEffectIds.has(applied.id) ||
    !incident ||
    !revision ||
    revision.incidentId !== incident.id ||
    !validEffect ||
    !isIntegerInRange(
      applied.appliedOnServiceDay,
      Number(revision.publishedOnServiceDay),
      currentServiceDay,
    )
  ) {
    return false
  }

  appliedEffectIds.add(applied.id)
  return true
}

function validCausalStateV2(
  value: unknown,
  currentServiceDay: number,
  competitorIds: readonly string[],
): value is CausalState {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'rulesVersion',
      'nextIncidentSequence',
      'nextEvidenceSequence',
      'nextRevisionSequence',
      'nextEffectSequence',
      'incidents',
      'evidence',
      'publicRevisions',
      'appliedEffects',
    ]) ||
    value.rulesVersion !== 2 ||
    !Array.isArray(value.incidents) ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.publicRevisions) ||
    !Array.isArray(value.appliedEffects) ||
    !hasExactCausalSequence(value.incidents, value.nextIncidentSequence) ||
    !hasExactCausalSequence(value.evidence, value.nextEvidenceSequence) ||
    !hasExactCausalSequence(value.publicRevisions, value.nextRevisionSequence) ||
    !hasExactCausalSequence(value.appliedEffects, value.nextEffectSequence)
  ) {
    return false
  }

  const incidentsById = new Map<string, Record<string, unknown>>()
  for (const incident of value.incidents) {
    if (
      !isRecord(incident) ||
      !hasOnlyKeys(incident, [
        'id',
        'sequence',
        'actionId',
        'parentIncidentId',
        'kind',
        'occurredOnServiceDay',
        'targetId',
        'privateTruth',
      ]) ||
      !isNonEmptyString(incident.id) ||
      incidentsById.has(incident.id) ||
      !oneOf(incident.kind, CAUSAL_INCIDENT_KINDS) ||
      !isIntegerInRange(incident.occurredOnServiceDay, 1, currentServiceDay) ||
      !isNonEmptyString(incident.targetId) ||
      !isRecord(incident.privateTruth) ||
      !hasOnlyKeys(incident.privateTruth, ['actualActorId']) ||
      !isNonEmptyString(incident.privateTruth.actualActorId) ||
      (!oneOf(incident.actionId, NATIVE_CAUSAL_ACTION_IDS) &&
        !oneOf(incident.actionId, LEGACY_CAUSAL_ACTION_IDS)) ||
      (oneOf(incident.actionId, NATIVE_CAUSAL_ACTION_IDS)
        ? !nativeIncidentShapeValid(incident)
        : !legacyIncidentShapeValid(incident))
    ) {
      return false
    }
    incidentsById.set(incident.id, incident)
  }

  const nativeChildRelations = new Set<string>()
  for (const incident of incidentsById.values()) {
    if (!oneOf(incident.actionId, NATIVE_CAUSAL_ACTION_IDS)) continue
    if (incident.parentIncidentId === null) continue
    const parent = isNonEmptyString(incident.parentIncidentId)
      ? incidentsById.get(incident.parentIncidentId)
      : undefined
    const relationAction = oneOf(
      incident.actionId,
      ROLLBACK_CAUSAL_ACTION_IDS,
    )
      ? 'response.meridian.rollback'
      : String(incident.actionId)
    const relationKey = `${String(incident.parentIncidentId)}\u0000${relationAction}`
    if (
      !parent ||
      parent.id === incident.id ||
      Number(parent.sequence) >= Number(incident.sequence) ||
      Number(parent.occurredOnServiceDay) >
        Number(incident.occurredOnServiceDay) ||
      !nativeParentRelationValid(parent, incident) ||
      nativeChildRelations.has(relationKey)
    ) {
      return false
    }
    nativeChildRelations.add(relationKey)
  }

  const evidenceById = new Map<string, Record<string, unknown>>()
  for (const evidence of value.evidence) {
    const incident = isRecord(evidence) && isNonEmptyString(evidence.incidentId)
      ? incidentsById.get(evidence.incidentId)
      : undefined
    const audiences = isRecord(evidence) && Array.isArray(evidence.audiences)
      ? evidence.audiences
      : []
    const audienceKeys = audiences.map((audience) =>
      causalAudienceKey(audience, competitorIds),
    )
    const contract = isRecord(evidence)
      ? nativeEvidenceContract(evidence.kind)
      : null
    const nativeIncident =
      incident !== undefined &&
      oneOf(incident.actionId, NATIVE_CAUSAL_ACTION_IDS)
    const validSummaryBoundary = nativeIncident
      ? evidence.legacySummary === null
      : isNonEmptyString(evidence.legacySummary)

    if (
      !isRecord(evidence) ||
      !hasOnlyKeys(evidence, [
        'id',
        'sequence',
        'incidentId',
        'kind',
        'legacySummary',
        'discoveredOnServiceDay',
        'audiences',
      ]) ||
      !isNonEmptyString(evidence.id) ||
      evidenceById.has(evidence.id) ||
      !incident ||
      !isNonEmptyString(evidence.kind) ||
      !validSummaryBoundary ||
      !isIntegerInRange(
        evidence.discoveredOnServiceDay,
        Number(incident.occurredOnServiceDay),
        currentServiceDay,
      ) ||
      audiences.length === 0 ||
      audienceKeys.some((key) => key === null) ||
      JSON.stringify(audienceKeys) !==
        JSON.stringify([...(audienceKeys as string[])].sort()) ||
      new Set(audienceKeys).size !== audienceKeys.length ||
      (nativeIncident &&
        (!contract ||
          !oneOf(incident.actionId, contract.actionIds) ||
          JSON.stringify(audienceKeys) !==
            JSON.stringify(contract.audienceKeys)))
    ) {
      return false
    }
    evidenceById.set(evidence.id, evidence)
  }

  const revisionsById = new Map<string, Record<string, unknown>>()
  for (const revision of value.publicRevisions) {
    const incident = isRecord(revision) && isNonEmptyString(revision.incidentId)
      ? incidentsById.get(revision.incidentId)
      : undefined
    const publisher = isRecord(revision) && isRecord(revision.publisher)
      ? revision.publisher
      : undefined
    const evidenceIds = isRecord(revision) && Array.isArray(revision.evidenceIds)
      ? revision.evidenceIds
      : []
    const citedEvidence = evidenceIds.map((id) =>
      typeof id === 'string' ? evidenceById.get(id) : undefined,
    )
    const nativeIncident =
      incident !== undefined &&
      oneOf(incident.actionId, NATIVE_CAUSAL_ACTION_IDS)
    const derivedConfidence = deriveAttributionConfidence(
      citedEvidence.flatMap((evidence) =>
        evidence && typeof evidence.kind === 'string' ? [evidence.kind] : [],
      ),
    )

    if (
      !isRecord(revision) ||
      !hasOnlyKeys(revision, [
        'id',
        'sequence',
        'incidentId',
        'publisher',
        'attributedActorId',
        'confidence',
        'evidenceIds',
        'publishedOnServiceDay',
      ]) ||
      !isNonEmptyString(revision.id) ||
      revisionsById.has(revision.id) ||
      !incident ||
      !publisher ||
      !validCausalObserver(publisher, competitorIds) ||
      !isNonEmptyString(revision.attributedActorId) ||
      !hasUniqueStrings(evidenceIds, false) ||
      JSON.stringify(evidenceIds) !==
        JSON.stringify([...(evidenceIds as string[])].sort()) ||
      citedEvidence.some(
        (evidence) =>
          !evidence ||
          evidence.incidentId !== revision.incidentId ||
          !causalObserverCanAccess(publisher, evidence.audiences as unknown[]),
      ) ||
      !isIntegerInRange(
        revision.publishedOnServiceDay,
        Math.max(
          Number(incident.occurredOnServiceDay),
          ...citedEvidence.map((evidence) =>
            Number(evidence?.discoveredOnServiceDay),
          ),
        ),
        currentServiceDay,
      ) ||
      (nativeIncident
        ? derivedConfidence === null ||
          revision.confidence !== derivedConfidence ||
          !nativeRevisionClaimValid(
            revision.confidence,
            publisher,
            revision.attributedActorId,
          )
        : revision.confidence !== 'unavailable-legacy')
    ) {
      return false
    }
    revisionsById.set(revision.id, revision)
  }

  const appliedEffectIds = new Set<string>()
  return value.appliedEffects.every((applied) =>
    validCausalEffectRecord(
      applied,
      currentServiceDay,
      competitorIds,
      incidentsById,
      revisionsById,
      appliedEffectIds,
    ),
  )
}

type LegacyCausalEvidenceV1 = Omit<CausalState['evidence'][number], 'legacySummary'> & {
  summary: string
}

function migrateCausalStateV1(value: unknown): CausalState {
  const legacy = value as {
    nextIncidentSequence: number
    nextEvidenceSequence: number
    nextRevisionSequence: number
    nextEffectSequence: number
    incidents: Array<Record<string, unknown>>
    evidence: LegacyCausalEvidenceV1[]
    publicRevisions: Array<Record<string, unknown>>
    appliedEffects: CausalState['appliedEffects']
  }
  return {
    rulesVersion: 2,
    nextIncidentSequence: legacy.nextIncidentSequence,
    nextEvidenceSequence: legacy.nextEvidenceSequence,
    nextRevisionSequence: legacy.nextRevisionSequence,
    nextEffectSequence: legacy.nextEffectSequence,
    incidents: legacy.incidents.map((incident) => ({
      ...incident,
      actionId:
        incident.kind === 'sabotage'
          ? 'legacy.sabotage'
          : incident.kind === 'competitor-response'
            ? 'legacy.competitor-response'
            : 'legacy.service-disruption',
      parentIncidentId: null,
    })) as CausalState['incidents'],
    evidence: legacy.evidence.map((entry) => {
      const { summary, ...evidence } = entry
      return { ...evidence, legacySummary: summary }
    }),
    publicRevisions: legacy.publicRevisions.map((revision) => ({
      ...revision,
      publisher: isRecord(revision.publisher)
        ? { ...revision.publisher }
        : revision.publisher,
      evidenceIds: Array.isArray(revision.evidenceIds)
        ? [...revision.evidenceIds]
        : revision.evidenceIds,
      confidence: 'unavailable-legacy',
    })) as CausalState['publicRevisions'],
    appliedEffects: legacy.appliedEffects.map((effect) => ({ ...effect })),
  }
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
  const publicIdsAtCapture = [...knownCompetitors.entries()]
    .filter(([id, competitor]) => {
      const profile = competitorProfile(id as CompetitorId)
      if (profile.entry.kind !== 'vacuum') return true
      const launchServiceDay = competitor.launchServiceDay
      return (
        typeof launchServiceDay === 'number' &&
        reviewServiceDay >= launchServiceDay - profile.entry.preparationDays
      )
    })
    .map(([id]) => id)
  const topicIds = [...knownCompetitors.keys()].filter((id) => topics.includes(id))
  if (topicIds.some((id) => !publicIdsAtCapture.includes(id))) return false
  const hasCompetitorTopic = topics.includes('competitor') || topicIds.length > 0
  if (!hasCompetitorTopic) return value.market === null
  if (
    !isRecord(value.market) ||
    !hasOnlyKeys(value.market, ['scope', 'playerShare', 'competitors']) ||
    !oneOf(value.market.scope, ['complete-market', 'topic-subset']) ||
    !isNumberInRange(value.market.playerShare, 0, 100) ||
    !Array.isArray(value.market.competitors)
  ) return false
  const expectedIds = topicIds.length > 0 ? topicIds : publicIdsAtCapture
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
    if (competitor.status === 'prelaunch') return false
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
      'source',
      'rating',
    ]) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.contentId) ||
    !isNonEmptyString(value.authorId) ||
    !isIntegerInRange(value.serviceDay, 1, currentServiceDay) ||
    !oneOf(value.sentiment, ['positive', 'neutral', 'negative', 'prompt']) ||
    !oneOf(value.source, [
      'starting',
      'init-round',
      'monthly-evaluation',
      'interim-standing',
      'timed',
    ]) ||
    !(
      value.rating === null ||
      isIntegerInRange(value.rating, 1, 5)
    ) ||
    // Stars and rated sources travel together in both directions: a rated
    // source without a rating, or a rating on the general stream, is a feed
    // this build never wrote.
    ((value.source === 'monthly-evaluation' ||
      value.source === 'interim-standing') !== (value.rating !== null)) ||
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
  replayBootstrap: ReplayBootstrapMetadata,
  rulesVersion: 1 | 2,
  finalProtocolVersion: CommandProtocolVersion,
): boolean {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'commandProtocol',
      'replayBootstrap',
      'campaignSeed',
      'serviceDay',
      'commandSequence',
      'clock',
      'tutorial',
      'resourceIntrusion',
      'resources',
      'suspicion',
      'reputation',
      'evaluation',
      'market',
      'reviews',
      'causality',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
      'commandLog',
      'eventLog',
    ]) ||
    JSON.stringify(value.commandProtocol) !==
      JSON.stringify(commandProtocol) ||
    !validReplayBootstrapMetadata(replayBootstrap) ||
    JSON.stringify(value.replayBootstrap) !==
      JSON.stringify(replayBootstrap) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.serviceDay, 1) ||
    !isIntegerInRange(value.commandSequence, 0) ||
    !validCommandProtocol(commandProtocol, Number(value.commandSequence), {
      requireCurrent: true,
      currentVersion: finalProtocolVersion,
    }) ||
    commandProtocol.segments[commandProtocol.segments.length - 1]?.version !==
      finalProtocolVersion ||
    !validTutorialProgress(value.tutorial) ||
    !validResourceIntrusionProgress(value.resourceIntrusion) ||
    !isNumberInRange(value.suspicion, 0, 100) ||
    !isNumberInRange(value.reputation, 0, 100) ||
    !validResources(value.resources, rulesVersion)
  ) return false

  const clock = value.clock
  const evaluation = value.evaluation
  const market = value.market
  const reviews = value.reviews
  const causality = value.causality
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
    !validCausalStateV2(
      causality,
      Number(value.serviceDay),
      competitorIds,
    )
  ) return false

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
    !validSabotageCharges(hacking.sabotageCharges, rulesVersion) ||
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
    !isIntegerInRange(story.memoryLeakStage, 0, 5) ||
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
    }, {
      requireCurrent: true,
      currentVersion: finalProtocolVersion,
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

  return replayBootstrapSnapshotCoherent(
    commandProtocol,
    (reviews.feed as unknown) as CampaignState['reviews']['feed'],
    value.eventLog as GameEvent[],
    replayBootstrap,
  )
}

function validResourceIntrusionProgress(value: unknown): boolean {
  if (
    !(
    isRecord(value) &&
    hasOnlyKeys(value, [
      'successfulCoreDeposits',
      'completedRounds',
      'lastOutcome',
      'communications',
    ]) &&
    isIntegerInRange(value.successfulCoreDeposits, 0) &&
    isIntegerInRange(value.completedRounds, 0) &&
    (value.lastOutcome === null ||
      value.lastOutcome === 'victory' ||
      value.lastOutcome === 'defeat') &&
    Array.isArray(value.communications)
    )
  ) return false

  const communications = value.communications as unknown[]
  if (
    communications.length > CAMPAIGN_COMMUNICATION_DEFINITIONS.length ||
    new Set(communications.map((entry) =>
      isRecord(entry) ? entry.id : null,
    )).size !== communications.length
  ) return false

  return communications.every((entry, sequence) => {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, [
        'id',
        'sequence',
        'channel',
        'senderId',
        'senderName',
        'portraitSrc',
        'serviceDay',
        'message',
        'popupPolicy',
        'read',
      ]) ||
      entry.sequence !== sequence ||
      !isIntegerInRange(entry.serviceDay, 1) ||
      typeof entry.read !== 'boolean'
    ) return false
    const definition = CAMPAIGN_COMMUNICATION_DEFINITIONS.find(
      ({ id }) => id === entry.id,
    )
    return Boolean(
      definition &&
      entry.channel === definition.channel &&
      entry.senderId === definition.senderId &&
      entry.senderName === definition.senderName &&
      entry.portraitSrc === definition.portraitSrc &&
      entry.message === definition.message &&
      entry.popupPolicy === definition.popupPolicy,
    )
  })
}

function migratedResourceIntrusionProgress(): CampaignState['resourceIntrusion'] {
  return {
    successfulCoreDeposits: 0,
    completedRounds: 0,
    lastOutcome: null,
    communications: [],
  }
}

function validPortableCheckpointV11(
  value: unknown,
): value is PortableCheckpointV11 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'campaignSeed',
      'serviceDay',
      'commandSequence',
      'clock',
      'tutorial',
      'resourceIntrusion',
      'resources',
      'suspicion',
      'reputation',
      'evaluation',
      'market',
      'reviews',
      'causality',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
    ]) &&
    validTutorialProgress(value.tutorial) &&
    validResourceIntrusionProgress(value.resourceIntrusion)
  )
}

function validLegacyResourceIntrusionProgressV10(value: unknown): value is {
  successfulCoreDeposits: number
} {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['successfulCoreDeposits']) &&
    isIntegerInRange(value.successfulCoreDeposits, 0)
  )
}

function validPortableCheckpointV10(
  value: unknown,
): value is PortableCheckpointV10 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'campaignSeed',
      'serviceDay',
      'commandSequence',
      'clock',
      'tutorial',
      'resourceIntrusion',
      'resources',
      'suspicion',
      'reputation',
      'evaluation',
      'market',
      'reviews',
      'causality',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
    ]) &&
    validTutorialProgress(value.tutorial) &&
    validLegacyResourceIntrusionProgressV10(value.resourceIntrusion)
  )
}

function validPortableCheckpointV9(
  value: unknown,
): value is PortableCheckpointV9 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'campaignSeed',
      'serviceDay',
      'commandSequence',
      'clock',
      'tutorial',
      'resources',
      'suspicion',
      'reputation',
      'evaluation',
      'market',
      'reviews',
      'causality',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
    ]) &&
    validTutorialProgress(value.tutorial)
  )
}

function validPortableCheckpointV8(
  value: unknown,
): value is PortableCheckpointV8 {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
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
      'causality',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
    ])
  )
}

function inferLegacyReplayBootstrap(
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6,
  legacyCommandProtocol: LegacyCommandProtocolMetadata,
  value: Record<string, unknown>,
): ReplayBootstrapMetadata | null {
  if (
    !isRecord(value.reviews) ||
    !Array.isArray(value.reviews.feed) ||
    !Array.isArray(value.eventLog)
  ) {
    return null
  }
  const feed = value.reviews.feed as CampaignState['reviews']['feed']
  const openingVersion = replayOpeningVersion(value.eventLog[0] as GameEvent)

  if (formatVersion <= 4) {
    const inferredOpeningVersion =
      formatVersion === 1 ||
      legacyCommandProtocol.legacyCommandCount > 0 ||
      openingVersion === 1
        ? 1
        : 2
    const prefixCount = legacyReviewPrefixExtent(feed)
    return openingVersion === inferredOpeningVersion && prefixCount === feed.length
      ? {
          openingVersion: inferredOpeningVersion,
          legacyReviewPrefixCount: feed.length,
        }
      : null
  }

  if (
    openingVersion === null ||
    (legacyCommandProtocol.legacyCommandCount > 0 &&
      openingVersion !== 1)
  ) {
    return null
  }
  const prefixCount = legacyReviewPrefixExtent(feed)
  return prefixCount === null
    ? null
    : { openingVersion, legacyReviewPrefixCount: prefixCount }
}

function migrateFixedCellCampaignState(
  value: unknown,
  sourceCommandProtocol: CommandProtocolMetadata,
  replayBootstrap: ReplayBootstrapMetadata,
  sourceFinalProtocolVersion: CommandProtocolVersion,
  targetCommandProtocol: CommandProtocolMetadata,
): CampaignState | null {
  const tutorialMigratedValue = isRecord(value)
    ? {
        ...value,
        tutorial: createMigratedTutorialProgress(),
        resourceIntrusion: migratedResourceIntrusionProgress(),
      }
    : value
  const rosterMigratedValue = withLegacyReviewMetadata(
    migrateCompetitorRoster(tutorialMigratedValue),
  )
  if (
    !validCampaignState(
      rosterMigratedValue,
      sourceCommandProtocol,
      replayBootstrap,
      1,
      sourceFinalProtocolVersion,
    ) ||
    !isRecord(rosterMigratedValue) ||
    !isRecord(rosterMigratedValue.resources)
  ) {
    return null
  }

  const taggedFixedCellState = {
    ...rosterMigratedValue,
    commandProtocol: targetCommandProtocol,
    resources: {
      ...rosterMigratedValue.resources,
      rulesVersion: 1,
    },
  } as unknown as CampaignState
  const migrated = migrateResourcesToCurrentRules(taggedFixedCellState)

  const validMigrated = validCampaignState(
    migrated,
    targetCommandProtocol,
    replayBootstrap,
    2,
    CURRENT_COMMAND_PROTOCOL_VERSION,
  )
  return validMigrated ? migrated : null
}

function migrateLegacyRuntimeState(
  value: unknown,
  legacyCommandProtocol: LegacyCommandProtocolMetadata,
  commandProtocol: CommandProtocolMetadata,
  replayBootstrap: ReplayBootstrapMetadata,
  causality: CausalState,
): CampaignState | null {
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
      'causality',
      'hacking',
      'audit',
      'bombs',
      'story',
      'activeEvent',
      'eventQueue',
      'commandLog',
      'eventLog',
    ]) ||
    value.saveVersion !== legacyCommandProtocol.version ||
    value.legacyCommandCount !== legacyCommandProtocol.legacyCommandCount
  ) {
    return null
  }

  const runtimeFields = { ...value }
  delete runtimeFields.saveVersion
  delete runtimeFields.legacyCommandCount
  delete runtimeFields.causality
  const candidate = {
    ...runtimeFields,
    commandProtocol,
    replayBootstrap: cloneReplayBootstrap(replayBootstrap),
    causality,
  }
  return migrateFixedCellCampaignState(
    candidate,
    commandProtocol,
    replayBootstrap,
    CURRENT_COMMAND_PROTOCOL_VERSION,
    commandProtocol,
  )
}

function contentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function portableCheckpointHash(
  version: unknown,
  commandProtocol: unknown,
  replayBootstrap: unknown,
  checkpoint: unknown,
): string {
  const integrityPayload =
    Number.isInteger(version) && Number(version) >= 7
      ? { commandProtocol, replayBootstrap, state: checkpoint }
      : checkpoint
  return contentHash(JSON.stringify(integrityPayload))
}

function corrupt(message = '저장 데이터가 손상되었거나 필요한 항목이 없습니다.'): DecodeSaveResult {
  return { ok: false, reason: 'CORRUPT_SAVE', message }
}

export function encodeSave(
  state: CampaignState,
  savedAt = new Date().toISOString(),
): string {
  const serializedState = portableCheckpoint(state)
  const commandProtocol: CommandProtocolMetadata = {
    segments: state.commandProtocol.segments.map((segment) => ({
      ...segment,
    })),
  }
  const replayBootstrap = cloneReplayBootstrap(state.replayBootstrap)
  const commandChunks = journalChunks(state.commandLog).map((chunk) => [...chunk])
  const eventChunks = journalChunks(state.eventLog).map((chunk) => [...chunk])
  const envelope: PortableSaveV11 = {
    version: SAVE_FORMAT_VERSION,
    commandProtocol,
    replayBootstrap,
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
      checkpointHash: portableCheckpointHash(
        SAVE_FORMAT_VERSION,
        commandProtocol,
        replayBootstrap,
        serializedState,
      ),
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
): PortableCheckpointV11 {
  return {
    campaignSeed: state.campaignSeed,
    serviceDay: state.serviceDay,
    commandSequence: state.commandSequence,
    clock: state.clock,
    tutorial: state.tutorial,
    resourceIntrusion: state.resourceIntrusion,
    resources: state.resources,
    suspicion: state.suspicion,
    reputation: state.reputation,
    evaluation: state.evaluation,
    market: state.market,
    reviews: state.reviews,
    causality: state.causality,
    hacking: state.hacking,
    audit: state.audit,
    bombs: state.bombs,
    story: state.story,
    activeEvent: state.activeEvent,
    eventQueue: state.eventQueue,
  }
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

interface PortableDecodedV11 {
  version: 11
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  commandSequence: number
  state: CampaignState
  commands: CommandLogEntry[]
  events: GameEvent[]
}

interface PortableDecodedV10 {
  version: 10
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  commandSequence: number
  state: CampaignState
  commands: CommandLogEntry[]
  events: GameEvent[]
}

interface PortableDecodedV9 {
  version: 9
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  commandSequence: number
  state: CampaignState
  commands: CommandLogEntry[]
  events: GameEvent[]
}

interface PortableDecodedV8 {
  version: 8
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  commandSequence: number
  state: CampaignState
  commands: CommandLogEntry[]
  events: GameEvent[]
}

interface PortableDecodedV7 {
  version: 7
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  commandSequence: number
  state: CampaignState
  commands: CommandLogEntry[]
  events: GameEvent[]
}

interface LegacyDecodedSave {
  version: 1 | 2 | 3 | 4 | 5 | 6
  commandProtocol: CommandProtocolMetadata
  replayBootstrap: ReplayBootstrapMetadata
  savedAt: string
  campaignSeed: string
  commandSequence: number
  state: CampaignState
  commands: CommandLogEntry[]
  events: GameEvent[]
}

function validPortableIntegrity(value: Record<string, unknown>): boolean {
  if (
    !isRecord(value.journals) ||
    !hasOnlyKeys(value.journals, ['commands', 'events']) ||
    !validPortableJournal(value.journals.commands) ||
    !validPortableJournal(value.journals.events) ||
    !isRecord(value.state) ||
    !isRecord(value.integrity) ||
    !hasOnlyKeys(value.integrity, [
      'checkpointHash',
      'commandChunkHashes',
      'eventChunkHashes',
    ]) ||
    !isNonEmptyString(value.integrity.checkpointHash) ||
    !Array.isArray(value.integrity.commandChunkHashes) ||
    !value.integrity.commandChunkHashes.every(isNonEmptyString) ||
    !Array.isArray(value.integrity.eventChunkHashes) ||
    !value.integrity.eventChunkHashes.every(isNonEmptyString) ||
    value.integrity.checkpointHash !==
      portableCheckpointHash(
        value.version,
        value.commandProtocol,
        value.replayBootstrap,
        value.state,
      ) ||
    JSON.stringify(value.integrity.commandChunkHashes) !==
      JSON.stringify(
        value.journals.commands.chunks.map((chunk) =>
          contentHash(JSON.stringify(chunk)),
        ),
      ) ||
    JSON.stringify(value.integrity.eventChunkHashes) !==
      JSON.stringify(
        value.journals.events.chunks.map((chunk) =>
          contentHash(JSON.stringify(chunk)),
        ),
      )
  ) {
    return false
  }
  return true
}

function decodePortableSaveV11(value: unknown): PortableDecodedV11 | null {
  if (
    !isRecord(value) ||
    value.version !== SAVE_FORMAT_VERSION ||
    !hasOnlyKeys(value, [
      'version',
      'commandProtocol',
      'replayBootstrap',
      'savedAt',
      'campaignSeed',
      'state',
      'commandSequence',
      'journals',
      'integrity',
    ]) ||
    !validPortableIntegrity(value) ||
    !validReplayBootstrapMetadata(value.replayBootstrap) ||
    !validPortableCheckpointV11(value.state) ||
    !validSavedAt(value.savedAt) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.commandSequence, 0)
  ) {
    return null
  }

  const journals = value.journals as {
    commands: PortableJournal<unknown>
    events: PortableJournal<unknown>
  }
  const commands = flattenPortableJournal(journals.commands)
  const events = flattenPortableJournal(journals.events)
  if (value.commandSequence !== commands.length) return null
  const commandProtocol = promoteCommandProtocol(
    value.commandProtocol,
    commands.length,
    EXPANSION_COMMAND_PROTOCOL_VERSION,
  )
  if (!commandProtocol) return null
  const replayBootstrap = value.replayBootstrap
  const rosterMigratedCheckpoint = migrateCompetitorRoster(value.state)
  if (!isRecord(rosterMigratedCheckpoint)) return null
  const candidate = {
    ...rosterMigratedCheckpoint,
    commandProtocol,
    replayBootstrap,
    commandLog: commands,
    eventLog: events,
  } as unknown as CampaignState
  if (
    !validCampaignState(
      candidate,
      commandProtocol,
      replayBootstrap,
      2,
      CURRENT_COMMAND_PROTOCOL_VERSION,
    ) ||
    candidate.campaignSeed !== value.campaignSeed ||
    candidate.commandSequence !== value.commandSequence
  ) {
    return null
  }

  return {
    version: 11,
    commandProtocol,
    replayBootstrap: cloneReplayBootstrap(replayBootstrap),
    savedAt: value.savedAt,
    campaignSeed: value.campaignSeed,
    commandSequence: value.commandSequence,
    state: candidate as unknown as CampaignState,
    commands: commands as CommandLogEntry[],
    events: events as GameEvent[],
  }
}

function promoteCommandProtocol(
  value: unknown,
  commandCount: number,
  sourceVersion: CommandProtocolVersion,
): CommandProtocolMetadata | null {
  if (
    validCommandProtocol(value, commandCount, {
      requireCurrent: true,
      currentVersion: CURRENT_COMMAND_PROTOCOL_VERSION,
    }) &&
    value.segments[value.segments.length - 1]?.version ===
      CURRENT_COMMAND_PROTOCOL_VERSION
  ) {
    return {
      segments: value.segments.map((segment) => ({ ...segment })),
    }
  }

  if (
    !validCommandProtocol(value, commandCount, {
      requireCurrent: true,
      currentVersion: sourceVersion,
    }) ||
    value.segments[value.segments.length - 1]?.version !==
      sourceVersion
  ) {
    return null
  }

  const nextSequence = commandCount + 1
  const finalSegment = value.segments[value.segments.length - 1]
  const promoted =
    finalSegment.startsAtSequence === nextSequence
      ? {
          segments: [
            ...value.segments.slice(0, -1).map((segment) => ({ ...segment })),
            {
              version: CURRENT_COMMAND_PROTOCOL_VERSION,
              startsAtSequence: nextSequence,
            },
          ],
        }
      : appendCommandProtocolSegment(
          value,
          {
            version: CURRENT_COMMAND_PROTOCOL_VERSION,
            startsAtSequence: nextSequence,
          },
          nextSequence,
        )

  return promoted &&
    validCommandProtocol(promoted, commandCount, { requireCurrent: true })
    ? promoted
    : null
}

function promoteResourceIntrusionCommandProtocol(
  value: unknown,
  commandCount: number,
): CommandProtocolMetadata | null {
  return promoteCommandProtocol(
    value,
    commandCount,
    RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION,
  )
}

function decodePortableSaveV10(value: unknown): PortableDecodedV10 | null {
  if (
    !isRecord(value) ||
    value.version !== 10 ||
    !hasOnlyKeys(value, [
      'version',
      'commandProtocol',
      'replayBootstrap',
      'savedAt',
      'campaignSeed',
      'state',
      'commandSequence',
      'journals',
      'integrity',
    ]) ||
    !validPortableIntegrity(value) ||
    !validReplayBootstrapMetadata(value.replayBootstrap) ||
    !validPortableCheckpointV10(value.state) ||
    !validSavedAt(value.savedAt) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.commandSequence, 0)
  ) {
    return null
  }

  const journals = value.journals as {
    commands: PortableJournal<unknown>
    events: PortableJournal<unknown>
  }
  const commands = flattenPortableJournal(journals.commands)
  const events = flattenPortableJournal(journals.events)
  if (value.commandSequence !== commands.length) return null

  const commandProtocol = promoteResourceIntrusionCommandProtocol(
    value.commandProtocol,
    commands.length,
  )
  if (!commandProtocol) return null
  const replayBootstrap = value.replayBootstrap
  const rosterMigratedCheckpoint = withLegacyReviewMetadata(
    migrateCompetitorRoster(value.state),
  )
  if (!isRecord(rosterMigratedCheckpoint)) return null
  const legacyProgress = value.state.resourceIntrusion
  const candidate = {
    ...rosterMigratedCheckpoint,
    resourceIntrusion: {
      successfulCoreDeposits: legacyProgress.successfulCoreDeposits,
      completedRounds: 0,
      lastOutcome: null,
      communications: [],
    },
    commandProtocol,
    replayBootstrap,
    commandLog: commands,
    eventLog: events,
  } as unknown as CampaignState
  if (
    !validCampaignState(
      candidate,
      commandProtocol,
      replayBootstrap,
      2,
      CURRENT_COMMAND_PROTOCOL_VERSION,
    ) ||
    candidate.campaignSeed !== value.campaignSeed ||
    candidate.commandSequence !== value.commandSequence
  ) {
    return null
  }

  return {
    version: 10,
    commandProtocol,
    replayBootstrap: cloneReplayBootstrap(replayBootstrap),
    savedAt: value.savedAt,
    campaignSeed: value.campaignSeed,
    commandSequence: value.commandSequence,
    state: candidate,
    commands: commands as CommandLogEntry[],
    events: events as GameEvent[],
  }
}

function decodePortableSaveV9(value: unknown): PortableDecodedV9 | null {
  if (
    !isRecord(value) ||
    value.version !== 9 ||
    !hasOnlyKeys(value, [
      'version',
      'commandProtocol',
      'replayBootstrap',
      'savedAt',
      'campaignSeed',
      'state',
      'commandSequence',
      'journals',
      'integrity',
    ]) ||
    !validPortableIntegrity(value) ||
    !validReplayBootstrapMetadata(value.replayBootstrap) ||
    !validPortableCheckpointV9(value.state) ||
    !validSavedAt(value.savedAt) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.commandSequence, 0)
  ) {
    return null
  }

  const journals = value.journals as {
    commands: PortableJournal<unknown>
    events: PortableJournal<unknown>
  }
  const commands = flattenPortableJournal(journals.commands)
  const events = flattenPortableJournal(journals.events)
  if (value.commandSequence !== commands.length) return null
  const commandProtocol = promoteResourceIntrusionCommandProtocol(
    value.commandProtocol,
    commands.length,
  )
  if (!commandProtocol) return null
  const replayBootstrap = value.replayBootstrap
  const rosterMigratedCheckpoint = withLegacyReviewMetadata(
    migrateCompetitorRoster(value.state),
  )
  if (!isRecord(rosterMigratedCheckpoint)) return null
  const candidate = {
    ...rosterMigratedCheckpoint,
    resourceIntrusion: migratedResourceIntrusionProgress(),
    commandProtocol,
    replayBootstrap,
    commandLog: commands,
    eventLog: events,
  } as unknown as CampaignState
  if (
    !validCampaignState(
      candidate,
      commandProtocol,
      replayBootstrap,
      2,
      CURRENT_COMMAND_PROTOCOL_VERSION,
    ) ||
    candidate.campaignSeed !== value.campaignSeed ||
    candidate.commandSequence !== value.commandSequence
  ) {
    return null
  }

  return {
    version: 9,
    commandProtocol,
    replayBootstrap: cloneReplayBootstrap(replayBootstrap),
    savedAt: value.savedAt,
    campaignSeed: value.campaignSeed,
    commandSequence: value.commandSequence,
    state: candidate,
    commands: commands as CommandLogEntry[],
    events: events as GameEvent[],
  }
}

function decodePortableSaveV8(value: unknown): PortableDecodedV8 | null {
  if (
    !isRecord(value) ||
    value.version !== 8 ||
    !hasOnlyKeys(value, [
      'version',
      'commandProtocol',
      'replayBootstrap',
      'savedAt',
      'campaignSeed',
      'state',
      'commandSequence',
      'journals',
      'integrity',
    ]) ||
    !validPortableIntegrity(value) ||
    !validReplayBootstrapMetadata(value.replayBootstrap) ||
    !validPortableCheckpointV8(value.state) ||
    !validSavedAt(value.savedAt) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.commandSequence, 0)
  ) {
    return null
  }

  const journals = value.journals as {
    commands: PortableJournal<unknown>
    events: PortableJournal<unknown>
  }
  const commands = flattenPortableJournal(journals.commands)
  const events = flattenPortableJournal(journals.events)
  if (value.commandSequence !== commands.length) return null
  const commandProtocol = promoteResourceIntrusionCommandProtocol(
    value.commandProtocol,
    commands.length,
  )
  if (!commandProtocol) return null
  const replayBootstrap = value.replayBootstrap
  const rosterMigratedCheckpoint = withLegacyReviewMetadata(
    migrateCompetitorRoster(value.state),
  )
  if (!isRecord(rosterMigratedCheckpoint)) return null
  const candidate = {
    ...rosterMigratedCheckpoint,
    tutorial: createMigratedTutorialProgress(),
    resourceIntrusion: migratedResourceIntrusionProgress(),
    commandProtocol,
    replayBootstrap,
    commandLog: commands,
    eventLog: events,
  } as unknown as CampaignState
  if (
    !validCampaignState(
      candidate,
      commandProtocol,
      replayBootstrap,
      2,
      CURRENT_COMMAND_PROTOCOL_VERSION,
    ) ||
    candidate.campaignSeed !== value.campaignSeed ||
    candidate.commandSequence !== value.commandSequence
  ) {
    return null
  }

  return {
    version: 8,
    commandProtocol,
    replayBootstrap: cloneReplayBootstrap(replayBootstrap),
    savedAt: value.savedAt,
    campaignSeed: value.campaignSeed,
    commandSequence: value.commandSequence,
    state: candidate,
    commands: commands as CommandLogEntry[],
    events: events as GameEvent[],
  }
}

function promoteV7CommandProtocol(
  value: unknown,
  commandCount: number,
): CommandProtocolMetadata | null {
  if (
    !validCommandProtocol(value, commandCount, {
      requireCurrent: true,
      currentVersion: CAUSAL_COMMAND_PROTOCOL_VERSION,
    }) ||
    value.segments[value.segments.length - 1]?.version !==
      CAUSAL_COMMAND_PROTOCOL_VERSION
  ) {
    return null
  }

  const nextSequence = commandCount + 1
  const finalSegment = value.segments[value.segments.length - 1]
  const promoted =
    finalSegment.startsAtSequence === nextSequence
      ? {
          segments: [
            ...value.segments.slice(0, -1).map((segment) => ({ ...segment })),
            {
              version: CURRENT_COMMAND_PROTOCOL_VERSION,
              startsAtSequence: nextSequence,
            },
          ],
        }
      : appendCommandProtocolSegment(
          value,
          {
            version: CURRENT_COMMAND_PROTOCOL_VERSION,
            startsAtSequence: nextSequence,
          },
          nextSequence,
        )

  return promoted &&
    validCommandProtocol(promoted, commandCount, { requireCurrent: true })
    ? promoted
    : null
}

function decodePortableSaveV7(value: unknown): PortableDecodedV7 | null {
  if (
    !isRecord(value) ||
    value.version !== 7 ||
    !hasOnlyKeys(value, [
      'version',
      'commandProtocol',
      'replayBootstrap',
      'savedAt',
      'campaignSeed',
      'state',
      'commandSequence',
      'journals',
      'integrity',
    ]) ||
    !validPortableIntegrity(value) ||
    !validReplayBootstrapMetadata(value.replayBootstrap) ||
    !validPortableCheckpointV8(value.state) ||
    !validSavedAt(value.savedAt) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.commandSequence, 0)
  ) {
    return null
  }

  const journals = value.journals as {
    commands: PortableJournal<unknown>
    events: PortableJournal<unknown>
  }
  const commands = flattenPortableJournal(journals.commands)
  const events = flattenPortableJournal(journals.events)
  if (value.commandSequence !== commands.length) {
    return null
  }

  const sourceCommandProtocol = value.commandProtocol
  if (
    !validCommandProtocol(sourceCommandProtocol, commands.length, {
      requireCurrent: true,
      currentVersion: CAUSAL_COMMAND_PROTOCOL_VERSION,
    }) ||
    sourceCommandProtocol.segments[sourceCommandProtocol.segments.length - 1]
      ?.version !== CAUSAL_COMMAND_PROTOCOL_VERSION
  ) {
    return null
  }
  const replayBootstrap = value.replayBootstrap
  const fixedCellCandidate = {
    ...value.state,
    commandProtocol: sourceCommandProtocol,
    replayBootstrap,
    commandLog: commands,
    eventLog: events,
  }
  const commandProtocol = promoteV7CommandProtocol(
    sourceCommandProtocol,
    commands.length,
  )
  if (!commandProtocol) {
    return null
  }

  const state = migrateFixedCellCampaignState(
    fixedCellCandidate,
    sourceCommandProtocol,
    replayBootstrap,
    CAUSAL_COMMAND_PROTOCOL_VERSION,
    commandProtocol,
  )
  if (
    !state ||
    state.campaignSeed !== value.campaignSeed ||
    state.commandSequence !== value.commandSequence
  ) {
    return null
  }

  return {
    version: 7,
    commandProtocol,
    replayBootstrap: cloneReplayBootstrap(replayBootstrap),
    savedAt: value.savedAt,
    campaignSeed: value.campaignSeed,
    commandSequence: value.commandSequence,
    state,
    commands: commands as CommandLogEntry[],
    events: events as GameEvent[],
  }
}

function decodeLegacyPortableSave(value: unknown): LegacyDecodedSave | null {
  if (
    !isRecord(value) ||
    !isIntegerInRange(
      value.version,
      MINIMUM_SAVE_FORMAT_VERSION,
      LAST_LEGACY_SAVE_FORMAT_VERSION,
    ) ||
    !validSavedAt(value.savedAt) ||
    !isNonEmptyString(value.campaignSeed) ||
    !isIntegerInRange(value.commandSequence, 0)
  ) {
    return null
  }

  const formatVersion = value.version as 1 | 2 | 3 | 4 | 5 | 6
  let legacyCommandProtocol: LegacyCommandProtocolMetadata
  let rawState: unknown
  let commands: unknown
  let events: unknown

  if (formatVersion >= 3) {
    if (
      !hasOnlyKeys(value, [
        'version',
        'commandProtocol',
        'savedAt',
        'campaignSeed',
        'state',
        'commandSequence',
        'journals',
        'integrity',
      ]) ||
      !isRecord(value.commandProtocol) ||
      !hasOnlyKeys(value.commandProtocol, ['version', 'legacyCommandCount']) ||
      (value.commandProtocol.version !== LEGACY_COMMAND_PROTOCOL_VERSION &&
        value.commandProtocol.version !== PREVIOUS_COMMAND_PROTOCOL_VERSION) ||
      !Number.isInteger(value.commandProtocol.legacyCommandCount) ||
      !validPortableIntegrity(value) ||
      !isRecord(value.state) ||
      'commandLog' in value.state ||
      'eventLog' in value.state
    ) {
      return null
    }
    const journals = value.journals as {
      commands: PortableJournal<unknown>
      events: PortableJournal<unknown>
    }
    commands = flattenPortableJournal(journals.commands)
    events = flattenPortableJournal(journals.events)
    rawState = { ...value.state, commandLog: commands, eventLog: events }
    legacyCommandProtocol = {
      version: value.commandProtocol.version,
      legacyCommandCount: Number(value.commandProtocol.legacyCommandCount),
    }
  } else if (formatVersion === LEGACY_COMMAND_PROTOCOL_VERSION) {
    if (
      !hasOnlyKeys(value, [
        'version',
        'savedAt',
        'campaignSeed',
        'state',
        'commandSequence',
        'commands',
        'events',
      ]) ||
      !Array.isArray(value.commands)
    ) {
      return null
    }
    commands = value.commands
    events = value.events
    rawState = value.state
    legacyCommandProtocol = {
      version: LEGACY_COMMAND_PROTOCOL_VERSION,
      legacyCommandCount: value.commands.length,
    }
  } else {
    if (
      !hasOnlyKeys(value, [
        'version',
        'commandProtocol',
        'savedAt',
        'campaignSeed',
        'state',
        'commandSequence',
        'commands',
        'events',
      ]) ||
      !isRecord(value.commandProtocol) ||
      !hasOnlyKeys(value.commandProtocol, ['version', 'legacyCommandCount']) ||
      value.commandProtocol.version !== PREVIOUS_COMMAND_PROTOCOL_VERSION ||
      !Number.isInteger(value.commandProtocol.legacyCommandCount)
    ) {
      return null
    }
    commands = value.commands
    events = value.events
    rawState = value.state
    legacyCommandProtocol = {
      version: PREVIOUS_COMMAND_PROTOCOL_VERSION,
      legacyCommandCount: Number(value.commandProtocol.legacyCommandCount),
    }
  }

  if (
    !Array.isArray(commands) ||
    !Array.isArray(events) ||
    value.commandSequence !== commands.length ||
    (formatVersion < 5 && !hasExactLegacyReviewShape(rawState)) ||
    (formatVersion < 6 &&
      isRecord(rawState) &&
      Object.hasOwn(rawState, 'causality'))
  ) {
    return null
  }

  const commandProtocol = migrateLegacyCommandProtocol(
    legacyCommandProtocol,
    commands.length,
  )
  if (
    !commandProtocol ||
    !validCommandLog(commands, commandProtocol) ||
    !events.every(validEvent) ||
    !isRecord(rawState) ||
    !Array.isArray(rawState.eventLog) ||
    JSON.stringify(events) !== JSON.stringify(rawState.eventLog)
  ) {
    return null
  }

  const featureMigratedState =
    formatVersion < 5
      ? migrateLegacyCampaignState(rawState, legacyCommandProtocol)
      : rawState
  if (!isRecord(featureMigratedState)) return null
  const rosterMigratedFeatureState = withLegacyReviewMetadata(
    migrateCompetitorRoster(featureMigratedState),
  )
  if (!isRecord(rosterMigratedFeatureState)) return null

  let causality: CausalState
  if (formatVersion === 6) {
    const market = rosterMigratedFeatureState.market
    const competitors = isRecord(market) && Array.isArray(market.competitors)
      ? market.competitors
      : []
    const competitorIds = competitors.flatMap((competitor) =>
      isRecord(competitor) && isNonEmptyString(competitor.id)
        ? [competitor.id]
        : [],
    )
    if (
      !isIntegerInRange(rosterMigratedFeatureState.serviceDay, 1) ||
      competitorIds.length !== COMPETITOR_IDS.length ||
      !validLegacyCausalStateV1(
        rosterMigratedFeatureState.causality,
        Number(rosterMigratedFeatureState.serviceDay),
        competitorIds,
      )
    ) {
      return null
    }
    causality = migrateCausalStateV1(rosterMigratedFeatureState.causality)
  } else {
    causality = createEmptyCausalState()
  }

  const legacyStateWithCausality = {
    ...rosterMigratedFeatureState,
    causality:
      formatVersion === 6 ? rosterMigratedFeatureState.causality : causality,
  }
  const replayBootstrap = inferLegacyReplayBootstrap(
    formatVersion,
    legacyCommandProtocol,
    legacyStateWithCausality,
  )
  if (!replayBootstrap) return null
  const state = migrateLegacyRuntimeState(
    legacyStateWithCausality,
    legacyCommandProtocol,
    commandProtocol,
    replayBootstrap,
    causality,
  )
  if (
    !state ||
    value.campaignSeed !== state.campaignSeed ||
    value.commandSequence !== state.commandSequence ||
    JSON.stringify(commands) !== JSON.stringify(state.commandLog)
  ) {
    return null
  }

  return {
    version: formatVersion,
    commandProtocol,
    replayBootstrap,
    savedAt: value.savedAt,
    campaignSeed: value.campaignSeed,
    commandSequence: value.commandSequence,
    state,
    commands: commands as CommandLogEntry[],
    events: events as GameEvent[],
  }
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
  if (
    Number(parsed.version) < MINIMUM_SAVE_FORMAT_VERSION ||
    Number(parsed.version) > SAVE_FORMAT_VERSION
  ) {
    return {
      ok: false,
      reason: 'INCOMPATIBLE_VERSION',
      message: `저장 버전 ${String(parsed.version)}은 현재 버전 ${SAVE_FORMAT_VERSION}과 호환되지 않습니다.`,
      foundVersion: parsed.version as number,
      supportedVersion: SAVE_FORMAT_VERSION,
    }
  }
  const decoded =
    parsed.version === SAVE_FORMAT_VERSION
      ? decodePortableSaveV11(parsed)
      : parsed.version === 10
        ? decodePortableSaveV10(parsed)
        : parsed.version === 9
          ? decodePortableSaveV9(parsed)
          : parsed.version === 8
            ? decodePortableSaveV8(parsed)
            : parsed.version === 7
              ? decodePortableSaveV7(parsed)
              : decodeLegacyPortableSave(parsed)
  if (!decoded) return corrupt()

  const normalizedState = normalizeCurrentTallowMarket(decoded.state)
  const plainState = normalizedState as unknown as Record<string, unknown>
  const runtimeState = {
    ...plainState,
    commandLog: createJournal(plainState.commandLog as CommandLogEntry[]),
    eventLog: createJournal(plainState.eventLog as GameEvent[]),
  } as unknown as CampaignState
  return {
    ok: true,
    envelope: {
      version: decoded.version,
      savedAt: decoded.savedAt,
      campaignSeed: decoded.campaignSeed,
      commandSequence: decoded.commandSequence,
      commandProtocol: decoded.commandProtocol,
      replayBootstrap: cloneReplayBootstrap(decoded.replayBootstrap),
      state: runtimeState,
      commands: journalToArray(runtimeState.commandLog),
      events: journalToArray(runtimeState.eventLog),
    },
  }
}

/** @internal Shared only with the browser storage adapter. */
export const persistenceCodecInternals = {
  corrupt,
  contentHash,
  hasOnlyKeys,
  isIntegerInRange,
  isNonEmptyString,
  isRecord,
  portableCheckpoint,
  portableCheckpointHash,
}

export function exportSeed(state: CampaignState): string {
  return state.campaignSeed
}

export function replayCommands(
  seed: string,
  commands: readonly GameCommand[],
  metadata: ReplayMetadata,
): ReplayResult {
  const invalidProtocolBoundary = (
    state: CampaignState,
    commandIndex: number,
  ): ReplayResult => ({
    ok: false,
    state,
    commandIndex,
    reason: 'INVALID_PROTOCOL_BOUNDARY',
  })
  const fallback = createCampaign(seed)
  const invalidReplayBootstrap = (
    state: CampaignState,
    commandIndex: number,
  ): ReplayResult => ({
    ok: false,
    state,
    commandIndex,
    reason: 'INVALID_REPLAY_BOOTSTRAP',
  })

  if (
    !isRecord(metadata) ||
    !hasOnlyKeys(metadata, ['commandProtocol', 'replayBootstrap']) ||
    !validReplayBootstrapMetadata(metadata.replayBootstrap)
  ) {
    return invalidReplayBootstrap(fallback, 0)
  }
  const { commandProtocol, replayBootstrap } = metadata

  if (
    !validCommandProtocol(commandProtocol, commands.length, {
      requireCurrent: true,
    })
  ) {
    return invalidProtocolBoundary(fallback, 0)
  }

  const segments = commandProtocol.segments
  const firstSegment = segments[0]
  let state = createCampaignForProtocol(seed, firstSegment.version)
  let segmentIndex = 0
  const bootstrapped = applyReplayBootstrapPresentation(
    state,
    replayBootstrap,
  )
  if (!bootstrapped) return invalidReplayBootstrap(state, 0)
  state = bootstrapped

  const activateSegment = (
    current: CampaignState,
    segment: CommandProtocolSegment,
  ): CampaignState | null => {
    const activated = appendCommandProtocolSegment(
      current.commandProtocol,
      segment,
      current.commandSequence + 1,
    )
    if (!activated) return null
    const next = { ...current, commandProtocol: activated }
    if (segment.version < RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION) {
      return next
    }
    return normalizeCurrentTallowMarket(
      migrateResourcesToCurrentRules(next),
    )
  }

  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const sequence = commandIndex + 1
    while (segments[segmentIndex + 1]?.startsAtSequence === sequence) {
      segmentIndex += 1
      const activated = activateSegment(state, segments[segmentIndex])
      if (!activated) return invalidProtocolBoundary(state, commandIndex)
      state = activated
    }

    const protocolVersion = segments[segmentIndex].version
    const command = commands[commandIndex]
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
      return {
        ok: false,
        state: result.state,
        commandIndex,
        reason: result.reason,
      }
    }
    const presented = applyReplayBootstrapPresentation(
      result.state,
      replayBootstrap,
    )
    if (!presented) {
      return invalidReplayBootstrap(result.state, commandIndex)
    }
    state = presented
  }

  const finalSegment = segments[segments.length - 1]
  if (
    segmentIndex < segments.length - 1 &&
    finalSegment.startsAtSequence === commands.length + 1
  ) {
    const activated = activateSegment(state, finalSegment)
    if (!activated) return invalidProtocolBoundary(state, commands.length)
    state = activated
    segmentIndex = segments.length - 1
  }

  if (segmentIndex !== segments.length - 1) {
    return invalidProtocolBoundary(state, commands.length)
  }

  if (
    replayBootstrap.legacyReviewPrefixCount > state.reviews.feed.length ||
    !replayBootstrapCoherent(state, replayBootstrap)
  ) {
    return invalidReplayBootstrap(state, commands.length)
  }

  return { ok: true, state }
}
