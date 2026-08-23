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

class FakeAudioBufferSourceNode extends FakeAudioNode {
  buffer: AudioBuffer | null = null
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
  bufferSources: FakeAudioBufferSourceNode[] = []
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  suspend = vi.fn(async () => {
    this.state = 'suspended'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })

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

  createBufferSource() {
    const source = new FakeAudioBufferSourceNode()
    this.bufferSources.push(source)
    return source
  }
}

describe('GameAudioEngine', () => {
  it('starts exactly one restrained music graph after activation and routes every layer through music bus', async () => {
    const context = new FakeAudioContext()
    const factory = vi.fn(() => context as unknown as AudioContext)
    const engine = new GameAudioEngine(factory)

    expect(engine.getStatus()).toMatchObject({
      activated: false,
      musicStarted: false,
      availability: 'idle',
    })
    await expect(engine.unlock()).resolves.toBe(true)
    await expect(engine.unlock()).resolves.toBe(true)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(context.oscillators).toHaveLength(3)
    const musicBus = context.gains[1]
    expect(
      context.oscillators.every(
        (oscillator) =>
          oscillator.connections[0]?.connections[0] === musicBus,
      ),
    ).toBe(true)
    expect(engine.getStatus()).toMatchObject({
      activated: true,
      musicStarted: true,
      availability: 'running',
      musicLayerCount: 3,
    })
  })

  it('shares one in-flight unlock across simultaneous activation gestures', async () => {
    const context = new FakeAudioContext()
    let resolveResume: (() => void) | null = null
    context.resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = () => {
            context.state = 'running'
            resolve()
          }
        }),
    )
    const factory = vi.fn(() => context as unknown as AudioContext)
    const engine = new GameAudioEngine(factory)

    const first = engine.unlock()
    const second = engine.unlock()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(context.resume).toHaveBeenCalledTimes(1)
    expect(context.oscillators).toHaveLength(0)
    if (!resolveResume) throw new Error('resume resolver missing')
    ;(resolveResume as () => void)()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(context.oscillators).toHaveLength(3)
  })

  it('updates master/music/effects independently and mute silences through master', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()

    engine.configure({ masterVolume: 0.5, musicVolume: 0.2, effectsVolume: 0.7 })
    expect(engine.getStatus()).toMatchObject({
      masterGain: 0.5,
      musicGain: 0.2,
      effectsGain: 0.7,
    })
    engine.configure({ effectsVolume: 0.1 })
    expect(engine.getStatus()).toMatchObject({ musicGain: 0.2, effectsGain: 0.1 })
    engine.configure({ muted: true })
    expect(engine.getStatus()).toMatchObject({
      masterGain: 0,
      musicGain: 0.2,
      effectsGain: 0.1,
    })
  })

  it('changes the tension layer from public state and emits sparse audit/memory music accents', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()
    const baseOscillators = context.oscillators.length

    engine.configurePublicState({
      tension: 'critical',
      auditActive: true,
      memorySignal: 'stage-1-original',
    })
    const afterFirstSignal = context.oscillators.length
    expect(afterFirstSignal).toBe(baseOscillators + 2)
    expect(engine.getStatus()).toMatchObject({
      tension: 'critical',
      auditActive: true,
      memorySignal: 'stage-1-original',
    })
    expect(
      context.oscillators
        .slice(baseOscillators)
        .every(
          (oscillator) =>
            oscillator.connections[0]?.connections[0] === context.gains[1],
        ),
    ).toBe(true)

    engine.configurePublicState({
      tension: 'critical',
      auditActive: true,
      memorySignal: 'stage-1-original',
    })
    expect(context.oscillators).toHaveLength(afterFirstSignal)
  })

  it('does not replay an already visible audit or memory signal when the first gesture unlocks music', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)

    engine.configurePublicState({
      tension: 'watch',
      auditActive: true,
      memorySignal: 'already-visible-memory',
    })
    await engine.unlock()
    expect(context.oscillators).toHaveLength(3)

    engine.configurePublicState({
      tension: 'watch',
      auditActive: true,
      memorySignal: 'already-visible-memory',
    })
    expect(context.oscillators).toHaveLength(3)
  })

  it('suspends while hidden, resumes only after activation, and disposes all music nodes', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)

    await engine.setBackgroundHidden(true)
    expect(context.suspend).not.toHaveBeenCalled()
    await engine.unlock()
    await engine.setBackgroundHidden(true)
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(engine.getStatus().availability).toBe('suspended')
    await engine.setBackgroundHidden(false)
    expect(context.resume).toHaveBeenCalledTimes(2)
    expect(engine.getStatus().availability).toBe('running')

    const musicSources = context.oscillators.slice(0, 3)
    expect(engine.play('select')).toBe(true)
    const effectSource = context.oscillators.at(-1)!
    const effectEnvelope = context.gains.at(-1)!
    expect(engine.startLoop('rail-flow')).toBe(true)
    const loopSources = context.oscillators.slice(-2)
    const listener = vi.fn()
    engine.subscribe(listener)
    await engine.dispose()
    expect(musicSources.every(({ stopped }) => stopped)).toBe(true)
    expect(context.gains.slice(0, 3).every(({ disconnected }) => disconnected)).toBe(
      true,
    )
    expect(effectSource.stopped).toBe(true)
    expect(effectSource.disconnected).toBe(true)
    expect(effectEnvelope.disconnected).toBe(true)
    expect(loopSources.every(({ stopped, disconnected }) => stopped && disconnected)).toBe(
      true,
    )
    expect(engine.getStatus()).toMatchObject({
      activated: false,
      musicStarted: false,
      availability: 'closed',
      musicLayerCount: 0,
    })
    const callsAfterDispose = listener.mock.calls.length
    engine.configure({ musicVolume: 0.1 })
    expect(listener).toHaveBeenCalledTimes(callsAfterDispose)
  })

  it('reconciles a rapid hidden then visible transition to the latest visible intent', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()
    let resolveSuspend: (() => void) | null = null
    context.suspend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSuspend = () => {
            context.state = 'suspended'
            resolve()
          }
        }),
    )

    const hide = engine.setBackgroundHidden(true)
    const show = engine.setBackgroundHidden(false)
    expect(context.suspend).toHaveBeenCalledTimes(1)
    if (!resolveSuspend) throw new Error('suspend resolver missing')
    ;(resolveSuspend as () => void)()
    await Promise.all([hide, show])

    expect(context.state).toBe('running')
    expect(context.resume).toHaveBeenCalledTimes(2)
    expect(engine.getStatus().availability).toBe('running')
  })

  it('does not lose a latest hidden intent behind a same-tick visible no-op', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()

    const alreadyVisible = engine.setBackgroundHidden(false)
    const hide = engine.setBackgroundHidden(true)
    await Promise.all([alreadyVisible, hide])

    expect(context.state).toBe('suspended')
    expect(context.suspend).toHaveBeenCalledTimes(1)
  })

  it('reconciles a rapid visible then hidden transition to the latest hidden intent', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()
    await engine.setBackgroundHidden(true)
    let resolveResume: (() => void) | null = null
    context.resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = () => {
            context.state = 'running'
            resolve()
          }
        }),
    )

    const show = engine.setBackgroundHidden(false)
    const hide = engine.setBackgroundHidden(true)
    expect(context.resume).toHaveBeenCalledTimes(1)
    if (!resolveResume) throw new Error('resume resolver missing')
    ;(resolveResume as () => void)()
    await Promise.all([show, hide])

    expect(context.state).toBe('suspended')
    expect(context.suspend).toHaveBeenCalledTimes(2)
    expect(engine.getStatus().availability).toBe('suspended')
  })

  it('honors a hidden intent issued while the first unlock is still pending', async () => {
    const context = new FakeAudioContext()
    let resolveResume: (() => void) | null = null
    context.resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = () => {
            context.state = 'running'
            resolve()
          }
        }),
    )
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)

    const unlock = engine.unlock()
    const hide = engine.setBackgroundHidden(true)
    if (!resolveResume) throw new Error('resume resolver missing')
    ;(resolveResume as () => void)()
    await expect(unlock).resolves.toBe(true)
    await hide

    expect(context.state).toBe('suspended')
    expect(context.suspend).toHaveBeenCalledTimes(1)
    expect(engine.getStatus().availability).toBe('suspended')
  })

  it('cannot reactivate after disposal wins a pending unlock race', async () => {
    const context = new FakeAudioContext()
    let resolveResume: (() => void) | null = null
    context.resume = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = () => {
            context.state = 'running'
            resolve()
          }
        }),
    )
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)

    const unlock = engine.unlock()
    await engine.dispose()
    if (!resolveResume) throw new Error('resume resolver missing')
    ;(resolveResume as () => void)()
    await expect(unlock).resolves.toBe(false)
    expect(context.oscillators).toHaveLength(0)
    expect(engine.getStatus()).toMatchObject({
      activated: false,
      musicStarted: false,
      availability: 'closed',
    })
  })

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

    const musicSourceCount = context.oscillators.length
    expect(engine.play('latch')).toBe(true)
    const effectSources = context.oscillators.slice(musicSourceCount)
    expect(effectSources.length).toBeGreaterThanOrEqual(2)
    expect(context.oscillators.every((oscillator) => oscillator.started)).toBe(true)
    expect(effectSources.every((oscillator) => oscillator.stopped)).toBe(true)
  })

  it('keeps one movement loop alive and stops every loop voice together', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(() => context as unknown as AudioContext)
    await engine.unlock()
    const musicSourceCount = context.oscillators.length
    const loopEngine = engine as GameAudioEngine & {
      startLoop(cue: 'rail-flow'): boolean
      stopLoop(cue: 'rail-flow'): void
    }

    expect(loopEngine.startLoop('rail-flow')).toBe(true)
    const loopSources = context.oscillators.slice(musicSourceCount)
    expect(loopSources).toHaveLength(2)
    expect(loopEngine.startLoop('rail-flow')).toBe(true)
    expect(context.oscillators.slice(musicSourceCount)).toHaveLength(2)

    loopEngine.stopLoop('rail-flow')
    expect(loopSources.every(({ stopped }) => stopped)).toBe(true)
  })

  it('counts active loop voices against the shared effects voice cap', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(
      () => context as unknown as AudioContext,
      { maxVoices: 2 },
    )
    await engine.unlock()

    expect(engine.startLoop('rail-flow')).toBe(true)
    expect(engine.play('select')).toBe(false)
  })

  it('can run effects without the retired procedural background layers', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(
      () => context as unknown as AudioContext,
      { proceduralMusic: false },
    )

    await expect(engine.unlock()).resolves.toBe(true)
    expect(engine.getStatus()).toMatchObject({
      activated: true,
      musicStarted: false,
      musicLayerCount: 0,
    })
    expect(context.oscillators).toHaveLength(0)
    expect(engine.play('expansion-open')).toBe(true)
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

  it('releases every voice of a chord after playback completes', async () => {
    const context = new FakeAudioContext()
    const engine = new GameAudioEngine(
      () => context as unknown as AudioContext,
      { maxVoices: 3, proceduralMusic: false },
    )
    await engine.unlock()

    expect(engine.play('snake-hit')).toBe(true)
    const chordSources = [...context.oscillators]
    expect(chordSources).toHaveLength(3)
    expect(engine.play('snake-burst')).toBe(false)

    chordSources.forEach((oscillator) => oscillator.finish())
    expect(engine.play('snake-burst')).toBe(true)
  })

  it('degrades silently when Web Audio is unavailable', async () => {
    const engine = new GameAudioEngine(() => null)

    await expect(engine.unlock()).resolves.toBe(false)
    expect(engine.play('impact')).toBe(false)
    expect(engine.getStatus()).toMatchObject({
      activated: false,
      musicStarted: false,
      availability: 'unavailable',
    })
  })

  it('reports blocked and closed contexts without creating music sources', async () => {
    const blocked = new FakeAudioContext()
    blocked.resume = vi.fn(async () => {
      throw new DOMException('gesture denied', 'NotAllowedError')
    })
    const blockedEngine = new GameAudioEngine(
      () => blocked as unknown as AudioContext,
    )
    await expect(blockedEngine.unlock()).resolves.toBe(false)
    expect(blockedEngine.getStatus().availability).toBe('blocked')
    expect(blocked.oscillators).toHaveLength(0)

    const closed = new FakeAudioContext()
    closed.state = 'closed'
    const closedEngine = new GameAudioEngine(
      () => closed as unknown as AudioContext,
    )
    await expect(closedEngine.unlock()).resolves.toBe(false)
    expect(closedEngine.getStatus().availability).toBe('closed')
    expect(closed.oscillators).toHaveLength(0)
  })
})
