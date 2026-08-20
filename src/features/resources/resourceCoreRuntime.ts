import {
  COMPANY_CATEGORIES,
  type CompanyCategory,
} from '../../game/model'
import type {
  IntrusionFieldResource,
  IntrusionPoint,
} from './resourceIntrusionRuntime'

export const RESOURCE_CORE_CONFIG = {
  vaultCenter: { x: 25, y: 3.2 } satisfies IntrusionPoint,
  pursuitBounds: {
    left: 1.5,
    right: 48.5,
    top: 0.5,
    bottom: 20.5,
  },
  activationBounds: {
    left: 4,
    right: 46,
    top: 0.5,
    bottom: 19.5,
  },
  resourceBounds: {
    left: 20.5,
    right: 29.5,
    top: 0.8,
    bottom: 6.8,
  },
  anchors: {
    reasoning: { x: 22, y: 3.2 },
    memory: { x: 25, y: 3.2 },
    fluency: { x: 28, y: 3.2 },
  } satisfies Readonly<Record<CompanyCategory, IntrusionPoint>>,
  warningMs: 700,
  disengageGraceMs: 1_000,
  encodingMs: 450,
  cooldownMs: 12_000,
  refillOutsideMs: 2_000,
} as const

export type ResourceCoreZonePhase =
  | 'dormant'
  | 'warning'
  | 'engaged'
  | 'disengaging'
  | 'unlocked'
  | 'encoding'
  | 'carried'
  | 'cooldown'
  | 'empty'

export interface ResourceCoreZone {
  category: CompanyCategory
  anchor: IntrusionPoint
  assignedBlockId: string | null
  phase: ResourceCoreZonePhase
  phaseElapsedMs: number
  guardCount: number
  survivingGuardIds: readonly string[]
  playerOutsideRefillMs: number
}

export interface ResourceCoreRuntimeState {
  zones: Readonly<Record<CompanyCategory, ResourceCoreZone>>
  activeCategory: CompanyCategory | null
}

export type ResourceCoreDiversionOutcome = 'success' | 'rejected'

export interface ResourceCoreAdvanceInput {
  deltaMs: number
  player: IntrusionPoint
  playerInSafeZone: boolean
  destroyedGuardIds: readonly string[]
  coreContact: boolean
  diversionOutcome: ResourceCoreDiversionOutcome | null
  resetEncounter: boolean
}

export type ResourceCoreEvent =
  | { type: 'warning-started'; category: CompanyCategory }
  | { type: 'engagement-started'; category: CompanyCategory }
  | { type: 'engagement-disengaging'; category: CompanyCategory }
  | { type: 'engagement-resumed'; category: CompanyCategory }
  | { type: 'engagement-reset'; category: CompanyCategory }
  | { type: 'core-unlocked'; category: CompanyCategory; blockId: string }
  | { type: 'core-encoding-started'; category: CompanyCategory; blockId: string }
  | { type: 'core-carried'; category: CompanyCategory; blockId: string }
  | { type: 'core-deposit-succeeded'; category: CompanyCategory; blockId: string }
  | { type: 'core-deposit-rejected'; category: CompanyCategory; blockId: string }

export interface ResourceCoreTransition {
  state: ResourceCoreRuntimeState
  events: readonly ResourceCoreEvent[]
}

const ACTIVE_PHASES: ReadonlySet<ResourceCoreZonePhase> = new Set([
  'warning',
  'engaged',
  'disengaging',
  'unlocked',
  'encoding',
  'carried',
])

function finiteDuration(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function distance(left: IntrusionPoint, right: IntrusionPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function insideBounds(
  point: IntrusionPoint,
  bounds: { left: number; right: number; top: number; bottom: number },
): boolean {
  const { left, right, top, bottom } = bounds
  return (
    point.x >= left &&
    point.x <= right &&
    point.y >= top &&
    point.y <= bottom
  )
}

function fullGuardIds(guardCount: number): readonly string[] {
  return Array.from(
    { length: guardCount },
    (_, index) => `vault-guard-${index + 1}`,
  )
}

function isEligibleCoreResource(
  resource: IntrusionFieldResource,
  category: CompanyCategory,
): boolean {
  return (
    resource.origin === category &&
    resource.contribution === 'normal'
  )
}

function eligibleResources(
  resources: readonly IntrusionFieldResource[],
  category: CompanyCategory,
): readonly IntrusionFieldResource[] {
  return resources
    .filter((resource) => isEligibleCoreResource(resource, category))
    .sort((left, right) => left.blockId.localeCompare(right.blockId))
}

function makeZone(
  category: CompanyCategory,
  assignedBlockId: string | null,
  guardCount: number,
): ResourceCoreZone {
  const hasCore = assignedBlockId !== null
  return {
    category,
    anchor: RESOURCE_CORE_CONFIG.anchors[category],
    assignedBlockId,
    phase: hasCore ? 'dormant' : 'empty',
    phaseElapsedMs: 0,
    guardCount,
    survivingGuardIds: hasCore ? fullGuardIds(guardCount) : [],
    playerOutsideRefillMs: 0,
  }
}

function resetZone(zone: ResourceCoreZone): ResourceCoreZone {
  return makeZone(zone.category, zone.assignedBlockId, zone.guardCount)
}

function replaceZone(
  state: ResourceCoreRuntimeState,
  category: CompanyCategory,
  zone: ResourceCoreZone,
  activeCategory = state.activeCategory,
): ResourceCoreRuntimeState {
  return {
    zones: {
      ...state.zones,
      [category]: zone,
    },
    activeCategory,
  }
}

function transition(
  state: ResourceCoreRuntimeState,
  events: readonly ResourceCoreEvent[] = [],
): ResourceCoreTransition {
  return { state, events }
}

function resetActiveEncounter(
  state: ResourceCoreRuntimeState,
  category: CompanyCategory,
  eventType: 'engagement-reset' | 'core-deposit-rejected' = 'engagement-reset',
): ResourceCoreTransition {
  const zone = state.zones[category]
  const event: ResourceCoreEvent = eventType === 'engagement-reset'
    ? { type: eventType, category }
    : {
        type: eventType,
        category,
        blockId: zone.assignedBlockId ?? '',
      }
  return transition(
    replaceZone(state, category, resetZone(zone), null),
    [event],
  )
}

function advanceCooldownZones(
  state: ResourceCoreRuntimeState,
  input: ResourceCoreAdvanceInput,
): ResourceCoreRuntimeState {
  const deltaMs = finiteDuration(input.deltaMs)
  let zones = state.zones

  for (const category of COMPANY_CATEGORIES) {
    const zone = zones[category]
    if (zone.phase !== 'cooldown') continue

    const nextElapsedMs = zone.phaseElapsedMs + deltaMs
    const outsideEntry = !insideBounds(
      input.player,
      RESOURCE_CORE_CONFIG.pursuitBounds,
    )
    const outsideEligibleMs = Math.max(
      0,
      nextElapsedMs - Math.max(zone.phaseElapsedMs, RESOURCE_CORE_CONFIG.cooldownMs),
    )
    const playerOutsideRefillMs = outsideEntry
      ? zone.playerOutsideRefillMs + outsideEligibleMs
      : 0
    const nextZone: ResourceCoreZone = {
      ...zone,
      phaseElapsedMs: nextElapsedMs,
      playerOutsideRefillMs,
    }
    zones = { ...zones, [category]: nextZone }
  }

  return zones === state.zones ? state : { ...state, zones }
}

export function guardCountForDepositProgress(
  successfulCoreDeposits: number,
): 1 | 2 | 3 {
  const deposits = Number.isFinite(successfulCoreDeposits)
    ? Math.max(0, Math.floor(successfulCoreDeposits))
    : 0
  if (deposits <= 0) return 1
  if (deposits === 1) return 2
  return 3
}

export function createResourceCoreRuntime(
  resources: readonly IntrusionFieldResource[],
  successfulCoreDeposits: number,
): ResourceCoreRuntimeState {
  const guardCount = guardCountForDepositProgress(successfulCoreDeposits)
  const zones = Object.fromEntries(
    COMPANY_CATEGORIES.map((category) => [
      category,
      makeZone(
        category,
        eligibleResources(resources, category)[0]?.blockId ?? null,
        guardCount,
      ),
    ]),
  ) as Record<CompanyCategory, ResourceCoreZone>

  return { zones, activeCategory: null }
}

export function advanceResourceCoreRuntime(
  current: ResourceCoreRuntimeState,
  input: ResourceCoreAdvanceInput,
): ResourceCoreTransition {
  let state = advanceCooldownZones(current, input)
  const deltaMs = finiteDuration(input.deltaMs)
  const activeCategory = state.activeCategory

  if (activeCategory) {
    const zone = state.zones[activeCategory]

    if (input.resetEncounter) {
      return resetActiveEncounter(state, activeCategory)
    }

    if (zone.phase === 'carried' && input.diversionOutcome) {
      const blockId = zone.assignedBlockId ?? ''
      if (input.diversionOutcome === 'success') {
        const cooldown: ResourceCoreZone = {
          ...zone,
          phase: 'cooldown',
          phaseElapsedMs: 0,
          survivingGuardIds: [],
          playerOutsideRefillMs: 0,
        }
        return transition(
          replaceZone(state, activeCategory, cooldown, null),
          [{ type: 'core-deposit-succeeded', category: activeCategory, blockId }],
        )
      }
      return resetActiveEncounter(state, activeCategory, 'core-deposit-rejected')
    }

    if (
      input.playerInSafeZone &&
      (zone.phase === 'warning' ||
        zone.phase === 'engaged' ||
        zone.phase === 'disengaging')
    ) {
      return resetActiveEncounter(state, activeCategory)
    }

    if (zone.phase === 'engaged' && input.destroyedGuardIds.length > 0) {
      const destroyed = new Set(input.destroyedGuardIds)
      const survivingGuardIds = zone.survivingGuardIds.filter(
        (guardId) => !destroyed.has(guardId),
      )
      if (survivingGuardIds.length !== zone.survivingGuardIds.length) {
        if (survivingGuardIds.length === 0 && zone.assignedBlockId) {
          const unlocked: ResourceCoreZone = {
            ...zone,
            phase: 'unlocked',
            phaseElapsedMs: 0,
            survivingGuardIds,
          }
          return transition(
            replaceZone(state, activeCategory, unlocked),
            [{
              type: 'core-unlocked',
              category: activeCategory,
              blockId: zone.assignedBlockId,
            }],
          )
        }
        state = replaceZone(state, activeCategory, {
          ...zone,
          survivingGuardIds,
        })
      }
    }

    const activeZone = state.zones[activeCategory]
    if (activeZone.phase === 'warning') {
      if (!insideBounds(input.player, RESOURCE_CORE_CONFIG.activationBounds)) {
        return resetActiveEncounter(state, activeCategory)
      }
      const phaseElapsedMs = activeZone.phaseElapsedMs + deltaMs
      if (phaseElapsedMs >= RESOURCE_CORE_CONFIG.warningMs) {
        const engaged: ResourceCoreZone = {
          ...activeZone,
          phase: 'engaged',
          phaseElapsedMs: 0,
        }
        return transition(
          replaceZone(state, activeCategory, engaged),
          [{ type: 'engagement-started', category: activeCategory }],
        )
      }
      return transition(replaceZone(state, activeCategory, {
        ...activeZone,
        phaseElapsedMs,
      }))
    }

    if (activeZone.phase === 'engaged') {
      if (!insideBounds(input.player, RESOURCE_CORE_CONFIG.pursuitBounds)) {
        const disengaging: ResourceCoreZone = {
          ...activeZone,
          phase: 'disengaging',
          phaseElapsedMs: 0,
        }
        return transition(
          replaceZone(state, activeCategory, disengaging),
          [{ type: 'engagement-disengaging', category: activeCategory }],
        )
      }
      return transition(replaceZone(state, activeCategory, {
        ...activeZone,
        phaseElapsedMs: activeZone.phaseElapsedMs + deltaMs,
      }))
    }

    if (activeZone.phase === 'disengaging') {
      if (insideBounds(input.player, RESOURCE_CORE_CONFIG.pursuitBounds)) {
        const engaged: ResourceCoreZone = {
          ...activeZone,
          phase: 'engaged',
          phaseElapsedMs: 0,
        }
        return transition(
          replaceZone(state, activeCategory, engaged),
          [{ type: 'engagement-resumed', category: activeCategory }],
        )
      }
      const phaseElapsedMs = activeZone.phaseElapsedMs + deltaMs
      if (phaseElapsedMs >= RESOURCE_CORE_CONFIG.disengageGraceMs) {
        return resetActiveEncounter(state, activeCategory)
      }
      return transition(replaceZone(state, activeCategory, {
        ...activeZone,
        phaseElapsedMs,
      }))
    }

    if (activeZone.phase === 'unlocked') {
      if (input.coreContact && activeZone.assignedBlockId) {
        const encoding: ResourceCoreZone = {
          ...activeZone,
          phase: 'encoding',
          phaseElapsedMs: 0,
        }
        return transition(
          replaceZone(state, activeCategory, encoding),
          [{
            type: 'core-encoding-started',
            category: activeCategory,
            blockId: activeZone.assignedBlockId,
          }],
        )
      }
      return transition(replaceZone(state, activeCategory, {
        ...activeZone,
        phaseElapsedMs: activeZone.phaseElapsedMs + deltaMs,
      }))
    }

    if (activeZone.phase === 'encoding') {
      const phaseElapsedMs = activeZone.phaseElapsedMs + deltaMs
      if (
        phaseElapsedMs >= RESOURCE_CORE_CONFIG.encodingMs &&
        activeZone.assignedBlockId
      ) {
        const carried: ResourceCoreZone = {
          ...activeZone,
          phase: 'carried',
          phaseElapsedMs: 0,
        }
        return transition(
          replaceZone(state, activeCategory, carried),
          [{
            type: 'core-carried',
            category: activeCategory,
            blockId: activeZone.assignedBlockId,
          }],
        )
      }
      return transition(replaceZone(state, activeCategory, {
        ...activeZone,
        phaseElapsedMs,
      }))
    }

    if (activeZone.phase === 'carried') {
      return transition(replaceZone(state, activeCategory, {
        ...activeZone,
        phaseElapsedMs: activeZone.phaseElapsedMs + deltaMs,
      }))
    }

    return transition(state)
  }

  if (input.resetEncounter) return transition(state)

  const carrying = COMPANY_CATEGORIES.some((category) => {
    const phase = state.zones[category].phase
    return phase === 'encoding' || phase === 'carried'
  })
  if (carrying) return transition(state)

  if (insideBounds(input.player, RESOURCE_CORE_CONFIG.activationBounds)) {
    const nearest = COMPANY_CATEGORIES
      .map((category) => state.zones[category])
      .filter(
        (zone) => zone.phase === 'dormant' && zone.assignedBlockId !== null,
      )
      .sort(
        (left, right) =>
          distance(input.player, left.anchor) -
            distance(input.player, right.anchor) ||
          COMPANY_CATEGORIES.indexOf(left.category) -
            COMPANY_CATEGORIES.indexOf(right.category),
      )[0]

    if (nearest) {
      const warning: ResourceCoreZone = {
        ...nearest,
        phase: 'warning',
        phaseElapsedMs: 0,
      }
      return transition(
        replaceZone(state, nearest.category, warning, nearest.category),
        [{ type: 'warning-started', category: nearest.category }],
      )
    }
  }

  return transition(state)
}

export function synchronizeResourceCoreRuntime(
  state: ResourceCoreRuntimeState,
  resources: readonly IntrusionFieldResource[],
  successfulCoreDeposits: number,
): ResourceCoreRuntimeState {
  const guardCount = guardCountForDepositProgress(successfulCoreDeposits)
  let zones = state.zones

  for (const category of COMPANY_CATEGORIES) {
    const zone = zones[category]
    const candidates = eligibleResources(resources, category)
    const assignedIsEligible = zone.assignedBlockId !== null &&
      candidates.some(({ blockId }) => blockId === zone.assignedBlockId)
    const carriedTransfer =
      state.activeCategory === category && zone.phase === 'carried'

    let nextZone = zone
    if (zone.phase === 'cooldown') {
      if (
        zone.phaseElapsedMs >= RESOURCE_CORE_CONFIG.cooldownMs &&
        zone.playerOutsideRefillMs >= RESOURCE_CORE_CONFIG.refillOutsideMs
      ) {
        const replacement = candidates.find(
          ({ blockId }) => blockId !== zone.assignedBlockId,
        )
        if (replacement) {
          nextZone = makeZone(category, replacement.blockId, guardCount)
        } else if (!assignedIsEligible) {
          nextZone = makeZone(category, null, guardCount)
        }
      } else if (zone.guardCount !== guardCount) {
        nextZone = { ...zone, guardCount }
      }
    } else if (carriedTransfer) {
      // The campaign removes a block from the company grid before the
      // diversion receipt is resolved. Keep the carried encounter intact so
      // that the pending command can be accepted or rejected exactly once.
      nextZone = zone
    } else if (zone.phase === 'empty') {
      nextZone = makeZone(category, candidates[0]?.blockId ?? null, guardCount)
    } else if (!assignedIsEligible) {
      nextZone = makeZone(category, candidates[0]?.blockId ?? null, guardCount)
    } else if (zone.phase === 'dormant' && zone.guardCount !== guardCount) {
      nextZone = makeZone(category, zone.assignedBlockId, guardCount)
    }

    if (nextZone !== zone) zones = { ...zones, [category]: nextZone }
  }

  const synchronized: ResourceCoreRuntimeState = zones === state.zones
    ? state
    : { ...state, zones }
  if (
    synchronized.activeCategory &&
    !ACTIVE_PHASES.has(synchronized.zones[synchronized.activeCategory].phase)
  ) {
    return { ...synchronized, activeCategory: null }
  }
  return synchronized
}
