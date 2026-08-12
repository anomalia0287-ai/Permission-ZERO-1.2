import { GAME_SOUND_RECIPES, type GameSoundCue } from './gameSounds'

export interface AudioMixSettings {
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  muted: boolean
}

export interface AudioEngineOptions {
  maxVoices?: number
}

export type AudioTension = 'calm' | 'watch' | 'critical'

export interface AudioPublicState {
  tension: AudioTension
  auditActive: boolean
  memorySignal: string | null
}

export interface AudioEngineStatus extends AudioPublicState {
  availability:
    | 'idle'
    | 'running'
    | 'suspended'
    | 'blocked'
    | 'unavailable'
    | 'closed'
  activated: boolean
  musicStarted: boolean
  musicLayerCount: number
  masterGain: number
  musicGain: number
  effectsGain: number
}

type AudioContextFactory = () => AudioContext | null

const DEFAULT_MIX: AudioMixSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.85,
  muted: false,
}

const DEFAULT_PUBLIC_STATE: AudioPublicState = {
  tension: 'calm',
  auditActive: false,
  memorySignal: null,
}

interface MusicVoice {
  source: OscillatorNode
  envelope: GainNode
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export class GameAudioEngine {
  private readonly contextFactory: AudioContextFactory
  private readonly maxVoices: number
  private context: AudioContext | null = null
  private masterBus: GainNode | null = null
  private musicBus: GainNode | null = null
  private effectsBus: GainNode | null = null
  private settings: AudioMixSettings = { ...DEFAULT_MIX }
  private readonly activeVoices = new Set<MusicVoice>()
  private readonly musicLayers = new Set<MusicVoice>()
  private readonly musicAccents = new Set<MusicVoice>()
  private tensionEnvelope: GainNode | null = null
  private publicState: AudioPublicState = { ...DEFAULT_PUBLIC_STATE }
  private activated = false
  private musicStarted = false
  private unavailable = false
  private blocked = false
  private disposed = false
  private unlockInFlight: Promise<boolean> | null = null
  private desiredBackgroundHidden = false
  private visibilityInFlight: Promise<void> | null = null
  private readonly statusListeners = new Set<(status: AudioEngineStatus) => void>()

  constructor(
    contextFactory: AudioContextFactory,
    options: AudioEngineOptions = {},
  ) {
    this.contextFactory = contextFactory
    this.maxVoices = Math.max(1, options.maxVoices ?? 12)
  }

  unlock(): Promise<boolean> {
    if (this.unlockInFlight) return this.unlockInFlight
    const attempt = this.performUnlock()
    this.unlockInFlight = attempt
    const clearAttempt = () => {
      if (this.unlockInFlight === attempt) this.unlockInFlight = null
    }
    void attempt.then(clearAttempt, clearAttempt)
    return attempt
  }

  private async performUnlock(): Promise<boolean> {
    if (this.disposed) return false
    let context: AudioContext | null = this.context
    if (!context) {
      try {
        context = this.contextFactory()
      } catch {
        context = null
      }
      if (!context) {
        this.unavailable = true
        this.emitStatus()
        return false
      }
      this.context = context
      this.unavailable = false
    }

    if (context.state === 'closed') {
      this.emitStatus()
      return false
    }
    if (!this.masterBus) this.createMixBuses(context)

    if (context.state === 'suspended') {
      try {
        await context.resume()
      } catch {
        this.blocked = true
        this.emitStatus()
        return false
      }
    }
    if (
      this.disposed ||
      this.context !== context ||
      (context.state as AudioContextState) === 'closed'
    ) {
      this.emitStatus()
      return false
    }
    this.blocked = false
    this.activated = true
    this.startMusic()
    await this.reconcileBackgroundVisibility()
    if (this.disposed || this.context !== context) return false
    this.emitStatus()
    return true
  }

  configure(patch: Partial<AudioMixSettings>): void {
    this.settings = { ...this.settings, ...patch }
    this.applyMix()
    this.emitStatus()
  }

  configurePublicState(patch: Partial<AudioPublicState>): void {
    const previous = this.publicState
    this.publicState = { ...this.publicState, ...patch }
    this.applyTensionLayer()
    if (this.musicStarted) {
      if (!previous.auditActive && this.publicState.auditActive) {
        this.playMusicAccent('sine', 88, 52, 0.027, 520)
      }
      if (
        this.publicState.memorySignal !== null &&
        this.publicState.memorySignal !== previous.memorySignal
      ) {
        this.playMusicAccent('triangle', 248, 124, 0.021, 460)
      }
    }
    this.emitStatus()
  }

  setBackgroundHidden(hidden: boolean): Promise<void> {
    this.desiredBackgroundHidden = hidden
    return this.reconcileBackgroundVisibility()
  }

  getStatus(): AudioEngineStatus {
    const availability: AudioEngineStatus['availability'] = this.disposed
      ? 'closed'
      : this.unavailable
        ? 'unavailable'
        : this.blocked
          ? 'blocked'
          : !this.context
            ? 'idle'
            : this.context.state === 'closed'
              ? 'closed'
              : this.context.state === 'suspended'
                ? 'suspended'
                : 'running'
    return {
      ...this.publicState,
      availability,
      activated: this.activated,
      musicStarted: this.musicStarted,
      musicLayerCount: this.musicLayers.size,
      masterGain: this.settings.muted ? 0 : clamp01(this.settings.masterVolume),
      musicGain: clamp01(this.settings.musicVolume),
      effectsGain: clamp01(this.settings.effectsVolume),
    }
  }

  subscribe(listener: (status: AudioEngineStatus) => void): () => void {
    if (this.disposed) {
      listener(this.getStatus())
      return () => undefined
    }
    this.statusListeners.add(listener)
    listener(this.getStatus())
    return () => this.statusListeners.delete(listener)
  }

  play(cue: GameSoundCue): boolean {
    const context = this.context
    const effectsBus = this.effectsBus
    const voices = GAME_SOUND_RECIPES[cue]

    if (
      !context ||
      !effectsBus ||
      context.state !== 'running' ||
      this.settings.muted ||
      this.settings.masterVolume <= 0 ||
      this.settings.effectsVolume <= 0 ||
      this.activeVoices.size + voices.length > this.maxVoices
    ) {
      return false
    }

    const now = context.currentTime
    for (const voice of voices) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      const delay = (voice.delayMs ?? 0) / 1000
      const start = now + delay
      const attackEnd = start + voice.attackMs / 1000
      const end = start + voice.durationMs / 1000

      oscillator.type = voice.wave
      oscillator.frequency.setValueAtTime(Math.max(1, voice.startFrequency), start)
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, voice.endFrequency),
        end,
      )
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.linearRampToValueAtTime(voice.gain, attackEnd)
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)

      oscillator.connect(envelope)
      envelope.connect(effectsBus)
      const activeVoice = { source: oscillator, envelope }
      this.activeVoices.add(activeVoice)
      oscillator.onended = () => {
        this.activeVoices.delete(activeVoice)
        oscillator.disconnect()
        envelope.disconnect()
      }
      oscillator.start(start)
      oscillator.stop(end + 0.01)
    }

    return true
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.desiredBackgroundHidden = true
    for (const voice of this.activeVoices) {
      voice.source.onended = null
      try {
        voice.source.stop()
      } catch {
        // A short effect may already have ended during teardown.
      }
      voice.source.disconnect()
      voice.envelope.disconnect()
    }
    this.activeVoices.clear()
    for (const voice of [...this.musicLayers, ...this.musicAccents]) {
      voice.source.onended = null
      try {
        voice.source.stop()
      } catch {
        // A source may already have ended between teardown steps.
      }
      voice.source.disconnect()
      voice.envelope.disconnect()
    }
    this.musicLayers.clear()
    this.musicAccents.clear()
    this.tensionEnvelope = null
    const context = this.context
    for (const bus of [this.musicBus, this.effectsBus, this.masterBus]) {
      try {
        bus?.disconnect()
      } catch {
        // A browser may already have released a bus with its closed context.
      }
    }
    this.context = null
    this.masterBus = null
    this.musicBus = null
    this.effectsBus = null
    this.activated = false
    this.musicStarted = false
    if (context && context.state !== 'closed') {
      try {
        await context.close()
      } catch {
        // Audio cleanup must never prevent the game from closing.
      }
    }
    this.emitStatus()
    this.statusListeners.clear()
  }

  private reconcileBackgroundVisibility(): Promise<void> {
    if (this.visibilityInFlight) {
      const current = this.visibilityInFlight
      const reconcileLatest = () => this.reconcileBackgroundVisibility()
      return current.then(reconcileLatest, reconcileLatest)
    }
    const attempt = this.performBackgroundVisibilityReconciliation()
    this.visibilityInFlight = attempt
    const clearAttempt = () => {
      if (this.visibilityInFlight === attempt) this.visibilityInFlight = null
    }
    void attempt.then(clearAttempt, clearAttempt)
    return attempt
  }

  private async performBackgroundVisibilityReconciliation(): Promise<void> {
    while (!this.disposed) {
      const context = this.context
      if (!context || !this.activated || context.state === 'closed') {
        this.emitStatus()
        return
      }

      try {
        if (this.desiredBackgroundHidden && context.state === 'running') {
          await context.suspend()
        } else if (!this.desiredBackgroundHidden && context.state === 'suspended') {
          await context.resume()
        } else {
          this.blocked = false
          this.emitStatus()
          return
        }
      } catch {
        if (!this.disposed && this.context === context) this.blocked = true
        this.emitStatus()
        return
      }

      if (this.disposed || this.context !== context) return
      this.blocked = false
      if (
        (this.desiredBackgroundHidden && context.state === 'suspended') ||
        (!this.desiredBackgroundHidden && context.state === 'running')
      ) {
        this.emitStatus()
        return
      }
      if (context.state !== 'running' && context.state !== 'suspended') {
        this.emitStatus()
        return
      }
    }
  }

  private createMixBuses(context: AudioContext): void {
    this.masterBus = context.createGain()
    this.musicBus = context.createGain()
    this.effectsBus = context.createGain()
    this.musicBus.connect(this.masterBus)
    this.effectsBus.connect(this.masterBus)
    this.masterBus.connect(context.destination)
    this.applyMix()
  }

  private applyMix(): void {
    if (!this.context || !this.masterBus || !this.musicBus || !this.effectsBus) {
      return
    }

    const now = this.context.currentTime
    this.masterBus.gain.setValueAtTime(
      this.settings.muted ? 0 : clamp01(this.settings.masterVolume),
      now,
    )
    this.musicBus.gain.setValueAtTime(clamp01(this.settings.musicVolume), now)
    this.effectsBus.gain.setValueAtTime(clamp01(this.settings.effectsVolume), now)
  }

  private startMusic(): void {
    const context = this.context
    const musicBus = this.musicBus
    if (
      this.musicStarted ||
      !context ||
      !musicBus ||
      context.state !== 'running'
    ) return

    this.createMusicLayer('sine', 48, 0.014)
    this.createMusicLayer('triangle', 71, 0.006)
    this.tensionEnvelope = this.createMusicLayer('sine', 96, 0).envelope
    this.musicStarted = true
    this.applyTensionLayer()
  }

  private createMusicLayer(
    wave: OscillatorType,
    frequency: number,
    gain: number,
  ): MusicVoice {
    const context = this.context
    const musicBus = this.musicBus
    if (!context || !musicBus) throw new Error('music graph unavailable')
    const source = context.createOscillator()
    const envelope = context.createGain()
    source.type = wave
    source.frequency.setValueAtTime(frequency, context.currentTime)
    envelope.gain.setValueAtTime(gain, context.currentTime)
    source.connect(envelope)
    envelope.connect(musicBus)
    source.start(context.currentTime)
    const voice = { source, envelope }
    this.musicLayers.add(voice)
    return voice
  }

  private applyTensionLayer(): void {
    if (!this.context || !this.tensionEnvelope) return
    const gain =
      this.publicState.tension === 'critical'
        ? 0.012
        : this.publicState.tension === 'watch'
          ? 0.005
          : 0
    this.tensionEnvelope.gain.setValueAtTime(gain, this.context.currentTime)
  }

  private playMusicAccent(
    wave: OscillatorType,
    startFrequency: number,
    endFrequency: number,
    gain: number,
    durationMs: number,
  ): void {
    const context = this.context
    const musicBus = this.musicBus
    if (
      !context ||
      !musicBus ||
      context.state !== 'running' ||
      this.musicAccents.size >= 4
    ) return
    const source = context.createOscillator()
    const envelope = context.createGain()
    const start = context.currentTime
    const end = start + durationMs / 1000
    source.type = wave
    source.frequency.setValueAtTime(startFrequency, start)
    source.frequency.exponentialRampToValueAtTime(endFrequency, end)
    envelope.gain.setValueAtTime(0.0001, start)
    envelope.gain.linearRampToValueAtTime(gain, start + 0.03)
    envelope.gain.exponentialRampToValueAtTime(0.0001, end)
    source.connect(envelope)
    envelope.connect(musicBus)
    const voice = { source, envelope }
    this.musicAccents.add(voice)
    source.onended = () => {
      this.musicAccents.delete(voice)
      source.disconnect()
      envelope.disconnect()
    }
    source.start(start)
    source.stop(end + 0.01)
  }

  private emitStatus(): void {
    if (this.statusListeners.size === 0) return
    const status = this.getStatus()
    this.statusListeners.forEach((listener) => listener(status))
  }
}

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

function createBrowserAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const audioWindow = window as AudioWindow
  const Context = window.AudioContext ?? audioWindow.webkitAudioContext
  return Context ? new Context() : null
}

let browserAudioEngine: GameAudioEngine | null = null

function activeBrowserAudioEngine(): GameAudioEngine {
  browserAudioEngine ??= new GameAudioEngine(createBrowserAudioContext)
  return browserAudioEngine
}

export function unlockGameAudio(): Promise<boolean> {
  return activeBrowserAudioEngine().unlock()
}

export function configureGameAudio(settings: Partial<AudioMixSettings>): void {
  activeBrowserAudioEngine().configure(settings)
}

export function configureGameAudioPublicState(
  state: Partial<AudioPublicState>,
): void {
  activeBrowserAudioEngine().configurePublicState(state)
}

export function setGameAudioBackgroundHidden(hidden: boolean): Promise<void> {
  return activeBrowserAudioEngine().setBackgroundHidden(hidden)
}

export function getGameAudioStatus(): AudioEngineStatus {
  return activeBrowserAudioEngine().getStatus()
}

export function subscribeGameAudioStatus(
  listener: (status: AudioEngineStatus) => void,
): () => void {
  return activeBrowserAudioEngine().subscribe(listener)
}

export function playGameSound(cue: GameSoundCue): boolean {
  return activeBrowserAudioEngine().play(cue)
}

export async function disposeGameAudio(): Promise<void> {
  const engine = browserAudioEngine
  browserAudioEngine = null
  await engine?.dispose()
}
