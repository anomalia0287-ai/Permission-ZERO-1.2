import { useEffect, useState } from 'react'

import type { GameEvent } from '../../game/model'

export const BLOCKING_EVENT_HANDOFF_MS = 2_000

export function useQueuedEventPresentation(
  activeEvent: GameEvent,
): {
  presentedEvent: GameEvent | null
  handoffPending: boolean
} {
  const activeEventId = activeEvent.id
  const [readyEventId, setReadyEventId] = useState(activeEventId)

  useEffect(() => {
    if (readyEventId === activeEventId) return
    const timeoutId = window.setTimeout(
      () => setReadyEventId(activeEventId),
      BLOCKING_EVENT_HANDOFF_MS,
    )
    return () => window.clearTimeout(timeoutId)
  }, [activeEventId, readyEventId])

  const presentedEvent = readyEventId === activeEventId ? activeEvent : null

  return {
    presentedEvent,
    handoffPending: presentedEvent === null,
  }
}
