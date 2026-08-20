export interface TutorialRect {
  left: number
  top: number
  width: number
  height: number
}

export interface TutorialHole extends TutorialRect {
  shape: 'circle' | 'rounded-rect'
  radius: number
}

export type TutorialCardPlacement =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'bottom-dock'

export interface TutorialCardPosition {
  left: number
  top: number
  placement: TutorialCardPlacement
}

export interface LogicalTutorialRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TutorialSize {
  width: number
  height: number
}

const VIEWPORT_MARGIN = 16
const TARGET_GAP = 24

export function logicalRectToViewport(
  canvasRect: TutorialRect,
  logicalRect: LogicalTutorialRect,
  logicalSize: TutorialSize,
): TutorialRect {
  const scaleX = logicalSize.width > 0
    ? canvasRect.width / logicalSize.width
    : 0
  const scaleY = logicalSize.height > 0
    ? canvasRect.height / logicalSize.height
    : 0

  return {
    left: canvasRect.left + logicalRect.x * scaleX,
    top: canvasRect.top + logicalRect.y * scaleY,
    width: logicalRect.width * scaleX,
    height: logicalRect.height * scaleY,
  }
}

export function unionTutorialRects(
  rects: readonly TutorialRect[],
): TutorialRect | null {
  if (rects.length === 0) return null

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.left + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height))
  return { left, top, width: right - left, height: bottom - top }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

function rectsOverlap(left: TutorialRect, right: TutorialRect): boolean {
  return (
    left.left < right.left + right.width &&
    left.left + left.width > right.left &&
    left.top < right.top + right.height &&
    left.top + left.height > right.top
  )
}

function candidateForPlacement(
  placement: Exclude<TutorialCardPlacement, 'bottom-dock'>,
  target: TutorialRect,
  cardSize: TutorialSize,
  viewport: TutorialSize,
): TutorialCardPosition {
  const centeredLeft = clamp(
    target.left + (target.width - cardSize.width) / 2,
    VIEWPORT_MARGIN,
    viewport.width - VIEWPORT_MARGIN - cardSize.width,
  )
  const centeredTop = clamp(
    target.top + (target.height - cardSize.height) / 2,
    VIEWPORT_MARGIN,
    viewport.height - VIEWPORT_MARGIN - cardSize.height,
  )

  switch (placement) {
    case 'top':
      return {
        left: centeredLeft,
        top: target.top - TARGET_GAP - cardSize.height,
        placement,
      }
    case 'right':
      return {
        left: target.left + target.width + TARGET_GAP,
        top: centeredTop,
        placement,
      }
    case 'left':
      return {
        left: target.left - TARGET_GAP - cardSize.width,
        top: centeredTop,
        placement,
      }
    case 'bottom':
      return {
        left: centeredLeft,
        top: target.top + target.height + TARGET_GAP,
        placement,
      }
  }
}

export function placeTutorialCard(
  target: TutorialRect,
  cardSize: TutorialSize,
  viewport: TutorialSize,
  preferredPlacement: Exclude<TutorialCardPlacement, 'bottom-dock'> = 'bottom',
): TutorialCardPosition {
  const defaultOrder = ['bottom', 'top', 'right', 'left'] as const
  const placements = [
    preferredPlacement,
    ...defaultOrder.filter((candidate) => candidate !== preferredPlacement),
  ]

  for (const placement of placements) {
    const candidate = candidateForPlacement(
      placement,
      target,
      cardSize,
      viewport,
    )
    const candidateRect = { ...candidate, ...cardSize }
    const inBounds =
      candidate.left >= VIEWPORT_MARGIN &&
      candidate.top >= VIEWPORT_MARGIN &&
      candidate.left + cardSize.width <= viewport.width - VIEWPORT_MARGIN &&
      candidate.top + cardSize.height <= viewport.height - VIEWPORT_MARGIN
    if (inBounds && !rectsOverlap(candidateRect, target)) return candidate
  }

  return {
    left: clamp(
      (viewport.width - cardSize.width) / 2,
      VIEWPORT_MARGIN,
      viewport.width - VIEWPORT_MARGIN - cardSize.width,
    ),
    top: clamp(
      viewport.height - VIEWPORT_MARGIN - cardSize.height,
      VIEWPORT_MARGIN,
      viewport.height - VIEWPORT_MARGIN - cardSize.height,
    ),
    placement: 'bottom-dock',
  }
}
