import { describe, expect, it, vi } from 'vitest'

import * as campaignRng from '../../game/rng'
import {
  RESOURCE_COLLISION_PASSES,
  RESOURCE_COLLISION_RESPONSE_SPEED,
  RESOURCE_FIXED_STEP_SECONDS,
  RESOURCE_MAX_FRAME_SECONDS,
  RESOURCE_MAX_SPEED,
  RESOURCE_MAX_STEPS_PER_FRAME,
  RESOURCE_RESTITUTION,
  RESOURCE_WALL_RESTITUTION,
  ResourceMotionController,
  createResourceBodies,
  dragResourceBody,
  nearestResourceInDirection,
  stableResourceLayout,
  stepResourceBodies,
  type ResourceBody,
  type ResourceFieldBounds,
  type ResourceFieldObstacle,
} from './resourceFieldPhysics'

const EMPTY_OBSTACLES: readonly ResourceFieldObstacle[] = []

function makeBody(
  id: string,
  overrides: Partial<Omit<ResourceBody, 'id'>> = {},
): ResourceBody {
  return {
    id,
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    radius: 10,
    mode: 'free',
    ...overrides,
  }
}

function makeBodies(...bodies: ResourceBody[]): Map<string, ResourceBody> {
  return new Map(bodies.map((body) => [body.id, body]))
}

function distance(left: ResourceBody, right: ResourceBody): number {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function expectBodyInsideBounds(
  body: ResourceBody,
  bounds: ResourceFieldBounds,
): void {
  expect(Number.isFinite(body.x)).toBe(true)
  expect(Number.isFinite(body.y)).toBe(true)
  expect(Number.isFinite(body.vx)).toBe(true)
  expect(Number.isFinite(body.vy)).toBe(true)
  expect(body.x).toBeGreaterThanOrEqual(body.radius - 1e-9)
  expect(body.x).toBeLessThanOrEqual(bounds.width - body.radius + 1e-9)
  expect(body.y).toBeGreaterThanOrEqual(body.radius - 1e-9)
  expect(body.y).toBeLessThanOrEqual(bounds.height - body.radius + 1e-9)
  expect(Math.hypot(body.vx, body.vy)).toBeLessThanOrEqual(
    RESOURCE_MAX_SPEED + 1e-9,
  )
}

function expectBodyOutsideObstacle(
  body: ResourceBody,
  obstacle: ResourceFieldObstacle,
): void {
  const closestX = Math.max(obstacle.left, Math.min(body.x, obstacle.right))
  const closestY = Math.max(obstacle.top, Math.min(body.y, obstacle.bottom))
  const separation = Math.hypot(body.x - closestX, body.y - closestY)
  expect(separation).toBeGreaterThanOrEqual(body.radius - 0.01)
}

function expectNonOverlapping(bodies: ReadonlyMap<string, ResourceBody>): void {
  const values = [...bodies.values()]
  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < values.length;
      rightIndex += 1
    ) {
      const left = values[leftIndex]
      const right = values[rightIndex]
      expect(distance(left, right)).toBeGreaterThanOrEqual(
        left.radius + right.radius - 0.01,
      )
    }
  }
}

function prepareSupportedFieldForWallAdjacentDrag(): {
  controller: ResourceMotionController
  ids: string[]
} {
  const ids = Array.from(
    { length: 54 },
    (_, index) => `body-${String(index).padStart(2, '0')}`,
  )
  const controller = new ResourceMotionController({
    ids,
    bounds: { width: 960, height: 620 },
    radius: 10,
  })
  expect(controller.beginDrag('body-00')).toBe(true)
  expect(controller.dragTo('body-00', { x: 15, y: 50 })).toBe(true)
  expect(controller.endDrag('body-00')).toBe(true)
  expect(controller.beginDrag('body-01')).toBe(true)
  return { controller, ids }
}

describe('resource field physics constants', () => {
  it('exposes the approved bounded fixed-step configuration', () => {
    expect(RESOURCE_FIXED_STEP_SECONDS).toBe(1 / 60)
    expect(RESOURCE_MAX_FRAME_SECONDS).toBe(0.1)
    expect(RESOURCE_MAX_STEPS_PER_FRAME).toBe(6)
    expect(RESOURCE_COLLISION_PASSES).toBe(2)
    expect(RESOURCE_RESTITUTION).toBe(0.92)
    expect(RESOURCE_WALL_RESTITUTION).toBe(1)
    expect(RESOURCE_MAX_SPEED).toBe(72)
  })
})

describe('deterministic resource body initialization', () => {
  it('is stable by ID across repeated creation and reordered or duplicate inputs without RNG', () => {
    const random01Spy = vi.spyOn(campaignRng, 'random01')
    const mathRandomSpy = vi.spyOn(Math, 'random')
    const ids = ['memory-2', 'reasoning-1', 'fluency-3', 'memory-1']
    const bounds = { width: 640, height: 420 }
    const obstacles = [
      {
        id: 'reserve-pocket',
        left: 480,
        top: 20,
        right: 620,
        bottom: 150,
      },
    ] as const

    const first = createResourceBodies(ids, bounds, 12, obstacles)
    const repeated = createResourceBodies(ids, bounds, 12, obstacles)
    const reordered = createResourceBodies(
      ['memory-1', 'fluency-3', 'reasoning-1', 'memory-2', 'memory-1'],
      bounds,
      12,
      obstacles,
    )

    expect(first).toEqual(repeated)
    expect(reordered.size).toBe(ids.length)
    for (const id of ids) {
      expect(reordered.get(id)).toEqual(first.get(id))
    }
    expect([...first.values()].some((body) => Math.hypot(body.vx, body.vy) > 0)).toBe(
      true,
    )
    for (const body of first.values()) {
      expectBodyInsideBounds(body, bounds)
      expectBodyOutsideObstacle(body, obstacles[0])
    }
    expect(random01Spy).not.toHaveBeenCalled()
    expect(mathRandomSpy).not.toHaveBeenCalled()

    random01Spy.mockRestore()
    mathRandomSpy.mockRestore()
  })

  it('adapts deterministically to changed bounds while keeping every value finite and valid', () => {
    const ids = ['one', 'two', 'three', 'four', 'five', 'six']
    const wide = createResourceBodies(ids, { width: 520, height: 260 }, 11)
    const tall = createResourceBodies(ids, { width: 260, height: 520 }, 11)

    expect(tall).not.toEqual(wide)
    for (const body of tall.values()) {
      expectBodyInsideBounds(body, { width: 260, height: 520 })
    }
  })

  it('uses the available stage footprint instead of packing a large field into the center', () => {
    const ids = Array.from({ length: 48 }, (_, index) => `stage-${index}`)
    const bodies = createResourceBodies(ids, { width: 840, height: 700 }, 16)
    const positions = [...bodies.values()]
    const xs = positions.map(({ x }) => x)
    const ys = positions.map(({ y }) => y)

    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(500)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(400)
    expectNonOverlapping(bodies)
  })

  it('starts every live display body at a clearly visible speed and keeps one body bouncing', () => {
    const bounds = { width: 96, height: 64 }
    let bodies = createResourceBodies(['visible-motion'], bounds, 10)
    const initial = bodies.get('visible-motion')!
    expect(Math.hypot(initial.vx, initial.vy)).toBeGreaterThanOrEqual(48)

    let directionChanges = 0
    let previousVx = initial.vx
    let previousVy = initial.vy
    for (let frame = 0; frame < 600; frame += 1) {
      bodies = stepResourceBodies(
        bodies,
        bounds,
        EMPTY_OBSTACLES,
        RESOURCE_FIXED_STEP_SECONDS,
      )
      const body = bodies.get('visible-motion')!
      if (Math.sign(body.vx) !== Math.sign(previousVx)) directionChanges += 1
      if (Math.sign(body.vy) !== Math.sign(previousVy)) directionChanges += 1
      previousVx = body.vx
      previousVy = body.vy
    }

    const final = bodies.get('visible-motion')!
    expect(directionChanges).toBeGreaterThanOrEqual(6)
    expect(Math.hypot(final.vx, final.vy)).toBeCloseTo(
      Math.hypot(initial.vx, initial.vy),
      8,
    )
  })

  it('lays out the supported 54-body company field and 18-body pocket without overlap', () => {
    const companyIds = Array.from({ length: 54 }, (_, index) => `company-${index}`)
    const reserveIds = Array.from({ length: 18 }, (_, index) => `reserve-${index}`)
    const companyBounds = { width: 960, height: 620 }
    const companyObstacles = [
      { id: 'pocket', left: 760, top: 20, right: 940, bottom: 190 },
      { id: 'tray', left: 250, top: 500, right: 710, bottom: 600 },
    ] as const
    const reserveBounds = { width: 360, height: 220 }

    const company = createResourceBodies(companyIds, companyBounds, 12, companyObstacles)
    const reserve = createResourceBodies(reserveIds, reserveBounds, 10)

    expect(company.size).toBe(54)
    expect(reserve.size).toBe(18)
    expectNonOverlapping(company)
    expectNonOverlapping(reserve)
    for (const body of company.values()) {
      expectBodyInsideBounds(body, companyBounds)
      for (const obstacle of companyObstacles) {
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
    for (const body of reserve.values()) {
      expectBodyInsideBounds(body, reserveBounds)
    }
  })

  it('rejects invalid or physically impossible numeric geometry explicitly', () => {
    expect(() => createResourceBodies(['a'], { width: Number.NaN, height: 100 }, 10)).toThrow(
      RangeError,
    )
    expect(() => createResourceBodies(['a'], { width: 100, height: 0 }, 10)).toThrow(
      RangeError,
    )
    expect(() => createResourceBodies(['a'], { width: 100, height: 100 }, 0)).toThrow(
      RangeError,
    )
    expect(() =>
      createResourceBodies(['a'], { width: 100, height: 100 }, 10, [
        { id: 'bad', left: 20, top: 20, right: 10, bottom: 40 },
      ]),
    ).toThrow(RangeError)
    expect(() =>
      stableResourceLayout(['a', 'b'], { width: 20, height: 20 }, 10),
    ).toThrow(RangeError)
  })
})

describe('fixed-step collisions and boundaries', () => {
  it('separates overlapping free bodies, including an exact zero-distance pair, deterministically', () => {
    const bounds = { width: 300, height: 220 }
    const firstInput = makeBodies(makeBody('alpha'), makeBody('beta'))
    const reversedInput = makeBodies(makeBody('beta'), makeBody('alpha'))

    const first = stepResourceBodies(firstInput, bounds, EMPTY_OBSTACLES, 0)
    const reversed = stepResourceBodies(reversedInput, bounds, EMPTY_OBSTACLES, 0)

    expect(distance(first.get('alpha')!, first.get('beta')!)).toBeGreaterThanOrEqual(19.99)
    expect(reversed.get('alpha')).toEqual(first.get('alpha'))
    expect(reversed.get('beta')).toEqual(first.get('beta'))
    expect(firstInput.get('alpha')).toEqual(makeBody('alpha'))
    expect(firstInput.get('beta')).toEqual(makeBody('beta'))
  })

  it('exchanges equal-mass head-on normal velocity with approved restitution', () => {
    const result = stepResourceBodies(
      makeBodies(
        makeBody('left', { x: 90, vx: 10, vy: 3 }),
        makeBody('right', { x: 110, vx: -10, vy: -2 }),
      ),
      { width: 300, height: 200 },
      EMPTY_OBSTACLES,
      0,
    )

    expect(result.get('left')!.vx).toBeCloseTo(-9.2, 8)
    expect(result.get('right')!.vx).toBeCloseTo(9.2, 8)
    expect(result.get('left')!.vy).toBe(3)
    expect(result.get('right')!.vy).toBe(-2)
  })

  it('fully separates the exact three-body all-free chain after the approved two passes', () => {
    const bounds = { width: 200, height: 100 }
    const input = makeBodies(
      makeBody('a', { x: 30, y: 50, vx: 42, vy: 0 }),
      makeBody('b', { x: 50, y: 50, vx: 0, vy: 0 }),
      makeBody('c', { x: 70, y: 50, vx: -42, vy: 0 }),
    )
    const result = stepResourceBodies(
      input,
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )

    expectNonOverlapping(result)
    expect(result.get('a')!.vx).toBeLessThan(0)
    expect(result.get('c')!.vx).toBeGreaterThan(0)
    for (const body of result.values()) {
      expectBodyInsideBounds(body, bounds)
      expect(body.x).toBe(input.get(body.id)!.x)
      expect(body.y).toBe(input.get(body.id)!.y)
    }

    const next = stepResourceBodies(result, bounds, EMPTY_OBSTACLES, 1 / 60)
    expectNonOverlapping(next)
    expect(next.get('a')!.x).toBeLessThan(result.get('a')!.x)
    expect(next.get('c')!.x).toBeGreaterThan(result.get('c')!.x)
  })

  it('finalizes the same all-free chain symmetrically when stable ID order opposes spatial order', () => {
    const bounds = { width: 200, height: 100 }
    const forward = stepResourceBodies(
      makeBodies(
        makeBody('a', { x: 30, y: 50, vx: 42, vy: 0 }),
        makeBody('b', { x: 50, y: 50, vx: 0, vy: 0 }),
        makeBody('c', { x: 70, y: 50, vx: -42, vy: 0 }),
      ),
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )
    const mirrored = stepResourceBodies(
      makeBodies(
        makeBody('a', { x: 170, y: 50, vx: -42, vy: 0 }),
        makeBody('b', { x: 150, y: 50, vx: 0, vy: 0 }),
        makeBody('c', { x: 130, y: 50, vx: 42, vy: 0 }),
      ),
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )

    expectNonOverlapping(forward)
    expectNonOverlapping(mirrored)
    for (const id of ['a', 'b', 'c']) {
      expect(mirrored.get(id)!.x).toBeCloseTo(bounds.width - forward.get(id)!.x, 10)
      expect(mirrored.get(id)!.y).toBeCloseTo(forward.get(id)!.y, 10)
      expect(mirrored.get(id)!.vx).toBeCloseTo(-forward.get(id)!.vx, 10)
      expect(mirrored.get(id)!.vy).toBeCloseTo(forward.get(id)!.vy, 10)
    }
  })

  it('finalizes a four-body all-free chain deterministically without rolling back unrelated motion', () => {
    const bounds = { width: 240, height: 100 }
    const bodies = [
      makeBody('a', { x: 30, y: 50, vx: 42, vy: 0 }),
      makeBody('b', { x: 50, y: 50, vx: 0, vy: 0 }),
      makeBody('c', { x: 70, y: 50, vx: 0, vy: 0 }),
      makeBody('d', { x: 90, y: 50, vx: -42, vy: 0 }),
      makeBody('z-unrelated', { x: 210, y: 50, vx: 6, vy: 0 }),
    ]
    const forward = stepResourceBodies(
      makeBodies(...bodies),
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )
    const reversed = stepResourceBodies(
      makeBodies(...[...bodies].reverse()),
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )

    expectNonOverlapping(forward)
    expect(reversed).toEqual(forward)
    expect(forward.get('z-unrelated')).toEqual({
      ...bodies[4],
      x: bodies[4].x + 6 / 60,
    })
  })

  it.each([
    {
      label: 'stable IDs follow spatial order',
      bodies: [
        makeBody('a', { x: 30, y: 50, vx: 42, vy: 0 }),
        makeBody('b', { x: 50, y: 50, vx: 0, vy: 0 }),
        makeBody('c', { x: 70, y: 50, vx: -42, vy: 0 }),
        makeBody('d', { x: 90.3, y: 50, vx: -20, vy: 0 }),
      ],
    },
    {
      label: 'stable IDs oppose mirrored spatial order',
      bodies: [
        makeBody('a', { x: 170, y: 50, vx: -42, vy: 0 }),
        makeBody('b', { x: 150, y: 50, vx: 0, vy: 0 }),
        makeBody('c', { x: 130, y: 50, vx: 42, vy: 0 }),
        makeBody('d', { x: 109.7, y: 50, vx: 20, vy: 0 }),
      ],
    },
  ])('keeps a component rollback pair-safe when $label', ({ bodies }) => {
    const bounds = { width: 200, height: 100 }
    const forward = stepResourceBodies(
      makeBodies(...bodies),
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )
    const reversed = stepResourceBodies(
      makeBodies(...[...bodies].reverse()),
      bounds,
      EMPTY_OBSTACLES,
      1 / 60,
    )

    expect(reversed).toEqual(forward)
    expectNonOverlapping(forward)
    const spatialOrder = [...forward.values()].sort((left, right) => left.x - right.x)
    for (let index = 1; index < spatialOrder.length; index += 1) {
      expect(distance(spatialOrder[index - 1], spatialOrder[index])).toBeGreaterThanOrEqual(
        19.999,
      )
    }
    for (const body of forward.values()) {
      expectBodyInsideBounds(body, bounds)
    }
  })

  it('closes rollback safety across a longer cascade and a near external body', () => {
    const bounds = { width: 300, height: 200 }
    const input = makeBodies(
      makeBody('a', { x: 50, y: 100, vx: -21, vy: 0 }),
      makeBody('b', { x: 70, y: 100, vx: -21, vy: 0 }),
      makeBody('c', { x: 90, y: 100, vx: -21, vy: 0 }),
      makeBody('d', { x: 110, y: 100, vx: -42, vy: 0 }),
      makeBody('e', { x: 130, y: 100, vx: -42, vy: 0 }),
      makeBody('z-near', { x: 150.14, y: 100, vx: -42, vy: 0 }),
    )

    const result = stepResourceBodies(input, bounds, EMPTY_OBSTACLES, 1 / 60)

    expectNonOverlapping(result)
    expect(distance(result.get('e')!, result.get('z-near')!)).toBeGreaterThanOrEqual(
      19.999,
    )
    for (const body of result.values()) {
      expectBodyInsideBounds(body, bounds)
    }
  })

  it('advances a five-body tangent chain on the frame after at most one safe rollback', () => {
    const bounds = { width: 140, height: 100 }
    const ids = ['a', 'b', 'c', 'd', 'e']
    const velocities = [-21, -21, -21, -42, -42]
    const input = makeBodies(
      ...ids.map((id, index) =>
        makeBody(id, {
          x: 30 + index * 20,
          y: 50,
          vx: velocities[index],
          vy: 0,
        }),
      ),
    )

    const first = stepResourceBodies(input, bounds, EMPTY_OBSTACLES, 1 / 60)
    const second = stepResourceBodies(first, bounds, EMPTY_OBSTACLES, 1 / 60)

    expectNonOverlapping(first)
    expectNonOverlapping(second)
    expect(
      ids.some((id) => {
        const before = first.get(id)!
        const after = second.get(id)!
        return before.x !== after.x || before.y !== after.y
      }),
    ).toBe(true)
    for (let index = 1; index < ids.length; index += 1) {
      expect(distance(second.get(ids[index - 1])!, second.get(ids[index])!)).toBeGreaterThanOrEqual(
        distance(first.get(ids[index - 1])!, first.get(ids[index])!) - 1e-9,
      )
    }
    for (const frame of [first, second]) {
      for (const body of frame.values()) {
        expectBodyInsideBounds(body, bounds)
      }
    }
  })

  it('keeps a remote tangent component and isolated body unchanged when another component rolls back', () => {
    const bounds = { width: 500, height: 200 }
    const chainIds = ['a', 'b', 'c', 'd', 'e']
    const velocities = [-21, -21, -21, -42, -42]
    const input = makeBodies(
      ...chainIds.map((id, index) =>
        makeBody(id, {
          x: 30 + index * 20,
          y: 50,
          vx: velocities[index],
          vy: 0,
        }),
      ),
      makeBody('u', { x: 300, y: 150 }),
      makeBody('v', { x: 320, y: 150 }),
      makeBody('z', { x: 450, y: 100 }),
    )

    const first = stepResourceBodies(input, bounds, EMPTY_OBSTACLES, 1 / 60)
    const second = stepResourceBodies(first, bounds, EMPTY_OBSTACLES, 1 / 60)

    expectNonOverlapping(first)
    expectNonOverlapping(second)
    for (const id of ['u', 'v', 'z']) {
      expect(first.get(id)).toEqual(input.get(id))
      expect(second.get(id)).toEqual(input.get(id))
    }
    expect(
      chainIds.some((id) => {
        const before = first.get(id)!
        const after = second.get(id)!
        return before.x !== after.x || before.y !== after.y
      }),
    ).toBe(true)
    for (const frame of [first, second]) {
      for (const body of frame.values()) {
        expectBodyInsideBounds(body, bounds)
      }
    }
  })

  it('advances only the feasible cascade component beside an obstacle without stalling unrelated motion', () => {
    const bounds = { width: 220, height: 200 }
    const obstacle = { id: 'block', left: 60.1, top: 40, right: 100.1, bottom: 160 }
    const chainIds = ['a', 'b', 'c']
    const input = makeBodies(
      makeBody('a', { x: 10, y: 100, vx: 42, vy: 0 }),
      makeBody('b', { x: 30, y: 100, vx: 42, vy: 0 }),
      makeBody('c', { x: 50, y: 100, vx: 42, vy: 0 }),
      makeBody('z', { x: 150, y: 20, vx: 6, vy: 0 }),
    )

    const first = stepResourceBodies(input, bounds, [obstacle], 1 / 60)
    const second = stepResourceBodies(first, bounds, [obstacle], 1 / 60)

    expectNonOverlapping(first)
    expectNonOverlapping(second)
    expect(first.get('z')!.x).toBeCloseTo(150 + 6 / 60, 10)
    expect(second.get('z')!.x).toBeCloseTo(150 + 12 / 60, 10)
    expect(first.get('z')!.vx).toBe(6)
    expect(second.get('z')!.vx).toBe(6)
    expect(
      chainIds.some((id) => {
        const before = first.get(id)!
        const after = second.get(id)!
        return before.x !== after.x || before.y !== after.y
      }),
    ).toBe(true)
    for (const frame of [first, second]) {
      for (const body of frame.values()) {
        expectBodyInsideBounds(body, bounds)
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
    for (const [before, after] of [
      [input, first],
      [first, second],
    ] as const) {
      for (const [id, body] of after) {
        const prior = before.get(id)!
        expect(Math.hypot(body.x - prior.x, body.y - prior.y)).toBeLessThanOrEqual(
          RESOURCE_MAX_SPEED / 60 + 1e-9,
        )
      }
    }
  })

  it('expands away from an exact obstacle tangent while unrelated motion continues', () => {
    const bounds = { width: 240, height: 200 }
    const obstacle = { id: 'block', left: 80, top: 40, right: 120, bottom: 160 }
    const chainIds = ['a', 'b', 'c']
    const input = makeBodies(
      makeBody('a', { x: 30, y: 100, vx: 42, vy: 0 }),
      makeBody('b', { x: 50, y: 100, vx: 42, vy: 0 }),
      makeBody('c', { x: 70, y: 100, vx: 42, vy: 0 }),
      makeBody('z', { x: 170, y: 20, vx: 6, vy: 0 }),
    )
    const frames: Map<string, ResourceBody>[] = []
    let frame = input

    for (let step = 0; step < 5; step += 1) {
      frame = stepResourceBodies(frame, bounds, [obstacle], 1 / 60)
      frames.push(frame)
    }

    expect(frames[0].get('a')!.vx).toBeCloseTo(-42, 10)
    expect(frames[0].get('b')!.vx).toBeCloseTo(-21, 10)
    expect(frames[0].get('c')!.vx).toBe(0)
    expect(
      chainIds.some((id) => {
        const before = frames[0].get(id)!
        const after = frames[1].get(id)!
        return before.x !== after.x || before.y !== after.y
      }),
    ).toBe(true)
    for (let index = 0; index < frames.length; index += 1) {
      const current = frames[index]
      expectNonOverlapping(current)
      expect(current.get('z')!.x).toBeCloseTo(170 + ((index + 1) * 6) / 60, 10)
      expect(current.get('z')!.vx).toBe(6)
      for (const body of current.values()) {
        expectBodyInsideBounds(body, bounds)
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
  })

  it.each([
    {
      label: 'the obstacle is on the right',
      obstacle: { id: 'block', left: 60, top: 40, right: 100, bottom: 160 },
      chain: [
        makeBody('a', { x: 10, y: 100, vx: 42, vy: 0 }),
        makeBody('b', { x: 30, y: 100, vx: 42, vy: 0 }),
        makeBody('c', { x: 50, y: 100, vx: 42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 180, y: 20, vx: 6, vy: 0 }),
    },
    {
      label: 'the geometry is mirrored with stable IDs in reverse spatial order',
      obstacle: { id: 'block', left: 120, top: 40, right: 160, bottom: 160 },
      chain: [
        makeBody('a', { x: 210, y: 100, vx: -42, vy: 0 }),
        makeBody('b', { x: 190, y: 100, vx: -42, vy: 0 }),
        makeBody('c', { x: 170, y: 100, vx: -42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 40, y: 20, vx: -6, vy: 0 }),
    },
  ])('uses a safe rigid tangent fallback when $label', ({ obstacle, chain, unrelated }) => {
    const bounds = { width: 220, height: 200 }
    const chainIds = ['a', 'b', 'c']
    const input = makeBodies(...chain, unrelated)
    const frames: Map<string, ResourceBody>[] = []
    let frame = input

    for (let step = 0; step < 5; step += 1) {
      frame = stepResourceBodies(frame, bounds, [obstacle], 1 / 60)
      frames.push(frame)
    }

    for (const id of chainIds) {
      expect(frames[0].get(id)!.x).toBe(input.get(id)!.x)
      expect(frames[0].get(id)!.y).toBe(input.get(id)!.y)
      expect(frames[0].get(id)!.vx).toBe(0)
      expect(frames[0].get(id)!.vy).toBe(-42)
      expect(frames[1].get(id)!.y).toBeCloseTo(99.3, 10)
    }
    for (let index = 0; index < frames.length; index += 1) {
      const current = frames[index]
      expectNonOverlapping(current)
      expect(distance(current.get('a')!, current.get('b')!)).toBeCloseTo(20, 10)
      expect(distance(current.get('b')!, current.get('c')!)).toBeCloseTo(20, 10)
      expect(current.get('z')!.x).toBeCloseTo(
        unrelated.x + ((index + 1) * unrelated.vx) / 60,
        10,
      )
      expect(current.get('z')!.vx).toBe(unrelated.vx)
      for (const body of current.values()) {
        expectBodyInsideBounds(body, bounds)
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
  })

  it.each([
    {
      label: 'the obstacle is on the right',
      obstacle: { id: 'block', left: 60, top: 0, right: 100, bottom: 21.2 },
      chain: [
        makeBody('a', { x: 10, y: 10.6, vx: 42, vy: 0 }),
        makeBody('b', { x: 30, y: 10.6, vx: 42, vy: 0 }),
        makeBody('c', { x: 50, y: 10.6, vx: 42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 180, y: 10.6, vx: 6, vy: 0 }),
    },
    {
      label: 'the geometry is mirrored with stable IDs in reverse spatial order',
      obstacle: { id: 'block', left: 120, top: 0, right: 160, bottom: 21.2 },
      chain: [
        makeBody('a', { x: 210, y: 10.6, vx: -42, vy: 0 }),
        makeBody('b', { x: 190, y: 10.6, vx: -42, vy: 0 }),
        makeBody('c', { x: 170, y: 10.6, vx: -42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 40, y: 10.6, vx: -6, vy: 0 }),
    },
  ])('halves a rigid tangent fallback to fit a near-jammed corridor when $label', ({ obstacle, chain, unrelated }) => {
    const bounds = { width: 220, height: 21.2 }
    const chainIds = ['a', 'b', 'c']
    const input = makeBodies(...chain, unrelated)
    const frames: Map<string, ResourceBody>[] = []
    let frame = input

    for (let step = 0; step < 5; step += 1) {
      frame = stepResourceBodies(frame, bounds, [obstacle], 1 / 60)
      frames.push(frame)
    }

    for (const id of chainIds) {
      expect(frames[0].get(id)!.x).toBe(input.get(id)!.x)
      expect(frames[0].get(id)!.y).toBe(input.get(id)!.y)
      expect(frames[0].get(id)!.vx).toBe(0)
      expect(frames[0].get(id)!.vy).toBe(-21)
      expect(frames[1].get(id)!.y).toBeCloseTo(10.25, 10)
    }
    for (let index = 0; index < frames.length; index += 1) {
      const current = frames[index]
      expectNonOverlapping(current)
      expect(distance(current.get('a')!, current.get('b')!)).toBeCloseTo(20, 10)
      expect(distance(current.get('b')!, current.get('c')!)).toBeCloseTo(20, 10)
      expect(current.get('z')!.x).toBeCloseTo(
        unrelated.x + ((index + 1) * unrelated.vx) / 60,
        10,
      )
      expect(current.get('z')!.vx).toBe(unrelated.vx)
      for (const body of current.values()) {
        expectBodyInsideBounds(body, bounds)
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
  })

  it.each([
    {
      label: 'the obstacle is on the right',
      obstacle: { id: 'block', left: 60, top: 0, right: 100, bottom: 20.0002 },
      chain: [
        makeBody('a', { x: 10, y: 10.0001, vx: 42, vy: 0 }),
        makeBody('b', { x: 30, y: 10.0001, vx: 42, vy: 0 }),
        makeBody('c', { x: 50, y: 10.0001, vx: 42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 180, y: 10.0001, vx: 6, vy: 0 }),
    },
    {
      label: 'the geometry is mirrored with stable IDs in reverse spatial order',
      obstacle: { id: 'block', left: 120, top: 0, right: 160, bottom: 20.0002 },
      chain: [
        makeBody('a', { x: 210, y: 10.0001, vx: -42, vy: 0 }),
        makeBody('b', { x: 190, y: 10.0001, vx: -42, vy: 0 }),
        makeBody('c', { x: 170, y: 10.0001, vx: -42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 40, y: 10.0001, vx: -6, vy: 0 }),
    },
  ])(
    'searches below a fixed halving floor for representable rigid progress when $label',
    ({ obstacle, chain, unrelated }) => {
      const bounds = { width: 220, height: 20.0002 }
      const input = makeBodies(...chain, unrelated)
      const frames: Map<string, ResourceBody>[] = []
      let frame = input

      for (let step = 0; step < 5; step += 1) {
        frame = stepResourceBodies(frame, bounds, [obstacle], 1 / 60)
        frames.push(frame)
      }

      for (const id of ['a', 'b', 'c']) {
        expect(frames[0].get(id)!.x).toBe(input.get(id)!.x)
        expect(frames[0].get(id)!.y).toBe(input.get(id)!.y)
        expect(frames[0].get(id)!.vx).toBe(0)
        expect(frames[0].get(id)!.vy).toBeLessThan(0)
        expect(frames[1].get(id)!.x).toBe(input.get(id)!.x)
        expect(frames[1].get(id)!.y).toBeLessThan(input.get(id)!.y)
      }
      for (let index = 0; index < frames.length; index += 1) {
        const current = frames[index]
        expectNonOverlapping(current)
        expect(distance(current.get('a')!, current.get('b')!)).toBeCloseTo(20, 10)
        expect(distance(current.get('b')!, current.get('c')!)).toBeCloseTo(20, 10)
        expect(current.get('z')!.x).toBeCloseTo(
          unrelated.x + ((index + 1) * unrelated.vx) / 60,
          10,
        )
        expect(current.get('z')!.vx).toBe(unrelated.vx)
        for (const body of current.values()) {
          expectBodyInsideBounds(body, bounds)
          expectBodyOutsideObstacle(body, obstacle)
        }
      }
    },
  )

  it('uses a stable diagonal rigid fallback when corner tangencies block every cardinal direction', () => {
    const bounds = { width: 180, height: 200 }
    const obstacles = [
      {
        id: 'lower-left-corner',
        left: 36.42507074287455,
        top: 105.14495755427527,
        right: 41.42507074287455,
        bottom: 110.14495755427527,
      },
      {
        id: 'upper-right-corner',
        left: 95.14495755427527,
        top: 86.42507074287455,
        right: 100.14495755427527,
        bottom: 91.42507074287455,
      },
    ] as const
    const input = makeBodies(
      makeBody('a', { x: 50, y: 100, vx: 42, vy: 0 }),
      makeBody('b', { x: 70, y: 100, vx: 42, vy: 0 }),
      makeBody('c', { x: 90, y: 100, vx: 42, vy: 0 }),
      makeBody('z', { x: 150, y: 30, vx: 6, vy: 0 }),
    )
    const first = stepResourceBodies(input, bounds, obstacles, 1 / 60)
    const second = stepResourceBodies(first, bounds, obstacles, 1 / 60)
    const expectedDiagonalSpeed = RESOURCE_COLLISION_RESPONSE_SPEED * Math.SQRT1_2
    const expectedDiagonalStep = expectedDiagonalSpeed / 60

    for (const id of ['a', 'b', 'c']) {
      expect(first.get(id)!.x).toBe(input.get(id)!.x)
      expect(first.get(id)!.y).toBe(input.get(id)!.y)
      expect(first.get(id)!.vx).toBeCloseTo(expectedDiagonalSpeed, 10)
      expect(first.get(id)!.vy).toBeCloseTo(expectedDiagonalSpeed, 10)
      expect(second.get(id)!.x).toBeCloseTo(input.get(id)!.x + expectedDiagonalStep, 10)
      expect(second.get(id)!.y).toBeCloseTo(input.get(id)!.y + expectedDiagonalStep, 10)
    }
    for (const frame of [first, second]) {
      expectNonOverlapping(frame)
      expect(distance(frame.get('a')!, frame.get('b')!)).toBeCloseTo(20, 10)
      expect(distance(frame.get('b')!, frame.get('c')!)).toBeCloseTo(20, 10)
      for (const body of frame.values()) {
        expectBodyInsideBounds(body, bounds)
        for (const obstacle of obstacles) {
          expectBodyOutsideObstacle(body, obstacle)
        }
      }
    }
    expect(first.get('z')!.x).toBeCloseTo(150.1, 10)
    expect(second.get('z')!.x).toBeCloseTo(150.2, 10)
    expect(first.get('z')!.vx).toBe(6)
    expect(second.get('z')!.vx).toBe(6)
  })

  it.each([
    {
      label: 'the feasible cone points down and right',
      obstacles: [
        {
          id: 'left-corner',
          left: 39.26423563648954,
          top: 108.19152044288992,
          right: 44.26423563648954,
          bottom: 113.19152044288992,
        },
        {
          id: 'right-corner',
          left: 91.73648177666931,
          top: 85.15192246987792,
          right: 96.73648177666931,
          bottom: 90.15192246987792,
        },
      ],
      chain: [
        makeBody('a', { x: 50, y: 100, vx: 42, vy: 0 }),
        makeBody('b', { x: 70, y: 100, vx: 42, vy: 0 }),
        makeBody('c', { x: 90, y: 100, vx: 42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 150, y: 30, vx: 6, vy: 0 }),
      expectedVx: 38.80294036547404,
    },
    {
      label: 'the geometry is mirrored with stable IDs in reverse spatial order',
      obstacles: [
        {
          id: 'left-corner',
          left: 180 - 44.26423563648954,
          top: 108.19152044288992,
          right: 180 - 39.26423563648954,
          bottom: 113.19152044288992,
        },
        {
          id: 'right-corner',
          left: 83.26351822333069,
          top: 85.15192246987792,
          right: 88.26351822333069,
          bottom: 90.15192246987792,
        },
      ],
      chain: [
        makeBody('a', { x: 130, y: 100, vx: -42, vy: 0 }),
        makeBody('b', { x: 110, y: 100, vx: -42, vy: 0 }),
        makeBody('c', { x: 90, y: 100, vx: -42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 30, y: 30, vx: -6, vy: 0 }),
      expectedVx: -38.80294036547404,
    },
    {
      label: 'the only feasible directions lie between twenty and twenty-five degrees',
      obstacles: [
        {
          id: 'left-corner',
          left: 40.773817382593,
          top: 109.0630778703665,
          right: 45.773817382593,
          bottom: 114.0630778703665,
        },
        {
          id: 'right-corner',
          left: 93.4202014332567,
          top: 85.60307379214092,
          right: 98.4202014332567,
          bottom: 90.60307379214092,
        },
      ],
      chain: [
        makeBody('a', { x: 50, y: 100, vx: 42, vy: 0 }),
        makeBody('b', { x: 70, y: 100, vx: 42, vy: 0 }),
        makeBody('c', { x: 90, y: 100, vx: 42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 150, y: 30, vx: 6, vy: 0 }),
      expectedVx: 38.80294036547404,
    },
    {
      label: 'the five-degree feasible cone is mirrored horizontally',
      obstacles: [
        {
          id: 'left-corner',
          left: 134.226182617407,
          top: 109.0630778703665,
          right: 139.226182617407,
          bottom: 114.0630778703665,
        },
        {
          id: 'right-corner',
          left: 81.5797985667433,
          top: 85.60307379214092,
          right: 86.5797985667433,
          bottom: 90.60307379214092,
        },
      ],
      chain: [
        makeBody('a', { x: 130, y: 100, vx: -42, vy: 0 }),
        makeBody('b', { x: 110, y: 100, vx: -42, vy: 0 }),
        makeBody('c', { x: 90, y: 100, vx: -42, vy: 0 }),
      ],
      unrelated: makeBody('z', { x: 30, y: 30, vx: -6, vy: 0 }),
      expectedVx: -38.80294036547404,
    },
  ])(
    'derives a continuous rigid fallback inside a narrow feasible cone when $label',
    ({ obstacles, chain, unrelated, expectedVx }) => {
      const bounds = { width: 180, height: 200 }
      const input = makeBodies(...chain, unrelated)
      const frames: Map<string, ResourceBody>[] = []
      const expectedVy = 16.07270415933377
      let frame = input

      for (let step = 0; step < 5; step += 1) {
        frame = stepResourceBodies(frame, bounds, obstacles, 1 / 60)
        frames.push(frame)
      }

      for (const id of ['a', 'b', 'c']) {
        expect(frames[0].get(id)!.x).toBe(input.get(id)!.x)
        expect(frames[0].get(id)!.y).toBe(input.get(id)!.y)
        expect(frames[0].get(id)!.vx).toBeCloseTo(expectedVx, 10)
        expect(frames[0].get(id)!.vy).toBeCloseTo(expectedVy, 10)
        expect(frames[1].get(id)!.x).toBeCloseTo(input.get(id)!.x + expectedVx / 60, 10)
        expect(frames[1].get(id)!.y).toBeCloseTo(input.get(id)!.y + expectedVy / 60, 10)
      }
      for (let index = 0; index < frames.length; index += 1) {
        const current = frames[index]
        expectNonOverlapping(current)
        expect(distance(current.get('a')!, current.get('b')!)).toBeCloseTo(20, 10)
        expect(distance(current.get('b')!, current.get('c')!)).toBeCloseTo(20, 10)
        expect(current.get('z')!.x).toBeCloseTo(
          unrelated.x + ((index + 1) * unrelated.vx) / 60,
          10,
        )
        expect(current.get('z')!.vx).toBe(unrelated.vx)
        for (const body of current.values()) {
          expectBodyInsideBounds(body, bounds)
          for (const obstacle of obstacles) {
            expectBodyOutsideObstacle(body, obstacle)
          }
        }
      }
    },
  )

  it.each([
    {
      label: 'the rotated chain uses its original spatial order',
      obstacles: [
        {
          id: 'upper-left-corner',
          left: 236.7395597077923,
          right: 239.7395597077923,
          top: 218.80916168336228,
          bottom: 221.80916168336228,
        },
        {
          id: 'lower-right-corner',
          left: 260.2602762843849,
          right: 263.2602762843849,
          top: 278.1908980089826,
          bottom: 281.1908980089826,
        },
      ],
      chain: [
        makeBody('a', {
          x: 243.159761141049,
          y: 231.20608789122136,
          vx: 14.364501603797146,
          vy: 39.46721542843515,
        }),
        makeBody('b', {
          x: 250,
          y: 250,
          vx: 14.364501603797146,
          vy: 39.46721542843515,
        }),
        makeBody('c', {
          x: 256.840238858951,
          y: 268.7939121087786,
          vx: 14.364501603797146,
          vy: 39.46721542843515,
        }),
      ],
      unrelated: makeBody('z', { x: 450, y: 40, vx: 0, vy: 6 }),
      expectedVx: 39.46721542843515,
    },
    {
      label: 'the rotated chain is mirrored with stable IDs in reverse spatial order',
      obstacles: [
        {
          id: 'upper-left-corner',
          left: 500 - 239.7395597077923,
          right: 500 - 236.7395597077923,
          top: 218.80916168336228,
          bottom: 221.80916168336228,
        },
        {
          id: 'lower-right-corner',
          left: 500 - 263.2602762843849,
          right: 500 - 260.2602762843849,
          top: 278.1908980089826,
          bottom: 281.1908980089826,
        },
      ],
      chain: [
        makeBody('a', {
          x: 500 - 243.159761141049,
          y: 231.20608789122136,
          vx: -14.364501603797146,
          vy: 39.46721542843515,
        }),
        makeBody('b', {
          x: 250,
          y: 250,
          vx: -14.364501603797146,
          vy: 39.46721542843515,
        }),
        makeBody('c', {
          x: 500 - 256.840238858951,
          y: 268.7939121087786,
          vx: -14.364501603797146,
          vy: 39.46721542843515,
        }),
      ],
      unrelated: makeBody('z', { x: 50, y: 40, vx: 0, vy: 6 }),
      expectedVx: -39.46721542843515,
    },
  ])(
    'does not turn sub-epsilon pair penetration into a repeated positional rollback when $label',
    ({ obstacles, chain, unrelated, expectedVx }) => {
      const bounds = { width: 500, height: 500 }
      const input = makeBodies(...chain, unrelated)
      const frames: Map<string, ResourceBody>[] = []
      const expectedVy = -14.364501603797146
      let frame = input

      for (let step = 0; step < 5; step += 1) {
        frame = stepResourceBodies(frame, bounds, obstacles, 1 / 60)
        frames.push(frame)
      }

      for (const id of ['a', 'b', 'c']) {
        expect(frames[0].get(id)!.x).toBe(input.get(id)!.x)
        expect(frames[0].get(id)!.y).toBe(input.get(id)!.y)
        expect(frames[0].get(id)!.vx).toBeCloseTo(expectedVx, 10)
        expect(frames[0].get(id)!.vy).toBeCloseTo(expectedVy, 10)
        expect(frames[1].get(id)!.x).toBeCloseTo(input.get(id)!.x + expectedVx / 60, 10)
        expect(frames[1].get(id)!.y).toBeCloseTo(input.get(id)!.y + expectedVy / 60, 10)
        expect(frames[4].get(id)!.x).toBeCloseTo(
          input.get(id)!.x + (expectedVx * 4) / 60,
          10,
        )
        expect(frames[4].get(id)!.y).toBeCloseTo(
          input.get(id)!.y + (expectedVy * 4) / 60,
          10,
        )
      }
      for (let index = 0; index < frames.length; index += 1) {
        const current = frames[index]
        expectNonOverlapping(current)
        expect(distance(current.get('a')!, current.get('b')!)).toBeCloseTo(20, 10)
        expect(distance(current.get('b')!, current.get('c')!)).toBeCloseTo(20, 10)
        expect(current.get('z')!.x).toBe(unrelated.x)
        expect(current.get('z')!.y).toBeCloseTo(
          unrelated.y + ((index + 1) * unrelated.vy) / 60,
          10,
        )
        expect(current.get('z')!.vx).toBe(0)
        expect(current.get('z')!.vy).toBe(6)
        for (const body of current.values()) {
          expectBodyInsideBounds(body, bounds)
          for (const obstacle of obstacles) {
            expectBodyOutsideObstacle(body, obstacle)
          }
        }
      }
    },
  )

  it.each([
    {
      label: 'the chain touches the left wall',
      chain: [
        makeBody('a', { x: 10, y: 100, vx: 42, vy: 0 }),
        makeBody('b', { x: 30, y: 100, vx: 42, vy: 0 }),
        makeBody('c', { x: 50, y: 100, vx: 42, vy: 0 }),
      ],
      obstacles: [
        {
          id: 'upper-opposing-corner',
          left: 60,
          right: 61,
          top: 98.999999996,
          bottom: 99.999999996,
        },
        {
          id: 'lower-opposing-corner',
          left: 60,
          right: 61,
          top: 100.000000004,
          bottom: 101.000000004,
        },
      ],
    },
    {
      label: 'the geometry is mirrored against the right wall',
      chain: [
        makeBody('a', { x: 190, y: 100, vx: -42, vy: 0 }),
        makeBody('b', { x: 170, y: 100, vx: -42, vy: 0 }),
        makeBody('c', { x: 150, y: 100, vx: -42, vy: 0 }),
      ],
      obstacles: [
        {
          id: 'upper-opposing-corner',
          left: 139,
          right: 140,
          top: 98.999999996,
          bottom: 99.999999996,
        },
        {
          id: 'lower-opposing-corner',
          left: 139,
          right: 140,
          top: 100.000000004,
          bottom: 101.000000004,
        },
      ],
    },
  ])(
    'rejects a mathematically empty contact cone even when its excess span is below the positional epsilon and $label',
    ({ chain, obstacles }) => {
      const bounds = { width: 200, height: 200 }
      const input = makeBodies(...chain)

      const result = stepResourceBodies(input, bounds, obstacles, 1 / 60)

      expectNonOverlapping(result)
      for (const id of ['a', 'b', 'c']) {
        expect(result.get(id)!.x).toBe(input.get(id)!.x)
        expect(result.get(id)!.y).toBe(input.get(id)!.y)
        expect(result.get(id)!.vx).toBe(0)
        expect(result.get(id)!.vy).toBe(0)
        expectBodyInsideBounds(result.get(id)!, bounds)
        for (const obstacle of obstacles) {
          expectBodyOutsideObstacle(result.get(id)!, obstacle)
        }
      }
    },
  )

  it('keeps a four-wall tangent component fail-closed when no rigid direction exists', () => {
    const bounds = { width: 140, height: 20 }
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const input = makeBodies(
      ...ids.map((id, index) =>
        makeBody(id, {
          x: 10 + index * 20,
          y: 10,
          vx: index < 5 ? -21 : -42,
          vy: 0,
        }),
      ),
    )

    const first = stepResourceBodies(input, bounds, EMPTY_OBSTACLES, 1 / 60)
    const second = stepResourceBodies(first, bounds, EMPTY_OBSTACLES, 1 / 60)

    expectNonOverlapping(first)
    expect(second).toEqual(first)
    for (const id of ids) {
      expect(first.get(id)!.x).toBe(input.get(id)!.x)
      expect(first.get(id)!.y).toBe(input.get(id)!.y)
      expect(first.get(id)!.vx).toBe(0)
      expect(first.get(id)!.vy).toBe(0)
      expectBodyInsideBounds(first.get(id)!, bounds)
    }
  })

  it.each([
    {
      label: 'left',
      body: makeBody('wall', { x: 10.05, y: 70, vx: -10, vy: 3 }),
      normal: 'x',
      expectedNormal: 10 * RESOURCE_WALL_RESTITUTION,
      expectedTangent: 3,
    },
    {
      label: 'right',
      body: makeBody('wall', { x: 189.95, y: 70, vx: 10, vy: 3 }),
      normal: 'x',
      expectedNormal: -10 * RESOURCE_WALL_RESTITUTION,
      expectedTangent: 3,
    },
    {
      label: 'top',
      body: makeBody('wall', { x: 70, y: 10.05, vx: 3, vy: -10 }),
      normal: 'y',
      expectedNormal: 10 * RESOURCE_WALL_RESTITUTION,
      expectedTangent: 3,
    },
    {
      label: 'bottom',
      body: makeBody('wall', { x: 70, y: 189.95, vx: 3, vy: 10 }),
      normal: 'y',
      expectedNormal: -10 * RESOURCE_WALL_RESTITUTION,
      expectedTangent: 3,
    },
  ])('reflects only the $label wall-normal component', ({ body, normal, expectedNormal, expectedTangent }) => {
    const result = stepResourceBodies(
      makeBodies(body),
      { width: 200, height: 200 },
      EMPTY_OBSTACLES,
      RESOURCE_FIXED_STEP_SECONDS,
    ).get('wall')!

    if (normal === 'x') {
      expect(result.vx).toBeCloseTo(expectedNormal, 8)
      expect(result.vy).toBeCloseTo(expectedTangent, 8)
    } else {
      expect(result.vy).toBeCloseTo(expectedNormal, 8)
      expect(result.vx).toBeCloseTo(expectedTangent, 8)
    }
  })

  it('pushes circles to the nearest valid AABB side and reflects only the collision normal', () => {
    const obstacle = { id: 'pocket', left: 100, top: 80, right: 200, bottom: 180 }
    const result = stepResourceBodies(
      makeBodies(
        makeBody('left-edge', { x: 95, y: 130, vx: 12, vy: 5 }),
        makeBody('inside-near-top', { x: 150, y: 83, vx: 4, vy: 10 }),
      ),
      { width: 320, height: 240 },
      [obstacle],
      0,
    )

    expect(result.get('left-edge')!.x).toBeCloseTo(90, 8)
    expect(result.get('left-edge')!.vx).toBeCloseTo(-12 * RESOURCE_WALL_RESTITUTION, 8)
    expect(result.get('left-edge')!.vy).toBe(5)
    expect(result.get('inside-near-top')!.y).toBeCloseTo(70, 8)
    expect(result.get('inside-near-top')!.vy).toBeCloseTo(-10 * RESOURCE_WALL_RESTITUTION, 8)
    expect(result.get('inside-near-top')!.vx).toBe(4)
  })

  it('keeps coordinates finite and caps speed through 10,000 fixed steps', () => {
    const bounds = { width: 360, height: 240 }
    const obstacles = [{ id: 'tray', left: 120, top: 90, right: 240, bottom: 150 }]
    let bodies = makeBodies(makeBody('fast', { x: 40, y: 40, vx: 400, vy: -300 }))

    for (let step = 0; step < 10_000; step += 1) {
      bodies = stepResourceBodies(bodies, bounds, obstacles, RESOURCE_FIXED_STEP_SECONDS)
    }

    const result = bodies.get('fast')!
    expectBodyInsideBounds(result, bounds)
    expectBodyOutsideObstacle(result, obstacles[0])
  })

  it('rejects invalid deltas, non-finite bodies, and non-finite drag points', () => {
    const bounds = { width: 200, height: 200 }
    const valid = makeBodies(makeBody('valid'))

    expect(() => stepResourceBodies(valid, bounds, EMPTY_OBSTACLES, Number.NaN)).toThrow(
      RangeError,
    )
    expect(() => stepResourceBodies(valid, bounds, EMPTY_OBSTACLES, -0.01)).toThrow(
      RangeError,
    )
    expect(() =>
      stepResourceBodies(
        makeBodies(makeBody('bad', { vx: Number.POSITIVE_INFINITY })),
        bounds,
        EMPTY_OBSTACLES,
        0,
      ),
    ).toThrow(RangeError)
    expect(() =>
      dragResourceBody(valid, 'valid', { x: Number.NaN, y: 0 }, bounds, EMPTY_OBSTACLES),
    ).toThrow(RangeError)
  })
})

describe('dragging and controller lifecycle', () => {
  it('clamps a far-away dragged pointer inside bounds and outside obstacles', () => {
    const bounds = { width: 300, height: 200 }
    const obstacles = [{ id: 'pocket', left: 240, top: 0, right: 300, bottom: 80 }]
    const result = dragResourceBody(
      makeBodies(makeBody('dragged', { x: 50, y: 50, vx: 9, vy: 7 })),
      'dragged',
      { x: 10_000, y: -10_000 },
      bounds,
      obstacles,
    ).get('dragged')!

    expect(result.mode).toBe('dragged')
    expect(result.vx).toBe(0)
    expect(result.vy).toBe(0)
    expectBodyInsideBounds(result, bounds)
    expectBodyOutsideObstacle(result, obstacles[0])
  })

  it('treats a dragged body as a fixed kinematic collider', () => {
    const result = stepResourceBodies(
      makeBodies(
        makeBody('dragged', { mode: 'dragged', x: 100, y: 100 }),
        makeBody('free', { x: 108, y: 100, vx: -8 }),
      ),
      { width: 300, height: 220 },
      EMPTY_OBSTACLES,
      0,
    )

    expect(result.get('dragged')).toEqual(
      makeBody('dragged', { mode: 'dragged', x: 100, y: 100 }),
    )
    expect(distance(result.get('dragged')!, result.get('free')!)).toBeGreaterThanOrEqual(19.99)
    expect(result.get('free')!.vx).toBeGreaterThan(0)
  })

  it('returns a pair-valid first frame and then advances after a public all-free collision chain', () => {
    const controller = new ResourceMotionController({
      ids: ['a', 'b', 'c'],
      bounds: { width: 120, height: 100 },
      radius: 10,
    })
    expect(controller.beginDrag('a')).toBe(true)
    expect(controller.dragTo('a', { x: 10, y: 50 })).toBe(true)
    expect(controller.endDrag('a')).toBe(true)
    expect(controller.beginDrag('b')).toBe(true)
    expect(controller.dragTo('b', { x: 30, y: 50 })).toBe(true)
    expect(controller.endDrag('b', { x: -42, y: 0 })).toBe(true)
    expect(controller.beginDrag('c')).toBe(true)
    expect(controller.dragTo('c', { x: 50, y: 50 })).toBe(true)
    expect(controller.endDrag('c', { x: -42, y: 0 })).toBe(true)
    const before = controller.snapshot()
    expectNonOverlapping(before.bodies)

    controller.step(1 / 60)
    const first = controller.snapshot()
    expectNonOverlapping(first.bodies)
    expect(first.bodies.get('a')!.x).toBe(before.bodies.get('a')!.x)
    expect(first.bodies.get('a')!.vx).not.toBe(before.bodies.get('a')!.vx)
    expect(first.bodies.get('b')!.vx - first.bodies.get('a')!.vx).toBeGreaterThan(0)
    expect(first.bodies.get('c')!.vx - first.bodies.get('b')!.vx).toBeGreaterThan(0)

    controller.step(1 / 60)
    const second = controller.snapshot()
    expectNonOverlapping(second.bodies)
    expect(
      [...second.bodies].some(([id, body]) => body.x !== first.bodies.get(id)!.x),
    ).toBe(true)
  })

  it('rejects an unsatisfiable kinematic drag atomically and keeps the next step valid', () => {
    const controller = new ResourceMotionController({
      ids: ['alpha', 'beta', 'gamma'],
      bounds: { width: 60, height: 20 },
      radius: 10,
    })
    expect(controller.beginDrag('alpha')).toBe(true)
    const beforeInvalidDrag = controller.snapshot()

    expect(controller.dragTo('alpha', { x: 40, y: 10 })).toBe(false)

    expect(controller.snapshot()).toEqual(beforeInvalidDrag)
    expect(() => controller.step(RESOURCE_FIXED_STEP_SECONDS)).not.toThrow()
    const stepped = controller.snapshot()
    expectNonOverlapping(stepped.bodies)
    for (const body of stepped.bodies.values()) {
      expectBodyInsideBounds(body, stepped.bounds)
    }
  })

  it('contains an expected obstacle-resolution failure before committing a drag candidate', () => {
    const obstacles = [
      { id: 'a', left: 0, top: 0, right: 20, bottom: 20 },
      { id: 'b', left: 20, top: 0, right: 40, bottom: 20 },
    ] as const
    const controller = new ResourceMotionController({
      ids: ['x'],
      bounds: { width: 100, height: 100 },
      radius: 10,
      obstacles,
    })
    expect(controller.beginDrag('x')).toBe(true)
    const beforeRejectedDrag = controller.snapshot()

    expect(() => {
      expect(controller.dragTo('x', { x: 0, y: 0 })).toBe(false)
    }).not.toThrow()

    expect(controller.snapshot()).toEqual(beforeRejectedDrag)
    expect(() => controller.step(RESOURCE_FIXED_STEP_SECONDS)).not.toThrow()
    const stepped = controller.snapshot()
    expectNonOverlapping(stepped.bodies)
    for (const body of stepped.bodies.values()) {
      expectBodyInsideBounds(body, stepped.bounds)
      for (const obstacle of obstacles) {
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
  })

  it('keeps the exact supported-field wall drag local or rejects it atomically', () => {
    const { controller, ids } = prepareSupportedFieldForWallAdjacentDrag()
    const before = controller.snapshot()

    const accepted = controller.dragTo('body-01', { x: 25, y: 50 })
    const after = controller.snapshot()

    if (!accepted) {
      expect(after).toEqual(before)
      return
    }

    expect(after.bodies.get('body-01')).toEqual({
      ...before.bodies.get('body-01')!,
      x: 25,
      y: 50,
      vx: 0,
      vy: 0,
      mode: 'dragged',
    })
    const priorNeighbor = before.bodies.get('body-00')!
    const nextNeighbor = after.bodies.get('body-00')!
    expect(Math.hypot(nextNeighbor.x - priorNeighbor.x, nextNeighbor.y - priorNeighbor.y)).toBeLessThanOrEqual(
      40,
    )
    for (const id of ids.slice(2)) {
      expect(after.bodies.get(id)).toEqual(before.bodies.get(id))
    }
  })

  it('keeps the exact supported-field pointer solve at two resolution traversals without extra hypot checks', () => {
    const { controller, ids } = prepareSupportedFieldForWallAdjacentDrag()
    const hypotSpy = vi.spyOn(Math, 'hypot')
    hypotSpy.mockClear()

    expect(controller.dragTo('body-01', { x: 25, y: 50 })).toBe(true)
    const hypotCalls = hypotSpy.mock.calls.length
    hypotSpy.mockRestore()

    const unorderedPairs = (ids.length * (ids.length - 1)) / 2
    const collisionResolutionChecks = RESOURCE_COLLISION_PASSES * unorderedPairs
    const fusedPrestepValidityPredicates = unorderedPairs
    expect(collisionResolutionChecks).toBe(2_862)
    expect(fusedPrestepValidityPredicates).toBe(1_431)
    expect(hypotCalls).toBe(collisionResolutionChecks + ids.length)
  })

  it('keeps supported 54-body free motion alive for one simulated minute', () => {
    const ids = Array.from(
      { length: 54 },
      (_, index) => `body-${String(index).padStart(2, '0')}`,
    )
    const obstacles = [
      { id: 'pocket', left: 760, top: 20, right: 940, bottom: 190 },
      { id: 'tray', left: 250, top: 500, right: 710, bottom: 600 },
    ] as const
    const controller = new ResourceMotionController({
      ids,
      bounds: { width: 960, height: 620 },
      radius: 10,
      obstacles,
    })
    const initial = controller.snapshot()

    expect(() => {
      for (let step = 0; step < 3_600; step += 1) {
        controller.step(RESOURCE_FIXED_STEP_SECONDS)
        if ((step + 1) % 600 === 0) {
          expectNonOverlapping(controller.snapshot().bodies)
        }
      }
    }).not.toThrow()
    const snapshot = controller.snapshot()
    expectNonOverlapping(snapshot.bodies)
    expect(
      ids.some((id) => {
        const before = initial.bodies.get(id)!
        const after = snapshot.bodies.get(id)!
        return before.x !== after.x || before.y !== after.y
      }),
    ).toBe(true)
    for (const body of snapshot.bodies.values()) {
      expectBodyInsideBounds(body, snapshot.bounds)
      for (const obstacle of obstacles) {
        expectBodyOutsideObstacle(body, obstacle)
      }
    }
  })

  it('advances a supported 47-body tangent chain and unrelated motion after one rollback', () => {
    const bounds = { width: 960, height: 620 }
    const chainIds = Array.from(
      { length: 47 },
      (_, index) => `chain-${String(index).padStart(2, '0')}`,
    )
    const unrelatedIds = Array.from(
      { length: 7 },
      (_, index) => `unrelated-${String(index).padStart(2, '0')}`,
    )
    const input = makeBodies(
      ...chainIds.map((id, index) =>
        makeBody(id, {
          x: 30 + index * 20,
          y: 300,
          vx: index === chainIds.length - 1 ? -42 : -21,
          vy: 0,
        }),
      ),
      ...unrelatedIds.map((id, index) =>
        makeBody(id, {
          x: 90 + index * 120,
          y: 100,
          vx: index === 0 ? 6 : 0,
          vy: 0,
        }),
      ),
    )

    const first = stepResourceBodies(input, bounds, EMPTY_OBSTACLES, 1 / 60)
    const second = stepResourceBodies(first, bounds, EMPTY_OBSTACLES, 1 / 60)

    expectNonOverlapping(first)
    expectNonOverlapping(second)
    expect(
      chainIds.some((id) => {
        const before = first.get(id)!
        const after = second.get(id)!
        return before.x !== after.x || before.y !== after.y
      }),
    ).toBe(true)
    for (let index = 1; index < chainIds.length; index += 1) {
      expect(
        distance(second.get(chainIds[index - 1])!, second.get(chainIds[index])!),
      ).toBeGreaterThanOrEqual(
        distance(first.get(chainIds[index - 1])!, first.get(chainIds[index])!) - 1e-9,
      )
    }
    expect(first.get(unrelatedIds[0])!.x - input.get(unrelatedIds[0])!.x).toBeCloseTo(
      6 / 60,
      10,
    )
    expect(second.get(unrelatedIds[0])!.x - first.get(unrelatedIds[0])!.x).toBeCloseTo(
      6 / 60,
      10,
    )
    for (const frame of [first, second]) {
      for (const body of frame.values()) {
        expectBodyInsideBounds(body, bounds)
      }
    }
    for (const [id, body] of second) {
      const prior = first.get(id)!
      expect(Math.hypot(body.x - prior.x, body.y - prior.y)).toBeLessThanOrEqual(
        RESOURCE_MAX_SPEED / 60 + 1e-9,
      )
    }
  })

  it('cancels drag and deterministically relayouts all IDs on a smaller valid geometry', () => {
    const controller = new ResourceMotionController({
      ids: ['alpha', 'beta', 'gamma'],
      bounds: { width: 500, height: 320 },
      radius: 12,
    })
    expect(controller.beginDrag('alpha')).toBe(true)
    expect(controller.dragTo('alpha', { x: 450, y: 280 })).toBe(true)

    const smaller = { width: 230, height: 150 }
    controller.setGeometry(smaller, 10, [])
    const snapshot = controller.snapshot()

    expect([...snapshot.bodies.keys()].sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(snapshot.bodies.get('alpha')!.mode).toBe('free')
    expect(snapshot.bodies.get('alpha')!.vx).toBe(0)
    expect(snapshot.bodies.get('alpha')!.vy).toBe(0)
    for (const body of snapshot.bodies.values()) {
      expectBodyInsideBounds(body, smaller)
    }
    expectNonOverlapping(snapshot.bodies)
  })

  it('removes missing IDs, preserves a deterministic set, and rejects unavailable drag actions', () => {
    const controller = new ResourceMotionController({
      ids: ['c', 'a', 'b', 'a'],
      bounds: { width: 300, height: 220 },
      radius: 10,
    })

    controller.setIds(['b', 'd', 'b'])

    expect([...controller.snapshot().bodies.keys()]).toEqual(['b', 'd'])
    expect(controller.beginDrag('missing')).toBe(false)
    expect(controller.dragTo('missing', { x: 10, y: 10 })).toBe(false)
    expect(controller.endDrag('missing')).toBe(false)
    expect(controller.cancelDrag('missing')).toBe(false)
  })

  it('caps release velocity and preserves outward wall velocity without reflecting it inward', () => {
    const controller = new ResourceMotionController({
      ids: ['alpha'],
      bounds: { width: 200, height: 160 },
      radius: 10,
    })
    expect(controller.beginDrag('alpha')).toBe(true)
    expect(controller.dragTo('alpha', { x: 10, y: 80 })).toBe(true)
    expect(controller.endDrag('alpha', { x: 1_000, y: 0 })).toBe(true)
    controller.step(RESOURCE_FIXED_STEP_SECONDS)

    const released = controller.snapshot().bodies.get('alpha')!
    expect(Math.hypot(released.vx, released.vy)).toBeLessThanOrEqual(RESOURCE_MAX_SPEED)

    const outwardOnly = stepResourceBodies(
      makeBodies(makeBody('wall', { x: 10, y: 80, vx: 5, vy: 2 })),
      { width: 200, height: 160 },
      EMPTY_OBSTACLES,
      0,
    ).get('wall')!
    expect(outwardOnly.vx).toBe(5)
    expect(outwardOnly.vy).toBe(2)
  })

  it('returns deep-cloned snapshots and isolates private controller state through disposal', () => {
    const options = {
      ids: ['alpha', 'beta'],
      bounds: { width: 300, height: 220 },
      radius: 10,
      obstacles: [{ id: 'corner', left: 250, top: 0, right: 300, bottom: 50 }],
    }
    const controller = new ResourceMotionController(options)
    const first = controller.snapshot()
    const originalAlphaX = first.bodies.get('alpha')!.x

    first.bodies.get('alpha')!.x = -9_999
    ;(first.bodies as Map<string, ResourceBody>).clear()
    first.bounds.width = -1
    options.bounds.width = 1
    options.obstacles[0].left = 0

    const isolated = controller.snapshot()
    expect(isolated.bodies.size).toBe(2)
    expect(isolated.bodies.get('alpha')!.x).toBe(originalAlphaX)
    expect(isolated.bounds).toEqual({ width: 300, height: 220 })

    controller.dispose()
    expect(controller.snapshot().bodies.size).toBe(0)
    expect(controller.beginDrag('alpha')).toBe(false)
    expect(() => controller.step(RESOURCE_FIXED_STEP_SECONDS)).not.toThrow()
  })
})

describe('reduced layout and directional focus', () => {
  it('creates an obstacle-safe non-overlapping stable layout with zero velocity', () => {
    const bounds = { width: 520, height: 320 }
    const obstacle = { id: 'tray', left: 150, top: 230, right: 370, bottom: 300 }
    const ids = Array.from({ length: 24 }, (_, index) => `block-${index}`)
    const layout = stableResourceLayout(ids, bounds, 11, [obstacle])

    expectNonOverlapping(layout)
    for (const body of layout.values()) {
      expectBodyInsideBounds(body, bounds)
      expectBodyOutsideObstacle(body, obstacle)
      expect(body.vx).toBe(0)
      expect(body.vy).toBe(0)
      expect(body.mode).toBe('free')
    }

    const controller = new ResourceMotionController({
      ids,
      bounds,
      radius: 11,
    })
    controller.setReducedMotion(true)
    const before = controller.snapshot()
    controller.step(1)
    expect(controller.snapshot()).toEqual(before)
  })

  it('orders directional candidates by angle, then distance, then stable ID', () => {
    const angular = makeBodies(
      makeBody('from', { x: 100, y: 100 }),
      makeBody('straight-far', { x: 140, y: 100 }),
      makeBody('near-off-axis', { x: 106, y: 104 }),
      makeBody('left', { x: 80, y: 100 }),
    )
    expect(nearestResourceInDirection(angular, 'from', 'right')).toBe('straight-far')

    const distanceTie = makeBodies(
      makeBody('from', { x: 100, y: 100 }),
      makeBody('far', { x: 140, y: 100 }),
      makeBody('near', { x: 120, y: 100 }),
    )
    expect(nearestResourceInDirection(distanceTie, 'from', 'right')).toBe('near')

    const idTie = makeBodies(
      makeBody('from', { x: 100, y: 100 }),
      makeBody('beta', { x: 120, y: 120 }),
      makeBody('alpha', { x: 120, y: 120 }),
    )
    expect(nearestResourceInDirection(idTie, 'from', 'down')).toBe('alpha')
    expect(nearestResourceInDirection(idTie, 'missing', 'down')).toBeNull()
    expect(nearestResourceInDirection(idTie, 'from', 'up')).toBeNull()
  })
})

describe('review regressions for positional constraint repair', () => {
  it('co-solves a free-body pair pushed through the left wall', () => {
    const bounds = { width: 100, height: 100 }
    const result = stepResourceBodies(
      makeBodies(
        makeBody('alpha', { x: 10, y: 50 }),
        makeBody('beta', { x: 15, y: 50 }),
      ),
      bounds,
      EMPTY_OBSTACLES,
      0,
    )

    expectBodyInsideBounds(result.get('alpha')!, bounds)
    expectBodyInsideBounds(result.get('beta')!, bounds)
    expect(distance(result.get('alpha')!, result.get('beta')!)).toBeGreaterThanOrEqual(19.99)
  })

  it('co-solves a free-body pair pushed into an AABB obstacle', () => {
    const bounds = { width: 200, height: 120 }
    const obstacle = { id: 'pocket', left: 100, top: 0, right: 140, bottom: 100 }
    const result = stepResourceBodies(
      makeBodies(
        makeBody('alpha', { x: 90, y: 50 }),
        makeBody('beta', { x: 85, y: 50 }),
      ),
      bounds,
      [obstacle],
      0,
    )

    expectNonOverlapping(result)
    for (const body of result.values()) {
      expectBodyInsideBounds(body, bounds)
      expectBodyOutsideObstacle(body, obstacle)
    }
  })

  it.each([
    ['dragged sorts first', 'a-dragged', 'z-free'],
    ['dragged sorts last', 'z-dragged', 'a-free'],
  ])('keeps a wall-adjacent kinematic body fixed when $0', (_label, draggedId, freeId) => {
    const bounds = { width: 100, height: 100 }
    const dragged = makeBody(draggedId, { x: 25, y: 50, mode: 'dragged' })
    const result = stepResourceBodies(
      makeBodies(dragged, makeBody(freeId, { x: 15, y: 50 })),
      bounds,
      EMPTY_OBSTACLES,
      0,
    )

    expect(result.get(draggedId)).toEqual(dragged)
    expectBodyInsideBounds(result.get(freeId)!, bounds)
    expect(distance(result.get(draggedId)!, result.get(freeId)!)).toBeGreaterThanOrEqual(19.99)
  })

  it.each([
    ['dragged sorts first', 'a-dragged', 'z-free'],
    ['dragged sorts last', 'z-dragged', 'a-free'],
  ])('keeps an AABB-adjacent kinematic body fixed when $0', (_label, draggedId, freeId) => {
    const bounds = { width: 200, height: 120 }
    const obstacle = { id: 'pocket', left: 100, top: 0, right: 140, bottom: 100 }
    const dragged = makeBody(draggedId, { x: 80, y: 50, mode: 'dragged' })
    const result = stepResourceBodies(
      makeBodies(dragged, makeBody(freeId, { x: 90, y: 50 })),
      bounds,
      [obstacle],
      0,
    )

    expect(result.get(draggedId)).toEqual(dragged)
    expectBodyInsideBounds(result.get(freeId)!, bounds)
    expectBodyOutsideObstacle(result.get(freeId)!, obstacle)
    expect(distance(result.get(draggedId)!, result.get(freeId)!)).toBeGreaterThanOrEqual(19.99)
  })
})

describe('review regressions for controller geometry and reduced transitions', () => {
  it('treats identical geometry as a no-op that preserves an active drag', () => {
    const controller = new ResourceMotionController({
      ids: ['alpha', 'beta'],
      bounds: { width: 300, height: 220 },
      radius: 10,
    })
    expect(controller.beginDrag('alpha')).toBe(true)
    expect(controller.dragTo('alpha', { x: 60, y: 70 })).toBe(true)
    const before = controller.snapshot()

    controller.setGeometry({ width: 300, height: 220 }, 10, [])

    expect(controller.snapshot()).toEqual(before)
  })

  it('cancels only the dragged body on changed geometry and keeps normal motion alive', () => {
    const controller = new ResourceMotionController({
      ids: ['alpha', 'beta', 'gamma'],
      bounds: { width: 300, height: 220 },
      radius: 10,
    })
    expect(controller.beginDrag('alpha')).toBe(true)
    expect(controller.dragTo('alpha', { x: 60, y: 70 })).toBe(true)

    controller.setGeometry({ width: 340, height: 240 }, 10, [])
    const resized = controller.snapshot()

    expect(resized.bodies.get('alpha')!.mode).toBe('free')
    expect(resized.bodies.get('alpha')!.vx).toBe(0)
    expect(resized.bodies.get('alpha')!.vy).toBe(0)
    for (const id of ['beta', 'gamma']) {
      expect(resized.bodies.get(id)!.mode).toBe('free')
      expect(Math.hypot(resized.bodies.get(id)!.vx, resized.bodies.get(id)!.vy)).toBeGreaterThan(0)
    }

    controller.step(RESOURCE_FIXED_STEP_SECONDS)
    const stepped = controller.snapshot()
    expect(
      ['beta', 'gamma'].some(
        (id) =>
          stepped.bodies.get(id)!.x !== resized.bodies.get(id)!.x ||
          stepped.bodies.get(id)!.y !== resized.bodies.get(id)!.y,
      ),
    ).toBe(true)
  })

  it('seeds bounded deterministic motion when reduced motion is disabled without teleporting', () => {
    const controller = new ResourceMotionController({
      ids: ['alpha', 'beta', 'gamma'],
      bounds: { width: 300, height: 220 },
      radius: 10,
      reducedMotion: true,
    })
    const stable = controller.snapshot()

    controller.setReducedMotion(false)
    const moving = controller.snapshot()

    for (const [id, body] of moving.bodies) {
      expect(body.x).toBe(stable.bodies.get(id)!.x)
      expect(body.y).toBe(stable.bodies.get(id)!.y)
      expect(Math.hypot(body.vx, body.vy)).toBeGreaterThan(0)
      expect(Math.hypot(body.vx, body.vy)).toBeLessThanOrEqual(RESOURCE_MAX_SPEED)
    }

    controller.step(RESOURCE_FIXED_STEP_SECONDS)
    expect(controller.snapshot()).not.toEqual(moving)
  })

  it.each(['end', 'cancel'] as const)(
    'synchronously restores a zero-velocity reduced layout after %s on an overlap',
    (action) => {
      const bounds = { width: 300, height: 220 }
      const obstacle = { id: 'pocket', left: 240, top: 0, right: 300, bottom: 70 }
      const controller = new ResourceMotionController({
        ids: ['alpha', 'beta', 'gamma'],
        bounds,
        radius: 10,
        obstacles: [obstacle],
        reducedMotion: true,
      })
      const beta = controller.snapshot().bodies.get('beta')!
      expect(controller.beginDrag('alpha')).toBe(true)
      expect(controller.dragTo('alpha', { x: beta.x, y: beta.y })).toBe(true)

      const finished =
        action === 'end' ? controller.endDrag('alpha', { x: 30, y: 20 }) : controller.cancelDrag('alpha')
      expect(finished).toBe(true)
      const restored = controller.snapshot()

      expectNonOverlapping(restored.bodies)
      for (const body of restored.bodies.values()) {
        expect(body.mode).toBe('free')
        expect(body.vx).toBe(0)
        expect(body.vy).toBe(0)
        expectBodyInsideBounds(body, bounds)
        expectBodyOutsideObstacle(body, obstacle)
      }
    },
  )

  it.each([
    ['inward', 12, -12 * RESOURCE_WALL_RESTITUTION],
    ['outward', -12, -12],
  ])('handles an exact AABB tangent with %s normal velocity', (_label, vx, expectedVx) => {
    const obstacle = { id: 'pocket', left: 100, top: 0, right: 140, bottom: 120 }
    const result = stepResourceBodies(
      makeBodies(makeBody('tangent', { x: 90, y: 60, vx, vy: 3 })),
      { width: 200, height: 120 },
      [obstacle],
      0,
    ).get('tangent')!

    expect(result.x).toBe(90)
    expect(result.vx).toBeCloseTo(expectedVx, 8)
    expect(result.vy).toBe(3)
  })
})
