export type GameSoundCue =
  | 'select'
  | 'expansion-open'
  | 'resistance'
  | 'suction'
  | 'latch'
  | 'impact'
  | 'reject'
  | 'alarm'
  | 'ui'
  | 'snake-deploy'
  | 'snake-init-suction'
  | 'snake-turn-queued'
  | 'snake-turn-committed'
  | 'snake-turn-rejected'
  | 'snake-cyan-telegraph'
  | 'snake-hit'
  | 'snake-rail-break'
  | 'snake-burst'
  | 'snake-resource-secured'

export type GameLoopCue = 'rail-flow'

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
  'rail-flow': [
    { wave: 'sine', frequency: 96, gain: 0.011 },
    { wave: 'triangle', frequency: 144, gain: 0.005 },
  ],
}

export const GAME_SOUND_RECIPES: Readonly<Record<GameSoundCue, readonly SoundVoice[]>> = {
  select: [
    { wave: 'sine', startFrequency: 410, endFrequency: 520, durationMs: 72, gain: 0.07, attackMs: 4 },
  ],
  'expansion-open': [
    { wave: 'triangle', startFrequency: 210, endFrequency: 510, durationMs: 135, gain: 0.042, attackMs: 4 },
    { wave: 'sine', startFrequency: 620, endFrequency: 940, durationMs: 88, gain: 0.025, attackMs: 3, delayMs: 48 },
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
    { wave: 'sine', startFrequency: 360, endFrequency: 430, durationMs: 54, gain: 0.026, attackMs: 2 },
  ],
  'snake-deploy': [
    { wave: 'triangle', startFrequency: 180, endFrequency: 360, durationMs: 120, gain: 0.035, attackMs: 5 },
  ],
  'snake-init-suction': [
    { wave: 'sine', startFrequency: 92, endFrequency: 248, durationMs: 2_000, gain: 0.058, attackMs: 40 },
    { wave: 'triangle', startFrequency: 760, endFrequency: 138, durationMs: 1_860, gain: 0.036, attackMs: 24, delayMs: 40 },
    { wave: 'sine', startFrequency: 1_240, endFrequency: 420, durationMs: 360, gain: 0.024, attackMs: 8, delayMs: 1_640 },
  ],
  'snake-turn-queued': [
    { wave: 'sine', startFrequency: 540, endFrequency: 690, durationMs: 42, gain: 0.026, attackMs: 2 },
  ],
  'snake-turn-committed': [
    { wave: 'triangle', startFrequency: 760, endFrequency: 1_020, durationMs: 54, gain: 0.034, attackMs: 2 },
  ],
  'snake-turn-rejected': [
    { wave: 'square', startFrequency: 196, endFrequency: 128, durationMs: 76, gain: 0.026, attackMs: 2 },
  ],
  'snake-cyan-telegraph': [
    { wave: 'sine', startFrequency: 330, endFrequency: 620, durationMs: 128, gain: 0.032, attackMs: 5 },
    { wave: 'triangle', startFrequency: 880, endFrequency: 1_120, durationMs: 74, gain: 0.018, attackMs: 2, delayMs: 72 },
  ],
  'snake-hit': [
    { wave: 'sine', startFrequency: 150, endFrequency: 62, durationMs: 105, gain: 0.075, attackMs: 2 },
    { wave: 'triangle', startFrequency: 520, endFrequency: 240, durationMs: 82, gain: 0.026, attackMs: 2 },
    { wave: 'square', startFrequency: 1_420, endFrequency: 690, durationMs: 36, gain: 0.012, attackMs: 1, delayMs: 12 },
  ],
  'snake-rail-break': [
    { wave: 'sawtooth', startFrequency: 410, endFrequency: 92, durationMs: 96, gain: 0.026, attackMs: 2 },
    { wave: 'triangle', startFrequency: 1_180, endFrequency: 260, durationMs: 72, gain: 0.018, attackMs: 1, delayMs: 8 },
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
