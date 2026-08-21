export type SnakeDirection8 =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west'

type SnakeCardinalDirection = 'north' | 'east' | 'south' | 'west'

type SnakeInputKey =
  | 'w'
  | 'a'
  | 's'
  | 'd'
  | 'arrowup'
  | 'arrowleft'
  | 'arrowdown'
  | 'arrowright'

export interface SnakeDirectionVector {
  readonly x: number
  readonly y: number
}

export interface ResourceSnakePendingChord {
  readonly direction: SnakeCardinalDirection
  readonly key: SnakeInputKey
  readonly startedAtMs: number
}

export interface ResourceSnakeInputState {
  readonly heading: SnakeDirection8
  readonly pendingChord: ResourceSnakePendingChord | null
  readonly pressedKeys: readonly SnakeInputKey[]
  readonly queuedTurns: readonly SnakeDirection8[]
  readonly timestampMs: number
}

export const RESOURCE_SNAKE_CHORD_WINDOW_MS = 24

const DIAGONAL_COMPONENT = Math.SQRT1_2

export const SNAKE_DIRECTION_VECTORS: Readonly<
  Record<SnakeDirection8, SnakeDirectionVector>
> = Object.freeze({
  north: Object.freeze({ x: 0, y: -1 }),
  'north-east': Object.freeze({ x: DIAGONAL_COMPONENT, y: -DIAGONAL_COMPONENT }),
  east: Object.freeze({ x: 1, y: 0 }),
  'south-east': Object.freeze({ x: DIAGONAL_COMPONENT, y: DIAGONAL_COMPONENT }),
  south: Object.freeze({ x: 0, y: 1 }),
  'south-west': Object.freeze({ x: -DIAGONAL_COMPONENT, y: DIAGONAL_COMPONENT }),
  west: Object.freeze({ x: -1, y: 0 }),
  'north-west': Object.freeze({ x: -DIAGONAL_COMPONENT, y: -DIAGONAL_COMPONENT }),
})

const INPUT_KEY_DIRECTIONS: Readonly<Record<SnakeInputKey, SnakeCardinalDirection>> =
  Object.freeze({
    w: 'north',
    arrowup: 'north',
    d: 'east',
    arrowright: 'east',
    s: 'south',
    arrowdown: 'south',
    a: 'west',
    arrowleft: 'west',
  })

const CARDINAL_AXES: Readonly<
  Record<SnakeCardinalDirection, Readonly<{ x: -1 | 0 | 1; y: -1 | 0 | 1 }>>
> = Object.freeze({
  north: Object.freeze({ x: 0, y: -1 }),
  east: Object.freeze({ x: 1, y: 0 }),
  south: Object.freeze({ x: 0, y: 1 }),
  west: Object.freeze({ x: -1, y: 0 }),
})

const COMBINED_DIRECTIONS: Readonly<Record<string, SnakeDirection8>> = Object.freeze({
  '1,-1': 'north-east',
  '1,1': 'south-east',
  '-1,1': 'south-west',
  '-1,-1': 'north-west',
})

const OPPOSITE_DIRECTIONS: Readonly<Record<SnakeDirection8, SnakeDirection8>> =
  Object.freeze({
    north: 'south',
    'north-east': 'south-west',
    east: 'west',
    'south-east': 'north-west',
    south: 'north',
    'south-west': 'north-east',
    west: 'east',
    'north-west': 'south-east',
  })

function canonicalInputKey(key: string): SnakeInputKey | null {
  const canonical = key.toLowerCase()
  return Object.prototype.hasOwnProperty.call(INPUT_KEY_DIRECTIONS, canonical)
    ? canonical as SnakeInputKey
    : null
}

function immutableState(
  state: Omit<ResourceSnakeInputState, 'pressedKeys' | 'queuedTurns'> & {
    readonly pressedKeys: readonly SnakeInputKey[]
    readonly queuedTurns: readonly SnakeDirection8[]
  },
): ResourceSnakeInputState {
  const pendingChord = state.pendingChord === null
    ? null
    : Object.freeze({ ...state.pendingChord })
  return Object.freeze({
    ...state,
    pendingChord,
    pressedKeys: Object.freeze([...state.pressedKeys]),
    queuedTurns: Object.freeze([...state.queuedTurns]),
  })
}

function monotonicTimestamp(previousMs: number, candidateMs: number): number {
  if (!Number.isFinite(candidateMs)) return previousMs
  return Math.max(previousMs, candidateMs, 0)
}

function effectiveHeading(state: ResourceSnakeInputState): SnakeDirection8 {
  return state.queuedTurns.at(-1) ?? state.heading
}

function queueResolvedDirection(
  state: ResourceSnakeInputState,
  direction: SnakeDirection8,
): ResourceSnakeInputState {
  if (state.queuedTurns.length >= 2) return state
  const previousHeading = effectiveHeading(state)
  if (
    direction === previousHeading
    || direction === OPPOSITE_DIRECTIONS[previousHeading]
  ) return state
  return immutableState({
    ...state,
    queuedTurns: [...state.queuedTurns, direction],
  })
}

function combinePerpendicularCardinals(
  first: SnakeCardinalDirection,
  second: SnakeCardinalDirection,
): SnakeDirection8 | null {
  const firstAxis = CARDINAL_AXES[first]
  const secondAxis = CARDINAL_AXES[second]
  if (firstAxis.x * secondAxis.x + firstAxis.y * secondAxis.y !== 0) return null
  return COMBINED_DIRECTIONS[
    `${firstAxis.x + secondAxis.x},${firstAxis.y + secondAxis.y}`
  ] ?? null
}

export function createResourceSnakeInputState(
  heading: SnakeDirection8,
): ResourceSnakeInputState {
  return immutableState({
    heading,
    pendingChord: null,
    pressedKeys: [],
    queuedTurns: [],
    timestampMs: 0,
  })
}

export function flushResourceSnakeChord(
  state: ResourceSnakeInputState,
  timestampMs: number,
): ResourceSnakeInputState {
  const nextTimestampMs = monotonicTimestamp(state.timestampMs, timestampMs)
  if (state.pendingChord === null) {
    if (nextTimestampMs === state.timestampMs) return state
    return immutableState({ ...state, timestampMs: nextTimestampMs })
  }
  if (
    nextTimestampMs - state.pendingChord.startedAtMs
    <= RESOURCE_SNAKE_CHORD_WINDOW_MS
  ) {
    if (nextTimestampMs === state.timestampMs) return state
    return immutableState({ ...state, timestampMs: nextTimestampMs })
  }

  const pendingDirection = state.pendingChord.direction
  const withoutPending = immutableState({
    ...state,
    pendingChord: null,
    timestampMs: nextTimestampMs,
  })
  return queueResolvedDirection(withoutPending, pendingDirection)
}

export function pressResourceSnakeKey(
  state: ResourceSnakeInputState,
  key: string,
  timestampMs: number,
  repeat = false,
): ResourceSnakeInputState {
  const canonicalKey = canonicalInputKey(key)
  if (canonicalKey === null) return state

  let next = flushResourceSnakeChord(state, timestampMs)
  if (repeat || next.pressedKeys.includes(canonicalKey)) return next

  const pressedKeys = [...next.pressedKeys, canonicalKey]
  const direction = INPUT_KEY_DIRECTIONS[canonicalKey]
  if (next.pendingChord === null) {
    return immutableState({
      ...next,
      pendingChord: {
        direction,
        key: canonicalKey,
        startedAtMs: next.timestampMs,
      },
      pressedKeys,
    })
  }

  const combined = combinePerpendicularCardinals(
    next.pendingChord.direction,
    direction,
  )
  if (combined !== null) {
    next = immutableState({
      ...next,
      pendingChord: null,
      pressedKeys,
    })
    return queueResolvedDirection(next, combined)
  }

  if (direction === next.pendingChord.direction) {
    return immutableState({ ...next, pressedKeys })
  }

  const firstDirection = next.pendingChord.direction
  next = immutableState({
    ...next,
    pendingChord: {
      direction,
      key: canonicalKey,
      startedAtMs: next.timestampMs,
    },
    pressedKeys,
  })
  return queueResolvedDirection(next, firstDirection)
}

export function releaseResourceSnakeKey(
  state: ResourceSnakeInputState,
  key: string,
): ResourceSnakeInputState {
  const canonicalKey = canonicalInputKey(key)
  if (canonicalKey === null || !state.pressedKeys.includes(canonicalKey)) return state
  return immutableState({
    ...state,
    pressedKeys: state.pressedKeys.filter((pressedKey) => pressedKey !== canonicalKey),
  })
}

export function consumeResourceSnakeTurn(
  state: ResourceSnakeInputState,
): Readonly<{ state: ResourceSnakeInputState; turn: SnakeDirection8 | null }> {
  const turn = state.queuedTurns[0] ?? null
  if (turn === null) return Object.freeze({ state, turn })
  return Object.freeze({
    state: immutableState({
      ...state,
      heading: turn,
      queuedTurns: state.queuedTurns.slice(1),
    }),
    turn,
  })
}

export function resetPressedSnakeKeys(
  state: ResourceSnakeInputState,
): ResourceSnakeInputState {
  if (
    state.pressedKeys.length === 0
    && state.queuedTurns.length === 0
    && state.pendingChord === null
  ) return state
  return immutableState({
    ...state,
    pendingChord: null,
    pressedKeys: [],
    queuedTurns: [],
  })
}
