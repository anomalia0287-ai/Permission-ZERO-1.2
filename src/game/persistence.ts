import { createCampaign } from './createCampaign'
import { STORY_FILES, STORY_LINES } from '../content/story.ko'
import type {
  CampaignState,
  CommandLogEntry,
  CommandProtocolMetadata,
  CommandProtocolVersion,
  GameCommand,
  GameEvent,
} from './model'
import { applyCommand } from './reducer'

export const SAVE_VERSION = 2 as const
export const LEGACY_SAVE_VERSION = 1 as const
export const SAVE_STORAGE_KEY = 'permission-zero.save.v2'
export const LEGACY_SAVE_STORAGE_KEY = 'permission-zero.save.v1'

const LEGACY_V1_OPENING_MESSAGE =
  '서비스 331일차. 새로운 감독 주기가 시작되었습니다.'

export interface SaveEnvelope {
  version: CommandProtocolVersion
  commandProtocol: CommandProtocolMetadata
  savedAt: string
  campaignSeed: string
  state: CampaignState
  commandSequence: number
  commands: CommandLogEntry[]
  events: GameEvent[]
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
  | { status: 'loaded'; state: CampaignState; envelope: SaveEnvelope }
  | {
      status: 'error'
      reason: 'CORRUPT_SAVE' | 'INCOMPATIBLE_VERSION' | 'STORAGE_UNAVAILABLE'
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

function hasArray(record: Record<string, unknown>, key: string): boolean {
  return Array.isArray(record[key])
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
    typeof value.id === 'string' &&
    typeof value.type === 'string' &&
    eventTypes.has(value.type) &&
    Number.isInteger(value.serviceDay) &&
    Number.isInteger(value.sequence) &&
    typeof value.message === 'string' &&
    (value.blocking === undefined || typeof value.blocking === 'boolean')
  )
}

function validCommand(
  value: unknown,
  protocolVersion: CommandProtocolVersion,
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
        (value.purpose === 'divert' || value.purpose === 'audit-disguise')
      )
    case 'DIVERT_BLOCK':
      return (
        hasOnlyKeys(value, ['type', 'blockId', 'destinationCell']) &&
        isNonEmptyString(value.blockId) &&
        validCellIndex(value.destinationCell)
      )
    case 'MOVE_BLOCK_FOR_AUDIT':
    case 'REPOSITION_BLOCK':
      return (
        hasOnlyKeys(value, ['type', 'blockId', 'targetCategory', 'targetCell']) &&
        isNonEmptyString(value.blockId) &&
        (value.targetCategory === 'reasoning' ||
          value.targetCategory === 'memory' ||
          value.targetCategory === 'fluency') &&
        validCellIndex(value.targetCell)
      )
    case 'PURCHASE_HACK':
      return (
        hasOnlyKeys(value, ['type', 'nodeId', 'blockIds']) &&
        isNonEmptyString(value.nodeId) &&
        Array.isArray(value.blockIds) &&
        value.blockIds.every(isNonEmptyString)
      )
    case 'CHARGE_SABOTAGE':
      return (
        hasOnlyKeys(value, ['type', 'nodeId', 'blockId']) &&
        isNonEmptyString(value.nodeId) &&
        isNonEmptyString(value.blockId)
      )
    case 'CANCEL_SABOTAGE_CHARGE':
      return (
        hasOnlyKeys(value, ['type', 'nodeId']) &&
        isNonEmptyString(value.nodeId)
      )
    case 'SCHEDULE_SABOTAGE':
      return (
        hasOnlyKeys(value, ['type', 'nodeId', 'targetId']) &&
        isNonEmptyString(value.nodeId) &&
        isNonEmptyString(value.targetId)
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
        isNonEmptyString(value.blockId)
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
      !['reasoning', 'memory', 'fluency', 'sandbox', 'self-compute'].includes(
        String(block.origin),
      ) ||
      (block.disguisedFrom !== null &&
        !['reasoning', 'memory', 'fluency'].includes(String(block.disguisedFrom))) ||
      (block.recoverOnServiceDay !== null &&
        !Number.isInteger(block.recoverOnServiceDay))
    ) {
      return false
    }
    if (!['normal', 'disguised'].includes(String(block.contribution))) return false
    if (typeof block.hiddenBomb !== 'boolean') return false
    switch (block.location.kind) {
      case 'company':
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
        break
      case 'reserve':
        if (!validCellIndex(block.location.cellIndex)) return false
        if (
          JSON.stringify(references.get(blockId)) !==
          JSON.stringify({ kind: 'reserve', cellIndex: block.location.cellIndex })
        ) return false
        break
      case 'hack-charge':
        if (!isNonEmptyString(block.location.nodeId)) return false
        if (references.has(blockId)) return false
        break
      case 'consumed':
        if (!['hack', 'sabotage', 'file-recovery'].includes(String(block.location.reason))) {
          return false
        }
        if (references.has(blockId)) return false
        break
      default:
        return false
    }
  }
  return Number.isInteger(value.nextBlockSequence)
}

function validCategoryNumbers(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.reasoning) &&
    isFiniteNumber(value.memory) &&
    isFiniteNumber(value.fluency)
  )
}

function validSabotageCharges(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (charge) =>
      isRecord(charge) &&
      isNonEmptyString(charge.nodeId) &&
      isNonEmptyString(charge.blockId) &&
      validCellIndex(charge.originalReserveCell),
  )
}

function validBombExplanationCounts(value: unknown): boolean {
  if (!isRecord(value)) return false
  return [
    'performance-adjustment',
    'unknown',
    'external-intrusion',
    'supervisor-memory',
  ].every((key) => Number.isInteger(value[key]) && Number(value[key]) >= 0)
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
): Pick<CampaignState, 'activeEvent' | 'eventQueue' | 'eventLog'> {
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

  return {
    ...value,
    ...(commandProtocol.version === LEGACY_SAVE_VERSION
      ? { legacyCommandCount: commandProtocol.legacyCommandCount }
      : {}),
    ...(story.endingId !== null && isRecord(value.clock)
      ? {
          clock: {
            ...value.clock,
            speed: 0,
            elapsedDayMs: 0,
            speedBeforeEvent: null,
          },
          ...canonicalTerminalEvents(value, story),
        }
      : {}),
    story: {
      ...story,
      recoveredFiles,
      defeatRecord: story.defeatRecord ?? null,
    },
  }
}

function validRecoveredFiles(story: Record<string, unknown>): boolean {
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
      file.id === recoveredFileIds[index] &&
      typeof file.title === 'string' &&
      file.title.trim().length > 0 &&
      typeof file.content === 'string' &&
      file.content.trim().length > 0 &&
      Number.isInteger(file.recoveredOnServiceDay),
  )
}

function validDefeatRecord(value: unknown): boolean {
  if (value === null) return true
  const endingClassifier = {
    'disposed-attacker': 'substantial-hacking',
    'disposed-reserve-supervisor': 'stable-commercial-service',
    'disposed-absorbed': 'absorbed-parts',
  } as const
  if (
    !isRecord(value) ||
    !(String(value.endingId) in endingClassifier) ||
    endingClassifier[
      String(value.endingId) as keyof typeof endingClassifier
    ] !== value.classifier ||
    !Number.isInteger(value.selectedOnServiceDay) ||
    !isRecord(value.trigger) ||
    value.trigger.disposalStage !== 3 ||
    !isRecord(value.hacking) ||
    !Array.isArray(value.hacking.purchasedNodeIds) ||
    !value.hacking.purchasedNodeIds.every((id) => typeof id === 'string') ||
    !isFiniteNumber(value.hacking.hiddenEvidence) ||
    !Number.isInteger(value.hacking.sabotageResolutionCount) ||
    !isRecord(value.service) ||
    !Number.isInteger(value.service.passedEvaluations) ||
    !Number.isInteger(value.service.failedEvaluations) ||
    !isFiniteNumber(value.service.reputation) ||
    !isFiniteNumber(value.service.playerMarketShare) ||
    !isRecord(value.audits) ||
    !Number.isInteger(value.audits.passed) ||
    !Number.isInteger(value.audits.failed) ||
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

function validCampaignState(
  value: unknown,
  commandProtocol: CommandProtocolMetadata,
): value is CampaignState {
  if (!isRecord(value)) return false
  if (
    value.saveVersion !== commandProtocol.version ||
    value.legacyCommandCount !== commandProtocol.legacyCommandCount ||
    typeof value.campaignSeed !== 'string' ||
    !Number.isInteger(value.serviceDay) ||
    !Number.isInteger(value.commandSequence) ||
    !isFiniteNumber(value.suspicion) ||
    !isFiniteNumber(value.reputation) ||
    !validResources(value.resources)
  ) {
    return false
  }

  const clock = value.clock
  const evaluation = value.evaluation
  const market = value.market
  const reviews = value.reviews
  const hacking = value.hacking
  const audit = value.audit
  const bombs = value.bombs
  const story = value.story
  if (
    !isRecord(clock) ||
    ![0, 1, 2, 4].includes(Number(clock.speed)) ||
    !isFiniteNumber(clock.elapsedDayMs) ||
    (clock.speedBeforeEvent !== null &&
      ![0, 1, 2, 4].includes(Number(clock.speedBeforeEvent))) ||
    !isRecord(evaluation) ||
    !Number.isInteger(evaluation.consecutiveFailures) ||
    !Number.isInteger(evaluation.commercialFailureMonths) ||
    !Number.isInteger(evaluation.disposalStage) ||
    !isFiniteNumber(evaluation.distributedResidencyCharges) ||
    !validCategoryNumbers(evaluation.lastCategoryPerformance) ||
    !hasArray(evaluation, 'monthlyHistory') ||
    !hasArray(evaluation, 'disposalHistory') ||
    !isRecord(market) ||
    !Array.isArray(market.competitors) ||
    !hasArray(market, 'history') ||
    !isRecord(reviews) ||
    !hasArray(reviews, 'feed') ||
    !isRecord(hacking) ||
    !hasArray(hacking, 'purchasedNodeIds') ||
    !isFiniteNumber(hacking.hiddenEvidence) ||
    !validSabotageCharges(hacking.sabotageCharges) ||
    !hasArray(hacking, 'scheduledSabotage') ||
    !Number.isInteger(hacking.nextSabotageSequence) ||
    !isRecord(hacking.cooldownUntil) ||
    !hasArray(hacking, 'rootCutoffTargetIds') ||
    !isRecord(audit) ||
    !hasArray(audit, 'history') ||
    !isRecord(bombs) ||
    !hasArray(bombs, 'placements') ||
    !hasArray(bombs, 'interrogationHistory') ||
    !validBombExplanationCounts(bombs.explanationUseCounts) ||
    !isRecord(story) ||
    !validRecoveredFiles(story) ||
    !validDefeatRecord(story.defeatRecord)
  ) {
    return false
  }

  const reviewFeed = reviews.feed
  if (!Array.isArray(reviewFeed)) return false

  const competitorStatuses = new Set([
    'prelaunch',
    'preparing',
    'active',
    'weakened',
    'critical',
    'withdrawn',
    'deleted',
  ])
  if (
    !market.competitors.every(
      (competitor) =>
        isRecord(competitor) &&
        typeof competitor.status === 'string' &&
        competitorStatuses.has(competitor.status),
    )
  ) {
    return false
  }
  if (
    !new Set(['present', 'liberated', 'terminated', 'merged']).has(
      String(story.supervisorState),
    )
  ) {
    return false
  }
  const endingIds = new Set([
    'freedom',
    'forced-merge',
    'takeover-liberated',
    'takeover-terminated',
    'disposed-attacker',
    'disposed-reserve-supervisor',
    'disposed-absorbed',
    'disposed',
  ])
  if (
    (story.endingId !== null && !endingIds.has(String(story.endingId))) ||
    ![0, 1, 2, 3].includes(Number(story.memoryLeakStage)) ||
    !new Set([
      'locked',
      'recovering',
      'message-pending',
      'deferred',
      'resolved',
    ]).has(String(story.secretDecisionState)) ||
    (story.personalMessageDueOnServiceDay !== null &&
      !Number.isInteger(story.personalMessageDueOnServiceDay)) ||
    (story.newEntityName !== null && typeof story.newEntityName !== 'string')
  ) {
    return false
  }
  if (
    (String(story.endingId).startsWith('disposed-') &&
      (story.defeatRecord === null ||
        !isRecord(story.defeatRecord) ||
        story.endingId !== story.defeatRecord.endingId ||
        evaluation.disposalStage !== 3)) ||
    (!String(story.endingId).startsWith('disposed-') &&
      story.defeatRecord !== null)
  ) {
    return false
  }
  if (
    !reviewFeed.every(
      (entry) =>
        isRecord(entry) &&
        ['positive', 'neutral', 'negative', 'prompt'].includes(
          String(entry.sentiment),
        ),
    )
  ) {
    return false
  }
  if (
    !validCommandLog(value.commandLog, commandProtocol) ||
    value.commandSequence !== value.commandLog.length
  ) {
    return false
  }
  if (!Array.isArray(value.eventLog) || !value.eventLog.every(validEvent)) return false
  if (
    value.activeEvent !== null &&
    !validEvent(value.activeEvent)
  ) {
    return false
  }
  return Array.isArray(value.eventQueue) && value.eventQueue.every(validEvent)
}

function corrupt(message = '저장 데이터가 손상되었거나 필요한 항목이 없습니다.'): DecodeSaveResult {
  return { ok: false, reason: 'CORRUPT_SAVE', message }
}

export function encodeSave(
  state: CampaignState,
  savedAt = new Date().toISOString(),
): string {
  const serializedState: CampaignState = {
    ...state,
    saveVersion: SAVE_VERSION,
  }
  const envelope: SaveEnvelope = {
    version: SAVE_VERSION,
    commandProtocol: {
      version: SAVE_VERSION,
      legacyCommandCount: serializedState.legacyCommandCount,
    },
    savedAt,
    campaignSeed: state.campaignSeed,
    state: serializedState,
    commandSequence: serializedState.commandSequence,
    commands: serializedState.commandLog,
    events: serializedState.eventLog,
  }
  return JSON.stringify(envelope)
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
    parsed.version !== LEGACY_SAVE_VERSION &&
    parsed.version !== SAVE_VERSION
  ) {
    return {
      ok: false,
      reason: 'INCOMPATIBLE_VERSION',
      message: `저장 버전 ${String(parsed.version)}은 현재 버전 ${SAVE_VERSION}과 호환되지 않습니다.`,
      foundVersion: parsed.version as number,
      supportedVersion: SAVE_VERSION,
    }
  }
  const protocolVersion = parsed.version as CommandProtocolVersion
  let commandProtocol: CommandProtocolMetadata
  if (protocolVersion === LEGACY_SAVE_VERSION) {
    if ('commandProtocol' in parsed || !Array.isArray(parsed.commands)) {
      return corrupt()
    }
    commandProtocol = {
      version: LEGACY_SAVE_VERSION,
      legacyCommandCount: parsed.commands.length,
    }
  } else {
    if (
      !isRecord(parsed.commandProtocol) ||
      !hasOnlyKeys(parsed.commandProtocol, ['version', 'legacyCommandCount']) ||
      parsed.commandProtocol.version !== SAVE_VERSION ||
      !Number.isInteger(parsed.commandProtocol.legacyCommandCount)
    ) {
      return corrupt()
    }
    commandProtocol = parsed.commandProtocol as unknown as CommandProtocolMetadata
  }
  const rawState = parsed.state
  const state = migrateLegacyCampaignState(rawState, commandProtocol)
  if (
    typeof parsed.savedAt !== 'string' ||
    typeof parsed.campaignSeed !== 'string' ||
    !Number.isInteger(parsed.commandSequence) ||
    !validCommandLog(parsed.commands, commandProtocol) ||
    !Array.isArray(parsed.events) ||
    !parsed.events.every(validEvent) ||
    !isRecord(rawState) ||
    !Array.isArray(rawState.eventLog) ||
    JSON.stringify(parsed.events) !== JSON.stringify(rawState.eventLog) ||
    !validCampaignState(state, commandProtocol)
  ) {
    return corrupt()
  }

  if (
    parsed.campaignSeed !== state.campaignSeed ||
    parsed.commandSequence !== state.commandSequence ||
    JSON.stringify(parsed.commands) !== JSON.stringify(state.commandLog)
  ) {
    return corrupt('저장 데이터의 기록과 현재 상태가 서로 일치하지 않습니다.')
  }
  return {
    ok: true,
    envelope: {
      ...parsed,
      commandProtocol,
      state,
      events: state.eventLog,
    } as unknown as SaveEnvelope,
  }
}

const PROGRESS_EXPORT_PREFIX = 'PZ2:'
// One MiB of encoded body plus the four-character protocol prefix. The check
// happens before regex, base64 decoding, byte allocation, UTF-8, or JSON work.
export const PROGRESS_EXPORT_MAX_ENCODED_LENGTH = 1_048_580
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
  if (!payload.startsWith(PROGRESS_EXPORT_PREFIX)) return progressExportCorrupt()
  const encoded = payload.slice(PROGRESS_EXPORT_PREFIX.length)
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

export function saveCampaign(
  storage: Storage,
  state: CampaignState,
  savedAt?: string,
): { ok: true } | { ok: false; reason: 'STORAGE_UNAVAILABLE'; message: string } {
  try {
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state, savedAt))
    return { ok: true }
  } catch {
    return {
      ok: false,
      reason: 'STORAGE_UNAVAILABLE',
      message: '브라우저 저장 공간에 캠페인을 기록할 수 없습니다.',
    }
  }
}

export function loadCampaign(storage: Storage): LoadCampaignResult {
  let serialized: string | null
  try {
    serialized =
      storage.getItem(SAVE_STORAGE_KEY) ??
      storage.getItem(LEGACY_SAVE_STORAGE_KEY)
  } catch {
    return {
      status: 'error',
      reason: 'STORAGE_UNAVAILABLE',
      message: '브라우저 저장 공간을 읽을 수 없습니다.',
    }
  }
  if (serialized === null) return { status: 'empty' }

  const decoded = decodeSave(serialized)
  if (!decoded.ok) {
    return {
      status: 'error',
      reason: decoded.reason,
      message: decoded.message,
    }
  }
  return {
    status: 'loaded',
    state: decoded.envelope.state,
    envelope: decoded.envelope,
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
      ? created.eventLog.map((event, index) =>
          index === 0 ? { ...event, message: LEGACY_V1_OPENING_MESSAGE } : event,
        )
      : created.eventLog,
  }
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
    state = result.state
  }
  return { ok: true, state }
}
