import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DispatchContext,
  SettingsContext,
  StateContext,
  type SettingsContextValue,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { createGameEvent } from '../../game/events'
import { MemoryStorage } from '../../test/fixtures'
import { EventLayer } from '../events/EventLayer'
import { ReviewFeed, ReviewHistoryPanel } from './ReviewFeed'
import '../../styles/global.css'
import '../../styles/connected-details.css'
import '../../styles/overlays.css'

function newerReviews(count: number, startServiceDay = 338) {
  return Array.from({ length: count }, (_, index) => ({
    id: `new-review-${index}`,
    contentId: `new-content-${index}`,
    authorId: `new-author-${index}`,
    serviceDay: startServiceDay + index,
    sentiment: 'neutral' as const,
    topics: ['general'],
    text: `new-review-text-${index}`,
    snapshot: {
      kind: 'unavailable' as const,
      reason: 'legacy-save' as const,
      capturedOnServiceDay: startServiceDay + index,
    },
  }))
}

function testSettings(): SettingsContextValue {
  const unavailable = () => {
    throw new Error('unused settings operation')
  }
  return {
    settings: {
      locale: 'ko',
      masterVolume: 0.8,
      musicVolume: 0.6,
      effectsVolume: 0.85,
      muted: false,
      reducedMotion: false,
      uiScale: 1,
    },
    updateSettings: vi.fn(),
    startNewCampaign: vi.fn(),
    loadIssue: null,
    saveFailure: null,
    retrySave: vi.fn(async () => true),
    copyProgressExport: vi.fn(async () => ({ ok: true as const })),
    createProgressFile: unavailable,
    validateProgressImport: unavailable,
    importProgressExport: unavailable,
    validateProgressFileImport: unavailable,
    importProgressFile: unavailable,
  }
}

describe('ReviewFeed', () => {
  it('opens every visible review as a modal detail and restores exact pointer trigger focus', async () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-detail-pointer">
        <div data-app-background>
          <ReviewFeed onOpenHistory={vi.fn()} onOpenHacking={vi.fn()} />
        </div>
      </GameProvider>,
    )
    const reviewButtons = screen.getAllByRole('button', { name: /리뷰 상세 보기/ })
    expect(reviewButtons).toHaveLength(2)
    reviewButtons[0].focus()
    fireEvent.click(reviewButtons[0])

    const dialog = await screen.findByRole('dialog', { name: '유저 리뷰 상세' })
    const detail = within(dialog)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(detail.getByText('windowseat')).toBeInTheDocument()
    expect(detail.getByText('서비스 0년 10개월 27일')).toBeInTheDocument()
    expect(detail.getByText('일반')).toBeInTheDocument()
    expect(detail.getByText('일반 요청')).toBeInTheDocument()
    expect(detail.getByText('이전 서비스 기록 — 당시 공개 상태가 저장되지 않았습니다.')).toBeInTheDocument()
    expect(detail.queryByText(/의심|폭탄|증거|사보타주/)).not.toBeInTheDocument()
    expect(document.querySelector('[data-app-background]')).toHaveAttribute('inert')

    fireEvent.click(screen.getByRole('button', { name: '리뷰 상세 닫기' }))
    await waitFor(() => expect(reviewButtons[0]).toHaveFocus())
  })

  it('opens by keyboard, traps Tab, closes with Escape, and restores the exact trigger', async () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-detail-keyboard">
        <div data-app-background>
          <ReviewFeed onOpenHistory={vi.fn()} onOpenHacking={vi.fn()} />
        </div>
      </GameProvider>,
    )
    const trigger = screen.getAllByRole('button', { name: /리뷰 상세 보기/ })[1]
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(trigger)

    const close = await screen.findByRole('button', { name: '리뷰 상세 닫기' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps a selected feed detail stable when newer reviews push its row out of the visible window', async () => {
    const state = createCampaign('review-feed-continuity')
    const fallback = <button data-app-focus-fallback>작업 화면 포커스</button>
    const view = (nextState: typeof state) => (
      <StateContext value={nextState}>
        <div data-app-background>
          {fallback}
          <ReviewFeed onOpenHistory={vi.fn()} onOpenHacking={vi.fn()} />
        </div>
      </StateContext>
    )
    const { rerender } = render(view(state))
    const trigger = screen.getByRole('button', { name: 'windowseat 리뷰 상세 보기' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '유저 리뷰 상세' })).toHaveTextContent(
      '주말 일정표를 부탁했는데 필요한 만큼은 해줬어요.',
    )

    const advanced = {
      ...state,
      reviews: {
        ...state.reviews,
        feed: [...state.reviews.feed, ...newerReviews(7)],
      },
    }
    rerender(view(advanced))

    expect(screen.queryByRole('button', { name: 'windowseat 리뷰 상세 보기' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '유저 리뷰 상세' })).toHaveTextContent(
      '주말 일정표를 부탁했는데 필요한 만큼은 해줬어요.',
    )
    fireEvent.click(screen.getByRole('button', { name: '리뷰 상세 닫기' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '작업 화면 포커스' })).toHaveFocus(),
    )
  })

  it('keeps a selected archive detail stable when feed growth moves its row to another page', () => {
    const state = createCampaign('review-history-continuity')
    const view = (nextState: typeof state) => (
      <StateContext value={nextState}>
        <div data-app-background>
          <ReviewHistoryPanel onClose={vi.fn()} />
        </div>
      </StateContext>
    )
    const { rerender } = render(view(state))
    fireEvent.click(screen.getByRole('button', { name: 'windowseat 리뷰 상세 보기' }))

    rerender(view({
      ...state,
      reviews: {
        ...state.reviews,
        feed: [...state.reviews.feed, ...newerReviews(51)],
      },
    }))

    expect(screen.queryByRole('button', { name: 'windowseat 리뷰 상세 보기' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '유저 리뷰 상세' })).toHaveTextContent(
      '주말 일정표를 부탁했는데 필요한 만큼은 해줬어요.',
    )
  })

  it('places a late blocking event above an open review and restores the review as modal top', async () => {
    const base = createCampaign('review-blocking-layer')
    const blockingEvent = createGameEvent(
      base,
      'story',
      '늦게 도착한 차단 통신',
      true,
    )
    const dispatch = vi.fn()
    const settings = testSettings()
    const view = (active: typeof base.activeEvent) => (
      <SettingsContext value={settings}>
        <DispatchContext value={dispatch}>
          <StateContext value={{ ...base, activeEvent: active }}>
            <div data-app-background>
              <button data-app-focus-fallback>작업 화면 포커스</button>
              <ReviewFeed onOpenHistory={vi.fn()} onOpenHacking={vi.fn()} />
            </div>
            <EventLayer />
          </StateContext>
        </DispatchContext>
      </SettingsContext>
    )
    const { rerender } = render(view(null))
    fireEvent.click(screen.getByRole('button', { name: 'windowseat 리뷰 상세 보기' }))
    const reviewDialog = screen.getByRole('dialog', { name: '유저 리뷰 상세' })

    rerender(view(blockingEvent))

    const eventDialog = screen.getByRole('dialog', { name: '기밀 통신' })
    expect(reviewDialog).toHaveAttribute('inert')
    expect(eventDialog).not.toHaveAttribute('inert')
    expect(Number(getComputedStyle(eventDialog.parentElement!).zIndex)).toBeGreaterThan(
      Number(getComputedStyle(reviewDialog).zIndex),
    )
    fireEvent.click(screen.getByRole('button', { name: '계속' }))
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESOLVE_ACTIVE_EVENT' })

    rerender(view(null))
    expect(reviewDialog).not.toHaveAttribute('inert')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '리뷰 상세 닫기' })).toHaveFocus(),
    )
  })

  it('shows only topic-relevant captured performance and market context', () => {
    const state = createCampaign('review-public-detail')
    state.reviews.feed = [
      {
        id: 'review-public-detail-1',
        contentId: 'negative-memory-01',
        authorId: 'archivecat',
        serviceDay: 337,
        sentiment: 'negative',
        topics: ['memory'],
        text: '바로 앞에서 말한 조건을 놓쳐서 다시 설명했어요.',
        snapshot: {
          kind: 'captured-public-v1',
          capturedOnServiceDay: 337,
          performance: {
            expectedPerformance: 14,
            categories: [{ category: 'memory', actual: 11 }],
          },
          market: null,
        },
      },
    ]
    render(
      <StateContext value={state}>
        <div data-app-background>
          <ReviewFeed onOpenHistory={vi.fn()} onOpenHacking={vi.fn()} />
        </div>
      </StateContext>,
    )
    fireEvent.click(screen.getByRole('button', { name: /리뷰 상세 보기/ }))

    const snapshot = within(screen.getByRole('region', { name: '당시 공개 상태' }))
    expect(snapshot.getByText('기억')).toBeInTheDocument()
    expect(snapshot.getByText('현재 11.0 / 기대 14.0')).toBeInTheDocument()
    expect(snapshot.queryByText('추론')).not.toBeInTheDocument()
    expect(snapshot.queryByText('유창성')).not.toBeInTheDocument()
    expect(snapshot.queryByText(/시장 점유율/)).not.toBeInTheDocument()
  })
  it('keeps public reviews visible and opens the complete history', () => {
    const onOpenHistory = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="reviews-ui">
        <ReviewFeed onOpenHistory={onOpenHistory} onOpenHacking={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('region', { name: '유저 리뷰' })).toBeInTheDocument()
    expect(screen.getByText('windowseat')).toBeInTheDocument()
    const market = screen.getByRole('region', { name: '경쟁 AI 현황' })
    expect(market).toHaveTextContent('MERIDIAN')
    expect(market).toHaveTextContent('TALLOW')
    expect(within(market).getByRole('img', { name: /시장 점유율:/ })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    expect(screen.getByText('review-text-0')).toBeInTheDocument()
    expect(container.querySelectorAll('.review-entry').length).toBeLessThanOrEqual(50)
    expect(screen.getByRole('button', { name: '더 최근 기록' })).toBeEnabled()
  })
})
