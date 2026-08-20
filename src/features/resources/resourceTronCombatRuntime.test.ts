import { describe, expect, it } from 'vitest'

import {
  RESOURCE_TRON_COMBAT_CONFIG,
  advanceResourceCombatState,
  applyResourceCombatResumeGrace,
  createResourceCombatState,
  getResourcePlayerPhase,
  getResourceTrailPhase,
  recordResourceCombatMovement,
  segmentContactTime,
  suppressResourceCombatTrail,
  type AdvanceResourceCombatInput,
  type ResourceCombatState,
  type ResourceGuard,
  type ResourceGuardSpawn,
  type ResourceProjectile,
} from './resourceTronCombatRuntime'

const OPAQUE_BASE = { x: 22.5, y: 21.25, width: 5, height: 1.75 }
const GUARDED_SAFE_AREA = { x: 20.5, y: 19.5, width: 9, height: 4 }

function spawn(
  id: string,
  position = { x: 4, y: 4 },
  initiative: 0 | 1 | 2 = 0,
  mode: 'combat' | 'patrol' = 'combat',
): ResourceGuardSpawn {
  return {
    id,
    category: 'reasoning',
    position,
    initiative,
    mode,
    patrolWaypoints: [
      position,
      { x: position.x + 5, y: position.y },
      { x: position.x + 5, y: position.y + 4 },
    ],
  }
}

function advanceInput(
  overrides: Partial<AdvanceResourceCombatInput> = {},
): AdvanceResourceCombatInput {
  return {
    deltaMs: 0,
    previousPlayer: { x: 12, y: 12 },
    player: { x: 12, y: 12 },
    playerVelocity: { x: 0, y: 0 },
    opaqueBase: OPAQUE_BASE,
    guardedSafeArea: GUARDED_SAFE_AREA,
    combatActive: true,
    patrolActive: false,
    tutorialEncounter: false,
    ...overrides,
  }
}

function advance(
  state: ResourceCombatState,
  overrides: Partial<AdvanceResourceCombatInput>,
) {
  return advanceResourceCombatState(state, advanceInput(overrides))
}

function replaceGuard(
  state: ResourceCombatState,
  id: string,
  update: Partial<ResourceGuard>,
): ResourceCombatState {
  const guard = state.guards.get(id)
  if (!guard) throw new Error(`missing guard ${id}`)
  return {
    ...state,
    guards: new Map(state.guards).set(id, { ...guard, ...update }),
  }
}

function projectile(
  overrides: Partial<ResourceProjectile> = {},
): ResourceProjectile {
  return {
    id: 1,
    sourceGuardId: 'guard-1',
    previousPosition: { x: 6, y: 10 },
    position: { x: 6, y: 10 },
    direction: { x: 1, y: 0 },
    speedPerMs: RESOURCE_TRON_COMBAT_CONFIG.projectileSpeedPerMs,
    ageMs: 0,
    lifetimeMs: RESOURCE_TRON_COMBAT_CONFIG.projectileLifetimeMs,
    ...overrides,
  }
}

describe('resourceTronCombatRuntime', () => {
  it('starts at 100 health with no projectiles and 0/600/1200ms initiatives', () => {
    const state = createResourceCombatState([
      spawn('guard-1', { x: 3, y: 3 }, 0),
      spawn('guard-2', { x: 5, y: 3 }, 1),
      spawn('guard-3', { x: 7, y: 3 }, 2),
    ])

    expect(state.playerHealth).toBe(100)
    expect(state.projectiles).toEqual([])
    expect(state.nextProjectileId).toBe(1)
    expect([...state.guards.values()].map(({ phase }) => phase))
      .toEqual(['pursuing', 'pursuing', 'pursuing'])
    expect([...state.guards.values()].map(({ phaseDurationMs }) => phaseDurationMs))
      .toEqual([0, 600, 1_200])
  })

  it('moves a patrol guard without causing body-contact damage', () => {
    const state = createResourceCombatState([
      spawn('vault-guard-1', { x: 15, y: 5 }, 0, 'patrol'),
    ])
    const result = advance(state, {
      deltaMs: 500,
      combatActive: false,
      patrolActive: true,
      player: { x: 15, y: 5 },
      previousPlayer: { x: 15, y: 5 },
    })

    expect(result.state.guards.get('vault-guard-1')?.position.x)
      .toBeGreaterThan(15)
    expect(result.state.guards.get('vault-guard-1')?.phase).toBe('patrolling')
    expect(result.state.playerHealth).toBe(100)
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'player-damaged' }))
  })

  it('pursues the player head at a readable sub-player speed', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 2, y: 5 })])
    state = replaceGuard(state, 'guard-1', { phase: 'pursuing', phaseDurationMs: 1_000 })
    const before = state.guards.get('guard-1')!.position
    const result = advance(state, {
      deltaMs: 100,
      player: { x: 20, y: 5 },
      previousPlayer: { x: 20, y: 5 },
    })
    const after = result.state.guards.get('guard-1')!.position
    const ratio = Math.hypot(after.x - before.x, after.y - before.y) / (100 / 72)

    expect(after.x).toBeGreaterThan(before.x)
    expect(ratio).toBeGreaterThanOrEqual(0.65)
    expect(ratio).toBeLessThanOrEqual(0.85)
  })

  it('never damages the player through enemy body overlap', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 8, y: 8 })])
    state = replaceGuard(state, 'guard-1', { phase: 'pursuing', phaseDurationMs: 1_000 })
    const result = advance(state, {
      deltaMs: 250,
      previousPlayer: { x: 8, y: 8 },
      player: { x: 8, y: 8 },
    })

    expect(result.state.playerHealth).toBe(100)
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'player-damaged' }))
  })

  it('routes pursuit around an active trail instead of suiciding into it', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 2, y: 5 })])
    state = replaceGuard(state, 'guard-1', { phase: 'pursuing', phaseDurationMs: 2_000 })
    state = {
      ...state,
      trail: [{ id: 1, from: { x: 4, y: 2 }, to: { x: 4, y: 8 }, createdAtMs: 0 }],
    }
    const result = advance(state, {
      deltaMs: 1_000,
      previousPlayer: { x: 10, y: 5 },
      player: { x: 10, y: 5 },
    })
    const guard = result.state.guards.get('guard-1')!

    expect(guard.phase).not.toBe('destroyed')
    expect(Math.abs(guard.position.y - 5)).toBeGreaterThan(0.2)
  })

  it('keeps pursuit outside the protected player base', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 20, y: 21.5 })])
    state = replaceGuard(state, 'guard-1', { phase: 'pursuing', phaseDurationMs: 2_000 })
    const result = advance(state, {
      deltaMs: 2_000,
      previousPlayer: { x: 25, y: 22 },
      player: { x: 25, y: 22 },
    })
    const { position } = result.state.guards.get('guard-1')!

    expect(
      position.x > GUARDED_SAFE_AREA.x &&
      position.x < GUARDED_SAFE_AREA.x + GUARDED_SAFE_AREA.width &&
      position.y > GUARDED_SAFE_AREA.y &&
      position.y < GUARDED_SAFE_AREA.y + GUARDED_SAFE_AREA.height,
    ).toBe(false)
  })

  it('aims for 480ms, then fires once along the direction locked at aim start', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 4, y: 4 })])
    state = replaceGuard(state, 'guard-1', {
      phase: 'pursuing',
      phaseElapsedMs: 0,
      phaseDurationMs: 0,
    })
    let result = advance(state, {
      deltaMs: 1,
      previousPlayer: { x: 12, y: 4 },
      player: { x: 12, y: 4 },
    })
    state = result.state
    const aiming = state.guards.get('guard-1')!
    expect(aiming.phase).toBe('aiming')
    expect(aiming.phaseDurationMs).toBe(480)
    expect(aiming.lockedAimDirection?.x).toBeGreaterThan(0.99)
    expect(result.events).toContainEqual({ type: 'guard-aiming', guardId: 'guard-1' })

    result = advance(state, {
      deltaMs: 480,
      previousPlayer: { x: 4, y: 12 },
      player: { x: 4, y: 12 },
    })
    const fired = result.state.projectiles[0]
    expect(fired.direction.x).toBeGreaterThan(0.99)
    expect(Math.abs(fired.direction.y)).toBeLessThan(0.01)
    expect(result.events).toContainEqual({
      type: 'guard-fired',
      guardId: 'guard-1',
      projectileId: fired.id,
    })
  })

  it('moves a fired projectile in a straight line without homing', () => {
    const state: ResourceCombatState = {
      ...createResourceCombatState(),
      projectiles: [projectile()],
      nextProjectileId: 2,
    }
    const result = advance(state, {
      deltaMs: 250,
      previousPlayer: { x: 20, y: 20 },
      player: { x: 4, y: 4 },
    })
    const moved = result.state.projectiles[0]

    expect(moved.position.x - 6).toBeCloseTo(2, 6)
    expect(moved.position.y).toBe(10)
    expect(moved.direction).toEqual({ x: 1, y: 0 })
  })

  it('removes a projectile after its 3.5-second lifetime', () => {
    const state: ResourceCombatState = {
      ...createResourceCombatState(),
      projectiles: [projectile({ ageMs: 3_400 })],
      nextProjectileId: 2,
    }

    expect(advance(state, { deltaMs: 99 }).state.projectiles).toHaveLength(1)
    expect(advance(state, { deltaMs: 100 }).state.projectiles).toEqual([])
  })

  it('deals exactly 10 health damage per projectile hit and consumes it', () => {
    const state: ResourceCombatState = {
      ...createResourceCombatState(),
      projectiles: [projectile()],
      nextProjectileId: 2,
    }
    const result = advance(state, {
      deltaMs: 500,
      previousPlayer: { x: 9, y: 10 },
      player: { x: 9, y: 10 },
    })

    expect(result.state.playerHealth).toBe(90)
    expect(result.state.projectiles).toEqual([])
    expect(result.events).toContainEqual({
      type: 'player-damaged',
      health: 90,
      guardId: 'guard-1',
      projectileId: 1,
    })
  })

  it('lets simultaneous projectile hits apply 10 damage each', () => {
    const state: ResourceCombatState = {
      ...createResourceCombatState(),
      projectiles: [
        projectile({ id: 1 }),
        projectile({ id: 2, sourceGuardId: 'guard-2' }),
      ],
      nextProjectileId: 3,
    }
    const result = advance(state, {
      deltaMs: 500,
      previousPlayer: { x: 9, y: 10 },
      player: { x: 9, y: 10 },
    })

    expect(result.state.playerHealth).toBe(80)
    expect(result.events.filter(({ type }) => type === 'player-damaged')).toHaveLength(2)
  })

  it('does not damage a player protected inside the base area', () => {
    const state: ResourceCombatState = {
      ...createResourceCombatState(),
      projectiles: [projectile({ position: { x: 20, y: 22 }, previousPosition: { x: 20, y: 22 } })],
      nextProjectileId: 2,
    }
    const result = advance(state, {
      deltaMs: 1_000,
      previousPlayer: { x: 25, y: 22 },
      player: { x: 25, y: 22 },
    })

    expect(result.state.playerHealth).toBe(100)
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'player-damaged' }))
  })

  it('enforces the per-guard 1800ms firing interval', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 4, y: 4 })])
    state = {
      ...replaceGuard(state, 'guard-1', {
        phase: 'aiming',
        phaseElapsedMs: 0,
        phaseDurationMs: 480,
        lockedAimDirection: { x: 1, y: 0 },
        lastShotAtMs: 0,
      }),
      elapsedMs: 1_000,
    }
    const result = advance(state, { deltaMs: 480 })

    expect(result.state.projectiles).toEqual([])
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'guard-fired' }))
  })

  it('enforces a 600ms firing gap across the enemy group', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 4, y: 4 })])
    state = {
      ...replaceGuard(state, 'guard-1', {
        phase: 'aiming',
        phaseElapsedMs: 0,
        phaseDurationMs: 480,
        lockedAimDirection: { x: 1, y: 0 },
      }),
      elapsedMs: 1_000,
      lastGlobalShotAtMs: 900,
    }
    const result = advance(state, { deltaMs: 480 })

    expect(result.state.projectiles).toEqual([])
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'guard-fired' }))
  })

  it('caps the active projectile pool at twelve', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 4, y: 4 })])
    state = {
      ...replaceGuard(state, 'guard-1', {
        phase: 'aiming',
        phaseElapsedMs: 0,
        phaseDurationMs: 480,
        lockedAimDirection: { x: 1, y: 0 },
      }),
      projectiles: Array.from({ length: 12 }, (_, index) => projectile({
        id: index + 1,
        position: { x: 30, y: 2 + index },
        previousPosition: { x: 30, y: 2 + index },
      })),
      nextProjectileId: 13,
    }
    const result = advance(state, { deltaMs: 480 })

    expect(result.state.projectiles).toHaveLength(12)
    expect(result.state.nextProjectileId).toBe(13)
  })

  it('still lets an active trail destroy a guard on swept contact', () => {
    let state = createResourceCombatState([spawn('guard-1', { x: 2, y: 5 })])
    state = replaceGuard(state, 'guard-1', {
      position: { x: 2, y: 5 },
      previousPosition: { x: 2, y: 5 },
      phase: 'pursuing',
      phaseElapsedMs: 0,
      phaseDurationMs: 2_000,
    })
    state = {
      ...state,
      trail: [{ id: 1, from: { x: 2, y: 4.7 }, to: { x: 2, y: 5.3 }, createdAtMs: 0 }],
    }
    const result = advance(state, { deltaMs: 16 })

    expect(result.state.guards.get('guard-1')?.phase).toBe('destroyed')
    expect(result.events).toContainEqual({ type: 'guard-destroyed', guardId: 'guard-1' })
  })

  it('emits open trail segments, clears them at base, and expires them in two phases', () => {
    let state = createResourceCombatState()
    state = recordResourceCombatMovement(state, {
      from: { x: 4, y: 4 },
      to: { x: 8, y: 4 },
      valid: true,
      safeArea: GUARDED_SAFE_AREA,
    }).state
    expect(state.trail).toMatchObject([{
      id: 1,
      from: { x: 4, y: 4 },
      to: { x: 8, y: 4 },
    }])
    expect(getResourceTrailPhase(state.trail[0], 1_499)).toBe('active')
    expect(getResourceTrailPhase(state.trail[0], 1_500)).toBe('fading')
    expect(getResourceTrailPhase(state.trail[0], 1_749)).toBe('fading')
    expect(getResourceTrailPhase(state.trail[0], 1_750)).toBeNull()

    state = recordResourceCombatMovement(state, {
      from: { x: 8, y: 4 },
      to: { x: 25, y: 22 },
      valid: true,
      safeArea: GUARDED_SAFE_AREA,
    }).state
    expect(state.trail).toEqual([])
  })

  it('blocks trail creation while suppressed and grants resume safety', () => {
    let state = suppressResourceCombatTrail(createResourceCombatState(), 800)
    state = recordResourceCombatMovement(state, {
      from: { x: 5, y: 5 },
      to: { x: 7, y: 5 },
      valid: true,
      safeArea: GUARDED_SAFE_AREA,
    }).state
    expect(state.trail).toEqual([])

    state = applyResourceCombatResumeGrace({ ...state, projectiles: [projectile()] })
    const result = advance(state, {
      deltaMs: 400,
      previousPlayer: { x: 9, y: 10 },
      player: { x: 9, y: 10 },
    })
    expect(result.state.playerHealth).toBe(100)
  })

  it('repairs ten health after a 300ms delay and each 750ms base interval', () => {
    let state = { ...createResourceCombatState(), playerHealth: 70 }
    state = advance(state, {
      deltaMs: 1_049,
      previousPlayer: { x: 25, y: 22 },
      player: { x: 25, y: 22 },
    }).state
    expect(state.playerHealth).toBe(70)

    let result = advance(state, {
      deltaMs: 1,
      previousPlayer: { x: 25, y: 22 },
      player: { x: 25, y: 22 },
    })
    expect(result.state.playerHealth).toBe(80)
    expect(result.events).toContainEqual({ type: 'player-repaired', health: 80 })

    result = advance(result.state, {
      deltaMs: 1_500,
      previousPlayer: { x: 25, y: 22 },
      player: { x: 25, y: 22 },
    })
    expect(result.state.playerHealth).toBe(100)
  })

  it('reconstructs at zero health and returns to 100 after 2.5 seconds', () => {
    let state: ResourceCombatState = {
      ...createResourceCombatState(),
      playerHealth: 10,
      projectiles: [projectile()],
    }
    let result = advance(state, {
      deltaMs: 500,
      previousPlayer: { x: 9, y: 10 },
      player: { x: 9, y: 10 },
    })
    state = result.state
    expect(state.playerHealth).toBe(0)
    expect(state.reconstructionMs).toBe(2_500)
    expect(getResourcePlayerPhase(state)).toBe('collapsing')
    expect(result.events).toContainEqual({ type: 'player-destroyed' })

    result = advance(state, { deltaMs: 2_500 })
    expect(result.state.playerHealth).toBe(100)
    expect(result.state.reconstructionMs).toBeNull()
    expect(result.events).toContainEqual({ type: 'player-reconstructed' })
  })

  it('detects swept line contact between coarse simulation ticks', () => {
    const contact = segmentContactTime(
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 7, y: -1 },
      { x: 7, y: 1 },
      0.1,
    )

    expect(contact).not.toBeNull()
    expect(contact!).toBeGreaterThan(0.48)
    expect(contact!).toBeLessThan(0.5)
  })
})
