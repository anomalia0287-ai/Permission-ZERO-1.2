import { describe, expect, it } from 'vitest'

import type { CompanyCategory } from '../../game/model'
import {
  RESOURCE_CORE_CONFIG,
  advanceResourceCoreRuntime,
  createResourceCoreRuntime,
  guardCountForDepositProgress,
  synchronizeResourceCoreRuntime,
  type ResourceCoreAdvanceInput,
  type ResourceCoreRuntimeState,
} from './resourceCoreRuntime'
import type {
  IntrusionFieldResource,
  IntrusionPoint,
} from './resourceIntrusionRuntime'

const FAR_FROM_CORES: IntrusionPoint = { x: 49, y: 23 }

const resources: readonly IntrusionFieldResource[] = [
  { blockId: 'reasoning-z', origin: 'reasoning', contribution: 'normal' },
  { blockId: 'fluency-a', origin: 'fluency', contribution: 'normal' },
  { blockId: 'reasoning-a', origin: 'reasoning', contribution: 'normal' },
  { blockId: 'memory-bomb', origin: 'memory', contribution: 'normal', hiddenBomb: true },
  { blockId: 'memory-disguised', origin: 'memory', contribution: 'disguised' },
  { blockId: 'memory-a', origin: 'memory', contribution: 'normal' },
]

function input(
  player: IntrusionPoint,
  overrides: Partial<ResourceCoreAdvanceInput> = {},
): ResourceCoreAdvanceInput {
  return {
    deltaMs: 0,
    player,
    playerInSafeZone: false,
    destroyedGuardIds: [],
    coreContact: false,
    diversionOutcome: null,
    resetEncounter: false,
    ...overrides,
  }
}

function step(
  state: ResourceCoreRuntimeState,
  player: IntrusionPoint,
  overrides: Partial<ResourceCoreAdvanceInput> = {},
): ResourceCoreRuntimeState {
  return advanceResourceCoreRuntime(state, input(player, overrides)).state
}

function engage(
  state: ResourceCoreRuntimeState,
  category: CompanyCategory,
): ResourceCoreRuntimeState {
  const anchor = RESOURCE_CORE_CONFIG.anchors[category]
  const warning = step(state, anchor)
  return step(warning, anchor, { deltaMs: RESOURCE_CORE_CONFIG.warningMs })
}

function carry(
  state: ResourceCoreRuntimeState,
  category: CompanyCategory,
): ResourceCoreRuntimeState {
  const anchor = RESOURCE_CORE_CONFIG.anchors[category]
  const engaged = engage(state, category)
  const unlocked = step(engaged, anchor, {
    destroyedGuardIds: engaged.zones[category].survivingGuardIds,
  })
  const encoding = step(unlocked, anchor, { coreContact: true })
  return step(encoding, anchor, {
    deltaMs: RESOURCE_CORE_CONFIG.encodingMs,
  })
}

describe('resourceCoreRuntime', () => {
  it('clusters all three deterministic resource cores inside one top-center vault', () => {
    const first = createResourceCoreRuntime(resources, 0)
    const second = createResourceCoreRuntime([...resources].reverse(), 0)

    expect(first).toEqual(second)
    expect(first.activeCategory).toBeNull()
    expect(first.zones.reasoning).toMatchObject({
      anchor: { x: 22, y: 3.2 },
      assignedBlockId: 'reasoning-a',
      phase: 'dormant',
    })
    expect(first.zones.memory).toMatchObject({
      anchor: { x: 25, y: 3.2 },
      assignedBlockId: 'memory-a',
      phase: 'dormant',
    })
    expect(first.zones.fluency).toMatchObject({
      anchor: { x: 28, y: 3.2 },
      assignedBlockId: 'fluency-a',
      phase: 'dormant',
    })

    for (const anchor of Object.values(RESOURCE_CORE_CONFIG.anchors)) {
      expect(Math.hypot(
        anchor.x - RESOURCE_CORE_CONFIG.vaultCenter.x,
        anchor.y - RESOURCE_CORE_CONFIG.vaultCenter.y,
      )).toBeLessThan(5)
    }
  })

  it('uses the enlarged pursuit and activation tiers across the upper field', () => {
    expect(RESOURCE_CORE_CONFIG.pursuitBounds).toEqual({
      left: 1.5,
      right: 48.5,
      top: 0.5,
      bottom: 20.5,
    })
    expect(RESOURCE_CORE_CONFIG.activationBounds).toEqual({
      left: 4,
      right: 46,
      top: 0.5,
      bottom: 19.5,
    })
    expect(RESOURCE_CORE_CONFIG.resourceBounds).toEqual({
      left: 20.5,
      right: 29.5,
      top: 0.8,
      bottom: 6.8,
    })
  })

  it('uses one shared entry area and selects the nearest core in the cluster', () => {
    const reasoning = step(createResourceCoreRuntime(resources, 0), { x: 21, y: 14 })
    const memory = step(createResourceCoreRuntime(resources, 0), { x: 25, y: 14 })
    const fluency = step(createResourceCoreRuntime(resources, 0), { x: 29, y: 14 })

    expect(reasoning.activeCategory).toBe('reasoning')
    expect(memory.activeCategory).toBe('memory')
    expect(fluency.activeCategory).toBe('fluency')
  })

  it('keeps the pursuit tier dormant until the player crosses the inner activation tier', () => {
    const initial = createResourceCoreRuntime(resources, 0)
    const pursuitOnly = step(initial, { x: 2, y: 10 })
    const activated = step(pursuitOnly, { x: 4.5, y: 10 })

    expect(pursuitOnly.activeCategory).toBeNull()
    expect(activated.activeCategory).toBe('reasoning')
    expect(activated.zones.reasoning.phase).toBe('warning')
  })

  it('keeps an active guard encounter across the wide field outside the base', () => {
    const engaged = engage(createResourceCoreRuntime(resources, 0), 'memory')
    const advanced = step(engaged, { x: 47, y: 20 }, { deltaMs: 250 })

    expect(advanced.activeCategory).toBe('memory')
    expect(advanced.zones.memory.phase).toBe('engaged')
  })

  it('begins disengaging only after the player leaves the outer pursuit tier', () => {
    const engaged = engage(createResourceCoreRuntime(resources, 0), 'memory')
    const outside = step(engaged, { x: 49, y: 12 }, { deltaMs: 1 })

    expect(outside.activeCategory).toBe('memory')
    expect(outside.zones.memory.phase).toBe('disengaging')
  })

  it('leaves a category empty when it has no normal company resource', () => {
    const state = createResourceCoreRuntime(
      resources.filter(({ origin }) => origin !== 'memory'),
      0,
    )

    expect(state.zones.memory).toMatchObject({
      assignedBlockId: null,
      phase: 'empty',
      survivingGuardIds: [],
    })
  })

  it('treats a hidden bomb as an ordinary core candidate until diversion reveals it', () => {
    const state = createResourceCoreRuntime(
      resources.filter(({ blockId }) => blockId !== 'memory-a'),
      0,
    )

    expect(state.zones.memory).toMatchObject({
      assignedBlockId: 'memory-bomb',
      phase: 'dormant',
      survivingGuardIds: ['vault-guard-1'],
    })
  })

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 3],
    [99, 3],
  ] as const)('uses %i successful deposits to field %i guards', (deposits, guards) => {
    expect(guardCountForDepositProgress(deposits)).toBe(guards)
    expect(createResourceCoreRuntime(resources, deposits).zones.reasoning)
      .toMatchObject({
        guardCount: guards,
        survivingGuardIds: Array.from(
          { length: guards },
          (_, index) => `vault-guard-${index + 1}`,
        ),
      })
  })

  it('moves dormant to warning to engaged and activates only one zone', () => {
    let state = createResourceCoreRuntime(resources, 0)
    const anchor = RESOURCE_CORE_CONFIG.anchors.reasoning

    state = step(state, anchor)
    expect(state.activeCategory).toBe('reasoning')
    expect(state.zones.reasoning.phase).toBe('warning')

    state = step(state, anchor, {
      deltaMs: RESOURCE_CORE_CONFIG.warningMs - 1,
    })
    expect(state.zones.reasoning.phase).toBe('warning')
    state = step(state, anchor, { deltaMs: 1 })
    expect(state.zones.reasoning.phase).toBe('engaged')
    expect(state.zones.memory.phase).toBe('dormant')
    expect(state.zones.fluency.phase).toBe('dormant')
  })

  it('cancels a warning outside the entry radius without changing its guards', () => {
    const initial = createResourceCoreRuntime(resources, 1)
    const warning = step(initial, RESOURCE_CORE_CONFIG.anchors.reasoning)
    const cancelled = step(warning, FAR_FROM_CORES, {
      deltaMs: RESOURCE_CORE_CONFIG.warningMs,
    })

    expect(cancelled.activeCategory).toBeNull()
    expect(cancelled.zones.reasoning).toMatchObject({
      phase: 'dormant',
      phaseElapsedMs: 0,
      survivingGuardIds: initial.zones.reasoning.survivingGuardIds,
    })
  })

  it('preserves an encounter during leash grace and fully resets it after one second', () => {
    const initial = createResourceCoreRuntime(resources, 1)
    const anchor = RESOURCE_CORE_CONFIG.anchors.reasoning
    let state = engage(initial, 'reasoning')
    state = step(state, anchor, {
      destroyedGuardIds: [state.zones.reasoning.survivingGuardIds[0]],
    })
    expect(state.zones.reasoning.survivingGuardIds).toHaveLength(1)

    state = step(state, FAR_FROM_CORES)
    expect(state.zones.reasoning.phase).toBe('disengaging')
    state = step(state, FAR_FROM_CORES, {
      deltaMs: RESOURCE_CORE_CONFIG.disengageGraceMs - 1,
    })
    state = step(state, anchor)
    expect(state.zones.reasoning.phase).toBe('engaged')
    expect(state.zones.reasoning.survivingGuardIds).toHaveLength(1)

    state = step(state, FAR_FROM_CORES)
    state = step(state, FAR_FROM_CORES, {
      deltaMs: RESOURCE_CORE_CONFIG.disengageGraceMs,
    })
    expect(state.activeCategory).toBeNull()
    expect(state.zones.reasoning.phase).toBe('dormant')
    expect(state.zones.reasoning.survivingGuardIds).toHaveLength(2)
  })

  it('resets a live encounter immediately on entering the base safe zone', () => {
    const initial = createResourceCoreRuntime(resources, 2)
    const engaged = engage(initial, 'memory')
    const reset = step(engaged, RESOURCE_CORE_CONFIG.anchors.memory, {
      playerInSafeZone: true,
    })

    expect(reset.activeCategory).toBeNull()
    expect(reset.zones.memory).toMatchObject({
      phase: 'dormant',
      survivingGuardIds: initial.zones.memory.survivingGuardIds,
    })
  })

  it('keeps an unlocked core outside the leash and encodes it for 0.45 seconds', () => {
    const anchor = RESOURCE_CORE_CONFIG.anchors.fluency
    let state = engage(createResourceCoreRuntime(resources, 0), 'fluency')
    state = step(state, anchor, {
      destroyedGuardIds: state.zones.fluency.survivingGuardIds,
    })
    expect(state.zones.fluency.phase).toBe('unlocked')

    state = step(state, FAR_FROM_CORES, { deltaMs: 4_000 })
    expect(state.zones.fluency.phase).toBe('unlocked')
    state = step(state, anchor, { coreContact: true })
    expect(state.zones.fluency.phase).toBe('encoding')
    state = step(state, anchor, {
      deltaMs: RESOURCE_CORE_CONFIG.encodingMs - 1,
    })
    expect(state.zones.fluency.phase).toBe('encoding')
    state = step(state, anchor, { deltaMs: 1 })
    expect(state.zones.fluency.phase).toBe('carried')
  })

  it('enters cooldown only after a successful diversion outcome', () => {
    const carried = carry(createResourceCoreRuntime(resources, 0), 'reasoning')
    const rejected = step(carried, FAR_FROM_CORES, {
      diversionOutcome: 'rejected',
    })
    const succeeded = step(carried, FAR_FROM_CORES, {
      diversionOutcome: 'success',
    })

    expect(rejected.activeCategory).toBeNull()
    expect(rejected.zones.reasoning.phase).toBe('dormant')
    expect(succeeded.activeCategory).toBeNull()
    expect(succeeded.zones.reasoning.phase).toBe('cooldown')
  })

  it('refills the same category only after 12 seconds and two seconds outside', () => {
    const expanded = [
      ...resources,
      { blockId: 'reasoning-b', origin: 'reasoning', contribution: 'normal' },
    ] as const
    const carried = carry(createResourceCoreRuntime(expanded, 0), 'reasoning')
    let state = step(carried, RESOURCE_CORE_CONFIG.anchors.reasoning, {
      diversionOutcome: 'success',
    })

    state = step(state, RESOURCE_CORE_CONFIG.anchors.reasoning, {
      deltaMs: RESOURCE_CORE_CONFIG.cooldownMs,
    })
    state = synchronizeResourceCoreRuntime(state, expanded, 1)
    expect(state.zones.reasoning.phase).toBe('cooldown')

    state = step(state, FAR_FROM_CORES, {
      deltaMs: RESOURCE_CORE_CONFIG.refillOutsideMs - 1,
    })
    state = synchronizeResourceCoreRuntime(state, expanded, 1)
    expect(state.zones.reasoning.phase).toBe('cooldown')

    state = step(state, FAR_FROM_CORES, { deltaMs: 1 })
    state = synchronizeResourceCoreRuntime(state, expanded, 1)
    expect(state.zones.reasoning).toMatchObject({
      phase: 'dormant',
      assignedBlockId: 'reasoning-b',
      guardCount: 2,
      playerOutsideRefillMs: 0,
    })
  })

  it('cancels and reassigns a core whose source block disappears or becomes disguised', () => {
    const initial = engage(createResourceCoreRuntime(resources, 0), 'reasoning')
    const withoutAssigned = resources.filter(
      ({ blockId }) => blockId !== 'reasoning-a',
    )
    const removed = synchronizeResourceCoreRuntime(initial, withoutAssigned, 0)

    expect(removed.activeCategory).toBeNull()
    expect(removed.zones.reasoning).toMatchObject({
      phase: 'dormant',
      assignedBlockId: 'reasoning-z',
    })

    const disguised = synchronizeResourceCoreRuntime(initial, [
      ...withoutAssigned,
      { blockId: 'reasoning-a', origin: 'reasoning', contribution: 'disguised' },
    ], 0)
    expect(disguised.zones.reasoning.assignedBlockId).toBe('reasoning-z')
  })

  it('preserves the eligible assigned block while it is carried', () => {
    const carried = carry(createResourceCoreRuntime(resources, 0), 'reasoning')
    const synchronized = synchronizeResourceCoreRuntime(carried, [
      ...resources,
      { blockId: 'reasoning-0', origin: 'reasoning', contribution: 'normal' },
    ], 0)

    expect(synchronized.activeCategory).toBe('reasoning')
    expect(synchronized.zones.reasoning).toMatchObject({
      phase: 'carried',
      assignedBlockId: 'reasoning-a',
    })
  })

  it('activates an empty frame when a new eligible resource arrives', () => {
    const withoutMemory = resources.filter(({ origin }) => origin !== 'memory')
    const empty = createResourceCoreRuntime(withoutMemory, 2)
    const refilled = synchronizeResourceCoreRuntime(empty, resources, 2)

    expect(refilled.zones.memory).toMatchObject({
      phase: 'dormant',
      assignedBlockId: 'memory-a',
      guardCount: 3,
      survivingGuardIds: [
        'vault-guard-1',
        'vault-guard-2',
        'vault-guard-3',
      ],
    })
  })

  it('returns encoding or carried cargo to a locked full-guard encounter on reset', () => {
    const carried = carry(createResourceCoreRuntime(resources, 2), 'fluency')
    const reset = step(carried, FAR_FROM_CORES, { resetEncounter: true })

    expect(reset.activeCategory).toBeNull()
    expect(reset.zones.fluency).toMatchObject({
      phase: 'dormant',
      assignedBlockId: 'fluency-a',
      survivingGuardIds: [
        'vault-guard-1',
        'vault-guard-2',
        'vault-guard-3',
      ],
    })
  })
})
