import { describe, expect, it } from 'vitest'

import { random01 } from './rng'

describe('random01', () => {
  it('returns the same value for the same campaign key', () => {
    const first = random01('서울-331', 331, 'allocation', 7)
    const second = random01('서울-331', 331, 'allocation', 7)

    expect(second).toBe(first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(1)
  })

  it('separates independent random streams', () => {
    const allocation = random01('campaign-a', 331, 'allocation', 0)
    const audit = random01('campaign-a', 331, 'audit', 0)
    const review = random01('campaign-a', 331, 'review', 0)

    expect(new Set([allocation, audit, review]).size).toBe(3)
  })

  it('changes when the command sequence changes', () => {
    const values = Array.from({ length: 8 }, (_, sequence) =>
      random01('campaign-a', 331, 'allocation', sequence),
    )

    expect(new Set(values).size).toBe(8)
  })
})
