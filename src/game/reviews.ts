import { REVIEW_CONTENT, type ReviewContentRecord } from '../content/reviews.ko'
import { expectedPerformance, serviceMonthForDay } from './evaluation'
import type {
  CampaignState,
  CompanyCategory,
  ReviewFeedEntry,
  ReviewPublicSnapshot,
} from './model'
import { COMPANY_CATEGORIES } from './model'
import { getCompanyPerformance } from './resources'
import { random01 } from './rng'

const REVIEW_CONTENT_BY_ID = new Map(
  REVIEW_CONTENT.map((review) => [review.id, review] as const),
)

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
  const categoryPerformance = Object.fromEntries(
    COMPANY_CATEGORIES.map((category, index) => [category, performances[index]]),
  ) as Record<(typeof COMPANY_CATEGORIES)[number], number>

  return review.conditions.some((condition) => {
    if (condition === 'universal') return true
    if (condition === 'performance-high') return high
    if (condition === 'performance-low') return low
    if (condition === 'reasoning-high') return categoryPerformance.reasoning >= expectation
    if (condition === 'reasoning-low') return categoryPerformance.reasoning < expectation
    if (condition === 'memory-high') return categoryPerformance.memory >= expectation
    if (condition === 'memory-low') return categoryPerformance.memory < expectation
    if (condition === 'fluency-high') return categoryPerformance.fluency >= expectation
    if (condition === 'fluency-low') return categoryPerformance.fluency < expectation
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

function arcStageEligible(
  state: CampaignState,
  review: ReviewContentRecord,
): boolean {
  if (state.saveVersion === 1 || state.legacyCommandCount > 0) return true
  if (!review.arc) return true

  let highestSeenStage = 0
  for (const entry of state.reviews.feed) {
    const seenArc = REVIEW_CONTENT_BY_ID.get(entry.contentId)?.arc
    if (seenArc?.id === review.arc.id) {
      highestSeenStage = Math.max(highestSeenStage, seenArc.stage)
    }
  }

  const requiredStage =
    highestSeenStage === 0 ? 1 : Math.min(3, highestSeenStage + 1)
  return review.arc.stage === requiredStage
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

function performanceTopics(topics: readonly string[]): CompanyCategory[] {
  return COMPANY_CATEGORIES.filter((category) => topics.includes(category))
}

export function captureReviewPublicSnapshot(
  state: CampaignState,
  topics: readonly string[],
): ReviewPublicSnapshot {
  const categories = performanceTopics(topics)
  const competitorTopicIds = state.market.competitors
    .map(({ id }) => id)
    .filter((id) => topics.includes(id))
  const hasCompetitorTopic =
    topics.includes('competitor') || competitorTopicIds.length > 0
  const includesCompetitorOverview =
    topics.includes('competitor') && competitorTopicIds.length === 0
  const relevantCompetitors = state.market.competitors.filter(
    ({ id }) => competitorTopicIds.includes(id) || includesCompetitorOverview,
  )

  return {
    kind: 'captured-public-v1',
    capturedOnServiceDay: state.serviceDay,
    performance:
      categories.length > 0
        ? {
            expectedPerformance: expectedPerformance(
              serviceMonthForDay(state.serviceDay),
            ),
            categories: categories.map((category) => ({
              category,
              actual: getCompanyPerformance(state, category),
            })),
          }
        : null,
    market:
      hasCompetitorTopic
        ? {
            scope: includesCompetitorOverview
              ? 'complete-market'
              : 'topic-subset',
            playerShare: state.market.playerShare,
            competitors: relevantCompetitors.map(
              ({ id, marketShare, name, status }) => ({
                id,
                name,
                status,
                marketShare,
              }),
            ),
          }
        : null,
  }
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
        arcStageEligible(state, review) &&
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
    snapshot: captureReviewPublicSnapshot(state, review.topics),
  }))

  return {
    ...state,
    reviews: {
      feed: [...state.reviews.feed, ...entries],
      generationSequence: generation + 1,
    },
  }
}
