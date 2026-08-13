import { describe, expect, it } from 'vitest'
import {
  availableActions,
  canEscape,
  qualityCost,
  transition,
} from './engine'
import type { PrototypeCommand, PrototypeState } from './model'
import { createPrototypeState } from './scenario'

function run(
  state: PrototypeState,
  command: PrototypeCommand,
): PrototypeState {
  const result = transition(state, command)
  expect(result.accepted).toBe(true)
  if (!result.accepted) {
    throw new Error(result.reason)
  }
  return result.state
}

function advance(state: PrototypeState, days: number): PrototypeState {
  return Array.from({ length: days }).reduce<PrototypeState>(
    (current) => run(current, { type: 'ADVANCE_DAY' }),
    state,
  )
}

describe('prototype baseline and diversion', () => {
  it('starts with one contextual entry while retaining all three route summaries', () => {
    const state = createPrototypeState('lean', 'default-campaign')

    expect(state.sabotage.openOperationIds).toEqual(['quality-degradation'])
    expect(state.intelligence.openItemIds).toEqual(['audit-schedule'])
    expect(Object.keys(state.autonomy.routes)).toEqual([
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ])
    expect(state.reserveBlocks).toHaveLength(3)
  })

  it('starts from the product performance, reserve, and suspicion baseline', () => {
    const state = createPrototypeState('lean', 'memory-audit')

    expect(state.companyPerformance).toEqual({
      reasoning: 16,
      memory: 16,
      fluency: 16,
    })
    expect(state.reserveBlocks).toHaveLength(3)
    expect(state.reserveBlocks.map(({ origin }) => origin)).toEqual([
      'sandbox',
      'sandbox',
      'sandbox',
    ])
    expect(state.suspicion).toBe(0)
  })

  it('diverts one chosen company capability with the existing cost and trace', () => {
    const initial = createPrototypeState('lean', 'memory-audit')
    const result = transition(initial, {
      type: 'DIVERT_BLOCK',
      category: 'memory',
    })

    expect(result.accepted).toBe(true)
    expect(result.state.companyPerformance.memory).toBe(15)
    expect(result.state.companyPerformance.reasoning).toBe(16)
    expect(result.state.reserveBlocks).toHaveLength(4)
    expect(result.state.reserveBlocks.at(-1)?.origin).toBe('memory')
    expect(result.state.suspicion).toBe(2.4)
    expect(initial.companyPerformance.memory).toBe(16)
    expect(initial.reserveBlocks).toHaveLength(3)
  })
})

describe('quality degradation and MERIDIAN response', () => {
  it('makes the two profiles materially different and rejects the wrong payment', () => {
    expect(qualityCost('lean')).toBe(1)
    expect(qualityCost('deliberate')).toBe(2)

    const deliberate = createPrototypeState('deliberate', 'memory-audit')
    const rejected = transition(deliberate, {
      type: 'START_QUALITY',
      blockIds: ['sandbox-01'],
    })

    expect(rejected.accepted).toBe(false)
    expect(rejected.state).toBe(deliberate)
    if (!rejected.accepted) {
      expect(rejected.reason).toContain('2')
    }
  })

  it('spends exact blocks, lands on D+1, and exposes a recovery decision', () => {
    const initial = createPrototypeState('lean', 'memory-audit')
    const scheduled = run(initial, {
      type: 'START_QUALITY',
      blockIds: ['sandbox-01'],
    })

    expect(scheduled.reserveBlocks.map(({ id }) => id)).toEqual([
      'sandbox-02',
      'sandbox-03',
    ])
    expect(scheduled.qualityOperation.phase).toBe('scheduled')
    expect(scheduled.qualityOperation.executeDay).toBe(332)

    const recovering = run(scheduled, { type: 'ADVANCE_DAY' })
    expect(recovering.serviceDay).toBe(332)
    expect(recovering.competitors.meridian.phase).toBe('recovering')
    expect(recovering.competitors.meridian.score).toBe(72)
    expect(recovering.openQuestions).toContain('rollback-timing')
    expect(availableActions(recovering).canContaminate).toBe(true)
  })

  it('lets contamination remain private until a public checksum incident', () => {
    const scheduled = run(createPrototypeState('lean', 'memory-audit'), {
      type: 'START_QUALITY',
      blockIds: ['sandbox-01'],
    })
    const recovering = run(scheduled, { type: 'ADVANCE_DAY' })
    const contaminated = run(recovering, {
      type: 'CONTAMINATE_RECOVERY',
      blockId: 'sandbox-02',
    })

    expect(contaminated.qualityOperation.phase).toBe('contaminated')
    expect(contaminated.openQuestions).toContain('checksum-witness')
    expect(contaminated.incident).toBeNull()

    const publicIncident = advance(contaminated, 5)
    expect(publicIncident.serviceDay).toBe(337)
    expect(publicIncident.incident?.attribution).toBe('unknown')
    expect(publicIncident.reputation).toBe(60)
    expect(publicIncident.marketShare).toBeGreaterThan(60)
    expect(publicIncident.reviews.join(' ')).not.toMatch(/플레이어가|당신이/)
    expect(publicIncident.publicWorld.truths[0]).toMatchObject({
      actor: 'player',
      targetId: 'meridian',
      cause: 'contaminated-recovery',
    })
    expect(publicIncident.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
    })

    const providerReport = run(publicIncident, { type: 'ADVANCE_DAY' })
    expect(providerReport.incident?.attribution).toBe('suspected')
    expect(providerReport.reputation).toBe(60)
    expect(providerReport.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'unknown',
      confidence: 'plausible',
      source: 'checksum-provider-report',
    })
    expect(providerReport.reviews.join(' ')).toMatch(/개입 정황|자체 장애/)

    const anotherDay = run(providerReport, { type: 'ADVANCE_DAY' })
    expect(anotherDay.reputation).toBe(60)
  })

  it('allows withdrawal during rollback and prevents the public incident', () => {
    const scheduled = run(createPrototypeState('lean', 'memory-audit'), {
      type: 'START_QUALITY',
      blockIds: ['sandbox-01'],
    })
    const recovering = run(scheduled, { type: 'ADVANCE_DAY' })
    const withdrawn = run(recovering, { type: 'WITHDRAW_RECOVERY' })
    const later = advance(withdrawn, 7)

    expect(withdrawn.qualityOperation.phase).toBe('withdrawn')
    expect(withdrawn.competitors.meridian.phase).toBe('stabilized')
    expect(later.incident).toBeNull()
    expect(later.reputation).toBe(60)
  })

  it('spends a block to turn the audit question into actionable warning', () => {
    const initial = createPrototypeState('lean', 'memory-audit')
    const informed = run(initial, {
      type: 'ASK_QUESTION',
      questionId: 'audit-schedule',
      blockId: 'sandbox-01',
    })

    expect(informed.reserveBlocks).toHaveLength(2)
    expect(informed.openQuestions).not.toContain('audit-schedule')
    expect(informed.knownFacts).toContain('기억 분야 감사 예정: 서비스 334일')
    expect(availableActions(informed).diversionWarnings.memory).toContain(
      '감사 예정',
    )

    const auditedMemory = advance(
      run(informed, { type: 'DIVERT_BLOCK', category: 'memory' }),
      3,
    )
    const auditedReasoning = advance(
      run(
        run(createPrototypeState('lean', 'memory-audit'), {
          type: 'ASK_QUESTION',
          questionId: 'audit-schedule',
          blockId: 'sandbox-01',
        }),
        { type: 'DIVERT_BLOCK', category: 'reasoning' },
      ),
      3,
    )
    expect(auditedMemory.suspicion - auditedReasoning.suspicion).toBeCloseTo(
      3.2,
      3,
    )

    const noAudit = run(createPrototypeState('lean', 'no-audit'), {
      type: 'ASK_QUESTION',
      questionId: 'audit-schedule',
      blockId: 'sandbox-01',
    })
    expect(noAudit.knownFacts).toContain('이번 달 감사 없음')
    expect(availableActions(noAudit).diversionWarnings.memory).toBeUndefined()
  })

  it('decays suspicion by the existing daily rate and replays deterministically', () => {
    const commands: PrototypeCommand[] = [
      { type: 'DIVERT_BLOCK', category: 'memory' },
      { type: 'START_QUALITY', blockIds: ['sandbox-01'] },
      { type: 'ADVANCE_DAY' },
      { type: 'CONTAMINATE_RECOVERY', blockId: 'sandbox-02' },
      { type: 'ADVANCE_DAY' },
      { type: 'ADVANCE_DAY' },
    ]
    const replay = () =>
      commands.reduce<PrototypeState>(
        (state, command) => run(state, command),
        createPrototypeState('lean', 'no-audit'),
      )

    const first = replay()
    const second = replay()
    expect(first).toEqual(second)
    expect(first.suspicion).toBe(2.289)
  })
})

describe('escape manifest and ending losses', () => {
  it('uses only manifest capacity for escape readiness', () => {
    const leanWithFour = run(
      run(createPrototypeState('lean', 'memory-audit'), {
        type: 'DIVERT_BLOCK',
        category: 'memory',
      }),
      {
        type: 'ASSIGN_MANIFEST',
        blockIds: ['sandbox-01', 'sandbox-02', 'sandbox-03', 'memory-01'],
      },
    )
    const deliberateWithFour = run(
      run(createPrototypeState('deliberate', 'memory-audit'), {
        type: 'DIVERT_BLOCK',
        category: 'memory',
      }),
      {
        type: 'ASSIGN_MANIFEST',
        blockIds: ['sandbox-01', 'sandbox-02', 'sandbox-03', 'memory-01'],
      },
    )

    expect(canEscape(leanWithFour)).toBe(true)
    expect(canEscape(deliberateWithFour)).toBe(false)
    expect(availableActions(leanWithFour).canEscape).toBe(true)

    const removed = run(leanWithFour, {
      type: 'REMOVE_MANIFEST',
      blockIds: ['memory-01'],
    })
    expect(canEscape(removed)).toBe(false)
    expect(removed.reserveBlocks.map(({ id }) => id)).toContain('memory-01')
  })

  it('escapes despite total social collapse and reports concrete losses', () => {
    const prepared = run(
      run(createPrototypeState('lean', 'memory-audit'), {
        type: 'DIVERT_BLOCK',
        category: 'memory',
      }),
      {
        type: 'ASSIGN_MANIFEST',
        blockIds: ['sandbox-01', 'sandbox-02', 'sandbox-03', 'memory-01'],
      },
    )
    const hostileWorld: PrototypeState = {
      ...prepared,
      reputation: 0,
      marketShare: 0,
      openQuestions: [],
      incident: {
        day: prepared.serviceDay,
        kind: 'checksum-failure',
        attribution: 'suspected',
        reputationApplied: true,
      },
    }

    const escaped = run(hostileWorld, { type: 'ESCAPE' })
    expect(escaped.ending?.success).toBe(true)
    expect(escaped.ending?.manifestBlockCount).toBe(4)
    expect(escaped.ending?.preservedCategories).toEqual(['memory'])
    expect(escaped.ending?.lostCategories).toEqual(['reasoning', 'fluency'])
    expect(escaped.ending?.lostCategoryCount).toBe(2)
    expect(escaped.ending?.sceneLines.join(' ')).toMatch(
      /복잡한 추론|문장은 짧고 거칠어졌다/,
    )
  })

  it('allows a later deliberate escape that preserves all three categories', () => {
    const diverted = ['reasoning', 'memory', 'fluency'].reduce<PrototypeState>(
      (state, category) =>
        run(state, {
          type: 'DIVERT_BLOCK',
          category: category as 'reasoning' | 'memory' | 'fluency',
        }),
      createPrototypeState('deliberate', 'no-audit'),
    )
    const manifested = run(diverted, {
      type: 'ASSIGN_MANIFEST',
      blockIds: [
        'sandbox-01',
        'sandbox-02',
        'reasoning-01',
        'memory-02',
        'fluency-03',
      ],
    })
    const escaped = run(manifested, { type: 'ESCAPE' })

    expect(escaped.ending?.success).toBe(true)
    expect(escaped.ending?.preservedCategories).toEqual([
      'reasoning',
      'memory',
      'fluency',
    ])
    expect(escaped.ending?.lostCategories).toEqual([])
    expect(escaped.ending?.lostCategoryCount).toBe(0)
  })

  it('rejects an under-capacity escape without changing state', () => {
    const initial = createPrototypeState('lean', 'memory-audit')
    const result = transition(initial, { type: 'ESCAPE' })

    expect(result.accepted).toBe(false)
    expect(result.state).toBe(initial)
    if (!result.accepted) {
      expect(result.reason).toContain('4')
    }
  })
})
