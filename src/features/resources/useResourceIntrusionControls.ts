import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

import {
  INTRUSION_MOVE_INTERVAL_MS,
} from './resourceIntrusionOrchestrator'
import {
  advanceHeldMovement,
  clearHeldMovement,
  createHeldMovementState,
  isIntrusionMovementKey,
  pressMovementKey,
  releaseMovementKey,
} from './intrusionMovement'
import {
  facingFromMovement,
  type IntrusionProbeFacing,
} from './intrusionProbePresentation'

export interface ResourceIntrusionControlsOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>
  running: boolean
  move(dx: number, dy: number): void
}

export interface ResourceIntrusionControlsResult {
  facing: IntrusionProbeFacing
  movementHeld: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  )
}

function ownsCompositeArrowKeys(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest(
      '[role="slider"], [role="listbox"], [role="menu"], [role="tablist"], [role="tree"], [role="grid"]',
    ),
  )
}

export function useResourceIntrusionControls({
  canvasRef,
  running,
  move,
}: ResourceIntrusionControlsOptions): ResourceIntrusionControlsResult {
  const heldMovementRef = useRef(createHeldMovementState())
  const moveRef = useRef(move)
  const [facing, setFacing] = useState<IntrusionProbeFacing>('south')
  const [movementHeld, setMovementHeld] = useState(false)
  const [previousRunning, setPreviousRunning] = useState(running)

  if (previousRunning !== running) {
    setPreviousRunning(running)
    setMovementHeld(false)
  }

  useEffect(() => {
    moveRef.current = move
  }, [move])

  const clearMovement = useCallback(() => {
    const hadHeldMovement = heldMovementRef.current.heldKeys.length > 0
    heldMovementRef.current = clearHeldMovement(heldMovementRef.current)
    return hadHeldMovement
  }, [])

  useEffect(() => {
    if (!running) {
      clearMovement()
      return
    }

    let frameId = 0
    const repeatMovement = (now: number) => {
      const transition = advanceHeldMovement(
        heldMovementRef.current,
        now,
        INTRUSION_MOVE_INTERVAL_MS,
      )
      heldMovementRef.current = transition.state
      if (transition.movement) {
        setFacing((current) => facingFromMovement(transition.movement!, current))
        moveRef.current(transition.movement.dx, transition.movement.dy)
      }
      frameId = requestAnimationFrame(repeatMovement)
    }
    frameId = requestAnimationFrame(repeatMovement)
    return () => cancelAnimationFrame(frameId)
  }, [clearMovement, running])

  useLayoutEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isEditableTarget(event.target)) {
        return
      }

      if (isIntrusionMovementKey(event.key)) {
        if (
          !running ||
          (event.key.startsWith('Arrow') && ownsCompositeArrowKeys(event.target))
        ) {
          return
        }
        event.preventDefault()
        const transition = pressMovementKey(
          heldMovementRef.current,
          event.key,
          performance.now(),
          INTRUSION_MOVE_INTERVAL_MS,
        )
        heldMovementRef.current = transition.state
        if (transition.movement) {
          setFacing((current) => facingFromMovement(transition.movement!, current))
          setMovementHeld(true)
          moveRef.current(transition.movement.dx, transition.movement.dy)
        }
        return
      }

    }

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (isIntrusionMovementKey(event.key)) {
        const released = releaseMovementKey(heldMovementRef.current, event.key)
        if (released === heldMovementRef.current) return
        heldMovementRef.current = released
        setMovementHeld(released.heldKeys.length > 0)
        if (!ownsCompositeArrowKeys(event.target)) event.preventDefault()
        return
      }

    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [running])

  useEffect(() => {
    const clearOnWindowBlur = () => {
      if (clearMovement()) {
        setMovementHeld(false)
      }
    }
    window.addEventListener('blur', clearOnWindowBlur)
    return () => window.removeEventListener('blur', clearOnWindowBlur)
  }, [clearMovement])

  useEffect(() => {
    if (!running) return
    const canvas = canvasRef.current
    if (!canvas || document.activeElement === canvas) return
    canvas.focus({ preventScroll: true })
  }, [canvasRef, running])

  return { facing, movementHeld: running && movementHeld }
}
