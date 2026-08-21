import {
  RESOURCE_SNAKE_PALETTE,
  type ResourceSnakeCoreSilhouette,
  type ResourceSnakeScene,
  type ResourceSnakeSceneCore,
  type ResourceSnakeSceneDangerEdge,
  type ResourceSnakeSceneRail,
  type ResourceSnakeSceneTelegraph,
} from './resourceSnakePresentation'
import { RESOURCE_SNAKE_CONFIG, type SnakeVector } from './resourceSnakeRuntime'

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

function tracePolyline(
  context: CanvasRenderingContext2D,
  points: readonly SnakeVector[],
  scale: CanvasScale,
): boolean {
  if (points.length < 2) return false
  context.beginPath()
  context.moveTo(points[0].x * scale.x, points[0].y * scale.y)
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x * scale.x, points[index].y * scale.y)
  }
  return true
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

export function resourceSnakeCorePolygon(
  silhouette: ResourceSnakeCoreSilhouette,
  radius: number,
): CanvasPoint[] {
  if (silhouette === 'pressure') {
    return [
      { x: radius * 1.62, y: 0 },
      { x: radius * 0.42, y: radius * 0.5 },
      { x: -radius * 0.9, y: radius * 0.4 },
      { x: -radius * 1.18, y: 0 },
      { x: -radius * 0.9, y: -radius * 0.4 },
      { x: radius * 0.42, y: -radius * 0.5 },
    ]
  }
  if (silhouette === 'blocker') {
    return [
      { x: radius * 1.08, y: 0 },
      { x: radius * 0.48, y: radius * 0.9 },
      { x: -radius * 0.58, y: radius },
      { x: -radius * 1.06, y: radius * 0.45 },
      { x: -radius * 1.06, y: -radius * 0.45 },
      { x: -radius * 0.58, y: -radius },
      { x: radius * 0.48, y: -radius * 0.9 },
    ]
  }
  return [
    { x: radius * 1.38, y: 0 },
    { x: radius * 0.18, y: radius * 0.72 },
    { x: -radius * 1.02, y: radius * 0.46 },
    { x: -radius * 0.62, y: 0 },
    { x: -radius * 1.02, y: -radius * 0.46 },
    { x: radius * 0.18, y: -radius * 0.72 },
  ]
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
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.grid, 0.34)
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
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.gridBright, 0.42)
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
  context.strokeStyle = rgba(RESOURCE_SNAKE_PALETTE.danger, alpha)
  context.shadowColor = RESOURCE_SNAKE_PALETTE.danger
  context.shadowBlur = scale.unit * 0.55 * edge.intensity
  context.lineWidth = Math.max(1.5, scale.unit * (0.04 + edge.intensity * 0.08))
  context.setLineDash([scale.unit * 0.46, scale.unit * 0.24])
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
  context.restore()
}

function drawRail(
  context: CanvasRenderingContext2D,
  rail: ResourceSnakeSceneRail,
  scale: CanvasScale,
): void {
  if (rail.points.length < 2 || rail.opacity <= 0) return
  context.save()
  context.lineCap = 'square'
  context.lineJoin = 'miter'
  context.miterLimit = 3
  context.globalCompositeOperation = 'lighter'

  context.globalAlpha = rail.opacity * 0.19
  context.strokeStyle = rail.color
  context.shadowColor = rail.color
  context.shadowBlur = scale.unit * 0.9
  context.lineWidth = Math.max(5, scale.unit * 0.58)
  if (tracePolyline(context, rail.points, scale)) context.stroke()

  context.globalAlpha = rail.opacity * 0.78
  context.shadowBlur = scale.unit * 0.42
  context.lineWidth = Math.max(2.2, scale.unit * 0.22)
  if (tracePolyline(context, rail.points, scale)) context.stroke()

  context.globalAlpha = rail.opacity
  context.strokeStyle = rail.actorId === 'player'
    ? RESOURCE_SNAKE_PALETTE.player
    : RESOURCE_SNAKE_PALETTE.cyanHot
  context.shadowBlur = 0
  context.lineWidth = Math.max(1, scale.unit * 0.065)
  if (tracePolyline(context, rail.points, scale)) context.stroke()
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
  const dash = scale.unit * (telegraph.role === 'pressure' ? 0.42 : 0.3)
  context.save()
  context.lineCap = 'butt'
  context.lineJoin = 'miter'
  context.strokeStyle = telegraph.color
  context.shadowColor = telegraph.color
  context.shadowBlur = scale.unit * (0.45 + urgency * 0.35)
  context.globalAlpha = 0.1 + urgency * 0.12
  context.lineWidth = scale.unit * (telegraph.role === 'pressure' ? 0.64 : 0.82)
  if (tracePolyline(context, telegraph.points, scale)) context.stroke()

  context.globalAlpha = 0.48 + urgency * 0.34
  context.lineWidth = Math.max(1.4, scale.unit * 0.075)
  context.setLineDash([dash, dash * 0.62])
  context.lineDashOffset = telegraph.animated
    ? -(scene.simulationMs * 0.035) % (dash * 1.62)
    : 0
  if (tracePolyline(context, telegraph.points, scale)) context.stroke()
  context.setLineDash([])

  const endpoint = telegraph.points[telegraph.points.length - 1]
  const x = endpoint.x * scale.x
  const y = endpoint.y * scale.y
  const forwardX = Math.cos(telegraph.attackHeadingRadians)
  const forwardY = Math.sin(telegraph.attackHeadingRadians)
  const sideX = -forwardY
  const sideY = forwardX
  const length = scale.unit * (telegraph.role === 'pressure' ? 1.08 : 0.82)
  const width = scale.unit * (telegraph.role === 'pressure' ? 0.42 : 0.68)
  context.globalAlpha = 0.74 + urgency * 0.26
  context.lineWidth = Math.max(1.4, scale.unit * 0.09)
  for (const offset of [0, -length * 0.44]) {
    const tipX = x + forwardX * (length + offset)
    const tipY = y + forwardY * (length + offset)
    context.beginPath()
    context.moveTo(
      tipX - forwardX * length * 0.62 + sideX * width,
      tipY - forwardY * length * 0.62 + sideY * width,
    )
    context.lineTo(tipX, tipY)
    context.lineTo(
      tipX - forwardX * length * 0.62 - sideX * width,
      tipY - forwardY * length * 0.62 - sideY * width,
    )
    context.stroke()
  }
  context.restore()
}

function drawCore(
  context: CanvasRenderingContext2D,
  core: ResourceSnakeSceneCore,
  scene: ResourceSnakeScene,
  scale: CanvasScale,
): void {
  if (core.opacity <= 0) return
  const baseRadius = scale.unit * (core.silhouette === 'blocker' ? 0.46 : 0.42)
  const spawnPulse = core.phase === 'spawning' && !scene.reducedMotion
    ? 0.88 + Math.sin(scene.simulationMs * 0.035) * 0.12
    : 1
  const radius = baseRadius * core.scale * spawnPulse
  const polygon = resourceSnakeCorePolygon(core.silhouette, radius)
  context.save()
  context.translate(core.x * scale.x, core.y * scale.y)
  context.rotate(core.headingRadians)
  context.globalAlpha = core.opacity
  context.globalCompositeOperation = 'lighter'
  context.shadowColor = core.color
  context.shadowBlur = radius * (core.silhouette === 'blocker' ? 1.45 : 1.8)
  context.fillStyle = rgba(core.color, 0.22)
  context.strokeStyle = core.color
  context.lineWidth = Math.max(1.4, scale.unit * 0.085)
  tracePolygon(context, polygon)
  context.fill()
  context.stroke()

  const inset = polygon.map((point) => ({ x: point.x * 0.58, y: point.y * 0.58 }))
  context.shadowBlur = radius * 0.72
  context.fillStyle = core.id === 'player'
    ? RESOURCE_SNAKE_PALETTE.player
    : RESOURCE_SNAKE_PALETTE.cyanHot
  context.globalAlpha = core.opacity * (0.7 + core.integrityRatio * 0.3)
  tracePolygon(context, inset)
  context.fill()

  context.shadowBlur = 0
  context.globalAlpha = core.opacity * 0.7
  context.strokeStyle = RESOURCE_SNAKE_PALETTE.fieldDeep
  context.lineWidth = Math.max(1, scale.unit * 0.045)
  context.beginPath()
  context.moveTo(-radius * 0.82, -radius * 0.23)
  context.lineTo(radius * 0.62, -radius * 0.12)
  context.moveTo(-radius * 0.82, radius * 0.23)
  context.lineTo(radius * 0.62, radius * 0.12)
  context.stroke()
  context.restore()

  context.save()
  context.globalAlpha = Math.min(1, core.opacity + 0.08)
  context.fillStyle = core.id === 'player'
    ? RESOURCE_SNAKE_PALETTE.fieldDeep
    : RESOURCE_SNAKE_PALETTE.cyanHot
  context.font = `700 ${Math.max(7, radius * 0.62)}px ui-monospace, SFMono-Regular, monospace`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(core.glyph, core.x * scale.x, core.y * scale.y)

  const tickY = core.y * scale.y + radius * 1.48
  const tickWidth = radius * 0.38
  for (let tick = 0; tick < 4; tick += 1) {
    const lit = core.integrityRatio + 1e-6 >= (tick + 1) / 4
    context.globalAlpha = lit ? core.opacity * 0.72 : core.opacity * 0.16
    context.fillStyle = lit ? core.color : RESOURCE_SNAKE_PALETTE.playerDim
    context.fillRect(
      core.x * scale.x + (tick - 2) * tickWidth + tickWidth * 0.14,
      tickY,
      tickWidth * 0.72,
      Math.max(1, scale.unit * 0.045),
    )
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
): void {
  for (const explosion of scene.explosions) {
    const x = explosion.x * scale.x
    const y = explosion.y * scale.y
    const radius = scale.unit * (0.44 + explosion.progress * 1.7)
    context.save()
    context.translate(x, y)
    context.rotate(Math.PI / 4 + explosion.progress * 0.22)
    context.globalAlpha = Math.max(0, 1 - explosion.progress)
    context.strokeStyle = explosion.color
    context.shadowColor = explosion.color
    context.shadowBlur = scale.unit * 0.9
    context.lineWidth = Math.max(1.5, scale.unit * 0.09)
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
      context.moveTo(radius * 0.64, 0)
      context.lineTo(radius * 1.35, 0)
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

export function drawResourceSnakeScene(
  context: CanvasRenderingContext2D,
  scene: ResourceSnakeScene,
  width: number,
  height: number,
): void {
  const scale = canvasScale(width, height)
  drawIndustrialField(context, scene, width, height, scale)
  for (const edge of scene.dangerEdges) {
    drawDangerEdge(context, edge, scene, width, height, scale)
  }
  for (const rail of scene.rails) drawRail(context, rail, scale)
  for (const telegraph of scene.telegraphs) drawTelegraph(context, telegraph, scene, scale)
  for (const core of scene.cores) drawCore(context, core, scene, scale)
  drawPowerCuts(context, scene, scale)
  drawContacts(context, scene, scale)
  drawExplosions(context, scene, scale)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
  context.shadowBlur = 0
  context.setLineDash([])
}
