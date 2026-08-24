import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POPUP_STAGE_GAP_MS, usePopupStage } from './usePopupStage'

describe('usePopupStage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('seats the very first candidate without any delay', () => {
    const { result } = renderHook(({ key }) => usePopupStage(key), {
      initialProps: { key: 'communication:a' as string | null },
    })

    expect(result.current).toBe('communication:a')
  })

  it('keeps a quiet gap between two consecutive popups', () => {
    const { result, rerender } = renderHook(({ key }) => usePopupStage(key), {
      initialProps: { key: 'communication:a' as string | null },
    })

    rerender({ key: 'communication:b' })
    // The stage empties immediately, but the follower has to wait.
    expect(result.current).toBeNull()
    act(() => {
      vi.advanceTimersByTime(POPUP_STAGE_GAP_MS - 1)
    })
    expect(result.current).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('communication:b')
  })

  it('empties the stage as soon as the candidate withdraws', () => {
    const { result, rerender } = renderHook(({ key }) => usePopupStage(key), {
      initialProps: { key: 'supervisor' as string | null },
    })

    rerender({ key: null })
    expect(result.current).toBeNull()
  })

  it('does not seat a candidate that withdrew during the gap', () => {
    const { result, rerender } = renderHook(({ key }) => usePopupStage(key), {
      initialProps: { key: 'communication:a' as string | null },
    })

    rerender({ key: 'supervisor' })
    rerender({ key: null })
    act(() => {
      vi.advanceTimersByTime(POPUP_STAGE_GAP_MS)
    })
    expect(result.current).toBeNull()
  })

  it('waits out only the remaining gap after unrelated quiet time', () => {
    const { result, rerender } = renderHook(({ key }) => usePopupStage(key), {
      initialProps: { key: 'communication:a' as string | null },
    })

    rerender({ key: null })
    act(() => {
      vi.advanceTimersByTime(POPUP_STAGE_GAP_MS)
    })
    // The gap has already fully elapsed while the stage sat empty.
    rerender({ key: 'communication:b' })
    expect(result.current).toBe('communication:b')
  })
})
