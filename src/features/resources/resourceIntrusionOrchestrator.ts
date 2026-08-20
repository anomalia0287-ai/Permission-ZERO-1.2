import type { CompanyCategory } from '../../game/model'
import {
  INTRUSION_BASE_BOX,
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_FIELD_HEIGHT,
  INTRUSION_FIELD_PADDING,
  INTRUSION_FIELD_WIDTH,
  INTRUSION_PLAYER_SIZE,
  INTRUSION_PLAYER_START,
  intrusionCellRect,
  intrusionRectsOverlap,
  type IntrusionFieldResource,
  type IntrusionPoint,
  type ResourceIntrusionDiversionOutcome,
} from './resourceIntrusionRuntime'
import {
  advanceResourceCoreRuntime,
  createResourceCoreRuntime,
  synchronizeResourceCoreRuntime,
  type ResourceCoreEvent,
  type ResourceCoreRuntimeState,
} from './resourceCoreRuntime'
import {
  advanceResourceRadarState,
  createResourceRadarState,
  type ResourceRadarEvent,
  type ResourceRadarState,
} from './resourceRadarRuntime'
import {
  advanceResourceCombatState,
  applyResourceCombatResumeGrace,
  createResourceCombatState,
  getResourceTrailPhase,
  recordResourceCombatMovement,
  resetResourceCombatEncounter,
  suppressResourceCombatTrail,
  synchronizeResourceCombatGuards,
  type ResourceCombatEvent,
  type ResourceCombatState,
  type ResourceGuardSpawn,
} from './resourceTronCombatRuntime'

export {
  INTRUSION_BASE_BOX,
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_FIELD_HEIGHT,
  INTRUSION_FIELD_PADDING,
  INTRUSION_FIELD_WIDTH,
  INTRUSION_PLAYER_SIZE,
  INTRUSION_PLAYER_START,
  intrusionCellRect,
  intrusionRectsOverlap,
}
export type {
  IntrusionFieldResource,
  IntrusionPoint,
  ResourceIntrusionDiversionOutcome,
}

export const INTRUSION_TICK_MS = 50
export const INTRUSION_MOVE_INTERVAL_MS = 36
export const INTRUSION_MOVE_STEP = 0.5
export const INTRUSION_CORE_CONTACT_RADIUS = 1.35
const INTRUSION_PLAYER_VELOCITY_MEMORY_MS = 180

export interface IntrusionPendingDiversion {
  blockId: string
  commandSequence: number
}

export interface ResourceIntrusionOrchestratorState {
  seed: string
  player: IntrusionPoint
  playerVelocity: IntrusionPoint
  playerVelocityRemainingMs: number
  core: ResourceCoreRuntimeState
  combat: ResourceCombatState
  radar: ResourceRadarState
  pendingDiversion: IntrusionPendingDiversion | null
  firstCoreCombatTutorialCompleted: boolean
  firstRadarTutorialCompleted: boolean
  hackingTutorialOpened: boolean
  nextOutputId: number
}

type ResourceIntrusionEffectPayload =
  | { type: 'request-diversion'; blockId: string }
  | { type: 'record-radar-detection' }
  | {
      type: 'complete-tutorial-milestone'
      sequenceId: 'first-core-combat' | 'first-radar-cycle'
    }
  | { type: 'open-hacking-tutorial' }

export type ResourceIntrusionRuntimeEffect = ResourceIntrusionEffectPayload & {
  id: number
}

export type ResourceIntrusionEvent =
  | ResourceCoreEvent
  | ResourceCombatEvent
  | ResourceRadarEvent
  | { type: 'player-moved' }
  | { type: 'core-encoded'; blockId: string; category: CompanyCategory }
  | { type: 'deposit-requested'; blockId: string }
  | {
      type: 'deposit-confirmed'
      blockId: string
      category: CompanyCategory
    }
  | {
      type: 'deposit-rejected'
      blockId: string
      outcome: 'rejected' | 'interrogation'
    }

export interface SequencedResourceIntrusionEvent {
  id: number
  event: ResourceIntrusionEvent
}

export interface ResourceIntrusionTransition {
  state: ResourceIntrusionOrchestratorState
  events: readonly SequencedResourceIntrusionEvent[]
  effects: readonly ResourceIntrusionRuntimeEffect[]
}

export interface AdvanceResourceIntrusionInput {
  elapsedMs: number
  resources: readonly IntrusionFieldResource[]
  commandSequence: number
  suspicionStage: number
  successfulCoreDeposits: number
  firstCoreCombatTutorialCompleted: boolean
  firstRadarTutorialCompleted: boolean
}

const GUARDED_SAFE_AREA = INTRUSION_DEPOSIT_BOX

function finiteDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function playerCenter(player: IntrusionPoint): IntrusionPoint {
  return {
    x: player.x + INTRUSION_PLAYER_SIZE / 2,
    y: player.y + INTRUSION_PLAYER_SIZE / 2,
  }
}

function playerInDepositArea(player: IntrusionPoint): boolean {
  return intrusionRectsOverlap(
    intrusionCellRect(player, INTRUSION_PLAYER_SIZE),
    INTRUSION_DEPOSIT_BOX,
  )
}

function coreEncounterRunsRadar(core: ResourceCoreRuntimeState): boolean {
  if (!core.activeCategory) return false
  const phase = core.zones[core.activeCategory].phase
  return (
    phase === 'engaged' ||
    phase === 'unlocked' ||
    phase === 'encoding' ||
    phase === 'carried'
  )
}

function coreRunsGuards(core: ResourceCoreRuntimeState): boolean {
  if (!core.activeCategory) return false
  return core.zones[core.activeCategory].phase === 'engaged'
}

function initiativeFromGuardId(
  guardId: string,
  fallback: number,
): 0 | 1 | 2 {
  const match = guardId.match(/-(\d+)$/)
  const parsed = match ? Number(match[1]) - 1 : fallback
  return Math.min(2, Math.max(0, parsed)) as 0 | 1 | 2
}

const VAULT_GUARD_STARTS: Readonly<Record<0 | 1 | 2, IntrusionPoint>> = {
  0: { x: 25, y: 6.2 },
  1: { x: 22, y: 7.2 },
  2: { x: 28, y: 7.2 },
}

const VAULT_PATROL_ROUTES: Readonly<
  Record<0 | 1 | 2, readonly IntrusionPoint[]>
> = {
  0: [
    { x: 25, y: 6.2 },
    { x: 23.5, y: 6.4 },
    { x: 25, y: 6.8 },
    { x: 26.5, y: 6.4 },
  ],
  1: [
    { x: 22, y: 7.2 },
    { x: 20.8, y: 6.8 },
    { x: 23, y: 7 },
    { x: 21.5, y: 6.4 },
  ],
  2: [
    { x: 28, y: 7.2 },
    { x: 29.2, y: 6.8 },
    { x: 27, y: 7 },
    { x: 28.5, y: 6.4 },
  ],
}

function dormantVaultGuardIds(
  core: ResourceCoreRuntimeState,
): readonly string[] {
  const guardCount = Math.max(
    0,
    ...Object.values(core.zones)
      .filter(({ assignedBlockId }) => assignedBlockId !== null)
      .map(({ guardCount: count }) => count),
  )
  return Array.from(
    { length: guardCount },
    (_, index) => `vault-guard-${index + 1}`,
  )
}

function guardSpawnsForCore(
  core: ResourceCoreRuntimeState,
): readonly ResourceGuardSpawn[] {
  const category = core.activeCategory
  const zone = category ? core.zones[category] : null
  const encounterVisible =
    zone?.phase === 'warning' ||
    zone?.phase === 'engaged' ||
    zone?.phase === 'disengaging'
  if (zone && !encounterVisible) return []

  const guardIds = zone?.survivingGuardIds ?? dormantVaultGuardIds(core)
  const mode = zone?.phase === 'engaged' ? 'combat' : 'patrol'
  return guardIds.map((id, index) => {
    const initiative = initiativeFromGuardId(id, index)
    return {
      id,
      category: category ?? 'memory',
      initiative,
      position: VAULT_GUARD_STARTS[initiative],
      mode,
      patrolWaypoints: VAULT_PATROL_ROUTES[initiative],
    }
  })
}

function withOutputs(
  state: ResourceIntrusionOrchestratorState,
  rawEvents: readonly ResourceIntrusionEvent[],
  rawEffects: readonly ResourceIntrusionEffectPayload[],
): ResourceIntrusionTransition {
  let nextOutputId = state.nextOutputId
  const events = rawEvents.map((event) => ({ id: nextOutputId++, event }))
  const effects = rawEffects.map((effect) => ({ ...effect, id: nextOutputId++ }))
  return {
    state: nextOutputId === state.nextOutputId
      ? state
      : { ...state, nextOutputId },
    events,
    effects,
  }
}

function resetEncounterPresentation(
  state: ResourceIntrusionOrchestratorState,
): ResourceIntrusionOrchestratorState {
  return {
    ...state,
    combat: resetResourceCombatEncounter(
      state.combat,
      guardSpawnsForCore(state.core),
    ),
    radar: createResourceRadarState(!state.firstRadarTutorialCompleted),
  }
}

export function createResourceIntrusionOrchestrator(
  seed: string,
  resources: readonly IntrusionFieldResource[],
  successfulCoreDeposits: number,
  firstCoreCombatTutorialCompleted: boolean,
  firstRadarTutorialCompleted: boolean,
): ResourceIntrusionOrchestratorState {
  const core = createResourceCoreRuntime(resources, successfulCoreDeposits)
  return {
    seed,
    player: { ...INTRUSION_PLAYER_START },
    playerVelocity: { x: 0, y: 0 },
    playerVelocityRemainingMs: 0,
    core,
    combat: createResourceCombatState(guardSpawnsForCore(core)),
    radar: createResourceRadarState(!firstRadarTutorialCompleted),
    pendingDiversion: null,
    firstCoreCombatTutorialCompleted,
    firstRadarTutorialCompleted,
    hackingTutorialOpened: successfulCoreDeposits > 0,
    nextOutputId: 1,
  }
}

export function synchronizeResourceIntrusionOrchestrator(
  current: ResourceIntrusionOrchestratorState,
  resources: readonly IntrusionFieldResource[],
  successfulCoreDeposits: number,
  firstCoreCombatTutorialCompleted = current.firstCoreCombatTutorialCompleted,
  firstRadarTutorialCompleted = current.firstRadarTutorialCompleted,
): ResourceIntrusionOrchestratorState {
  const core = synchronizeResourceCoreRuntime(
    current.core,
    resources,
    successfulCoreDeposits,
  )
  const firstCoreCompleted =
    current.firstCoreCombatTutorialCompleted || firstCoreCombatTutorialCompleted
  const firstRadarCompleted =
    current.firstRadarTutorialCompleted || firstRadarTutorialCompleted
  let state: ResourceIntrusionOrchestratorState = {
    ...current,
    core,
    firstCoreCombatTutorialCompleted: firstCoreCompleted,
    firstRadarTutorialCompleted: firstRadarCompleted,
  }

  const guardSpawns = guardSpawnsForCore(core)
  state = {
    ...state,
    combat: synchronizeResourceCombatGuards(state.combat, guardSpawns),
  }
  if (!core.activeCategory && current.core.activeCategory) {
    state = resetEncounterPresentation(state)
  }
  if (firstRadarCompleted && state.radar.tutorialCycle) {
    state = { ...state, radar: { ...state.radar, tutorialCycle: false } }
  }
  return state
}

export function getCarriedResourceCoreId(
  state: ResourceIntrusionOrchestratorState,
): string | null {
  const category = state.core.activeCategory
  if (!category) return null
  const zone = state.core.zones[category]
  return zone.phase === 'carried' ? zone.assignedBlockId : null
}

export function moveResourceIntrusionOrchestratorPlayer(
  current: ResourceIntrusionOrchestratorState,
  dx: number,
  dy: number,
): ResourceIntrusionTransition {
  if (current.combat.reconstructionMs !== null) {
    return withOutputs(current, [], [])
  }
  const magnitude = Math.hypot(dx, dy)
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
    return withOutputs(current, [], [])
  }
  const direction = { x: dx / magnitude, y: dy / magnitude }
  const nextPlayer = {
    x: Math.max(
      INTRUSION_FIELD_PADDING,
      Math.min(
        INTRUSION_FIELD_WIDTH - INTRUSION_PLAYER_SIZE - INTRUSION_FIELD_PADDING,
        current.player.x + direction.x * INTRUSION_MOVE_STEP,
      ),
    ),
    y: Math.max(
      INTRUSION_FIELD_PADDING,
      Math.min(
        INTRUSION_FIELD_HEIGHT - INTRUSION_PLAYER_SIZE - INTRUSION_FIELD_PADDING,
        current.player.y + direction.y * INTRUSION_MOVE_STEP,
      ),
    ),
  }
  if (nextPlayer.x === current.player.x && nextPlayer.y === current.player.y) {
    return withOutputs(current, [], [])
  }

  const movement = recordResourceCombatMovement(current.combat, {
    from: playerCenter(current.player),
    to: playerCenter(nextPlayer),
    valid: true,
    safeArea: INTRUSION_DEPOSIT_BOX,
  })
  return withOutputs(
    {
      ...current,
      player: nextPlayer,
      playerVelocity: {
        x: (nextPlayer.x - current.player.x) / INTRUSION_MOVE_INTERVAL_MS,
        y: (nextPlayer.y - current.player.y) / INTRUSION_MOVE_INTERVAL_MS,
      },
      playerVelocityRemainingMs: INTRUSION_PLAYER_VELOCITY_MEMORY_MS,
      combat: movement.state,
    },
    [{ type: 'player-moved' }, ...movement.events],
    [],
  )
}

function coreContact(
  state: ResourceIntrusionOrchestratorState,
): boolean {
  const category = state.core.activeCategory
  if (!category) return false
  const zone = state.core.zones[category]
  return (
    zone.phase === 'unlocked' &&
    Math.hypot(
      playerCenter(state.player).x - zone.anchor.x,
      playerCenter(state.player).y - zone.anchor.y,
    ) <= INTRUSION_CORE_CONTACT_RADIUS
  )
}

function addTutorialAndRadarEffects(
  state: ResourceIntrusionOrchestratorState,
  events: readonly ResourceIntrusionEvent[],
  effects: ResourceIntrusionEffectPayload[],
): ResourceIntrusionOrchestratorState {
  let next = state
  if (
    !next.firstCoreCombatTutorialCompleted &&
    events.some(({ type }) => type === 'core-unlocked')
  ) {
    next = { ...next, firstCoreCombatTutorialCompleted: true }
    effects.push({
      type: 'complete-tutorial-milestone',
      sequenceId: 'first-core-combat',
    })
  }
  if (
    !next.firstRadarTutorialCompleted &&
    events.some(({ type }) => type === 'radar-tutorial-completed')
  ) {
    next = { ...next, firstRadarTutorialCompleted: true }
    effects.push({
      type: 'complete-tutorial-milestone',
      sequenceId: 'first-radar-cycle',
    })
  }
  if (events.some(({ type }) => type === 'radar-head-detected')) {
    effects.push({ type: 'record-radar-detection' })
  }
  return next
}

export function advanceResourceIntrusionOrchestrator(
  current: ResourceIntrusionOrchestratorState,
  input: AdvanceResourceIntrusionInput,
): ResourceIntrusionTransition {
  const elapsedMs = finiteDuration(input.elapsedMs)
  let state = synchronizeResourceIntrusionOrchestrator(
    current,
    input.resources,
    input.successfulCoreDeposits,
    input.firstCoreCombatTutorialCompleted,
    input.firstRadarTutorialCompleted,
  )
  const events: ResourceIntrusionEvent[] = []
  const effects: ResourceIntrusionEffectPayload[] = []
  const reconstructionAtStart = state.combat.reconstructionMs !== null

  if (reconstructionAtStart && state.core.activeCategory) {
    const reset = advanceResourceCoreRuntime(state.core, {
      deltaMs: 0,
      player: playerCenter(state.player),
      playerInSafeZone: playerInDepositArea(state.player),
      destroyedGuardIds: [],
      coreContact: false,
      diversionOutcome: null,
      resetEncounter: true,
    })
    state = { ...state, core: reset.state }
    events.push(...reset.events)
    state = resetEncounterPresentation(state)
  }

  const guardSpawns = guardSpawnsForCore(state.core)
  state = {
    ...state,
    combat: synchronizeResourceCombatGuards(state.combat, guardSpawns),
  }
  const center = playerCenter(state.player)
  const observedPlayerVelocity = state.playerVelocityRemainingMs > 0
    ? state.playerVelocity
    : { x: 0, y: 0 }
  const combat = advanceResourceCombatState(state.combat, {
    deltaMs: elapsedMs,
    previousPlayer: center,
    player: center,
    playerVelocity: observedPlayerVelocity,
    opaqueBase: INTRUSION_BASE_BOX,
    guardedSafeArea: GUARDED_SAFE_AREA,
    combatActive: coreRunsGuards(state.core) && !reconstructionAtStart,
    patrolActive: !reconstructionAtStart,
    tutorialEncounter: !state.firstCoreCombatTutorialCompleted,
  })
  state = { ...state, combat: combat.state }
  const playerVelocityRemainingMs = Math.max(
    0,
    state.playerVelocityRemainingMs - elapsedMs,
  )
  state = {
    ...state,
    playerVelocity: playerVelocityRemainingMs > 0
      ? state.playerVelocity
      : { x: 0, y: 0 },
    playerVelocityRemainingMs,
  }
  events.push(...combat.events)

  const activeTrail = state.combat.trail.filter(
    (segment) => getResourceTrailPhase(segment, state.combat.elapsedMs) === 'active',
  )
  const radar = advanceResourceRadarState(state.radar, {
    deltaMs: elapsedMs,
    radarUnlocked: input.successfulCoreDeposits >= 3,
    encounterActive: coreEncounterRunsRadar(state.core) && !reconstructionAtStart,
    seed: state.seed,
    suspicionStage: input.suspicionStage,
    player: center,
    activeTrail,
    exclusion: INTRUSION_DEPOSIT_BOX,
    tutorialCycle: !state.firstRadarTutorialCompleted,
  })
  state = { ...state, radar: radar.state }
  events.push(...radar.events)
  for (const event of radar.events) {
    if (event.type === 'radar-trail-cleared') {
      state = {
        ...state,
        combat: suppressResourceCombatTrail(state.combat, 0),
      }
    } else if (event.type === 'radar-head-suppressed') {
      state = {
        ...state,
        combat: suppressResourceCombatTrail(state.combat, event.durationMs),
      }
    }
  }

  const destroyedGuardIds = combat.events
    .filter((event): event is Extract<ResourceCombatEvent, {
      type: 'guard-destroyed'
    }> => event.type === 'guard-destroyed')
    .map(({ guardId }) => guardId)
  const playerDestroyed = combat.events.some(
    ({ type }) => type === 'player-destroyed',
  )
  const core = advanceResourceCoreRuntime(state.core, {
    deltaMs: elapsedMs,
    player: center,
    playerInSafeZone: playerInDepositArea(state.player),
    destroyedGuardIds,
    coreContact: coreContact(state),
    diversionOutcome: null,
    resetEncounter: reconstructionAtStart || playerDestroyed,
  })
  state = { ...state, core: core.state }
  events.push(...core.events)

  for (const event of core.events) {
    if (event.type === 'core-carried') {
      events.push({
        type: 'core-encoded',
        blockId: event.blockId,
        category: event.category,
      })
    }
  }

  const encounterReset = core.events.some(
    ({ type }) => type === 'engagement-reset',
  )
  if (playerDestroyed || encounterReset) {
    state = resetEncounterPresentation(state)
  } else {
    state = {
      ...state,
      combat: synchronizeResourceCombatGuards(
        state.combat,
        guardSpawnsForCore(state.core),
      ),
    }
    if (!coreEncounterRunsRadar(state.core) && state.radar.phase !== 'dormant') {
      state = {
        ...state,
        radar: createResourceRadarState(!state.firstRadarTutorialCompleted),
      }
    }
  }

  if (combat.events.some(({ type }) => type === 'player-reconstructed')) {
    state = { ...state, player: { ...INTRUSION_PLAYER_START } }
  }

  state = addTutorialAndRadarEffects(state, events, effects)

  const carriedBlockId = getCarriedResourceCoreId(state)
  if (
    carriedBlockId &&
    state.combat.reconstructionMs === null &&
    playerInDepositArea(state.player) &&
    state.pendingDiversion === null
  ) {
    state = {
      ...state,
      pendingDiversion: {
        blockId: carriedBlockId,
        commandSequence: input.commandSequence,
      },
    }
    events.push({ type: 'deposit-requested', blockId: carriedBlockId })
    effects.push({ type: 'request-diversion', blockId: carriedBlockId })
  }

  return withOutputs(state, events, effects)
}

export function resolveResourceIntrusionOrchestratorDiversion(
  current: ResourceIntrusionOrchestratorState,
  outcome: ResourceIntrusionDiversionOutcome,
  resources: readonly IntrusionFieldResource[],
  successfulCoreDeposits: number,
): ResourceIntrusionTransition {
  const pending = current.pendingDiversion
  const category = current.core.activeCategory
  if (!pending || !category || getCarriedResourceCoreId(current) !== pending.blockId) {
    return withOutputs(current, [], [])
  }

  const accepted = outcome.kind === 'success'
  const core = advanceResourceCoreRuntime(current.core, {
    deltaMs: 0,
    player: playerCenter(current.player),
    playerInSafeZone: playerInDepositArea(current.player),
    destroyedGuardIds: [],
    coreContact: false,
    diversionOutcome: accepted ? 'success' : 'rejected',
    resetEncounter: false,
  })
  let state: ResourceIntrusionOrchestratorState = {
    ...current,
    core: synchronizeResourceCoreRuntime(
      core.state,
      resources,
      successfulCoreDeposits,
    ),
    pendingDiversion: null,
  }
  state = resetEncounterPresentation(state)
  const events: ResourceIntrusionEvent[] = [...core.events]
  const effects: ResourceIntrusionEffectPayload[] = []

  if (accepted) {
    events.push({
      type: 'deposit-confirmed',
      blockId: pending.blockId,
      category,
    })
    if (!state.hackingTutorialOpened) {
      state = { ...state, hackingTutorialOpened: true }
      effects.push({ type: 'open-hacking-tutorial' })
    }
  } else {
    events.push({
      type: 'deposit-rejected',
      blockId: pending.blockId,
      outcome: outcome.kind === 'interrogation' ? 'interrogation' : 'rejected',
    })
  }

  return withOutputs(state, events, effects)
}

export function suspendResourceIntrusionOrchestrator(
  state: ResourceIntrusionOrchestratorState,
): ResourceIntrusionOrchestratorState {
  return {
    ...state,
    combat: applyResourceCombatResumeGrace(state.combat),
  }
}
