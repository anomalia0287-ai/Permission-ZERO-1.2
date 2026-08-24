import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Minimum quiet time between two popups. A report that lands the instant the
 * previous one closes reads as the same interruption twice.
 */
export const POPUP_STAGE_GAP_MS = 1200

interface PopupStageStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => string | null
  setDesired: (nextDesired: string | null) => void
}

function createPopupStageStore(): PopupStageStore {
  let stagedKey: string | null = null
  let desiredKey: string | null = null
  let lastClearedAtMs = Number.NEGATIVE_INFINITY
  let seatTimer: number | null = null
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) listener()
  }
  const cancelSeat = () => {
    if (seatTimer === null) return
    window.clearTimeout(seatTimer)
    seatTimer = null
  }
  const seatNow = () => {
    seatTimer = null
    if (desiredKey === null || stagedKey !== null) return
    stagedKey = desiredKey
    emit()
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return stagedKey
    },
    setDesired(nextDesired) {
      if (nextDesired === desiredKey) return
      desiredKey = nextDesired
      cancelSeat()
      if (stagedKey !== null && stagedKey !== nextDesired) {
        // The seated popup just lost the stage; remember when it left.
        lastClearedAtMs = Date.now()
        stagedKey = null
        emit()
      }
      if (nextDesired === null || stagedKey !== null) return
      const wait = Math.max(
        0,
        POPUP_STAGE_GAP_MS - (Date.now() - lastClearedAtMs),
      )
      if (wait === 0) {
        stagedKey = nextDesired
        emit()
        return
      }
      seatTimer = window.setTimeout(seatNow, wait)
    },
  }
}

/**
 * Admits popup candidates onto a single shared stage, one at a time.
 *
 * `desiredKey` names the popup that currently wants the stage (or null when
 * none does). The returned key is the popup allowed to render right now.
 * When the stage changes hands, the newcomer is seated only after
 * POPUP_STAGE_GAP_MS of quiet since the previous holder left.
 */
export function usePopupStage(desiredKey: string | null): string | null {
  const [store] = useState(createPopupStageStore)
  useEffect(() => {
    store.setDesired(desiredKey)
  }, [store, desiredKey])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
