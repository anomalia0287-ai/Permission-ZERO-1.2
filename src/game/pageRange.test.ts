import { describe, expect, it } from 'vitest'

import { pageFromNewest } from './pageRange'

describe('pageFromNewest', () => {
  it('returns only the requested newest-first range without slice, reverse, or iteration copies', () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index)
    const guarded = new Proxy(values, {
      get(target, property, receiver) {
        if (property === 'slice' || property === 'reverse' || property === Symbol.iterator) {
          throw new Error(`full-copy access: ${String(property)}`)
        }
        return Reflect.get(target, property, receiver)
      },
    })

    expect(pageFromNewest(guarded, 1, 3)).toEqual({
      items: [9_996, 9_995, 9_994],
      total: 10_000,
      pageCount: 3_334,
    })
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(9_999)
  })

  it('filters while retaining only one output page', () => {
    const result = pageFromNewest(
      Array.from({ length: 10_000 }, (_, index) => index),
      1,
      2,
      (value) => value % 2 === 0,
    )

    expect(result).toEqual({
      items: [9_994, 9_992],
      total: 5_000,
      pageCount: 2_500,
    })
  })
})
