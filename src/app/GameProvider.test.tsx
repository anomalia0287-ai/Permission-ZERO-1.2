import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import { loadCampaign, saveCampaign } from '../game/persistence'
import { MemoryStorage } from '../test/fixtures'
import {
  useGameDispatch,
  useGameSelector,
  useGameSettings,
  useGameState,
} from './GameContext'
import { GameProvider } from './GameProvider'

class CountingStorage extends MemoryStorage {
  writes = 0

  override setItem(key: string, value: string): void {
    this.writes += 1
    super.setItem(key, value)
  }
}

function Probe() {
  const state = useGameState()
  const speed = useGameSelector((campaign) => campaign.clock.speed)
  const dispatch = useGameDispatch()
  const { settings, updateSettings } = useGameSettings()

  return (
    <div>
      <output aria-label="seed">{state.campaignSeed}</output>
      <output aria-label="speed">{speed}</output>
      <output aria-label="scale">{settings.uiScale}</output>
      <button type="button" onClick={() => dispatch({ type: 'SET_SPEED', speed: 2 })}>
        accept
      </button>
      <button type="button" onClick={() => dispatch({ type: 'RESOLVE_AUDIT' })}>
        reject
      </button>
      <button type="button" onClick={() => updateSettings({ uiScale: 1.1 })}>
        setting
      </button>
    </div>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('GameProvider', () => {
  it('loads an existing campaign instead of replacing it', () => {
    const storage = new CountingStorage()
    saveCampaign(storage, createCampaign('loaded-campaign'), '2026-08-12T00:00:00.000Z')
    storage.writes = 0

    render(
      <GameProvider storage={storage} initialSeed="new-campaign">
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('seed')).toHaveTextContent('loaded-campaign')
    expect(storage.writes).toBe(0)
  })

  it('autosaves after an accepted command and not after a rejected command', () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    render(
      <GameProvider storage={storage} initialSeed="autosave" autosaveDelayMs={100}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'reject' }))
    act(() => vi.advanceTimersByTime(150))
    expect(storage.writes).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    act(() => vi.advanceTimersByTime(99))
    expect(storage.writes).toBe(0)
    act(() => vi.advanceTimersByTime(1))
    expect(storage.writes).toBe(1)
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status === 'loaded') expect(loaded.state.clock.speed).toBe(2)
  })

  it('flushes the latest accepted state when unmounted before the throttle fires', () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    const view = render(
      <GameProvider storage={storage} initialSeed="flush" autosaveDelayMs={10_000}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    view.unmount()

    expect(storage.writes).toBe(1)
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state.clock.speed : null).toBe(2)
  })

  it('updates familiar local settings without mutating the campaign', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="settings">
        <Probe />
      </GameProvider>,
    )
    expect(screen.getByLabelText('scale')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'setting' }))
    expect(screen.getByLabelText('scale')).toHaveTextContent('1.1')
    expect(screen.getByLabelText('seed')).toHaveTextContent('settings')
  })
})
