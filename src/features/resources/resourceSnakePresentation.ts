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

export interface ResourceSnakeScene {
  simulationMs: number
  reducedMotion: boolean
  cores: ResourceSnakeSceneCore[]
  rails: ResourceSnakeSceneRail[]
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

function actorColor(actor: SnakeActor): string {
  if (actor.kind === 'player') return RESOURCE_SNAKE_PALETTE.player
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
  const extraction = [...runtime.events].reverse().find((event) => (
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
      ? actor.phase === 'spawning' ? 0.72 : actor.phase === 'exploding' ? 1.42 : 1
      : Number((1 - extractionProgress * 0.82).toFixed(3)),
    phase: actor.phase,
    role,
    shape: actor.kind === 'player' ? 'circle' : 'square',
    integrityRatio: actorIntegrityRatio(actor),
  }
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
    opacity: Number(((actor.phase === 'defeated'
      ? 0.16
      : 0.56 + integrity * 0.44) * fade).toFixed(3)),
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
): ResourceSnakeSceneVfx[] {
  return runtime.events.flatMap((event) => {
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
): ResourceSnakeSceneVfx[] {
  return runtime.events.flatMap((event) => {
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
  const candidates: ResourceSnakeSceneVfx[] = [
    ...telegraphs.flatMap((telegraph) => {
      const projected = telegraphVfx(runtime, telegraph, reducedMotion)
      return projected ? [projected] : []
    }),
    ...collisionVfx(runtime, allActors),
    ...deathVfx(runtime, allActors, reducedMotion),
  ]
  const effects = selectResourceSnakeVfx(candidates, reducedMotion)

  return {
    simulationMs: runtime.simulationMs,
    reducedMotion,
    cores: allActors.map((actor) => actorCore(runtime, actor, reducedMotion)),
    rails: allActors.map((actor) => actorRail(runtime, actor, reducedMotion)),
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
  const collision = [...runtime.events].reverse().find((event) => (
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
