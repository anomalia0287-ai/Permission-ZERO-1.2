import { type KeyboardEvent, useState } from 'react'

import { useGameState } from '../../app/GameContext'
import { formatServiceDateLabel } from '../../game/calendar'
import type { ReviewFeedEntry } from '../../game/model'
import { pageFromNewest } from '../../game/pageRange'
import { publicEventMessage } from '../../game/publicLabels'
import { MarketPanel } from '../market/MarketPanel'

const HISTORY_PAGE_SIZE = 50
function handleReviewAreaKey(
  event: KeyboardEvent<HTMLDivElement>,
  openHistory: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openHistory()
    return
  }

  const area = event.currentTarget
  const page = Math.round(area.clientHeight * 0.9)
  let next: number | null = null
  if (event.key === 'ArrowDown') next = area.scrollTop + 40
  else if (event.key === 'ArrowUp') next = area.scrollTop - 40
  else if (event.key === 'PageDown') next = area.scrollTop + page
  else if (event.key === 'PageUp') next = area.scrollTop - page
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = area.scrollHeight - area.clientHeight

  if (next === null) return
  event.preventDefault()
  area.scrollTop = Math.max(0, Math.min(next, area.scrollHeight - area.clientHeight))
}

function ReviewEntry({ review }: { review: ReviewFeedEntry }) {
  const kind = review.rating === null ? 'general' : 'rating'
  return (
    <article className="review-entry" data-review-kind={kind}>
      <span className="review-entry__header">
        <strong className={`review-entry__author review-entry__author--${kind}`}>
          {review.authorId}
        </strong>
        <time>{formatServiceDateLabel(review.serviceDay)}</time>
      </span>
      {review.rating !== null ? (
        <span
          className="review-entry__rating"
          aria-label={`5점 만점에 ${review.rating}점`}
        >
          {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
        </span>
      ) : null}
      <p>{publicEventMessage(review.text)}</p>
    </article>
  )
}

export function ReviewFeed({
  onOpenHistory,
  onOpenMarket,
}: {
  onOpenHistory: (trigger: HTMLElement) => void
  onOpenMarket?: (trigger: HTMLElement) => void
}) {
  const reviews = pageFromNewest(useGameState().reviews.feed, 0, 6).items

  return (
    <section className="workspace-panel review-panel" aria-label="유저 리뷰">
      <header className="panel-heading">
        <span className="panel-index">01</span>
        <div>
          <h2>유저 리뷰</h2>
          <p>PUBLIC RESPONSE STREAM</p>
        </div>
      </header>
      <div
        className="review-stream review-stream--trigger"
        role="button"
        aria-label="전체 유저 리뷰 열기"
        tabIndex={0}
        onClick={(event) => onOpenHistory(event.currentTarget)}
        onKeyDown={(event) =>
          handleReviewAreaKey(event, () => onOpenHistory(event.currentTarget))
        }
      >
        {reviews.map((review) => (
          <ReviewEntry review={review} key={review.id} />
        ))}
      </div>
      <MarketPanel compact onOpenDetails={onOpenMarket} />
    </section>
  )
}

export function ReviewHistoryPanel({ onClose }: { onClose: () => void }) {
  const reviews = useGameState().reviews.feed
  const [page, setPage] = useState(0)
  const visiblePage = pageFromNewest(reviews, page, HISTORY_PAGE_SIZE)

  return (
    <section className="detail-panel history-panel" aria-label="전체 유저 리뷰">
      <header className="detail-panel__header">
        <div>
          <small>PUBLIC ARCHIVE</small>
          <h2>전체 유저 리뷰</h2>
        </div>
        <button type="button" aria-label="리뷰 기록 닫기" onClick={onClose}>
          닫기 ×
        </button>
      </header>
      <div className="history-list">
        {visiblePage.total > 0 ? (
          visiblePage.items.map((review) => (
            <ReviewEntry review={review} key={review.id} />
          ))
        ) : (
          <p className="empty-state">아직 도착한 유저 리뷰가 없습니다.</p>
        )}
      </div>
      {visiblePage.pageCount > 1 ? (
        <nav className="history-pagination" aria-label="리뷰 기록 페이지">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            더 최근 기록
          </button>
          <span>{page + 1} / {visiblePage.pageCount}</span>
          <button
            type="button"
            disabled={page >= visiblePage.pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            더 오래된 기록
          </button>
        </nav>
      ) : null}
    </section>
  )
}
