import { describe, expect, it } from 'vitest'

import {
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_PLAYER_SIZE,
  INTRUSION_PLAYER_START,
  advanceResourceIntrusionOrchestrator,
  createResourceIntrusionOrchestrator,
  getCarriedResourceCoreId,
  moveResourceIntrusionOrchestratorPlayer,
  resolveResourceIntrusionOrchestratorDiversion,
  type AdvanceResourceIntrusionInput,
  type IntrusionFieldResource,
  type ResourceIntrusionOrchestratorState,
} from './resourceIntrusionOrchestrator'
import { RESOURCE_CORE_CONFIG } from './resourceCoreRuntime'
import { RESOURCE_TRON_COMBAT_CONFIG } from './resourceTronCombatRuntime'

const resources: readonly IntrusionFieldResource[] = [
  { blockId: 'reasoning-a', origin: 'reasoning', contribution: 'normal' },
  { blockId: 'reasoning-b', origin: 'reasoning', contribution: 'normal' },
  { blockId: 'memory-a', origin: 'memory', contribution: 'normal' },
  { blockId: 'fluency-a', origin: 'fluency', contribution: 'normal' },
]

function input(
  overrides: Partial<AdvanceResourceIntrusionInput> = {},
): AdvanceResourceIntrusionInput {
  return {
    elapsedMs: 0,
    resources,
    commandSequence: 0,
    suspicionStage: 1,
    successfulCoreDeposits: 0,
    firstCoreCombatTutorialCompleted: false,
    firstRadarTutorialCompleted: false,
    ...overrides,
  }
}

function advance(
  state: ResourceIntrusionOrchestratorState,
  overrides: Partial<AdvanceResourceIntrusionInput> = {},
) {
  return advanceResourceIntrusionOrchestrator(state, input(overrides))
}

function playerTopLeftAt(anchor: { x: number; y: number }) {
  return { x: anchor.x - 1, y: anchor.y - 1 }
}

function engageReasoning(
  deposits = 0,
): ResourceIntrusionOrchestratorState {
  let state = createResourceIntrusionOrchestrator(
    'engage-seed',
    resources,
    deposits,
    false,
    true,
  )
  state = {
    ...state,
    player: playerTopLeftAt(RESOURCE_CORE_CONFIG.anchors.reasoning),
  }
  state = advance(state, { successfulCoreDeposits: deposits }).state
  return advance(state, {
    elapsedMs: RESOURCE_CORE_CONFIG.warningMs,
    successfulCoreDeposits: deposits,
  }).state
}

function unlockedReasoning(
  deposits = 0,
): ResourceIntrusionOrchestratorState {
  const state = engageReasoning(deposits)
  return {
    ...state,
    core: {
      ...state.core,
      activeCategory: 'reasoning',
      zones: {
        ...state.core.zones,
        reasoning: {
          ...state.core.zones.reasoning,
          phase: 'unlocked',
          phaseElapsedMs: 0,
          survivingGuardIds: [],
        },
      },
    },
    combat: {
      ...state.combat,
      guards: new Map(),
      trail: [],
    },
  }
}

function carriedReasoning(
  deposits = 0,
): ResourceIntrusionOrchestratorState {
  let state = unlockedReasoning(deposits)
  state = advance(state, { successfulCoreDeposits: deposits }).state
  return advance(state, {
    elapsedMs: RESOURCE_CORE_CONFIG.encodingMs,
    successfulCoreDeposits: deposits,
  }).state
}

describe('resourceIntrusionOrchestrator', () => {
  it('keeps the player safe while the visible vault guard continuously patrols', () => {
    const initial = createResourceIntrusionOrchestrator(
      'safe-idle',
      resources,
      0,
      false,
      false,
    )
    const initialGuard = [...initial.combat.guards.values()][0]
    const result = advance(initial, { elapsedMs: 500 })
    const movedGuard = [...result.state.combat.guards.values()][0]

    expect(result.state.player).toEqual(INTRUSION_PLAYER_START)
    expect(result.state.combat.playerHealth).toBe(100)
    expect(result.state.combat.guards.size).toBe(1)
    expect(initialGuard?.phase).toBe('patrolling')
    expect(movedGuard?.phase).toBe('patrolling')
    expect(movedGuard?.position).not.toEqual(initialGuard?.position)
    expect(result.state.core.activeCategory).toBeNull()
    expect(result.effects).toEqual([])
  })

  it('holds dormant guards in a compact defense line in front of the cores', () => {
    const state = createResourceIntrusionOrchestrator(
      'defense-line',
      resources,
      2,
      false,
      false,
    )
    const guards = [...state.combat.guards.values()]
    const xs = guards.map(({ position }) => position.x)

    expect(guards).toHaveLength(3)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(9)
    for (const guard of guards) {
      expect(guard.position.y).toBeGreaterThanOrEqual(6.2)
      expect(guard.position.y).toBeLessThanOrEqual(7.2)
      expect(guard.phase).toBe('patrolling')
    }
  })

  it('keeps one shared vault encounter active while the player crosses between cores', () => {
    let state = createResourceIntrusionOrchestrator(
      'single-zone',
      resources,
      0,
      false,
      false,
    )
    state = {
      ...state,
      player: playerTopLeftAt(RESOURCE_CORE_CONFIG.anchors.reasoning),
    }
    state = advance(state).state
    expect(state.core.activeCategory).toBe('reasoning')

    state = {
      ...state,
      player: playerTopLeftAt(RESOURCE_CORE_CONFIG.anchors.memory),
    }
    state = advance(state, { elapsedMs: 1_000 }).state
    expect(state.core.activeCategory).toBe('reasoning')
    expect(
      Object.values(state.core.zones).filter(({ phase }) =>
        ['warning', 'engaged', 'disengaging'].includes(phase),
      ),
    ).toHaveLength(1)
  })

  it('keeps the core locked until the last surviving pursuing guard touches a trail', () => {
    let state = engageReasoning(1)
    const guardIds = state.core.zones.reasoning.survivingGuardIds
    const guards = new Map(state.combat.guards)
    guards.set(guardIds[0], {
      ...guards.get(guardIds[0])!,
      position: { x: 2, y: 3 },
      previousPosition: { x: 2, y: 3 },
      phase: 'pursuing',
      phaseElapsedMs: 0,
      phaseDurationMs: 1_000,
      lockedAimDirection: null,
    })
    guards.set(guardIds[1], {
      ...guards.get(guardIds[1])!,
      position: { x: 0, y: 12 },
      previousPosition: { x: 0, y: 12 },
      phase: 'pursuing',
      phaseElapsedMs: 0,
      phaseDurationMs: 1_000,
    })
    state = {
      ...state,
      combat: {
        ...state.combat,
        guards,
        trail: [{
          id: 1,
          from: { x: 2, y: 1 },
          to: { x: 2, y: 5 },
          createdAtMs: state.combat.elapsedMs,
        }],
      },
    }
    state = advance(state, {
      elapsedMs: 16,
      successfulCoreDeposits: 1,
    }).state
    expect(state.core.zones.reasoning.phase).toBe('engaged')
    expect(state.core.zones.reasoning.survivingGuardIds).toEqual([guardIds[1]])

    const remaining = state.combat.guards.get(guardIds[1])!
    state = {
      ...state,
      combat: {
        ...state.combat,
        guards: new Map(state.combat.guards).set(guardIds[1], {
          ...remaining,
          position: { x: 2, y: 3 },
          previousPosition: { x: 2, y: 3 },
          phase: 'pursuing',
          phaseElapsedMs: 0,
          phaseDurationMs: 1_000,
          lockedAimDirection: null,
        }),
        trail: [{
          id: 2,
          from: { x: 2, y: 1 },
          to: { x: 2, y: 5 },
          createdAtMs: state.combat.elapsedMs,
        }],
      },
    }
    const unlocked = advance(state, {
      elapsedMs: 16,
      successfulCoreDeposits: 1,
    })
    expect(unlocked.state.core.zones.reasoning.phase).toBe('unlocked')
    expect(unlocked.effects.map(({ type }) => type))
      .toContain('complete-tutorial-milestone')
  })

  it('locks ranged aim on the current player head after movement', () => {
    let state = engageReasoning()
    const guardId = state.core.zones.reasoning.survivingGuardIds[0]
    const guard = state.combat.guards.get(guardId)!
    state = {
      ...state,
      combat: {
        ...state.combat,
        guards: new Map(state.combat.guards).set(guardId, {
          ...guard,
          phase: 'pursuing',
          phaseElapsedMs: 0,
          phaseDurationMs: 0,
          lockedAimDirection: null,
        }),
      },
    }

    state = moveResourceIntrusionOrchestratorPlayer(state, 1, 0).state
    const guardBeforeAim = state.combat.guards.get(guardId)!
    const playerCenter = {
      x: state.player.x + INTRUSION_PLAYER_SIZE / 2,
      y: state.player.y + INTRUSION_PLAYER_SIZE / 2,
    }
    const targetDelta = {
      x: playerCenter.x - guardBeforeAim.position.x,
      y: playerCenter.y - guardBeforeAim.position.y,
    }
    const targetLength = Math.hypot(targetDelta.x, targetDelta.y) || 1
    const targetDirectionX = targetDelta.x / targetLength
    state = advance(state, { elapsedMs: 1 }).state

    expect(state.combat.guards.get(guardId)?.phase).toBe('aiming')
    expect(state.combat.guards.get(guardId)?.lockedAimDirection?.x)
      .toBeCloseTo(targetDirectionX, 3)
  })

  it('moves in normalized half-cell increments for smoother diagonal control', () => {
    const state = createResourceIntrusionOrchestrator(
      'smooth-player-motion',
      resources,
      0,
      false,
      false,
    )

    const moved = moveResourceIntrusionOrchestratorPlayer(state, 1, -1).state
    const dx = moved.player.x - state.player.x
    const dy = moved.player.y - state.player.y

    expect(Math.hypot(dx, dy)).toBeCloseTo(0.5, 6)
    expect(dx).toBeCloseTo(Math.SQRT1_2 * 0.5, 6)
    expect(dy).toBeCloseTo(-Math.SQRT1_2 * 0.5, 6)
  })

  it('continues movement during 0.45-second encoding and then carries a square payload', () => {
    let state = unlockedReasoning()
    state = advance(state).state
    expect(state.core.zones.reasoning.phase).toBe('encoding')
    const before = state.player

    state = moveResourceIntrusionOrchestratorPlayer(state, 1, 0).state
    expect(state.player).toEqual({ x: before.x + 0.5, y: before.y })
    state = advance(state, {
      elapsedMs: RESOURCE_CORE_CONFIG.encodingMs - 1,
    }).state
    expect(state.core.zones.reasoning.phase).toBe('encoding')
    state = advance(state, { elapsedMs: 1 }).state
    expect(state.core.zones.reasoning.phase).toBe('carried')
    expect(getCarriedResourceCoreId(state)).toBe('reasoning-a')
  })

  it('blocks other core activation while carrying', () => {
    let state = carriedReasoning()
    state = {
      ...state,
      player: playerTopLeftAt(RESOURCE_CORE_CONFIG.anchors.memory),
    }
    state = advance(state, { elapsedMs: 1_000 }).state

    expect(state.core.activeCategory).toBe('reasoning')
    expect(state.core.zones.reasoning.phase).toBe('carried')
    expect(state.core.zones.memory.phase).toBe('dormant')
  })

  it('returns carried cargo on destruction without requesting diversion', () => {
    let state = carriedReasoning()
    state = {
      ...state,
      combat: {
        ...state.combat,
        playerHealth: 0,
        reconstructionMs: RESOURCE_TRON_COMBAT_CONFIG.reconstructionMs,
      },
    }
    state = {
      ...state,
      player: { x: INTRUSION_DEPOSIT_BOX.x, y: INTRUSION_DEPOSIT_BOX.y },
    }
    const result = advance(state, { elapsedMs: 1 })

    expect(result.state.core.activeCategory).toBeNull()
    expect(result.state.core.zones.reasoning.phase).toBe('dormant')
    expect(getCarriedResourceCoreId(result.state)).toBeNull()
    expect(result.state.pendingDiversion).toBeNull()
    expect(result.effects.map(({ type }) => type))
      .not.toContain('request-diversion')
  })

  it('revives every guard immediately when a live encounter retreats to base', () => {
    let state = engageReasoning(1)
    const zone = state.core.zones.reasoning
    state = {
      ...state,
      core: {
        ...state.core,
        zones: {
          ...state.core.zones,
          reasoning: {
            ...zone,
            survivingGuardIds: zone.survivingGuardIds.slice(1),
          },
        },
      },
      player: INTRUSION_PLAYER_START,
    }
    state = advance(state, { successfulCoreDeposits: 1 }).state

    expect(state.core.activeCategory).toBeNull()
    expect(state.core.zones.reasoning.phase).toBe('dormant')
    expect(state.core.zones.reasoning.survivingGuardIds).toHaveLength(2)
  })

  it('requests one deposit and starts cooldown only for an accepted diversion', () => {
    let carrying = carriedReasoning()
    carrying = { ...carrying, player: INTRUSION_PLAYER_START }
    const requested = advance(carrying, { commandSequence: 12 })
    expect(requested.effects).toContainEqual(expect.objectContaining({
      type: 'request-diversion',
      blockId: 'reasoning-a',
    }))
    expect(requested.state.pendingDiversion).toEqual({
      blockId: 'reasoning-a',
      commandSequence: 12,
    })

    const rejected = resolveResourceIntrusionOrchestratorDiversion(
      requested.state,
      { kind: 'rejected' },
      resources,
      0,
    )
    expect(rejected.state.core.zones.reasoning.phase).toBe('dormant')
    expect(rejected.effects.map(({ type }) => type))
      .not.toContain('open-hacking-tutorial')

    const accepted = resolveResourceIntrusionOrchestratorDiversion(
      requested.state,
      { kind: 'success', origin: 'reasoning' },
      resources.filter(({ blockId }) => blockId !== 'reasoning-a'),
      1,
    )
    expect(accepted.state.core.zones.reasoning.phase).toBe('cooldown')
    expect(accepted.effects.map(({ type }) => type))
      .toContain('open-hacking-tutorial')
  })

  it('treats interrogation like rejection without progress or success feedback', () => {
    let carrying = { ...carriedReasoning(), player: INTRUSION_PLAYER_START }
    carrying = advance(carrying, { commandSequence: 7 }).state
    const result = resolveResourceIntrusionOrchestratorDiversion(
      carrying,
      { kind: 'interrogation' },
      resources,
      0,
    )

    expect(result.state.core.zones.reasoning.phase).toBe('dormant')
    expect(result.events.map(({ event }) => event.type))
      .toContain('deposit-rejected')
    expect(result.events.map(({ event }) => event.type))
      .not.toContain('deposit-confirmed')
  })

  it('emits radar suspicion once and keeps output IDs strictly monotonic', () => {
    let state = engageReasoning(3)
    state = {
      ...state,
      radar: {
        ...state.radar,
        phase: 'active',
        lane: { axis: 'row', index: 4, width: 2 },
        sequence: 1,
        tutorialCycle: false,
      },
    }
    const first = advance(state, {
      elapsedMs: 1,
      successfulCoreDeposits: 3,
      suspicionStage: 4,
      firstRadarTutorialCompleted: true,
    })
    expect(first.effects.map(({ type }) => type))
      .toContain('record-radar-detection')

    const second = advance(first.state, {
      elapsedMs: 1,
      successfulCoreDeposits: 3,
      suspicionStage: 4,
      firstRadarTutorialCompleted: true,
    })
    expect(second.effects.map(({ type }) => type))
      .not.toContain('record-radar-detection')
    const ids = [
      ...first.events.map(({ id }) => id),
      ...first.effects.map(({ id }) => id),
      ...second.events.map(({ id }) => id),
      ...second.effects.map(({ id }) => id),
    ]
    expect(ids).toEqual([...ids].sort((left, right) => left - right))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
