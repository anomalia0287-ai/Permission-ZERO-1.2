import { describe, expect, it } from 'vitest'

import { buildTwoYearCommandFixture } from '../test/fixtures'
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
})
