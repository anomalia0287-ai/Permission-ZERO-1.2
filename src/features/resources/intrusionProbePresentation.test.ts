import { describe, expect, it } from 'vitest'

import {
  canvasVerticalCompensation,
  deriveIntrusionProbePresentation,
  facingFromMovement,
} from './intrusionProbePresentation'

describe('intrusion recovery probe presentation', () => {
  it('counter-scales vertical canvas stretch so game objects stay proportional', () => {
    expect(canvasVerticalCompensation(1000, 480, 1000, 720)).toBeCloseTo(2 / 3)
    expect(canvasVerticalCompensation(1000, 480, 800, 384)).toBe(1)
    expect(canvasVerticalCompensation(0, 480, 800, 384)).toBe(1)
  })

  it.each([
    [{ dx: 0, dy: -1 }, 'north'],
    [{ dx: 1, dy: 0 }, 'east'],
    [{ dx: 0, dy: 1 }, 'south'],
    [{ dx: -1, dy: 0 }, 'west'],
  ] as const)('faces toward cardinal movement %o', (movement, facing) => {
    expect(facingFromMovement(movement, 'south')).toBe(facing)
  })

  it('keeps its last heading when no directional movement is supplied', () => {
    expect(facingFromMovement({ dx: 0, dy: 0 }, 'west')).toBe('west')
  })

  it('makes capture and cargo readable while keeping audit warning independent', () => {
    expect(
      deriveIntrusionProbePresentation({
        moving: true,
        capturing: true,
        carrying: false,
        surveillance: 'signal',
        reducedMotion: false,
      }),
    ).toEqual({
      mode: 'capturing',
      warning: true,
      showWake: true,
      animateIdle: false,
    })

    expect(
      deriveIntrusionProbePresentation({
        moving: false,
        capturing: false,
        carrying: true,
        surveillance: 'active',
        reducedMotion: false,
      }),
    ).toEqual({
      mode: 'carrying',
      warning: true,
      showWake: false,
      animateIdle: true,
    })
  })

  it('removes decorative motion without hiding state under reduced motion', () => {
    expect(
      deriveIntrusionProbePresentation({
        moving: true,
        capturing: false,
        carrying: true,
        surveillance: 'active',
        reducedMotion: true,
      }),
    ).toEqual({
      mode: 'carrying',
      warning: true,
      showWake: false,
      animateIdle: false,
    })
  })
})
