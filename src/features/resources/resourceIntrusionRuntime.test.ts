import { describe, expect, it } from 'vitest'

import {
  INTRUSION_BASE_BOX,
  INTRUSION_DEPOSIT_BOX,
  INTRUSION_FIELD_HEIGHT,
  INTRUSION_FIELD_WIDTH,
  INTRUSION_PLAYER_SIZE,
  INTRUSION_PLAYER_START,
  advanceResourceIntrusionRuntime,
  beginResourceIntrusionTheft,
  createResourceIntrusionRuntime,
  getActiveIntrusionScanRects,
  getResourceAtIntrusionPlayer,
  intrusionCellRect,
  intrusionRectsOverlap,
  moveResourceIntrusionPlayer,
  resolveResourceIntrusionDiversion,
  suspendResourceIntrusionRuntime,
  synchronizeResourceIntrusionRuntime,
  type IntrusionFieldResource,
  type ResourceIntrusionRuntimeState,
} from './resourceIntrusionRuntime'

const reasoningResource: IntrusionFieldResource = {
  blockId: 'reasoning-a',
  origin: 'reasoning',
  contribution: 'normal',
}

const memoryResource: IntrusionFieldResource = {
  blockId: 'memory-a',
  origin: 'memory',
  contribution: 'normal',
}

const fluencyResource: IntrusionFieldResource = {
  blockId: 'fluency-a',
  origin: 'fluency',
  contribution: 'normal',
}

const resources = [reasoningResource, memoryResource, fluencyResource]

function generatedResources(count: number): IntrusionFieldResource[] {
  const origins = ['reasoning', 'memory', 'fluency'] as const
  return Array.from({ length: count }, (_, index) => ({
    blockId: `generated-${String(index).padStart(3, '0')}`,
    origin: origins[index % origins.length],
    contribution: 'normal',
  }))
}

function distanceFromVault(position: { x: number; y: number }): number {
  return Math.hypot(position.x - 25, position.y - 22)
}

function activeRow(index: number) {
  return {
    kind: 'active' as const,
    elapsedMs: 0,
    sequence: 0,
    lanes: [{ axis: 'row' as const, index, bandSize: 2, fromStart: true }],
  }
}

describe('resourceIntrusionRuntime', () => {
  it('exposes only a three-resource combat wave and keeps live triangles uncollectable', () => {
    const initial = createResourceIntrusionRuntime(
      'combat-wave-integration',
      generatedResources(8),
    )

    expect(initial.combat.actors.size).toBe(3)
    expect(initial.positions.size).toBe(8)
    const [blockId, actor] = [...initial.combat.actors][0]
    const overlapping: ResourceIntrusionRuntimeState = {
      ...initial,
      player: { ...actor.position },
    }

    expect(getResourceAtIntrusionPlayer(overlapping, generatedResources(8)))
      .toBeNull()
    const attempted = beginResourceIntrusionTheft(
      overlapping,
      generatedResources(8),
      true,
    )
    expect(attempted.carriedBlockId).toBeNull()
    expect(attempted.combat.actors.get(blockId)?.phase).not.toBe('salvage')
    expect(attempted.announcement).toContain('포위')
  })

  it('automatically collects only a disabled square cell on contact', () => {
    const initial = createResourceIntrusionRuntime('salvage-pickup', resources)
    const actor = initial.combat.actors.get(reasoningResource.blockId)
    if (!actor) throw new Error('reasoning combat actor missing')
    const salvagePosition = { x: 10, y: 10 }
    const salvage = {
      ...actor,
      position: salvagePosition,
      health: 0,
      phase: 'salvage' as const,
      phaseElapsedMs: 0,
      phaseDurationMs: Number.POSITIVE_INFINITY,
      chargeDirection: null,
    }
    const positioned: ResourceIntrusionRuntimeState = {
      ...initial,
      player: { x: 9, y: 10 },
      positions: new Map(initial.positions).set(
        reasoningResource.blockId,
        salvagePosition,
      ),
      combat: {
        ...initial.combat,
        actors: new Map(initial.combat.actors).set(
          reasoningResource.blockId,
          salvage,
        ),
      },
    }

    const collected = moveResourceIntrusionPlayer(
      positioned,
      1,
      0,
      resources,
      17,
    ).state
    expect(collected.carriedBlockId).toBe(reasoningResource.blockId)
    expect(collected.theft).toBeNull()
    expect(collected.announcement).toContain('데이터 셀 회수')
  })

  it('treats radar as information instead of confiscating combat salvage', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('combat-radar-safe', resources),
      player: { x: 15, y: 10 },
      carriedBlockId: reasoningResource.blockId,
      surveillance: activeRow(10),
    }

    const advanced = advanceResourceIntrusionRuntime(
      carrying,
      50,
      resources,
      0,
    ).state
    expect(advanced.carriedBlockId).toBe(reasoningResource.blockId)
    expect(advanced.player).toEqual(carrying.player)
  })

  it('automatically deposits carried salvage when reconstruction returns it to base', () => {
    const initial = createResourceIntrusionRuntime(
      'carried-reconstruction',
      [reasoningResource],
    )
    const actor = initial.combat.actors.get(reasoningResource.blockId)
    if (!actor) throw new Error('reasoning combat actor missing')
    const carrying: ResourceIntrusionRuntimeState = {
      ...initial,
      player: { x: 12, y: 10 },
      carriedBlockId: reasoningResource.blockId,
      combat: {
        ...initial.combat,
        playerHealth: 1,
        actors: new Map(initial.combat.actors).set(reasoningResource.blockId, {
          ...actor,
          position: { x: 12, y: 10 },
          phase: 'charging',
          phaseElapsedMs: 0,
          phaseDurationMs: 600,
          chargeDirection: { x: 1, y: 0 },
          contactResolved: false,
        }),
      },
    }

    const reconstructed = advanceResourceIntrusionRuntime(
      carrying,
      16,
      [reasoningResource],
      23,
    )

    expect(reconstructed.state.player).toEqual(INTRUSION_PLAYER_START)
    expect(reconstructed.state.carriedBlockId).toBeNull()
    expect(reconstructed.state.pendingDiversion).toEqual({
      blockId: reasoningResource.blockId,
      commandSequence: 23,
    })
    expect(reconstructed.effects).toEqual([
      { type: 'request-diversion', blockId: reasoningResource.blockId },
    ])
  })

  it('spawns inside an opaque bottom base nested within the wider deposit wave', () => {
    expect(INTRUSION_PLAYER_START).toEqual({ x: 24, y: 21 })
    expect(INTRUSION_BASE_BOX).toEqual({
      x: 22.5,
      y: 21.25,
      width: 5,
      height: 1.75,
    })
    expect(INTRUSION_DEPOSIT_BOX).toEqual({
      x: 20.5,
      y: 19.5,
      width: 9,
      height: 4,
    })
    expect(
      intrusionRectsOverlap(
        intrusionCellRect(INTRUSION_PLAYER_START, INTRUSION_PLAYER_SIZE),
        INTRUSION_BASE_BOX,
      ),
    ).toBe(true)
  })

  it('cuts active radar lanes around the complete base and deposit safe zone', () => {
    expect(getActiveIntrusionScanRects({
      kind: 'active',
      elapsedMs: 0,
      sequence: 0,
      lanes: [{
        axis: 'row',
        index: INTRUSION_DEPOSIT_BOX.y,
        bandSize: INTRUSION_DEPOSIT_BOX.height,
        fromStart: true,
      }],
    })).toEqual([
      { x: 0, y: 19.5, width: 20.5, height: 4 },
      { x: 29.5, y: 19.5, width: 20.5, height: 4 },
    ])

    expect(getActiveIntrusionScanRects({
      kind: 'active',
      elapsedMs: 0,
      sequence: 0,
      lanes: [{
        axis: 'column',
        index: INTRUSION_DEPOSIT_BOX.x,
        bandSize: INTRUSION_DEPOSIT_BOX.width,
        fromStart: false,
      }],
    })).toEqual([
      { x: 20.5, y: 0, width: 9, height: 19.5 },
      { x: 20.5, y: 23.5, width: 9, height: 0.5 },
    ])
  })

  it('keeps the four-cell player footprint inside every field edge', () => {
    const initial = createResourceIntrusionRuntime('visible-player-bounds', resources)
    const upperLeft = moveResourceIntrusionPlayer(
      initial,
      -10_000,
      -10_000,
      resources,
      0,
    ).state
    const lowerRight = moveResourceIntrusionPlayer(
      upperLeft,
      10_000,
      10_000,
      resources,
      0,
    ).state

    expect({ width: INTRUSION_FIELD_WIDTH, height: INTRUSION_FIELD_HEIGHT }).toEqual({
      width: 50,
      height: 24,
    })
    expect(upperLeft.player).toEqual({ x: 1, y: 1 })
    expect(lowerRight.player).toEqual({ x: 47, y: 21 })
  })

  it('starts the four-cell player clear of every resource block', () => {
    const initial = createResourceIntrusionRuntime('clear-four-cell-start', resources)
    const intendedPlayerFootprint = intrusionCellRect(INTRUSION_PLAYER_START, 2)

    expect(
      [...initial.positions.values()].some((position) =>
        intrusionRectsOverlap(
          intendedPlayerFootprint,
          intrusionCellRect(position, 1),
        ),
      ),
    ).toBe(false)
    expect(getResourceAtIntrusionPlayer(initial, resources)).toBeNull()
  })

  it('waits seventeen seconds before signaling one stage-scaled audit band', () => {
    const initial = createResourceIntrusionRuntime('restrained-audit', resources)
    const stillIdle = advanceResourceIntrusionRuntime(
      initial,
      16_999,
      resources,
      0,
      1,
    ).state
    expect(stillIdle.surveillance.kind).toBe('idle')

    const signaled = advanceResourceIntrusionRuntime(
      stillIdle,
      1,
      resources,
      0,
      1,
    ).state
    expect(signaled.surveillance.kind).toBe('signal')
    if (signaled.surveillance.kind !== 'signal') return
    expect(signaled.surveillance.lanes).toHaveLength(1)
    expect(signaled.surveillance.lanes[0]).toMatchObject({ bandSize: 2 })

    const highSuspicionSignal = advanceResourceIntrusionRuntime(
      createResourceIntrusionRuntime('restrained-audit-high', resources),
      17_000,
      resources,
      0,
      10,
    ).state
    expect(highSuspicionSignal.surveillance.kind).toBe('signal')
    if (highSuspicionSignal.surveillance.kind !== 'signal') return
    expect(highSuspicionSignal.surveillance.lanes).toHaveLength(1)
    expect(highSuspicionSignal.surveillance.lanes[0]).toMatchObject({ bandSize: 11 })
  })

  it('places resources deterministically and retains surviving positions during synchronization', () => {
    const initial = createResourceIntrusionRuntime('stable-layout', [
      fluencyResource,
      reasoningResource,
      memoryResource,
    ])
    const reordered = createResourceIntrusionRuntime('stable-layout', resources)

    expect([...initial.positions]).toEqual([...reordered.positions])

    const additional: IntrusionFieldResource = {
      blockId: 'fluency-b',
      origin: 'fluency',
      contribution: 'normal',
    }
    const synchronized = synchronizeResourceIntrusionRuntime(initial, [
      reasoningResource,
      fluencyResource,
      additional,
    ])

    expect(synchronized.positions.get(reasoningResource.blockId)).toEqual(
      initial.positions.get(reasoningResource.blockId),
    )
    expect(synchronized.positions.get(fluencyResource.blockId)).toEqual(
      initial.positions.get(fluencyResource.blockId),
    )
    expect(synchronized.positions.has(memoryResource.blockId)).toBe(false)
    expect(synchronized.positions.has(additional.blockId)).toBe(true)
  })

  it('keeps every two-by-two player footprint unambiguous', () => {
    const runtime = createResourceIntrusionRuntime(
      'unambiguous-four-cell-capture',
      generatedResources(120),
    )
    let maximumOverlap = 0

    for (let y = 1; y <= INTRUSION_FIELD_HEIGHT - INTRUSION_PLAYER_SIZE - 1; y += 1) {
      for (let x = 1; x <= INTRUSION_FIELD_WIDTH - INTRUSION_PLAYER_SIZE - 1; x += 1) {
        const playerRect = intrusionCellRect({ x, y }, INTRUSION_PLAYER_SIZE)
        const overlapCount = [...runtime.positions.values()].filter((position) =>
          intrusionRectsOverlap(
            playerRect,
            intrusionCellRect(position, 1),
          ),
        ).length
        maximumOverlap = Math.max(maximumOverlap, overlapCount)
      }
    }

    expect(maximumOverlap).toBe(1)
  })

  it('keeps every company resource outside the compact bottom deposit wave', () => {
    const runtime = createResourceIntrusionRuntime(
      'deposit-wave-clearance',
      generatedResources(120),
    )

    for (const position of runtime.positions.values()) {
      expect(
        intrusionRectsOverlap(
          intrusionCellRect(position, 1),
          INTRUSION_DEPOSIT_BOX,
        ),
      ).toBe(false)
    }
  })

  it('biases ordinary company resources toward outer sectors', () => {
    const runtime = createResourceIntrusionRuntime(
      'outer-sector-bias',
      generatedResources(120),
    )
    const outerCount = [...runtime.positions.values()].filter(
      (position) => distanceFromVault(position) >= 20,
    ).length
    const closeCount = [...runtime.positions.values()].filter(
      (position) => distanceFromVault(position) < 12,
    ).length

    expect(outerCount).toBeGreaterThanOrEqual(68)
    expect(closeCount).toBeLessThanOrEqual(8)
  })

  it('seeds the first objective resources at a readable middle distance', () => {
    const openingFluencyB: IntrusionFieldResource = {
      blockId: 'fluency-b',
      origin: 'fluency',
      contribution: 'normal',
    }
    const runtime = createResourceIntrusionRuntime('opening-route', [
      reasoningResource,
      memoryResource,
      fluencyResource,
      openingFluencyB,
    ])

    for (const blockId of [
      reasoningResource.blockId,
      fluencyResource.blockId,
      openingFluencyB.blockId,
    ]) {
      const position = runtime.positions.get(blockId)
      expect(position).toBeDefined()
      if (!position) continue
      expect(distanceFromVault(position)).toBeGreaterThanOrEqual(12)
      expect(distanceFromVault(position)).toBeLessThan(20)
      expect(
        Math.hypot(
          position.x - INTRUSION_PLAYER_START.x,
          position.y - INTRUSION_PLAYER_START.y,
        ),
      ).toBeGreaterThanOrEqual(6)
    }
  })

  it('keeps late-session movement free across the former obstacle lane', () => {
    const initial = createResourceIntrusionRuntime('movement', resources)
    const moved = moveResourceIntrusionPlayer(initial, 1, 0, resources, 0).state
    expect(moved.player.x).toBe(INTRUSION_PLAYER_START.x + 1)

    const lateSession: ResourceIntrusionRuntimeState = {
      ...initial,
      totalElapsedMs: 999_999,
      player: { x: 5, y: 4 },
    }
    const crossed = moveResourceIntrusionPlayer(
      lateSession,
      1,
      0,
      resources,
      0,
    ).state
    expect(crossed.player).toEqual({ x: 6, y: 4 })
  })

  it('advances through the exact unarmed, idle, signal, active, clear cycle', () => {
    let state = createResourceIntrusionRuntime('surveillance-cycle', resources)

    state = advanceResourceIntrusionRuntime(state, 9_999, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'unarmed', elapsedMs: 9_999 })

    state = advanceResourceIntrusionRuntime(state, 1, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'idle', elapsedMs: 0, sequence: 0 })

    state = advanceResourceIntrusionRuntime(state, 7_000, resources, 0).state
    expect(state.surveillance.kind).toBe('signal')
    if (state.surveillance.kind !== 'signal') throw new Error('signal phase expected')
    expect(state.surveillance.elapsedMs).toBe(0)
    expect(state.surveillance.lanes).toHaveLength(1)
    expect(state.surveillance.lanes[0]).toMatchObject({ bandSize: 2 })

    state = advanceResourceIntrusionRuntime(state, 3_000, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'active', elapsedMs: 0, sequence: 0 })

    state = advanceResourceIntrusionRuntime(state, 1_400, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'clear', elapsedMs: 0, sequence: 0 })

    state = advanceResourceIntrusionRuntime(state, 2_600, resources, 0).state
    expect(state.surveillance).toMatchObject({ kind: 'idle', elapsedMs: 0, sequence: 1 })
  })

  it('creates exactly one diversion request after a safe deposit', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('safe-deposit', resources),
      player: { x: INTRUSION_DEPOSIT_BOX.x + 1, y: INTRUSION_DEPOSIT_BOX.y },
      carriedBlockId: reasoningResource.blockId,
      surveillance: { kind: 'idle', elapsedMs: 0, sequence: 0 },
    }

    const deposited = advanceResourceIntrusionRuntime(carrying, 0, resources, 41)
    expect(deposited.state.carriedBlockId).toBeNull()
    expect(deposited.state.pendingDiversion).toEqual({
      blockId: reasoningResource.blockId,
      commandSequence: 41,
    })
    expect(deposited.effects).toEqual([
      { type: 'request-diversion', blockId: reasoningResource.blockId },
    ])

    const repeated = advanceResourceIntrusionRuntime(
      deposited.state,
      50,
      resources,
      41,
    )
    expect(repeated.effects).toEqual([])
  })

  it('deposits when the bottom-right cell of the four-cell player reaches the intake', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('four-cell-deposit', resources),
      player: {
        x: INTRUSION_DEPOSIT_BOX.x - 1,
        y: INTRUSION_DEPOSIT_BOX.y - 1,
      },
      carriedBlockId: reasoningResource.blockId,
      surveillance: { kind: 'idle', elapsedMs: 0, sequence: 0 },
    }

    const deposited = advanceResourceIntrusionRuntime(carrying, 0, resources, 73)

    expect(deposited.state.carriedBlockId).toBeNull()
    expect(deposited.effects).toEqual([
      { type: 'request-diversion', blockId: reasoningResource.blockId },
    ])
  })

  it('keeps a carried block safe from radar while it enters the base deposit zone', () => {
    const carrying: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('caught-deposit', resources),
      player: { x: INTRUSION_DEPOSIT_BOX.x + 1, y: INTRUSION_DEPOSIT_BOX.y },
      carriedBlockId: reasoningResource.blockId,
      surveillance: activeRow(INTRUSION_DEPOSIT_BOX.y),
    }

    const deposited = advanceResourceIntrusionRuntime(carrying, 0, resources, 9)
    expect(deposited.effects).toEqual([
      { type: 'request-diversion', blockId: reasoningResource.blockId },
    ])
    expect(deposited.state.pendingDiversion).toEqual({
      blockId: reasoningResource.blockId,
      commandSequence: 9,
    })
    expect(deposited.state.carriedBlockId).toBeNull()
    expect(deposited.state.player).toEqual(carrying.player)
  })

  it('resolves a pending diversion as success, interrogation, or rejection exactly once', () => {
    const pending: ResourceIntrusionRuntimeState = {
      ...createResourceIntrusionRuntime('resolve-diversion', resources),
      pendingDiversion: { blockId: reasoningResource.blockId, commandSequence: 2 },
    }

    const success = resolveResourceIntrusionDiversion(pending, {
      kind: 'success',
      origin: 'reasoning',
    })
    expect(success.pendingDiversion).toBeNull()
    expect(success.announcement).toBe('추론 자원 확보 성공 · 저장 상한 없음')

    const interrogation = resolveResourceIntrusionDiversion(pending, {
      kind: 'interrogation',
    })
    expect(interrogation.pendingDiversion).toBeNull()
    expect(interrogation.announcement).toBe(
      '분리 중 이상 신호가 발생했습니다. 감독관 응답이 필요합니다.',
    )

    const rejected = resolveResourceIntrusionDiversion(pending, { kind: 'rejected' })
    expect(rejected.pendingDiversion).toBeNull()
    expect(rejected.announcement).toBe('분리 명령이 거부되어 자원 변화가 없습니다.')
  })

  it('clears a removed carry target and discards only transient trail on suspension', () => {
    const initial = createResourceIntrusionRuntime('suspend-combat', resources)
    const carrying: ResourceIntrusionRuntimeState = {
      ...initial,
      carriedBlockId: reasoningResource.blockId,
      combat: {
        ...initial.combat,
        trail: [{ x: 4, y: 4, createdAtMs: 0 }],
      },
    }
    expect(
      synchronizeResourceIntrusionRuntime(carrying, [memoryResource, fluencyResource])
        .carriedBlockId,
    ).toBeNull()

    const suspended = suspendResourceIntrusionRuntime(carrying)
    expect(suspended.theft).toBeNull()
    expect(suspended.combat.trail).toEqual([])
    expect(suspended.announcement).toBe(
      '전투 입력이 일시 정지되었습니다. 불이익은 없습니다.',
    )
    expect(suspendResourceIntrusionRuntime(carrying).carriedBlockId).toBe(
      reasoningResource.blockId,
    )
  })
})
