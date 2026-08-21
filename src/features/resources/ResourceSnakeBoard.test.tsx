import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useGameDispatch,
  useGameState,
  useRuntimeSuspensionOwnership,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import * as audioEngineModule from '../../audio/audioEngine'
import { createCampaign } from '../../game/createCampaign'
import { MemoryStorage } from '../../test/fixtures'
import { ResourceSnakeBoard } from './ResourceSnakeBoard'
import * as resourceSnakeCanvasModule from './resourceSnakeCanvas'
import {
  createResourceSnakeEncounter,
  selectEligibleSnakeResourceCandidates,
} from './resourceSnakeEncounter'

function SuspensionControl() {
  const [suspended, setSuspended] = useState(false)
  useRuntimeSuspensionOwnership(suspended, 'resource-snake-test')
  return (
    <button type="button" onClick={() => setSuspended((current) => !current)}>
      {suspended ? '재개' : '정지'}
    </button>
  )
}

function CampaignProbe() {
  const gameState = useGameState()
  return (
    <output
      data-testid="campaign-probe"
      data-successful-deposits={gameState.resourceIntrusion.successfulCoreDeposits}
    />
  )
}

function ReservationInvalidator({ blockId }: { blockId: string }) {
  const dispatch = useGameDispatch()
  return (
    <button
      type="button"
      onClick={() => {
        dispatch({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
        dispatch({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
      }}
    >
      예약 원본 이동
    </button>
  )
}

function dispatchTimedKeyboardEvent(
  type: 'keydown' | 'keyup',
  key: string,
  timeStamp: number,
  target: Window | HTMLElement = window,
): void {
  const event = new KeyboardEvent(type, { key, bubbles: true })
  Object.defineProperty(event, 'timeStamp', { configurable: true, value: timeStamp })
  act(() => target.dispatchEvent(event))
}

describe('ResourceSnakeBoard', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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
    expect(canvas).toHaveClass('resource-snake-board__canvas')
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
    expect(arena).toHaveAttribute('data-combat-loop', 'eight-way-lightcycle')
    expect(arena).toHaveAttribute('data-field-rendering', 'continuous-cyan-rails')
    expect(arena).toHaveAttribute('data-grid', 'industrial-top-down')

    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))

    expect(arena).toHaveAttribute('data-round-phase', 'deploying')
    expect(screen.getByRole('button', { name: 'PLAY' })).toHaveAttribute(
      'data-deploying',
      'true',
    )
    expect(Number(arena.getAttribute('data-enemy-count'))).toBeGreaterThan(0)
    expect(arena).toHaveAttribute('data-player-integrity', '100')
    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      phase?: string
      simulationMs?: number
      player?: { x?: number; y?: number; integrity?: number; trailDots?: number }
      enemies?: Array<{
        id?: string
        category?: string
        integrity?: number
        role?: string
        reservedBlockId?: string
      }>
    }
    expect(snapshot).toMatchObject({
      phase: 'deploying',
      simulationMs: 0,
      player: { x: 25, y: 21, integrity: 100, trailDots: 0 },
    })
    expect(snapshot.enemies).toHaveLength(1)
    expect(snapshot.enemies?.[0]).toMatchObject({
      id: 'enemy-0',
      integrity: 30,
      role: 'pressure',
    })
    expect(['reasoning', 'memory', 'fluency']).toContain(snapshot.enemies?.[0]?.category)
    expect(snapshot.enemies?.[0]?.reservedBlockId).toEqual(expect.any(String))
  })

  it('cancels an active reward reservation when its source block leaves the company', () => {
    const seed = 'snake-board-reservation-reconcile'
    const initial = createCampaign(seed)
    const encounter = createResourceSnakeEncounter({
      campaignSeed: seed,
      roundOrdinal: 0,
      successfulDeposits: 0,
      candidates: selectEligibleSnakeResourceCandidates(initial.resources),
      bag: { cycle: 0, remainingCategories: [] },
    })
    const reservedBlockId = encounter.setup?.enemies[0]?.reservedBlockId
    if (!reservedBlockId) throw new Error('테스트 예약 리소스 누락')

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed={seed}>
        <ResourceSnakeBoard />
        <ReservationInvalidator blockId={reservedBlockId} />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    fireEvent.click(screen.getByRole('button', { name: '예약 원본 이동' }))

    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      enemies?: Array<{ reservationStatus?: string }>
      events?: Array<{ type?: string; outcome?: string }>
    }
    expect(snapshot.enemies?.[0]?.reservationStatus).toBe('cancelled')
    expect(snapshot.events).toContainEqual(expect.objectContaining({
      type: 'resource-reward-resolved',
      outcome: 'cancelled',
    }))
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
    act(() => vi.advanceTimersByTime(400))
    expect(arena).toHaveAttribute('data-round-phase', 'active')

    const startX = Number(arena.getAttribute('data-player-x'))
    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    act(() => vi.advanceTimersByTime(500))
    dispatchTimedKeyboardEvent('keyup', 'd', frameNow)

    expect(Number(arena.getAttribute('data-player-x'))).toBeGreaterThan(startX)
    expect(Number(arena.getAttribute('data-trail-dots'))).toBeGreaterThan(0)
  })

  it('uses the keydown timestamp and flushes one cardinal command only after 24ms', () => {
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
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-chord-flush">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(400))

    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    expect(arena).toHaveAttribute('data-input-pending', 'east')
    expect(arena).toHaveAttribute('data-player-heading', 'north')

    act(() => vi.advanceTimersByTime(16))
    expect(arena).toHaveAttribute('data-input-pending', 'east')
    expect(arena).toHaveAttribute('data-player-heading', 'north')

    act(() => vi.advanceTimersByTime(16))
    expect(arena).toHaveAttribute('data-input-pending', 'none')
    expect(arena).toHaveAttribute('data-player-heading', 'east')
    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      input?: { timestampMs?: number; queuedTurns?: string[] }
      events?: Array<{ type?: string; heading?: string }>
    }
    expect(snapshot.input?.timestampMs).toBe(frameNow)
    expect(snapshot.input?.queuedTurns).toEqual([])
    expect(snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'snake-turn-queued', heading: 'east' }),
      expect.objectContaining({ type: 'snake-turn-committed', heading: 'east' }),
    ]))
  })

  it('folds two perpendicular keydowns inside 24ms into one diagonal turn', () => {
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
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-diagonal-chord">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(400))

    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    dispatchTimedKeyboardEvent('keydown', 'w', frameNow + 12)
    expect(arena.getAttribute('data-input-queue')).toBe('["north-east"]')
    act(() => vi.advanceTimersByTime(32))

    expect(arena).toHaveAttribute('data-player-heading', 'north-east')
    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      player?: { velocity?: { x?: number; y?: number } }
    }
    expect(snapshot.player?.velocity?.x).toBeGreaterThan(0)
    expect(snapshot.player?.velocity?.y).toBeLessThan(0)
  })

  it('rejects an exact reverse without stalling and emits the combat-only reject cue', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))
    const playSound = vi.spyOn(audioEngineModule, 'playGameSound').mockReturnValue(true)

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-reverse-reject">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(400))

    dispatchTimedKeyboardEvent('keydown', 's', frameNow)
    act(() => vi.advanceTimersByTime(32))

    expect(arena).toHaveAttribute('data-player-heading', 'north')
    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      player?: { velocity?: { x?: number; y?: number } }
      events?: Array<{ type?: string; reason?: string }>
    }
    expect(snapshot.player?.velocity).toEqual({ x: 0, y: -12 })
    expect(snapshot.events).toContainEqual(expect.objectContaining({
      type: 'snake-turn-rejected',
      reason: 'reverse',
    }))
    expect(playSound).toHaveBeenCalledWith('snake-turn-rejected')
  })

  it('ignores editable targets and clears pending input on blur', () => {
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
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-focus-exclusion">
        <ResourceSnakeBoard />
        <input aria-label="편집 입력" />
      </GameProvider>,
    )
    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(400))

    dispatchTimedKeyboardEvent(
      'keydown',
      'd',
      frameNow,
      screen.getByRole('textbox', { name: '편집 입력' }),
    )
    expect(arena).toHaveAttribute('data-input-pending', 'none')

    dispatchTimedKeyboardEvent('keydown', 'd', frameNow + 2)
    expect(arena).toHaveAttribute('data-input-pending', 'east')
    act(() => window.dispatchEvent(new Event('blur')))
    expect(arena).toHaveAttribute('data-input-pending', 'none')
    expect(arena).toHaveAttribute('data-input-queue', '[]')
  })

  it('removes keyboard, blur, resize, and animation-frame ownership on unmount', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    const cancel = vi.fn((frameId: number) => window.clearTimeout(frameId))
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const remove = vi.spyOn(window, 'removeEventListener')

    const { unmount } = render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-cleanup">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(32))
    unmount()

    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('keyup', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('blur', expect.any(Function))
    expect(cancel).toHaveBeenCalled()
  })

  it('owns one canvas context and publishes a bounded render p95 every 30 draws', () => {
    vi.useFakeTimers()
    let frameNow = 0
    vi.stubGlobal('navigator', { userAgent: 'resource-snake-test' })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => {
        frameNow += 16
        callback(frameNow)
      }, 16)
    ))
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => window.clearTimeout(frameId))
    const disconnect = vi.fn()
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() { disconnect() }
    }
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    const context = {} as CanvasRenderingContext2D
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1_000,
      height: 480,
    } as DOMRect)
    const draw = vi.spyOn(resourceSnakeCanvasModule, 'drawResourceSnakeScene')
      .mockImplementation(() => undefined)
    let diagnosticClock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      diagnosticClock += 0.25
      return diagnosticClock
    })

    const { unmount } = render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-render-ring">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    for (let frame = 0; frame < 36; frame += 1) {
      act(() => vi.advanceTimersByTime(16))
    }

    expect(getContext).toHaveBeenCalledTimes(1)
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(30)
    expect(Number(arena.getAttribute('data-render-samples'))).toBeGreaterThanOrEqual(30)
    expect(Number(arena.getAttribute('data-render-samples'))).toBeLessThanOrEqual(120)
    expect(Number(arena.getAttribute('data-render-p95-ms'))).toBeGreaterThanOrEqual(0)
    expect(Number(arena.getAttribute('data-render-max-ms'))).toBeGreaterThanOrEqual(0)

    unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('moves live enemies through the coordinated group planner', () => {
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

    expect(arena).toHaveAttribute('data-enemy-planner', 'cyan-readable-hunter')
    expect(arena.getAttribute('data-enemy-positions')).not.toBe(initialPositions)
    expect(Number(arena.getAttribute('data-enemy-trail-dots'))).toBeGreaterThan(0)
    const phases = JSON.parse(arena.getAttribute('data-ai-phases') ?? '[]') as Array<{
      phase?: string
    }>
    expect(phases).toHaveLength(1)
    expect(['telegraph', 'commit', 'recover', 'cruise']).toContain(phases[0].phase)
  })

  it('exposes the cyan attack telegraph before the first committed turn', () => {
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
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-cyan-telegraph">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    act(() => vi.advanceTimersByTime(400))

    expect(arena).toHaveAttribute('data-enemy-planner', 'cyan-readable-hunter')
    expect(Number(arena.getAttribute('data-cyan-telegraph-count'))).toBe(1)
    expect(arena.getAttribute('data-ai-phases')).toContain('telegraph')
  })

  it('does not award a resource when an untouched enemy only has to survive its own opening route', () => {
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
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-idle-survival">
        <ResourceSnakeBoard />
        <CampaignProbe />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    const campaign = screen.getByTestId('campaign-probe')
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))

    act(() => vi.advanceTimersByTime(30_000))

    expect(['active', 'idle']).toContain(arena.getAttribute('data-round-phase'))
    expect(campaign).toHaveAttribute('data-successful-deposits', '0')
  }, 30_000)

  it('schedules a fresh decision at an emergency plan expiry before normal cadence', async () => {
    const { nextResourceSnakePlanningAtMs } = await import('./resourceSnakeScheduling')

    expect(nextResourceSnakePlanningAtMs(
      5_000,
      6,
      [{ commitUntilMs: 5_008.333_333_333_333 }],
    )).toBeCloseTo(5_008.333_333_333_333, 9)
    expect(nextResourceSnakePlanningAtMs(
      5_000,
      14,
      [{ commitUntilMs: 5_340 }, { commitUntilMs: 5_340 }],
    )).toBeCloseTo(5_071.428_571_428_572, 9)
    expect(nextResourceSnakePlanningAtMs(Number.NaN, 0, [])).toBe(0)
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
    act(() => vi.advanceTimersByTime(400))
    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    act(() => vi.advanceTimersByTime(160))
    const beforeSuspension = arena.getAttribute('data-player-x')

    fireEvent.click(screen.getByRole('button', { name: '정지' }))
    act(() => vi.advanceTimersByTime(500))
    expect(arena).toHaveAttribute('data-player-x', beforeSuspension)
    expect(arena).toHaveAttribute('data-input-pressed', '0')
    expect(arena).toHaveAttribute('data-input-pending', 'none')
    expect(arena).toHaveAttribute('data-input-queue', '[]')

    fireEvent.click(screen.getByRole('button', { name: '재개' }))
    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    act(() => vi.advanceTimersByTime(160))
    expect(Number(arena.getAttribute('data-player-x'))).toBeGreaterThan(
      Number(beforeSuspension),
    )
    dispatchTimedKeyboardEvent('keyup', 'd', frameNow)
  })

  it('runs the restrained movement hum while the always-moving round is active', () => {
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
    act(() => vi.advanceTimersByTime(400))

    expect(startLoop).toHaveBeenCalledWith('movement-hum')
    fireEvent.keyDown(window, { key: 'd' })
    act(() => vi.advanceTimersByTime(32))
    fireEvent.keyUp(window, { key: 'd' })
    expect(stopLoop).not.toHaveBeenCalledWith('movement-hum')
  })
})
