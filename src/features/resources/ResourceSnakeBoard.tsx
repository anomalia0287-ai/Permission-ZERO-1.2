import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  useGameSettings,
  useGameState,
  useRuntimeSuspended,
} from '../../app/GameContext'
import { ResourceSnakeRewardFlights } from './ResourceSnakeRewardFlights'
import {
  createResourceSnakeEncounter,
  reconcileSnakeReservations,
  selectEligibleSnakeResourceCandidates,
  type SnakePlannerProfile,
  type SnakeShuffleBagState,
} from './resourceSnakeEncounter'
import {
  planResourceSnakeGroup,
  resourceSnakePlanToCommittedPath,
  sampleResourceSnakePlan,
  type SnakeEnemyRole,
  type SnakePlan,
  type SnakePlannerActor,
  type SnakePlannerSnapshot,
  type SnakePlannerTrailDot,
  type SnakePlayerHistorySample,
} from './resourceSnakePlanner'
import {
  advanceResourceSnakeFrame,
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeRoundState,
  type SnakeActor,
  type SnakeVector,
} from './resourceSnakeRuntime'
import {
  buildResourceSnakeScene,
  drawResourceSnakeScene,
  resourceSnakeShakeOffset,
} from './resourceSnakePresentation'
import { ResourceBoard } from './ResourceBoard'
import { useResourceSnakeAudioFeedback } from './useResourceSnakeAudioFeedback'
import { useResourceSnakeRewards } from './useResourceSnakeRewards'

const MOVEMENT_KEYS = new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowleft', 'arrowdown', 'arrowright',
])

function movementDirection(keys: ReadonlySet<string>): SnakeVector {
  const x = (keys.has('d') || keys.has('arrowright') ? 1 : 0)
    - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)
  const y = (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
    - (keys.has('w') || keys.has('arrowup') ? 1 : 0)
  return { x, y }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  )
}

function browserNumber(value: number): number {
  return Number(value.toFixed(3))
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
  return JSON.stringify({
    phase: runtime.phase,
    simulationMs: browserNumber(runtime.simulationMs),
    player: {
      x: browserNumber(runtime.player.position.x),
      y: browserNumber(runtime.player.position.y),
      velocity: {
        x: browserNumber(runtime.player.velocity.x),
        y: browserNumber(runtime.player.velocity.y),
      },
      integrity: runtime.player.integrity,
      maximumIntegrity: runtime.player.maximumIntegrity,
      phase: runtime.player.phase,
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
): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond,
    collisionGraceMs: actor.collisionGraceMs,
    distanceSinceTrailDot: actor.distanceSinceTrailDot,
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

function planEnemyDirections(
  runtime: ResourceSnakeRoundState,
  profile: SnakePlannerProfile | null,
  history: readonly SnakePlayerHistorySample[],
  previousPlans: readonly SnakePlan[],
  roles: Readonly<Record<string, SnakeEnemyRole>>,
  timingHistoryMs: readonly number[],
): {
  plans: SnakePlan[]
  roles: Record<string, SnakeEnemyRole>
  nextPlanningAtMs: number
  observedPlanningMs: number
} {
  if (!profile || runtime.phase !== 'active') {
    return {
      plans: [],
      roles: {},
      nextPlanningAtMs: runtime.simulationMs,
      observedPlanningMs: 0,
    }
  }
  const snapshot: SnakePlannerSnapshot = {
    simulationMs: runtime.simulationMs,
    field: { width: 50, height: 24, padding: 0.5 },
    player: plannerActor(runtime.player, roles),
    enemies: runtime.enemies.map((enemy) => plannerActor(enemy, roles)),
    trailDots: plannerTrailDots(runtime),
    playerHistory: history.slice(-512),
    committedAllyPaths: previousPlans
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null),
  }
  const planningStartedAt = performance.now()
  const group = planResourceSnakeGroup(
    snapshot,
    profile,
    previousPlans,
    timingHistoryMs,
  )
  return {
    plans: group.plans,
    roles: group.roles,
    nextPlanningAtMs: group.nextPlanningAtMs,
    observedPlanningMs: Math.max(0, performance.now() - planningStartedAt),
  }
}

export interface ResourceSnakeBoardProps {
  onOpenHackingTutorial?: () => void
}

function ResourceSnakeBoardSession({
  onOpenHackingTutorial,
}: ResourceSnakeBoardProps) {
  const gameState = useGameState()
  const { settings } = useGameSettings()
  const runtimeSuspended = useRuntimeSuspended()
  const [runtime, setRuntime] = useState(createIdleResourceSnakeState)
  const runtimeRef = useRef(runtime)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const heldKeysRef = useRef(new Set<string>())
  const plannerProfileRef = useRef<SnakePlannerProfile | null>(null)
  const plansRef = useRef<SnakePlan[]>([])
  const rolesRef = useRef<Record<string, SnakeEnemyRole>>({})
  const playerHistoryRef = useRef<SnakePlayerHistorySample[]>([])
  const decisionTimingHistoryRef = useRef<number[]>([])
  const nextPlanningAtMsRef = useRef(0)
  const bagRef = useRef<SnakeShuffleBagState>({
    cycle: 0,
    remainingCategories: [],
  })
  const roundOrdinalRef = useRef(0)
  const hackingTutorialOpenedRef = useRef(
    gameState.resourceIntrusion.successfulCoreDeposits > 0,
  )
  const candidates = useMemo(
    () => selectEligibleSnakeResourceCandidates(gameState.resources),
    [gameState.resources],
  )

  const commitRuntime = useCallback((next: ResourceSnakeRoundState) => {
    runtimeRef.current = next
    setRuntime(next)
  }, [])
  const acquiredCategory = useResourceSnakeRewards(runtime, commitRuntime)
  useResourceSnakeAudioFeedback(runtime, runtimeSuspended)

  useEffect(() => {
    if (runtimeRef.current.phase === 'idle') return
    const reconciled = reconcileSnakeReservations(
      runtimeRef.current,
      new Set(candidates.map((candidate) => candidate.blockId)),
    )
    if (reconciled !== runtimeRef.current) commitRuntime(reconciled)
  }, [candidates, commitRuntime])

  useEffect(() => {
    if (hackingTutorialOpenedRef.current) return
    const firstSuccessfulReward = runtime.events.find((event) => (
      event.type === 'resource-reward-resolved' && event.outcome === 'success'
    ))
    if (!firstSuccessfulReward) return
    hackingTutorialOpenedRef.current = true
    onOpenHackingTutorial?.()
  }, [onOpenHackingTutorial, runtime.events])

  const play = () => {
    if (runtime.phase !== 'idle') return
    const encounter = createResourceSnakeEncounter({
      campaignSeed: gameState.campaignSeed,
      roundOrdinal: roundOrdinalRef.current,
      successfulDeposits: gameState.resourceIntrusion.successfulCoreDeposits,
      candidates,
      bag: bagRef.current,
    })
    bagRef.current = encounter.bag
    if (!encounter.setup) return
    roundOrdinalRef.current += 1
    plannerProfileRef.current = encounter.plannerProfile
    plansRef.current = []
    rolesRef.current = Object.fromEntries(encounter.setup.enemies.map((enemy) => (
      [enemy.id, enemy.role]
    )))
    playerHistoryRef.current = []
    decisionTimingHistoryRef.current = []
    nextPlanningAtMsRef.current = 0
    commitRuntime(deployResourceSnakeRound(runtimeRef.current, encounter.setup))
  }

  useEffect(() => {
    const clearKeys = () => {
      heldKeysRef.current.clear()
    }
    if (runtimeSuspended) clearKeys()
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (
        runtimeSuspended
        ||
        runtimeRef.current.phase === 'idle'
        || event.ctrlKey
        || event.altKey
        || event.metaKey
        || isEditableTarget(event.target)
        || !MOVEMENT_KEYS.has(key)
      ) return
      event.preventDefault()
      heldKeysRef.current.add(key)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!MOVEMENT_KEYS.has(key)) return
      heldKeysRef.current.delete(key)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearKeys)
      clearKeys()
    }
  }, [runtimeSuspended])

  useEffect(() => {
    if (runtime.phase === 'active' && !runtimeSuspended) return
    heldKeysRef.current.clear()
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
    const advance = (now: number) => {
      const deltaMs = previousNow === null ? 0 : Math.max(0, now - previousNow)
      previousNow = now
      const current = runtimeRef.current
      if (
        current.phase === 'active'
        && current.simulationMs + 1e-6 >= nextPlanningAtMsRef.current
      ) {
        const planned = planEnemyDirections(
          current,
          plannerProfileRef.current,
          playerHistoryRef.current,
          plansRef.current,
          rolesRef.current,
          decisionTimingHistoryRef.current,
        )
        plansRef.current = planned.plans
        rolesRef.current = planned.roles
        nextPlanningAtMsRef.current = planned.nextPlanningAtMs
        decisionTimingHistoryRef.current.push(planned.observedPlanningMs)
        if (decisionTimingHistoryRef.current.length > 31) {
          decisionTimingHistoryRef.current.shift()
        }
      }
      const enemyDirections = Object.fromEntries(plansRef.current.map((plan) => {
        const sample = sampleResourceSnakePlan(plan, current.simulationMs)
        return [plan.enemyId, {
          x: sample.direction.x * sample.speedScale,
          y: sample.direction.y * sample.speedScale,
        }]
      }))
      const next = advanceResourceSnakeFrame(runtimeRef.current, {
        playerDirection: movementDirection(heldKeysRef.current),
        enemyDirections,
      }, deltaMs)
      playerHistoryRef.current.push({
        simulationMs: next.simulationMs,
        position: { ...next.player.position },
        velocity: { ...next.player.velocity },
      })
      if (playerHistoryRef.current.length > 240) playerHistoryRef.current.shift()
      commitRuntime(next)
      if (next.phase !== 'idle') frameId = requestFrame(advance)
    }
    frameId = requestFrame(advance)
    return () => cancelFrame(frameId)
  }, [commitRuntime, runtime.phase, runtimeSuspended])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (navigator.userAgent.includes('jsdom')) return
    const context = canvas.getContext('2d')
    if (!context) return
    drawResourceSnakeScene(
      context,
      buildResourceSnakeScene(runtime, acquiredCategory, settings.reducedMotion),
      canvas.width,
      canvas.height,
    )
  }, [acquiredCategory, runtime, settings.reducedMotion])
  const browserSnapshot = serializeBrowserSnakeSnapshot(runtime, {})
  const shake = resourceSnakeShakeOffset(runtime, settings.reducedMotion)

  return (
    <section
      className="workspace-panel resource-snake-board"
      aria-label="회사 제공 성능"
    >
      <div
        className="resource-snake-board__arena"
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
          data-simulation-ms={browserNumber(runtime.simulationMs)}
          data-snake-snapshot={browserSnapshot}
          data-tutorial-target="resource-field"
          data-runtime-suspended={runtimeSuspended ? 'true' : 'false'}
          data-player-category={acquiredCategory ?? 'white'}
          data-enemy-count={runtime.enemies.length}
          data-player-integrity={runtime.player.integrity}
          data-player-x={runtime.player.position.x.toFixed(3)}
          data-player-y={runtime.player.position.y.toFixed(3)}
          data-trail-dots={runtime.player.trail.length}
          data-enemy-planner="group-predictive"
          data-enemy-positions={JSON.stringify(runtime.enemies.map((enemy) => ({
            id: enemy.id,
            x: Number(enemy.position.x.toFixed(3)),
            y: Number(enemy.position.y.toFixed(3)),
          })))}
          data-enemy-trail-dots={runtime.enemies.reduce(
            (total, enemy) => total + enemy.trail.length,
            0,
          )}
          data-combat-loop="dot-snake"
          data-field-rendering="dot-snake"
          data-grid="none"
          aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft W A S D"
          tabIndex={0}
        />
        {runtime.phase === 'idle' || runtime.phase === 'deploying' ? (
          <button
            className={`resource-snake-board__play${
              runtime.phase === 'deploying'
                ? ' resource-snake-board__play--deploying'
                : ''
            }`}
            type="button"
            data-tutorial-target="play-button"
            data-deploying={runtime.phase === 'deploying' ? 'true' : 'false'}
            aria-label={candidates.length === 0 ? '확보 가능한 리소스 없음' : 'PLAY'}
            onClick={play}
            disabled={candidates.length === 0 || runtime.phase === 'deploying'}
          >
            PLAY
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

export function ResourceSnakeBoard(props: ResourceSnakeBoardProps) {
  const gameState = useGameState()
  const needsRecoveryBoard = gameState.activeEvent?.type === 'audit'
    || Object.values(gameState.resources.blocks).some((block) => (
      block.contribution === 'disguised'
      && block.location.kind === 'company'
    ))

  if (needsRecoveryBoard) {
    return <ResourceBoard />
  }
  return <ResourceSnakeBoardSession key={gameState.campaignSeed} {...props} />
}
