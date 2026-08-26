import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { applyCommand } from './reducer'
import { decodeSave, encodeSave } from './persistence'
import type { CampaignState, CommandProtocolVersion } from './model'

/*
 * A campaign in progress must survive an adjudication.
 *
 * Every version bump before this one orphaned the saves written under the
 * previous one, because the current save format only accepted a log already
 * sitting at the newest version. Promotion appends the new version at the next
 * command instead. This walks a save from each recent version forward.
 */
function savedAt(version: CommandProtocolVersion, seed: string): string {
  const base = createCampaign(seed)
  const state: CampaignState = {
    ...base,
    commandProtocol: { segments: [{ version, startsAtSequence: 1 }] },
  }
  return encodeSave(state, '2026-08-26T00:00:00.000Z')
}

describe('a campaign in progress survives the v16 adjudication', () => {
  it.each([13, 14, 15, 16] as const)(
    'opens a v%i save and carries it to the current rules',
    (version) => {
      const decoded = decodeSave(savedAt(version, `promote-${version}`))
      expect(decoded.ok, `v${version} failed to decode`).toBe(true)
      if (!decoded.ok) return

      const segments = decoded.envelope.state.commandProtocol.segments
      // What was already played keeps the rules it was played under; the new
      // version takes over from the next command.
      expect(segments.at(-1)?.version).toBe(16)
      expect(segments.at(-1)?.startsAtSequence).toBe(
        decoded.envelope.state.commandSequence + 1,
      )

      // And the campaign is still playable, not merely readable.
      const advanced = applyCommand(decoded.envelope.state, { type: 'ADVANCE_DAY' })
      expect(advanced.accepted, `v${version} could not advance`).toBe(true)
    },
  )
})
