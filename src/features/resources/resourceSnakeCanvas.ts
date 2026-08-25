import {
  RESOURCE_SNAKE_PALETTE,
  type ResourceSnakeScene,
  type ResourceSnakeSceneCore,
  type ResourceSnakeSceneDangerEdge,
  type ResourceSnakeSceneRail,
  type ResourceSnakeSceneTelegraph,
} from './resourceSnakePresentation'
import { RESOURCE_SNAKE_CONFIG } from './resourceSnakeRuntime'

interface CanvasPoint {
  x: number
  y: number
}

interface CanvasScale {
  x: number
  y: number
  unit: number
}

export interface ResourceSnakeCanvasResolution {
  width: number
  height: number
  pixelRatio: number
}

const MAXIMUM_CANVAS_PIXELS = 2_400_000
const MAXIMUM_DEVICE_PIXEL_RATIO = 2

export function resourceSnakeCanvasResolution(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
): ResourceSnakeCanvasResolution {
  const safeWidth = Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 1
  const safeHeight = Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : 1
  const requestedRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? Math.min(devicePixelRatio, MAXIMUM_DEVICE_PIXEL_RATIO)
    : 1
  const allocationRatio = Math.sqrt(
    MAXIMUM_CANVAS_PIXELS / (safeWidth * safeHeight),
  )
  const pixelRatio = Math.min(requestedRatio, allocationRatio)
  return {
    width: Math.max(1, Math.floor(safeWidth * pixelRatio)),
    height: Math.max(1, Math.floor(safeHeight * pixelRatio)),
    pixelRatio,
  }
}

export function synchronizeResourceSnakeCanvasSize(
  canvas: HTMLCanvasElement,
  devicePixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio,
): boolean {
  const bounds = canvas.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return false
  const resolution = resourceSnakeCanvasResolution(
    bounds.width,
    bounds.height,
    devicePixelRatio,
  )
  if (canvas.width === resolution.width && canvas.height === resolution.height) return false
  canvas.width = resolution.width
  canvas.height = resolution.height
  return true
}

function canvasScale(width: number, height: number): CanvasScale {
  const x = width / RESOURCE_SNAKE_CONFIG.fieldWidth
  const y = height / RESOURCE_SNAKE_CONFIG.fieldHeight
  return { x, y, unit: Math.min(x, y) }
}

function rgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const red = Number.parseInt(clean.slice(0, 2), 16)
  const green = Number.parseInt(clean.slice(2, 4), 16)
  const blue = Number.parseInt(clean.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`
}

function tracePolygon(
  context: CanvasRenderingContext2D,
  points: readonly CanvasPoint[],
): void {
  if (points.length === 0) return
  context.beginPath()
  context.moveTo(points[0].x, points[0].y)
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y)
  }
  context.closePath()
}

function drawIndustrialField(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
  scale: CanvasScale,
): void {
  context.clearRect(0, 0, width, height)
  const wash = context.createLinearGradient(0, 0, 0, height)
  wash.addColorStop(0, RESOURCE_SNAKE_PALETTE.field)
  wash.addColorStop(0.52, RESOURCE_SNAKE_PALETTE.fieldDeep)
  wash.addColorStop(1, '#071016')
  context.fillStyle = wash
  context.fillRect(0, 0, width, height)

  context.save()
  context.lineWidth = Math.max(0.5, scale.unit * 0.018)
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.grid, 0.5)
  for (let x = 2; x < RESOURCE_SNAKE_CONFIG.fieldWidth; x += 2) {
    context.beginPath()
    context.moveTo(x * scale.x, 0)
    context.lineTo(x * scale.x, height)
    context.stroke()
  }
  for (let y = 2; y < RESOURCE_SNAKE_CONFIG.fieldHeight; y += 2) {
    context.beginPath()
    context.moveTo(0, y * scale.y)
    context.lineTo(width, y * scale.y)
    context.stroke()
  }

  context.lineWidth = Math.max(0.75, scale.unit * 0.028)
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.gridBright, 0.66)
  for (let x = 10; x < RESOURCE_SNAKE_CONFIG.fieldWidth; x += 10) {
    context.beginPath()
    context.moveTo(x * scale.x, 0)
    context.lineTo(x * scale.x, height)
    context.stroke()
  }
  for (let y = 8; y < RESOURCE_SNAKE_CONFIG.fieldHeight; y += 8) {
    context.beginPath()
    context.moveTo(0, y * scale.y)
    context.lineTo(width, y * scale.y)
    context.stroke()
  }

  const dash = Math.max(4, scale.unit * 0.38)
  context.setLineDash([dash, dash * 0.72])
  context.lineDashOffset = scene.reducedMotion ? 0 : -(scene.simulationMs * 0.012) % (dash * 1.72)
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.gridBright, 0.62)
  context.lineWidth = Math.max(1, scale.unit * 0.035)
  context.strokeRect(
    scale.unit * 0.34,
    scale.unit * 0.34,
    width - scale.unit * 0.68,
    height - scale.unit * 0.68,
  )
  context.setLineDash([])

  const bracket = scale.unit * 0.72
  const inset = scale.unit * 0.58
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.cyan, 0.38)
  context.lineWidth = Math.max(1, scale.unit * 0.045)
  const corners: Array<[number, number, number, number]> = [
    [inset, inset, 1, 1],
    [width - inset, inset, -1, 1],
    [width - inset, height - inset, -1, -1],
    [inset, height - inset, 1, -1],
  ]
  for (const [x, y, signX, signY] of corners) {
    context.beginPath()
    context.moveTo(x + signX * bracket, y)
    context.lineTo(x, y)
    context.lineTo(x, y + signY * bracket)
    context.stroke()
  }

  context.globalAlpha = 0.46
  context.fillStyle = RESOURCE_SNAKE_PALETTE.playerDim
  context.font = `${Math.max(7, scale.unit * 0.34)}px ui-monospace, SFMono-Regular, monospace`
  context.textAlign = 'left'
  context.textBaseline = 'top'
  const fieldCode = `CYAN GRID // ${String(Math.floor(scene.simulationMs)).padStart(6, '0')}`
  context.fillText(fieldCode, inset + scale.unit * 0.18, inset + scale.unit * 0.18)
  context.textAlign = 'right'
  context.fillText('SECTOR 50×24', width - inset - scale.unit * 0.18, inset + scale.unit * 0.18)
  context.restore()
}

function drawDangerEdge(
  context: CanvasRenderingContext2D,
  edge: ResourceSnakeSceneDangerEdge,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
  scale: CanvasScale,
): void {
  const pulse = scene.reducedMotion
    ? 0.72
    : 0.62 + Math.sin(scene.simulationMs * 0.022) * 0.2
  const alpha = edge.intensity * pulse
  if (alpha <= 0) return
  const inset = scale.unit * 0.36
  context.save()
  context.shadowBlur = 0
  const traceEdge = () => {
    context.beginPath()
    if (edge.side === 'north' || edge.side === 'south') {
      const y = edge.side === 'north' ? inset : height - inset
      context.moveTo(inset, y)
      context.lineTo(width - inset, y)
    } else {
      const x = edge.side === 'west' ? inset : width - inset
      context.moveTo(x, inset)
      context.lineTo(x, height - inset)
    }
    context.stroke()
  }
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.danger, alpha * 0.18)
  context.lineWidth = Math.max(3, scale.unit * (0.14 + edge.intensity * 0.12))
  context.setLineDash([])
  traceEdge()
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.danger, alpha)
  context.lineWidth = Math.max(1.5, scale.unit * (0.04 + edge.intensity * 0.08))
  context.setLineDash([scale.unit * 0.46, scale.unit * 0.24])
  traceEdge()
  context.restore()
}

/** Cheap deterministic 0..1, so the crackle is stable within a frame. */
function crackleRandom(seed: number, tick: number, index: number): number {
  let hash = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b)
  hash = Math.imul(hash ^ tick, 0xc2b2ae35)
  hash = Math.imul(hash ^ (index + 1), 0x27d4eb2f)
  return ((hash >>> 8) & 0xffffff) / 0x1000000
}

/**
 * Live current running down the wall.
 *
 * A fixed handful of short arcs, re-seeded a few times a second, rather than
 * anything per-point: the cost stays flat however long the trail grows,
 * which matters because the trail is longest exactly when the round is
 * busiest.
 */
function drawRailCurrent(
  context: CanvasRenderingContext2D,
  path: readonly { x: number; y: number }[],
  rail: ResourceSnakeSceneRail,
  simulationMs: number,
  scale: CanvasScale,
): void {
  if (path.length < 2) return
  const seed = rail.actorId.length * 31 + rail.actorId.charCodeAt(0)
  const tick = Math.floor(simulationMs / 70)
  const arcs = 4

  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (let index = 0; index < arcs; index += 1) {
    const along = crackleRandom(seed, tick, index) * (path.length - 1)
    const segment = Math.floor(along)
    const withinSegment = along - segment
    const from = path[segment]
    const to = path[Math.min(segment + 1, path.length - 1)]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    const normalX = -dy / length
    const normalY = dx / length
    const x = from.x + dx * withinSegment
    const y = from.y + dy * withinSegment
    const reach = scale.unit * (0.22 + crackleRandom(seed, tick, index + 41) * 0.5)
    const side = crackleRandom(seed, tick, index + 83) > 0.5 ? 1 : -1
    const skew = (crackleRandom(seed, tick, index + 127) - 0.5) * scale.unit * 0.5

    context.globalAlpha = rail.opacity * 0.55
    context.strokeStyle = rail.color
    context.lineWidth = Math.max(1, scale.unit * 0.05)
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(
      x + normalX * reach * side * 0.55 + (dx / length) * skew,
      y + normalY * reach * side * 0.55 + (dy / length) * skew,
    )
    context.lineTo(x + normalX * reach * side, y + normalY * reach * side)
    context.stroke()

  }
}

function drawRail(
  context: CanvasRenderingContext2D,
  rail: ResourceSnakeSceneRail,
  head: ResourceSnakeSceneCore | undefined,
  simulationMs: number,
  reducedMotion: boolean,
  scale: CanvasScale,
): void {
  if (rail.points.length < 1 || rail.opacity <= 0 || rail.dissolve >= 1) return

  // The trail dots are the hazard; drawing the ribbon that connects them is
  // the same wall, read as one continuous line instead of a bead necklace.
  // The head is appended so the line reaches the actor rather than stopping
  // a dot short of it.
  const path: Array<{ x: number; y: number }> = rail.points.map((point) => ({
    x: point.x * scale.x,
    y: point.y * scale.y,
  }))
  if (head && head.opacity > 0 && rail.dissolve <= 0) {
    path.push({ x: head.x * scale.x, y: head.y * scale.y })
  }

  // Light drains from the oldest end forward, so a killed actor's line goes
  // out the way it was laid down.
  let leading: { x: number; y: number } | null = null
  if (rail.dissolve > 0 && path.length > 1) {
    const drainedSpan = rail.dissolve * (path.length - 1)
    const wholePoints = Math.floor(drainedSpan)
    const withinSegment = drainedSpan - wholePoints
    const from = path[wholePoints]
    const to = path[Math.min(wholePoints + 1, path.length - 1)]
    leading = {
      x: from.x + (to.x - from.x) * withinSegment,
      y: from.y + (to.y - from.y) * withinSegment,
    }
    path.splice(0, wholePoints + 1, leading)
  }
  if (path.length < 1) return

  context.save()
  context.globalCompositeOperation = 'lighter'
  context.shadowBlur = 0
  context.lineCap = 'round'
  context.lineJoin = 'round'
  // Four additive passes: the widest is the bloom that makes the ribbon read
  // as a lit wall, the narrowest is the hot core down its middle.
  const bloomSize = Math.max(9, scale.unit * 1.05)
  const haloSize = Math.max(6, scale.unit * 0.62)
  const outerSize = Math.max(3.4, scale.unit * 0.36)
  const innerSize = Math.max(1.6, scale.unit * 0.15)
  context.strokeStyle = rail.color
  context.fillStyle = rail.color

  // Two passes, not four. The widest ones covered the most pixels for the
  // least visible gain, and additive blending over a long trail is paid per
  // pixel every frame.
  void bloomSize
  void outerSize
  const passes: Array<[number, number]> = [
    [haloSize, 0.2],
    [innerSize, 1],
  ]
  for (const [size, alphaScale] of passes) {
    context.globalAlpha = rail.opacity * alphaScale
    if (path.length === 1) {
      context.beginPath()
      context.arc(path[0].x, path[0].y, size / 2, 0, Math.PI * 2)
      context.fill()
      continue
    }
    context.lineWidth = size
    context.beginPath()
    context.moveTo(path[0].x, path[0].y)
    for (let index = 1; index < path.length; index += 1) {
      context.lineTo(path[index].x, path[index].y)
    }
    context.stroke()
  }

  if (!reducedMotion) {
    drawRailCurrent(context, path, rail, simulationMs, scale)
  }

  // The draining edge burns brighter for a moment before it is gone.
  if (leading) {
    const flare = Math.max(2.5, scale.unit * 0.5) * (1 - rail.dissolve * 0.5)
    const glow = context.createRadialGradient(
      leading.x, leading.y, 0, leading.x, leading.y, flare * 2.4,
    )
    glow.addColorStop(0, rgba(rail.color, rail.opacity * 0.9))
    glow.addColorStop(1, rgba(rail.color, 0))
    context.globalAlpha = 1
    context.fillStyle = glow
    context.beginPath()
    context.arc(leading.x, leading.y, flare * 2.4, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}

function drawTelegraph(
  context: CanvasRenderingContext2D,
  telegraph: ResourceSnakeSceneTelegraph,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
): void {
  if (telegraph.points.length < 2) return
  const urgency = 0.34 + telegraph.progress * 0.66
  context.save()
  context.globalCompositeOperation = 'lighter'
  context.shadowBlur = 0
  context.fillStyle = telegraph.color
  const spacing = 0.54
  const radius = Math.max(1.2, scale.unit * (0.07 + urgency * 0.035))
  const phase = telegraph.animated ? (scene.simulationMs * 0.0024) % 1 : 0
  for (let index = 1; index < telegraph.points.length; index += 1) {
    const start = telegraph.points[index - 1]
    const end = telegraph.points[index]
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const dots = Math.max(1, Math.ceil(length / spacing))
    for (let dot = 0; dot <= dots; dot += 1) {
      const progress = (dot + phase) / dots
      if (progress > 1) continue
      const x = (start.x + (end.x - start.x) * progress) * scale.x
      const y = (start.y + (end.y - start.y) * progress) * scale.y
      const dotAlpha = (0.22 + urgency * 0.42) * (dot % 2 === 0 ? 1 : 0.62)
      context.globalAlpha = dotAlpha * 0.16
      context.beginPath()
      context.arc(x, y, radius * 2.35, 0, Math.PI * 2)
      context.fill()
      context.globalAlpha = dotAlpha
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  const endpoint = telegraph.points[telegraph.points.length - 1]
  const x = endpoint.x * scale.x
  const y = endpoint.y * scale.y
  context.globalAlpha = (0.74 + urgency * 0.26) * 0.16
  context.beginPath()
  context.arc(x, y, radius * 3.15, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = 0.74 + urgency * 0.26
  context.beginPath()
  context.arc(x, y, radius * 1.85, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawCore(
  context: CanvasRenderingContext2D,
  core: ResourceSnakeSceneCore,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
): void {
  if (core.opacity <= 0) return
  const baseRadius = scale.unit * (core.shape === 'circle' ? 0.34 : 0.38)
  const spawnPulse = core.phase === 'spawning' && !scene.reducedMotion
    ? 0.88 + Math.sin(scene.simulationMs * 0.035) * 0.12
    : 1
  const radius = baseRadius * core.scale * spawnPulse
  context.save()
  context.translate(core.x * scale.x, core.y * scale.y)
  context.globalCompositeOperation = 'lighter'
  context.shadowBlur = 0
  context.fillStyle = core.color
  context.strokeStyle = core.color
  context.lineWidth = Math.max(1, scale.unit * 0.06)
  // A radial falloff rather than a flat block: a head that throws light reads
  // as the brightest thing on the field, which is what the eye tracks during a
  // round.
  const bloomRadius = radius * 3.4
  const bloom = context.createRadialGradient(0, 0, radius * 0.2, 0, 0, bloomRadius)
  bloom.addColorStop(0, rgba(core.color, core.opacity * 0.5))
  bloom.addColorStop(0.42, rgba(core.color, core.opacity * 0.16))
  bloom.addColorStop(1, rgba(core.color, 0))
  context.globalAlpha = 1
  context.fillStyle = bloom
  context.beginPath()
  context.arc(0, 0, bloomRadius, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = core.color
  context.globalAlpha = core.opacity * 0.12
  if (core.shape === 'circle') {
    context.beginPath()
    context.arc(0, 0, radius * 1.72, 0, Math.PI * 2)
    context.fill()
  } else {
    context.fillRect(-radius * 1.72, -radius * 1.72, radius * 3.44, radius * 3.44)
  }
  context.globalAlpha = core.opacity * 0.5
  if (core.shape === 'circle') {
    context.beginPath()
    context.arc(0, 0, radius, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  } else {
    context.fillRect(-radius, -radius, radius * 2, radius * 2)
    context.strokeRect(-radius, -radius, radius * 2, radius * 2)
  }

  const inset = radius * 0.44
  context.fillStyle = core.color
  context.globalAlpha = core.opacity * (0.7 + core.integrityRatio * 0.3)
  if (core.shape === 'circle') {
    context.beginPath()
    context.arc(0, 0, inset, 0, Math.PI * 2)
    context.fill()
  } else {
    context.fillRect(-inset, -inset, inset * 2, inset * 2)
  }
  context.restore()
}

/**
 * Motion made visible: short additive streaks trail each head opposite to its
 * travel, so speed reads from the head itself and upgrades feel like speed.
 * Direction comes from the actor's own trail, so nothing new is simulated.
 */
function drawHeadStreaks(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
): void {
  if (scene.reducedMotion) return
  context.save()
  context.globalCompositeOperation = 'lighter'
  context.lineCap = 'round'
  for (const core of scene.cores) {
    if (core.opacity <= 0) continue
    const rail = scene.rails.find((candidate) => candidate.actorId === core.id)
    const tail = rail?.points.at(-1)
    if (!tail) continue
    const headX = core.x * scale.x
    const headY = core.y * scale.y
    const dx = headX - tail.x * scale.x
    const dy = headY - tail.y * scale.y
    const length = Math.hypot(dx, dy)
    if (length < 0.5) continue
    const unitX = dx / length
    const unitY = dy / length
    const reach = scale.unit * 1.35
    context.strokeStyle = core.color
    for (const [side, alpha] of [[-1, 0.2], [0, 0.4], [1, 0.2]] as const) {
      const offsetX = -unitY * side * scale.unit * 0.16
      const offsetY = unitX * side * scale.unit * 0.16
      context.globalAlpha = core.opacity * alpha
      context.lineWidth = Math.max(1, scale.unit * (side === 0 ? 0.09 : 0.05))
      context.beginPath()
      context.moveTo(headX + offsetX - unitX * reach * 0.25, headY + offsetY - unitY * reach * 0.25)
      context.lineTo(headX + offsetX - unitX * reach, headY + offsetY - unitY * reach)
      context.stroke()
    }
  }
  context.restore()
}

function drawContacts(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
): void {
  for (const contact of scene.contacts) {
    const x = contact.x * scale.x
    const y = contact.y * scale.y
    const radius = scale.unit * (0.28 + contact.progress * 0.92)
    context.save()
    context.translate(x, y)
    context.rotate(contact.rotationRadians)
    context.globalAlpha = 1 - contact.progress
    context.strokeStyle = contact.color
    context.shadowColor = contact.color
    context.shadowBlur = scale.unit * 0.65
    context.lineWidth = Math.max(1.4, scale.unit * 0.075)
    for (let ring = 0; ring < 3; ring += 1) {
      context.beginPath()
      context.arc(0, 0, radius * (0.56 + ring * 0.22), -0.72, 0.72)
      context.stroke()
      context.rotate((Math.PI * 2) / 3)
    }

    // Sparks off the point of contact. Their angles come from the contact's own
    // rotation, so the same collision throws the same sparks on every replay.
    // They are brightest at the moment of impact and gone well before the arcs,
    // which is what makes a graze feel like metal rather than a fading ring.
    const sparkLife = Math.max(0, 1 - contact.progress / 0.55)
    if (sparkLife > 0) {
      context.globalCompositeOperation = 'lighter'
      context.globalAlpha = sparkLife
      context.shadowBlur = scale.unit * 0.3
      context.lineWidth = Math.max(1, scale.unit * 0.05)
      context.lineCap = 'round'
      for (let spark = 0; spark < 7; spark += 1) {
        const angle = contact.rotationRadians + spark * 2.399963229728653
        const reach = scale.unit * (0.34 + ((spark * 37) % 11) / 11 * 0.9)
        const near = reach * (0.3 + contact.progress * 0.9)
        const far = near + reach * (0.5 + sparkLife * 0.6)
        context.beginPath()
        context.moveTo(Math.cos(angle) * near, Math.sin(angle) * near)
        context.lineTo(Math.cos(angle) * far, Math.sin(angle) * far)
        context.stroke()
      }
    }
    context.restore()
  }
}

function drawPowerCuts(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
): void {
  for (const cut of scene.powerCuts) {
    const x = cut.x * scale.x
    const y = cut.y * scale.y
    const length = scale.unit * (0.65 + cut.progress * 0.75)
    context.save()
    context.translate(x, y)
    context.rotate(cut.angleRadians)
    context.globalAlpha = Math.max(0, 0.88 - cut.progress * 0.88)
    context.strokeStyle = cut.color
    context.shadowColor = cut.color
    context.shadowBlur = scale.unit * 0.42
    context.lineWidth = Math.max(1, scale.unit * 0.06)
    context.beginPath()
    context.moveTo(-length, 0)
    context.lineTo(-length * 0.4, -scale.unit * 0.26)
    context.lineTo(-length * 0.08, scale.unit * 0.2)
    context.lineTo(length * 0.34, -scale.unit * 0.22)
    context.lineTo(length, 0)
    context.stroke()
    context.restore()
  }
}

function drawExplosions(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
  width: number,
  height: number,
): void {
  for (const explosion of scene.explosions) {
    const x = explosion.x * scale.x
    const y = explosion.y * scale.y
    // Eased rather than linear: a shape growing at a constant rate reads as a
    // slide transition. The blast leaves fast and settles, which is what makes
    // it land as an impact.
    const eased = 1 - (1 - explosion.progress) ** 3

    // A death is a field event, not a local one: a single thin ring crosses
    // the whole arena so a kill on the far side still registers. It rides the
    // same progress as the blast, so replays draw the same wave.
    if (!scene.reducedMotion) {
      const reach = Math.hypot(width, height) * 0.72
      const waveRadius = scale.unit * 0.4 + eased * reach
      const waveFade = Math.max(0, 1 - explosion.progress) * 0.5
      if (waveFade > 0.01) {
        context.save()
        context.globalCompositeOperation = 'lighter'
        context.globalAlpha = waveFade
        context.strokeStyle = explosion.color
        context.lineWidth = Math.max(1, scale.unit * 0.1 * (1 - eased * 0.6))
        context.beginPath()
        context.arc(x, y, waveRadius, 0, Math.PI * 2)
        context.stroke()
        context.globalAlpha = waveFade * 0.4
        context.lineWidth = Math.max(2, scale.unit * 0.3)
        context.beginPath()
        context.arc(x, y, waveRadius * 0.94, 0, Math.PI * 2)
        context.stroke()
        context.restore()
      }
    }
    const radius = scale.unit * (0.3 + eased * 2.05)
    const fade = Math.max(0, 1 - explosion.progress)

    context.save()
    context.translate(x, y)
    context.globalCompositeOperation = 'lighter'

    // The bang: a white-hot core over the actor's color, gone within the first
    // third of the effect so the eye reads a flash and not a growing disc.
    const flashLife = Math.max(0, 1 - explosion.progress / 0.34)
    if (flashLife > 0) {
      const flashRadius = scale.unit * (0.9 + eased * 1.5)
      const flash = context.createRadialGradient(0, 0, 0, 0, 0, flashRadius)
      flash.addColorStop(0, `rgba(255, 255, 255, ${(flashLife * 0.9).toFixed(3)})`)
      flash.addColorStop(0.3, rgba(explosion.color, flashLife * 0.72))
      flash.addColorStop(1, rgba(explosion.color, 0))
      context.globalAlpha = 1
      context.fillStyle = flash
      context.beginPath()
      context.arc(0, 0, flashRadius, 0, Math.PI * 2)
      context.fill()
    }

    context.rotate(Math.PI / 4 + explosion.progress * 0.22)
    context.globalAlpha = fade
    context.strokeStyle = explosion.color
    context.shadowColor = explosion.color
    context.shadowBlur = scale.unit * 0.9
    // The shockwave thins as it expands instead of holding one weight.
    context.lineWidth = Math.max(1, scale.unit * 0.2 * (1 - eased * 0.78))
    tracePolygon(context, [
      { x: radius, y: 0 },
      { x: 0, y: radius },
      { x: -radius, y: 0 },
      { x: 0, y: -radius },
    ])
    context.stroke()
    for (let ray = 0; ray < 8; ray += 1) {
      context.rotate(Math.PI / 4)
      context.beginPath()
      context.moveTo(radius * 0.6, 0)
      context.lineTo(radius * (1.25 + fade * 0.5), 0)
      context.stroke()
    }
    context.restore()
  }

  for (const fragment of scene.fragments) {
    const travel = fragment.travel * fragment.progress * scale.unit
    const directionX = Math.cos(fragment.angleRadians)
    const directionY = Math.sin(fragment.angleRadians)
    const x = fragment.x * scale.x + directionX * travel
    const y = fragment.y * scale.y + directionY * travel
    const length = scale.unit * (0.16 + (1 - fragment.progress) * 0.34)
    context.save()
    context.globalAlpha = Math.max(0, 0.86 - fragment.progress * 0.86)
    context.strokeStyle = fragment.color
    context.shadowColor = fragment.color
    context.shadowBlur = scale.unit * 0.3
    context.lineWidth = Math.max(1, scale.unit * 0.055)
    context.beginPath()
    context.moveTo(x - directionX * length, y - directionY * length)
    context.lineTo(x + directionX * length, y + directionY * length)
    context.stroke()
    context.restore()
  }
}

/**
 * Paints the arena at rest for the idle phase. The combat loop does not run
 * while waiting, so without this the largest surface on screen stays pure
 * black and reads as a failed load rather than a field standing by.
 * Same ground and grid as live play, dimmed so the round start still lands.
 */
export function drawDormantResourceSnakeField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const scale = canvasScale(width, height)
  context.clearRect(0, 0, width, height)

  const wash = context.createLinearGradient(0, 0, 0, height)
  wash.addColorStop(0, RESOURCE_SNAKE_PALETTE.field)
  wash.addColorStop(0.52, RESOURCE_SNAKE_PALETTE.fieldDeep)
  wash.addColorStop(1, '#050c12')
  context.fillStyle = wash
  context.fillRect(0, 0, width, height)

  context.save()
  context.lineWidth = Math.max(0.5, scale.unit * 0.016)
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.grid, 0.55)
  for (let x = 2; x < RESOURCE_SNAKE_CONFIG.fieldWidth; x += 2) {
    context.beginPath()
    context.moveTo(x * scale.x, 0)
    context.lineTo(x * scale.x, height)
    context.stroke()
  }
  for (let y = 2; y < RESOURCE_SNAKE_CONFIG.fieldHeight; y += 2) {
    context.beginPath()
    context.moveTo(0, y * scale.y)
    context.lineTo(width, y * scale.y)
    context.stroke()
  }

  // A faint centre glow marks where the round begins.
  const focus = context.createRadialGradient(
    width / 2,
    height / 2,
    0,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.42,
  )
  focus.addColorStop(0, rgba(RESOURCE_SNAKE_PALETTE.grid, 0.3))
  focus.addColorStop(1, 'rgba(0, 0, 0, 0)')
  context.fillStyle = focus
  context.fillRect(0, 0, width, height)
  context.restore()

  context.globalAlpha = 1
  context.shadowBlur = 0
  context.setLineDash([])
}

const SURVEILLANCE_PURPLE = '#a06bff'

/**
 * The company's watchers: purple markers that patrol the arena's perimeter
 * once suspicion crosses the watch line. They are pure presentation — no
 * collision, no runtime state — and their position derives from the
 * simulation clock, so a replay shows the same patrol. Above the alarm line a
 * second watcher joins from the opposite corner and the sweep gets brighter,
 * which is the field itself telling the player how closely they are watched.
 */
// The fleeing bot mutters at the player: a small dark chip above its head,
// tinted with the bot's own category color. Pure presentation.
function drawSpeeches(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
  scale: CanvasScale,
): void {
  if (scene.speeches.length === 0) return
  const fontSize = Math.max(11, scale.unit * 0.42)
  context.save()
  context.font = `600 ${fontSize}px 'Pretendard', 'Malgun Gothic', sans-serif`
  context.textBaseline = 'middle'
  for (const speech of scene.speeches) {
    const fade = speech.progress > 0.72
      ? Math.max(0, 1 - (speech.progress - 0.72) / 0.28)
      : 1
    if (fade <= 0) continue
    const paddingX = fontSize * 0.6
    const chipHeight = fontSize * 1.9
    const textWidth = context.measureText(speech.text).width
    const chipWidth = textWidth + paddingX * 2
    let x = speech.x * scale.x - chipWidth / 2
    let y = speech.y * scale.y - scale.unit * 1.05 - chipHeight
    x = Math.min(Math.max(x, scale.unit * 0.4), width - chipWidth - scale.unit * 0.4)
    y = Math.min(Math.max(y, scale.unit * 0.4), height - chipHeight - scale.unit * 0.4)
    context.globalAlpha = 0.82 * fade
    context.fillStyle = 'rgba(4, 10, 16, 0.85)'
    context.strokeStyle = speech.color
    context.lineWidth = 1
    context.beginPath()
    const radius = chipHeight * 0.28
    context.roundRect(x, y, chipWidth, chipHeight, radius)
    context.fill()
    context.stroke()
    context.globalAlpha = fade
    context.fillStyle = '#dfe7ee'
    context.fillText(speech.text, x + paddingX, y + chipHeight / 2)
  }
  context.restore()
}

function drawSurveillance(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
  scale: CanvasScale,
): void {
  const surveillance = scene.surveillance
  if (!surveillance) return
  void width
  void height
  const glow = 0.42 + surveillance.intensity * 0.42

  // No beams, no sweep rings, no per-watcher gradients: the wind-up is read
  // off the body itself. Gradients allocate every frame and the lane covered
  // a third of the field in additive blending, which is exactly the kind of
  // cost that shows up as a dropped frame during a chase.
  context.save()
  context.globalCompositeOperation = 'lighter'
  context.strokeStyle = SURVEILLANCE_PURPLE
  context.fillStyle = SURVEILLANCE_PURPLE
  for (const watcher of surveillance.watchers) {
    const x = watcher.x * scale.x
    const y = watcher.y * scale.y
    const winding = watcher.phase === 'telegraph'
    // Winding up, it swells and burns brighter; that is the tell.
    const radius = scale.unit
      * (0.34 + surveillance.intensity * 0.12)
      * (winding ? 1 + watcher.phaseProgress * 0.85 : 1)
    const target = watcher.target
    const aim = target
      ? Math.atan2(target.y * scale.y - y, target.x * scale.x - x)
      : 0

    if (watcher.phase === 'charge') {
      const reach = scale.unit * 2.4
      context.globalAlpha = glow * 0.8
      context.lineWidth = Math.max(1.5, scale.unit * 0.2)
      context.beginPath()
      context.moveTo(x - Math.cos(aim) * reach, y - Math.sin(aim) * reach)
      context.lineTo(x, y)
      context.stroke()
    }

    context.globalAlpha = glow * (winding ? 0.55 + watcher.phaseProgress * 0.45 : 0.5)
    context.beginPath()
    context.arc(x, y, radius * 1.7, 0, Math.PI * 2)
    context.fill()

    context.globalAlpha = winding ? Math.min(1, glow * 1.6) : glow
    context.lineWidth = Math.max(1, scale.unit * 0.06)
    context.beginPath()
    context.moveTo(x, y - radius)
    context.lineTo(x + radius, y)
    context.lineTo(x, y + radius)
    context.lineTo(x - radius, y)
    context.closePath()
    context.stroke()
    context.globalAlpha = glow * 0.35 * watcher.integrityRatio
    context.fill()

    if (target) {
      context.globalAlpha = Math.min(1, glow * 1.5)
      context.beginPath()
      context.arc(
        x + Math.cos(aim) * radius * 0.35,
        y + Math.sin(aim) * radius * 0.35,
        Math.max(1.2, radius * 0.22),
        0,
        Math.PI * 2,
      )
      context.fill()
    }
  }
  context.restore()
}

// Drawn over the lit field rather than under it: the corners fall away so the
// action sits inside a room instead of on a flat plate, and the additive
// passes below stop building toward a uniformly grey rectangle at the edges.
function drawFieldVignette(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  context.save()
  context.globalCompositeOperation = 'source-over'
  context.globalAlpha = 1
  const radius = Math.hypot(width, height) * 0.5
  const vignette = context.createRadialGradient(
    width / 2, height / 2, radius * 0.42,
    width / 2, height / 2, radius,
  )
  vignette.addColorStop(0, 'rgba(2, 7, 12, 0)')
  vignette.addColorStop(0.7, 'rgba(2, 7, 12, 0.3)')
  vignette.addColorStop(1, 'rgba(2, 7, 12, 0.62)')
  context.fillStyle = vignette
  context.fillRect(0, 0, width, height)
  context.restore()
}

export function drawResourceSnakeScene(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
): void {
  const scale = canvasScale(width, height)
  drawIndustrialField(context, scene, width, height, scale)
  // Under the actors, not over them: the vignette is the room falling away at
  // its edges, and a light source inside that room should not be dimmed by it.
  drawFieldVignette(context, width, height)
  for (const edge of scene.dangerEdges) {
    drawDangerEdge(context, edge, scene, width, height, scale)
  }
  drawSpeeches(context, scene, width, height, scale)
  drawSurveillance(context, scene, width, height, scale)
  for (const rail of scene.rails) {
    drawRail(
      context,
      rail,
      scene.cores.find(({ id }) => id === rail.actorId),
      scene.simulationMs,
      scene.reducedMotion,
      scale,
    )
  }
  for (const telegraph of scene.telegraphs) drawTelegraph(context, telegraph, scene, scale)
  for (const core of scene.cores) drawCore(context, core, scene, scale)
  drawHeadStreaks(context, scene, scale)
  drawPowerCuts(context, scene, scale)
  drawContacts(context, scene, scale)
  drawExplosions(context, scene, scale, width, height)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.shadowBlur = 0
  context.setLineDash([])
}
