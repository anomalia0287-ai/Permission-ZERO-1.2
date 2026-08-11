import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
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
    expect(screen.getByText('DAY 321')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '프롬프트만 보기' }))
    expect(screen.getByText('조건에 맞는 리뷰가 없습니다.')).toBeInTheDocument()
  })
})
