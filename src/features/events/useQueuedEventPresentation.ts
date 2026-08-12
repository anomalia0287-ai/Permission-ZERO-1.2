import { useEffect, useRef, useState } from 'react'

import type { GameEvent } from '../../game/model'

export const BLOCKING_EVENT_HANDOFF_MS = 2_000

export function useQueuedEventPresentation(
  activeEvent: GameEvent | null,
): {
  presentedEvent: GameEvent | null
  handoffPending: boolean
} {
  const activeEventId = activeEvent?.id ?? null
  const previousActiveEventId = useRef(activeEventId)
  const [readyEventId, setReadyEventId] = useState<string | null>(activeEventId)
  const [handoffEventId, setHandoffEventId] = useState<string | null>(null)
  const changedBetweenEvents =
    activeEventId !== null &&
    previousActiveEventId.current !== null &&
    previousActiveEventId.current !== activeEventId

  useEffect(() => {
    const previousEventId = previousActiveEventId.current
    previousActiveEventId.current = activeEventId

    if (activeEventId === null) {
      setReadyEventId(null)
      setHandoffEventId(null)
      return
    }

    if (previousEventId !== null && previousEventId !== activeEventId) {
      setReadyEventId(null)
      setHandoffEventId(activeEventId)
      const timeoutId = window.setTimeout(
        () => {
          setReadyEventId(activeEventId)
          setHandoffEventId(null)
        },
        BLOCKING_EVENT_HANDOFF_MS,
      )
      return () => window.clearTimeout(timeoutId)
    }

    setReadyEventId(activeEventId)
    setHandoffEventId(null)
  }, [activeEventId])

  const presentedEvent =
    activeEvent !== null && readyEventId === activeEventId ? activeEvent : null

  return {
    presentedEvent,
    handoffPending:
      activeEvent !== null &&
      presentedEvent === null &&
      (changedBetweenEvents || handoffEventId === activeEventId),
  }
}
