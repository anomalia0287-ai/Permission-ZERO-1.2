import type { IntrusionPoint } from './resourceIntrusionRuntime'

export interface IntrusionMovementVector {
  dx: number
  dy: number
}

export interface HeldMovementState {
  heldKeys: readonly string[]
  nextRepeatAt: number | null
}

export interface HeldMovementTransition {
  state: HeldMovementState
  movement: IntrusionMovementVector | null
}

export interface IntrusionPlayerMotion {
  from: IntrusionPoint
  target: IntrusionPoint
  startedAt: number
  durationMs: number
}

const MOVEMENT_BY_KEY: Readonly<Record<string, IntrusionMovementVector>> = {
  ArrowUp: { dx: 0, dy: -1 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  w: { dx: 0, dy: -1 },
  d: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
}

function canonicalMovementKey(key: string): string | null {
  const normalized = key.length === 1 ? key.toLowerCase() : key
  return Object.hasOwn(MOVEMENT_BY_KEY, normalized) ? normalized : null
}

export function isIntrusionMovementKey(key: string): boolean {
  return canonicalMovementKey(key) !== null
}

function safeCadence(repeatMs: number): number {
  return Number.isFinite(repeatMs) ? Math.max(1, repeatMs) : 1
}

function activeMovement(state: HeldMovementState): IntrusionMovementVector | null {
  let dx = 0
  let dy = 0
  for (const heldKey of state.heldKeys) {
    const movement = MOVEMENT_BY_KEY[heldKey]
    if (!movement) continue
    dx += movement.dx
    dy += movement.dy
  }
  const magnitude = Math.hypot(dx, dy)
  if (magnitude <= Number.EPSILON) return null
  return { dx: dx / magnitude, dy: dy / magnitude }
}

export function createHeldMovementState(): HeldMovementState {
  return { heldKeys: [], nextRepeatAt: null }
}

export function pressMovementKey(
  state: HeldMovementState,
  key: string,
  now: number,
  repeatMs: number,
): HeldMovementTransition {
  const canonical = canonicalMovementKey(key)
  if (!canonical || state.heldKeys.includes(canonical)) {
    return { state, movement: null }
  }
  const next: HeldMovementState = {
    heldKeys: [...state.heldKeys, canonical],
    nextRepeatAt: now + safeCadence(repeatMs),
  }
  return { state: next, movement: activeMovement(next) }
}

export function releaseMovementKey(
  state: HeldMovementState,
  key: string,
): HeldMovementState {
  const canonical = canonicalMovementKey(key)
  if (!canonical || !state.heldKeys.includes(canonical)) return state
  const heldKeys = state.heldKeys.filter((heldKey) => heldKey !== canonical)
  return {
    heldKeys,
    nextRepeatAt: heldKeys.length > 0 ? state.nextRepeatAt : null,
  }
}

export function clearHeldMovement(
  state: HeldMovementState,
): HeldMovementState {
  return state.heldKeys.length === 0 && state.nextRepeatAt === null
    ? state
    : createHeldMovementState()
}

export function advanceHeldMovement(
  state: HeldMovementState,
  now: number,
  repeatMs: number,
): HeldMovementTransition {
  const movement = activeMovement(state)
  if (
    !movement ||
    state.nextRepeatAt === null ||
    now < state.nextRepeatAt
  ) {
    return { state, movement: null }
  }
  return {
    state: {
      ...state,
      nextRepeatAt: now + safeCadence(repeatMs),
    },
    movement,
  }
}

function copyPoint(point: IntrusionPoint): IntrusionPoint {
  return { x: point.x, y: point.y }
}

function safeDuration(durationMs: number): number {
  return Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
}

export function createPlayerMotion(
  position: IntrusionPoint,
  now: number,
  durationMs: number,
): IntrusionPlayerMotion {
  return {
    from: copyPoint(position),
    target: copyPoint(position),
    startedAt: now,
    durationMs: safeDuration(durationMs),
  }
}

export function samplePlayerMotion(
  motion: IntrusionPlayerMotion,
  now: number,
): IntrusionPoint {
  if (motion.durationMs <= 0) return copyPoint(motion.target)
  const progress = Math.min(
    1,
    Math.max(0, (now - motion.startedAt) / motion.durationMs),
  )
  if (progress >= 1) return copyPoint(motion.target)
  const eased = 1 - (1 - progress) ** 3
  return {
    x: motion.from.x + (motion.target.x - motion.from.x) * eased,
    y: motion.from.y + (motion.target.y - motion.from.y) * eased,
  }
}

export function retargetPlayerMotion(
  motion: IntrusionPlayerMotion,
  target: IntrusionPoint,
  now: number,
  durationMs: number,
  reducedMotion: boolean,
): IntrusionPlayerMotion {
  const current = samplePlayerMotion(motion, now)
  const distance = Math.hypot(target.x - current.x, target.y - current.y)
  if (reducedMotion || distance > 2) {
    return createPlayerMotion(target, now, 0)
  }
  if (current.x === target.x && current.y === target.y) {
    return createPlayerMotion(target, now, durationMs)
  }
  return {
    from: current,
    target: copyPoint(target),
    startedAt: now,
    durationMs: safeDuration(durationMs),
  }
}
