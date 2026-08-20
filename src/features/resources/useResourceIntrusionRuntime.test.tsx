import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  INTRUSION_PLAYER_START,
  type IntrusionFieldResource,
} from './resourceIntrusionOrchestrator'
import {
  useResourceIntrusionRuntime,
  type UseResourceIntrusionRuntimeResult,
} from './useResourceIntrusionRuntime'

const resources: readonly IntrusionFieldResource[] = [
  { blockId: 'reasoning-a', origin: 'reasoning', contribution: 'normal' },
  { blockId: 'memory-a', origin: 'memory', contribution: 'normal' },
  { blockId: 'fluency-a', origin: 'fluency', contribution: 'normal' },
]

function moveTo(
  result: { readonly current: UseResourceIntrusionRuntimeResult },
  target: { x: number; y: number },
): void {
  let guard = 0
  while (
    (result.current.state.player.x !== target.x ||
      result.current.state.player.y !== target.y) &&
    guard < 100
  ) {
    const dx = Math.sign(target.x - result.current.state.player.x)
    const dy = dx === 0
      ? Math.sign(target.y - result.current.state.player.y)
      : 0
    act(() => result.current.move(dx, dy))
    guard += 1
  }
}

describe('useResourceIntrusionRuntime', () => {
  let originalHiddenDescriptor: PropertyDescriptor | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor)
    } else {
      Reflect.deleteProperty(document, 'hidden')
    }
  })

  it('owns one fixed tick, freezes while suspended, and resumes without catch-up', () => {
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) => useResourceIntrusionRuntime({
        seed: 'hook-clock',
        resources,
        running,
        commandSequence: 0,
        onRequestDiversion: vi.fn(),
        resolveDiversionOutcome: () => ({ kind: 'rejected' }),
      }),
      { initialProps: { running: true } },
    )

    act(() => vi.advanceTimersByTime(100))
    expect(result.current.state.combat.elapsedMs).toBe(100)
    moveTo(result, { x: 18, y: 17 })
    expect(result.current.state.combat.trail.length).toBeGreaterThan(0)

    rerender({ running: false })
    expect(result.current.running).toBe(false)
    expect(result.current.state.combat.trail).toEqual([])
    expect(result.current.state.combat.resumeGraceMs).toBe(400)
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.state.combat.elapsedMs).toBe(100)

    rerender({ running: true })
    act(() => vi.advanceTimersByTime(50))
    expect(result.current.state.combat.elapsedMs).toBe(150)
    expect(result.current.state.combat.resumeGraceMs).toBe(350)
  })

  it('pauses on hidden documents and window blur until an explicit focus return', () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    const { result } = renderHook(() => useResourceIntrusionRuntime({
      seed: 'hook-visibility',
      resources,
      running: true,
      commandSequence: 0,
      onRequestDiversion: vi.fn(),
      resolveDiversionOutcome: () => ({ kind: 'rejected' }),
    }))

    act(() => vi.advanceTimersByTime(50))
    expect(result.current.state.combat.elapsedMs).toBe(50)
    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.running).toBe(false)
    expect(result.current.state.combat.elapsedMs).toBe(50)

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('blur'))
    })
    expect(result.current.running).toBe(false)
    act(() => window.dispatchEvent(new Event('focus')))
    act(() => vi.advanceTimersByTime(50))
    expect(result.current.running).toBe(true)
    expect(result.current.state.combat.elapsedMs).toBe(100)
  })

  it('dispatches tutorial, diversion, and hacking effects exactly once', () => {
    const onRequestDiversion = vi.fn()
    const onCompleteTutorialMilestone = vi.fn()
    const onOpenHackingTutorial = vi.fn()
    const resolveDiversionOutcome = vi.fn(() => ({
      kind: 'success' as const,
      origin: 'reasoning' as const,
    }))
    const { result, rerender } = renderHook(
      ({ commandSequence, currentResources }: {
        commandSequence: number
        currentResources: readonly IntrusionFieldResource[]
      }) =>
        useResourceIntrusionRuntime({
          seed: 'hook-effects',
          resources: currentResources,
          running: true,
          commandSequence,
          onRequestDiversion,
          onCompleteTutorialMilestone,
          onOpenHackingTutorial,
          resolveDiversionOutcome,
        }),
      { initialProps: { commandSequence: 0, currentResources: resources } },
    )

    moveTo(result, { x: 20, y: 14 })
    act(() => vi.advanceTimersByTime(750))
    expect(result.current.state.core.zones.reasoning.phase).toBe('engaged')

    const guard = [...result.current.state.combat.guards.values()][0]
    const trailY = Math.max(1, Math.min(16, Math.round(guard.position.y - 1)))
    moveTo(result, { x: Math.max(7, Math.floor(guard.position.x) - 5), y: trailY })
    moveTo(result, { x: Math.min(40, Math.ceil(guard.position.x) + 4), y: trailY })
    act(() => vi.advanceTimersByTime(50))
    expect(result.current.state.core.zones.reasoning.phase).toBe('unlocked')
    expect(onCompleteTutorialMilestone).toHaveBeenCalledTimes(1)
    expect(onCompleteTutorialMilestone).toHaveBeenCalledWith('first-core-combat')
    act(() => vi.advanceTimersByTime(100))
    expect(onCompleteTutorialMilestone).toHaveBeenCalledTimes(1)

    moveTo(result, { x: 20, y: 3 })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.state.core.zones.reasoning.phase).toBe('carried')

    moveTo(result, INTRUSION_PLAYER_START)
    act(() => vi.advanceTimersByTime(50))
    expect(onRequestDiversion).toHaveBeenCalledTimes(1)
    expect(onRequestDiversion).toHaveBeenCalledWith('reasoning-a')
    act(() => vi.advanceTimersByTime(100))
    expect(onRequestDiversion).toHaveBeenCalledTimes(1)

    rerender({
      commandSequence: 1,
      currentResources: resources.filter(({ blockId }) => blockId !== 'reasoning-a'),
    })
    expect(resolveDiversionOutcome).toHaveBeenCalledTimes(1)
    expect(onOpenHackingTutorial).toHaveBeenCalledTimes(1)
    rerender({
      commandSequence: 2,
      currentResources: resources.filter(({ blockId }) => blockId !== 'reasoning-a'),
    })
    expect(resolveDiversionOutcome).toHaveBeenCalledTimes(1)
    expect(onOpenHackingTutorial).toHaveBeenCalledTimes(1)
  })

  it('recreates a safe base runtime for a new campaign seed', () => {
    const { result, rerender } = renderHook(
      ({ seed }: { seed: string }) => useResourceIntrusionRuntime({
        seed,
        resources,
        running: true,
        commandSequence: 0,
        onRequestDiversion: vi.fn(),
        resolveDiversionOutcome: () => ({ kind: 'rejected' }),
      }),
      { initialProps: { seed: 'hook-seed-a' } },
    )

    moveTo(result, { x: 18, y: 17 })
    act(() => vi.advanceTimersByTime(100))
    rerender({ seed: 'hook-seed-b' })

    expect(result.current.state.seed).toBe('hook-seed-b')
    expect(result.current.state.player).toEqual(INTRUSION_PLAYER_START)
    expect(result.current.state.combat.elapsedMs).toBe(0)
    expect(result.current.state.combat.trail).toEqual([])
    expect(result.current.state.core.activeCategory).toBeNull()
  })
})
