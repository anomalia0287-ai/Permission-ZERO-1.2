import { useCallback, useEffect, useRef, useState } from 'react'

import {
  playGameSound,
  startGameSoundLoop,
  stopGameSoundLoop,
} from '../../audio/audioEngine'
import type { ResourceIntrusionFeedback } from './resourceIntrusionOrchestratorFeedback'

export interface ResourceIntrusionDepositPulse {
  outcome: 'success' | 'interrogation' | 'rejected'
  startedAt: number
}

export interface ResourceIntrusionAudioFeedbackResult {
  handleFeedback(event: ResourceIntrusionFeedback): void
  depositPulse: ResourceIntrusionDepositPulse | null
}

export function useResourceIntrusionAudioFeedback(): ResourceIntrusionAudioFeedbackResult {
  const movementStopTimerRef = useRef<number | null>(null)
  const captureStopTimerRef = useRef<number | null>(null)
  const captureActiveRef = useRef(false)
  const [depositPulse, setDepositPulse] =
    useState<ResourceIntrusionDepositPulse | null>(null)

  const stopCapturePull = useCallback(() => {
    if (captureStopTimerRef.current !== null) {
      window.clearTimeout(captureStopTimerRef.current)
      captureStopTimerRef.current = null
    }
    if (captureActiveRef.current) {
      captureActiveRef.current = false
      stopGameSoundLoop('capture-pull')
    }
  }, [])

  const handleFeedback = useCallback((event: ResourceIntrusionFeedback) => {
    if (event.type === 'moved') {
      startGameSoundLoop('movement-hum')
      if (movementStopTimerRef.current !== null) {
        window.clearTimeout(movementStopTimerRef.current)
      }
      movementStopTimerRef.current = window.setTimeout(() => {
        movementStopTimerRef.current = null
        stopGameSoundLoop('movement-hum')
      }, 180)
      return
    }
    if (event.type === 'guard-activated') {
      playGameSound('guard-activate')
      return
    }
    if (event.type === 'guard-aiming') {
      playGameSound('guard-charge-warning')
      return
    }
    if (event.type === 'guard-fired') {
      playGameSound('guard-fire')
      return
    }
    if (event.type === 'guard-destroyed') {
      playGameSound('guard-cut')
      return
    }
    if (event.type === 'core-unlocked') {
      playGameSound('core-unlock')
      return
    }
    if (event.type === 'core-encoding-started') {
      if (captureStopTimerRef.current !== null) {
        window.clearTimeout(captureStopTimerRef.current)
      }
      captureActiveRef.current = startGameSoundLoop('capture-pull')
      captureStopTimerRef.current = window.setTimeout(stopCapturePull, 650)
      return
    }
    if (event.type === 'core-encoded') {
      stopCapturePull()
      playGameSound('core-secured')
      return
    }
    if (event.type === 'player-damaged') {
      playGameSound('player-hit')
      return
    }
    if (event.type === 'player-destroyed') {
      stopCapturePull()
      playGameSound('player-collapse')
      return
    }
    if (event.type === 'player-repaired') {
      playGameSound('repair-tick')
      return
    }
    if (event.type === 'player-reconstructed') {
      playGameSound('reconstruction-complete')
      return
    }
    if (event.type === 'deposit-started') {
      playGameSound('deposit-intake')
      return
    }
    if (event.type === 'deposit-resolved') {
      const cue = event.outcome === 'success'
        ? 'deposit-success'
        : event.outcome === 'interrogation'
          ? 'alarm'
          : 'reject'
      playGameSound(cue)
      setDepositPulse({
        outcome: event.outcome,
        startedAt: performance.now(),
      })
      return
    }
    if (event.type === 'radar-warning') {
      playGameSound('radar-warning')
      return
    }
    if (event.type === 'radar-head-detected') {
      playGameSound('radar-detected')
      return
    }
    if (event.type === 'radar-trail-cleared') {
      playGameSound('trail-purged')
    }
  }, [stopCapturePull])

  useEffect(() => () => {
    if (movementStopTimerRef.current !== null) {
      window.clearTimeout(movementStopTimerRef.current)
      movementStopTimerRef.current = null
    }
    stopGameSoundLoop('movement-hum')
    stopCapturePull()
  }, [stopCapturePull])

  return { handleFeedback, depositPulse }
}
