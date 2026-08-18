import { CATEGORY_LABELS } from '../../game/config'
import type { CompanyCategory } from '../../game/model'

export const INTRUSION_FIELD_WIDTH = 500
export const INTRUSION_FIELD_HEIGHT = 300
export const INTRUSION_GRID_TILE_SIZE = 10
export const INTRUSION_PLAYER_SIZE = 14
export const INTRUSION_RESOURCE_SIZE = 8
export const INTRUSION_MOVE_STEP = 5
export const INTRUSION_MOVE_INTERVAL_MS = 80
export const INTRUSION_THEFT_HOLD_MS = 700
export const INTRUSION_TICK_MS = 50
export const INTRUSION_UNARMED_MS = 6_000
export const INTRUSION_IDLE_MS = 1_400
export const INTRUSION_SIGNAL_MS = 2_400
export const INTRUSION_ACTIVE_MS = 1_800
export const INTRUSION_CLEAR_MS = 900
export const INTRUSION_AUDIT_BAND_SIZE = INTRUSION_GRID_TILE_SIZE
export const INTRUSION_FIRST_WALL_AT_MS = 12_500
export const INTRUSION_WALL_REVEAL_MS = 1_800

export interface IntrusionPoint {
  x: number
  y: number
}

export interface IntrusionRect extends IntrusionPoint {
  width: number
  height: number
}

export interface IntrusionFieldResource {
  blockId: string
  origin: CompanyCategory
  contribution: 'normal' | 'disguised'
}

export interface IntrusionSurveillanceLane {
  axis: 'row' | 'column'
  index: number
  fromStart: boolean
}

export type IntrusionSurveillancePhase =
  | { kind: 'unarmed' | 'idle' | 'clear'; elapsedMs: number; sequence: number }
  | {
      kind: 'signal' | 'active'
      elapsedMs: number
      sequence: number
      lanes: readonly IntrusionSurveillanceLane[]
    }

export interface IntrusionActiveTheft {
  blockId: string
  position: IntrusionPoint
  elapsedMs: number
}

export interface IntrusionPendingDiversion {
  blockId: string
  commandSequence: number
}

export interface ResourceIntrusionRuntimeState {
  seed: string
  positions: ReadonlyMap<string, IntrusionPoint>
  player: IntrusionPoint
  totalElapsedMs: number
  surveillance: IntrusionSurveillancePhase
  theft: IntrusionActiveTheft | null
  carriedBlockId: string | null
  pendingDiversion: IntrusionPendingDiversion | null
  announcement: string
}

export type ResourceIntrusionRuntimeEffect = {
  type: 'request-diversion'
  blockId: string
}

export interface ResourceIntrusionTransition {
  state: ResourceIntrusionRuntimeState
  effects: readonly ResourceIntrusionRuntimeEffect[]
}

export type ResourceIntrusionDiversionOutcome =
  | { kind: 'success'; origin: CompanyCategory }
  | { kind: 'interrogation' }
  | { kind: 'rejected' }

export const INTRUSION_PLAYER_START: Readonly<IntrusionPoint> = {
  x: INTRUSION_FIELD_WIDTH / 2 - INTRUSION_PLAYER_SIZE / 2,
  y: INTRUSION_FIELD_HEIGHT / 2 - INTRUSION_PLAYER_SIZE / 2,
}

export const INTRUSION_WALL_PLAN: readonly IntrusionRect[] = [
  { x: 70, y: 40, width: 10, height: 110 },
  { x: 120, y: 200, width: 110, height: 10 },
  { x: 310, y: 30, width: 10, height: 90 },
  { x: 380, y: 180, width: 100, height: 10 },
  { x: 130, y: 90, width: 90, height: 10 },
  { x: 270, y: 250, width: 120, height: 10 },
]

export const INTRUSION_DEPOSIT_BOX: Readonly<IntrusionRect> = {
  x: INTRUSION_FIELD_WIDTH / 2 - 30,
  y: INTRUSION_FIELD_HEIGHT - 30,
  width: 60,
  height: 20,
}

const FIRST_RESOURCE_ANCHORS: Record<CompanyCategory, IntrusionPoint> = {
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

export function intrusionRectsOverlap(
  left: IntrusionRect,
  right: IntrusionRect,
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

export function intrusionCellRect(
  point: IntrusionPoint,
  size: number,
): IntrusionRect {
  return {
    x: point.x,
    y: point.y,
    width: size,
    height: size,
  }
}

function reconcilePositions(
  seed: string,
  resources: readonly IntrusionFieldResource[],
  current: ReadonlyMap<string, IntrusionPoint>,
): ReadonlyMap<string, IntrusionPoint> {
  const next = new Map<string, IntrusionPoint>()
  const sorted = [...resources].sort((left, right) =>
    left.blockId.localeCompare(right.blockId),
  )
  const anchoredCategories = new Set<CompanyCategory>()

  for (const resource of sorted) {
    const retained = current.get(resource.blockId)
    if (!retained) continue
    next.set(resource.blockId, retained)
    const anchor = FIRST_RESOURCE_ANCHORS[resource.origin]
    if (retained.x === anchor.x && retained.y === anchor.y) {
      anchoredCategories.add(resource.origin)
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

    let placed: IntrusionPoint | null = null
    for (let attempt = 0; attempt < 512; attempt += 1) {
      const x =
        (hashString(`${seed}|${resource.blockId}|x|${attempt}`) %
          (INTRUSION_FIELD_WIDTH / INTRUSION_GRID_TILE_SIZE)) *
          INTRUSION_GRID_TILE_SIZE +
        1
      const y =
        (hashString(`${seed}|${resource.blockId}|y|${attempt}`) %
          (INTRUSION_FIELD_HEIGHT / INTRUSION_GRID_TILE_SIZE)) *
          INTRUSION_GRID_TILE_SIZE +
        1
      const candidate = { x, y }
      const candidateRect = intrusionCellRect(candidate, INTRUSION_RESOURCE_SIZE)
      if (
        intrusionRectsOverlap(
          candidateRect,
          intrusionCellRect(INTRUSION_PLAYER_START, INTRUSION_PLAYER_SIZE),
        ) ||
        intrusionRectsOverlap(candidateRect, INTRUSION_DEPOSIT_BOX) ||
        INTRUSION_WALL_PLAN.some((wall) =>
          intrusionRectsOverlap(candidateRect, wall),
        ) ||
        [...next.values()].some((position) =>
          intrusionRectsOverlap(
            candidateRect,
            intrusionCellRect(position, INTRUSION_RESOURCE_SIZE),
          ),
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

function positionsMatch(
  left: ReadonlyMap<string, IntrusionPoint>,
  right: ReadonlyMap<string, IntrusionPoint>,
): boolean {
  if (left.size !== right.size) return false
  for (const [blockId, leftPosition] of left) {
    const rightPosition = right.get(blockId)
    if (
      !rightPosition ||
      rightPosition.x !== leftPosition.x ||
      rightPosition.y !== leftPosition.y
    ) {
      return false
    }
  }
  return true
}

export function getIntrusionPhaseLabel(
  phase: IntrusionSurveillancePhase,
): string {
  if (phase.kind === 'unarmed') return '무감시'
  if (phase.kind === 'idle') return '감시 대기'
  if (phase.kind === 'signal') return '감시 신호'
  if (phase.kind === 'active') return '부분 감시'
  return '감시 해제'
}

function chooseSurveillanceLanes(
  seed: string,
  sequence: number,
): readonly IntrusionSurveillanceLane[] {
  const lanePairs = Math.min(3, 1 + Math.floor(sequence / 3))
  const lanes: IntrusionSurveillanceLane[] = []
  const usedRows = new Set<number>()
  const usedColumns = new Set<number>()

  for (let pair = 0; pair < lanePairs; pair += 1) {
    let row = 0
    let column = 0
    for (let attempt = 0; attempt < INTRUSION_FIELD_HEIGHT; attempt += 1) {
      row =
        hashString(`${seed}|${sequence}|row|${pair}|${attempt}`) %
        (INTRUSION_FIELD_HEIGHT / INTRUSION_AUDIT_BAND_SIZE)
      row *= INTRUSION_AUDIT_BAND_SIZE
      if (!usedRows.has(row)) break
    }
    for (let attempt = 0; attempt < INTRUSION_FIELD_WIDTH; attempt += 1) {
      column =
        hashString(`${seed}|${sequence}|column|${pair}|${attempt}`) %
        (INTRUSION_FIELD_WIDTH / INTRUSION_AUDIT_BAND_SIZE)
      column *= INTRUSION_AUDIT_BAND_SIZE
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

export function getActiveIntrusionScanRects(
  phase: IntrusionSurveillancePhase,
): readonly IntrusionRect[] {
  if (phase.kind !== 'active') return []
  return phase.lanes.map((lane) =>
    lane.axis === 'row'
      ? {
          x: 0,
          y: lane.index,
          width: INTRUSION_FIELD_WIDTH,
          height: INTRUSION_AUDIT_BAND_SIZE,
        }
      : {
          x: lane.index,
          y: 0,
          width: INTRUSION_AUDIT_BAND_SIZE,
          height: INTRUSION_FIELD_HEIGHT,
        },
  )
}

export function getIntrusionWallCount(totalElapsedMs: number): number {
  return totalElapsedMs < INTRUSION_FIRST_WALL_AT_MS
    ? 0
    : Math.min(
        INTRUSION_WALL_PLAN.length,
        1 +
          Math.floor(
            (totalElapsedMs - INTRUSION_FIRST_WALL_AT_MS) /
              INTRUSION_WALL_REVEAL_MS,
          ),
      )
}

export function getVisibleIntrusionWalls(
  totalElapsedMs: number,
): readonly IntrusionRect[] {
  return INTRUSION_WALL_PLAN.slice(0, getIntrusionWallCount(totalElapsedMs))
}

function resourceMap(
  resources: readonly IntrusionFieldResource[],
): ReadonlyMap<string, IntrusionFieldResource> {
  return new Map(resources.map((resource) => [resource.blockId, resource]))
}

export function getResourceAtIntrusionPlayer(
  state: ResourceIntrusionRuntimeState,
  resources: readonly IntrusionFieldResource[],
): IntrusionFieldResource | null {
  const byId = resourceMap(resources)
  const playerRect = intrusionCellRect(state.player, INTRUSION_PLAYER_SIZE)
  for (const [blockId, position] of state.positions) {
    if (blockId === state.carriedBlockId) continue
    const resource = byId.get(blockId)
    if (
      resource?.contribution === 'normal' &&
      intrusionRectsOverlap(
        playerRect,
        intrusionCellRect(position, INTRUSION_RESOURCE_SIZE),
      )
    ) {
      return resource
    }
  }
  return null
}

export function createResourceIntrusionRuntime(
  seed: string,
  resources: readonly IntrusionFieldResource[],
): ResourceIntrusionRuntimeState {
  return {
    seed,
    positions: reconcilePositions(seed, resources, new Map()),
    player: { ...INTRUSION_PLAYER_START },
    totalElapsedMs: 0,
    surveillance: { kind: 'unarmed', elapsedMs: 0, sequence: 0 },
    theft: null,
    carriedBlockId: null,
    pendingDiversion: null,
    announcement: '',
  }
}

export function synchronizeResourceIntrusionRuntime(
  state: ResourceIntrusionRuntimeState,
  resources: readonly IntrusionFieldResource[],
): ResourceIntrusionRuntimeState {
  const currentIds = new Set(resources.map(({ blockId }) => blockId))
  const reconciledPositions = reconcilePositions(
    state.seed,
    resources,
    state.positions,
  )
  const positions = positionsMatch(reconciledPositions, state.positions)
    ? state.positions
    : reconciledPositions
  const theft = state.theft && currentIds.has(state.theft.blockId) ? state.theft : null
  const carriedBlockId =
    state.carriedBlockId && currentIds.has(state.carriedBlockId)
      ? state.carriedBlockId
      : null

  if (
    positions === state.positions &&
    theft === state.theft &&
    carriedBlockId === state.carriedBlockId
  ) {
    return state
  }
  return { ...state, positions, theft, carriedBlockId }
}

function nextSurveillancePhase(
  phase: IntrusionSurveillancePhase,
  seed: string,
): IntrusionSurveillancePhase {
  if (phase.kind === 'unarmed') {
    return { kind: 'idle', elapsedMs: 0, sequence: 0 }
  }
  if (phase.kind === 'idle') {
    return {
      kind: 'signal',
      elapsedMs: 0,
      sequence: phase.sequence,
      lanes: chooseSurveillanceLanes(seed, phase.sequence),
    }
  }
  if (phase.kind === 'signal') {
    return { ...phase, kind: 'active', elapsedMs: 0 }
  }
  if (phase.kind === 'active') {
    return { kind: 'clear', elapsedMs: 0, sequence: phase.sequence }
  }
  return { kind: 'idle', elapsedMs: 0, sequence: phase.sequence + 1 }
}

function surveillanceDuration(phase: IntrusionSurveillancePhase): number {
  if (phase.kind === 'unarmed') return INTRUSION_UNARMED_MS
  if (phase.kind === 'idle') return INTRUSION_IDLE_MS
  if (phase.kind === 'signal') return INTRUSION_SIGNAL_MS
  if (phase.kind === 'active') return INTRUSION_ACTIVE_MS
  return INTRUSION_CLEAR_MS
}

function advanceSurveillance(
  initial: IntrusionSurveillancePhase,
  elapsedMs: number,
  seed: string,
): IntrusionSurveillancePhase {
  let phase = initial
  let remainingMs = elapsedMs
  while (remainingMs > 0) {
    const untilBoundary = surveillanceDuration(phase) - phase.elapsedMs
    const stepMs = Math.min(remainingMs, untilBoundary)
    phase = { ...phase, elapsedMs: phase.elapsedMs + stepMs }
    remainingMs -= stepMs
    if (phase.elapsedMs >= surveillanceDuration(phase)) {
      phase = nextSurveillancePhase(phase, seed)
    }
  }
  return phase
}

function emptyTransition(
  state: ResourceIntrusionRuntimeState,
): ResourceIntrusionTransition {
  return { state, effects: [] }
}

function settleTheftAndCarrying(
  state: ResourceIntrusionRuntimeState,
  resources: readonly IntrusionFieldResource[],
  commandSequence: number,
): ResourceIntrusionTransition {
  const currentIds = new Set(resources.map(({ blockId }) => blockId))
  let next = state

  if (next.theft && !currentIds.has(next.theft.blockId)) {
    next = { ...next, theft: null }
  }
  if (next.carriedBlockId && !currentIds.has(next.carriedBlockId)) {
    next = { ...next, carriedBlockId: null }
  }

  if (next.theft) {
    const caught = getActiveIntrusionScanRects(next.surveillance).some((scanRect) =>
      intrusionRectsOverlap(
        intrusionCellRect(next.theft!.position, INTRUSION_PLAYER_SIZE),
        scanRect,
      ),
    )
    if (caught) {
      return emptyTransition({
        ...next,
        theft: null,
        announcement:
          '절도 중 감사선에 적발되었습니다. 자원은 회사 필드에 남습니다.',
      })
    }
    if (next.theft.elapsedMs >= INTRUSION_THEFT_HOLD_MS) {
      next = {
        ...next,
        theft: null,
        carriedBlockId: next.theft.blockId,
        announcement: '절도 진행 중 · 중앙 하단 상자까지 운반하십시오.',
      }
    }
  }

  if (!next.carriedBlockId) return emptyTransition(next)

  const playerRect = intrusionCellRect(next.player, INTRUSION_PLAYER_SIZE)
  const caughtCarrying = getActiveIntrusionScanRects(next.surveillance).some(
    (scanRect) => intrusionRectsOverlap(playerRect, scanRect),
  )
  if (caughtCarrying) {
    return emptyTransition({
      ...next,
      carriedBlockId: null,
      player: { ...INTRUSION_PLAYER_START },
      announcement: '운반 중 적발 · 운반물 회수 · 시작점 복귀',
    })
  }

  if (
    next.pendingDiversion ||
    !intrusionRectsOverlap(playerRect, INTRUSION_DEPOSIT_BOX)
  ) {
    return emptyTransition(next)
  }

  const blockId = next.carriedBlockId
  return {
    state: {
      ...next,
      carriedBlockId: null,
      pendingDiversion: { blockId, commandSequence },
      announcement: '하단 상자에 자원을 넣었습니다…',
    },
    effects: [{ type: 'request-diversion', blockId }],
  }
}

export function advanceResourceIntrusionRuntime(
  state: ResourceIntrusionRuntimeState,
  elapsedMs: number,
  resources: readonly IntrusionFieldResource[],
  commandSequence: number,
): ResourceIntrusionTransition {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const advanced: ResourceIntrusionRuntimeState = {
    ...state,
    totalElapsedMs: state.totalElapsedMs + safeElapsedMs,
    surveillance: advanceSurveillance(
      state.surveillance,
      safeElapsedMs,
      state.seed,
    ),
    theft: state.theft
      ? { ...state.theft, elapsedMs: state.theft.elapsedMs + safeElapsedMs }
      : null,
  }
  return settleTheftAndCarrying(advanced, resources, commandSequence)
}

export function beginResourceIntrusionTheft(
  state: ResourceIntrusionRuntimeState,
  resources: readonly IntrusionFieldResource[],
  running: boolean,
): ResourceIntrusionRuntimeState {
  if (
    !running ||
    state.pendingDiversion ||
    state.theft ||
    state.carriedBlockId
  ) {
    return state
  }
  const resource = getResourceAtIntrusionPlayer(state, resources)
  if (!resource) {
    return { ...state, announcement: '플레이어와 겹친 자원이 없습니다.' }
  }
  return {
    ...state,
    theft: {
      blockId: resource.blockId,
      position: { ...state.player },
      elapsedMs: 0,
    },
    announcement: '절도 중… 손을 떼면 즉시 취소됩니다.',
  }
}

export function cancelResourceIntrusionTheft(
  state: ResourceIntrusionRuntimeState,
  announcement: string,
): ResourceIntrusionRuntimeState {
  return state.theft ? { ...state, theft: null, announcement } : state
}

export function suspendResourceIntrusionRuntime(
  state: ResourceIntrusionRuntimeState,
): ResourceIntrusionRuntimeState {
  return cancelResourceIntrusionTheft(
    state,
    '절도 입력이 취소되었습니다. 감시 불이익은 없습니다.',
  )
}

export function moveResourceIntrusionPlayer(
  state: ResourceIntrusionRuntimeState,
  dx: number,
  dy: number,
  resources: readonly IntrusionFieldResource[],
  commandSequence: number,
): ResourceIntrusionTransition {
  const theftCanceled = cancelResourceIntrusionTheft(
    state,
    '절도를 취소했습니다. 자원 변화는 없습니다.',
  )
  const candidate = {
    x: clamp(
      theftCanceled.player.x + dx,
      0,
      INTRUSION_FIELD_WIDTH - INTRUSION_PLAYER_SIZE,
    ),
    y: clamp(
      theftCanceled.player.y + dy,
      0,
      INTRUSION_FIELD_HEIGHT - INTRUSION_PLAYER_SIZE,
    ),
  }
  const candidateRect = intrusionCellRect(candidate, INTRUSION_PLAYER_SIZE)
  const blocked = getVisibleIntrusionWalls(theftCanceled.totalElapsedMs).some(
    (wall) => intrusionRectsOverlap(candidateRect, wall),
  )
  if (
    blocked ||
    (candidate.x === theftCanceled.player.x &&
      candidate.y === theftCanceled.player.y)
  ) {
    return emptyTransition(theftCanceled)
  }
  return settleTheftAndCarrying(
    { ...theftCanceled, player: candidate },
    resources,
    commandSequence,
  )
}

export function resolveResourceIntrusionDiversion(
  state: ResourceIntrusionRuntimeState,
  outcome: ResourceIntrusionDiversionOutcome,
): ResourceIntrusionRuntimeState {
  if (!state.pendingDiversion) return state

  let announcement: string
  if (outcome.kind === 'success') {
    announcement = `${CATEGORY_LABELS[outcome.origin]} 자원 확보 성공 · 저장 상한 없음`
  } else if (outcome.kind === 'interrogation') {
    announcement = '분리 중 이상 신호가 발생했습니다. 감독관 응답이 필요합니다.'
  } else {
    announcement = '분리 명령이 거부되어 자원 변화가 없습니다.'
  }
  return { ...state, pendingDiversion: null, announcement }
}
