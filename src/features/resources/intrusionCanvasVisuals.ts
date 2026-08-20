import type { CompanyCategory } from '../../game/model'
import {
  INTRUSION_BASE_BOX,
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_RESOURCE_SIZE,
  type IntrusionFieldResource,
  type IntrusionPoint,
} from './resourceIntrusionRuntime'
import {
  RESOURCE_COMBAT_CONFIG,
  type ResourceCombatActor,
  type ResourceCombatCompression,
  type ResourceCombatTrailPoint,
} from './resourceCombatRuntime'

const RESOURCE_GLINT_CYCLE_MS = 3_200
const RESOURCE_GLINT_DURATION_MS = 220
const DEPOSIT_PULSE_DURATION_MS = 720

export const RESOURCE_COLORS: Record<CompanyCategory, string> = {
  reasoning: '#ff6b3d',
  memory: '#796cff',
  fluency: '#f3c96b',
}

const RESOURCE_GLOWS: Record<CompanyCategory, string> = {
  reasoning: 'rgba(255, 107, 61, 0.5)',
  memory: 'rgba(121, 108, 255, 0.5)',
  fluency: 'rgba(243, 201, 107, 0.5)',
}

export interface ResourceGlintPresentation {
  visible: boolean
  progress: number
  alpha: number
}

export interface DepositPulseLike {
  outcome: 'success' | 'interrogation' | 'rejected'
  startedAt: number
}

export interface DepositPulsePresentation {
  active: boolean
  positive: boolean
  intensity: number
}

export interface IntrusionResourceDrawOptions {
  blockId: string
  resource: IntrusionFieldResource
  position: IntrusionPoint
  cellSize: number
  elapsedMs: number
  verticalCompensation: number
  reducedMotion: boolean
  actor?: ResourceCombatActor
}

export interface ResourceCombatTrailDrawOptions {
  trail: readonly ResourceCombatTrailPoint[]
  compression: ResourceCombatCompression | null
  cellSize: number
  elapsedMs: number
  reducedMotion: boolean
}

export interface DepositStationDrawOptions {
  cellSize: number
  elapsedMs: number
  nowMs: number
  carrying: boolean
  pending: boolean
  pulse: DepositPulseLike | null
  reducedMotion: boolean
}

function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function getResourceGlint(
  blockId: string,
  elapsedMs: number,
  reducedMotion: boolean,
): ResourceGlintPresentation {
  const hash = hashString(`${blockId}|resource-glint`)
  if (reducedMotion) {
    const visible = hash % 11 === 0
    return {
      visible,
      progress: visible ? 0.48 : 0,
      alpha: visible ? 0.28 : 0,
    }
  }

  const phase = hash % RESOURCE_GLINT_CYCLE_MS
  const cycleTime = (
    (Math.max(0, elapsedMs) + phase) % RESOURCE_GLINT_CYCLE_MS
  )
  const visible = cycleTime < RESOURCE_GLINT_DURATION_MS
  if (!visible) return { visible: false, progress: 0, alpha: 0 }

  const progress = cycleTime / RESOURCE_GLINT_DURATION_MS
  return {
    visible: true,
    progress,
    alpha: Math.sin(progress * Math.PI) * 0.82,
  }
}

export function getDepositPulsePresentation(
  pulse: DepositPulseLike | null,
  nowMs: number,
  reducedMotion: boolean,
): DepositPulsePresentation {
  if (!pulse) return { active: false, positive: false, intensity: 0 }
  const age = nowMs - pulse.startedAt
  const duration = reducedMotion ? 320 : DEPOSIT_PULSE_DURATION_MS
  if (age < 0 || age >= duration) {
    return { active: false, positive: false, intensity: 0 }
  }

  const progress = age / duration
  const attack = reducedMotion ? 1 : Math.min(1, age / 110)
  return {
    active: true,
    positive: pulse.outcome === 'success',
    intensity: (reducedMotion ? 0.34 : attack) * (1 - progress),
  }
}

export function drawIntrusionResource(
  context: CanvasRenderingContext2D,
  {
    blockId,
    resource,
    position,
    cellSize,
    elapsedMs,
    verticalCompensation,
    reducedMotion,
    actor,
  }: IntrusionResourceDrawOptions,
): void {
  const actorSize = actor ? RESOURCE_COMBAT_CONFIG.actorSize : INTRUSION_RESOURCE_SIZE
  const centerX = (position.x + actorSize / 2) * cellSize
  const centerY = (position.y + actorSize / 2) * cellSize
  const halfWidth = cellSize * 0.72
  const halfHeight = cellSize * 0.84
  const color = RESOURCE_COLORS[resource.origin]
  const glint = getResourceGlint(blockId, elapsedMs, reducedMotion)
  const normal = resource.contribution === 'normal'
  const phase = actor?.phase ?? 'tracking'
  const direction = actor?.chargeDirection

  if (phase === 'telegraph' && direction) {
    const telegraphProgress = Math.min(
      1,
      Math.max(0, actor.phaseElapsedMs / Math.max(1, actor.phaseDurationMs)),
    )
    const pulse = reducedMotion
      ? 0.72
      : 0.5 + Math.sin(elapsedMs / 70) * 0.2
    const lineLength = cellSize * (7 + telegraphProgress * 5)
    context.save()
    context.globalAlpha = pulse
    context.strokeStyle = '#ff7148'
    context.shadowColor = '#ff5c35'
    context.shadowBlur = 10
    context.lineWidth = 1.25
    context.setLineDash([8, 7])
    context.lineDashOffset = reducedMotion ? 0 : -(elapsedMs / 42) % 15
    context.beginPath()
    context.moveTo(centerX, centerY)
    context.lineTo(
      centerX + direction.x * lineLength,
      centerY + direction.y * lineLength,
    )
    context.stroke()
    context.setLineDash([])
    context.restore()
  }

  context.save()
  context.translate(centerX, centerY)
  context.scale(1, verticalCompensation)
  if (direction) {
    context.rotate(Math.atan2(direction.y, direction.x) + Math.PI / 2)
  }
  context.globalAlpha = normal ? 0.96 : 0.44
  context.shadowColor = RESOURCE_GLOWS[resource.origin]
  context.shadowBlur = phase === 'charging' ? 15 : normal ? 9 : 2

  if (phase === 'salvage') {
    const side = cellSize * 0.72
    const shell = context.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2)
    shell.addColorStop(0, 'rgba(255, 255, 255, 0.88)')
    shell.addColorStop(0.22, `${color}d6`)
    shell.addColorStop(0.72, `${color}72`)
    shell.addColorStop(1, 'rgba(5, 7, 12, 0.98)')
    context.fillStyle = shell
    context.strokeStyle = 'rgba(247, 249, 252, 0.92)'
    context.lineWidth = 1
    context.fillRect(-side / 2, -side / 2, side, side)
    context.strokeRect(-side / 2, -side / 2, side, side)
    context.shadowBlur = 0
    context.globalAlpha = 0.74
    context.strokeStyle = color
    context.beginPath()
    context.moveTo(-side * 0.28, -side * 0.08)
    context.lineTo(side * 0.28, -side * 0.08)
    context.moveTo(-side * 0.28, side * 0.12)
    context.lineTo(side * 0.12, side * 0.12)
    context.stroke()
    if (glint.visible) {
      context.globalAlpha = glint.alpha
      context.strokeStyle = '#ffffff'
      context.beginPath()
      context.moveTo(-side * 0.4, -side * 0.32)
      context.lineTo(side * 0.34, side * 0.4)
      context.stroke()
    }
    context.restore()
    return
  }

  const shell = context.createLinearGradient(
    -halfWidth,
    -halfHeight,
    halfWidth,
    halfHeight,
  )
  shell.addColorStop(0, 'rgba(255, 255, 255, 0.92)')
  shell.addColorStop(0.18, `${color}c4`)
  shell.addColorStop(0.62, `${color}54`)
  shell.addColorStop(1, 'rgba(5, 7, 12, 0.96)')
  context.fillStyle = shell
  context.strokeStyle = 'rgba(238, 241, 247, 0.88)'
  context.lineWidth = 0.85
  context.lineJoin = 'round'
  context.beginPath()
  context.moveTo(0, -halfHeight)
  context.lineTo(halfWidth, halfHeight * 0.78)
  context.lineTo(0, halfHeight * 0.46)
  context.lineTo(-halfWidth, halfHeight * 0.78)
  context.closePath()
  context.fill()
  context.stroke()

  context.shadowBlur = 0
  context.globalAlpha = normal ? 0.58 : 0.25
  context.fillStyle = 'rgba(7, 9, 15, 0.58)'
  context.strokeStyle = `${color}dc`
  context.lineWidth = 0.65
  context.beginPath()
  context.moveTo(0, -halfHeight * 0.62)
  context.lineTo(halfWidth * 0.54, halfHeight * 0.5)
  context.lineTo(0, halfHeight * 0.28)
  context.lineTo(-halfWidth * 0.54, halfHeight * 0.5)
  context.closePath()
  context.fill()
  context.stroke()

  context.globalAlpha = normal ? 0.88 : 0.42
  context.strokeStyle = 'rgba(245, 248, 252, 0.82)'
  context.lineWidth = 0.85
  context.beginPath()
  context.moveTo(-halfWidth * 0.32, halfHeight * 0.38)
  context.lineTo(0, -halfHeight * 0.38)
  context.lineTo(halfWidth * 0.32, halfHeight * 0.38)
  context.stroke()

  if (actor) {
    context.globalAlpha = 0.66
    context.strokeStyle = actor.health > 1 ? '#ffffff' : '#ff8c6a'
    context.lineWidth = 1.6
    context.beginPath()
    context.moveTo(-halfWidth * 0.34, halfHeight * 0.92)
    context.lineTo(
      actor.health > 1 ? halfWidth * 0.34 : 0,
      halfHeight * 0.92,
    )
    context.stroke()
  }

  if (glint.visible) {
    const glintX = -halfWidth + glint.progress * halfWidth * 2
    context.globalAlpha = glint.alpha
    context.strokeStyle = '#ffffff'
    context.shadowColor = '#ffffff'
    context.shadowBlur = 6
    context.lineWidth = 1.05
    context.beginPath()
    context.moveTo(glintX - 2.8, -halfHeight * 0.72)
    context.lineTo(glintX + 2.2, halfHeight * 0.58)
    context.stroke()
  }

  context.restore()
}

export function drawResourceCombatTrail(
  context: CanvasRenderingContext2D,
  {
    trail,
    compression,
    cellSize,
    elapsedMs,
    reducedMotion,
  }: ResourceCombatTrailDrawOptions,
): void {
  if (trail.length > 1) {
    const first = trail[0]
    const last = trail[trail.length - 1]
    const gradient = context.createLinearGradient(
      first.x * cellSize,
      first.y * cellSize,
      last.x * cellSize,
      last.y * cellSize,
    )
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.06)')
    gradient.addColorStop(0.62, 'rgba(238, 242, 248, 0.58)')
    gradient.addColorStop(1, 'rgba(255, 122, 72, 0.98)')
    context.save()
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(first.x * cellSize, first.y * cellSize)
    for (const point of trail.slice(1)) {
      context.lineTo(point.x * cellSize, point.y * cellSize)
    }
    context.strokeStyle = 'rgba(255, 107, 61, 0.22)'
    context.shadowColor = '#ff6b3d'
    context.shadowBlur = reducedMotion ? 5 : 14
    context.lineWidth = 8
    context.stroke()
    context.shadowBlur = 0
    context.strokeStyle = gradient
    context.lineWidth = 2.2
    context.stroke()
    context.restore()
  }

  if (!compression || compression.polygon.length < 3) return
  const age = Math.max(0, elapsedMs - compression.startedAtMs)
  const progress = Math.min(
    1,
    age / RESOURCE_COMBAT_CONFIG.compressionVisibleMs,
  )
  const alpha = reducedMotion ? 0.26 : Math.sin(progress * Math.PI) * 0.5
  const first = compression.polygon[0]
  context.save()
  context.beginPath()
  context.moveTo(first.x * cellSize, first.y * cellSize)
  for (const point of compression.polygon.slice(1)) {
    context.lineTo(point.x * cellSize, point.y * cellSize)
  }
  context.closePath()
  context.globalAlpha = Math.max(0.08, alpha)
  context.fillStyle = compression.hitBlockIds.length > 0
    ? 'rgba(255, 102, 58, 0.24)'
    : 'rgba(230, 235, 241, 0.12)'
  context.fill()
  context.globalAlpha = Math.max(0.18, alpha + 0.14)
  context.strokeStyle = '#f7f8fa'
  context.shadowColor = '#ff6b3d'
  context.shadowBlur = reducedMotion ? 4 : 18 * (1 - progress)
  context.lineWidth = 3 - progress * 1.4
  context.stroke()
  context.restore()
}

export function drawDeploymentPad(
  context: CanvasRenderingContext2D,
  cellSize: number,
  elapsedMs: number,
  reducedMotion: boolean,
) {
  const x = INTRUSION_BASE_BOX.x * cellSize
  const y = INTRUSION_BASE_BOX.y * cellSize
  const width = INTRUSION_BASE_BOX.width * cellSize
  const height = INTRUSION_BASE_BOX.height * cellSize
  const centerX = x + width / 2
  const centerY = y + height / 2

  context.save()
  const baseSurface = context.createLinearGradient(x, y, x, y + height)
  baseSurface.addColorStop(0, 'rgba(29, 34, 39, 0.99)')
  baseSurface.addColorStop(1, 'rgba(3, 5, 8, 1)')
  context.fillStyle = baseSurface
  context.strokeStyle = 'rgba(191, 200, 208, 0.82)'
  context.lineWidth = 1.35
  context.beginPath()
  context.roundRect(x + 1, y + 1, width - 2, height - 2, 7)
  context.fill()
  context.stroke()

  context.strokeStyle = 'rgba(242, 189, 84, 0.58)'
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(x + 10, y + 7)
  context.lineTo(x + width - 10, y + 7)
  context.stroke()

  context.translate(centerX, centerY)
  context.setLineDash([4, 5])
  context.lineDashOffset = reducedMotion ? 0 : -(elapsedMs / 180) % 9
  context.strokeStyle = 'rgba(204, 214, 222, 0.46)'
  context.beginPath()
  context.ellipse(0, 0, width * 0.17, height * 0.28, 0, 0, Math.PI * 2)
  context.stroke()
  context.setLineDash([])

  context.strokeStyle = 'rgba(199, 208, 216, 0.5)'
  context.lineWidth = 1
  for (const rotation of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    context.save()
    context.rotate(rotation)
    context.beginPath()
    context.moveTo(-4, -height * 0.34)
    context.lineTo(0, -height * 0.22)
    context.lineTo(4, -height * 0.34)
    context.stroke()
    context.restore()
  }
  context.restore()
}

export function drawDepositStation(
  context: CanvasRenderingContext2D,
  {
    cellSize,
    elapsedMs,
    nowMs,
    carrying,
    pending,
    pulse,
    reducedMotion,
  }: DepositStationDrawOptions,
) {
  const x = INTRUSION_DEPOSIT_BOX.x * cellSize
  const y = INTRUSION_DEPOSIT_BOX.y * cellSize
  const width = INTRUSION_DEPOSIT_BOX.width * cellSize
  const height = INTRUSION_DEPOSIT_BOX.height * cellSize
  const centerX = x + width / 2
  const centerY = y + height / 2
  const pulsePresentation = getDepositPulsePresentation(
    pulse,
    nowMs,
    reducedMotion,
  )
  const outcomeColor = pulse?.outcome === 'success'
    ? '#f2bd54'
    : pulse?.outcome === 'interrogation'
      ? '#f04420'
      : '#7f8b88'
  const ready = carrying || pending
  const readyPulse = reducedMotion
    ? 0.4
    : 0.32 + Math.sin(elapsedMs / 150) * 0.12

  context.save()
  context.fillStyle = ready
    ? `rgba(205, 214, 222, ${0.035 + readyPulse * 0.04})`
    : 'rgba(205, 214, 222, 0.025)'
  context.strokeStyle = ready
    ? `rgba(224, 231, 237, ${0.34 + readyPulse * 0.3})`
    : 'rgba(190, 201, 210, 0.24)'
  context.lineWidth = ready ? 1.4 : 1
  context.beginPath()
  context.roundRect(x + 1, y + 1, width - 2, height - 2, 18)
  context.fill()
  context.stroke()

  context.strokeStyle = ready
    ? `rgba(242, 189, 84, ${0.32 + readyPulse * 0.45})`
    : 'rgba(201, 211, 220, 0.18)'
  context.lineWidth = 1
  for (const scale of [0.74, 0.48]) {
    context.beginPath()
    context.ellipse(
      centerX,
      centerY,
      width * scale * 0.5,
      height * scale * 0.5,
      0,
      Math.PI,
      Math.PI * 2,
    )
    context.stroke()
  }

  if (pulsePresentation.active) {
    context.globalAlpha = pulsePresentation.intensity
    context.strokeStyle = outcomeColor
    context.shadowColor = outcomeColor
    context.shadowBlur = pulsePresentation.positive ? 18 : 8
    context.lineWidth = pulsePresentation.positive ? 3 : 2
    context.beginPath()
    context.roundRect(x - 2, y - 2, width + 4, height + 4, 20)
    context.stroke()
  }
  context.restore()
}
