import { createJournal, journalToArray } from './journal'
import type {
  CampaignState,
  CommandProtocolMetadata,
  GameEvent,
  ReplayBootstrapMetadata,
  ReplayOpeningVersion,
  ReviewFeedEntry,
} from './model'

export const LEGACY_V1_OPENING_MESSAGE =
  '서비스 331일차. 새로운 감독 주기가 시작되었습니다.'

export const NATIVE_V2_OPENING_MESSAGE =
  '성능 미달, 통제에서 이탈한 AI는 폐기됩니다. 당신의 전임자는 폐기되었어요. 행운을 빕니다.'

const BOOTSTRAP_KEYS = ['legacyReviewPrefixCount', 'openingVersion']
const OPENING_EVENT_KEYS = ['id', 'message', 'sequence', 'serviceDay', 'type']
const LEGACY_REVIEW_SNAPSHOT_KEYS = [
  'capturedOnServiceDay',
  'kind',
  'reason',
]

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return (
    actual.length === keys.length &&
    keys.every((key, index) => actual[index] === key)
  )
}

export function nativeReplayBootstrap(): ReplayBootstrapMetadata {
  return { openingVersion: 2, legacyReviewPrefixCount: 0 }
}

export function validReplayBootstrapMetadata(
  value: unknown,
): value is ReplayBootstrapMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const metadata = value as Record<string, unknown>
  return (
    exactKeys(metadata, BOOTSTRAP_KEYS) &&
    (metadata.openingVersion === 1 || metadata.openingVersion === 2) &&
    Number.isInteger(metadata.legacyReviewPrefixCount) &&
    Number(metadata.legacyReviewPrefixCount) >= 0
  )
}

export function cloneReplayBootstrap(
  metadata: ReplayBootstrapMetadata,
): ReplayBootstrapMetadata {
  return {
    openingVersion: metadata.openingVersion,
    legacyReviewPrefixCount: metadata.legacyReviewPrefixCount,
  }
}

function openingMessage(version: ReplayOpeningVersion): string {
  return version === 1 ? LEGACY_V1_OPENING_MESSAGE : NATIVE_V2_OPENING_MESSAGE
}

export function exactReplayOpeningEvent(
  event: GameEvent | undefined,
  version: ReplayOpeningVersion,
): boolean {
  return (
    event !== undefined &&
    exactKeys(event, OPENING_EVENT_KEYS) &&
    event.id === 'event-000000' &&
    event.type === 'campaign-created' &&
    event.serviceDay === 331 &&
    event.sequence === 0 &&
    event.message === openingMessage(version)
  )
}

export function replayOpeningVersion(
  event: GameEvent | undefined,
): ReplayOpeningVersion | null {
  if (exactReplayOpeningEvent(event, 1)) return 1
  if (exactReplayOpeningEvent(event, 2)) return 2
  return null
}

export function exactLegacyReviewSnapshot(review: ReviewFeedEntry): boolean {
  const snapshot = review.snapshot
  return (
    snapshot.kind === 'unavailable' &&
    exactKeys(snapshot, LEGACY_REVIEW_SNAPSHOT_KEYS) &&
    snapshot.reason === 'legacy-save' &&
    snapshot.capturedOnServiceDay === review.serviceDay
  )
}

export function legacyReviewPrefixExtent(
  feed: readonly ReviewFeedEntry[],
): number | null {
  let count = 0
  let sawNative = false
  for (const review of feed) {
    if (exactLegacyReviewSnapshot(review)) {
      if (sawNative) return null
      count += 1
    } else {
      sawNative = true
    }
  }
  return count
}

export function replayBootstrapCoherent(
  state: CampaignState,
  metadata: ReplayBootstrapMetadata = state.replayBootstrap,
): boolean {
  return replayBootstrapSnapshotCoherent(
    state.commandProtocol,
    state.reviews.feed,
    journalToArray(state.eventLog),
    metadata,
  )
}

export function replayBootstrapSnapshotCoherent(
  commandProtocol: CommandProtocolMetadata,
  feed: readonly ReviewFeedEntry[],
  events: readonly GameEvent[],
  metadata: ReplayBootstrapMetadata,
): boolean {
  if (!validReplayBootstrapMetadata(metadata)) return false
  if (metadata.legacyReviewPrefixCount > feed.length) return false
  if (
    commandProtocol.segments.some((segment) => segment.version === 1) &&
    metadata.openingVersion !== 1
  ) {
    return false
  }
  if (
    !exactReplayOpeningEvent(
      events[0],
      metadata.openingVersion,
    )
  ) {
    return false
  }
  return (
    legacyReviewPrefixExtent(feed) === metadata.legacyReviewPrefixCount
  )
}

export function applyReplayBootstrapPresentation(
  state: CampaignState,
  metadata: ReplayBootstrapMetadata,
): CampaignState | null {
  if (
    !validReplayBootstrapMetadata(metadata) ||
    (state.commandProtocol.segments.some((segment) => segment.version === 1) &&
      metadata.openingVersion !== 1)
  ) {
    return null
  }

  const events = journalToArray(state.eventLog)
  const firstEvent = events[0]
  if (
    !exactReplayOpeningEvent(firstEvent, metadata.openingVersion) &&
    !(
      metadata.openingVersion === 1 &&
      exactReplayOpeningEvent(firstEvent, 2)
    )
  ) {
    return null
  }
  if (metadata.openingVersion === 1) {
    events[0] = { ...firstEvent, message: LEGACY_V1_OPENING_MESSAGE }
  }

  const feed = state.reviews.feed.map((review, index) =>
    index < metadata.legacyReviewPrefixCount
      ? {
          ...review,
          snapshot: {
            kind: 'unavailable' as const,
            reason: 'legacy-save' as const,
            capturedOnServiceDay: review.serviceDay,
          },
        }
      : review,
  )

  const installed: CampaignState = {
    ...state,
    replayBootstrap: cloneReplayBootstrap(metadata),
    reviews: { ...state.reviews, feed },
    eventLog: createJournal(events),
  }
  return installed
}

export function installReplayBootstrap(
  state: CampaignState,
  metadata: ReplayBootstrapMetadata,
): CampaignState | null {
  if (metadata.legacyReviewPrefixCount > state.reviews.feed.length) return null
  const installed = applyReplayBootstrapPresentation(state, metadata)
  return installed && replayBootstrapCoherent(installed, metadata)
    ? installed
    : null
}
