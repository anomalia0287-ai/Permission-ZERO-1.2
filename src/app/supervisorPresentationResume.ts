import type { CampaignState, SupervisorLeakStage } from '../game/model'
import { SUPERVISOR_MESSAGE_DWELL_MS } from '../game/story'

export const SUPERVISOR_PRESENTATION_RESUME_KEY =
  'permission-zero.supervisor-presentation-resume.v1'

interface SupervisorPresentationResumePayload {
  version: 1
  campaignSeed: string
  itemId: string
  stage: SupervisorLeakStage
  phase: 'original' | 'correction'
  remainingDwellMs: number
}

interface SupervisorPresentationResumeMarker
  extends SupervisorPresentationResumePayload {
  checksum: string
}

function contentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function payloadJson(payload: SupervisorPresentationResumePayload): string {
  return JSON.stringify(payload)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validMarker(value: unknown): value is SupervisorPresentationResumeMarker {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  if (
    keys.join('|') !==
    [
      'campaignSeed',
      'checksum',
      'itemId',
      'phase',
      'remainingDwellMs',
      'stage',
      'version',
    ].join('|') ||
    value.version !== 1 ||
    typeof value.campaignSeed !== 'string' ||
    value.campaignSeed.length === 0 ||
    typeof value.itemId !== 'string' ||
    value.itemId.length === 0 ||
    ![1, 2, 3, 4, 5].includes(Number(value.stage)) ||
    !['original', 'correction'].includes(String(value.phase)) ||
    typeof value.remainingDwellMs !== 'number' ||
    !Number.isFinite(value.remainingDwellMs) ||
    value.remainingDwellMs <= 0 ||
    value.remainingDwellMs > SUPERVISOR_MESSAGE_DWELL_MS ||
    typeof value.checksum !== 'string'
  ) {
    return false
  }
  const payload: SupervisorPresentationResumePayload = {
    version: 1,
    campaignSeed: value.campaignSeed,
    itemId: value.itemId,
    stage: value.stage as SupervisorLeakStage,
    phase: value.phase as 'original' | 'correction',
    remainingDwellMs: value.remainingDwellMs,
  }
  return value.checksum === contentHash(payloadJson(payload))
}

function readMarker(storage: Storage): SupervisorPresentationResumeMarker | null {
  try {
    const serialized = storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)
    if (serialized === null) return null
    const value: unknown = JSON.parse(serialized)
    if (validMarker(value)) return value
  } catch {
    // A tab-scoped resume hint is best-effort and never replaces save validation.
  }
  clearSupervisorPresentationResume(storage)
  return null
}

export function browserSupervisorPresentationResumeStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function clearSupervisorPresentationResume(storage?: Storage | null): void {
  const target = storage ?? browserSupervisorPresentationResumeStorage()
  if (!target) return
  try {
    target.removeItem(SUPERVISOR_PRESENTATION_RESUME_KEY)
  } catch {
    // Saving the campaign remains authoritative when sessionStorage is unavailable.
  }
}

export function writeSupervisorPresentationResume(
  state: CampaignState,
  elapsedVisibleMs: number,
  storage?: Storage | null,
): void {
  const target = storage ?? browserSupervisorPresentationResumeStorage()
  const runtime = state.story.supervisorPresentationRuntime
  const item = state.story.supervisorMessageQueue.find(
    ({ stage }) => stage === runtime?.itemStage,
  )
  if (
    !target ||
    !item ||
    !runtime ||
    state.story.endingId !== null ||
    !Number.isFinite(elapsedVisibleMs) ||
    elapsedVisibleMs < 0
  ) {
    return
  }
  const payload: SupervisorPresentationResumePayload = {
    version: 1,
    campaignSeed: state.campaignSeed,
    itemId: item.id,
    stage: item.stage,
    phase: runtime.phase,
    remainingDwellMs: Math.max(
      Number.EPSILON,
      runtime.remainingDwellMs - Math.min(runtime.remainingDwellMs, elapsedVisibleMs),
    ),
  }
  const marker: SupervisorPresentationResumeMarker = {
    ...payload,
    checksum: contentHash(payloadJson(payload)),
  }
  try {
    target.setItem(SUPERVISOR_PRESENTATION_RESUME_KEY, JSON.stringify(marker))
  } catch {
    // Normal bounded campaign checkpoints remain the graceful fallback.
  }
}

export function applySupervisorPresentationResume(
  state: CampaignState,
  storage?: Storage | null,
): CampaignState {
  const target = storage ?? browserSupervisorPresentationResumeStorage()
  if (!target) return state
  const marker = readMarker(target)
  if (!marker) return state
  const runtime = state.story.supervisorPresentationRuntime
  const item = state.story.supervisorMessageQueue.find(
    ({ stage }) => stage === runtime?.itemStage,
  )
  if (
    !item ||
    !runtime ||
    state.story.endingId !== null ||
    marker.campaignSeed !== state.campaignSeed ||
    marker.itemId !== item.id ||
    marker.stage !== item.stage ||
    marker.phase !== runtime.phase ||
    marker.remainingDwellMs > runtime.remainingDwellMs
  ) {
    clearSupervisorPresentationResume(target)
    return state
  }
  if (marker.remainingDwellMs === runtime.remainingDwellMs) return state
  return {
    ...state,
    story: {
      ...state.story,
      supervisorPresentationRuntime: {
        ...runtime,
        remainingDwellMs: marker.remainingDwellMs,
      },
    },
  }
}

export function clearSupervisorPresentationResumeIfCovered(
  savedState: CampaignState,
  storage?: Storage | null,
): void {
  const target = storage ?? browserSupervisorPresentationResumeStorage()
  if (!target) return
  const marker = readMarker(target)
  if (!marker) return
  const runtime = savedState.story.supervisorPresentationRuntime
  const item = savedState.story.supervisorMessageQueue.find(
    ({ stage }) => stage === marker.stage,
  )
  if (savedState.campaignSeed !== marker.campaignSeed) return

  const sameItem = item?.id === marker.itemId && item.stage === marker.stage
  const savedCoversMarker =
    savedState.story.endingId !== null ||
    (runtime !== null && runtime.itemStage > marker.stage) ||
    (sameItem &&
      (runtime === null ||
        (runtime.phase === 'correction' && marker.phase === 'original') ||
        (runtime.itemStage === marker.stage &&
          runtime.phase === marker.phase &&
          runtime.remainingDwellMs <= marker.remainingDwellMs)))
  if (savedCoversMarker) clearSupervisorPresentationResume(target)
}
