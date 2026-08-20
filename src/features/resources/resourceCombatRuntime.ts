export type ResourceCombatOrigin = 'reasoning' | 'memory' | 'fluency'

export interface ResourceCombatPoint {
  x: number
  y: number
}

export interface ResourceCombatRect extends ResourceCombatPoint {
  width: number
  height: number
}

export interface ResourceCombatResource {
  blockId: string
  origin: ResourceCombatOrigin
  contribution: 'normal' | 'disguised'
  hiddenBomb?: boolean
}

export type ResourceCombatActorPhase =
  | 'tracking'
  | 'telegraph'
  | 'charging'
  | 'recovering'
  | 'staggered'
  | 'salvage'

export interface ResourceCombatActor {
  blockId: string
  position: ResourceCombatPoint
  spawnPosition: ResourceCombatPoint
  health: number
  phase: ResourceCombatActorPhase
  phaseElapsedMs: number
  phaseDurationMs: number
  chargeDirection: ResourceCombatPoint | null
  actionSequence: number
  contactResolved: boolean
  initiative: number
}

export interface ResourceCombatTrailPoint extends ResourceCombatPoint {
  createdAtMs: number
}

export interface ResourceCombatCompression {
  sequence: number
  polygon: ResourceCombatPoint[]
  hitBlockIds: string[]
  startedAtMs: number
}

export interface ResourceCombatState {
  seed: string
  elapsedMs: number
  waveNumber: number
  waveBlockIds: readonly string[]
  actors: ReadonlyMap<string, ResourceCombatActor>
  trail: readonly ResourceCombatTrailPoint[]
  trailSuppressedUntilMs: number
  lastCompression: ResourceCombatCompression | null
  compressionSequence: number
  playerHealth: number
  playerInvulnerableMs: number
  respawnCount: number
}

export type ResourceCombatEvent =
  | { type: 'player-damaged'; health: number; blockId: string }
  | { type: 'player-disabled' }
  | { type: 'compression-resolved'; hitBlockIds: readonly string[] }
  | { type: 'resource-disabled'; blockId: string }
  | { type: 'wave-started'; waveNumber: number; blockIds: readonly string[] }

export interface ResourceCombatTransition {
  state: ResourceCombatState
  events: readonly ResourceCombatEvent[]
}

export interface AdvanceResourceCombatInput {
  elapsedMs: number
  player: ResourceCombatPoint
}

export const RESOURCE_COMBAT_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  fieldPadding: 1,
  playerSize: 2,
  actorSize: 1.35,
  actorHealth: 2,
  playerHealth: 3,
  playerInvulnerabilityMs: 800,
  trailLifetimeMs: 3_500,
  trailClosureDistance: 1.35,
  trailMinimumPoints: 6,
  trailMinimumArea: 8,
  trackingSpeedPerMs: 0.0022,
  chargeSpeedPerMs: 0.016,
  telegraphMs: 700,
  chargeMs: 560,
  recoveryMs: 760,
  staggerMs: 520,
  compressionVisibleMs: 420,
  safeZone: { x: 20, y: 19, width: 10, height: 5 },
} as const

const ORIGIN_ORDER: readonly ResourceCombatOrigin[] = [
  'reasoning',
  'memory',
  'fluency',
]

function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function rectAt(
  point: ResourceCombatPoint,
  size: number,
): ResourceCombatRect {
  return { ...point, width: size, height: size }
}

function rectsOverlap(
  left: ResourceCombatRect,
  right: ResourceCombatRect,
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function pointInsideRect(
  point: ResourceCombatPoint,
  rect: ResourceCombatRect,
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function normalize(vector: ResourceCombatPoint): ResourceCombatPoint {
  const length = Math.hypot(vector.x, vector.y)
  if (length < 0.0001) return { x: 0, y: -1 }
  return { x: vector.x / length, y: vector.y / length }
}

function resourceCenter(actor: ResourceCombatActor): ResourceCombatPoint {
  return {
    x: actor.position.x + RESOURCE_COMBAT_CONFIG.actorSize / 2,
    y: actor.position.y + RESOURCE_COMBAT_CONFIG.actorSize / 2,
  }
}

function playerCenter(player: ResourceCombatPoint): ResourceCombatPoint {
  return {
    x: player.x + RESOURCE_COMBAT_CONFIG.playerSize / 2,
    y: player.y + RESOURCE_COMBAT_CONFIG.playerSize / 2,
  }
}

function chooseWave(
  resources: readonly ResourceCombatResource[],
): ResourceCombatResource[] {
  const groups = new Map<ResourceCombatOrigin, ResourceCombatResource[]>(
    ORIGIN_ORDER.map((origin) => [origin, []]),
  )
  for (const resource of resources) {
    if (resource.contribution !== 'normal') continue
    groups.get(resource.origin)?.push(resource)
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.blockId.localeCompare(right.blockId))
  }

  const selected: ResourceCombatResource[] = []
  let row = 0
  while (selected.length < 3) {
    let found = false
    for (const origin of ORIGIN_ORDER) {
      const resource = groups.get(origin)?.[row]
      if (!resource) continue
      selected.push(resource)
      found = true
      if (selected.length === 3) break
    }
    if (!found) break
    row += 1
  }
  return selected
}

function fallbackSpawn(initiative: number): ResourceCombatPoint {
  const anchors: readonly ResourceCombatPoint[] = [
    { x: 8, y: 6 },
    { x: 24, y: 4 },
    { x: 40, y: 7 },
  ]
  return { ...anchors[initiative % anchors.length] }
}

function initialTrackingDuration(
  seed: string,
  blockId: string,
  initiative: number,
): number {
  return (
    720 +
    initiative * 640 +
    (hashString(`${seed}|${blockId}|opening`) % 120)
  )
}

function recurringTrackingDuration(
  seed: string,
  actor: ResourceCombatActor,
): number {
  return (
    900 +
    actor.initiative * 130 +
    (hashString(`${seed}|${actor.blockId}|${actor.actionSequence}`) % 240)
  )
}

function createActor(
  seed: string,
  resource: ResourceCombatResource,
  position: ResourceCombatPoint | undefined,
  initiative: number,
): ResourceCombatActor {
  const spawnPosition = position ?? fallbackSpawn(initiative)
  return {
    blockId: resource.blockId,
    position: { ...spawnPosition },
    spawnPosition: { ...spawnPosition },
    health: RESOURCE_COMBAT_CONFIG.actorHealth,
    phase: 'tracking',
    phaseElapsedMs: 0,
    phaseDurationMs: initialTrackingDuration(
      seed,
      resource.blockId,
      initiative,
    ),
    chargeDirection: null,
    actionSequence: 0,
    contactResolved: false,
    initiative,
  }
}

function createWaveActors(
  seed: string,
  wave: readonly ResourceCombatResource[],
  positions: ReadonlyMap<string, ResourceCombatPoint>,
): ReadonlyMap<string, ResourceCombatActor> {
  return new Map(
    wave.map((resource, initiative) => [
      resource.blockId,
      createActor(seed, resource, positions.get(resource.blockId), initiative),
    ]),
  )
}

export function createResourceCombatState(
  seed: string,
  resources: readonly ResourceCombatResource[],
  positions: ReadonlyMap<string, ResourceCombatPoint>,
): ResourceCombatState {
  const wave = chooseWave(resources)
  return {
    seed,
    elapsedMs: 0,
    waveNumber: 1,
    waveBlockIds: wave.map(({ blockId }) => blockId),
    actors: createWaveActors(seed, wave, positions),
    trail: [],
    trailSuppressedUntilMs: 0,
    lastCompression: null,
    compressionSequence: 0,
    playerHealth: RESOURCE_COMBAT_CONFIG.playerHealth,
    playerInvulnerableMs: 0,
    respawnCount: 0,
  }
}

export function synchronizeResourceCombatState(
  state: ResourceCombatState,
  resources: readonly ResourceCombatResource[],
  positions: ReadonlyMap<string, ResourceCombatPoint>,
): ResourceCombatState {
  const currentIds = new Set(resources.map(({ blockId }) => blockId))
  const currentWaveIds = state.waveBlockIds.filter((blockId) =>
    currentIds.has(blockId),
  )

  if (currentWaveIds.length > 0) {
    const actors = new Map(
      [...state.actors].filter(([blockId]) => currentIds.has(blockId)),
    )
    if (actors.size === state.actors.size) return state
    return { ...state, actors }
  }

  const wave = chooseWave(resources)
  if (wave.length === 0) {
    if (state.actors.size === 0 && state.waveBlockIds.length === 0) return state
    return { ...state, waveBlockIds: [], actors: new Map(), trail: [] }
  }
  const waveNumber = state.waveNumber + 1
  return {
    ...state,
    waveNumber,
    waveBlockIds: wave.map(({ blockId }) => blockId),
    actors: createWaveActors(
      `${state.seed}|wave-${waveNumber}`,
      wave,
      positions,
    ),
    trail: [],
    trailSuppressedUntilMs: 0,
    lastCompression: null,
  }
}

function moveActorToward(
  actor: ResourceCombatActor,
  target: ResourceCombatPoint,
  distance: number,
): { actor: ResourceCombatActor; blocked: boolean } {
  const center = resourceCenter(actor)
  const direction = normalize({ x: target.x - center.x, y: target.y - center.y })
  const nextPosition = {
    x: clamp(
      actor.position.x + direction.x * distance,
      RESOURCE_COMBAT_CONFIG.fieldPadding,
      RESOURCE_COMBAT_CONFIG.fieldWidth -
        RESOURCE_COMBAT_CONFIG.fieldPadding -
        RESOURCE_COMBAT_CONFIG.actorSize,
    ),
    y: clamp(
      actor.position.y + direction.y * distance,
      RESOURCE_COMBAT_CONFIG.fieldPadding,
      RESOURCE_COMBAT_CONFIG.fieldHeight -
        RESOURCE_COMBAT_CONFIG.fieldPadding -
        RESOURCE_COMBAT_CONFIG.actorSize,
    ),
  }
  if (
    rectsOverlap(
      rectAt(nextPosition, RESOURCE_COMBAT_CONFIG.actorSize),
      RESOURCE_COMBAT_CONFIG.safeZone,
    )
  ) {
    return { actor, blocked: true }
  }
  return { actor: { ...actor, position: nextPosition }, blocked: false }
}

function moveTrackingActor(
  actor: ResourceCombatActor,
  player: ResourceCombatPoint,
  elapsedMs: number,
  totalElapsedMs: number,
): ResourceCombatActor {
  const rawPlayerPosition = playerCenter(player)
  const playerWaitingInBase = pointInsideRect(
    rawPlayerPosition,
    RESOURCE_COMBAT_CONFIG.safeZone,
  )
  const engagementCenter = playerWaitingInBase
    ? {
        x: rawPlayerPosition.x,
        y: RESOURCE_COMBAT_CONFIG.safeZone.y - 6.5,
      }
    : rawPlayerPosition
  const orbitAngle =
    totalElapsedMs / 1_850 + actor.initiative * (Math.PI * 2 / 3)
  const target = {
    x:
      engagementCenter.x +
      Math.cos(orbitAngle) * (playerWaitingInBase ? 10.5 : 6.4),
    y:
      engagementCenter.y +
      Math.sin(orbitAngle) * (playerWaitingInBase ? 4.5 : 4.2),
  }
  return moveActorToward(
    actor,
    target,
    RESOURCE_COMBAT_CONFIG.trackingSpeedPerMs * elapsedMs,
  ).actor
}

function transitionActorPhase(
  actor: ResourceCombatActor,
  seed: string,
  player: ResourceCombatPoint,
): ResourceCombatActor {
  if (actor.phase === 'tracking') {
    const center = resourceCenter(actor)
    const target = playerCenter(player)
    return {
      ...actor,
      phase: 'telegraph',
      phaseElapsedMs: 0,
      phaseDurationMs: RESOURCE_COMBAT_CONFIG.telegraphMs,
      chargeDirection: normalize({ x: target.x - center.x, y: target.y - center.y }),
      actionSequence: actor.actionSequence + 1,
      contactResolved: false,
    }
  }
  if (actor.phase === 'telegraph') {
    return {
      ...actor,
      phase: 'charging',
      phaseElapsedMs: 0,
      phaseDurationMs: RESOURCE_COMBAT_CONFIG.chargeMs,
      contactResolved: false,
    }
  }
  if (actor.phase === 'charging') {
    return {
      ...actor,
      phase: 'recovering',
      phaseElapsedMs: 0,
      phaseDurationMs: RESOURCE_COMBAT_CONFIG.recoveryMs,
      chargeDirection: null,
      contactResolved: false,
    }
  }
  if (actor.phase === 'recovering' || actor.phase === 'staggered') {
    return {
      ...actor,
      phase: 'tracking',
      phaseElapsedMs: 0,
      phaseDurationMs: recurringTrackingDuration(seed, actor),
      chargeDirection: null,
      contactResolved: false,
    }
  }
  return actor
}

function advanceActor(
  initial: ResourceCombatActor,
  elapsedMs: number,
  player: ResourceCombatPoint,
  seed: string,
  totalElapsedMs: number,
): ResourceCombatActor {
  if (initial.phase === 'salvage') return initial
  let actor = initial
  let remainingMs = elapsedMs
  while (remainingMs > 0 && actor.phase !== 'salvage') {
    const untilBoundary = Math.max(0, actor.phaseDurationMs - actor.phaseElapsedMs)
    const stepMs = Math.min(remainingMs, untilBoundary)

    if (actor.phase === 'tracking') {
      actor = moveTrackingActor(actor, player, stepMs, totalElapsedMs - remainingMs)
    } else if (actor.phase === 'charging' && actor.chargeDirection) {
      const target = {
        x: resourceCenter(actor).x + actor.chargeDirection.x,
        y: resourceCenter(actor).y + actor.chargeDirection.y,
      }
      const moved = moveActorToward(
        actor,
        target,
        RESOURCE_COMBAT_CONFIG.chargeSpeedPerMs * stepMs,
      )
      if (moved.blocked) {
        actor = {
          ...actor,
          phase: 'recovering',
          phaseElapsedMs: 0,
          phaseDurationMs: RESOURCE_COMBAT_CONFIG.recoveryMs,
          chargeDirection: null,
          contactResolved: false,
        }
        remainingMs -= stepMs
        continue
      }
      actor = moved.actor
    }

    actor = { ...actor, phaseElapsedMs: actor.phaseElapsedMs + stepMs }
    remainingMs -= stepMs
    if (actor.phaseElapsedMs >= actor.phaseDurationMs) {
      actor = transitionActorPhase(actor, seed, player)
    }
    if (stepMs === 0) {
      actor = transitionActorPhase(actor, seed, player)
    }
  }
  return actor
}

function resetCurrentWave(state: ResourceCombatState): ResourceCombatState {
  const actors = new Map<string, ResourceCombatActor>()
  for (const actor of state.actors.values()) {
    actors.set(actor.blockId, {
      ...actor,
      position: { ...actor.spawnPosition },
      health: RESOURCE_COMBAT_CONFIG.actorHealth,
      phase: 'tracking',
      phaseElapsedMs: 0,
      phaseDurationMs: initialTrackingDuration(
        `${state.seed}|respawn-${state.respawnCount + 1}`,
        actor.blockId,
        actor.initiative,
      ),
      chargeDirection: null,
      contactResolved: false,
    })
  }
  return {
    ...state,
    actors,
    trail: [],
    trailSuppressedUntilMs:
      state.elapsedMs + RESOURCE_COMBAT_CONFIG.compressionVisibleMs,
    lastCompression: null,
    playerHealth: RESOURCE_COMBAT_CONFIG.playerHealth,
    playerInvulnerableMs: RESOURCE_COMBAT_CONFIG.playerInvulnerabilityMs,
    respawnCount: state.respawnCount + 1,
  }
}

function pruneTrail(
  trail: readonly ResourceCombatTrailPoint[],
  nowMs: number,
): ResourceCombatTrailPoint[] {
  const cutoff = nowMs - RESOURCE_COMBAT_CONFIG.trailLifetimeMs
  return trail.filter(({ createdAtMs }) => createdAtMs >= cutoff)
}

export function advanceResourceCombatState(
  state: ResourceCombatState,
  input: AdvanceResourceCombatInput,
): ResourceCombatTransition {
  const elapsedMs = Number.isFinite(input.elapsedMs)
    ? Math.max(0, input.elapsedMs)
    : 0
  if (elapsedMs === 0) return { state, events: [] }

  const elapsedAtEnd = state.elapsedMs + elapsedMs
  let playerHealth = state.playerHealth
  let playerInvulnerableMs = Math.max(
    0,
    state.playerInvulnerableMs - elapsedMs,
  )
  const playerProtected = rectsOverlap(
    rectAt(input.player, RESOURCE_COMBAT_CONFIG.playerSize),
    RESOURCE_COMBAT_CONFIG.safeZone,
  )
  const events: ResourceCombatEvent[] = []
  const actors = new Map<string, ResourceCombatActor>()
  const orderedActors = [...state.actors.values()].sort(
    (left, right) => left.initiative - right.initiative,
  )

  for (const current of orderedActors) {
    let actor = advanceActor(
      current,
      elapsedMs,
      input.player,
      state.seed,
      elapsedAtEnd,
    )
    const contact =
      !playerProtected &&
      actor.phase === 'charging' &&
      !actor.contactResolved &&
      rectsOverlap(
        rectAt(actor.position, RESOURCE_COMBAT_CONFIG.actorSize),
        rectAt(input.player, RESOURCE_COMBAT_CONFIG.playerSize),
      )
    if (contact) {
      actor = { ...actor, contactResolved: true }
      if (playerInvulnerableMs <= 0) {
        playerHealth -= 1
        playerInvulnerableMs = RESOURCE_COMBAT_CONFIG.playerInvulnerabilityMs
        events.push({
          type: 'player-damaged',
          health: Math.max(0, playerHealth),
          blockId: actor.blockId,
        })
      }
    }
    actors.set(actor.blockId, actor)
  }

  const advanced: ResourceCombatState = {
    ...state,
    elapsedMs: elapsedAtEnd,
    actors,
    trail: pruneTrail(state.trail, elapsedAtEnd),
    lastCompression:
      state.lastCompression &&
      elapsedAtEnd - state.lastCompression.startedAtMs <
        RESOURCE_COMBAT_CONFIG.compressionVisibleMs
        ? state.lastCompression
        : null,
    playerHealth,
    playerInvulnerableMs,
  }

  if (playerHealth > 0) return { state: advanced, events }
  events.push({ type: 'player-disabled' })
  return { state: resetCurrentWave(advanced), events }
}

function distance(
  left: ResourceCombatPoint,
  right: ResourceCombatPoint,
): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function polygonArea(points: readonly ResourceCombatPoint[]): number {
  let twiceArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    twiceArea += current.x * next.y - next.x * current.y
  }
  return twiceArea / 2
}

function pointInPolygon(
  point: ResourceCombatPoint,
  polygon: readonly ResourceCombatPoint[],
): boolean {
  let inside = false
  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index, index += 1
  ) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y || Number.EPSILON) +
          current.x
    if (crosses) inside = !inside
  }
  return inside
}

function selectClosurePolygon(
  points: readonly ResourceCombatTrailPoint[],
): ResourceCombatPoint[] | null {
  if (points.length < RESOURCE_COMBAT_CONFIG.trailMinimumPoints) return null
  const head = points[points.length - 1]
  let selected: ResourceCombatPoint[] | null = null
  let selectedArea = 0
  const latestCandidate =
    points.length - RESOURCE_COMBAT_CONFIG.trailMinimumPoints
  for (let index = 0; index <= latestCandidate; index += 1) {
    const candidate = points[index]
    if (distance(head, candidate) > RESOURCE_COMBAT_CONFIG.trailClosureDistance) {
      continue
    }
    const polygon: ResourceCombatPoint[] = points
      .slice(index)
      .map(({ x, y }) => ({ x, y }))
    const area = Math.abs(polygonArea(polygon))
    if (area < RESOURCE_COMBAT_CONFIG.trailMinimumArea || area <= selectedArea) {
      continue
    }
    selected = polygon
    selectedArea = area
  }
  return selected
}

function isMovementInsideSafeZone(
  point: ResourceCombatPoint,
): boolean {
  return pointInsideRect(playerCenter(point), RESOURCE_COMBAT_CONFIG.safeZone)
}

export function recordResourceCombatMovement(
  state: ResourceCombatState,
  from: ResourceCombatPoint,
  to: ResourceCombatPoint,
  nowMs: number,
): ResourceCombatTransition {
  const safeNowMs = Number.isFinite(nowMs)
    ? Math.max(state.elapsedMs, nowMs)
    : state.elapsedMs
  if (safeNowMs < state.trailSuppressedUntilMs) {
    return {
      state: state.trail.length === 0 ? state : { ...state, trail: [] },
      events: [],
    }
  }
  if (isMovementInsideSafeZone(from) || isMovementInsideSafeZone(to)) {
    if (state.trail.length === 0) return { state, events: [] }
    return { state: { ...state, trail: [] }, events: [] }
  }

  const trail = pruneTrail(state.trail, safeNowMs)
  const fromCenter = playerCenter(from)
  const toCenter = playerCenter(to)
  if (trail.length === 0) {
    trail.push({ ...fromCenter, createdAtMs: safeNowMs })
  }
  const previous = trail[trail.length - 1]
  if (distance(previous, toCenter) > 0.001) {
    trail.push({ ...toCenter, createdAtMs: safeNowMs })
  }

  const polygon = selectClosurePolygon(trail)
  if (!polygon) {
    return {
      state: { ...state, elapsedMs: safeNowMs, trail },
      events: [],
    }
  }

  const hitBlockIds: string[] = []
  const events: ResourceCombatEvent[] = []
  const actors = new Map<string, ResourceCombatActor>()
  for (const actor of state.actors.values()) {
    if (
      actor.phase === 'salvage' ||
      !pointInPolygon(resourceCenter(actor), polygon)
    ) {
      actors.set(actor.blockId, actor)
      continue
    }

    const health = Math.max(0, actor.health - 1)
    hitBlockIds.push(actor.blockId)
    if (health === 0) {
      actors.set(actor.blockId, {
        ...actor,
        health,
        phase: 'salvage',
        phaseElapsedMs: 0,
        phaseDurationMs: Number.POSITIVE_INFINITY,
        chargeDirection: null,
        contactResolved: false,
      })
      events.push({ type: 'resource-disabled', blockId: actor.blockId })
      continue
    }
    actors.set(actor.blockId, {
      ...actor,
      health,
      phase: 'staggered',
      phaseElapsedMs: 0,
      phaseDurationMs: RESOURCE_COMBAT_CONFIG.staggerMs,
      chargeDirection: null,
      contactResolved: false,
    })
  }

  const sequence = state.compressionSequence + 1
  events.unshift({ type: 'compression-resolved', hitBlockIds })
  return {
    state: {
      ...state,
      elapsedMs: safeNowMs,
      actors,
      trail: [],
      trailSuppressedUntilMs:
        safeNowMs + RESOURCE_COMBAT_CONFIG.compressionVisibleMs,
      compressionSequence: sequence,
      lastCompression: {
        sequence,
        polygon,
        hitBlockIds,
        startedAtMs: safeNowMs,
      },
    },
    events,
  }
}

export function getResourceCombatPositions(
  state: ResourceCombatState,
): ReadonlyMap<string, ResourceCombatPoint> {
  return new Map(
    [...state.actors].map(([blockId, actor]) => [
      blockId,
      { ...actor.position },
    ]),
  )
}

export function getSalvageAtPlayer(
  state: ResourceCombatState,
  player: ResourceCombatPoint,
): ResourceCombatActor | null {
  const playerRect = rectAt(player, RESOURCE_COMBAT_CONFIG.playerSize)
  return (
    [...state.actors.values()].find(
      (actor) =>
        actor.phase === 'salvage' &&
        rectsOverlap(
          playerRect,
          rectAt(actor.position, RESOURCE_COMBAT_CONFIG.actorSize),
        ),
    ) ?? null
  )
}
