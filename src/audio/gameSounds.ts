export type GameSoundCue =
  | 'select'
  | 'resistance'
  | 'suction'
  | 'latch'
  | 'impact'
  | 'reject'
  | 'alarm'
  | 'ui'
  | 'snake-deploy'
  | 'snake-hit'
  | 'snake-burst'
  | 'snake-resource-secured'

export type GameLoopCue = 'movement-hum'
export type GameSampleCue = 'hacking-network-click'

export const GAME_SAMPLE_URLS: Readonly<Record<GameSampleCue, string>> = {
  'hacking-network-click': './audio/u_03zpxbws1q-mouse-click-sound-523406.mp3',
}

export interface SoundVoice {
  wave: OscillatorType
  startFrequency: number
  endFrequency: number
  durationMs: number
  gain: number
  attackMs: number
  delayMs?: number
}

export interface LoopSoundVoice {
  wave: OscillatorType
  frequency: number
  gain: number
}

export const GAME_LOOP_RECIPES: Readonly<
  Record<GameLoopCue, readonly LoopSoundVoice[]>
> = {
  'movement-hum': [
    { wave: 'sine', frequency: 82, gain: 0.012 },
    { wave: 'triangle', frequency: 123, gain: 0.006 },
  ],
}

export const GAME_SOUND_RECIPES: Readonly<Record<GameSoundCue, readonly SoundVoice[]>> = {
  select: [
    { wave: 'sine', startFrequency: 410, endFrequency: 520, durationMs: 72, gain: 0.07, attackMs: 4 },
  ],
  resistance: [
    { wave: 'triangle', startFrequency: 145, endFrequency: 104, durationMs: 125, gain: 0.1, attackMs: 8 },
  ],
  suction: [
    { wave: 'sine', startFrequency: 640, endFrequency: 210, durationMs: 180, gain: 0.085, attackMs: 12 },
  ],
  latch: [
    { wave: 'square', startFrequency: 820, endFrequency: 690, durationMs: 58, gain: 0.048, attackMs: 2 },
    { wave: 'triangle', startFrequency: 1240, endFrequency: 930, durationMs: 74, gain: 0.035, attackMs: 2, delayMs: 24 },
  ],
  impact: [
    { wave: 'sine', startFrequency: 118, endFrequency: 58, durationMs: 145, gain: 0.13, attackMs: 2 },
  ],
  reject: [
    { wave: 'sawtooth', startFrequency: 172, endFrequency: 104, durationMs: 118, gain: 0.065, attackMs: 3 },
  ],
  alarm: [
    { wave: 'square', startFrequency: 430, endFrequency: 430, durationMs: 190, gain: 0.055, attackMs: 4 },
    { wave: 'square', startFrequency: 610, endFrequency: 610, durationMs: 190, gain: 0.04, attackMs: 4, delayMs: 205 },
  ],
  ui: [
    { wave: 'sine', startFrequency: 310, endFrequency: 350, durationMs: 48, gain: 0.045, attackMs: 2 },
  ],
  'snake-deploy': [
    { wave: 'triangle', startFrequency: 180, endFrequency: 360, durationMs: 120, gain: 0.035, attackMs: 5 },
  ],
  'snake-hit': [
    { wave: 'sine', startFrequency: 150, endFrequency: 62, durationMs: 105, gain: 0.075, attackMs: 2 },
    { wave: 'triangle', startFrequency: 520, endFrequency: 240, durationMs: 82, gain: 0.026, attackMs: 2 },
  ],
  'snake-burst': [
    { wave: 'triangle', startFrequency: 920, endFrequency: 180, durationMs: 170, gain: 0.052, attackMs: 2 },
    { wave: 'sine', startFrequency: 190, endFrequency: 54, durationMs: 220, gain: 0.065, attackMs: 2, delayMs: 18 },
  ],
  'snake-resource-secured': [
    { wave: 'sine', startFrequency: 420, endFrequency: 760, durationMs: 190, gain: 0.042, attackMs: 4 },
    { wave: 'triangle', startFrequency: 720, endFrequency: 1_080, durationMs: 210, gain: 0.024, attackMs: 4, delayMs: 54 },
  ],
}
