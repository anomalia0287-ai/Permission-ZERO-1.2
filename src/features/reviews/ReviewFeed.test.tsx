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
    expect(within(streamTrigger).getAllByText('일반').length).toBeGreaterThan(0)

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
    expect(within(market).getByText('당신', { exact: true })).toBeInTheDocument()
    expect(within(market).getByText('60.0%', { exact: true })).toBeInTheDocument()
  })

  it('separates evaluative feedback from general traffic without exposing sentiment labels', () => {
    const state = createCampaign('review-history-channels')
    state.reviews.feed = [
      {
        ...state.reviews.feed[0],
        id: 'evaluation-positive',
        sentiment: 'positive',
        topics: ['general'],
        text: '품질이 확실히 좋아졌습니다.',
      },
      {
        ...state.reviews.feed[0],
        id: 'evaluation-performance',
        sentiment: 'neutral',
        topics: ['reasoning'],
        text: '추론 과정은 안정적이네요.',
      },
      {
        ...state.reviews.feed[0],
        id: 'general-neutral',
        sentiment: 'neutral',
        topics: ['general'],
        text: '오늘도 필요한 만큼 썼습니다.',
      },
      {
        ...state.reviews.feed[0],
        id: 'general-prompt',
        sentiment: 'prompt',
        topics: ['ordinary-prompt'],
        text: '이번 주 일정을 정리해줘.',
      },
    ]

    render(
      <StateContext value={state}>
        <ReviewHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )

    const archive = screen.getByRole('region', { name: '전체 유저 리뷰' })
    const channels = within(archive).getByRole('tablist', { name: '리뷰 구분' })
    expect(within(channels).getByRole('tab', { name: /일반\s*2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(within(archive).getByText('오늘도 필요한 만큼 썼습니다.')).toBeInTheDocument()
    expect(within(archive).getByText('이번 주 일정을 정리해줘.')).toBeInTheDocument()
    expect(within(archive).queryByText('품질이 확실히 좋아졌습니다.')).not.toBeInTheDocument()

    fireEvent.click(within(channels).getByRole('tab', { name: /평가\s*2/ }))
    expect(within(archive).getByText('품질이 확실히 좋아졌습니다.')).toBeInTheDocument()
    expect(within(archive).getByText('추론 과정은 안정적이네요.')).toBeInTheDocument()
    expect(within(archive).queryByText('오늘도 필요한 만큼 썼습니다.')).not.toBeInTheDocument()
    expect(
      archive.querySelectorAll('[data-review-channel="evaluation"]'),
    ).toHaveLength(2)
    expect(within(archive).queryByText(/호평|불만|프롬프트/)).not.toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('tab', { name: /평가\s*137/ }))
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
