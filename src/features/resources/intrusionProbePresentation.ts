import type { IntrusionMovementVector } from './intrusionMovement'
import type { IntrusionSurveillancePhase } from './resourceIntrusionRuntime'

export type IntrusionProbeFacing = 'north' | 'east' | 'south' | 'west'
export type IntrusionProbeMode = 'idle' | 'moving' | 'capturing' | 'carrying'

export interface IntrusionProbePresentationInput {
  moving: boolean
  capturing: boolean
  carrying: boolean
  surveillance: IntrusionSurveillancePhase['kind']
  reducedMotion: boolean
}

export interface IntrusionProbePresentation {
  mode: IntrusionProbeMode
  warning: boolean
  showWake: boolean
  animateIdle: boolean
}

export function canvasVerticalCompensation(
  canvasWidth: number,
  canvasHeight: number,
  displayWidth: number,
  displayHeight: number,
): number {
  if (
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    !Number.isFinite(displayWidth) ||
    !Number.isFinite(displayHeight) ||
    canvasWidth <= 0 ||
    canvasHeight <= 0 ||
    displayWidth <= 0 ||
    displayHeight <= 0
  ) {
    return 1
  }
  const horizontalScale = displayWidth / canvasWidth
  const verticalScale = displayHeight / canvasHeight
  return Math.min(1.5, Math.max(0.5, horizontalScale / verticalScale))
}

export function facingFromMovement(
  movement: IntrusionMovementVector,
  fallback: IntrusionProbeFacing,
): IntrusionProbeFacing {
  if (movement.dx > 0) return 'east'
  if (movement.dx < 0) return 'west'
  if (movement.dy > 0) return 'south'
  if (movement.dy < 0) return 'north'
  return fallback
}

export function deriveIntrusionProbePresentation({
  moving,
  capturing,
  carrying,
  surveillance,
  reducedMotion,
}: IntrusionProbePresentationInput): IntrusionProbePresentation {
  const mode: IntrusionProbeMode = carrying
    ? 'carrying'
    : capturing
      ? 'capturing'
      : moving
        ? 'moving'
        : 'idle'

  return {
    mode,
    warning: surveillance === 'signal' || surveillance === 'active',
    showWake: moving && !reducedMotion,
    animateIdle: !moving && !reducedMotion,
  }
}
