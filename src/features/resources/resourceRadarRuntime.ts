import type {
  IntrusionPoint,
  IntrusionRect,
} from './resourceIntrusionRuntime'
import type { ResourceTrailSegment } from './resourceTronCombatRuntime'

export const RESOURCE_RADAR_CONFIG = {
  fieldWidth: 50,
  fieldHeight: 24,
  safeBuffer: 1,
  telegraphMs: 2_200,
  activeMs: 1_600,
  clearMs: 3_000,
  trailClearFadeMs: 180,
  headSuppressionMs: 800,
} as const

export type ResourceRadarPhase =
  | 'dormant'
  | 'idle'
  | 'telegraph'
  | 'active'
  | 'clear'

export interface ResourceRadarLane {
  axis: 'row' | 'column'
  index: number
  width: number
}

export interface ResourceRadarState {
  phase: ResourceRadarPhase
  elapsedMs: number
  sequence: number
  lane: ResourceRadarLane | null
  headDetectedThisEncounter: boolean
  tutorialCycle: boolean
  headInsideLane: boolean
  trailInsideLane: boolean
}

export interface ResourceRadarAdvanceInput {
  deltaMs: number
  radarUnlocked: boolean
  encounterActive: boolean
  seed: string
  suspicionStage: number
  player: IntrusionPoint
  activeTrail: readonly ResourceTrailSegment[]
  exclusion: IntrusionRect
  tutorialCycle: boolean
}

export type ResourceRadarEvent =
  | { type: 'radar-warning-started' }
  | { type: 'radar-trail-cleared'; fadeMs: number }
  | { type: 'radar-head-suppressed'; durationMs: number }
  | { type: 'radar-head-detected' }
  | { type: 'radar-tutorial-completed' }

export interface ResourceRadarTransition {
  state: ResourceRadarState
  events: readonly ResourceRadarEvent[]
}

interface TimeInterval {
  start: number
  end: number
}

const EPSILON = 1e-9

function finiteDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function boundedStage(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(10, Math.max(1, Math.floor(value)))
}

function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function radarTimingForSuspicionStage(stage: number): {
  idleMs: number
  laneWidth: number
} {
  const bounded = boundedStage(stage)
  if (bounded <= 3) return { idleMs: 8_000, laneWidth: 1.5 }
  if (bounded <= 6) return { idleMs: 7_000, laneWidth: 2 }
  if (bounded <= 8) return { idleMs: 6_000, laneWidth: 2.5 }
  return { idleMs: 5_000, laneWidth: 3 }
}

function laneHitsPoint(lane: ResourceRadarLane, point: IntrusionPoint): boolean {
  const coordinate = lane.axis === 'row' ? point.y : point.x
  return Math.abs(coordinate - lane.index) <= lane.width / 2
}

function laneCenters(axis: ResourceRadarLane['axis'], width: number): number[] {
  const extent = axis === 'row'
    ? RESOURCE_RADAR_CONFIG.fieldHeight
    : RESOURCE_RADAR_CONFIG.fieldWidth
  const minimum = width / 2
  const maximum = extent - width / 2
  const centers: number[] = []
  for (let index = minimum; index <= maximum + EPSILON; index += 1) {
    centers.push(Number(index.toFixed(4)))
  }
  return centers
}

export function chooseResourceRadarLane(
  seed: string,
  sequence: number,
  stage: number,
  player: IntrusionPoint,
  tutorialSafe: boolean,
): ResourceRadarLane {
  const timing = radarTimingForSuspicionStage(stage)
  const hash = hashString(
    `${seed}|radar|${Math.max(0, Math.floor(sequence))}|${boundedStage(stage)}`,
  )
  const axis: ResourceRadarLane['axis'] = hash % 2 === 0 ? 'row' : 'column'
  const centers = laneCenters(axis, timing.laneWidth)
  const start = centers.length === 0 ? 0 : hash % centers.length

  for (let offset = 0; offset < centers.length; offset += 1) {
    const lane: ResourceRadarLane = {
      axis,
      index: centers[(start + offset) % centers.length],
      width: timing.laneWidth,
    }
    if (!tutorialSafe || !laneHitsPoint(lane, player)) return lane
  }

  return { axis, index: centers[0] ?? 0, width: timing.laneWidth }
}

function expandRect(rect: IntrusionRect, amount: number): IntrusionRect {
  return {
    x: Math.max(0, rect.x - amount),
    y: Math.max(0, rect.y - amount),
    width: Math.min(
      RESOURCE_RADAR_CONFIG.fieldWidth,
      rect.x + rect.width + amount,
    ) - Math.max(0, rect.x - amount),
    height: Math.min(
      RESOURCE_RADAR_CONFIG.fieldHeight,
      rect.y + rect.height + amount,
    ) - Math.max(0, rect.y - amount),
  }
}

function rectsOverlap(left: IntrusionRect, right: IntrusionRect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function fullLaneRect(lane: ResourceRadarLane): IntrusionRect {
  return lane.axis === 'row'
    ? {
        x: 0,
        y: lane.index - lane.width / 2,
        width: RESOURCE_RADAR_CONFIG.fieldWidth,
        height: lane.width,
      }
    : {
        x: lane.index - lane.width / 2,
        y: 0,
        width: lane.width,
        height: RESOURCE_RADAR_CONFIG.fieldHeight,
      }
}

export function clipResourceRadarLane(
  lane: ResourceRadarLane,
  exclusion: IntrusionRect,
): readonly IntrusionRect[] {
  const laneRect = fullLaneRect(lane)
  const expanded = expandRect(exclusion, RESOURCE_RADAR_CONFIG.safeBuffer)
  if (!rectsOverlap(laneRect, expanded)) return [laneRect]

  if (lane.axis === 'row') {
    const leftWidth = Math.max(0, expanded.x)
    const rightX = Math.min(
      RESOURCE_RADAR_CONFIG.fieldWidth,
      expanded.x + expanded.width,
    )
    return [
      { ...laneRect, width: leftWidth },
      {
        ...laneRect,
        x: rightX,
        width: RESOURCE_RADAR_CONFIG.fieldWidth - rightX,
      },
    ].filter(({ width }) => width > EPSILON)
  }

  const topHeight = Math.max(0, expanded.y)
  const bottomY = Math.min(
    RESOURCE_RADAR_CONFIG.fieldHeight,
    expanded.y + expanded.height,
  )
  return [
    { ...laneRect, height: topHeight },
    {
      ...laneRect,
      y: bottomY,
      height: RESOURCE_RADAR_CONFIG.fieldHeight - bottomY,
    },
  ].filter(({ height }) => height > EPSILON)
}

function pointInsideRect(point: IntrusionPoint, rect: IntrusionRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function intersectIntervals(
  left: TimeInterval,
  right: TimeInterval,
): TimeInterval | null {
  const start = Math.max(left.start, right.start)
  const end = Math.min(left.end, right.end)
  return start <= end + EPSILON ? { start, end } : null
}

function linearRangeInterval(
  initial: number,
  velocity: number,
  minimum: number,
  maximum: number,
): TimeInterval | null {
  if (Math.abs(velocity) <= EPSILON) {
    return initial >= minimum - EPSILON && initial <= maximum + EPSILON
      ? { start: 0, end: 1 }
      : null
  }
  const first = (minimum - initial) / velocity
  const second = (maximum - initial) / velocity
  const interval = {
    start: Math.max(0, Math.min(first, second)),
    end: Math.min(1, Math.max(first, second)),
  }
  return interval.start <= interval.end + EPSILON ? interval : null
}

function segmentIntersectsRect(
  from: IntrusionPoint,
  to: IntrusionPoint,
  rect: IntrusionRect,
): boolean {
  if (pointInsideRect(from, rect) || pointInsideRect(to, rect)) return true
  const horizontal = linearRangeInterval(
    from.x,
    to.x - from.x,
    rect.x,
    rect.x + rect.width,
  )
  const vertical = linearRangeInterval(
    from.y,
    to.y - from.y,
    rect.y,
    rect.y + rect.height,
  )
  return horizontal !== null && vertical !== null &&
    intersectIntervals(horizontal, vertical) !== null
}

function pointInsideLaneRects(
  point: IntrusionPoint,
  lane: ResourceRadarLane,
  exclusion: IntrusionRect,
): boolean {
  return clipResourceRadarLane(lane, exclusion).some((rect) =>
    pointInsideRect(point, rect),
  )
}

function trailInsideLaneRects(
  trail: readonly ResourceTrailSegment[],
  lane: ResourceRadarLane,
  exclusion: IntrusionRect,
): boolean {
  const rectangles = clipResourceRadarLane(lane, exclusion)
  return trail.some((segment) =>
    rectangles.some((rect) =>
      segmentIntersectsRect(segment.from, segment.to, rect),
    ),
  )
}

export function createResourceRadarState(
  tutorialCycle: boolean,
): ResourceRadarState {
  return {
    phase: 'dormant',
    elapsedMs: 0,
    sequence: 0,
    lane: null,
    headDetectedThisEncounter: false,
    tutorialCycle,
    headInsideLane: false,
    trailInsideLane: false,
  }
}

function resetDormant(tutorialCycle: boolean): ResourceRadarState {
  return createResourceRadarState(tutorialCycle)
}

function detectActiveLane(
  state: ResourceRadarState,
  input: ResourceRadarAdvanceInput,
): ResourceRadarTransition {
  if (state.phase !== 'active' || !state.lane) {
    return { state, events: [] }
  }

  const headInsideLane = pointInsideLaneRects(
    input.player,
    state.lane,
    input.exclusion,
  )
  const trailInsideLane = trailInsideLaneRects(
    input.activeTrail,
    state.lane,
    input.exclusion,
  )
  const events: ResourceRadarEvent[] = []
  let headDetectedThisEncounter = state.headDetectedThisEncounter

  if (trailInsideLane && !state.trailInsideLane) {
    events.push({
      type: 'radar-trail-cleared',
      fadeMs: RESOURCE_RADAR_CONFIG.trailClearFadeMs,
    })
  }
  if (headInsideLane && !state.headInsideLane) {
    events.push({
      type: 'radar-head-suppressed',
      durationMs: RESOURCE_RADAR_CONFIG.headSuppressionMs,
    })
    if (!state.tutorialCycle && !headDetectedThisEncounter) {
      events.push({ type: 'radar-head-detected' })
      headDetectedThisEncounter = true
    }
  }

  return {
    state: {
      ...state,
      headInsideLane,
      trailInsideLane,
      headDetectedThisEncounter,
    },
    events,
  }
}

function phaseDuration(
  state: ResourceRadarState,
  suspicionStage: number,
): number {
  if (state.phase === 'idle') {
    return radarTimingForSuspicionStage(suspicionStage).idleMs
  }
  if (state.phase === 'telegraph') return RESOURCE_RADAR_CONFIG.telegraphMs
  if (state.phase === 'active') return RESOURCE_RADAR_CONFIG.activeMs
  if (state.phase === 'clear') return RESOURCE_RADAR_CONFIG.clearMs
  return Number.POSITIVE_INFINITY
}

function nextPhase(
  state: ResourceRadarState,
  input: ResourceRadarAdvanceInput,
): ResourceRadarTransition {
  if (state.phase === 'idle') {
    const sequence = state.sequence + 1
    return {
      state: {
        ...state,
        phase: 'telegraph',
        elapsedMs: 0,
        sequence,
        lane: chooseResourceRadarLane(
          input.seed,
          sequence,
          input.suspicionStage,
          input.player,
          state.tutorialCycle,
        ),
        headInsideLane: false,
        trailInsideLane: false,
      },
      events: [{ type: 'radar-warning-started' }],
    }
  }
  if (state.phase === 'telegraph') {
    return {
      state: {
        ...state,
        phase: 'active',
        elapsedMs: 0,
        headInsideLane: false,
        trailInsideLane: false,
      },
      events: [],
    }
  }
  if (state.phase === 'active') {
    return {
      state: {
        ...state,
        phase: 'clear',
        elapsedMs: 0,
        headInsideLane: false,
        trailInsideLane: false,
      },
      events: [],
    }
  }
  if (state.phase === 'clear') {
    const completedTutorial = state.tutorialCycle
    return {
      state: {
        ...state,
        phase: 'idle',
        elapsedMs: 0,
        lane: null,
        tutorialCycle: false,
        headInsideLane: false,
        trailInsideLane: false,
      },
      events: completedTutorial
        ? [{ type: 'radar-tutorial-completed' }]
        : [],
    }
  }
  return { state, events: [] }
}

export function advanceResourceRadarState(
  current: ResourceRadarState,
  input: ResourceRadarAdvanceInput,
): ResourceRadarTransition {
  if (!input.radarUnlocked || !input.encounterActive) {
    const dormant = current.phase === 'dormant'
      ? current
      : resetDormant(input.tutorialCycle)
    return { state: dormant, events: [] }
  }

  if (current.phase === 'dormant') {
    return {
      state: {
        ...current,
        phase: 'idle',
        elapsedMs: 0,
        tutorialCycle: input.tutorialCycle,
      },
      events: [],
    }
  }

  const detected = detectActiveLane(current, input)
  let state = detected.state
  const events: ResourceRadarEvent[] = [...detected.events]
  let remainingMs = finiteDuration(input.deltaMs)
  let transitions = 0

  while (remainingMs > EPSILON && transitions < 8) {
    const duration = phaseDuration(state, input.suspicionStage)
    const untilBoundary = Math.max(0, duration - state.elapsedMs)
    if (remainingMs < untilBoundary - EPSILON) {
      state = { ...state, elapsedMs: state.elapsedMs + remainingMs }
      break
    }
    state = { ...state, elapsedMs: duration }
    remainingMs = Math.max(0, remainingMs - untilBoundary)
    const next = nextPhase(state, input)
    state = next.state
    events.push(...next.events)
    transitions += 1
  }

  return { state, events }
}
