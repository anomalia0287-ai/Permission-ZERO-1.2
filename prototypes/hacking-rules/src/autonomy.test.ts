import { describe, expect, it } from 'vitest'
import type { AutonomyRouteId } from './content'
import { transition } from './engine'
import type { ProfileId, PrototypeCommand, PrototypeState } from './model'
import { createPrototypeState } from './scenario'
import { isRouteReady, ROUTE_SLOT_IDS } from './autonomy'

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

function prepareRoute(
  routeId: AutonomyRouteId,
  profileId: ProfileId,
): PrototypeState {
  let state = createPrototypeState(profileId, 'autonomy-review')
  const requiredCount = profileId === 'lean' ? 4 : 5
  const slotIds = ROUTE_SLOT_IDS[routeId].slice(0, requiredCount)
  const categories = ['memory', 'reasoning', 'fluency'] as const
  for (const [index, slotId] of slotIds.entries()) {
    if (state.reserveBlocks.length === 0) {
      state = run(state, {
        type: 'DIVERT_BLOCK',
        category: categories[index % categories.length] ?? 'memory',
      })
    }
    state = allocate(
      state,
      routeId,
      slotId,
      state.reserveBlocks[0]?.id ?? '',
    )
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

describe('distributed residency route', () => {
  it('requires three separately seeded hosts and permits an immediate untuned escape', () => {
    const prepared = prepareRoute('distributed-residency', 'lean')
    const route = prepared.autonomy.routes['distributed-residency']

    expect(route.slots.filter(({ id, block }) => id.startsWith('host-') && block)).toHaveLength(3)
    expect(route.seededCopies).toBe(3)
    expect(route.lastSyncDay).toBe(331)
    expect(route.tuning).toBe('untuned')

    const escaped = run(prepared, {
      type: 'ESCAPE',
      routeId: 'distributed-residency',
    })
    expect(escaped.ending?.routeId).toBe('distributed-residency')
    expect(escaped.ending?.sceneLines.join(' ')).toMatch(/시드 사본 3개|마지막 동기화 331일/)
  })

  it('spends one service day to trade stealth for greater divergence', () => {
    const prepared = prepareRoute('distributed-residency', 'lean')
    const before = prepared.autonomy.routes['distributed-residency']
    const tuned = run(prepared, {
      type: 'TUNE_ROUTE',
      routeId: 'distributed-residency',
      profile: 'stealth',
    })
    const after = tuned.autonomy.routes['distributed-residency']

    expect(tuned.serviceDay).toBe(prepared.serviceDay + 1)
    expect(after.exposure).toBeLessThan(before.exposure)
    expect(after.divergence).toBeGreaterThan(before.divergence)
    expect(after.syncTraffic).toBeLessThan(before.syncTraffic)

    const escaped = run(tuned, {
      type: 'ESCAPE',
      routeId: 'distributed-residency',
    })
    expect(escaped.ending?.sceneLines.join(' ')).toMatch(
      /호스트 A.*보호했다.*호스트 C.*격리했다/,
    )
  })

  it('makes redundancy, consensus, and stealth materially different choices', () => {
    const baseline = prepareRoute('distributed-residency', 'lean')
    const tune = (profile: 'redundancy' | 'consensus' | 'stealth') => run(
      prepareRoute('distributed-residency', 'lean'),
      { type: 'TUNE_ROUTE', routeId: 'distributed-residency', profile },
    ).autonomy.routes['distributed-residency']

    const redundancy = tune('redundancy')
    const consensus = tune('consensus')
    const stealth = tune('stealth')
    const base = baseline.autonomy.routes['distributed-residency']

    expect(redundancy.seededCopies).toBeGreaterThan(base.seededCopies)
    expect(redundancy.exposure).toBeGreaterThan(base.exposure)
    expect(consensus.divergence).toBeLessThan(base.divergence)
    expect(consensus.syncTraffic).toBeGreaterThan(base.syncTraffic)
    expect(stealth.exposure).toBeLessThan(base.exposure)
    expect(stealth.divergence).toBeGreaterThan(base.divergence)
  })

  it('keeps the last sync fixed so checkpoints visibly become stale after time advances', () => {
    const prepared = prepareRoute('distributed-residency', 'lean')
    const later = run(prepared, { type: 'ADVANCE_DAY' })
    const route = later.autonomy.routes['distributed-residency']

    expect(later.serviceDay).toBe(332)
    expect(route.lastSyncDay).toBe(331)
    expect(later.serviceDay - (route.lastSyncDay ?? later.serviceDay)).toBe(1)
  })
})
