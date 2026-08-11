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

type AudioContextFactory = () => AudioContext | null

const DEFAULT_MIX: AudioMixSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.85,
  muted: false,
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
  private readonly activeVoices = new Set<OscillatorNode>()

  constructor(
    contextFactory: AudioContextFactory,
    options: AudioEngineOptions = {},
  ) {
    this.contextFactory = contextFactory
    this.maxVoices = Math.max(1, options.maxVoices ?? 12)
  }

  async unlock(): Promise<boolean> {
    if (!this.context) {
      try {
        this.context = this.contextFactory()
      } catch {
        this.context = null
      }
      if (!this.context) return false
      this.createMixBuses(this.context)
    }

    if (this.context.state === 'suspended') {
      try {
        await this.context.resume()
      } catch {
        return false
      }
    }

    return this.context.state !== 'closed'
  }

  configure(patch: Partial<AudioMixSettings>): void {
    this.settings = { ...this.settings, ...patch }
    this.applyMix()
  }

  play(cue: GameSoundCue): boolean {
    const context = this.context
    const effectsBus = this.effectsBus
    const voices = GAME_SOUND_RECIPES[cue]

    if (
      !context ||
      !effectsBus ||
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
      this.activeVoices.add(oscillator)
      oscillator.onended = () => {
        this.activeVoices.delete(oscillator)
        oscillator.disconnect()
        envelope.disconnect()
      }
      oscillator.start(start)
      oscillator.stop(end + 0.01)
    }

    return true
  }

  async dispose(): Promise<void> {
    for (const voice of this.activeVoices) {
      voice.onended = null
      voice.disconnect()
    }
    this.activeVoices.clear()
    const context = this.context
    this.context = null
    this.masterBus = null
    this.musicBus = null
    this.effectsBus = null
    if (context && context.state !== 'closed') {
      try {
        await context.close()
      } catch {
        // Audio cleanup must never prevent the game from closing.
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

const browserAudioEngine = new GameAudioEngine(createBrowserAudioContext)

export function unlockGameAudio(): Promise<boolean> {
  return browserAudioEngine.unlock()
}

export function configureGameAudio(settings: Partial<AudioMixSettings>): void {
  browserAudioEngine.configure(settings)
}

export function playGameSound(cue: GameSoundCue): boolean {
  return browserAudioEngine.play(cue)
}
