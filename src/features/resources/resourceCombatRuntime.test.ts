import { describe, expect, it } from 'vitest'

import {
  RESOURCE_COMBAT_CONFIG,
  advanceResourceCombatState,
  createResourceCombatState,
  recordResourceCombatMovement,
  synchronizeResourceCombatState,
  type ResourceCombatActor,
  type ResourceCombatResource,
  type ResourceCombatState,
} from './resourceCombatRuntime'

const resources: readonly ResourceCombatResource[] = [
  { blockId: 'reasoning-a', origin: 'reasoning', contribution: 'normal' },
  { blockId: 'memory-a', origin: 'memory', contribution: 'normal' },
  { blockId: 'fluency-a', origin: 'fluency', contribution: 'normal' },
  { blockId: 'reasoning-b', origin: 'reasoning', contribution: 'normal' },
]

const positions = new Map([
  ['reasoning-a', { x: 9, y: 8 }],
  ['memory-a', { x: 23, y: 5 }],
  ['fluency-a', { x: 38, y: 8 }],
  ['reasoning-b', { x: 42, y: 15 }],
])

function replaceActor(
  state: ResourceCombatState,
  blockId: string,
  update: Partial<ResourceCombatActor>,
): ResourceCombatState {
  const actor = state.actors.get(blockId)
  if (!actor) throw new Error(`missing combat actor ${blockId}`)
  return {
    ...state,
    actors: new Map(state.actors).set(blockId, { ...actor, ...update }),
  }
}

function walkRectangle(
  initial: ResourceCombatState,
  bounds: { left: number; top: number; right: number; bottom: number },
  startedAtMs = 0,
): ResourceCombatState {
  const points: { x: number; y: number }[] = []
  for (let x = bounds.left; x <= bounds.right; x += 1) {
    points.push({ x, y: bounds.top })
  }
  for (let y = bounds.top + 1; y <= bounds.bottom; y += 1) {
    points.push({ x: bounds.right, y })
  }
  for (let x = bounds.right - 1; x >= bounds.left; x -= 1) {
    points.push({ x, y: bounds.bottom })
  }
  for (let y = bounds.bottom - 1; y >= bounds.top; y -= 1) {
    points.push({ x: bounds.left, y })
  }

  let state = initial
  let from = points[0]
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index]
    state = recordResourceCombatMovement(
      state,
      from,
      to,
      startedAtMs + index * 72,
    ).state
    from = to
  }
  return state
}

describe('resourceCombatRuntime', () => {
  it('starts a deterministic wave of at most three two-hit triangular resources', () => {
    const first = createResourceCombatState('combat-seed', resources, positions)
    const second = createResourceCombatState('combat-seed', resources, positions)

    expect([...first.actors.keys()]).toEqual([...second.actors.keys()])
    expect(first.actors.size).toBe(3)
    expect(first.waveBlockIds).toHaveLength(3)
    expect([...first.actors.values()].map((actor) => actor.health)).toEqual([
      2, 2, 2,
    ])
    expect([...first.actors.values()].every((actor) => actor.phase === 'tracking'))
      .toBe(true)
    expect(new Set([...first.actors.values()].map((actor) => actor.phaseDurationMs)).size)
      .toBe(3)
  })

  it('keeps a hidden-bomb resource visually indistinguishable and active in combat', () => {
    const withHiddenBomb = resources.map((resource) =>
      resource.blockId === 'reasoning-a'
        ? { ...resource, hiddenBomb: true }
        : resource,
    )

    const state = createResourceCombatState(
      'hidden-bomb-combat',
      withHiddenBomb,
      positions,
    )

    expect(state.waveBlockIds).toContain('reasoning-a')
    expect(state.actors.get('reasoning-a')).toMatchObject({
      health: 2,
      phase: 'tracking',
    })
  })

  it('does not refill a partial wave and advances only after every wave id leaves the field', () => {
    const first = createResourceCombatState('wave-seed', resources, positions)
    const remainingWaveIds = first.waveBlockIds.slice(1)
    const partialResources = resources.filter(
      ({ blockId }) => blockId !== first.waveBlockIds[0],
    )
    const partial = synchronizeResourceCombatState(
      first,
      partialResources,
      positions,
    )

    expect([...partial.actors.keys()].sort()).toEqual([...remainingWaveIds].sort())
    expect(partial.waveNumber).toBe(1)
    expect(partial.actors.has('reasoning-b')).toBe(false)

    const afterWaveResources = resources.filter(
      ({ blockId }) => !first.waveBlockIds.includes(blockId),
    )
    const next = synchronizeResourceCombatState(
      partial,
      afterWaveResources,
      positions,
    )
    expect(next.waveNumber).toBe(2)
    expect([...next.actors.keys()]).toEqual(['reasoning-b'])
  })

  it('telegraphs before charging and keeps staggered attack timing between three actors', () => {
    let state = createResourceCombatState('timing-seed', resources, positions)
    const ordered = [...state.actors.values()].sort(
      (left, right) => left.initiative - right.initiative,
    )
    const firstDuration = ordered[0].phaseDurationMs

    state = advanceResourceCombatState(state, {
      elapsedMs: firstDuration,
      player: { x: 24, y: 12 },
    }).state

    const phases = [...state.actors.values()]
      .sort((left, right) => left.initiative - right.initiative)
      .map((actor) => actor.phase)
    expect(phases[0]).toBe('telegraph')
    expect(phases.slice(1)).toEqual(['tracking', 'tracking'])

    state = advanceResourceCombatState(state, {
      elapsedMs: RESOURCE_COMBAT_CONFIG.telegraphMs,
      player: { x: 24, y: 12 },
    }).state
    expect(
      [...state.actors.values()].sort(
        (left, right) => left.initiative - right.initiative,
      )[0].phase,
    ).toBe('charging')
  })

  it('resolves one authoritative body hit per charge and grants contact invulnerability', () => {
    let state = createResourceCombatState('contact-seed', resources.slice(0, 1), positions)
    state = replaceActor(state, 'reasoning-a', {
      position: { x: 12, y: 10 },
      phase: 'charging',
      phaseElapsedMs: 0,
      phaseDurationMs: 600,
      chargeDirection: { x: 1, y: 0 },
      contactResolved: false,
    })

    const first = advanceResourceCombatState(state, {
      elapsedMs: 16,
      player: { x: 12, y: 10 },
    })
    expect(first.state.playerHealth).toBe(2)
    expect(first.state.playerInvulnerableMs).toBeGreaterThan(0)
    expect(first.events).toContainEqual({
      type: 'player-damaged',
      health: 2,
      blockId: 'reasoning-a',
    })

    const second = advanceResourceCombatState(first.state, {
      elapsedMs: 100,
      player: { x: 12, y: 10 },
    })
    expect(second.state.playerHealth).toBe(2)
    expect(
      second.events.filter((event) => event.type === 'player-damaged'),
    ).toHaveLength(0)
  })

  it('blocks charge motion from entering the opaque base and deposit wave', () => {
    let state = createResourceCombatState('base-seed', resources.slice(0, 1), positions)
    state = replaceActor(state, 'reasoning-a', {
      position: { x: 24, y: 17.3 },
      phase: 'charging',
      phaseElapsedMs: 0,
      phaseDurationMs: 600,
      chargeDirection: { x: 0, y: 1 },
      contactResolved: false,
    })

    const next = advanceResourceCombatState(state, {
      elapsedMs: 100,
      player: { x: 24, y: 21 },
    }).state
    const actor = next.actors.get('reasoning-a')!
    expect(actor.position.y + RESOURCE_COMBAT_CONFIG.actorSize).toBeLessThanOrEqual(
      RESOURCE_COMBAT_CONFIG.safeZone.y,
    )
    expect(actor.phase).toBe('recovering')
  })

  it('protects the player as soon as its body overlaps the deposit wave', () => {
    let state = createResourceCombatState('deposit-shield', resources.slice(0, 1), positions)
    state = replaceActor(state, 'reasoning-a', {
      position: { x: 22.65, y: 17.65 },
      phase: 'charging',
      phaseElapsedMs: 0,
      phaseDurationMs: 600,
      chargeDirection: { x: 1, y: 0 },
      contactResolved: false,
    })

    const transition = advanceResourceCombatState(state, {
      elapsedMs: 1,
      player: { x: 24, y: 18 },
    })

    expect(transition.state.playerHealth).toBe(3)
    expect(transition.events).not.toContainEqual(expect.objectContaining({
      type: 'player-damaged',
    }))
  })

  it('reconstructs the player and current wave without campaign loss at zero health', () => {
    let state = createResourceCombatState('restart-seed', resources.slice(0, 1), positions)
    state = {
      ...state,
      playerHealth: 1,
      trail: [{ x: 4, y: 4, createdAtMs: 0 }],
    }
    state = replaceActor(state, 'reasoning-a', {
      position: { x: 12, y: 10 },
      phase: 'charging',
      phaseElapsedMs: 0,
      phaseDurationMs: 600,
      chargeDirection: { x: 1, y: 0 },
      contactResolved: false,
    })

    const transition = advanceResourceCombatState(state, {
      elapsedMs: 16,
      player: { x: 12, y: 10 },
    })
    expect(transition.state.playerHealth).toBe(3)
    expect(transition.state.respawnCount).toBe(1)
    expect(transition.state.trail).toEqual([])
    expect(transition.state.actors.get('reasoning-a')).toMatchObject({
      health: 2,
      phase: 'tracking',
    })
    expect(transition.events).toContainEqual({ type: 'player-disabled' })
  })

  it('closes a substantial trail, damages every resource inside, and leaves outside resources intact', () => {
    let state = createResourceCombatState('closure-seed', resources, positions)
    state = replaceActor(state, 'reasoning-a', { position: { x: 9, y: 8 } })
    state = replaceActor(state, 'memory-a', { position: { x: 11, y: 9 } })
    state = replaceActor(state, 'fluency-a', { position: { x: 30, y: 8 } })

    state = walkRectangle(state, { left: 5, top: 4, right: 15, bottom: 13 })

    expect(state.actors.get('reasoning-a')).toMatchObject({
      health: 1,
      phase: 'staggered',
    })
    expect(state.actors.get('memory-a')).toMatchObject({
      health: 1,
      phase: 'staggered',
    })
    expect(state.actors.get('fluency-a')).toMatchObject({ health: 2 })
    expect(state.lastCompression?.hitBlockIds.sort()).toEqual([
      'memory-a',
      'reasoning-a',
    ])
    expect(state.trail).toEqual([])
  })

  it('rejects zero-area backtracking and expires unfinished trail after 3.5 seconds', () => {
    let state = createResourceCombatState('trail-seed', resources.slice(0, 1), positions)
    const line = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 7, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ]
    for (let index = 1; index < line.length; index += 1) {
      state = recordResourceCombatMovement(
        state,
        line[index - 1],
        line[index],
        index * 72,
      ).state
    }
    expect(state.lastCompression).toBeNull()
    expect(state.actors.get('reasoning-a')).toMatchObject({ health: 2 })

    state = advanceResourceCombatState(state, {
      elapsedMs: RESOURCE_COMBAT_CONFIG.trailLifetimeMs + 1,
      player: { x: 5, y: 5 },
    }).state
    expect(state.trail).toEqual([])
  })

  it('turns a two-hit triangular resource into square salvage', () => {
    let state = createResourceCombatState('salvage-seed', resources.slice(0, 1), positions)
    state = replaceActor(state, 'reasoning-a', { position: { x: 9, y: 8 } })

    state = walkRectangle(state, { left: 5, top: 4, right: 15, bottom: 13 })
    const secondTraceStartedAt = state.elapsedMs + 600
    state = walkRectangle(
      state,
      { left: 5, top: 4, right: 15, bottom: 13 },
      secondTraceStartedAt,
    )

    expect(state.actors.get('reasoning-a')).toMatchObject({
      health: 0,
      phase: 'salvage',
      chargeDirection: null,
    })
    expect(state.lastCompression?.hitBlockIds).toEqual(['reasoning-a'])
  })
})
