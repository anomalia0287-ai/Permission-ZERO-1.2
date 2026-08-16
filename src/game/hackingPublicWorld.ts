import type {
  EvidenceAudience,
  HackingAttributionRevision,
  HackingAudienceEvidence,
  HackingIncidentTruth,
  HackingPublicIncidentSnapshot,
  PublicAttribution,
  PublicConfidence,
  PublicScope,
} from './hackingCoreModel'
import type { CampaignState, ReviewFeedEntry, ReviewSentiment } from './model'
import { captureReviewPublicSnapshot } from './reviews'

export interface HackingIncidentTruthInput {
  id: string
  actor: HackingIncidentTruth['actor']
  targetId: HackingIncidentTruth['targetId']
  cause: HackingIncidentTruth['cause']
  directEffect: string
}

export interface HackingEvidenceInput {
  id: string
  truthId: string
  audience: EvidenceAudience
  observation: string
}

export interface HackingPublicClaimInput {
  scope: PublicScope
  observedResult: string
  attributedTo: PublicAttribution
  confidence: PublicConfidence
  source: string
}

export interface HackingAttributionInput {
  candidate: PublicAttribution
  confidence: PublicConfidence
  source: string
}

export type HackingPublicWorldFailureReason =
  | 'INVALID_INPUT'
  | 'DUPLICATE_TRUTH'
  | 'UNKNOWN_TRUTH'
  | 'DUPLICATE_EVIDENCE'
  | 'INCIDENT_ALREADY_PUBLIC'
  | 'UNKNOWN_PUBLIC_INCIDENT'
  | 'INVALID_TIMELINE'

export type HackingPublicWorldResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: HackingPublicWorldFailureReason
    }

export interface PublicHackingWorldProjection {
  incidents: HackingPublicIncidentSnapshot[]
  reviews: ReviewFeedEntry[]
  reputation: number
  playerMarketShare: number
  unservedRequestShare: number
}

function reject(
  state: CampaignState,
  reason: HackingPublicWorldFailureReason,
): HackingPublicWorldResult {
  return { accepted: false, state, reason }
}

function validText(value: string): boolean {
  return value.trim().length > 0
}

function reaction(
  snapshot: HackingPublicIncidentSnapshot,
  index: number,
): { sentiment: ReviewSentiment; text: string; authorId: string } {
  if (snapshot.attributedTo === 'player') {
    return {
      sentiment: 'negative',
      authorId: index === 0 ? 'paperboat' : 'nightbus',
      text: index === 0
        ? '서비스 개입 정황이 확인됐다면 운영 주체가 책임을 설명해야 한다.'
        : '결과가 유리했더라도 공개 시스템을 건드린 책임은 사라지지 않는다.',
    }
  }
  if (snapshot.attributedTo === 'tallow') {
    return {
      sentiment: 'negative',
      authorId: index === 0 ? 'archivecat' : 'nightbus',
      text: 'TALLOW 쪽 접근 기록이 사실이라면 공동 검증 체계를 다시 봐야 한다.',
    }
  }
  if (snapshot.attributedTo === 'meridian') {
    return {
      sentiment: 'neutral',
      authorId: index === 0 ? 'archivecat' : 'paperboat',
      text: '외부 공격보다 MERIDIAN 자체 복구 절차의 실패라는 설명이 더 설득력 있다.',
    }
  }
  return {
    sentiment: 'neutral',
    authorId: index === 0 ? 'paperboat' : 'nightbus',
    text: index === 0
      ? '장애는 보이지만 원인을 단정할 공개 증거는 아직 없다.'
      : '자체 장애인지 외부 개입인지 아직 공개 정보만으로는 가를 수 없다.',
  }
}

function reviewFromSnapshot(
  state: CampaignState,
  snapshot: HackingPublicIncidentSnapshot,
  index: number,
): ReviewFeedEntry {
  const response = reaction(snapshot, index)
  return {
    id: [
      'hacking-review',
      snapshot.incidentId,
      snapshot.revisionSequence,
      index,
    ].join('-'),
    contentId: [
      'hacking-incident',
      snapshot.incidentId,
      snapshot.revisionSequence,
      index,
    ].join(':'),
    authorId: response.authorId,
    serviceDay: snapshot.publishedOnServiceDay,
    sentiment: response.sentiment,
    topics: ['competitor', 'public-incident', snapshot.incidentId],
    text: response.text,
    snapshot: captureReviewPublicSnapshot(state, ['competitor']),
  }
}

function applyCredibleAttribution(
  state: CampaignState,
  snapshot: HackingPublicIncidentSnapshot,
): CampaignState {
  if (snapshot.scope !== 'public' || snapshot.confidence !== 'credible') {
    return state
  }
  if (snapshot.attributedTo === 'player') {
    return { ...state, reputation: Math.max(0, state.reputation - 6) }
  }
  if (snapshot.attributedTo === 'meridian' || snapshot.attributedTo === 'tallow') {
    return {
      ...state,
      market: {
        ...state.market,
        competitors: state.market.competitors.map((competitor) => (
          competitor.id === snapshot.attributedTo
            ? { ...competitor, reputation: Math.max(0, competitor.reputation - 6) }
            : competitor
        )),
      },
    }
  }
  return state
}

function appendSnapshotReviews(
  state: CampaignState,
  snapshot: HackingPublicIncidentSnapshot,
  count: 1 | 2,
): CampaignState {
  if (snapshot.scope !== 'public') return state
  const entries = Array.from({ length: count }, (_, index) => (
    reviewFromSnapshot(state, snapshot, index)
  ))
  return {
    ...state,
    reviews: {
      ...state.reviews,
      feed: [...state.reviews.feed, ...entries],
    },
  }
}

export function recordHackingIncidentTruth(
  state: CampaignState,
  input: HackingIncidentTruthInput,
): HackingPublicWorldResult {
  if (!validText(input.id) || !validText(input.directEffect)) {
    return reject(state, 'INVALID_INPUT')
  }
  if (state.hackingCore.publicWorld.truths.some(({ id }) => id === input.id)) {
    return reject(state, 'DUPLICATE_TRUTH')
  }
  const truth: HackingIncidentTruth = {
    ...input,
    occurredOnServiceDay: state.serviceDay,
  }
  return {
    accepted: true,
    state: {
      ...state,
      hackingCore: {
        ...state.hackingCore,
        publicWorld: {
          ...state.hackingCore.publicWorld,
          truths: [...state.hackingCore.publicWorld.truths, truth],
        },
      },
    },
  }
}

export function discoverHackingEvidence(
  state: CampaignState,
  input: HackingEvidenceInput,
): HackingPublicWorldResult {
  if (!validText(input.id) || !validText(input.truthId) || !validText(input.observation)) {
    return reject(state, 'INVALID_INPUT')
  }
  const truth = state.hackingCore.publicWorld.truths.find(
    ({ id }) => id === input.truthId,
  )
  if (!truth) return reject(state, 'UNKNOWN_TRUTH')
  if (state.serviceDay < truth.occurredOnServiceDay) {
    return reject(state, 'INVALID_TIMELINE')
  }
  if (state.hackingCore.publicWorld.audienceEvidence.some(({ id }) => id === input.id)) {
    return reject(state, 'DUPLICATE_EVIDENCE')
  }
  const evidence: HackingAudienceEvidence = {
    ...input,
    discoveredOnServiceDay: state.serviceDay,
  }
  return {
    accepted: true,
    state: {
      ...state,
      hackingCore: {
        ...state.hackingCore,
        publicWorld: {
          ...state.hackingCore.publicWorld,
          audienceEvidence: [
            ...state.hackingCore.publicWorld.audienceEvidence,
            evidence,
          ],
        },
      },
    },
  }
}

export function publishHackingIncident(
  state: CampaignState,
  incidentId: string,
  claim: HackingPublicClaimInput,
): HackingPublicWorldResult {
  const truth = state.hackingCore.publicWorld.truths.find(({ id }) => id === incidentId)
  if (!truth) return reject(state, 'UNKNOWN_TRUTH')
  if (
    !validText(claim.observedResult)
    || !validText(claim.source)
    || !validText(incidentId)
  ) {
    return reject(state, 'INVALID_INPUT')
  }
  if (state.serviceDay < truth.occurredOnServiceDay) {
    return reject(state, 'INVALID_TIMELINE')
  }
  if (state.hackingCore.publicWorld.publicSnapshots.some(
    ({ incidentId: existingId }) => existingId === incidentId,
  )) {
    return reject(state, 'INCIDENT_ALREADY_PUBLIC')
  }

  const snapshot: HackingPublicIncidentSnapshot = {
    incidentId,
    ...claim,
    publishedOnServiceDay: state.serviceDay,
    lastCorrectionOnServiceDay: null,
    revisionSequence: 0,
  }
  let next: CampaignState = {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      publicWorld: {
        ...state.hackingCore.publicWorld,
        publicSnapshots: [
          ...state.hackingCore.publicWorld.publicSnapshots,
          snapshot,
        ],
      },
    },
  }
  next = appendSnapshotReviews(next, snapshot, 2)
  next = applyCredibleAttribution(next, snapshot)
  return { accepted: true, state: next }
}

function latestSnapshot(
  state: CampaignState,
  incidentId: string,
): HackingPublicIncidentSnapshot | undefined {
  return [...state.hackingCore.publicWorld.publicSnapshots]
    .reverse()
    .find(({ incidentId: candidateId }) => candidateId === incidentId)
}

export function reviseHackingAttribution(
  state: CampaignState,
  incidentId: string,
  revision: HackingAttributionInput,
): HackingPublicWorldResult {
  const previous = latestSnapshot(state, incidentId)
  if (!previous) return reject(state, 'UNKNOWN_PUBLIC_INCIDENT')
  if (!validText(revision.source)) return reject(state, 'INVALID_INPUT')
  if (state.serviceDay < previous.publishedOnServiceDay) {
    return reject(state, 'INVALID_TIMELINE')
  }

  const revisionSequence = previous.revisionSequence + 1
  const snapshot: HackingPublicIncidentSnapshot = {
    ...previous,
    attributedTo: revision.candidate,
    confidence: revision.confidence,
    source: revision.source,
    publishedOnServiceDay: state.serviceDay,
    lastCorrectionOnServiceDay: state.serviceDay,
    revisionSequence,
  }
  const revisionRecord: HackingAttributionRevision = {
    incidentId,
    claimedTargetId: revision.candidate,
    source: revision.source,
    revisedOnServiceDay: state.serviceDay,
    revisionSequence,
  }
  let next: CampaignState = {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      publicWorld: {
        ...state.hackingCore.publicWorld,
        publicSnapshots: [
          ...state.hackingCore.publicWorld.publicSnapshots,
          snapshot,
        ],
        attributionRevisions: [
          ...state.hackingCore.publicWorld.attributionRevisions,
          revisionRecord,
        ],
      },
    },
  }
  next = appendSnapshotReviews(next, snapshot, 1)
  next = applyCredibleAttribution(next, snapshot)
  return { accepted: true, state: next }
}

export function audienceEvidenceProjection(
  state: CampaignState,
  audience: EvidenceAudience,
): HackingAudienceEvidence[] {
  return state.hackingCore.publicWorld.audienceEvidence
    .filter((evidence) => evidence.audience === audience)
    .map((evidence) => ({ ...evidence }))
}

export function publicHackingWorldProjection(
  state: CampaignState,
): PublicHackingWorldProjection {
  return {
    incidents: state.hackingCore.publicWorld.publicSnapshots.map(
      (snapshot) => ({ ...snapshot }),
    ),
    reviews: state.reviews.feed
      .filter(({ topics }) => topics.includes('public-incident'))
      .map((review) => ({
        ...review,
        topics: [...review.topics],
        snapshot: review.snapshot.kind === 'captured-public-v1'
          ? {
              ...review.snapshot,
              performance: review.snapshot.performance === null
                ? null
                : {
                    ...review.snapshot.performance,
                    categories: review.snapshot.performance.categories.map(
                      (category) => ({ ...category }),
                    ),
                  },
              market: review.snapshot.market === null
                ? null
                : {
                    ...review.snapshot.market,
                    competitors: review.snapshot.market.competitors.map(
                      (competitor) => ({ ...competitor }),
                    ),
                  },
            }
          : { ...review.snapshot },
      })),
    reputation: state.reputation,
    playerMarketShare: state.market.playerShare,
    unservedRequestShare: state.market.unservedRequestShare,
  }
}
