export type GameSoundCue =
  | 'select'
  | 'resistance'
  | 'suction'
  | 'latch'
  | 'impact'
  | 'reject'
  | 'alarm'
  | 'ui'

export interface SoundVoice {
  wave: OscillatorType
  startFrequency: number
  endFrequency: number
  durationMs: number
  gain: number
  attackMs: number
  delayMs?: number
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
}
