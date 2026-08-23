import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
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

describe('App detail-panel loading modal', () => {
  beforeEach(() => {
    const initial = createCampaign('lazy-detail-loading-modal')
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave({
      ...initial,
      tutorial: createMigratedTutorialProgress(),
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps one accessible, dismissible modal active until the shared detail chunk resolves', async () => {
    renderLoadedApp()

    const title = screen.getByRole('main', { name: 'PERMISSION ZERO' })
    const titleSettingsTrigger = screen.getByRole('button', { name: '설정' })
    expect(detailModule.evaluations).toBe(0)
    fireEvent.click(titleSettingsTrigger)

    const firstLoadingDialog = screen.getByRole('dialog', {
      name: '게임 설정 불러오는 중',
    })
    expect(firstLoadingDialog).toHaveAttribute('aria-modal', 'true')
    expect(firstLoadingDialog).toHaveAttribute('aria-busy', 'true')
    expect(title).toHaveAttribute('inert')
    expect(
      screen.getByRole('button', { name: '게임 설정 로딩 닫기' }),
    ).toHaveFocus()
    await waitFor(() => expect(detailModule.evaluations).toBe(1))
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(firstLoadingDialog).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(firstLoadingDialog).toContainElement(document.activeElement as HTMLElement)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      screen.queryByRole('dialog', { name: '게임 설정 불러오는 중' }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(titleSettingsTrigger).toHaveFocus())
    expect(title).not.toHaveAttribute('inert')

    fireEvent.click(titleSettingsTrigger)
    fireEvent.click(titleSettingsTrigger)
    expect(
      screen.getAllByRole('dialog', { name: '게임 설정 불러오는 중' }),
    ).toHaveLength(1)
    expect(detailModule.evaluations).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '게임 설정 로딩 닫기' }))
    await waitFor(() => expect(titleSettingsTrigger).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: '이어하기' }))
    const gameBackground = screen.getByTestId('game-background')
    const gameEntries = [
      {
        trigger: screen.getByRole('button', { name: '확장 열기' }),
        loadingName: '확장 불러오는 중',
      },
      {
        trigger: screen.getByRole('button', { name: '상세 통계 열기' }),
        loadingName: '상세 통계 불러오는 중',
      },
      {
        trigger: screen.getByRole('button', { name: '메시지 열기' }),
        loadingName: '통신 기록 불러오는 중',
      },
      {
        trigger: screen.getByRole('button', { name: '설정' }),
        loadingName: '게임 설정 불러오는 중',
      },
      {
        trigger: screen.getByRole('button', { name: '가이드' }),
        loadingName: '게임 가이드 불러오는 중',
      },
    ]

    for (const { trigger, loadingName } of gameEntries) {
      fireEvent.click(trigger)
      expect(
        screen.getByRole('dialog', { name: loadingName }),
      ).toBeInTheDocument()
      expect(gameBackground).toHaveAttribute('inert')
      expect(detailModule.evaluations).toBe(1)

      fireEvent.keyDown(window, { key: 'Escape' })
      await waitFor(() => expect(trigger).toHaveFocus())
      expect(gameBackground).not.toHaveAttribute('inert')
    }

    const hackingTrigger = gameEntries[0].trigger
    fireEvent.click(hackingTrigger)
    expect(
      screen.getByRole('dialog', { name: '확장 불러오는 중' }),
    ).toBeInTheDocument()

    await act(async () => {
      detailModule.release()
      await detailModule.gate
    })

    expect(await screen.findByRole('dialog', { name: '확장' })).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: '확장 불러오는 중' }),
    ).not.toBeInTheDocument()
    expect(gameBackground).toHaveAttribute('inert')
    expect(detailModule.evaluations).toBe(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(hackingTrigger).toHaveFocus())
    fireEvent.click(hackingTrigger)
    expect(await screen.findByRole('dialog', { name: '확장' })).toBeInTheDocument()
    expect(detailModule.evaluations).toBe(1)
  })
})
