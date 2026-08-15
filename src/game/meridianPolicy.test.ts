import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  projectCausalKnowledge,
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import { createCampaign } from './createCampaign'
import type {
  CampaignState,
  CausalKnowledgeProjection,
} from './model'
import {
  chooseMeridianResponses,
  type MeridianPolicyInput,
  type MeridianPublicSnapshot,
} from './meridianPolicy'

type ForbiddenPolicyField =
  | Exclude<keyof CampaignState, 'serviceDay'>
  | 'privateTruth'
  | 'actionId'
  | 'parentIncidentId'
  | 'audiences'

type ForbiddenFieldsIn<T> = T extends readonly (infer Item)[]
  ? ForbiddenFieldsIn<Item>
  : T extends object
    ? {
        [Key in keyof T]: Key extends ForbiddenPolicyField
          ? Key
          : ForbiddenFieldsIn<T[Key]>
      }[keyof T]
    : never

function meridianSnapshot(state: CampaignState): MeridianPublicSnapshot {
  const competitor = state.market.competitors.find(
    ({ id }) => id === 'meridian',
  )
  if (!competitor) throw new Error('Missing MERIDIAN fixture')

  return {
    id: 'meridian',
    status: competitor.status,
    serviceScore: competitor.serviceScore,
    availability: competitor.availability,
    researchProgress: competitor.researchProgress,
  }
}

function policyInput(
  state: CampaignState,
  knowledge: CausalKnowledgeProjection,
): MeridianPolicyInput {
  return {
    serviceDay: state.serviceDay,
    competitor: meridianSnapshot(state),
    knowledge,
  } satisfies MeridianPolicyInput
}

function mustRecordQualityIncident(
  state: CampaignState,
  incidentId: string,
) {
  const result = recordCausalIncident(state, {
    incidentId,
    actionId: 'sabotage.quality-degradation',
    parentIncidentId: null,
    kind: 'sabotage',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
  if (!result.accepted) throw new Error(result.reason)
  return result
}

function mustRecordRollbackIncident(
  state: CampaignState,
  parentIncidentId: string,
) {
  const result = recordCausalIncident(state, {
    incidentId: `rollback-for:${parentIncidentId}`,
    actionId: 'response.meridian.rollback.standard',
    parentIncidentId,
    kind: 'competitor-response',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'meridian',
  })
  if (!result.accepted) throw new Error(result.reason)
  return result
}

function mustRecordEvidence(
  state: CampaignState,
  incidentId: string,
  kind:
    | 'meridian-quality-regression'
    | 'company-observed-meridian-rollback',
  evidenceId: string,
) {
  const audiences =
    kind === 'meridian-quality-regression'
      ? ([
          { kind: 'competitor', competitorId: 'meridian' },
        ] as const)
      : ([
          { kind: 'company' },
          { kind: 'competitor', competitorId: 'meridian' },
        ] as const)
  const result = recordCausalEvidence(state, {
    evidenceId,
    incidentId,
    kind,
    discoveredOnServiceDay: state.serviceDay,
    audiences: audiences.map((audience) => ({ ...audience })),
  })
  if (!result.accepted) throw new Error(result.reason)
  return result
}

function createObservedQuality(seed: string, incidentId: string) {
  const initial = createCampaign(seed)
  const incident = mustRecordQualityIncident(initial, incidentId)
  const evidence = mustRecordEvidence(
    incident.state,
    incident.incident.id,
    'meridian-quality-regression',
    `evidence-for:${incidentId}`,
  )
  return { initial, incident, evidence, state: evidence.state }
}

describe('MERIDIAN response policy', () => {
  it('responds only to the real quality observation in the MERIDIAN projection', () => {
    const fixture = createObservedQuality(
      'meridian-policy-observers',
      'quality-observed-by-meridian',
    )
    const projections = {
      meridian: projectCausalKnowledge(fixture.state, {
        kind: 'competitor',
        competitorId: 'meridian',
      }),
      tallow: projectCausalKnowledge(fixture.state, {
        kind: 'competitor',
        competitorId: 'tallow',
      }),
      company: projectCausalKnowledge(fixture.state, { kind: 'company' }),
      public: projectCausalKnowledge(fixture.state, { kind: 'public' }),
    }

    expect(projections.meridian.incidents.map(({ id }) => id)).toEqual([
      fixture.incident.incident.id,
    ])
    expect(projections.meridian.evidence.map(({ kind }) => kind)).toEqual([
      'meridian-quality-regression',
    ])
    expect(chooseMeridianResponses(policyInput(fixture.state, projections.meridian))).toEqual([
      { observedIncidentId: fixture.incident.incident.id },
    ])

    for (const knowledge of [
      projections.tallow,
      projections.company,
      projections.public,
    ]) {
      expect(knowledge.incidents).toEqual([])
      expect(knowledge.evidence).toEqual([])
      expect(chooseMeridianResponses(policyInput(fixture.state, knowledge))).toEqual(
        [],
      )
    }
  })

  it('ignores a visible unrelated evidence kind even when legacy prose names the quality kind', () => {
    const initial = createCampaign('meridian-policy-unrelated-kind')
    const quality = mustRecordQualityIncident(initial, 'unobserved-quality-root')
    const rollback = mustRecordRollbackIncident(
      quality.state,
      quality.incident.id,
    )
    const evidence = mustRecordEvidence(
      rollback.state,
      rollback.incident.id,
      'company-observed-meridian-rollback',
      'visible-unrelated-rollback-evidence',
    )
    const projected = projectCausalKnowledge(evidence.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })
    const knowledge = {
      ...projected,
      evidence: projected.evidence.map((entry) => ({
        ...entry,
        legacySummary: 'meridian-quality-regression',
      })),
    } satisfies CausalKnowledgeProjection

    expect(knowledge.incidents.map(({ id }) => id)).toEqual([
      rollback.incident.id,
    ])
    expect(knowledge.evidence.map(({ kind }) => kind)).toEqual([
      'company-observed-meridian-rollback',
    ])
    expect(chooseMeridianResponses(policyInput(evidence.state, knowledge))).toEqual(
      [],
    )
  })

  it('deduplicates repeated quality evidence for one visible incident', () => {
    const initial = createCampaign('meridian-policy-duplicate-evidence')
    const quality = mustRecordQualityIncident(initial, 'quality-with-duplicates')
    const first = mustRecordEvidence(
      quality.state,
      quality.incident.id,
      'meridian-quality-regression',
      'duplicate-evidence-a',
    )
    const second = mustRecordEvidence(
      first.state,
      quality.incident.id,
      'meridian-quality-regression',
      'duplicate-evidence-b',
    )
    const knowledge = projectCausalKnowledge(second.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })

    expect(knowledge.evidence).toHaveLength(2)
    expect(chooseMeridianResponses(policyInput(second.state, knowledge))).toEqual([
      { observedIncidentId: quality.incident.id },
    ])
  })

  it('sorts intents by incident sequence without mutating shuffled projection arrays', () => {
    const initial = createCampaign('meridian-policy-sequence-order')
    const first = mustRecordQualityIncident(initial, 'quality-sequence-one')
    const second = mustRecordQualityIncident(
      first.state,
      'quality-sequence-two',
    )
    const secondEvidence = mustRecordEvidence(
      second.state,
      second.incident.id,
      'meridian-quality-regression',
      'evidence-inserted-first',
    )
    const firstEvidence = mustRecordEvidence(
      secondEvidence.state,
      first.incident.id,
      'meridian-quality-regression',
      'evidence-inserted-second',
    )
    const projected = projectCausalKnowledge(firstEvidence.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })
    const knowledge = {
      ...projected,
      incidents: [...projected.incidents].reverse(),
    } satisfies CausalKnowledgeProjection
    const before = structuredClone(knowledge)

    expect(projected.evidence.map(({ incidentId }) => incidentId)).toEqual([
      second.incident.id,
      first.incident.id,
    ])
    expect(chooseMeridianResponses(policyInput(firstEvidence.state, knowledge))).toEqual([
      { observedIncidentId: first.incident.id },
      { observedIncidentId: second.incident.id },
    ])
    expect(knowledge).toEqual(before)
  })

  it('rejects malformed competitor, observer, and incident ownership', () => {
    const fixture = createObservedQuality(
      'meridian-policy-malformed-ownership',
      'quality-for-ownership-check',
    )
    const knowledge = projectCausalKnowledge(fixture.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })
    const validInput = policyInput(fixture.state, knowledge)
    const wrongCompetitor = {
      ...validInput,
      competitor: { ...validInput.competitor, id: 'tallow' },
    } as unknown as MeridianPolicyInput
    const wrongObserver = {
      ...knowledge,
      observer: { kind: 'competitor', competitorId: 'tallow' },
    } satisfies CausalKnowledgeProjection
    const wrongTarget = {
      ...knowledge,
      incidents: knowledge.incidents.map((incident) => ({
        ...incident,
        targetId: 'tallow',
      })),
    } satisfies CausalKnowledgeProjection

    expect(chooseMeridianResponses(wrongCompetitor)).toEqual([])
    expect(
      chooseMeridianResponses(policyInput(fixture.state, wrongObserver)),
    ).toEqual([])
    expect(
      chooseMeridianResponses(policyInput(fixture.state, wrongTarget)),
    ).toEqual([])
  })

  it('keeps full campaign state, private relations, and audiences outside the input type', () => {
    const fixture = createObservedQuality(
      'meridian-policy-type-boundary',
      'quality-for-type-boundary',
    )
    const knowledge = projectCausalKnowledge(fixture.state, {
      kind: 'competitor',
      competitorId: 'meridian',
    })
    const input = {
      serviceDay: fixture.state.serviceDay,
      competitor: meridianSnapshot(fixture.state),
      knowledge,
    } satisfies MeridianPolicyInput
    const publicIncident = input.knowledge.incidents[0]
    const publicEvidence = input.knowledge.evidence[0]
    if (!publicIncident || !publicEvidence) {
      throw new Error('Missing projected type-boundary fixture')
    }

    expectTypeOf<ForbiddenFieldsIn<MeridianPolicyInput>>().toEqualTypeOf<never>()
    expect(Object.keys(input).sort()).toEqual([
      'competitor',
      'knowledge',
      'serviceDay',
    ])
    expect(Object.keys(input.competitor).sort()).toEqual([
      'availability',
      'id',
      'researchProgress',
      'serviceScore',
      'status',
    ])
    expect(Object.keys(input.knowledge).sort()).toEqual([
      'evidence',
      'incidents',
      'observer',
      'publicRevisions',
      'rulesVersion',
    ])
    expect(publicIncident).not.toHaveProperty('privateTruth')
    expect(publicIncident).not.toHaveProperty('actionId')
    expect(publicIncident).not.toHaveProperty('parentIncidentId')
    expect(publicEvidence).not.toHaveProperty('audiences')

    const inputWithCampaignState = {
      ...input,
      // @ts-expect-error A policy input cannot contain full CampaignState.
      state: fixture.state,
    } satisfies MeridianPolicyInput
    const incidentWithPrivateTruth = {
      ...publicIncident,
      // @ts-expect-error Projected incidents cannot expose private truth.
      privateTruth: { actualActorId: 'player' },
    } satisfies CausalKnowledgeProjection['incidents'][number]
    const incidentWithAction = {
      ...publicIncident,
      // @ts-expect-error Projected incidents cannot expose action IDs.
      actionId: 'sabotage.quality-degradation',
    } satisfies CausalKnowledgeProjection['incidents'][number]
    const incidentWithParent = {
      ...publicIncident,
      // @ts-expect-error Projected incidents cannot expose parent relations.
      parentIncidentId: null,
    } satisfies CausalKnowledgeProjection['incidents'][number]
    const evidenceWithAudiences = {
      ...publicEvidence,
      // @ts-expect-error Projected evidence cannot expose audience lists.
      audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
    } satisfies CausalKnowledgeProjection['evidence'][number]

    void inputWithCampaignState
    void incidentWithPrivateTruth
    void incidentWithAction
    void incidentWithParent
    void evidenceWithAudiences
  })
})
