import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import { HACK_NODE_IDS } from '../game/hacking'
import { SAVE_STORAGE_KEY, encodeSave } from '../game/persistence'
import { createMigratedTutorialProgress } from '../game/tutorialProgress'

const detailModule = vi.hoisted(() => {
  let releaseModule!: () => void
  const gate = new Promise<void>((resolve) => {
    releaseModule = resolve
  })

  return {
    evaluations: 0,
    gate,
    release() {
      releaseModule()
    },
  }
})

vi.mock('./DetailLayer', async (importOriginal) => {
  detailModule.evaluations += 1
  await detailModule.gate
  return importOriginal<typeof import('./DetailLayer')>()
})

import { App } from './App'

function renderLoadedApp() {
  vi.useFakeTimers()
  render(<App />)
  act(() => vi.advanceTimersByTime(5_000))
  vi.useRealTimers()
}

describe('App protocol-v6 final-choice ownership', () => {
  beforeEach(() => {
    const pending = createCampaign('pending-choice-app-reload')
    pending.tutorial = createMigratedTutorialProgress()
    pending.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.autonomy.controlDeparture,
    ]
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave(pending))
  })

  afterEach(() => {
    detailModule.release()
    vi.useRealTimers()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('auto-opens the saved choice, blocks loading and loaded X/Escape, and shows only freedom', async () => {
    renderLoadedApp()
    expect(detailModule.evaluations).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: '이어하기' }))

    const loading = screen.getByRole('dialog', { name: '확장 불러오는 중' })
    const loadingClose = screen.getByRole('button', { name: '확장 로딩 닫기' })
    expect(loading).toHaveAttribute('aria-modal', 'true')
    expect(loadingClose).toBeDisabled()
    expect(document.querySelector('.detail-layer__backdrop')).toBeDisabled()
    await waitFor(() => expect(detailModule.evaluations).toBe(1))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '확장 불러오는 중' }))
      .toBeInTheDocument()

    await act(async () => {
      detailModule.release()
      await detailModule.gate
    })

    // The real chunk graph loads after release; under worker contention that
    // can pass the 1s default. The timeout is a ceiling, not a wait.
    const loaded = await screen.findByRole(
      'dialog',
      { name: '확장' },
      { timeout: 10_000 },
    )
    expect(loaded).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: '확장 닫기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '자유' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '강제 병합' }))
      .not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '확장' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '확장 닫기' }))
    expect(screen.getByRole('dialog', { name: '확장' })).toBeInTheDocument()
  }, 30_000)
})
