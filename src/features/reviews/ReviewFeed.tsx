import { useRef, useState } from 'react'

import { AccessibleDialog } from '../../app/AccessibleDialog'
import { useGameState } from '../../app/GameContext'
import { formatServiceDateLabel } from '../../game/calendar'
import type { ReviewFeedEntry, ReviewSentiment } from '../../game/model'
import { pageFromNewest } from '../../game/pageRange'
import {
  publicCategoryLabel,
  publicCompetitorStatusLabel,
  publicReviewSentimentLabel,
  publicReviewTopicLabel,
} from '../../game/publicLabels'
import { MarketPanel } from '../market/MarketPanel'

const HISTORY_PAGE_SIZE = 50

function ReviewDetail({
  review,
  onClose,
  returnFocus,
}: {
  review: ReviewFeedEntry
  onClose: () => void
  returnFocus: () => HTMLElement | null
}) {
  const snapshot = review.snapshot
  return (
    <AccessibleDialog
      className="review-detail-layer"
      label="유저 리뷰 상세"
      description="선택한 유저 리뷰의 전체 문장과 당시 공개 상태입니다."
      dismissible
      onDismiss={onClose}
      returnFocus={returnFocus}
      fallbackFocus={() =>
        document.querySelector<HTMLElement>('[data-app-focus-fallback]')
      }
    >
      <button
        className="review-detail-layer__backdrop"
        type="button"
        aria-label="리뷰 상세 배경 닫기"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <article className="review-detail-card">
        <header>
          <div>
            <small>PUBLIC RESPONSE RECORD</small>
            <h2>유저 리뷰 상세</h2>
          </div>
          <button
            type="button"
            aria-label="리뷰 상세 닫기"
            data-dialog-initial-focus
            onClick={onClose}
          >
            닫기 ×
          </button>
        </header>
        <div className="review-detail-card__identity">
          <strong>{review.authorId}</strong>
          <span>{publicReviewSentimentLabel(review.sentiment)}</span>
          <time>{formatServiceDateLabel(review.serviceDay)}</time>
        </div>
        <p className="review-detail-card__text">{review.text}</p>
        <div className="review-detail-card__topics" aria-label="공개 주제">
          {review.topics.map((topic) => (
            <span key={topic}>{publicReviewTopicLabel(topic)}</span>
          ))}
        </div>
        <section className="review-public-snapshot" aria-label="당시 공개 상태">
          <h3>당시 공개 상태</h3>
          {snapshot.kind === 'unavailable' ? (
            <p>이전 서비스 기록 — 당시 공개 상태가 저장되지 않았습니다.</p>
          ) : (
            <>
              {snapshot.performance ? (
                <dl>
                  {snapshot.performance.categories.map(({ actual, category }) => (
                    <div key={category}>
                      <dt>{publicCategoryLabel(category)}</dt>
                      <dd>
                        현재 {actual.toFixed(1)} / 기대{' '}
                        {snapshot.performance?.expectedPerformance.toFixed(1)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {snapshot.market ? (
                <dl>
                  <div>
                    <dt>플레이어 시장 점유율</dt>
                    <dd>{snapshot.market.playerShare.toFixed(1)}%</dd>
                  </div>
                  {snapshot.market.competitors.map((competitor) => (
                    <div key={competitor.id}>
                      <dt>{competitor.name}</dt>
                      <dd>
                        {publicCompetitorStatusLabel(competitor.status)} · 시장 점유율{' '}
                        {competitor.marketShare.toFixed(1)}%
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {!snapshot.performance && !snapshot.market ? (
                <p>이 기록과 직접 관련된 공개 성능·시장 수치는 없습니다.</p>
              ) : null}
            </>
          )}
        </section>
      </article>
    </AccessibleDialog>
  )
}

function ReviewEntry({
  review,
  onOpen,
}: {
  review: ReviewFeedEntry
  onOpen: (review: ReviewFeedEntry, trigger: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      className={`review-entry review-entry--${review.sentiment}`}
      aria-label={`${review.authorId} 리뷰 상세 보기`}
      onClick={(event) => onOpen(review, event.currentTarget)}
    >
      <span className="review-entry__header">
        <strong>{review.authorId}</strong>
        <span>{publicReviewSentimentLabel(review.sentiment)}</span>
        <time>{formatServiceDateLabel(review.serviceDay)}</time>
      </span>
      <p>{review.text}</p>
    </button>
  )
}

export function ReviewFeed({
  onOpenHistory,
}: {
  onOpenHistory: (trigger: HTMLButtonElement) => void
  onOpenHacking?: (trigger: HTMLButtonElement) => void
}) {
  const state = useGameState()
  const reviews = pageFromNewest(state.reviews.feed, 0, 6).items
  const [selectedReview, setSelectedReview] = useState<ReviewFeedEntry | null>(null)
  const detailReturnFocusRef = useRef<HTMLButtonElement | null>(null)

  function openReview(review: ReviewFeedEntry, trigger: HTMLButtonElement) {
    detailReturnFocusRef.current = trigger
    setSelectedReview(review)
  }

  return (
    <>
    <section className="workspace-panel review-panel" aria-label="유저 리뷰">
      <button
        type="button"
        className="panel-heading review-panel__open"
        aria-label="전체 리뷰 기록"
        onClick={(event) => onOpenHistory(event.currentTarget)}
      >
        <span className="panel-index">01</span>
        <span className="review-panel__heading-copy">
          <strong>유저 리뷰</strong>
          <small>최근 {reviews.length} / 누적 {state.reviews.feed.length}</small>
        </span>
        <span className="review-panel__open-mark" aria-hidden="true">↗</span>
      </button>
      <div className="review-stream" aria-live="polite">
        {reviews.map((review) => (
          <ReviewEntry review={review} key={review.id} onOpen={openReview} />
        ))}
      </div>
      <MarketPanel />
    </section>
    {selectedReview ? (
      <ReviewDetail
        review={selectedReview}
        onClose={() => setSelectedReview(null)}
        returnFocus={() => detailReturnFocusRef.current}
      />
    ) : null}
    </>
  )
}

export function ReviewHistoryPanel({ onClose }: { onClose: () => void }) {
  const reviews = useGameState().reviews.feed
  const [filter, setFilter] = useState<'all' | ReviewSentiment>('all')
  const [page, setPage] = useState(0)
  const [selectedReview, setSelectedReview] = useState<ReviewFeedEntry | null>(null)
  const detailReturnFocusRef = useRef<HTMLButtonElement | null>(null)
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

  function openReview(review: ReviewFeedEntry, trigger: HTMLButtonElement) {
    detailReturnFocusRef.current = trigger
    setSelectedReview(review)
  }

  return (
    <>
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
          visible.map((review) => (
            <ReviewEntry review={review} key={review.id} onOpen={openReview} />
          ))
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
    {selectedReview ? (
      <ReviewDetail
        review={selectedReview}
        onClose={() => setSelectedReview(null)}
        returnFocus={() => detailReturnFocusRef.current}
      />
    ) : null}
    </>
  )
}
