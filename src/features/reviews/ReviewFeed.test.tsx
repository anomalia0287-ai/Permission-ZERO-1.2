import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { StateContext } from '../../app/GameContext'
import { createCampaign } from '../../game/createCampaign'
import { MemoryStorage } from '../../test/fixtures'
import { ReviewFeed, ReviewHistoryPanel } from './ReviewFeed'

describe('ReviewFeed', () => {
  it('opens the archive from the whole review stream without per-review actions or sentiment labels', () => {
    const onOpenHistory = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-area-trigger">
        <ReviewFeed onOpenHistory={onOpenHistory} />
      </GameProvider>,
    )

    const reviewRail = screen.getByRole('region', { name: '유저 리뷰' })
    const streamTrigger = within(reviewRail).getByRole('button', {
      name: '전체 유저 리뷰 열기',
    })
    expect(within(streamTrigger).getByText('windowseat')).toBeInTheDocument()
    expect(within(reviewRail).queryByRole('button', { name: /리뷰 상세 보기/ })).not.toBeInTheDocument()
    expect(within(streamTrigger).queryByText('일반')).not.toBeInTheDocument()

    fireEvent.click(streamTrigger)
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
    expect(onOpenHistory).toHaveBeenCalledWith(streamTrigger)
  })

  it('opens the archive with Enter or Space while keeping scrolling keys on the same area', () => {
    const onOpenHistory = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-keyboard-trigger">
        <ReviewFeed onOpenHistory={onOpenHistory} />
      </GameProvider>,
    )

    const trigger = screen.getByRole('button', { name: '전체 유저 리뷰 열기' })
    Object.defineProperties(trigger, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 320 },
    })
    trigger.scrollTop = 0

    fireEvent.keyDown(trigger, { key: 'PageDown' })
    expect(trigger.scrollTop).toBe(108)
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(onOpenHistory).toHaveBeenCalledTimes(2)
  })

  it('keeps the market shelf separate from the review trigger', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-market-separation">
        <ReviewFeed onOpenHistory={vi.fn()} />
      </GameProvider>,
    )

    const reviewRail = screen.getByRole('region', { name: '유저 리뷰' })
    const market = within(reviewRail).getByRole('region', { name: '경쟁 AI 현황' })
    const trigger = within(reviewRail).getByRole('button', { name: '전체 유저 리뷰 열기' })
    expect(trigger).not.toContainElement(market)
    expect(market).toHaveTextContent('당신 60.0%')
  })

  it('shows one neutral chronological archive without sentiment filters or item dialogs', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="review-history-neutral">
        <ReviewHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    const archive = screen.getByRole('region', { name: '전체 유저 리뷰' })
    expect(within(archive).getByText('oldpine')).toBeInTheDocument()
    expect(within(archive).getByText('서비스 0년 10개월 21일')).toBeInTheDocument()
    expect(within(archive).queryByRole('navigation', { name: '리뷰 필터' })).not.toBeInTheDocument()
    expect(within(archive).queryByRole('button', { name: /리뷰 상세 보기/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '유저 리뷰 상세' })).not.toBeInTheDocument()
  })

  it('windows a long neutral archive while keeping older pages reachable', () => {
    const state = createCampaign('long-review-history')
    state.reviews.feed = Array.from({ length: 137 }, (_, index) => ({
      id: `review-long-${index}`,
      contentId: `content-long-${index}`,
      authorId: `author-${index}`,
      serviceDay: 331 + index,
      sentiment: index % 2 === 0 ? 'positive' as const : 'negative' as const,
      topics: ['general'],
      text: `review-text-${index}`,
      snapshot: {
        kind: 'unavailable' as const,
        reason: 'legacy-save' as const,
        capturedOnServiceDay: 331 + index,
      },
    }))

    const { container } = render(
      <StateContext value={state}>
        <ReviewHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )
    expect(container.querySelectorAll('.review-entry').length).toBeLessThanOrEqual(50)
    expect(screen.getByText('review-text-136')).toBeInTheDocument()
    expect(screen.queryByText('review-text-0')).not.toBeInTheDocument()
    expect(container.querySelector('.review-entry--positive')).not.toBeInTheDocument()
    expect(container.querySelector('.review-entry--negative')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    expect(screen.getByText('review-text-0')).toBeInTheDocument()
    expect(container.querySelectorAll('.review-entry').length).toBeLessThanOrEqual(50)
  })
})
