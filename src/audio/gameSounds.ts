export type GameSoundCue =
  | 'select'
  | 'resistance'
  | 'suction'
  | 'latch'
  | 'impact'
  | 'reject'
  | 'alarm'
  | 'ui'
  | 'deposit-intake'
  | 'deposit-success'
  | 'compression-hit'
  | 'resource-break'
  | 'guard-activate'
  | 'guard-charge-warning'
  | 'guard-fire'
  | 'guard-cut'
  | 'core-unlock'
  | 'core-secured'
  | 'player-hit'
  | 'player-collapse'
  | 'repair-tick'
  | 'reconstruction-complete'
  | 'radar-warning'
  | 'radar-detected'
  | 'trail-purged'

export type GameLoopCue = 'movement-hum' | 'capture-pull'
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
  'capture-pull': [
    { wave: 'sine', frequency: 176, gain: 0.013 },
    { wave: 'triangle', frequency: 264, gain: 0.005 },
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
  'deposit-intake': [
    { wave: 'sine', startFrequency: 260, endFrequency: 120, durationMs: 220, gain: 0.055, attackMs: 8 },
  ],
  'deposit-success': [
    { wave: 'triangle', startFrequency: 420, endFrequency: 620, durationMs: 210, gain: 0.05, attackMs: 6 },
    { wave: 'sine', startFrequency: 840, endFrequency: 1040, durationMs: 260, gain: 0.03, attackMs: 5, delayMs: 70 },
  ],
  'compression-hit': [
    { wave: 'sine', startFrequency: 190, endFrequency: 72, durationMs: 190, gain: 0.075, attackMs: 3 },
    { wave: 'triangle', startFrequency: 720, endFrequency: 410, durationMs: 120, gain: 0.035, attackMs: 2, delayMs: 36 },
  ],
  'resource-break': [
    { wave: 'triangle', startFrequency: 310, endFrequency: 860, durationMs: 150, gain: 0.05, attackMs: 3 },
    { wave: 'sine', startFrequency: 920, endFrequency: 1320, durationMs: 120, gain: 0.026, attackMs: 2, delayMs: 62 },
  ],
  'guard-activate': [
    { wave: 'triangle', startFrequency: 176, endFrequency: 248, durationMs: 105, gain: 0.044, attackMs: 5 },
    { wave: 'sine', startFrequency: 352, endFrequency: 430, durationMs: 92, gain: 0.021, attackMs: 4, delayMs: 30 },
  ],
  'guard-charge-warning': [
    { wave: 'sawtooth', startFrequency: 112, endFrequency: 174, durationMs: 180, gain: 0.036, attackMs: 12 },
    { wave: 'sine', startFrequency: 430, endFrequency: 670, durationMs: 158, gain: 0.024, attackMs: 8, delayMs: 18 },
  ],
  'guard-fire': [
    { wave: 'square', startFrequency: 520, endFrequency: 210, durationMs: 92, gain: 0.038, attackMs: 2 },
    { wave: 'sine', startFrequency: 180, endFrequency: 88, durationMs: 126, gain: 0.032, attackMs: 2, delayMs: 18 },
  ],
  'guard-cut': [
    { wave: 'triangle', startFrequency: 480, endFrequency: 1120, durationMs: 104, gain: 0.046, attackMs: 2 },
    { wave: 'sine', startFrequency: 182, endFrequency: 68, durationMs: 132, gain: 0.04, attackMs: 2, delayMs: 12 },
  ],
  'core-unlock': [
    { wave: 'square', startFrequency: 280, endFrequency: 330, durationMs: 58, gain: 0.032, attackMs: 2 },
    { wave: 'triangle', startFrequency: 560, endFrequency: 720, durationMs: 96, gain: 0.026, attackMs: 3, delayMs: 56 },
  ],
  'core-secured': [
    { wave: 'sine', startFrequency: 720, endFrequency: 980, durationMs: 146, gain: 0.044, attackMs: 4 },
    { wave: 'sine', startFrequency: 1080, endFrequency: 1420, durationMs: 210, gain: 0.027, attackMs: 4, delayMs: 78 },
  ],
  'player-hit': [
    { wave: 'sine', startFrequency: 128, endFrequency: 54, durationMs: 158, gain: 0.105, attackMs: 2 },
    { wave: 'sawtooth', startFrequency: 330, endFrequency: 142, durationMs: 104, gain: 0.031, attackMs: 2 },
  ],
  'player-collapse': [
    { wave: 'sine', startFrequency: 94, endFrequency: 32, durationMs: 330, gain: 0.115, attackMs: 3 },
    { wave: 'square', startFrequency: 380, endFrequency: 190, durationMs: 240, gain: 0.032, attackMs: 5, delayMs: 42 },
  ],
  'repair-tick': [
    { wave: 'sine', startFrequency: 330, endFrequency: 510, durationMs: 86, gain: 0.028, attackMs: 3 },
  ],
  'reconstruction-complete': [
    { wave: 'triangle', startFrequency: 240, endFrequency: 480, durationMs: 164, gain: 0.037, attackMs: 6 },
    { wave: 'sine', startFrequency: 620, endFrequency: 920, durationMs: 190, gain: 0.027, attackMs: 5, delayMs: 112 },
  ],
  'radar-warning': [
    { wave: 'sine', startFrequency: 260, endFrequency: 260, durationMs: 132, gain: 0.042, attackMs: 8 },
    { wave: 'sine', startFrequency: 390, endFrequency: 390, durationMs: 132, gain: 0.026, attackMs: 8, delayMs: 174 },
  ],
  'radar-detected': [
    { wave: 'square', startFrequency: 510, endFrequency: 420, durationMs: 224, gain: 0.05, attackMs: 3 },
    { wave: 'sine', startFrequency: 118, endFrequency: 72, durationMs: 260, gain: 0.07, attackMs: 3, delayMs: 28 },
  ],
  'trail-purged': [
    { wave: 'sawtooth', startFrequency: 460, endFrequency: 92, durationMs: 176, gain: 0.035, attackMs: 2 },
    { wave: 'triangle', startFrequency: 820, endFrequency: 210, durationMs: 138, gain: 0.025, attackMs: 2, delayMs: 22 },
  ],
}
