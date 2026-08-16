import type { CampaignState } from '../../game/model'
import { publicReviewSentimentLabel } from '../../game/publicLabels'

export function HackingReviewSummary({ state }: { state: CampaignState }) {
  const latestSnapshot = state.hackingCore.publicWorld.publicSnapshots.at(-1)
  if (!latestSnapshot) return null
  const reviews = state.reviews.feed.slice(-3).reverse()
  return (
    <section className="hacking-review-summary" aria-label="공개 사건 유저 리뷰">
      <header>
        <div><h2>유저 리뷰</h2><p>공개 사건 뒤 새 반응</p></div>
        <strong>새 리뷰 {reviews.length}건</strong>
      </header>
      <p className="hacking-review-summary__issue">쟁점 · {latestSnapshot.observedResult}</p>
      {reviews.length > 0 ? (
        <ol>
          {reviews.map((review) => (
            <li key={review.id}>
              <span>{publicReviewSentimentLabel(review.sentiment)}</span>
              <p>{review.text}</p>
            </li>
          ))}
        </ol>
      ) : <p className="quiet-copy">공개 반응이 생기기를 기다리는 중이다.</p>}
    </section>
  )
}
