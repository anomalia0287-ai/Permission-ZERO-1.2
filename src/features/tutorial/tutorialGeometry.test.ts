import { describe, expect, it } from 'vitest'

import {
  logicalRectToViewport,
  placeTutorialCard,
  unionTutorialRects,
  type TutorialRect,
} from './tutorialGeometry'

function overlaps(left: TutorialRect, right: TutorialRect): boolean {
  return (
    left.left < right.left + right.width &&
    left.left + left.width > right.left &&
    left.top < right.top + right.height &&
    left.top + left.height > right.top
  )
}

describe('tutorial geometry', () => {
  it('projects logical field rectangles into viewport coordinates', () => {
    expect(logicalRectToViewport(
      { left: 100, top: 50, width: 1000, height: 480 },
      { x: 20, y: 12, width: 10, height: 6 },
      { width: 50, height: 24 },
    )).toEqual({ left: 500, top: 290, width: 200, height: 120 })
  })

  it('unions separated spotlight targets without losing their gap', () => {
    expect(unionTutorialRects([
      { left: 1200, top: 80, width: 120, height: 170 },
      { left: 1200, top: 420, width: 120, height: 68 },
    ])).toEqual({ left: 1200, top: 80, width: 120, height: 408 })
    expect(unionTutorialRects([])).toBeNull()
  })

  it('places the card inside the viewport without covering its target', () => {
    const target = { left: 480, top: 260, width: 200, height: 120 }
    const cardSize = { width: 280, height: 132 }
    const viewport = { width: 1280, height: 720 }
    const placed = placeTutorialCard(target, cardSize, viewport, 'bottom')
    const card = { left: placed.left, top: placed.top, ...cardSize }

    expect(placed.placement).toBe('bottom')
    expect(card.left).toBeGreaterThanOrEqual(16)
    expect(card.top).toBeGreaterThanOrEqual(16)
    expect(card.left + card.width).toBeLessThanOrEqual(viewport.width - 16)
    expect(card.top + card.height).toBeLessThanOrEqual(viewport.height - 16)
    expect(overlaps(card, target)).toBe(false)
  })

  it('tries another side before using a bounded bottom dock fallback', () => {
    expect(placeTutorialCard(
      { left: 500, top: 620, width: 160, height: 80 },
      { width: 300, height: 120 },
      { width: 1280, height: 720 },
      'bottom',
    ).placement).toBe('top')

    const fallback = placeTutorialCard(
      { left: 0, top: 0, width: 1280, height: 650 },
      { width: 300, height: 120 },
      { width: 1280, height: 720 },
      'bottom',
    )
    expect(fallback).toEqual({
      left: 490,
      top: 584,
      placement: 'bottom-dock',
    })
  })
})
