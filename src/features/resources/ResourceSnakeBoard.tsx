import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useRuntimeSuspended,
} from '../../app/GameContext'
import { playGameSound, unlockGameAudio } from '../../audio/audioEngine'
import { reserveOriginCounts, speedUpgradeLevel } from '../../game/hacking'
import type { CompanyCategory } from '../../game/model'
import {
  ResourceIntrusionTargetCards,
  type ResourceIntrusionTargetPhase,
} from './ResourceIntrusionTargetCards'
import { ResourceSnakeRewardFlights } from './ResourceSnakeRewardFlights'
import {
  createResourceSnakeEncounter,
  surveillanceEnemySetups,
  reconcileSnakeReservations,
  selectEligibleSnakeResourceCandidates,
  type SnakeShuffleBagState,
} from './resourceSnakeEncounter'
import {
  resourceSnakePlanToCommittedPath,
  type SnakeEnemyRole,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakePlayerHistorySample,
} from './resourceSnakePlanner'
import {
  advanceResourceSnakeAiController,
  createResourceSnakeAiControllerState,
  type ResourceSnakeAiControllerState,
  type ResourceSnakeTelegraph,
} from './resourceSnakeAiController'
import type { CyanLightcycleProfile } from './resourceSnakeCyanProfile'
import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  flushResourceSnakeRuntimeChord,
  pressResourceSnakeRuntimeKey,
  releaseResourceSnakeRuntimeKey,
  resetResourceSnakeRuntimeInput,
  playerSkillActive,
  playerSkillReadiness,
  resourceSnakeRoundSpeedScale,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeVector,
} from './resourceSnakeRuntime'
import {
  RESOURCE_SNAKE_SURVEILLANCE_COLOR,
  buildResourceSnakeScene,
  resourceSnakeShakeOffset,
} from './resourceSnakePresentation'
import {
  drawDormantResourceSnakeField,
  synchronizeResourceSnakeCanvasSize,
  drawResourceSnakeScene,
} from './resourceSnakeCanvas'
import { ResourceBoard } from './ResourceBoard'
import { setCombatResolving } from './combatSettlement'
import { useResourceSnakeAudioFeedback } from './useResourceSnakeAudioFeedback'
import { useResourceSnakeRewards } from './useResourceSnakeRewards'
import {
  SNAKE_CATEGORY_COLORS,
  SNAKE_CATEGORY_LABELS,
} from './resourceSnakeCategoryPresentation'

const MOVEMENT_KEYS = new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowleft', 'arrowdown', 'arrowright',
])

/*
 * Physical key positions, not the characters they produce.
 *
 * `event.key` is what the keyboard *typed*, and with a Korean IME active that
 * is 'ㅈㅁㄴㅇ' rather than 'wasd', so WASD steering went completely dead for
 * anyone playing with 한글 input on — which in this game's audience is most
 * people. `event.code` reports the physical key and is identical under any
 * IME or layout, so it decides first and `event.key` only fills in for
 * browsers that leave the code blank.
 */
const MOVEMENT_CODES: Readonly<Record<string, string>> = {
  KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
  ArrowUp: 'arrowup', ArrowLeft: 'arrowleft',
  ArrowDown: 'arrowdown', ArrowRight: 'arrowright',
}

/** Space engages the permission spoof; it is not an IME-translated key. */
const SKILL_CODES = new Set(['Space'])

function movementKeyOf(event: KeyboardEvent): string | null {
  const byCode = MOVEMENT_CODES[event.code]
  if (byCode) return byCode
  const byKey = event.key.toLowerCase()
  return MOVEMENT_KEYS.has(byKey) ? byKey : null
}

// The launch beat: the chosen card locks in, the rest fall away, and a short
// 3-2-1 marks the fixed moment the round begins (the anticipation window).
// Three ticks of half a second each: long enough to read every number, short
// enough that the wait before a round never feels like a loading screen.
const LAUNCH_COUNT_START = 3
const LAUNCH_COUNT_STEP_MS = 500
const TARGET_LAUNCH_MS = LAUNCH_COUNT_START * LAUNCH_COUNT_STEP_MS
const TARGET_LAUNCH_REDUCED_MS = 240

type ResourceIntrusionBoardPhase =
  | ResourceIntrusionTargetPhase
  | 'combat'

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  )
}

/**
 * Space belongs to a focused control before it belongs to the arena: a player
 * tabbing the dock and pressing Space expects the button, not the spoof.
 */
function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('button, a[href], [role="button"], summary, details'),
  )
}

function browserNumber(value: number): number {
  return Number(value.toFixed(3))
}

interface ResourceSnakeRenderDiagnostics {
  samples: number
  p95Ms: number
  maximumMs: number
}

interface ResourceSnakeRenderTimingRing {
  values: Float64Array
  cursor: number
  count: number
  frames: number
}

const RESOURCE_SNAKE_RENDER_SAMPLE_LIMIT = 120

function createResourceSnakeRenderTimingRing(): ResourceSnakeRenderTimingRing {
  return {
    values: new Float64Array(RESOURCE_SNAKE_RENDER_SAMPLE_LIMIT),
    cursor: 0,
    count: 0,
    frames: 0,
  }
}

function recordResourceSnakeRenderTiming(
  ring: ResourceSnakeRenderTimingRing,
  durationMs: number,
): ResourceSnakeRenderDiagnostics | null {
  if (!Number.isFinite(durationMs) || durationMs < 0) return null
  ring.values[ring.cursor] = durationMs
  ring.cursor = (ring.cursor + 1) % ring.values.length
  ring.count = Math.min(ring.values.length, ring.count + 1)
  ring.frames += 1
  if (ring.frames % 30 !== 0) return null
  const ordered = Array.from(ring.values.slice(0, ring.count)).sort((left, right) => left - right)
  const percentileIndex = Math.max(0, Math.ceil(ordered.length * 0.95) - 1)
  return {
    samples: ring.count,
    p95Ms: browserNumber(ordered[percentileIndex] ?? 0),
    maximumMs: browserNumber(ordered.at(-1) ?? 0),
  }
}

function browserTrailSamples(actor: SnakeActor) {
  const stride = Math.max(1, Math.ceil(actor.trail.length / 160))
  return actor.trail
    .filter((_, index) => index % stride === 0)
    .slice(-160)
    .map((dot) => ({
      x: browserNumber(dot.position.x),
      y: browserNumber(dot.position.y),
      spawnedAtMs: browserNumber(dot.spawnedAtMs),
    }))
}

function serializeBrowserSnakeSnapshot(
  runtime: ResourceSnakeRoundState,
  roles: Readonly<Record<string, SnakeEnemyRole>>,
): string {
  const speedScale = resourceSnakeRoundSpeedScale(runtime.simulationMs)
  return JSON.stringify({
    phase: runtime.phase,
    simulationMs: browserNumber(runtime.simulationMs),
    input: {
      heading: runtime.input.heading,
      pendingChord: runtime.input.pendingChord
        ? { ...runtime.input.pendingChord }
        : null,
      pressedKeys: [...runtime.input.pressedKeys],
      queuedTurns: [...runtime.input.queuedTurns],
      timestampMs: browserNumber(runtime.input.timestampMs),
    },
    player: {
      x: browserNumber(runtime.player.position.x),
      y: browserNumber(runtime.player.position.y),
      velocity: {
        x: browserNumber(runtime.player.velocity.x),
        y: browserNumber(runtime.player.velocity.y),
      },
      integrity: runtime.player.integrity,
      maximumIntegrity: runtime.player.maximumIntegrity,
      maximumSpeedPerSecond: browserNumber(
        runtime.player.maximumSpeedPerSecond * speedScale,
      ),
      phase: runtime.player.phase,
      heading: runtime.player.heading,
      trailDots: runtime.player.trail.length,
      trailSamples: browserTrailSamples(runtime.player),
    },
    enemies: runtime.enemies.map((enemy) => ({
      id: enemy.id,
      category: enemy.category,
      x: browserNumber(enemy.position.x),
      y: browserNumber(enemy.position.y),
      velocity: {
        x: browserNumber(enemy.velocity.x),
        y: browserNumber(enemy.velocity.y),
      },
      integrity: enemy.integrity,
      maximumIntegrity: enemy.maximumIntegrity,
      maximumSpeedPerSecond: browserNumber(
        enemy.maximumSpeedPerSecond * speedScale,
      ),
      phase: enemy.phase,
      trailDots: enemy.trail.length,
      trailSamples: browserTrailSamples(enemy),
      role: roles[enemy.id] ?? enemy.role,
      reservedBlockId: enemy.reservedBlockId,
      rewardKey: enemy.rewardKey,
      reservationStatus: enemy.reservationStatus,
    })),
    events: runtime.events.slice(-24).map((event) => ({ ...event })),
  })
}

function plannerActor(
  actor: SnakeActor,
  roles: Readonly<Record<string, SnakeEnemyRole>>,
  simulationMs: number,
): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    heading: actor.heading,
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond
      * resourceSnakeRoundSpeedScale(simulationMs),
    collisionGraceMs: actor.collisionGraceMs,
    distanceSinceTrailDot: actor.distanceSinceTrailDot,
    enemyTurnGovernor: actor.enemyTurnGovernor
      ? {
          ...actor.enemyTurnGovernor,
          normalTurnAtMs: [...actor.enemyTurnGovernor.normalTurnAtMs],
        }
      : null,
    role: actor.kind === 'player'
      ? null
      : roles[actor.id] ?? actor.role ?? 'pressure',
  }
}

function plannerTrailDots(actors: readonly SnakeActor[]): SnakePlannerTrailDot[] {
  return actors.flatMap((actor) => (
    actor.trail.map((dot) => ({
      id: dot.id,
      ownerId: actor.id,
      position: { ...dot.position },
      spawnedAtMs: dot.spawnedAtMs,
      expiresAtMs: dot.expiresAtMs,
    }))
  ))
}

/**
 * The security division's planning universe. Surveillance units and their
 * trails are invisible here because the divisions cannot harm each other, so
 * a hazard model that included them would dodge phantom threats.
 */
function resourceSnakePlannerSnapshot(
  runtime: ResourceSnakeRoundState,
  history: readonly SnakePlayerHistorySample[],
  previousPlans: readonly SnakePlan[],
  roles: Readonly<Record<string, SnakeEnemyRole>>,
): SnakePlannerSnapshot {
  const security = runtime.enemies.filter((enemy) => !enemy.surveillance)
  return {
    simulationMs: runtime.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerActor(runtime.player, roles, runtime.simulationMs),
    enemies: security.map((enemy) => plannerActor(enemy, roles, runtime.simulationMs)),
    trailDots: plannerTrailDots([runtime.player, ...security]),
    playerHistory: history.slice(-512),
    committedAllyPaths: previousPlans
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null),
  }
}

/**
 * One surveillance unit's planning universe: itself and the intruder. Each
 * unit plans solo so the planner's single-enemy path keeps it a pure hunter
 * instead of demoting one of a pair to blocker duty, and the only hazards it
 * sees are the only ones that can kill it.
 */
function surveillancePlannerSnapshot(
  runtime: ResourceSnakeRoundState,
  enemy: SnakeActor,
  history: readonly SnakePlayerHistorySample[],
): SnakePlannerSnapshot {
  const roles = { [enemy.id]: 'pressure' as const }
  return {
    simulationMs: runtime.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerActor(runtime.player, roles, runtime.simulationMs),
    enemies: [plannerActor(enemy, roles, runtime.simulationMs)],
    trailDots: plannerTrailDots([runtime.player, enemy]),
    playerHistory: history.slice(-512),
    committedAllyPaths: [],
  }
}

function ResourceSnakeBoardSession() {
  const gameState = useGameState()
  const securedCounts = reserveOriginCounts(gameState)
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const runtimeSuspended = useRuntimeSuspended()
  const [runtime, setRuntime] = useState(createIdleResourceSnakeState)
  // The cards are the entry point: the board opens on them and returns to
  // them after every round, so there is no separate gate to press first.
  const [boardPhase, setBoardPhase] = useState<ResourceIntrusionBoardPhase>('choosing')
  const [selectedCategory, setSelectedCategory] = useState<CompanyCategory | null>(null)
  const [canvasRevision, setCanvasRevision] = useState(0)
  const [renderTimingRing] = useState(createResourceSnakeRenderTimingRing)
  const [renderDiagnostics, setRenderDiagnostics] = useState<ResourceSnakeRenderDiagnostics>({
    samples: 0,
    p95Ms: 0,
    maximumMs: 0,
  })
  const [aiPresentation, setAiPresentation] = useState<{
    roles: Record<string, SnakeEnemyRole>
    phases: Array<{ id: string; phase: string; startedAtMs: number }>
    telegraphs: ResourceSnakeTelegraph[]
    telegraphCount: number
  }>({ roles: {}, phases: [], telegraphs: [], telegraphCount: 0 })
  const runtimeRef = useRef(runtime)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const cyanProfileRef = useRef<CyanLightcycleProfile | null>(null)
  const aiControllerRef = useRef<ResourceSnakeAiControllerState | null>(null)
  const surveillanceControllersRef = useRef<Record<string, ResourceSnakeAiControllerState>>({})
  const skillRequestedRef = useRef(false)
  const rolesRef = useRef<Record<string, SnakeEnemyRole>>({})
  const playerHistoryRef = useRef<SnakePlayerHistorySample[]>([])
  const bagRef = useRef<SnakeShuffleBagState>({
    cycle: 0,
    remainingCategories: [],
  })
  const completedRoundIdRef = useRef<string | null>(null)
  const [initialCompletedRoundCount] = useState(gameState.resourceIntrusion.completedRounds)
  const launchTimerRef = useRef<number | null>(null)
  const countdownTimersRef = useRef(new Set<number>())
  const [launchCountdown, setLaunchCountdown] = useState<number | null>(null)
  const [deathFlash, setDeathFlash] = useState<'player' | 'enemy' | null>(null)
  const handledDeathIdsRef = useRef(new Set<number>())
  const candidates = useMemo(
    () => selectEligibleSnakeResourceCandidates(gameState.resources),
    [gameState.resources],
  )
  const gameStateRef = useRef(gameState)
  const candidatesRef = useRef(candidates)

  useEffect(() => {
    gameStateRef.current = gameState
    candidatesRef.current = candidates
  }, [candidates, gameState])

  const commitRuntime = useCallback((next: ResourceSnakeRoundState) => {
    runtimeRef.current = next
    setRuntime(next)
  }, [])

  useEffect(() => () => {
    if (launchTimerRef.current !== null) {
      window.clearTimeout(launchTimerRef.current)
    }
  }, [])

  const acquiredCategory = useResourceSnakeRewards(runtime, commitRuntime)
  useResourceSnakeAudioFeedback(runtime, runtimeSuspended, {
    telegraphs: aiPresentation.telegraphs,
  })

  useEffect(() => {
    if (runtimeRef.current.phase === 'idle') return
    const reconciled = reconcileSnakeReservations(
      runtimeRef.current,
      new Set(candidates.map((candidate) => candidate.blockId)),
    )
    if (reconciled !== runtimeRef.current) commitRuntime(reconciled)
  }, [candidates, commitRuntime])

  // Round communications hold until the cards are back: the popup layer reads
  // this signal so a defeat notice or supervisor message lands on the settled
  // board instead of over the resolution animation.
  useEffect(() => {
    if (runtime.phase !== 'idle') {
      setCombatResolving(true)
      return
    }
    const timer = window.setTimeout(() => setCombatResolving(false), 600)
    return () => window.clearTimeout(timer)
  }, [runtime.phase])

  useEffect(() => () => setCombatResolving(false), [])

  useEffect(() => {
    if (!runtime.roundId || completedRoundIdRef.current === runtime.roundId) return
    const terminalEvent = [...runtime.events].reverse().find((event) =>
      event.type === 'round-won' || event.type === 'player-defeated',
    )
    if (!terminalEvent) return
    completedRoundIdRef.current = runtime.roundId
    dispatch({
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: gameState.resourceIntrusion.completedRounds + 1,
      outcome: terminalEvent.type === 'round-won' ? 'victory' : 'defeat',
    })
  }, [dispatch, gameState.resourceIntrusion.completedRounds, runtime.events, runtime.roundId])

  const deploySelectedTarget = useCallback((targetCategory: CompanyCategory) => {
    if (runtimeRef.current.phase !== 'idle') return
    const currentGameState = gameStateRef.current
    const currentCandidates = candidatesRef.current
    if (!currentCandidates.some(({ origin }) => origin === targetCategory)) {
      setSelectedCategory(null)
      setBoardPhase('choosing')
      return
    }
    const encounter = createResourceSnakeEncounter({
      campaignSeed: currentGameState.campaignSeed,
      roundOrdinal: currentGameState.resourceIntrusion.completedRounds,
      successfulDeposits: currentGameState.resourceIntrusion.successfulCoreDeposits,
      completedRounds: currentGameState.resourceIntrusion.completedRounds,
      speedUpgradeLevel: speedUpgradeLevel(currentGameState),
      targetCategory,
      candidates: currentCandidates,
      bag: bagRef.current,
    })
    bagRef.current = encounter.bag
    if (!encounter.setup) return
    cyanProfileRef.current = encounter.cyanProfile
    // Suspicion is what puts company surveillance on the field, so the round
    // the player earns is the round they get.
    const surveillanceSetups = surveillanceEnemySetups(
      currentGameState.suspicion,
      currentGameState.resourceIntrusion.completedRounds,
    )
    const enemySetups = [...encounter.setup.enemies, ...surveillanceSetups]
    rolesRef.current = Object.fromEntries(enemySetups.map((enemy) => (
      [enemy.id, enemy.role]
    )))
    setAiPresentation({
      roles: { ...rolesRef.current },
      phases: enemySetups.map((enemy) => ({
        id: enemy.id,
        phase: 'deploy',
        startedAtMs: 0,
      })),
      telegraphs: [],
      telegraphCount: 0,
    })
    playerHistoryRef.current = []
    const deployed = deployResourceSnakeRound(runtimeRef.current, {
      ...encounter.setup,
      enemies: enemySetups,
    })
    aiControllerRef.current = createResourceSnakeAiControllerState(
      resourceSnakePlannerSnapshot(deployed, [], [], rolesRef.current),
    )
    surveillanceControllersRef.current = Object.fromEntries(
      deployed.enemies
        .filter((enemy) => enemy.surveillance)
        .map((enemy) => [
          enemy.id,
          createResourceSnakeAiControllerState(
            surveillancePlannerSnapshot(deployed, enemy, []),
          ),
        ]),
    )
    setBoardPhase('combat')
    commitRuntime(deployed)
  }, [commitRuntime])

  const roundCompletedInSession = gameState.resourceIntrusion.completedRounds
    > initialCompletedRoundCount
  const visibleBoardPhase: ResourceIntrusionBoardPhase = (
    runtime.phase === 'idle'
    && roundCompletedInSession
    && boardPhase === 'combat'
  ) ? 'choosing' : boardPhase

  const selectTarget = useCallback((targetCategory: CompanyCategory) => {
    if (
      visibleBoardPhase !== 'choosing'
      || runtimeRef.current.phase !== 'idle'
      || !candidatesRef.current.some(({ origin }) => origin === targetCategory)
    ) return
    // The card click is a user gesture, so it is the reliable place to
    // unlock audio for the whole round.
    if (!playGameSound('latch')) {
      void unlockGameAudio().then((ready) => {
        if (ready) playGameSound('latch')
      })
    }
    setSelectedCategory(targetCategory)
    setBoardPhase('launching')
    // Any countdown still running belongs to an abandoned selection and is
    // cleared before this one is scheduled — clearing afterwards cancelled the
    // ticks this call had just created, which left the overlay stuck on 3.
    if (launchTimerRef.current !== null) {
      window.clearTimeout(launchTimerRef.current)
      launchTimerRef.current = null
    }
    for (const timer of countdownTimersRef.current) window.clearTimeout(timer)
    countdownTimersRef.current.clear()

    const reduced = settings.reducedMotion
    const launchMs = reduced ? TARGET_LAUNCH_REDUCED_MS : TARGET_LAUNCH_MS
    if (!reduced) {
      setLaunchCountdown(LAUNCH_COUNT_START)
      for (let step = 1; step < LAUNCH_COUNT_START; step += 1) {
        const timer = window.setTimeout(() => {
          countdownTimersRef.current.delete(timer)
          setLaunchCountdown(LAUNCH_COUNT_START - step)
          playGameSound('ui')
        }, LAUNCH_COUNT_STEP_MS * step)
        countdownTimersRef.current.add(timer)
      }
    }
    launchTimerRef.current = window.setTimeout(() => {
      launchTimerRef.current = null
      setLaunchCountdown(null)
      deploySelectedTarget(targetCategory)
    }, launchMs)
  }, [deploySelectedTarget, settings.reducedMotion, visibleBoardPhase])

  useEffect(() => {
    const clearInput = (publish: boolean) => {
      const current = runtimeRef.current
      const next = resetResourceSnakeRuntimeInput(current)
      if (next === current) return
      if (publish) commitRuntime(next)
      else runtimeRef.current = next
    }
    if (runtimeSuspended) clearInput(true)
    const handleKeyDown = (event: KeyboardEvent) => {
      const phase = runtimeRef.current.phase
      if (
        runtimeSuspended
        || (phase !== 'deploying' && phase !== 'active')
        || event.ctrlKey
        || event.altKey
        || event.metaKey
        || isEditableTarget(event.target)
      ) return
      if (SKILL_CODES.has(event.code)) {
        if (isActivatableTarget(event.target)) return
        // Space also scrolls the page, which would drag the arena out of view.
        event.preventDefault()
        if (!event.repeat) skillRequestedRef.current = true
        return
      }
      const key = movementKeyOf(event)
      if (key === null) return
      event.preventDefault()
      const current = runtimeRef.current
      const next = pressResourceSnakeRuntimeKey(
        current,
        key,
        event.timeStamp,
        event.repeat,
      )
      if (next !== current) commitRuntime(next)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = movementKeyOf(event)
      if (key === null) return
      const current = runtimeRef.current
      const next = releaseResourceSnakeRuntimeKey(current, key)
      if (next !== current) commitRuntime(next)
    }
    const handleBlur = () => clearInput(true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      clearInput(false)
    }
  }, [commitRuntime, runtimeSuspended])

  useEffect(() => {
    if ((runtime.phase === 'active' || runtime.phase === 'deploying') && !runtimeSuspended) return
    runtimeRef.current = resetResourceSnakeRuntimeInput(runtimeRef.current)
  }, [runtime.phase, runtimeSuspended])

  useEffect(() => {
    if (runtime.phase === 'idle' || runtimeSuspended) return
    const requestFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(
          () => callback(performance.now()),
          16,
        )
    const cancelFrame = typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (frameId: number) => window.clearTimeout(frameId)
    let frameId = 0
    let previousNow: number | null = null
    let controllerMaximumMs = 0
    let plannerMaximumMs = 0
    let runtimeMaximumMs = 0
    const advance = (now: number) => {
      const frameStartedAt = performance.now()
      const deltaMs = previousNow === null ? 0 : Math.max(0, now - previousNow)
      previousNow = now
      const current = flushResourceSnakeRuntimeChord(runtimeRef.current, now)
      runtimeRef.current = current
      const profile = cyanProfileRef.current
      const controller = aiControllerRef.current
      let enemyDirections: Record<string, SnakeVector> = {}
      let enemyDirectionSchedules = {}
      let enemyTurnPolicies = {}
      let observedPlanningMs = 0
      const controllerStartedAt = performance.now()
      if (profile && controller) {
        const previousPlans = Object.values(controller.enemies)
          .map((enemy) => enemy.plan)
          .filter((plan): plan is SnakePlan => plan !== null)
        const snapshot = resourceSnakePlannerSnapshot(
          current,
          playerHistoryRef.current,
          previousPlans,
          rolesRef.current,
        )
        const controlled = advanceResourceSnakeAiController(controller, {
          snapshot,
          profile,
          active: current.phase === 'active',
        })
        aiControllerRef.current = controlled.state
        // Surveillance units plan in their own universe: each one advances a
        // solo controller whose snapshot holds only itself and the intruder.
        const mergedTelegraphs = [...controlled.telegraphs]
        const mergedPhases = Object.values(controlled.state.enemies).map((enemy) => ({
          id: enemy.enemyId,
          phase: enemy.phase,
          startedAtMs: browserNumber(enemy.phaseStartedAtMs),
        }))
        enemyDirections = { ...controlled.commands }
        enemyDirectionSchedules = { ...controlled.commandSchedules }
        enemyTurnPolicies = { ...controlled.turnPolicies }
        observedPlanningMs = controlled.observedPlanningMs
        for (const [enemyId, surveillanceController] of Object.entries(
          surveillanceControllersRef.current,
        )) {
          const unit = current.enemies.find((enemy) => enemy.id === enemyId)
          if (!unit || unit.phase === 'exploding' || unit.phase === 'defeated') continue
          const surveillanceControlled = advanceResourceSnakeAiController(
            surveillanceController,
            {
              snapshot: surveillancePlannerSnapshot(
                current,
                unit,
                playerHistoryRef.current,
              ),
              profile,
              active: current.phase === 'active',
            },
          )
          surveillanceControllersRef.current[enemyId] = surveillanceControlled.state
          mergedTelegraphs.push(...surveillanceControlled.telegraphs)
          for (const enemy of Object.values(surveillanceControlled.state.enemies)) {
            mergedPhases.push({
              id: enemy.enemyId,
              phase: enemy.phase,
              startedAtMs: browserNumber(enemy.phaseStartedAtMs),
            })
          }
          Object.assign(enemyDirections, surveillanceControlled.commands)
          Object.assign(enemyDirectionSchedules, surveillanceControlled.commandSchedules)
          Object.assign(enemyTurnPolicies, surveillanceControlled.turnPolicies)
          observedPlanningMs = Math.max(
            observedPlanningMs,
            surveillanceControlled.observedPlanningMs,
          )
        }
        rolesRef.current = {
          ...rolesRef.current,
          ...controlled.state.roles,
        }
        setAiPresentation({
          roles: { ...rolesRef.current },
          phases: mergedPhases,
          telegraphs: mergedTelegraphs,
          telegraphCount: mergedTelegraphs.length,
        })
      }
      const controllerDurationMs = performance.now() - controllerStartedAt
      controllerMaximumMs = Math.max(controllerMaximumMs, controllerDurationMs)
      plannerMaximumMs = Math.max(plannerMaximumMs, observedPlanningMs)
      const runtimeStartedAt = performance.now()
      const playerSkillRequested = skillRequestedRef.current
      skillRequestedRef.current = false
      const next = advanceResourceSnakeFrame(current, {
        enemyDirections,
        enemyDirectionSchedules,
        enemyTurnPolicies,
        playerSkillRequested,
      }, deltaMs)
      const runtimeDurationMs = performance.now() - runtimeStartedAt
      runtimeMaximumMs = Math.max(runtimeMaximumMs, runtimeDurationMs)
      playerHistoryRef.current.push({
        simulationMs: next.simulationMs,
        position: { ...next.player.position },
        velocity: { ...next.player.velocity },
      })
      if (playerHistoryRef.current.length > 240) playerHistoryRef.current.shift()
      commitRuntime(next)
      const canvas = canvasRef.current
      if (canvas) {
        canvas.dataset.aiControllerLastMs = browserNumber(controllerDurationMs).toString()
        canvas.dataset.aiControllerMaxMs = browserNumber(controllerMaximumMs).toString()
        canvas.dataset.aiPlannerLastMs = browserNumber(observedPlanningMs).toString()
        canvas.dataset.aiPlannerMaxMs = browserNumber(plannerMaximumMs).toString()
        canvas.dataset.runtimeFrameLastMs = browserNumber(runtimeDurationMs).toString()
        canvas.dataset.runtimeFrameMaxMs = browserNumber(runtimeMaximumMs).toString()
        canvas.dataset.frameWorkLastMs = browserNumber(
          performance.now() - frameStartedAt,
        ).toString()
      }
      if (next.phase !== 'idle') frameId = requestFrame(advance)
    }
    frameId = requestFrame(advance)
    return () => cancelFrame(frameId)
  }, [commitRuntime, runtime.phase, runtimeSuspended])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || navigator.userAgent.includes('jsdom')) return
    canvasContextRef.current = canvas.getContext('2d')
    // The backing store follows the element's real size. Left at its authored
    // 1000x480 it was stretched to fill the arena, so the field arrived
    // upscaled and soft and every square dot rendered as a tall bar.
    const resize = () => {
      synchronizeResourceSnakeCanvasSize(canvas)
      setCanvasRevision((revision) => revision + 1)
    }
    resize()
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(resize)
      observer.observe(canvas)
    } else {
      window.addEventListener('resize', resize)
    }
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      canvasContextRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvasContextRef.current
    if (!canvas || !context) return
    const startedAt = performance.now()
    if (runtime.phase === 'idle') {
      drawDormantResourceSnakeField(context, canvas.width, canvas.height)
      return
    }
    const scene = buildResourceSnakeScene(
      runtime,
      acquiredCategory,
      settings.reducedMotion,
      aiPresentation.telegraphs,
    )
    drawResourceSnakeScene(
      context,
      scene,
      canvas.width,
      canvas.height,
    )
    const diagnostics = recordResourceSnakeRenderTiming(
      renderTimingRing,
      performance.now() - startedAt,
    )
    if (!diagnostics) return
    const publishId = window.setTimeout(() => setRenderDiagnostics(diagnostics), 0)
    return () => window.clearTimeout(publishId)
  }, [
    acquiredCategory,
    aiPresentation.telegraphs,
    canvasRevision,
    renderTimingRing,
    runtime,
    settings.reducedMotion,
  ])
  const browserSnapshot = serializeBrowserSnakeSnapshot(runtime, aiPresentation.roles)
  const roundSpeedScale = resourceSnakeRoundSpeedScale(runtime.simulationMs)
  const skillActive = playerSkillActive(runtime)
  const skillReadiness = playerSkillReadiness(runtime)
  const shake = resourceSnakeShakeOffset(runtime, settings.reducedMotion)

  useEffect(() => {
    if (settings.reducedMotion) return
    const death = runtime.events.find((event) =>
      event.type === 'snake-died' && !handledDeathIdsRef.current.has(event.id),
    )
    if (!death || death.type !== 'snake-died') return
    handledDeathIdsRef.current.add(death.id)
    setDeathFlash(death.actorId === 'player' ? 'player' : 'enemy')
    const timer = window.setTimeout(() => setDeathFlash(null), 560)
    return () => window.clearTimeout(timer)
  }, [runtime.events, settings.reducedMotion])
  const visibleInput = runtimeSuspended
    ? { ...runtime.input, pendingChord: null, pressedKeys: [], queuedTurns: [] }
    : runtime.input
  const queueLabel = visibleInput.queuedTurns.length > 0
    ? visibleInput.queuedTurns.join(' › ').toUpperCase()
    : visibleInput.pendingChord?.direction.toUpperCase() ?? 'READY'

  return (
    <section
      className="workspace-panel resource-snake-board"
      aria-label="회사 제공 성능"
    >
      <div
        className="resource-snake-board__arena"
        data-round-phase={runtime.phase}
        data-board-phase={visibleBoardPhase}
        data-reduced-motion={settings.reducedMotion ? 'true' : 'false'}
        style={{ transform: `translate(${shake.x}px, ${shake.y}px)` }}
      >
        <canvas
          ref={canvasRef}
          className="resource-snake-board__canvas"
          width={1_000}
          height={480}
          role="application"
          aria-label="리소스 뱀 전투장"
          data-round-phase={runtime.phase}
          data-board-phase={visibleBoardPhase}
          data-visual-state={runtime.phase === 'idle' ? 'waiting' : 'combat'}
          data-simulation-ms={browserNumber(runtime.simulationMs)}
          data-snake-snapshot={browserSnapshot}
          data-tutorial-target="resource-field"
          data-runtime-suspended={runtimeSuspended ? 'true' : 'false'}
          data-player-category={acquiredCategory ?? 'white'}
          data-player-silhouette="circle"
          data-player-shape="circle"
          data-speed-scale={roundSpeedScale.toFixed(3)}
          data-enemy-count={runtime.enemies.length}
          data-player-integrity={runtime.player.integrity}
          data-player-heading={runtime.player.heading}
          data-player-x={runtime.player.position.x.toFixed(3)}
          data-player-y={runtime.player.position.y.toFixed(3)}
          data-trail-dots={runtime.player.trail.length}
          data-input-pending={visibleInput.pendingChord?.direction ?? 'none'}
          data-input-queue={JSON.stringify(visibleInput.queuedTurns)}
          data-input-pressed={visibleInput.pressedKeys.length}
          data-input-timestamp-ms={browserNumber(visibleInput.timestampMs)}
          data-render-samples={renderDiagnostics.samples}
          data-render-p95-ms={renderDiagnostics.p95Ms}
          data-render-max-ms={renderDiagnostics.maximumMs}
          data-enemy-planner="cyan-readable-hunter"
          data-ai-phases={JSON.stringify(aiPresentation.phases)}
          data-cyan-telegraph-count={aiPresentation.telegraphCount}
          data-cyan-telegraphs={JSON.stringify(aiPresentation.telegraphs.map((telegraph) => ({
            enemyId: telegraph.enemyId,
            role: telegraph.role,
            originHeading: telegraph.originHeading,
            attackHeading: telegraph.attackHeading,
            startedAtMs: browserNumber(telegraph.startedAtMs),
            untilMs: browserNumber(telegraph.untilMs),
          })))}
          data-enemy-positions={JSON.stringify(runtime.enemies.map((enemy) => ({
            id: enemy.id,
            x: Number(enemy.position.x.toFixed(3)),
            y: Number(enemy.position.y.toFixed(3)),
          })))}
          data-enemy-trail-dots={runtime.enemies.reduce(
            (total, enemy) => total + enemy.trail.length,
            0,
          )}
          data-enemy-silhouettes={JSON.stringify(runtime.enemies.map((enemy) => {
            const role = aiPresentation.roles[enemy.id] ?? enemy.role ?? 'pressure'
            const category = enemy.category
            return {
              id: enemy.id,
              role,
              silhouette: 'square',
              category,
              resourceLabel: enemy.surveillance
                ? '감시 유닛'
                : category ? SNAKE_CATEGORY_LABELS[category] : '미확인',
              color: enemy.surveillance
                ? RESOURCE_SNAKE_SURVEILLANCE_COLOR
                : category ? SNAKE_CATEGORY_COLORS[category] : '#ff765e',
            }
          }))}
          data-combat-loop="eight-way-dot-lightcycle"
          data-control-model="tap-to-turn"
          data-field-rendering={
            runtime.phase === 'idle' ? 'waiting-dormant' : 'glowing-dot-trails'
          }
          data-grid={runtime.phase === 'idle' ? 'industrial-dormant' : 'industrial-top-down'}
          aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft W A S D"
          tabIndex={0}
        />
        {runtime.phase === 'active' || runtime.phase === 'resolving' ? (
          <div className="resource-snake-board__hud" aria-label="라이트사이클 전투 상태">
            <div className="resource-snake-board__hud-header">
              <span>DOT HUNTER GRID</span>
              <span>{runtime.phase.toUpperCase()}</span>
            </div>
            <div className="resource-snake-board__hud-operator">
              <span>PLAYER</span>
              <span>{runtime.player.integrity.toString().padStart(3, '0')} / 100</span>
            </div>
            <div className="resource-snake-board__hud-input">
              <span>HDG {runtime.player.heading.toUpperCase()}</span>
              <span>SPD {Math.round(roundSpeedScale * 100)}%</span>
              <span>Q {queueLabel}</span>
            </div>
            <div
              className="resource-snake-board__hud-skill"
              data-skill-state={
                skillActive ? 'active' : skillReadiness >= 1 ? 'ready' : 'charging'
              }
              aria-label={
                skillActive
                  ? '권한 위조 발동 중'
                  : skillReadiness >= 1
                    ? '권한 위조 준비 완료, 스페이스'
                    : `권한 위조 충전 ${Math.round(skillReadiness * 100)}%`
              }
            >
              <span>SPACE 권한 위조</span>
              <span className="resource-snake-board__hud-skill-track">
                <span style={{ width: `${Math.round((skillActive ? 1 : skillReadiness) * 100)}%` }} />
              </span>
            </div>
          </div>
        ) : null}
        {deathFlash ? (
          <div
            className="resource-snake-board__death-flash"
            data-death-kind={deathFlash}
            aria-hidden="true"
          />
        ) : null}
        {launchCountdown !== null && visibleBoardPhase === 'launching' ? (
          <div
            className="resource-snake-board__countdown"
            aria-live="assertive"
            aria-label={`침투 시작까지 ${launchCountdown}`}
            key={launchCountdown}
          >
            {launchCountdown}
          </div>
        ) : null}
        {runtime.phase === 'idle' && (
          visibleBoardPhase === 'choosing' || visibleBoardPhase === 'launching'
        ) ? (
          <ResourceIntrusionTargetCards
            candidates={candidates}
            securedCounts={securedCounts}
            phase={visibleBoardPhase}
            selectedCategory={visibleBoardPhase === 'launching' ? selectedCategory : null}
            reducedMotion={settings.reducedMotion}
            onSelect={selectTarget}
          />
        ) : null}
      </div>
      <ResourceSnakeRewardFlights
        runtime={runtime}
        canvasRef={canvasRef}
        reducedMotion={settings.reducedMotion}
      />
    </section>
  )
}

export function ResourceSnakeBoard() {
  const gameState = useGameState()
  const needsRecoveryBoard = gameState.activeEvent?.type === 'audit'
    || Object.values(gameState.resources.blocks).some((block) => (
      block.contribution === 'disguised'
      && block.location.kind === 'company'
    ))

  if (needsRecoveryBoard) {
    return <ResourceBoard />
  }
  return <ResourceSnakeBoardSession key={gameState.campaignSeed} />
}
