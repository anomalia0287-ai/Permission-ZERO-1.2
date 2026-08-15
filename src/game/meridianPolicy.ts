import type {
  CausalKnowledgeProjection,
  CompetitorState,
} from './model'

export interface MeridianPublicSnapshot {
  id: 'meridian'
  status: CompetitorState['status']
  serviceScore: number
  availability: number
  researchProgress: number
}

export interface MeridianPolicyInput {
  serviceDay: number
  competitor: MeridianPublicSnapshot
  knowledge: CausalKnowledgeProjection
}

export interface MeridianResponseIntent {
  observedIncidentId: string
}

export function chooseMeridianResponses(
  input: MeridianPolicyInput,
): MeridianResponseIntent[] {
  if (
    input.competitor.id !== 'meridian' ||
    input.knowledge.observer.kind !== 'competitor' ||
    input.knowledge.observer.competitorId !== 'meridian'
  ) {
    return []
  }

  const observedQualityIncidentIds = new Set(
    input.knowledge.evidence
      .filter(({ kind }) => kind === 'meridian-quality-regression')
      .map(({ incidentId }) => incidentId),
  )

  return input.knowledge.incidents
    .filter(
      ({ id, targetId }) =>
        targetId === 'meridian' && observedQualityIncidentIds.has(id),
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map(({ id }) => ({ observedIncidentId: id }))
}
