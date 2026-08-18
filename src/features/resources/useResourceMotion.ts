import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

import {
  RESOURCE_FIXED_STEP_SECONDS,
  RESOURCE_MAX_FRAME_SECONDS,
  RESOURCE_MAX_STEPS_PER_FRAME,
  ResourceMotionController,
  type ResourceFieldObstacle,
  type ResourceMotionSnapshot,
} from './resourceFieldPhysics'

export interface ResourceMotionObstacleRef {
  id: string
  ref: RefObject<HTMLElement | null>
}

export interface UseResourceMotionOptions {
  ids: readonly string[]
  containerRef: RefObject<HTMLElement | null>
  radius: number
  obstacleRefs?: readonly ResourceMotionObstacleRef[]
  reducedMotion: boolean
  active: boolean
  motionRate?: number
}

export interface UseResourceMotionResult {
  geometryRevision: number
  beginDrag(id: string): boolean
  dragTo(id: string, point: { x: number; y: number }): boolean
  endDrag(id: string, releaseVelocity?: { x: number; y: number }): boolean
  cancelDrag(id: string): boolean
  getSnapshot(): ResourceMotionSnapshot
  registerBody(id: string, element: HTMLElement | null): void
  focusNearest(
    fromId: string,
    direction: 'left' | 'right' | 'up' | 'down',
  ): string | null
}

const EMPTY_OBSTACLE_REFS: readonly ResourceMotionObstacleRef[] = []

function normalizedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right))
}

function emptySnapshot(): ResourceMotionSnapshot {
  return { bodies: new Map(), bounds: { width: 0, height: 0 } }
}

function finiteRect(rect: DOMRect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.right) &&
    Number.isFinite(rect.bottom) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  )
}

export function useResourceMotion({
  ids,
  containerRef,
  radius,
  obstacleRefs = EMPTY_OBSTACLE_REFS,
  reducedMotion,
  active,
  motionRate = 1,
}: UseResourceMotionOptions): UseResourceMotionResult {
  const [geometryRevision, setGeometryRevision] = useState(0)
  const controllerRef = useRef<ResourceMotionController | null>(null)
  const bodyElementsRef = useRef(new Map<string, HTMLElement>())
  const idsRef = useRef(new Set<string>())
  const containerRefRef = useRef(containerRef)
  const obstacleRefsRef = useRef(obstacleRefs)
  const radiusRef = useRef(radius)
  const activeRef = useRef(active)
  const reducedMotionRef = useRef(reducedMotion)
  const motionRateRef = useRef(motionRate)
  const mountedRef = useRef(false)
  const frameIdRef = useRef<number | null>(null)
  const frameGenerationRef = useRef(0)
  const lastFrameTimeRef = useRef<number | null>(null)
  const accumulatorRef = useRef(0)
  const runFrameRef = useRef<(timestamp: number) => void>(() => undefined)
  const observerRef = useRef<ResizeObserver | null>(null)
  const observedTargetsRef = useRef(new Set<Element>())
  const observedTargetRevisionRef = useRef(0)
  const appliedGeometrySignatureRef = useRef<string | null>(null)
  const appliedIdsKeyRef = useRef<string | null>(null)
  const appliedReducedMotionRef = useRef<boolean | null>(null)
  const geometryInvalidRef = useRef(true)
  const measureGeometryRef = useRef<() => void>(() => undefined)
  const reconcileTargetsRef = useRef<() => void>(() => undefined)

  const sortedIds = normalizedIds(ids)
  const idsKey = sortedIds.join('\u0000')
  useLayoutEffect(() => {
    idsRef.current = new Set(sortedIds)
    containerRefRef.current = containerRef
    obstacleRefsRef.current = obstacleRefs
    radiusRef.current = radius
    activeRef.current = active
    reducedMotionRef.current = reducedMotion
    motionRateRef.current =
      Number.isFinite(motionRate) && motionRate > 0 ? motionRate : 1
  })

  const applyTransforms = useCallback((): void => {
    const controller = controllerRef.current
    if (controller === null) {
      return
    }
    const snapshot = controller.snapshot()
    for (const [id, element] of bodyElementsRef.current) {
      const body = snapshot.bodies.get(id)
      if (body !== undefined) {
        element.style.transform = `translate3d(${body.x - body.radius}px, ${
          body.y - body.radius
        }px, 0)`
      }
    }
  }, [])

  const cancelFrameLoop = useCallback((): void => {
    frameGenerationRef.current += 1
    if (frameIdRef.current !== null) {
      cancelAnimationFrame(frameIdRef.current)
      frameIdRef.current = null
    }
    lastFrameTimeRef.current = null
    accumulatorRef.current = 0
  }, [])

  const shouldRunContinuously = useCallback((): boolean => {
    return (
      mountedRef.current &&
      activeRef.current &&
      !reducedMotionRef.current &&
      !geometryInvalidRef.current &&
      controllerRef.current !== null &&
      idsRef.current.size > 0 &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden')
    )
  }, [])

  const scheduleFrame = useCallback((): void => {
    if (!shouldRunContinuously() || frameIdRef.current !== null) {
      return
    }
    const generation = frameGenerationRef.current
    let scheduledId = 0
    scheduledId = requestAnimationFrame((timestamp) => {
      if (
        generation !== frameGenerationRef.current ||
        frameIdRef.current !== scheduledId
      ) {
        return
      }
      frameIdRef.current = null
      runFrameRef.current(timestamp)
    })
    frameIdRef.current = scheduledId
  }, [shouldRunContinuously])

  const runFrame = useCallback(
    (timestamp: number): void => {
      if (!shouldRunContinuously()) {
        return
      }
      const controller = controllerRef.current
      if (controller === null) {
        return
      }

      const previousTimestamp = lastFrameTimeRef.current
      lastFrameTimeRef.current = timestamp
      try {
        if (previousTimestamp !== null) {
          const elapsedSeconds = Math.max(
            0,
            Math.min(
              ((timestamp - previousTimestamp) / 1_000) * motionRateRef.current,
              RESOURCE_MAX_FRAME_SECONDS,
            ),
          )
          accumulatorRef.current = Math.min(
            accumulatorRef.current + elapsedSeconds,
            RESOURCE_MAX_FRAME_SECONDS,
          )
          let steps = 0
          while (
            accumulatorRef.current + Number.EPSILON >=
              RESOURCE_FIXED_STEP_SECONDS &&
            steps < RESOURCE_MAX_STEPS_PER_FRAME
          ) {
            controller.step(RESOURCE_FIXED_STEP_SECONDS)
            accumulatorRef.current -= RESOURCE_FIXED_STEP_SECONDS
            steps += 1
          }
        }
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error
        }
        geometryInvalidRef.current = true
        cancelFrameLoop()
        applyTransforms()
        return
      }
      applyTransforms()
      scheduleFrame()
    },
    [
      applyTransforms,
      cancelFrameLoop,
      scheduleFrame,
      shouldRunContinuously,
    ],
  )

  useLayoutEffect(() => {
    runFrameRef.current = runFrame
  }, [runFrame])

  const measureGeometry = useCallback((): void => {
    const container = containerRefRef.current.current
    if (container === null) {
      geometryInvalidRef.current = true
      cancelFrameLoop()
      return
    }

    const containerRect = container.getBoundingClientRect()
    const currentRadius = radiusRef.current
    const bounds = {
      width: container.clientWidth,
      height: container.clientHeight,
    }
    const contentOriginX = containerRect.left + container.clientLeft - container.scrollLeft
    const contentOriginY = containerRect.top + container.clientTop - container.scrollTop
    if (
      !finiteRect(containerRect) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      !Number.isFinite(contentOriginX) ||
      !Number.isFinite(contentOriginY) ||
      !Number.isFinite(currentRadius) ||
      currentRadius <= 0 ||
      currentRadius * 2 > bounds.width ||
      currentRadius * 2 > bounds.height
    ) {
      geometryInvalidRef.current = true
      cancelFrameLoop()
      return
    }

    const obstacles: ResourceFieldObstacle[] = []
    for (const obstacleRef of obstacleRefsRef.current) {
      const element = obstacleRef.ref.current
      if (element === null) {
        continue
      }
      const obstacleRect = element.getBoundingClientRect()
      if (!finiteRect(obstacleRect) || obstacleRect.width <= 0 || obstacleRect.height <= 0) {
        geometryInvalidRef.current = true
        cancelFrameLoop()
        return
      }
      obstacles.push({
        id: obstacleRef.id,
        left: obstacleRect.left - contentOriginX,
        top: obstacleRect.top - contentOriginY,
        right: obstacleRect.right - contentOriginX,
        bottom: obstacleRect.bottom - contentOriginY,
      })
    }
    obstacles.sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.left - right.left ||
        left.top - right.top ||
        left.right - right.right ||
        left.bottom - right.bottom,
    )

    const geometrySignature = JSON.stringify([
      observedTargetRevisionRef.current,
      bounds.width,
      bounds.height,
      currentRadius,
      ...obstacles.flatMap((obstacle) => [
        obstacle.id,
        obstacle.left,
        obstacle.top,
        obstacle.right,
        obstacle.bottom,
      ]),
    ])
    const currentIds = [...idsRef.current]
    const currentIdsKey = currentIds.join('\u0000')
    const currentReducedMotion = reducedMotionRef.current
    const currentController = controllerRef.current
    if (
      currentController !== null &&
      geometrySignature === appliedGeometrySignatureRef.current &&
      currentIdsKey === appliedIdsKeyRef.current &&
      currentReducedMotion === appliedReducedMotionRef.current
    ) {
      geometryInvalidRef.current = false
      scheduleFrame()
      return
    }

    const geometryChanged = geometrySignature !== appliedGeometrySignatureRef.current
    try {
      if (currentController === null || currentIdsKey !== appliedIdsKeyRef.current) {
        const nextController = new ResourceMotionController({
          ids: currentIds,
          bounds,
          radius: currentRadius,
          obstacles,
          reducedMotion: currentReducedMotion,
        })
        controllerRef.current = nextController
        currentController?.dispose()
      } else {
        currentController.setGeometry(bounds, currentRadius, obstacles)
        currentController.setReducedMotion(currentReducedMotion)
      }
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error
      }
      geometryInvalidRef.current = true
      cancelFrameLoop()
      return
    }

    appliedGeometrySignatureRef.current = geometrySignature
    appliedIdsKeyRef.current = currentIdsKey
    appliedReducedMotionRef.current = currentReducedMotion
    geometryInvalidRef.current = false
    applyTransforms()
    if (geometryChanged) {
      setGeometryRevision((revision) => revision + 1)
    }
    scheduleFrame()
  }, [applyTransforms, cancelFrameLoop, scheduleFrame])
  useLayoutEffect(() => {
    measureGeometryRef.current = measureGeometry
  }, [measureGeometry])

  const reconcileTargets = useCallback((): void => {
    const observer = observerRef.current
    if (observer === null) {
      return
    }
    const desiredTargets = new Set<Element>()
    const container = containerRefRef.current.current
    if (container !== null) {
      desiredTargets.add(container)
    }
    for (const obstacleRef of obstacleRefsRef.current) {
      if (obstacleRef.ref.current !== null) {
        desiredTargets.add(obstacleRef.ref.current)
      }
    }

    let targetsChanged = false
    for (const target of observedTargetsRef.current) {
      if (!desiredTargets.has(target)) {
        observer.unobserve(target)
        targetsChanged = true
      }
    }
    for (const target of desiredTargets) {
      if (!observedTargetsRef.current.has(target)) {
        observer.observe(target)
        targetsChanged = true
      }
    }
    observedTargetsRef.current = desiredTargets
    if (targetsChanged) {
      observedTargetRevisionRef.current += 1
    }
    measureGeometryRef.current()
  }, [])
  useLayoutEffect(() => {
    reconcileTargetsRef.current = reconcileTargets
  }, [reconcileTargets])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelFrameLoop()
      controllerRef.current?.dispose()
      controllerRef.current = null
      geometryInvalidRef.current = true
      appliedGeometrySignatureRef.current = null
      appliedIdsKeyRef.current = null
      appliedReducedMotionRef.current = null
    }
  }, [cancelFrameLoop])

  useEffect(() => {
    for (const id of bodyElementsRef.current.keys()) {
      if (!idsRef.current.has(id)) {
        bodyElementsRef.current.delete(id)
      }
    }
  }, [idsKey])

  useEffect(() => {
    if (active && !reducedMotion) {
      scheduleFrame()
    } else {
      cancelFrameLoop()
    }
  }, [active, cancelFrameLoop, reducedMotion, scheduleFrame])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        cancelFrameLoop()
      } else {
        scheduleFrame()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [cancelFrameLoop, scheduleFrame])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    let observing = true
    const observer = new ResizeObserver(() => {
      if (!observing || !mountedRef.current) {
        return
      }
      reconcileTargetsRef.current()
    })
    observerRef.current = observer
    reconcileTargetsRef.current()
    return () => {
      observing = false
      observer.disconnect()
      if (observerRef.current === observer) {
        observerRef.current = null
        observedTargetsRef.current = new Set()
      }
    }
  }, [])

  useLayoutEffect(() => {
    reconcileTargetsRef.current()
  })

  const beginDrag = useCallback(
    (id: string): boolean => {
      const changed = controllerRef.current?.beginDrag(id) ?? false
      if (changed) {
        applyTransforms()
      }
      return changed
    },
    [applyTransforms],
  )

  const dragTo = useCallback(
    (id: string, point: { x: number; y: number }): boolean => {
      const changed = controllerRef.current?.dragTo(id, point) ?? false
      if (changed) {
        applyTransforms()
      }
      return changed
    },
    [applyTransforms],
  )

  const endDrag = useCallback(
    (id: string, releaseVelocity?: { x: number; y: number }): boolean => {
      const changed = controllerRef.current?.endDrag(id, releaseVelocity) ?? false
      if (changed) {
        applyTransforms()
        scheduleFrame()
      }
      return changed
    },
    [applyTransforms, scheduleFrame],
  )

  const cancelDrag = useCallback(
    (id: string): boolean => {
      const changed = controllerRef.current?.cancelDrag(id) ?? false
      if (changed) {
        applyTransforms()
      }
      return changed
    },
    [applyTransforms],
  )

  const getSnapshot = useCallback((): ResourceMotionSnapshot => {
    return controllerRef.current?.snapshot() ?? emptySnapshot()
  }, [])

  const registerBody = useCallback(
    (id: string, element: HTMLElement | null): void => {
      if (element === null) {
        bodyElementsRef.current.delete(id)
        return
      }
      bodyElementsRef.current.set(id, element)
      const body = controllerRef.current?.snapshot().bodies.get(id)
      if (body !== undefined) {
        element.style.transform = `translate3d(${body.x - body.radius}px, ${
          body.y - body.radius
        }px, 0)`
      }
    },
    [],
  )

  const focusNearest = useCallback(
    (
      fromId: string,
      direction: 'left' | 'right' | 'up' | 'down',
    ): string | null => {
      const nearestId = controllerRef.current?.nearest(fromId, direction) ?? null
      if (nearestId !== null) {
        bodyElementsRef.current.get(nearestId)?.focus()
      }
      return nearestId
    },
    [],
  )

  return {
    geometryRevision,
    beginDrag,
    dragTo,
    endDrag,
    cancelDrag,
    getSnapshot,
    registerBody,
    focusNearest,
  }
}
