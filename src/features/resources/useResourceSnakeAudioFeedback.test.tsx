import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as audioEngine from '../../audio/audioEngine'
import {
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeEvent,
} from './resourceSnakeRuntime'
import type { ResourceSnakeTelegraph } from './resourceSnakeAiController'
import {
  useResourceSnakeAudioFeedback,
} from './useResourceSnakeAudioFeedback'

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

  it('deduplicates multiple collision records emitted in the same simulation frame', () => {
    const play = vi.spyOn(audioEngine, 'playGameSound').mockReturnValue(true)
    const runtime = activeRuntime()
    const collision = {
      type: 'snake-collided' as const,
      actorIds: ['enemy-0' as const],
      point: { x: 10, y: 8 },
      hitStopMs: 90 as const,
      startedAtMs: 300,
    }

    renderHook(() => useResourceSnakeAudioFeedback({
      ...runtime,
      events: [
        { id: 1, ...collision },
        { id: 2, ...collision, actorIds: ['player', 'enemy-0'] },
      ],
    }, false))

    expect(play.mock.calls.filter(([cue]) => cue === 'snake-hit')).toHaveLength(1)
  })

  it('runs rail flow only after real velocity and stops on suspension or unmount', () => {
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
    expect(stop).toHaveBeenCalledWith('rail-flow')

    rerender({
      current: {
        ...runtime,
        player: { ...runtime.player, velocity: { x: 1, y: 0 } },
      },
      suspended: false,
    })
    expect(start).toHaveBeenCalledTimes(2)
    unmount()
    expect(stop.mock.calls.filter(([cue]) => cue === 'rail-flow').length).toBeGreaterThanOrEqual(2)
  })

  it('deduplicates cyan telegraph, rail-break, and queued/applied/rejected intent cues', () => {
    const play = vi.spyOn(audioEngine, 'playGameSound').mockReturnValue(true)
    const runtime = {
      ...activeRuntime(),
      events: [
        {
          id: 6,
          type: 'snake-damaged' as const,
          actorId: 'enemy-0' as const,
          integrity: 10,
          maximumIntegrity: 30,
        },
        {
          id: 7,
          type: 'snake-turn-queued' as const,
          heading: 'east' as const,
          inputAtMs: 610,
          startedAtMs: 610,
        },
        {
          id: 8,
          type: 'snake-turn-committed' as const,
          heading: 'east' as const,
          inputAtMs: 610,
          startedAtMs: 620,
        },
        {
          id: 9,
          type: 'snake-turn-rejected' as const,
          requestedHeading: 'west' as const,
          reason: 'reverse' as const,
          inputAtMs: 630,
          startedAtMs: 630,
        },
      ],
    }
    const telegraphs: ResourceSnakeTelegraph[] = [{
      enemyId: 'enemy-0',
      role: 'pressure',
      originHeading: 'south',
      attackHeading: 'south-west',
      startedAtMs: 600,
      untilMs: 780,
      path: [{ x: 20, y: 4 }, { x: 18, y: 6 }],
    }]
    const feedback = { telegraphs }
    const { rerender } = renderHook(
      ({ current }) => useResourceSnakeAudioFeedback(current, false, feedback),
      { initialProps: { current: runtime } },
    )

    expect(play.mock.calls.map(([cue]) => cue)).toEqual([
      'snake-rail-break',
      'snake-turn-queued',
      'snake-turn-committed',
      'snake-turn-rejected',
      'snake-cyan-telegraph',
    ])

    rerender({ current: { ...runtime, events: [...runtime.events] } })
    expect(play).toHaveBeenCalledTimes(5)
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
