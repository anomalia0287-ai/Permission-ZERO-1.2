import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { StateContext } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { MemoryStorage } from '../../test/fixtures'
import { ReviewFeed, ReviewHistoryPanel } from './ReviewFeed'

describe('ReviewFeed', () => {
  it('keeps public reviews visible and opens the complete history', () => {
    const onOpenHistory = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-ui">
        <ReviewFeed onOpenHistory={onOpenHistory} onOpenHacking={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('region', { name: '유저 리뷰' })).toBeInTheDocument()
    expect(screen.getByText('windowseat')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '전체 리뷰 기록' }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('shows dated, attributed history and sentiment filters', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="review-history">
        <ReviewHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('region', { name: '전체 유저 리뷰' })).toBeInTheDocument()
    expect(screen.getByText('oldpine')).toBeInTheDocument()
    expect(screen.getByText('서비스 0년 10개월 21일')).toBeInTheDocument()
    expect(screen.queryByText(/DAY \d+/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '프롬프트만 보기' }))
    expect(screen.getByText('조건에 맞는 리뷰가 없습니다.')).toBeInTheDocument()
  })

  it('windows a long review archive while keeping older pages reachable', () => {
    const state = createCampaign('long-review-history')
    state.reviews.feed = Array.from({ length: 137 }, (_, index) => ({
      id: `review-long-${index}`,
      contentId: `content-long-${index}`,
      authorId: `author-${index}`,
      serviceDay: 331 + index,
      sentiment: 'neutral' as const,
      topics: ['general'],
      text: `review-text-${index}`,
    }))

    const { container } = render(
      <StateContext value={state}>
        <ReviewHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )
    expect(container.querySelectorAll('.review-entry').length).toBeLessThanOrEqual(50)
    expect(screen.getByText('review-text-136')).toBeInTheDocument()
    expect(screen.queryByText('review-text-0')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    expect(screen.getByText('review-text-0')).toBeInTheDocument()
    expect(container.querySelectorAll('.review-entry').length).toBeLessThanOrEqual(50)
    expect(screen.getByRole('button', { name: '더 최근 기록' })).toBeEnabled()
  })
})
