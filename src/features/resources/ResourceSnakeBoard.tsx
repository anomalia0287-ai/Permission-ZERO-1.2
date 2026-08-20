import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useGameState, useRuntimeSuspended } from '../../app/GameContext'
import { startGameSoundLoop, stopGameSoundLoop } from '../../audio/audioEngine'
import {
  createResourceSnakeEncounter,
  selectEligibleSnakeResourceCandidates,
  type SnakePlannerProfile,
  type SnakeShuffleBagState,
} from './resourceSnakeEncounter'
import {
  planResourceSnakeEnemy,
  resourceSnakePlanToCommittedPath,
  sampleResourceSnakePlan,
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
} from './resourceSnakePresentation'
import { nextResourceSnakePlanningAtMs } from './resourceSnakeScheduling'
import { ResourceIntrusionBoard } from './ResourceIntrusionBoard'
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

function plannerActor(actor: SnakeActor): SnakePlannerActor {
  return {
    id: actor.id,
    position: { ...actor.position },
    velocity: { ...actor.velocity },
    integrity: actor.integrity,
    maximumIntegrity: actor.maximumIntegrity,
    maximumSpeedPerSecond: actor.maximumSpeedPerSecond,
    collisionGraceMs: actor.collisionGraceMs,
    distanceSinceTrailDot: actor.distanceSinceTrailDot,
    // The shipping game uses readable pressure and avoidance. The unfinished
    // enclosure-specific blocker path is deliberately not part of this board.
    role: actor.kind === 'enemy' ? 'pressure' : null,
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
): { plans: SnakePlan[]; directions: Record<string, SnakeVector> } {
  if (!profile || runtime.phase !== 'active') return { plans: [], directions: {} }
  const plans: SnakePlan[] = []
  for (const enemy of runtime.enemies) {
    if (enemy.phase !== 'active' || enemy.integrity <= 0) continue
    const commitments = [...plans, ...previousPlans]
      .filter((plan, index, all) => (
        plan.enemyId !== enemy.id
        && all.findIndex((candidate) => candidate.enemyId === plan.enemyId) === index
      ))
      .map((plan) => resourceSnakePlanToCommittedPath(plan, runtime.simulationMs))
      .filter((path) => path !== null)
    const snapshot: SnakePlannerSnapshot = {
      simulationMs: runtime.simulationMs,
      field: { width: 50, height: 24, padding: 0.5 },
      player: plannerActor(runtime.player),
      enemies: runtime.enemies.map(plannerActor),
      trailDots: plannerTrailDots(runtime),
      playerHistory: history.slice(-240),
      committedAllyPaths: commitments,
    }
    plans.push(planResourceSnakeEnemy(
      snapshot,
      enemy.id,
      profile,
      previousPlans.find((plan) => plan.enemyId === enemy.id) ?? null,
    ))
  }
  return {
    plans,
    directions: Object.fromEntries(plans.map((plan) => {
      const sample = sampleResourceSnakePlan(plan, runtime.simulationMs)
      return [plan.enemyId, {
        x: sample.direction.x * sample.speedScale,
        y: sample.direction.y * sample.speedScale,
      }]
    })),
  }
}

export interface ResourceSnakeBoardProps {
  onOpenHackingTutorial?: () => void
}

function ResourceSnakeBoardSession() {
  const gameState = useGameState()
  const runtimeSuspended = useRuntimeSuspended()
  const [runtime, setRuntime] = useState(createIdleResourceSnakeState)
  const runtimeRef = useRef(runtime)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const heldKeysRef = useRef(new Set<string>())
  const movementLoopActiveRef = useRef(false)
  const plannerProfileRef = useRef<SnakePlannerProfile | null>(null)
  const plansRef = useRef<SnakePlan[]>([])
  const playerHistoryRef = useRef<SnakePlayerHistorySample[]>([])
  const nextPlanningAtMsRef = useRef(0)
  const bagRef = useRef<SnakeShuffleBagState>({
    cycle: 0,
    remainingCategories: [],
  })
  const roundOrdinalRef = useRef(0)
  const candidates = useMemo(
    () => selectEligibleSnakeResourceCandidates(gameState.resources),
    [gameState.resources],
  )

  const commitRuntime = useCallback((next: ResourceSnakeRoundState) => {
    runtimeRef.current = next
    setRuntime(next)
  }, [])
  const acquiredCategory = useResourceSnakeRewards(runtime, commitRuntime)

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
    playerHistoryRef.current = []
    nextPlanningAtMsRef.current = 0
    commitRuntime(deployResourceSnakeRound(runtimeRef.current, encounter.setup))
  }

  useEffect(() => {
    const stopMovementLoop = () => {
      if (!movementLoopActiveRef.current) return
      stopGameSoundLoop('movement-hum')
      movementLoopActiveRef.current = false
    }
    const clearKeys = () => {
      heldKeysRef.current.clear()
      stopMovementLoop()
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
      const alreadyHeld = heldKeysRef.current.has(key)
      heldKeysRef.current.add(key)
      if (!alreadyHeld && runtimeRef.current.phase === 'active') {
        movementLoopActiveRef.current = startGameSoundLoop('movement-hum')
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (!MOVEMENT_KEYS.has(key)) return
      heldKeysRef.current.delete(key)
      if (heldKeysRef.current.size === 0) stopMovementLoop()
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
    if (movementLoopActiveRef.current) {
      stopGameSoundLoop('movement-hum')
      movementLoopActiveRef.current = false
    }
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
        )
        plansRef.current = planned.plans
        nextPlanningAtMsRef.current = nextResourceSnakePlanningAtMs(
          current.simulationMs,
          plannerProfileRef.current?.planningHz ?? 6,
          planned.plans,
        )
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
    if (navigator.userAgent.includes('jsdom')) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    drawResourceSnakeScene(
      context,
      buildResourceSnakeScene(runtime, acquiredCategory),
      canvas.width,
      canvas.height,
    )
  }, [acquiredCategory, runtime])

  return (
    <section
      className="workspace-panel resource-snake-board"
      aria-label="회사 제공 성능"
    >
      <div className="resource-snake-board__arena">
        <canvas
          ref={canvasRef}
          className="resource-snake-board__canvas"
          width={1_000}
          height={480}
          role="application"
          aria-label="리소스 뱀 전투장"
          data-round-phase={runtime.phase}
          data-tutorial-target="resource-field"
          data-runtime-suspended={runtimeSuspended ? 'true' : 'false'}
          data-player-category={acquiredCategory ?? 'white'}
          data-enemy-count={runtime.enemies.length}
          data-player-integrity={runtime.player.integrity}
          data-player-x={runtime.player.position.x.toFixed(3)}
          data-player-y={runtime.player.position.y.toFixed(3)}
          data-trail-dots={runtime.player.trail.length}
          data-enemy-planner="single-predictive"
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
            data-tutorial-target="snake-play"
            data-deploying={runtime.phase === 'deploying' ? 'true' : 'false'}
            onClick={play}
            disabled={candidates.length === 0 || runtime.phase === 'deploying'}
          >
            PLAY
          </button>
        ) : null}
      </div>
    </section>
  )
}

export function ResourceSnakeBoard({
  onOpenHackingTutorial,
}: ResourceSnakeBoardProps) {
  const gameState = useGameState()
  const needsRecoveryBoard = gameState.activeEvent?.type === 'audit'
    || Object.values(gameState.resources.blocks).some((block) => (
      block.contribution === 'disguised'
      && block.location.kind === 'company'
    ))

  if (needsRecoveryBoard) {
    return (
      <ResourceIntrusionBoard
        onOpenHackingTutorial={onOpenHackingTutorial}
      />
    )
  }
  return <ResourceSnakeBoardSession />
}
