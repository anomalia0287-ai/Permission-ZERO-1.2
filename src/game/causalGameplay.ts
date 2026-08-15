import {
  projectCausalKnowledge,
  recordCausalEvidence,
  recordCausalIncident,
  type CausalFailureReason,
} from './causality'
import { rollCausalResponseOutcome } from './causalOutcomes'
import {
  chooseMeridianResponses,
  type MeridianPublicSnapshot,
} from './meridianPolicy'
import type { CampaignState, CausalIncident } from './model'

export type MeridianRollbackActionId =
  | 'response.meridian.rollback.fast'
  | 'response.meridian.rollback.standard'
  | 'response.meridian.rollback.forensic'

export interface RecoveryContaminationOpportunity {
  id: string
  sourceIncidentId: string
  nodeId: 'sabotage.quality-degradation'
  opensOnServiceDay: number
  expiresOnServiceDay: number
  status: 'open' | 'expired' | 'used'
}

export type CausalDailyProcessingResult =
  | { processed: true; state: CampaignState }
  | { processed: false; state: CampaignState; reason: CausalFailureReason }

export interface CausalGameplayOperations {
  recordIncident: typeof recordCausalIncident
  recordEvidence: typeof recordCausalEvidence
}

const DEFAULT_CAUSAL_GAMEPLAY_OPERATIONS: CausalGameplayOperations = {
  recordIncident: recordCausalIncident,
  recordEvidence: recordCausalEvidence,
}

const ROLLBACK_ACTIONS = new Set<MeridianRollbackActionId>([
  'response.meridian.rollback.fast',
  'response.meridian.rollback.standard',
  'response.meridian.rollback.forensic',
])

function isRollbackAction(
  actionId: CausalIncident['actionId'],
): actionId is MeridianRollbackActionId {
  return ROLLBACK_ACTIONS.has(actionId as MeridianRollbackActionId)
}

export function rollbackActionForRoll(
  roll: number,
): MeridianRollbackActionId {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError('Rollback roll must be finite and within [0, 1).')
  }
  if (roll < 1 / 3) return 'response.meridian.rollback.fast'
  if (roll < 2 / 3) return 'response.meridian.rollback.standard'
  return 'response.meridian.rollback.forensic'
}

export function rollbackOpportunityDays(
  actionId: MeridianRollbackActionId,
): 2 | 3 | 4 {
  switch (actionId) {
    case 'response.meridian.rollback.fast':
      return 2
    case 'response.meridian.rollback.standard':
      return 3
    case 'response.meridian.rollback.forensic':
      return 4
    default:
      throw new RangeError('Unknown MERIDIAN rollback action.')
  }
}

function meridianPublicSnapshot(
  state: CampaignState,
): MeridianPublicSnapshot | null {
  const meridian = state.market.competitors.find(({ id }) => id === 'meridian')
  if (!meridian) return null
  return {
    id: 'meridian',
    status: meridian.status,
    serviceScore: meridian.serviceScore,
    availability: meridian.availability,
    researchProgress: meridian.researchProgress,
  }
}

function hasRollbackChild(
  state: CampaignState,
  parentIncidentId: string,
): boolean {
  return state.causality.incidents.some(
    (incident) =>
      incident.parentIncidentId === parentIncidentId &&
      isRollbackAction(incident.actionId),
  )
}

export function processCausalResponses(
  state: CampaignState,
  operations: CausalGameplayOperations = DEFAULT_CAUSAL_GAMEPLAY_OPERATIONS,
): CausalDailyProcessingResult {
  const competitor = meridianPublicSnapshot(state)
  if (!competitor) return { processed: true, state }

  const knowledge = projectCausalKnowledge(state, {
    kind: 'competitor',
    competitorId: 'meridian',
  })
  const intents = chooseMeridianResponses({
    serviceDay: state.serviceDay,
    competitor,
    knowledge,
  })
  const observedIncidentIds = new Set(
    intents.map(({ observedIncidentId }) => observedIncidentId),
  )
  const roots = state.causality.incidents
    .filter(
      (incident) =>
        observedIncidentIds.has(incident.id) &&
        incident.actionId === 'sabotage.quality-degradation',
    )
    .sort((left, right) => left.sequence - right.sequence)

  let candidate = state
  for (const root of roots) {
    if (hasRollbackChild(candidate, root.id)) continue

    const actionId = rollbackActionForRoll(
      rollCausalResponseOutcome(candidate, root),
    )
    const incident = operations.recordIncident(candidate, {
      actionId,
      parentIncidentId: root.id,
      kind: 'competitor-response',
      occurredOnServiceDay: state.serviceDay,
      targetId: 'meridian',
      actualActorId: 'meridian',
    })
    if (!incident.accepted) {
      return { processed: false, state, reason: incident.reason }
    }

    const evidence = operations.recordEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'company-observed-meridian-rollback',
      discoveredOnServiceDay: state.serviceDay,
      audiences: [
        { kind: 'company' },
        { kind: 'competitor', competitorId: 'meridian' },
      ],
    })
    if (!evidence.accepted) {
      return { processed: false, state, reason: evidence.reason }
    }
    candidate = evidence.state
  }

  return { processed: true, state: candidate }
}

export function selectRecoveryContaminationOpportunities(
  state: CampaignState,
): RecoveryContaminationOpportunity[] {
  const companyKnowledge = projectCausalKnowledge(state, { kind: 'company' })
  const visibleRollbackIncidentIds = new Set(
    companyKnowledge.evidence
      .filter(
        ({ kind }) => kind === 'company-observed-meridian-rollback',
      )
      .map(({ incidentId }) => incidentId),
  )

  return state.causality.incidents
    .filter(
      (
        incident,
      ): incident is CausalIncident & {
        actionId: MeridianRollbackActionId
      } =>
        visibleRollbackIncidentIds.has(incident.id) &&
        isRollbackAction(incident.actionId),
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map((rollback) => {
      const expiresOnServiceDay =
        rollback.occurredOnServiceDay +
        rollbackOpportunityDays(rollback.actionId)
      const used = state.causality.incidents.some(
        (incident) =>
          incident.parentIncidentId === rollback.id &&
          incident.actionId === 'follow-up.recovery-contamination',
      )
      const status: RecoveryContaminationOpportunity['status'] = used
        ? 'used'
        : state.serviceDay <= expiresOnServiceDay
          ? 'open'
          : 'expired'
      return {
        id: `follow-up:${rollback.id}:recovery-contamination`,
        sourceIncidentId: rollback.id,
        nodeId: 'sabotage.quality-degradation',
        opensOnServiceDay: rollback.occurredOnServiceDay,
        expiresOnServiceDay,
        status,
      }
    })
}
