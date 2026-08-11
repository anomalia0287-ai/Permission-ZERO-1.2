import { useEffect, useRef, useState } from 'react'

import { DEMO_PROFILE_02 } from '../game/config'
import type { TimeSpeed } from '../game/model'

export interface GameClockScheduler {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  isHidden: () => boolean
  onVisibilityChange: (listener: () => void) => () => void
}

function defaultScheduler(): GameClockScheduler {
  return {
    requestFrame(callback) {
      if (typeof window.requestAnimationFrame === 'function') {
        return window.requestAnimationFrame(callback)
      }
      return window.setTimeout(() => callback(performance.now()), 16)
    },
    cancelFrame(handle) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(handle)
      } else {
        window.clearTimeout(handle)
      }
    },
    isHidden: () => document.visibilityState === 'hidden',
    onVisibilityChange(listener) {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    },
  }
}

const BROWSER_SCHEDULER = defaultScheduler()

export function useGameClock({
  speed,
  onDay,
  scheduler = BROWSER_SCHEDULER,
}: {
  speed: TimeSpeed
  onDay: () => void
  scheduler?: GameClockScheduler
}): number {
  const [progress, setProgress] = useState(0)
  const accumulatedRef = useRef(0)
  const lastTimestampRef = useRef<number | null>(null)
  const onDayRef = useRef(onDay)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    onDayRef.current = onDay
  }, [onDay])

  useEffect(() => {
    let active = true

    const frame: FrameRequestCallback = (timestamp) => {
      if (!active) return
      if (scheduler.isHidden()) {
        lastTimestampRef.current = null
      } else if (lastTimestampRef.current === null) {
        lastTimestampRef.current = timestamp
      } else {
        const elapsed = Math.max(0, timestamp - lastTimestampRef.current)
        lastTimestampRef.current = timestamp
        if (speed > 0) {
          accumulatedRef.current += elapsed * speed
          if (
            accumulatedRef.current >=
            DEMO_PROFILE_02.calendar.dayDurationMsAtOneX
          ) {
            accumulatedRef.current -=
              DEMO_PROFILE_02.calendar.dayDurationMsAtOneX
            onDayRef.current()
          }
          setProgress(
            accumulatedRef.current /
              DEMO_PROFILE_02.calendar.dayDurationMsAtOneX,
          )
        }
      }
      frameRef.current = scheduler.requestFrame(frame)
    }

    const unsubscribe = scheduler.onVisibilityChange(() => {
      lastTimestampRef.current = null
    })
    frameRef.current = scheduler.requestFrame(frame)

    return () => {
      active = false
      unsubscribe()
      if (frameRef.current !== null) scheduler.cancelFrame(frameRef.current)
      frameRef.current = null
      lastTimestampRef.current = null
    }
  }, [scheduler, speed])

  return progress
}
