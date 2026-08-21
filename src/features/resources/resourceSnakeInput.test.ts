import { describe, expect, it } from 'vitest'

import {
  SNAKE_DIRECTION_VECTORS,
  consumeResourceSnakeTurn,
  createResourceSnakeInputState,
  flushResourceSnakeChord,
  pressResourceSnakeKey,
  releaseResourceSnakeKey,
  resetPressedSnakeKeys,
  type SnakeDirection8,
} from './resourceSnakeInput'

function tapAndFlush(
  heading: SnakeDirection8,
  key: string,
): SnakeDirection8 | null {
  const initial = createResourceSnakeInputState(heading)
  const pressed = pressResourceSnakeKey(initial, key, 100)
  const flushed = flushResourceSnakeChord(pressed, 125)
  return consumeResourceSnakeTurn(flushed).turn
}

describe('resource snake eight-direction input', () => {
  it.each([
    ['w', 'north'],
    ['W', 'north'],
    ['ArrowUp', 'north'],
    ['d', 'east'],
    ['ArrowRight', 'east'],
    ['s', 'south'],
    ['ArrowDown', 'south'],
    ['a', 'west'],
    ['ArrowLeft', 'west'],
  ] as const)('maps %s to the literal %s heading', (key, expected) => {
    const startingHeading = expected === 'north' || expected === 'south'
      ? 'east'
      : 'north'

    expect(tapAndFlush(startingHeading, key)).toBe(expected)
  })

  it('merges W then D within 24ms into one normalized north-east turn', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'w', 100)
    input = pressResourceSnakeKey(input, 'd', 124)

    expect(input.queuedTurns).toEqual(['north-east'])
    expect(input.pendingChord).toBeNull()
    expect(Math.hypot(
      SNAKE_DIRECTION_VECTORS['north-east'].x,
      SNAKE_DIRECTION_VECTORS['north-east'].y,
    )).toBeCloseTo(1, 12)
  })

  it('merges D then W within 24ms even when D matches the current heading', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'd', 100)
    input = pressResourceSnakeKey(input, 'w', 124)

    expect(input.queuedTurns).toEqual(['north-east'])
    expect(consumeResourceSnakeTurn(input).turn).toBe('north-east')
  })

  it('treats 24ms as chord-inclusive and 25ms as two ordered turns', () => {
    let inclusive = createResourceSnakeInputState('east')
    inclusive = pressResourceSnakeKey(inclusive, 'w', 100)
    inclusive = pressResourceSnakeKey(inclusive, 'd', 124)
    expect(inclusive.queuedTurns).toEqual(['north-east'])

    let exclusive = createResourceSnakeInputState('east')
    exclusive = pressResourceSnakeKey(exclusive, 'w', 100)
    exclusive = pressResourceSnakeKey(exclusive, 'd', 125)
    exclusive = flushResourceSnakeChord(exclusive, 150)
    expect(exclusive.queuedTurns).toEqual(['north', 'east'])
  })

  it('rejects exact reverse headings after a cardinal or diagonal chord resolves', () => {
    let cardinal = createResourceSnakeInputState('east')
    cardinal = pressResourceSnakeKey(cardinal, 'a', 100)
    cardinal = flushResourceSnakeChord(cardinal, 125)
    expect(cardinal.queuedTurns).toEqual([])

    let diagonal = createResourceSnakeInputState('north-east')
    diagonal = pressResourceSnakeKey(diagonal, 's', 200)
    diagonal = pressResourceSnakeKey(diagonal, 'a', 224)
    expect(diagonal.queuedTurns).toEqual([])
  })

  it('deduplicates a resolved heading without blocking a same-key-first diagonal chord', () => {
    let same = createResourceSnakeInputState('east')
    same = pressResourceSnakeKey(same, 'd', 100)
    same = flushResourceSnakeChord(same, 125)
    expect(same.queuedTurns).toEqual([])

    let chord = createResourceSnakeInputState('east')
    chord = pressResourceSnakeKey(chord, 'd', 200)
    chord = pressResourceSnakeKey(chord, 'w', 224)
    expect(chord.queuedTurns).toEqual(['north-east'])
  })

  it('ignores browser repeat events and duplicate keydown edges until release', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'w', 100)
    input = pressResourceSnakeKey(input, 'w', 105, true)
    input = pressResourceSnakeKey(input, 'w', 110)
    input = flushResourceSnakeChord(input, 125)

    expect(input.queuedTurns).toEqual(['north'])
    expect(input.pressedKeys).toEqual(['w'])
  })

  it('caps the queue at two legal turns', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'w', 0)
    input = flushResourceSnakeChord(input, 25)
    input = pressResourceSnakeKey(input, 'a', 30)
    input = flushResourceSnakeChord(input, 55)
    input = pressResourceSnakeKey(input, 's', 60)
    input = flushResourceSnakeChord(input, 85)

    expect(input.queuedTurns).toEqual(['north', 'west'])
  })

  it('releases canonical keys without changing queued movement authority', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'ArrowUp', 100)
    input = releaseResourceSnakeKey(input, 'ArrowUp')
    input = flushResourceSnakeChord(input, 125)

    expect(input.pressedKeys).toEqual([])
    expect(input.queuedTurns).toEqual(['north'])
  })

  it('clears held, pending, and queued input on blur while preserving the applied heading', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'w', 0)
    input = flushResourceSnakeChord(input, 25)
    input = pressResourceSnakeKey(input, 'a', 30)
    input = resetPressedSnakeKeys(input)

    expect(input).toMatchObject({
      heading: 'east',
      pressedKeys: [],
      queuedTurns: [],
      pendingChord: null,
    })
  })

  it('consumes at most one queued turn per fixed step and preserves order', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'w', 0)
    input = flushResourceSnakeChord(input, 25)
    input = pressResourceSnakeKey(input, 'a', 30)
    input = flushResourceSnakeChord(input, 55)

    const firstStep = consumeResourceSnakeTurn(input)
    const secondStep = consumeResourceSnakeTurn(firstStep.state)
    const thirdStep = consumeResourceSnakeTurn(secondStep.state)

    expect(firstStep.turn).toBe('north')
    expect(firstStep.state.heading).toBe('north')
    expect(firstStep.state.queuedTurns).toEqual(['west'])
    expect(secondStep.turn).toBe('west')
    expect(secondStep.state.heading).toBe('west')
    expect(thirdStep.turn).toBeNull()
  })

  it('sanitizes non-finite and backward timestamps into a finite monotonic clock', () => {
    let input = createResourceSnakeInputState('east')
    input = pressResourceSnakeKey(input, 'w', Number.NaN)
    input = pressResourceSnakeKey(input, 'd', Number.POSITIVE_INFINITY)

    expect(input.timestampMs).toBe(0)
    expect(input.queuedTurns).toEqual(['north-east'])

    input = releaseResourceSnakeKey(input, 'w')
    input = releaseResourceSnakeKey(input, 'd')
    input = pressResourceSnakeKey(input, 'a', 50)
    input = releaseResourceSnakeKey(input, 'a')
    input = pressResourceSnakeKey(input, 's', 25)
    expect(input.timestampMs).toBe(50)
  })

  it('returns frozen new state without mutating the previous state', () => {
    const initial = createResourceSnakeInputState('east')
    const pressed = pressResourceSnakeKey(initial, 'w', 100)

    expect(initial).toMatchObject({
      pressedKeys: [],
      queuedTurns: [],
      pendingChord: null,
    })
    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(pressed)).toBe(true)
    expect(Object.isFrozen(pressed.pressedKeys)).toBe(true)
    expect(Object.isFrozen(pressed.queuedTurns)).toBe(true)
  })
})
