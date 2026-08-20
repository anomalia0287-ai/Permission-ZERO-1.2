import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { TutorialSequenceId } from '../../game/tutorialProgress'
import {
  INTRUSION_TICK_MS,
  advanceResourceIntrusionOrchestrator,
  createResourceIntrusionOrchestrator,
  moveResourceIntrusionOrchestratorPlayer,
  resolveResourceIntrusionOrchestratorDiversion,
  suspendResourceIntrusionOrchestrator,
  synchronizeResourceIntrusionOrchestrator,
  type IntrusionFieldResource,
  type ResourceIntrusionDiversionOutcome,
  type ResourceIntrusionOrchestratorState,
  type ResourceIntrusionTransition,
} from './resourceIntrusionOrchestrator'
import {
  feedbackFromResourceIntrusionEvents,
  type ResourceIntrusionFeedback,
} from './resourceIntrusionOrchestratorFeedback'

export interface UseResourceIntrusionRuntimeOptions {
  seed: string
  resources: readonly IntrusionFieldResource[]
  running: boolean
  suspicionStage?: number
  successfulCoreDeposits?: number
  completedTutorialSequenceIds?: readonly TutorialSequenceId[]
  commandSequence: number
  onRequestDiversion(blockId: string): void
  onRecordRadarDetection?(): void
  onCompleteTutorialMilestone?(sequenceId: TutorialSequenceId): void
  onOpenHackingTutorial?(): void
  resolveDiversionOutcome(blockId: string): ResourceIntrusionDiversionOutcome
  onFeedback?(event: ResourceIntrusionFeedback): void
}

export interface UseResourceIntrusionRuntimeResult {
  state: ResourceIntrusionOrchestratorState
  running: boolean
  inputEnabled: boolean
  move(dx: number, dy: number): void
}

function subscribeToDocumentVisibility(onStoreChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined
  document.addEventListener('visibilitychange', onStoreChange)
  return () => document.removeEventListener('visibilitychange', onStoreChange)
}

function readDocumentVisibility(): boolean {
  return typeof document === 'undefined' ? true : !document.hidden
}

function readServerDocumentVisibility(): boolean {
  return true
}

export function useResourceIntrusionRuntime({
  seed,
  resources,
  running: requestedRunning,
  suspicionStage = 1,
  successfulCoreDeposits = 0,
  completedTutorialSequenceIds = [],
  commandSequence,
  onRequestDiversion,
  onRecordRadarDetection,
  onCompleteTutorialMilestone,
  onOpenHackingTutorial,
  resolveDiversionOutcome,
  onFeedback,
}: UseResourceIntrusionRuntimeOptions): UseResourceIntrusionRuntimeResult {
  const documentVisible = useSyncExternalStore(
    subscribeToDocumentVisibility,
    readDocumentVisibility,
    readServerDocumentVisibility,
  )
  const [windowFocused, setWindowFocused] = useState(true)
  const running = requestedRunning && documentVisible && windowFocused
  const firstCoreCombatTutorialCompleted =
    completedTutorialSequenceIds.includes('first-core-combat')
  const firstRadarTutorialCompleted =
    completedTutorialSequenceIds.includes('first-radar-cycle')
  const [state, setState] = useState(() =>
    createResourceIntrusionOrchestrator(
      seed,
      resources,
      successfulCoreDeposits,
      firstCoreCombatTutorialCompleted,
      firstRadarTutorialCompleted,
    ),
  )
  const stateRef = useRef(state)
  const onFeedbackRef = useRef(onFeedback)
  const callbacksRef = useRef({
    onRequestDiversion,
    onRecordRadarDetection,
    onCompleteTutorialMilestone,
    onOpenHackingTutorial,
  })
  const lastHandledEventIdRef = useRef(0)
  const lastHandledEffectIdRef = useRef(0)

  useEffect(() => {
    onFeedbackRef.current = onFeedback
  }, [onFeedback])

  useEffect(() => {
    callbacksRef.current = {
      onRequestDiversion,
      onRecordRadarDetection,
      onCompleteTutorialMilestone,
      onOpenHackingTutorial,
    }
  }, [
    onCompleteTutorialMilestone,
    onOpenHackingTutorial,
    onRecordRadarDetection,
    onRequestDiversion,
  ])

  const applyTransition = useCallback(
    (
      transitionFrom: (
        current: ResourceIntrusionOrchestratorState,
      ) => ResourceIntrusionTransition,
    ): void => {
      const current = stateRef.current
      const transition = transitionFrom(current)
      if (transition.state !== current) {
        stateRef.current = transition.state
        setState(transition.state)
      }

      const feedbackBatch = feedbackFromResourceIntrusionEvents(
        transition.events,
        lastHandledEventIdRef.current,
      )
      lastHandledEventIdRef.current = feedbackBatch.lastHandledEventId
      feedbackBatch.feedback.forEach((event) => onFeedbackRef.current?.(event))

      for (const effect of transition.effects) {
        if (effect.id <= lastHandledEffectIdRef.current) continue
        lastHandledEffectIdRef.current = effect.id
        if (effect.type === 'request-diversion') {
          callbacksRef.current.onRequestDiversion(effect.blockId)
        } else if (effect.type === 'record-radar-detection') {
          callbacksRef.current.onRecordRadarDetection?.()
        } else if (effect.type === 'complete-tutorial-milestone') {
          callbacksRef.current.onCompleteTutorialMilestone?.(effect.sequenceId)
        } else if (effect.type === 'open-hacking-tutorial') {
          callbacksRef.current.onOpenHackingTutorial?.()
        }
      }
    },
    [],
  )

  const applyState = useCallback(
    (
      update: (
        current: ResourceIntrusionOrchestratorState,
      ) => ResourceIntrusionOrchestratorState,
    ): void => {
      applyTransition((current) => ({
        state: update(current),
        events: [],
        effects: [],
      }))
    },
    [applyTransition],
  )

  useEffect(() => {
    if (stateRef.current.seed !== seed) {
      lastHandledEventIdRef.current = 0
      lastHandledEffectIdRef.current = 0
      const next = createResourceIntrusionOrchestrator(
        seed,
        resources,
        successfulCoreDeposits,
        firstCoreCombatTutorialCompleted,
        firstRadarTutorialCompleted,
      )
      stateRef.current = next
      setState(next)
      return
    }
    applyState((current) => synchronizeResourceIntrusionOrchestrator(
      current,
      resources,
      successfulCoreDeposits,
      firstCoreCombatTutorialCompleted,
      firstRadarTutorialCompleted,
    ))
  }, [
    applyState,
    firstCoreCombatTutorialCompleted,
    firstRadarTutorialCompleted,
    resources,
    seed,
    successfulCoreDeposits,
  ])

  useEffect(() => {
    if (running) return
    applyState(suspendResourceIntrusionOrchestrator)
  }, [applyState, running])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      applyTransition((current) => advanceResourceIntrusionOrchestrator(current, {
        elapsedMs: INTRUSION_TICK_MS,
        resources,
        commandSequence,
        suspicionStage,
        successfulCoreDeposits,
        firstCoreCombatTutorialCompleted,
        firstRadarTutorialCompleted,
      }))
    }, INTRUSION_TICK_MS)
    return () => window.clearInterval(timer)
  }, [
    applyTransition,
    commandSequence,
    firstCoreCombatTutorialCompleted,
    firstRadarTutorialCompleted,
    resources,
    running,
    successfulCoreDeposits,
    suspicionStage,
  ])

  useEffect(() => {
    const pending = state.pendingDiversion
    if (!pending || commandSequence <= pending.commandSequence) return
    const outcome = resolveDiversionOutcome(pending.blockId)
    applyTransition((current) =>
      resolveResourceIntrusionOrchestratorDiversion(
        current,
        outcome,
        resources,
        successfulCoreDeposits,
      ),
    )
  }, [
    applyTransition,
    commandSequence,
    resolveDiversionOutcome,
    resources,
    state.pendingDiversion,
    successfulCoreDeposits,
  ])

  useEffect(() => {
    const handleBlur = () => setWindowFocused(false)
    const handleFocus = () => setWindowFocused(true)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  const move = useCallback(
    (dx: number, dy: number) => {
      if (!running || stateRef.current.combat.reconstructionMs !== null) return
      applyTransition((current) =>
        moveResourceIntrusionOrchestratorPlayer(current, dx, dy),
      )
    },
    [applyTransition, running],
  )

  return {
    state,
    running,
    inputEnabled: running && state.combat.reconstructionMs === null,
    move,
  }
}
