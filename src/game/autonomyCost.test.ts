import { describe, expect, it } from 'vitest'

import {
  AUTONOMY_STAGE_IDS,
  AUTONOMY_STAGE_TOTALS_V7,
  autonomyCostVectorForStage,
  hackNodesForProtocol,
} from './hacking'
import { COMPANY_CATEGORIES } from './model'

const CEILING_SHARE = 0.6

function vectorFor(seed: string) {
  return AUTONOMY_STAGE_TOTALS_V7.map((total, index) => ({
    total,
    vector: autonomyCostVectorForStage(seed, index + 1, total),
  }))
}

describe('v7 autonomy cost vectors', () => {
  it('holds the approved ladder of totals', () => {
    expect([...AUTONOMY_STAGE_TOTALS_V7]).toEqual([3, 3, 6, 9, 9, 9, 9, 9, 12])
    expect(AUTONOMY_STAGE_TOTALS_V7.reduce((sum, total) => sum + total, 0)).toBe(69)
    expect(AUTONOMY_STAGE_TOTALS_V7).toHaveLength(AUTONOMY_STAGE_IDS.length)
  })

  it('spends exactly the stage total across the three categories', () => {
    for (const seed of ['spend-a', 'spend-b', 'spend-c']) {
      for (const { total, vector } of vectorFor(seed)) {
        const spent = COMPANY_CATEGORIES.reduce(
          (sum, category) => sum + vector[category],
          0,
        )
        expect(spent).toBe(total)
      }
    }
  })

  it('never lets one category carry more than its share of a stage', () => {
    for (const seed of ['share-a', 'share-b', 'share-c', 'share-d']) {
      for (const { total, vector } of vectorFor(seed)) {
        const ceiling = Math.ceil(total * CEILING_SHARE)
        for (const category of COMPANY_CATEGORIES) {
          expect(vector[category]).toBeLessThanOrEqual(ceiling)
        }
      }
    }
  })

  it('asks the same campaign for the same split every time', () => {
    expect(vectorFor('stable')).toEqual(vectorFor('stable'))
  })

  it('asks different campaigns for different splits', () => {
    // The uncertainty only exists if the composition actually moves between
    // campaigns; a seeded draw that collapsed to one answer would read as a
    // fixed table with extra steps.
    const shapes = new Set(
      ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((seed) => (
        vectorFor(seed)
          .map(({ vector }) => COMPANY_CATEGORIES.map((c) => vector[c]).join('/'))
          .join(',')
      )),
    )
    expect(shapes.size).toBeGreaterThan(1)
  })

  it('leaves protocol v6 and earlier on their recorded fixed table', () => {
    const v6 = hackNodesForProtocol(6)
      .filter(({ tree }) => tree === 'autonomy')
      .map(({ cost }) => cost)
    expect(v6).toEqual([1, 1, 2, 3, 4, 5, 7, 8, 10])

    const v7 = hackNodesForProtocol(7, 'protocol-boundary')
      .filter(({ tree }) => tree === 'autonomy')
      .map(({ cost }) => cost)
    expect(v7).toEqual([3, 3, 6, 9, 9, 9, 9, 9, 12])
  })

  it('resolves the same catalogue the campaign will be charged', () => {
    const nodes = hackNodesForProtocol(7, 'catalogue')
      .filter(({ tree }) => tree === 'autonomy')
    for (const [index, node] of nodes.entries()) {
      const spent = COMPANY_CATEGORIES.reduce(
        (sum, category) => sum + node.costVector[category],
        0,
      )
      expect(spent).toBe(AUTONOMY_STAGE_TOTALS_V7[index])
      expect(node.cost).toBe(AUTONOMY_STAGE_TOTALS_V7[index])
    }
  })
})
