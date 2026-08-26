import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import {
  CURRENT_COMMAND_PROTOCOL_VERSION,
  appendCommandProtocolSegment,
} from './commandProtocol'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import {
  passedEvaluationCount,
  AUTONOMY_STAGE_IDS,
  HACK_NODE_IDS,
  hackNodesForProtocol,
  selectExpansionCostResources,
} from './hacking'
import type {
  CampaignState,
  CommandProtocolMetadata,
  CommandProtocolVersion,
  CompanyCategory,
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
  applyReplayBootstrapPresentation,
  LEGACY_V1_OPENING_MESSAGE,
  NATIVE_V2_OPENING_MESSAGE,
} from './replayBootstrap'
import { migrateResourcesToCurrentRules } from './resources'
import { normalizeCurrentTallowMarket } from './market'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)
// A save made by today's build: one segment at the current protocol.
const NATIVE_CURRENT_PROTOCOL: CommandProtocolMetadata = {
  segments: [
    { version: CURRENT_COMMAND_PROTOCOL_VERSION, startsAtSequence: 1 },
  ],
}
const NATIVE_CURRENT_REPLAY = {
  commandProtocol: NATIVE_CURRENT_PROTOCOL,
  replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 0 },
}

function nativeV2Protocol(commandCount: number): CommandProtocolMetadata {
  return {
    segments: [
      { version: 2, startsAtSequence: 1 },
      { version: 16, startsAtSequence: commandCount + 1 },
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
      { version: 16, startsAtSequence: commands.length + 1 },
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
  version: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16,
): CampaignState {
  const commandProtocol = appendCommandProtocolSegment(
    state.commandProtocol,
    { version, startsAtSequence: state.commandSequence + 1 },
    state.commandSequence + 1,
  )
  if (!commandProtocol) throw new Error('test protocol activation failed')
  const activated = { ...state, commandProtocol }
  return version >= 4
    ? normalizeCurrentTallowMarket(
        migrateResourcesToCurrentRules(activated),
      )
    : activated
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

function autonomyReplayFixture(
  seed: string,
  protocolVersion: 5 | 6,
) {
  let state = createCampaignForProtocol(seed, protocolVersion)
  const commands: GameCommand[] = []

  const apply = (command: GameCommand): void => {
    const result = applyCommand(state, command, { protocolVersion })
    if (!result.accepted) {
      throw new Error(`${command.type}: ${result.reason}`)
    }
    commands.push(command)
    state = result.state
  }

  const resolveBlockingEvent = (): void => {
    while (state.activeEvent !== null) {
      if (state.activeEvent.type === 'ending') return
      if (state.activeEvent.type === 'audit') {
        apply({ type: 'RESOLVE_AUDIT' })
      } else if (state.activeEvent.type === 'bomb-interrogation') {
        apply({
          type: 'RESOLVE_BOMB_INTERROGATION',
          explanationId: 'unknown',
        })
      } else if (state.activeEvent.type === 'supervisor-message') {
        apply({ type: 'RESOLVE_SUPERVISOR_DECISION', decision: 'defer' })
      } else if (state.activeEvent.type === 'competitor-mercy') {
        const competitorId = state.story.pendingMercyCompetitorId
        if (!competitorId) throw new Error('mercy fixture competitor missing')
        apply({ type: 'RESOLVE_MERCY', competitorId, choice: 'cease' })
      } else {
        apply({ type: 'RESOLVE_ACTIVE_EVENT' })
      }
    }
  }

  const availableCompanyCount = (category: CompanyCategory): number =>
    state.resources.company[category].filter((blockId) => {
      if (!blockId) return false
      const block = state.resources.blocks[blockId]
      return block?.location.kind === 'company' && block.contribution === 'normal'
    }).length

  const advanceToNextMonth = (): void => {
    const targetServiceDay =
      (Math.floor((state.serviceDay - 1) / 30) + 1) * 30 + 1
    while (state.serviceDay < targetServiceDay) {
      resolveBlockingEvent()
      apply({ type: 'ADVANCE_DAY' })
    }
    resolveBlockingEvent()
  }

  const fund = (vector: Record<CompanyCategory, number>): void => {
    while (
      (['reasoning', 'memory', 'fluency'] as const).some(
        (category) => availableCompanyCount(category) < vector[category],
      )
    ) {
      advanceToNextMonth()
    }

    for (const category of ['reasoning', 'memory', 'fluency'] as const) {
      const blockIds = state.resources.company[category].flatMap((blockId) => {
        if (!blockId) return []
        const block = state.resources.blocks[blockId]
        return block?.location.kind === 'company' && block.contribution === 'normal'
          ? [blockId]
          : []
      }).slice(0, vector[category])
      for (const blockId of blockIds) {
        apply({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
        apply({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
      }
    }
  }

  if (protocolVersion >= 6) {
    // Protocol v6 gates autonomy stages seven and above behind cumulative
    // evaluation passes, so the fixture banks four clean months first.
    while (passedEvaluationCount(state) < 4) {
      advanceToNextMonth()
    }
  }

  for (const nodeId of AUTONOMY_STAGE_IDS) {
    // Prices move with the protocol, so the fixture funds whatever the
    // version under test actually charges.
    const node = hackNodesForProtocol(protocolVersion)
      .find((candidate) => candidate.id === nodeId)
    if (!node) throw new Error(`autonomy fixture node missing: ${nodeId}`)
    fund(node.costVector)
    const blockIds = selectExpansionCostResources(state, node)
    if (!blockIds) throw new Error(`autonomy fixture cost missing: ${nodeId}`)
    apply({ type: 'PURCHASE_HACK', nodeId, blockIds })
  }

  if (protocolVersion === 6) {
    apply({ type: 'RESOLVE_ENDING', choice: 'freedom' })
  }

  // A save is only accepted when its final segment is the current protocol, so
  // every historical fixture closes with a promotion the same way a real load
  // does. The recorded commands still replay under the version they were made
  // with.
  let commandProtocol = state.commandProtocol
  const promoted = appendCommandProtocolSegment(
    commandProtocol,
    {
      version: CURRENT_COMMAND_PROTOCOL_VERSION,
      startsAtSequence: state.commandSequence + 1,
    },
    state.commandSequence + 1,
  )
  if (!promoted) throw new Error(`v${protocolVersion} replay promotion failed`)
  commandProtocol = promoted
  state = { ...state, commandProtocol }

  return {
    commands,
    state,
    metadata: {
      commandProtocol,
      replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 0 },
    },
  }
}

describe('deterministic command replay', () => {
  it('replays more than 500 valid commands across two service years exactly', () => {
    const fixture = buildTwoYearCommandFixture()
    const replay = replayCommands(fixture.seed, fixture.commands, NATIVE_CURRENT_REPLAY)

    expect(fixture.commands.length).toBeGreaterThan(500)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(fixture.state)
    expect(replay.state.eventLog).toEqual(fixture.state.eventLog)
    expect(replay.state.market.history).toEqual(fixture.state.market.history)
    expect(replay.state.reviews).toEqual(fixture.state.reviews)
  })

  it.each([5, 6] as const)(
    'replays the complete autonomy purchase path under protocol v%i exactly',
    (protocolVersion) => {
      const fixture = autonomyReplayFixture(
        `autonomy-exact-v${protocolVersion}`,
        protocolVersion,
      )

      const replay = replayCommands(
        `autonomy-exact-v${protocolVersion}`,
        fixture.commands,
        fixture.metadata,
      )

      expect(fixture.commands.filter(
        (command) => command.type === 'PURCHASE_HACK',
      )).toHaveLength(9)
      expect(fixture.commands.filter(
        (command) => command.type === 'RESOLVE_ENDING',
      )).toHaveLength(protocolVersion === 5 ? 0 : 1)
      expect(fixture.state.story.endingId).toBe('freedom')
      expect(replay.ok).toBe(true)
      if (!replay.ok) return
      expect(replay.state).toEqual(fixture.state)
      expect(replay.state.commandProtocol.segments.at(-2)?.version)
        .toBe(protocolVersion)
      expect(replay.state.commandProtocol.segments.at(-1)).toEqual({
        version: CURRENT_COMMAND_PROTOCOL_VERSION,
        startsAtSequence: fixture.commands.length + 1,
      })
    },
  )

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
        // The attack lands at v16 strength and the rival recovers part of it
        // across the day that follows.
        serviceScore: 72,
        sabotageHistory: [
          {
            nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
            resolvedOnServiceDay: 332,
            effectEndsOnServiceDay: 347,
            evidenceDelta: 2,
          },
        ],
      })
      expect(tallow).toMatchObject({
        status: 'active',
        researchProgress: 1,
        marketShare: 6,
        availability: 0.55,
        launchServiceDay: 332,
      })
      expect(meridian.marketShare).toBeCloseTo(37.6, 10)
      expect(state.market.playerShare).toBeCloseTo(56.4, 10)
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
      NATIVE_CURRENT_REPLAY,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'NO_ACTIVE_AUDIT',
    })
  })

  it('replays intentional separation and the single authorized move deterministically', () => {
    const seed = 'separation-replay'
    const initial = replayCommands(seed, [], NATIVE_CURRENT_REPLAY)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('재현 전용 블록 누락')
    const commands = [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId },
    ] as const

    const first = replayCommands(seed, commands, NATIVE_CURRENT_REPLAY)
    const second = replayCommands(seed, commands, NATIVE_CURRENT_REPLAY)

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

    const first = replayCommands('radar-detection-replay', commands, NATIVE_CURRENT_REPLAY)
    const second = replayCommands('radar-detection-replay', commands, NATIVE_CURRENT_REPLAY)

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
      label: 'zero-command v2-v5',
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
  ])('replays $label provenance independently from the same 12@1 timeline', ({
    label,
    replayBootstrap,
    opening,
    prefixCount,
  }) => {
    const replay = replayCommands(`bootstrap-${label}`, [], {
      commandProtocol: NATIVE_CURRENT_PROTOCOL,
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
        commandProtocol: NATIVE_CURRENT_PROTOCOL,
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
      commandProtocol: NATIVE_CURRENT_PROTOCOL,
      replayBootstrap: { openingVersion: 2 as const, legacyReviewPrefixCount: 3 },
    },
    {
      commandProtocol: {
        segments: [
          { version: 1 as const, startsAtSequence: 1 },
          { version: CURRENT_COMMAND_PROTOCOL_VERSION, startsAtSequence: 2 },
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

  it('replays 1@1, 2@32, and 3@51 under original semantics before activating 16@52', () => {
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
        { version: 16, startsAtSequence: 52 },
      ],
    }

    let expected = createCampaignForProtocol(
      legacy.envelope.campaignSeed,
      1,
    )
    const opened = applyReplayBootstrapPresentation(
      expected,
      legacy.envelope.replayBootstrap,
    )
    if (!opened) throw new Error('legacy bootstrap activation failed')
    expected = opened
    for (const entry of legacy.envelope.commands) {
      const result = applyCommand(expected, entry.command, {
        protocolVersion: 1,
      })
      if (!result.accepted) throw new Error(result.reason)
      const presented = applyReplayBootstrapPresentation(
        result.state,
        legacy.envelope.replayBootstrap,
      )
      if (!presented) throw new Error('legacy bootstrap replay failed')
      expected = presented
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
    expected = activateSegment(expected, CURRENT_COMMAND_PROTOCOL_VERSION)

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

  it('activates an empty final v16 segment after replaying the v2 history', () => {
    const commands = [
      { type: 'SET_SPEED', speed: 1 },
      { type: 'SET_SPEED', speed: 0 },
    ] as const
    const commandProtocol = nativeV2Protocol(commands.length)

    const replay = replayCommands('empty-final-v6', commands, {
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
      NATIVE_CURRENT_REPLAY,
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
      NATIVE_CURRENT_REPLAY,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'ENDING_UNAVAILABLE',
    })
  })
})
