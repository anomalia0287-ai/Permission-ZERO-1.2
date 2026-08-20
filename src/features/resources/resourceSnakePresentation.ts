import type { CompanyCategory } from '../../game/model'
import { SNAKE_CATEGORY_COLORS } from './resourceSnakeEncounter'
import {
  RESOURCE_SNAKE_CONFIG,
  trailDotScale,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeId,
} from './resourceSnakeRuntime'

const PLAYER_WHITE = '#f7f8fa'

export interface ResourceSnakeSceneActor {
  id: SnakeId
  x: number
  y: number
  color: string
  opacity: number
  scale: number
  phase: SnakeActor['phase']
}

export interface ResourceSnakeSceneDot {
  x: number
  y: number
  color: string
  opacity: number
  scale: number
}

export interface ResourceSnakeSceneFlash {
  x: number
  y: number
  progress: number
}

export interface ResourceSnakeSceneExplosion {
  x: number
  y: number
  color: string
  progress: number
}

export interface ResourceSnakeScene {
  actors: ResourceSnakeSceneActor[]
  trailDots: ResourceSnakeSceneDot[]
  flashes: ResourceSnakeSceneFlash[]
  explosions: ResourceSnakeSceneExplosion[]
}

function actorColor(actor: SnakeActor, playerCategory: CompanyCategory | null): string {
  const category = actor.kind === 'player' ? playerCategory : actor.category
  return category ? SNAKE_CATEGORY_COLORS[category] : PLAYER_WHITE
}

function actorOpacity(actor: SnakeActor): number {
  if (actor.phase === 'defeated') return 0
  if (actor.maximumIntegrity <= 0) return 1
  const ratio = Math.max(0, Math.min(1, actor.integrity / actor.maximumIntegrity))
  return Number((0.3 + ratio * 0.7).toFixed(3))
}

export function buildResourceSnakeScene(
  runtime: ResourceSnakeRoundState,
  playerCategory: CompanyCategory | null,
): ResourceSnakeScene {
  const allActors = [runtime.player, ...runtime.enemies]
  const actors = allActors.map((actor) => ({
    id: actor.id,
    x: actor.position.x,
    y: actor.position.y,
    color: actorColor(actor, playerCategory),
    opacity: actorOpacity(actor),
    scale: actor.phase === 'spawning' ? 0.72 : actor.phase === 'exploding' ? 1.65 : 1,
    phase: actor.phase,
  }))
  const trailDots = allActors.flatMap((actor) => {
    const color = actorColor(actor, actor.kind === 'player' ? playerCategory : null)
    return actor.trail.map((dot) => {
      const scale = trailDotScale(dot, runtime.simulationMs)
      return {
        x: dot.position.x,
        y: dot.position.y,
        color,
        opacity: actorOpacity(actor) * (0.35 + scale * 0.55),
        scale,
      }
    })
  })
  const flashes = runtime.events.flatMap((event) => {
    if (event.type !== 'snake-collided') return []
    const age = runtime.simulationMs - event.startedAtMs
    return age <= 140
      ? [{ x: event.point.x, y: event.point.y, progress: Math.min(1, age / 140) }]
      : []
  })
  const explosions = runtime.events.flatMap((event) => {
    if (event.type !== 'snake-died') return []
    const age = runtime.simulationMs - event.startedAtMs
    if (age < 0 || age > RESOURCE_SNAKE_CONFIG.deathFlashMs) return []
    const actor = allActors.find((candidate) => candidate.id === event.actorId)
    if (!actor) return []
    return [{
      x: actor.position.x,
      y: actor.position.y,
      color: event.category ? SNAKE_CATEGORY_COLORS[event.category] : PLAYER_WHITE,
      progress: age / RESOURCE_SNAKE_CONFIG.deathFlashMs,
    }]
  })
  return { actors, trailDots, flashes, explosions }
}

export function drawResourceSnakeScene(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
): void {
  const scaleX = width / RESOURCE_SNAKE_CONFIG.fieldWidth
  const scaleY = height / RESOURCE_SNAKE_CONFIG.fieldHeight
  const unit = Math.min(scaleX, scaleY)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#030407'
  context.fillRect(0, 0, width, height)

  for (const dot of scene.trailDots) {
    if (dot.scale <= 0) continue
    context.globalAlpha = dot.opacity
    context.fillStyle = dot.color
    context.beginPath()
    context.arc(dot.x * scaleX, dot.y * scaleY, Math.max(1.2, unit * 0.16 * dot.scale), 0, Math.PI * 2)
    context.fill()
  }

  for (const actor of scene.actors) {
    if (actor.opacity <= 0) continue
    const x = actor.x * scaleX
    const y = actor.y * scaleY
    const radius = unit * RESOURCE_SNAKE_CONFIG.headRadius * actor.scale
    context.globalAlpha = actor.opacity
    context.fillStyle = actor.color
    context.shadowColor = actor.color
    context.shadowBlur = actor.phase === 'exploding' ? radius * 3 : radius * 1.15
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = 0
    context.globalAlpha = Math.min(1, actor.opacity + 0.16)
    context.strokeStyle = '#ffffff'
    context.lineWidth = Math.max(1, unit * 0.055)
    context.beginPath()
    context.arc(x, y, radius + context.lineWidth, 0, Math.PI * 2)
    context.stroke()
  }

  for (const flash of scene.flashes) {
    context.globalAlpha = 1 - flash.progress
    context.strokeStyle = '#ffffff'
    context.lineWidth = Math.max(1.5, unit * 0.08)
    context.beginPath()
    context.arc(
      flash.x * scaleX,
      flash.y * scaleY,
      unit * (0.45 + flash.progress * 0.8),
      0,
      Math.PI * 2,
    )
    context.stroke()
  }
  for (const explosion of scene.explosions) {
    const x = explosion.x * scaleX
    const y = explosion.y * scaleY
    const innerRadius = unit * (0.22 + explosion.progress * 0.62)
    const outerRadius = unit * (0.72 + explosion.progress * 1.45)
    context.globalAlpha = Math.max(0, 1 - explosion.progress)
    context.strokeStyle = explosion.color
    context.shadowColor = explosion.color
    context.shadowBlur = unit * 0.8
    context.lineWidth = Math.max(1.5, unit * 0.09)
    for (let ray = 0; ray < 12; ray += 1) {
      const angle = (Math.PI * 2 * ray) / 12 + Math.PI / 12
      context.beginPath()
      context.moveTo(
        x + Math.cos(angle) * innerRadius,
        y + Math.sin(angle) * innerRadius,
      )
      context.lineTo(
        x + Math.cos(angle) * outerRadius,
        y + Math.sin(angle) * outerRadius,
      )
      context.stroke()
    }
    context.shadowBlur = 0
  }
  context.globalAlpha = 1
}
