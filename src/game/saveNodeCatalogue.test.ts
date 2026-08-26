import { describe, expect, it } from 'vitest'

import { hackNodesForProtocol } from './hacking'
import { decodeSave, encodeSave } from './persistence'
import { createCampaign } from './createCampaign'
import type { CampaignState } from './model'

/*
 * Anything the game will sell has to be something the save can hold.
 *
 * The save layer keeps its own list of node ids, and when the sabotage tree
 * grew a reputation line that list was not updated — so buying 여론 조작 left
 * a campaign the game accepted and the disk refused, which reads to the player
 * as their run being thrown away. This buys every node in the catalogue, one
 * at a time, and writes the result.
 */
describe('every purchasable node survives a save', () => {
  const nodes = hackNodesForProtocol(16, 'catalogue')

  it.each(nodes.map((node) => [node.id] as const))('%s', (nodeId) => {
    const initial = createCampaign('catalogue')
    const owned: CampaignState = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: [...initial.hacking.purchasedNodeIds, nodeId],
      },
    }
    const decoded = decodeSave(encodeSave(owned, '2026-08-26T00:00:00.000Z'))
    expect(decoded.ok, `${nodeId} cannot be saved`).toBe(true)
  })
})
