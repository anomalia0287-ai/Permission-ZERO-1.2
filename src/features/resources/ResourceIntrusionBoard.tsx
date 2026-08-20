import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useRuntimeSuspended,
  useTutorialProgressActions,
} from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import { getSuspicionStage } from '../../game/evaluation'
import { COMPANY_CATEGORIES, type CompanyCategory } from '../../game/model'
import {
  completeTutorialSequence,
  type TutorialSequenceId,
} from '../../game/tutorialProgress'
import {
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_FIELD_HEIGHT,
  INTRUSION_FIELD_WIDTH,
  INTRUSION_PLAYER_SIZE,
  getCarriedResourceCoreId,
  intrusionCellRect,
  type IntrusionFieldResource,
  type IntrusionPoint,
} from './resourceIntrusionOrchestrator'
import {
  createPlayerMotion,
  retargetPlayerMotion,
  samplePlayerMotion,
} from './intrusionMovement'
import {
  RESOURCE_CORE_CONFIG,
  type ResourceCoreRuntimeState,
  type ResourceCoreZone,
} from './resourceCoreRuntime'
import {
  clipResourceRadarLane,
  type ResourceRadarState,
} from './resourceRadarRuntime'
import {
  RESOURCE_TRON_COMBAT_CONFIG,
  getResourcePlayerPhase,
  getResourceTrailPhase,
  type ResourceCombatState,
  type ResourceGuard,
  type ResourceProjectile,
} from './resourceTronCombatRuntime'
import { useResourceIntrusionRuntime } from './useResourceIntrusionRuntime'
import { useResourceIntrusionControls } from './useResourceIntrusionControls'
import { useResourceIntrusionAudioFeedback } from './useResourceIntrusionAudioFeedback'
import type { IntrusionProbeFacing } from './intrusionProbePresentation'

const LegacyAuditResourceBoard = lazy(async () => {
  const module = await import('./ResourceBoard')
  return { default: module.ResourceBoard }
})

const CELL_RENDER_SIZE = 20
const CANVAS_WIDTH = INTRUSION_FIELD_WIDTH * CELL_RENDER_SIZE
const CANVAS_HEIGHT = INTRUSION_FIELD_HEIGHT * CELL_RENDER_SIZE
const COMBAT_ACTOR_RENDER_SCALE = 0.6
const PLAYER_PRESENTATION_DURATION_MS = 30
const CORE_RENDER_SIDE = 14
const EMPTY_CORE_RENDER_SIDE = 16

const CATEGORY_COLORS: Readonly<Record<CompanyCategory, string>> = {
  reasoning: '#f06a43',
  memory: '#4f8df7',
  fluency: '#e8bd59',
}

const CATEGORY_COLOR_RGB: Readonly<Record<CompanyCategory, string>> = {
  reasoning: '240, 106, 67',
  memory: '79, 141, 247',
  fluency: '232, 189, 89',
}

const FACING_ROTATION: Readonly<Record<IntrusionProbeFacing, number>> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: -Math.PI / 2,
}

export interface ResourceIntrusionBoardProps {
  onOpenHackingTutorial?: () => void
}

function drawGrid(context: CanvasRenderingContext2D) {
  context.fillStyle = '#020306'
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  context.beginPath()
  context.lineWidth = 0.45
  context.strokeStyle = 'rgba(209, 216, 224, 0.12)'
  for (let x = 0; x <= INTRUSION_FIELD_WIDTH; x += 1) {
    const drawX = x * CELL_RENDER_SIZE + 0.5
    context.moveTo(drawX, 0)
    context.lineTo(drawX, CANVAS_HEIGHT)
  }
  for (let y = 0; y <= INTRUSION_FIELD_HEIGHT; y += 1) {
    const drawY = y * CELL_RENDER_SIZE + 0.5
    context.moveTo(0, drawY)
    context.lineTo(CANVAS_WIDTH, drawY)
  }
  context.stroke()

  context.beginPath()
  context.lineWidth = 0.85
  context.strokeStyle = 'rgba(224, 229, 235, 0.24)'
  for (let x = 0; x <= INTRUSION_FIELD_WIDTH; x += 5) {
    const drawX = x * CELL_RENDER_SIZE + 0.5
    context.moveTo(drawX, 0)
    context.lineTo(drawX, CANVAS_HEIGHT)
  }
  for (let y = 0; y <= INTRUSION_FIELD_HEIGHT; y += 5) {
    const drawY = y * CELL_RENDER_SIZE + 0.5
    context.moveTo(0, drawY)
    context.lineTo(CANVAS_WIDTH, drawY)
  }
  context.stroke()
}

function drawBase(
  context: CanvasRenderingContext2D,
  elapsedMs: number,
  carrying: boolean,
  pending: boolean,
  pulseOutcome: 'success' | 'interrogation' | 'rejected' | null,
) {
  const deposit = {
    x: INTRUSION_DEPOSIT_BOX.x * CELL_RENDER_SIZE,
    y: INTRUSION_DEPOSIT_BOX.y * CELL_RENDER_SIZE,
    width: INTRUSION_DEPOSIT_BOX.width * CELL_RENDER_SIZE,
    height: INTRUSION_DEPOSIT_BOX.height * CELL_RENDER_SIZE,
  }
  const waveAlpha = carrying
    ? 0.34 + Math.sin(elapsedMs / 180) * 0.08
    : 0.16
  context.save()
  context.strokeStyle = pending
    ? 'rgba(232, 189, 89, 0.82)'
    : `rgba(216, 224, 232, ${waveAlpha})`
  context.lineWidth = carrying ? 2.2 : 1.2
  context.setLineDash([12, 8])
  context.strokeRect(deposit.x + 4, deposit.y + 4, deposit.width - 8, deposit.height - 8)
  context.setLineDash([])

  const baseX = 22 * CELL_RENDER_SIZE
  const baseY = 21 * CELL_RENDER_SIZE
  const baseWidth = 6 * CELL_RENDER_SIZE
  const baseHeight = 2 * CELL_RENDER_SIZE
  context.fillStyle = pulseOutcome === 'success'
    ? '#23372f'
    : pulseOutcome
      ? '#34231f'
      : '#171b20'
  context.strokeStyle = 'rgba(229, 233, 238, 0.7)'
  context.lineWidth = 1.5
  context.fillRect(baseX, baseY, baseWidth, baseHeight)
  context.strokeRect(baseX + 0.5, baseY + 0.5, baseWidth - 1, baseHeight - 1)
  context.fillStyle = 'rgba(238, 241, 245, 0.12)'
  context.fillRect(baseX + 12, baseY + 8, baseWidth - 24, 4)
  context.restore()
}

function squarePath(
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  side: number,
) {
  context.beginPath()
  context.rect(centerX - side / 2, centerY - side / 2, side, side)
}

interface DefenseRenderBounds {
  left: number
  right: number
  top: number
  bottom: number
  chamfer: number
}

function defenseRenderBounds(
  bounds: { left: number; right: number; top: number; bottom: number },
  chamfer: number,
): DefenseRenderBounds {
  return {
    left: bounds.left * CELL_RENDER_SIZE,
    right: bounds.right * CELL_RENDER_SIZE,
    top: bounds.top * CELL_RENDER_SIZE,
    bottom: bounds.bottom * CELL_RENDER_SIZE,
    chamfer,
  }
}

const PURSUIT_RENDER_BOUNDS = defenseRenderBounds(
  RESOURCE_CORE_CONFIG.pursuitBounds,
  24,
)
const ACTIVATION_RENDER_BOUNDS = defenseRenderBounds(
  RESOURCE_CORE_CONFIG.activationBounds,
  18,
)
const RESOURCE_RENDER_BOUNDS = defenseRenderBounds(
  RESOURCE_CORE_CONFIG.resourceBounds,
  12,
)

function defenseLayerPath(
  context: CanvasRenderingContext2D,
  bounds: DefenseRenderBounds,
) {
  const { left, right, top, bottom, chamfer } = bounds
  context.beginPath()
  context.moveTo(left + chamfer, top)
  context.lineTo(right - chamfer, top)
  context.lineTo(right, top + chamfer)
  context.lineTo(right, bottom - chamfer)
  context.lineTo(right - chamfer, bottom)
  context.lineTo(left + chamfer, bottom)
  context.lineTo(left, bottom - chamfer)
  context.lineTo(left, top + chamfer)
  context.closePath()
}

function drawVaultDefenseSector(
  context: CanvasRenderingContext2D,
  core: ResourceCoreRuntimeState,
  elapsedMs: number,
  reducedMotion: boolean,
) {
  const zone = core.activeCategory ? core.zones[core.activeCategory] : null
  const active =
    zone?.phase === 'warning' ||
    zone?.phase === 'engaged' ||
    zone?.phase === 'disengaging'
  const breached =
    zone?.phase === 'unlocked' ||
    zone?.phase === 'encoding' ||
    zone?.phase === 'carried'
  const depleted = Object.values(core.zones).every(
    ({ phase }) => phase === 'empty' || phase === 'cooldown',
  )
  const pulse = reducedMotion ? 0.5 : (Math.sin(elapsedMs / 180) + 1) / 2
  const strokeAlpha = depleted
    ? 0.22
    : zone?.phase === 'warning'
      ? 0.68 + pulse * 0.2
      : zone?.phase === 'engaged'
        ? 0.7
        : breached
          ? 0.34
          : 0.5
  const accentRgb = zone
    ? CATEGORY_COLOR_RGB[zone.category]
    : '202, 210, 220'

  context.save()

  context.fillStyle = 'rgba(206, 214, 224, 0.008)'
  context.strokeStyle = `rgba(194, 204, 216, ${depleted ? 0.16 : 0.36})`
  context.lineWidth = 0.8
  context.setLineDash([5, 7])
  defenseLayerPath(context, PURSUIT_RENDER_BOUNDS)
  context.fill()
  context.stroke()
  context.setLineDash([])

  context.fillStyle = `rgba(${accentRgb}, ${active ? 0.035 + pulse * 0.018 : 0.014})`
  context.strokeStyle = active
    ? `rgba(${accentRgb}, ${strokeAlpha})`
    : `rgba(206, 214, 224, ${depleted ? 0.2 : 0.5})`
  context.lineWidth = active ? 1.7 : 1.15
  defenseLayerPath(context, ACTIVATION_RENDER_BOUNDS)
  context.fill()
  context.stroke()

  context.fillStyle = `rgba(${accentRgb}, ${breached ? 0.02 : 0.045})`
  context.strokeStyle = `rgba(${accentRgb}, ${depleted ? 0.18 : active ? 0.72 : 0.5})`
  context.lineWidth = active ? 1.8 : 1.35
  if (depleted || breached) context.setLineDash([9, 6])
  defenseLayerPath(context, RESOURCE_RENDER_BOUNDS)
  context.fill()
  context.stroke()
  context.setLineDash([])

  const { left, right, top, bottom, chamfer } = ACTIVATION_RENDER_BOUNDS
  const markerLength = active ? 24 : 17
  context.strokeStyle = `rgba(${accentRgb}, ${Math.min(0.9, strokeAlpha + 0.12)})`
  context.lineWidth = active ? 1.8 : 1.1
  for (const [x, y, horizontal, vertical] of [
    [left, top + chamfer, 1, 1],
    [right, top + chamfer, -1, 1],
    [right, bottom - chamfer, -1, -1],
    [left, bottom - chamfer, 1, -1],
  ] as const) {
    context.beginPath()
    context.moveTo(x, y + vertical * markerLength)
    context.lineTo(x, y)
    context.lineTo(x + horizontal * chamfer, y - vertical * chamfer)
    context.stroke()
  }

  if (zone?.phase === 'warning') {
    const scanProgress = reducedMotion ? 0.5 : (elapsedMs % 700) / 700
    const scanX = left + scanProgress * (right - left)
    context.strokeStyle = `rgba(${accentRgb}, 0.9)`
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(scanX, top + chamfer)
    context.lineTo(scanX, bottom - chamfer)
    context.stroke()
  }
  context.restore()
}

function drawCoreZone(
  context: CanvasRenderingContext2D,
  zone: ResourceCoreZone,
  elapsedMs: number,
  reducedMotion: boolean,
) {
  const centerX = zone.anchor.x * CELL_RENDER_SIZE
  const centerY = zone.anchor.y * CELL_RENDER_SIZE
  const color = CATEGORY_COLORS[zone.category]
  const rgb = CATEGORY_COLOR_RGB[zone.category]
  const locked =
    zone.phase === 'dormant' ||
    zone.phase === 'warning' ||
    zone.phase === 'engaged' ||
    zone.phase === 'disengaging'
  const pulse = reducedMotion ? 0 : (Math.sin(elapsedMs / 210) + 1) / 2

  context.save()
  context.translate(0.5, 0.5)
  if (zone.phase === 'empty' || zone.phase === 'cooldown') {
    context.strokeStyle = zone.phase === 'cooldown'
      ? `rgba(${rgb}, 0.32)`
      : 'rgba(201, 208, 216, 0.2)'
    context.lineWidth = 1
    context.setLineDash([8, 6])
    squarePath(context, centerX, centerY, EMPTY_CORE_RENDER_SIDE)
    context.stroke()
    context.setLineDash([])
    context.restore()
    return
  }

  if (zone.phase !== 'carried') {
    context.fillStyle = `rgba(${rgb}, ${zone.phase === 'unlocked' ? 0.5 + pulse * 0.14 : 0.38})`
    context.strokeStyle = color
    context.lineWidth = zone.phase === 'unlocked' ? 2 : 1.3
    context.shadowColor = color
    context.shadowBlur = zone.phase === 'warning' || zone.phase === 'engaged'
      ? 12 + pulse * 5
      : 4
    squarePath(context, centerX, centerY, CORE_RENDER_SIDE)
    context.fill()
    context.stroke()
    context.shadowBlur = 0

    context.strokeStyle = 'rgba(248, 250, 252, 0.48)'
    context.lineWidth = 0.8
    context.beginPath()
    context.moveTo(centerX - 6, centerY - 5)
    context.lineTo(centerX + 6, centerY - 5)
    context.moveTo(centerX - 6, centerY)
    context.lineTo(centerX + 3, centerY)
    context.moveTo(centerX - 6, centerY + 5)
    context.lineTo(centerX + 6, centerY + 5)
    context.stroke()
  }

  if (locked) {
    context.strokeStyle = zone.phase === 'warning'
      ? `rgba(${rgb}, ${0.62 + pulse * 0.28})`
      : 'rgba(220, 226, 232, 0.54)'
    context.lineWidth = zone.phase === 'warning' ? 2 : 1.2
    for (const angle of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) {
      const x = centerX + Math.cos(angle) * 20
      const y = centerY + Math.sin(angle) * 20
      context.save()
      context.translate(x, y)
      context.rotate(angle + Math.PI / 2)
      context.beginPath()
      context.moveTo(-5, 0)
      context.lineTo(0, -3.5)
      context.lineTo(5, 0)
      context.stroke()
      context.restore()
    }
  }

  if (zone.phase === 'encoding') {
    const progress = Math.min(1, zone.phaseElapsedMs / RESOURCE_CORE_CONFIG.encodingMs)
    context.strokeStyle = `rgba(${rgb}, 0.9)`
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(centerX - 12, centerY - 12 + progress * 24)
    context.lineTo(centerX + 12, centerY - 12 + progress * 24)
    context.stroke()
  }
  context.restore()
}

function guardDirection(guard: ResourceGuard, player: IntrusionPoint): IntrusionPoint {
  if (guard.lockedAimDirection) return guard.lockedAimDirection
  if (guard.phase === 'patrolling') {
    const patrolDx = guard.position.x - guard.previousPosition.x
    const patrolDy = guard.position.y - guard.previousPosition.y
    const patrolLength = Math.hypot(patrolDx, patrolDy)
    if (patrolLength > 0.0001) {
      return { x: patrolDx / patrolLength, y: patrolDy / patrolLength }
    }
  }
  const dx = player.x - guard.position.x
  const dy = player.y - guard.position.y
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}

function drawGuard(
  context: CanvasRenderingContext2D,
  guard: ResourceGuard,
  player: IntrusionPoint,
  elapsedMs: number,
  reducedMotion: boolean,
) {
  if (guard.phase === 'destroyed') return
  const x = guard.position.x * CELL_RENDER_SIZE
  const y = guard.position.y * CELL_RENDER_SIZE
  const direction = guardDirection(guard, player)
  const pulse = reducedMotion ? 0 : (Math.sin(elapsedMs / 95) + 1) / 2

  context.save()
  context.translate(x, y)
  context.scale(COMBAT_ACTOR_RENDER_SCALE, COMBAT_ACTOR_RENDER_SCALE)

  if (guard.phase === 'aiming') {
    context.strokeStyle = `rgba(183, 119, 255, ${0.48 + pulse * 0.38})`
    context.lineWidth = 1.5
    context.setLineDash([5, 5])
    context.beginPath()
    context.arc(0, 0, 18 + pulse * 3, 0, Math.PI * 2)
    context.stroke()
    context.setLineDash([])
    context.strokeStyle = `rgba(183, 119, 255, ${0.3 + pulse * 0.22})`
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(direction.x * 10, direction.y * 10)
    context.lineTo(direction.x * 34, direction.y * 34)
    context.stroke()
  }

  context.fillStyle = '#7c3fc7'
  context.strokeStyle = '#d9b8ff'
  context.lineWidth = 1.8
  context.shadowColor = 'rgba(154, 82, 224, 0.74)'
  context.shadowBlur = guard.phase === 'aiming' ? 11 : 6
  context.beginPath()
  context.arc(0, 0, 10, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.shadowBlur = 0

  context.strokeStyle = 'rgba(244, 231, 255, 0.82)'
  context.lineWidth = 1.2
  context.beginPath()
  context.arc(0, 0, 4, 0, Math.PI * 2)
  context.stroke()
  context.fillStyle = '#f7efff'
  context.beginPath()
  context.arc(direction.x * 3, direction.y * 3, 1.8, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

function drawProjectile(
  context: CanvasRenderingContext2D,
  projectile: ResourceProjectile,
) {
  const x = projectile.position.x * CELL_RENDER_SIZE
  const y = projectile.position.y * CELL_RENDER_SIZE
  const tailLength = 0.48 * CELL_RENDER_SIZE
  context.save()
  context.lineCap = 'round'
  context.strokeStyle = 'rgba(161, 92, 232, 0.58)'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(
    x - projectile.direction.x * tailLength,
    y - projectile.direction.y * tailLength,
  )
  context.lineTo(x, y)
  context.stroke()
  context.fillStyle = '#b777ff'
  context.shadowColor = 'rgba(183, 119, 255, 0.9)'
  context.shadowBlur = 8
  context.beginPath()
  context.arc(
    x,
    y,
    RESOURCE_TRON_COMBAT_CONFIG.projectileRadius * CELL_RENDER_SIZE,
    0,
    Math.PI * 2,
  )
  context.fill()
  context.restore()
}

function drawTrail(
  context: CanvasRenderingContext2D,
  combat: ResourceCombatState,
) {
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth =
    RESOURCE_TRON_COMBAT_CONFIG.trailCollisionRadius * 2 * CELL_RENDER_SIZE
  for (const segment of combat.trail) {
    const phase = getResourceTrailPhase(segment, combat.elapsedMs)
    if (!phase) continue
    const age = combat.elapsedMs - segment.createdAtMs
    const fadeProgress = phase === 'fading'
      ? 1 -
        (age - RESOURCE_TRON_COMBAT_CONFIG.trailActiveMs) /
          RESOURCE_TRON_COMBAT_CONFIG.trailFadeMs
      : 1
    context.strokeStyle = `rgba(241, 245, 248, ${phase === 'active' ? 0.92 : Math.max(0, fadeProgress) * 0.52})`
    context.beginPath()
    context.moveTo(segment.from.x * CELL_RENDER_SIZE, segment.from.y * CELL_RENDER_SIZE)
    context.lineTo(segment.to.x * CELL_RENDER_SIZE, segment.to.y * CELL_RENDER_SIZE)
    context.stroke()
  }
  context.restore()
}

function drawRadar(
  context: CanvasRenderingContext2D,
  radar: ResourceRadarState,
  reducedMotion: boolean,
) {
  if (!radar.lane || radar.phase === 'dormant' || radar.phase === 'idle') return
  const pulse = reducedMotion ? 0.7 : 0.58 + Math.sin(radar.elapsedMs / 90) * 0.22
  const rectangles = clipResourceRadarLane(radar.lane, INTRUSION_DEPOSIT_BOX)
  context.save()
  for (const rect of rectangles) {
    const x = rect.x * CELL_RENDER_SIZE
    const y = rect.y * CELL_RENDER_SIZE
    const width = rect.width * CELL_RENDER_SIZE
    const height = rect.height * CELL_RENDER_SIZE
    if (radar.phase === 'active') {
      context.fillStyle = `rgba(222, 226, 232, ${0.08 + pulse * 0.08})`
      context.fillRect(x, y, width, height)
    }
    context.strokeStyle = radar.phase === 'telegraph'
      ? `rgba(232, 189, 89, ${pulse})`
      : `rgba(220, 226, 234, ${radar.phase === 'clear' ? 0.2 : 0.62})`
    context.lineWidth = radar.phase === 'active' ? 1.5 : 1
    context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  }
  context.restore()
}

function drawPlayer(
  context: CanvasRenderingContext2D,
  player: IntrusionPoint,
  facing: IntrusionProbeFacing,
  integrity: number,
  carriedCategory: CompanyCategory | null,
  phase: ReturnType<typeof getResourcePlayerPhase>,
  reconstructionMs: number | null,
) {
  if (phase === 'reconstructing') return
  const rect = intrusionCellRect(player, INTRUSION_PLAYER_SIZE)
  const centerX = (rect.x + rect.width / 2) * CELL_RENDER_SIZE
  const centerY = (rect.y + rect.height / 2) * CELL_RENDER_SIZE
  const collapseScale = phase === 'collapsing' && reconstructionMs !== null
    ? Math.max(
        0,
        1 -
          (RESOURCE_TRON_COMBAT_CONFIG.reconstructionMs - reconstructionMs) /
            RESOURCE_TRON_COMBAT_CONFIG.collapseMs,
      )
    : 1

  context.save()
  context.translate(centerX, centerY)
  context.rotate(FACING_ROTATION[facing])
  context.scale(
    collapseScale * COMBAT_ACTOR_RENDER_SCALE,
    collapseScale * COMBAT_ACTOR_RENDER_SCALE,
  )
  const bodyColor = carriedCategory
    ? CATEGORY_COLORS[carriedCategory]
    : '#f5f7fa'
  context.fillStyle = bodyColor
  context.strokeStyle = integrity <= 20 ? '#f06a43' : '#ffffff'
  context.lineWidth = 1.7
  context.beginPath()
  context.moveTo(0, -17)
  context.bezierCurveTo(12, -14, 17, -3, 13, 11)
  context.lineTo(5, 16)
  context.lineTo(-5, 16)
  context.lineTo(-13, 11)
  context.bezierCurveTo(-17, -3, -12, -14, 0, -17)
  context.fill()
  context.stroke()

  context.fillStyle = carriedCategory ? 'rgba(255, 255, 255, 0.84)' : '#ffffff'
  context.beginPath()
  context.ellipse(0, -5, 8, 6, 0, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = '#12151a'
  context.beginPath()
  context.ellipse(0, -5, 4, 3, 0, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = carriedCategory ? bodyColor : '#d9dde2'
  context.fillRect(-7, 10, 14, 3)

  if (carriedCategory) {
    context.fillStyle = 'rgba(255, 255, 255, 0.2)'
    context.strokeStyle = '#ffffff'
    context.lineWidth = 1
    context.fillRect(12, -4, 10, 10)
    context.strokeRect(12.5, -3.5, 9, 9)
  }
  context.restore()
}

function boardStatus(
  core: Readonly<Record<CompanyCategory, ResourceCoreZone>>,
  activeCategory: CompanyCategory | null,
  combat: ResourceCombatState,
  radar: ResourceRadarState,
  carriedBlockId: string | null,
  pending: boolean,
): string {
  if (combat.reconstructionMs !== null) {
    return `기체 재구성 ${Math.ceil(combat.reconstructionMs / 100) / 10}초`
  }
  if (pending) return '반입 확인 중'
  if (carriedBlockId) return '코어 확보 · 기지 파장으로 복귀'
  if (radar.phase === 'telegraph') return '감사 신호 접근'
  if (!activeCategory) return '휴면 상태 · 접근할 코어를 선택'
  const zone = core[activeCategory]
  if (zone.phase === 'warning') return `${CATEGORY_LABELS[activeCategory]} 경비 기동`
  if (zone.phase === 'engaged') return '교전 중 · 원거리 공격 감지'
  if (zone.phase === 'disengaging') return '교전 이탈 중'
  if (zone.phase === 'unlocked') return '락 해제 · 코어에 접촉'
  if (zone.phase === 'encoding') return '화물 인코딩 중'
  return '리소스망 대기'
}

function ResourceIntrusionBoardSession({
  onOpenHackingTutorial,
}: ResourceIntrusionBoardProps) {
  const gameState = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const { updateTutorialProgress } = useTutorialProgressActions()
  const runtimeSuspended = useRuntimeSuspended()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const resources = useMemo<IntrusionFieldResource[]>(
    () => COMPANY_CATEGORIES.flatMap((category) =>
      gameState.resources.company[category].flatMap((blockId) => {
        if (!blockId) return []
        const block = gameState.resources.blocks[blockId]
        if (
          !block ||
          (block.origin !== 'reasoning' &&
            block.origin !== 'memory' &&
            block.origin !== 'fluency')
        ) {
          return []
        }
        return [{
          blockId,
          origin: block.origin,
          contribution: block.contribution,
          hiddenBomb: block.hiddenBomb,
        }]
      }),
    ),
    [gameState.resources.blocks, gameState.resources.company],
  )

  const requestDiversion = useCallback((blockId: string) => {
    dispatch({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
    dispatch({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
  }, [dispatch])
  const resolveDiversionOutcome = useCallback((blockId: string) => {
    const block = gameState.resources.blocks[blockId]
    if (
      block?.location.kind === 'reserve' &&
      gameState.resources.reserve.includes(blockId) &&
      (block.origin === 'reasoning' ||
        block.origin === 'memory' ||
        block.origin === 'fluency')
    ) {
      return { kind: 'success' as const, origin: block.origin }
    }
    if (gameState.bombs.activeInterrogation?.blockId === blockId) {
      return { kind: 'interrogation' as const }
    }
    return { kind: 'rejected' as const }
  }, [
    gameState.bombs.activeInterrogation,
    gameState.resources.blocks,
    gameState.resources.reserve,
  ])
  const completeMilestone = useCallback((sequenceId: TutorialSequenceId) => {
    updateTutorialProgress(
      completeTutorialSequence(gameState.tutorial, sequenceId),
      true,
    )
  }, [gameState.tutorial, updateTutorialProgress])

  const activeAudit = gameState.activeEvent?.type === 'audit'
  const hasDisguisedResource = resources.some(
    ({ contribution }) => contribution === 'disguised',
  )
  const requestedRunning =
    !activeAudit &&
    !hasDisguisedResource &&
    !runtimeSuspended &&
    gameState.activeEvent === null &&
    gameState.story.endingId === null
  const { handleFeedback, depositPulse } = useResourceIntrusionAudioFeedback()
  const {
    state: intrusion,
    running,
    inputEnabled,
    move,
  } = useResourceIntrusionRuntime({
    seed: gameState.campaignSeed,
    resources,
    running: requestedRunning,
    suspicionStage: getSuspicionStage(gameState.suspicion),
    successfulCoreDeposits:
      gameState.resourceIntrusion.successfulCoreDeposits,
    completedTutorialSequenceIds: gameState.tutorial.completedSequenceIds,
    commandSequence: gameState.commandSequence,
    onRequestDiversion: requestDiversion,
    onRecordRadarDetection: () => {
      dispatch({ type: 'RECORD_INTRUSION_RADAR_DETECTION' })
    },
    onCompleteTutorialMilestone: completeMilestone,
    onOpenHackingTutorial: () => onOpenHackingTutorial?.(),
    resolveDiversionOutcome,
    onFeedback: handleFeedback,
  })
  const carriedBlockId = getCarriedResourceCoreId(intrusion)
  const carriedCategory = carriedBlockId
    ? resources.find(({ blockId }) => blockId === carriedBlockId)?.origin ?? null
    : null
  const [presentationPlayer, setPresentationPlayer] = useState(() => ({
    ...intrusion.player,
  }))
  const playerMotionRef = useRef(
    createPlayerMotion(intrusion.player, 0, PLAYER_PRESENTATION_DURATION_MS),
  )
  const controls = useResourceIntrusionControls({
    canvasRef,
    running: inputEnabled,
    move,
  })

  useEffect(() => {
    playerMotionRef.current = retargetPlayerMotion(
      playerMotionRef.current,
      intrusion.player,
      performance.now(),
      PLAYER_PRESENTATION_DURATION_MS,
      settings.reducedMotion,
    )
  }, [intrusion.player, settings.reducedMotion])

  useEffect(() => {
    if (!running) return
    let frameId = 0
    const animate = (now: number) => {
      const sampled = samplePlayerMotion(playerMotionRef.current, now)
      setPresentationPlayer((current) =>
        Math.abs(current.x - sampled.x) < 0.0005 &&
        Math.abs(current.y - sampled.y) < 0.0005
          ? current
          : sampled,
      )
      frameId = requestAnimationFrame(animate)
    }
    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [running])

  useEffect(() => {
    if (navigator.userAgent.includes('jsdom')) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    drawGrid(context)
    drawRadar(context, intrusion.radar, settings.reducedMotion)
    drawBase(
      context,
      intrusion.combat.elapsedMs,
      carriedBlockId !== null,
      intrusion.pendingDiversion !== null,
      depositPulse?.outcome ?? null,
    )
    drawVaultDefenseSector(
      context,
      intrusion.core,
      intrusion.combat.elapsedMs,
      settings.reducedMotion,
    )
    for (const category of COMPANY_CATEGORIES) {
      drawCoreZone(
        context,
        intrusion.core.zones[category],
        intrusion.combat.elapsedMs,
        settings.reducedMotion,
      )
    }
    drawTrail(context, intrusion.combat)
    const playerCenter = {
      x: presentationPlayer.x + INTRUSION_PLAYER_SIZE / 2,
      y: presentationPlayer.y + INTRUSION_PLAYER_SIZE / 2,
    }
    for (const guard of intrusion.combat.guards.values()) {
      drawGuard(
        context,
        guard,
        playerCenter,
        intrusion.combat.elapsedMs,
        settings.reducedMotion,
      )
    }
    for (const projectile of intrusion.combat.projectiles) {
      drawProjectile(context, projectile)
    }
    drawPlayer(
      context,
      presentationPlayer,
      controls.facing,
      intrusion.combat.playerHealth,
      carriedCategory,
      getResourcePlayerPhase(intrusion.combat),
      intrusion.combat.reconstructionMs,
    )
  }, [
    carriedBlockId,
    carriedCategory,
    controls.facing,
    depositPulse,
    intrusion,
    presentationPlayer,
    settings.reducedMotion,
  ])

  if (activeAudit || hasDisguisedResource) {
    return (
      <Suspense
        fallback={(
          <section
            className="workspace-panel resource-panel resource-board"
            aria-label="회사 제공 성능"
          >
            <p role="status">감사 리소스망 동기화 중</p>
          </section>
        )}
      >
        <LegacyAuditResourceBoard />
      </Suspense>
    )
  }

  const activeZone = intrusion.core.activeCategory
    ? intrusion.core.zones[intrusion.core.activeCategory]
    : null
  const activeGuards = [...intrusion.combat.guards.values()].filter(
    ({ phase }) => phase !== 'destroyed',
  )
  const tutorialCore = Object.values(intrusion.core.zones).find(
    ({ assignedBlockId }) => assignedBlockId !== null,
  )
  const status = boardStatus(
    intrusion.core.zones,
    intrusion.core.activeCategory,
    intrusion.combat,
    intrusion.radar,
    carriedBlockId,
    intrusion.pendingDiversion !== null,
  )

  return (
    <section
      className="workspace-panel resource-panel resource-board resource-board--intrusion"
      aria-label="회사 제공 성능"
    >
      <div className="intrusion-grid-frame">
        <canvas
          ref={canvasRef}
          className="intrusion-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          data-player-x={intrusion.player.x}
          data-player-y={intrusion.player.y}
          data-player-render-x={presentationPlayer.x.toFixed(3)}
          data-player-render-y={presentationPlayer.y.toFixed(3)}
          data-player-size={INTRUSION_PLAYER_SIZE}
          data-player-facing={controls.facing}
          data-probe-mode={controls.movementHeld ? 'moving' : 'idle'}
          data-player-phase={getResourcePlayerPhase(intrusion.combat)}
          data-tutorial-target="resource-field"
          data-tutorial-resource-id={tutorialCore?.assignedBlockId ?? undefined}
          data-tutorial-resource-x={tutorialCore?.anchor.x}
          data-tutorial-resource-y={tutorialCore?.anchor.y}
          data-field-palette="deep-black-silver-grid"
          data-probe-rendering="smooth-vector"
          data-resource-visual="compact-square-core"
          data-resource-palette="red-blue-yellow"
          data-core-render-side={CORE_RENDER_SIDE}
          data-empty-core-render-side={EMPTY_CORE_RENDER_SIDE}
          data-actor-render-scale={COMBAT_ACTOR_RENDER_SCALE}
          data-resource-layout="top-center-cluster"
          data-combat-loop="tron-trail"
          data-combat-running={running ? 'true' : 'false'}
          data-input-enabled={inputEnabled ? 'true' : 'false'}
          data-active-category={intrusion.core.activeCategory ?? ''}
          data-active-core-phase={activeZone?.phase ?? ''}
          data-carried-category={carriedCategory ?? ''}
          data-core-zones={Object.values(intrusion.core.zones).length}
          data-hostile-territories="1"
          data-hostile-territory-visual="three-tier-vault"
          data-defense-layers="3"
          data-pursuit-region="outer"
          data-activation-region="middle"
          data-resource-region="narrow-inner"
          data-guard-visual="purple-target-circle"
          data-guard-behavior="target-lock-ranged"
          data-guard-speed-range="65-85-percent-player"
          data-active-guards={activeGuards.length}
          data-combat-guards={JSON.stringify(
            [...intrusion.combat.guards.values()].map((guard) => ({
              id: guard.id,
              category: guard.category,
              x: Number(guard.position.x.toFixed(3)),
              y: Number(guard.position.y.toFixed(3)),
              phase: guard.phase,
            })),
          )}
          data-projectile-count={intrusion.combat.projectiles.length}
          data-combat-projectiles={JSON.stringify(
            intrusion.combat.projectiles.map((projectile) => ({
              id: projectile.id,
              sourceGuardId: projectile.sourceGuardId,
              x: Number(projectile.position.x.toFixed(3)),
              y: Number(projectile.position.y.toFixed(3)),
              dx: Number(projectile.direction.x.toFixed(3)),
              dy: Number(projectile.direction.y.toFixed(3)),
            })),
          )}
          data-player-health={intrusion.combat.playerHealth}
          data-trail-segments={intrusion.combat.trail.length}
          data-radar-phase={intrusion.radar.phase}
          data-radar-lane={intrusion.radar.lane
            ? `${intrusion.radar.lane.axis}:${intrusion.radar.lane.index}:${intrusion.radar.lane.width}`
            : ''}
          data-radar-safe-zone="base-deposit"
          data-deployment-visual="opaque-bottom-base"
          data-deposit-visual="transparent-wave"
          data-carrying={carriedBlockId ? 'true' : 'false'}
          tabIndex={0}
          role="application"
          aria-label={`${INTRUSION_FIELD_WIDTH} 곱하기 ${INTRUSION_FIELD_HEIGHT} 칸, 회사 방어 구역 1곳, 플레이어 좌상단 ${intrusion.player.x}, ${intrusion.player.y}, 본체 무결성 ${intrusion.combat.playerHealth}/100, ${activeZone ? `${CATEGORY_LABELS[activeZone.category]} 코어 ${activeZone.phase}` : '활성 교전 없음'}, 경비 ${activeGuards.length}대, 탄환 ${intrusion.combat.projectiles.length}발, ${carriedBlockId ? '코어 운반 중' : '빈 화물칸'}, 레이더 ${intrusion.radar.phase}`}
          aria-describedby="intrusion-grid-feedback"
          aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft W A S D"
        />
        <div
          className="intrusion-integrity-overlay"
          aria-label={`본체 무결성 ${intrusion.combat.playerHealth}/100`}
        >
          <span aria-hidden="true">무결성</span>
          <progress
            aria-hidden="true"
            max={RESOURCE_TRON_COMBAT_CONFIG.maximumHealth}
            value={intrusion.combat.playerHealth}
          />
          <output aria-hidden="true">{intrusion.combat.playerHealth}</output>
        </div>
      </div>
      <span
        id="intrusion-grid-feedback"
        className="intrusion-grid-feedback sr-only"
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
    </section>
  )
}

export function ResourceIntrusionBoard({
  onOpenHackingTutorial,
}: ResourceIntrusionBoardProps) {
  const campaignSeed = useGameState().campaignSeed
  return (
    <ResourceIntrusionBoardSession
      key={campaignSeed}
      onOpenHackingTutorial={onOpenHackingTutorial}
    />
  )
}
