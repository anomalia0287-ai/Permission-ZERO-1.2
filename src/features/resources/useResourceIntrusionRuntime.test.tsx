import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_PLAYER_START,
  INTRUSION_THEFT_HOLD_MS,
  type IntrusionFieldResource,
} from './resourceIntrusionRuntime'
import { useResourceIntrusionRuntime } from './useResourceIntrusionRuntime'

const reasoningResource: IntrusionFieldResource = {
  blockId: 'reasoning-a',
  origin: 'reasoning',
  contribution: 'normal',
}

const resources = [reasoningResource]

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

  it('owns one fixed interval and discards time while suspended', () => {
    const onRequestDiversion = vi.fn()
    const resolveDiversionOutcome = vi.fn(() => ({ kind: 'rejected' as const }))
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useResourceIntrusionRuntime({
          seed: 'hook-clock',
          resources,
          running,
          commandSequence: 0,
          onRequestDiversion,
          resolveDiversionOutcome,
        }),
      { initialProps: { running: true } },
    )

    act(() => vi.advanceTimersByTime(100))
    expect(result.current.state.totalElapsedMs).toBe(100)

    act(() => {
      result.current.move(5, 0)
      result.current.beginTheft()
    })
    expect(result.current.state.theft).not.toBeNull()

    rerender({ running: false })
    expect(result.current.state.theft).toBeNull()
    expect(result.current.state.announcement).toBe(
      '절도 입력이 취소되었습니다. 감시 불이익은 없습니다.',
    )
    act(() => vi.advanceTimersByTime(500))
    expect(result.current.state.totalElapsedMs).toBe(100)

    rerender({ running: true })
    act(() => vi.advanceTimersByTime(50))
    expect(result.current.state.totalElapsedMs).toBe(150)
    expect(onRequestDiversion).not.toHaveBeenCalled()
  })

  it('pauses while the document is hidden and resumes without backfilling elapsed time', () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    const { result } = renderHook(() =>
      useResourceIntrusionRuntime({
        seed: 'hook-visibility',
        resources,
        running: true,
        commandSequence: 0,
        onRequestDiversion: vi.fn(),
        resolveDiversionOutcome: () => ({ kind: 'rejected' }),
      }),
    )

    act(() => vi.advanceTimersByTime(50))
    expect(result.current.state.totalElapsedMs).toBe(50)

    act(() => {
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.running).toBe(false)
    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current.state.totalElapsedMs).toBe(50)

    act(() => {
      hidden = false
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => vi.advanceTimersByTime(50))
    expect(result.current.state.totalElapsedMs).toBe(100)
  })

  it('dispatches one diversion request and resolves it only after command sequence advances', () => {
    const onRequestDiversion = vi.fn()
    const resolveDiversionOutcome = vi.fn(() => ({
      kind: 'success' as const,
      origin: 'reasoning' as const,
    }))
    const { result, rerender } = renderHook(
      ({ commandSequence }: { commandSequence: number }) =>
        useResourceIntrusionRuntime({
          seed: 'hook-diversion',
          resources,
          running: true,
          commandSequence,
          onRequestDiversion,
          resolveDiversionOutcome,
        }),
      { initialProps: { commandSequence: 7 } },
    )

    act(() => result.current.move(5, 0))
    act(() => result.current.beginTheft())
    act(() => vi.advanceTimersByTime(INTRUSION_THEFT_HOLD_MS))
    expect(result.current.state.carriedBlockId).toBe(reasoningResource.blockId)

    act(() =>
      result.current.move(
        INTRUSION_DEPOSIT_BOX.x + 10 - result.current.state.player.x,
        INTRUSION_DEPOSIT_BOX.y - result.current.state.player.y,
      ),
    )
    expect(onRequestDiversion).toHaveBeenCalledTimes(1)
    expect(onRequestDiversion).toHaveBeenCalledWith(reasoningResource.blockId)
    expect(result.current.state.pendingDiversion).toEqual({
      blockId: reasoningResource.blockId,
      commandSequence: 7,
    })
    expect(resolveDiversionOutcome).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(100))
    expect(onRequestDiversion).toHaveBeenCalledTimes(1)

    rerender({ commandSequence: 8 })
    expect(resolveDiversionOutcome).toHaveBeenCalledTimes(1)
    expect(resolveDiversionOutcome).toHaveBeenCalledWith(reasoningResource.blockId)
    expect(result.current.state.pendingDiversion).toBeNull()
    expect(result.current.state.announcement).toBe(
      '추론 자원 확보 성공 · 저장 상한 없음',
    )
  })

  it('resets for a new campaign seed and cancels an active theft on window blur', () => {
    const { result, rerender } = renderHook(
      ({ seed }: { seed: string }) =>
        useResourceIntrusionRuntime({
          seed,
          resources,
          running: true,
          commandSequence: 0,
          onRequestDiversion: vi.fn(),
          resolveDiversionOutcome: () => ({ kind: 'rejected' }),
        }),
      { initialProps: { seed: 'hook-seed-a' } },
    )

    act(() => {
      result.current.move(5, 0)
      result.current.beginTheft()
    })
    act(() => window.dispatchEvent(new Event('blur')))
    expect(result.current.state.theft).toBeNull()
    expect(result.current.state.announcement).toBe(
      '절도를 취소했습니다. 감시 불이익은 없습니다.',
    )

    act(() => vi.advanceTimersByTime(500))
    rerender({ seed: 'hook-seed-b' })
    expect(result.current.state.seed).toBe('hook-seed-b')
    expect(result.current.state.totalElapsedMs).toBe(0)
    expect(result.current.state.player).toEqual(INTRUSION_PLAYER_START)
  })
})
