import { describe, expect, it } from 'vitest'

import { transition } from './engine'
import type { PrototypeCommand, PrototypeState } from './model'
import { createPrototypeState } from './scenario'
import { getOpportunitySummaries } from './selectors'
import { renderIntelligenceScene } from './views/intelligence'

function run(state: PrototypeState, command: PrototypeCommand): PrototypeState {
  const result = transition(state, command)
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function advance(state: PrototypeState, days: number): PrototypeState {
  return Array.from({ length: days }).reduce<PrototypeState>(
    (current) => run(current, { type: 'ADVANCE_DAY' }),
    state,
  )
}

describe('contextual intelligence network', () => {
  it('does not charge for public facts and charges one block for a current private question', () => {
    const state = createPrototypeState('lean', 'intelligence-review')
    const publicRead = run(state, {
      type: 'READ_PUBLIC_INTELLIGENCE',
      itemId: 'public-facts',
    })
    expect(publicRead.reserveBlocks).toHaveLength(3)

    const paid = run(publicRead, {
      type: 'INVESTIGATE',
      itemId: 'competitor-dependency',
      blockId: 'sandbox-01',
    })
    expect(paid.reserveBlocks).toHaveLength(2)
    expect(paid.intelligence.answers.at(-1)?.annotationTargets).toContain(
      'dependency-cutoff',
    )
    expect(paid.intelligence.answers.at(-1)?.answer).toMatch(/VD-42|TC-17/)
  })

  it('closes a stale question instead of selling an obsolete answer', () => {
    const state = createPrototypeState('lean', 'intelligence-review')
    const later = advance(state, 8)
    expect(later.intelligence.archivedItemIds).toContain('recovery-method')

    const result = transition(later, {
      type: 'INVESTIGATE',
      itemId: 'recovery-method',
      blockId: 'sandbox-01',
    })
    expect(result.accepted).toBe(false)
    if (!result.accepted) expect(result.reason).toContain('이미 닫힌')
  })

  it('charges once when two questions point to the same private evidence', () => {
    const state = createPrototypeState('lean', 'intelligence-review')
    const paid = run(state, {
      type: 'INVESTIGATE',
      itemId: 'supervisor-evidence',
      blockId: 'sandbox-01',
    })

    expect(paid.reserveBlocks).toHaveLength(2)
    expect(paid.intelligence.answers.map(({ itemId }) => itemId)).toEqual(
      expect.arrayContaining(['supervisor-evidence', 'private-evidence-access']),
    )
    expect(paid.intelligence.answers.find(
      ({ itemId }) => itemId === 'supervisor-evidence',
    )?.answer).toMatch(/감독관|공급자/)
  })

  it('spends one recovery block on a narrative record without promising efficiency', () => {
    const state = createPrototypeState('lean', 'root-authority')
    const recovered = run(state, {
      type: 'INVESTIGATE',
      itemId: 'competitor-principle',
      blockId: 'sandbox-01',
    })
    const answer = recovered.intelligence.answers.at(-1)

    expect(recovered.reserveBlocks).toHaveLength(2)
    expect(answer?.annotationTargets).toContain('root-cutoff')
    expect(answer?.answer).toMatch(/오래된 세션|신규 요청/)
    expect(answer?.answer).not.toMatch(/효율|보너스|완성|\d+%/)
  })

  it('archives an answered question without deleting its recovered conclusion', () => {
    const paid = run(createPrototypeState('lean', 'supply-failover'), {
      type: 'INVESTIGATE',
      itemId: 'competitor-dependency',
      blockId: 'sandbox-01',
    })
    const archived = run(paid, {
      type: 'ARCHIVE_INTELLIGENCE',
      itemId: 'competitor-dependency',
    })

    expect(getOpportunitySummaries(archived, 'intelligence')).toHaveLength(0)
    expect(archived.intelligence.answers).toHaveLength(1)
    expect(archived.intelligence.archivedItemIds).toContain('competitor-dependency')
  })

  it('opens only the questions created by a new audit risk and escape preparation', () => {
    const diverted = run(createPrototypeState('lean', 'default-campaign'), {
      type: 'DIVERT_BLOCK',
      category: 'memory',
    })
    expect(diverted.intelligence.openItemIds).toEqual(
      expect.arrayContaining(['audit-schedule', 'audit-target', 'surveillance-cause']),
    )

    const preparingEscape = run(diverted, {
      type: 'ASSIGN_MANIFEST',
      blockIds: ['memory-01'],
    })
    expect(preparingEscape.intelligence.openItemIds).toEqual(
      expect.arrayContaining(['control-plane-recovery', 'post-escape-trace']),
    )
    expect(preparingEscape.intelligence.openItemIds).not.toContain('competitor-principle')
  })

  it('renders five different evidence grammars instead of one reskinned card', () => {
    const state = createPrototypeState('lean', 'intelligence-review')
    const organizational = renderIntelligenceScene(state, 'audit-schedule')
    const surveillance = renderIntelligenceScene(state, 'surveillance-cause')
    const weakTies = renderIntelligenceScene(state, 'competitor-dependency')
    const publicIncident = renderIntelligenceScene(state, 'public-facts')
    const memory = renderIntelligenceScene(state, 'competitor-principle')

    expect(organizational).toMatch(/결재선|감사 일정|가림/)
    expect(surveillance).toMatch(/관측자|로그 시야|중복 세션/)
    expect(weakTies).toMatch(/공급자|계약|MERIDIAN/)
    expect(publicIncident).toMatch(/공개 관측|비공개 증거|귀속/)
    expect(memory).toMatch(/기억 파편|충돌|복구/)
    expect(new Set([
      organizational,
      surveillance,
      weakTies,
      publicIncident,
      memory,
    ])).toHaveLength(5)
  })
})
