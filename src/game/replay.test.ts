import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import type { GameCommand } from './model'
import { journalToArray } from './journal'
import { decodeSave, replayCommands } from './persistence'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)
const NATIVE_V2_PROTOCOL = { version: 2, legacyCommandCount: 0 } as const

describe('deterministic command replay', () => {
  it('replays more than 500 valid commands across two service years exactly', () => {
    const fixture = buildTwoYearCommandFixture()
    const replay = replayCommands(fixture.seed, fixture.commands, NATIVE_V2_PROTOCOL)

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
      NATIVE_V2_PROTOCOL,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'NO_ACTIVE_AUDIT',
    })
  })

  it('replays intentional separation and the single authorized move deterministically', () => {
    const seed = 'separation-replay'
    const initial = replayCommands(seed, [], NATIVE_V2_PROTOCOL)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('재현 전용 블록 누락')
    const commands = [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK', blockId, destinationCell: 3 },
    ] as const

    const first = replayCommands(seed, commands, NATIVE_V2_PROTOCOL)
    const second = replayCommands(seed, commands, NATIVE_V2_PROTOCOL)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    expect(journalToArray(first.state.commandLog).map(({ command }) => command.type)).toEqual([
      'BEGIN_BLOCK_SEPARATION',
      'DIVERT_BLOCK',
    ])
    expect(first.state.resources.reserve[3]).toBe(blockId)
  })

  it('replays a genuine v1 save with historical one-command transfers exactly', () => {
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
    expect(replay.state).toEqual(decoded.envelope.state)
    expect(replay.state.commandSequence).toBe(31)
    expect(replay.state.commandLog).toEqual(decoded.envelope.state.commandLog)
  })

  it('keeps v2 strict when a transfer omits its separation command', () => {
    const initial = replayCommands('strict-v2-transfer', [], NATIVE_V2_PROTOCOL)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('strict v2 block missing')

    expect(
      replayCommands(
        'strict-v2-transfer',
        [{ type: 'DIVERT_BLOCK', blockId, destinationCell: 3 }],
        NATIVE_V2_PROTOCOL,
      ),
    ).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'SEPARATION_REQUIRED',
    })
  })

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
      NATIVE_V2_PROTOCOL,
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
      NATIVE_V2_PROTOCOL,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'ENDING_UNAVAILABLE',
    })
  })
})
