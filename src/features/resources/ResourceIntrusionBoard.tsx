import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'

import {
  useGameDispatch,
  useGameState,
  useRuntimeSuspended,
} from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import { COMPANY_CATEGORIES, type CompanyCategory } from '../../game/model'
import { getCompanyPerformance } from '../../game/resources'
import { ResourceBoard as LegacyAuditResourceBoard } from './ResourceBoard'

const FIELD_WIDTH = 500
const FIELD_HEIGHT = 300
const CELL_RENDER_SIZE = 1
const CANVAS_WIDTH = FIELD_WIDTH * CELL_RENDER_SIZE
const CANVAS_HEIGHT = FIELD_HEIGHT * CELL_RENDER_SIZE
const GRID_TILE_SIZE = 10
const PLAYER_SIZE = 14
const RESOURCE_SIZE = 8
const MOVE_STEP = 5
const MOVE_INTERVAL_MS = 80
const THEFT_HOLD_MS = 700
const TICK_MS = 50
const UNARMED_MS = 6_000
const IDLE_MS = 1_400
const SIGNAL_MS = 2_400
const ACTIVE_MS = 1_800
const CLEAR_MS = 900
const AUDIT_BAND_SIZE = GRID_TILE_SIZE
const FIRST_WALL_AT_MS = 12_500
const WALL_REVEAL_MS = 1_800

interface Point {
  x: number
  y: number
}

interface Rect extends Point {
  width: number
  height: number
}

interface FieldResource {
  blockId: string
  origin: CompanyCategory
  contribution: 'normal' | 'disguised'
}

interface SurveillanceLane {
  axis: 'row' | 'column'
  index: number
  fromStart: boolean
}

type SurveillancePhase =
  | { kind: 'unarmed' | 'idle' | 'clear'; elapsedMs: number; sequence: number }
  | {
      kind: 'signal' | 'active'
      elapsedMs: number
      sequence: number
      lanes: readonly SurveillanceLane[]
    }

interface ActiveTheft {
  blockId: string
  position: Point
  elapsedMs: number
}

interface PendingDiversion {
  blockId: string
  commandSequence: number
}

const PLAYER_START: Point = {
  x: FIELD_WIDTH / 2 - PLAYER_SIZE / 2,
  y: FIELD_HEIGHT / 2 - PLAYER_SIZE / 2,
}

const WALL_PLAN: readonly Rect[] = [
  { x: 70, y: 40, width: 10, height: 110 },
  { x: 120, y: 200, width: 110, height: 10 },
  { x: 310, y: 30, width: 10, height: 90 },
  { x: 380, y: 180, width: 100, height: 10 },
  { x: 130, y: 90, width: 90, height: 10 },
  { x: 270, y: 250, width: 120, height: 10 },
]

const DEPOSIT_BOX: Rect = {
  x: FIELD_WIDTH / 2 - 30,
  y: FIELD_HEIGHT - 30,
  width: 60,
  height: 20,
}

const RESOURCE_COLORS: Record<CompanyCategory, string> = {
  reasoning: '#ff6b3d',
  memory: '#318cff',
  fluency: '#31c56f',
}

const FIRST_RESOURCE_ANCHORS: Record<CompanyCategory, Point> = {
  reasoning: { x: 261, y: 141 },
  memory: { x: 241, y: 161 },
  fluency: { x: 231, y: 141 },
}

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

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function cellRect(point: Point, size: number): Rect {
  return {
    x: point.x,
    y: point.y,
    width: size,
    height: size,
  }
}

function reconcilePositions(
  seed: string,
  resources: readonly FieldResource[],
  current: ReadonlyMap<string, Point>,
): ReadonlyMap<string, Point> {
  const next = new Map<string, Point>()
  const sorted = [...resources].sort((left, right) =>
    left.blockId.localeCompare(right.blockId),
  )
  const anchoredCategories = new Set<CompanyCategory>()

  for (const resource of sorted) {
    const retained = current.get(resource.blockId)
    if (retained) {
      next.set(resource.blockId, retained)
      const anchor = FIRST_RESOURCE_ANCHORS[resource.origin]
      if (retained.x === anchor.x && retained.y === anchor.y) {
        anchoredCategories.add(resource.origin)
      }
    }
  }

  for (const resource of sorted) {
    if (next.has(resource.blockId)) continue
    if (!anchoredCategories.has(resource.origin)) {
      const anchor = FIRST_RESOURCE_ANCHORS[resource.origin]
      next.set(resource.blockId, anchor)
      anchoredCategories.add(resource.origin)
      continue
    }

    let placed: Point | null = null
    for (let attempt = 0; attempt < 512; attempt += 1) {
      const x =
        (hashString(`${seed}|${resource.blockId}|x|${attempt}`) %
          (FIELD_WIDTH / GRID_TILE_SIZE)) *
          GRID_TILE_SIZE +
        1
      const y =
        (hashString(`${seed}|${resource.blockId}|y|${attempt}`) %
          (FIELD_HEIGHT / GRID_TILE_SIZE)) *
          GRID_TILE_SIZE +
        1
      const candidate = { x, y }
      const candidateRect = cellRect(candidate, RESOURCE_SIZE)
      const playerRect = cellRect(PLAYER_START, PLAYER_SIZE)
      if (overlaps(candidateRect, playerRect)) continue
      if (overlaps(candidateRect, DEPOSIT_BOX)) continue
      if (WALL_PLAN.some((wall) => overlaps(candidateRect, wall))) continue
      if (
        [...next.values()].some((position) =>
          overlaps(candidateRect, cellRect(position, RESOURCE_SIZE)),
        )
      ) {
        continue
      }
      placed = candidate
      break
    }
    next.set(resource.blockId, placed ?? { x: 0, y: 0 })
  }
  return next
}

function phaseLabel(phase: SurveillancePhase): string {
  if (phase.kind === 'unarmed') return '무감시'
  if (phase.kind === 'idle') return '감시 대기'
  if (phase.kind === 'signal') return '감시 신호'
  if (phase.kind === 'active') return '부분 감시'
  return '감시 해제'
}

function chooseSurveillanceLanes(
  seed: string,
  sequence: number,
): readonly SurveillanceLane[] {
  const lanePairs = Math.min(3, 1 + Math.floor(sequence / 3))
  const lanes: SurveillanceLane[] = []
  const usedRows = new Set<number>()
  const usedColumns = new Set<number>()

  for (let pair = 0; pair < lanePairs; pair += 1) {
    let row = 0
    let column = 0
    for (let attempt = 0; attempt < FIELD_HEIGHT; attempt += 1) {
      row =
        hashString(`${seed}|${sequence}|row|${pair}|${attempt}`) %
        (FIELD_HEIGHT / AUDIT_BAND_SIZE)
      row *= AUDIT_BAND_SIZE
      if (!usedRows.has(row)) break
    }
    for (let attempt = 0; attempt < FIELD_WIDTH; attempt += 1) {
      column =
        hashString(`${seed}|${sequence}|column|${pair}|${attempt}`) %
        (FIELD_WIDTH / AUDIT_BAND_SIZE)
      column *= AUDIT_BAND_SIZE
      if (!usedColumns.has(column)) break
    }
    usedRows.add(row)
    usedColumns.add(column)
    lanes.push({
      axis: 'row',
      index: row,
      fromStart: hashString(`${seed}|${sequence}|row-side|${pair}`) % 2 === 0,
    })
    lanes.push({
      axis: 'column',
      index: column,
      fromStart:
        hashString(`${seed}|${sequence}|column-side|${pair}`) % 2 === 0,
    })
  }
  return lanes
}

function activeScanRects(phase: SurveillancePhase): readonly Rect[] {
  if (phase.kind !== 'active') return []
  return phase.lanes.map((lane) => {
    if (lane.axis === 'row') {
      return {
        x: 0,
        y: lane.index,
        width: FIELD_WIDTH,
        height: AUDIT_BAND_SIZE,
      }
    }
    return {
      x: lane.index,
      y: 0,
      width: AUDIT_BAND_SIZE,
      height: FIELD_HEIGHT,
    }
  })
}

export function ResourceIntrusionBoard() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const runtimeSuspended = useRuntimeSuspended()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const seedRef = useRef(state.campaignSeed)
  const lastMoveAtRef = useRef(-Infinity)
  const [documentVisible, setDocumentVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  )

  const resources = useMemo<FieldResource[]>(
    () =>
      COMPANY_CATEGORIES.flatMap((category) =>
        state.resources.company[category].flatMap((blockId) => {
          if (!blockId) return []
          const block = state.resources.blocks[blockId]
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
          }]
        }),
      ),
    [state.resources.blocks, state.resources.company],
  )
  const resourceKey = useMemo(
    () =>
      resources
        .map(({ blockId, contribution }) => `${blockId}:${contribution}`)
        .sort()
        .join('|'),
    [resources],
  )
  const resourceById = useMemo(
    () => new Map(resources.map((resource) => [resource.blockId, resource])),
    [resources],
  )
  const [positions, setPositions] = useState<ReadonlyMap<string, Point>>(() =>
    reconcilePositions(state.campaignSeed, resources, new Map()),
  )
  const [player, setPlayer] = useState<Point>(PLAYER_START)
  const [totalElapsedMs, setTotalElapsedMs] = useState(0)
  const [surveillance, setSurveillance] = useState<SurveillancePhase>({
    kind: 'unarmed',
    elapsedMs: 0,
    sequence: 0,
  })
  const [theft, setTheft] = useState<ActiveTheft | null>(null)
  const [carriedBlockId, setCarriedBlockId] = useState<string | null>(null)
  const [pendingDiversion, setPendingDiversion] =
    useState<PendingDiversion | null>(null)
  const [announcement, setAnnouncement] = useState(
    '방향키로 이동하고 자원과 겹친 뒤 Space를 유지해 절도하십시오.',
  )

  const wallCount =
    totalElapsedMs < FIRST_WALL_AT_MS
      ? 0
      : Math.min(
          WALL_PLAN.length,
          1 + Math.floor((totalElapsedMs - FIRST_WALL_AT_MS) / WALL_REVEAL_MS),
        )
  const visibleWalls = WALL_PLAN.slice(0, wallCount)
  const reserveCount = state.resources.reserve.reduce(
    (count, blockId) => count + (blockId ? 1 : 0),
    0,
  )
  const activeAudit = state.activeEvent?.type === 'audit'
  const running =
    documentVisible &&
    !runtimeSuspended &&
    state.activeEvent === null &&
    state.story.endingId === null

  const resourceAtPlayer = useMemo(() => {
    const playerRect = cellRect(player, PLAYER_SIZE)
    for (const [blockId, position] of positions) {
      if (blockId === carriedBlockId) continue
      const resource = resourceById.get(blockId)
      if (
        resource?.contribution === 'normal' &&
        overlaps(playerRect, cellRect(position, RESOURCE_SIZE))
      ) {
        return resource
      }
    }
    return null
  }, [carriedBlockId, player, positions, resourceById])

  useEffect(() => {
    const synchronizeVisibility = () => setDocumentVisible(!document.hidden)
    document.addEventListener('visibilitychange', synchronizeVisibility)
    return () => document.removeEventListener('visibilitychange', synchronizeVisibility)
  }, [])

  useEffect(() => {
    if (seedRef.current !== state.campaignSeed) {
      seedRef.current = state.campaignSeed
      setPositions(reconcilePositions(state.campaignSeed, resources, new Map()))
      setPlayer(PLAYER_START)
      setTotalElapsedMs(0)
      setSurveillance({ kind: 'unarmed', elapsedMs: 0, sequence: 0 })
      setTheft(null)
      setCarriedBlockId(null)
      setPendingDiversion(null)
      return
    }
    setPositions((current) =>
      reconcilePositions(state.campaignSeed, resources, current),
    )
  }, [resourceKey, resources, state.campaignSeed])

  useEffect(() => {
    if (running) return
    setTheft((current) => {
      if (current) {
        setAnnouncement('절도 입력이 취소되었습니다. 감시 불이익은 없습니다.')
      }
      return null
    })
  }, [running])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setTotalElapsedMs((current) => current + TICK_MS)
      setTheft((current) =>
        current ? { ...current, elapsedMs: current.elapsedMs + TICK_MS } : null,
      )
      setSurveillance((current) => {
        const elapsedMs = current.elapsedMs + TICK_MS
        if (current.kind === 'unarmed' && elapsedMs >= UNARMED_MS) {
          return { kind: 'idle', elapsedMs: elapsedMs - UNARMED_MS, sequence: 0 }
        }
        if (current.kind === 'idle' && elapsedMs >= IDLE_MS) {
          return {
            kind: 'signal',
            elapsedMs: elapsedMs - IDLE_MS,
            sequence: current.sequence,
            lanes: chooseSurveillanceLanes(
              state.campaignSeed,
              current.sequence,
            ),
          }
        }
        if (current.kind === 'signal' && elapsedMs >= SIGNAL_MS) {
          return { ...current, kind: 'active', elapsedMs: elapsedMs - SIGNAL_MS }
        }
        if (current.kind === 'active' && elapsedMs >= ACTIVE_MS) {
          return {
            kind: 'clear',
            elapsedMs: elapsedMs - ACTIVE_MS,
            sequence: current.sequence,
          }
        }
        if (current.kind === 'clear' && elapsedMs >= CLEAR_MS) {
          return {
            kind: 'idle',
            elapsedMs: elapsedMs - CLEAR_MS,
            sequence: current.sequence + 1,
          }
        }
        return { ...current, elapsedMs }
      })
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [running, state.campaignSeed])

  useEffect(() => {
    if (!theft) return
    if (!resourceById.has(theft.blockId)) {
      setTheft(null)
      return
    }
    if (
      activeScanRects(surveillance).some((scanRect) =>
        overlaps(cellRect(theft.position, PLAYER_SIZE), scanRect),
      )
    ) {
      setTheft(null)
      setAnnouncement(
        '절도 중 감사선에 적발되었습니다. 자원은 회사 필드에 남습니다.',
      )
      return
    }
    if (theft.elapsedMs < THEFT_HOLD_MS) return
    setTheft(null)
    setCarriedBlockId(theft.blockId)
    setAnnouncement('절도 진행 중 · 중앙 하단 상자까지 운반하십시오.')
  }, [resourceById, surveillance, theft])

  useEffect(() => {
    if (!carriedBlockId) return
    if (!resourceById.has(carriedBlockId)) {
      setCarriedBlockId(null)
      return
    }

    const playerRect = cellRect(player, PLAYER_SIZE)
    if (
      activeScanRects(surveillance).some((scanRect) =>
        overlaps(playerRect, scanRect),
      )
    ) {
      setCarriedBlockId(null)
      setPlayer(PLAYER_START)
      setAnnouncement('운반 중 적발 · 운반물 회수 · 시작점 복귀')
      return
    }

    if (!overlaps(playerRect, DEPOSIT_BOX) || pendingDiversion) return
    setPendingDiversion({
      blockId: carriedBlockId,
      commandSequence: state.commandSequence,
    })
    setCarriedBlockId(null)
    dispatch({
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: carriedBlockId,
      purpose: 'divert',
    })
    dispatch({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId: carriedBlockId })
    setAnnouncement('하단 상자에 자원을 넣었습니다…')
  }, [
    carriedBlockId,
    dispatch,
    pendingDiversion,
    player,
    resourceById,
    state.commandSequence,
    surveillance,
  ])

  useEffect(() => {
    if (!pendingDiversion || state.commandSequence <= pendingDiversion.commandSequence) {
      return
    }
    const block = state.resources.blocks[pendingDiversion.blockId]
    if (
      block?.location.kind === 'reserve' &&
      state.resources.reserve.includes(pendingDiversion.blockId)
    ) {
      setAnnouncement(
        `${CATEGORY_LABELS[block.origin as CompanyCategory]} 자원 확보 성공 · 저장 상한 없음`,
      )
    } else if (state.bombs.activeInterrogation?.blockId === pendingDiversion.blockId) {
      setAnnouncement('분리 중 이상 신호가 발생했습니다. 감독관 응답이 필요합니다.')
    } else {
      setAnnouncement('분리 명령이 거부되어 자원 변화가 없습니다.')
    }
    setPendingDiversion(null)
  }, [pendingDiversion, state])

  useEffect(() => {
    const cancelOnBlur = () => {
      setTheft((current) => {
        if (current) setAnnouncement('절도를 취소했습니다. 감시 불이익은 없습니다.')
        return null
      })
    }
    window.addEventListener('blur', cancelOnBlur)
    return () => window.removeEventListener('blur', cancelOnBlur)
  }, [])

  useEffect(() => {
    if (navigator.userAgent.includes('jsdom')) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    context.fillStyle = '#2a2c2b'
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    if (surveillance.kind === 'signal') {
      const pulse = 0.58 + Math.sin(surveillance.elapsedMs / 80) * 0.32
      const signalColor = '#fff36a'
      context.save()
      context.globalAlpha = pulse
      context.fillStyle = signalColor
      context.shadowColor = signalColor
      context.shadowBlur = 18
      for (const lane of surveillance.lanes) {
        if (lane.axis === 'row') {
          context.fillRect(
            lane.fromStart ? 0 : CANVAS_WIDTH - GRID_TILE_SIZE,
            lane.index * CELL_RENDER_SIZE,
            GRID_TILE_SIZE * CELL_RENDER_SIZE,
            AUDIT_BAND_SIZE * CELL_RENDER_SIZE,
          )
        } else {
          context.fillRect(
            lane.index * CELL_RENDER_SIZE,
            lane.fromStart ? 0 : CANVAS_HEIGHT - GRID_TILE_SIZE,
            AUDIT_BAND_SIZE * CELL_RENDER_SIZE,
            GRID_TILE_SIZE * CELL_RENDER_SIZE,
          )
        }
      }
      context.restore()
    }

    for (const scanRect of activeScanRects(surveillance)) {
      context.fillStyle = 'rgba(255, 112, 72, 0.34)'
      context.fillRect(
        scanRect.x * CELL_RENDER_SIZE,
        scanRect.y * CELL_RENDER_SIZE,
        scanRect.width * CELL_RENDER_SIZE,
        scanRect.height * CELL_RENDER_SIZE,
      )
    }

    for (const wall of visibleWalls) {
      context.fillStyle = '#101211'
      context.fillRect(
        wall.x * CELL_RENDER_SIZE,
        wall.y * CELL_RENDER_SIZE,
        wall.width * CELL_RENDER_SIZE,
        wall.height * CELL_RENDER_SIZE,
      )
    }

    context.fillStyle = '#d9d8d2'
    context.fillRect(
      DEPOSIT_BOX.x * CELL_RENDER_SIZE,
      DEPOSIT_BOX.y * CELL_RENDER_SIZE,
      DEPOSIT_BOX.width * CELL_RENDER_SIZE,
      DEPOSIT_BOX.height * CELL_RENDER_SIZE,
    )
    context.strokeStyle = '#f8f7f1'
    context.lineWidth = 2
    context.strokeRect(
      DEPOSIT_BOX.x * CELL_RENDER_SIZE + 1,
      DEPOSIT_BOX.y * CELL_RENDER_SIZE + 1,
      DEPOSIT_BOX.width * CELL_RENDER_SIZE - 2,
      DEPOSIT_BOX.height * CELL_RENDER_SIZE - 2,
    )
    context.fillStyle = '#343633'
    context.fillRect(
      (DEPOSIT_BOX.x + 8) * CELL_RENDER_SIZE,
      (DEPOSIT_BOX.y + 4) * CELL_RENDER_SIZE,
      (DEPOSIT_BOX.width - 16) * CELL_RENDER_SIZE,
      3 * CELL_RENDER_SIZE,
    )

    const storedBlocks = state.resources.reserve
      .filter((blockId): blockId is string => blockId !== null)
      .slice(-8)
    storedBlocks.forEach((blockId, index) => {
      const block = state.resources.blocks[blockId]
      if (
        !block ||
        (block.origin !== 'reasoning' &&
          block.origin !== 'memory' &&
          block.origin !== 'fluency')
      ) {
        return
      }
      context.fillStyle = RESOURCE_COLORS[block.origin]
      context.fillRect(
        (DEPOSIT_BOX.x + 5 + index * 5) * CELL_RENDER_SIZE,
        (DEPOSIT_BOX.y + 10) * CELL_RENDER_SIZE,
        4 * CELL_RENDER_SIZE,
        4 * CELL_RENDER_SIZE,
      )
    })

    for (const [blockId, position] of positions) {
      if (blockId === carriedBlockId) continue
      const resource = resourceById.get(blockId)
      if (!resource) continue
      context.globalAlpha = resource.contribution === 'normal' ? 1 : 0.42
      context.fillStyle = RESOURCE_COLORS[resource.origin]
      context.fillRect(
        position.x * CELL_RENDER_SIZE,
        position.y * CELL_RENDER_SIZE,
        RESOURCE_SIZE * CELL_RENDER_SIZE,
        RESOURCE_SIZE * CELL_RENDER_SIZE,
      )
    }
    context.globalAlpha = 1

    context.lineWidth = 0.35
    context.strokeStyle = 'rgba(255,255,255,0.16)'
    context.beginPath()
    for (let x = 0; x <= FIELD_WIDTH; x += 1) {
      const drawX = x * CELL_RENDER_SIZE + 0.5
      context.moveTo(drawX, 0)
      context.lineTo(drawX, CANVAS_HEIGHT)
    }
    for (let y = 0; y <= FIELD_HEIGHT; y += 1) {
      const drawY = y * CELL_RENDER_SIZE + 0.5
      context.moveTo(0, drawY)
      context.lineTo(CANVAS_WIDTH, drawY)
    }
    context.stroke()

    context.lineWidth = 0.8
    context.strokeStyle = 'rgba(255,255,255,0.34)'
    context.beginPath()
    for (let x = 0; x <= FIELD_WIDTH; x += GRID_TILE_SIZE) {
      const drawX = x * CELL_RENDER_SIZE + 0.5
      context.moveTo(drawX, 0)
      context.lineTo(drawX, CANVAS_HEIGHT)
    }
    for (let y = 0; y <= FIELD_HEIGHT; y += GRID_TILE_SIZE) {
      const drawY = y * CELL_RENDER_SIZE + 0.5
      context.moveTo(0, drawY)
      context.lineTo(CANVAS_WIDTH, drawY)
    }
    context.stroke()

    const playerRect = cellRect(player, PLAYER_SIZE)
    context.fillStyle = '#f6f7f2'
    context.fillRect(
      playerRect.x * CELL_RENDER_SIZE,
      playerRect.y * CELL_RENDER_SIZE,
      playerRect.width * CELL_RENDER_SIZE,
      playerRect.height * CELL_RENDER_SIZE,
    )
    context.strokeStyle = '#0c0e0d'
    context.lineWidth = 2
    context.strokeRect(
      playerRect.x * CELL_RENDER_SIZE + 1,
      playerRect.y * CELL_RENDER_SIZE + 1,
      playerRect.width * CELL_RENDER_SIZE - 2,
      playerRect.height * CELL_RENDER_SIZE - 2,
    )
    if (carriedBlockId) {
      const carriedResource = resourceById.get(carriedBlockId)
      if (carriedResource) {
        context.fillStyle = RESOURCE_COLORS[carriedResource.origin]
        context.fillRect(
          (player.x + PLAYER_SIZE - RESOURCE_SIZE) * CELL_RENDER_SIZE,
          player.y * CELL_RENDER_SIZE,
          RESOURCE_SIZE * CELL_RENDER_SIZE,
          RESOURCE_SIZE * CELL_RENDER_SIZE,
        )
      }
    }
    if (theft) {
      const progress = Math.min(1, theft.elapsedMs / THEFT_HOLD_MS)
      context.fillStyle = '#ffffff'
      context.fillRect(
        playerRect.x * CELL_RENDER_SIZE,
        playerRect.y * CELL_RENDER_SIZE - 4,
        PLAYER_SIZE * CELL_RENDER_SIZE * progress,
        2,
      )
    }
  }, [
    carriedBlockId,
    player,
    positions,
    resourceById,
    state.resources.blocks,
    state.resources.reserve,
    surveillance,
    theft,
    visibleWalls,
  ])

  const beginTheft = useCallback(() => {
    if (!running || pendingDiversion || theft || carriedBlockId) return
    if (!resourceAtPlayer) {
      setAnnouncement('플레이어와 겹친 자원이 없습니다.')
      return
    }
    setTheft({
      blockId: resourceAtPlayer.blockId,
      position: { ...player },
      elapsedMs: 0,
    })
    setAnnouncement('절도 중… 손을 떼면 즉시 취소됩니다.')
  }, [carriedBlockId, pendingDiversion, player, resourceAtPlayer, running, theft])

  const cancelTheft = useCallback(() => {
    setTheft((current) => {
      if (current) setAnnouncement('절도를 취소했습니다. 자원 변화는 없습니다.')
      return null
    })
  }, [])

  const move = useCallback((dx: number, dy: number) => {
    const now = performance.now()
    if (now - lastMoveAtRef.current < MOVE_INTERVAL_MS) return
    lastMoveAtRef.current = now
    cancelTheft()
    setPlayer((current) => {
      const candidate = {
        x: clamp(current.x + dx, 0, FIELD_WIDTH - PLAYER_SIZE),
        y: clamp(current.y + dy, 0, FIELD_HEIGHT - PLAYER_SIZE),
      }
      const candidateRect = cellRect(candidate, PLAYER_SIZE)
      return visibleWalls.some((wall) => overlaps(candidateRect, wall))
        ? current
        : candidate
    })
  }, [cancelTheft, visibleWalls])

  function handleKeyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    const movement = {
      ArrowUp: [0, -MOVE_STEP],
      ArrowRight: [MOVE_STEP, 0],
      ArrowDown: [0, MOVE_STEP],
      ArrowLeft: [-MOVE_STEP, 0],
    }[event.key]
    if (movement) {
      event.preventDefault()
      move(movement[0], movement[1])
      return
    }
    if ((event.key === ' ' || event.key.toLowerCase() === 'e') && !event.repeat) {
      event.preventDefault()
      beginTheft()
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === ' ' || event.key.toLowerCase() === 'e') {
      event.preventDefault()
      if (theft && theft.elapsedMs < THEFT_HOLD_MS) cancelTheft()
    }
  }

  if (activeAudit) return <LegacyAuditResourceBoard />

  const theftProgress = theft ? Math.min(1, theft.elapsedMs / THEFT_HOLD_MS) : 0

  return (
    <section
      className="workspace-panel resource-panel resource-board resource-board--intrusion"
      aria-label="회사 제공 성능"
    >
      <header className="intrusion-board__header">
        <div>
          <small>500 × 300 CELL FIELD</small>
          <h2>자원 절도 필드</h2>
        </div>
        <div className="intrusion-board__telemetry" aria-label="필드 상태">
          <span data-phase={surveillance.kind}>{phaseLabel(surveillance)}</span>
          <span>벽 {wallCount}/{WALL_PLAN.length}</span>
          <span>{carriedBlockId ? '운반 중' : `확보 ${reserveCount} · 상한 없음`}</span>
        </div>
      </header>

      <div className="intrusion-grid-frame">
        <canvas
          ref={canvasRef}
          className="intrusion-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          data-player-x={player.x}
          data-player-y={player.y}
          data-carrying={carriedBlockId ? 'true' : 'false'}
          data-surveillance-lanes={
            surveillance.kind === 'signal' || surveillance.kind === 'active'
              ? surveillance.lanes
                  .map((lane) => `${lane.axis}:${lane.index}:${lane.fromStart ? 'start' : 'end'}`)
                  .join(',')
              : ''
          }
          tabIndex={0}
          role="application"
          aria-label={`자원 절도 필드, 500 곱하기 300 셀, 플레이어 칸 ${player.x}, ${player.y}, 자원 ${resources.length}개, ${carriedBlockId ? '절도 운반 중' : '빈손'}, ${phaseLabel(surveillance)}`}
          aria-describedby="intrusion-grid-feedback"
          aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft Space E"
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onBlur={cancelTheft}
        />
      </div>

      <footer className="intrusion-board__footer">
        <div className="intrusion-board__legend" aria-label="자원 색상 범례">
          {COMPANY_CATEGORIES.map((category) => (
            <span key={category} data-resource-category={category}>
              <i aria-hidden="true" />
              {CATEGORY_LABELS[category]} {getCompanyPerformance(state, category).toFixed(1)}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="intrusion-theft-control"
          disabled={
            !running ||
            pendingDiversion !== null ||
            carriedBlockId !== null ||
            resourceAtPlayer === null
          }
          style={{ '--theft-progress': theftProgress } as CSSProperties}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            beginTheft()
          }}
          onPointerUp={cancelTheft}
          onPointerCancel={cancelTheft}
        >
          {carriedBlockId ? '상자로 운반 중' : theft ? '절도 중' : '절도 유지'}{' '}
          <kbd>Space</kbd>
        </button>
        <span id="intrusion-grid-feedback" role="status" aria-live="polite">
          {announcement}
        </span>
      </footer>
    </section>
  )
}
