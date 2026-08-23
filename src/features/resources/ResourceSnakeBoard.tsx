import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useRuntimeSuspended,
} from '../../app/GameContext'
import { playGameSound, unlockGameAudio } from '../../audio/audioEngine'
import { speedUpgradeLevel } from '../../game/hacking'
import type { CompanyCategory } from '../../game/model'
import {
  ResourceIntrusionTargetCards,
  type ResourceIntrusionTargetPhase,
} from './ResourceIntrusionTargetCards'
import { ResourceSnakeRewardFlights } from './ResourceSnakeRewardFlights'
import { ResourceSnakeCategoryLegend } from './ResourceSnakeCategoryLegend'
import {
  createResourceSnakeEncounter,
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
  resourceSnakeRoundSpeedScale,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeVector,
} from './resourceSnakeRuntime'
import {
  buildResourceSnakeScene,
  resourceSnakeShakeOffset,
} from './resourceSnakePresentation'
import {
  drawDormantResourceSnakeField,
  drawResourceSnakeScene,
} from './resourceSnakeCanvas'
import { ResourceBoard } from './ResourceBoard'
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

const INTRUSION_OPENING_MS = 2_000
const TARGET_LAUNCH_MS = 240

type ResourceIntrusionBoardPhase =
  | 'ready'
  | 'opening'
  | ResourceIntrusionTargetPhase
  | 'combat'

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
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

function plannerTrailDots(runtime: ResourceSnakeRoundState): SnakePlannerTrailDot[] {
  return [runtime.player, ...runtime.enemies].flatMap((actor) => (
    actor.trail.map((dot) => ({
      id: dot.id,
      ownerId: actor.id,
      position: { ...dot.position },
      spawnedAtMs: dot.spawnedAtMs,
      expiresAtMs: dot.expiresAtMs,
    }))
  ))
}

function resourceSnakePlannerSnapshot(
  runtime: ResourceSnakeRoundState,
  history: readonly SnakePlayerHistorySample[],
  previousPlans: readonly SnakePlan[],
  roles: Readonly<Record<string, SnakeEnemyRole>>,
): SnakePlannerSnapshot {
  return {
    simulationMs: runtime.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerActor(runtime.player, roles, runtime.simulationMs),
    enemies: runtime.enemies.map((enemy) => plannerActor(enemy, roles, runtime.simulationMs)),
    trailDots: plannerTrailDots(runtime),
    playerHistory: history.slice(-512),
    committedAllyPaths: previousPlans
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null),
  }
}

function ResourceSnakeBoardSession() {
  const gameState = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const runtimeSuspended = useRuntimeSuspended()
  const [runtime, setRuntime] = useState(createIdleResourceSnakeState)
  const [boardPhase, setBoardPhase] = useState<ResourceIntrusionBoardPhase>('ready')
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
  const rolesRef = useRef<Record<string, SnakeEnemyRole>>({})
  const playerHistoryRef = useRef<SnakePlayerHistorySample[]>([])
  const bagRef = useRef<SnakeShuffleBagState>({
    cycle: 0,
    remainingCategories: [],
  })
  const completedRoundIdRef = useRef<string | null>(null)
  const [initialCompletedRoundCount] = useState(gameState.resourceIntrusion.completedRounds)
  const openingTimerRef = useRef<number | null>(null)
  const launchTimerRef = useRef<number | null>(null)
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
    if (openingTimerRef.current !== null) {
      window.clearTimeout(openingTimerRef.current)
    }
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
    rolesRef.current = Object.fromEntries(encounter.setup.enemies.map((enemy) => (
      [enemy.id, enemy.role]
    )))
    setAiPresentation({
      roles: { ...rolesRef.current },
      phases: encounter.setup.enemies.map((enemy) => ({
        id: enemy.id,
        phase: 'deploy',
        startedAtMs: 0,
      })),
      telegraphs: [],
      telegraphCount: 0,
    })
    playerHistoryRef.current = []
    const deployed = deployResourceSnakeRound(runtimeRef.current, encounter.setup)
    aiControllerRef.current = createResourceSnakeAiControllerState(
      resourceSnakePlannerSnapshot(deployed, [], [], rolesRef.current),
    )
    setBoardPhase('combat')
    commitRuntime(deployed)
  }, [commitRuntime])

  const openTargets = useCallback(() => {
    if (
      boardPhase !== 'ready'
      || runtimeRef.current.phase !== 'idle'
      || candidatesRef.current.length === 0
    ) return
    setBoardPhase('opening')
    const played = playGameSound('snake-init-suction')
    if (!played) {
      void unlockGameAudio().then((ready) => {
        if (ready) playGameSound('snake-init-suction')
      })
    }
    if (openingTimerRef.current !== null) {
      window.clearTimeout(openingTimerRef.current)
    }
    openingTimerRef.current = window.setTimeout(() => {
      openingTimerRef.current = null
      setBoardPhase('choosing')
    }, INTRUSION_OPENING_MS)
  }, [boardPhase])

  const roundCompletedInSession = gameState.resourceIntrusion.completedRounds
    > initialCompletedRoundCount
  const visibleBoardPhase: ResourceIntrusionBoardPhase = (
    runtime.phase === 'idle'
    && roundCompletedInSession
    && (boardPhase === 'combat' || boardPhase === 'ready')
  ) ? 'choosing' : boardPhase

  const selectTarget = useCallback((targetCategory: CompanyCategory) => {
    if (
      visibleBoardPhase !== 'choosing'
      || runtimeRef.current.phase !== 'idle'
      || !candidatesRef.current.some(({ origin }) => origin === targetCategory)
    ) return
    setSelectedCategory(targetCategory)
    setBoardPhase('launching')
    if (launchTimerRef.current !== null) {
      window.clearTimeout(launchTimerRef.current)
    }
    launchTimerRef.current = window.setTimeout(() => {
      launchTimerRef.current = null
      deploySelectedTarget(targetCategory)
    }, TARGET_LAUNCH_MS)
  }, [deploySelectedTarget, visibleBoardPhase])

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
      const key = event.key.toLowerCase()
      const phase = runtimeRef.current.phase
      if (
        runtimeSuspended
        || (phase !== 'deploying' && phase !== 'active')
        || event.ctrlKey
        || event.altKey
        || event.metaKey
        || isEditableTarget(event.target)
        || !MOVEMENT_KEYS.has(key)
      ) return
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
      const key = event.key.toLowerCase()
      if (!MOVEMENT_KEYS.has(key)) return
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
        rolesRef.current = controlled.state.roles
        setAiPresentation({
          roles: { ...controlled.state.roles },
          phases: Object.values(controlled.state.enemies).map((enemy) => ({
            id: enemy.enemyId,
            phase: enemy.phase,
            startedAtMs: browserNumber(enemy.phaseStartedAtMs),
          })),
          telegraphs: controlled.telegraphs,
          telegraphCount: controlled.telegraphs.length,
        })
        enemyDirections = controlled.commands
        enemyDirectionSchedules = controlled.commandSchedules
        enemyTurnPolicies = controlled.turnPolicies
        observedPlanningMs = controlled.observedPlanningMs
      }
      const controllerDurationMs = performance.now() - controllerStartedAt
      controllerMaximumMs = Math.max(controllerMaximumMs, controllerDurationMs)
      plannerMaximumMs = Math.max(plannerMaximumMs, observedPlanningMs)
      const runtimeStartedAt = performance.now()
      const next = advanceResourceSnakeFrame(current, {
        enemyDirections,
        enemyDirectionSchedules,
        enemyTurnPolicies,
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
    const resize = () => setCanvasRevision((revision) => revision + 1)
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
  const shake = resourceSnakeShakeOffset(runtime, settings.reducedMotion)
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
              resourceLabel: category ? SNAKE_CATEGORY_LABELS[category] : '미확인',
              color: category ? SNAKE_CATEGORY_COLORS[category] : '#ff765e',
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
            <ResourceSnakeCategoryLegend
              className="resource-snake-board__hud-legend"
              ariaLabel="적 리소스 색상 범례"
            />
            <div className="resource-snake-board__hud-operator">
              <span>PLAYER</span>
              <span>{runtime.player.integrity.toString().padStart(3, '0')} / 100</span>
            </div>
            <div className="resource-snake-board__hud-input">
              <span>HDG {runtime.player.heading.toUpperCase()}</span>
              <span>SPD {Math.round(roundSpeedScale * 100)}%</span>
              <span>Q {queueLabel}</span>
            </div>
            <div className="resource-snake-board__hud-help">
              WASD / ARROWS · TAP TO TURN · 8-WAY
            </div>
          </div>
        ) : null}
        {runtime.phase === 'idle' && (
          visibleBoardPhase === 'choosing' || visibleBoardPhase === 'launching'
        ) ? (
          <ResourceIntrusionTargetCards
            candidates={candidates}
            phase={visibleBoardPhase}
            selectedCategory={visibleBoardPhase === 'launching' ? selectedCategory : null}
            reducedMotion={settings.reducedMotion}
            onSelect={selectTarget}
          />
        ) : null}
        {runtime.phase === 'idle' && (
          visibleBoardPhase === 'ready' || visibleBoardPhase === 'opening'
        ) ? (
          <button
            className={`resource-snake-board__play resource-snake-board__play--round${
              visibleBoardPhase === 'opening'
                ? ' resource-snake-board__play--opening'
                : ''
            }`}
            type="button"
            data-tutorial-target="play-button"
            data-opening={visibleBoardPhase === 'opening' ? 'true' : 'false'}
            aria-label="InIt"
            aria-busy={visibleBoardPhase === 'opening' ? 'true' : 'false'}
            title={candidates.length === 0 ? '확보 가능한 리소스 없음' : 'InIt'}
            onClick={openTargets}
            disabled={candidates.length === 0 || visibleBoardPhase === 'opening'}
          >
            InIt
          </button>
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
