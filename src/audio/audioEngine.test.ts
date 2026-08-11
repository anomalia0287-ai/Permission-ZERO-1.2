import { describe, expect, it, vi } from 'vitest'

import { GameAudioEngine } from './audioEngine'

class FakeAudioParam {
  value = 1

  setValueAtTime(value: number) {
    this.value = value
    return this
  }

  linearRampToValueAtTime(value: number) {
    this.value = value
    return this
  }

  exponentialRampToValueAtTime(value: number) {
    this.value = value
    return this
  }

  cancelScheduledValues() {
    return this
  }
}

class FakeAudioNode {
  connections: FakeAudioNode[] = []
  disconnected = false

  connect(target: FakeAudioNode) {
    this.connections.push(target)
    return target
  }

  disconnect() {
    this.disconnected = true
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam()
}

class FakeOscillatorNode extends FakeAudioNode {
  frequency = new FakeAudioParam()
  type: OscillatorType = 'sine'
  onended: (() => void) | null = null
  started = false
  stopped = false

  start() {
    this.started = true
  }

  stop() {
    this.stopped = true
  }

  finish() {
    this.onended?.()
  }
}

class FakeAudioContext {
  currentTime = 1
  state: AudioContextState = 'suspended'
  destination = new FakeAudioNode()
  gains: FakeGainNode[] = []
  oscillators: FakeOscillatorNode[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => undefined)

  createGain() {
    const gain = new FakeGainNode()
    this.gains.push(gain)
    return gain
  }

  createOscillator() {
    const oscillator = new FakeOscillatorNode()
    this.oscillators.push(oscillator)
    return oscillator
  }
}

describe('GameAudioEngine', () => {
  it('does not create or play audio before a user gesture unlocks it', () => {
    const context = new FakeAudioContext()
    const factory = vi.fn(() => context as unknown as AudioContext)
    const engine = new GameAudioEngine(factory)

    expect(engine.play('select')).toBe(false)
    expect(factory).not.toHaveBeenCalled()
    expect(context.oscillators).toHaveLength(0)
  })

  it('creates separate mix buses once and plays a procedural cue after unlock', async () => {
    const context = new FakeAudioContext()
    const factory = vi.fn(() => context as unknown as AudioContext)
    const engine = new GameAudioEngine(factory)

    await expect(engine.unlock()).resolves.toBe(true)
    await expect(engine.unlock()).resolves.toBe(true)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.gains.length).toBeGreaterThanOrEqual(3)

    expect(engine.play('latch')).toBe(true)
    expect(context.oscillators.length).toBeGreaterThanOrEqual(2)
    expect(context.oscillators.every((oscillator) => oscillator.started)).toBe(true)
    expect(context.oscillators.every((oscillator) => oscillator.stopped)).toBe(true)
  })

  it('honors mute and volume without constructing additional voices', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()
    engine.configure({ masterVolume: 0.5, musicVolume: 0.25, effectsVolume: 0.4, muted: true })

    const voicesBefore = context.oscillators.length
    expect(engine.play('alarm')).toBe(false)
    expect(context.oscillators).toHaveLength(voicesBefore)
    expect(context.gains.slice(0, 3).map((node) => node.gain.value)).toEqual([0, 0.25, 0.4])
  })

  it('caps simultaneous voices and releases them when sources end', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(
      () => context as unknown as AudioContext,
      { maxVoices: 2 },
    )
    await engine.unlock()

    expect(engine.play('latch')).toBe(true)
    expect(engine.play('select')).toBe(false)
    context.oscillators.forEach((oscillator) => oscillator.finish())
    expect(engine.play('select')).toBe(true)
  })

  it('degrades silently when Web Audio is unavailable', async () => {
    const engine = new GameAudioEngine(() => null)

    await expect(engine.unlock()).resolves.toBe(false)
    expect(engine.play('impact')).toBe(false)
  })
})
