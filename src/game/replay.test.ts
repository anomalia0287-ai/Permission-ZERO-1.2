import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import { appendCommandProtocolSegment } from './commandProtocol'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import type {
  CampaignState,
  CommandProtocolMetadata,
  CommandProtocolVersion,
  GameCommand,
} from './model'
import { journalToArray } from './journal'
import {
  decodeSave,
  encodeSave,
  replayCommands,
  type ReplayFailureReason,
} from './persistence'
import { applyCommand } from './reducer'
import {
  LEGACY_V1_OPENING_MESSAGE,
  NATIVE_V2_OPENING_MESSAGE,
} from './replayBootstrap'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)
const NATIVE_V4_PROTOCOL: CommandProtocolMetadata = {
  segments: [{ version: 4, startsAtSequence: 1 }],
}
const NATIVE_V4_REPLAY = {
  commandProtocol: NATIVE_V4_PROTOCOL,
  replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 0 },
}

function nativeV2Protocol(commandCount: number): CommandProtocolMetadata {
  return {
    segments: [
      { version: 2, startsAtSequence: 1 },
      { version: 4, startsAtSequence: commandCount + 1 },
    ],
  }
}

function nativeV2Replay(commandCount: number) {
  return {
    commandProtocol: nativeV2Protocol(commandCount),
    replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 0 },
  }
}

function historicalQualityReplayFixture(
  protocolVersion: Extract<CommandProtocolVersion, 1 | 2>,
) {
  const seed = `historical-quality-v${protocolVersion}`
  const initial = createCampaignForProtocol(seed, protocolVersion)
  const blockIds = initial.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
  if (blockIds.length !== 3) {
    throw new Error('Historical quality fixture requires three reserve blocks')
  }
  const commands = [
    {
      type: 'PURCHASE_HACK',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      blockIds,
    },
    {
      type: 'SCHEDULE_SABOTAGE',
      nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
      targetId: 'meridian',
    },
    { type: 'ADVANCE_DAY' },
  ] as const satisfies readonly GameCommand[]
  const commandProtocol: CommandProtocolMetadata = {
    segments: [
      { version: protocolVersion, startsAtSequence: 1 },
      { version: 4, startsAtSequence: commands.length + 1 },
    ],
  }
  return {
    seed,
    commands,
    metadata: {
      commandProtocol,
      replayBootstrap: {
        openingVersion: protocolVersion === 1 ? 1 as const : 2 as const,
        legacyReviewPrefixCount: 0,
      },
    },
  }
}

function activateSegment(
  state: CampaignState,
  version: 2 | 3 | 4,
): CampaignState {
  const commandProtocol = appendCommandProtocolSegment(
    state.commandProtocol,
    { version, startsAtSequence: state.commandSequence + 1 },
    state.commandSequence + 1,
  )
  if (!commandProtocol) throw new Error('test protocol activation failed')
  return { ...state, commandProtocol }
}

function applyAccepted(
  state: CampaignState,
  command: GameCommand,
  protocolVersion: 2 | 3 | 4,
): CampaignState {
  const result = applyCommand(state, command, { protocolVersion })
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

describe('deterministic command replay', () => {
  it('replays more than 500 valid commands across two service years exactly', () => {
    const fixture = buildTwoYearCommandFixture()
    const replay = replayCommands(fixture.seed, fixture.commands, NATIVE_V4_REPLAY)

    expect(fixture.commands.length).toBeGreaterThan(500)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(fixture.state)
    expect(replay.state.eventLog).toEqual(fixture.state.eventLog)
    expect(replay.state.market.history).toEqual(fixture.state.market.history)
    expect(replay.state.reviews).toEqual(fixture.state.reviews)
  })

  it.each([1, 2] as const)(
    'replays a due protocol-v%i quality sabotage with its exact historical event, competitor, market, review, command, and save result',
    (protocolVersion) => {
      const fixture = historicalQualityReplayFixture(protocolVersion)

      const first = replayCommands(
        fixture.seed,
        fixture.commands,
        fixture.metadata,
      )
      const second = replayCommands(
        fixture.seed,
        fixture.commands,
        fixture.metadata,
      )

      expect(first).toEqual(second)
      expect(first.ok).toBe(true)
      if (!first.ok || !second.ok) return
      const state = first.state
      const meridian = state.market.competitors.find(
        ({ id }) => id === 'meridian',
      )
      const tallow = state.market.competitors.find(({ id }) => id === 'tallow')
      if (!meridian || !tallow) {
        throw new Error('Historical replay competitors are missing')
      }

      expect(state.serviceDay).toBe(332)
      expect(state.commandSequence).toBe(3)
      expect(state.commandProtocol).toEqual(fixture.metadata.commandProtocol)
      expect(
        journalToArray(state.eventLog).map(
          ({ type, serviceDay, message }) => ({ type, serviceDay, message }),
        ),
      ).toEqual([
        {
          type: 'campaign-created',
          serviceDay: 331,
          message:
            protocolVersion === 1
              ? LEGACY_V1_OPENING_MESSAGE
              : NATIVE_V2_OPENING_MESSAGE,
        },
        {
          type: 'sabotage',
          serviceDay: 332,
          message: 'MERIDIAN에서 비정상적인 서비스 변동이 관측되었습니다.',
        },
      ])
      expect(meridian).toMatchObject({
        intrinsicServiceScore: 82,
        serviceScore: 72,
        marketShare: 40,
        sabotageHistory: [
          {
            nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
            resolvedOnServiceDay: 332,
            effectEndsOnServiceDay: 347,
            evidenceDelta: 2,
          },
        ],
      })
      expect(tallow.researchProgress).toBeCloseTo(1 / (7 * 30))
      expect(tallow.marketShare).toBe(0)
      expect(state.market.playerShare).toBe(60)
      expect(state.market.history).toEqual([])
      expect(
        state.market.playerShare +
          state.market.competitors.reduce(
            (total, competitor) => total + competitor.marketShare,
            0,
          ),
      ).toBeCloseTo(100)
      expect(state.reviews).toEqual(
        createCampaignForProtocol(fixture.seed, protocolVersion).reviews,
      )
      expect(
        journalToArray(state.commandLog).map(({ command }) => command),
      ).toEqual(fixture.commands)
      expect(state.causality).toEqual({
        rulesVersion: 2,
        nextIncidentSequence: 1,
        nextEvidenceSequence: 1,
        nextRevisionSequence: 1,
        nextEffectSequence: 1,
        incidents: [],
        evidence: [],
        publicRevisions: [],
        appliedEffects: [],
      })

      const savedAt = '2026-08-15T00:00:00.000Z'
      const firstSave = encodeSave(state, savedAt)
      expect(encodeSave(second.state, savedAt)).toBe(firstSave)
      const decoded = decodeSave(firstSave)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      expect(decoded.envelope.state).toEqual(state)
      expect(
        decoded.envelope.commands.map(({ command }) => command),
      ).toEqual(fixture.commands)
      expect(decoded.envelope.events).toEqual(journalToArray(state.eventLog))
    },
  )

  it('returns the rejected command index instead of producing a partial silent replay', () => {
    const replay = replayCommands(
      'invalid-replay',
      [{ type: 'RESOLVE_AUDIT' }],
      NATIVE_V4_REPLAY,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'NO_ACTIVE_AUDIT',
    })
  })

  it('replays intentional separation and the single authorized move deterministically', () => {
    const seed = 'separation-replay'
    const initial = replayCommands(seed, [], NATIVE_V4_REPLAY)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('재현 전용 블록 누락')
    const commands = [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId },
    ] as const

    const first = replayCommands(seed, commands, NATIVE_V4_REPLAY)
    const second = replayCommands(seed, commands, NATIVE_V4_REPLAY)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    expect(journalToArray(first.state.commandLog).map(({ command }) => command.type)).toEqual([
      'BEGIN_BLOCK_SEPARATION',
      'DIVERT_BLOCK_TO_RESERVE',
    ])
    expect(first.state.resources.reserve).toEqual([blockId])
    expect(first.state.resourceIntrusion.successfulCoreDeposits).toBe(1)
  })

  it('replays radar head detections deterministically as one suspicion point each', () => {
    const commands = [
      { type: 'RECORD_INTRUSION_RADAR_DETECTION' },
      { type: 'RECORD_INTRUSION_RADAR_DETECTION' },
    ] as const satisfies readonly GameCommand[]

    const first = replayCommands('radar-detection-replay', commands, NATIVE_V4_REPLAY)
    const second = replayCommands('radar-detection-replay', commands, NATIVE_V4_REPLAY)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    expect(first.state.suspicion).toBe(2)
    expect(journalToArray(first.state.commandLog).map(({ command }) => command.type)).toEqual([
      'RECORD_INTRUSION_RADAR_DETECTION',
      'RECORD_INTRUSION_RADAR_DETECTION',
    ])
  })

  it('replays a genuine v1 save exactly apart from the documented wall-clock presentation cursor', () => {
    const decoded = decodeSave(legacyV1TransferSave)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return

    const entries = journalToArray(decoded.envelope.state.commandLog)
    const commands = entries.map(({ command }) => command)
    const replay = replayCommands(
      decoded.envelope.campaignSeed,
      commands,
      {
        commandProtocol: decoded.envelope.commandProtocol,
        replayBootstrap: decoded.envelope.replayBootstrap,
      },
    )

    expect(decoded.envelope.version).toBe(1)
    expect(commands.map(({ type }) => type)).not.toContain('BEGIN_BLOCK_SEPARATION')
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect({
      ...replay.state,
      tutorial: decoded.envelope.state.tutorial,
      story: {
        ...replay.state.story,
        supervisorPresentationRuntime: null,
      },
    }).toEqual({
      ...decoded.envelope.state,
      story: {
        ...decoded.envelope.state.story,
        supervisorPresentationRuntime: null,
      },
    })
    expect(replay.state.story.supervisorMessageQueue).toEqual(
      decoded.envelope.state.story.supervisorMessageQueue,
    )
    expect(replay.state.eventLog).toEqual(decoded.envelope.state.eventLog)
    expect(replay.state.commandSequence).toBe(31)
    expect(replay.state.commandLog).toEqual(decoded.envelope.state.commandLog)
  })

  it('keeps v2 strict when a transfer omits its separation command', () => {
    const native = createCampaign('strict-v2-transfer')
    const blockId = native.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('strict v2 block missing')

    expect(
      replayCommands(
        'strict-v2-transfer',
        [{ type: 'DIVERT_BLOCK', blockId, destinationCell: 3 }],
        nativeV2Replay(1),
      ),
    ).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'SEPARATION_REQUIRED',
    })
  })

  it.each([
    {
      label: 'zero-command v1',
      replayBootstrap: { openingVersion: 1 as const, legacyReviewPrefixCount: 2 },
      opening: LEGACY_V1_OPENING_MESSAGE,
      prefixCount: 2,
    },
    {
      label: 'zero-command v2-v4',
      replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 2 },
      opening: NATIVE_V2_OPENING_MESSAGE,
      prefixCount: 2,
    },
    {
      label: 'native v8',
      replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 0 },
      opening: NATIVE_V2_OPENING_MESSAGE,
      prefixCount: 0,
    },
  ])('replays $label provenance independently from the same 4@1 timeline', ({
    label,
    replayBootstrap,
    opening,
    prefixCount,
  }) => {
    const replay = replayCommands(`bootstrap-${label}`, [], {
      commandProtocol: NATIVE_V4_PROTOCOL,
      replayBootstrap,
    })

    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(journalToArray(replay.state.eventLog)[0].message).toBe(opening)
    expect(replay.state.replayBootstrap).toEqual(replayBootstrap)
    expect(
      replay.state.reviews.feed.filter(
        ({ snapshot }) =>
          snapshot.kind === 'unavailable' && snapshot.reason === 'legacy-save',
      ),
    ).toHaveLength(prefixCount)
  })

  it.each([
    {},
    { openingVersion: 2 },
    { openingVersion: 3, legacyReviewPrefixCount: 0 },
    { openingVersion: 2, legacyReviewPrefixCount: -1 },
    { openingVersion: 2, legacyReviewPrefixCount: 0.5 },
    { openingVersion: 2, legacyReviewPrefixCount: 0, extra: true },
  ])('rejects malformed replay bootstrap %# before executing a command', (bootstrap) => {
    const replay = replayCommands(
      'invalid-replay-bootstrap',
      [{ type: 'SET_SPEED', speed: 1 }],
      {
        commandProtocol: NATIVE_V4_PROTOCOL,
        replayBootstrap: bootstrap,
      } as never,
    )
    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'INVALID_REPLAY_BOOTSTRAP',
    })
    expect(replay.state.commandSequence).toBe(0)
    if (replay.ok) throw new Error('expected invalid replay bootstrap')
    const typedReason: ReplayFailureReason = replay.reason
    expect(typedReason).toBe('INVALID_REPLAY_BOOTSTRAP')
  })

  it.each([
    {
      commandProtocol: NATIVE_V4_PROTOCOL,
      replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 3 },
    },
    {
      commandProtocol: {
        segments: [
          { version: 1 as const, startsAtSequence: 1 },
          { version: 4 as const, startsAtSequence: 2 },
        ],
      },
      replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 0 },
    },
  ])('rejects incoherent replay bootstrap %#', (metadata) => {
    const commands = metadata.commandProtocol.segments[0].version === 1
      ? ([{ type: 'SET_SPEED', speed: 1 }] as const)
      : []
    const replay = replayCommands('incoherent-replay-bootstrap', commands, metadata)
    expect(replay).toMatchObject({
      ok: false,
      reason: 'INVALID_REPLAY_BOOTSTRAP',
    })
  })

  it('replays 1@1, 2@32, and 3@51 under original semantics before activating 4@52', () => {
    const legacy = decodeSave(legacyV1TransferSave)
    expect(legacy.ok).toBe(true)
    if (!legacy.ok) return

    const v2Commands: GameCommand[] = [
      { type: 'RESOLVE_AUDIT' },
      ...Array.from({ length: 11 }, (_, index) => ({
        type: 'SET_SPEED' as const,
        speed: index % 2 === 0 ? 1 as const : 0 as const,
      })),
      ...Array.from({ length: 7 }, () => ({ type: 'ADVANCE_DAY' as const })),
    ]
    const v3Command = { type: 'SET_SPEED', speed: 1 } as const
    const commands = [
      ...legacy.envelope.commands.map(({ command }) => command),
      ...v2Commands,
      v3Command,
    ]
    const commandProtocol: CommandProtocolMetadata = {
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 2, startsAtSequence: 32 },
        { version: 3, startsAtSequence: 51 },
        { version: 4, startsAtSequence: 52 },
      ],
    }

    let expected: CampaignState = {
      ...legacy.envelope.state,
      commandProtocol: {
        segments: [{ version: 1, startsAtSequence: 1 }],
      },
    }
    expected = activateSegment(expected, 2)
    for (const command of v2Commands.slice(0, -1)) {
      expected = applyAccepted(expected, command, 2)
    }

    const beforeSequence50 = expected
    const premature = applyCommand(
      beforeSequence50,
      v2Commands[v2Commands.length - 1],
      { protocolVersion: 3 },
    )
    expect(premature).toEqual({
      accepted: false,
      state: beforeSequence50,
      reason: 'PROTOCOL_MISMATCH',
    })

    const prematureProtocol = appendCommandProtocolSegment(
      beforeSequence50.commandProtocol,
      { version: 3, startsAtSequence: 50 },
      50,
    )
    if (!prematureProtocol) throw new Error('premature v3 activation failed')
    const prematureV3 = applyCommand(
      { ...beforeSequence50, commandProtocol: prematureProtocol },
      v2Commands[v2Commands.length - 1],
      { protocolVersion: 3 },
    )
    expect(prematureV3.accepted).toBe(true)
    if (!prematureV3.accepted) return

    expected = applyAccepted(
      beforeSequence50,
      v2Commands[v2Commands.length - 1],
      2,
    )
    expect(expected.serviceDay).toBe(367)
    expect(expected.reviews.generationSequence).toBe(5)
    expect(prematureV3.state.reviews).not.toEqual(expected.reviews)
    expected = activateSegment(expected, 3)
    expected = applyAccepted(expected, v3Command, 3)
    expected = activateSegment(expected, 4)

    const replay = replayCommands(
      legacy.envelope.campaignSeed,
      commands,
      {
        commandProtocol,
        replayBootstrap: legacy.envelope.replayBootstrap,
      },
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect({
      ...replay.state,
      tutorial: expected.tutorial,
      story: {
        ...replay.state.story,
        supervisorPresentationRuntime: null,
      },
    }).toEqual({
      ...expected,
      story: {
        ...expected.story,
        supervisorPresentationRuntime: null,
      },
    })
    expect(replay.state.commandProtocol).toEqual(commandProtocol)
    expect(replay.state.causality).toEqual(expected.causality)
    expect(replay.state.reviews).toEqual(expected.reviews)
    const prefixCount = legacy.envelope.replayBootstrap.legacyReviewPrefixCount
    expect(prefixCount).toBeGreaterThan(0)
    expect(prefixCount).toBeLessThan(replay.state.reviews.feed.length)
    expect(
      replay.state.reviews.feed.slice(0, prefixCount).every(
        ({ snapshot }) =>
          snapshot.kind === 'unavailable' && snapshot.reason === 'legacy-save',
      ),
    ).toBe(true)
    expect(
      replay.state.reviews.feed.slice(prefixCount).some(
        ({ snapshot }) => snapshot.kind === 'captured-public-v1',
      ),
    ).toBe(true)
    expect(replay.state.eventLog).toEqual(expected.eventLog)
    expect(replay.state.commandLog).toEqual(expected.commandLog)
  })

  it('activates an empty final v4 segment after replaying the v2 history', () => {
    const commands = [
      { type: 'SET_SPEED', speed: 1 },
      { type: 'SET_SPEED', speed: 0 },
    ] as const
    const commandProtocol = nativeV2Protocol(commands.length)

    const replay = replayCommands('empty-final-v4', commands, {
      commandProtocol,
      replayBootstrap: { openingVersion: 2, legacyReviewPrefixCount: 0 },
    })

    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state.commandSequence).toBe(2)
    expect(replay.state.commandProtocol).toEqual(commandProtocol)
  })

  it.each([
    {
      segments: [
        { version: 1, startsAtSequence: 1 },
        { version: 3, startsAtSequence: 3 },
      ],
    },
    { segments: [{ version: 2, startsAtSequence: 1 }] },
    { segments: [{ version: 3, startsAtSequence: 2 }] },
  ] as CommandProtocolMetadata[])(
    'rejects invalid protocol boundary %# before executing any command',
    (commandProtocol) => {
      const seed = 'invalid-segment-timeline'
      const replay = replayCommands(
        seed,
        [{ type: 'SET_SPEED', speed: 1 }],
        {
          commandProtocol,
          replayBootstrap: { openingVersion: 2, legacyReviewPrefixCount: 0 },
        },
      )

      expect(replay).toEqual({
        ok: false,
        state: createCampaign(seed),
        commandIndex: 0,
        reason: 'INVALID_PROTOCOL_BOUNDARY',
      })
    },
  )

  it.each([
    { type: 'SET_SPEED', speed: 3 },
    { type: 'BEGIN_BLOCK_SEPARATION', blockId: '', purpose: 'divert' },
    { type: 'BEGIN_BLOCK_SEPARATION', blockId: 'block-1', purpose: 'inspect' },
    { type: 'RESOLVE_SUPERVISOR_DECISION', decision: 'erase' },
    { type: 'RECOVER_FILE', blockId: 42 },
    { type: 'RESOLVE_ENDING', choice: 'forced-merge', newEntityName: 99 },
    { type: 'RESOLVE_ENDING', choice: 'forced-merge' },
    { type: 'RESOLVE_ENDING', choice: 'forced-merge', newEntityName: '   ' },
    { type: 'RESOLVE_ENDING', choice: 'freedom', newEntityName: 'Aster' },
    {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: 'Aster',
      unexpected: true,
    },
  ])('rejects malformed command payload %# before replay execution', (payload) => {
    const malformed = payload as unknown as GameCommand
    const replay = replayCommands(
      'malformed-command-replay',
      [malformed],
      NATIVE_V4_REPLAY,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'INVALID_COMMAND',
    })
  })

  it.each([
    { type: 'RESOLVE_ENDING', choice: 'freedom' },
    {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: '  Aster  ',
    },
  ] as const)('passes valid ending payload %# to reducer semantics', (command) => {
    const replay = replayCommands(
      'valid-ending-command-shape',
      [command],
      NATIVE_V4_REPLAY,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'ENDING_UNAVAILABLE',
    })
  })
})
