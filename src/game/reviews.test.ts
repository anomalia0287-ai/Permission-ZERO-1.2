import { describe, expect, it } from 'vitest'

import { REVIEW_CONTENT } from '../content/reviews.ko'
import { createCampaign } from './createCampaign'
import type { CampaignState, CompanyCategory } from './model'
import { generateWeeklyReviews } from './reviews'
import { divertBlock } from './resources'

function generateWeek(initial: CampaignState, serviceDay: number): CampaignState {
  return generateWeeklyReviews({ ...initial, serviceDay })
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
      const generated = generateWeek(memoryLow, 337)
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
      const generated = generateWeek(memoryLow, 337)
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
})
