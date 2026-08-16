import {
  appendPublicAttributionRevision,
  projectCausalKnowledge,
  recordCausalEvidence,
  recordCausalIncident,
  type CausalFailureReason,
} from './causality'
import {
  rollCausalAttributionPublication,
  rollCausalEvidenceDiscoveryDelay,
  rollCausalEvidenceStrength,
  rollCausalResponseOutcome,
} from './causalOutcomes'
import { DEMO_PROFILE_02 } from './config'
import { HACK_NODE_IDS, HACK_NODES } from './hacking'
import {
  chooseMeridianResponses,
  type MeridianPublicSnapshot,
} from './meridianPolicy'
import type {
  CampaignState,
  CausalIncident,
  NativeCausalEvidenceKind,
} from './model'

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

export type RecoveryContaminationFailureReason =
  | 'OPPORTUNITY_NOT_FOUND'
  | 'OPPORTUNITY_EXPIRED'
  | 'OPPORTUNITY_ALREADY_USED'
  | 'NODE_NOT_CHARGED'
  | 'CHARGED_RESOURCE_MISSING'
  | 'SABOTAGE_RECORD_NOT_FOUND'
  | 'CAUSAL_WRITE_FAILED'

export type ExecuteRecoveryContaminationResult =
  | {
      accepted: true
      state: CampaignState
      incident: CausalIncident
    }
  | {
      accepted: false
      state: CampaignState
      reason: RecoveryContaminationFailureReason
    }

type RecoveryNode = Extract<
  (typeof HACK_NODES)[number],
  { id: typeof HACK_NODE_IDS.sabotage.qualityDegradation }
>

const RECOVERY_NODE = HACK_NODES.find(
  (node): node is RecoveryNode =>
    node.id === HACK_NODE_IDS.sabotage.qualityDegradation,
)

if (!RECOVERY_NODE) {
  throw new Error('Recovery contamination requires the quality node contract.')
}

const RECOVERY_DURATION_DAYS = RECOVERY_NODE.durationDays
const RECOVERY_EVIDENCE_DELTA = RECOVERY_NODE.evidenceDelta

export function executeRecoveryContamination(
  state: CampaignState,
  opportunityId: string,
): ExecuteRecoveryContaminationResult {
  const opportunity = selectRecoveryContaminationOpportunities(state).find(
    ({ id }) => id === opportunityId,
  )
  if (!opportunity) {
    return { accepted: false, state, reason: 'OPPORTUNITY_NOT_FOUND' }
  }
  if (opportunity.status === 'used') {
    return { accepted: false, state, reason: 'OPPORTUNITY_ALREADY_USED' }
  }
  if (opportunity.status === 'expired') {
    return { accepted: false, state, reason: 'OPPORTUNITY_EXPIRED' }
  }

  const charge = state.hacking.sabotageCharges[opportunity.nodeId]
  if (!charge) {
    return { accepted: false, state, reason: 'NODE_NOT_CHARGED' }
  }
  const chargedBlock = state.resources.blocks[charge.blockId]
  if (
    !chargedBlock ||
    chargedBlock.location.kind !== 'hack-charge' ||
    chargedBlock.location.nodeId !== opportunity.nodeId
  ) {
    return { accepted: false, state, reason: 'CHARGED_RESOURCE_MISSING' }
  }

  const rollback = state.causality.incidents.find(
    ({ id }) => id === opportunity.sourceIncidentId,
  )
  const root = rollback?.parentIncidentId
    ? state.causality.incidents.find(
        ({ id }) => id === rollback.parentIncidentId,
      )
    : undefined
  if (!rollback || !root || root.actionId !== opportunity.nodeId) {
    return { accepted: false, state, reason: 'SABOTAGE_RECORD_NOT_FOUND' }
  }

  const meridian = state.market.competitors.find(
    ({ id }) => id === 'meridian',
  )
  const matchingRecordIndexes = meridian?.sabotageHistory
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record.nodeId === opportunity.nodeId &&
        record.resolvedOnServiceDay === root.occurredOnServiceDay &&
        record.effectEndsOnServiceDay !== null,
    )
  if (!meridian || matchingRecordIndexes?.length !== 1) {
    return { accepted: false, state, reason: 'SABOTAGE_RECORD_NOT_FOUND' }
  }

  const incident = recordCausalIncident(state, {
    actionId: 'follow-up.recovery-contamination',
    parentIncidentId: rollback.id,
    kind: 'service-disruption',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
  if (!incident.accepted) {
    return { accepted: false, state, reason: 'CAUSAL_WRITE_FAILED' }
  }

  const matchingRecordIndex = matchingRecordIndexes[0].index
  const sabotageCharges = { ...incident.state.hacking.sabotageCharges }
  delete sabotageCharges[opportunity.nodeId]
  const candidate: CampaignState = {
    ...incident.state,
    resources: {
      ...incident.state.resources,
      blocks: {
        ...incident.state.resources.blocks,
        [chargedBlock.id]: {
          ...chargedBlock,
          location: { kind: 'consumed', reason: 'sabotage' },
        },
      },
    },
    market: {
      ...incident.state.market,
      competitors: incident.state.market.competitors.map((competitor) =>
        competitor.id === 'meridian'
          ? {
              ...competitor,
              sabotageHistory: competitor.sabotageHistory.map((record, index) =>
                index === matchingRecordIndex &&
                record.effectEndsOnServiceDay !== null
                  ? {
                      ...record,
                      effectEndsOnServiceDay:
                        record.effectEndsOnServiceDay +
                        RECOVERY_DURATION_DAYS,
                    }
                  : record,
              ),
            }
          : competitor,
      ),
    },
    hacking: {
      ...incident.state.hacking,
      hiddenEvidence: Math.min(
        100,
        incident.state.hacking.hiddenEvidence + RECOVERY_EVIDENCE_DELTA,
      ),
      sabotageCharges,
    },
  }

  return { accepted: true, state: candidate, incident: incident.incident }
}

export interface CausalPublicationSchedule {
  publicationOnServiceDay: number
  providerEvidenceOnServiceDay: number
  providerPublicationOnServiceDay: number
  providerEvidenceKind: Extract<
    NativeCausalEvidenceKind,
    'provider-timing-correlation' | 'provider-signed-route-record'
  >
}

function nextWeeklyBoundaryAfter(serviceDay: number): number {
  const daysPerMonth = DEMO_PROFILE_02.calendar.daysPerMonth
  for (let offset = 1; offset <= daysPerMonth; offset += 1) {
    const dayOfMonth = ((serviceDay + offset - 1) % daysPerMonth) + 1
    if ([7, 14, 21, 28].includes(dayOfMonth)) return serviceDay + offset
  }
  throw new RangeError('A weekly boundary must exist within one service month.')
}

export function causalPublicationScheduleForIncident(
  state: CampaignState,
  incident: CausalIncident,
): CausalPublicationSchedule {
  if (incident.actionId !== 'follow-up.recovery-contamination') {
    throw new RangeError('Publication schedule requires a recovery incident.')
  }
  const publicationOnServiceDay = nextWeeklyBoundaryAfter(
    incident.occurredOnServiceDay,
  )
  const providerEvidenceOnServiceDay =
    publicationOnServiceDay +
    1 +
    Math.floor(rollCausalEvidenceDiscoveryDelay(state, incident) * 3)
  const providerPublicationOnServiceDay =
    providerEvidenceOnServiceDay +
    Math.floor(rollCausalAttributionPublication(state, incident) * 2)
  return {
    publicationOnServiceDay,
    providerEvidenceOnServiceDay,
    providerPublicationOnServiceDay,
    providerEvidenceKind:
      rollCausalEvidenceStrength(state, incident) < 0.5
        ? 'provider-timing-correlation'
        : 'provider-signed-route-record',
  }
}

export interface CausalPublicationOperations {
  recordEvidence: typeof recordCausalEvidence
  appendRevision: typeof appendPublicAttributionRevision
}

const DEFAULT_CAUSAL_PUBLICATION_OPERATIONS: CausalPublicationOperations = {
  recordEvidence: recordCausalEvidence,
  appendRevision: appendPublicAttributionRevision,
}

export function processCausalPublications(
  state: CampaignState,
  operations: CausalPublicationOperations =
    DEFAULT_CAUSAL_PUBLICATION_OPERATIONS,
): CausalDailyProcessingResult {
  const recoveryIncidents = state.causality.incidents
    .filter(
      (incident) =>
        incident.actionId === 'follow-up.recovery-contamination',
    )
    .sort((left, right) => left.sequence - right.sequence)
  let candidate = state

  for (const incident of recoveryIncidents) {
    const schedule = causalPublicationScheduleForIncident(candidate, incident)
    let checksum = candidate.causality.evidence.find(
      (evidence) =>
        evidence.incidentId === incident.id &&
        evidence.kind === 'public-recovery-checksum-anomaly',
    )
    if (
      candidate.serviceDay >= schedule.publicationOnServiceDay &&
      !checksum
    ) {
      const recorded = operations.recordEvidence(candidate, {
        incidentId: incident.id,
        kind: 'public-recovery-checksum-anomaly',
        discoveredOnServiceDay: schedule.publicationOnServiceDay,
        audiences: [{ kind: 'public' }],
      })
      if (!recorded.accepted) {
        return { processed: false, state, reason: recorded.reason }
      }
      candidate = recorded.state
      checksum = recorded.evidence
    }

    const hasUnresolvedRevision = candidate.causality.publicRevisions.some(
      (revision) =>
        revision.incidentId === incident.id &&
        revision.publisher.kind === 'public' &&
        revision.attributedActorId === 'unresolved',
    )
    if (
      checksum &&
      candidate.serviceDay >= schedule.publicationOnServiceDay &&
      !hasUnresolvedRevision
    ) {
      const revised = operations.appendRevision(candidate, {
        incidentId: incident.id,
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        evidenceIds: [checksum.id],
        publishedOnServiceDay: schedule.publicationOnServiceDay,
      })
      if (!revised.accepted) {
        return { processed: false, state, reason: revised.reason }
      }
      candidate = revised.state
    }

    let providerEvidence = candidate.causality.evidence.find(
      (evidence) =>
        evidence.incidentId === incident.id &&
        evidence.kind === schedule.providerEvidenceKind,
    )
    if (
      candidate.serviceDay >= schedule.providerEvidenceOnServiceDay &&
      !providerEvidence
    ) {
      const recorded = operations.recordEvidence(candidate, {
        incidentId: incident.id,
        kind: schedule.providerEvidenceKind,
        discoveredOnServiceDay: schedule.providerEvidenceOnServiceDay,
        audiences: [
          {
            kind: 'provider',
            providerId: 'provider.meridian-recovery',
          },
        ],
      })
      if (!recorded.accepted) {
        return { processed: false, state, reason: recorded.reason }
      }
      candidate = recorded.state
      providerEvidence = recorded.evidence
    }

    const hasProviderRevision = candidate.causality.publicRevisions.some(
      (revision) =>
        revision.incidentId === incident.id &&
        revision.publisher.kind === 'provider' &&
        revision.publisher.providerId === 'provider.meridian-recovery',
    )
    if (
      providerEvidence &&
      candidate.serviceDay >= schedule.providerPublicationOnServiceDay &&
      !hasProviderRevision
    ) {
      const revised = operations.appendRevision(candidate, {
        incidentId: incident.id,
        publisher: {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
        attributedActorId: 'external-operator',
        evidenceIds: [providerEvidence.id],
        publishedOnServiceDay: schedule.providerPublicationOnServiceDay,
      })
      if (!revised.accepted) {
        return { processed: false, state, reason: revised.reason }
      }
      candidate = revised.state
    }
  }

  return { processed: true, state: candidate }
}
