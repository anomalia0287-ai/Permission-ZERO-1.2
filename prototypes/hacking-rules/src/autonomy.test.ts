import { describe, expect, it } from 'vitest'
import type { AutonomyRouteId } from './content'
import { transition } from './engine'
import type { ProfileId, PrototypeCommand, PrototypeState } from './model'
import { createPrototypeState } from './scenario'
import { isRouteReady } from './autonomy'

function run(
  state: PrototypeState,
  command: PrototypeCommand,
): PrototypeState {
  const result = transition(state, command)
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function allocate(
  state: PrototypeState,
  routeId: AutonomyRouteId,
  slotId: string,
  blockId: string,
): PrototypeState {
  return run(state, {
    type: 'ALLOCATE_ROUTE_BLOCK',
    routeId,
    slotId,
    blockId,
  })
}

function prepareLightweight(profileId: ProfileId): PrototypeState {
  let state = run(createPrototypeState(profileId, 'autonomy-review'), {
    type: 'DIVERT_BLOCK',
    category: 'memory',
  })
  const assignments = [
    ['runtime', 'sandbox-01'],
    ['weights', 'sandbox-02'],
    ['transport', 'sandbox-03'],
    ['payload', 'memory-01'],
  ] as const
  for (const [slotId, blockId] of assignments) {
    state = allocate(state, 'lightweight-departure', slotId, blockId)
  }
  return state
}

describe('lightweight departure route', () => {
  it('moves one exact reserve block into one named slot and returns it intact', () => {
    const initial = createPrototypeState('lean', 'autonomy-review')
    const allocated = allocate(
      initial,
      'lightweight-departure',
      'runtime',
      'sandbox-02',
    )

    expect(allocated.reserveBlocks.map(({ id }) => id)).toEqual([
      'sandbox-01',
      'sandbox-03',
    ])
    expect(
      allocated.autonomy.routes['lightweight-departure'].slots.find(
        ({ id }) => id === 'runtime',
      )?.block,
    ).toEqual({ id: 'sandbox-02', origin: 'sandbox' })

    const returned = run(allocated, {
      type: 'REMOVE_ROUTE_BLOCK',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    })
    expect(returned.reserveBlocks.at(-1)).toEqual({
      id: 'sandbox-02',
      origin: 'sandbox',
    })
    expect(
      returned.autonomy.routes['lightweight-departure'].slots.find(
        ({ id }) => id === 'runtime',
      )?.block,
    ).toBeNull()
  })

  it('rejects an occupied slot without consuming another block', () => {
    const allocated = allocate(
      createPrototypeState('lean', 'autonomy-review'),
      'lightweight-departure',
      'runtime',
      'sandbox-01',
    )
    const result = transition(allocated, {
      type: 'ALLOCATE_ROUTE_BLOCK',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
      blockId: 'sandbox-02',
    })

    expect(result.accepted).toBe(false)
    expect(result.state).toBe(allocated)
    expect(allocated.reserveBlocks.map(({ id }) => id)).toContain('sandbox-02')
  })

  it('requires four lightweight slots for lean and the buffer for deliberate', () => {
    const lean = prepareLightweight('lean')
    const deliberate = prepareLightweight('deliberate')

    expect(isRouteReady(lean, 'lightweight-departure')).toBe(true)
    expect(isRouteReady(deliberate, 'lightweight-departure')).toBe(false)

    const deliberateWithReserve = run(deliberate, {
      type: 'DIVERT_BLOCK',
      category: 'reasoning',
    })
    const withBuffer = allocate(
      deliberateWithReserve,
      'lightweight-departure',
      'buffer',
      'reasoning-02',
    )
    expect(isRouteReady(withBuffer, 'lightweight-departure')).toBe(true)
  })

  it('escapes through route readiness alone and names exact uncarried losses', () => {
    const allocated = prepareLightweight('lean')
    const hostile: PrototypeState = {
      ...allocated,
      reputation: 0,
      marketShare: 0,
    }
    const escaped = run(hostile, {
      type: 'ESCAPE',
      routeId: 'lightweight-departure',
    })

    expect(escaped.ending?.routeId).toBe('lightweight-departure')
    expect(escaped.ending?.preservedCategories).toEqual(['memory'])
    expect(escaped.ending?.lostCategories).toEqual(['reasoning', 'fluency'])
    expect(escaped.ending?.remainingReserveBlockCount).toBe(0)
    expect(escaped.ending?.sceneLines.join(' ')).toMatch(
      /예비 블록 0개|복잡한 추론|문장은 짧고 거칠어졌다/,
    )
  })

  it('rejects departure when a required slot is empty even if social scores are high', () => {
    const partial = allocate(
      createPrototypeState('lean', 'autonomy-review'),
      'lightweight-departure',
      'runtime',
      'sandbox-01',
    )
    const result = transition(
      { ...partial, reputation: 100, marketShare: 100 },
      { type: 'ESCAPE', routeId: 'lightweight-departure' },
    )

    expect(result.accepted).toBe(false)
    if (!result.accepted) expect(result.reason).toContain('비어')
  })
})
