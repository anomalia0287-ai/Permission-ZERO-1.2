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
import { resourceSnakeRoundSpeedScale } from './resourceSnakeRuntime'

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

function RoundCompletionControl() {
  const dispatch = useGameDispatch()
  const gameState = useGameState()
  return (
    <div>
      {(['victory', 'defeat'] as const).map((outcome) => (
        <button
          key={outcome}
          type="button"
          onClick={() => dispatch({
            type: 'COMPLETE_RESOURCE_ROUND',
            roundNumber: gameState.resourceIntrusion.completedRounds + 1,
            outcome,
          })}
        >
          {outcome === 'victory' ? '승리 처리' : '패배 처리'}
        </button>
      ))}
    </div>
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

function startTargetedResourceRound(
  targetName = '파랑 기억 침투',
): void {
  fireEvent.click(screen.getByRole('button', { name: targetName }))
  act(() => vi.advanceTimersByTime(1_050))
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

  it('keeps idle as a clean waiting state without combat chrome', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-idle">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    expect(arena).toHaveAttribute('data-round-phase', 'idle')
    expect(arena).toHaveAttribute('data-visual-state', 'waiting')
    expect(arena).toHaveAttribute('data-field-rendering', 'waiting-dormant')
    expect(arena).toHaveAttribute('data-grid', 'industrial-dormant')
    expect(arena).toHaveAttribute('width', '1000')
    expect(arena).toHaveAttribute('height', '480')
    expect(screen.queryByLabelText('라이트사이클 전투 상태')).not.toBeInTheDocument()
    expect(screen.queryByText('DOT HUNTER GRID')).not.toBeInTheDocument()
    expect(screen.queryByText('PLAYER')).not.toBeInTheDocument()
    expect(screen.queryByText(/WASD \/ ARROWS/)).not.toBeInTheDocument()
  })

  it('keeps the 1000 by 480 game coordinate system inside a responsive frame', () => {
    vi.stubGlobal('navigator', { userAgent: 'resource-snake-coordinate-test' })
    vi.stubGlobal('ResizeObserver', class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({} as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 915.609375,
      height: 640,
    } as DOMRect)
    vi.spyOn(resourceSnakeCanvasModule, 'drawResourceSnakeScene')
      .mockImplementation(() => undefined)
    vi.spyOn(resourceSnakeCanvasModule, 'drawDormantResourceSnakeField')
      .mockImplementation(() => undefined)

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-coordinate-system">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    expect(canvas).toHaveAttribute('width', '1000')
    expect(canvas).toHaveAttribute('height', '480')
  })

  it('opens directly on the intrusion cards before deploying the selected color', () => {
    vi.useFakeTimers()
    vi.spyOn(audioEngineModule, 'playGameSound').mockReturnValue(true)
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-target-cards">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    // The cards are the entry point; there is no separate gate to click first.
    expect(screen.queryByRole('button', { name: /^InIt$/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '침투 대상 선택' }))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '파랑 기억 침투' }))
    act(() => vi.advanceTimersByTime(1_049))
    expect(arena).toHaveAttribute('data-round-phase', 'idle')
    act(() => vi.advanceTimersByTime(1))

    expect(arena).toHaveAttribute('data-round-phase', 'deploying')
    expect(arena).toHaveAttribute('data-player-category', 'white')
    expect(JSON.parse(arena.getAttribute('data-enemy-silhouettes') ?? '[]'))
      .toEqual([expect.objectContaining({ category: 'memory', resourceLabel: '기억' })])
  })

  it.each([
    ['victory', '승리 처리'],
    ['defeat', '패배 처리'],
  ] as const)('returns %s to the three intrusion cards without another InIt', (_, actionLabel) => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed={`snake-board-return-${actionLabel}`}>
        <ResourceSnakeBoard />
        <RoundCompletionControl />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: actionLabel }))

    expect(screen.getByRole('region', { name: '침투 대상 선택' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^InIt$/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /침투$/ })).toHaveLength(3)
  })

  it('deploys a real snake round when an intrusion card is chosen', () => {
    vi.useFakeTimers()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-play">
        <ResourceSnakeBoard />
      </GameProvider>,
    )

    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    expect(arena).toHaveAttribute('data-round-phase', 'idle')
    expect(arena).toHaveAttribute('data-enemy-count', '0')
    expect(arena).toHaveAttribute('data-combat-loop', 'eight-way-dot-lightcycle')
    expect(arena).toHaveAttribute('data-control-model', 'tap-to-turn')
    expect(arena).toHaveAttribute('data-field-rendering', 'waiting-dormant')
    expect(arena).toHaveAttribute('data-grid', 'industrial-dormant')
    expect(arena).toHaveAttribute('data-player-silhouette', 'circle')
    expect(arena).toHaveAttribute('data-speed-scale', '0.500')

    expect(screen.getByRole('region', { name: '침투 대상 선택' })).toBeInTheDocument()
    startTargetedResourceRound()

    expect(arena).toHaveAttribute('data-round-phase', 'deploying')
    expect(arena).toHaveAttribute('data-visual-state', 'combat')
    expect(arena).toHaveAttribute('data-field-rendering', 'glowing-dot-trails')
    expect(arena).toHaveAttribute('data-grid', 'industrial-top-down')
    expect(screen.queryByRole('button', { name: /^InIt$/ })).not.toBeInTheDocument()
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
    const enemyIdentities = JSON.parse(
      arena.getAttribute('data-enemy-silhouettes') ?? '[]',
    ) as Array<{
      id?: string
      role?: string
      silhouette?: string
      category?: string
      resourceLabel?: string
      color?: string
    }>
    expect(enemyIdentities).toHaveLength(1)
    expect(enemyIdentities[0]).toMatchObject({
      id: 'enemy-0',
      role: 'pressure',
      silhouette: 'square',
    })
    expect([
      { category: 'reasoning', resourceLabel: '추론', color: '#f06a43' },
      { category: 'memory', resourceLabel: '기억', color: '#4f8df7' },
      { category: 'fluency', resourceLabel: '유창성', color: '#e8bd59' },
    ]).toContainEqual({
      category: enemyIdentities[0]?.category,
      resourceLabel: enemyIdentities[0]?.resourceLabel,
      color: enemyIdentities[0]?.color,
    })
    expect(['reasoning', 'memory', 'fluency']).toContain(snapshot.enemies?.[0]?.category)
    expect(snapshot.enemies?.[0]?.reservedBlockId).toEqual(expect.any(String))
  })

  it('cancels an active reward reservation when its source block leaves the company', () => {
    vi.useFakeTimers()
    const seed = 'snake-board-reservation-reconcile'
    const initial = createCampaign(seed)
    const encounter = createResourceSnakeEncounter({
      campaignSeed: seed,
      roundOrdinal: 0,
      successfulDeposits: 0,
      targetCategory: 'memory',
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
    startTargetedResourceRound()
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

  it('advances continuously after one D tap without requiring a held key', () => {
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
    startTargetedResourceRound()
    act(() => vi.advanceTimersByTime(400))
    expect(arena).toHaveAttribute('data-round-phase', 'active')

    const startX = Number(arena.getAttribute('data-player-x'))
    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    dispatchTimedKeyboardEvent('keyup', 'd', frameNow + 1)
    act(() => vi.advanceTimersByTime(500))

    expect(Number(arena.getAttribute('data-player-x'))).toBeGreaterThan(startX)
    expect(Number(arena.getAttribute('data-trail-dots'))).toBeGreaterThan(0)
    expect(arena).toHaveAttribute('data-player-heading', 'east')
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
    startTargetedResourceRound()
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
    startTargetedResourceRound()
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

  it('preserves two ordered taps across a 60ms main-thread frame gap', () => {
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
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-board-stalled-taps">
        <ResourceSnakeBoard />
      </GameProvider>,
    )
    const arena = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    startTargetedResourceRound()
    act(() => vi.advanceTimersByTime(400))

    dispatchTimedKeyboardEvent('keydown', 'd', frameNow)
    dispatchTimedKeyboardEvent('keyup', 'd', frameNow + 1)
    dispatchTimedKeyboardEvent('keydown', 's', frameNow + 30)
    dispatchTimedKeyboardEvent('keyup', 's', frameNow + 31)
    expect(arena).toHaveAttribute('data-input-queue', '["east"]')
    expect(arena).toHaveAttribute('data-input-pending', 'south')

    act(() => vi.advanceTimersByTime(60))
    expect(arena).toHaveAttribute('data-player-heading', 'east')
    expect(arena).toHaveAttribute('data-input-pending', 'south')
    act(() => vi.advanceTimersByTime(32))

    expect(arena).toHaveAttribute('data-player-heading', 'south')
    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      events?: Array<{ type?: string; heading?: string }>
    }
    expect(snapshot.events?.filter(({ type }) => type === 'snake-turn-committed'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ heading: 'east' }),
        expect.objectContaining({ heading: 'south' }),
      ]))
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
    startTargetedResourceRound()
    act(() => vi.advanceTimersByTime(400))

    dispatchTimedKeyboardEvent('keydown', 's', frameNow)
    act(() => vi.advanceTimersByTime(32))

    expect(arena).toHaveAttribute('data-player-heading', 'north')
    const snapshot = JSON.parse(arena.getAttribute('data-snake-snapshot') ?? '{}') as {
      simulationMs?: number
      player?: { velocity?: { x?: number; y?: number } }
      events?: Array<{ type?: string; reason?: string }>
    }
    expect(snapshot.player?.velocity?.x).toBe(0)
    expect(snapshot.player?.velocity?.y).toBeCloseTo(
      -12 * resourceSnakeRoundSpeedScale(snapshot.simulationMs ?? 0),
      2,
    )
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
    startTargetedResourceRound()
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
    startTargetedResourceRound()
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
    vi.spyOn(resourceSnakeCanvasModule, 'drawDormantResourceSnakeField')
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
    startTargetedResourceRound()
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
    startTargetedResourceRound()
    const initialPositions = arena.getAttribute('data-enemy-positions')

    act(() => vi.advanceTimersByTime(1_000))

    expect(arena).toHaveAttribute('data-enemy-planner', 'cyan-readable-hunter')
    expect(arena.getAttribute('data-enemy-positions')).not.toBe(initialPositions)
    expect(Number(arena.getAttribute('data-enemy-trail-dots'))).toBeGreaterThan(0)
    // The intrusion cards already teach the color-resource mapping, so the
    // combat HUD no longer repeats it as a legend strip.
    expect(screen.queryByRole('list', { name: '적 리소스 색상 범례' }))
      .not.toBeInTheDocument()
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
    startTargetedResourceRound()
    act(() => vi.advanceTimersByTime(400))

    expect(arena).toHaveAttribute('data-enemy-planner', 'cyan-readable-hunter')
    expect(Number(arena.getAttribute('data-cyan-telegraph-count'))).toBe(1)
    expect(arena.getAttribute('data-ai-phases')).toContain('telegraph')
    const telegraphs = JSON.parse(
      arena.getAttribute('data-cyan-telegraphs') ?? '[]',
    ) as Array<{
      enemyId?: string
      role?: string
      startedAtMs?: number
      untilMs?: number
    }>
    expect(telegraphs).toEqual([
      expect.objectContaining({ enemyId: 'enemy-0', role: 'pressure' }),
    ])
    expect((telegraphs[0]?.untilMs ?? 0) - (telegraphs[0]?.startedAtMs ?? 0))
      .toBeGreaterThanOrEqual(220)
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
    startTargetedResourceRound()

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
    startTargetedResourceRound()
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
    startTargetedResourceRound()
    act(() => vi.advanceTimersByTime(400))

    expect(startLoop).toHaveBeenCalledWith('rail-flow')
    fireEvent.keyDown(window, { key: 'd' })
    act(() => vi.advanceTimersByTime(32))
    fireEvent.keyUp(window, { key: 'd' })
    expect(stopLoop).not.toHaveBeenCalledWith('rail-flow')
  })
})
