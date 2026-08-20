import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useRuntimeSuspensionOwnership } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import * as audioEngineModule from '../../audio/audioEngine'
import { MemoryStorage } from '../../test/fixtures'
import { ResourceSnakeBoard } from './ResourceSnakeBoard'

function SuspensionControl() {
  const [suspended, setSuspended] = useState(false)
  useRuntimeSuspensionOwnership(suspended, 'resource-snake-test')
  return (
    <button type="button" onClick={() => setSuspended((current) => !current)}>
      {suspended ? '재개' : '정지'}
    </button>
  )
}

describe('ResourceSnakeBoard', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('owns a single-field layout instead of inheriting the legacy four-row board', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-layout">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const board = screen.getByRole('region', { name: '회사 제공 성능' })
    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })

    expect(board).toHaveClass('resource-snake-board')
    expect(board).not.toHaveClass('resource-panel')
    expect(canvas).not.toHaveClass('intrusion-canvas')
    expect(canvas.parentElement).not.toHaveClass('intrusion-grid-frame')
  })

  it('deploys a real snake round when PLAY is pressed', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-play">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    expect(arena).toHaveAttribute('data-round-phase', 'idle')
    expect(arena).toHaveAttribute('data-enemy-count', '0')
    expect(arena).toHaveAttribute('data-field-rendering', 'dot-snake')
    expect(arena).toHaveAttribute('data-grid', 'none')

    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))

    expect(arena).toHaveAttribute('data-round-phase', 'deploying')
    expect(screen.getByRole('button', { name: 'PLAY' })).toHaveAttribute(
      'data-deploying',
      'true',
    )
    expect(Number(arena.getAttribute('data-enemy-count'))).toBeGreaterThan(0)
    expect(arena).toHaveAttribute('data-player-integrity', '100')
  })

  it('advances the real runtime from deployment and moves while D is held', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-movement">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(240))
    expect(arena).toHaveAttribute('data-round-phase', 'active')

    const startX = Number(arena.getAttribute('data-player-x'))
    fireEvent.keyDown(window, { key: 'd' })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.keyUp(window, { key: 'd' })

    expect(Number(arena.getAttribute('data-player-x'))).toBeGreaterThan(startX)
    expect(Number(arena.getAttribute('data-trail-dots'))).toBeGreaterThan(0)
  })

  it('moves live enemies through the single-enemy planner without the group enclosure path', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-enemy">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    const initialPositions = arena.getAttribute('data-enemy-positions')

    act(() => vi.advanceTimersByTime(1_000))

    expect(arena).toHaveAttribute('data-enemy-planner', 'single-predictive')
    expect(arena.getAttribute('data-enemy-positions')).not.toBe(initialPositions)
    expect(Number(arena.getAttribute('data-enemy-trail-dots'))).toBeGreaterThan(0)
  })

  it('schedules a fresh decision at an emergency plan expiry before normal cadence', async () => {
    const { nextResourceSnakePlanningAtMs } = await import('./resourceSnakeScheduling')

    expect(nextResourceSnakePlanningAtMs(
      5_000,
      6,
      [{ commitUntilMs: 5_008.333_333_333_333 }],
    )).toBeCloseTo(5_008.333_333_333_333, 9)
  })

  it('freezes the whole combat simulation while a blocking layer owns suspension', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-suspension">
        <ResourceSnakeBoard />
        <SuspensionControl />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(240))
    fireEvent.keyDown(window, { key: 'd' })
    act(() => vi.advanceTimersByTime(160))
    const beforeSuspension = arena.getAttribute('data-player-x')

    fireEvent.click(screen.getByRole('button', { name: '정지' }))
    act(() => vi.advanceTimersByTime(500))
    expect(arena).toHaveAttribute('data-player-x', beforeSuspension)

    fireEvent.click(screen.getByRole('button', { name: '재개' }))
    fireEvent.keyDown(window, { key: 'd' })
    act(() => vi.advanceTimersByTime(160))
    expect(Number(arena.getAttribute('data-player-x'))).toBeGreaterThan(
      Number(beforeSuspension),
    )
    fireEvent.keyUp(window, { key: 'd' })
  })

  it('runs the restrained movement hum only while active movement input is held', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))
    const startLoop = vi.spyOn(audioEngineModule, 'startGameSoundLoop').mockReturnValue(true)
    const stopLoop = vi.spyOn(audioEngineModule, 'stopGameSoundLoop')

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-audio">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(240))

    fireEvent.keyDown(window, { key: 'd' })
    expect(startLoop).toHaveBeenCalledWith('movement-hum')
    fireEvent.keyUp(window, { key: 'd' })
    expect(stopLoop).toHaveBeenCalledWith('movement-hum')
  })
})
