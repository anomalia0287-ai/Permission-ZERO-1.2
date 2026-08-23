import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  readResourceSnakeVitals,
  useResourceSnakeVitals,
} from './useResourceSnakeVitals'

describe('resource snake vitals bridge', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('aggregates every enemy into one round health value', () => {
    expect(readResourceSnakeVitals(JSON.stringify({
      player: { integrity: 82, maximumIntegrity: 100 },
      enemies: [
        { integrity: 20, maximumIntegrity: 30 },
        { integrity: 0, maximumIntegrity: 50 },
      ],
    }))).toEqual({
      playerCurrent: 82,
      playerMaximum: 100,
      enemyCurrent: 20,
      enemyMaximum: 80,
    })
  })

  it('falls back to idle values for a missing or malformed snapshot', () => {
    expect(readResourceSnakeVitals(null)).toEqual({
      playerCurrent: 100,
      playerMaximum: 100,
      enemyCurrent: 0,
      enemyMaximum: 100,
    })
    expect(readResourceSnakeVitals('{broken')).toEqual({
      playerCurrent: 100,
      playerMaximum: 100,
      enemyCurrent: 0,
      enemyMaximum: 100,
    })
  })

  it('publishes changed canvas vitals on the bounded polling cadence', () => {
    vi.useFakeTimers()
    const canvas = document.createElement('canvas')
    canvas.dataset.snakeSnapshot = JSON.stringify({
      player: { integrity: 100, maximumIntegrity: 100 },
      enemies: [],
    })
    document.body.append(canvas)

    const { result } = renderHook(() => useResourceSnakeVitals())
    expect(result.current.enemyCurrent).toBe(0)

    canvas.dataset.snakeSnapshot = JSON.stringify({
      player: { integrity: 91, maximumIntegrity: 100 },
      enemies: [{ integrity: 35, maximumIntegrity: 50 }],
    })
    act(() => vi.advanceTimersByTime(160))

    expect(result.current).toEqual({
      playerCurrent: 91,
      playerMaximum: 100,
      enemyCurrent: 35,
      enemyMaximum: 50,
    })
  })
})
