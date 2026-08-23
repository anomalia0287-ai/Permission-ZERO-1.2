import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  flushResourceSnakeRuntimeChord,
  pressResourceSnakeRuntimeKey,
  releaseResourceSnakeRuntimeKey,
  resetResourceSnakeRuntimeInput,
  RESOURCE_SNAKE_CONFIG,
  resourceSnakeRoundSpeedScale,
  type ResourceSnakeRoundState,
  type SnakeFrameInput,
} from './resourceSnakeRuntime'

const NO_ENEMY_INPUT: SnakeFrameInput = { enemyDirections: {} }

function activeRuntime(): ResourceSnakeRoundState {
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), {
    roundId: 'public-smoke',
    playerSpawn: { x: 25, y: 12 },
    enemies: [],
  })
  for (const deltaMs of [100, 100, 100, 60]) {
    state = advanceResourceSnakeFrame(state, NO_ENEMY_INPUT, deltaMs)
  }
  expect(state.phase).toBe('active')
  return state
}

function queueCardinal(
  state: ResourceSnakeRoundState,
  key: 'w' | 'a' | 's' | 'd',
  inputAtMs: number,
): ResourceSnakeRoundState {
  let next = pressResourceSnakeRuntimeKey(state, key, inputAtMs)
  next = flushResourceSnakeRuntimeChord(next, inputAtMs + 25)
  return releaseResourceSnakeRuntimeKey(next, key)
}

function runClockwiseScript(framePartitions: readonly number[]) {
  let state = activeRuntime()
  const speeds: number[] = []
  const expectedSpeeds: number[] = []
  const turns = [
    { key: 'd' as const, inputAtMs: 1_000 },
    { key: 's' as const, inputAtMs: 1_400 },
    { key: 'a' as const, inputAtMs: 1_800 },
    { key: 'w' as const, inputAtMs: 2_200 },
  ]
  for (const turn of turns) {
    state = queueCardinal(state, turn.key, turn.inputAtMs)
    for (const deltaMs of framePartitions) {
      state = advanceResourceSnakeFrame(state, NO_ENEMY_INPUT, deltaMs)
      speeds.push(Math.hypot(state.player.velocity.x, state.player.velocity.y))
      expectedSpeeds.push(
        RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
          * resourceSnakeRoundSpeedScale(state.simulationMs),
      )
    }
  }
  return { expectedSpeeds, speeds, state }
}

describe('resource snake public-boundary smoke simulation', () => {
  it('runs a deterministic clockwise rail with no live zero-speed frame', () => {
    const first = runClockwiseScript([100, 100, 100, 100])
    const replay = runClockwiseScript([100, 100, 100, 100])
    const committed = first.state.events.filter((event) => (
      event.type === 'snake-turn-committed'
    ))

    expect(first.speeds).toHaveLength(first.expectedSpeeds.length)
    first.speeds.forEach((speed, index) => {
      expect(speed).toBeCloseTo(first.expectedSpeeds[index], 10)
      expect(speed).toBeGreaterThan(0)
    })
    expect(committed.map((event) => (
      event.type === 'snake-turn-committed' ? event.heading : null
    ))).toEqual(['east', 'south', 'west', 'north'])
    expect(first.state.player.railVertices.length).toBeGreaterThanOrEqual(4)
    expect(first.state).toEqual(replay.state)
  })

  it('is frame-partition deterministic across the same fixed-step command script', () => {
    const coarse = runClockwiseScript([100, 100, 100, 100]).state
    const split = runClockwiseScript([40, 60, 25, 75, 80, 20, 50, 50]).state

    expect(split.simulationMs).toBeCloseTo(coarse.simulationMs, 8)
    expect(split.accumulatorMs).toBeCloseTo(coarse.accumulatorMs, 8)
    expect(split.player.position.x).toBeCloseTo(coarse.player.position.x, 8)
    expect(split.player.position.y).toBeCloseTo(coarse.player.position.y, 8)
    expect(split.player.heading).toBe(coarse.player.heading)
    expect(split.player.trail).toEqual(coarse.player.trail)
    expect(split.events).toEqual(coarse.events)
  })

  it('applies one normalized diagonal chord at full speed through the public runtime', () => {
    let state = pressResourceSnakeRuntimeKey(activeRuntime(), 'd', 3_000)
    state = pressResourceSnakeRuntimeKey(state, 'w', 3_012)
    expect(state.input.queuedTurns).toEqual(['north-east'])

    state = advanceResourceSnakeFrame(
      state,
      NO_ENEMY_INPUT,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(state.player.heading).toBe('north-east')
    expect(state.player.velocity.x).toBeGreaterThan(0)
    expect(state.player.velocity.y).toBeLessThan(0)
    expect(Math.hypot(state.player.velocity.x, state.player.velocity.y)).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(state.simulationMs),
      10,
    )
    expect(state.events.at(-1)).toMatchObject({
      type: 'snake-turn-committed',
      heading: 'north-east',
    })
  })

  it('rejects reverse authority once and clears all transient input idempotently', () => {
    let state = pressResourceSnakeRuntimeKey(activeRuntime(), 's', 4_000)
    state = flushResourceSnakeRuntimeChord(state, 4_025)
    expect(state.events.filter((event) => event.type === 'snake-turn-rejected')).toHaveLength(1)

    const cleared = resetResourceSnakeRuntimeInput(state)
    const clearedAgain = resetResourceSnakeRuntimeInput(cleared)
    expect(cleared.input).toMatchObject({
      pendingChord: null,
      pressedKeys: [],
      queuedTurns: [],
    })
    expect(clearedAgain).toBe(cleared)

    const moved = advanceResourceSnakeFrame(
      cleared,
      NO_ENEMY_INPUT,
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )
    expect(moved.player.heading).toBe('north')
    expect(Math.hypot(moved.player.velocity.x, moved.player.velocity.y)).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond
        * resourceSnakeRoundSpeedScale(moved.simulationMs),
      10,
    )
    expect(moved.events.filter((event) => event.type === 'snake-turn-rejected')).toHaveLength(1)
  })
})
