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
   * When far it hurries; inside two commit ranges it slows to a prowl, so
   * closing reads as intent rather than drift.
   */
  stalkUnitsPerSecond: 9,
  stalkProwlUnitsPerSecond: 5.5,
  /** Steering limit, so it banks toward the player instead of snapping. */
  stalkTurnRadiansPerSecond: 3.1,
  /**
   * It only commits inside this range. Dashing from across the field gave
   * the flight so much air time that every dash was a free dodge, which is
   * what read as stupidity.
   */
  commitDistance: 11,
  /** How far ahead it probes for trails while closing. */
  avoidLookahead: 2.6,
  /** How wide a berth it tries to give a live line. */
  avoidRadius: 1.3,
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
  /** Health lost when it runs into the intruder rather than past them. */
  strikeSelfDamage: 10,
  /** Health lost on touching a live trail — the player's counterplay. */
  trailContactDamage: 10,
})

/** How close to the field edge counts as hitting the wall. */
const WALL_MARGIN = 0.12
/** How far inside the wall a watcher arrives, so it does not spawn into it. */
const WATCHER_ENTRY_INSET = 1.2

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
    const entry = snakeWatcherEntryPosition((perimeter * index) / Math.max(1, total))
    const inward = normalized({
      x: centre.x - entry.x,
      y: centre.y - entry.y,
    }, { x: 0, y: 1 })
    // Just inside the wall: the edge kills watchers too, so they may not be
    // standing on it the instant they arrive.
    const position = {
      x: entry.x + inward.x * WATCHER_ENTRY_INSET,
      y: entry.y + inward.y * WATCHER_ENTRY_INSET,
    }
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

function outsideField(position: SnakeVector): boolean {
  return (
    position.x <= WALL_MARGIN
    || position.y <= WALL_MARGIN
    || position.x >= RESOURCE_SNAKE_CONFIG.fieldWidth - WALL_MARGIN
    || position.y >= RESOURCE_SNAKE_CONFIG.fieldHeight - WALL_MARGIN
  )
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
  hazardDots: readonly SnakeVector[],
  simulationMs: number,
  stepMs: number,
): AdvanceSnakeWatchersResult {
  const strikes: SnakeWatcherStrike[] = []
  const trailContactRadius =
    RESOURCE_SNAKE_CONFIG.trailRadius + 0.34
  const touchesTrail = (position: SnakeVector): boolean => {
    for (const dot of hazardDots) {
      if (distance(position, dot) <= trailContactRadius) return true
    }
    return false
  }
  const nearestDot = (position: SnakeVector): SnakeVector | null => {
    let nearest: SnakeVector | null = null
    let nearestDist = Number.POSITIVE_INFINITY
    for (const dot of hazardDots) {
      const dist = distance(position, dot)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = dot
      }
    }
    return nearest
  }
  const burned = (watcher: SnakeWatcher, position: SnakeVector): SnakeWatcher => {
    const integrity = Math.max(
      0,
      watcher.integrity - SNAKE_WATCHER_CONFIG.trailContactDamage,
    )
    // It recoils off the line it touched. Without this it resumed the hunt
    // still nose-first against the same wall and ground itself to nothing
    // on the spot — which read as stupidity, because it was.
    const touched = nearestDot(position)
    const recoil = touched
      ? normalized(
        { x: position.x - touched.x, y: position.y - touched.y },
        { x: -watcher.heading.x, y: -watcher.heading.y },
      )
      : { x: -watcher.heading.x, y: -watcher.heading.y }
    return {
      ...watcher,
      position,
      heading: recoil,
      integrity,
      phase: integrity <= 0 ? 'defeated' : 'recover',
      phaseStartedAtMs: simulationMs,
    }
  }
  const stepped = watchers.map((watcher): SnakeWatcher => {
    if (watcher.phase === 'defeated') return watcher
    const elapsedMs = simulationMs - watcher.phaseStartedAtMs

    if (watcher.phase === 'stalk') {
      // Bank toward the player and keep closing. Nothing here reads a clock
      // for position, so a watcher never snaps back to where it entered.
      const seconds = stepMs / 1000
      const range = distance(watcher.position, playerPosition)
      const toPlayer = normalized(
        { x: playerPosition.x - watcher.position.x, y: playerPosition.y - watcher.position.y },
        watcher.heading,
      )
      // It respects the lines the same way the player must. The probe looks
      // ahead of its nose; a live dot there bends the approach around it —
      // it hunts around walls while free, and only its committed dash can
      // still be baited into one.
      let desired = toPlayer
      const probe = {
        x: watcher.position.x + watcher.heading.x * SNAKE_WATCHER_CONFIG.avoidLookahead,
        y: watcher.position.y + watcher.heading.y * SNAKE_WATCHER_CONFIG.avoidLookahead,
      }
      let nearestThreat: SnakeVector | null = null
      let nearestDistance: number = SNAKE_WATCHER_CONFIG.avoidRadius
      for (const dot of hazardDots) {
        const threatDistance = distance(probe, dot)
        if (threatDistance < nearestDistance) {
          nearestDistance = threatDistance
          nearestThreat = dot
        }
      }
      if (nearestThreat) {
        // Head-on, "away from the threat" points straight back into it, so
        // the dodge is lateral: pick the side of the nose the threat is NOT
        // on and blend that with the pull toward the player.
        const lateral = { x: -watcher.heading.y, y: watcher.heading.x }
        const threatSide =
          (nearestThreat.x - watcher.position.x) * lateral.x
          + (nearestThreat.y - watcher.position.y) * lateral.y
        const dodge = threatSide >= 0 ? -1 : 1
        desired = normalized(
          {
            x: toPlayer.x + lateral.x * dodge * 1.6,
            y: toPlayer.y + lateral.y * dodge * 1.6,
          },
          toPlayer,
        )
      }
      const heading = playerIsActive
        ? steer(
          watcher.heading,
          desired,
          SNAKE_WATCHER_CONFIG.stalkTurnRadiansPerSecond * seconds
            * (nearestThreat ? 2 : 1),
        )
        : watcher.heading
      // Hurry while far, prowl when close: approach with visible intent.
      const speed = range > SNAKE_WATCHER_CONFIG.commitDistance * 2
        ? SNAKE_WATCHER_CONFIG.stalkUnitsPerSecond
        : SNAKE_WATCHER_CONFIG.stalkProwlUnitsPerSecond
      const travel = speed * seconds
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
      // The grid's edge is as lethal to a watcher as it is to everything
      // else here; nothing on this field gets to ignore the wall.
      if (outsideField(position)) {
        return {
          ...watcher,
          position,
          heading,
          integrity: 0,
          phase: 'defeated',
          phaseStartedAtMs: simulationMs,
        }
      }

      // A live line burns it, exactly as it burns everything else that
      // touches one — walling a watcher off is the player's counterplay.
      if (touchesTrail(position)) return burned(watcher, position)

      // It does not pass through the intruder: running into them hurts both.
      if (
        playerIsActive
        && distance(position, playerPosition) <= snakeWatcherStrikeRadius()
      ) {
        strikes.push({ watcherId: watcher.id, point: { ...position } })
        const integrity = Math.max(
          0,
          watcher.integrity - SNAKE_WATCHER_CONFIG.strikeSelfDamage,
        )
        return {
          ...watcher,
          position,
          heading,
          integrity,
          phase: integrity <= 0 ? 'defeated' : 'recover',
          phaseStartedAtMs: simulationMs,
        }
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
      // The wall does not wait for the dash to finish, and neither does a
      // line across its path — a dash through either ends there.
      if (outsideField(position)) {
        return {
          ...watcher,
          position,
          integrity: 0,
          phase: 'defeated',
          phaseStartedAtMs: simulationMs,
        }
      }
      if (touchesTrail(position)) return burned(watcher, position)

      const connected = playerIsActive
        && distance(position, playerPosition) <= snakeWatcherStrikeRadius()
      const spent = travelled >= span + SNAKE_WATCHER_CONFIG.chargeOvershoot - 1e-6
      if (!connected && !spent) return { ...watcher, position }

      if (connected) strikes.push({ watcherId: watcher.id, point: { ...position } })
      if (outsideField(position)) {
        return {
          ...watcher,
          position,
          integrity: 0,
          phase: 'defeated',
          phaseStartedAtMs: simulationMs,
        }
      }
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

    if (elapsedMs < SNAKE_WATCHER_CONFIG.recoverMs) {
      // Recovery drifts along its heading — after a burn that heading is the
      // recoil, so it visibly backs off the line before rehunting.
      const drift = (SNAKE_WATCHER_CONFIG.stalkProwlUnitsPerSecond * stepMs) / 2000
      return {
        ...watcher,
        position: {
          x: clampToField(
            watcher.position.x + watcher.heading.x * drift,
            RESOURCE_SNAKE_CONFIG.fieldWidth,
          ),
          y: clampToField(
            watcher.position.y + watcher.heading.y * drift,
            RESOURCE_SNAKE_CONFIG.fieldHeight,
          ),
        },
      }
    }
    // Resume the hunt from wherever the recovery drift left it.
    return {
      ...watcher,
      phase: 'stalk',
      phaseStartedAtMs: simulationMs,
    }
  })

  return { watchers: stepped, strikes }
}
