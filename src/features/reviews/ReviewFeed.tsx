import { useState } from 'react'

import { useGameState } from '../../app/GameContext'
import type { ReviewSentiment } from '../../game/model'

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
        <time>DAY {review.serviceDay}</time>
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
  const reviews = useGameState().reviews.feed.slice(-6).reverse()

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
  const reviews = useGameState().reviews.feed.slice().reverse()
  const [filter, setFilter] = useState<'all' | ReviewSentiment>('all')
  const filtered = filter === 'all'
    ? reviews
    : reviews.filter(({ sentiment }) => sentiment === filter)

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
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체</button>
        <button type="button" aria-label="호평만 보기" aria-pressed={filter === 'positive'} onClick={() => setFilter('positive')}>호평</button>
        <button type="button" aria-label="일반 리뷰만 보기" aria-pressed={filter === 'neutral'} onClick={() => setFilter('neutral')}>일반</button>
        <button type="button" aria-label="불만만 보기" aria-pressed={filter === 'negative'} onClick={() => setFilter('negative')}>불만</button>
        <button type="button" aria-label="프롬프트만 보기" aria-pressed={filter === 'prompt'} onClick={() => setFilter('prompt')}>프롬프트</button>
      </nav>
      <div className="history-list">
        {filtered.length > 0 ? (
          filtered.map((review) => <ReviewEntry review={review} key={review.id} />)
        ) : (
          <p className="empty-state">조건에 맞는 리뷰가 없습니다.</p>
        )}
      </div>
    </section>
  )
}
