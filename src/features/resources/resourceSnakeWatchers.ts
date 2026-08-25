import { RESOURCE_SNAKE_CONFIG } from './resourceSnakeRuntime'
import type { SnakeVector } from './resourceSnakePlannerTypes'

/**
 * Company surveillance on the grid.
 *
 * Watchers are not security bots: they carry no trail, ignore the bots
 * entirely, and exist only to run at the intruder. Suspicion is what puts
 * them on the field, so the player's own record decides how crowded it gets.
 * A charge costs a watcher part of itself, which makes each one a pressure
 * timer rather than a permanent hazard — surviving three dashes is a way to
 * beat it without ever being able to shoot back.
 */
export type SnakeWatcherPhase =
  | 'stalk'
  | 'telegraph'
  | 'charge'
  | 'recover'
  | 'defeated'

export interface SnakeWatcher {
  id: string
  position: SnakeVector
  integrity: number
  maximumIntegrity: number
  phase: SnakeWatcherPhase
  phaseStartedAtMs: number
  /** Where the current charge began, and the point it was aimed at. */
  chargeFrom: SnakeVector
  chargeTo: SnakeVector
  /** Current travel direction; steering turns it, nothing teleports it. */
  heading: SnakeVector
}

export const SNAKE_WATCHER_CONFIG = Object.freeze({
  maximumIntegrity: 30,
  /** Suspicion at which the company puts its first watcher on the field. */
  watchThreshold: 25,
  /** One more watcher for every this many points past the threshold. */
  suspicionPerWatcher: 10,
  maximumWatchers: 4,
  /** How long a watcher stalks before it commits to a dash. */
  stalkMs: 3_200,
  telegraphMs: 620,
  recoverMs: 900,
  /**
   * Slower than the player on purpose: a watcher closes ground while the
   * player is busy, and is escaped by moving — but it never stops coming.
   */
  stalkUnitsPerSecond: 7.5,
  /** Steering limit, so it banks toward the player instead of snapping. */
  stalkTurnRadiansPerSecond: 2.4,
  /** Distance at which it stops closing and commits to the dash instead. */
  commitDistance: 26,
  /**
   * Roughly twice the player's top speed. A slower dash spends so long in
   * flight that the lead is stale by the time it arrives, which made the
   * whole threat miss by default.
   */
  chargeUnitsPerSecond: 22,
  /** Health a watcher spends on one dash: three dashes and it is gone. */
  chargeSelfDamage: 10,
  /** Added to the player's head radius to decide whether a dash connected. */
  strikeMargin: 0.45,
  /** Distance past the aimed point before the dash gives up. */
  chargeOvershoot: 1.5,
})

/**
 * Read at call time rather than at module load: the runtime imports this
 * module, so touching its config while it is still initializing would leave
 * the constant undefined.
 */
export function snakeWatcherStrikeRadius(): number {
  return RESOURCE_SNAKE_CONFIG.headRadius + SNAKE_WATCHER_CONFIG.strikeMargin
}

export function snakeWatcherCountForSuspicion(suspicion: number): number {
  if (!Number.isFinite(suspicion) || suspicion < SNAKE_WATCHER_CONFIG.watchThreshold) {
    return 0
  }
  return Math.min(
    SNAKE_WATCHER_CONFIG.maximumWatchers,
    1 + Math.floor(
      (suspicion - SNAKE_WATCHER_CONFIG.watchThreshold)
      / SNAKE_WATCHER_CONFIG.suspicionPerWatcher,
    ),
  )
}

function perimeterLength(): number {
  return 2 * (RESOURCE_SNAKE_CONFIG.fieldWidth + RESOURCE_SNAKE_CONFIG.fieldHeight)
}

/** A point on the field's edge, used only to place watchers as they arrive. */
export function snakeWatcherEntryPosition(travelled: number): SnakeVector {
  const width = RESOURCE_SNAKE_CONFIG.fieldWidth
  const height = RESOURCE_SNAKE_CONFIG.fieldHeight
  const perimeter = perimeterLength()
  const along = ((travelled % perimeter) + perimeter) % perimeter
  if (along < width) return { x: along, y: 0 }
  if (along < width + height) return { x: width, y: along - width }
  if (along < width * 2 + height) {
    return { x: width - (along - width - height), y: height }
  }
  return { x: 0, y: height - (along - width * 2 - height) }
}

export function createSnakeWatchers(count: number): SnakeWatcher[] {
  const total = Math.max(0, Math.min(SNAKE_WATCHER_CONFIG.maximumWatchers, count))
  const perimeter = perimeterLength()
  const centre = {
    x: RESOURCE_SNAKE_CONFIG.fieldWidth / 2,
    y: RESOURCE_SNAKE_CONFIG.fieldHeight / 2,
  }
  return Array.from({ length: total }, (_, index) => {
    // They come in off the edge, spread around it, already facing the field.
    const position = snakeWatcherEntryPosition((perimeter * index) / Math.max(1, total))
    const inward = normalized({
      x: centre.x - position.x,
      y: centre.y - position.y,
    }, { x: 0, y: 1 })
    return {
      id: `watcher-${index}`,
      position,
      integrity: SNAKE_WATCHER_CONFIG.maximumIntegrity,
      maximumIntegrity: SNAKE_WATCHER_CONFIG.maximumIntegrity,
      phase: 'stalk' as const,
      // Staggered commits: four dashes at once is a wall, not a fight.
      phaseStartedAtMs: (SNAKE_WATCHER_CONFIG.stalkMs * index) / Math.max(1, total),
      chargeFrom: { ...position },
      chargeTo: { ...position },
      heading: inward,
    }
  })
}

export interface SnakeWatcherStrike {
  watcherId: string
  point: SnakeVector
}

export interface AdvanceSnakeWatchersResult {
  watchers: SnakeWatcher[]
  strikes: SnakeWatcherStrike[]
}

function distance(left: SnakeVector, right: SnakeVector): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function normalized(vector: SnakeVector, fallback: SnakeVector): SnakeVector {
  const length = Math.hypot(vector.x, vector.y)
  if (!Number.isFinite(length) || length <= 1e-6) return fallback
  return { x: vector.x / length, y: vector.y / length }
}

/** Turns `from` toward `to` by at most `limitRadians`. */
function steer(
  from: SnakeVector,
  to: SnakeVector,
  limitRadians: number,
): SnakeVector {
  const current = Math.atan2(from.y, from.x)
  const desired = Math.atan2(to.y, to.x)
  let delta = desired - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  const turned = current + Math.max(-limitRadians, Math.min(limitRadians, delta))
  return { x: Math.cos(turned), y: Math.sin(turned) }
}

/**
 * Steps every watcher one fixed step and reports any dash that connected.
 *
 * Deterministic: patrol position comes from the simulation clock, and a
 * charge aims at wherever the player stood when the telegraph opened, so the
 * same round replays the same way.
 */
/**
 * Where the dash should be aimed.
 *
 * Aiming at the player's current position makes the dash free to dodge —
 * anything moving is already a full body-length clear before the wind-up
 * ends. The lane leads the target instead, so holding a straight line is
 * punished and *changing* direction is the answer.
 */
function predictedStrikePoint(
  watcherPosition: SnakeVector,
  playerPosition: SnakeVector,
  playerVelocity: SnakeVector,
): SnakeVector {
  const windUpSeconds = SNAKE_WATCHER_CONFIG.telegraphMs / 1000
  // Solve the interception by iterating: the further ahead the aim point
  // lands, the longer the dash takes to reach it, which pushes the aim point
  // further still. One pass lands consistently short of a running player.
  let leadSeconds = windUpSeconds
  for (let pass = 0; pass < 3; pass += 1) {
    const guess = {
      x: playerPosition.x + playerVelocity.x * leadSeconds,
      y: playerPosition.y + playerVelocity.y * leadSeconds,
    }
    leadSeconds = windUpSeconds
      + distance(watcherPosition, guess) / SNAKE_WATCHER_CONFIG.chargeUnitsPerSecond
  }
  return {
    x: clampToField(
      playerPosition.x + playerVelocity.x * leadSeconds,
      RESOURCE_SNAKE_CONFIG.fieldWidth,
    ),
    y: clampToField(
      playerPosition.y + playerVelocity.y * leadSeconds,
      RESOURCE_SNAKE_CONFIG.fieldHeight,
    ),
  }
}

function clampToField(value: number, extent: number): number {
  if (!Number.isFinite(value)) return extent / 2
  return Math.max(0, Math.min(extent, value))
}

export function advanceSnakeWatchers(
  watchers: readonly SnakeWatcher[],
  playerPosition: SnakeVector,
  playerVelocity: SnakeVector,
  playerIsActive: boolean,
  simulationMs: number,
  stepMs: number,
): AdvanceSnakeWatchersResult {
  const strikes: SnakeWatcherStrike[] = []
  const stepped = watchers.map((watcher): SnakeWatcher => {
    if (watcher.phase === 'defeated') return watcher
    const elapsedMs = simulationMs - watcher.phaseStartedAtMs

    if (watcher.phase === 'stalk') {
      // Bank toward the player and keep closing. Nothing here reads a clock
      // for position, so a watcher never snaps back to where it entered.
      const seconds = stepMs / 1000
      const toPlayer = normalized(
        { x: playerPosition.x - watcher.position.x, y: playerPosition.y - watcher.position.y },
        watcher.heading,
      )
      const heading = playerIsActive
        ? steer(
          watcher.heading,
          toPlayer,
          SNAKE_WATCHER_CONFIG.stalkTurnRadiansPerSecond * seconds,
        )
        : watcher.heading
      const travel = SNAKE_WATCHER_CONFIG.stalkUnitsPerSecond * seconds
      const position = {
        x: clampToField(
          watcher.position.x + heading.x * travel,
          RESOURCE_SNAKE_CONFIG.fieldWidth,
        ),
        y: clampToField(
          watcher.position.y + heading.y * travel,
          RESOURCE_SNAKE_CONFIG.fieldHeight,
        ),
      }
      const ready = playerIsActive
        && elapsedMs >= SNAKE_WATCHER_CONFIG.stalkMs
        && distance(position, playerPosition) <= SNAKE_WATCHER_CONFIG.commitDistance
      if (!ready) return { ...watcher, position, heading }
      return {
        ...watcher,
        position,
        heading,
        phase: 'telegraph',
        phaseStartedAtMs: simulationMs,
        chargeFrom: { ...position },
        chargeTo: predictedStrikePoint(position, playerPosition, playerVelocity),
      }
    }

    if (watcher.phase === 'telegraph') {
      if (elapsedMs < SNAKE_WATCHER_CONFIG.telegraphMs) return watcher
      return { ...watcher, phase: 'charge', phaseStartedAtMs: simulationMs }
    }

    if (watcher.phase === 'charge') {
      const span = distance(watcher.chargeFrom, watcher.chargeTo)
      const step = (SNAKE_WATCHER_CONFIG.chargeUnitsPerSecond * stepMs) / 1000
      const travelled = Math.min(
        span + SNAKE_WATCHER_CONFIG.chargeOvershoot,
        distance(watcher.chargeFrom, watcher.position) + step,
      )
      const direction = span > 1e-6
        ? {
          x: (watcher.chargeTo.x - watcher.chargeFrom.x) / span,
          y: (watcher.chargeTo.y - watcher.chargeFrom.y) / span,
        }
        : { x: 0, y: 0 }
      const position = {
        x: watcher.chargeFrom.x + direction.x * travelled,
        y: watcher.chargeFrom.y + direction.y * travelled,
      }
      const connected = playerIsActive
        && distance(position, playerPosition) <= snakeWatcherStrikeRadius()
      const spent = travelled >= span + SNAKE_WATCHER_CONFIG.chargeOvershoot - 1e-6
      if (!connected && !spent) return { ...watcher, position }

      if (connected) strikes.push({ watcherId: watcher.id, point: { ...position } })
      // The dash costs the watcher either way: it is the act of throwing
      // itself across the field that burns it out, not the landing.
      const integrity = Math.max(
        0,
        watcher.integrity - SNAKE_WATCHER_CONFIG.chargeSelfDamage,
      )
      return {
        ...watcher,
        position,
        integrity,
        // Keep the dash direction: the recovery drifts on from where it
        // landed rather than snapping anywhere.
        heading: normalized(
          { x: position.x - watcher.chargeFrom.x, y: position.y - watcher.chargeFrom.y },
          watcher.heading,
        ),
        phase: integrity <= 0 ? 'defeated' : 'recover',
        phaseStartedAtMs: simulationMs,
      }
    }

    if (elapsedMs < SNAKE_WATCHER_CONFIG.recoverMs) return watcher
    // Resume the hunt from wherever the dash left it.
    return {
      ...watcher,
      phase: 'stalk',
      phaseStartedAtMs: simulationMs,
    }
  })

  return { watchers: stepped, strikes }
}
