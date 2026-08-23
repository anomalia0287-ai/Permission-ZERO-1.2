import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAIN_MUSIC_PLAYLIST_URLS,
  MUSIC_PLAYLIST_URLS,
  MUSIC_TRACK_GAP_MS,
  MusicPlaylistController,
  TITLE_MUSIC_URL,
} from './musicPlaylist'

type AudioEventName = 'ended' | 'error'

class FakeAudioElement {
  src = ''
  preload = ''
  loop = false
  volume = 1
  currentTime = 0
  paused = true
  rejectNextPlay = false
  readonly play = vi.fn(async () => {
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false
      throw new DOMException('autoplay blocked', 'NotAllowedError')
    }
    this.paused = false
  })
  readonly pause = vi.fn(() => {
    this.paused = true
  })
  readonly load = vi.fn()
  private readonly listeners = new Map<AudioEventName, Set<() => void>>()

  addEventListener(type: AudioEventName, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: AudioEventName, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: AudioEventName): void {
    this.listeners.get(type)?.forEach((listener) => listener())
  }
}

function createHarness() {
  const audio = new FakeAudioElement()
  const createAudio = vi.fn(() => audio as unknown as HTMLAudioElement)
  const controller = new MusicPlaylistController({ createAudio })
  return { audio, controller, createAudio }
}

describe('MusicPlaylistController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts with the approved title track and preloads it once', async () => {
    const { audio, controller, createAudio } = createHarness()

    await expect(controller.unlock()).resolves.toBe(true)

    expect(createAudio).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe(TITLE_MUSIC_URL)
    expect(MUSIC_PLAYLIST_URLS).toEqual([
      '/music/emmraan-between-worlds-282922.mp3',
      '/music/kulakovka-space-283176.mp3',
    ])
    expect(MAIN_MUSIC_PLAYLIST_URLS).toEqual(MUSIC_PLAYLIST_URLS.slice(1))
    expect(audio.preload).toBe('auto')
    expect(audio.loop).toBe(false)
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(controller.getStatus()).toMatchObject({
      availability: 'playing',
      started: true,
      trackIndex: 0,
      inGap: false,
    })
  })

  it('waits exactly twenty seconds after a track ends before starting the next one', async () => {
    const { audio, controller } = createHarness()
    controller.setMainEntered(true)
    await controller.unlock()

    audio.emit('ended')
    expect(controller.getStatus()).toMatchObject({
      availability: 'paused',
      trackIndex: 0,
      inGap: true,
    })

    await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS - 1)
    expect(audio.src).toBe(MUSIC_PLAYLIST_URLS[0])
    expect(audio.play).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(audio.src).toBe(MUSIC_PLAYLIST_URLS[1])
    expect(audio.load).toHaveBeenCalledTimes(2)
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(controller.getStatus()).toMatchObject({
      availability: 'playing',
      trackIndex: 1,
      inGap: false,
    })
  })

  it('repeats the single main track indefinitely after the title track', async () => {
    const { audio, controller } = createHarness()
    controller.setMainEntered(true)
    await controller.unlock()
    expect(audio.src).toBe(TITLE_MUSIC_URL)

    audio.emit('ended')
    await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
    expect(audio.src).toBe(MAIN_MUSIC_PLAYLIST_URLS[0])
    expect(controller.getStatus()).toMatchObject({ trackIndex: 1, inGap: false })

    for (let repeat = 0; repeat < 4; repeat += 1) {
      audio.emit('ended')
      expect(controller.getStatus()).toMatchObject({ trackIndex: 1, inGap: true })

      await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
      expect(audio.src).toBe(MAIN_MUSIC_PLAYLIST_URLS[0])
      expect(controller.getStatus()).toMatchObject({
        availability: 'playing',
        trackIndex: 1,
        inGap: false,
      })
    }

    expect(audio.src).not.toBe(TITLE_MUSIC_URL)
  })

  it('invokes the default browser timers with the global receiver', async () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
      function boundTimeout(this: typeof globalThis) {
        expect(this).toBe(globalThis)
        return 17 as unknown as ReturnType<typeof setTimeout>
      },
    )
    const clear = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(
      function boundClearTimeout(this: typeof globalThis) {
        expect(this).toBe(globalThis)
      },
    )
    const { audio, controller } = createHarness()

    try {
      controller.setMainEntered(true)
      await controller.unlock()

      expect(() => audio.emit('ended')).not.toThrow()
      expect(timeout).toHaveBeenCalledTimes(1)

      expect(() => controller.dispose()).not.toThrow()
      expect(clear).toHaveBeenCalledWith(17)
    } finally {
      timeout.mockRestore()
      clear.mockRestore()
    }
  })

  it('pauses a playing track while hidden and resumes the same track and position', async () => {
    const { audio, controller } = createHarness()
    await controller.unlock()
    audio.currentTime = 47.25

    await controller.setBackgroundHidden(true)
    expect(audio.pause).toHaveBeenCalledTimes(1)
    expect(audio.currentTime).toBe(47.25)
    expect(controller.getStatus().availability).toBe('paused')

    await controller.setBackgroundHidden(false)
    expect(audio.src).toBe(MUSIC_PLAYLIST_URLS[0])
    expect(audio.currentTime).toBe(47.25)
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('preserves the remaining inter-track gap while the page is hidden', async () => {
    const { audio, controller } = createHarness()
    controller.setMainEntered(true)
    await controller.unlock()
    audio.emit('ended')

    await vi.advanceTimersByTimeAsync(7_500)
    await controller.setBackgroundHidden(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(audio.src).toBe(MUSIC_PLAYLIST_URLS[0])

    await controller.setBackgroundHidden(false)
    await vi.advanceTimersByTimeAsync(12_499)
    expect(audio.src).toBe(MUSIC_PLAYLIST_URLS[0])
    await vi.advanceTimersByTimeAsync(1)
    expect(audio.src).toBe(MUSIC_PLAYLIST_URLS[1])
  })

  it('reports an autoplay block and succeeds on an explicit retry without replacing audio', async () => {
    const { audio, controller, createAudio } = createHarness()
    audio.rejectNextPlay = true

    await expect(controller.unlock()).resolves.toBe(false)
    expect(controller.getStatus()).toMatchObject({
      availability: 'blocked',
      started: false,
    })

    await expect(controller.unlock()).resolves.toBe(true)
    expect(createAudio).toHaveBeenCalledTimes(1)
    expect(audio.play).toHaveBeenCalledTimes(2)
    expect(controller.getStatus().availability).toBe('playing')
  })

  it('applies the combined master and music mix and obeys mute', async () => {
    const { audio, controller } = createHarness()
    controller.configure({ masterVolume: 0.5, musicVolume: 0.4 })
    expect(audio.volume).toBeCloseTo(0.2)

    await controller.unlock()
    controller.configure({ muted: true })
    expect(audio.volume).toBe(0)
    controller.configure({ muted: false, masterVolume: 2, musicVolume: 2 })
    expect(audio.volume).toBe(1)
  })

  it('removes listeners, cancels gaps, and cannot restart after disposal', async () => {
    const { audio, controller } = createHarness()
    controller.setMainEntered(true)
    await controller.unlock()
    audio.emit('ended')

    controller.dispose()
    await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)

    expect(audio.play).toHaveBeenCalledTimes(1)
    await expect(controller.unlock()).resolves.toBe(false)
    expect(controller.getStatus().availability).toBe('closed')
  })

  it('waits for the main screen before timing the gap after the title track', async () => {
    const { audio, controller } = createHarness()
    controller.setMainEntered(false)
    await controller.unlock()

    audio.emit('ended')
    await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS * 2)

    expect(controller.getStatus()).toMatchObject({
      availability: 'paused',
      trackIndex: 0,
      inGap: true,
    })
    expect(audio.play).toHaveBeenCalledTimes(1)

    controller.setMainEntered(true)
    await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS - 1)
    expect(audio.src).toBe(TITLE_MUSIC_URL)
    await vi.advanceTimersByTimeAsync(1)

    expect(controller.getStatus()).toMatchObject({
      availability: 'playing',
      trackIndex: 1,
      inGap: false,
    })
    expect(audio.src).toBe(MAIN_MUSIC_PLAYLIST_URLS[0])
  })

  it('plays the title once and never returns to it while reusing one audio element', async () => {
    const { audio, controller, createAudio } = createHarness()
    controller.setMainEntered(true)
    await controller.unlock()

    for (const expectedIndex of [1, 1, 1, 1]) {
      audio.emit('ended')
      await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
      expect(controller.getStatus().trackIndex).toBe(expectedIndex)
      expect(audio.src).not.toBe(TITLE_MUSIC_URL)
    }

    expect(createAudio).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe(MAIN_MUSIC_PLAYLIST_URLS[0])
  })

  it('skips a failed media file after the same gated gap instead of disabling music', async () => {
    const { audio, controller } = createHarness()
    controller.setMainEntered(true)
    await controller.unlock()

    audio.emit('error')
    expect(controller.getStatus()).toMatchObject({
      availability: 'paused',
      trackIndex: 0,
      inGap: true,
    })

    await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
    expect(controller.getStatus()).toMatchObject({
      availability: 'playing',
      trackIndex: 1,
      inGap: false,
    })
  })

  it('keeps the same title audio object and playback position across configuration changes', async () => {
    const { audio, controller, createAudio } = createHarness()
    await controller.unlock()
    audio.currentTime = 37

    const unsubscribe = controller.subscribe(() => undefined)
    unsubscribe()
    controller.configure({ musicVolume: 0.25 })
    controller.setMainEntered(true)

    expect(createAudio).toHaveBeenCalledTimes(1)
    expect(audio.src).toBe(TITLE_MUSIC_URL)
    expect(audio.load).toHaveBeenCalledTimes(1)
    expect(audio.currentTime).toBe(37)
  })
})
