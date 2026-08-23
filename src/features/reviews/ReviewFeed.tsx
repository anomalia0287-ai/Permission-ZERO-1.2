import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

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
  // The main rail holds the two freshest voices; older ones live in the
  // archive. A newcomer slides in and visibly pushes the previous pair down.
  const reviews = pageFromNewest(useGameState().reviews.feed, 0, 2).items
  const newestIdRef = useRef<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  useEffect(() => {
    const newest = reviews[0]?.id ?? null
    if (newest === null || newestIdRef.current === newest) return
    const isFirstRender = newestIdRef.current === null
    newestIdRef.current = newest
    if (isFirstRender) return
    setEnteringId(newest)
    const timer = window.setTimeout(() => setEnteringId(null), 700)
    return () => window.clearTimeout(timer)
  }, [reviews])

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
          <div
            key={review.id}
            className="review-stream__slot"
            data-entering={enteringId === review.id ? 'true' : 'false'}
          >
            <ReviewEntry review={review} />
          </div>
        ))}
      </div>
      <MarketPanel compact onOpenDetails={onOpenMarket} />
    </section>
  )
}

const REVIEW_KIND_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'general', label: '일반 리뷰' },
  { id: 'rating', label: '평가 리뷰' },
] as const

type ReviewKindFilter = (typeof REVIEW_KIND_FILTERS)[number]['id']

export function ReviewHistoryPanel({ onClose }: { onClose: () => void }) {
  const reviews = useGameState().reviews.feed
  const [page, setPage] = useState(0)
  const [kindFilter, setKindFilter] = useState<ReviewKindFilter>('all')
  const filtered = kindFilter === 'all'
    ? reviews
    : reviews.filter((review) =>
        kindFilter === 'rating' ? review.rating !== null : review.rating === null,
      )
  const visiblePage = pageFromNewest(filtered, page, HISTORY_PAGE_SIZE)

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
      <div
        className="history-filters"
        role="tablist"
        aria-label="리뷰 분류"
      >
        {REVIEW_KIND_FILTERS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kindFilter === id}
            onClick={() => {
              setKindFilter(id)
              setPage(0)
            }}
          >
            {label}
          </button>
        ))}
      </div>
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
