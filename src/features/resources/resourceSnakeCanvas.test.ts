import { describe, expect, it, vi } from 'vitest'

import {
  drawResourceSnakeScene,
  resourceSnakeCanvasResolution,
} from './resourceSnakeCanvas'
import type {
  ResourceSnakeScene,
  ResourceSnakeSceneRail,
} from './resourceSnakePresentation'

function recordingContext() {
  const calls: string[] = []
  const assignments: Array<{ property: string; value: unknown }> = []
  const gradient = { addColorStop: vi.fn() }
  const methods = new Set([
    'arc',
    'beginPath',
    'clearRect',
    'clip',
    'closePath',
    'fill',
    'fillRect',
    'fillText',
    'lineTo',
    'moveTo',
    'restore',
    'rotate',
    'save',
    'setLineDash',
    'stroke',
    'strokeRect',
    'translate',
  ])
  const target: Record<string, unknown> = {
    canvas: { width: 1_000, height: 480 },
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
  }
  const context = new Proxy(target, {
    get(object, property: string) {
      if (property in object) return object[property]
      if (!methods.has(property)) return undefined
      const method = vi.fn(() => calls.push(property))
      object[property] = method
      return method
    },
    set(object, property: string, value) {
      assignments.push({ property, value })
      object[property] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { assignments, calls, context }
}

const EMPTY_SCENE: ResourceSnakeScene = {
  simulationMs: 500,
  reducedMotion: false,
  surveillance: null,
  cores: [],
  rails: [],
  speeches: [],
  telegraphs: [],
  contacts: [],
  explosions: [],
  fragments: [],
  powerCuts: [],
  dangerEdges: [],
}

describe('resource snake canvas', () => {
  it('uses high-DPI backing pixels without allowing an unbounded canvas allocation', () => {
    expect(resourceSnakeCanvasResolution(1_000, 480, 3)).toEqual({
      width: 2_000,
      height: 960,
      pixelRatio: 2,
    })
    const huge = resourceSnakeCanvasResolution(2_400, 1_200, 2)
    expect(huge.width * huge.height).toBeLessThanOrEqual(2_400_000)
    expect(huge.pixelRatio).toBeLessThan(1)
  })

  function railScene(overrides: Partial<ResourceSnakeSceneRail> = {}): ResourceSnakeScene {
    return {
      ...EMPTY_SCENE,
      rails: [{
        actorId: 'enemy-0',
        color: '#f06a43',
        opacity: 1,
        dissolve: 0,
        points: [
          { x: 4, y: 4 },
          { x: 10, y: 4 },
          { x: 10, y: 8 },
        ],
        ...overrides,
      }],
      cores: [{
        id: 'enemy-0',
        x: 10,
        y: 8,
        color: '#f06a43',
        opacity: 1,
        scale: 1,
        phase: 'active',
        role: 'pressure',
        shape: 'square',
        integrityRatio: 1,
      }],
    }
  }

  it('draws the trail as luminous dots in its category color', () => {
    const baseline = recordingContext()
    drawResourceSnakeScene(baseline.context, EMPTY_SCENE, 1_000, 480)
    const { assignments, calls, context } = recordingContext()

    drawResourceSnakeScene(context, railScene(), 1_000, 480)

    // A filled square per dot per pass — the bead-of-light look, not a
    // stroked ribbon.
    expect(calls.filter((call) => call === 'fillRect').length).toBeGreaterThan(
      baseline.calls.filter((call) => call === 'fillRect').length
      + railScene().rails[0].points.length,
    )
    const fillStyles = assignments
      .filter(({ property }) => property === 'fillStyle')
      .map(({ value }) => value)
    expect(fillStyles).toContain('#f06a43')
    expect(fillStyles).not.toContain('#d7fbff')
  })

  it('drains a killed rail from the tail and stops drawing it once gone', () => {
    const baseline = recordingContext()
    drawResourceSnakeScene(baseline.context, EMPTY_SCENE, 1_000, 480)

    const draining = recordingContext()
    drawResourceSnakeScene(draining.context, railScene({ dissolve: 0.5 }), 1_000, 480)
    const intact = recordingContext()
    drawResourceSnakeScene(intact.context, railScene(), 1_000, 480)

    // Half-drained: fewer dots remain than when intact.
    expect(draining.calls.filter((call) => call === 'fillRect').length)
      .toBeLessThan(intact.calls.filter((call) => call === 'fillRect').length)
    expect(draining.calls.filter((call) => call === 'fillRect').length)
      .toBeGreaterThan(baseline.calls.filter((call) => call === 'fillRect').length)

    // Fully drained: only the core remains, no rail marks at all.
    const coreOnly = recordingContext()
    drawResourceSnakeScene(coreOnly.context, railScene({ points: [] }), 1_000, 480)
    const gone = recordingContext()
    drawResourceSnakeScene(gone.context, railScene({ dissolve: 1 }), 1_000, 480)
    expect(gone.calls.filter((call) => call === 'fillRect').length).toBe(
      coreOnly.calls.filter((call) => call === 'fillRect').length,
    )
  })

  it('renders telegraphs as glowing dots without an attack chevron', () => {
    const baseline = recordingContext()
    drawResourceSnakeScene(baseline.context, EMPTY_SCENE, 1_000, 480)
    const { calls, context } = recordingContext()
    drawResourceSnakeScene(context, {
      ...EMPTY_SCENE,
      telegraphs: [{
        id: 'telegraph:enemy-0:400',
        kind: 'telegraph',
        priority: 'critical',
        startedAtMs: 400,
        enemyId: 'enemy-0',
        role: 'pressure',
        color: '#21e6ff',
        points: [{ x: 10, y: 4 }, { x: 10, y: 9 }],
        attackHeadingRadians: Math.PI / 2,
        progress: 0.5,
        animated: true,
      }],
    }, 1_000, 480)

    expect(calls.filter((call) => call === 'lineTo')).toHaveLength(
      baseline.calls.filter((call) => call === 'lineTo').length,
    )
    expect(calls.filter((call) => call === 'arc').length).toBeGreaterThan(
      baseline.calls.filter((call) => call === 'arc').length,
    )
  })

  it('draws the player head as a circle and the enemy head as a square', () => {
    const { calls, context } = recordingContext()
    drawResourceSnakeScene(context, {
      ...EMPTY_SCENE,
      cores: [
        {
          id: 'player', x: 12, y: 12, color: '#f4f7ff', opacity: 1, scale: 1,
          phase: 'active', role: null, shape: 'circle', integrityRatio: 1,
        },
        {
          id: 'enemy-0', x: 20, y: 12, color: '#21e6ff', opacity: 1, scale: 1,
          phase: 'active', role: 'pressure', shape: 'square', integrityRatio: 1,
        },
      ],
    }, 1_000, 480)

    expect(calls.filter((call) => call === 'arc').length).toBeGreaterThan(0)
    expect(calls.filter((call) => call === 'fillRect').length).toBeGreaterThan(0)
  })
})
