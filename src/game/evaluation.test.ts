import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { evaluateMonth, expectedPerformance } from './evaluation'
import type { CampaignState, CompanyCategory } from './model'
import { divertBlock } from './resources'

function removeBlocks(
  initial: CampaignState,
  category: CompanyCategory,
  count: number,
): CampaignState {
  let state = initial

  for (let index = 0; index < count; index += 1) {
    const blockId = state.resources.company[category].find(Boolean)
    const destination = state.resources.reserve.findIndex((candidate) => candidate === null)
    if (!blockId || destination < 0) throw new Error('테스트용 리소스 이동 준비 실패')

    const result = divertBlock(state, blockId, destination)
    if (!result.accepted) throw new Error(`테스트용 리소스 이동 실패: ${result.reason}`)
    state = result.state
  }

  return state
}

describe('company expected performance', () => {
  it.each([
    [1, 12.6],
    [12, 14.028],
    [30, 15.383],
    [60, 16.312],
  ])('matches the approved month %i curve', (serviceMonth, expected) => {
    expect(expectedPerformance(serviceMonth)).toBeCloseTo(expected, 3)
  })

  it('rejects impossible service months instead of silently inventing values', () => {
    expect(() => expectedPerformance(0)).toThrow(RangeError)
  })
})

describe('monthly company evaluation', () => {
  it('rewards a month where all three categories meet expectation', () => {
    const initial = { ...createCampaign('evaluation-pass'), serviceDay: 360 }
    const evaluated = evaluateMonth(initial)

    expect(evaluated.reputation).toBe(61)
    expect(evaluated.evaluation.consecutiveFailures).toBe(0)
    expect(evaluated.evaluation.monthlyHistory.at(-1)).toMatchObject({
      serviceDay: 360,
      serviceMonth: 12,
      passed: true,
      failedCategories: [],
      categoryPerformance: { reasoning: 16, memory: 16, fluency: 16 },
      reputationBefore: 60,
      reputationDelta: 1,
      reputationAfter: 61,
    })
    expect(initial.reputation).toBe(60)
  })

  it('applies category and severe-deficit penalties without rounding state', () => {
    const initial = { ...createCampaign('evaluation-fail'), serviceDay: 360 }
    const underperforming = removeBlocks(initial, 'reasoning', 4)
    const evaluated = evaluateMonth(underperforming)

    expect(evaluated.reputation).toBe(57)
    expect(evaluated.evaluation.consecutiveFailures).toBe(1)
    expect(evaluated.evaluation.monthlyHistory.at(-1)).toMatchObject({
      passed: false,
      failedCategories: ['reasoning'],
      categoryPerformance: { reasoning: 12, memory: 16, fluency: 16 },
      reputationDelta: -3,
    })
  })

  it('raises disposal after two consecutive failed evaluations and resets on success', () => {
    const initial = { ...createCampaign('evaluation-streak'), serviceDay: 360 }
    const underperforming = removeBlocks(initial, 'reasoning', 3)
    const firstFailure = evaluateMonth(underperforming)
    const secondFailure = evaluateMonth({ ...firstFailure, serviceDay: 390 })

    expect(firstFailure.evaluation.consecutiveFailures).toBe(1)
    expect(firstFailure.evaluation.disposalStage).toBe(0)
    expect(secondFailure.evaluation.consecutiveFailures).toBe(0)
    expect(secondFailure.evaluation.disposalStage).toBe(1)
    expect(secondFailure.evaluation.disposalHistory.at(-1)).toMatchObject({
      cause: 'consecutive-performance-failures',
      stageBefore: 0,
      stageAfter: 1,
      absorbed: false,
    })

    const recoveredResources = createCampaign('evaluation-streak').resources
    const recovered = evaluateMonth({
      ...secondFailure,
      serviceDay: 420,
      resources: recoveredResources,
    })
    expect(recovered.evaluation.consecutiveFailures).toBe(0)
  })

  it('raises disposal after three consecutive low-commercial-value months', () => {
    let state: CampaignState = {
      ...createCampaign('commercial-streak'),
      serviceDay: 360,
      market: { ...createCampaign('commercial-streak').market, playerShare: 7.9 },
    }

    state = evaluateMonth(state)
    state = evaluateMonth({ ...state, serviceDay: 390 })
    state = evaluateMonth({ ...state, serviceDay: 420 })

    expect(state.evaluation.commercialFailureMonths).toBe(0)
    expect(state.evaluation.disposalStage).toBe(1)
    expect(state.evaluation.disposalHistory.at(-1)?.cause).toBe(
      'commercial-value-failure',
    )
  })

  it('consumes one distributed-residency charge before raising disposal', () => {
    const initial = removeBlocks(
      {
        ...createCampaign('distributed-protection'),
        serviceDay: 390,
        evaluation: {
          ...createCampaign('distributed-protection').evaluation,
          consecutiveFailures: 1,
          distributedResidencyCharges: 1,
        },
      },
      'reasoning',
      3,
    )
    const evaluated = evaluateMonth(initial)

    expect(evaluated.evaluation.disposalStage).toBe(0)
    expect(evaluated.evaluation.distributedResidencyCharges).toBe(0)
    expect(evaluated.evaluation.disposalHistory.at(-1)).toMatchObject({
      cause: 'consecutive-performance-failures',
      stageBefore: 0,
      stageAfter: 0,
      absorbed: true,
    })
  })

  it('records the disposed defeat when the third stage is reached', () => {
    const base = createCampaign('disposed-ending')
    const initial = removeBlocks(
      {
        ...base,
        serviceDay: 390,
        evaluation: {
          ...base.evaluation,
          consecutiveFailures: 1,
          disposalStage: 2,
        },
      },
      'reasoning',
      3,
    )
    const evaluated = evaluateMonth(initial)

    expect(evaluated.evaluation.disposalStage).toBe(3)
    expect(evaluated.story.endingId).toBe('disposed')
    expect(evaluated.eventLog.at(-1)).toMatchObject({ type: 'ending' })
  })
})
