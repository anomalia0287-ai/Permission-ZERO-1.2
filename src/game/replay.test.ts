import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
import type { GameCommand } from './model'
import { replayCommands } from './persistence'

describe('deterministic command replay', () => {
  it('replays more than 500 valid commands across two service years exactly', () => {
    const fixture = buildTwoYearCommandFixture()
    const replay = replayCommands(fixture.seed, fixture.commands)

    expect(fixture.commands.length).toBeGreaterThan(500)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.state).toEqual(fixture.state)
    expect(replay.state.eventLog).toEqual(fixture.state.eventLog)
    expect(replay.state.market.history).toEqual(fixture.state.market.history)
    expect(replay.state.reviews).toEqual(fixture.state.reviews)
  })

  it('returns the rejected command index instead of producing a partial silent replay', () => {
    const replay = replayCommands('invalid-replay', [
      { type: 'RESOLVE_AUDIT' },
    ])

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'NO_ACTIVE_AUDIT',
    })
  })

  it.each([
    { type: 'SET_SPEED', speed: 3 },
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
    const replay = replayCommands('malformed-command-replay', [malformed])

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
    const replay = replayCommands('valid-ending-command-shape', [command])

    expect(replay).toMatchObject({
      ok: false,
      commandIndex: 0,
      reason: 'ENDING_UNAVAILABLE',
    })
  })
})
