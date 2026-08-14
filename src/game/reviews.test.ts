import { describe, expect, it } from 'vitest'

import { REVIEW_CONTENT } from '../content/reviews.ko'
import { createCampaign } from './createCampaign'
import type { CampaignState, CompanyCategory } from './model'
import { generateWeeklyReviews } from './reviews'
import { divertBlock } from './resources'

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
    const destination = state.resources.reserve.findIndex((id) => id === null)
    if (!blockId || destination < 0) throw new Error('리뷰 성능 상태 준비 실패')
    const result = divertBlock(state, blockId, destination)
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
      const added = state.reviews.feed.length - before
      expect(added).toBeGreaterThanOrEqual(1)
      expect(added).toBeLessThanOrEqual(2)
    }
  })

  it('produces identical output for identical seed, state, date, and sequence', () => {
    const first = generateWeek(createCampaign('review-replay'), 337)
    const replay = generateWeek(createCampaign('review-replay'), 337)

    expect(replay.reviews).toEqual(first.reviews)
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
    const selected = new Set<string>()

    for (let seed = 0; seed < 400; seed += 1) {
      const memoryLow = depleteCategory(
        createCampaign(`review-category-${seed}`),
        'memory',
        5,
      )
      const generated = generateReviewRounds(memoryLow, 337, 12)
      for (const entry of generated.reviews.feed.slice(2)) {
        selected.add(entry.contentId)
      }
    }

    expect(selected).toContain('negative-memory-01')
    expect(selected).not.toContain('negative-reasoning-01')
    expect(selected).not.toContain('negative-fluency-01')
    expect(
      selected.has('positive-reasoning-01') ||
        selected.has('positive-fluency-01'),
    ).toBe(true)
    expect(selected).not.toContain('positive-memory-01')
  })

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
