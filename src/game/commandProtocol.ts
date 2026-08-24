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
export const REVIEW_CLASSIFICATION_COMMAND_PROTOCOL_VERSION = 9 as const
export const REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION = 8 as const
export const AUTONOMY_COST_COMMAND_PROTOCOL_VERSION = 7 as const
export const FINAL_CHOICE_COMMAND_PROTOCOL_VERSION = 6 as const
export const CURRENT_COMMAND_PROTOCOL_VERSION =
  REVIEW_CLASSIFICATION_COMMAND_PROTOCOL_VERSION
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

const SUPPORTED_COMMAND_PROTOCOL_VERSIONS = [
  LEGACY_COMMAND_PROTOCOL_VERSION,
  PREVIOUS_COMMAND_PROTOCOL_VERSION,
  CAUSAL_COMMAND_PROTOCOL_VERSION,
  RESOURCE_INTRUSION_COMMAND_PROTOCOL_VERSION,
  EXPANSION_COMMAND_PROTOCOL_VERSION,
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
  AUTONOMY_COST_COMMAND_PROTOCOL_VERSION,
  REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION,
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
