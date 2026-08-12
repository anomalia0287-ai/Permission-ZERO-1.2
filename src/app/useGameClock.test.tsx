import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameClock, type GameClockScheduler } from './useGameClock'

function manualScheduler() {
  let callback: FrameRequestCallback | null = null
  let hidden = false
  const visibilityListeners = new Set<() => void>()
  const scheduler: GameClockScheduler = {
    requestFrame(next) {
      callback = next
      return 1
    },
    cancelFrame() {
      callback = null
    },
    isHidden: () => hidden,
    onVisibilityChange(listener) {
      visibilityListeners.add(listener)
      return () => visibilityListeners.delete(listener)
    },
  }

  return {
    scheduler,
    frame(timestamp: number) {
      const next = callback
      callback = null
      next?.(timestamp)
    },
    setHidden(value: boolean) {
      hidden = value
      for (const listener of visibilityListeners) listener()
    },
    listenerCount: () => visibilityListeners.size,
    hasFrame: () => callback !== null,
  }
}

function ClockProbe({
  speed,
  scheduler,
  onDay,
  initialElapsedDayMs = 0,
  dayKey = 'campaign:331',
  onElapsedCheckpoint = () => undefined,
}: {
  speed: 0 | 1 | 2 | 4
  scheduler: GameClockScheduler
  onDay: () => void
  initialElapsedDayMs?: number
  dayKey?: string | number
  onElapsedCheckpoint?: (elapsedDayMs: number, flush: boolean) => void
}) {
  const progress = useGameClock({
    speed,
    scheduler,
    onDay,
    initialElapsedDayMs,
    dayKey,
    onElapsedCheckpoint,
  })
  return <output aria-label="progress">{progress.toFixed(3)}</output>
}

describe('useGameClock', () => {
  it('advances a logical day after 24 seconds at 1x and pauses at 0x', () => {
    const manual = manualScheduler()
    const onDay = vi.fn()
    const view = render(
      <ClockProbe speed={1} scheduler={manual.scheduler} onDay={onDay} />,
    )

    act(() => manual.frame(0))
    act(() => manual.frame(12_000))
    expect(screen.getByLabelText('progress')).toHaveTextContent('0.500')
    act(() => manual.frame(24_000))
    expect(onDay).toHaveBeenCalledTimes(1)

    view.rerender(
      <ClockProbe speed={0} scheduler={manual.scheduler} onDay={onDay} />,
    )
    act(() => manual.frame(60_000))
    expect(onDay).toHaveBeenCalledTimes(1)
  })

  it('does not count time spent in a hidden tab', () => {
    const manual = manualScheduler()
    const onDay = vi.fn()
    render(<ClockProbe speed={1} scheduler={manual.scheduler} onDay={onDay} />)

    act(() => manual.frame(0))
    act(() => manual.frame(5_000))
    act(() => manual.setHidden(true))
    act(() => manual.frame(500_000))
    act(() => manual.setHidden(false))
    act(() => manual.frame(501_000))
    expect(onDay).not.toHaveBeenCalled()
    act(() => manual.frame(520_000))
    expect(onDay).toHaveBeenCalledTimes(1)
  })

  it('resumes a persisted partial day and needs only the remaining fraction', () => {
    const manual = manualScheduler()
    const onDay = vi.fn()
    render(
      <ClockProbe
        speed={1}
        scheduler={manual.scheduler}
        onDay={onDay}
        initialElapsedDayMs={23_000}
      />,
    )

    expect(screen.getByLabelText('progress')).toHaveTextContent('0.958')
    act(() => manual.frame(0))
    act(() => manual.frame(999))
    expect(onDay).not.toHaveBeenCalled()
    act(() => manual.frame(1_000))
    expect(onDay).toHaveBeenCalledTimes(1)
  })

  it('resets to the persisted fraction when the campaign day changes', () => {
    const manual = manualScheduler()
    const onDay = vi.fn()
    const view = render(
      <ClockProbe speed={1} scheduler={manual.scheduler} onDay={onDay} />,
    )
    act(() => manual.frame(0))
    act(() => manual.frame(6_000))
    expect(screen.getByLabelText('progress')).toHaveTextContent('0.250')

    view.rerender(
      <ClockProbe
        speed={1}
        scheduler={manual.scheduler}
        onDay={onDay}
        initialElapsedDayMs={12_000}
        dayKey="campaign:332"
      />,
    )
    expect(screen.getByLabelText('progress')).toHaveTextContent('0.500')
    act(() => manual.frame(7_000))
    act(() => manual.frame(19_000))
    expect(onDay).toHaveBeenCalledTimes(1)
  })

  it('checkpoints at a bounded cadence and flushes immediately on page lifecycle events', () => {
    const manual = manualScheduler()
    const checkpoints = vi.fn()
    render(
      <ClockProbe
        speed={1}
        scheduler={manual.scheduler}
        onDay={() => undefined}
        onElapsedCheckpoint={checkpoints}
      />,
    )

    act(() => manual.frame(0))
    for (let timestamp = 100; timestamp < 2_000; timestamp += 100) {
      act(() => manual.frame(timestamp))
    }
    expect(checkpoints).not.toHaveBeenCalled()
    act(() => manual.frame(2_000))
    expect(checkpoints).toHaveBeenCalledTimes(1)
    expect(checkpoints).toHaveBeenLastCalledWith(2_000, false)

    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(checkpoints).toHaveBeenLastCalledWith(2_000, true)
    act(() => window.dispatchEvent(new Event('beforeunload')))
    expect(checkpoints).toHaveBeenLastCalledWith(2_000, true)
  })

  it('cancels animation and visibility subscriptions on unmount', () => {
    const manual = manualScheduler()
    const view = render(
      <ClockProbe speed={1} scheduler={manual.scheduler} onDay={() => undefined} />,
    )
    expect(manual.hasFrame()).toBe(true)
    expect(manual.listenerCount()).toBe(1)

    view.unmount()
    expect(manual.hasFrame()).toBe(false)
    expect(manual.listenerCount()).toBe(0)
  })
})
