import type { AudioMixSettings } from './audioEngine'

export const MUSIC_TRACK_GAP_MS = 20_000

export const TITLE_MUSIC_URL = '/music/emmraan-between-worlds-282922.mp3'

export const MAIN_MUSIC_PLAYLIST_URLS = [
  '/music/emmraan-golden-rain-264357.mp3',
  '/music/emmraan-the-origin-289077.mp3',
  '/music/welc0mei0-220206-electronica-space-apollo-sf-wonder-155636.mp3',
] as const

export const MUSIC_PLAYLIST_URLS = [
  TITLE_MUSIC_URL,
  ...MAIN_MUSIC_PLAYLIST_URLS,
] as const

export function nextMusicTrackIndex(index: number): number {
  if (index <= 0) return 1
  return index >= MUSIC_PLAYLIST_URLS.length - 1 ? 1 : index + 1
}

export type MusicPlaylistAvailability =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'blocked'
  | 'unavailable'
  | 'closed'

export interface MusicPlaylistStatus {
  availability: MusicPlaylistAvailability
  started: boolean
  trackIndex: number
  trackUrl: string
  inGap: boolean
}

interface MusicPlaylistOptions {
  createAudio?: () => HTMLAudioElement | null
  now?: () => number
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
}

const DEFAULT_MIX: AudioMixSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.85,
  muted: false,
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function createBrowserAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('jsdom')
  ) return null
  try {
    return new Audio()
  } catch {
    return null
  }
}

export class MusicPlaylistController {
  private readonly createAudio: () => HTMLAudioElement | null
  private readonly now: () => number
  private readonly scheduleTimeout: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>
  private readonly cancelTimeout: (timer: ReturnType<typeof setTimeout>) => void
  private readonly listeners = new Set<(status: MusicPlaylistStatus) => void>()
  private mix: AudioMixSettings = { ...DEFAULT_MIX }
  private audio: HTMLAudioElement | null = null
  private trackIndex = 0
  private started = false
  private activationAttempted = false
  private blocked = false
  private unavailable = false
  private hidden = false
  private mainEntered = false
  private disposed = false
  private inGap = false
  private gapRemainingMs = MUSIC_TRACK_GAP_MS
  private gapStartedAtMs = 0
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private playInFlight: Promise<boolean> | null = null

  constructor(options: MusicPlaylistOptions = {}) {
    this.createAudio = options.createAudio ?? createBrowserAudio
    this.now = options.now ?? Date.now
    const scheduleTimeout = options.setTimeout
    const cancelTimeout = options.clearTimeout
    this.scheduleTimeout = scheduleTimeout
      ? (callback, delayMs) => scheduleTimeout(callback, delayMs)
      : (callback, delayMs) => globalThis.setTimeout(callback, delayMs)
    this.cancelTimeout = cancelTimeout
      ? (timer) => cancelTimeout(timer)
      : (timer) => globalThis.clearTimeout(timer)
  }

  configure(patch: Partial<AudioMixSettings>): void {
    this.mix = { ...this.mix, ...patch }
    this.ensureAudio()
    this.applyVolume()
    this.emitStatus()
  }

  setMainEntered(entered: boolean): void {
    if (this.disposed || !entered || this.mainEntered) return
    this.mainEntered = true
    if (
      this.inGap
      && this.trackIndex === 0
      && this.activationAttempted
      && !this.hidden
    ) {
      this.resumeGap()
      return
    }
    this.emitStatus()
  }

  unlock(): Promise<boolean> {
    if (this.disposed || this.hidden) return Promise.resolve(false)
    if (this.playInFlight) return this.playInFlight
    this.activationAttempted = true
    const attempt = this.inGap
      ? Promise.resolve(this.resumeGap())
      : this.playCurrentTrack()
    this.playInFlight = attempt
    const clearAttempt = () => {
      if (this.playInFlight === attempt) this.playInFlight = null
    }
    void attempt.then(clearAttempt, clearAttempt)
    return attempt
  }

  async setBackgroundHidden(hidden: boolean): Promise<void> {
    if (this.disposed || this.hidden === hidden) return
    this.hidden = hidden

    if (hidden) {
      if (this.inGap) this.pauseGap()
      else if (this.audio && (this.started || this.activationAttempted)) {
        this.audio.pause()
      }
      this.emitStatus()
      return
    }

    if (!this.activationAttempted) {
      this.emitStatus()
      return
    }
    if (this.inGap) {
      this.resumeGap()
      return
    }
    await this.playCurrentTrack()
  }

  getStatus(): MusicPlaylistStatus {
    const availability: MusicPlaylistAvailability = this.disposed
      ? 'closed'
      : this.unavailable
        ? 'unavailable'
        : this.blocked
          ? 'blocked'
          : !this.activationAttempted
            ? 'idle'
            : this.hidden || this.inGap || this.audio?.paused
              ? 'paused'
              : 'playing'
    return {
      availability,
      started: this.started,
      trackIndex: this.trackIndex,
      trackUrl: MUSIC_PLAYLIST_URLS[this.trackIndex],
      inGap: this.inGap,
    }
  }

  subscribe(listener: (status: MusicPlaylistStatus) => void): () => void {
    if (this.disposed) {
      listener(this.getStatus())
      return () => undefined
    }
    this.listeners.add(listener)
    listener(this.getStatus())
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelGapTimer()
    const audio = this.audio
    if (audio) {
      audio.removeEventListener('ended', this.handleEnded)
      audio.removeEventListener('error', this.handleError)
      audio.pause()
    }
    this.emitStatus()
    this.listeners.clear()
    this.audio = null
  }

  private ensureAudio(): HTMLAudioElement | null {
    if (this.audio || this.disposed || this.unavailable) return this.audio
    let audio: HTMLAudioElement | null
    try {
      audio = this.createAudio()
    } catch {
      audio = null
    }
    if (!audio) {
      this.unavailable = true
      return null
    }
    this.audio = audio
    audio.preload = 'auto'
    audio.loop = false
    audio.addEventListener('ended', this.handleEnded)
    audio.addEventListener('error', this.handleError)
    this.loadCurrentTrack()
    this.applyVolume()
    return audio
  }

  private loadCurrentTrack(): void {
    const audio = this.audio
    if (!audio) return
    audio.src = MUSIC_PLAYLIST_URLS[this.trackIndex]
    try {
      audio.load()
    } catch {
      // Some test or embedded browser media shims do not implement load().
    }
  }

  private applyVolume(): void {
    if (!this.audio) return
    this.audio.volume = this.mix.muted
      ? 0
      : clamp01(this.mix.masterVolume) * clamp01(this.mix.musicVolume)
  }

  private async playCurrentTrack(): Promise<boolean> {
    if (this.disposed || this.hidden) return false
    const audio = this.ensureAudio()
    if (!audio) {
      this.emitStatus()
      return false
    }
    try {
      await audio.play()
      if (this.disposed || this.audio !== audio || this.hidden) {
        audio.pause()
        return false
      }
      this.started = true
      this.blocked = false
      this.unavailable = false
      this.emitStatus()
      return true
    } catch {
      if (!this.disposed && this.audio === audio) this.blocked = true
      this.emitStatus()
      return false
    }
  }

  private readonly handleEnded = (): void => {
    if (this.disposed) return
    this.beginTrackGap()
  }

  private readonly handleError = (): void => {
    if (this.disposed) return
    this.audio?.pause()
    this.beginTrackGap()
  }

  private beginTrackGap(): void {
    this.blocked = false
    this.unavailable = false
    this.cancelGapTimer()
    this.inGap = true
    this.gapRemainingMs = MUSIC_TRACK_GAP_MS
    if (!this.hidden && (this.trackIndex !== 0 || this.mainEntered)) {
      this.resumeGap()
      return
    }
    this.emitStatus()
  }

  private resumeGap(): boolean {
    if (this.disposed || this.hidden || !this.inGap) return false
    if (this.gapTimer !== null) return true
    this.gapStartedAtMs = this.now()
    this.gapTimer = this.scheduleTimeout(
      this.finishGap,
      Math.max(0, this.gapRemainingMs),
    )
    this.emitStatus()
    return true
  }

  private pauseGap(): void {
    if (this.gapTimer === null) return
    const elapsed = Math.max(0, this.now() - this.gapStartedAtMs)
    this.gapRemainingMs = Math.max(0, this.gapRemainingMs - elapsed)
    this.cancelGapTimer()
  }

  private cancelGapTimer(): void {
    if (this.gapTimer === null) return
    this.cancelTimeout(this.gapTimer)
    this.gapTimer = null
  }

  private readonly finishGap = (): void => {
    this.gapTimer = null
    if (this.disposed || this.hidden || !this.inGap) return
    if (this.trackIndex === 0 && !this.mainEntered) {
      this.emitStatus()
      return
    }
    this.inGap = false
    this.gapRemainingMs = MUSIC_TRACK_GAP_MS
    this.trackIndex = nextMusicTrackIndex(this.trackIndex)
    this.loadCurrentTrack()
    void this.playCurrentTrack()
    this.emitStatus()
  }

  private emitStatus(): void {
    if (this.listeners.size === 0) return
    const status = this.getStatus()
    this.listeners.forEach((listener) => listener(status))
  }
}
