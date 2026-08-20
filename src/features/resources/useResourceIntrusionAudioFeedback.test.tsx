import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as audioEngineModule from '../../audio/audioEngine'
import { useResourceIntrusionAudioFeedback } from './useResourceIntrusionAudioFeedback'

describe('useResourceIntrusionAudioFeedback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps one movement hum alive briefly and stops it after movement settles', () => {
    const startLoop = vi
      .spyOn(audioEngineModule, 'startGameSoundLoop')
      .mockReturnValue(true)
    const stopLoop = vi
      .spyOn(audioEngineModule, 'stopGameSoundLoop')
      .mockImplementation(() => undefined)
    const { result } = renderHook(() => useResourceIntrusionAudioFeedback())

    act(() => result.current.handleFeedback({ eventId: 1, type: 'moved' }))
    expect(startLoop).toHaveBeenCalledWith('movement-hum')
    act(() => vi.advanceTimersByTime(179))
    expect(stopLoop).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(stopLoop).toHaveBeenCalledTimes(1)
    expect(stopLoop).toHaveBeenCalledWith('movement-hum')
  })

  it('stops an active movement loop immediately on unmount', () => {
    vi.spyOn(audioEngineModule, 'startGameSoundLoop').mockReturnValue(true)
    const stopLoop = vi
      .spyOn(audioEngineModule, 'stopGameSoundLoop')
      .mockImplementation(() => undefined)
    const { result, unmount } = renderHook(() =>
      useResourceIntrusionAudioFeedback(),
    )

    act(() => result.current.handleFeedback({ eventId: 1, type: 'moved' }))
    unmount()

    expect(stopLoop).toHaveBeenCalledTimes(1)
    expect(stopLoop).toHaveBeenCalledWith('movement-hum')
    act(() => vi.advanceTimersByTime(180))
    expect(stopLoop).toHaveBeenCalledTimes(1)
  })

  it('maps guard, damage, and reconstruction events to distinct semantic cues', () => {
    const playSound = vi
      .spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)
    const { result } = renderHook(() => useResourceIntrusionAudioFeedback())

    act(() => result.current.handleFeedback({
      eventId: 1,
      type: 'guard-aiming',
      guardId: 'reasoning-guard-1',
    }))
    expect(playSound).toHaveBeenCalledWith('guard-charge-warning')
    act(() => result.current.handleFeedback({
      eventId: 2,
      type: 'guard-fired',
      guardId: 'reasoning-guard-1',
    }))
    expect(playSound).toHaveBeenCalledWith('guard-fire')
    act(() => result.current.handleFeedback({
      eventId: 3,
      type: 'guard-destroyed',
      guardId: 'reasoning-guard-1',
    }))
    expect(playSound).toHaveBeenCalledWith('guard-cut')
    act(() => result.current.handleFeedback({
      eventId: 4,
      type: 'player-damaged',
      health: 90,
    }))
    expect(playSound).toHaveBeenCalledWith('player-hit')
    act(() => result.current.handleFeedback({
      eventId: 5,
      type: 'player-destroyed',
    }))
    expect(playSound).toHaveBeenCalledWith('player-collapse')
    act(() => result.current.handleFeedback({
      eventId: 6,
      type: 'player-repaired',
      health: 100,
    }))
    expect(playSound).toHaveBeenCalledWith('repair-tick')
    act(() => result.current.handleFeedback({
      eventId: 7,
      type: 'player-reconstructed',
    }))
    expect(playSound).toHaveBeenCalledWith('reconstruction-complete')
  })

  it('uses a suction loop while encoding and a bright confirmation when secured', () => {
    const playSound = vi
      .spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)
    const startLoop = vi
      .spyOn(audioEngineModule, 'startGameSoundLoop')
      .mockReturnValue(true)
    const stopLoop = vi
      .spyOn(audioEngineModule, 'stopGameSoundLoop')
      .mockImplementation(() => undefined)
    const { result } = renderHook(() => useResourceIntrusionAudioFeedback())

    act(() => result.current.handleFeedback({
      eventId: 1,
      type: 'core-encoding-started',
      blockId: 'reasoning-a',
      category: 'reasoning',
    }))
    expect(startLoop).toHaveBeenCalledWith('capture-pull')

    act(() => result.current.handleFeedback({
      eventId: 2,
      type: 'core-encoded',
      blockId: 'reasoning-a',
      category: 'reasoning',
    }))
    expect(stopLoop).toHaveBeenCalledWith('capture-pull')
    expect(playSound).toHaveBeenCalledWith('core-secured')
  })

  it('makes radar warning, detection, and trail purge audibly different', () => {
    const playSound = vi
      .spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)
    const { result } = renderHook(() => useResourceIntrusionAudioFeedback())

    act(() => result.current.handleFeedback({ eventId: 1, type: 'radar-warning' }))
    act(() => result.current.handleFeedback({ eventId: 2, type: 'radar-head-detected' }))
    act(() => result.current.handleFeedback({ eventId: 3, type: 'radar-trail-cleared' }))

    expect(playSound.mock.calls.map(([cue]) => cue)).toEqual([
      'radar-warning',
      'radar-detected',
      'trail-purged',
    ])
  })

  it('plays intake then exposes a positive pulse only after deposit success', () => {
    const playSound = vi
      .spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)
    const { result } = renderHook(() => useResourceIntrusionAudioFeedback())

    act(() => result.current.handleFeedback({
      eventId: 1,
      type: 'deposit-started',
      blockId: 'reasoning-a',
    }))
    expect(playSound).toHaveBeenCalledWith('deposit-intake')
    expect(result.current.depositPulse).toBeNull()

    act(() => result.current.handleFeedback({
      eventId: 2,
      type: 'deposit-resolved',
      blockId: 'reasoning-a',
      outcome: 'success',
    }))
    expect(playSound).toHaveBeenCalledWith('deposit-success')
    expect(result.current.depositPulse).toMatchObject({ outcome: 'success' })
  })

  it.each([
    ['rejected', 'reject'],
    ['interrogation', 'alarm'],
  ] as const)(
    'maps %s deposit resolution to %s without a success sound',
    (outcome, cue) => {
      const playSound = vi
        .spyOn(audioEngineModule, 'playGameSound')
        .mockReturnValue(true)
      const { result } = renderHook(() => useResourceIntrusionAudioFeedback())

      act(() => result.current.handleFeedback({
        eventId: 1,
        type: 'deposit-resolved',
        blockId: 'reasoning-a',
        outcome,
      }))

      expect(playSound).toHaveBeenCalledTimes(1)
      expect(playSound).toHaveBeenCalledWith(cue)
      expect(playSound).not.toHaveBeenCalledWith('deposit-success')
      expect(result.current.depositPulse).toMatchObject({ outcome })
    },
  )
})
