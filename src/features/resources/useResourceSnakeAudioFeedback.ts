import { useEffect, useRef } from 'react'

import {
  playGameSound,
  startGameSoundLoop,
  stopGameSoundLoop,
} from '../../audio/audioEngine'
import type { GameSoundCue } from '../../audio/gameSounds'
import type {
  ResourceSnakeEvent,
  ResourceSnakeRoundState,
} from './resourceSnakeRuntime'

function eventCue(event: ResourceSnakeEvent): GameSoundCue | null {
  switch (event.type) {
    case 'round-started':
      return 'snake-deploy'
    case 'snake-collided':
      return 'snake-hit'
    case 'snake-died':
      return 'snake-burst'
    case 'resource-reward-resolved':
      return event.outcome === 'success' ? 'snake-resource-secured' : null
    default:
      return null
  }
}

function stopMovementLoopSafely(activeRef: { current: boolean }): void {
  if (!activeRef.current) return
  activeRef.current = false
  try {
    stopGameSoundLoop('movement-hum')
  } catch {
    // Presentation failures must never cross into the simulation boundary.
  }
}

export function useResourceSnakeAudioFeedback(
  runtime: ResourceSnakeRoundState,
  runtimeSuspended: boolean,
): void {
  const highestEventByRoundRef = useRef(new Map<string, number>())
  const movementLoopActiveRef = useRef(false)
  const moving = runtime.phase === 'active'
    && !runtimeSuspended
    && Math.hypot(runtime.player.velocity.x, runtime.player.velocity.y) > 0.05

  useEffect(() => {
    const roundKey = runtime.roundId ?? 'idle'
    let highestEventId = highestEventByRoundRef.current.get(roundKey) ?? 0
    for (const event of runtime.events) {
      if (event.id <= highestEventId) continue
      highestEventId = event.id
      const cue = eventCue(event)
      if (!cue) continue
      try {
        playGameSound(cue)
      } catch {
        // Audio is optional feedback; runtime events remain authoritative.
      }
    }
    highestEventByRoundRef.current.set(roundKey, highestEventId)
    while (highestEventByRoundRef.current.size > 32) {
      const oldest = highestEventByRoundRef.current.keys().next().value
      if (oldest === undefined) break
      highestEventByRoundRef.current.delete(oldest)
    }
  }, [runtime.events, runtime.roundId])

  useEffect(() => {
    if (!moving) {
      stopMovementLoopSafely(movementLoopActiveRef)
      return
    }
    if (movementLoopActiveRef.current) return
    try {
      movementLoopActiveRef.current = startGameSoundLoop('movement-hum')
    } catch {
      movementLoopActiveRef.current = false
    }
  }, [moving])

  useEffect(() => () => {
    stopMovementLoopSafely(movementLoopActiveRef)
  }, [])
}
