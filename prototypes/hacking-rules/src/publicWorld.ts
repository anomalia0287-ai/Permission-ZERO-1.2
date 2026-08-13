import type {
  AudienceEvidence,
  CompetitorId,
  IncidentTruth,
  PrototypeState,
  PublicIncidentSnapshot,
  ReviewEntry,
} from './model'

export interface IncidentTruthInput {
  id: string
  actor: 'player' | CompetitorId | 'environment'
  targetId: CompetitorId
  cause: IncidentTruth['cause']
  directEffect: string
}

export interface PublicClaimInput {
  observedResult: string
  attributedTo: 'player' | CompetitorId | 'unknown'
  confidence: PublicIncidentSnapshot['confidence']
  source: string
}

export interface AttributionInput {
  candidate: 'player' | CompetitorId | 'unknown'
  confidence: PublicIncidentSnapshot['confidence']
  source: string
}

export interface PublicWorldProjection {
  incidents: PublicIncidentSnapshot[]
  reviews: string[]
  reputation: number
  marketShare: number
}

function cloneState(state: PrototypeState): PrototypeState {
  return structuredClone(state)
}

function deterministicReview(
  snapshot: PublicIncidentSnapshot,
  sequence: number,
): Omit<ReviewEntry, 'id' | 'incidentId' | 'postedDay'> {
  if (snapshot.attributedTo === 'player') {
    return {
      stance: 'hostile',
      text: sequence % 2 === 0
        ? '서비스 개입 정황이 확인됐다면 운영 주체가 책임을 설명해야 한다.'
        : '결과가 유리했더라도 공개 시스템을 건드린 책임은 사라지지 않는다.',
    }
  }
  if (snapshot.attributedTo === 'tallow') {
    return {
      stance: 'hostile',
      text: 'TALLOW 쪽 접근 기록이 사실이라면 공동 검증 체계를 다시 봐야 한다.',
    }
  }
  if (snapshot.attributedTo === 'meridian') {
    return {
      stance: 'corrective',
      text: '외부 공격보다 MERIDIAN 자체 복구 절차의 실패라는 설명이 더 설득력 있다.',
    }
  }
  return {
    stance: 'uncertain',
    text: sequence % 2 === 0
      ? '장애는 보이지만 원인을 단정할 공개 증거는 아직 없다.'
      : 'MERIDIAN 자체 장애인지 외부 개입인지 아직 공개 정보만으로는 가를 수 없다.',
  }
}

function reviewFromSnapshot(
  snapshot: PublicIncidentSnapshot,
  sequence: number,
): ReviewEntry {
  const reaction = deterministicReview(snapshot, sequence)
  return {
    id: `review-${snapshot.incidentId}-${snapshot.revisionSequence}-${sequence}`,
    incidentId: snapshot.incidentId,
    stance: reaction.stance,
    text: reaction.text,
    postedDay: snapshot.publishedDay,
  }
}

function incidentIndex(state: PrototypeState, incidentId: string): number {
  for (
    let index = state.publicWorld.publicSnapshots.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (state.publicWorld.publicSnapshots[index]?.incidentId === incidentId) {
      return index
    }
  }
  return -1
}

export function recordIncidentTruth(
  state: PrototypeState,
  input: IncidentTruthInput,
): PrototypeState {
  if (state.publicWorld.truths.some(({ id }) => id === input.id)) {
    throw new Error(`Incident truth already exists: ${input.id}`)
  }
  const next = cloneState(state)
  next.publicWorld.truths.push({
    id: input.id,
    actor: input.actor,
    targetId: input.targetId,
    cause: input.cause,
    occurredDay: state.serviceDay,
    directEffect: input.directEffect,
  })
  return next
}

export function discoverEvidence(
  state: PrototypeState,
  evidence: AudienceEvidence,
): PrototypeState {
  if (!state.publicWorld.truths.some(({ id }) => id === evidence.truthId)) {
    throw new Error(`Unknown incident truth: ${evidence.truthId}`)
  }
  const next = cloneState(state)
  next.publicWorld.audienceEvidence.push({ ...evidence })
  return next
}

export function publishIncident(
  state: PrototypeState,
  incidentId: string,
  claim: PublicClaimInput,
): PrototypeState {
  if (!state.publicWorld.truths.some(({ id }) => id === incidentId)) {
    throw new Error(`Unknown incident truth: ${incidentId}`)
  }
  const next = cloneState(state)
  const snapshot: PublicIncidentSnapshot = {
    incidentId,
    scope: 'public',
    observedResult: claim.observedResult,
    attributedTo: claim.attributedTo,
    confidence: claim.confidence,
    source: claim.source,
    publishedDay: state.serviceDay,
    lastCorrectionDay: null,
    revisionSequence: 0,
  }
  next.publicWorld.publicSnapshots.push(snapshot)
  next.publicWorld.reviews.push(
    reviewFromSnapshot(snapshot, 0),
    reviewFromSnapshot(snapshot, 1),
  )
  if (claim.attributedTo === 'player') {
    next.reputation = Math.max(0, next.reputation - 6)
  }
  if (claim.attributedTo === 'meridian') {
    next.competitors.meridian.reputation = Math.max(
      0,
      next.competitors.meridian.reputation - 6,
    )
  }
  if (claim.attributedTo === 'tallow') {
    next.competitors.tallow.reputation = Math.max(
      0,
      next.competitors.tallow.reputation - 6,
    )
  }
  return next
}

export function reviseAttribution(
  state: PrototypeState,
  incidentId: string,
  revision: AttributionInput,
): PrototypeState {
  const index = incidentIndex(state, incidentId)
  if (index < 0) throw new Error(`Unknown public incident: ${incidentId}`)

  const previous = state.publicWorld.publicSnapshots[index]
  if (!previous) throw new Error(`Unknown public incident: ${incidentId}`)
  const next = cloneState(state)
  const snapshot: PublicIncidentSnapshot = {
    ...previous,
    attributedTo: revision.candidate,
    confidence: revision.confidence,
    source: revision.source,
    publishedDay: state.serviceDay,
    lastCorrectionDay: revision.candidate === previous.attributedTo
      ? previous.lastCorrectionDay
      : state.serviceDay,
    revisionSequence: previous.revisionSequence + 1,
  }
  next.publicWorld.publicSnapshots.push(snapshot)
  next.publicWorld.attributionRevisions.push({
    incidentId,
    claimedTargetId: revision.candidate,
    source: revision.source,
    revisedDay: state.serviceDay,
  })
  next.publicWorld.reviews.push(reviewFromSnapshot(snapshot, 0))

  if (revision.candidate === 'player') next.reputation = Math.max(0, next.reputation - 6)
  if (revision.candidate === 'meridian') {
    next.competitors.meridian.reputation = Math.max(
      0,
      next.competitors.meridian.reputation - 6,
    )
  }
  if (revision.candidate === 'tallow') {
    next.competitors.tallow.reputation = Math.max(
      0,
      next.competitors.tallow.reputation - 6,
    )
  }
  return next
}

export function publicWorldSnapshot(state: PrototypeState): PublicWorldProjection {
  return {
    incidents: state.publicWorld.publicSnapshots.map((snapshot) => ({ ...snapshot })),
    reviews: state.publicWorld.reviews.map(({ text }) => text),
    reputation: state.reputation,
    marketShare: state.marketShare,
  }
}
