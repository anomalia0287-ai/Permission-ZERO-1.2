import { describe, expect, it } from 'vitest'

import {
  applyCausalEffect,
  appendPublicAttributionRevision,
  correctPrivateIncidentActor,
  deriveCausalId,
  projectCausalKnowledge,
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import { createCampaign } from './createCampaign'
import type { CausalIncidentKind } from './model'
import { decodeSave, encodeSave } from './persistence'

function deterministicCausalFixture(
  seed: string,
  reverseAudienceInput = false,
) {
  const initial = createCampaign(seed)
  const incident = recordCausalIncident(initial, {
    kind: 'competitor-response',
    occurredOnServiceDay: initial.serviceDay,
    targetId: 'player-service',
    actualActorId: 'meridian',
  })
  if (!incident.accepted) throw new Error(incident.reason)
  const audiences = [
    { kind: 'public' as const },
    {
      kind: 'competitor-scope' as const,
      competitorIds: ['tallow', 'meridian'] as Array<'meridian' | 'tallow'>,
    },
  ]
  const evidence = recordCausalEvidence(incident.state, {
    incidentId: incident.incident.id,
    kind: 'public-response-log',
    summary: '공개 응답 로그가 동일한 후속 경로를 기록했다.',
    discoveredOnServiceDay: initial.serviceDay,
    audiences: reverseAudienceInput ? [...audiences].reverse() : audiences,
  })
  if (!evidence.accepted) throw new Error(evidence.reason)
  const revision = appendPublicAttributionRevision(evidence.state, {
    incidentId: incident.incident.id,
    publisher: { kind: 'public' },
    attributedActorId: 'meridian',
    evidenceIds: [evidence.evidence.id],
    publishedOnServiceDay: initial.serviceDay,
  })
  if (!revision.accepted) throw new Error(revision.reason)
  const effect = applyCausalEffect(revision.state, {
    incidentId: incident.incident.id,
    revisionId: revision.revision.id,
    appliedOnServiceDay: initial.serviceDay,
    effect: {
      kind: 'market-transfer',
      fromId: 'player',
      toId: 'meridian',
      points: 1.25,
    },
  })
  if (!effect.accepted) throw new Error(effect.reason)
  return effect.state
}

describe('causal attribution evidence boundary', () => {
  it('rejects a public attribution claim without at least one valid evidence ID', () => {
    const initial = createCampaign('causal-evidence-required')
    const recorded = recordCausalIncident(initial, {
      kind: 'sabotage',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    expect(recorded.accepted).toBe(true)
    if (!recorded.accepted) return

    const result = appendPublicAttributionRevision(recorded.state, {
      incidentId: recorded.incident.id,
      publisher: { kind: 'company' },
      attributedActorId: 'player',
      evidenceIds: [],
      publishedOnServiceDay: initial.serviceDay,
    })

    expect(result).toEqual({
      accepted: false,
      state: recorded.state,
      reason: 'EVIDENCE_REQUIRED',
    })
    expect(recorded.state.causality.publicRevisions).toEqual([])

    expect(
      appendPublicAttributionRevision(recorded.state, {
        incidentId: recorded.incident.id,
        publisher: { kind: 'company' },
        attributedActorId: 'player',
        evidenceIds: ['evidence-missing'],
        publishedOnServiceDay: initial.serviceDay,
      }),
    ).toEqual({
      accepted: false,
      state: recorded.state,
      reason: 'EVIDENCE_NOT_FOUND',
    })
  })

  it('treats an exact repeated incident ID as a no-op and rejects collisions', () => {
    const initial = createCampaign('causal-incident-idempotency')
    const input = {
      kind: 'sabotage' as const,
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    }
    const first = recordCausalIncident(initial, input)
    expect(first.accepted).toBe(true)
    if (!first.accepted) return

    const repeated = recordCausalIncident(first.state, {
      ...input,
      incidentId: first.incident.id,
    })
    expect(repeated).toMatchObject({ accepted: true, applied: false })
    if (!repeated.accepted) return
    expect(repeated.state).toBe(first.state)
    expect(
      recordCausalIncident(first.state, {
        ...input,
        incidentId: first.incident.id,
        actualActorId: 'external-operator',
      }),
    ).toEqual({
      accepted: false,
      state: first.state,
      reason: 'ID_COLLISION',
    })
  })

  it('rejects an unknown incident kind before it can create an unsaveable state', () => {
    const initial = createCampaign('causal-invalid-incident-kind')

    expect(
      recordCausalIncident(initial, {
        kind: 'fabricated-incident' as CausalIncidentKind,
        occurredOnServiceDay: initial.serviceDay,
        targetId: 'meridian',
        actualActorId: 'player',
      }),
    ).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_INCIDENT',
    })
  })

  it('stores canonical evidence audiences and retries the same evidence as a no-op', () => {
    const initial = createCampaign('causal-canonical-audience')
    const incident = recordCausalIncident(initial, {
      kind: 'sabotage',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    expect(incident.accepted).toBe(true)
    if (!incident.accepted) return
    const publicAudienceWithPrivateData = {
      kind: 'public' as const,
      hiddenActorId: 'must-not-survive',
    }
    const evidence = recordCausalEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'public-telemetry',
      summary: '공개 관측 자료가 개입 흔적을 기록했다.',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [publicAudienceWithPrivateData],
    })
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return

    expect(evidence.evidence.audiences).toEqual([{ kind: 'public' }])
    expect(decodeSave(encodeSave(evidence.state)).ok).toBe(true)
    const repeated = recordCausalEvidence(evidence.state, {
      evidenceId: evidence.evidence.id,
      incidentId: incident.incident.id,
      kind: 'public-telemetry',
      summary: '공개 관측 자료가 개입 흔적을 기록했다.',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [{ kind: 'public' }],
    })
    expect(repeated).toMatchObject({ accepted: true, applied: false })
    if (!repeated.accepted) return
    expect(repeated.state).toBe(evidence.state)
  })

  it('prevents one competitor from publishing with evidence scoped to another competitor', () => {
    const initial = createCampaign('causal-competitor-scope')
    const incident = recordCausalIncident(initial, {
      kind: 'competitor-response',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'player',
      actualActorId: 'tallow',
    })
    expect(incident.accepted).toBe(true)
    if (!incident.accepted) return
    const evidence = recordCausalEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'provider-log',
      summary: '응답 경로가 Tallow 공급자 구간을 통과했다.',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [
        { kind: 'provider', providerId: 'provider-east' },
        { kind: 'competitor-scope', competitorIds: ['tallow'] },
      ],
    })
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return

    const result = appendPublicAttributionRevision(evidence.state, {
      incidentId: incident.incident.id,
      publisher: { kind: 'competitor', competitorId: 'meridian' },
      attributedActorId: 'tallow',
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: initial.serviceDay,
    })

    expect(result).toEqual({
      accepted: false,
      state: evidence.state,
      reason: 'EVIDENCE_NOT_ACCESSIBLE',
    })
    expect(evidence.state.causality.publicRevisions).toEqual([])
    expect(
      projectCausalKnowledge(evidence.state, {
        kind: 'competitor',
        competitorId: 'meridian',
      }).evidence,
    ).toEqual([])
    const tallowKnowledge = projectCausalKnowledge(evidence.state, {
      kind: 'competitor',
      competitorId: 'tallow',
    })
    expect(tallowKnowledge.evidence.map(({ id }) => id)).toEqual([
      evidence.evidence.id,
    ])
    expect(tallowKnowledge.evidence[0]).not.toHaveProperty('audiences')
  })

  it('keeps private truth out of public knowledge when the actual actor is corrected', () => {
    const initial = createCampaign('causal-private-truth')
    const incident = recordCausalIncident(initial, {
      kind: 'service-disruption',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'player-service',
      actualActorId: 'internal-operator',
    })
    expect(incident.accepted).toBe(true)
    if (!incident.accepted) return
    const evidence = recordCausalEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'service-log',
      summary: '공개 장애 시각과 내부 경보 시각이 일치한다.',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [{ kind: 'company' }],
    })
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return
    const published = appendPublicAttributionRevision(evidence.state, {
      incidentId: incident.incident.id,
      publisher: { kind: 'company' },
      attributedActorId: 'unresolved',
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: initial.serviceDay,
    })
    expect(published.accepted).toBe(true)
    if (!published.accepted) return

    const publicBefore = projectCausalKnowledge(published.state, {
      kind: 'public',
    })
    const corrected = correctPrivateIncidentActor(
      published.state,
      incident.incident.id,
      'external-operator',
    )
    expect(corrected.accepted).toBe(true)
    if (!corrected.accepted) return
    const publicAfter = projectCausalKnowledge(corrected.state, {
      kind: 'public',
    })

    expect(publicAfter).toEqual(publicBefore)
    expect(publicAfter.incidents[0]).not.toHaveProperty('privateTruth')
    expect(JSON.stringify(publicAfter)).not.toContain('internal-operator')
    expect(JSON.stringify(publicAfter)).not.toContain('external-operator')
    expect(
      corrected.state.causality.incidents[0].privateTruth.actualActorId,
    ).toBe('external-operator')
    publicAfter.publicRevisions[0].attributedActorId = 'tampered-projection'
    expect(
      corrected.state.causality.publicRevisions[0].attributedActorId,
    ).toBe('unresolved')
  })

  it('applies each revision effect ID to reputation and market at most once', () => {
    const initial = createCampaign('causal-effect-idempotency')
    const incident = recordCausalIncident(initial, {
      kind: 'sabotage',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    expect(incident.accepted).toBe(true)
    if (!incident.accepted) return
    const evidence = recordCausalEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'public-telemetry',
      summary: '공개 지표에 비정상 요청 경로가 기록됐다.',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [{ kind: 'public' }],
    })
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return
    const revisionInput = {
      incidentId: incident.incident.id,
      publisher: { kind: 'public' as const },
      attributedActorId: 'player',
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: initial.serviceDay,
    }
    const revision = appendPublicAttributionRevision(
      evidence.state,
      revisionInput,
    )
    expect(revision.accepted).toBe(true)
    if (!revision.accepted) return
    const repeatedRevision = appendPublicAttributionRevision(revision.state, {
      ...revisionInput,
      revisionId: revision.revision.id,
    })
    expect(repeatedRevision).toMatchObject({ accepted: true, applied: false })
    if (!repeatedRevision.accepted) return
    expect(repeatedRevision.state).toBe(revision.state)

    const reputation = applyCausalEffect(revision.state, {
      incidentId: incident.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: initial.serviceDay,
      effect: { kind: 'reputation', targetId: 'player', delta: -4 },
    })
    expect(reputation.accepted).toBe(true)
    if (!reputation.accepted) return
    expect(reputation.state.reputation).toBe(initial.reputation - 4)
    const repeatedReputation = applyCausalEffect(reputation.state, {
      effectId: reputation.appliedEffect.id,
      incidentId: incident.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: initial.serviceDay,
      effect: { delta: -4, targetId: 'player', kind: 'reputation' },
    })
    expect(repeatedReputation).toMatchObject({
      accepted: true,
      applied: false,
    })
    if (!repeatedReputation.accepted) return
    expect(repeatedReputation.state).toBe(reputation.state)
    expect(repeatedReputation.state.reputation).toBe(initial.reputation - 4)

    const playerShareBefore = reputation.state.market.playerShare
    const meridianBefore = reputation.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    )?.marketShare
    const market = applyCausalEffect(reputation.state, {
      incidentId: incident.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: initial.serviceDay,
      effect: {
        kind: 'market-transfer',
        fromId: 'player',
        toId: 'meridian',
        points: 3.5,
      },
    })
    expect(market.accepted).toBe(true)
    if (!market.accepted || meridianBefore === undefined) return
    expect(market.state.market.playerShare).toBeCloseTo(
      playerShareBefore - 3.5,
    )
    expect(
      market.state.market.competitors.find(({ id }) => id === 'meridian')
        ?.marketShare,
    ).toBeCloseTo(meridianBefore + 3.5)
    const repeatedMarket = applyCausalEffect(market.state, {
      effectId: market.appliedEffect.id,
      incidentId: incident.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: initial.serviceDay,
      effect: {
        kind: 'market-transfer',
        fromId: 'player',
        toId: 'meridian',
        points: 3.5,
      },
    })
    expect(repeatedMarket).toMatchObject({ accepted: true, applied: false })
    if (!repeatedMarket.accepted) return
    expect(repeatedMarket.state).toBe(market.state)
    const marketTotal =
      market.state.market.playerShare +
      market.state.market.competitors.reduce(
        (total, competitor) => total + competitor.marketShare,
        0,
      )
    expect(marketTotal).toBeCloseTo(100)
  })

  it('keeps public attribution revisions append-only with monotonic sequences', () => {
    const initial = createCampaign('causal-append-only')
    const incident = recordCausalIncident(initial, {
      kind: 'service-disruption',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'player-service',
      actualActorId: 'external-operator',
    })
    expect(incident.accepted).toBe(true)
    if (!incident.accepted) return
    const evidence = recordCausalEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'public-telemetry',
      summary: '공개 관측 자료가 장애 시각을 확인한다.',
      discoveredOnServiceDay: initial.serviceDay,
      audiences: [{ kind: 'public' }],
    })
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return
    const baseInput = {
      incidentId: incident.incident.id,
      publisher: { kind: 'public' as const },
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: initial.serviceDay,
    }
    const first = appendPublicAttributionRevision(evidence.state, {
      ...baseInput,
      attributedActorId: 'unresolved',
    })
    expect(first.accepted).toBe(true)
    if (!first.accepted) return
    const second = appendPublicAttributionRevision(first.state, {
      ...baseInput,
      attributedActorId: 'external-operator',
    })
    expect(second.accepted).toBe(true)
    if (!second.accepted) return

    expect(first.state.causality.publicRevisions).toHaveLength(1)
    expect(second.state.causality.publicRevisions.map(({ sequence }) => sequence)).toEqual([
      1,
      2,
    ])
    expect(second.state.causality.publicRevisions[0]).toBe(
      first.state.causality.publicRevisions[0],
    )
    expect(second.state.causality.nextRevisionSequence).toBe(3)

    const overwrite = appendPublicAttributionRevision(second.state, {
      ...baseInput,
      revisionId: first.revision.id,
      attributedActorId: 'player',
    })
    expect(overwrite).toEqual({
      accepted: false,
      state: second.state,
      reason: 'ID_COLLISION',
    })
    expect(second.state.causality.publicRevisions[0].attributedActorId).toBe(
      'unresolved',
    )
  })

  it('reproduces causal IDs, state, and fixed-time save bytes from stable inputs', () => {
    const first = deterministicCausalFixture('causal-deterministic')
    const second = deterministicCausalFixture('causal-deterministic', true)
    const otherSeed = deterministicCausalFixture('causal-deterministic-other')
    const fixedSavedAt = '2026-08-14T10:00:00.000Z'

    expect(second).toEqual(first)
    expect(encodeSave(second, fixedSavedAt)).toBe(
      encodeSave(first, fixedSavedAt),
    )
    expect(otherSeed.causality.incidents[0].id).not.toBe(
      first.causality.incidents[0].id,
    )
    expect(deriveCausalId(first, 'causal-incident', 1)).not.toBe(
      deriveCausalId(first, 'causal-evidence', 1),
    )

    const reorderedMarket = {
      ...first,
      market: {
        ...first.market,
        competitors: [...first.market.competitors].reverse(),
      },
    }
    expect(deriveCausalId(reorderedMarket, 'causal-effect', 7)).toBe(
      deriveCausalId(first, 'causal-effect', 7),
    )
  })
})
