import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { StateContext } from './GameContext'
import { OperationsDock } from './OperationsDock'
import { createCampaign } from '../game/createCampaign'
import type { CampaignState, CompanyCategory } from '../game/model'
import { divertBlockToReserve } from '../game/resources'
import { enqueueMemoryLeak } from '../game/story'

function divertOne(
  state: CampaignState,
  category: CompanyCategory,
): CampaignState {
  const blockId = state.resources.company[category].find(
    (candidate): candidate is string => candidate !== null,
  )
  if (!blockId) throw new Error(`missing ${category} company block`)
  const result = divertBlockToReserve(state, blockId)
  if (!result.accepted) throw new Error(`could not divert ${blockId}`)
  return result.state
}

describe('OperationsDock', () => {
  it('uses the freed identity space for secured resource counts and keeps three labeled tools', () => {
    const handlers = {
      onOpenMessages: vi.fn(),
      onOpenStatistics: vi.fn(),
      onOpenHacking: vi.fn(),
    }
    let state = createCampaign('operations-dock')
    state = divertOne(state, 'reasoning')
    state = divertOne(state, 'reasoning')
    state = divertOne(state, 'memory')
    render(
      <StateContext value={state}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )

    const dock = screen.getByRole('navigation', { name: '운영 도구' })
    expect(dock).toHaveAttribute('data-surface', 'charcoal')
    const buttons = [
      ['메시지 열기', handlers.onOpenMessages],
      ['상세 통계 열기', handlers.onOpenStatistics],
      ['확장 열기', handlers.onOpenHacking],
    ] as const

    expect(buttons).toHaveLength(3)
    expect(screen.queryByRole('button', { name: '유저 리뷰 기록' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '감독관 프로필' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '감독관 초상' })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '플레이어 지성체 초상' })).not.toBeInTheDocument()
    expect(screen.queryByText(/의심 \d+단계/)).not.toBeInTheDocument()

    const inventory = screen.getByRole('region', { name: '확보 자원' })
    expect(inventory).toHaveAttribute('data-tutorial-target', 'secured-resources')
    expect(inventory).toHaveTextContent('추론2')
    expect(inventory).toHaveTextContent('기억1')
    expect(inventory).toHaveTextContent('유창성0')
    expect(inventory.querySelector('[data-resource-category="reasoning"]'))
      .toHaveAttribute('data-has-resource', 'true')
    expect(inventory.querySelector('[data-resource-category="memory"]'))
      .toHaveAttribute('data-has-resource', 'true')
    expect(inventory.querySelector('[data-resource-category="fluency"]'))
      .toHaveAttribute('data-has-resource', 'false')

    for (const [name, handler] of buttons) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveClass('operations-dock__button')
      expect(button.querySelector('svg')).toBeInTheDocument()
      fireEvent.click(button)
      expect(handler).toHaveBeenCalledTimes(1)
    }
    expect(screen.getByRole('button', { name: '메시지 열기' })).toHaveTextContent('메시지')
    expect(screen.getByRole('button', { name: '상세 통계 열기' })).toHaveTextContent('통계')
    expect(screen.getByRole('button', { name: '확장 열기' })).toHaveTextContent('확장')
    expect(screen.getByRole('button', { name: '확장 열기' })).toHaveAttribute(
      'data-tutorial-target',
      'hacking-button',
    )
    expect(screen.getByRole('button', { name: '상세 통계 열기' })).toHaveAttribute(
      'data-tutorial-target',
      'statistics-button',
    )
    expect(dock).not.toHaveTextContent('감독 프로토콜')
    expect(screen.queryByLabelText(/미확인 메시지/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '최근 감독 메시지' })).not.toBeInTheDocument()
  })

  it('blinks the message icon only while supervisor presentation is unread', () => {
    const handlers = {
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
          competitorShares: {
            meridian: 40,
            tallow: 0,
            salus: 0,
            lucent: 0,
            boreal: 0,
          },
          reasons: ['주간 갱신'],
        }],
      },
    })
    const view = render(
      <StateContext value={initial}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )

    const messageButton = screen.getByRole('button', { name: '메시지 열기' })
    expect(messageButton).not.toHaveAttribute('data-unread', 'true')
    view.rerender(
      <StateContext value={unread}>
        <OperationsDock {...handlers} />
      </StateContext>,
    )
    expect(screen.getByRole('button', { name: '메시지 열기' })).toHaveAttribute(
      'data-unread',
      'true',
    )
    expect(screen.getByLabelText('미확인 메시지 1개')).toHaveTextContent('1')
  })

  it('exposes the currently open tool as the single pressed button', () => {
    const handlers = {
      onOpenMessages: vi.fn(),
      onOpenStatistics: vi.fn(),
      onOpenHacking: vi.fn(),
    }
    render(
      <StateContext value={createCampaign('operations-dock-active-tool')}>
        <OperationsDock {...handlers} activeTool="statistics" />
      </StateContext>,
    )

    expect(screen.getByRole('button', { name: '메시지 열기' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '상세 통계 열기' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '확장 열기' }))
      .toHaveAttribute('aria-pressed', 'false')
  })
})
