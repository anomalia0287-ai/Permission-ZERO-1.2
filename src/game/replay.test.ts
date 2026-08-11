import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
import legacyV1TransferEnvelope from '../test/legacy-v1-transfer-save.json'
import type { GameCommand } from './model'
import { decodeSave, replayCommands } from './persistence'

const legacyV1TransferSave = JSON.stringify(legacyV1TransferEnvelope)

describe('deterministic command replay', () => {
  it('replays more than 500 valid commands across two service years exactly', () => {
    const fixture = buildTwoYearCommandFixture()
    const replay = replayCommands(fixture.seed, fixture.commands, 2)

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
      2,
    )

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'NO_ACTIVE_AUDIT',
    })
  })

  it('replays intentional separation and the single authorized move deterministically', () => {
    const seed = 'separation-replay'
    const initial = replayCommands(seed, [], 2)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('재현 전용 블록 누락')
    const commands = [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK', blockId, destinationCell: 3 },
    ] as const

    const first = replayCommands(seed, commands, 2)
    const second = replayCommands(seed, commands, 2)

    expect(first).toEqual(second)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return
    expect(first.state.commandLog.map(({ command }) => command.type)).toEqual([
      'BEGIN_BLOCK_SEPARATION',
      'DIVERT_BLOCK',
    ])
    expect(first.state.resources.reserve[3]).toBe(blockId)
  })

  it('replays a genuine v1 save with historical one-command transfers exactly', () => {
    const decoded = decodeSave(legacyV1TransferSave)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return

    const commands = decoded.envelope.commands.map(({ command }) => command)
    const replay = replayCommands(
      decoded.envelope.campaignSeed,
      commands,
      decoded.envelope.version,
    )

    expect(decoded.envelope.version).toBe(1)
    expect(commands.map(({ type }) => type)).not.toContain('BEGIN_BLOCK_SEPARATION')
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(decoded.envelope.state)
    expect(replay.state.commandSequence).toBe(31)
    expect(replay.state.commandLog).toEqual(decoded.envelope.commands)
  })

  it('keeps v2 strict when a transfer omits its separation command', () => {
    const initial = replayCommands('strict-v2-transfer', [], 2)
    if (!initial.ok) throw new Error(initial.reason)
    const blockId = initial.state.resources.company.reasoning.find(Boolean)
    if (!blockId) throw new Error('strict v2 block missing')

    expect(
      replayCommands(
        'strict-v2-transfer',
        [{ type: 'DIVERT_BLOCK', blockId, destinationCell: 3 }],
        2,
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
    const replay = replayCommands('malformed-command-replay', [malformed], 2)

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
    const replay = replayCommands('valid-ending-command-shape', [command], 2)

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'ENDING_UNAVAILABLE',
    })
  })
})
