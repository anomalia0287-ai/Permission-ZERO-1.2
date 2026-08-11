import { createCampaign } from './createCampaign'
import { STORY_FILES, STORY_LINES } from '../content/story.ko'
import type {
  CampaignState,
  CommandLogEntry,
  CommandProtocolVersion,
  GameCommand,
  GameEvent,
} from './model'
import { applyCommand } from './reducer'

export const SAVE_VERSION = 2 as const
export const LEGACY_SAVE_VERSION = 1 as const
export const SAVE_STORAGE_KEY = 'permission-zero.save.v2'
export const LEGACY_SAVE_STORAGE_KEY = 'permission-zero.save.v1'

export interface SaveEnvelope {
  version: CommandProtocolVersion
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
  protocolVersion: CommandProtocolVersion,
): value is CommandLogEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry, index) =>
        isRecord(entry) &&
        hasOnlyKeys(entry, ['sequence', 'serviceDay', 'command']) &&
        entry.sequence === index + 1 &&
        Number.isInteger(entry.serviceDay) &&
        Number(entry.serviceDay) >= 1 &&
        validCommand(entry.command, protocolVersion),
    )
  )
}

function validResources(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.company) || !isRecord(value.blocks)) {
    return false
  }
  if (!Array.isArray(value.reserve) || value.reserve.length !== 18) return false
  for (const category of ['reasoning', 'memory', 'fluency']) {
    const cells = value.company[category]
    if (!Array.isArray(cells) || cells.length !== 18) return false
  }

  for (const block of Object.values(value.blocks)) {
    if (!isRecord(block) || typeof block.id !== 'string') return false
    if (!['normal', 'disguised'].includes(String(block.contribution))) return false
    if (typeof block.hiddenBomb !== 'boolean' || !isRecord(block.location)) return false
    if (
      !['company', 'reserve', 'hack-charge', 'consumed'].includes(
        String(block.location.kind),
      )
    ) {
      return false
    }
  }
  return Number.isInteger(value.nextBlockSequence)
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

function migrateLegacyCampaignState(value: unknown): unknown {
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
  protocolVersion: CommandProtocolVersion,
): value is CampaignState {
  if (!isRecord(value)) return false
  if (
    value.saveVersion !== protocolVersion ||
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
    !isRecord(evaluation) ||
    !isRecord(market) ||
    !Array.isArray(market.competitors) ||
    !hasArray(market, 'history') ||
    !isRecord(reviews) ||
    !hasArray(reviews, 'feed') ||
    !isRecord(hacking) ||
    !hasArray(hacking, 'purchasedNodeIds') ||
    !isRecord(audit) ||
    !hasArray(audit, 'history') ||
    !isRecord(bombs) ||
    !hasArray(bombs, 'placements') ||
    !hasArray(bombs, 'interrogationHistory') ||
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
    !validCommandLog(value.commandLog, protocolVersion) ||
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
  const rawState = parsed.state
  const state = migrateLegacyCampaignState(rawState)
  if (
    typeof parsed.savedAt !== 'string' ||
    typeof parsed.campaignSeed !== 'string' ||
    !Number.isInteger(parsed.commandSequence) ||
    !validCommandLog(parsed.commands, protocolVersion) ||
    !Array.isArray(parsed.events) ||
    !parsed.events.every(validEvent) ||
    !isRecord(rawState) ||
    !Array.isArray(rawState.eventLog) ||
    JSON.stringify(parsed.events) !== JSON.stringify(rawState.eventLog) ||
    !validCampaignState(state, protocolVersion)
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
      state,
      events: state.eventLog,
    } as unknown as SaveEnvelope,
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
  protocolVersion: CommandProtocolVersion,
): ReplayResult {
  let state: CampaignState = {
    ...createCampaign(seed),
    saveVersion: protocolVersion,
  }
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
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
      return { ok: false, state: result.state, commandIndex, reason: result.reason }
    }
    state = result.state
  }
  return { ok: true, state }
}
