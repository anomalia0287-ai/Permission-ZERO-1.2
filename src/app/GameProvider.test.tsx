import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import type { CampaignState } from '../game/model'
import { createGameEvent } from '../game/events'
import { appendJournal } from '../game/journal'
import {
  SAVE_STORAGE_KEY,
  encodeSave,
  loadCampaign,
  saveCampaign,
} from '../game/persistence'
import { MemoryStorage } from '../test/fixtures'
import { applyCommand } from '../game/reducer'
import { enqueueMemoryLeak } from '../game/story'
import {
  useGameDispatch,
  useGameSelector,
  useGameSettings,
  useGameState,
  useClockCheckpoint,
  usePauseOwnership,
} from './GameContext'
import { GameProvider } from './GameProvider'
import {
  SUPERVISOR_PRESENTATION_RESUME_KEY,
  writeSupervisorPresentationResume,
} from './supervisorPresentationResume'

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
  const {
    loadIssue,
    retrySave,
    saveFailure,
    settings,
    updateSettings,
  } = useGameSettings()

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
      <output aria-label="save warning">{saveFailure?.message ?? ''}</output>
      <output aria-label="load issue">{loadIssue?.reason ?? 'none'}</output>
      <output aria-label="supervisor presentation remaining">
        {state.story.supervisorPresentationRuntime?.remainingDwellMs ?? 'none'}
      </output>
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

function ClockCheckpointProbe() {
  const state = useGameState()
  const checkpoint = useClockCheckpoint()
  return (
    <>
      <output aria-label="elapsed day checkpoint">{state.clock.elapsedDayMs}</output>
      <output aria-label="checkpoint command count">{state.commandSequence}</output>
      <button type="button" onClick={() => checkpoint(23_000, true)}>
        checkpoint partial day
      </button>
    </>
  )
}

afterEach(() => {
  vi.useRealTimers()
  window.sessionStorage.clear()
})

function presentationState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMemoryLeak({
    ...initial,
    serviceDay: 338,
    market: {
      ...initial.market,
      history: [{
        serviceDay: 337,
        cadence: 'weekly',
        playerShare: 60,
        competitorShares: { meridian: 40, tallow: 0 },
        reasons: ['주간 갱신'],
      }],
    },
  })
}

async function flushSaveWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

async function advanceAndFlush(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

describe('GameProvider', () => {
  it('applies a matching tab resume marker and persists it before clearing the hint', async () => {
    const storage = new MemoryStorage()
    const persisted = presentationState('provider-presentation-resume')
    await saveCampaign(storage, persisted, '2026-08-12T00:00:00.000Z')
    writeSupervisorPresentationResume(persisted, 1_750, window.sessionStorage)

    render(
      <GameProvider storage={storage} initialSeed="unused-seed">
        <Probe />
      </GameProvider>,
    )
    await flushSaveWork()

    expect(
      screen.getByLabelText('supervisor presentation remaining'),
    ).toHaveTextContent('2250')
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(
      loaded.state.story.supervisorPresentationRuntime?.remainingDwellMs,
    ).toBe(2_250)
    expect(
      window.sessionStorage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY),
    ).toBeNull()
  })

  it('loads an existing campaign instead of replacing it', async () => {
    const storage = new CountingStorage()
    await saveCampaign(storage, createCampaign('loaded-campaign'), '2026-08-12T00:00:00.000Z')
    storage.writes = 0

    render(
      <GameProvider storage={storage} initialSeed="new-campaign">
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('seed')).toHaveTextContent('loaded-campaign')
    expect(storage.writes).toBe(0)
  })

  it('falls back with a recovery issue before rendering a corrupt resource graph', () => {
    const storage = new MemoryStorage()
    const parsed = JSON.parse(encodeSave(createCampaign('corrupt-graph'))) as {
      state: ReturnType<typeof createCampaign>
    }
    parsed.state.resources.reserve[0] = 'dangling-render-crash'
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(parsed))

    render(
      <GameProvider storage={storage} initialSeed="safe-render-fallback">
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('seed')).toHaveTextContent('safe-render-fallback')
    expect(screen.getByLabelText('load issue')).toHaveTextContent('CORRUPT_SAVE')
  })

  it('replaces an unchanged corrupt save after the player confirms a new campaign', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, '{broken')

    render(
      <GameProvider storage={storage} initialSeed="safe-render-fallback" autosaveDelayMs={25}>
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByLabelText('load issue')).toHaveTextContent('CORRUPT_SAVE')
    fireEvent.click(screen.getByRole('button', { name: 'new campaign' }))
    await advanceAndFlush(25)

    expect(screen.getByLabelText('save dirty')).toHaveTextContent('false')
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state.campaignSeed : null).toBe(
      'replacement-seed',
    )
  })

  it('autosaves after an accepted command and not after a rejected command', async () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    render(
      <GameProvider storage={storage} initialSeed="autosave" autosaveDelayMs={100}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'reject' }))
    await advanceAndFlush(150)
    expect(storage.writes).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    await advanceAndFlush(99)
    expect(storage.writes).toBe(0)
    await advanceAndFlush(1)
    expect(storage.writes).toBe(1)
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status === 'loaded') expect(loaded.state.clock.speed).toBe(2)
  })

  it('flushes the latest accepted state when unmounted before the throttle fires', async () => {
    vi.useFakeTimers()
    const storage = new CountingStorage()
    const view = render(
      <GameProvider storage={storage} initialSeed="flush" autosaveDelayMs={10_000}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    view.unmount()
    await flushSaveWork()

    expect(storage.writes).toBe(1)
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state.clock.speed : null).toBe(2)
  })

  it('persists a flushed partial-day checkpoint without adding a command', async () => {
    const storage = new CountingStorage()
    render(
      <GameProvider storage={storage} initialSeed="partial-day">
        <ClockCheckpointProbe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'checkpoint partial day' }))
    await flushSaveWork()
    expect(screen.getByLabelText('elapsed day checkpoint')).toHaveTextContent('23000')
    expect(screen.getByLabelText('checkpoint command count')).toHaveTextContent('0')
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status !== 'loaded') return
    expect(loaded.state.clock.elapsedDayMs).toBe(23_000)
    expect(loaded.state.commandSequence).toBe(0)
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

  it('retains dirty state after quota failures and clears it only after a successful retry', async () => {
    vi.useFakeTimers()
    const storage = new RecoverableFailingStorage()
    render(
      <GameProvider storage={storage} initialSeed="recover-save" autosaveDelayMs={25}>
        <Probe />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    await advanceAndFlush(25)
    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'retry save' }))
    await flushSaveWork()
    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
    storage.failWrites = false
    fireEvent.click(screen.getByRole('button', { name: 'retry save' }))
    await flushSaveWork()

    expect(screen.getByLabelText('save dirty')).toHaveTextContent('false')
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state.clock.speed : null).toBe(2)
  })

  it('keeps a stale tab dirty and shows Korean conflict recovery guidance', async () => {
    vi.useFakeTimers()
    const storage = new MemoryStorage()
    const base = createCampaign('stale-provider-tab')
    const initial = await saveCampaign(storage, base)
    if (!initial.ok) throw new Error(initial.message)

    render(
      <GameProvider storage={storage} autosaveDelayMs={25}>
        <Probe />
      </GameProvider>,
    )
    const external = applyCommand(base, { type: 'SET_SPEED', speed: 1 })
    if (!external.accepted) throw new Error(external.reason)
    const externalSave = await saveCampaign(
      storage,
      external.state,
      undefined,
      initial.revision,
    )
    if (!externalSave.ok) throw new Error(externalSave.message)

    fireEvent.click(screen.getByRole('button', { name: 'accept' }))
    await advanceAndFlush(25)

    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
    expect(screen.getByLabelText('save warning')).toHaveTextContent(
      '다른 탭에서 더 최신 진행을 저장했습니다',
    )
    const loaded = loadCampaign(storage)
    expect(loaded.status === 'loaded' ? loaded.state.clock.speed : null).toBe(1)
  })

  it('keeps progress dirty with export guidance when browser save locks are unavailable', async () => {
    vi.useFakeTimers()
    const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    })

    try {
      render(
        <GameProvider
          storage={new MemoryStorage()}
          initialSeed="unsupported-save-lock"
          autosaveDelayMs={25}
        >
          <Probe />
        </GameProvider>,
      )

      fireEvent.click(screen.getByRole('button', { name: 'accept' }))
      await act(async () => {
        vi.advanceTimersByTime(25)
        await Promise.resolve()
      })

      expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
      expect(screen.getByLabelText('save warning')).toHaveTextContent(
        '현재 진행 파일을 내려받은 뒤',
      )
    } finally {
      if (descriptor) Object.defineProperty(navigator, 'locks', descriptor)
    }
  })

  it('keeps a failed final beforeunload flush truthful and blocks silent navigation', async () => {
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
    await flushSaveWork()

    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
  })

  it('marks accepted mutations dirty when the localStorage getter is unavailable and reacquires it on retry', async () => {
    vi.useFakeTimers()
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    const storage = new MemoryStorage()
    let storageAvailable = false
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        if (!storageAvailable) {
          throw new DOMException('private getter path', 'SecurityError')
        }
        return storage
      },
    })

    try {
      const view = render(
        <GameProvider initialSeed="getter-recovery" autosaveDelayMs={25}>
          <Probe />
        </GameProvider>,
      )

      expect(screen.getByLabelText('save dirty')).toHaveTextContent('false')
      fireEvent.click(screen.getByRole('button', { name: 'accept' }))
      await advanceAndFlush(25)
      expect(screen.getByLabelText('save dirty')).toHaveTextContent('true')
      expect(screen.getByLabelText('save warning')).not.toBeEmptyDOMElement()
      expect(screen.getByLabelText('save warning')).not.toHaveTextContent(
        'private getter path',
      )

      const event = new Event('beforeunload', { cancelable: true })
      act(() => window.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(true)
      await flushSaveWork()

      storageAvailable = true
      fireEvent.click(screen.getByRole('button', { name: 'retry save' }))
      await flushSaveWork()
      expect(screen.getByLabelText('save dirty')).toHaveTextContent('false')
      const loaded = loadCampaign(storage)
      expect(loaded.status === 'loaded' ? loaded.state.clock.speed : null).toBe(2)
      view.unmount()
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    }
  })

  it('keeps blocking-event pause ownership independent while a UI pause still owns time', async () => {
    const state = createCampaign('independent-pause-owners')
    state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: 2 }
    state.activeEvent = createGameEvent(
      state,
      'story',
      'blocking while settings remains open',
      true,
    )
    state.eventLog = appendJournal(state.eventLog, state.activeEvent)
    const storage = new MemoryStorage()
    await saveCampaign(storage, state)
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
