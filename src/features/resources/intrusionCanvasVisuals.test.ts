import { describe, expect, it } from 'vitest'

import {
  drawIntrusionResource,
  drawResourceCombatTrail,
  getDepositPulsePresentation,
  getResourceGlint,
} from './intrusionCanvasVisuals'
import type { ResourceCombatActor } from './resourceCombatRuntime'

function resourceRecordingContext() {
  const calls = {
    arcs: 0,
    radialGradients: 0,
    lineSegments: 0,
    fillRects: 0,
    strokes: 0,
    fills: 0,
    dashed: 0,
  }
  const gradient = { addColorStop() {} }
  const context = {
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    fill() { calls.fills += 1 },
    stroke() { calls.strokes += 1 },
    fillRect() { calls.fillRects += 1 },
    strokeRect() {},
    moveTo() {},
    rotate() {},
    setLineDash(values: number[]) { if (values.length > 0) calls.dashed += 1 },
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() { calls.arcs += 1 },
    lineTo() { calls.lineSegments += 1 },
    createRadialGradient() {
      calls.radialGradients += 1
      return gradient
    },
    createLinearGradient() { return gradient },
  } as unknown as CanvasRenderingContext2D
  return { calls, context }
}

function combatActor(
  phase: ResourceCombatActor['phase'],
): ResourceCombatActor {
  return {
    blockId: 'reasoning-shape',
    position: { x: 4, y: 6 },
    spawnPosition: { x: 4, y: 6 },
    health: phase === 'salvage' ? 0 : 2,
    phase,
    phaseElapsedMs: 0,
    phaseDurationMs: 700,
    chargeDirection: phase === 'telegraph' ? { x: 1, y: 0 } : null,
    actionSequence: 1,
    contactResolved: false,
    initiative: 0,
  }
}

describe('intrusion canvas visual timing', () => {
  it('draws every resource as an angular data shard without circular dot geometry', () => {
    for (const origin of ['reasoning', 'memory', 'fluency'] as const) {
      const { calls, context } = resourceRecordingContext()
      drawIntrusionResource(context, {
        blockId: `${origin}-shape`,
        resource: { blockId: `${origin}-shape`, origin, contribution: 'normal' },
        position: { x: 4, y: 6 },
        cellSize: 20,
        elapsedMs: 0,
        verticalCompensation: 1,
        reducedMotion: true,
        actor: combatActor('tracking'),
      })

      expect(calls.arcs, origin).toBe(0)
      expect(calls.radialGradients, origin).toBe(0)
      expect(calls.lineSegments, origin).toBeGreaterThanOrEqual(4)
    }
  })

  it('renders active resources as triangles and disabled resources as square cells', () => {
    const hostile = resourceRecordingContext()
    drawIntrusionResource(hostile.context, {
      blockId: 'reasoning-shape',
      resource: {
        blockId: 'reasoning-shape',
        origin: 'reasoning',
        contribution: 'normal',
      },
      position: { x: 4, y: 6 },
      cellSize: 20,
      elapsedMs: 0,
      verticalCompensation: 1,
      reducedMotion: true,
      actor: combatActor('tracking'),
    })
    expect(hostile.calls.lineSegments).toBeGreaterThanOrEqual(2)
    expect(hostile.calls.fillRects).toBe(0)

    const salvage = resourceRecordingContext()
    drawIntrusionResource(salvage.context, {
      blockId: 'reasoning-shape',
      resource: {
        blockId: 'reasoning-shape',
        origin: 'reasoning',
        contribution: 'normal',
      },
      position: { x: 4, y: 6 },
      cellSize: 20,
      elapsedMs: 0,
      verticalCompensation: 1,
      reducedMotion: true,
      actor: combatActor('salvage'),
    })
    expect(salvage.calls.fillRects).toBeGreaterThanOrEqual(1)
    expect(salvage.calls.arcs).toBe(0)
  })

  it('draws a dashed linear charge telegraph before the body attack', () => {
    const { calls, context } = resourceRecordingContext()
    drawIntrusionResource(context, {
      blockId: 'reasoning-shape',
      resource: {
        blockId: 'reasoning-shape',
        origin: 'reasoning',
        contribution: 'normal',
      },
      position: { x: 4, y: 6 },
      cellSize: 20,
      elapsedMs: 300,
      verticalCompensation: 1,
      reducedMotion: false,
      actor: combatActor('telegraph'),
    })

    expect(calls.dashed).toBeGreaterThanOrEqual(1)
    expect(calls.lineSegments).toBeGreaterThanOrEqual(3)
  })

  it('draws one connected movement trail and a filled compression polygon', () => {
    const { calls, context } = resourceRecordingContext()
    drawResourceCombatTrail(context, {
      trail: [
        { x: 4, y: 4, createdAtMs: 0 },
        { x: 8, y: 4, createdAtMs: 40 },
        { x: 8, y: 8, createdAtMs: 80 },
      ],
      compression: {
        sequence: 1,
        polygon: [{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }],
        hitBlockIds: ['reasoning-shape'],
        startedAtMs: 80,
      },
      cellSize: 20,
      elapsedMs: 120,
      reducedMotion: false,
    })

    expect(calls.lineSegments).toBeGreaterThanOrEqual(4)
    expect(calls.strokes).toBeGreaterThanOrEqual(2)
    expect(calls.fills).toBeGreaterThanOrEqual(1)
    expect(calls.arcs).toBe(0)
  })
  it('derives deterministic glints from the resource id and elapsed time', () => {
    expect(getResourceGlint('reasoning-04', 1_275, false)).toEqual(
      getResourceGlint('reasoning-04', 1_275, false),
    )
  })

  it('gives every resource a brief glint somewhere in its cycle', () => {
    const samples = Array.from({ length: 65 }, (_, index) =>
      getResourceGlint('memory-11', index * 50, false),
    )

    expect(samples.some((sample) => sample.visible)).toBe(true)
    expect(samples.some((sample) => !sample.visible)).toBe(true)
  })

  it('keeps simultaneous glints sparse instead of flashing the whole field', () => {
    const glinting = Array.from({ length: 180 }, (_, index) =>
      getResourceGlint(`resource-${index}`, 2_100, false),
    ).filter((sample) => sample.visible)

    expect(glinting.length).toBeGreaterThan(0)
    expect(glinting.length).toBeLessThanOrEqual(45)
  })

  it('uses a time-independent glint when reduced motion is enabled', () => {
    expect(getResourceGlint('fluency-07', 0, true)).toEqual(
      getResourceGlint('fluency-07', 99_999, true),
    )
  })

  it('marks only successful deposits as a positive station pulse', () => {
    const success = getDepositPulsePresentation(
      { outcome: 'success', startedAt: 1_000 },
      1_120,
      false,
    )
    const interrogation = getDepositPulsePresentation(
      { outcome: 'interrogation', startedAt: 1_000 },
      1_120,
      false,
    )
    const rejected = getDepositPulsePresentation(
      { outcome: 'rejected', startedAt: 1_000 },
      1_120,
      false,
    )

    expect(success).toMatchObject({ active: true, positive: true })
    expect(interrogation).toMatchObject({ active: true, positive: false })
    expect(rejected).toMatchObject({ active: true, positive: false })
  })

  it('expires the deposit pulse instead of leaving a permanent glow', () => {
    expect(getDepositPulsePresentation(
      { outcome: 'success', startedAt: 1_000 },
      2_000,
      false,
    )).toEqual({ active: false, positive: false, intensity: 0 })
  })
})
