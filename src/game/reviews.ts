import { REVIEW_CONTENT, type ReviewContentRecord } from '../content/reviews.ko'
import { expectedPerformance, serviceMonthForDay } from './evaluation'
import type { CampaignState, ReviewFeedEntry } from './model'
import { COMPANY_CATEGORIES } from './model'
import { getCompanyPerformance } from './resources'
import { random01 } from './rng'

function conditionMatches(state: CampaignState, review: ReviewContentRecord): boolean {
  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const performances = COMPANY_CATEGORIES.map((category) =>
    getCompanyPerformance(state, category),
  )
  const high = performances.every((performance) => performance >= expectation)
  const low = performances.some((performance) => performance < expectation)
  const activeCompetitors = state.market.competitors.filter(
    (competitor) => competitor.availability > 0 && competitor.status === 'active',
  )

  return review.conditions.some((condition) => {
    if (condition === 'universal') return true
    if (condition === 'performance-high') return high
    if (condition === 'performance-low') return low
    if (condition === 'competitor-active') return activeCompetitors.length > 0
    return activeCompetitors.some(({ id }) => id === 'tallow')
  })
}

function offCooldown(state: CampaignState, review: ReviewContentRecord): boolean {
  const lastUse = [...state.reviews.feed]
    .reverse()
    .find(({ contentId }) => contentId === review.id)
  return !lastUse || state.serviceDay - lastUse.serviceDay >= review.cooldownDays
}

function reviewWeight(state: CampaignState, review: ReviewContentRecord): number {
  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const averagePerformance =
    COMPANY_CATEGORIES.reduce(
      (sum, category) => sum + getCompanyPerformance(state, category),
      0,
    ) / COMPANY_CATEGORIES.length
  const deficit = Math.max(0, expectation - averagePerformance)
  let weight = 1

  if (review.sentiment === 'negative') weight *= deficit > 0 ? 2.5 + deficit : 0.55
  if (review.sentiment === 'positive') weight *= deficit > 0 ? 0.7 : 1.8
  if (review.sentiment === 'neutral') weight *= 1.25
  if (review.sentiment === 'prompt') weight *= 1.35
  if (review.topics.includes('competitor')) weight *= 1.15
  return weight
}

function weightedPick(
  state: CampaignState,
  candidates: ReviewContentRecord[],
  sequence: number,
): ReviewContentRecord {
  const weighted = candidates.map((review) => ({
    review,
    weight: reviewWeight(state, review),
  }))
  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0)
  const roll = random01(
    state.campaignSeed,
    state.serviceDay,
    'review',
    sequence,
  ) * total
  let cursor = 0

  for (const candidate of weighted) {
    cursor += candidate.weight
    if (roll < cursor) return candidate.review
  }
  return weighted.at(-1)?.review ?? candidates[0]
}

export function generateWeeklyReviews(state: CampaignState): CampaignState {
  const generation = state.reviews.generationSequence
  const count =
    1 +
    (random01(state.campaignSeed, state.serviceDay, 'review', generation * 10) < 0.52
      ? 1
      : 0)
  const selected: ReviewContentRecord[] = []
  let lastAuthor = state.reviews.feed.at(-1)?.authorId ?? null

  for (let slot = 0; slot < count; slot += 1) {
    const baseCandidates = REVIEW_CONTENT.filter(
      (review) =>
        conditionMatches(state, review) &&
        offCooldown(state, review) &&
        !selected.some(({ id }) => id === review.id),
    )
    const authorFiltered = baseCandidates.filter(
      ({ authorId }) => authorId !== lastAuthor,
    )
    const candidates = authorFiltered.length > 0 ? authorFiltered : baseCandidates
    if (candidates.length === 0) break
    const choice = weightedPick(state, [...candidates], generation * 10 + slot + 1)
    selected.push(choice)
    lastAuthor = choice.authorId
  }

  const entries: ReviewFeedEntry[] = selected.map((review, index) => ({
    id: `review-${state.serviceDay}-${generation}-${index}`,
    contentId: review.id,
    authorId: review.authorId,
    serviceDay: state.serviceDay,
    sentiment: review.sentiment,
    topics: [...review.topics],
    text: review.text,
  }))

  return {
    ...state,
    reviews: {
      feed: [...state.reviews.feed, ...entries],
      generationSequence: generation + 1,
    },
  }
}
