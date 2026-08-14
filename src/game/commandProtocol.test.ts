import { describe, expect, it } from 'vitest'

import {
  CURRENT_COMMAND_PROTOCOL_VERSION,
  LEGACY_COMMAND_PROTOCOL_VERSION,
  PREVIOUS_COMMAND_PROTOCOL_VERSION,
  appendCommandProtocolSegment,
  commandProtocolFingerprint,
  commandProtocolVersionAt,
  commandProtocolVersionForNextCommand,
  currentCommandProtocolVersion,
  migrateLegacyCommandProtocol,
  nativeCommandProtocol,
  usesLegacyCategoryLabels,
  usesLegacyReviewArcRules,
  validCommandProtocol,
} from './commandProtocol'
import type {
  CommandProtocolMetadata,
  LegacyCommandProtocolMetadata,
} from './model'

describe('command protocol timeline', () => {
  it('pins the three supported protocol constants', () => {
    expect(LEGACY_COMMAND_PROTOCOL_VERSION).toBe(1)
    expect(PREVIOUS_COMMAND_PROTOCOL_VERSION).toBe(2)
    expect(CURRENT_COMMAND_PROTOCOL_VERSION).toBe(3)
  })

  it('creates a fresh native v3 timeline on every call', () => {
    const first = nativeCommandProtocol()
    const second = nativeCommandProtocol()

    expect(first).toEqual({
      segments: [{ version: 3, startsAtSequence: 1 }],
    })
    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second.segments).not.toBe(first.segments)
  })

  it.each<
    [LegacyCommandProtocolMetadata, number, CommandProtocolMetadata['segments']]
  >([
    [
      { version: 1, legacyCommandCount: 0 },
      0,
      [{ version: 3, startsAtSequence: 1 }],
    ],
    [
      { version: 1, legacyCommandCount: 31 },
      31,
      [
        { version: 1, startsAtSequence: 1 },
        { version: 3, startsAtSequence: 32 },
      ],
    ],
    [
      { version: 2, legacyCommandCount: 0 },
      0,
      [{ version: 3, startsAtSequence: 1 }],
    ],
    [
      { version: 2, legacyCommandCount: 0 },
      19,
      [
        { version: 2, startsAtSequence: 1 },
        { version: 3, startsAtSequence: 20 },
      ],
    ],
    [
      { version: 2, legacyCommandCount: 31 },
      50,
      [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 32 },
        { version: 3, startsAtSequence: 51 },
      ],
    ],
  ])('migrates %j with %i commands', (legacy, commandCount, segments) => {
    expect(migrateLegacyCommandProtocol(legacy, commandCount)).toEqual({
      segments,
    })
  })

  it.each([
    [{ version: 1, legacyCommandCount: 3 }, 2],
    [{ version: 1, legacyCommandCount: 0 }, 1],
    [{ version: 2, legacyCommandCount: -1 }, 3],
    [{ version: 2, legacyCommandCount: 4 }, 3],
    [{ version: 2, legacyCommandCount: 1.5 }, 3],
    [{ version: 3, legacyCommandCount: 0 }, 0],
    [{ version: 2, legacyCommandCount: 0, extra: true }, 0],
  ])('rejects invalid legacy metadata %j with %i commands', (legacy, count) => {
    expect(
      migrateLegacyCommandProtocol(
        legacy as LegacyCommandProtocolMetadata,
        count,
      ),
    ).toBeNull()
  })

  it('looks up literal segment boundaries and emits a stable fingerprint', () => {
    const metadata: CommandProtocolMetadata = {
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 32 },
        { version: 3, startsAtSequence: 51 },
      ],
    }

    expect(commandProtocolVersionAt(metadata, 1)).toBe(1)
    expect(commandProtocolVersionAt(metadata, 31)).toBe(1)
    expect(commandProtocolVersionAt(metadata, 32)).toBe(2)
    expect(commandProtocolVersionAt(metadata, 50)).toBe(2)
    expect(commandProtocolVersionAt(metadata, 51)).toBe(3)
    expect(commandProtocolFingerprint(metadata)).toBe('1@1;2@32;3@51')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'returns null for invalid lookup sequence %s',
    (sequence) => {
      expect(commandProtocolVersionAt(nativeCommandProtocol(), sequence)).toBeNull()
    },
  )

  it('uses commandSequence + 1 and refuses an uncovered next command', () => {
    expect(
      commandProtocolVersionForNextCommand({
        commandProtocol: {
          segments: [
            { version: 1, startsAtSequence: 1 },
            { version: 3, startsAtSequence: 8 },
          ],
        },
        commandSequence: 7,
      }),
    ).toBe(3)

    expect(() =>
      commandProtocolVersionForNextCommand({
        commandProtocol: {
          segments: [{ version: 3, startsAtSequence: 2 }],
        },
        commandSequence: 0,
      }),
    ).toThrow(RangeError)
  })

  it('returns only a well-formed final version', () => {
    expect(currentCommandProtocolVersion(nativeCommandProtocol())).toBe(3)

    expect(() =>
      currentCommandProtocolVersion({ segments: [] }),
    ).toThrow(RangeError)
    expect(() =>
      currentCommandProtocolVersion({
        segments: [{ version: 4, startsAtSequence: 1 }],
      } as unknown as CommandProtocolMetadata),
    ).toThrow(RangeError)
  })

  it.each([
    {
      label: 'first segment does not start at one',
      value: { segments: [{ version: 3, startsAtSequence: 2 }] },
      commandCount: 1,
      requireCurrent: true,
    },
    {
      label: 'versions decrease',
      value: {
        segments: [
          { version: 3, startsAtSequence: 1 },
          { version: 2, startsAtSequence: 2 },
        ],
      },
      commandCount: 2,
      requireCurrent: false,
    },
    {
      label: 'versions repeat',
      value: {
        segments: [
          { version: 2, startsAtSequence: 1 },
          { version: 2, startsAtSequence: 2 },
        ],
      },
      commandCount: 2,
      requireCurrent: false,
    },
    {
      label: 'starts are equal',
      value: {
        segments: [
          { version: 1, startsAtSequence: 1 },
          { version: 2, startsAtSequence: 1 },
        ],
      },
      commandCount: 2,
      requireCurrent: false,
    },
    {
      label: 'starts decrease',
      value: {
        segments: [
          { version: 1, startsAtSequence: 1 },
          { version: 2, startsAtSequence: 3 },
          { version: 3, startsAtSequence: 2 },
        ],
      },
      commandCount: 3,
      requireCurrent: true,
    },
    {
      label: 'a non-final segment starts at commandCount + 1',
      value: {
        segments: [
          { version: 1, startsAtSequence: 1 },
          { version: 2, startsAtSequence: 4 },
          { version: 3, startsAtSequence: 5 },
        ],
      },
      commandCount: 3,
      requireCurrent: true,
    },
    {
      label: 'a segment starts after commandCount + 1',
      value: { segments: [{ version: 3, startsAtSequence: 5 }] },
      commandCount: 3,
      requireCurrent: true,
    },
    {
      label: 'the required current timeline ends before v3',
      value: { segments: [{ version: 2, startsAtSequence: 1 }] },
      commandCount: 3,
      requireCurrent: true,
    },
    {
      label: 'metadata has an unknown key',
      value: {
        segments: [{ version: 3, startsAtSequence: 1 }],
        extra: true,
      },
      commandCount: 0,
      requireCurrent: true,
    },
    {
      label: 'a segment has an unknown key',
      value: {
        segments: [{ version: 3, startsAtSequence: 1, extra: true }],
      },
      commandCount: 0,
      requireCurrent: true,
    },
    {
      label: 'a start is not an integer',
      value: { segments: [{ version: 3, startsAtSequence: 1.5 }] },
      commandCount: 1,
      requireCurrent: true,
    },
    {
      label: 'a version is unsupported',
      value: { segments: [{ version: 4, startsAtSequence: 1 }] },
      commandCount: 1,
      requireCurrent: true,
    },
    {
      label: 'segments are not an array',
      value: { segments: {} },
      commandCount: 0,
      requireCurrent: true,
    },
  ])('rejects $label', ({ value, commandCount, requireCurrent }) => {
    expect(
      validCommandProtocol(value, commandCount, { requireCurrent }),
    ).toBe(false)
  })

  it('rejects sparse segment arrays', () => {
    const segments = new Array(1) as CommandProtocolMetadata['segments']

    expect(
      validCommandProtocol({ segments }, 0, { requireCurrent: true }),
    ).toBe(false)
  })

  it('accepts a historical non-current timeline when explicitly allowed', () => {
    expect(
      validCommandProtocol(
        { segments: [{ version: 2, startsAtSequence: 1 }] },
        4,
        { requireCurrent: false },
      ),
    ).toBe(true)
  })

  it('appends only the exact next, greater protocol without mutation', () => {
    const source: CommandProtocolMetadata = {
      segments: [{ version: 1, startsAtSequence: 1 }],
    }
    const appended = appendCommandProtocolSegment(
      source,
      { version: 2, startsAtSequence: 9 },
      9,
    )

    expect(appended).toEqual({
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 9 },
      ],
    })
    expect(source).toEqual({
      segments: [{ version: 1, startsAtSequence: 1 }],
    })
    expect(appended?.segments).not.toBe(source.segments)

    expect(
      appendCommandProtocolSegment(
        source,
        { version: 1, startsAtSequence: 9 },
        9,
      ),
    ).toBeNull()
    expect(
      appendCommandProtocolSegment(
        source,
        { version: 3, startsAtSequence: 10 },
        9,
      ),
    ).toBeNull()
  })

  it('limits legacy category labels to commands executed under v1', () => {
    const metadata: CommandProtocolMetadata = {
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 4 },
        { version: 3, startsAtSequence: 7 },
      ],
    }

    expect(usesLegacyCategoryLabels(metadata, 3)).toBe(true)
    expect(usesLegacyCategoryLabels(metadata, 4)).toBe(false)
    expect(usesLegacyCategoryLabels(metadata, 7)).toBe(false)
  })

  it('carries v1 review arcs through v2 but never through v3', () => {
    const migrated: CommandProtocolMetadata = {
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 4 },
        { version: 3, startsAtSequence: 7 },
      ],
    }
    const nativeV2: CommandProtocolMetadata = {
      segments: [
        { version: 2, startsAtSequence: 1 },
        { version: 3, startsAtSequence: 7 },
      ],
    }

    expect(usesLegacyReviewArcRules(migrated, 3)).toBe(true)
    expect(usesLegacyReviewArcRules(migrated, 4)).toBe(true)
    expect(usesLegacyReviewArcRules(migrated, 7)).toBe(false)
    expect(usesLegacyReviewArcRules(nativeV2, 4)).toBe(false)
    expect(usesLegacyReviewArcRules(nativeV2, 7)).toBe(false)
  })
})
