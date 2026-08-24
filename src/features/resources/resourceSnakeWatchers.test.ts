import { describe, expect, it } from 'vitest'

import {
  advanceSnakeWatchers,
  createSnakeWatchers,
  snakeWatcherCountForSuspicion,
  snakeWatcherPatrolPosition,
  snakeWatcherStrikeRadius,
  SNAKE_WATCHER_CONFIG,
  type SnakeWatcher,
} from './resourceSnakeWatchers'
import { RESOURCE_SNAKE_CONFIG } from './resourceSnakeRuntime'

const STEP_MS = RESOURCE_SNAKE_CONFIG.fixedStepMs

function runWatchers(
  watchers: SnakeWatcher[],
  playerPosition: { x: number; y: number },
  fromMs: number,
  steps: number,
  playerVelocity: { x: number; y: number } = { x: 0, y: 0 },
) {
  let current = watchers
  const strikes: string[] = []
  let simulationMs = fromMs
  for (let step = 0; step < steps; step += 1) {
    simulationMs += STEP_MS
    const result = advanceSnakeWatchers(
      current,
      playerPosition,
      playerVelocity,
      true,
      simulationMs,
      STEP_MS,
    )
    current = result.watchers
    for (const strike of result.strikes) strikes.push(strike.watcherId)
  }
  return { watchers: current, strikes, simulationMs }
}

describe('company watchers', () => {
  it('scales with suspicion and never exceeds the approved ceiling', () => {
    expect(snakeWatcherCountForSuspicion(24.9)).toBe(0)
    expect(snakeWatcherCountForSuspicion(25)).toBe(1)
    expect(snakeWatcherCountForSuspicion(45)).toBe(3)
    expect(snakeWatcherCountForSuspicion(100)).toBe(4)
    expect(snakeWatcherCountForSuspicion(Number.NaN)).toBe(0)
    expect(createSnakeWatchers(9)).toHaveLength(
      SNAKE_WATCHER_CONFIG.maximumWatchers,
    )
  })

  it('spreads watchers around the field edge rather than stacking them', () => {
    const watchers = createSnakeWatchers(4)
    const positions = watchers.map(({ position }) => `${position.x},${position.y}`)

    expect(new Set(positions).size).toBe(4)
    for (const { position } of watchers) {
      expect(position.x).toBeGreaterThanOrEqual(0)
      expect(position.x).toBeLessThanOrEqual(RESOURCE_SNAKE_CONFIG.fieldWidth)
      expect(position.y).toBeGreaterThanOrEqual(0)
      expect(position.y).toBeLessThanOrEqual(RESOURCE_SNAKE_CONFIG.fieldHeight)
    }
    // The patrol walk closes on itself, so a lap returns to its start.
    const perimeter = 2 * (
      RESOURCE_SNAKE_CONFIG.fieldWidth + RESOURCE_SNAKE_CONFIG.fieldHeight
    )
    expect(snakeWatcherPatrolPosition(perimeter))
      .toEqual(snakeWatcherPatrolPosition(0))
  })

  it('winds up before it dashes, so the strike can be answered by moving', () => {
    const player = { x: 25, y: 12 }
    const patrolled = runWatchers(createSnakeWatchers(1), player, 0, 400)
    const telegraphing = patrolled.watchers[0]

    expect(telegraphing.phase).toBe('telegraph')
    // A still player is led nowhere, so the lane lands on them exactly.
    expect(telegraphing.chargeTo).toEqual(player)

    const winding = runWatchers(patrolled.watchers, player, patrolled.simulationMs, 2)
    expect(winding.watchers[0].phase).toBe('telegraph')
    expect(winding.strikes).toEqual([])
  })

  it('spends itself on each dash and is gone after three', () => {
    const player = { x: 25, y: 12 }
    let watchers = createSnakeWatchers(1)
    let simulationMs = 0
    const seenPhases = new Set<string>()

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const run = runWatchers(watchers, player, simulationMs, 900)
      watchers = run.watchers
      simulationMs = run.simulationMs
      seenPhases.add(watchers[0].phase)
    }

    expect(watchers[0].integrity).toBe(0)
    expect(watchers[0].phase).toBe('defeated')
    // A defeated watcher stays defeated rather than rejoining the patrol.
    const after = runWatchers(watchers, player, simulationMs, 600)
    expect(after.watchers[0].phase).toBe('defeated')
    expect(after.strikes).toEqual([])
  })

  it('lands a strike on a player that stands in the lane, and misses one that moves', () => {
    const player = { x: 25, y: 12 }
    const wound = runWatchers(createSnakeWatchers(1), player, 0, 400)

    const stationary = runWatchers(wound.watchers, player, wound.simulationMs, 600)
    expect(stationary.strikes.length).toBeGreaterThan(0)

    const dodged = runWatchers(
      wound.watchers,
      // Far outside the locked lane by the time the dash arrives.
      { x: 6, y: 3 },
      wound.simulationMs,
      600,
    )
    expect(dodged.strikes).toEqual([])
    // Dodging still costs the watcher the charge it spent.
    expect(dodged.watchers[0].integrity).toBeLessThan(
      SNAKE_WATCHER_CONFIG.maximumIntegrity,
    )
  })

  it('holds still while the player is not active', () => {
    const watchers = createSnakeWatchers(2)
    const result = advanceSnakeWatchers(
      watchers,
      { x: 25, y: 12 },
      { x: 0, y: 0 },
      false,
      SNAKE_WATCHER_CONFIG.patrolMs * 4,
      STEP_MS,
    )

    expect(result.strikes).toEqual([])
    expect(result.watchers.every(({ phase }) => phase === 'patrol')).toBe(true)
  })

  it('staggers the wind-ups so four watchers arrive in sequence', () => {
    const watchers = createSnakeWatchers(4)
    const starts = watchers.map(({ phaseStartedAtMs }) => phaseStartedAtMs)

    expect(new Set(starts).size).toBe(4)
    expect(Math.max(...starts) - Math.min(...starts))
      .toBeGreaterThanOrEqual(SNAKE_WATCHER_CONFIG.patrolMs / 2)

    // Only the earliest is winding up when the first window closes.
    const first = runWatchers(watchers, { x: 25, y: 12 }, 0, 400)
    const windingUp = first.watchers.filter(({ phase }) => phase !== 'patrol')
    expect(windingUp.length).toBeLessThan(4)
  })

  it('replays identically for the same clock and player path', () => {
    const player = { x: 20, y: 9 }
    const first = runWatchers(createSnakeWatchers(3), player, 0, 700)
    const second = runWatchers(createSnakeWatchers(3), player, 0, 700)

    expect(second.watchers).toEqual(first.watchers)
    expect(second.strikes).toEqual(first.strikes)
  })

  it('keeps the strike radius tied to the player head', () => {
    expect(snakeWatcherStrikeRadius()).toBeCloseTo(
      RESOURCE_SNAKE_CONFIG.headRadius + SNAKE_WATCHER_CONFIG.strikeMargin,
      8,
    )
  })
})
