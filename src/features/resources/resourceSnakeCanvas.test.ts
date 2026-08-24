import { describe, expect, it, vi } from 'vitest'

import {
  drawResourceSnakeScene,
  resourceSnakeCanvasResolution,
} from './resourceSnakeCanvas'
import type { ResourceSnakeScene } from './resourceSnakePresentation'

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

  it('renders luminous discrete trail dots without replacing their category color', () => {
    const baseline = recordingContext()
    drawResourceSnakeScene(baseline.context, EMPTY_SCENE, 1_000, 480)
    const { assignments, calls, context } = recordingContext()
    const scene: ResourceSnakeScene = {
      ...EMPTY_SCENE,
      rails: [{
        actorId: 'enemy-0',
        color: '#f06a43',
        opacity: 1,
        points: [
          { x: 4, y: 4 },
          { x: 10, y: 4 },
          { x: 10, y: 8 },
        ],
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

    drawResourceSnakeScene(context, scene, 1_000, 480)

    expect(calls.filter((call) => call === 'lineTo')).toHaveLength(
      baseline.calls.filter((call) => call === 'lineTo').length,
    )
    expect(calls.filter((call) => call === 'fillRect').length).toBeGreaterThan(
      baseline.calls.filter((call) => call === 'fillRect').length + scene.rails[0].points.length,
    )
    const fillStyles = assignments
      .filter(({ property }) => property === 'fillStyle')
      .map(({ value }) => value)
    expect(fillStyles).toContain('#f06a43')
    expect(fillStyles).not.toContain('#d7fbff')
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
