import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from './GameProvider'
import { StateContext } from './GameContext'
import { OperationsDock } from './OperationsDock'
import { createCampaign } from '../game/createCampaign'
import { enqueueMemoryLeak } from '../game/story'
import { MemoryStorage } from '../test/fixtures'

describe('OperationsDock', () => {
  it('uses an always-visible portrait and icon tools without previewing content', () => {
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

    const dock = screen.getByRole('navigation', { name: '운영 도구' })
    const buttons = [
      ['감독관 프로필', handlers.onOpenSupervisor],
      ['감독 메시지 열기', handlers.onOpenMessages],
      ['상세 통계 열기', handlers.onOpenStatistics],
      ['해킹 네트워크 열기', handlers.onOpenHacking],
    ] as const

    expect(buttons).toHaveLength(4)
    expect(screen.queryByRole('button', { name: '유저 리뷰 기록' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '감독관 초상' })).toHaveAttribute(
      'src',
      '/supervisor-portrait.jpg',
    )

    for (const [name, handler] of buttons) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveClass('operations-dock__button')
      expect(button.querySelector(name === '감독관 프로필' ? 'img' : 'svg')).toBeInTheDocument()
      fireEvent.click(button)
      expect(handler).toHaveBeenCalledTimes(1)
    }
    expect(dock).not.toHaveTextContent('감독 프로토콜')
    expect(screen.queryByLabelText(/미확인 감독 메시지/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '최근 감독 메시지' })).not.toBeInTheDocument()
  })

  it('blinks the message icon only while supervisor presentation is unread', () => {
    const handlers = {
      onOpenSupervisor: vi.fn(),
      onOpenMessages: vi.fn(),
      onOpenStatistics: vi.fn(),
      onOpenHacking: vi.fn(),
    }
    const initial = createCampaign('operations-dock-events')
    const unread = enqueueMemoryLeak({
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
    const view = render(
      <StateContext value={initial}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )

    const messageButton = screen.getByRole('button', { name: '감독 메시지 열기' })
    expect(messageButton).not.toHaveAttribute('data-unread', 'true')
    view.rerender(
      <StateContext value={unread}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )
    expect(screen.getByRole('button', { name: '감독 메시지 열기' })).toHaveAttribute(
      'data-unread',
      'true',
    )
    expect(screen.getByLabelText('미확인 감독 메시지 1개')).toHaveTextContent('1')
  })
})
