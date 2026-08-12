import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  AUDIT_INTEL_NODE_IDS,
  auditProbability,
  auditTargetWeights,
  getAuditIntel,
  getSuspicionBand,
  openScheduledAudit,
  resolveAudit,
  scheduleMonthlyAudit,
} from './evaluation'
import type { CampaignState, CompanyCategory } from './model'
import { divertBlock } from './resources'

function withScheduledAudit(
  initial: CampaignState,
  target: CompanyCategory = 'reasoning',
): CampaignState {
  return {
    ...initial,
    serviceDay: 360,
    audit: {
      ...initial.audit,
      scheduled: true,
      target,
      scheduledOnServiceDay: 360,
      probability: auditProbability(initial.suspicion),
      roll: 0,
      targetWeights: auditTargetWeights(initial),
    },
  }
}

function removeReasoningBlocks(initial: CampaignState, count: number): CampaignState {
  let state = initial
  for (let index = 0; index < count; index += 1) {
    const blockId = state.resources.company.reasoning.find(Boolean)
    const destination = state.resources.reserve.findIndex((candidate) => candidate === null)
    if (!blockId || destination < 0) throw new Error('감사 실패 상태 준비 실패')
    const result = divertBlock(state, blockId, destination)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

describe('monthly audit selection', () => {
  it.each([
    [39.9, 'routine', '정상 감시', 0.1],
    [40, 'integrity', '무결성 프로토콜', 30],
    [69.9, 'integrity', '무결성 프로토콜', 0.1],
    [70, 'accelerated', '가속 프로토콜', 0],
  ])(
    'classifies suspicion %s at the public protocol boundary',
    (suspicion, id, label, remaining) => {
      expect(getSuspicionBand(suspicion)).toMatchObject({
        id,
        label,
        remainingToNext: remaining,
      })
    },
  )

  it.each([
    [0, 0.03],
    [25, 0.0726],
    [50, 0.1685],
    [75, 0.3059],
    [100, 0.48],
  ])('uses the approved probability curve at suspicion %i', (suspicion, expected) => {
    expect(auditProbability(suspicion)).toBeCloseTo(expected, 4)
  })

  it('weights only company-observable prior performance deficits', () => {
    const base = createCampaign('audit-target')
    const state = {
      ...base,
      evaluation: {
        ...base.evaluation,
        lastCategoryPerformance: { reasoning: 13, memory: 16, fluency: 10 },
      },
    }
    const weights = auditTargetWeights(state)

    expect(weights.reasoning).toBeCloseTo(2.028, 3)
    expect(weights.memory).toBe(1)
    expect(weights.fluency).toBeCloseTo(5.028, 3)
  })

  it('makes a deterministic month-start decision and keeps it hidden by default', () => {
    let scheduled: CampaignState | undefined

    for (let seedIndex = 0; seedIndex < 100 && !scheduled; seedIndex += 1) {
      const candidate = scheduleMonthlyAudit({
        ...createCampaign(`audit-roll-${seedIndex}`),
        suspicion: 100,
      })
      if (candidate.audit.scheduled) scheduled = candidate
    }

    expect(scheduled).toBeDefined()
    if (!scheduled) return

    const replay = scheduleMonthlyAudit({
      ...createCampaign(scheduled.campaignSeed),
      suspicion: 100,
    })
    expect(replay.audit).toEqual(scheduled.audit)
    expect(getAuditIntel(scheduled)).toEqual({
      scheduleKnown: false,
      scheduled: null,
      biasKnown: false,
      targetWeights: null,
      targetKnown: false,
      target: null,
    })

    const informed = {
      ...scheduled,
      hacking: {
        ...scheduled.hacking,
        purchasedNodeIds: Object.values(AUDIT_INTEL_NODE_IDS),
      },
    }
    expect(getAuditIntel(informed)).toEqual({
      scheduleKnown: true,
      scheduled: true,
      biasKnown: true,
      targetWeights: scheduled.audit.targetWeights,
      targetKnown: true,
      target: scheduled.audit.target,
    })
  })
})

describe('audit lifecycle', () => {
  it('pauses on day 30, passes at expectation, and restores the prior speed', () => {
    const due = withScheduledAudit({
      ...createCampaign('audit-pass'),
      clock: { speed: 4, elapsedDayMs: 0, speedBeforeEvent: null },
    })
    const opened = openScheduledAudit(due)

    expect(opened.clock.speed).toBe(0)
    expect(opened.clock.speedBeforeEvent).toBe(4)
    expect(opened.activeEvent).toMatchObject({ type: 'audit', blocking: true })

    const result = resolveAudit(opened)
    expect(result.resolved).toBe(true)
    if (!result.resolved) return

    expect(result.passed).toBe(true)
    expect(result.submittedPerformance).toBe(16)
    expect(result.state.clock.speed).toBe(4)
    expect(result.state.activeEvent).toBeNull()
    expect(result.state.audit.scheduled).toBe(false)
  })

  it('adds suspicion and one disposal stage on failure', () => {
    const depleted = removeReasoningBlocks(
      withScheduledAudit(createCampaign('audit-fail')),
      4,
    )
    const opened = openScheduledAudit(depleted)
    const result = resolveAudit(opened)

    expect(result.resolved).toBe(true)
    if (!result.resolved) return

    expect(result.passed).toBe(false)
    expect(result.state.suspicion).toBeCloseTo(depleted.suspicion + 25)
    expect(result.state.evaluation.disposalStage).toBe(1)
    expect(result.state.audit.history.at(-1)).toMatchObject({
      target: 'reasoning',
      passed: false,
      submittedPerformance: 12,
      suspicionDelta: 25,
      disposalAbsorbed: false,
    })
  })

  it('uses distributed residency to absorb an audit-failure disposal increase once', () => {
    const base = createCampaign('audit-protected')
    const protectedState = removeReasoningBlocks(
      withScheduledAudit({
        ...base,
        evaluation: { ...base.evaluation, distributedResidencyCharges: 1 },
      }),
      4,
    )
    const result = resolveAudit(openScheduledAudit(protectedState))

    expect(result.resolved).toBe(true)
    if (!result.resolved) return
    expect(result.state.evaluation.disposalStage).toBe(0)
    expect(result.state.evaluation.distributedResidencyCharges).toBe(0)
    expect(result.state.audit.history.at(-1)?.disposalAbsorbed).toBe(true)
  })
})
