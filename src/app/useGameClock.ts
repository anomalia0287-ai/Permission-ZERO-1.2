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
  initialElapsedDayMs,
  dayKey,
  onElapsedCheckpoint,
  scheduler = BROWSER_SCHEDULER,
}: {
  speed: TimeSpeed
  onDay: () => void
  initialElapsedDayMs: number
  dayKey: string | number
  onElapsedCheckpoint: (elapsedDayMs: number, flush: boolean) => void
  scheduler?: GameClockScheduler
}): number {
  const dayDuration = DEMO_PROFILE_02.calendar.dayDurationMsAtOneX
  const normalizedInitial = Math.min(
    dayDuration - Number.EPSILON,
    Math.max(0, initialElapsedDayMs),
  )
  const [clockView, setClockView] = useState({
    dayKey,
    progress: normalizedInitial / dayDuration,
  })
  const accumulatedRef = useRef(normalizedInitial)
  const lastTimestampRef = useRef<number | null>(null)
  const lastCheckpointTimestampRef = useRef<number | null>(null)
  const onDayRef = useRef(onDay)
  const onElapsedCheckpointRef = useRef(onElapsedCheckpoint)
  const frameRef = useRef<number | null>(null)
  const dayKeyRef = useRef(dayKey)

  useEffect(() => {
    dayKeyRef.current = dayKey
  }, [dayKey])

  useEffect(() => {
    onDayRef.current = onDay
  }, [onDay])

  useEffect(() => {
    onElapsedCheckpointRef.current = onElapsedCheckpoint
  }, [onElapsedCheckpoint])

  useEffect(() => {
    accumulatedRef.current = normalizedInitial
    lastTimestampRef.current = null
    lastCheckpointTimestampRef.current = null
  }, [dayDuration, dayKey, normalizedInitial])

  useEffect(() => {
    let active = true

    const frame: FrameRequestCallback = (timestamp) => {
      if (!active) return
      if (scheduler.isHidden()) {
        lastTimestampRef.current = null
      } else if (lastTimestampRef.current === null) {
        lastTimestampRef.current = timestamp
        lastCheckpointTimestampRef.current = timestamp
      } else {
        const elapsed = Math.max(0, timestamp - lastTimestampRef.current)
        lastTimestampRef.current = timestamp
        if (speed > 0) {
          accumulatedRef.current += elapsed * speed
          if (
            accumulatedRef.current >=
            dayDuration
          ) {
            accumulatedRef.current -= dayDuration
            onElapsedCheckpointRef.current(accumulatedRef.current, false)
            onDayRef.current()
            lastCheckpointTimestampRef.current = timestamp
          } else if (
            lastCheckpointTimestampRef.current === null ||
            timestamp - lastCheckpointTimestampRef.current >= 2_000
          ) {
            onElapsedCheckpointRef.current(accumulatedRef.current, false)
            lastCheckpointTimestampRef.current = timestamp
          }
          setClockView({
            dayKey: dayKeyRef.current,
            progress: accumulatedRef.current / dayDuration,
          })
        }
      }
      frameRef.current = scheduler.requestFrame(frame)
    }

    const unsubscribe = scheduler.onVisibilityChange(() => {
      if (scheduler.isHidden()) {
        onElapsedCheckpointRef.current(accumulatedRef.current, true)
      }
      lastTimestampRef.current = null
      lastCheckpointTimestampRef.current = null
    })
    const flush = () => {
      onElapsedCheckpointRef.current(accumulatedRef.current, true)
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    frameRef.current = scheduler.requestFrame(frame)

    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      if (frameRef.current !== null) scheduler.cancelFrame(frameRef.current)
      frameRef.current = null
      lastTimestampRef.current = null
    }
  }, [dayDuration, scheduler, speed])

  return Object.is(clockView.dayKey, dayKey)
    ? clockView.progress
    : normalizedInitial / dayDuration
}
