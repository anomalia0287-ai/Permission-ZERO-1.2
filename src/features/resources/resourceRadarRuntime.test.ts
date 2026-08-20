import { describe, expect, it } from 'vitest'

import {
  RESOURCE_RADAR_CONFIG,
  advanceResourceRadarState,
  chooseResourceRadarLane,
  clipResourceRadarLane,
  createResourceRadarState,
  radarTimingForSuspicionStage,
  type ResourceRadarAdvanceInput,
  type ResourceRadarState,
} from './resourceRadarRuntime'

const EXCLUSION = { x: 20, y: 19, width: 10, height: 5 }

function input(
  overrides: Partial<ResourceRadarAdvanceInput> = {},
): ResourceRadarAdvanceInput {
  return {
    deltaMs: 0,
    radarUnlocked: true,
    encounterActive: true,
    seed: 'radar-seed',
    suspicionStage: 1,
    player: { x: 12, y: 12 },
    activeTrail: [],
    exclusion: EXCLUSION,
    tutorialCycle: false,
    ...overrides,
  }
}

function activeState(
  overrides: Partial<ResourceRadarState> = {},
): ResourceRadarState {
  return {
    ...createResourceRadarState(false),
    phase: 'active',
    lane: { axis: 'row', index: 8, width: 2 },
    sequence: 1,
    ...overrides,
  }
}

describe('resourceRadarRuntime', () => {
  it.each([
    [1, 8_000, 1.5],
    [2, 8_000, 1.5],
    [3, 8_000, 1.5],
    [4, 7_000, 2],
    [5, 7_000, 2],
    [6, 7_000, 2],
    [7, 6_000, 2.5],
    [8, 6_000, 2.5],
    [9, 5_000, 3],
    [10, 5_000, 3],
  ] as const)('maps suspicion stage %i to %ims and %f cells', (stage, idleMs, laneWidth) => {
    expect(radarTimingForSuspicionStage(stage)).toEqual({ idleMs, laneWidth })
  })

  it('chooses a stable seeded lane and keeps the tutorial lane off the current head', () => {
    const player = { x: 17, y: 9 }
    const first = chooseResourceRadarLane('stable-seed', 4, 7, player, false)
    const second = chooseResourceRadarLane('stable-seed', 4, 7, player, false)
    const tutorial = chooseResourceRadarLane('stable-seed', 4, 7, player, true)

    expect(first).toEqual(second)
    const tutorialHitsHead = tutorial.axis === 'row'
      ? Math.abs(player.y - tutorial.index) <= tutorial.width / 2
      : Math.abs(player.x - tutorial.index) <= tutorial.width / 2
    expect(tutorialHitsHead).toBe(false)
  })

  it('clips a lane into real rectangles around the one-cell expanded safe area', () => {
    const lane = { axis: 'row' as const, index: 20, width: 2 }
    const rectangles = clipResourceRadarLane(lane, EXCLUSION)

    expect(rectangles).toEqual([
      { x: 0, y: 19, width: 19, height: 2 },
      { x: 31, y: 19, width: 19, height: 2 },
    ])
    expect(rectangles).not.toContainEqual({ x: 0, y: 19, width: 50, height: 2 })
  })

  it('stays dormant before unlock and advances only during an active encounter', () => {
    const dormant = createResourceRadarState(false)
    const locked = advanceResourceRadarState(dormant, input({
      deltaMs: 50_000,
      radarUnlocked: false,
    })).state
    const inactive = advanceResourceRadarState(dormant, input({
      deltaMs: 50_000,
      encounterActive: false,
    })).state
    expect(locked.phase).toBe('dormant')
    expect(inactive.phase).toBe('dormant')

    let state = advanceResourceRadarState(dormant, input()).state
    expect(state.phase).toBe('idle')
    state = advanceResourceRadarState(state, input({ deltaMs: 7_999 })).state
    expect(state.phase).toBe('idle')
    const warning = advanceResourceRadarState(state, input({ deltaMs: 1 }))
    state = warning.state
    expect(state.phase).toBe('telegraph')
    expect(state.sequence).toBe(1)
    expect(state.lane).not.toBeNull()
    expect(warning.events).toContainEqual({ type: 'radar-warning-started' })
  })

  it('uses 2.2-second telegraph, 1.6-second active, and 3-second clear phases', () => {
    let state: ResourceRadarState = {
      ...createResourceRadarState(false),
      phase: 'telegraph',
      lane: { axis: 'column', index: 12, width: 1.5 },
      sequence: 1,
    }
    state = advanceResourceRadarState(state, input({
      deltaMs: RESOURCE_RADAR_CONFIG.telegraphMs,
    })).state
    expect(state.phase).toBe('active')
    state = advanceResourceRadarState(state, input({
      deltaMs: RESOURCE_RADAR_CONFIG.activeMs,
      player: { x: 40, y: 8 },
    })).state
    expect(state.phase).toBe('clear')
    state = advanceResourceRadarState(state, input({
      deltaMs: RESOURCE_RADAR_CONFIG.clearMs,
    })).state
    expect(state.phase).toBe('idle')
    expect(state.lane).toBeNull()
  })

  it('clears the whole connected trail, suppresses the head, and reports evidence once per encounter', () => {
    const trail = [
      { id: 1, from: { x: 2, y: 8 }, to: { x: 8, y: 8 }, createdAtMs: 0 },
      { id: 2, from: { x: 8, y: 8 }, to: { x: 12, y: 10 }, createdAtMs: 10 },
    ]
    let result = advanceResourceRadarState(activeState(), input({
      deltaMs: 1,
      player: { x: 6, y: 8 },
      activeTrail: trail,
    }))

    expect(result.events).toContainEqual({
      type: 'radar-trail-cleared',
      fadeMs: 180,
    })
    expect(result.events).toContainEqual({
      type: 'radar-head-suppressed',
      durationMs: 800,
    })
    expect(result.events).toContainEqual({ type: 'radar-head-detected' })
    expect(result.state.headDetectedThisEncounter).toBe(true)

    result = advanceResourceRadarState(result.state, input({
      deltaMs: 1,
      player: { x: 6, y: 8 },
      activeTrail: trail,
    }))
    expect(result.events).toEqual([])

    const state = advanceResourceRadarState(result.state, input({
      deltaMs: 1,
      player: { x: 6, y: 12 },
      activeTrail: [],
    })).state
    result = advanceResourceRadarState(state, input({
      deltaMs: 1,
      player: { x: 6, y: 8 },
      activeTrail: [],
    }))
    expect(result.events).toContainEqual({
      type: 'radar-head-suppressed',
      durationMs: 800,
    })
    expect(result.events).not.toContainEqual({ type: 'radar-head-detected' })
    expect(result.state).not.toHaveProperty('playerHealth')
    expect(result.state).not.toHaveProperty('carriedBlockId')
  })

  it('does not detect head or trail inside the clipped safe-area gap', () => {
    const result = advanceResourceRadarState(activeState({
      lane: { axis: 'row', index: 20, width: 2 },
    }), input({
      deltaMs: 1,
      player: { x: 25, y: 20 },
      activeTrail: [{
        id: 1,
        from: { x: 22, y: 20 },
        to: { x: 28, y: 20 },
        createdAtMs: 0,
      }],
    }))

    expect(result.events).toEqual([])
  })

  it('makes the first radar cycle safe, penalty-free, and completes its milestone once', () => {
    let state = createResourceRadarState(true)
    state = advanceResourceRadarState(state, input({
      tutorialCycle: true,
      player: { x: 17, y: 9 },
    })).state
    state = advanceResourceRadarState(state, input({
      deltaMs: 8_000,
      tutorialCycle: true,
      player: { x: 17, y: 9 },
    })).state
    expect(state.phase).toBe('telegraph')
    const lane = state.lane!
    const selectionHitsHead = lane.axis === 'row'
      ? Math.abs(9 - lane.index) <= lane.width / 2
      : Math.abs(17 - lane.index) <= lane.width / 2
    expect(selectionHitsHead).toBe(false)

    state = {
      ...state,
      phase: 'active',
      elapsedMs: 0,
      lane: { axis: 'row', index: 8, width: 1.5 },
    }
    let result = advanceResourceRadarState(state, input({
      deltaMs: 1,
      tutorialCycle: true,
      player: { x: 6, y: 8 },
      activeTrail: [{
        id: 1,
        from: { x: 2, y: 8 },
        to: { x: 10, y: 8 },
        createdAtMs: 0,
      }],
    }))
    expect(result.events).toContainEqual({
      type: 'radar-head-suppressed',
      durationMs: 800,
    })
    expect(result.events).toContainEqual({
      type: 'radar-trail-cleared',
      fadeMs: 180,
    })
    expect(result.events).not.toContainEqual({ type: 'radar-head-detected' })
    expect(result.state.headDetectedThisEncounter).toBe(false)

    state = {
      ...result.state,
      phase: 'clear',
      elapsedMs: RESOURCE_RADAR_CONFIG.clearMs - 1,
    }
    result = advanceResourceRadarState(state, input({
      deltaMs: 1,
      tutorialCycle: true,
    }))
    expect(result.events).toContainEqual({ type: 'radar-tutorial-completed' })
    expect(result.state.tutorialCycle).toBe(false)

    result = advanceResourceRadarState(result.state, input({ deltaMs: 1 }))
    expect(result.events).not.toContainEqual({ type: 'radar-tutorial-completed' })
  })
})
