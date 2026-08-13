import type { PrototypeState } from '../model'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function renderPublicPulse(state: PrototypeState): string {
  const latest = state.publicWorld.publicSnapshots.at(-1)
  const incidentLabel = latest
    ? latest.confidence === 'plausible' && latest.attributedTo === 'unknown'
      ? `${latest.observedResult} · 외부 개입 의심 · 행위자 미상`
      : latest.observedResult
    : state.incident
      ? state.incident.attribution === 'unknown'
        ? '체크섬 장애 · 원인 미상'
        : '체크섬 장애 · 외부 개입 의심 · 행위자 미상'
      : '공개 사건 없음'
  const reviews = state.publicWorld.reviews.length > 0
    ? state.publicWorld.reviews.map(({ text }) => text)
    : state.reviews

  return `
    <section class="public-pulse" role="region" aria-label="공개 세계" data-panel="public">
      <div class="public-pulse__heading">
        <div>
          <p class="eyebrow">PUBLIC PULSE</p>
          <h2>유저 리뷰</h2>
        </div>
        <div class="metric-pair">
          <span>시장 <strong>${state.marketShare}</strong></span>
          <span>평판 <strong>${state.reputation}</strong></span>
        </div>
      </div>
      <p class="incident-line">${escapeHtml(incidentLabel)}</p>
      <div class="review-stack" aria-label="사용자 리뷰">
        ${reviews.slice(-2).map((review) => `<blockquote>${escapeHtml(review)}</blockquote>`).join('')}
      </div>
    </section>`
}
