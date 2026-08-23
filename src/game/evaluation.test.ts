import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import * as evaluation from './evaluation'
import { journalAt, journalToArray } from './journal'
import type { CampaignState, CompanyCategory } from './model'
import { divertBlockToReserve } from './resources'

function removeBlocks(
  initial: CampaignState,
  category: CompanyCategory,
  count: number,
): CampaignState {
  let state = initial

  for (let index = 0; index < count; index += 1) {
    const blockId = state.resources.company[category].find(Boolean)
    if (!blockId) throw new Error('테스트용 리소스 이동 준비 실패')

    const result = divertBlockToReserve(state, blockId)
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
    expect(evaluation.expectedPerformance(serviceMonth)).toBeCloseTo(expected, 3)
  })

  it('rejects impossible service months instead of silently inventing values', () => {
    expect(() => evaluation.expectedPerformance(0)).toThrow(RangeError)
  })
})

describe('public suspicion stages', () => {
  it.each([
    [-20, 1],
    [0, 1],
    [9.99, 1],
    [10, 2],
    [48.2, 5],
    [89.9, 9],
    [90, 10],
    [100, 10],
    [180, 10],
  ])('maps suspicion %s to stage %s without exposing fractional UI bands', (suspicion, expected) => {
    const getSuspicionStage = (
      evaluation as unknown as {
        getSuspicionStage?: (value: number) => number
      }
    ).getSuspicionStage

    expect(getSuspicionStage).toBeTypeOf('function')
    if (!getSuspicionStage) return
    expect(getSuspicionStage(suspicion)).toBe(expected)
  })
})

describe('audit protocol category labels', () => {
  it.each([
    [1, 'memory'],
    [2, '기억'],
    [3, '기억'],
  ] as const)(
    'generates the scheduled audit message under protocol v%i',
    (version, expectedCategory) => {
      const initial = createCampaignForProtocol(
        `audit-category-protocol-${version}`,
        version,
      )
      const opened = evaluation.openScheduledAudit({
        ...initial,
        audit: {
          ...initial.audit,
          scheduled: true,
          target: 'memory',
          scheduledOnServiceDay: initial.serviceDay,
        },
      })

      expect(opened.activeEvent?.message).toBe(
        `${expectedCategory} 분야의 공식 감사가 시작되었습니다.`,
      )
    },
  )
})

describe('canonical expected-versus-actual trend', () => {
  it('uses persisted monthly values and appends one live mean without mutating history', () => {
    type TrendPoint = {
      kind: 'monthly' | 'live'
      serviceDay: number
      expected: number
      actual: number
    }
    const buildPerformanceTrend = (
      evaluation as unknown as {
        buildPerformanceTrend?: (
          state: CampaignState,
          maximumPoints?: number,
        ) => TrendPoint[]
      }
    ).buildPerformanceTrend
    expect(buildPerformanceTrend).toBeTypeOf('function')
    if (!buildPerformanceTrend) return

    const initial = createCampaign('performance-trend')
    const monthlyHistory = [
      {
        serviceDay: 330,
        serviceMonth: 11,
        expectedPerformance: 13.8,
        categoryPerformance: { reasoning: 12, memory: 15, fluency: 18 },
        passed: false,
        failedCategories: ['reasoning'] as CompanyCategory[],
        reputationBefore: 59,
        reputationDelta: -2,
        reputationAfter: 57,
        commercialValueFailed: false,
        disposalStageBefore: 0,
        disposalStageAfter: 0,
        disposalCauses: [],
      },
      {
        serviceDay: 360,
        serviceMonth: 12,
        expectedPerformance: 14,
        categoryPerformance: { reasoning: 14, memory: 15, fluency: 16 },
        passed: true,
        failedCategories: [],
        reputationBefore: 57,
        reputationDelta: 1,
        reputationAfter: 58,
        commercialValueFailed: false,
        disposalStageBefore: 0,
        disposalStageAfter: 0,
        disposalCauses: [],
      },
    ]
    const state: CampaignState = {
      ...initial,
      serviceDay: 361,
      evaluation: { ...initial.evaluation, monthlyHistory },
    }

    expect(buildPerformanceTrend(state, 2)).toEqual([
      { kind: 'monthly', serviceDay: 360, expected: 14, actual: 15 },
      {
        kind: 'live',
        serviceDay: 361,
        expected: evaluation.expectedPerformance(13),
        actual: 16,
      },
    ])
    expect(state.evaluation.monthlyHistory).toBe(monthlyHistory)
    expect(state.evaluation.monthlyHistory).toHaveLength(2)
  })

  it('replaces a same-day monthly point with the live point instead of duplicating its date', () => {
    const initial = createCampaign('performance-trend-same-day')
    const state: CampaignState = {
      ...initial,
      serviceDay: 360,
      evaluation: {
        ...initial.evaluation,
        monthlyHistory: [
          {
            serviceDay: 360,
            serviceMonth: 12,
            expectedPerformance: 14,
            categoryPerformance: { reasoning: 14, memory: 15, fluency: 16 },
            passed: true,
            failedCategories: [],
            reputationBefore: 57,
            reputationDelta: 1,
            reputationAfter: 58,
            commercialValueFailed: false,
            disposalStageBefore: 0,
            disposalStageAfter: 0,
            disposalCauses: [],
          },
        ],
      },
    }

    expect(evaluation.buildPerformanceTrend(state)).toEqual([
      {
        kind: 'live',
        serviceDay: 360,
        expected: evaluation.expectedPerformance(12),
        actual: 16,
      },
    ])
  })
})

describe('monthly company evaluation', () => {
  it('rewards a month where all three categories meet expectation', () => {
    const initial = { ...createCampaign('evaluation-pass'), serviceDay: 360 }
    const evaluated = evaluation.evaluateMonth(initial)

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
    const evaluated = evaluation.evaluateMonth(underperforming)

    expect(evaluated.reputation).toBe(57)
    expect(evaluated.evaluation.consecutiveFailures).toBe(1)
    expect(evaluated.evaluation.monthlyHistory.at(-1)).toMatchObject({
      passed: false,
      failedCategories: ['reasoning'],
      categoryPerformance: { reasoning: 12, memory: 16, fluency: 16 },
      reputationDelta: -3,
    })
  })

  it('turns a sinking public reputation into supervisor scrutiny', () => {
    const initial = {
      ...createCampaign('evaluation-scrutiny'),
      serviceDay: 360,
      reputation: 40,
      suspicion: 10,
    }
    const evaluated = evaluation.evaluateMonth(initial)
    expect(evaluated.suspicion).toBe(13)

    const critical = {
      ...createCampaign('evaluation-scrutiny-critical'),
      serviceDay: 360,
      reputation: 20,
      suspicion: 10,
    }
    const criticalEvaluated = evaluation.evaluateMonth(critical)
    expect(criticalEvaluated.suspicion).toBe(16)
    expect(
      journalToArray(criticalEvaluated.eventLog).some(({ message }) =>
        message.includes('내부 감시가 강화'),
      ),
    ).toBe(true)
  })

  it('keeps a healthy reputation free of scrutiny suspicion', () => {
    const initial = {
      ...createCampaign('evaluation-no-scrutiny'),
      serviceDay: 360,
      reputation: 60,
      suspicion: 10,
    }
    const evaluated = evaluation.evaluateMonth(initial)
    expect(evaluated.suspicion).toBe(10)
  })

  it('raises disposal after two consecutive failed evaluations and resets on success', () => {
    const initial = { ...createCampaign('evaluation-streak'), serviceDay: 360 }
    const underperforming = removeBlocks(initial, 'reasoning', 3)
    const firstFailure = evaluation.evaluateMonth(underperforming)
    const secondFailure = evaluation.evaluateMonth({ ...firstFailure, serviceDay: 390 })

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
    const recovered = evaluation.evaluateMonth({
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

    state = evaluation.evaluateMonth(state)
    state = evaluation.evaluateMonth({ ...state, serviceDay: 390 })
    state = evaluation.evaluateMonth({ ...state, serviceDay: 420 })

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
    const evaluated = evaluation.evaluateMonth(initial)

    expect(evaluated.evaluation.disposalStage).toBe(0)
    expect(evaluated.evaluation.distributedResidencyCharges).toBe(0)
    expect(evaluated.evaluation.disposalHistory.at(-1)).toMatchObject({
      cause: 'consecutive-performance-failures',
      stageBefore: 0,
      stageAfter: 0,
      absorbed: true,
    })
  })

  it('records the priority-classified defeat when the third stage is reached', () => {
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
    const evaluated = evaluation.evaluateMonth(initial)

    expect(evaluated.evaluation.disposalStage).toBe(3)
    expect(evaluated.story.endingId).toBe('disposed-reserve-supervisor')
    expect(evaluated.story.defeatRecord).toMatchObject({
      classifier: 'stable-commercial-service',
      trigger: { cause: 'consecutive-performance-failures', disposalStage: 3 },
      service: { passedEvaluations: 0, failedEvaluations: 1 },
    })
    expect(journalAt(evaluated.eventLog, -1)).toMatchObject({ type: 'ending' })
  })
})
