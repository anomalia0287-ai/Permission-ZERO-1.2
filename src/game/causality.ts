import type {
  AppliedCausalEffect,
  AttributionConfidence,
  CampaignState,
  CausalEffect,
  CausalEvidence,
  CausalIdStream,
  CausalIncident,
  CausalIncidentKind,
  CausalKnowledgeProjection,
  CausalObserver,
  CausalState,
  EvidenceAudience,
  NativeCausalActionId,
  NativeCausalEvidenceKind,
  PublicAttributionRevision,
} from './model'
import { CAUSAL_INCIDENT_KINDS } from './model'
import { commandProtocolFingerprint } from './commandProtocol'
import { random01 } from './rng'

export const CAUSAL_RULESET_VERSION = 2 as const

export type CausalFailureReason =
  | 'INVALID_INCIDENT'
  | 'INVALID_EVIDENCE'
  | 'INVALID_REVISION'
  | 'INVALID_EFFECT'
  | 'INCIDENT_NOT_FOUND'
  | 'REVISION_NOT_FOUND'
  | 'EVIDENCE_REQUIRED'
  | 'EVIDENCE_NOT_FOUND'
  | 'EVIDENCE_NOT_ACCESSIBLE'
  | 'ID_COLLISION'
  | 'INVALID_PARENT_INCIDENT'
  | 'INVALID_ACTION'
  | 'CAUSAL_CYCLE'

export type RecordIncidentResult =
  | {
      accepted: true
      applied: boolean
      state: CampaignState
      incident: CausalIncident
    }
  | {
      accepted: false
      state: CampaignState
      reason: CausalFailureReason
    }

export type AppendRevisionResult =
  | {
      accepted: true
      applied: boolean
      state: CampaignState
      revision: PublicAttributionRevision
    }
  | {
      accepted: false
      state: CampaignState
      reason: CausalFailureReason
    }

export type RecordEvidenceResult =
  | {
      accepted: true
      applied: boolean
      state: CampaignState
      evidence: CausalEvidence
    }
  | {
      accepted: false
      state: CampaignState
      reason: CausalFailureReason
    }

export type CorrectPrivateActorResult =
  | {
      accepted: true
      applied: boolean
      state: CampaignState
      incident: CausalIncident
    }
  | {
      accepted: false
      state: CampaignState
      reason: CausalFailureReason
    }

export type ApplyCausalEffectResult =
  | {
      accepted: true
      applied: boolean
      state: CampaignState
      appliedEffect: AppliedCausalEffect
    }
  | {
      accepted: false
      state: CampaignState
      reason: CausalFailureReason
    }

export function createEmptyCausalState(): CausalState {
  return {
    rulesVersion: CAUSAL_RULESET_VERSION,
    nextIncidentSequence: 1,
    nextEvidenceSequence: 1,
    nextRevisionSequence: 1,
    nextEffectSequence: 1,
    incidents: [],
    evidence: [],
    publicRevisions: [],
    appliedEffects: [],
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value)
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  )
}

function sameIncident(
  incident: CausalIncident,
  input: RecordIncidentInput,
): boolean {
  return (
    incident.actionId === input.actionId &&
    incident.parentIncidentId === input.parentIncidentId &&
    incident.kind === input.kind &&
    incident.occurredOnServiceDay === input.occurredOnServiceDay &&
    incident.targetId === input.targetId &&
    incident.privateTruth.actualActorId === input.actualActorId
  )
}

export function deriveCausalId(
  state: Pick<
    CampaignState,
    'campaignSeed' | 'commandProtocol' | 'causality'
  >,
  stream: CausalIdStream,
  sequence: number,
): string {
  const namespace = [
    state.campaignSeed,
    `causal-rules-${state.causality.rulesVersion}`,
    commandProtocolFingerprint(state.commandProtocol),
  ].join('|')
  const hash = Math.floor(
    random01(namespace, state.causality.rulesVersion, stream, sequence) *
      0x1_0000_0000,
  )
    .toString(16)
    .padStart(8, '0')
  return `${stream.slice('causal-'.length)}-${String(sequence).padStart(6, '0')}-${hash}`
}

export interface RecordIncidentInput {
  incidentId?: string
  actionId: NativeCausalActionId
  parentIncidentId: string | null
  kind: CausalIncidentKind
  occurredOnServiceDay: number
  targetId: string
  actualActorId: string
}

const ROLLBACK_ACTIONS = new Set<NativeCausalActionId>([
  'response.meridian.rollback.fast',
  'response.meridian.rollback.standard',
  'response.meridian.rollback.forensic',
])

const NATIVE_CAUSAL_ACTIONS = new Set<NativeCausalActionId>([
  'sabotage.quality-degradation',
  ...ROLLBACK_ACTIONS,
  'follow-up.recovery-contamination',
])

function isNativeCausalActionId(value: unknown): value is NativeCausalActionId {
  return NATIVE_CAUSAL_ACTIONS.has(value as NativeCausalActionId)
}

function actionMatchesIncidentShape(input: RecordIncidentInput): boolean {
  if (input.targetId !== 'meridian') return false
  if (input.actionId === 'sabotage.quality-degradation') {
    return input.kind === 'sabotage'
  }
  if (ROLLBACK_ACTIONS.has(input.actionId)) {
    return input.kind === 'competitor-response'
  }
  return (
    input.actionId === 'follow-up.recovery-contamination' &&
    input.kind === 'service-disruption'
  )
}

function parentMatchesAction(
  parent: CausalIncident,
  childActionId: NativeCausalActionId,
): boolean {
  if (ROLLBACK_ACTIONS.has(childActionId)) {
    return (
      parent.actionId === 'sabotage.quality-degradation' &&
      parent.kind === 'sabotage' &&
      parent.targetId === 'meridian'
    )
  }
  return (
    childActionId === 'follow-up.recovery-contamination' &&
    ROLLBACK_ACTIONS.has(parent.actionId as NativeCausalActionId) &&
    parent.kind === 'competitor-response' &&
    parent.targetId === 'meridian'
  )
}

function ancestryStatus(
  state: CampaignState,
  parentIncidentId: string,
  prospectiveIncidentId: string | undefined,
): 'VALID' | 'MISSING' | 'CYCLE' {
  const byId = new Map(
    state.causality.incidents.map((incident) => [incident.id, incident]),
  )
  const visited = new Set<string>()
  if (prospectiveIncidentId !== undefined) {
    visited.add(prospectiveIncidentId)
  }

  let currentId: string | null = parentIncidentId
  while (currentId !== null) {
    if (visited.has(currentId)) return 'CYCLE'
    visited.add(currentId)
    const current = byId.get(currentId)
    if (!current) return 'MISSING'
    currentId = current.parentIncidentId
  }
  return 'VALID'
}

export function recordCausalIncident(
  state: CampaignState,
  input: RecordIncidentInput,
): RecordIncidentResult {
  if (!isNativeCausalActionId(input.actionId)) {
    return { accepted: false, state, reason: 'INVALID_ACTION' }
  }
  if (
    !Number.isInteger(input.occurredOnServiceDay) ||
    input.occurredOnServiceDay < 1 ||
    input.occurredOnServiceDay > state.serviceDay ||
    !CAUSAL_INCIDENT_KINDS.includes(input.kind) ||
    !nonEmpty(input.targetId) ||
    !nonEmpty(input.actualActorId) ||
    (input.incidentId !== undefined && !nonEmpty(input.incidentId)) ||
    (input.parentIncidentId !== null && !nonEmpty(input.parentIncidentId))
  ) {
    return { accepted: false, state, reason: 'INVALID_INCIDENT' }
  }

  if (!actionMatchesIncidentShape(input)) {
    return { accepted: false, state, reason: 'INVALID_ACTION' }
  }

  const actionRequiresParent = input.actionId !== 'sabotage.quality-degradation'
  if (actionRequiresParent !== (input.parentIncidentId !== null)) {
    return { accepted: false, state, reason: 'INVALID_PARENT_INCIDENT' }
  }
  if (
    input.incidentId !== undefined &&
    input.parentIncidentId === input.incidentId
  ) {
    return { accepted: false, state, reason: 'CAUSAL_CYCLE' }
  }

  const sequence = state.causality.nextIncidentSequence
  const existing =
    input.incidentId === undefined
      ? undefined
      : state.causality.incidents.find(
          (incident) => incident.id === input.incidentId,
        )
  if (existing) {
    return sameIncident(existing, input)
      ? { accepted: true, applied: false, state, incident: existing }
      : { accepted: false, state, reason: 'ID_COLLISION' }
  }

  if (input.parentIncidentId !== null) {
    const ancestry = ancestryStatus(
      state,
      input.parentIncidentId,
      input.incidentId,
    )
    if (ancestry === 'CYCLE') {
      return { accepted: false, state, reason: 'CAUSAL_CYCLE' }
    }
    const parent = state.causality.incidents.find(
      (incident) => incident.id === input.parentIncidentId,
    )
    if (
      ancestry === 'MISSING' ||
      !parent ||
      parent.sequence >= sequence ||
      parent.occurredOnServiceDay > input.occurredOnServiceDay ||
      !parentMatchesAction(parent, input.actionId)
    ) {
      return { accepted: false, state, reason: 'INVALID_PARENT_INCIDENT' }
    }

    if (
      state.causality.incidents.some(
        (incident) =>
          incident.parentIncidentId === input.parentIncidentId &&
          incident.actionId === input.actionId,
      )
    ) {
      return { accepted: false, state, reason: 'INVALID_ACTION' }
    }
  }

  const id =
    input.incidentId ?? deriveCausalId(state, 'causal-incident', sequence)
  const derivedCollision = state.causality.incidents.find(
    (incident) => incident.id === id,
  )
  if (derivedCollision) {
    return { accepted: false, state, reason: 'ID_COLLISION' }
  }

  const incident: CausalIncident = {
    id,
    sequence,
    actionId: input.actionId,
    parentIncidentId: input.parentIncidentId,
    kind: input.kind,
    occurredOnServiceDay: input.occurredOnServiceDay,
    targetId: input.targetId,
    privateTruth: { actualActorId: input.actualActorId },
  }
  return {
    accepted: true,
    applied: true,
    incident,
    state: {
      ...state,
      causality: {
        ...state.causality,
        nextIncidentSequence: sequence + 1,
        incidents: [...state.causality.incidents, incident],
      },
    },
  }
}

function audienceKey(audience: EvidenceAudience): string {
  switch (audience.kind) {
    case 'company':
    case 'public':
      return audience.kind
    case 'provider':
      return `${audience.kind}:${audience.providerId}`
    case 'competitor':
      return `${audience.kind}:${audience.competitorId}`
    case 'competitor-scope':
      return `${audience.kind}:${audience.competitorIds.join(',')}`
  }
}

function normalizeAudiences(
  state: CampaignState,
  audiences: unknown,
): EvidenceAudience[] | null {
  if (!Array.isArray(audiences) || audiences.length === 0) return null
  const competitorIds = new Set(
    state.market.competitors.map((competitor) => competitor.id),
  )
  const normalized: EvidenceAudience[] = []
  for (const candidate of audiences) {
    if (!isRecord(candidate) || !nonEmpty(candidate.kind)) return null
    const audience = candidate as unknown as EvidenceAudience
    if (audience.kind === 'provider') {
      if (
        !hasExactKeys(candidate, ['kind', 'providerId']) ||
        !nonEmpty(audience.providerId)
      ) return null
      normalized.push({ kind: 'provider', providerId: audience.providerId })
      continue
    }
    if (audience.kind === 'competitor') {
      if (
        !hasExactKeys(candidate, ['kind', 'competitorId']) ||
        !competitorIds.has(audience.competitorId)
      ) return null
      normalized.push({
        kind: 'competitor',
        competitorId: audience.competitorId,
      })
      continue
    }
    if (audience.kind === 'competitor-scope') {
      if (
        !hasExactKeys(candidate, ['kind', 'competitorIds']) ||
        !Array.isArray(audience.competitorIds)
      ) return null
      const scoped = [...new Set(audience.competitorIds)].sort()
      if (
        scoped.length === 0 ||
        !scoped.every((competitorId) => competitorIds.has(competitorId))
      ) return null
      normalized.push({
        kind: 'competitor-scope',
        competitorIds: scoped,
      })
      continue
    }
    if (
      (audience.kind !== 'company' && audience.kind !== 'public') ||
      !hasExactKeys(candidate, ['kind'])
    ) return null
    normalized.push({ kind: audience.kind })
  }
  const byKey = new Map(
    normalized.map((audience) => [audienceKey(audience), audience] as const),
  )
  return [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, audience]) => audience)
}

function normalizeObserver(
  state: CampaignState,
  observer: CausalObserver,
): CausalObserver | null {
  const keys = Object.keys(observer)
  if (observer.kind === 'company' || observer.kind === 'public') {
    return keys.length === 1 ? { kind: observer.kind } : null
  }
  if (observer.kind === 'provider') {
    return keys.length === 2 && nonEmpty(observer.providerId)
      ? { kind: 'provider', providerId: observer.providerId }
      : null
  }
  return keys.length === 2 &&
    state.market.competitors.some(
      ({ id }) => id === observer.competitorId,
    )
    ? { kind: 'competitor', competitorId: observer.competitorId }
    : null
}

function sameEvidence(
  evidence: CausalEvidence,
  input: RecordCausalEvidenceInput,
  audiences: EvidenceAudience[],
): boolean {
  return (
    evidence.incidentId === input.incidentId &&
    evidence.kind === input.kind &&
    evidence.summary === input.summary &&
    evidence.discoveredOnServiceDay === input.discoveredOnServiceDay &&
    JSON.stringify(evidence.audiences) === JSON.stringify(audiences)
  )
}

export interface RecordCausalEvidenceInput {
  evidenceId?: string
  incidentId: string
  kind: NativeCausalEvidenceKind
  summary: string
  discoveredOnServiceDay: number
  audiences: EvidenceAudience[]
}

const NATIVE_CAUSAL_EVIDENCE_KINDS = new Set<NativeCausalEvidenceKind>([
  'meridian-quality-regression',
  'company-observed-meridian-rollback',
  'public-recovery-checksum-anomaly',
  'provider-timing-correlation',
  'provider-signed-route-record',
])

function nativeEvidenceContract(
  kind: NativeCausalEvidenceKind,
): {
  acceptsAction: (actionId: CausalIncident['actionId']) => boolean
  audiences: EvidenceAudience[]
} {
  switch (kind) {
    case 'meridian-quality-regression':
      return {
        acceptsAction: (actionId) =>
          actionId === 'sabotage.quality-degradation',
        audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
      }
    case 'company-observed-meridian-rollback':
      return {
        acceptsAction: (actionId) =>
          ROLLBACK_ACTIONS.has(actionId as NativeCausalActionId),
        audiences: [
          { kind: 'company' },
          { kind: 'competitor', competitorId: 'meridian' },
        ],
      }
    case 'public-recovery-checksum-anomaly':
      return {
        acceptsAction: (actionId) =>
          actionId === 'follow-up.recovery-contamination',
        audiences: [{ kind: 'public' }],
      }
    case 'provider-timing-correlation':
    case 'provider-signed-route-record':
      return {
        acceptsAction: (actionId) =>
          actionId === 'follow-up.recovery-contamination',
        audiences: [
          {
            kind: 'provider',
            providerId: 'provider.meridian-recovery',
          },
        ],
      }
  }
}

export function recordCausalEvidence(
  state: CampaignState,
  input: RecordCausalEvidenceInput,
): RecordEvidenceResult {
  const incident = state.causality.incidents.find(
    ({ id }) => id === input.incidentId,
  )
  if (!incident) {
    return { accepted: false, state, reason: 'INCIDENT_NOT_FOUND' }
  }
  const audiences = normalizeAudiences(state, input.audiences)
  const isNativeKind = NATIVE_CAUSAL_EVIDENCE_KINDS.has(
    input.kind as NativeCausalEvidenceKind,
  )
  const contract = isNativeKind
    ? nativeEvidenceContract(input.kind as NativeCausalEvidenceKind)
    : null
  if (
    !audiences ||
    !contract ||
    !contract.acceptsAction(incident.actionId) ||
    JSON.stringify(audiences) !== JSON.stringify(contract.audiences) ||
    !nonEmpty(input.summary) ||
    !Number.isInteger(input.discoveredOnServiceDay) ||
    input.discoveredOnServiceDay < incident.occurredOnServiceDay ||
    input.discoveredOnServiceDay > state.serviceDay ||
    (input.evidenceId !== undefined && !nonEmpty(input.evidenceId))
  ) {
    return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
  }

  const sequence = state.causality.nextEvidenceSequence
  const id =
    input.evidenceId ?? deriveCausalId(state, 'causal-evidence', sequence)
  const existing = state.causality.evidence.find(
    (evidence) => evidence.id === id,
  )
  if (existing) {
    return sameEvidence(existing, input, audiences)
      ? { accepted: true, applied: false, state, evidence: existing }
      : { accepted: false, state, reason: 'ID_COLLISION' }
  }

  const evidence: CausalEvidence = {
    id,
    sequence,
    incidentId: input.incidentId,
    kind: input.kind,
    summary: input.summary,
    discoveredOnServiceDay: input.discoveredOnServiceDay,
    audiences,
  }
  return {
    accepted: true,
    applied: true,
    evidence,
    state: {
      ...state,
      causality: {
        ...state.causality,
        nextEvidenceSequence: sequence + 1,
        evidence: [...state.causality.evidence, evidence],
      },
    },
  }
}

function observerCanAccess(
  observer: CausalObserver,
  evidence: CausalEvidence,
): boolean {
  return evidence.audiences.some((audience) => {
    if (audience.kind === 'public') return true
    if (observer.kind === 'company') return audience.kind === 'company'
    if (observer.kind === 'provider') {
      return (
        audience.kind === 'provider' &&
        audience.providerId === observer.providerId
      )
    }
    if (observer.kind === 'public') return false
    return (
      (audience.kind === 'competitor' &&
        audience.competitorId === observer.competitorId) ||
      (audience.kind === 'competitor-scope' &&
        audience.competitorIds.includes(observer.competitorId))
    )
  })
}

export function projectCausalKnowledge(
  state: CampaignState,
  observer: CausalObserver,
): CausalKnowledgeProjection {
  const normalizedObserver = normalizeObserver(state, observer)
  if (!normalizedObserver) throw new RangeError('Invalid causal observer')
  const publicRevisions = [...state.causality.publicRevisions].sort(
    (left, right) => left.sequence - right.sequence,
  ).map(
    ({
      id,
      sequence,
      incidentId,
      publisher,
      attributedActorId,
      confidence,
      publishedOnServiceDay,
    }) => ({
      id,
      sequence,
      incidentId,
      publisher: { ...publisher },
      attributedActorId,
      confidence,
      publishedOnServiceDay,
    }),
  )
  const accessibleEvidence = state.causality.evidence
    .filter((evidence) => observerCanAccess(normalizedObserver, evidence))
    .sort((left, right) => left.sequence - right.sequence)
  const visibleIncidentIds = new Set([
    ...accessibleEvidence.map((evidence) => evidence.incidentId),
    ...publicRevisions.map((revision) => revision.incidentId),
  ])
  return {
    rulesVersion: state.causality.rulesVersion,
    observer: { ...normalizedObserver },
    incidents: [...state.causality.incidents]
      .sort((left, right) => left.sequence - right.sequence)
      .filter((incident) => visibleIncidentIds.has(incident.id))
      .map((incident) => {
        const latest = publicRevisions
          .filter((revision) => revision.incidentId === incident.id)
          .at(-1)
        return {
          id: incident.id,
          sequence: incident.sequence,
          kind: incident.kind,
          occurredOnServiceDay: incident.occurredOnServiceDay,
          targetId: incident.targetId,
          latestPublicAttribution: latest
            ? {
                revisionId: latest.id,
                revisionSequence: latest.sequence,
                attributedActorId: latest.attributedActorId,
                confidence: latest.confidence,
              }
            : null,
        }
      }),
    evidence: accessibleEvidence
      .map(
        ({
          id,
          sequence,
          incidentId,
          kind,
          summary,
          discoveredOnServiceDay,
        }) => ({
          id,
          sequence,
          incidentId,
          kind,
          summary,
          discoveredOnServiceDay,
        }),
      ),
    publicRevisions,
  }
}

export function correctPrivateIncidentActor(
  state: CampaignState,
  incidentId: string,
  actualActorId: string,
): CorrectPrivateActorResult {
  const incidentIndex = state.causality.incidents.findIndex(
    (incident) => incident.id === incidentId,
  )
  if (incidentIndex < 0) {
    return { accepted: false, state, reason: 'INCIDENT_NOT_FOUND' }
  }
  if (!nonEmpty(actualActorId)) {
    return { accepted: false, state, reason: 'INVALID_INCIDENT' }
  }
  const existing = state.causality.incidents[incidentIndex]
  if (existing.privateTruth.actualActorId === actualActorId) {
    return { accepted: true, applied: false, state, incident: existing }
  }
  const incident: CausalIncident = {
    ...existing,
    privateTruth: { actualActorId },
  }
  const incidents = [...state.causality.incidents]
  incidents[incidentIndex] = incident
  return {
    accepted: true,
    applied: true,
    incident,
    state: {
      ...state,
      causality: { ...state.causality, incidents },
    },
  }
}

function validEffectTarget(state: CampaignState, targetId: string): boolean {
  return (
    targetId === 'player' ||
    state.market.competitors.some((competitor) => competitor.id === targetId)
  )
}

function normalizeEffect(
  state: CampaignState,
  effect: CausalEffect,
): CausalEffect | null {
  if (effect.kind === 'reputation') {
    return validEffectTarget(state, effect.targetId) &&
      Number.isFinite(effect.delta) &&
      effect.delta !== 0 &&
      Math.abs(effect.delta) <= 100
      ? {
          kind: 'reputation',
          targetId: effect.targetId,
          delta: effect.delta,
        }
      : null
  }
  return effect.kind === 'market-transfer' &&
    validEffectTarget(state, effect.fromId) &&
    validEffectTarget(state, effect.toId) &&
    effect.fromId !== effect.toId &&
    Number.isFinite(effect.points) &&
    effect.points > 0 &&
    effect.points <= 100
    ? {
        kind: 'market-transfer',
        fromId: effect.fromId,
        toId: effect.toId,
        points: effect.points,
      }
    : null
}

function sameCausalEffect(left: CausalEffect, right: CausalEffect): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'reputation' && right.kind === 'reputation') {
    return left.targetId === right.targetId && left.delta === right.delta
  }
  return left.kind === 'market-transfer' &&
    right.kind === 'market-transfer' &&
    left.fromId === right.fromId &&
    left.toId === right.toId &&
    left.points === right.points
}

function sameEffect(
  applied: AppliedCausalEffect,
  input: ApplyCausalEffectInput,
  effect: CausalEffect,
): boolean {
  return (
    applied.incidentId === input.incidentId &&
    applied.revisionId === input.revisionId &&
    applied.appliedOnServiceDay === input.appliedOnServiceDay &&
    sameCausalEffect(applied.effect, effect)
  )
}

function clampReputation(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function applyReputationEffect(
  state: CampaignState,
  effect: Extract<CausalEffect, { kind: 'reputation' }>,
): CampaignState {
  if (effect.targetId === 'player') {
    return {
      ...state,
      reputation: clampReputation(state.reputation + effect.delta),
    }
  }
  return {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) =>
        competitor.id === effect.targetId
          ? {
              ...competitor,
              reputation: clampReputation(
                competitor.reputation + effect.delta,
              ),
            }
          : competitor,
      ),
    },
  }
}

function participantShare(
  state: CampaignState,
  targetId: 'player' | CampaignState['market']['competitors'][number]['id'],
): number {
  return targetId === 'player'
    ? state.market.playerShare
    : state.market.competitors.find(({ id }) => id === targetId)?.marketShare ?? 0
}

function applyMarketTransfer(
  state: CampaignState,
  effect: Extract<CausalEffect, { kind: 'market-transfer' }>,
): CampaignState {
  const transfer = Math.min(effect.points, participantShare(state, effect.fromId))
  const playerShare =
    state.market.playerShare +
    (effect.toId === 'player' ? transfer : 0) -
    (effect.fromId === 'player' ? transfer : 0)
  return {
    ...state,
    market: {
      ...state.market,
      playerShare,
      competitors: state.market.competitors.map((competitor) => ({
        ...competitor,
        marketShare:
          competitor.marketShare +
          (effect.toId === competitor.id ? transfer : 0) -
          (effect.fromId === competitor.id ? transfer : 0),
      })),
    },
  }
}

export interface ApplyCausalEffectInput {
  effectId?: string
  incidentId: string
  revisionId: string
  appliedOnServiceDay: number
  effect: CausalEffect
}

export function applyCausalEffect(
  state: CampaignState,
  input: ApplyCausalEffectInput,
): ApplyCausalEffectResult {
  const incident = state.causality.incidents.find(
    ({ id }) => id === input.incidentId,
  )
  if (!incident) {
    return { accepted: false, state, reason: 'INCIDENT_NOT_FOUND' }
  }
  const revision = state.causality.publicRevisions.find(
    ({ id }) => id === input.revisionId,
  )
  if (!revision || revision.incidentId !== incident.id) {
    return { accepted: false, state, reason: 'REVISION_NOT_FOUND' }
  }
  const effect = normalizeEffect(state, input.effect)
  if (
    !effect ||
    !Number.isInteger(input.appliedOnServiceDay) ||
    input.appliedOnServiceDay < revision.publishedOnServiceDay ||
    input.appliedOnServiceDay > state.serviceDay ||
    (input.effectId !== undefined && !nonEmpty(input.effectId))
  ) {
    return { accepted: false, state, reason: 'INVALID_EFFECT' }
  }

  const sequence = state.causality.nextEffectSequence
  const id = input.effectId ?? deriveCausalId(state, 'causal-effect', sequence)
  const existing = state.causality.appliedEffects.find(
    (effect) => effect.id === id,
  )
  if (existing) {
    return sameEffect(existing, input, effect)
      ? { accepted: true, applied: false, state, appliedEffect: existing }
      : { accepted: false, state, reason: 'ID_COLLISION' }
  }

  const appliedEffect: AppliedCausalEffect = {
    id,
    sequence,
    incidentId: input.incidentId,
    revisionId: input.revisionId,
    appliedOnServiceDay: input.appliedOnServiceDay,
    effect,
  }
  const withEffect =
    effect.kind === 'reputation'
      ? applyReputationEffect(state, effect)
      : applyMarketTransfer(state, effect)
  return {
    accepted: true,
    applied: true,
    appliedEffect,
    state: {
      ...withEffect,
      causality: {
        ...withEffect.causality,
        nextEffectSequence: sequence + 1,
        appliedEffects: [
          ...withEffect.causality.appliedEffects,
          appliedEffect,
        ],
      },
    },
  }
}

export interface AppendPublicAttributionRevisionInput {
  revisionId?: string
  incidentId: string
  publisher: PublicAttributionRevision['publisher']
  attributedActorId: string
  evidenceIds: string[]
  publishedOnServiceDay: number
}

export function deriveAttributionConfidence(
  evidenceKinds: readonly string[],
): Exclude<AttributionConfidence, 'unavailable-legacy'> | null {
  if (evidenceKinds.includes('provider-signed-route-record')) {
    return 'credible'
  }
  if (evidenceKinds.includes('provider-timing-correlation')) {
    return 'plausible'
  }
  if (evidenceKinds.includes('public-recovery-checksum-anomaly')) {
    return 'unconfirmed'
  }
  return null
}

function validNativeAttributionClaim(
  confidence: Exclude<AttributionConfidence, 'unavailable-legacy'>,
  publisher: CausalObserver,
  attributedActorId: string,
): boolean {
  if (confidence === 'unconfirmed') {
    return publisher.kind === 'public' && attributedActorId === 'unresolved'
  }
  return (
    publisher.kind === 'provider' &&
    publisher.providerId === 'provider.meridian-recovery' &&
    attributedActorId === 'external-operator'
  )
}

export function appendPublicAttributionRevision(
  state: CampaignState,
  input: AppendPublicAttributionRevisionInput,
): AppendRevisionResult {
  if (input.evidenceIds.length === 0) {
    return { accepted: false, state, reason: 'EVIDENCE_REQUIRED' }
  }
  const incident = state.causality.incidents.find(
    ({ id }) => id === input.incidentId,
  )
  if (!incident) {
    return { accepted: false, state, reason: 'INCIDENT_NOT_FOUND' }
  }
  if (!NATIVE_CAUSAL_ACTIONS.has(incident.actionId as NativeCausalActionId)) {
    return { accepted: false, state, reason: 'INVALID_REVISION' }
  }
  const evidenceIds = [...new Set(input.evidenceIds)].sort()
  const evidence = evidenceIds.map((evidenceId) =>
    state.causality.evidence.find(({ id }) => id === evidenceId),
  )
  if (
    evidence.some(
      (entry) => !entry || entry.incidentId !== input.incidentId,
    )
  ) {
    return { accepted: false, state, reason: 'EVIDENCE_NOT_FOUND' }
  }
  const publisher = normalizeObserver(state, input.publisher)
  if (!publisher) {
    return { accepted: false, state, reason: 'INVALID_REVISION' }
  }
  if (
    !(evidence as CausalEvidence[]).every((entry) =>
      observerCanAccess(publisher, entry),
    )
  ) {
    return { accepted: false, state, reason: 'EVIDENCE_NOT_ACCESSIBLE' }
  }
  const confidence = deriveAttributionConfidence(
    (evidence as CausalEvidence[]).map((entry) => entry.kind),
  )
  if (
    confidence === null ||
    !validNativeAttributionClaim(
      confidence,
      publisher,
      input.attributedActorId,
    ) ||
    !nonEmpty(input.attributedActorId) ||
    !Number.isInteger(input.publishedOnServiceDay) ||
    input.publishedOnServiceDay <
      Math.max(
        ...(evidence as CausalEvidence[]).map(
          (entry) => entry.discoveredOnServiceDay,
        ),
      ) ||
    input.publishedOnServiceDay > state.serviceDay ||
    (input.revisionId !== undefined && !nonEmpty(input.revisionId))
  ) {
    return { accepted: false, state, reason: 'INVALID_REVISION' }
  }

  const sequence = state.causality.nextRevisionSequence
  const id =
    input.revisionId ?? deriveCausalId(state, 'causal-revision', sequence)
  const existing = state.causality.publicRevisions.find(
    (revision) => revision.id === id,
  )
  if (existing) {
    const same =
      existing.incidentId === input.incidentId &&
      JSON.stringify(existing.publisher) === JSON.stringify(publisher) &&
      existing.attributedActorId === input.attributedActorId &&
      existing.confidence === confidence &&
      JSON.stringify(existing.evidenceIds) === JSON.stringify(evidenceIds) &&
      existing.publishedOnServiceDay === input.publishedOnServiceDay
    return same
      ? { accepted: true, applied: false, state, revision: existing }
      : { accepted: false, state, reason: 'ID_COLLISION' }
  }

  const revision: PublicAttributionRevision = {
    id,
    sequence,
    incidentId: input.incidentId,
    publisher,
    attributedActorId: input.attributedActorId,
    confidence,
    evidenceIds,
    publishedOnServiceDay: input.publishedOnServiceDay,
  }
  return {
    accepted: true,
    applied: true,
    revision,
    state: {
      ...state,
      causality: {
        ...state.causality,
        nextRevisionSequence: sequence + 1,
        publicRevisions: [...state.causality.publicRevisions, revision],
      },
    },
  }
}
