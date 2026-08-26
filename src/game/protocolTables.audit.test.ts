import { describe, expect, it } from 'vitest'

import {
  AUTONOMY_STAGE_IDS,
  AUTONOMY_STAGE_TOTALS_V16,
  hackNodesForProtocol,
} from './hacking'
import { COMPANY_CATEGORIES, type CommandProtocolVersion } from './model'
import { SUPPORTED_COMMAND_PROTOCOL_VERSIONS } from './commandProtocol'

/*
 * Structural checks on the priced tables.
 *
 * A cost and its per-category vector are shown to the player separately — the
 * headline price on the card, the coloured requirement underneath — and they
 * are spent from the vector. If they disagree the panel asks for one thing and
 * charges another, which no test that only plays the game would notice.
 */
describe('priced tables hold together at every protocol version', () => {
  const versions = SUPPORTED_COMMAND_PROTOCOL_VERSIONS.filter(
    (version) => version >= 5,
  ) as readonly CommandProtocolVersion[]

  it.each(versions)('v%i: every cost equals its own vector', (version) => {
    const nodes = hackNodesForProtocol(version, 'table-audit')
    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      const vector = node.costVector
      const summed = COMPANY_CATEGORIES.reduce((sum, c) => sum + vector[c], 0)
      expect(summed, `${node.id} vector`).toBe(node.cost)
      // Nothing may be free, and nothing may ask for a negative line.
      expect(node.cost, `${node.id} cost`).toBeGreaterThan(0)
      for (const category of COMPANY_CATEGORIES) {
        expect(vector[category], `${node.id} ${category}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it.each(versions)('v%i: the autonomy ladder never gets cheaper as it climbs', (version) => {
    const nodes = hackNodesForProtocol(version, 'table-audit')
    const costs = AUTONOMY_STAGE_IDS.map((id) => {
      const node = nodes.find((candidate) => candidate.id === id)
      expect(node, `${id} missing at v${version}`).toBeDefined()
      return node?.cost ?? 0
    })
    for (let index = 1; index < costs.length; index += 1) {
      // Older ladders repeat a price between stages; that is their contract.
      // What must never happen is a later stage costing less than an earlier
      // one, which would let a campaign skip the climb by buying backwards.
      expect(
        costs[index],
        `stage ${index + 1} at v${version}`,
      ).toBeGreaterThanOrEqual(costs[index - 1])
    }
  })

  it('gives the v16 ladder a distinct price at every stage', () => {
    const nodes = hackNodesForProtocol(16, 'table-audit')
    const costs = AUTONOMY_STAGE_IDS.map(
      (id) => nodes.find((node) => node.id === id)?.cost ?? 0,
    )
    for (let index = 1; index < costs.length; index += 1) {
      expect(costs[index], `v16 stage ${index + 1}`).toBeGreaterThan(costs[index - 1])
    }
  })

  it('prices the v16 ladder at exactly the published totals', () => {
    const nodes = hackNodesForProtocol(16, 'table-audit')
    const costs = AUTONOMY_STAGE_IDS.map(
      (id) => nodes.find((node) => node.id === id)?.cost ?? 0,
    )
    expect(costs).toEqual([...AUTONOMY_STAGE_TOTALS_V16])
    // Halved, and the whole climb has to fit inside a campaign.
    expect(costs.reduce<number>((a, b) => a + b, 0)).toBe(91)
  })

  it('leaves every earlier version paying what it agreed to', () => {
    const v15 = hackNodesForProtocol(15, 'table-audit')
    const v16 = hackNodesForProtocol(16, 'table-audit')
    const priceOf = (nodes: readonly { id: string; cost: number }[], id: string) =>
      nodes.find((node) => node.id === id)?.cost
    for (const id of AUTONOMY_STAGE_IDS) {
      expect(priceOf(v15, id), `${id} at v15`).toBeGreaterThan(
        priceOf(v16, id) ?? 0,
      )
    }
  })
})
