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
}: {
  speed: 0 | 1 | 2 | 4
  scheduler: GameClockScheduler
  onDay: () => void
}) {
  const progress = useGameClock({ speed, scheduler, onDay })
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
