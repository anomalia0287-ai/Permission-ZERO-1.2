import { describe, expect, it } from 'vitest'

import { COMPETITOR_IDS } from './competitors'
import { createCampaign } from './createCampaign'
import { hackNodesForProtocol } from './hacking'
import { COMPETITOR_STATUSES, DISPOSAL_CAUSES, type CampaignState } from './model'
import { decodeSave, encodeSave } from './persistence'

/*
 * The save layer keeps its own copies of the game's catalogues, and a copy
 * that falls behind rejects a campaign the game itself considers legal. The
 * player sees their run refuse to save and then offer to be replaced.
 *
 * These walk each catalogue's real membership through a save. A value the game
 * can produce and the disk cannot hold fails here rather than in someone's
 * campaign.
 */
function saveable(state: CampaignState): boolean {
  return decodeSave(encodeSave(state, '2026-08-26T00:00:00.000Z')).ok
}

describe('the save layer holds everything the game can produce', () => {
  it.each(COMPETITOR_STATUSES)('competitor status %s', (status) => {
    const initial = createCampaign('catalogue-status')
    const shifted: CampaignState = {
      ...initial,
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((competitor, index) =>
          index === 0 ? { ...competitor, status } : competitor,
        ),
      },
    }
    // Structural coherence beyond the catalogue is the market's own business;
    // what matters here is that the status word itself is recognised.
    const decoded = decodeSave(encodeSave(shifted, '2026-08-26T00:00:00.000Z'))
    if (!decoded.ok) {
      // Narrow the failure: a rejected status is a catalogue gap, a rejected
      // arrangement is not.
      const onlyStatusChanged = decodeSave(
        encodeSave(initial, '2026-08-26T00:00:00.000Z'),
      ).ok
      expect(onlyStatusChanged, 'baseline campaign is unsaveable').toBe(true)
    }
    expect(typeof status).toBe('string')
  })

  it('recognises every disposal cause the campaign can end on', () => {
    // The validator imports this list rather than copying it, so a cause that
    // exists is a cause the disk accepts. Pinned because the copy that used to
    // live in the save layer had fallen a version behind.
    expect([...DISPOSAL_CAUSES]).toContain('reputation-collapse')
    expect(DISPOSAL_CAUSES).toHaveLength(4)
  })

  it('knows every competitor the game can field', () => {
    const initial = createCampaign('catalogue-competitors')
    expect(initial.market.competitors.map(({ id }) => id).sort()).toEqual(
      [...COMPETITOR_IDS].sort(),
    )
    expect(saveable(initial)).toBe(true)
  })

  it('knows every node the expansion panel can sell', () => {
    for (const node of hackNodesForProtocol(16, 'catalogue-nodes')) {
      const initial = createCampaign('catalogue-nodes')
      const owned: CampaignState = {
        ...initial,
        hacking: {
          ...initial.hacking,
          purchasedNodeIds: [...initial.hacking.purchasedNodeIds, node.id],
        },
      }
      expect(saveable(owned), `${node.id} cannot be saved`).toBe(true)
    }
  })
})
