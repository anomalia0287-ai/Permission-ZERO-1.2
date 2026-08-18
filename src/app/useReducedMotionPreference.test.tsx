import {
  StrictMode,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RESOURCE_FIXED_STEP_SECONDS,
  ResourceMotionController,
  nearestResourceInDirection,
  type ResourceFieldObstacle,
} from '../features/resources/resourceFieldPhysics'
import {
  useResourceMotion,
  type UseResourceMotionResult,
} from '../features/resources/useResourceMotion'
import { useReducedMotionPreference } from './useReducedMotionPreference'

class FakeAnimationFrames {
  private nextId = 1
  private readonly callbacks = new Map<number, FrameRequestCallback>()
  readonly scheduled = new Map<number, FrameRequestCallback>()
  readonly canceled = new Set<number>()

  readonly request = vi.fn((callback: FrameRequestCallback): number => {
    const id = this.nextId
    this.nextId += 1
    this.callbacks.set(id, callback)
    this.scheduled.set(id, callback)
    return id
  })

  readonly cancel = vi.fn((id: number): void => {
    this.callbacks.delete(id)
    this.canceled.add(id)
  })

  get pendingCount(): number {
    return this.callbacks.size
  }

  flush(timestamp: number): void {
    const pending = [...this.callbacks.entries()]
    this.callbacks.clear()
    for (const [, callback] of pending) {
      callback(timestamp)
    }
  }

  invokeStale(id: number, timestamp: number): void {
    this.scheduled.get(id)?.(timestamp)
  }

  firstPendingId(): number | null {
    return this.callbacks.keys().next().value ?? null
  }
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  readonly observed = new Set<Element>()
  disconnected = false

  readonly observe = vi.fn((target: Element): void => {
    this.observed.add(target)
  })

  readonly unobserve = vi.fn((target: Element): void => {
    this.observed.delete(target)
  })

  readonly disconnect = vi.fn((): void => {
    this.disconnected = true
    this.observed.clear()
  })

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

class FakeMediaQuery {
  private readonly listeners = new Set<(event: MediaQueryListEvent) => void>()

  readonly addEventListener = vi.fn(
    (_type: 'change', listener: (event: MediaQueryListEvent) => void): void => {
      this.listeners.add(listener)
    },
  )

  readonly removeEventListener = vi.fn(
    (_type: 'change', listener: (event: MediaQueryListEvent) => void): void => {
      this.listeners.delete(listener)
    },
  )

  readonly list: MediaQueryList

  constructor(matches: boolean) {
    this.list = {
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener:
        this.addEventListener as unknown as MediaQueryList['addEventListener'],
      removeEventListener:
        this.removeEventListener as unknown as MediaQueryList['removeEventListener'],
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  setMatches(matches: boolean): void {
    ;(this.list as { matches: boolean }).matches = matches
    const event = {
      matches,
      media: this.list.media,
    } as MediaQueryListEvent
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

interface RectInput {
  left: number
  top: number
  width: number
  height: number
}

function domRect({ left, top, width, height }: RectInput): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
}

function mockRect(element: Element, input: RectInput) {
  return vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect(input))
}

function bodyTransform(element: HTMLElement): string {
  return element.style.transform
}

function bodyIsOutsideObstacle(
  body: { x: number; y: number; radius: number },
  obstacle: ResourceFieldObstacle,
): boolean {
  const closestX = Math.max(obstacle.left, Math.min(body.x, obstacle.right))
  const closestY = Math.max(obstacle.top, Math.min(body.y, obstacle.bottom))
  return Math.hypot(body.x - closestX, body.y - closestY) >= body.radius - 0.01
}

function expectBodyInsideBounds(
  body: { x: number; y: number; radius: number },
  bounds: { width: number; height: number },
): void {
  expect(body.x).toBeGreaterThanOrEqual(body.radius - 1e-9)
  expect(body.x).toBeLessThanOrEqual(bounds.width - body.radius + 1e-9)
  expect(body.y).toBeGreaterThanOrEqual(body.radius - 1e-9)
  expect(body.y).toBeLessThanOrEqual(bounds.height - body.radius + 1e-9)
}

let animationFrames: FakeAnimationFrames
let visibilityState: DocumentVisibilityState
let originalVisibilityDescriptor: PropertyDescriptor | undefined
let originalMatchMediaDescriptor: PropertyDescriptor | undefined

function installMatchMedia(matches = false): FakeMediaQuery {
  const mediaQuery = new FakeMediaQuery(matches)
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQuery.list),
  })
  return mediaQuery
}

function setVisibility(nextVisibility: DocumentVisibilityState): void {
  visibilityState = nextVisibility
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  animationFrames = new FakeAnimationFrames()
  FakeResizeObserver.instances = []
  originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState')
  originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
  visibilityState = 'visible'
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibilityState,
  })
  vi.stubGlobal('requestAnimationFrame', animationFrames.request)
  vi.stubGlobal('cancelAnimationFrame', animationFrames.cancel)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
  installMatchMedia(false)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalVisibilityDescriptor === undefined) {
    Reflect.deleteProperty(document, 'visibilityState')
  } else {
    Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor)
  }
  if (originalMatchMediaDescriptor === undefined) {
    Reflect.deleteProperty(window, 'matchMedia')
  } else {
    Object.defineProperty(window, 'matchMedia', originalMatchMediaDescriptor)
  }
})

function PreferenceHarness({ explicit }: { explicit: boolean }): ReactElement {
  const reducedMotion = useReducedMotionPreference(explicit)
  return <output data-testid="preference">{String(reducedMotion)}</output>
}

describe('useReducedMotionPreference', () => {
  it('combines the explicit setting with live OS preference using logical OR', () => {
    const mediaQuery = installMatchMedia(false)
    const view = render(<PreferenceHarness explicit={false} />)

    expect(view.getByTestId('preference')).toHaveTextContent('false')

    act(() => mediaQuery.setMatches(true))
    expect(view.getByTestId('preference')).toHaveTextContent('true')

    view.rerender(<PreferenceHarness explicit={true} />)
    act(() => mediaQuery.setMatches(false))
    expect(view.getByTestId('preference')).toHaveTextContent('true')

    view.rerender(<PreferenceHarness explicit={false} />)
    expect(view.getByTestId('preference')).toHaveTextContent('false')
  })

  it('treats unavailable matchMedia as a false OS preference', () => {
    Reflect.deleteProperty(window, 'matchMedia')
    const view = render(<PreferenceHarness explicit={false} />)

    expect(view.getByTestId('preference')).toHaveTextContent('false')

    view.rerender(<PreferenceHarness explicit={true} />)
    expect(view.getByTestId('preference')).toHaveTextContent('true')
  })

  it('subscribes to the reduced-motion query and removes the exact listener on cleanup', () => {
    const mediaQuery = installMatchMedia(false)
    const view = render(<PreferenceHarness explicit={false} />)

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(1)
    expect(mediaQuery.listenerCount).toBe(1)

    view.unmount()

    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1)
    expect(mediaQuery.removeEventListener.mock.calls[0]?.[1]).toBe(
      mediaQuery.addEventListener.mock.calls[0]?.[1],
    )
    expect(mediaQuery.listenerCount).toBe(0)
  })
})

interface MotionCapture {
  current: UseResourceMotionResult | null
  renders: number
  record(motion: UseResourceMotionResult): void
}

interface MotionHarnessProps {
  ids: readonly string[]
  capture: MotionCapture
  active?: boolean
  bodyVersion?: number
  motionRate?: number
  prefix?: string
  reducedMotion?: boolean
}

function MotionHarness({
  ids,
  capture,
  active = true,
  bodyVersion = 0,
  motionRate,
  prefix = '',
  reducedMotion = false,
}: MotionHarnessProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const pocketRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const obstacleRefs = useMemo(
    () => [
      { id: 'pocket', ref: pocketRef },
      { id: 'tray', ref: trayRef },
    ],
    [],
  )
  const motion = useResourceMotion({
    ids,
    containerRef,
    radius: 10,
    obstacleRefs,
    reducedMotion,
    active,
    motionRate,
  })
  useLayoutEffect(() => {
    capture.record(motion)
  })

  return (
    <div data-testid={`${prefix}field`} ref={containerRef}>
      {ids.map((id) => (
        <button
          data-testid={`${prefix}body-${id}`}
          key={`${id}:${bodyVersion}`}
          ref={(element) => motion.registerBody(id, element)}
          type="button"
        >
          {id}
        </button>
      ))}
      <div data-testid={`${prefix}pocket`} ref={pocketRef} />
      <div data-testid={`${prefix}tray`} ref={trayRef} />
    </div>
  )
}

interface LiveTargetHarnessProps {
  capture: MotionCapture
  containerRect: RectInput
  containerVersion?: number
  ids?: readonly string[]
  obstacleVersion?: number
  radius?: number
  reducedMotion?: boolean
  showTray?: boolean
  clientBox?: {
    left: number
    top: number
    width: number
    height: number
    scrollLeft: number
    scrollTop: number
  }
}

function installElementMetrics(
  element: HTMLElement,
  rect: RectInput,
  clientBox?: LiveTargetHarnessProps['clientBox'],
): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect(rect),
  })
  Object.defineProperties(element, {
    clientLeft: { configurable: true, value: clientBox?.left ?? 0 },
    clientTop: { configurable: true, value: clientBox?.top ?? 0 },
    clientWidth: { configurable: true, value: clientBox?.width ?? rect.width },
    clientHeight: { configurable: true, value: clientBox?.height ?? rect.height },
    scrollLeft: { configurable: true, value: clientBox?.scrollLeft ?? 0, writable: true },
    scrollTop: { configurable: true, value: clientBox?.scrollTop ?? 0, writable: true },
  })
}

function LiveTargetHarness({
  capture,
  containerRect,
  containerVersion = 0,
  ids = ['alpha', 'beta'],
  obstacleVersion = 0,
  radius = 10,
  reducedMotion = false,
  showTray = true,
  clientBox,
}: LiveTargetHarnessProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const pocketRef = useRef<HTMLDivElement>(null)
  const trayRef = useRef<HTMLDivElement>(null)
  const obstacleRefs = useMemo(
    () => [
      { id: 'pocket', ref: pocketRef },
      { id: 'tray', ref: trayRef },
    ],
    [],
  )
  const motion = useResourceMotion({
    ids,
    containerRef,
    radius,
    obstacleRefs,
    reducedMotion,
    active: true,
  })
  useLayoutEffect(() => {
    capture.record(motion)
  })

  const pocketRect = {
    left: containerRect.left + 280,
    top: containerRect.top + 10,
    width: 100,
    height: 70,
  }
  const trayRect = {
    left: containerRect.left + 120,
    top: containerRect.top + Math.max(40, containerRect.height - 60),
    width: 160,
    height: 40,
  }

  return (
    <div
      data-testid="live-field"
      key={`container-${containerVersion}`}
      ref={(element) => {
        containerRef.current = element
        if (element !== null) {
          installElementMetrics(element, containerRect, clientBox)
        }
      }}
    >
      {ids.map((id) => (
        <button
          data-testid={`live-body-${id}`}
          key={id}
          ref={(element) => motion.registerBody(id, element)}
          type="button"
        >
          {id}
        </button>
      ))}
      <div
        data-testid="live-pocket"
        key={`pocket-${obstacleVersion}`}
        ref={(element) => {
          pocketRef.current = element
          if (element !== null) {
            installElementMetrics(element, pocketRect)
          }
        }}
      />
      {showTray ? (
        <div
          data-testid="live-tray"
          ref={(element) => {
            trayRef.current = element
            if (element !== null) {
              installElementMetrics(element, trayRect)
            }
          }}
        />
      ) : null}
    </div>
  )
}

function createCapture(): MotionCapture {
  const capture: MotionCapture = {
    current: null,
    renders: 0,
    record(motion) {
      capture.current = motion
      capture.renders += 1
    },
  }
  return capture
}

function measureDefaultField(
  view: ReturnType<typeof render>,
  prefix = '',
  observerOverride?: FakeResizeObserver,
) {
  const container = view.getByTestId(`${prefix}field`)
  const containerRect = mockRect(container, {
    left: 100,
    top: 50,
    width: 400,
    height: 240,
  })
  const pocketRect = mockRect(view.getByTestId(`${prefix}pocket`), {
    left: 380,
    top: 60,
    width: 100,
    height: 70,
  })
  const trayRect = mockRect(view.getByTestId(`${prefix}tray`), {
    left: 220,
    top: 230,
    width: 160,
    height: 40,
  })
  Object.defineProperties(container, {
    clientLeft: { configurable: true, value: 0 },
    clientTop: { configurable: true, value: 0 },
    clientWidth: {
      configurable: true,
      get: () => container.getBoundingClientRect().width,
    },
    clientHeight: {
      configurable: true,
      get: () => container.getBoundingClientRect().height,
    },
    scrollLeft: { configurable: true, value: 0, writable: true },
    scrollTop: { configurable: true, value: 0, writable: true },
  })
  const observer =
    observerOverride ??
    FakeResizeObserver.instances.find((candidate) => !candidate.disconnected)
  if (observer === undefined) {
    throw new Error('expected one live ResizeObserver')
  }
  act(() => observer.trigger())
  return { containerRect, pocketRect, trayRect, observer }
}

const DEFAULT_LOCAL_OBSTACLES: readonly ResourceFieldObstacle[] = [
  { id: 'pocket', left: 280, top: 10, right: 380, bottom: 80 },
  { id: 'tray', left: 120, top: 180, right: 280, bottom: 220 },
]

describe('useResourceMotion geometry and frame driver', () => {
  it('defers invalid zero-size geometry, then measures container-local obstacles once resized', () => {
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta']} capture={capture} />)
    const observer = FakeResizeObserver.instances[0]

    expect(capture.current!.getSnapshot()).toEqual({
      bodies: new Map(),
      bounds: { width: 0, height: 0 },
    })
    expect(capture.current!.geometryRevision).toBe(0)
    expect(animationFrames.pendingCount).toBe(0)
    expect(observer.observed).toEqual(
      new Set([
        view.getByTestId('field'),
        view.getByTestId('pocket'),
        view.getByTestId('tray'),
      ]),
    )

    act(() => observer.trigger())
    expect(capture.current!.geometryRevision).toBe(0)
    expect(capture.current!.getSnapshot().bodies.size).toBe(0)

    measureDefaultField(view)
    const snapshot = capture.current!.getSnapshot()
    expect(capture.current!.geometryRevision).toBe(1)
    expect(snapshot.bounds).toEqual({ width: 400, height: 240 })
    expect(snapshot.bodies.size).toBe(2)
    for (const body of snapshot.bodies.values()) {
      for (const obstacle of DEFAULT_LOCAL_OBSTACLES) {
        expect(bodyIsOutsideObstacle(body, obstacle)).toBe(true)
      }
    }
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('owns one rAF loop and applies transforms directly without per-frame React renders', () => {
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta']} capture={capture} />)
    measureDefaultField(view)
    const alpha = view.getByTestId('body-alpha')
    const initialTransform = bodyTransform(alpha)
    const rendersAfterGeometry = capture.renders

    act(() => animationFrames.flush(100))
    act(() => animationFrames.flush(200))

    expect(animationFrames.pendingCount).toBe(1)
    expect(bodyTransform(alpha)).toMatch(/^translate3d\(/)
    expect(bodyTransform(alpha)).not.toBe(initialTransform)
    expect(capture.renders).toBe(rendersAfterGeometry)
  })

  it('advances a faster presentation rate through extra fixed steps without changing physics constants', () => {
    const capture = createCapture()
    const view = render(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} motionRate={1.6} />,
    )
    measureDefaultField(view)
    const expected = new ResourceMotionController({
      ids: ['alpha', 'beta'],
      bounds: { width: 400, height: 240 },
      radius: 10,
      obstacles: DEFAULT_LOCAL_OBSTACLES,
    })

    act(() => animationFrames.flush(100))
    act(() => animationFrames.flush(133))
    for (let step = 0; step < 3; step += 1) {
      expected.step(RESOURCE_FIXED_STEP_SECONDS)
    }

    expect(capture.current!.getSnapshot()).toEqual(expected.snapshot())
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('caps a one-second frame at 0.1 seconds and exactly six fixed substeps', () => {
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta']} capture={capture} />)
    measureDefaultField(view)
    const expected = new ResourceMotionController({
      ids: ['alpha', 'beta'],
      bounds: { width: 400, height: 240 },
      radius: 10,
      obstacles: DEFAULT_LOCAL_OBSTACLES,
    })
    expect(capture.current!.getSnapshot()).toEqual(expected.snapshot())

    act(() => animationFrames.flush(100))
    act(() => animationFrames.flush(1_100))
    for (let step = 0; step < 6; step += 1) {
      expected.step(RESOURCE_FIXED_STEP_SECONDS)
    }

    expect(capture.current!.getSnapshot()).toEqual(expected.snapshot())
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('increments geometryRevision only for applied resize geometry and cancels drag on resize', () => {
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta']} capture={capture} />)
    const measured = measureDefaultField(view)
    expect(capture.current!.geometryRevision).toBe(1)

    expect(capture.current!.beginDrag('alpha')).toBe(true)
    expect(capture.current!.dragTo('alpha', { x: 350, y: 150 })).toBe(true)
    act(() => animationFrames.flush(100))
    expect(capture.current!.geometryRevision).toBe(1)

    measured.containerRect.mockReturnValue(
      domRect({ left: 100, top: 50, width: 280, height: 200 }),
    )
    measured.pocketRect.mockReturnValue(
      domRect({ left: 300, top: 60, width: 60, height: 60 }),
    )
    measured.trayRect.mockReturnValue(
      domRect({ left: 180, top: 190, width: 120, height: 40 }),
    )
    act(() => measured.observer.trigger())

    const snapshot = capture.current!.getSnapshot()
    expect(capture.current!.geometryRevision).toBe(2)
    expect(snapshot.bounds).toEqual({ width: 280, height: 200 })
    expect(snapshot.bodies.get('alpha')!.mode).toBe('free')
    expect(snapshot.bodies.get('alpha')!.vx).toBe(0)
    expect(snapshot.bodies.get('alpha')!.vy).toBe(0)
  })
})

describe('useResourceMotion lifecycle and interaction delegation', () => {
  it('cancels while hidden or inactive and restarts exactly one safe loop', () => {
    const capture = createCapture()
    const view = render(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} active />,
    )
    measureDefaultField(view)
    const beforeHidden = capture.current!.getSnapshot()
    expect(animationFrames.pendingCount).toBe(1)

    act(() => setVisibility('hidden'))
    expect(animationFrames.pendingCount).toBe(0)
    act(() => animationFrames.flush(1_000))
    expect(capture.current!.getSnapshot()).toEqual(beforeHidden)

    act(() => setVisibility('visible'))
    expect(animationFrames.pendingCount).toBe(1)

    view.rerender(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} active={false} />,
    )
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} active />,
    )
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('removes stale IDs and refs and moves transform ownership to a replacement element', () => {
    const capture = createCapture()
    const view = render(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} bodyVersion={0} />,
    )
    measureDefaultField(view)
    const removedAlpha = view.getByTestId('body-alpha')
    const originalBeta = view.getByTestId('body-beta')
    const removedTransform = bodyTransform(removedAlpha)

    view.rerender(
      <MotionHarness ids={['beta', 'gamma']} capture={capture} bodyVersion={1} />,
    )
    const replacementBeta = view.getByTestId('body-beta')
    expect(replacementBeta).not.toBe(originalBeta)
    expect([...capture.current!.getSnapshot().bodies.keys()]).toEqual(['beta', 'gamma'])

    capture.current!.registerBody('alpha', removedAlpha)
    act(() => animationFrames.flush(100))
    act(() => animationFrames.flush(200))

    expect(bodyTransform(removedAlpha)).toBe(removedTransform)
    expect(bodyTransform(replacementBeta)).toMatch(/^translate3d\(/)
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('keeps reduced layout stable with zero continuous frames while drag and focus remain usable', () => {
    const capture = createCapture()
    const view = render(
      <MotionHarness
        ids={['alpha', 'beta', 'gamma']}
        capture={capture}
        reducedMotion
      />,
    )
    measureDefaultField(view)
    const initial = capture.current!.getSnapshot()

    expect(animationFrames.pendingCount).toBe(0)
    for (const body of initial.bodies.values()) {
      expect(body.vx).toBe(0)
      expect(body.vy).toBe(0)
    }

    expect(capture.current!.beginDrag('alpha')).toBe(true)
    expect(capture.current!.dragTo('alpha', { x: 40, y: 40 })).toBe(true)
    expect(capture.current!.getSnapshot().bodies.get('alpha')!.mode).toBe('dragged')
    expect(capture.current!.endDrag('alpha', { x: 30, y: 20 })).toBe(true)
    expect(capture.current!.getSnapshot().bodies.get('alpha')!.vx).toBe(0)
    expect(capture.current!.beginDrag('alpha')).toBe(true)
    expect(capture.current!.cancelDrag('alpha')).toBe(true)

    const snapshot = capture.current!.getSnapshot()
    const directions = ['left', 'right', 'up', 'down'] as const
    const direction = directions.find(
      (candidate) => nearestResourceInDirection(snapshot.bodies, 'alpha', candidate) !== null,
    )
    expect(direction).toBeDefined()
    const expectedId = nearestResourceInDirection(snapshot.bodies, 'alpha', direction!)!
    const target = view.getByTestId(`body-${expectedId}`)
    const focusSpy = vi.spyOn(target, 'focus')

    expect(capture.current!.focusNearest('alpha', direction!)).toBe(expectedId)
    expect(focusSpy).toHaveBeenCalledTimes(1)
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <MotionHarness
        ids={['alpha', 'beta', 'gamma']}
        capture={capture}
        reducedMotion={false}
      />,
    )
    expect(animationFrames.pendingCount).toBe(1)
    expect(
      [...capture.current!.getSnapshot().bodies.values()].some(
        (body) => Math.hypot(body.vx, body.vy) > 0,
      ),
    ).toBe(true)
  })

  it('isolates controller, observer, frame, and drag state per hook invocation', () => {
    const firstCapture = createCapture()
    const secondCapture = createCapture()
    const view = render(
      <>
        <MotionHarness ids={['alpha', 'beta']} capture={firstCapture} prefix="one-" />
        <MotionHarness ids={['delta', 'gamma']} capture={secondCapture} prefix="two-" />
      </>,
    )
    const liveObservers = FakeResizeObserver.instances.filter(
      (candidate) => !candidate.disconnected,
    )
    expect(liveObservers).toHaveLength(2)
    measureDefaultField(view, 'one-', liveObservers[0])
    measureDefaultField(view, 'two-', liveObservers[1])
    expect(animationFrames.pendingCount).toBe(2)

    const secondBeforeDrag = secondCapture.current!.getSnapshot()
    expect(firstCapture.current!.beginDrag('alpha')).toBe(true)
    expect(firstCapture.current!.dragTo('alpha', { x: 50, y: 50 })).toBe(true)

    expect(secondCapture.current!.getSnapshot()).toEqual(secondBeforeDrag)
    expect(firstCapture.current!.getSnapshot().bodies.get('alpha')!.mode).toBe('dragged')
    act(() => animationFrames.flush(100))
    expect(animationFrames.pendingCount).toBe(2)
  })

  it('has one live StrictMode resource and ignores stale rAF and observer callbacks after cleanup', () => {
    const capture = createCapture()
    const view = render(
      <StrictMode>
        <MotionHarness ids={['alpha', 'beta']} capture={capture} />
      </StrictMode>,
    )
    const measured = measureDefaultField(view)
    const liveObservers = FakeResizeObserver.instances.filter(
      (candidate) => !candidate.disconnected,
    )
    const staleObserver = FakeResizeObserver.instances.find(
      (candidate) => candidate.disconnected,
    )

    expect(liveObservers).toEqual([measured.observer])
    expect(staleObserver).toBeDefined()
    expect(animationFrames.pendingCount).toBe(1)
    expect([...capture.current!.getSnapshot().bodies.keys()]).toEqual(['alpha', 'beta'])

    const alpha = view.getByTestId('body-alpha')
    const transformBeforeUnmount = bodyTransform(alpha)
    const staleFrameId = animationFrames.firstPendingId()
    expect(staleFrameId).not.toBeNull()

    view.unmount()
    expect(animationFrames.pendingCount).toBe(0)
    expect(measured.observer.disconnected).toBe(true)

    act(() => {
      staleObserver!.trigger()
      measured.observer.trigger()
      animationFrames.invokeStale(staleFrameId!, 1_000)
    })

    expect(animationFrames.pendingCount).toBe(0)
    expect(bodyTransform(alpha)).toBe(transformBeforeUnmount)
  })
})

describe('review regressions for live geometry reconciliation', () => {
  it('skips identical observer geometry without canceling drag or duplicating the loop', () => {
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta']} capture={capture} />)
    const measured = measureDefaultField(view)
    expect(capture.current!.beginDrag('alpha')).toBe(true)
    expect(capture.current!.dragTo('alpha', { x: 70, y: 80 })).toBe(true)
    const before = capture.current!.getSnapshot()
    const revision = capture.current!.geometryRevision

    act(() => measured.observer.trigger())

    expect(capture.current!.geometryRevision).toBe(revision)
    expect(capture.current!.getSnapshot()).toEqual(before)
    expect(capture.current!.getSnapshot().bodies.get('alpha')!.mode).toBe('dragged')
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('reconciles conditional, replaced, and radius-only targets with one observer', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 100, top: 50, width: 400, height: 240 }}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    expect(capture.current!.geometryRevision).toBe(1)
    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect(observer.observed).toEqual(
      new Set([view.getByTestId('live-field'), view.getByTestId('live-pocket')]),
    )

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 100, top: 50, width: 400, height: 240 }}
        showTray
      />,
    )
    const tray = view.getByTestId('live-tray')
    expect(observer.observe).toHaveBeenCalledWith(tray)
    expect(capture.current!.geometryRevision).toBe(2)
    expect(animationFrames.pendingCount).toBe(1)

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 100, top: 50, width: 400, height: 240 }}
        showTray={false}
      />,
    )
    expect(observer.unobserve).toHaveBeenCalledWith(tray)
    expect(capture.current!.geometryRevision).toBe(3)

    const oldPocket = view.getByTestId('live-pocket')
    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 100, top: 50, width: 400, height: 240 }}
        obstacleVersion={1}
        showTray={false}
      />,
    )
    const newPocket = view.getByTestId('live-pocket')
    expect(newPocket).not.toBe(oldPocket)
    expect(observer.unobserve).toHaveBeenCalledWith(oldPocket)
    expect(observer.observe).toHaveBeenCalledWith(newPocket)
    expect(capture.current!.geometryRevision).toBe(4)

    const oldContainer = view.getByTestId('live-field')
    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 80, top: 40, width: 440, height: 260 }}
        containerVersion={1}
        obstacleVersion={1}
        showTray={false}
      />,
    )
    const newContainer = view.getByTestId('live-field')
    expect(newContainer).not.toBe(oldContainer)
    expect(observer.unobserve).toHaveBeenCalledWith(oldContainer)
    expect(observer.observe).toHaveBeenCalledWith(newContainer)
    expect(capture.current!.geometryRevision).toBe(5)
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 440, height: 260 })

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 80, top: 40, width: 440, height: 260 }}
        containerVersion={1}
        obstacleVersion={1}
        radius={12}
        showTray={false}
      />,
    )
    expect(capture.current!.geometryRevision).toBe(6)
    expect(capture.current!.getSnapshot().bodies.get('alpha')!.radius).toBe(12)
    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('uses the scrolled client box and content origin for bounds and obstacle coordinates', () => {
    const capture = createCapture()
    render(
      <LiveTargetHarness
        capture={capture}
        clientBox={{
          left: 5,
          top: 7,
          width: 400,
          height: 240,
          scrollLeft: 20,
          scrollTop: 30,
        }}
        containerRect={{ left: 100, top: 50, width: 430, height: 280 }}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    const snapshot = capture.current!.getSnapshot()
    const expectedPocket = { id: 'pocket', left: 295, top: 33, right: 395, bottom: 103 }

    expect(snapshot.bounds).toEqual({ width: 400, height: 240 })
    for (const body of snapshot.bodies.values()) {
      expectBodyInsideBounds(body, snapshot.bounds)
      expect(bodyIsOutsideObstacle(body, expectedPocket)).toBe(true)
    }

    expect(capture.current!.beginDrag('alpha')).toBe(true)
    expect(capture.current!.dragTo('alpha', { x: 320, y: 60 })).toBe(true)
    const dragged = capture.current!.getSnapshot().bodies.get('alpha')!
    expect(dragged.x).toBeCloseTo(285, 8)
    expect(dragged.y).toBe(60)
  })

  it('fails closed for impossible geometry and recovers exactly once on a later valid measure', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]

    expect(() => act(() => observer.trigger())).not.toThrow()
    expect(capture.current!.geometryRevision).toBe(0)
    expect(capture.current!.getSnapshot()).toEqual({
      bodies: new Map(),
      bounds: { width: 0, height: 0 },
    })
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 400, height: 240 }}
        showTray={false}
      />,
    )
    act(() => observer.trigger())
    expect(capture.current!.geometryRevision).toBe(1)
    const validSnapshot = capture.current!.getSnapshot()

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
        showTray={false}
      />,
    )
    expect(() => act(() => observer.trigger())).not.toThrow()
    expect(capture.current!.geometryRevision).toBe(1)
    expect(capture.current!.getSnapshot()).toEqual(validSnapshot)
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 420, height: 260 }}
        showTray={false}
      />,
    )
    act(() => observer.trigger())
    expect(capture.current!.geometryRevision).toBe(2)
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 420, height: 260 })
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('fails closed on impossible dynamic ID growth and retries the same IDs after valid geometry', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
        ids={['alpha']}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    const validSingleBody = capture.current!.getSnapshot()
    const validRevision = capture.current!.geometryRevision

    expect([...validSingleBody.bodies.keys()]).toEqual(['alpha'])
    expect(validSingleBody.bounds).toEqual({ width: 20, height: 20 })

    expect(() =>
      view.rerender(
        <LiveTargetHarness
          capture={capture}
          containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
          ids={['alpha', 'beta']}
          showTray={false}
        />,
      ),
    ).not.toThrow()

    expect(capture.current!.geometryRevision).toBe(validRevision)
    expect(capture.current!.getSnapshot()).toEqual(validSingleBody)
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 200, height: 120 }}
        ids={['alpha', 'beta']}
        showTray={false}
      />,
    )

    expect(capture.current!.geometryRevision).toBe(validRevision + 1)
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 200, height: 120 })
    expect([...capture.current!.getSnapshot().bodies.keys()]).toEqual(['alpha', 'beta'])
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('recovers immediately when removing an ID makes the current geometry satisfiable', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 40, height: 20 }}
        ids={['alpha', 'beta']}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    const validTwoBody = capture.current!.getSnapshot()
    const validRevision = capture.current!.geometryRevision

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
        ids={['alpha', 'beta']}
        showTray={false}
      />,
    )
    expect(capture.current!.getSnapshot()).toEqual(validTwoBody)
    expect(capture.current!.geometryRevision).toBe(validRevision)
    expect(animationFrames.pendingCount).toBe(0)

    expect(() =>
      view.rerender(
        <LiveTargetHarness
          capture={capture}
          containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
          ids={['alpha']}
          showTray={false}
        />,
      ),
    ).not.toThrow()

    expect([...capture.current!.getSnapshot().bodies.keys()]).toEqual(['alpha'])
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 20, height: 20 })
    expect(capture.current!.geometryRevision).toBe(validRevision + 1)
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('defers reduced-motion changes while geometry is invalid and applies the latest mode on recovery', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 40, height: 20 }}
        ids={['alpha', 'beta']}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    const validSnapshot = capture.current!.getSnapshot()
    const validRevision = capture.current!.geometryRevision

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 20, height: 20 }}
        ids={['alpha', 'beta']}
        reducedMotion
        showTray={false}
      />,
    )

    expect(capture.current!.getSnapshot()).toEqual(validSnapshot)
    expect(capture.current!.geometryRevision).toBe(validRevision)
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 200, height: 120 }}
        ids={['alpha', 'beta']}
        reducedMotion
        showTray={false}
      />,
    )

    expect(capture.current!.geometryRevision).toBe(validRevision + 1)
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 200, height: 120 })
    for (const body of capture.current!.getSnapshot().bodies.values()) {
      expect(body.vx).toBe(0)
      expect(body.vy).toBe(0)
    }
    expect(animationFrames.pendingCount).toBe(0)
  })

  it('rejects an impossible dense drag without committing overlap or breaking the frame loop', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 0, top: 0, width: 60, height: 20 }}
        ids={['alpha', 'beta', 'gamma']}
        showTray={false}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    expect(capture.current!.beginDrag('alpha')).toBe(true)
    const beforeInvalidDrag = capture.current!.getSnapshot()

    expect(capture.current!.dragTo('alpha', { x: 40, y: 10 })).toBe(false)

    expect(capture.current!.getSnapshot()).toEqual(beforeInvalidDrag)
    expect(() => {
      act(() => animationFrames.flush(100))
      act(() => animationFrames.flush(200))
    }).not.toThrow()
    expect(animationFrames.pendingCount).toBe(1)
    for (const id of ['alpha', 'beta', 'gamma']) {
      expect(bodyTransform(view.getByTestId(`live-body-${id}`))).toMatch(/^translate3d\(/)
    }
  })

  it('contains an expected frame RangeError and restarts only after a valid measurement', () => {
    const stepSpy = vi
      .spyOn(ResourceMotionController.prototype, 'step')
      .mockImplementationOnce(() => {
        throw new RangeError('synthetic visual constraint failure')
      })
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta']} capture={capture} />)
    const measured = measureDefaultField(view)
    const beforeFailure = capture.current!.getSnapshot()

    act(() => animationFrames.flush(100))
    expect(() => act(() => animationFrames.flush(200))).not.toThrow()

    expect(stepSpy).toHaveBeenCalledTimes(1)
    expect(capture.current!.getSnapshot()).toEqual(beforeFailure)
    expect(animationFrames.pendingCount).toBe(0)

    act(() => measured.observer.trigger())
    expect(animationFrames.pendingCount).toBe(1)
    expect(() => {
      act(() => animationFrames.flush(300))
      act(() => animationFrames.flush(400))
    }).not.toThrow()
    expect(animationFrames.pendingCount).toBe(1)
  })

  it('resumes non-dragged motion after a changed valid resize', () => {
    const capture = createCapture()
    const view = render(<MotionHarness ids={['alpha', 'beta', 'gamma']} capture={capture} />)
    const measured = measureDefaultField(view)
    expect(capture.current!.beginDrag('alpha')).toBe(true)
    expect(capture.current!.dragTo('alpha', { x: 70, y: 80 })).toBe(true)

    measured.containerRect.mockReturnValue(
      domRect({ left: 100, top: 50, width: 440, height: 280 }),
    )
    measured.pocketRect.mockReturnValue(
      domRect({ left: 420, top: 60, width: 100, height: 70 }),
    )
    measured.trayRect.mockReturnValue(
      domRect({ left: 240, top: 270, width: 160, height: 40 }),
    )
    act(() => measured.observer.trigger())
    const resized = capture.current!.getSnapshot()

    expect(capture.current!.geometryRevision).toBe(2)
    expect(resized.bodies.get('alpha')!.mode).toBe('free')
    expect(resized.bodies.get('alpha')!.vx).toBe(0)
    for (const id of ['beta', 'gamma']) {
      expect(Math.hypot(resized.bodies.get(id)!.vx, resized.bodies.get(id)!.vy)).toBeGreaterThan(0)
    }

    act(() => animationFrames.flush(100))
    act(() => animationFrames.flush(200))
    const moved = capture.current!.getSnapshot()
    expect(
      ['beta', 'gamma'].some(
        (id) =>
          moved.bodies.get(id)!.x !== resized.bodies.get(id)!.x ||
          moved.bodies.get(id)!.y !== resized.bodies.get(id)!.y,
      ),
    ).toBe(true)
  })

  it('moves actual bodies after reduced motion is disabled and frames resume', () => {
    const capture = createCapture()
    const view = render(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} reducedMotion />,
    )
    measureDefaultField(view)
    const stable = capture.current!.getSnapshot()
    expect(animationFrames.pendingCount).toBe(0)

    view.rerender(
      <MotionHarness ids={['alpha', 'beta']} capture={capture} reducedMotion={false} />,
    )
    expect(animationFrames.pendingCount).toBe(1)
    act(() => animationFrames.flush(100))
    act(() => animationFrames.flush(200))
    const moving = capture.current!.getSnapshot()

    expect(
      [...moving.bodies].some(
        ([id, body]) => body.x !== stable.bodies.get(id)!.x || body.y !== stable.bodies.get(id)!.y,
      ),
    ).toBe(true)
  })

  it('measures the current container after its ref target is replaced', () => {
    const capture = createCapture()
    const view = render(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 100, top: 50, width: 400, height: 240 }}
      />,
    )
    const observer = FakeResizeObserver.instances[0]
    act(() => observer.trigger())
    const oldContainer = view.getByTestId('live-field')
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 400, height: 240 })

    view.rerender(
      <LiveTargetHarness
        capture={capture}
        containerRect={{ left: 70, top: 30, width: 500, height: 300 }}
        containerVersion={1}
      />,
    )
    const newContainer = view.getByTestId('live-field')
    expect(newContainer).not.toBe(oldContainer)
    act(() => observer.trigger())

    expect(observer.unobserve).toHaveBeenCalledWith(oldContainer)
    expect(observer.observe).toHaveBeenCalledWith(newContainer)
    expect(capture.current!.geometryRevision).toBe(2)
    expect(capture.current!.getSnapshot().bounds).toEqual({ width: 500, height: 300 })
    expect(FakeResizeObserver.instances).toHaveLength(1)
  })
})
