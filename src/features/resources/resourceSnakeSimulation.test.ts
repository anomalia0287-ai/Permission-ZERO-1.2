import { describe, expect, it } from 'vitest'
import {
  createResourceSnakeEncounter,
  type SnakeResourceCandidate,
} from './resourceSnakeEncounter'
import {
  planResourceSnakeGroup,
  resourceSnakePlanToCommittedPath,
  sampleResourceSnakeCommittedPath,
  sampleResourceSnakePlan,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakeVector,
} from './resourceSnakePlanner'
import {
  RESOURCE_SNAKE_CONFIG,
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeEvent,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeEnemyRole,
  type SnakeTrailDot,
} from './resourceSnakeRuntime'

interface SnakeSimulationMetrics {
  unforcedEnemyDeaths: number
  enemyDeathsByPlayerTrail: number
  enemyBoundaryHits: number
  enemySelfTrailHits: number
  headOnHits: number
  medianPlayerAreaReduction: number
  duplicateRoleCycles: number
  allyPathConflicts: number
  planDurationsMs: number[]
}

type PlayerPolicy = 'stationary' | 'long-straight' | 'alternating-turn' | 'decoy-exit' | 'stop-start'

interface SimulationRun {
  metrics: SnakeSimulationMetrics
  enemySpawns: number
  planningCycles: number
  dualPlanningCycles: number
  committedPlans: number
  forcedEnemyDeaths: number
  replay: string | null
}

interface FixtureMetrics extends SnakeSimulationMetrics {
  tier: string
  policy: PlayerPolicy
  seeds: number
  enemySpawns: number
  planningCycles: number
  dualPlanningCycles: number
  committedPlans: number
  forcedEnemyDeaths: number
  failedSeeds: number[]
}

const SEEDS_PER_FIXTURE = 200
const SIMULATION_DURATION_MS = 6_000
const FRAME_MS = 1_000 / 60
const GRID_SIZE = 0.75
const GRID_WIDTH = Math.ceil(RESOURCE_SNAKE_CONFIG.fieldWidth / GRID_SIZE)
const GRID_HEIGHT = Math.ceil(RESOURCE_SNAKE_CONFIG.fieldHeight / GRID_SIZE)
const RESOURCE_CANDIDATES: readonly SnakeResourceCandidate[] = [
  { blockId: 'reasoning-sim', origin: 'reasoning', contribution: 'normal', hiddenBomb: false },
  { blockId: 'memory-sim', origin: 'memory', contribution: 'normal', hiddenBomb: false },
  { blockId: 'fluency-sim', origin: 'fluency', contribution: 'normal', hiddenBomb: false },
]
const TIERS = [
  { label: 'early-0', successfulDeposits: 0, period: 'early' },
  { label: 'early-3', successfulDeposits: 3, period: 'early' },
  { label: 'middle-6', successfulDeposits: 6, period: 'middle' },
  { label: 'late-9', successfulDeposits: 9, period: 'late' },
  { label: 'late-12', successfulDeposits: 12, period: 'late' },
] as const
const POLICIES: readonly PlayerPolicy[] = [
  'stationary',
  'long-straight',
  'alternating-turn',
  'decoy-exit',
  'stop-start',
]

function hashSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function unitDirection(index: number): SnakeVector {
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ]
  return directions[((index % directions.length) + directions.length) % directions.length]
}

function playerDirection(
  policy: PlayerPolicy,
  elapsedMs: number,
  seed: number,
): SnakeVector {
  const phase = hashSeed(`${policy}:${seed}`)
  if (policy === 'stationary') return { x: 0, y: 0 }
  if (policy === 'long-straight') {
    if (elapsedMs >= 2_400) return { x: 0, y: 0 }
    return phase % 2 === 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }
  }
  if (policy === 'alternating-turn') {
    return unitDirection(Math.floor(elapsedMs / 750) + phase % 4)
  }
  if (policy === 'decoy-exit') {
    const side = phase % 2 === 0 ? 1 : -1
    if (elapsedMs < 1_600) return { x: side, y: 0 }
    if (elapsedMs < 3_200) return { x: -side, y: -0.45 }
    if (elapsedMs < 4_600) return { x: -side, y: 0.45 }
    return { x: 0, y: 0 }
  }
  const cycle = Math.floor(elapsedMs / 800)
  if (elapsedMs % 800 >= 480) return { x: 0, y: 0 }
  return unitDirection(cycle + phase % 4)
}

function plannerActor(actor: SnakeActor, roles: Readonly<Record<string, SnakeEnemyRole>>): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond,
    collisionGraceMs: actor.collisionGraceMs,
    role: actor.kind === 'player' ? null : roles[actor.id] ?? actor.role ?? 'pressure',
  }
}

function plannerTrail(actor: SnakeActor, dot: SnakeTrailDot): SnakePlannerTrailDot {
  return {
    id: dot.id,
    ownerId: actor.id,
    position: { ...dot.position },
    spawnedAtMs: dot.spawnedAtMs,
    expiresAtMs: dot.expiresAtMs,
  }
}

function plannerSnapshot(
  runtime: ResourceSnakeRoundState,
  roles: Readonly<Record<string, SnakeEnemyRole>>,
  history: SnakePlannerSnapshot['playerHistory'],
  previousPlans: readonly SnakePlan[],
): SnakePlannerSnapshot {
  return {
    simulationMs: runtime.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerActor(runtime.player, roles),
    enemies: runtime.enemies.map((enemy) => plannerActor(enemy, roles)),
    trailDots: [runtime.player, ...runtime.enemies].flatMap((actor) => (
      actor.trail.map((dot) => plannerTrail(actor, dot))
    )),
    playerHistory: history.slice(-512),
    committedAllyPaths: previousPlans
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null),
  }
}

function activeRuntime(setup: NonNullable<ReturnType<typeof createResourceSnakeEncounter>['setup']>): ResourceSnakeRoundState {
  let runtime = deployResourceSnakeRound(createIdleResourceSnakeState(), setup)
  runtime = advanceResourceSnakeFrame(runtime, {}, 100)
  runtime = advanceResourceSnakeFrame(runtime, {}, 100)
  runtime = advanceResourceSnakeFrame(runtime, {}, 20)
  return runtime
}

function commandsForPlans(plans: readonly SnakePlan[], simulationMs: number): Record<string, SnakeVector> {
  return Object.fromEntries(plans.map((plan) => {
    const sample = sampleResourceSnakePlan(plan, simulationMs)
    return [plan.enemyId, {
      x: sample.direction.x * sample.speedScale,
      y: sample.direction.y * sample.speedScale,
    }]
  }))
}

function commitmentsConflict(plans: readonly SnakePlan[], simulationMs: number): boolean {
  if (plans.length !== 2) return false
  const commitments = plans.map((plan) => resourceSnakePlanToCommittedPath(plan, simulationMs))
  if (!commitments[0] || !commitments[1]) return false
  const untilMs = Math.min(commitments[0].commitUntilMs, commitments[1].commitUntilMs)
  const times = [...new Set(commitments.flatMap((commitment) => (
    commitment?.samples.map((sample) => sample.atMs) ?? []
  )))].filter((atMs) => atMs <= untilMs).sort((left, right) => left - right)
  return times.some((atMs) => {
    const first = sampleResourceSnakeCommittedPath(commitments[0]!, atMs)
    const second = sampleResourceSnakeCommittedPath(commitments[1]!, atMs)
    return !!first && !!second && Math.hypot(
      first.position.x - second.position.x,
      first.position.y - second.position.y,
    ) <= 0.75
  })
}

function nearestTrailOwner(
  state: ResourceSnakeRoundState,
  point: SnakeVector,
): { ownerId: SnakeActor['id']; dot: SnakeTrailDot } | null {
  let nearest: { ownerId: SnakeActor['id']; dot: SnakeTrailDot; distance: number } | null = null
  for (const actor of [state.player, ...state.enemies]) {
    for (const dot of actor.trail) {
      const dotDistance = Math.hypot(dot.position.x - point.x, dot.position.y - point.y)
      if (dotDistance <= 0.6 && (!nearest || dotDistance < nearest.distance)) {
        nearest = { ownerId: actor.id, dot, distance: dotDistance }
      }
    }
  }
  return nearest && { ownerId: nearest.ownerId, dot: nearest.dot }
}

type CollisionCause =
  | { kind: 'boundary' | 'head-on' | 'unknown' }
  | { kind: 'trail'; ownerId: SnakeActor['id']; dot: SnakeTrailDot }

function collisionCause(
  event: Extract<ResourceSnakeEvent, { type: 'snake-collided' }>,
  prior: ResourceSnakeRoundState,
): CollisionCause {
  if (event.actorIds.length > 1) return { kind: 'head-on' }
  if (
    event.point.x <= RESOURCE_SNAKE_CONFIG.headRadius + 0.06
    || event.point.x >= RESOURCE_SNAKE_CONFIG.fieldWidth - RESOURCE_SNAKE_CONFIG.headRadius - 0.06
    || event.point.y <= RESOURCE_SNAKE_CONFIG.headRadius + 0.06
    || event.point.y >= RESOURCE_SNAKE_CONFIG.fieldHeight - RESOURCE_SNAKE_CONFIG.headRadius - 0.06
  ) return { kind: 'boundary' }
  const nearest = nearestTrailOwner(prior, event.point)
  return nearest ? { kind: 'trail', ownerId: nearest.ownerId, dot: nearest.dot } : { kind: 'unknown' }
}

function playerTrailEnteredAfterCommit(plan: SnakePlan | undefined, dot: SnakeTrailDot): boolean {
  if (!plan || dot.spawnedAtMs <= plan.plannedAtMs) return false
  return plan.path.some((point, index) => (
    plan.plannedAtMs + (index + 1) * plan.stepMs >= dot.spawnedAtMs
    && Math.hypot(point.x - dot.position.x, point.y - dot.position.y) <= 0.6
  ))
}

function markDisk(occupancy: Uint8Array, position: SnakeVector, radius: number): void {
  const minimumX = Math.max(0, Math.floor((position.x - radius) / GRID_SIZE))
  const maximumX = Math.min(GRID_WIDTH - 1, Math.floor((position.x + radius) / GRID_SIZE))
  const minimumY = Math.max(0, Math.floor((position.y - radius) / GRID_SIZE))
  const maximumY = Math.min(GRID_HEIGHT - 1, Math.floor((position.y + radius) / GRID_SIZE))
  const expanded = radius + GRID_SIZE * 0.5
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const dx = (x + 0.5) * GRID_SIZE - position.x
      const dy = (y + 0.5) * GRID_SIZE - position.y
      if (dx * dx + dy * dy <= expanded * expanded) occupancy[y * GRID_WIDTH + x] = 1
    }
  }
}

function playerReachableArea(state: ResourceSnakeRoundState): number {
  const occupancy = new Uint8Array(GRID_WIDTH * GRID_HEIGHT)
  for (let index = 0; index < occupancy.length; index += 1) {
    const x = (index % GRID_WIDTH + 0.5) * GRID_SIZE
    const y = (Math.floor(index / GRID_WIDTH) + 0.5) * GRID_SIZE
    if (x < 0.5 || x > 49.5 || y < 0.5 || y > 23.5) occupancy[index] = 1
  }
  for (const actor of [state.player, ...state.enemies]) {
    for (const dot of actor.trail) {
      if (dot.spawnedAtMs >= state.simulationMs || dot.expiresAtMs <= state.simulationMs) continue
      if (actor.id === 'player' && state.simulationMs - dot.spawnedAtMs < 240) continue
      markDisk(occupancy, dot.position, 0.55)
    }
  }
  const startX = Math.floor(state.player.position.x / GRID_SIZE)
  const startY = Math.floor(state.player.position.y / GRID_SIZE)
  const start = startY * GRID_WIDTH + startX
  occupancy[start] = 0
  const visited = new Uint8Array(occupancy.length)
  const queue = new Int32Array(occupancy.length)
  let read = 0
  let write = 1
  queue[0] = start
  visited[start] = 1
  while (read < write) {
    const index = queue[read]
    read += 1
    const x = index % GRID_WIDTH
    const neighbors = [index - GRID_WIDTH, index + GRID_WIDTH, index - 1, index + 1]
    for (let neighborIndex = 0; neighborIndex < neighbors.length; neighborIndex += 1) {
      const neighbor = neighbors[neighborIndex]
      if (
        neighbor < 0
        || neighbor >= occupancy.length
        || (neighborIndex === 2 && x === 0)
        || (neighborIndex === 3 && x + 1 === GRID_WIDTH)
        || occupancy[neighbor]
        || visited[neighbor]
      ) continue
      visited[neighbor] = 1
      queue[write] = neighbor
      write += 1
    }
  }
  return write
}

function simulationFailed(run: SimulationRun): boolean {
  return run.metrics.unforcedEnemyDeaths > 0
    || run.metrics.duplicateRoleCycles > 0
    || run.metrics.allyPathConflicts > 0
}

function runSimulation(
  tier: typeof TIERS[number],
  policy: PlayerPolicy,
  seed: number,
  captureReplay = false,
): SimulationRun {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: `simulation:${tier.label}:${policy}:${seed}`,
    roundOrdinal: seed + 1,
    successfulDeposits: tier.successfulDeposits,
    candidates: RESOURCE_CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup) throw new Error('simulation fixture requires eligible resources')
  let runtime = activeRuntime(encounter.setup)
  const initialArea = playerReachableArea(runtime)
  const activeStartedAtMs = runtime.simulationMs
  const history: SnakePlannerSnapshot['playerHistory'] = [{
    simulationMs: runtime.simulationMs,
    position: { ...runtime.player.position },
    velocity: { ...runtime.player.velocity },
  }]
  const metrics: SnakeSimulationMetrics = {
    unforcedEnemyDeaths: 0,
    enemyDeathsByPlayerTrail: 0,
    enemyBoundaryHits: 0,
    enemySelfTrailHits: 0,
    headOnHits: 0,
    medianPlayerAreaReduction: 0,
    duplicateRoleCycles: 0,
    allyPathConflicts: 0,
    planDurationsMs: [],
  }
  let roles = Object.fromEntries(runtime.enemies.map((enemy) => [
    enemy.id,
    enemy.role ?? 'pressure',
  ])) as Record<string, SnakeEnemyRole>
  let plans: SnakePlan[] = []
  let nextPlanningAtMs = runtime.simulationMs
  let processedEvents = runtime.events.length
  let planningCycles = 0
  let dualPlanningCycles = 0
  let committedPlans = 0
  let forcedEnemyDeaths = 0
  const decisionTimingHistoryMs: number[] = []
  const lastCollision = new Map<string, CollisionCause>()
  const replayPlans: SnakePlan[][] = []
  while (
    runtime.phase === 'active'
    && runtime.simulationMs < activeStartedAtMs + SIMULATION_DURATION_MS - 1e-6
  ) {
    if (runtime.simulationMs + 1e-6 >= nextPlanningAtMs) {
      const state = plannerSnapshot(runtime, roles, history, plans)
      const planningStartedAt = performance.now()
      const group = planResourceSnakeGroup(
        state,
        encounter.plannerProfile,
        plans,
        decisionTimingHistoryMs,
        () => runtime.simulationMs,
      )
      const observedPlanningMs = performance.now() - planningStartedAt
      plans = group.plans
      roles = group.roles
      nextPlanningAtMs = group.nextPlanningAtMs
      decisionTimingHistoryMs.push(2)
      if (decisionTimingHistoryMs.length > 31) decisionTimingHistoryMs.shift()
      metrics.planDurationsMs.push(observedPlanningMs)
      planningCycles += 1
      if (runtime.enemies.length === 2) {
        dualPlanningCycles += 1
        const roleValues = Object.values(group.roles)
        if (
          roleValues.filter((role) => role === 'pressure').length !== 1
          || roleValues.filter((role) => role === 'blocker').length !== 1
        ) metrics.duplicateRoleCycles += 1
        if (commitmentsConflict(group.plans, runtime.simulationMs)) metrics.allyPathConflicts += 1
      }
      committedPlans += group.plans.filter((plan) => (
        resourceSnakePlanToCommittedPath(plan, runtime.simulationMs) !== null
      )).length
      if (captureReplay) replayPlans.push(group.plans)
    }
    const prior = runtime
    const elapsedMs = runtime.simulationMs - activeStartedAtMs
    runtime = advanceResourceSnakeFrame(runtime, {
      playerDirection: playerDirection(policy, elapsedMs, seed),
      enemyDirections: commandsForPlans(plans, runtime.simulationMs),
    }, FRAME_MS)
    history.push({
      simulationMs: runtime.simulationMs,
      position: { ...runtime.player.position },
      velocity: { ...runtime.player.velocity },
    })
    const newEvents = runtime.events.slice(processedEvents)
    processedEvents = runtime.events.length
    for (const event of newEvents) {
      if (event.type === 'snake-collided') {
        const cause = collisionCause(event, prior)
        for (const actorId of event.actorIds) lastCollision.set(actorId, cause)
        const enemyIds = event.actorIds.filter((actorId) => actorId !== 'player')
        if (cause.kind === 'boundary') metrics.enemyBoundaryHits += enemyIds.length
        if (cause.kind === 'head-on' && enemyIds.length > 0) metrics.headOnHits += 1
        if (cause.kind === 'trail') {
          metrics.enemySelfTrailHits += enemyIds.filter((actorId) => actorId === cause.ownerId).length
        }
      }
      if (event.type === 'snake-died' && event.actorId !== 'player') {
        const cause = lastCollision.get(event.actorId)
        const playerTrail = cause?.kind === 'trail' && cause.ownerId === 'player'
        if (playerTrail) metrics.enemyDeathsByPlayerTrail += 1
        const plan = plans.find((candidate) => candidate.enemyId === event.actorId)
        const forced = playerTrail && playerTrailEnteredAfterCommit(plan, cause.dot)
        if (forced) forcedEnemyDeaths += 1
        else metrics.unforcedEnemyDeaths += 1
      }
    }
  }
  const finalArea = playerReachableArea(runtime)
  metrics.medianPlayerAreaReduction = initialArea === 0
    ? 0
    : Math.max(0, (initialArea - finalArea) / initialArea * 100)
  return {
    metrics,
    enemySpawns: encounter.setup.enemies.length,
    planningCycles,
    dualPlanningCycles,
    committedPlans,
    forcedEnemyDeaths,
    replay: captureReplay ? JSON.stringify({ plans: replayPlans, events: runtime.events }) : null,
  }
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle]
}

function warmPlanner(): void {
  const encounter = createResourceSnakeEncounter({
    campaignSeed: 'simulation-warmup',
    roundOrdinal: 0,
    successfulDeposits: 12,
    candidates: RESOURCE_CANDIDATES,
    bag: { cycle: 0, remainingCategories: [] },
  })
  if (!encounter.setup) throw new Error('warmup encounter missing')
  const runtime = activeRuntime(encounter.setup)
  const roles = Object.fromEntries(runtime.enemies.map((enemy) => [
    enemy.id,
    enemy.role ?? 'pressure',
  ])) as Record<string, SnakeEnemyRole>
  const history = [{
    simulationMs: runtime.simulationMs,
    position: { ...runtime.player.position },
    velocity: { ...runtime.player.velocity },
  }]
  const state = plannerSnapshot(runtime, roles, history, [])
  for (let index = 0; index < 50; index += 1) {
    planResourceSnakeGroup(state, encounter.plannerProfile, [], [], () => runtime.simulationMs)
  }
}

describe('seeded resource snake public-API simulation', () => {
  it('does not turn a decoy exit into a genuine head-on and self-trail death', () => {
    const evidence = [TIERS[0], TIERS[2]].map((tier) => {
      const metrics = runSimulation(tier, 'decoy-exit', 0).metrics
      return {
        tier: tier.label,
        unforcedEnemyDeaths: metrics.unforcedEnemyDeaths,
        enemyDeathsByPlayerTrail: metrics.enemyDeathsByPlayerTrail,
        enemySelfTrailHits: metrics.enemySelfTrailHits,
        headOnHits: metrics.headOnHits,
      }
    })

    expect(evidence).toEqual([
      {
        tier: 'early-0',
        unforcedEnemyDeaths: 0,
        enemyDeathsByPlayerTrail: 0,
        enemySelfTrailHits: 0,
        headOnHits: 0,
      },
      {
        tier: 'middle-6',
        unforcedEnemyDeaths: 0,
        enemyDeathsByPlayerTrail: 0,
        enemySelfTrailHits: 0,
        headOnHits: 0,
      },
    ])
  })

  it('meets every safety, coordination, pressure, and deterministic replay threshold', () => {
    warmPlanner()
    const fixtures: FixtureMetrics[] = []
    for (const tier of TIERS) {
      for (const policy of POLICIES) {
        const reductions: number[] = []
        const failedSeeds: number[] = []
        const fixture: FixtureMetrics = {
          tier: tier.label,
          policy,
          seeds: SEEDS_PER_FIXTURE,
          enemySpawns: 0,
          planningCycles: 0,
          dualPlanningCycles: 0,
          committedPlans: 0,
          forcedEnemyDeaths: 0,
          unforcedEnemyDeaths: 0,
          enemyDeathsByPlayerTrail: 0,
          enemyBoundaryHits: 0,
          enemySelfTrailHits: 0,
          headOnHits: 0,
          medianPlayerAreaReduction: 0,
          duplicateRoleCycles: 0,
          allyPathConflicts: 0,
          planDurationsMs: [],
          failedSeeds,
        }
        for (let seed = 0; seed < SEEDS_PER_FIXTURE; seed += 1) {
          const run = runSimulation(tier, policy, seed)
          fixture.enemySpawns += run.enemySpawns
          fixture.planningCycles += run.planningCycles
          fixture.dualPlanningCycles += run.dualPlanningCycles
          fixture.committedPlans += run.committedPlans
          fixture.forcedEnemyDeaths += run.forcedEnemyDeaths
          fixture.unforcedEnemyDeaths += run.metrics.unforcedEnemyDeaths
          fixture.enemyDeathsByPlayerTrail += run.metrics.enemyDeathsByPlayerTrail
          fixture.enemyBoundaryHits += run.metrics.enemyBoundaryHits
          fixture.enemySelfTrailHits += run.metrics.enemySelfTrailHits
          fixture.headOnHits += run.metrics.headOnHits
          fixture.duplicateRoleCycles += run.metrics.duplicateRoleCycles
          fixture.allyPathConflicts += run.metrics.allyPathConflicts
          fixture.planDurationsMs.push(...run.metrics.planDurationsMs)
          reductions.push(run.metrics.medianPlayerAreaReduction)
          if (simulationFailed(run)) failedSeeds.push(seed)
        }
        fixture.medianPlayerAreaReduction = median(reductions)
        fixtures.push(fixture)
        for (const failedSeed of failedSeeds) {
          const first = runSimulation(tier, policy, failedSeed, true)
          const replayed = runSimulation(tier, policy, failedSeed, true)
          expect(replayed.replay).toBe(first.replay)
        }
      }
    }

    const report = fixtures.map((fixture) => ({
      ...fixture,
      planDurationsMs: {
        count: fixture.planDurationsMs.length,
        p95: [...fixture.planDurationsMs].sort((left, right) => left - right)[
          Math.ceil(fixture.planDurationsMs.length * 0.95) - 1
        ] ?? 0,
      },
    }))
    if (process.env.RESOURCE_SNAKE_SIM_REPORT === '1') {
      process.stdout.write(`RESOURCE_SNAKE_SIM ${JSON.stringify(report)}\n`)
    }
    expect(fixtures).toHaveLength(TIERS.length * POLICIES.length)
    for (const fixture of fixtures) {
      expect(fixture.seeds).toBe(SEEDS_PER_FIXTURE)
      expect(fixture.planDurationsMs.length).toBeGreaterThan(0)
      expect(fixture.unforcedEnemyDeaths + fixture.forcedEnemyDeaths).toBeLessThanOrEqual(
        fixture.enemySpawns,
      )
      expect(fixture.enemyDeathsByPlayerTrail).toBeLessThanOrEqual(fixture.enemySpawns)
      expect(fixture.enemyBoundaryHits).toBeGreaterThanOrEqual(0)
      expect(fixture.enemySelfTrailHits).toBeGreaterThanOrEqual(0)
      expect(fixture.headOnHits).toBeGreaterThanOrEqual(0)
      expect(fixture.medianPlayerAreaReduction).toBeGreaterThanOrEqual(0)
      expect(fixture.duplicateRoleCycles).toBe(0)
      if (fixture.dualPlanningCycles > 0) {
        expect(
          fixture.allyPathConflicts / fixture.dualPlanningCycles,
          JSON.stringify(report),
        ).toBeLessThan(0.05)
      }
      const tier = TIERS.find((candidate) => candidate.label === fixture.tier)!
      if (
        tier.period === 'early'
        && (fixture.policy === 'stationary' || fixture.policy === 'long-straight')
      ) {
        expect(
          fixture.unforcedEnemyDeaths / fixture.enemySpawns,
          JSON.stringify(report),
        ).toBeLessThan(0.03)
      }
      if (tier.period === 'late') {
        expect(
          fixture.unforcedEnemyDeaths / fixture.enemySpawns,
          JSON.stringify(report),
        ).toBeLessThan(0.02)
      }
      if (
        (fixture.tier === 'early-0' || fixture.tier === 'middle-6')
        && fixture.policy === 'decoy-exit'
      ) {
        expect(fixture.unforcedEnemyDeaths, JSON.stringify(report)).toBe(0)
      }
      if (tier.period === 'late' && fixture.policy === 'decoy-exit') {
        expect(fixture.medianPlayerAreaReduction, JSON.stringify(report)).toBeGreaterThanOrEqual(8)
      }
      if (fixture.tier === 'early-0' && fixture.policy === 'stationary') {
        expect(
          fixture.headOnHits / fixture.committedPlans,
          JSON.stringify(report),
        ).toBeLessThan(0.02)
      }
    }

    for (const [tier, policy, seed] of [
      [TIERS[0], 'stationary', 0],
      [TIERS[4], 'decoy-exit', 199],
    ] as const) {
      const first = runSimulation(tier, policy, seed, true)
      const replayed = runSimulation(tier, policy, seed, true)
      expect(replayed.replay).toBe(first.replay)
    }
  }, 1_200_000)
})
