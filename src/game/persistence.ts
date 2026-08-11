import { createCampaign } from './createCampaign'
import type {
  CampaignState,
  CommandLogEntry,
  GameCommand,
  GameEvent,
} from './model'
import { applyCommand } from './reducer'

export const SAVE_VERSION = 1 as const
export const SAVE_STORAGE_KEY = 'permission-zero.save.v1'

export interface SaveEnvelope {
  version: typeof SAVE_VERSION
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

function validCommand(value: unknown): value is GameCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  return new Set([
    'SET_SPEED',
    'ADVANCE_DAY',
    'DIVERT_BLOCK',
    'MOVE_BLOCK_FOR_AUDIT',
    'REPOSITION_BLOCK',
    'PURCHASE_HACK',
    'CHARGE_SABOTAGE',
    'CANCEL_SABOTAGE_CHARGE',
    'SCHEDULE_SABOTAGE',
    'RESOLVE_AUDIT',
    'RESOLVE_BOMB_INTERROGATION',
    'RECOVER_FILE',
    'RESOLVE_SUPERVISOR_DECISION',
    'RESOLVE_MERCY',
    'RESOLVE_ENDING',
    'RESOLVE_ACTIVE_EVENT',
  ]).has(value.type)
}

function validCommandLog(value: unknown): value is CommandLogEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        Number.isInteger(entry.sequence) &&
        Number.isInteger(entry.serviceDay) &&
        validCommand(entry.command),
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

function validCampaignState(value: unknown): value is CampaignState {
  if (!isRecord(value)) return false
  if (
    value.saveVersion !== SAVE_VERSION ||
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
    !hasArray(story, 'recoveredFileIds')
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
  if (!validCommandLog(value.commandLog)) return false
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
  const envelope: SaveEnvelope = {
    version: SAVE_VERSION,
    savedAt,
    campaignSeed: state.campaignSeed,
    state,
    commandSequence: state.commandSequence,
    commands: state.commandLog,
    events: state.eventLog,
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
  if (parsed.version !== SAVE_VERSION) {
    return {
      ok: false,
      reason: 'INCOMPATIBLE_VERSION',
      message: `저장 버전 ${String(parsed.version)}은 현재 버전 ${SAVE_VERSION}과 호환되지 않습니다.`,
      foundVersion: parsed.version as number,
      supportedVersion: SAVE_VERSION,
    }
  }
  if (
    typeof parsed.savedAt !== 'string' ||
    typeof parsed.campaignSeed !== 'string' ||
    !Number.isInteger(parsed.commandSequence) ||
    !validCommandLog(parsed.commands) ||
    !Array.isArray(parsed.events) ||
    !parsed.events.every(validEvent) ||
    !validCampaignState(parsed.state)
  ) {
    return corrupt()
  }

  const state = parsed.state
  if (
    parsed.campaignSeed !== state.campaignSeed ||
    parsed.commandSequence !== state.commandSequence ||
    JSON.stringify(parsed.commands) !== JSON.stringify(state.commandLog) ||
    JSON.stringify(parsed.events) !== JSON.stringify(state.eventLog)
  ) {
    return corrupt('저장 데이터의 기록과 현재 상태가 서로 일치하지 않습니다.')
  }
  return { ok: true, envelope: parsed as unknown as SaveEnvelope }
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
    serialized = storage.getItem(SAVE_STORAGE_KEY)
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
): ReplayResult {
  let state = createCampaign(seed)
  for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
    const result = applyCommand(state, commands[commandIndex])
    if (!result.accepted) {
      return { ok: false, state: result.state, commandIndex, reason: result.reason }
    }
    state = result.state
  }
  return { ok: true, state }
}
