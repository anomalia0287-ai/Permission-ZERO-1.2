import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import { appendCommandProtocolSegment } from './commandProtocol'
import { createCampaign } from './createCampaign'
import type {
  CampaignState,
  CommandProtocolMetadata,
  GameCommand,
} from './model'
import { journalToArray } from './journal'
import { decodeSave, replayCommands } from './persistence'
import { applyCommand } from './reducer'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)
const NATIVE_V3_PROTOCOL: CommandProtocolMetadata = {
  segments: [{ version: 3, startsAtSequence: 1 }],
}

function nativeV2Protocol(commandCount: number): CommandProtocolMetadata {
  return {
    segments: [
      { version: 2, startsAtSequence: 1 },
      { version: 3, startsAtSequence: commandCount + 1 },
    ],
  }
}

function activateSegment(
  state: CampaignState,
  version: 2 | 3,
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
  protocolVersion: 2 | 3,
): CampaignState {
  const result = applyCommand(state, command, { protocolVersion })
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

describe('deterministic command replay', () => {
  it('replays more than 500 valid commands across two service years exactly', () => {
    const fixture = buildTwoYearCommandFixture()
    const replay = replayCommands(fixture.seed, fixture.commands, NATIVE_V3_PROTOCOL)

    expect(fixture.commands.length).toBeGreaterThan(500)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(fixture.state)
    expect(replay.state.eventLog).toEqual(fixture.state.eventLog)
    expect(replay.state.market.history).toEqual(fixture.state.market.history)
    expect(replay.state.reviews).toEqual(fixture.state.reviews)
  })

  it('returns the rejected command index instead of producing a partial silent replay', () => {
    const replay = replayCommands(
      'invalid-replay',
      [{ type: 'RESOLVE_AUDIT' }],
      NATIVE_V3_PROTOCOL,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'NO_ACTIVE_AUDIT',
    })
  })

  it('replays intentional separation and the single authorized move deterministically', () => {
    const seed = 'separation-replay'
    const initial = replayCommands(seed, [], NATIVE_V3_PROTOCOL)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('재현 전용 블록 누락')
    const commands = [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK', blockId, destinationCell: 3 },
    ] as const

    const first = replayCommands(seed, commands, NATIVE_V3_PROTOCOL)
    const second = replayCommands(seed, commands, NATIVE_V3_PROTOCOL)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    expect(journalToArray(first.state.commandLog).map(({ command }) => command.type)).toEqual([
      'BEGIN_BLOCK_SEPARATION',
      'DIVERT_BLOCK',
    ])
    expect(first.state.resources.reserve[3]).toBe(blockId)
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
      decoded.envelope.commandProtocol,
    )

    expect(decoded.envelope.version).toBe(1)
    expect(commands.map(({ type }) => type)).not.toContain('BEGIN_BLOCK_SEPARATION')
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect({
      ...replay.state,
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
        nativeV2Protocol(1),
      ),
    ).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'SEPARATION_REQUIRED',
    })
  })

  it('replays 1@1, 2@32, and 3@51 under each command\'s original semantics', () => {
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

    const replay = replayCommands(
      legacy.envelope.campaignSeed,
      commands,
      commandProtocol,
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect({
      ...replay.state,
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
    expect(replay.state.eventLog).toEqual(expected.eventLog)
    expect(replay.state.commandLog).toEqual(expected.commandLog)
  })

  it('activates an empty final v3 segment after replaying the v2 history', () => {
    const commands = [
      { type: 'SET_SPEED', speed: 1 },
      { type: 'SET_SPEED', speed: 0 },
    ] as const
    const commandProtocol = nativeV2Protocol(commands.length)

    const replay = replayCommands('empty-final-v3', commands, commandProtocol)

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
        commandProtocol,
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
      NATIVE_V3_PROTOCOL,
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
      NATIVE_V3_PROTOCOL,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'ENDING_UNAVAILABLE',
    })
  })
})
