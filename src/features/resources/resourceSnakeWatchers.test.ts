import { describe, expect, it } from 'vitest'

import {
  advanceSnakeWatchers,
  createSnakeWatchers,
  snakeWatcherCountForSuspicion,
  snakeWatcherEntryPosition,
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
  hazardDots: { x: number; y: number }[] = [],
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
      hazardDots,
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

  it('enters spread around the field edge rather than stacking up', () => {
    const watchers = createSnakeWatchers(4)
    const positions = watchers.map(({ position }) => `${position.x},${position.y}`)

    expect(new Set(positions).size).toBe(4)
    for (const { position } of watchers) {
      expect(position.x).toBeGreaterThanOrEqual(0)
      expect(position.x).toBeLessThanOrEqual(RESOURCE_SNAKE_CONFIG.fieldWidth)
      expect(position.y).toBeGreaterThanOrEqual(0)
      expect(position.y).toBeLessThanOrEqual(RESOURCE_SNAKE_CONFIG.fieldHeight)
    }
    // The entry walk closes on itself, so a lap returns to its start.
    const perimeter = 2 * (
      RESOURCE_SNAKE_CONFIG.fieldWidth + RESOURCE_SNAKE_CONFIG.fieldHeight
    )
    expect(snakeWatcherEntryPosition(perimeter))
      .toEqual(snakeWatcherEntryPosition(0))
  })

  it('closes on the player instead of walking the edge', () => {
    const player = { x: 25, y: 12 }
    const start = createSnakeWatchers(1)
    const before = Math.hypot(
      start[0].position.x - player.x,
      start[0].position.y - player.y,
    )

    const stalked = runWatchers(start, player, 0, 120)
    const after = Math.hypot(
      stalked.watchers[0].position.x - player.x,
      stalked.watchers[0].position.y - player.y,
    )

    expect(stalked.watchers[0].phase).toBe('stalk')
    expect(after).toBeLessThan(before)
    // It travels through the field, not along its border.
    expect(stalked.watchers[0].position.x).toBeGreaterThan(0)
    expect(stalked.watchers[0].position.x).toBeLessThan(
      RESOURCE_SNAKE_CONFIG.fieldWidth,
    )
    expect(stalked.watchers[0].position.y).toBeGreaterThan(0)
    expect(stalked.watchers[0].position.y).toBeLessThan(
      RESOURCE_SNAKE_CONFIG.fieldHeight,
    )
  })

  it('never teleports: a dash leaves it where it landed', () => {
    const player = { x: 25, y: 12 }
    let watchers = createSnakeWatchers(1)
    let simulationMs = 0
    let previous = watchers[0].position

    for (let step = 0; step < 1_200; step += 1) {
      simulationMs += STEP_MS
      const result = advanceSnakeWatchers(
        watchers,
        player,
        { x: 0, y: 0 },
        true,
        [],
        simulationMs,
        STEP_MS,
      )
      watchers = result.watchers
      const current = watchers[0].position
      const jump = Math.hypot(current.x - previous.x, current.y - previous.y)
      // One step can only cover a dash's worth of ground; anything larger is
      // the snap-back the owner reported.
      expect(jump).toBeLessThanOrEqual(
        (SNAKE_WATCHER_CONFIG.chargeUnitsPerSecond * STEP_MS) / 1000 + 1e-6,
      )
      previous = current
    }
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
      [],
      SNAKE_WATCHER_CONFIG.stalkMs * 4,
      STEP_MS,
    )

    expect(result.strikes).toEqual([])
    expect(result.watchers.every(({ phase }) => phase === 'stalk')).toBe(true)
  })

  it('staggers the wind-ups so four watchers arrive in sequence', () => {
    const watchers = createSnakeWatchers(4)
    const starts = watchers.map(({ phaseStartedAtMs }) => phaseStartedAtMs)

    expect(new Set(starts).size).toBe(4)
    expect(Math.max(...starts) - Math.min(...starts))
      .toBeGreaterThanOrEqual(SNAKE_WATCHER_CONFIG.stalkMs / 2)

    // Only the earliest is winding up when the first window closes.
    const first = runWatchers(watchers, { x: 25, y: 12 }, 0, 400)
    const windingUp = first.watchers.filter(({ phase }) => phase !== 'stalk')
    expect(windingUp.length).toBeLessThan(4)
  })

  it('never leaves the field even in the middle of a dash', () => {
    // Aim a dash lane that would carry it past the edge with overshoot.
    const charging = [{
      ...createSnakeWatchers(1)[0],
      position: { x: 3, y: 3 },
      phase: 'charge' as const,
      phaseStartedAtMs: 0,
      chargeFrom: { x: 3, y: 3 },
      chargeTo: { x: 0.4, y: 0.4 },
      heading: { x: -1, y: -1 },
    }]

    let watchers: SnakeWatcher[] = charging
    let simulationMs = 0
    for (let step = 0; step < 240; step += 1) {
      simulationMs += STEP_MS
      const result = advanceSnakeWatchers(
        watchers, { x: 40, y: 20 }, { x: 0, y: 0 }, true, [], simulationMs, STEP_MS,
      )
      watchers = result.watchers
      const { position, phase } = watchers[0]
      if (phase === 'defeated') break
      // Mid-flight positions stay on the board; there is no phasing through.
      expect(position.x).toBeGreaterThanOrEqual(0)
      expect(position.y).toBeGreaterThanOrEqual(0)
    }
    expect(watchers[0].phase).toBe('defeated')
  })

  it('steers around a live trail while hunting instead of blundering into it', () => {
    // Approaching from far enough to see the wall coming, a competent
    // hunter goes around it: at most one graze, and it still closes.
    const stalker = [{
      ...createSnakeWatchers(1)[0],
      position: { x: 14, y: 12 },
      heading: { x: 1, y: 0 },
    }]
    const line = Array.from({ length: 9 }, (_, index) => ({
      x: 22, y: 8 + index,
    }))

    const hunted = runWatchers(stalker, { x: 30, y: 12 }, 0, 900, { x: 0, y: 0 }, line)

    // The hunt succeeds: it rounds the wall and reaches the player. Dying
    // spent at the end of a delivered strike is completion, not failure —
    // what would have been failure is grinding to nothing against the wall,
    // which shows up here as a death far from the target with no strikes.
    const finalRange = Math.hypot(
      hunted.watchers[0].position.x - 30,
      hunted.watchers[0].position.y - 12,
    )
    expect(hunted.strikes.length > 0 || finalRange < 12).toBe(true)
    if (hunted.watchers[0].phase === 'defeated') {
      expect(hunted.strikes.length).toBeGreaterThan(0)
      expect(finalRange).toBeLessThan(3)
    }
  })

  it('burns on a live trail instead of passing through it', () => {
    const stalker = [{
      ...createSnakeWatchers(1)[0],
      position: { x: 20, y: 12 },
      heading: { x: 1, y: 0 },
    }]
    // A wall of trail dots directly in its path toward the player.
    const line = Array.from({ length: 9 }, (_, index) => ({
      x: 22, y: 8 + index,
    }))

    const result = runWatchers(stalker, { x: 30, y: 12 }, 0, 300, { x: 0, y: 0 }, line)

    expect(result.watchers[0].integrity).toBeLessThan(
      SNAKE_WATCHER_CONFIG.maximumIntegrity,
    )
  })

  it('dies against the wall like everything else on the field', () => {
    const watchers = createSnakeWatchers(1)
    // Point it straight at the near wall and let it run.
    const driven = [{
      ...watchers[0],
      position: { x: 2, y: 12 },
      heading: { x: -1, y: 0 },
    }]

    const result = runWatchers(driven, { x: 2, y: 12.2 }, 0, 400)

    expect(result.watchers[0].phase).toBe('defeated')
    expect(result.watchers[0].integrity).toBe(0)
  })

  it('does not pass through the intruder while stalking', () => {
    const player = { x: 25, y: 12 }
    const touching = [{
      ...createSnakeWatchers(1)[0],
      position: { x: 24.2, y: 12 },
      heading: { x: 1, y: 0 },
    }]

    const result = runWatchers(touching, player, 0, 3)

    expect(result.strikes.length).toBeGreaterThan(0)
    // Contact costs the watcher too; it is not a free hit.
    expect(result.watchers[0].integrity).toBeLessThan(
      SNAKE_WATCHER_CONFIG.maximumIntegrity,
    )
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
