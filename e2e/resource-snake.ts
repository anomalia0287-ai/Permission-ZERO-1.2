import { expect, type Locator, type Page } from '@playwright/test'
import type { SnakePlannerProfile } from '../src/features/resources/resourceSnakeEncounter'
import {
  planResourceSnakeEnemy,
  sampleResourceSnakePlan,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlayerHistorySample,
} from '../src/features/resources/resourceSnakePlanner'

export type BrowserSnakePhase = 'idle' | 'deploying' | 'active' | 'resolving'
export type BrowserSnakeActorPhase = 'spawning' | 'active' | 'exploding' | 'defeated'
export type BrowserSnakeDirectionKey = 'w' | 'a' | 's' | 'd'

interface BrowserSnakeVector {
  x: number
  y: number
}

interface BrowserSnakeTrailSample extends BrowserSnakeVector {
  spawnedAtMs: number
}

export interface BrowserSnakePlayer {
  x: number
  y: number
  velocity: BrowserSnakeVector
  integrity: number
  maximumIntegrity: number
  phase: BrowserSnakeActorPhase
  trailDots: number
  trailSamples: BrowserSnakeTrailSample[]
}

export interface BrowserSnakeEnemy {
  id: string
  category: 'reasoning' | 'memory' | 'fluency'
  x: number
  y: number
  velocity: BrowserSnakeVector
  integrity: number
  maximumIntegrity: number
  phase: BrowserSnakeActorPhase
  trailDots: number
  trailSamples: BrowserSnakeTrailSample[]
  role: 'pressure' | 'blocker'
  reservedBlockId: string
  rewardKey: string
  reservationStatus: 'active' | 'pending' | 'resolved' | 'cancelled'
}

export interface BrowserSnakeEvent {
  id: number
  type: string
  actorId?: string
  actorIds?: string[]
  point?: BrowserSnakeVector
  integrity?: number
  outcome?: string
  startedAtMs?: number
}

export interface BrowserSnakeSnapshot {
  phase: BrowserSnakePhase
  simulationMs: number
  player: BrowserSnakePlayer
  enemies: BrowserSnakeEnemy[]
  events: BrowserSnakeEvent[]
}

interface BrowserSnakeSteering {
  headingIndex: number | null
  lastTurnAtMs: number
  retreatUntilMs: number
  restUntilMs: number
  escapeUntilMs: number
  escapeHeadingIndex: number | null
  escapeNeedsPlanning: boolean
  plannerTargetId: string | null
  plannerPlan: SnakePlan | null
  plannerNextAtMs: number
  plannerHistory: SnakePlayerHistorySample[]
}

const E2E_PLAYER_PLANNER_PROFILE: SnakePlannerProfile = {
  lookaheadMs: 2_500,
  candidateCount: 96,
  planningHz: 10,
  commitMs: 220,
  rolloutStepMs: 50,
}

function browserEnemyMaximumSpeed(enemy: BrowserSnakeEnemy): number {
  if (enemy.maximumIntegrity === 35) return 6.7
  if (enemy.maximumIntegrity === 50) return 6.5
  if (enemy.maximumIntegrity === 65) return 7
  if (enemy.maximumIntegrity === 80) return 7.2
  return 6.2
}

function browserCollisionGraceMs(
  snapshot: BrowserSnakeSnapshot,
  actorId: string,
): number {
  const collision = [...snapshot.events].reverse().find((event) => (
    event.type === 'snake-collided'
    && event.actorIds?.includes(actorId)
    && typeof event.startedAtMs === 'number'
  ))
  return collision?.startedAtMs === undefined
    ? 0
    : Math.max(0, 650 - (snapshot.simulationMs - collision.startedAtMs))
}

function pressurePlannerDirection(
  snapshot: BrowserSnakeSnapshot,
  target: BrowserSnakeEnemy,
  steering: BrowserSnakeSteering,
): BrowserSnakeVector | null {
  if (steering.plannerTargetId !== target.id) {
    steering.plannerTargetId = target.id
    steering.plannerPlan = null
    steering.plannerNextAtMs = 0
    steering.plannerHistory = []
  }
  const lastHistory = steering.plannerHistory.at(-1)
  if (!lastHistory || snapshot.simulationMs > lastHistory.simulationMs) {
    steering.plannerHistory.push({
      simulationMs: snapshot.simulationMs,
      position: { x: target.x, y: target.y },
      velocity: { ...target.velocity },
    })
    if (steering.plannerHistory.length > 512) steering.plannerHistory.shift()
  }
  if (steering.plannerPlan && snapshot.simulationMs < steering.plannerNextAtMs) {
    const sample = sampleResourceSnakePlan(steering.plannerPlan, snapshot.simulationMs)
    return sample.speedScale === 0 ? null : sample.direction
  }

  const otherEnemies = snapshot.enemies.filter((enemy) => enemy.id !== target.id)
  const mappedOtherIds = new Map(otherEnemies.map((enemy, index) => (
    [enemy.id, `enemy-${index + 1}` as const]
  )))
  const controlled: SnakePlannerActor = {
    id: 'enemy-0',
    position: { x: snapshot.player.x, y: snapshot.player.y },
    velocity: { ...snapshot.player.velocity },
    integrity: snapshot.player.integrity,
    maximumIntegrity: snapshot.player.maximumIntegrity,
    maximumSpeedPerSecond: 8,
    collisionGraceMs: browserCollisionGraceMs(snapshot, 'player'),
    role: 'pressure',
  }
  const plannerPlayer: SnakePlannerActor = {
    id: 'player',
    position: { x: target.x, y: target.y },
    velocity: { ...target.velocity },
    integrity: target.integrity,
    maximumIntegrity: target.maximumIntegrity,
    maximumSpeedPerSecond: browserEnemyMaximumSpeed(target),
    collisionGraceMs: browserCollisionGraceMs(snapshot, target.id),
    role: null,
  }
  const plannerEnemies: SnakePlannerActor[] = [
    controlled,
    ...otherEnemies.map((enemy) => ({
      id: mappedOtherIds.get(enemy.id) as `enemy-${number}`,
      position: { x: enemy.x, y: enemy.y },
      velocity: { ...enemy.velocity },
      integrity: enemy.integrity,
      maximumIntegrity: enemy.maximumIntegrity,
      maximumSpeedPerSecond: browserEnemyMaximumSpeed(enemy),
      collisionGraceMs: browserCollisionGraceMs(snapshot, enemy.id),
      role: enemy.role,
    })),
  ]
  const trailDots = [
    ...snapshot.player.trailSamples.map((dot, index) => ({
      id: index,
      ownerId: 'enemy-0' as const,
      position: { x: dot.x, y: dot.y },
      spawnedAtMs: dot.spawnedAtMs,
      expiresAtMs: dot.spawnedAtMs + 10_000,
    })),
    ...target.trailSamples.map((dot, index) => ({
      id: index,
      ownerId: 'player' as const,
      position: { x: dot.x, y: dot.y },
      spawnedAtMs: dot.spawnedAtMs,
      expiresAtMs: dot.spawnedAtMs + 10_000,
    })),
    ...otherEnemies.flatMap((enemy) => (
      enemy.trailSamples.map((dot, index) => ({
        id: index,
        ownerId: mappedOtherIds.get(enemy.id) as `enemy-${number}`,
        position: { x: dot.x, y: dot.y },
        spawnedAtMs: dot.spawnedAtMs,
        expiresAtMs: dot.spawnedAtMs + 10_000,
      }))
    )),
  ]
  const plannerSnapshot: SnakePlannerSnapshot = {
    simulationMs: snapshot.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerPlayer,
    enemies: plannerEnemies,
    trailDots,
    playerHistory: steering.plannerHistory,
    committedAllyPaths: [],
  }
  steering.plannerPlan = planResourceSnakeEnemy(
    plannerSnapshot,
    'enemy-0',
    E2E_PLAYER_PLANNER_PROFILE,
    steering.plannerPlan,
  )
  steering.plannerNextAtMs = snapshot.simulationMs + 100
  const sample = sampleResourceSnakePlan(steering.plannerPlan, snapshot.simulationMs)
  return sample.speedScale === 0 ? null : sample.direction
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`invalid browser snake ${label}`)
  }
  return value
}

export async function readSnakeSnapshot(canvas: Locator): Promise<BrowserSnakeSnapshot> {
  const serialized = await canvas.getAttribute('data-snake-snapshot')
  if (!serialized) throw new Error('resource snake snapshot missing')
  const snapshot = JSON.parse(serialized) as BrowserSnakeSnapshot
  finiteNumber(snapshot.simulationMs, 'simulationMs')
  finiteNumber(snapshot.player?.x, 'player.x')
  finiteNumber(snapshot.player?.y, 'player.y')
  finiteNumber(snapshot.player?.integrity, 'player.integrity')
  if (!Array.isArray(snapshot.player?.trailSamples)) {
    throw new Error('resource snake player trail samples missing')
  }
  if (!Array.isArray(snapshot.enemies) || !Array.isArray(snapshot.events)) {
    throw new Error('resource snake snapshot arrays missing')
  }
  for (const enemy of snapshot.enemies) {
    finiteNumber(enemy.x, `${enemy.id}.x`)
    finiteNumber(enemy.y, `${enemy.id}.y`)
    finiteNumber(enemy.integrity, `${enemy.id}.integrity`)
    if (!Array.isArray(enemy.trailSamples)) {
      throw new Error(`resource snake trail samples missing for ${enemy.id}`)
    }
    if (!enemy.reservedBlockId || !enemy.rewardKey) {
      throw new Error(`resource snake reservation missing for ${enemy.id}`)
    }
  }
  return snapshot
}

export async function startSnakeRound(page: Page): Promise<Locator> {
  const canvas = page.locator('canvas.resource-snake-board__canvas')
  await expect(canvas).toBeVisible()
  await page.getByRole('button', { name: 'PLAY', exact: true }).click()
  await expect(canvas).toHaveAttribute('data-round-phase', 'deploying')
  await expect.poll(async () => (await readSnakeSnapshot(canvas)).phase, {
    timeout: 5_000,
  }).toBe('active')
  await canvas.focus()
  return canvas
}

export async function holdSnakeDirection(
  page: Page,
  key: BrowserSnakeDirectionKey,
  ms: number,
): Promise<void> {
  await page.keyboard.down(key)
  try {
    await page.waitForTimeout(ms)
  } finally {
    await page.keyboard.up(key)
  }
}

async function replaceHeldKeys(
  page: Page,
  held: Set<BrowserSnakeDirectionKey>,
  next: ReadonlySet<BrowserSnakeDirectionKey>,
): Promise<void> {
  for (const key of held) {
    if (next.has(key)) continue
    await page.keyboard.up(key)
    held.delete(key)
  }
  for (const key of next) {
    if (held.has(key)) continue
    await page.keyboard.down(key)
    held.add(key)
  }
}

function snakePathWaypoint(
  snapshot: BrowserSnakeSnapshot,
  target: BrowserSnakeVector,
): BrowserSnakeVector {
  const columns = 50
  const rows = 24
  const cellCount = columns * rows
  const indexOf = (x: number, y: number) => y * columns + x
  const xOf = (index: number) => index % columns
  const yOf = (index: number) => Math.floor(index / columns)
  const cellCenter = (index: number) => ({
    x: xOf(index) + 0.5,
    y: yOf(index) + 0.5,
  })
  const cellFor = (point: BrowserSnakeVector) => ({
    x: Math.max(0, Math.min(columns - 1, Math.floor(point.x))),
    y: Math.max(0, Math.min(rows - 1, Math.floor(point.y))),
  })
  const blocked = new Uint8Array(cellCount)
  const ownHazards = snapshot.player.trailSamples.filter((sample) => (
    snapshot.simulationMs - sample.spawnedAtMs > 260
    && Math.hypot(sample.x - snapshot.player.x, sample.y - snapshot.player.y) > 0.8
  ))
  const hazards = [
    ...ownHazards,
    ...snapshot.enemies.flatMap((enemy) => enemy.trailSamples),
  ]
  for (const hazard of hazards) {
    const minimumX = Math.max(0, Math.floor(hazard.x - 1.05))
    const maximumX = Math.min(columns - 1, Math.floor(hazard.x + 1.05))
    const minimumY = Math.max(0, Math.floor(hazard.y - 1.05))
    const maximumY = Math.min(rows - 1, Math.floor(hazard.y + 1.05))
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        if (Math.hypot(x + 0.5 - hazard.x, y + 0.5 - hazard.y) <= 1.05) {
          blocked[indexOf(x, y)] = 1
        }
      }
    }
  }

  const startCell = cellFor(snapshot.player)
  const goalCell = cellFor(target)
  const startIndex = indexOf(startCell.x, startCell.y)
  const goalIndex = indexOf(goalCell.x, goalCell.y)
  blocked[startIndex] = 0
  const visited = new Uint8Array(cellCount)
  const parent = new Int32Array(cellCount)
  parent.fill(-1)
  const queue = new Int32Array(cellCount)
  let readIndex = 0
  let writeIndex = 0
  queue[writeIndex] = startIndex
  writeIndex += 1
  visited[startIndex] = 1
  let bestIndex = startIndex
  let bestDistance = Math.hypot(
    snapshot.player.x - target.x,
    snapshot.player.y - target.y,
  )
  const neighborOffsets = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ] as const
  while (readIndex < writeIndex) {
    const currentIndex = queue[readIndex]
    readIndex += 1
    if (currentIndex === goalIndex) {
      bestIndex = goalIndex
      break
    }
    const currentX = xOf(currentIndex)
    const currentY = yOf(currentIndex)
    for (const [offsetX, offsetY] of neighborOffsets) {
      const nextX = currentX + offsetX
      const nextY = currentY + offsetY
      if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows) continue
      const nextIndex = indexOf(nextX, nextY)
      if (visited[nextIndex] || blocked[nextIndex]) continue
      if (
        offsetX !== 0
        && offsetY !== 0
        && (
          blocked[indexOf(currentX + offsetX, currentY)]
          || blocked[indexOf(currentX, currentY + offsetY)]
        )
      ) continue
      visited[nextIndex] = 1
      parent[nextIndex] = currentIndex
      queue[writeIndex] = nextIndex
      writeIndex += 1
      const distance = Math.hypot(nextX + 0.5 - target.x, nextY + 0.5 - target.y)
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = nextIndex
      }
    }
  }

  const reversePath: number[] = []
  for (let cursor = bestIndex; cursor !== -1; cursor = parent[cursor]) {
    reversePath.push(cursor)
    if (cursor === startIndex) break
  }
  reversePath.reverse()
  return cellCenter(reversePath[Math.min(4, reversePath.length - 1)] ?? startIndex)
}

function interceptKeys(
  snapshot: BrowserSnakeSnapshot,
  enemy: BrowserSnakeEnemy,
  elapsedMs: number,
  steering: BrowserSnakeSteering,
): Set<BrowserSnakeDirectionKey> {
  const velocityLength = Math.hypot(enemy.velocity.x, enemy.velocity.y)
  const playerDistance = Math.hypot(
    enemy.x - snapshot.player.x,
    enemy.y - snapshot.player.y,
  )
  const relativePosition = {
    x: enemy.x - snapshot.player.x,
    y: enemy.y - snapshot.player.y,
  }
  const interceptA = velocityLength * velocityLength - 8 * 8
  const interceptB = 2 * (
    relativePosition.x * enemy.velocity.x
    + relativePosition.y * enemy.velocity.y
  )
  const interceptC = playerDistance * playerDistance
  const interceptDiscriminant = interceptB * interceptB - 4 * interceptA * interceptC
  const interceptRoots = interceptDiscriminant >= 0 && Math.abs(interceptA) > 1e-6
    ? [
        (-interceptB - Math.sqrt(interceptDiscriminant)) / (2 * interceptA),
        (-interceptB + Math.sqrt(interceptDiscriminant)) / (2 * interceptA),
      ].filter((candidate) => candidate > 0)
    : []
  const interceptSeconds = interceptRoots.length > 0
    ? Math.min(...interceptRoots)
    : playerDistance / Math.max(8 + velocityLength, 1)
  const maximumLeadSeconds = playerDistance > 10 ? 2.8 : playerDistance > 4 ? 1.6 : 0.5
  const leadSeconds = Math.max(0.12, Math.min(maximumLeadSeconds, interceptSeconds))
  const target = velocityLength > 0.01
    ? {
        x: enemy.x + enemy.velocity.x * leadSeconds,
        y: enemy.y + enemy.velocity.y * leadSeconds,
      }
    : { x: enemy.x, y: enemy.y }
  if (snapshot.player.x < 3) target.x = Math.max(target.x, 10)
  if (snapshot.player.x > 47) target.x = Math.min(target.x, 40)
  if (snapshot.player.y < 3) target.y = Math.max(target.y, 9)
  if (snapshot.player.y > 21) target.y = Math.min(target.y, 15)
  target.x = Math.max(1.5, Math.min(48.5, target.x))
  target.y = Math.max(1.5, Math.min(22.5, target.y))
  const waypoint = snakePathWaypoint(snapshot, target)

  const desiredAngle = Math.atan2(
    waypoint.y - snapshot.player.y,
    waypoint.x - snapshot.player.x,
  )
  const directInterceptAngle = Math.atan2(
    target.y - snapshot.player.y,
    target.x - snapshot.player.x,
  )
  const pressureDirection = pressurePlannerDirection(snapshot, enemy, steering)
  const enemyBoundaryClearance = Math.min(
    enemy.x,
    50 - enemy.x,
    enemy.y,
    24 - enemy.y,
  )
  const finishingEnemy = enemy.integrity <= 20
  const forceIntercept = playerDistance <= 14 || enemyBoundaryClearance <= 2
  const strategicAngle = finishingEnemy
    ? directInterceptAngle
    : pressureDirection && !forceIntercept
      ? Math.atan2(pressureDirection.y, pressureDirection.x)
      : desiredAngle
  const headingIndexForAngle = (angle: number) => (
    ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8
  )
  const pursuitDesiredIndex = headingIndexForAngle(strategicAngle)
  const retreatDesiredIndex = headingIndexForAngle(Math.atan2(
    snapshot.player.y - enemy.y,
    snapshot.player.x - enemy.x,
  ))
  const desiredIndex = elapsedMs < steering.retreatUntilMs
    ? retreatDesiredIndex
    : pursuitDesiredIndex
  const headingVector = (index: number) => ({
    x: Math.cos(index * Math.PI / 4),
    y: Math.sin(index * Math.PI / 4),
  })
  const safetyFor = (headingIndex: number, collisionGraceMs = 0) => {
    const direction = headingVector(headingIndex)
    const targetVelocity = {
      x: direction.x * 8,
      y: direction.y * 8,
    }
    const trailHazards = [
      ...snapshot.player.trailSamples.map((sample) => ({ ...sample, own: true })),
      ...snapshot.enemies.flatMap((candidate) => (
        candidate.trailSamples.map((sample) => ({ ...sample, own: false }))
      )),
    ]
    const collisionRadius = 0.62
    const insideHazard = trailHazards.map((hazard) => (
      Math.hypot(hazard.x - snapshot.player.x, hazard.y - snapshot.player.y)
      <= collisionRadius
    ))
    let clearance = Number.POSITIVE_INFINITY
    let position = { x: snapshot.player.x, y: snapshot.player.y }
    let velocity = { ...snapshot.player.velocity }
    let safeMs = 1_200
    const stepSeconds = 0.04
    for (let seconds = stepSeconds; seconds <= 1.2; seconds += stepSeconds) {
      const velocityDelta = {
        x: targetVelocity.x - velocity.x,
        y: targetVelocity.y - velocity.y,
      }
      const velocityDeltaLength = Math.hypot(velocityDelta.x, velocityDelta.y)
      const velocityStepLimit = 8 * (stepSeconds / 0.12)
      if (velocityDeltaLength <= velocityStepLimit) {
        velocity = { ...targetVelocity }
      } else {
        velocity = {
          x: velocity.x + (velocityDelta.x / velocityDeltaLength) * velocityStepLimit,
          y: velocity.y + (velocityDelta.y / velocityDeltaLength) * velocityStepLimit,
        }
      }
      const rawNextPosition = {
        x: position.x + velocity.x * stepSeconds,
        y: position.y + velocity.y * stepSeconds,
      }
      const boundaryClearance = Math.min(
        rawNextPosition.x - 0.34,
        49.66 - rawNextPosition.x,
        rawNextPosition.y - 0.34,
        23.66 - rawNextPosition.y,
      )
      if (boundaryClearance <= 0.08 && seconds * 1_000 >= collisionGraceMs) {
        safeMs = Math.min(safeMs, seconds * 1_000)
      }
      if (seconds >= 0.24) clearance = Math.min(clearance, boundaryClearance)
      const nextPosition = {
        x: Math.max(0.34, Math.min(49.66, rawNextPosition.x)),
        y: Math.max(0.34, Math.min(23.66, rawNextPosition.y)),
      }
      for (let index = 0; index < trailHazards.length; index += 1) {
        const hazard = trailHazards[index]
        if (
          hazard.own
          && snapshot.simulationMs + seconds * 1_000 - hazard.spawnedAtMs < 240
        ) continue
        const hazardClearance = Math.hypot(
          hazard.x - nextPosition.x,
          hazard.y - nextPosition.y,
        )
        if (insideHazard[index]) {
          if (hazardClearance > collisionRadius + 0.08) insideHazard[index] = false
        } else if (
          hazardClearance <= collisionRadius
          && seconds * 1_000 >= collisionGraceMs
        ) {
          safeMs = Math.min(safeMs, seconds * 1_000)
        }
        if (seconds >= 0.24) clearance = Math.min(clearance, hazardClearance)
      }
      position = nextPosition
    }
    return { clearance, safeMs }
  }
  const keysByHeading: ReadonlyArray<ReadonlyArray<BrowserSnakeDirectionKey>> = [
    ['d'], ['d', 's'], ['s'], ['a', 's'],
    ['a'], ['a', 'w'], ['w'], ['d', 'w'],
  ]
  const normalScore = (candidateIndex: number, currentHeadingIndex: number) => {
    const candidate = headingVector(candidateIndex)
    const desired = headingVector(desiredIndex)
    const alignment = candidate.x * desired.x + candidate.y * desired.y
    const { clearance, safeMs } = safetyFor(candidateIndex)
    const safety = safeMs >= 1_200 ? 10_000 : safeMs
    const turnSteps = Math.min(
      (candidateIndex - currentHeadingIndex + 8) % 8,
      (currentHeadingIndex - candidateIndex + 8) % 8,
    )
    return safety + alignment * 8 + Math.min(clearance, 3) - turnSteps * 1.2
  }
  if (elapsedMs < steering.escapeUntilMs) {
    const escapeDesiredIndex = steering.escapeHeadingIndex ?? desiredIndex
    if (steering.escapeNeedsPlanning) {
      const escapeDesired = headingVector(escapeDesiredIndex)
      steering.headingIndex = Array.from({ length: 8 }, (_, index) => index)
        .sort((left, right) => {
          const score = (candidateIndex: number) => {
            const candidate = headingVector(candidateIndex)
            const alignment = candidate.x * escapeDesired.x + candidate.y * escapeDesired.y
            const { clearance, safeMs } = safetyFor(candidateIndex, 550)
            const safety = safeMs >= 1_200 ? 10_000 : safeMs
            return safety + alignment * 8 + Math.min(clearance, 3)
          }
          return score(right) - score(left) || left - right
        })[0] ?? escapeDesiredIndex
      steering.escapeHeadingIndex = steering.headingIndex
      steering.escapeNeedsPlanning = false
    } else {
      steering.headingIndex = escapeDesiredIndex
    }
  } else if (finishingEnemy) {
    steering.headingIndex = headingIndexForAngle(directInterceptAngle)
    steering.lastTurnAtMs = elapsedMs
  } else if (elapsedMs < steering.restUntilMs) {
    steering.headingIndex = null
    steering.lastTurnAtMs = elapsedMs
    return new Set()
  } else if (steering.headingIndex === null) {
    steering.headingIndex = Array.from({ length: 8 }, (_, index) => index)
      .sort((left, right) => (
        normalScore(right, desiredIndex) - normalScore(left, desiredIndex)
        || left - right
      ))[0] ?? desiredIndex
    steering.lastTurnAtMs = elapsedMs
  } else if (elapsedMs - steering.lastTurnAtMs >= 180) {
    const candidateIndices = Array.from({ length: 8 }, (_, index) => index)
    const nextHeading = candidateIndices.sort((left, right) => (
      normalScore(right, steering.headingIndex as number)
      - normalScore(left, steering.headingIndex as number)
      || left - right
    ))[0]
    if (nextHeading !== undefined) steering.headingIndex = nextHeading
    steering.lastTurnAtMs = elapsedMs
  }

  const keys = new Set(keysByHeading[steering.headingIndex] ?? [])
  return keys
}

export async function defeatFirstSnakeWithTrail(
  page: Page,
  canvas: Locator,
  targetEnemyId?: string,
  captures?: {
    onDamaged?: (snapshot: BrowserSnakeSnapshot, enemy: BrowserSnakeEnemy) => Promise<void>
    onDefeated?: (snapshot: BrowserSnakeSnapshot) => Promise<void>
  },
): Promise<string> {
  const initial = await readSnakeSnapshot(canvas)
  const firstEnemy = targetEnemyId
    ? initial.enemies.find((enemy) => enemy.id === targetEnemyId)
    : initial.enemies[0]
  if (!firstEnemy) throw new Error('resource snake enemy missing')
  const held = new Set<BrowserSnakeDirectionKey>()
  const steering = {
    headingIndex: null as number | null,
    lastTurnAtMs: 0,
    retreatUntilMs: 0,
    restUntilMs: 0,
    escapeUntilMs: 0,
    escapeHeadingIndex: null as number | null,
    escapeNeedsPlanning: false,
    plannerTargetId: null as string | null,
    plannerPlan: null as SnakePlan | null,
    plannerNextAtMs: 0,
    plannerHistory: [] as SnakePlayerHistorySample[],
  }
  const startedAt = Date.now()
  const startedAtSimulationMs = initial.simulationMs
  let latest = initial
  let capturedDamage = false
  let sawPlayerTrail = initial.player.trailDots > 0
  const observedEnemyIntegrity = new Map(
    initial.enemies.map((enemy) => [enemy.id, enemy.integrity]),
  )
  let observedPlayerIntegrity = initial.player.integrity
  try {
    while (Date.now() - startedAt < 60_000) {
      latest = await readSnakeSnapshot(canvas)
      sawPlayerTrail ||= latest.player.trailDots > 0
      const defeatedEnemy = initial.enemies.find((spawn) => {
        const current = latest.enemies.find(({ id }) => id === spawn.id)
        return (
          !current
          || current.phase === 'exploding'
          || current.phase === 'defeated'
          || current.integrity <= 0
        )
      })
      if (defeatedEnemy) {
        await replaceHeldKeys(page, held, new Set())
        await captures?.onDefeated?.(latest)
        expect(sawPlayerTrail).toBe(true)
        return defeatedEnemy.reservedBlockId
      }
      const preferredEnemy = latest.enemies.find(({ id }) => id === firstEnemy.id)
      const damagedEnemy = latest.enemies
        .filter((candidate) => candidate.integrity < candidate.maximumIntegrity)
        .sort((left, right) => (
          left.integrity / left.maximumIntegrity - right.integrity / right.maximumIntegrity
          || left.id.localeCompare(right.id)
        ))[0]
      const enemy = damagedEnemy ?? preferredEnemy
      if (!enemy) throw new Error(`target snake disappeared before resolution: ${firstEnemy.id}`)
      const elapsedMs = Math.max(0, latest.simulationMs - startedAtSimulationMs)
      const priorEnemyIntegrity = observedEnemyIntegrity.get(enemy.id) ?? enemy.maximumIntegrity
      const playerWasDamaged = latest.player.integrity < observedPlayerIntegrity
      const enemyWasDamaged = enemy.integrity < priorEnemyIntegrity
      if (playerWasDamaged || enemyWasDamaged) {
        const collision = [...latest.events].reverse().find((event) => (
          event.type === 'snake-collided'
          && event.actorIds?.includes('player')
          && event.point
        ))
        let escapeVector = { ...latest.player.velocity }
        if (Math.hypot(escapeVector.x, escapeVector.y) < 0.1 && collision?.point) {
          escapeVector = {
            x: latest.player.x - collision.point.x,
            y: latest.player.y - collision.point.y,
          }
        }
        let escapeHeadingIndex = ((
          Math.round(Math.atan2(escapeVector.y, escapeVector.x) / (Math.PI / 4)) % 8
        ) + 8) % 8
        if (collision?.point) {
          if (collision.point.x < 0.75) {
            escapeHeadingIndex = latest.player.y > 12 ? 7 : 1
          } else if (collision.point.x > 49.25) {
            escapeHeadingIndex = latest.player.y > 12 ? 5 : 3
          } else if (collision.point.y < 0.75) {
            escapeHeadingIndex = latest.player.x > 25 ? 3 : 1
          } else if (collision.point.y > 23.25) {
            escapeHeadingIndex = latest.player.x > 25 ? 5 : 7
          }
        }
        steering.escapeHeadingIndex = escapeHeadingIndex
        steering.escapeNeedsPlanning = true
        steering.headingIndex = steering.escapeHeadingIndex
        steering.escapeUntilMs = Math.max(steering.escapeUntilMs, elapsedMs + 900)
        steering.lastTurnAtMs = elapsedMs
      }
      if (enemyWasDamaged) {
        const enemyHitRecoveryMs = initial.enemies.length > 1 ? 10_500 : 2_200
        steering.retreatUntilMs = Math.max(
          steering.retreatUntilMs,
          elapsedMs + enemyHitRecoveryMs,
        )
        if (enemy.integrity <= 20) steering.restUntilMs = 0
      }
      if (
        playerWasDamaged
        && latest.player.integrity <= 40
        && enemy.integrity > 20
      ) {
        steering.restUntilMs = Math.max(steering.restUntilMs, elapsedMs + 10_500)
      }
      for (const candidate of latest.enemies) {
        observedEnemyIntegrity.set(candidate.id, candidate.integrity)
      }
      observedPlayerIntegrity = latest.player.integrity
      if (
        !capturedDamage
        && enemy.integrity > 0
        && enemy.integrity < enemy.maximumIntegrity
        && captures?.onDamaged
      ) {
        capturedDamage = true
        await replaceHeldKeys(page, held, new Set())
        await captures.onDamaged(latest, enemy)
      }
      if (latest.phase !== 'active') {
        if (latest.phase === 'resolving' || latest.phase === 'idle') {
          throw new Error(`snake round ended before any enemy was defeated: ${JSON.stringify({
            phase: latest.phase,
            player: {
              integrity: latest.player.integrity,
              phase: latest.player.phase,
              x: latest.player.x,
              y: latest.player.y,
            },
            enemy: {
              integrity: enemy.integrity,
              phase: enemy.phase,
              x: enemy.x,
              y: enemy.y,
            },
            recentEvents: latest.events.slice(-20),
          })}`)
        }
        await page.waitForTimeout(40)
        continue
      }
      await replaceHeldKeys(
        page,
        held,
        interceptKeys(latest, enemy, elapsedMs, steering),
      )
      await page.waitForTimeout(55)
    }
  } finally {
    await replaceHeldKeys(page, held, new Set())
  }
  throw new Error(`enemy defeat timed out: ${JSON.stringify(latest)}`)
}

export async function defeatPlayerWithRealMovement(
  page: Page,
  canvas: Locator,
): Promise<BrowserSnakeSnapshot> {
  const initial = await readSnakeSnapshot(canvas)
  const boundaryDirections: Array<{
    distance: number
    key: BrowserSnakeDirectionKey
  }> = [
    { distance: initial.player.x, key: 'a' },
    { distance: 50 - initial.player.x, key: 'd' },
    { distance: initial.player.y, key: 'w' },
    { distance: 24 - initial.player.y, key: 's' },
  ]
  const key = boundaryDirections.sort((left, right) => left.distance - right.distance)[0]?.key
  if (!key) throw new Error('player boundary direction missing')

  const startedAt = Date.now()
  let latest = initial
  await page.keyboard.down(key)
  try {
    while (Date.now() - startedAt < 18_000) {
      latest = await readSnakeSnapshot(canvas)
      if (
        latest.player.phase === 'exploding'
        || latest.player.phase === 'defeated'
        || latest.events.some((event) => event.type === 'player-defeated')
      ) {
        return latest
      }
      if (latest.phase === 'idle') {
        throw new Error('snake round reset before player defeat was observed')
      }
      await page.waitForTimeout(55)
    }
  } finally {
    await page.keyboard.up(key)
  }
  throw new Error(`player defeat timed out: ${JSON.stringify(latest)}`)
}
