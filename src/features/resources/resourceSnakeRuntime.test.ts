import { describe, expect, it } from 'vitest'

import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  RESOURCE_SNAKE_CONFIG,
  trailDotScale,
  type ResourceSnakeRoundState,
  type SnakeFrameInput,
  type SnakeRoundSetup,
} from './resourceSnakeRuntime'

const input: SnakeFrameInput = {
  playerDirection: { x: 0, y: 0 },
  enemyDirections: {},
}

const setup: SnakeRoundSetup = {
  roundId: 'round-1',
  playerSpawn: { x: 25, y: 12 },
  enemies: [],
}

function activeState(): ResourceSnakeRoundState {
  let state = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  for (const deltaMs of [100, 100, 20]) {
    state = advanceResourceSnakeFrame(state, input, deltaMs)
  }
  expect(state.phase).toBe('active')
  return state
}

describe('resource snake fixed-step movement kernel', () => {
  it('keeps the player position unchanged while input is idle', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(state, input, 100)

    expect(next.player.position).toEqual(state.player.position)
    expect(next.player.velocity).toEqual({ x: 0, y: 0 })
  })

  it('normalizes diagonal input before applying player speed', () => {
    const state = activeState()
    const next = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 1 } },
      RESOURCE_SNAKE_CONFIG.fixedStepMs,
    )

    expect(next.player.velocity.x).toBeCloseTo(next.player.velocity.y)
    expect(Math.hypot(next.player.velocity.x, next.player.velocity.y)).toBeLessThanOrEqual(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    )
  })

  it('reaches the configured speed cap after 120ms of held input', () => {
    const state = activeState()
    const after100 = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const next = advanceResourceSnakeFrame(
      after100,
      { ...input, playerDirection: { x: 1, y: 0 } },
      RESOURCE_SNAKE_CONFIG.playerAccelerationMs - 100,
    )

    expect(next.player.velocity.x).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
      5,
    )
    expect(next.player.velocity.y).toBeCloseTo(0)
  })

  it('decelerates to zero in 100ms after input release', () => {
    const state = advanceResourceSnakeFrame(
      activeState(),
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const next = advanceResourceSnakeFrame(state, input, RESOURCE_SNAKE_CONFIG.playerDecelerationMs)

    expect(next.player.velocity).toEqual({ x: 0, y: 0 })
  })

  it('clamps a long frame to 100ms and discards excess time', () => {
    const state = activeState()
    const afterLongFrame = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      5_000,
    )
    const control = advanceResourceSnakeFrame(
      state,
      { ...input, playerDirection: { x: 1, y: 0 } },
      RESOURCE_SNAKE_CONFIG.maximumFrameDeltaMs,
    )

    expect(afterLongFrame.simulationMs - state.simulationMs).toBeCloseTo(100, 5)
    expect(afterLongFrame.player.velocity.x).toBeLessThanOrEqual(
      RESOURCE_SNAKE_CONFIG.playerMaximumSpeedPerSecond,
    )
    expect(afterLongFrame.player.velocity.x).toBeCloseTo(
      control.player.velocity.x,
      5,
    )
  })

  it('samples trail dots by distance and does not add dots while stopped', () => {
    const moving = advanceResourceSnakeFrame(
      activeState(),
      { ...input, playerDirection: { x: 1, y: 0 } },
      100,
    )
    const stopped = advanceResourceSnakeFrame(moving, input, 100)

    expect(moving.player.trail.length).toBeGreaterThan(0)
    expect(stopped.player.trail.length).toBeLessThanOrEqual(moving.player.trail.length)
  })

  it('shrinks a trail dot linearly only during its final shrink window', () => {
    const dot = {
      id: 1,
      position: { x: 1, y: 1 },
      spawnedAtMs: 0,
      expiresAtMs: RESOURCE_SNAKE_CONFIG.trailLifetimeMs,
    }

    expect(trailDotScale(dot, 7_900)).toBe(1)
    expect(trailDotScale(dot, 9_000)).toBeCloseTo(0.5)
    expect(trailDotScale(dot, 10_000)).toBe(0)
  })
})
