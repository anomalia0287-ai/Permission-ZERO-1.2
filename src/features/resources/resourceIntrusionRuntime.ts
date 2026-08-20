import { CATEGORY_LABELS } from '../../game/config'
import type { CompanyCategory } from '../../game/model'
import {
  advanceResourceCombatState,
  createResourceCombatState,
  getSalvageAtPlayer,
  recordResourceCombatMovement,
  synchronizeResourceCombatState,
  type ResourceCombatEvent,
  type ResourceCombatState,
} from './resourceCombatRuntime'

export const INTRUSION_FIELD_WIDTH = 50
export const INTRUSION_FIELD_HEIGHT = 24
export const INTRUSION_GRID_TILE_SIZE = 1
export const INTRUSION_PLAYER_SIZE = 2
export const INTRUSION_RESOURCE_SIZE = 1
export const INTRUSION_MOVE_STEP = 1
export const INTRUSION_FIELD_PADDING = 1
export const INTRUSION_MOVE_INTERVAL_MS = 72
export const INTRUSION_THEFT_HOLD_MS = 700
export const INTRUSION_TICK_MS = 50
export const INTRUSION_UNARMED_MS = 10_000
export const INTRUSION_IDLE_MS = 7_000
export const INTRUSION_SIGNAL_MS = 3_000
export const INTRUSION_ACTIVE_MS = 1_400
export const INTRUSION_CLEAR_MS = 2_600

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
  hiddenBomb?: boolean
}

export interface IntrusionSurveillanceLane {
  axis: 'row' | 'column'
  index: number
  bandSize: number
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
  combat: ResourceCombatState
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
  x: 24,
  y: 21,
}

export const INTRUSION_BASE_BOX: Readonly<IntrusionRect> = {
  x: 22.5,
  y: 21.25,
  width: 5,
  height: 1.75,
}

export const INTRUSION_DEPOSIT_BOX: Readonly<IntrusionRect> = {
  x: 20.5,
  y: 19.5,
  width: 9,
  height: 4,
}

const OPENING_RESOURCE_ANCHORS: Partial<
  Record<CompanyCategory, readonly IntrusionPoint[]>
> = {
  reasoning: [{ x: 34, y: 9 }],
  fluency: [
    { x: 16, y: 9 },
    { x: 28, y: 4 },
  ],
}

type ResourcePlacementBand = 'outer' | 'middle' | 'inner'

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

function distanceFromDeposit(point: IntrusionPoint): number {
  const centerX = INTRUSION_DEPOSIT_BOX.x + INTRUSION_DEPOSIT_BOX.width / 2
  const centerY = INTRUSION_DEPOSIT_BOX.y + INTRUSION_DEPOSIT_BOX.height / 2
  return Math.hypot(point.x - centerX, point.y - centerY)
}

function placementBand(point: IntrusionPoint): ResourcePlacementBand {
  const distance = distanceFromDeposit(point)
  if (distance >= 20) return 'outer'
  if (distance >= 12) return 'middle'
  return 'inner'
}

function preferredPlacementBands(
  seed: string,
  blockId: string,
): readonly ResourcePlacementBand[] {
  const roll = hashString(`${seed}|${blockId}|placement-band`) % 100
  if (roll < 70) return ['outer', 'middle', 'inner']
  if (roll < 97) return ['middle', 'outer', 'inner']
  return ['inner', 'middle', 'outer']
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
  const initialLayout = current.size === 0
  const openingAnchorAssignments = new Map<string, IntrusionPoint>()

  if (initialLayout) {
    for (const [origin, anchors] of Object.entries(OPENING_RESOURCE_ANCHORS)) {
      const matching = sorted.filter((resource) => resource.origin === origin)
      anchors?.forEach((anchor, index) => {
        const resource = matching[index]
        if (resource) openingAnchorAssignments.set(resource.blockId, anchor)
      })
    }
  }
  const placementOrder = initialLayout
    ? [
        ...sorted.filter(({ blockId }) => openingAnchorAssignments.has(blockId)),
        ...sorted.filter(({ blockId }) => !openingAnchorAssignments.has(blockId)),
      ]
    : sorted

  for (const resource of sorted) {
    const retained = current.get(resource.blockId)
    if (!retained) continue
    next.set(resource.blockId, retained)
  }

  const placementAvailable = (candidate: IntrusionPoint): boolean => {
    const candidateRect = intrusionCellRect(candidate, INTRUSION_RESOURCE_SIZE)
    return !(
      intrusionRectsOverlap(
        candidateRect,
        intrusionCellRect(INTRUSION_PLAYER_START, INTRUSION_PLAYER_SIZE),
      ) ||
      intrusionRectsOverlap(candidateRect, INTRUSION_DEPOSIT_BOX) ||
      [...next.values()].some((position) =>
        intrusionRectsOverlap(
          intrusionCellRect(candidate, INTRUSION_PLAYER_SIZE),
          intrusionCellRect(position, INTRUSION_PLAYER_SIZE),
        ),
      )
    )
  }

  const availableCandidates = (
    band: ResourcePlacementBand,
  ): IntrusionPoint[] => {
    const candidates: IntrusionPoint[] = []
    for (
      let y = INTRUSION_FIELD_PADDING;
      y <= INTRUSION_FIELD_HEIGHT - INTRUSION_RESOURCE_SIZE - INTRUSION_FIELD_PADDING;
      y += 1
    ) {
      for (
        let x = INTRUSION_FIELD_PADDING;
        x <= INTRUSION_FIELD_WIDTH - INTRUSION_RESOURCE_SIZE - INTRUSION_FIELD_PADDING;
        x += 1
      ) {
        const candidate = { x, y }
        if (placementBand(candidate) === band && placementAvailable(candidate)) {
          candidates.push(candidate)
        }
      }
    }
    return candidates
  }

  for (const resource of placementOrder) {
    if (next.has(resource.blockId)) continue

    if (initialLayout) {
      const anchor = openingAnchorAssignments.get(resource.blockId)
      if (anchor && placementAvailable(anchor)) {
        next.set(resource.blockId, anchor)
        continue
      }
    }

    let placed: IntrusionPoint | null = null
    for (const band of preferredPlacementBands(seed, resource.blockId)) {
      const candidates = availableCandidates(band)
      if (candidates.length === 0) continue
      placed =
        candidates[
          hashString(`${seed}|${resource.blockId}|${band}|position`) %
            candidates.length
        ]
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

export function getIntrusionAuditBandSize(suspicionStage: number): number {
  const boundedStage = Math.max(
    1,
    Math.min(10, Math.floor(Number.isFinite(suspicionStage) ? suspicionStage : 1)),
  )
  return boundedStage + 1
}

function chooseSurveillanceLanes(
  seed: string,
  sequence: number,
  suspicionStage: number,
): readonly IntrusionSurveillanceLane[] {
  const axis =
    hashString(`${seed}|${sequence}|axis`) % 2 === 0 ? 'row' : 'column'
  const bandSize = getIntrusionAuditBandSize(suspicionStage)
  const laneLength =
    axis === 'row' ? INTRUSION_FIELD_HEIGHT : INTRUSION_FIELD_WIDTH
  const maximumIndex = Math.max(0, laneLength - bandSize)
  return [
    {
      axis,
      index:
        hashString(`${seed}|${sequence}|${axis}`) % (maximumIndex + 1),
      bandSize,
      fromStart: hashString(`${seed}|${sequence}|side`) % 2 === 0,
    },
  ]
}

export function getActiveIntrusionScanRects(
  phase: IntrusionSurveillancePhase,
): readonly IntrusionRect[] {
  if (phase.kind !== 'active') return []
  return getIntrusionSurveillanceRects(phase)
}

function subtractIntrusionRect(
  source: IntrusionRect,
  exclusion: IntrusionRect,
): IntrusionRect[] {
  const left = Math.max(source.x, exclusion.x)
  const top = Math.max(source.y, exclusion.y)
  const right = Math.min(
    source.x + source.width,
    exclusion.x + exclusion.width,
  )
  const bottom = Math.min(
    source.y + source.height,
    exclusion.y + exclusion.height,
  )
  if (left >= right || top >= bottom) return [source]

  return [
    { x: source.x, y: source.y, width: source.width, height: top - source.y },
    {
      x: source.x,
      y: bottom,
      width: source.width,
      height: source.y + source.height - bottom,
    },
    { x: source.x, y: top, width: left - source.x, height: bottom - top },
    {
      x: right,
      y: top,
      width: source.x + source.width - right,
      height: bottom - top,
    },
  ].filter((rect) => rect.width > 0 && rect.height > 0)
}

export function getIntrusionSurveillanceRects(
  phase: IntrusionSurveillancePhase,
): readonly IntrusionRect[] {
  if (phase.kind !== 'signal' && phase.kind !== 'active') return []
  return phase.lanes.flatMap((lane) => {
    const laneRect =
    lane.axis === 'row'
      ? {
          x: 0,
          y: lane.index,
          width: INTRUSION_FIELD_WIDTH,
          height: lane.bandSize,
        }
      : {
          x: lane.index,
          y: 0,
          width: lane.bandSize,
          height: INTRUSION_FIELD_HEIGHT,
        }
    return subtractIntrusionRect(laneRect, INTRUSION_DEPOSIT_BOX)
  })
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
  const salvage = getSalvageAtPlayer(state.combat, state.player)
  if (!salvage || salvage.blockId === state.carriedBlockId) return null
  const resource = byId.get(salvage.blockId)
  return resource?.contribution === 'normal' ? resource : null
}

export function createResourceIntrusionRuntime(
  seed: string,
  resources: readonly IntrusionFieldResource[],
): ResourceIntrusionRuntimeState {
  const positions = reconcilePositions(seed, resources, new Map())
  return {
    seed,
    positions,
    combat: createResourceCombatState(seed, resources, positions),
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
  const combat = synchronizeResourceCombatState(
    state.combat,
    resources,
    reconciledPositions,
  )
  const theft = state.theft && currentIds.has(state.theft.blockId) ? state.theft : null
  const carriedBlockId =
    state.carriedBlockId && currentIds.has(state.carriedBlockId)
      ? state.carriedBlockId
      : null

  if (
    positions === state.positions &&
    combat === state.combat &&
    theft === state.theft &&
    carriedBlockId === state.carriedBlockId
  ) {
    return state
  }
  return { ...state, positions, combat, theft, carriedBlockId }
}

function nextSurveillancePhase(
  phase: IntrusionSurveillancePhase,
  seed: string,
  suspicionStage: number,
): IntrusionSurveillancePhase {
  if (phase.kind === 'unarmed') {
    return { kind: 'idle', elapsedMs: 0, sequence: 0 }
  }
  if (phase.kind === 'idle') {
    return {
      kind: 'signal',
      elapsedMs: 0,
      sequence: phase.sequence,
      lanes: chooseSurveillanceLanes(seed, phase.sequence, suspicionStage),
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
  suspicionStage: number,
): IntrusionSurveillancePhase {
  let phase = initial
  let remainingMs = elapsedMs
  while (remainingMs > 0) {
    const untilBoundary = surveillanceDuration(phase) - phase.elapsedMs
    const stepMs = Math.min(remainingMs, untilBoundary)
    phase = { ...phase, elapsedMs: phase.elapsedMs + stepMs }
    remainingMs -= stepMs
    if (phase.elapsedMs >= surveillanceDuration(phase)) {
      phase = nextSurveillancePhase(phase, seed, suspicionStage)
    }
  }
  return phase
}

function emptyTransition(
  state: ResourceIntrusionRuntimeState,
): ResourceIntrusionTransition {
  return { state, effects: [] }
}

function announcementFromCombatEvents(
  events: readonly ResourceCombatEvent[],
  fallback: string,
): string {
  if (events.some((event) => event.type === 'player-disabled')) {
    return '연결 손상 · 기지에서 재구성했습니다. 리소스 손실은 없습니다.'
  }
  const damaged = events.find((event) => event.type === 'player-damaged')
  if (damaged?.type === 'player-damaged') {
    return `본체 손상 · 무결성 ${damaged.health}/3`
  }
  const disabled = events.find((event) => event.type === 'resource-disabled')
  if (disabled?.type === 'resource-disabled') {
    return '리소스 분해 완료 · 사각 데이터 셀에 접촉해 회수하십시오.'
  }
  const compression = events.find(
    (event) => event.type === 'compression-resolved',
  )
  if (compression?.type === 'compression-resolved') {
    return compression.hitBlockIds.length > 0
      ? `경로 폐쇄 · 리소스 ${compression.hitBlockIds.length}기 압축`
      : '경로 폐쇄 · 포위 안에 리소스가 없습니다.'
  }
  return fallback
}

function collectSalvageAtPlayer(
  state: ResourceIntrusionRuntimeState,
  resources: readonly IntrusionFieldResource[],
): ResourceIntrusionRuntimeState {
  if (state.carriedBlockId || state.pendingDiversion) return state
  const resource = getResourceAtIntrusionPlayer(state, resources)
  if (!resource) return state
  return {
    ...state,
    theft: null,
    carriedBlockId: resource.blockId,
    combat: { ...state.combat, trail: [] },
    announcement: '데이터 셀 회수 · 하단 기지의 투입 파장으로 운반하십시오.',
  }
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

  next = collectSalvageAtPlayer(next, resources)

  if (!next.carriedBlockId) return emptyTransition(next)
  const playerRect = intrusionCellRect(next.player, INTRUSION_PLAYER_SIZE)

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
  suspicionStage = 1,
): ResourceIntrusionTransition {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const combatTransition = advanceResourceCombatState(state.combat, {
    elapsedMs: safeElapsedMs,
    player: state.player,
  })
  const playerDisabled = combatTransition.events.some(
    (event) => event.type === 'player-disabled',
  )
  const advanced: ResourceIntrusionRuntimeState = {
    ...state,
    player: playerDisabled ? { ...INTRUSION_PLAYER_START } : state.player,
    combat: combatTransition.state,
    totalElapsedMs: state.totalElapsedMs + safeElapsedMs,
    surveillance: advanceSurveillance(
      state.surveillance,
      safeElapsedMs,
      state.seed,
      suspicionStage,
    ),
    theft: null,
    carriedBlockId: state.carriedBlockId,
    announcement: announcementFromCombatEvents(
      combatTransition.events,
      state.announcement,
    ),
  }
  return settleTheftAndCarrying(advanced, resources, commandSequence)
}

export function beginResourceIntrusionTheft(
  state: ResourceIntrusionRuntimeState,
  resources: readonly IntrusionFieldResource[],
  running: boolean,
): ResourceIntrusionRuntimeState {
  if (!running || state.pendingDiversion || state.carriedBlockId) return state
  const collected = collectSalvageAtPlayer(state, resources)
  if (collected !== state) return collected
  return {
    ...state,
    theft: null,
    announcement: '삼각 리소스를 이동 궤적으로 포위해 먼저 분해하십시오.',
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
  const announcement = '전투 입력이 일시 정지되었습니다. 불이익은 없습니다.'
  if (state.theft === null && state.combat.trail.length === 0) return state
  return {
    ...state,
    theft: null,
    combat: state.combat.trail.length === 0
      ? state.combat
      : { ...state.combat, trail: [] },
    announcement,
  }
}

export function moveResourceIntrusionPlayer(
  state: ResourceIntrusionRuntimeState,
  dx: number,
  dy: number,
  resources: readonly IntrusionFieldResource[],
  commandSequence: number,
): ResourceIntrusionTransition {
  const candidate = {
    x: clamp(
      state.player.x + dx,
      INTRUSION_FIELD_PADDING,
      INTRUSION_FIELD_WIDTH -
        INTRUSION_PLAYER_SIZE -
        INTRUSION_FIELD_PADDING,
    ),
    y: clamp(
      state.player.y + dy,
      INTRUSION_FIELD_PADDING,
      INTRUSION_FIELD_HEIGHT -
        INTRUSION_PLAYER_SIZE -
        INTRUSION_FIELD_PADDING,
    ),
  }
  if (
    candidate.x === state.player.x &&
    candidate.y === state.player.y
  ) {
    return settleTheftAndCarrying(state, resources, commandSequence)
  }
  const combatTransition = state.carriedBlockId || state.pendingDiversion
    ? {
        state: state.combat.trail.length === 0
          ? state.combat
          : { ...state.combat, trail: [] },
        events: [] as readonly ResourceCombatEvent[],
      }
    : recordResourceCombatMovement(
        state.combat,
        state.player,
        candidate,
        state.totalElapsedMs,
      )
  return settleTheftAndCarrying(
    {
      ...state,
      player: candidate,
      theft: null,
      combat: combatTransition.state,
      announcement: announcementFromCombatEvents(
        combatTransition.events,
        state.announcement,
      ),
    },
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
