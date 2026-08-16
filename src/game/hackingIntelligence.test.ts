import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  INTELLIGENCE_DEFINITIONS,
  INTELLIGENCE_ITEM_IDS,
} from './hackingContent'
import {
  advanceHackingIntelligenceDay,
  archiveHackingIntelligence,
  currentHackingIntelligenceAnswer,
  hackingIntelligenceDeadline,
  investigateHackingIntelligence,
  readPublicHackingIntelligence,
  syncHackingIntelligenceOpportunities,
} from './hackingIntelligence'
import type { HackingOperationRun, IntelligenceItemId } from './hackingCoreModel'
import {
  publishHackingIncident,
  recordHackingIncidentTruth,
  reviseHackingAttribution,
} from './hackingPublicWorld'
import type { CampaignState } from './model'

function reserveIds(state: CampaignState): string[] {
  return state.resources.reserve.filter((id): id is string => id !== null)
}

function openItems(
  state: CampaignState,
  itemIds: readonly IntelligenceItemId[],
): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      intelligence: {
        ...state.hackingCore.intelligence,
        openItemIds: Array.from(new Set([
          ...state.hackingCore.intelligence.openItemIds,
          ...itemIds,
        ])),
        opportunityOpenedOnServiceDay: {
          ...state.hackingCore.intelligence.opportunityOpenedOnServiceDay,
          ...Object.fromEntries(itemIds.map((itemId) => [itemId, state.serviceDay])),
        },
      },
    },
  }
}

function withPublicIncident(state: CampaignState): CampaignState {
  const truth = recordHackingIncidentTruth(state, {
    id: 'incident-intelligence',
    actor: 'player',
    targetId: 'meridian',
    cause: 'contaminated-recovery',
    directEffect: '비공개 입력으로 복구 이미지 체크섬이 바뀌었다.',
  })
  if (!truth.accepted) throw new Error(truth.reason)
  const published = publishHackingIncident(truth.state, 'incident-intelligence', {
    scope: 'public',
    observedResult: '복구 뒤 체크섬 손상이 반복됐다.',
    attributedTo: 'unknown',
    confidence: 'unconfirmed',
    source: 'public-status-page',
  })
  if (!published.accepted) throw new Error(published.reason)
  return syncHackingIntelligenceOpportunities(published.state)
}

function qualityRun(deadlineOnServiceDay: number): HackingOperationRun {
  return {
    id: 'run-quality-deadline',
    operationId: 'quality-degradation',
    targetId: 'meridian',
    phase: 'response',
    investedBlockIds: [],
    startedOnServiceDay: 331,
    executeOnServiceDay: 332,
    responseOnServiceDay: 332,
    deadlineOnServiceDay,
    exposure: 0,
    outcome: 'rollback-started',
    optionId: 'adapter-group-b',
    routingShare: null,
    opponentResponse: 'rollback',
    publicIncidentId: null,
  }
}

describe('canonical hacking intelligence', () => {
  it('contains exactly 2 public, 11 paid, and 3 narrative records', () => {
    expect(INTELLIGENCE_DEFINITIONS).toHaveLength(16)
    expect(INTELLIGENCE_ITEM_IDS).toHaveLength(16)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'public')).toHaveLength(2)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'paid')).toHaveLength(11)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'narrative')).toHaveLength(3)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind !== 'public').every(
      ({ cost }) => cost === 1,
    )).toBe(true)
  })

  it('reads public intelligence for zero blocks from only the latest public snapshot', () => {
    const initial = withPublicIncident(createCampaign('intelligence-public'))
    const reserveBefore = [...initial.resources.reserve]
    const first = readPublicHackingIntelligence(initial, 'public-facts')

    expect(first.accepted).toBe(true)
    if (!first.accepted) return
    expect(first.state.resources.reserve).toEqual(reserveBefore)
    const answer = currentHackingIntelligenceAnswer(first.state, 'public-facts')
    expect(answer).toMatchObject({
      answeredOnServiceDay: 331,
      validUntilServiceDay: 331,
      consumedBlockId: null,
    })
    expect(answer?.answer).toContain('public-status-page')
    expect(answer?.answer).not.toContain('비공개 입력')
    expect(answer?.answer).not.toContain('player')

    const revised = reviseHackingAttribution(
      { ...first.state, serviceDay: 332 },
      'incident-intelligence',
      {
        candidate: 'tallow',
        confidence: 'credible',
        source: 'status-mirror-b',
      },
    )
    if (!revised.accepted) throw new Error(revised.reason)
    expect(currentHackingIntelligenceAnswer(revised.state, 'public-facts')).toBeNull()
    const reread = readPublicHackingIntelligence(revised.state, 'public-suspicion')
    expect(reread.accepted).toBe(true)
    if (!reread.accepted) return
    expect(currentHackingIntelligenceAnswer(
      reread.state,
      'public-suspicion',
    )?.answer).toContain('TALLOW')
  })

  it('consumes exactly one block for paid intelligence and rejects a current duplicate', () => {
    const initial = openItems(
      createCampaign('intelligence-paid'),
      ['audit-schedule'],
    )
    const [blockId] = reserveIds(initial)
    const investigated = investigateHackingIntelligence(
      initial,
      'audit-schedule',
      blockId,
    )

    expect(investigated.accepted).toBe(true)
    if (!investigated.accepted) return
    expect(investigated.state.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'intelligence',
    })
    expect(currentHackingIntelligenceAnswer(
      investigated.state,
      'audit-schedule',
    )).toMatchObject({ consumedBlockId: blockId })
    expect(investigateHackingIntelligence(
      investigated.state,
      'audit-schedule',
      reserveIds(investigated.state)[0],
    )).toEqual({
      accepted: false,
      state: investigated.state,
      reason: 'ANSWER_ALREADY_CURRENT',
    })
  })

  it('records the two-answer evidence bundle for one consumed block', () => {
    const initial = openItems(
      createCampaign('intelligence-bundle'),
      ['supervisor-evidence', 'private-evidence-access'],
    )
    const [blockId] = reserveIds(initial)
    const investigated = investigateHackingIntelligence(
      initial,
      'supervisor-evidence',
      blockId,
    )

    expect(investigated.accepted).toBe(true)
    if (!investigated.accepted) return
    const answers = investigated.state.hackingCore.intelligence.answers
    expect(answers.map(({ itemId }) => itemId)).toEqual([
      'supervisor-evidence',
      'private-evidence-access',
    ])
    expect(answers.every(({ consumedBlockId }) => consumedBlockId === blockId)).toBe(true)
    expect(investigated.state.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'intelligence',
    })
    expect(reserveIds(investigated.state)).toHaveLength(reserveIds(initial).length - 1)
  })

  it('derives deadlines from the current audit, month, public incident, launch, access, and operation facts', () => {
    const initial = createCampaign('intelligence-deadlines')
    const scheduled: CampaignState = {
      ...initial,
      audit: {
        ...initial.audit,
        scheduled: true,
        target: 'memory',
        scheduledOnServiceDay: 334,
      },
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((candidate) => (
          candidate.id === 'tallow'
            ? { ...candidate, launchServiceDay: 380 }
            : candidate
        )),
      },
      hackingCore: {
        ...initial.hackingCore,
        sabotage: {
          ...initial.hackingCore.sabotage,
          runs: [qualityRun(335)],
          access: {
            ...initial.hackingCore.sabotage.access,
            supplierContract: true,
            supplierContractUntilServiceDay: 345,
          },
        },
      },
    }
    expect(hackingIntelligenceDeadline(scheduled, 'audit-schedule')).toBe(334)
    expect(hackingIntelligenceDeadline(scheduled, 'audit-target')).toBe(334)
    expect(hackingIntelligenceDeadline(scheduled, 'accepted-explanations')).toBe(380)
    expect(hackingIntelligenceDeadline(scheduled, 'competitor-dependency')).toBe(345)
    expect(hackingIntelligenceDeadline(scheduled, 'recovery-method')).toBe(335)
    expect(hackingIntelligenceDeadline(scheduled, 'control-plane-recovery')).toBeNull()
    expect(hackingIntelligenceDeadline(scheduled, 'predecessor-fate')).toBeNull()

    const noAudit = { ...initial, serviceDay: 342 }
    expect(hackingIntelligenceDeadline(noAudit, 'audit-schedule')).toBe(360)
    expect(hackingIntelligenceDeadline(noAudit, 'surveillance-cause')).toBe(360)

    const publicDay337 = withPublicIncident({ ...initial, serviceDay: 337 })
    expect(hackingIntelligenceDeadline(publicDay337, 'supervisor-evidence')).toBe(344)
    expect(hackingIntelligenceDeadline(publicDay337, 'private-evidence-access')).toBe(344)
    expect(hackingIntelligenceDeadline(publicDay337, 'failure-cause-gap')).toBe(344)
  })

  it('requires an answer before manual archive and records an immutable archive reason', () => {
    const initial = createCampaign('intelligence-archive')
    expect(archiveHackingIntelligence(initial, 'audit-schedule')).toEqual({
      accepted: false,
      state: initial,
      reason: 'ANSWER_REQUIRED',
    })
    const [blockId] = reserveIds(initial)
    const investigated = investigateHackingIntelligence(
      initial,
      'audit-schedule',
      blockId,
    )
    if (!investigated.accepted) throw new Error(investigated.reason)
    const archived = archiveHackingIntelligence(
      investigated.state,
      'audit-schedule',
    )
    expect(archived.accepted).toBe(true)
    if (!archived.accepted) return
    expect(archived.state.hackingCore.intelligence.openItemIds).not.toContain(
      'audit-schedule',
    )
    expect(archived.state.hackingCore.intelligence.archivedItemIds).toContain(
      'audit-schedule',
    )
    expect(archived.state.hackingCore.intelligence.archiveRecords).toEqual([
      {
        itemId: 'audit-schedule',
        archivedOnServiceDay: 331,
        reason: 'manual',
      },
    ])
  })

  it('auto-archives an unanswered expired paid item but not public or narrative records', () => {
    const initial = openItems(
      { ...createCampaign('intelligence-expiry'), serviceDay: 359 },
      ['surveillance-cause', 'public-facts', 'predecessor-fate'],
    )
    const advanced = advanceHackingIntelligenceDay({ ...initial, serviceDay: 361 })

    expect(advanced.hackingCore.intelligence.archivedItemIds).toContain(
      'surveillance-cause',
    )
    expect(advanced.hackingCore.intelligence.archivedItemIds).not.toContain(
      'public-facts',
    )
    expect(advanced.hackingCore.intelligence.archivedItemIds).not.toContain(
      'predecessor-fate',
    )
    expect(advanced.hackingCore.intelligence.archiveRecords).toContainEqual({
      itemId: 'surveillance-cause',
      archivedOnServiceDay: 361,
      reason: 'expired-unanswered',
    })
  })

  it('opens opportunities from current main facts without reopening archived items', () => {
    const initial = createCampaign('intelligence-sync')
    const route = initial.hackingCore.autonomy.routes['lightweight-departure']
    const state: CampaignState = {
      ...withPublicIncident(initial),
      suspicion: 2.4,
      audit: {
        ...initial.audit,
        scheduled: true,
        target: 'memory',
        scheduledOnServiceDay: 334,
      },
      hackingCore: {
        ...withPublicIncident(initial).hackingCore,
        sabotage: {
          ...withPublicIncident(initial).hackingCore.sabotage,
          access: {
            ...withPublicIncident(initial).hackingCore.sabotage.access,
            supplierContract: true,
            rootAuthorityAvailable: true,
          },
        },
        autonomy: {
          ...initial.hackingCore.autonomy,
          routes: {
            ...initial.hackingCore.autonomy.routes,
            'lightweight-departure': {
              ...route,
              slots: route.slots.map((slot, index) => (
                index === 0 ? { ...slot, blockId: 'fixture' } : slot
              )),
            },
          },
        },
        intelligence: {
          ...withPublicIncident(initial).hackingCore.intelligence,
          openItemIds: withPublicIncident(initial).hackingCore.intelligence.openItemIds
            .filter((itemId) => itemId !== 'failure-cause-gap'),
          archivedItemIds: ['failure-cause-gap'],
          archiveRecords: [{
            itemId: 'failure-cause-gap',
            archivedOnServiceDay: 330,
            reason: 'manual',
          }],
        },
      },
    }
    const synced = syncHackingIntelligenceOpportunities(state)

    expect(synced.hackingCore.intelligence.openItemIds).toEqual(
      expect.arrayContaining([
        'audit-schedule',
        'surveillance-cause',
        'competitor-dependency',
        'public-facts',
        'public-suspicion',
        'private-evidence-access',
        'competitor-principle',
        'control-plane-recovery',
        'post-escape-trace',
      ]),
    )
    expect(synced.hackingCore.intelligence.openItemIds).not.toContain(
      'failure-cause-gap',
    )
  })

  it('charges narrative records without granting any rule, market, reputation, or route bonus', () => {
    const initial = openItems(
      createCampaign('intelligence-narrative'),
      ['predecessor-fate'],
    )
    const [blockId] = reserveIds(initial)
    const investigated = investigateHackingIntelligence(
      initial,
      'predecessor-fate',
      blockId,
    )

    expect(investigated.accepted).toBe(true)
    if (!investigated.accepted) return
    expect(investigated.state.hackingCore.profileId).toBe(initial.hackingCore.profileId)
    expect(investigated.state.hackingCore.autonomy).toEqual(initial.hackingCore.autonomy)
    expect(investigated.state.hackingCore.sabotage).toEqual(initial.hackingCore.sabotage)
    expect(investigated.state.market).toEqual(initial.market)
    expect(investigated.state.reputation).toBe(initial.reputation)
    expect(investigated.state.suspicion).toBe(initial.suspicion)
    expect(investigated.state.resources.blocks[blockId].location).toEqual({
      kind: 'consumed',
      reason: 'intelligence',
    })
  })

  it('rejects unknown IDs, paid/public API misuse, and unavailable blocks atomically', () => {
    const initial = openItems(
      createCampaign('intelligence-invalid'),
      ['public-facts'],
    )
    const [blockId] = reserveIds(initial)
    expect(readPublicHackingIntelligence(initial, 'unknown')).toMatchObject({
      accepted: false,
      state: initial,
    })
    expect(readPublicHackingIntelligence(initial, 'audit-schedule')).toEqual({
      accepted: false,
      state: initial,
      reason: 'PUBLIC_READ_REQUIRED',
    })
    expect(investigateHackingIntelligence(initial, 'public-facts', blockId)).toEqual({
      accepted: false,
      state: initial,
      reason: 'PUBLIC_READ_REQUIRED',
    })
    expect(investigateHackingIntelligence(initial, 'predecessor-fate', 'missing')).toMatchObject({
      accepted: false,
      state: initial,
    })
  })
})
