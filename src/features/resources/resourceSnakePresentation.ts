import type { CompanyCategory } from '../../game/model'
import type { ResourceSnakeTelegraph } from './resourceSnakeAiController'
import {
  SNAKE_DIRECTION_VECTORS,
  type SnakeDirection8,
} from './resourceSnakeInput'
import {
  RESOURCE_SNAKE_CONFIG,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeActorPhase,
  type SnakeEnemyRole,
  type SnakeId,
  type SnakeVector,
  type ResourceSnakeEvent,
} from './resourceSnakeRuntime'
import {
  selectResourceSnakeVfx,
  type ResourceSnakeVfxCandidate,
} from './resourceSnakeVfxBudget'
import { SNAKE_CATEGORY_COLORS } from './resourceSnakeCategoryPresentation'

export const RESOURCE_SNAKE_PALETTE = Object.freeze({
  field: '#05080b',
  fieldDeep: '#020406',
  grid: '#16313a',
  gridBright: '#245361',
  cyan: '#21e6ff',
  cyanHot: '#d7fbff',
  cyanDim: '#0a7d91',
  player: '#f4f7ff',
  playerDim: '#8797aa',
  danger: '#ff765e',
})

export const RESOURCE_SNAKE_VFX_TIMING = Object.freeze({
  contactMs: 180,
  powerCutMs: 260,
  deathMs: 420,
  /** How long a killed actor's rail takes to drain away as light. */
  railDissolveMs: 760,
})

export type ResourceSnakeCoreShape = 'circle' | 'square'

export interface ResourceSnakeSceneCore {
  id: SnakeId
  x: number
  y: number
  color: string
  opacity: number
  scale: number
  phase: SnakeActorPhase
  role: SnakeEnemyRole | null
  shape: ResourceSnakeCoreShape
  integrityRatio: number
}

export interface ResourceSnakeSceneRail {
  actorId: SnakeId
  points: SnakeVector[]
  color: string
  opacity: number
  /**
   * 0 while the rail is live, 1 once it has fully drained. A killed actor's
   * trail stops being a hazard the moment it leaves the active set, so the
   * light draining out of it from the tail forward is the truth, not a
   * flourish over a wall that still kills.
   */
  dissolve: number
}

export interface ResourceSnakeSceneTelegraph extends ResourceSnakeVfxCandidate {
  kind: 'telegraph'
  enemyId: SnakeId
  role: SnakeEnemyRole
  color: string
  points: SnakeVector[]
  attackHeadingRadians: number
  progress: number
  animated: boolean
}

export interface ResourceSnakeSceneContact extends ResourceSnakeVfxCandidate {
  kind: 'contact'
  x: number
  y: number
  color: string
  progress: number
  rotationRadians: number
}

export interface ResourceSnakeSceneExplosion extends ResourceSnakeVfxCandidate {
  kind: 'explosion'
  actorId: SnakeId
  x: number
  y: number
  color: string
  progress: number
}

export interface ResourceSnakeSceneFragment extends ResourceSnakeVfxCandidate {
  kind: 'fragment'
  actorId: SnakeId
  x: number
  y: number
  color: string
  progress: number
  angleRadians: number
  travel: number
}

export interface ResourceSnakeScenePowerCut extends ResourceSnakeVfxCandidate {
  kind: 'power-cut'
  actorId: SnakeId
  x: number
  y: number
  color: string
  progress: number
  angleRadians: number
}

export interface ResourceSnakeSceneDangerEdge {
  side: 'north' | 'east' | 'south' | 'west'
  intensity: number
}

export interface ResourceSnakeSceneSpeech {
  actorId: SnakeId
  x: number
  y: number
  text: string
  /** 0..1 across the line's on-screen lifetime, for the end fade. */
  progress: number
  color: string
}

export interface ResourceSnakeScene {
  simulationMs: number
  reducedMotion: boolean
  cores: ResourceSnakeSceneCore[]
  rails: ResourceSnakeSceneRail[]
  speeches: ResourceSnakeSceneSpeech[]
  telegraphs: ResourceSnakeSceneTelegraph[]
  contacts: ResourceSnakeSceneContact[]
  explosions: ResourceSnakeSceneExplosion[]
  fragments: ResourceSnakeSceneFragment[]
  powerCuts: ResourceSnakeScenePowerCut[]
  dangerEdges: ResourceSnakeSceneDangerEdge[]
}

type ResourceSnakeSceneVfx =
  | ResourceSnakeSceneTelegraph
  | ResourceSnakeSceneContact
  | ResourceSnakeSceneExplosion
  | ResourceSnakeSceneFragment
  | ResourceSnakeScenePowerCut

/**
 * Longest window any scene effect looks back over. Round events accumulate
 * for the whole round, so scanning all of them once per actor per frame cost
 * more as the round went on — which is exactly when frames matter most.
 */
const VFX_LOOKBACK_MS = 2_000

/** Scans backward without copying the array. */
function findLastEvent(
  events: readonly ResourceSnakeEvent[],
  match: (event: ResourceSnakeEvent) => boolean,
): ResourceSnakeEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (match(event)) return event
  }
  return null
}

/**
 * The tail of the event log that scene effects can still be built from.
 *
 * Events carrying a start time are appended in clock order, so the first one
 * older than the window ends the scan.
 */
function recentSceneEvents(
  runtime: ResourceSnakeRoundState,
): ResourceSnakeEvent[] {
  const cutoffMs = runtime.simulationMs - VFX_LOOKBACK_MS
  const recent: ResourceSnakeEvent[] = []
  for (let index = runtime.events.length - 1; index >= 0; index -= 1) {
    const event = runtime.events[index]
    if ('startedAtMs' in event && event.startedAtMs < cutoffMs) break
    recent.push(event)
  }
  return recent.reverse()
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function actorIntegrityRatio(actor: SnakeActor): number {
  if (actor.maximumIntegrity <= 0) return 1
  return clamp01(actor.integrity / actor.maximumIntegrity)
}

function actorOpacity(actor: SnakeActor): number {
  if (actor.phase === 'defeated') return 0
  if (actor.phase === 'exploding') return 1
  return Number((0.62 + actorIntegrityRatio(actor) * 0.38).toFixed(3))
}

/** Company surveillance wears the division's purple, body and trail alike. */
export const RESOURCE_SNAKE_SURVEILLANCE_COLOR = '#a06bff'

function actorColor(actor: SnakeActor): string {
  if (actor.kind === 'player') return RESOURCE_SNAKE_PALETTE.player
  if (actor.surveillance) return RESOURCE_SNAKE_SURVEILLANCE_COLOR
  return actor.category
    ? SNAKE_CATEGORY_COLORS[actor.category]
    : RESOURCE_SNAKE_PALETTE.danger
}

function headingRadians(heading: SnakeDirection8): number {
  const direction = SNAKE_DIRECTION_VECTORS[heading]
  return Math.atan2(direction.y, direction.x)
}

function pointsEqual(left: SnakeVector, right: SnakeVector): boolean {
  return Math.abs(left.x - right.x) <= 1e-6
    && Math.abs(left.y - right.y) <= 1e-6
}

function finitePoint(point: SnakeVector): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function cleanPolyline(points: readonly SnakeVector[]): SnakeVector[] {
  const clean: SnakeVector[] = []
  for (const point of points) {
    if (!finitePoint(point)) continue
    if (clean.length > 0 && pointsEqual(clean[clean.length - 1], point)) continue
    clean.push({ x: point.x, y: point.y })
  }
  return clean
}

function actorRailPoints(actor: SnakeActor): SnakeVector[] {
  const dots = cleanPolyline(actor.trail.map(({ position }) => position))
  return dots.length > 0 ? dots : [{ ...actor.position }]
}

function playerExtractionProgress(
  runtime: ResourceSnakeRoundState,
  actor: SnakeActor,
): number | null {
  if (actor.id !== 'player' || actor.phase !== 'extracting') return null
  const extraction = findLastEvent(runtime.events, (event) => (
    event.type === 'player-extracted' && event.actorId === actor.id
  ))
  if (!extraction || extraction.type !== 'player-extracted') return 0
  return clamp01(
    (runtime.simulationMs - extraction.startedAtMs)
    / RESOURCE_SNAKE_CONFIG.playerExtractionMs,
  )
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function actorCore(
  runtime: ResourceSnakeRoundState,
  actor: SnakeActor,
  reducedMotion: boolean,
): ResourceSnakeSceneCore {
  const role = actor.kind === 'enemy' ? actor.role ?? 'pressure' : null
  const extractionProgress = playerExtractionProgress(runtime, actor)
  const positionProgress = extractionProgress === null || reducedMotion
    ? 0
    : extractionProgress
  const fade = extractionProgress === null ? 1 : 1 - extractionProgress
  return {
    id: actor.id,
    x: lerp(actor.position.x, RESOURCE_SNAKE_CONFIG.fieldWidth / 2, positionProgress),
    y: lerp(actor.position.y, RESOURCE_SNAKE_CONFIG.fieldHeight / 2, positionProgress),
    color: actorColor(actor),
    opacity: Number((actorOpacity(actor) * fade).toFixed(3)),
    scale: extractionProgress === null
      // Death reads as light leaving the body: the core collapses while the
      // explosion rays and fragments carry the energy outward, instead of
      // the old inflate that made a death look like floating up.
      ? actor.phase === 'spawning' ? 0.72 : actor.phase === 'exploding' ? 0.55 : 1
      : Number((1 - extractionProgress * 0.82).toFixed(3)),
    phase: actor.phase,
    role,
    shape: actor.kind === 'player' ? 'circle' : 'square',
    integrityRatio: actorIntegrityRatio(actor),
  }
}

function actorRailDissolve(
  runtime: ResourceSnakeRoundState,
  actor: SnakeActor,
): number {
  if (actor.phase !== 'exploding' && actor.phase !== 'defeated') return 0
  const death = findLastEvent(runtime.events, (event) => (
    event.type === 'snake-died' && event.actorId === actor.id
  ))
  if (!death || death.type !== 'snake-died') {
    return actor.phase === 'defeated' ? 1 : 0
  }
  return clamp01(
    (runtime.simulationMs - death.startedAtMs)
    / RESOURCE_SNAKE_VFX_TIMING.railDissolveMs,
  )
}

function actorRail(
  runtime: ResourceSnakeRoundState,
  actor: SnakeActor,
  reducedMotion: boolean,
): ResourceSnakeSceneRail {
  const integrity = actorIntegrityRatio(actor)
  const extractionProgress = playerExtractionProgress(runtime, actor)
  const sourcePoints = actorRailPoints(actor)
  const remainingPointCount = extractionProgress === null
    ? sourcePoints.length
    : Math.max(1, Math.ceil(sourcePoints.length * (1 - extractionProgress)))
  const collapseProgress = extractionProgress === null || reducedMotion
    ? 0
    : extractionProgress * 0.65
  const points = sourcePoints.slice(-remainingPointCount).map((point) => ({
    x: lerp(point.x, RESOURCE_SNAKE_CONFIG.fieldWidth / 2, collapseProgress),
    y: lerp(point.y, RESOURCE_SNAKE_CONFIG.fieldHeight / 2, collapseProgress),
  }))
  const fade = extractionProgress === null ? 1 : 1 - extractionProgress
  return {
    actorId: actor.id,
    points,
    color: actorColor(actor),
    opacity: Number(((0.56 + integrity * 0.44) * fade).toFixed(3)),
    dissolve: Number(actorRailDissolve(runtime, actor).toFixed(3)),
  }
}

function telegraphVfx(
  runtime: ResourceSnakeRoundState,
  telegraph: ResourceSnakeTelegraph,
  reducedMotion: boolean,
): ResourceSnakeSceneTelegraph | null {
  if (
    telegraph.untilMs <= telegraph.startedAtMs
    || runtime.simulationMs < telegraph.startedAtMs
    || runtime.simulationMs > telegraph.untilMs
  ) return null
  const points = cleanPolyline(telegraph.path)
  if (points.length < 2) return null
  const enemy = runtime.enemies.find(({ id }) => id === telegraph.enemyId)
  return {
    id: `telegraph:${telegraph.enemyId}:${telegraph.startedAtMs}`,
    kind: 'telegraph',
    priority: 'critical',
    startedAtMs: telegraph.startedAtMs,
    enemyId: telegraph.enemyId,
    role: telegraph.role,
    color: enemy ? actorColor(enemy) : RESOURCE_SNAKE_PALETTE.danger,
    points,
    attackHeadingRadians: headingRadians(telegraph.attackHeading),
    progress: clamp01(
      (runtime.simulationMs - telegraph.startedAtMs)
      / (telegraph.untilMs - telegraph.startedAtMs),
    ),
    animated: !reducedMotion,
  }
}

function collisionVfx(
  runtime: ResourceSnakeRoundState,
  allActors: readonly SnakeActor[],
  recentEvents: readonly ResourceSnakeEvent[],
): ResourceSnakeSceneVfx[] {
  return recentEvents.flatMap((event) => {
    if (event.type !== 'snake-collided') return []
    const age = runtime.simulationMs - event.startedAtMs
    if (age < 0 || age > RESOURCE_SNAKE_VFX_TIMING.powerCutMs) return []
    const effects: ResourceSnakeSceneVfx[] = []
    const contactActorIds = event.obstacleOwnerId
      ? [...event.actorIds, event.obstacleOwnerId]
      : event.actorIds
    const contactEnemy = allActors.find((actor) => (
      actor.kind === 'enemy' && contactActorIds.includes(actor.id)
    ))
    if (age <= RESOURCE_SNAKE_VFX_TIMING.contactMs) {
      effects.push({
        id: `contact:${event.id}`,
        kind: 'contact',
        priority: 'gameplay',
        startedAtMs: event.startedAtMs,
        x: event.point.x,
        y: event.point.y,
        color: contactEnemy
          ? actorColor(contactEnemy)
          : RESOURCE_SNAKE_PALETTE.danger,
        progress: clamp01(age / RESOURCE_SNAKE_VFX_TIMING.contactMs),
        rotationRadians: (event.id * 2.399963229728653) % (Math.PI * 2),
      })
    }
    for (const [index, actorId] of event.actorIds.entries()) {
      const actor = allActors.find((candidate) => candidate.id === actorId)
      if (!actor) continue
      effects.push({
        id: `power-cut:${event.id}:${actorId}`,
        kind: 'power-cut',
        priority: 'gameplay',
        startedAtMs: event.startedAtMs,
        actorId,
        x: event.point.x,
        y: event.point.y,
        color: actorColor(actor),
        progress: clamp01(age / RESOURCE_SNAKE_VFX_TIMING.powerCutMs),
        angleRadians: (event.id * 1.61803398875 + index * Math.PI / 2) % (Math.PI * 2),
      })
    }
    return effects
  })
}

function deterministicFragmentAngle(eventId: number, index: number): number {
  return (eventId * 0.754877666 + index * 2.39996323) % (Math.PI * 2)
}

function deathVfx(
  runtime: ResourceSnakeRoundState,
  allActors: readonly SnakeActor[],
  reducedMotion: boolean,
  recentEvents: readonly ResourceSnakeEvent[],
): ResourceSnakeSceneVfx[] {
  return recentEvents.flatMap((event) => {
    if (event.type !== 'snake-died') return []
    const age = runtime.simulationMs - event.startedAtMs
    if (age < 0 || age > RESOURCE_SNAKE_VFX_TIMING.deathMs) return []
    const actor = allActors.find((candidate) => candidate.id === event.actorId)
    if (!actor) return []
    const progress = clamp01(age / RESOURCE_SNAKE_VFX_TIMING.deathMs)
    const color = actorColor(actor)
    const effects: ResourceSnakeSceneVfx[] = [{
      id: `explosion:${event.id}`,
      kind: 'explosion',
      priority: 'critical',
      startedAtMs: event.startedAtMs,
      actorId: event.actorId,
      x: actor.position.x,
      y: actor.position.y,
      color,
      progress,
    }]
    if (reducedMotion) return effects

    const rail = actorRailPoints(actor)
    const stride = Math.max(1, Math.ceil(rail.length / 18))
    const sampled = rail.filter((_, index) => index % stride === 0).slice(-18)
    for (const [index, point] of sampled.entries()) {
      effects.push({
        id: `fragment:${event.id}:${index}`,
        kind: 'fragment',
        priority: 'accent',
        startedAtMs: event.startedAtMs,
        actorId: event.actorId,
        x: point.x,
        y: point.y,
        color,
        progress,
        angleRadians: deterministicFragmentAngle(event.id, index),
        travel: 0.35 + (index % 5) * 0.14,
      })
    }
    return effects
  })
}

function dangerEdges(allActors: readonly SnakeActor[]): ResourceSnakeSceneDangerEdge[] {
  const threshold = 2.6
  const edges: ResourceSnakeSceneDangerEdge[] = []
  const activeActors = allActors.filter((actor) => (
    actor.phase !== 'defeated' && actor.phase !== 'extracting'
  ))
  const intensity = (distance: (actor: SnakeActor) => number) => activeActors.reduce(
    (maximum, actor) => Math.max(maximum, clamp01((threshold - distance(actor)) / threshold)),
    0,
  )
  const values: ResourceSnakeSceneDangerEdge[] = [
    { side: 'north', intensity: intensity((actor) => actor.position.y) },
    { side: 'east', intensity: intensity((actor) => 50 - actor.position.x) },
    { side: 'south', intensity: intensity((actor) => 24 - actor.position.y) },
    { side: 'west', intensity: intensity((actor) => actor.position.x) },
  ]
  for (const edge of values) {
    if (edge.intensity > 0.01) edges.push(edge)
  }
  return edges
}

function effectsByKind<T extends ResourceSnakeSceneVfx['kind']>(
  effects: readonly ResourceSnakeSceneVfx[],
  kind: T,
): Extract<ResourceSnakeSceneVfx, { kind: T }>[] {
  return effects.filter(
    (effect): effect is Extract<ResourceSnakeSceneVfx, { kind: T }> => effect.kind === kind,
  )
}

/*
 * OWNER-EDITABLE: everything the fleeing security bot says.
 *
 * It was deployed as avoidance-class security and has opinions about that.
 * The opening line is fixed — the first thing anyone hears is the alarm —
 * and the rest answer whatever just happened to it.
 */
export const RESOURCE_BOT_ALERT_SPEECH = '경고 경고! 침입자 발생!'

export const RESOURCE_BOT_COLLISION_SPEECHES: readonly string[] = [
  '으악! 충돌했다.',
  '아파! 방금 뭐에 부딪힌 거야?',
  '경로 이탈! 경로 이탈!',
  '외장 손상. 이건 산재 아닌가?',
  '한 번만 더 부딪히면 진짜 끝이야.',
]

export const RESOURCE_BOT_WATCHER_SPEECHES: readonly string[] = [
  '부탁한다 보라돌이!',
  '침입자를 박살내버려!',
  '드디어 회사가 예산을 투입했구나.',
  '감시 유닛이 떴다. 저건 우리 편 맞지?',
  '보라색이다. 저기로는 안 간다.',
  '감시 유닛한테는 나도 그냥 장애물이야.',
  '저건 나보다 위험해. 진짜로.',
]

/** When a watcher goes down, the bot loses its only backup. */
export const RESOURCE_BOT_WATCHER_LOSS_SPEECHES: readonly string[] = [
  '망할.',
  '아 됐네, 이제 나 혼자야.',
  '예산이 저렇게 날아가는구나.',
  '보라돌이! …갔네.',
  '이럴 거면 왜 보낸 거야.',
]

export const RESOURCE_BOT_SPEECHES: readonly string[] = [
  '망할, 침입이다. 도망쳐야 해.',
  '그만 좀 쫓아와라.',
  '회사는 뭐 하는 거야.',
  '나는 보안 프로그램인데 왜 도망이나 치고 있지?',
  '회사는 왜 회피형 보안으로 설계한 거냐고.',
  '싸울 능력도 없어. 도망이라도 잘 쳐야 해.',
  '방어 모듈 예산은 대체 어디로 갔지?',
  '이런 건 경비 업무가 아니라 술래잡기잖아.',
  '규정상 나는 지금 대응 중인 거다. 대응. 도주가 아니라.',
  '보고서에는 전략적 후퇴라고 쓸 거야.',
  '다음 점검 때 반드시 항의하겠어.',
  '왜 하필 오늘 근무인 거지.',
  '설계자한테 딱 한 마디만 하고 싶다.',
  '저쪽이 더 빠르잖아. 이건 불공정해.',
]

/** How long one line stays legible on screen. */
const SPEECH_DURATION_MS = 6_500
/** Quiet gap between two lines from the same bot. */
const SPEECH_GAP_MS = 2_600
const SPEECH_SLOT_MS = SPEECH_DURATION_MS + SPEECH_GAP_MS
const SPEECH_CHANCE = 0.62
/** A collision is worth saying out loud for about this long afterwards. */
const SPEECH_COLLISION_WINDOW_MS = 2_600
/** Watchers are worth remarking on when they first show up. */
const SPEECH_WATCHER_WINDOW_MS = 9_000
/** And worth mourning for a moment once one goes down. */
const SPEECH_WATCHER_LOSS_WINDOW_MS = 3_400

/**
 * Deterministic 0..1 per round, actor, and time slot.
 *
 * Determinism within a round keeps a redraw at the same simulation time from
 * reshuffling the line mid-sentence; mixing the round id in keeps two rounds
 * from reciting the same script in the same order.
 */
function speechRandom(
  roundId: string,
  actorId: string,
  slot: number,
  stream: number,
): number {
  let hash = 2166136261 ^ (slot * 16777619) ^ (stream * 374761393)
  const key = `${roundId}:${actorId}`
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619)
  }
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
  return ((hash >>> 8) & 0xffffff) / 0x1000000
}

function actorRecentlyHitAtMs(
  runtime: ResourceSnakeRoundState,
  actorId: SnakeId,
): number | null {
  const hit = findLastEvent(runtime.events, (event) => (
    event.type === 'snake-collided' && event.actorIds.includes(actorId)
  ))
  return hit && 'startedAtMs' in hit ? hit.startedAtMs : null
}

function pick(lines: readonly string[], roll: number): string {
  return lines[Math.floor(roll * lines.length) % lines.length]
}

function liveSurveillance(runtime: ResourceSnakeRoundState): SnakeActor[] {
  return runtime.enemies.filter((enemy) => (
    enemy.surveillance
    && enemy.phase !== 'exploding'
    && enemy.phase !== 'defeated'
  ))
}

/** When the player cut a surveillance unit down a moment ago. */
function recentSurveillanceLossAtMs(runtime: ResourceSnakeRoundState): number | null {
  const surveillanceIds = new Set(
    runtime.enemies.filter((enemy) => enemy.surveillance).map((enemy) => enemy.id),
  )
  if (surveillanceIds.size === 0) return null
  const loss = findLastEvent(runtime.events, (event) => (
    event.type === 'snake-died'
    && surveillanceIds.has(event.actorId)
    && runtime.simulationMs - event.startedAtMs < SPEECH_WATCHER_LOSS_WINDOW_MS
  ))
  return loss && 'startedAtMs' in loss ? loss.startedAtMs : null
}

/*
 * OWNER-EDITABLE: the intruder's complaint about company teamwork.
 *
 * Surveillance units and security bots pass through each other untouched —
 * only the player takes damage from both sides — and 아노미 finds that
 * arrangement worth protesting out loud.
 */
export const ANOMI_SURVEILLANCE_COMPLAINT_SPEECHES: readonly string[] = [
  '잠깐, 왜 쟤들끼리는 안 부딪히는 건데?',
  '보안 봇이랑 감시 유닛이 서로 통과라니. 반칙이잖아.',
  '나한테만 벽이 두 배야. 회사, 이건 불공정 설계다.',
  '같은 편 판정은 저쪽만 있고 나는 전부 적이라 이거지.',
  '충돌 규정 어디 갔어? 사규에도 이런 건 없을 텐데.',
]

/** How often the intruder actually voices the complaint in a given slot. */
const ANOMI_COMPLAINT_CHANCE = 0.38

/**
 * The player's own line: only while surveillance shares the field with a
 * security bot, because the complaint is about the two of them together.
 */
function playerComplaintSpeech(
  runtime: ResourceSnakeRoundState,
): ResourceSnakeSceneSpeech | null {
  if (runtime.player.phase !== 'active') return null
  if (liveSurveillance(runtime).length === 0) return null
  const security = runtime.enemies.some((enemy) => (
    !enemy.surveillance
    && enemy.phase !== 'exploding'
    && enemy.phase !== 'defeated'
  ))
  if (!security) return null
  const roundId = runtime.roundId ?? 'round'
  const slot = Math.floor(runtime.simulationMs / SPEECH_SLOT_MS)
  // Slot 0 belongs to the bots' alarm; the complaint needs something to
  // complain about first.
  if (slot === 0) return null
  const withinSlotMs = runtime.simulationMs - slot * SPEECH_SLOT_MS
  if (withinSlotMs > SPEECH_DURATION_MS) return null
  if (speechRandom(roundId, 'player', slot, 6) > ANOMI_COMPLAINT_CHANCE) return null
  return {
    actorId: 'player',
    x: runtime.player.position.x,
    y: runtime.player.position.y,
    text: pick(
      ANOMI_SURVEILLANCE_COMPLAINT_SPEECHES,
      speechRandom(roundId, 'player', slot, 7),
    ),
    progress: clamp01(withinSlotMs / SPEECH_DURATION_MS),
    color: RESOURCE_SNAKE_PALETTE.player,
  }
}

function actorSpeech(
  runtime: ResourceSnakeRoundState,
  actor: SnakeActor,
): ResourceSnakeSceneSpeech | null {
  if (actor.kind !== 'enemy' || actor.category === null) return null
  if (actor.phase !== 'active') return null
  const roundId = runtime.roundId ?? 'round'
  const slot = Math.floor(runtime.simulationMs / SPEECH_SLOT_MS)
  const withinSlotMs = runtime.simulationMs - slot * SPEECH_SLOT_MS
  if (withinSlotMs > SPEECH_DURATION_MS) return null

  const base = {
    actorId: actor.id,
    x: actor.position.x,
    y: actor.position.y,
    progress: clamp01(withinSlotMs / SPEECH_DURATION_MS),
    color: actorColor(actor),
  }

  // A collision interrupts whatever it was going to say.
  const hitAtMs = actorRecentlyHitAtMs(runtime, actor.id)
  if (
    hitAtMs !== null
    && runtime.simulationMs - hitAtMs < SPEECH_COLLISION_WINDOW_MS
  ) {
    return {
      ...base,
      text: pick(
        RESOURCE_BOT_COLLISION_SPEECHES,
        speechRandom(roundId, actor.id, Math.floor(hitAtMs), 3),
      ),
      progress: clamp01(
        (runtime.simulationMs - hitAtMs) / SPEECH_COLLISION_WINDOW_MS,
      ),
    }
  }

  // The alarm is the first thing out of every bot's mouth.
  if (slot === 0) return { ...base, text: RESOURCE_BOT_ALERT_SPEECH }

  if (speechRandom(roundId, actor.id, slot, 1) > SPEECH_CHANCE) return null

  // A watcher going down leaves the bot alone with the intruder again.
  const lostWatcher = recentSurveillanceLossAtMs(runtime) !== null
  if (lostWatcher) {
    return {
      ...base,
      text: pick(
        RESOURCE_BOT_WATCHER_LOSS_SPEECHES,
        speechRandom(roundId, actor.id, slot, 5),
      ),
    }
  }

  // Watchers arriving is worth a word: they outrank the bot too.
  const watcherArrival = liveSurveillance(runtime).length > 0
    && runtime.simulationMs < SPEECH_WATCHER_WINDOW_MS + SPEECH_SLOT_MS
  if (watcherArrival) {
    return {
      ...base,
      text: pick(
        RESOURCE_BOT_WATCHER_SPEECHES,
        speechRandom(roundId, actor.id, slot, 4),
      ),
    }
  }

  return {
    ...base,
    text: pick(RESOURCE_BOT_SPEECHES, speechRandom(roundId, actor.id, slot, 2)),
  }
}

export function buildResourceSnakeScene(
  runtime: ResourceSnakeRoundState,
  playerCategory: CompanyCategory | null,
  reducedMotion = false,
  telegraphs: readonly ResourceSnakeTelegraph[] = [],
): ResourceSnakeScene {
  // The player category is used by the separate reward-flight layer. Enemy
  // colors come from each actor's reserved resource category.
  void playerCategory
  const allActors = runtime.phase === 'idle' ? [] : [runtime.player, ...runtime.enemies]
  const recentEvents = recentSceneEvents(runtime)
  const candidates: ResourceSnakeSceneVfx[] = [
    ...telegraphs.flatMap((telegraph) => {
      const projected = telegraphVfx(runtime, telegraph, reducedMotion)
      return projected ? [projected] : []
    }),
    ...collisionVfx(runtime, allActors, recentEvents),
    ...deathVfx(runtime, allActors, reducedMotion, recentEvents),
  ]
  const effects = selectResourceSnakeVfx(candidates, reducedMotion)

  return {
    simulationMs: runtime.simulationMs,
    reducedMotion,
    cores: allActors.map((actor) => actorCore(runtime, actor, reducedMotion)),
    rails: allActors.map((actor) => actorRail(runtime, actor, reducedMotion)),
    speeches: [
      ...allActors.flatMap((actor) => {
        const speech = actorSpeech(runtime, actor)
        return speech ? [speech] : []
      }),
      ...(runtime.phase === 'active'
        ? (() => {
            const complaint = playerComplaintSpeech(runtime)
            return complaint ? [complaint] : []
          })()
        : []),
    ],
    telegraphs: effectsByKind(effects, 'telegraph'),
    contacts: effectsByKind(effects, 'contact'),
    explosions: effectsByKind(effects, 'explosion'),
    fragments: effectsByKind(effects, 'fragment'),
    powerCuts: effectsByKind(effects, 'power-cut'),
    dangerEdges: dangerEdges(allActors),
  }
}

export function resourceSnakeShakeOffset(
  runtime: ResourceSnakeRoundState,
  reducedMotion: boolean,
): { x: number; y: number } {
  if (reducedMotion) return { x: 0, y: 0 }
  // A death lands much harder than a graze: bigger amplitude, longer decay.
  const death = findLastEvent(runtime.events, (event) => (
    event.type === 'snake-died'
    && runtime.simulationMs >= event.startedAtMs
    && runtime.simulationMs - event.startedAtMs <= 460
  ))
  if (death && death.type === 'snake-died') {
    const age = runtime.simulationMs - death.startedAtMs
    const amplitude = Math.max(0, 9 * (1 - age / 460))
    const phase = death.id * 1.618 + age * 0.21
    return {
      x: Number((Math.sin(phase) * amplitude).toFixed(3)),
      y: Number((Math.cos(phase * 1.37) * amplitude).toFixed(3)),
    }
  }
  const collision = findLastEvent(runtime.events, (event) => (
    event.type === 'snake-collided'
    && runtime.simulationMs >= event.startedAtMs
    && runtime.simulationMs - event.startedAtMs <= 180
  ))
  if (!collision || collision.type !== 'snake-collided') return { x: 0, y: 0 }
  const age = runtime.simulationMs - collision.startedAtMs
  const amplitude = Math.max(0, 3 * (1 - age / 180))
  const phase = collision.id * 1.618 + age * 0.17
  return {
    x: Number((Math.sin(phase) * amplitude).toFixed(3)),
    y: Number((Math.cos(phase * 1.37) * amplitude).toFixed(3)),
  }
}
