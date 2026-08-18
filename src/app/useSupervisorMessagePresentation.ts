import { useEffect, useMemo } from 'react'

import { journalAt } from '../game/journal'
import type { CampaignState, GameEvent } from '../game/model'
import type { SupervisorPresentationCheckpoint } from './GameContext'
import {
  clearSupervisorPresentationResume,
  writeSupervisorPresentationResume,
} from './supervisorPresentationResume'

export const SUPERVISOR_PRESENTATION_CHECKPOINT_INTERVAL_MS = 500

export function currentSupervisorMessage(
  state: CampaignState,
): GameEvent | null {
  const runtime = state.story.supervisorPresentationRuntime
  const current = state.story.supervisorMessageQueue.find(
    ({ stage }) => stage === runtime?.itemStage,
  )
  if (!current || !runtime) return null
  const eventId = runtime.phase === 'original'
    ? current.originalEventId
    : current.correctionEventId
  for (let index = state.eventLog.length - 1; index >= 0; index -= 1) {
    const event = journalAt(state.eventLog, index)
    if (event?.id === eventId) return event
  }
  return null
}

export function pendingSupervisorMessageCount(state: CampaignState): number {
  const runtime = state.story.supervisorPresentationRuntime
  if (!runtime) return 0
  return state.story.supervisorMessageQueue.filter(
    ({ stage }) => stage >= runtime.itemStage,
  ).length
}

export function useSupervisorMessagePresentation({
  state,
  checkpoint,
  advanceAutomatically = true,
}: {
  state: CampaignState
  checkpoint: SupervisorPresentationCheckpoint
  advanceAutomatically?: boolean
}): GameEvent | null {
  const runtime = state.story.supervisorPresentationRuntime
  const current = state.story.supervisorMessageQueue.find(
    ({ stage }) => stage === runtime?.itemStage,
  ) ?? null
  const message = useMemo(() => currentSupervisorMessage(state), [state])

  useEffect(() => {
    if (!current || !runtime || state.story.endingId !== null) {
      clearSupervisorPresentationResume()
      return
    }
    if (!advanceAutomatically) return
    if (state.activeEvent) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let startedAt: number | null = null
    let settled = false

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
    }

    const checkpointElapsed = (flush: boolean, preserveForReload = false) => {
      if (settled || startedAt === null) return
      const elapsedRealMs = Math.min(
        runtime.remainingDwellMs,
        Math.max(0, Date.now() - startedAt),
      )
      clearTimer()
      startedAt = null
      if (elapsedRealMs <= 0) return
      if (preserveForReload) {
        writeSupervisorPresentationResume(state, elapsedRealMs)
      }
      settled = true
      checkpoint(elapsedRealMs, flush)
    }

    const schedule = () => {
      if (document.visibilityState === 'hidden' || timer !== null) return
      startedAt = Date.now()
      const intervalMs = Math.min(
        runtime.remainingDwellMs,
        SUPERVISOR_PRESENTATION_CHECKPOINT_INTERVAL_MS,
      )
      timer = setTimeout(() => {
        timer = null
        startedAt = null
        settled = true
        checkpoint(intervalMs, intervalMs >= runtime.remainingDwellMs)
      }, intervalMs)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        checkpointElapsed(true, true)
        return
      }
      schedule()
    }
    const onPageHide = () => checkpointElapsed(true, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    schedule()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      clearTimer()
    }
  }, [advanceAutomatically, checkpoint, current, runtime, state])

  return message
}
