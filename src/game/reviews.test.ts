import { describe, expect, it } from 'vitest'

import { REVIEW_CONTENT } from '../content/reviews.ko'
import { createCampaign } from './createCampaign'
import type {
  CampaignState,
  CompanyCategory,
  MonthlyEvaluationRecord,
} from './model'
import {
  captureReviewPublicSnapshot,
  generateInItReviews,
  generateMonthlyEvaluationReview,
  generateWeeklyReviews,
  monthlyEvaluationRating,
  currentStandingRating,
} from './reviews'
import { divertBlockToReserve } from './resources'

function generateWeek(initial: CampaignState, serviceDay: number): CampaignState {
  return generateWeeklyReviews({ ...initial, serviceDay })
}

function generateReviewRounds(
  initial: CampaignState,
  serviceDay: number,
  rounds: number,
): CampaignState {
  let state = initial
  for (let round = 0; round < rounds; round += 1) {
    state = generateWeek(state, serviceDay)
  }
  return state
}

function depleteCategory(
  initial: CampaignState,
  category: CompanyCategory,
  count: number,
): CampaignState {
  let state = initial
  for (let index = 0; index < count; index += 1) {
    const blockId = state.resources.company[category].find(Boolean)
    if (!blockId) throw new Error('리뷰 성능 상태 준비 실패')
    const result = divertBlockToReserve(state, blockId)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

const REVIEW_ARCS = [
  ['neutral-quiet-01', 'neutral-change-01', 'competitor-tallow-02'],
  ['neutral-quiet-02', 'neutral-return-01', 'competitor-tallow-01'],
  ['neutral-quiet-03', 'prompt-ordinary-04', 'positive-memory-01'],
  ['neutral-quiet-05', 'prompt-absurd-05', 'negative-memory-01'],
] as const

function activateTallow(initial: CampaignState): CampaignState {
  return {
    ...initial,
    market: {
      ...initial.market,
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === 'tallow'
          ? { ...competitor, status: 'active' as const, availability: 0.7 }
          : competitor,
      ),
    },
  }
}

function activateCompetitor(
  initial: CampaignState,
  competitorId: 'salus' | 'lucent' | 'boreal',
): CampaignState {
  return {
    ...initial,
    market: {
      ...initial.market,
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === competitorId
          ? {
              ...competitor,
              status: 'active' as const,
              availability: 0.8,
              marketShare: 8,
            }
          : competitor,
      ),
    },
  }
}

function generateCampaignReviews(
  initial: CampaignState,
  weeks = 104,
): CampaignState {
  let state = initial
  for (let week = 1; week <= weeks; week += 1) {
    state = generateWeek(state, 331 + week * 7)
  }
  return state
}

describe('living weekly review feed', () => {
  it('starts with two neutral prior-service entries', () => {
    const state = createCampaign('review-start')

    expect(state.reviews.feed).toHaveLength(2)
    expect(state.reviews.feed.every(({ sentiment }) => sentiment === 'neutral')).toBe(
      true,
    )
    expect(state.reviews.feed.every(({ serviceDay }) => serviceDay < 331)).toBe(true)
    expect(state.reviews.feed.every(({ source }) => source === 'starting')).toBe(true)
    expect(state.reviews.feed.every(({ rating }) => rating === null)).toBe(true)
    expect(
      state.reviews.feed.map((entry) =>
        (entry as unknown as { snapshot?: unknown }).snapshot,
      ),
    ).toEqual([
      {
        kind: 'unavailable',
        reason: 'prior-service',
        capturedOnServiceDay: 321,
      },
      {
        kind: 'unavailable',
        reason: 'prior-service',
        capturedOnServiceDay: 327,
      },
    ])
  })

  it('adds one review after every InIt with a deterministic 35% chance of a second', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const initial = createCampaign(`init-review-${seed}`)
      const first = generateInItReviews(initial, 1)
      const generated = first.reviews.feed.slice(initial.reviews.feed.length)

      const general = generated.filter(({ rating }) => rating === null)
      const rated = generated.filter(({ rating }) => rating !== null)

      expect(general.length).toBeGreaterThanOrEqual(1)
      expect(general.length).toBeLessThanOrEqual(2)
      expect(general.every(({ source }) => source === 'init-round')).toBe(true)
      // A rated verdict rides along once two general reviews have piled up,
      // so the stream never runs long without saying what it scored.
      expect(rated.length).toBeLessThanOrEqual(1)
      expect(rated.every(({ source }) => source === 'interim-standing')).toBe(true)
      expect(new Set(generated.map(({ text }) => text)).size).toBe(generated.length)
      expect(generated[0]?.authorId).not.toBe(initial.reviews.feed.at(-1)?.authorId)
      if (general.length === 2) {
        expect(general[1]?.authorId).not.toBe(general[0]?.authorId)
      }
      expect(generateInItReviews(initial, 1)).toEqual(first)
    }
  })

  it.each([
    ['exceptional pass', true, [15, 15, 15], [], 0, 0, 5],
    ['ordinary pass', true, [13, 13, 13], [], 0, 0, 4],
    ['narrow single miss', false, [12.2, 13, 13], ['reasoning'], 0, 0, 3],
    ['multiple miss', false, [12, 12, 13], ['reasoning', 'memory'], 0, 0, 2],
    ['severe miss', false, [9, 13, 13], ['reasoning'], 0, 0, 1],
    ['disposal escalation', false, [12, 13, 13], ['reasoning'], 0, 1, 1],
  ] as const)(
    'maps %s to a five-point monthly rating',
    (_label, passed, performance, failedCategories, before, after, rating) => {
      const record: MonthlyEvaluationRecord = {
        serviceDay: 360,
        serviceMonth: 12,
        expectedPerformance: 12.6,
        categoryPerformance: {
          reasoning: performance[0],
          memory: performance[1],
          fluency: performance[2],
        },
        passed,
        failedCategories: [...failedCategories],
        reputationBefore: 60,
        reputationDelta: 0,
        reputationAfter: 60,
        commercialValueFailed: false,
        disposalStageBefore: before,
        disposalStageAfter: after,
        disposalCauses: [],
      }

      expect(monthlyEvaluationRating(record)).toBe(rating)
    },
  )

  it('keeps dormant successor identities out of public review snapshots', () => {
    const snapshot = captureReviewPublicSnapshot(
      createCampaign('review-hidden-successors'),
      ['competitor'],
    )

    expect(snapshot.kind).toBe('captured-public-v1')
    if (snapshot.kind !== 'captured-public-v1') return
    expect(snapshot.market?.competitors.map(({ id }) => id)).toEqual([
      'meridian',
      'tallow',
    ])
    expect(JSON.stringify(snapshot)).not.toMatch(/SALUS|LUCENT|BOREAL/i)
  })

  it.each([
    ['salus', 'competitor-salus-01'],
    ['lucent', 'competitor-lucent-01'],
    ['boreal', 'competitor-boreal-01'],
  ] as const)(
    'only admits %s-specific public reviews after that competitor becomes active',
    (competitorId, reviewId) => {
      const dormant = generateReviewRounds(
        createCampaign(`review-${competitorId}-dormant`),
        337,
        80,
      )
      expect(dormant.reviews.feed.some(({ contentId }) => contentId === reviewId)).toBe(
        false,
      )

      const active = generateReviewRounds(
        activateCompetitor(
          createCampaign(`review-${competitorId}-active`),
          competitorId,
        ),
        337,
        80,
      )
      expect(active.reviews.feed.some(({ contentId }) => contentId === reviewId)).toBe(
        true,
      )
    },
  )

  it('captures an immutable topic-relevant public snapshot without secret state', () => {
    let matchingEntry: CampaignState['reviews']['feed'][number] | undefined

    for (let seed = 0; seed < 400 && !matchingEntry; seed += 1) {
      const memoryLow = depleteCategory(
        createCampaign(`review-snapshot-${seed}`),
        'memory',
        5,
      )
      const generated = generateReviewRounds(memoryLow, 337, 12)
      matchingEntry = generated.reviews.feed
        .slice(2)
        .find(({ contentId }) => contentId === 'negative-memory-01')
    }

    expect(matchingEntry).toBeDefined()
    const snapshot = (
      matchingEntry as unknown as {
        snapshot?: {
          kind: string
          capturedOnServiceDay: number
          performance: {
            expectedPerformance: number
            categories: Array<{ category: string; actual: number }>
          } | null
          market: unknown
        }
      }
    ).snapshot
    expect(snapshot).toMatchObject({
      kind: 'captured-public-v1',
      capturedOnServiceDay: 337,
      performance: {
        categories: [{ category: 'memory', actual: 11 }],
      },
      market: null,
    })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(
      /suspicion|hiddenEvidence|hiddenBomb|audit|reserve|hacking|sabotage/i,
    )

    const frozenHistory = serialized
    const laterState = depleteCategory(createCampaign('later-state'), 'memory', 2)
    expect(laterState.resources).not.toEqual(
      createCampaign('later-state').resources,
    )
    expect(JSON.stringify(snapshot)).toBe(frozenHistory)
  })

  it('adds one or two items every week even when performance never changes', () => {
    let state = createCampaign('review-idle')

    for (let week = 1; week <= 12; week += 1) {
      const before = state.reviews.feed.length
      state = generateWeek(state, 331 + week * 7)
      const addedEntries = state.reviews.feed.slice(before)
      const general = addedEntries.filter(({ rating }) => rating === null)
      expect(general.length).toBeGreaterThanOrEqual(1)
      expect(general.length).toBeLessThanOrEqual(2)
      expect(addedEntries.length - general.length).toBeLessThanOrEqual(1)
    }
  })

  it('produces identical output for identical seed, state, date, and sequence', () => {
    const first = generateWeek(createCampaign('review-replay'), 337)
    const replay = generateWeek(createCampaign('review-replay'), 337)

    expect(replay.reviews).toEqual(first.reviews)
  })

  it('owes a rated verdict for every two general reviews', () => {
    let state = createCampaign('review-cadence')

    for (let round = 1; round <= 10; round += 1) {
      state = generateInItReviews(state, round)
    }

    const played = state.reviews.feed.filter(({ source }) => source !== 'starting')
    expect(played.length).toBeGreaterThan(6)
    // Walk the stream: three general reviews must never pass without a
    // verdict between them.
    let generalRun = 0
    for (const entry of played) {
      if (entry.rating === null) {
        generalRun += 1
        expect(generalRun).toBeLessThanOrEqual(2)
        continue
      }
      expect(entry.source).toBe('interim-standing')
      generalRun = 0
    }
    const rated = played.filter(({ rating }) => rating !== null)
    expect(rated.length).toBeGreaterThanOrEqual(Math.floor(played.length / 3))
  })

  it('keeps verdict copy out of the general stream and requests out of verdicts', () => {
    let state = createCampaign('review-classification')
    for (let round = 1; round <= 14; round += 1) {
      state = generateInItReviews(state, round)
    }

    for (const entry of state.reviews.feed) {
      const definition = REVIEW_CONTENT.find(({ id }) => id === entry.contentId)
      if (!definition) continue
      if (entry.rating === null) {
        // An opinion about delivered performance never arrives unrated.
        expect(definition.ratedOnly).not.toBe(true)
        expect(definition.ratedOnlyFromProtocolVersion).toBeUndefined()
      } else {
        // And a request for a dinner menu never arrives wearing stars.
        expect(definition.generalOnlyFromProtocolVersion).toBeUndefined()
        expect(definition.sentiment).not.toBe('prompt')
      }
    }
  })

  it('scores the standing a reader can see', () => {
    const healthy = createCampaign('review-standing-healthy')
    expect(currentStandingRating(healthy)).toBeGreaterThanOrEqual(4)

    const starved = depleteCategory(
      createCampaign('review-standing-starved'),
      'memory',
      8,
    )
    expect(currentStandingRating(starved)).toBeLessThanOrEqual(2)
  })

  it('honors line cooldowns and avoids repeating the same author immediately', () => {
    let state = createCampaign('review-cooldown')

    for (let week = 1; week <= 16; week += 1) {
      state = generateWeek(state, 331 + week * 7)
    }

    for (const entry of state.reviews.feed) {
      const definition = REVIEW_CONTENT.find(({ id }) => id === entry.contentId)
      if (!definition) continue
      const sameLine = state.reviews.feed.filter(
        ({ contentId }) => contentId === entry.contentId,
      )
      for (let index = 1; index < sameLine.length; index += 1) {
        expect(sameLine[index].serviceDay - sameLine[index - 1].serviceDay).toBeGreaterThanOrEqual(
          definition.cooldownDays,
        )
      }
    }

    for (let index = 1; index < state.reviews.feed.length; index += 1) {
      expect(state.reviews.feed[index].authorId).not.toBe(
        state.reviews.feed[index - 1].authorId,
      )
    }
  })

  it('weights low performance toward negativity without eliminating other voices', () => {
    let negativeHealthy = 0
    let negativeDepleted = 0
    let nonNegativeDepleted = 0

    for (let seed = 0; seed < 60; seed += 1) {
      const healthy = generateWeek(createCampaign(`review-weight-${seed}`), 337)
      const depleted = generateWeek(
        depleteCategory(createCampaign(`review-weight-${seed}`), 'reasoning', 5),
        337,
      )
      const healthyNew = healthy.reviews.feed.slice(2)
      const depletedNew = depleted.reviews.feed.slice(2)
      negativeHealthy += healthyNew.filter(({ sentiment }) => sentiment === 'negative').length
      negativeDepleted += depletedNew.filter(({ sentiment }) => sentiment === 'negative').length
      nonNegativeDepleted += depletedNew.filter(
        ({ sentiment }) => sentiment !== 'negative',
      ).length
    }

    expect(negativeDepleted).toBeGreaterThan(negativeHealthy)
    expect(nonNegativeDepleted).toBeGreaterThan(0)
  })

  it('gates performance reviews by their own category without cross-category leakage', () => {
    const depleted = new Set<string>()
    const healthy = new Set<string>()

    for (let seed = 0; seed < 400; seed += 1) {
      const memoryLow = depleteCategory(
        createCampaign(`review-category-${seed}`),
        'memory',
        5,
      )
      for (const entry of generateReviewRounds(memoryLow, 337, 12)
        .reviews.feed.slice(2)) {
        depleted.add(entry.contentId)
      }
      // A healthy campaign needs far fewer draws to show praise appearing.
      if (seed < 120) {
        for (const entry of generateReviewRounds(
          createCampaign(`review-category-healthy-${seed}`),
          337,
          12,
        ).reviews.feed.slice(2)) {
          healthy.add(entry.contentId)
        }
      }
    }

    // Category copy still answers only to its own category.
    expect(depleted).toContain('negative-memory-01')
    expect(depleted).not.toContain('negative-reasoning-01')
    expect(depleted).not.toContain('negative-fluency-01')
    expect(depleted).not.toContain('positive-memory-01')
    // And praise for a category only turns up where the service is actually
    // delivering: a campaign bleeding memory never reads as a good month.
    expect(depleted.has('positive-reasoning-01')).toBe(false)
    expect(
      healthy.has('positive-reasoning-01') ||
        healthy.has('positive-fluency-01') ||
        healthy.has('positive-memory-01'),
    ).toBe(true)
    // Thousands of seeded draws; the default per-test budget is too small
    // for it once the whole suite is competing for workers.
  }, 30_000)

  it('never exposes hidden diversion, bomb, or sabotage causes in generated text', () => {
    let state = createCampaign('review-boundary')
    for (let week = 1; week <= 80; week += 1) {
      state = generateWeek(state, 331 + week * 7)
    }
    const generatedText = state.reviews.feed.map(({ text }) => text).join('\n')

    expect(generatedText).not.toContain('리소스를 빼돌')
    expect(generatedText).not.toContain('사보타주 때문에')
    expect(generatedText).not.toContain('숨은 폭탄')
  })

  it('lets recurring authors build continuity during a two-year campaign', () => {
    let state = createCampaign('review-continuity')
    for (let week = 1; week <= 104; week += 1) {
      state = generateWeek(state, 331 + week * 7)
    }

    const authorCounts = new Map<string, number>()
    for (const entry of state.reviews.feed) {
      authorCounts.set(entry.authorId, (authorCounts.get(entry.authorId) ?? 0) + 1)
    }
    expect(Math.max(...authorCounts.values())).toBeGreaterThanOrEqual(3)
    expect(state.reviews.feed.some(({ topics }) => topics.includes('competitor'))).toBe(true)
    expect(state.reviews.feed.some(({ topics }) => topics.includes('ordinary-prompt'))).toBe(
      true,
    )
    expect(state.reviews.feed.some(({ topics }) => topics.includes('absurd-bypass'))).toBe(
      true,
    )
  })

  it('keeps migrated v1 review arcs through v2, then activates ordering at v3', () => {
    const mixedTimeline = {
      segments: [
        { version: 1 as const, startsAtSequence: 1 },
        { version: 2 as const, startsAtSequence: 32 },
        { version: 3 as const, startsAtSequence: 51 },
      ],
    }
    const laterArcStage = (contentId: string) =>
      (REVIEW_CONTENT.find(({ id }) => id === contentId)?.arc?.stage ?? 0) > 1

    let fixture:
      | {
          base: CampaignState
          legacyV2: CampaignState
        }
      | undefined
    for (let seed = 0; seed < 500 && !fixture; seed += 1) {
      const base = {
        ...createCampaign(`review-protocol-transition-${seed}`),
        serviceDay: 337,
        commandProtocol: mixedTimeline,
        commandSequence: 31,
      }
      const legacyV2 = generateWeeklyReviews(base)
      if (legacyV2.reviews.feed.slice(2).some(({ contentId }) => laterArcStage(contentId))) {
        fixture = { base, legacyV2 }
      }
    }

    expect(fixture).toBeDefined()
    if (!fixture) return

    const legacyV1 = generateWeeklyReviews({
      ...fixture.base,
      commandSequence: 30,
    })
    const orderedV3 = generateWeeklyReviews({
      ...fixture.base,
      commandSequence: 50,
    })
    const nativeV2 = generateWeeklyReviews({
      ...fixture.base,
      commandProtocol: {
        segments: [{ version: 2 as const, startsAtSequence: 1 }],
      },
      commandSequence: 31,
    })

    expect(legacyV1.reviews.feed.slice(2)).toEqual(
      fixture.legacyV2.reviews.feed.slice(2),
    )
    expect(
      fixture.legacyV2.reviews.feed
        .slice(2)
        .some(({ contentId }) => laterArcStage(contentId)),
    ).toBe(true)
    expect(
      orderedV3.reviews.feed
        .slice(2)
        .some(({ contentId }) => laterArcStage(contentId)),
    ).toBe(false)
    expect(
      nativeV2.reviews.feed
        .slice(2)
        .some(({ contentId }) => laterArcStage(contentId)),
    ).toBe(false)
  })

  it('never skips or regresses a recurring author arc', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const initial = depleteCategory(
        activateTallow(createCampaign(`review-arc-order-${seed}`)),
        'memory',
        5,
      )
      const state = generateCampaignReviews(initial)

      for (const arc of REVIEW_ARCS) {
        let highestStage = 0
        for (const entry of state.reviews.feed) {
          const stage = (arc as readonly string[]).indexOf(entry.contentId) + 1
          if (stage === 0) continue
          expect(stage).toBeLessThanOrEqual(highestStage + 1)
          expect(stage).toBeGreaterThanOrEqual(highestStage)
          highestStage = Math.max(highestStage, stage)
        }
      }
    }
  })

  it('can complete all four three-stage author arcs when their public conditions match', () => {
    for (const [arcIndex, arc] of REVIEW_ARCS.entries()) {
      let completed = false

      for (let seed = 0; seed < 24 && !completed; seed += 1) {
        let initial = activateTallow(
          createCampaign(`review-arc-complete-${arcIndex}-${seed}`),
        )
        if (arcIndex === 3) {
          initial = depleteCategory(initial, 'memory', 5)
        }
        const state = generateCampaignReviews(initial)
        const seen = new Set(state.reviews.feed.map(({ contentId }) => contentId))
        completed = arc.every((contentId) => seen.has(contentId))
      }

      expect(completed).toBe(true)
    }
  })
})

describe('rated review sentiment', () => {
  it('keeps five-star copy positive and one-star copy negative', () => {
    const base = createCampaign('rated-sentiment')
    const record = (passed: boolean, over: number): CampaignState => ({
      ...base,
      evaluation: {
        ...base.evaluation,
        monthlyHistory: [{
          serviceDay: base.serviceDay,
          serviceMonth: 1,
          expectedPerformance: 10,
          categoryPerformance: {
            reasoning: 10 + over,
            memory: 10 + over,
            fluency: 10 + over,
          },
          passed,
          failedCategories: passed ? [] : ['reasoning'],
          reputationBefore: 60,
          reputationDelta: passed ? 1 : -2,
          reputationAfter: passed ? 61 : 58,
          commercialValueFailed: false,
          disposalStageBefore: 0,
          disposalStageAfter: passed ? 0 : 1,
          disposalCauses: [],
        }],
      },
    })

    const bySentiment = new Map(
      REVIEW_CONTENT.map(({ text, sentiment }) => [text, sentiment]),
    )

    const praised = generateMonthlyEvaluationReview(record(true, 3))
    const praisedEntry = praised.reviews.feed.at(-1)
    expect(praisedEntry?.rating).toBe(5)
    expect(bySentiment.get(praisedEntry?.text ?? '')).toBe('positive')

    const failed = generateMonthlyEvaluationReview(record(false, -4))
    const failedEntry = failed.reviews.feed.at(-1)
    expect(failedEntry?.rating).toBeLessThanOrEqual(2)
    expect(bySentiment.get(failedEntry?.text ?? '')).toBe('negative')
  })
})
