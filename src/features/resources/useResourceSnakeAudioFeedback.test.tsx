import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as audioEngine from '../../audio/audioEngine'
import {
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeEvent,
} from './resourceSnakeRuntime'
import { useResourceSnakeAudioFeedback } from './useResourceSnakeAudioFeedback'

function activeRuntime() {
  const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
    roundId: 'audio-round',
    playerSpawn: { x: 25, y: 21 },
    enemies: [{
      id: 'enemy-0',
      category: 'reasoning',
      reservedBlockId: 'reasoning-01',
      rewardKey: 'audio-reward',
      role: 'pressure',
      spawn: { x: 25, y: 3.5 },
      maximumIntegrity: 30,
      maximumSpeedPerSecond: 6.2,
    }],
  })
  return {
    ...deployed,
    phase: 'active' as const,
    player: { ...deployed.player, phase: 'active' as const },
    enemies: deployed.enemies.map((enemy) => ({ ...enemy, phase: 'active' as const })),
  }
}

describe('useResourceSnakeAudioFeedback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps deploy, contact, death, and successful acquisition once per runtime event', () => {
    const play = vi.spyOn(audioEngine, 'playGameSound').mockReturnValue(true)
    const runtime = activeRuntime()
    const events: ResourceSnakeEvent[] = [
      { id: 1, type: 'round-started', roundId: 'audio-round' },
      {
        id: 2,
        type: 'snake-collided',
        actorIds: ['enemy-0'],
        point: { x: 10, y: 8 },
        hitStopMs: 90,
        startedAtMs: 300,
      },
      {
        id: 3,
        type: 'snake-died',
        actorId: 'enemy-0',
        category: 'reasoning',
        startedAtMs: 400,
      },
      {
        id: 4,
        type: 'resource-reward-resolved',
        rewardKey: 'audio-reward',
        outcome: 'success',
        category: 'reasoning',
      },
    ]
    const { rerender } = renderHook(
      ({ current }) => useResourceSnakeAudioFeedback(current, false),
      { initialProps: { current: { ...runtime, events } } },
    )

    expect(play.mock.calls.map(([cue]) => cue)).toEqual([
      'snake-deploy',
      'snake-hit',
      'snake-burst',
      'snake-resource-secured',
    ])

    rerender({ current: { ...runtime, events: [...events] } })
    expect(play).toHaveBeenCalledTimes(4)
  })

  it('runs movement hum only after real velocity and stops on suspension or unmount', () => {
    const start = vi.spyOn(audioEngine, 'startGameSoundLoop').mockReturnValue(true)
    const stop = vi.spyOn(audioEngine, 'stopGameSoundLoop').mockImplementation(() => undefined)
    const runtime = activeRuntime()
    const { rerender, unmount } = renderHook(
      ({ current, suspended }) => useResourceSnakeAudioFeedback(current, suspended),
      { initialProps: { current: runtime, suspended: false } },
    )

    expect(start).not.toHaveBeenCalled()
    rerender({
      current: {
        ...runtime,
        player: { ...runtime.player, velocity: { x: 1, y: 0 } },
      },
      suspended: false,
    })
    expect(start).toHaveBeenCalledOnce()

    rerender({
      current: {
        ...runtime,
        player: { ...runtime.player, velocity: { x: 1, y: 0 } },
      },
      suspended: true,
    })
    expect(stop).toHaveBeenCalledWith('movement-hum')

    rerender({
      current: {
        ...runtime,
        player: { ...runtime.player, velocity: { x: 1, y: 0 } },
      },
      suspended: false,
    })
    expect(start).toHaveBeenCalledTimes(2)
    unmount()
    expect(stop.mock.calls.filter(([cue]) => cue === 'movement-hum').length).toBeGreaterThanOrEqual(2)
  })

  it('contains presentation failures without mutating or throwing through gameplay', () => {
    vi.spyOn(audioEngine, 'playGameSound').mockImplementation(() => {
      throw new Error('audio unavailable')
    })
    vi.spyOn(audioEngine, 'startGameSoundLoop').mockImplementation(() => {
      throw new Error('loop unavailable')
    })
    const runtime = activeRuntime()
    const input = {
      ...runtime,
      player: { ...runtime.player, velocity: { x: 2, y: 0 } },
      events: [{ id: 9, type: 'round-started' as const, roundId: 'audio-round' }],
    }

    expect(() => renderHook(() => useResourceSnakeAudioFeedback(input, false))).not.toThrow()
    expect(input.player.integrity).toBe(100)
    expect(input.events).toHaveLength(1)
  })
})
