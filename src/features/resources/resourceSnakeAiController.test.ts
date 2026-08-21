import { describe, expect, it, vi } from 'vitest'

import { SNAKE_DIRECTION_VECTORS } from './resourceSnakeInput'
import type {
  SnakeGroupPlan,
  SnakePlan,
  SnakePlannerActor,
  SnakePlannerSnapshot,
} from './resourceSnakePlannerTypes'
import { cyanLightcycleProfile } from './resourceSnakeCyanProfile'
import {
  advanceResourceSnakeAiController,
  createResourceSnakeAiControllerState,
  type ResourceSnakeAiControllerDependencies,
} from './resourceSnakeAiController'

function actor(
  id: SnakePlannerActor['id'],
  overrides: Partial<SnakePlannerActor> = {},
): SnakePlannerActor {
  return {
    id,
    position: id === 'player' ? { x: 30, y: 12 } : { x: 10, y: 12 },
    velocity: id === 'player' ? { x: 0, y: -12 } : { x: 12, y: 0 },
    heading: id === 'player' ? 'north' : 'east',
    integrity: 50,
    maximumIntegrity: 50,
    maximumSpeedPerSecond: 12,
    collisionGraceMs: 0,
    distanceSinceTrailDot: 0,
    role: id === 'player' ? null : 'pressure',
    ...overrides,
  }
}

function snapshot(
  simulationMs: number,
  enemies: SnakePlannerActor[] = [actor('enemy-0')],
): SnakePlannerSnapshot {
  const player = actor('player')
  return {
    simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player,
    enemies,
    trailDots: [],
    playerHistory: [{ simulationMs, position: player.position, velocity: player.velocity }],
    committedAllyPaths: [],
  }
}

function plan(
  plannedAtMs: number,
  attackHeading: 'north' | 'south' = 'north',
  fallback = false,
): SnakePlan {
  const profile = cyanLightcycleProfile('cyan-dual-role')
  const direction = SNAKE_DIRECTION_VECTORS[attackHeading]
  const origin = SNAKE_DIRECTION_VECTORS.east
  const stepCount = profile.lookaheadMs / profile.rolloutStepMs
  return {
    enemyId: 'enemy-0',
    intent: fallback ? 'escape' : 'cutoff',
    role: 'pressure',
    direction: { ...direction },
    speedScale: fallback ? 0.92 : 1,
    plannedAtMs,
    commandAtMs: plannedAtMs + profile.telegraphMs,
    stepMs: 50,
    originPosition: { x: 10, y: 12 },
    originVelocity: { x: 12, y: 0 },
    originMaximumSpeedPerSecond: 12,
    directions: Array.from({ length: stepCount }, (_, index) => (
      index * 50 < profile.telegraphMs ? { ...origin } : { ...direction }
    )),
    commitUntilMs: plannedAtMs + profile.telegraphMs + profile.commitMs,
    path: Array.from({ length: stepCount }, (_, index) => ({ x: 10 + index, y: 12 })),
    score: {
      survives: fallback ? 0 : 1,
      reachableArea: 100,
      allyClearance: 10,
      playerAreaReduction: 5,
      cutoffProgress: 1,
      pressureDistance: 4,
      steeringCost: 1,
    },
    candidateIndex: attackHeading === 'north' ? 1 : 2,
    evaluatedCandidates: 96,
    elapsedMs: 0,
    fallback,
    originHeading: 'east',
    attackHeading,
    headingChanges: [
      { offsetMs: 0, heading: 'east' },
      { offsetMs: profile.telegraphMs, heading: attackHeading },
    ],
  }
}

function group(plans: SnakePlan[]): SnakeGroupPlan {
  return {
    plans,
    roles: Object.fromEntries(plans.map((entry) => [entry.enemyId, entry.role])),
    nextPlanningAtMs: plans[0]?.plannedAtMs ?? 0,
    candidateBudget: 96,
    elapsedMs: 0,
  }
}

function dependencies(
  plans: SnakePlan[],
  fatal = false,
): ResourceSnakeAiControllerDependencies {
  return {
    planGroup: vi.fn(() => group(plans)),
    planIsFatal: vi.fn(() => fatal),
  }
}

describe('cyan lightcycle AI controller', () => {
  it('moves from deploy into a stable telegraph while continuing on the origin heading', () => {
    const profile = cyanLightcycleProfile('cyan-dual-role')
    const initial = createResourceSnakeAiControllerState(snapshot(5_000))
    const deployed = advanceResourceSnakeAiController(initial, {
      snapshot: snapshot(5_000), profile, active: false,
    }, dependencies([plan(5_000)]))
    const advertised = advanceResourceSnakeAiController(deployed.state, {
      snapshot: snapshot(5_000), profile, active: true,
    }, dependencies([plan(5_000)]))

    expect(deployed.state.enemies['enemy-0'].phase).toBe('deploy')
    expect(deployed.commands['enemy-0']).toEqual(SNAKE_DIRECTION_VECTORS.east)
    expect(advertised.state.enemies['enemy-0']).toMatchObject({
      phase: 'telegraph',
      advertisedHeading: 'north',
      phaseStartedAtMs: 5_000,
    })
    expect(advertised.commands['enemy-0']).toEqual(SNAKE_DIRECTION_VECTORS.east)
    expect(advertised.telegraphs).toEqual([expect.objectContaining({
      enemyId: 'enemy-0', originHeading: 'east', attackHeading: 'north',
      startedAtMs: 5_000, untilMs: 5_160,
    })])
  })

  it('ignores a merely better plan during telegraph but enters recovery when the commitment becomes fatal', () => {
    const profile = cyanLightcycleProfile('cyan-dual-role')
    const first = plan(5_000, 'north')
    const initial = createResourceSnakeAiControllerState(snapshot(5_000))
    const started = advanceResourceSnakeAiController(initial, {
      snapshot: snapshot(5_000), profile, active: true,
    }, dependencies([first]))
    const replacement = plan(5_072, 'south')
    const stable = advanceResourceSnakeAiController(started.state, {
      snapshot: snapshot(5_072), profile, active: true,
    }, dependencies([replacement], false))
    const fatal = advanceResourceSnakeAiController(stable.state, {
      snapshot: snapshot(5_144), profile, active: true,
    }, dependencies([replacement], true))

    expect(stable.state.enemies['enemy-0'].plan).toBe(first)
    expect(stable.state.enemies['enemy-0'].advertisedHeading).toBe('north')
    expect(fatal.state.enemies['enemy-0'].phase).toBe('recover')
    expect(Math.hypot(
      fatal.commands['enemy-0'].x,
      fatal.commands['enemy-0'].y,
    )).toBeCloseTo(0.92, 12)
  })

  it('applies exactly the advertised heading at telegraph expiry and holds it through commit', () => {
    const profile = cyanLightcycleProfile('cyan-dual-role')
    const selected = plan(5_000, 'north')
    const initial = createResourceSnakeAiControllerState(snapshot(5_000))
    const started = advanceResourceSnakeAiController(initial, {
      snapshot: snapshot(5_000), profile, active: true,
    }, dependencies([selected]))
    const committed = advanceResourceSnakeAiController(started.state, {
      snapshot: snapshot(5_160), profile, active: true,
    }, dependencies([plan(5_160, 'south')], false))
    const held = advanceResourceSnakeAiController(committed.state, {
      snapshot: snapshot(5_300), profile, active: true,
    }, dependencies([plan(5_300, 'south')], false))

    expect(committed.state.enemies['enemy-0'].phase).toBe('commit')
    expect(committed.commands['enemy-0']).toEqual(SNAKE_DIRECTION_VECTORS.north)
    expect(held.state.enemies['enemy-0'].phase).toBe('commit')
    expect(held.commands['enemy-0']).toEqual(SNAKE_DIRECTION_VECTORS.north)
    expect(held.state.enemies['enemy-0'].plan).toBe(selected)
  })

  it('requires two consecutive shared-cadence safe plans to leave nonzero recovery', () => {
    const profile = cyanLightcycleProfile('cyan-dual-role')
    const first = plan(5_000, 'north')
    const initial = createResourceSnakeAiControllerState(snapshot(5_000))
    const started = advanceResourceSnakeAiController(initial, {
      snapshot: snapshot(5_000), profile, active: true,
    }, dependencies([first]))
    const recovering = advanceResourceSnakeAiController(started.state, {
      snapshot: snapshot(5_072), profile, active: true,
    }, dependencies([plan(5_072, 'south', true)], true))
    const firstSafe = advanceResourceSnakeAiController(recovering.state, {
      snapshot: snapshot(5_144), profile, active: true,
    }, dependencies([plan(5_144, 'north')]))
    const secondSafe = advanceResourceSnakeAiController(firstSafe.state, {
      snapshot: snapshot(5_216), profile, active: true,
    }, dependencies([plan(5_216, 'north')]))

    expect(firstSafe.state.enemies['enemy-0']).toMatchObject({
      phase: 'recover', safePlanConfirmations: 1,
    })
    expect(Math.hypot(firstSafe.commands['enemy-0'].x, firstSafe.commands['enemy-0'].y))
      .toBeCloseTo(0.92, 12)
    expect(secondSafe.state.enemies['enemy-0']).toMatchObject({
      phase: 'telegraph', safePlanConfirmations: 0, advertisedHeading: 'north',
    })
  })

  it('plans the entire cyan group once per cadence and marks dead actors defeated', () => {
    const profile = cyanLightcycleProfile('cyan-dual-role')
    const pressure = actor('enemy-0', { role: 'pressure' })
    const blocker = actor('enemy-1', { role: 'blocker', position: { x: 34, y: 12 } })
    const dead = actor('enemy-1', { role: 'blocker', integrity: 0 })
    const initial = createResourceSnakeAiControllerState(snapshot(5_000, [pressure, blocker]))
    const planner = vi.fn(() => group([
      plan(5_000, 'north'),
      { ...plan(5_000, 'south'), enemyId: 'enemy-1', role: 'blocker' },
    ]))
    const started = advanceResourceSnakeAiController(initial, {
      snapshot: snapshot(5_000, [pressure, blocker]), profile, active: true,
    }, { planGroup: planner, planIsFatal: () => false })
    const beforeCadence = advanceResourceSnakeAiController(started.state, {
      snapshot: snapshot(5_050, [pressure, dead]), profile, active: true,
    }, { planGroup: planner, planIsFatal: () => false })

    expect(planner).toHaveBeenCalledTimes(1)
    expect(started.state.enemies['enemy-0'].role).toBe('pressure')
    expect(started.state.enemies['enemy-1'].role).toBe('blocker')
    expect(beforeCadence.state.enemies['enemy-1'].phase).toBe('defeated')
    expect(beforeCadence.commands['enemy-1']).toBeUndefined()
  })
})
