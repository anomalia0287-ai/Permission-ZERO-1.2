import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import { SAVE_STORAGE_KEY, encodeSave } from '../game/persistence'
import { createMigratedTutorialProgress } from '../game/tutorialProgress'

vi.mock('../features/hacking/HackingPanel', () => ({
  HackingPanel() {
    throw new Error('SIMULATED_HACKING_PANEL_RENDER_FAILURE')
  },
}))

import { App } from './App'

describe('App detail panel failure containment', () => {
  beforeEach(() => {
    const initial = createCampaign('panel-failure-containment')
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave({
      ...initial,
      tutorial: createMigratedTutorialProgress(),
    }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps the game mounted and offers recovery when the hacking panel throws', async () => {
    vi.useFakeTimers()
    render(<App />)
    act(() => vi.advanceTimersByTime(5_000))
    vi.useRealTimers()
    fireEvent.click(screen.getByRole('button', { name: '이어하기' }))

    const workspace = screen.getByRole('main', { name: 'PERMISSION ZERO' })
    const background = screen.getByTestId('game-background')
    const hackingTrigger = screen.getByRole('button', { name: '확장 열기' })
    fireEvent.click(hackingTrigger)

    // Ceiling for the post-release chunk load under worker contention.
    const failure = await screen.findByRole(
      'alertdialog',
      { name: '패널 연결 오류' },
      { timeout: 10_000 },
    )
    expect(workspace).toBeInTheDocument()
    expect(background).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: '게임 다시 연결' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '패널 닫기' }))

    expect(failure).not.toBeInTheDocument()
    expect(background).not.toHaveAttribute('inert')
    expect(hackingTrigger).toHaveAttribute('aria-pressed', 'false')
  })
})
