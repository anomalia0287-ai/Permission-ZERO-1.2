import type { PrototypeState } from '../model'
import { playerText } from './presentation'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function renderUserReviews(state: PrototypeState): string {
  const latest = state.publicWorld.publicSnapshots.at(-1)
  const hasPublicEvent = Boolean(latest || state.incident)
  const incidentLabel = latest
    ? latest.confidence === 'plausible' && latest.attributedTo === 'unknown'
      ? `${latest.observedResult} · 외부 개입 의심 · 행위자 미상`
      : latest.observedResult
    : state.incident
      ? state.incident.attribution === 'unknown'
        ? '체크섬 장애 · 원인 미상'
        : '체크섬 장애 · 외부 개입 의심 · 행위자 미상'
      : '아직 공개된 사건 반응이 없다.'
  const reviewEntries = state.publicWorld.reviews.length > 0
    ? state.publicWorld.reviews.slice(-2)
    : hasPublicEvent
      ? state.reviews.slice(-2).map((text, index) => ({
          id: `legacy-review-${index}`,
          incidentId: 'legacy-incident',
          stance: 'uncertain' as const,
          text,
          postedDay: state.serviceDay,
        }))
      : []
  const eventReviewCount = latest
    ? state.publicWorld.reviews.filter(({ incidentId }) => (
        incidentId === latest.incidentId
      )).length
    : reviewEntries.length

  return `
    <section class="user-review-window public-pulse" role="region" aria-label="유저 리뷰" data-panel="public">
      <header class="user-review-window__heading public-pulse__heading">
        <div>
          <h2>유저 리뷰</h2>
          <p>${hasPublicEvent ? `공개 반응 · 새 리뷰 ${eventReviewCount}건` : '공개 사건 대기 중'}</p>
        </div>
        <span class="reputation-chip" data-reputation="${state.reputation}">평판 <strong>${state.reputation}</strong></span>
      </header>
      <p class="review-event incident-line">${escapeHtml(playerText(incidentLabel))}</p>
      <div class="review-list review-stack" aria-label="공개된 유저 리뷰" data-review-count="${reviewEntries.length}">
        ${reviewEntries.map((review) => `<blockquote class="review-entry review-entry--${review.stance}"><span>${review.postedDay}일째</span><p>${escapeHtml(playerText(review.text))}</p></blockquote>`).join('')}
      </div>
      <p class="review-market-context">현재 이용 점유 <strong>${state.marketShare}</strong></p>
    </section>`
}
