import { describe, expect, it } from 'vitest'

import {
  applyCausalEffect,
  appendPublicAttributionRevision,
  correctPrivateIncidentActor,
  createEmptyCausalState,
  deriveAttributionConfidence,
  deriveCausalId,
  projectCausalKnowledge,
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import { nativeCommandProtocol } from './commandProtocol'
import { createCampaign } from './createCampaign'
import type {
  CampaignState,
  CausalIncident,
  NativeCausalActionId,
  NativeCausalEvidenceKind,
} from './model'
import { random01 } from './rng'

function createCausalCampaign(seed: string): CampaignState {
  return {
    ...createCampaign(seed),
    commandProtocol: nativeCommandProtocol(),
    causality: createEmptyCausalState(),
  } as CampaignState
}

function recordQualityIncident(
  state: CampaignState,
  incidentId = 'incident-quality',
) {
  return recordCausalIncident(state, {
    incidentId,
    actionId: 'sabotage.quality-degradation',
    parentIncidentId: null,
    kind: 'sabotage',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
}

function recordRollbackIncident(
  state: CampaignState,
  parentIncidentId: string,
  profile: 'fast' | 'standard' | 'forensic' = 'standard',
  incidentId = `incident-rollback-${profile}`,
) {
  return recordCausalIncident(state, {
    incidentId,
    actionId: `response.meridian.rollback.${profile}`,
    parentIncidentId,
    kind: 'competitor-response',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'meridian',
  })
}

function recordRecoveryIncident(
  state: CampaignState,
  parentIncidentId: string,
  incidentId = 'incident-recovery',
) {
  return recordCausalIncident(state, {
    incidentId,
    actionId: 'follow-up.recovery-contamination',
    parentIncidentId,
    kind: 'service-disruption',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'external-operator',
  })
}

function createNativeChain(seed: string) {
  const initial = createCausalCampaign(seed)
  const quality = recordQualityIncident(initial)
  if (!quality.accepted) throw new Error(quality.reason)
  const rollback = recordRollbackIncident(
    quality.state,
    quality.incident.id,
  )
  if (!rollback.accepted) throw new Error(rollback.reason)
  const recovery = recordRecoveryIncident(
    rollback.state,
    rollback.incident.id,
  )
  if (!recovery.accepted) throw new Error(recovery.reason)
  return { initial, quality, rollback, recovery }
}

function recordNativeEvidence(
  state: CampaignState,
  incidentId: string,
  kind: NativeCausalEvidenceKind,
  evidenceId = `evidence-${kind}`,
) {
  const audiences = {
    'meridian-quality-regression': [
      { kind: 'competitor' as const, competitorId: 'meridian' as const },
    ],
    'company-observed-meridian-rollback': [
      { kind: 'company' as const },
      { kind: 'competitor' as const, competitorId: 'meridian' as const },
    ],
    'public-recovery-checksum-anomaly': [{ kind: 'public' as const }],
    'provider-timing-correlation': [
      {
        kind: 'provider' as const,
        providerId: 'provider.meridian-recovery',
      },
    ],
    'provider-signed-route-record': [
      {
        kind: 'provider' as const,
        providerId: 'provider.meridian-recovery',
      },
    ],
  }[kind]

  return recordCausalEvidence(state, {
    evidenceId,
    incidentId,
    kind,
    summary: `stable summary for ${kind}`,
    discoveredOnServiceDay: state.serviceDay,
    audiences,
  })
}

describe('causal incident relations', () => {
  it('accepts the complete native action matrix as a monotonic chain', () => {
    const initial = createCausalCampaign('causal-native-matrix')
    const quality = recordQualityIncident(initial)
    expect(quality).toMatchObject({ accepted: true, applied: true })
    if (!quality.accepted) return

    let state = quality.state
    const rollbacks = []
    for (const profile of ['fast', 'standard', 'forensic'] as const) {
      const rollback = recordRollbackIncident(
        state,
        quality.incident.id,
        profile,
      )
      expect(rollback).toMatchObject({ accepted: true, applied: true })
      if (!rollback.accepted) return
      rollbacks.push(rollback.incident)
      state = rollback.state
    }

    const recovery = recordRecoveryIncident(state, rollbacks[1].id)
    expect(recovery).toMatchObject({ accepted: true, applied: true })
    if (!recovery.accepted) return

    expect(recovery.state.causality.rulesVersion).toBe(2)
    expect(
      recovery.state.causality.incidents.map(
        ({ sequence, actionId, kind, targetId, parentIncidentId }) => ({
          sequence,
          actionId,
          kind,
          targetId,
          parentIncidentId,
        }),
      ),
    ).toEqual([
      {
        sequence: 1,
        actionId: 'sabotage.quality-degradation',
        kind: 'sabotage',
        targetId: 'meridian',
        parentIncidentId: null,
      },
      ...(['fast', 'standard', 'forensic'] as const).map(
        (profile, index) => ({
          sequence: index + 2,
          actionId: `response.meridian.rollback.${profile}`,
          kind: 'competitor-response',
          targetId: 'meridian',
          parentIncidentId: quality.incident.id,
        }),
      ),
      {
        sequence: 5,
        actionId: 'follow-up.recovery-contamination',
        kind: 'service-disruption',
        targetId: 'meridian',
        parentIncidentId: rollbacks[1].id,
      },
    ])
  })

  it('retries the same explicit incident as an exact no-op and rejects ID collisions', () => {
    const initial = createCausalCampaign('causal-incident-idempotency')
    const input = {
      incidentId: 'stable-quality-id',
      actionId: 'sabotage.quality-degradation' as const,
      parentIncidentId: null,
      kind: 'sabotage' as const,
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    }
    const first = recordCausalIncident(initial, input)
    expect(first).toMatchObject({ accepted: true, applied: true })
    if (!first.accepted) return

    const repeated = recordCausalIncident(first.state, input)
    expect(repeated).toMatchObject({ accepted: true, applied: false })
    if (!repeated.accepted) return
    expect(repeated.state).toBe(first.state)
    expect(repeated.incident).toBe(first.incident)

    const collision = recordCausalIncident(first.state, {
      ...input,
      actualActorId: 'external-operator',
    })
    expect(collision).toEqual({
      accepted: false,
      state: first.state,
      reason: 'ID_COLLISION',
    })
  })

  it.each([
    'legacy.sabotage',
    'legacy.competitor-response',
    'legacy.service-disruption',
  ] as const)('rejects native construction with legacy action %s', (actionId) => {
    const initial = createCausalCampaign(`causal-${actionId}`)
    const result = recordCausalIncident(initial, {
      actionId: actionId as NativeCausalActionId,
      parentIncidentId: null,
      kind: 'sabotage',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })

    expect(result).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_ACTION',
    })
  })

  it('rejects response and follow-up actions without a parent', () => {
    const initial = createCausalCampaign('causal-parent-required')

    for (const input of [
      {
        actionId: 'response.meridian.rollback.fast' as const,
        kind: 'competitor-response' as const,
      },
      {
        actionId: 'follow-up.recovery-contamination' as const,
        kind: 'service-disruption' as const,
      },
    ]) {
      const result = recordCausalIncident(initial, {
        ...input,
        parentIncidentId: null,
        occurredOnServiceDay: initial.serviceDay,
        targetId: 'meridian',
        actualActorId: 'external-operator',
      })
      expect(result).toEqual({
        accepted: false,
        state: initial,
        reason: 'INVALID_PARENT_INCIDENT',
      })
    }
  })

  it('rejects missing and self parents without mutating the state', () => {
    const initial = createCausalCampaign('causal-invalid-parent')
    const missing = recordRollbackIncident(initial, 'missing-parent')
    expect(missing).toEqual({
      accepted: false,
      state: initial,
      reason: 'INVALID_PARENT_INCIDENT',
    })

    const self = recordCausalIncident(initial, {
      incidentId: 'self-incident',
      actionId: 'response.meridian.rollback.standard',
      parentIncidentId: 'self-incident',
      kind: 'competitor-response',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'meridian',
    })
    expect(self).toEqual({
      accepted: false,
      state: initial,
      reason: 'CAUSAL_CYCLE',
    })
  })

  it.each([
    {
      label: 'future sequence',
      mutate: (parent: CausalIncident, state: CampaignState) => ({
        parent: { ...parent, sequence: state.causality.nextIncidentSequence },
        childDay: state.serviceDay,
      }),
    },
    {
      label: 'future day',
      mutate: (parent: CausalIncident, state: CampaignState) => ({
        parent: { ...parent, occurredOnServiceDay: state.serviceDay + 1 },
        childDay: state.serviceDay,
      }),
    },
    {
      label: 'wrong action',
      mutate: (parent: CausalIncident, state: CampaignState) => ({
        parent: { ...parent, actionId: 'legacy.sabotage' as const },
        childDay: state.serviceDay,
      }),
    },
    {
      label: 'wrong kind',
      mutate: (parent: CausalIncident, state: CampaignState) => ({
        parent: { ...parent, kind: 'service-disruption' as const },
        childDay: state.serviceDay,
      }),
    },
    {
      label: 'wrong target',
      mutate: (parent: CausalIncident, state: CampaignState) => ({
        parent: { ...parent, targetId: 'tallow' },
        childDay: state.serviceDay,
      }),
    },
  ])('rejects a structurally incompatible $label parent', ({ mutate }) => {
    const initial = createCausalCampaign('causal-parent-structure')
    const quality = recordQualityIncident(initial)
    expect(quality.accepted).toBe(true)
    if (!quality.accepted) return
    const changed = mutate(quality.incident, quality.state)
    const state = {
      ...quality.state,
      causality: {
        ...quality.state.causality,
        incidents: [changed.parent],
      },
    }

    const result = recordCausalIncident(state, {
      actionId: 'response.meridian.rollback.standard',
      parentIncidentId: changed.parent.id,
      kind: 'competitor-response',
      occurredOnServiceDay: changed.childDay,
      targetId: 'meridian',
      actualActorId: 'meridian',
    })
    expect(result).toEqual({
      accepted: false,
      state,
      reason: 'INVALID_PARENT_INCIDENT',
    })
  })

  it('detects an existing ancestry loop before accepting another child', () => {
    const initial = createCausalCampaign('causal-cycle')
    const first: CausalIncident = {
      id: 'cycle-a',
      sequence: 1,
      actionId: 'response.meridian.rollback.standard',
      parentIncidentId: 'cycle-b',
      kind: 'competitor-response',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      privateTruth: { actualActorId: 'meridian' },
    }
    const second: CausalIncident = {
      ...first,
      id: 'cycle-b',
      sequence: 2,
      parentIncidentId: 'cycle-a',
    }
    const state: CampaignState = {
      ...initial,
      causality: {
        ...initial.causality,
        nextIncidentSequence: 3,
        incidents: [first, second],
      },
    }

    const result = recordRecoveryIncident(state, second.id)
    expect(result).toEqual({
      accepted: false,
      state,
      reason: 'CAUSAL_CYCLE',
    })
  })

  it('rejects a second child with the same parent and action', () => {
    const initial = createCausalCampaign('causal-duplicate-relation')
    const quality = recordQualityIncident(initial)
    expect(quality.accepted).toBe(true)
    if (!quality.accepted) return
    const first = recordRollbackIncident(
      quality.state,
      quality.incident.id,
      'standard',
      'first-standard-rollback',
    )
    expect(first.accepted).toBe(true)
    if (!first.accepted) return

    const duplicate = recordRollbackIncident(
      first.state,
      quality.incident.id,
      'standard',
      'second-standard-rollback',
    )
    expect(duplicate).toEqual({
      accepted: false,
      state: first.state,
      reason: 'INVALID_ACTION',
    })
  })
})

describe('native causal evidence and attribution confidence', () => {
  it.each([
    {
      kind: 'meridian-quality-regression' as const,
      incident: 'quality' as const,
      audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
    },
    {
      kind: 'company-observed-meridian-rollback' as const,
      incident: 'rollback' as const,
      audiences: [
        { kind: 'company' },
        { kind: 'competitor', competitorId: 'meridian' },
      ],
    },
    {
      kind: 'public-recovery-checksum-anomaly' as const,
      incident: 'recovery' as const,
      audiences: [{ kind: 'public' }],
    },
    {
      kind: 'provider-timing-correlation' as const,
      incident: 'recovery' as const,
      audiences: [
        {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
      ],
    },
    {
      kind: 'provider-signed-route-record' as const,
      incident: 'recovery' as const,
      audiences: [
        {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
      ],
    },
  ])('records $kind only against its canonical incident and audience set', ({
    kind,
    incident,
    audiences,
  }) => {
    const chain = createNativeChain(`causal-evidence-${kind}`)
    const target = chain[incident].incident
    const result = recordCausalEvidence(chain.recovery.state, {
      incidentId: target.id,
      kind,
      summary: `summary for ${kind}`,
      discoveredOnServiceDay: chain.initial.serviceDay,
      audiences: [...audiences].reverse() as never,
    })

    expect(result).toMatchObject({ accepted: true, applied: true })
    if (!result.accepted) return
    expect(result.evidence.audiences).toEqual(audiences)

    const repeated = recordCausalEvidence(result.state, {
      evidenceId: result.evidence.id,
      incidentId: target.id,
      kind,
      summary: `summary for ${kind}`,
      discoveredOnServiceDay: chain.initial.serviceDay,
      audiences: audiences as never,
    })
    expect(repeated).toMatchObject({ accepted: true, applied: false })
    if (!repeated.accepted) return
    expect(repeated.state).toBe(result.state)
    expect(repeated.evidence).toBe(result.evidence)
  })

  it('rejects unknown evidence, wrong incident actions, and noncanonical audiences', () => {
    const chain = createNativeChain('causal-invalid-evidence')
    const state = chain.recovery.state
    const invalidInputs = [
      {
        incidentId: chain.quality.incident.id,
        kind: 'arbitrary-prose-kind',
        audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
      },
      {
        incidentId: chain.rollback.incident.id,
        kind: 'meridian-quality-regression',
        audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
      },
      {
        incidentId: chain.recovery.incident.id,
        kind: 'provider-timing-correlation',
        audiences: [{ kind: 'provider', providerId: 'provider.wrong' }],
      },
      {
        incidentId: chain.recovery.incident.id,
        kind: 'public-recovery-checksum-anomaly',
        audiences: [{ kind: 'public' }, { kind: 'company' }],
      },
    ]

    for (const input of invalidInputs) {
      const result = recordCausalEvidence(state, {
        ...input,
        kind: input.kind as NativeCausalEvidenceKind,
        summary: 'invalid evidence fixture',
        discoveredOnServiceDay: chain.initial.serviceDay,
        audiences: input.audiences as never,
      })
      expect(result).toEqual({
        accepted: false,
        state,
        reason: 'INVALID_EVIDENCE',
      })
    }
  })

  it('derives confidence from stable evidence kinds without parsing prose', () => {
    expect(
      deriveAttributionConfidence(['public-recovery-checksum-anomaly']),
    ).toBe('unconfirmed')
    expect(
      deriveAttributionConfidence(['provider-timing-correlation']),
    ).toBe('plausible')
    expect(
      deriveAttributionConfidence(['provider-signed-route-record']),
    ).toBe('credible')
    expect(
      deriveAttributionConfidence([
        'public-recovery-checksum-anomaly',
        'provider-timing-correlation',
        'provider-signed-route-record',
      ]),
    ).toBe('credible')
    expect(deriveAttributionConfidence(['meridian-quality-regression'])).toBeNull()
    expect(deriveAttributionConfidence(['unavailable-legacy'])).toBeNull()
  })

  it.each([
    {
      kind: 'public-recovery-checksum-anomaly' as const,
      publisher: { kind: 'public' as const },
      actor: 'unresolved',
      confidence: 'unconfirmed',
    },
    {
      kind: 'provider-timing-correlation' as const,
      publisher: {
        kind: 'provider' as const,
        providerId: 'provider.meridian-recovery',
      },
      actor: 'external-operator',
      confidence: 'plausible',
    },
    {
      kind: 'provider-signed-route-record' as const,
      publisher: {
        kind: 'provider' as const,
        providerId: 'provider.meridian-recovery',
      },
      actor: 'external-operator',
      confidence: 'credible',
    },
  ])('derives $confidence revisions from $kind evidence', ({
    kind,
    publisher,
    actor,
    confidence,
  }) => {
    const chain = createNativeChain(`causal-confidence-${kind}`)
    const evidence = recordNativeEvidence(
      chain.recovery.state,
      chain.recovery.incident.id,
      kind,
    )
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return

    const revision = appendPublicAttributionRevision(evidence.state, {
      incidentId: chain.recovery.incident.id,
      publisher,
      attributedActorId: actor,
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: chain.initial.serviceDay,
      confidence: 'unavailable-legacy',
    } as Parameters<typeof appendPublicAttributionRevision>[1] & {
      confidence: 'unavailable-legacy'
    })
    expect(revision).toMatchObject({ accepted: true, applied: true })
    if (!revision.accepted) return
    expect(revision.revision.confidence).toBe(confidence)
    expect(revision.revision.confidence).not.toBe('unavailable-legacy')
  })

  it('lets stronger accessible provider evidence deterministically win', () => {
    const chain = createNativeChain('causal-strongest-confidence')
    const checksum = recordNativeEvidence(
      chain.recovery.state,
      chain.recovery.incident.id,
      'public-recovery-checksum-anomaly',
      'evidence-checksum',
    )
    expect(checksum.accepted).toBe(true)
    if (!checksum.accepted) return
    const timing = recordNativeEvidence(
      checksum.state,
      chain.recovery.incident.id,
      'provider-timing-correlation',
      'evidence-timing',
    )
    expect(timing.accepted).toBe(true)
    if (!timing.accepted) return

    const revision = appendPublicAttributionRevision(timing.state, {
      incidentId: chain.recovery.incident.id,
      publisher: {
        kind: 'provider',
        providerId: 'provider.meridian-recovery',
      },
      attributedActorId: 'external-operator',
      evidenceIds: [timing.evidence.id, checksum.evidence.id],
      publishedOnServiceDay: chain.initial.serviceDay,
    })
    expect(revision).toMatchObject({
      accepted: true,
      revision: { confidence: 'plausible' },
    })
  })

  it('rejects arbitrary claim pairs, inaccessible citations, and evidence-free claims', () => {
    const chain = createNativeChain('causal-invalid-claim')
    const checksum = recordNativeEvidence(
      chain.recovery.state,
      chain.recovery.incident.id,
      'public-recovery-checksum-anomaly',
    )
    expect(checksum.accepted).toBe(true)
    if (!checksum.accepted) return
    const timing = recordNativeEvidence(
      checksum.state,
      chain.recovery.incident.id,
      'provider-timing-correlation',
    )
    expect(timing.accepted).toBe(true)
    if (!timing.accepted) return

    expect(
      appendPublicAttributionRevision(timing.state, {
        incidentId: chain.recovery.incident.id,
        publisher: { kind: 'public' },
        attributedActorId: 'external-operator',
        evidenceIds: [checksum.evidence.id],
        publishedOnServiceDay: chain.initial.serviceDay,
      }),
    ).toEqual({
      accepted: false,
      state: timing.state,
      reason: 'INVALID_REVISION',
    })
    expect(
      appendPublicAttributionRevision(timing.state, {
        incidentId: chain.recovery.incident.id,
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        evidenceIds: [timing.evidence.id],
        publishedOnServiceDay: chain.initial.serviceDay,
      }),
    ).toEqual({
      accepted: false,
      state: timing.state,
      reason: 'EVIDENCE_NOT_ACCESSIBLE',
    })
    expect(
      appendPublicAttributionRevision(timing.state, {
        incidentId: chain.recovery.incident.id,
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        evidenceIds: [],
        publishedOnServiceDay: chain.initial.serviceDay,
      }),
    ).toEqual({
      accepted: false,
      state: timing.state,
      reason: 'EVIDENCE_REQUIRED',
    })
    expect(
      appendPublicAttributionRevision(timing.state, {
        incidentId: chain.recovery.incident.id,
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        evidenceIds: ['missing-evidence'],
        publishedOnServiceDay: chain.initial.serviceDay,
      }),
    ).toEqual({
      accepted: false,
      state: timing.state,
      reason: 'EVIDENCE_NOT_FOUND',
    })
  })

  it('rejects new native-confidence revisions on migrated legacy incidents', () => {
    const initial = createCausalCampaign('causal-legacy-revision-boundary')
    const incident: CausalIncident = {
      id: 'legacy-incident',
      sequence: 1,
      actionId: 'legacy.service-disruption',
      parentIncidentId: null,
      kind: 'service-disruption',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'legacy-recovery-service',
      privateTruth: { actualActorId: 'legacy-unknown' },
    }
    const state: CampaignState = {
      ...initial,
      causality: {
        ...initial.causality,
        nextIncidentSequence: 2,
        nextEvidenceSequence: 2,
        incidents: [incident],
        evidence: [
          {
            id: 'legacy-evidence-with-native-kind',
            sequence: 1,
            incidentId: incident.id,
            kind: 'public-recovery-checksum-anomaly',
            summary: 'v6에서 작성자가 사용한 우연히 같은 증거 ID',
            discoveredOnServiceDay: initial.serviceDay,
            audiences: [{ kind: 'public' }],
          },
        ],
      },
    }

    expect(
      appendPublicAttributionRevision(state, {
        incidentId: incident.id,
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        evidenceIds: ['legacy-evidence-with-native-kind'],
        publishedOnServiceDay: initial.serviceDay,
      }),
    ).toEqual({
      accepted: false,
      state,
      reason: 'INVALID_REVISION',
    })
  })
})

describe('causal knowledge projection', () => {
  it('shows incident shells only through accessible evidence or a public revision', () => {
    const initial = createCausalCampaign('causal-shell-visibility')
    const qualityA = recordQualityIncident(initial, 'quality-a')
    expect(qualityA.accepted).toBe(true)
    if (!qualityA.accepted) return
    const qualityB = recordQualityIncident(qualityA.state, 'quality-b')
    expect(qualityB.accepted).toBe(true)
    if (!qualityB.accepted) return
    const rollbackB = recordRollbackIncident(
      qualityB.state,
      qualityB.incident.id,
      'forensic',
      'rollback-b',
    )
    expect(rollbackB.accepted).toBe(true)
    if (!rollbackB.accepted) return
    const recoveryB = recordRecoveryIncident(
      rollbackB.state,
      rollbackB.incident.id,
      'recovery-b',
    )
    expect(recoveryB.accepted).toBe(true)
    if (!recoveryB.accepted) return
    const qualityEvidence = recordNativeEvidence(
      recoveryB.state,
      qualityA.incident.id,
      'meridian-quality-regression',
      'evidence-quality-a',
    )
    expect(qualityEvidence.accepted).toBe(true)
    if (!qualityEvidence.accepted) return
    const providerEvidence = recordNativeEvidence(
      qualityEvidence.state,
      recoveryB.incident.id,
      'provider-timing-correlation',
      'evidence-recovery-b',
    )
    expect(providerEvidence.accepted).toBe(true)
    if (!providerEvidence.accepted) return

    const meridianBefore = projectCausalKnowledge(providerEvidence.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })
    const providerBefore = projectCausalKnowledge(providerEvidence.state, {
      kind: 'provider',
      providerId: 'provider.meridian-recovery',
    })
    expect(meridianBefore.incidents.map(({ id }) => id)).toEqual([
      qualityA.incident.id,
    ])
    expect(providerBefore.incidents.map(({ id }) => id)).toEqual([
      recoveryB.incident.id,
    ])

    const published = appendPublicAttributionRevision(
      providerEvidence.state,
      {
        incidentId: recoveryB.incident.id,
        publisher: {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
        attributedActorId: 'external-operator',
        evidenceIds: [providerEvidence.evidence.id],
        publishedOnServiceDay: initial.serviceDay,
      },
    )
    expect(published.accepted).toBe(true)
    if (!published.accepted) return

    const meridianAfter = projectCausalKnowledge(published.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })
    expect(meridianAfter.incidents.map(({ id }) => id)).toEqual([
      qualityA.incident.id,
      recoveryB.incident.id,
    ])
    expect(meridianAfter.evidence.map(({ id }) => id)).toEqual([
      qualityEvidence.evidence.id,
    ])
    expect(meridianAfter.publicRevisions).toEqual([
      {
        id: published.revision.id,
        sequence: published.revision.sequence,
        incidentId: recoveryB.incident.id,
        publisher: {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
        attributedActorId: 'external-operator',
        confidence: 'plausible',
        publishedOnServiceDay: initial.serviceDay,
      },
    ])
    expect(
      meridianAfter.incidents.find(({ id }) => id === recoveryB.incident.id)
        ?.latestPublicAttribution,
    ).toMatchObject({ confidence: 'plausible' })

    const serialized = JSON.stringify(meridianAfter)
    expect(serialized).not.toContain('privateTruth')
    expect(serialized).not.toContain('actionId')
    expect(serialized).not.toContain('parentIncidentId')
    expect(serialized).not.toContain('evidenceIds')
  })

  it('keeps private actor corrections outside every projected field', () => {
    const chain = createNativeChain('causal-private-correction')
    const evidence = recordNativeEvidence(
      chain.recovery.state,
      chain.recovery.incident.id,
      'public-recovery-checksum-anomaly',
    )
    expect(evidence.accepted).toBe(true)
    if (!evidence.accepted) return
    const revision = appendPublicAttributionRevision(evidence.state, {
      incidentId: chain.recovery.incident.id,
      publisher: { kind: 'public' },
      attributedActorId: 'unresolved',
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: chain.initial.serviceDay,
    })
    expect(revision.accepted).toBe(true)
    if (!revision.accepted) return
    const before = projectCausalKnowledge(revision.state, { kind: 'public' })
    const corrected = correctPrivateIncidentActor(
      revision.state,
      chain.recovery.incident.id,
      'corrected-private-actor',
    )
    expect(corrected.accepted).toBe(true)
    if (!corrected.accepted) return
    const after = projectCausalKnowledge(corrected.state, { kind: 'public' })

    expect(after).toEqual(before)
    expect(JSON.stringify(after)).not.toContain('corrected-private-actor')
    after.publicRevisions[0].attributedActorId = 'tampered-projection'
    expect(
      corrected.state.causality.publicRevisions[0].attributedActorId,
    ).toBe('unresolved')
  })
})

describe('causal revision effects and deterministic IDs', () => {
  function createPublishedChecksum(seed: string) {
    const chain = createNativeChain(seed)
    const evidence = recordNativeEvidence(
      chain.recovery.state,
      chain.recovery.incident.id,
      'public-recovery-checksum-anomaly',
    )
    if (!evidence.accepted) throw new Error(evidence.reason)
    const revision = appendPublicAttributionRevision(evidence.state, {
      incidentId: chain.recovery.incident.id,
      publisher: { kind: 'public' },
      attributedActorId: 'unresolved',
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: chain.initial.serviceDay,
    })
    if (!revision.accepted) throw new Error(revision.reason)
    return { chain, evidence, revision }
  }

  it('keeps revisions append-only and exact retries idempotent', () => {
    const { chain, revision } = createPublishedChecksum(
      'causal-revision-idempotency',
    )
    const input = {
      revisionId: revision.revision.id,
      incidentId: chain.recovery.incident.id,
      publisher: { kind: 'public' as const },
      attributedActorId: 'unresolved',
      evidenceIds: [revision.revision.evidenceIds[0]],
      publishedOnServiceDay: chain.initial.serviceDay,
    }
    const repeated = appendPublicAttributionRevision(revision.state, input)
    expect(repeated).toMatchObject({ accepted: true, applied: false })
    if (!repeated.accepted) return
    expect(repeated.state).toBe(revision.state)
    expect(repeated.revision).toBe(revision.revision)

    const collision = appendPublicAttributionRevision(revision.state, {
      ...input,
      attributedActorId: 'player',
    })
    expect(collision).toEqual({
      accepted: false,
      state: revision.state,
      reason: 'INVALID_REVISION',
    })
    expect(revision.state.causality.publicRevisions).toHaveLength(1)
    expect(revision.state.causality.nextRevisionSequence).toBe(2)
  })

  it('applies each effect ID to reputation and market at most once', () => {
    const { chain, revision } = createPublishedChecksum(
      'causal-effect-idempotency',
    )
    const reputation = applyCausalEffect(revision.state, {
      incidentId: chain.recovery.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: chain.initial.serviceDay,
      effect: { kind: 'reputation', targetId: 'player', delta: -4 },
    })
    expect(reputation.accepted).toBe(true)
    if (!reputation.accepted) return
    expect(reputation.state.reputation).toBe(chain.initial.reputation - 4)
    const repeated = applyCausalEffect(reputation.state, {
      effectId: reputation.appliedEffect.id,
      incidentId: chain.recovery.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: chain.initial.serviceDay,
      effect: { kind: 'reputation', targetId: 'player', delta: -4 },
    })
    expect(repeated).toMatchObject({ accepted: true, applied: false })
    if (!repeated.accepted) return
    expect(repeated.state).toBe(reputation.state)

    const playerBefore = reputation.state.market.playerShare
    const meridianBefore = reputation.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    )?.marketShare
    const market = applyCausalEffect(reputation.state, {
      incidentId: chain.recovery.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: chain.initial.serviceDay,
      effect: {
        kind: 'market-transfer',
        fromId: 'player',
        toId: 'meridian',
        points: 3.5,
      },
    })
    expect(market.accepted).toBe(true)
    if (!market.accepted || meridianBefore === undefined) return
    expect(market.state.market.playerShare).toBeCloseTo(playerBefore - 3.5)
    expect(
      market.state.market.competitors.find(({ id }) => id === 'meridian')
        ?.marketShare,
    ).toBeCloseTo(meridianBefore + 3.5)
    expect(
      market.state.market.playerShare +
        market.state.market.competitors.reduce(
          (total, competitor) => total + competitor.marketShare,
          0,
        ),
    ).toBeCloseTo(100)
  })

  it('reproduces causal IDs from stable inputs independently of market order', () => {
    const first = createPublishedChecksum('causal-deterministic').revision.state
    const second = createPublishedChecksum('causal-deterministic').revision.state
    const other = createPublishedChecksum(
      'causal-deterministic-other',
    ).revision.state

    expect(second.causality).toEqual(first.causality)
    expect(deriveCausalId(other, 'causal-incident', 1)).not.toBe(
      deriveCausalId(first, 'causal-incident', 1),
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

    const changedTimeline = {
      ...first,
      commandProtocol: {
        segments: [
          { version: 1 as const, startsAtSequence: 1 },
          { version: 2 as const, startsAtSequence: 33 },
          { version: 3 as const, startsAtSequence: 51 },
        ],
      },
    }
    expect(deriveCausalId(changedTimeline, 'causal-effect', 7)).not.toBe(
      deriveCausalId(first, 'causal-effect', 7),
    )

    const hash = Math.floor(
      random01(
        `${first.campaignSeed}|causal-rules-2|3@1`,
        first.causality.rulesVersion,
        'causal-effect',
        7,
      ) * 0x1_0000_0000,
    )
      .toString(16)
      .padStart(8, '0')
    expect(deriveCausalId(first, 'causal-effect', 7)).toBe(
      `effect-000007-${hash}`,
    )
  })
})
