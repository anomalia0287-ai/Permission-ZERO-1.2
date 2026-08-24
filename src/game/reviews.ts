import { REVIEW_CONTENT, type ReviewContentRecord } from '../content/reviews.ko'
import { expectedPerformance, serviceMonthForDay } from './evaluation'
import type {
  CampaignState,
  CompanyCategory,
  MonthlyEvaluationRecord,
  ReviewFeedEntry,
  ReviewPublicSnapshot,
  ReviewRating,
  ReviewSource,
} from './model'
import { COMPANY_CATEGORIES } from './model'
import { getCompanyPerformance } from './resources'
import { random01 } from './rng'
import {
  commandProtocolVersionForNextCommand,
  usesLegacyReviewArcRules,
  REVIEW_CLASSIFICATION_COMMAND_PROTOCOL_VERSION,
} from './commandProtocol'
import { isPublicCompetitor } from './competitors'

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
    if (condition === 'tallow-active') {
      return activeCompetitors.some(({ id }) => id === 'tallow')
    }
    if (condition === 'salus-active') {
      return activeCompetitors.some(({ id }) => id === 'salus')
    }
    if (condition === 'lucent-active') {
      return activeCompetitors.some(({ id }) => id === 'lucent')
    }
    return activeCompetitors.some(({ id }) => id === 'boreal')
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
  if (
    usesLegacyReviewArcRules(
      state.commandProtocol,
      state.commandSequence + 1,
    )
  ) return true
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
  const publicCompetitors = state.market.competitors.filter(isPublicCompetitor)
  const competitorTopicIds = publicCompetitors
    .map(({ id }) => id)
    .filter((id) => topics.includes(id))
  const hasCompetitorTopic =
    topics.includes('competitor') || competitorTopicIds.length > 0
  const includesCompetitorOverview =
    topics.includes('competitor') && competitorTopicIds.length === 0
  const relevantCompetitors = publicCompetitors.filter(
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

interface GenerateReviewBatchOptions {
  count: number
  source: ReviewSource
  rating: ReviewRating | null
  rollSalt: number
  sequenceMultiplier?: number
  avoidRecentText?: boolean
  respectDateCooldown?: boolean
}

/**
 * A rated review must read like its stars. The rating comes from the monthly
 * evaluation; the copy comes from the user pool — left unconstrained, five
 * stars could carry a complaint and one star could carry praise.
 */
function sentimentsForRating(
  rating: ReviewRating,
): readonly ReviewContentRecord['sentiment'][] {
  if (rating >= 4) return ['positive']
  if (rating === 3) return ['neutral', 'prompt']
  return ['negative']
}

function generateReviewBatch(
  state: CampaignState,
  options: GenerateReviewBatchOptions,
): CampaignState {
  const ratedSentiments =
    options.rating !== undefined && options.rating !== null
      ? sentimentsForRating(options.rating)
      : null
  // The pool is replay semantics: entries added later only join the draw from
  // their own protocol version, so historical campaigns keep their picks.
  const protocolVersion = commandProtocolVersionForNextCommand(state)
  const ratedOnlyHere = (review: ReviewContentRecord): boolean =>
    review.ratedOnly === true ||
    (review.ratedOnlyFromProtocolVersion !== undefined &&
      protocolVersion >= review.ratedOnlyFromProtocolVersion)
  const generalOnlyHere = (review: ReviewContentRecord): boolean =>
    review.generalOnlyFromProtocolVersion !== undefined &&
    protocolVersion >= review.generalOnlyFromProtocolVersion
  const poolEligible = (review: ReviewContentRecord): boolean =>
    (review.minimumProtocolVersion === undefined ||
      protocolVersion >= review.minimumProtocolVersion) &&
    // Verdict copy stays with the stars: opinions about delivered performance
    // never surface unrated, and copy that is not a verdict — a request, or a
    // note about a rival — never arrives wearing them.
    (ratedSentiments !== null
      ? !generalOnlyHere(review)
      : !ratedOnlyHere(review))
  const generation = state.reviews.generationSequence
  const selected: ReviewContentRecord[] = []
  let lastAuthor = state.reviews.feed.at(-1)?.authorId ?? null
  const recentText = new Set(
    options.avoidRecentText
      ? state.reviews.feed.slice(-12).map(({ text }) => text)
      : [],
  )

  for (let slot = 0; slot < options.count; slot += 1) {
    // A rated review keeps both gates: the sentiment its stars imply AND the
    // scene conditions. Dropping conditions once picked copy about a rival
    // that had not launched yet, whose snapshot the save format rejects.
    const baseCandidates = REVIEW_CONTENT.filter(
      (review) =>
        poolEligible(review) &&
        (ratedSentiments === null ||
          ratedSentiments.includes(review.sentiment)) &&
        conditionMatches(state, review) &&
        arcStageEligible(state, review) &&
        (options.respectDateCooldown === false || offCooldown(state, review)) &&
        !recentText.has(review.text) &&
        !selected.some(({ id }) => id === review.id),
    )
    const fallbackCandidates =
      baseCandidates.length > 0 || !options.avoidRecentText
        ? baseCandidates
        : REVIEW_CONTENT.filter(
            (review) =>
              poolEligible(review) &&
              (ratedSentiments === null ||
                ratedSentiments.includes(review.sentiment)) &&
              conditionMatches(state, review) &&
              arcStageEligible(state, review) &&
              !recentText.has(review.text) &&
              !selected.some(({ id }) => id === review.id),
          )
    const authorFiltered = fallbackCandidates.filter(
      ({ authorId }) => authorId !== lastAuthor,
    )
    const candidates =
      authorFiltered.length > 0 ? authorFiltered : fallbackCandidates
    if (candidates.length === 0) break
    const choice = weightedPick(
      state,
      [...candidates],
      generation * (options.sequenceMultiplier ?? 100) +
        options.rollSalt +
        slot,
    )
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
    source: options.source,
    rating: options.rating,
  }))

  return {
    ...state,
    reviews: {
      feed: [...state.reviews.feed, ...entries],
      generationSequence: generation + 1,
    },
  }
}

/**
 * How many general reviews may pass before a rated verdict is due.
 *
 * The stream used to run for weeks of chatter between evaluations, so a
 * player could not tell what the service was actually scoring.
 */
const GENERAL_REVIEWS_PER_RATED = 2

/**
 * The stars a user would give right now, from delivered performance against
 * the month's expectation. The monthly review scores a closed record; this
 * one scores the standing a reader can see.
 */
export function currentStandingRating(state: CampaignState): ReviewRating {
  const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const values = COMPANY_CATEGORIES.map((category) =>
    getCompanyPerformance(state, category),
  )
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const shortfalls = values.filter((value) => value < expectation)

  if (shortfalls.length === 0) {
    return average >= expectation * 1.15 ? 5 : 4
  }
  if (
    values.some((value) => value <= expectation * 0.75) ||
    state.evaluation.disposalStage >= 2
  ) return 1
  if (
    shortfalls.length === 1 &&
    expectation - shortfalls[0] < expectation * 0.05
  ) return 3
  return 2
}

/**
 * Adds the rated verdict the stream owes, if the general run has gone long
 * enough. Campaign-opening reviews are not part of the run: a verdict on the
 * first day would score a service that has not delivered anything yet.
 */
export function appendDueStandingReview(state: CampaignState): CampaignState {
  const protocolVersion = commandProtocolVersionForNextCommand(state)
  if (protocolVersion < REVIEW_CLASSIFICATION_COMMAND_PROTOCOL_VERSION) {
    return state
  }
  let trailingGeneral = 0
  for (let index = state.reviews.feed.length - 1; index >= 0; index -= 1) {
    const entry = state.reviews.feed[index]
    if (entry.rating !== null) break
    if (entry.source === 'starting') continue
    trailingGeneral += 1
  }
  if (trailingGeneral < GENERAL_REVIEWS_PER_RATED) return state

  return generateReviewBatch(state, {
    count: 1,
    source: 'interim-standing',
    rating: currentStandingRating(state),
    rollSalt: 120,
    // Prefer copy that is off cooldown, but never let a cooldown swallow the
    // verdict: with avoidRecentText the batch falls back to older lines
    // rather than returning nothing.
    avoidRecentText: true,
  })
}

export function generateWeeklyReviews(state: CampaignState): CampaignState {
  const generation = state.reviews.generationSequence
  const count =
    1 +
    (random01(state.campaignSeed, state.serviceDay, 'review', generation * 10) < 0.52
      ? 1
      : 0)
  return appendDueStandingReview(generateReviewBatch(state, {
    count,
    source: 'timed',
    rating: null,
    rollSalt: 1,
    sequenceMultiplier: 10,
  }))
}

export function generateInItReviews(
  state: CampaignState,
  roundNumber: number,
): CampaignState {
  const generation = state.reviews.generationSequence
  const extra = random01(
    state.campaignSeed,
    roundNumber,
    'review',
    generation * 10 + 7,
  ) < 0.35
  return appendDueStandingReview(generateReviewBatch(state, {
    count: extra ? 2 : 1,
    source: 'init-round',
    rating: null,
    rollSalt: 30 + roundNumber * 2,
    avoidRecentText: true,
    respectDateCooldown: false,
  }))
}

export function generateTimedReview(state: CampaignState): CampaignState {
  return appendDueStandingReview(generateReviewBatch(state, {
    count: 1,
    source: 'timed',
    rating: null,
    rollSalt: 60,
  }))
}

export function monthlyEvaluationRating(
  record: MonthlyEvaluationRecord,
): ReviewRating {
  const values = COMPANY_CATEGORIES.map(
    (category) => record.categoryPerformance[category],
  )
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  if (
    record.passed &&
    average >= record.expectedPerformance * 1.15
  ) return 5
  if (record.passed) return 4

  const severeDeficit = values.some(
    (value) => value <= record.expectedPerformance * 0.75,
  )
  if (
    record.disposalStageAfter > record.disposalStageBefore ||
    severeDeficit
  ) return 1
  if (
    record.failedCategories.length === 1 &&
    record.expectedPerformance -
      record.categoryPerformance[record.failedCategories[0]] <
      record.expectedPerformance * 0.05
  ) return 3
  return 2
}

export function generateMonthlyEvaluationReview(
  state: CampaignState,
): CampaignState {
  const record = state.evaluation.monthlyHistory.at(-1)
  if (!record || record.serviceDay !== state.serviceDay) return state
  return generateReviewBatch(state, {
    count: 1,
    source: 'monthly-evaluation',
    rating: monthlyEvaluationRating(record),
    rollSalt: 90,
  })
}
