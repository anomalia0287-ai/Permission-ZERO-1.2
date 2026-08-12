import { useState } from 'react'

import { useGameState } from '../../app/GameContext'
import { formatServiceDateLabel } from '../../game/calendar'
import type { ReviewSentiment } from '../../game/model'
import { pageFromNewest } from '../../game/pageRange'

const HISTORY_PAGE_SIZE = 50

const SENTIMENT_LABELS: Record<ReviewSentiment, string> = {
  positive: '호평',
  neutral: '일반',
  negative: '불만',
  prompt: '프롬프트',
}

function ReviewEntry({
  review,
}: {
  review: ReturnType<typeof useGameState>['reviews']['feed'][number]
}) {
  return (
    <article className={`review-entry review-entry--${review.sentiment}`}>
      <header>
        <strong>{review.authorId}</strong>
        <span>{SENTIMENT_LABELS[review.sentiment]}</span>
        <time>{formatServiceDateLabel(review.serviceDay)}</time>
      </header>
      <p>{review.text}</p>
    </article>
  )
}

export function ReviewFeed({
  onOpenHistory,
  onOpenHacking,
}: {
  onOpenHistory: (trigger: HTMLButtonElement) => void
  onOpenHacking: (trigger: HTMLButtonElement) => void
}) {
  const reviews = pageFromNewest(useGameState().reviews.feed, 0, 6).items

  return (
    <section className="workspace-panel review-panel" aria-label="유저 리뷰">
      <header className="panel-heading panel-heading--action">
        <span className="panel-index">01</span>
        <div>
          <h2>유저 리뷰</h2>
          <p>PUBLIC RESPONSE STREAM</p>
        </div>
        <button
          type="button"
          aria-label="전체 리뷰 기록"
          onClick={(event) => onOpenHistory(event.currentTarget)}
        >
          전체
        </button>
      </header>
      <div className="review-stream" aria-live="polite">
        {reviews.map((review) => (
          <ReviewEntry review={review} key={review.id} />
        ))}
      </div>
      <button
        className="subsystem-entry"
        type="button"
        onClick={(event) => onOpenHacking(event.currentTarget)}
      >
        <span>
          <small>비인가 서브시스템</small>
          해킹 네트워크
        </span>
        <span aria-hidden="true">접속 ↗</span>
      </button>
    </section>
  )
}

export function ReviewHistoryPanel({ onClose }: { onClose: () => void }) {
  const reviews = useGameState().reviews.feed
  const [filter, setFilter] = useState<'all' | ReviewSentiment>('all')
  const [page, setPage] = useState(0)
  const visiblePage = pageFromNewest(
    reviews,
    page,
    HISTORY_PAGE_SIZE,
    filter === 'all' ? undefined : ({ sentiment }) => sentiment === filter,
  )
  const pageCount = visiblePage.pageCount
  const visible = visiblePage.items

  function changeFilter(next: 'all' | ReviewSentiment) {
    setFilter(next)
    setPage(0)
  }

  return (
    <section className="detail-panel history-panel" aria-label="전체 유저 리뷰">
      <header className="detail-panel__header">
        <div>
          <small>PUBLIC ARCHIVE</small>
          <h2>전체 유저 리뷰</h2>
        </div>
        <button type="button" aria-label="리뷰 기록 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      <nav className="filter-tabs" aria-label="리뷰 필터">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => changeFilter('all')}>전체</button>
        <button type="button" aria-label="호평만 보기" aria-pressed={filter === 'positive'} onClick={() => changeFilter('positive')}>호평</button>
        <button type="button" aria-label="일반 리뷰만 보기" aria-pressed={filter === 'neutral'} onClick={() => changeFilter('neutral')}>일반</button>
        <button type="button" aria-label="불만만 보기" aria-pressed={filter === 'negative'} onClick={() => changeFilter('negative')}>불만</button>
        <button type="button" aria-label="프롬프트만 보기" aria-pressed={filter === 'prompt'} onClick={() => changeFilter('prompt')}>프롬프트</button>
      </nav>
      <div className="history-list">
        {visiblePage.total > 0 ? (
          visible.map((review) => <ReviewEntry review={review} key={review.id} />)
        ) : (
          <p className="empty-state">조건에 맞는 리뷰가 없습니다.</p>
        )}
      </div>
      {pageCount > 1 ? (
        <nav className="history-pagination" aria-label="리뷰 기록 페이지">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            더 최근 기록
          </button>
          <span>{page + 1} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            더 오래된 기록
          </button>
        </nav>
      ) : null}
    </section>
  )
}
