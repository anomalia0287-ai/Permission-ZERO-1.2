import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from './GameProvider'
import { StateContext } from './GameContext'
import { OperationsDock } from './OperationsDock'
import { createCampaign } from '../game/createCampaign'
import { appendJournal, journalAt } from '../game/journal'
import { MemoryStorage } from '../test/fixtures'

describe('OperationsDock', () => {
  it('keeps the supervisor, horizontal suspicion readout, and ordered command cards visible', () => {
    const handlers = {
      onOpenSupervisor: vi.fn(),
      onOpenMessages: vi.fn(),
      onOpenStatistics: vi.fn(),
      onOpenHacking: vi.fn(),
    }
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="operations-dock">
        <OperationsDock {...handlers} />
      </GameProvider>,
    )

    const rail = screen.getByRole('complementary', { name: '감독관 관제' })
    const dock = screen.getByRole('navigation', { name: '운영 도구' })
    const profile = screen.getByRole('button', { name: '감독관 프로필' })
    expect(profile.querySelector('img')).toHaveAttribute('src', '/supervisor-portrait.png')
    const buttons = [
      ['감독 메시지 열기', handlers.onOpenMessages],
      ['통계 열기', handlers.onOpenStatistics],
      ['해킹 네트워크 열기', handlers.onOpenHacking],
    ] as const

    expect(buttons).toHaveLength(3)
    expect(screen.queryByRole('button', { name: '유저 리뷰 기록' })).not.toBeInTheDocument()
    fireEvent.click(profile)
    expect(handlers.onOpenSupervisor).toHaveBeenCalledTimes(1)

    for (const [name, handler] of buttons) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveClass('operations-dock__button')
      expect(button.querySelector('svg')).toBeInTheDocument()
      fireEvent.click(button)
      expect(handler).toHaveBeenCalledTimes(1)
    }
    expect(rail).toHaveTextContent('감독 프로토콜 7A')
    expect(rail).toHaveTextContent('현재 의심 수치')
    expect(screen.getByRole('region', { name: '현재 의심 수치' })).toBeInTheDocument()
    expect(rail).toHaveTextContent('다음 달 감사')
    expect(dock).toHaveTextContent('메시지')
    expect(dock).toHaveTextContent('통계')
    expect(dock).toHaveTextContent('해킹 네트워크')
    expect(screen.getByLabelText('감독 메시지 1개')).toHaveTextContent('1')
  })

  it('increments the sealed message badge as journal events arrive', () => {
    const handlers = {
      onOpenSupervisor: vi.fn(),
      onOpenMessages: vi.fn(),
      onOpenStatistics: vi.fn(),
      onOpenHacking: vi.fn(),
    }
    const initial = createCampaign('operations-dock-events')
    const opening = journalAt(initial.eventLog, 0)!
    const withTwo = {
      ...initial,
      eventLog: appendJournal(initial.eventLog, {
        ...opening,
        id: 'event-000001',
        sequence: 1,
      }),
    }
    const withThree = {
      ...withTwo,
      eventLog: appendJournal(withTwo.eventLog, {
        ...opening,
        id: 'event-000002',
        sequence: 2,
      }),
    }
    const view = render(
      <StateContext value={initial}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )

    expect(screen.getByLabelText('감독 메시지 1개')).toHaveTextContent('1')
    view.rerender(
      <StateContext value={withTwo}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )
    expect(screen.getByLabelText('감독 메시지 2개')).toHaveTextContent('2')
    view.rerender(
      <StateContext value={withThree}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )
    expect(screen.getByLabelText('감독 메시지 3개')).toHaveTextContent('3')
  })
})
