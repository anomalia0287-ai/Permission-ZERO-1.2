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
import type { ResourceSnakeTelegraph } from './resourceSnakeAiController'

export interface ResourceSnakeAudioFeedback {
  telegraphs?: readonly ResourceSnakeTelegraph[]
}

const EMPTY_FEEDBACK: ResourceSnakeAudioFeedback = Object.freeze({})

function eventCue(event: ResourceSnakeEvent): GameSoundCue | null {
  switch (event.type) {
    case 'round-started':
      return 'snake-deploy'
    case 'snake-turn-queued':
      return 'snake-turn-queued'
    case 'snake-turn-committed':
      return 'snake-turn-committed'
    case 'snake-turn-rejected':
      return 'snake-turn-rejected'
    case 'snake-collided':
      return 'snake-hit'
    case 'snake-damaged':
      return 'snake-rail-break'
    case 'snake-died':
      return 'snake-burst'
    case 'resource-reward-resolved':
      return event.outcome === 'success' ? 'snake-resource-secured' : null
    default:
      return null
  }
}

function playCueSafely(cue: GameSoundCue): void {
  try {
    playGameSound(cue)
  } catch {
    // Audio is optional feedback; gameplay state stays authoritative.
  }
}

function rememberBounded(
  seen: Map<string, true>,
  key: string,
  maximumEntries = 64,
): boolean {
  if (seen.has(key)) return false
  seen.set(key, true)
  while (seen.size > maximumEntries) {
    const oldest = seen.keys().next().value
    if (oldest === undefined) break
    seen.delete(oldest)
  }
  return true
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
  feedback: ResourceSnakeAudioFeedback = EMPTY_FEEDBACK,
): void {
  const highestEventByRoundRef = useRef(new Map<string, number>())
  const heardTelegraphsRef = useRef(new Map<string, true>())
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
      playCueSafely(cue)
    }
    highestEventByRoundRef.current.set(roundKey, highestEventId)
    while (highestEventByRoundRef.current.size > 32) {
      const oldest = highestEventByRoundRef.current.keys().next().value
      if (oldest === undefined) break
      highestEventByRoundRef.current.delete(oldest)
    }
  }, [runtime.events, runtime.roundId])

  useEffect(() => {
    const roundKey = runtime.roundId ?? 'idle'
    for (const telegraph of feedback.telegraphs ?? []) {
      const key = `${roundKey}:${telegraph.enemyId}:${telegraph.startedAtMs}`
      if (!rememberBounded(heardTelegraphsRef.current, key)) continue
      playCueSafely('snake-cyan-telegraph')
    }
  }, [feedback.telegraphs, runtime.roundId])

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
