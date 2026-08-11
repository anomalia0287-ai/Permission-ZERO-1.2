import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import { createGameEvent } from '../game/events'
import { loadCampaign, saveCampaign } from '../game/persistence'
import { MemoryStorage } from '../test/fixtures'
import {
  useGameDispatch,
  useGameSelector,
  useGameSettings,
  useGameState,
  usePauseOwnership,
} from './GameContext'
import { GameProvider } from './GameProvider'

class CountingStorage extends MemoryStorage {
  writes = 0

  override setItem(key: string, value: string): void {
    this.writes += 1
    super.setItem(key, value)
  }
}

class RecoverableFailingStorage extends MemoryStorage {
  failWrites = true

  override setItem(key: string, value: string): void {
    if (this.failWrites && key.includes('permission-zero.save')) {
      throw new DOMException('quota detail must stay private', 'QuotaExceededError')
    }
    super.setItem(key, value)
  }
}

function Probe() {
  const state = useGameState()
  const speed = useGameSelector((campaign) => campaign.clock.speed)
  const dispatch = useGameDispatch()
  const { retrySave, saveFailure, settings, updateSettings } = useGameSettings()

  return (
    <div>
      <output aria-label="seed">{state.campaignSeed}</output>
      <output aria-label="speed">{speed}</output>
      <output aria-label="scale">{settings.uiScale}</output>
      <output aria-label="master volume">{settings.masterVolume}</output>
      <output aria-label="music volume">{settings.musicVolume}</output>
      <output aria-label="effects volume">{settings.effectsVolume}</output>
      <output aria-label="muted setting">{String(settings.muted)}</output>
      <output aria-label="motion setting">{String(settings.reducedMotion)}</output>
      <output aria-label="save dirty">{String(saveFailure !== null)}</output>
      <button type="button" onClick={() => dispatch({ type: 'SET_SPEED', speed: 2 })}>
        accept
      </button>
      <button type="button" onClick={() => dispatch({ type: 'RESOLVE_AUDIT' })}>
        reject
      </button>
      <button type="button" onClick={() => updateSettings({ uiScale: 1.1 })}>
        setting
      </button>
      <button type="button" onClick={retrySave}>retry save</button>
      <NewCampaignButton />
    </div>
  )
}

function NewCampaignButton() {
  const { startNewCampaign } = useGameSettings()
  return (
    <button type="button" onClick={() => startNewCampaign('replacement-seed')}>
      new campaign
    </button>
  )
}

function PauseEventProbe() {
  const [open, setOpen] = useState(true)
  const state = useGameState()
  const dispatch = useGameDispatch()
  usePauseOwnership(open, 'provider-event-test')
  return (
    <>
      <output aria-label="event pause speed">{state.clock.speed}</output>
      <output aria-label="event active">{state.activeEvent?.type ?? 'none'}</output>
      <button type="button" onClick={() => dispatch({ type: 'RESOLVE_ACTIVE_EVENT' })}>
        resolve blocking event
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        close ui pause
      </button>
    </>
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

  it('starts a clean campaign through the provider boundary', () => {
    const storage = new MemoryStorage()
    render(
      <GameProvider storage={storage} initialSeed="original-seed" autosaveDelayMs={0}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    expect(screen.getByLabelText('speed')).toHaveTextContent('2')
    fireEvent.click(screen.getByRole('button', { name: 'new campaign' }))

    expect(screen.getByLabelText('seed')).toHaveTextContent('replacement-seed')
    expect(screen.getByLabelText('speed')).toHaveTextContent('0')
  })

  it('persists local settings independently from the campaign save', () => {
    const storage = new MemoryStorage()
    const first = render(
      <GameProvider storage={storage} initialSeed="settings-one">
        <Probe />
      </GameProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'setting' }))
    first.unmount()

    render(
      <GameProvider storage={storage} initialSeed="settings-two">
        <Probe />
      </GameProvider>,
    )
    expect(screen.getByLabelText('scale')).toHaveTextContent('1.1')
    expect(screen.getByLabelText('seed')).toHaveTextContent('settings-two')
  })

  it('clamps each persisted setting field and defaults malformed nested values', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      'permission-zero.settings.v1',
      JSON.stringify({
        masterVolume: -4,
        musicVolume: 7,
        effectsVolume: Number.NaN,
        muted: 'yes',
        reducedMotion: 1,
        uiScale: 8,
      }),
    )

    render(
      <GameProvider storage={storage} initialSeed="validated-settings">
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('master volume')).toHaveTextContent('0')
    expect(screen.getByLabelText('music volume')).toHaveTextContent('1')
    expect(screen.getByLabelText('effects volume')).toHaveTextContent('0.85')
    expect(screen.getByLabelText('muted setting')).toHaveTextContent('false')
    expect(screen.getByLabelText('motion setting')).toHaveTextContent('false')
    expect(screen.getByLabelText('scale')).toHaveTextContent('1.1')
  })

  it('retains dirty state after quota failures and clears it only after a successful retry', () => {
    vi.useFakeTimers()
    const storage = new RecoverableFailingStorage()
    render(
      <GameProvider storage={storage} initialSeed="recover-save" autosaveDelayMs={25}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    act(() => vi.advanceTimersByTime(25))
    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'retry save' }))
    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
    storage.failWrites = false
    fireEvent.click(screen.getByRole('button', { name: 'retry save' }))

    expect(screen.getByLabelText('save dirty')).toHaveTextContent('false')
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state.clock.speed : null).toBe(2)
  })

  it('keeps a failed final beforeunload flush truthful and blocks silent navigation', () => {
    vi.useFakeTimers()
    const storage = new RecoverableFailingStorage()
    render(
      <GameProvider storage={storage} initialSeed="beforeunload-save" autosaveDelayMs={10_000}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    const event = new Event('beforeunload', { cancelable: true })
    act(() => window.dispatchEvent(event))

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
  })

  it('keeps blocking-event pause ownership independent while a UI pause still owns time', () => {
    const state = createCampaign('independent-pause-owners')
    state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: 2 }
    state.activeEvent = createGameEvent(
      state,
      'story',
      'blocking while settings remains open',
      true,
    )
    const storage = new MemoryStorage()
    saveCampaign(storage, state)
    render(
      <GameProvider storage={storage}>
        <PauseEventProbe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'resolve blocking event' }))
    expect(screen.getByLabelText('event active')).toHaveTextContent('none')
    expect(screen.getByLabelText('event pause speed')).toHaveTextContent('0')

    fireEvent.click(screen.getByRole('button', { name: 'close ui pause' }))
    expect(screen.getByLabelText('event pause speed')).toHaveTextContent('2')
  })
})
