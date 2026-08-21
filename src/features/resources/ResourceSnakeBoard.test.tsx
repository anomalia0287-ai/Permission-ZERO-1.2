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
    fireEvent.keyDown(window, { key: 'd' })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.keyUp(window, { key: 'd' })

    expect(Number(arena.getAttribute('data-player-x'))).toBeGreaterThan(startX)
    expect(Number(arena.getAttribute('data-trail-dots'))).toBeGreaterThan(0)
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
