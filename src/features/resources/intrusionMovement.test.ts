import { describe, expect, it } from 'vitest'

import {
  advanceHeldMovement,
  clearHeldMovement,
  createHeldMovementState,
  createPlayerMotion,
  pressMovementKey,
  releaseMovementKey,
  retargetPlayerMotion,
  samplePlayerMotion,
} from './intrusionMovement'

describe('held intrusion movement', () => {
  it.each([
    ['ArrowUp', { dx: 0, dy: -1 }],
    ['ArrowRight', { dx: 1, dy: 0 }],
    ['ArrowDown', { dx: 0, dy: 1 }],
    ['ArrowLeft', { dx: -1, dy: 0 }],
    ['w', { dx: 0, dy: -1 }],
    ['D', { dx: 1, dy: 0 }],
    ['s', { dx: 0, dy: 1 }],
    ['A', { dx: -1, dy: 0 }],
  ])('moves immediately when %s is first pressed', (key, expected) => {
    const transition = pressMovementKey(
      createHeldMovementState(),
      key,
      1_000,
      70,
    )

    expect(transition.movement).toEqual(expected)
  })

  it('ignores browser key-repeat events and repeats only on its own cadence', () => {
    const first = pressMovementKey(
      createHeldMovementState(),
      'ArrowRight',
      100,
      70,
    )
    const browserRepeat = pressMovementKey(first.state, 'ArrowRight', 124, 70)
    const tooEarly = advanceHeldMovement(browserRepeat.state, 169, 70)
    const onCadence = advanceHeldMovement(tooEarly.state, 170, 70)

    expect(browserRepeat.movement).toBeNull()
    expect(tooEarly.movement).toBeNull()
    expect(onCadence.movement).toEqual({ dx: 1, dy: 0 })
  })

  it('combines perpendicular held keys into a normalized diagonal and restores on release', () => {
    const right = pressMovementKey(
      createHeldMovementState(),
      'ArrowRight',
      0,
      70,
    )
    const up = pressMovementKey(right.state, 'w', 20, 70)
    const repeatedUp = advanceHeldMovement(up.state, 90, 70)
    const releasedUp = releaseMovementKey(repeatedUp.state, 'w')
    const restoredRight = advanceHeldMovement(releasedUp, 160, 70)

    expect(up.movement?.dx).toBeCloseTo(Math.SQRT1_2)
    expect(up.movement?.dy).toBeCloseTo(-Math.SQRT1_2)
    expect(repeatedUp.movement?.dx).toBeCloseTo(Math.SQRT1_2)
    expect(repeatedUp.movement?.dy).toBeCloseTo(-Math.SQRT1_2)
    expect(restoredRight.movement).toEqual({ dx: 1, dy: 0 })
  })

  it('stops after keyup and clears every held direction on blur or suspension', () => {
    const pressed = pressMovementKey(
      createHeldMovementState(),
      'd',
      0,
      70,
    )
    const released = releaseMovementKey(pressed.state, 'd')
    const afterRelease = advanceHeldMovement(released, 500, 70)
    const withTwoKeys = pressMovementKey(
      pressMovementKey(pressed.state, 'w', 10, 70).state,
      'a',
      20,
      70,
    ).state
    const cleared = clearHeldMovement(withTwoKeys)

    expect(afterRelease.movement).toBeNull()
    expect(cleared.heldKeys).toEqual([])
    expect(advanceHeldMovement(cleared, 500, 70).movement).toBeNull()
  })
})

describe('intrusion player presentation motion', () => {
  it('eases between discrete logical cells and settles exactly on the target', () => {
    const initial = createPlayerMotion({ x: 4, y: 7 }, 0, 100)
    const moving = retargetPlayerMotion(
      initial,
      { x: 5, y: 7 },
      0,
      100,
      false,
    )
    const midpoint = samplePlayerMotion(moving, 50)

    expect(midpoint.x).toBeGreaterThan(4)
    expect(midpoint.x).toBeLessThan(5)
    expect(midpoint.y).toBe(7)
    expect(samplePlayerMotion(moving, 100)).toEqual({ x: 5, y: 7 })
  })

  it('retargets from the current rendered point without snapping backward', () => {
    const first = retargetPlayerMotion(
      createPlayerMotion({ x: 0, y: 0 }, 0, 100),
      { x: 1, y: 0 },
      0,
      100,
      false,
    )
    const renderedAtRetarget = samplePlayerMotion(first, 40)
    const second = retargetPlayerMotion(
      first,
      { x: 2, y: 0 },
      40,
      100,
      false,
    )

    expect(samplePlayerMotion(second, 40)).toEqual(renderedAtRetarget)
    expect(renderedAtRetarget.x).toBeGreaterThan(0)
    expect(renderedAtRetarget.x).toBeLessThan(1)
    expect(samplePlayerMotion(second, 140)).toEqual({ x: 2, y: 0 })
  })

  it('snaps presentation to the logical cell when reduced motion is enabled', () => {
    const reduced = retargetPlayerMotion(
      createPlayerMotion({ x: 3, y: 3 }, 0, 100),
      { x: 4, y: 3 },
      10,
      100,
      true,
    )

    expect(samplePlayerMotion(reduced, 10)).toEqual({ x: 4, y: 3 })
  })
})
