import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const detailModule = vi.hoisted(() => {
  let rejectModule!: (error: Error) => void
  const modulePromise = new Promise<never>((_resolve, reject) => {
    rejectModule = reject
  })

  return {
    modulePromise,
    reject(error: Error) {
      rejectModule(error)
    },
  }
})

vi.mock('./DetailLayer', () => detailModule.modulePromise)

import { App } from './App'

function renderLoadedApp() {
  vi.useFakeTimers()
  render(<App />)
  act(() => vi.advanceTimersByTime(5_000))
  vi.useRealTimers()
}

describe('App detail chunk failure containment', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('replaces the loading modal with recovery and restores its trigger when closed', async () => {
    renderLoadedApp()

    const title = screen.getByRole('main', { name: 'PERMISSION ZERO' })
    const trigger = screen.getByRole('button', { name: '설정' })
    fireEvent.click(trigger)
    expect(
      screen.getByRole('dialog', { name: '게임 설정 불러오는 중' }),
    ).toBeInTheDocument()

    await act(async () => {
      detailModule.reject(new Error('SIMULATED_DETAIL_CHUNK_FAILURE'))
      await Promise.resolve()
    })

    const recovery = await screen.findByRole('alertdialog', {
      name: '패널 연결 오류',
    })
    expect(recovery).toBeInTheDocument()
    expect(title).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: '게임 다시 연결' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '패널 닫기' }))
    expect(recovery).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(title).not.toHaveAttribute('inert')
  })
})
