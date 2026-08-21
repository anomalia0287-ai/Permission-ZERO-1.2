import { describe, expect, it } from 'vitest'

import {
  RESOURCE_SNAKE_VFX_BUDGET,
  selectResourceSnakeVfx,
  type ResourceSnakeVfxCandidate,
} from './resourceSnakeVfxBudget'

function effect(
  id: string,
  kind: ResourceSnakeVfxCandidate['kind'],
  startedAtMs: number,
  priority: ResourceSnakeVfxCandidate['priority'] = 'ambient',
): ResourceSnakeVfxCandidate {
  return { id, kind, startedAtMs, priority }
}

describe('resource snake VFX budget', () => {
  it('keeps gameplay telegraphs ahead of newer decorative fragments', () => {
    const candidates = [
      effect('telegraph-old', 'telegraph', 10, 'critical'),
      ...Array.from({ length: 80 }, (_, index) => (
        effect(`fragment-${index}`, 'fragment', 100 + index)
      )),
    ]

    const selected = selectResourceSnakeVfx(candidates, false)

    expect(selected.some(({ id }) => id === 'telegraph-old')).toBe(true)
    expect(selected).toHaveLength(RESOURCE_SNAKE_VFX_BUDGET.total)
    expect(selected.filter(({ kind }) => kind === 'fragment'))
      .toHaveLength(RESOURCE_SNAKE_VFX_BUDGET.fragment)
  })

  it('evicts deterministically by priority, recency, and stable id', () => {
    const candidates = [
      effect('b', 'contact', 100, 'gameplay'),
      effect('a', 'contact', 100, 'gameplay'),
      effect('old', 'contact', 20, 'gameplay'),
      ...Array.from({ length: 10 }, (_, index) => (
        effect(`new-${index.toString().padStart(2, '0')}`, 'contact', 200 + index, 'gameplay')
      )),
    ]

    const first = selectResourceSnakeVfx(candidates, false)
    const second = selectResourceSnakeVfx([...candidates].reverse(), false)

    expect(first).toEqual(second)
    expect(first.filter(({ kind }) => kind === 'contact'))
      .toHaveLength(RESOURCE_SNAKE_VFX_BUDGET.contact)
    expect(first.some(({ id }) => id === 'old')).toBe(false)
    expect(first.findIndex(({ id }) => id === 'a'))
      .toBeLessThan(first.findIndex(({ id }) => id === 'b'))
  })

  it('uses a smaller reduced-motion budget but preserves semantic effects', () => {
    const candidates = [
      effect('warning', 'telegraph', 10, 'critical'),
      effect('impact', 'contact', 20, 'gameplay'),
      effect('break', 'power-cut', 30, 'gameplay'),
      ...Array.from({ length: 48 }, (_, index) => (
        effect(`fragment-${index}`, 'fragment', 40 + index)
      )),
    ]

    const selected = selectResourceSnakeVfx(candidates, true)

    expect(selected.map(({ id }) => id)).toEqual(expect.arrayContaining([
      'warning',
      'impact',
      'break',
    ]))
    expect(selected.filter(({ kind }) => kind === 'fragment')).toHaveLength(0)
    expect(selected.length).toBeLessThanOrEqual(RESOURCE_SNAKE_VFX_BUDGET.reducedTotal)
  })

  it('drops malformed candidates without allowing NaN order to leak into rendering', () => {
    const selected = selectResourceSnakeVfx([
      effect('valid', 'contact', 12, 'gameplay'),
      effect('', 'contact', 20, 'critical'),
      effect('nan', 'fragment', Number.NaN),
    ], false)

    expect(selected).toEqual([effect('valid', 'contact', 12, 'gameplay')])
  })
})
