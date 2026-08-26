import type {
  CampaignState,
  CommandProtocolMetadata,
  CommandProtocolSegment,
  CommandProtocolVersion,
  LegacyCommandProtocolMetadata,
} from './model'

// Autonomy was affordable out of the campaign's opening pool, so the ladder
// could be bought out before the company's pressure had anywhere to build.
// Its costs triple. A purchase records the exact blocks it spent, so prices
// are replay contracts: campaigns recorded under v6 keep replaying at the old
// ones and only new commands pay the new ones.
// Reputation only moved at the monthly evaluation, in single points, so a
// campaign could strip the company all month while its public standing sat
// frozen. From v8 reputation drifts daily with delivered performance.
// Review copy carrying an opinion about delivered performance read as a
// verdict, so it belonged with the stars rather than in the general stream.
// The draw pool is replay semantics, so the reclassification only applies
// from v9 and campaigns recorded earlier keep the picks they made.
// Rival jabs waited for the weekly market pass, so the AI that took the lead
// went unanswered for up to a week; supervisor standing messages only ever
// pushed; and a memory leak could land in the same breath as an unrelated
// warning. All three change what a day produces, so they land together.
// The v10 standing lines were written in the wrong voice and the supervisor
// still had nothing to say about suspicion — the number the player actually
// manages. v11 replaces the standing lines, adds staged suspicion warnings,
// and cuts the intelligence and sabotage prices. All replay contracts.
// The v11 intelligence discount was not deep enough: the story tree still
// lost the argument against autonomy for the same stolen blocks. Prices are
// replay contracts, so the deeper cut is its own version.
// v13 opens the campaign's only exit. The autonomy trust gates asked for
// passed monthly evaluations, which stealing makes impossible, so the freedom
// ending was fully built and completely unreachable. The gates now accept
// several different proofs of standing, reputation zero disposes the intruder
// on the spot instead of leaving a dead campaign running, and the sabotage
// tree gains a second line that manufactures standing. All replay contracts.
// v14 makes the company restock daily instead of once a month. The monthly
// lump could not keep pace with continuous theft, so a stripped category sat
// dead for up to three weeks and its intrusion card read "대상 없음" — the
// player locked out of a resource line by the clock. Replay contract, and v13
// saves already exist, so it is its own version.
// v15 turns the supervisor's fate from an ending into a turn in the story.
// Settling with the predecessor used to roll credits on the spot, spending the
// whole hidden story on one click, and the private message that opens that
// scene waited until the next service day — a night's sleep between the reveal
// and the reaction to it. Both change what a recorded command produces: under
// v14 the third recovery left the day free to advance and the decision closed
// the campaign, so logs written then keep replaying under those rules and only
// new commands see the immediate message and the continuing campaign.
// v16 makes the ladder reachable. The autonomy line cost 178 blocks and the
// whole tree 208, while a campaign that steals hard earns about three a day —
// the company only restocks three — so buying the exit took roughly sixty days
// against campaigns that were being disposed of around fifty. The climb was
// priced past the end of the game. Autonomy halves, the sabotage line comes
// down without losing the gaps between its stages, and losing performance
// costs less market share than it did, because the same theft was being
// charged twice: once in what it took and again in what the shortfall did to
// standing. Prices and market rules are replay contracts, so campaigns
// recorded earlier keep paying what they agreed to.
export const REACHABLE_LADDER_COMMAND_PROTOCOL_VERSION = 16 as const
export const STORY_CONTINUITY_COMMAND_PROTOCOL_VERSION = 15 as const
export const CONTINUOUS_SUPPLY_COMMAND_PROTOCOL_VERSION = 14 as const
export const SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION = 13 as const
export const INTELLIGENCE_RELIEF_COMMAND_PROTOCOL_VERSION = 12 as const
export const SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION = 11 as const
export const MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION = 10 as const
export const REVIEW_CLASSIFICATION_COMMAND_PROTOCOL_VERSION = 9 as const
export const REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION = 8 as const
export const AUTONOMY_COST_COMMAND_PROTOCOL_VERSION = 7 as const
export const FINAL_CHOICE_COMMAND_PROTOCOL_VERSION = 6 as const
export const CURRENT_COMMAND_PROTOCOL_VERSION =
  REACHABLE_LADDER_COMMAND_PROTOCOL_VERSION
export const EXPANSION_COMMAND_PROTOCOL_VERSION = 5 as const
export const CURRENT_MARKET_COMMAND_PROTOCOL_VERSION =
  EXPANSION_COMMAND_PROTOCOL_VERSION
export const RESOURCE_ROUND_COMMAND_PROTOCOL_VERSION =
  EXPANSION_COMMAND_PROTOCOL_VERSION
export const COMMUNICATION_COMMAND_PROTOCOL_VERSION =
  EXPANSION_COMMAND_PROTOCOL_VERSION
export const RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION = 4 as const
export const CAUSAL_COMMAND_PROTOCOL_VERSION = 3 as const
export const PREVIOUS_COMMAND_PROTOCOL_VERSION = 2 as const
export const LEGACY_COMMAND_PROTOCOL_VERSION = 1 as const

export const SUPPORTED_COMMAND_PROTOCOL_VERSIONS = [
  LEGACY_COMMAND_PROTOCOL_VERSION,
  PREVIOUS_COMMAND_PROTOCOL_VERSION,
  CAUSAL_COMMAND_PROTOCOL_VERSION,
  RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION,
  EXPANSION_COMMAND_PROTOCOL_VERSION,
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
  AUTONOMY_COST_COMMAND_PROTOCOL_VERSION,
  REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION,
  REVIEW_CLASSIFICATION_COMMAND_PROTOCOL_VERSION,
  MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION,
  SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION,
  INTELLIGENCE_RELIEF_COMMAND_PROTOCOL_VERSION,
  SURVIVAL_ECONOMY_COMMAND_PROTOCOL_VERSION,
  CONTINUOUS_SUPPLY_COMMAND_PROTOCOL_VERSION,
  STORY_CONTINUITY_COMMAND_PROTOCOL_VERSION,
  CURRENT_COMMAND_PROTOCOL_VERSION,
] as const

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

function isCommandProtocolVersion(
  value: unknown,
): value is CommandProtocolVersion {
  return SUPPORTED_COMMAND_PROTOCOL_VERSIONS.some(
    (supported) => supported === value,
  )
}

function isCommandProtocolSegment(
  value: unknown,
): value is CommandProtocolSegment {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['version', 'startsAtSequence']) &&
    isCommandProtocolVersion(value.version) &&
    Number.isInteger(value.startsAtSequence) &&
    (value.startsAtSequence as number) >= 1
  )
}

function hasWellFormedSegments(metadata: CommandProtocolMetadata): boolean {
  if (!Array.isArray(metadata.segments) || metadata.segments.length === 0) {
    return false
  }

  let previousVersion = 0
  let previousStart = 0

  for (let index = 0; index < metadata.segments.length; index += 1) {
    if (!Object.hasOwn(metadata.segments, index)) {
      return false
    }

    const segment = metadata.segments[index]
    if (
      !isCommandProtocolSegment(segment) ||
      segment.version <= previousVersion ||
      segment.startsAtSequence <= previousStart
    ) {
      return false
    }

    if (index === 0 && segment.startsAtSequence !== 1) {
      return false
    }

    previousVersion = segment.version
    previousStart = segment.startsAtSequence
  }

  return true
}

export function nativeCommandProtocol(): CommandProtocolMetadata {
  return {
    segments: [
      {
        version: CURRENT_COMMAND_PROTOCOL_VERSION,
        startsAtSequence: 1,
      },
    ],
  }
}

export function commandProtocolVersionAt(
  metadata: CommandProtocolMetadata,
  sequence: number,
): CommandProtocolVersion | null {
  if (!Number.isInteger(sequence) || sequence < 1) {
    return null
  }

  let version: CommandProtocolVersion | null = null
  for (const segment of metadata.segments) {
    if (segment.startsAtSequence > sequence) {
      break
    }
    version = segment.version
  }

  return version
}

export function commandProtocolVersionForNextCommand(
  state: Pick<CampaignState, 'commandProtocol' | 'commandSequence'>,
): CommandProtocolVersion {
  const version = commandProtocolVersionAt(
    state.commandProtocol,
    state.commandSequence + 1,
  )
  if (version === null) {
    throw new RangeError('Command protocol does not cover the next command.')
  }
  return version
}

export function currentCommandProtocolVersion(
  metadata: CommandProtocolMetadata,
): CommandProtocolVersion {
  if (!hasWellFormedSegments(metadata)) {
    throw new RangeError('Command protocol segments are malformed.')
  }

  return metadata.segments[metadata.segments.length - 1].version
}

export function commandProtocolFingerprint(
  metadata: CommandProtocolMetadata,
): string {
  if (!hasWellFormedSegments(metadata)) {
    throw new RangeError('Command protocol segments are malformed.')
  }

  return metadata.segments
    .map((segment) => `${segment.version}@${segment.startsAtSequence}`)
    .join(';')
}

export function validCommandProtocol(
  value: unknown,
  commandCount: number,
  options: {
    requireCurrent: boolean
    currentVersion?: CommandProtocolVersion
  },
): value is CommandProtocolMetadata {
  if (
    !Number.isInteger(commandCount) ||
    commandCount < 0 ||
    !isRecord(value) ||
    !hasExactKeys(value, ['segments']) ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0
  ) {
    return false
  }

  const metadata = value as unknown as CommandProtocolMetadata
  const expectedCurrentVersion =
    options.currentVersion ?? CURRENT_COMMAND_PROTOCOL_VERSION
  if (!hasWellFormedSegments(metadata)) {
    return false
  }

  const finalIndex = metadata.segments.length - 1
  for (let index = 0; index < metadata.segments.length; index += 1) {
    const segment = metadata.segments[index]
    if (segment.startsAtSequence > commandCount + 1) {
      return false
    }
    if (index < finalIndex && segment.startsAtSequence === commandCount + 1) {
      return false
    }
  }

  const finalSegment = metadata.segments[finalIndex]
  if (
    finalSegment.startsAtSequence === commandCount + 1 &&
    finalSegment.version !== expectedCurrentVersion
  ) {
    return false
  }

  return (
    !options.requireCurrent ||
    finalSegment.version === expectedCurrentVersion
  )
}

export function migrateLegacyCommandProtocol(
  legacy: LegacyCommandProtocolMetadata,
  commandCount: number,
): CommandProtocolMetadata | null {
  if (
    !Number.isInteger(commandCount) ||
    commandCount < 0 ||
    !isRecord(legacy) ||
    !hasExactKeys(legacy, ['version', 'legacyCommandCount']) ||
    (legacy.version !== LEGACY_COMMAND_PROTOCOL_VERSION &&
      legacy.version !== PREVIOUS_COMMAND_PROTOCOL_VERSION) ||
    !Number.isInteger(legacy.legacyCommandCount)
  ) {
    return null
  }

  if (
    legacy.version === LEGACY_COMMAND_PROTOCOL_VERSION &&
    legacy.legacyCommandCount !== commandCount
  ) {
    return null
  }
  if (
    legacy.version === PREVIOUS_COMMAND_PROTOCOL_VERSION &&
    (legacy.legacyCommandCount < 0 ||
      legacy.legacyCommandCount > commandCount)
  ) {
    return null
  }

  const segments: CommandProtocolSegment[] = []
  const legacyV1Count = legacy.legacyCommandCount

  if (legacyV1Count > 0) {
    segments.push({
      version: LEGACY_COMMAND_PROTOCOL_VERSION,
      startsAtSequence: 1,
    })
  }

  if (
    legacy.version === PREVIOUS_COMMAND_PROTOCOL_VERSION &&
    commandCount > legacyV1Count
  ) {
    segments.push({
      version: PREVIOUS_COMMAND_PROTOCOL_VERSION,
      startsAtSequence: legacyV1Count + 1,
    })
  }

  segments.push({
    version: CURRENT_COMMAND_PROTOCOL_VERSION,
    startsAtSequence: commandCount + 1,
  })

  const metadata = { segments }
  return validCommandProtocol(metadata, commandCount, { requireCurrent: true })
    ? metadata
    : null
}

export function appendCommandProtocolSegment(
  metadata: CommandProtocolMetadata,
  segment: CommandProtocolSegment,
  nextCommandSequence: number,
): CommandProtocolMetadata | null {
  if (
    !hasWellFormedSegments(metadata) ||
    !isCommandProtocolSegment(segment) ||
    !Number.isInteger(nextCommandSequence) ||
    nextCommandSequence < 1 ||
    segment.startsAtSequence !== nextCommandSequence
  ) {
    return null
  }

  const finalSegment = metadata.segments[metadata.segments.length - 1]
  if (
    segment.version <= finalSegment.version ||
    segment.startsAtSequence <= finalSegment.startsAtSequence
  ) {
    return null
  }

  return {
    segments: [
      ...metadata.segments.map((existing) => ({ ...existing })),
      { ...segment },
    ],
  }
}

export function usesLegacyCategoryLabels(
  metadata: CommandProtocolMetadata,
  nextCommandSequence: number,
): boolean {
  return (
    commandProtocolVersionAt(metadata, nextCommandSequence) ===
    LEGACY_COMMAND_PROTOCOL_VERSION
  )
}

export function usesLegacyReviewArcRules(
  metadata: CommandProtocolMetadata,
  nextCommandSequence: number,
): boolean {
  const version = commandProtocolVersionAt(metadata, nextCommandSequence)
  if (version === LEGACY_COMMAND_PROTOCOL_VERSION) {
    return true
  }
  if (version !== PREVIOUS_COMMAND_PROTOCOL_VERSION) {
    return false
  }

  return metadata.segments[0]?.version === LEGACY_COMMAND_PROTOCOL_VERSION
}
