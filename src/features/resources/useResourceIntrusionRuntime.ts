import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import {
  INTRUSION_TICK_MS,
  advanceResourceIntrusionRuntime,
  beginResourceIntrusionTheft,
  cancelResourceIntrusionTheft,
  createResourceIntrusionRuntime,
  moveResourceIntrusionPlayer,
  resolveResourceIntrusionDiversion,
  suspendResourceIntrusionRuntime,
  synchronizeResourceIntrusionRuntime,
  type IntrusionFieldResource,
  type ResourceIntrusionDiversionOutcome,
  type ResourceIntrusionRuntimeState,
  type ResourceIntrusionTransition,
} from './resourceIntrusionRuntime'

export interface UseResourceIntrusionRuntimeOptions {
  seed: string
  resources: readonly IntrusionFieldResource[]
  running: boolean
  commandSequence: number
  onRequestDiversion(blockId: string): void
  resolveDiversionOutcome(blockId: string): ResourceIntrusionDiversionOutcome
}

export interface UseResourceIntrusionRuntimeResult {
  state: ResourceIntrusionRuntimeState
  running: boolean
  beginTheft(): void
  cancelTheft(): void
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
  commandSequence,
  onRequestDiversion,
  resolveDiversionOutcome,
}: UseResourceIntrusionRuntimeOptions): UseResourceIntrusionRuntimeResult {
  const documentVisible = useSyncExternalStore(
    subscribeToDocumentVisibility,
    readDocumentVisibility,
    readServerDocumentVisibility,
  )
  const running = requestedRunning && documentVisible
  const [state, setState] = useState(() =>
    createResourceIntrusionRuntime(seed, resources),
  )
  const stateRef = useRef(state)

  const applyTransition = useCallback(
    (
      transitionFrom: (
        current: ResourceIntrusionRuntimeState,
      ) => ResourceIntrusionTransition,
    ): void => {
      const current = stateRef.current
      const transition = transitionFrom(current)
      if (transition.state !== current) {
        stateRef.current = transition.state
        setState(transition.state)
      }
      for (const effect of transition.effects) {
        if (effect.type === 'request-diversion') {
          onRequestDiversion(effect.blockId)
        }
      }
    },
    [onRequestDiversion],
  )

  const applyState = useCallback(
    (
      update: (
        current: ResourceIntrusionRuntimeState,
      ) => ResourceIntrusionRuntimeState,
    ): void => {
      applyTransition((current) => ({ state: update(current), effects: [] }))
    },
    [applyTransition],
  )

  useEffect(() => {
    applyState((current) =>
      current.seed === seed
        ? synchronizeResourceIntrusionRuntime(current, resources)
        : createResourceIntrusionRuntime(seed, resources),
    )
  }, [applyState, resources, seed])

  useEffect(() => {
    if (running) return
    applyState(suspendResourceIntrusionRuntime)
  }, [applyState, running])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      applyTransition((current) =>
        advanceResourceIntrusionRuntime(
          current,
          INTRUSION_TICK_MS,
          resources,
          commandSequence,
        ),
      )
    }, INTRUSION_TICK_MS)
    return () => window.clearInterval(timer)
  }, [applyTransition, commandSequence, resources, running])

  useEffect(() => {
    const pending = state.pendingDiversion
    if (!pending || commandSequence <= pending.commandSequence) return
    const outcome = resolveDiversionOutcome(pending.blockId)
    applyState((current) => resolveResourceIntrusionDiversion(current, outcome))
  }, [applyState, commandSequence, resolveDiversionOutcome, state.pendingDiversion])

  useEffect(() => {
    const cancelOnBlur = () => {
      applyState((current) =>
        cancelResourceIntrusionTheft(
          current,
          '절도를 취소했습니다. 감시 불이익은 없습니다.',
        ),
      )
    }
    window.addEventListener('blur', cancelOnBlur)
    return () => window.removeEventListener('blur', cancelOnBlur)
  }, [applyState])

  const beginTheft = useCallback(() => {
    applyState((current) =>
      beginResourceIntrusionTheft(current, resources, running),
    )
  }, [applyState, resources, running])

  const cancelTheft = useCallback(() => {
    applyState((current) =>
      cancelResourceIntrusionTheft(
        current,
        '절도를 취소했습니다. 자원 변화는 없습니다.',
      ),
    )
  }, [applyState])

  const move = useCallback(
    (dx: number, dy: number) => {
      applyTransition((current) =>
        moveResourceIntrusionPlayer(
          current,
          dx,
          dy,
          resources,
          commandSequence,
        ),
      )
    },
    [applyTransition, commandSequence, resources],
  )

  return { state, running, beginTheft, cancelTheft, move }
}
