export interface ResourceFieldBounds {
  width: number
  height: number
}

export interface ResourceFieldObstacle {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

export interface ResourceBody {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  mode: 'free' | 'dragged'
}

export interface ResourceMotionSnapshot {
  bodies: ReadonlyMap<string, ResourceBody>
  bounds: ResourceFieldBounds
}

export interface ResourceMotionControllerOptions {
  ids: readonly string[]
  bounds: ResourceFieldBounds
  radius: number
  obstacles?: readonly ResourceFieldObstacle[]
  reducedMotion?: boolean
}

export const RESOURCE_FIXED_STEP_SECONDS = 1 / 60
export const RESOURCE_MAX_FRAME_SECONDS = 0.1
export const RESOURCE_MAX_STEPS_PER_FRAME = 6
export const RESOURCE_COLLISION_PASSES = 2
export const RESOURCE_RESTITUTION = 0.92
export const RESOURCE_WALL_RESTITUTION = 1
export const RESOURCE_MAX_SPEED = 72
export const RESOURCE_COLLISION_RESPONSE_SPEED = 42

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const GOLDEN_ANGLE_RADIANS = Math.PI * (3 - Math.sqrt(5))
const GEOMETRY_EPSILON = 1e-9
const CONTACT_ANGLE_EPSILON = Number.EPSILON * 64
const SEPARATION_TOLERANCE = 0.001
const MAX_SPIRAL_CANDIDATES = 4_096
const MAX_RELAXATION_PASSES = 96
const PAIR_LEFT_MOVED = 1
const PAIR_RIGHT_MOVED = 2
const PAIR_CONTACT = 4
const MAX_CONTACT_EXPANSION_SCALE_HALVINGS = 12
const MAX_CONTACT_DRIFT_PROJECTION_PASSES = 8
const RIGID_FALLBACK_UP = 1
const RIGID_FALLBACK_RIGHT = 2
const RIGID_FALLBACK_DOWN = 4
const RIGID_FALLBACK_LEFT = 8
const RIGID_FALLBACK_UP_RIGHT = 16
const RIGID_FALLBACK_DOWN_RIGHT = 32
const RIGID_FALLBACK_DOWN_LEFT = 64
const RIGID_FALLBACK_UP_LEFT = 128
const RIGID_FALLBACK_DIAGONAL_COMPONENT = Math.SQRT1_2
const CONTINUOUS_FALLBACK_INTERIOR = 1
const CONTINUOUS_FALLBACK_LOWER_BOUNDARY = 2
const CONTINUOUS_FALLBACK_UPPER_BOUNDARY = 4
const RIGID_CANDIDATE_VALID = 1
const RIGID_CANDIDATE_PROGRESS = 2
const CONTINUOUS_FALLBACK_ALL =
  CONTINUOUS_FALLBACK_INTERIOR |
  CONTINUOUS_FALLBACK_LOWER_BOUNDARY |
  CONTINUOUS_FALLBACK_UPPER_BOUNDARY
const RIGID_FALLBACK_ALL =
  RIGID_FALLBACK_UP |
  RIGID_FALLBACK_RIGHT |
  RIGID_FALLBACK_DOWN |
  RIGID_FALLBACK_LEFT |
  RIGID_FALLBACK_UP_RIGHT |
  RIGID_FALLBACK_DOWN_RIGHT |
  RIGID_FALLBACK_DOWN_LEFT |
  RIGID_FALLBACK_UP_LEFT

function resourceRangeError(detail: string): RangeError {
  return new RangeError(`Invalid resource field geometry: ${detail}`)
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw resourceRangeError(`${name} must be finite`)
  }
}

function validateBounds(bounds: ResourceFieldBounds): ResourceFieldBounds {
  assertFinite(bounds.width, 'bounds.width')
  assertFinite(bounds.height, 'bounds.height')
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw resourceRangeError('bounds must be positive')
  }
  return { width: bounds.width, height: bounds.height }
}

function validateRadius(radius: number, bounds: ResourceFieldBounds): number {
  assertFinite(radius, 'radius')
  if (radius <= 0 || radius * 2 > bounds.width || radius * 2 > bounds.height) {
    throw resourceRangeError('radius does not fit inside bounds')
  }
  return radius
}

function normalizeIds(ids: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) {
      throw resourceRangeError('body IDs must be non-empty strings')
    }
    unique.add(id)
  }
  return [...unique].sort((left, right) => left.localeCompare(right))
}

function normalizeObstacles(
  obstacles: readonly ResourceFieldObstacle[],
): ResourceFieldObstacle[] {
  const result = obstacles.map((obstacle) => {
    assertFinite(obstacle.left, `${obstacle.id}.left`)
    assertFinite(obstacle.top, `${obstacle.id}.top`)
    assertFinite(obstacle.right, `${obstacle.id}.right`)
    assertFinite(obstacle.bottom, `${obstacle.id}.bottom`)
    if (obstacle.right <= obstacle.left || obstacle.bottom <= obstacle.top) {
      throw resourceRangeError(`obstacle ${obstacle.id} must have positive area`)
    }
    return { ...obstacle }
  })
  result.sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      left.left - right.left ||
      left.top - right.top ||
      left.right - right.right ||
      left.bottom - right.bottom,
  )
  return result
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum))
}

function hashDisplayId(value: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

function deterministicPairNormal(leftId: string, rightId: string): { x: number; y: number } {
  const hash = hashDisplayId(`${leftId}\u0000${rightId}`)
  const angle = (hash / 0x1_0000_0000) * Math.PI * 2
  return { x: Math.cos(angle), y: Math.sin(angle) }
}

function deterministicDisplayVelocity(id: string): { vx: number; vy: number } {
  const velocityHash = hashDisplayId(`${id}:velocity`)
  const angle = (velocityHash / 0x1_0000_0000) * Math.PI * 2
  const speed = 48 + ((velocityHash >>> 8) / 0x00ff_ffff) * 24
  return {
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  }
}

function circleOverlapsObstacle(
  x: number,
  y: number,
  radius: number,
  obstacle: ResourceFieldObstacle,
): boolean {
  const closestX = clamp(x, obstacle.left, obstacle.right)
  const closestY = clamp(y, obstacle.top, obstacle.bottom)
  const deltaX = x - closestX
  const deltaY = y - closestY
  return deltaX * deltaX + deltaY * deltaY < radius * radius - GEOMETRY_EPSILON
}

function positionIsAvailable(
  x: number,
  y: number,
  radius: number,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
  bodies: readonly ResourceBody[],
): boolean {
  if (
    x < radius - GEOMETRY_EPSILON ||
    x > bounds.width - radius + GEOMETRY_EPSILON ||
    y < radius - GEOMETRY_EPSILON ||
    y > bounds.height - radius + GEOMETRY_EPSILON
  ) {
    return false
  }
  for (const obstacle of obstacles) {
    if (circleOverlapsObstacle(x, y, radius, obstacle)) {
      return false
    }
  }
  for (const body of bodies) {
    const deltaX = x - body.x
    const deltaY = y - body.y
    const minimumDistance = radius + body.radius
    if (deltaX * deltaX + deltaY * deltaY < minimumDistance * minimumDistance - 0.01) {
      return false
    }
  }
  return true
}

function findSpiralPosition(
  radius: number,
  spiralSpacing: number,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
  bodies: readonly ResourceBody[],
): { x: number; y: number } | null {
  const centerX = bounds.width / 2
  const centerY = bounds.height / 2
  for (let candidate = 0; candidate < MAX_SPIRAL_CANDIDATES; candidate += 1) {
    const distance = spiralSpacing * Math.sqrt(candidate)
    const angle = candidate * GOLDEN_ANGLE_RADIANS
    const x = clamp(centerX + Math.cos(angle) * distance, radius, bounds.width - radius)
    const y = clamp(centerY + Math.sin(angle) * distance, radius, bounds.height - radius)
    if (positionIsAvailable(x, y, radius, bounds, obstacles, bodies)) {
      return { x, y }
    }
  }

  const gridSpacing = radius * 2 + 0.25
  for (let y = radius; y <= bounds.height - radius + GEOMETRY_EPSILON; y += gridSpacing) {
    for (let x = radius; x <= bounds.width - radius + GEOMETRY_EPSILON; x += gridSpacing) {
      if (positionIsAvailable(x, y, radius, bounds, obstacles, bodies)) {
        return { x, y }
      }
    }
  }
  return null
}

function relaxLayout(
  bodies: ResourceBody[],
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): void {
  for (let pass = 0; pass < MAX_RELAXATION_PASSES; pass += 1) {
    let changed = false
    for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
      const left = bodies[leftIndex]
      for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
        const right = bodies[rightIndex]
        let deltaX = right.x - left.x
        let deltaY = right.y - left.y
        let distance = Math.hypot(deltaX, deltaY)
        const minimumDistance = left.radius + right.radius
        if (distance >= minimumDistance - SEPARATION_TOLERANCE) {
          continue
        }
        if (distance <= GEOMETRY_EPSILON) {
          const normal = deterministicPairNormal(left.id, right.id)
          deltaX = normal.x
          deltaY = normal.y
          distance = 1
        }
        const displacement = (minimumDistance - distance) / 2
        const normalX = deltaX / distance
        const normalY = deltaY / distance
        left.x = clamp(left.x - normalX * displacement, left.radius, bounds.width - left.radius)
        left.y = clamp(left.y - normalY * displacement, left.radius, bounds.height - left.radius)
        right.x = clamp(right.x + normalX * displacement, right.radius, bounds.width - right.radius)
        right.y = clamp(right.y + normalY * displacement, right.radius, bounds.height - right.radius)
        changed = true
      }
    }
    if (!changed) {
      break
    }
  }

  for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
    const left = bodies[leftIndex]
    if (!positionIsAvailable(left.x, left.y, left.radius, bounds, obstacles, bodies.slice(0, leftIndex))) {
      throw resourceRangeError('bodies cannot be placed without overlap')
    }
  }
}

function buildResourceBodies(
  ids: readonly string[],
  boundsInput: ResourceFieldBounds,
  radiusInput: number,
  obstaclesInput: readonly ResourceFieldObstacle[],
  moving: boolean,
): Map<string, ResourceBody> {
  const bounds = validateBounds(boundsInput)
  const radius = validateRadius(radiusInput, bounds)
  const obstacles = normalizeObstacles(obstaclesInput)
  const bodies: ResourceBody[] = []
  const normalizedIds = normalizeIds(ids)
  const compactSpacing = radius * 2 + 0.25
  const compactRadius = compactSpacing * Math.sqrt(Math.max(1, normalizedIds.length - 1))
  const targetRadius = Math.min(bounds.width, bounds.height) * 0.43
  const spacingScale = clamp(targetRadius / compactRadius, 1, 1.6)
  const spiralSpacing = compactSpacing * spacingScale

  for (const id of normalizedIds) {
    const position = findSpiralPosition(radius, spiralSpacing, bounds, obstacles, bodies)
    if (position === null) {
      throw resourceRangeError('bodies cannot be placed without overlap')
    }
    const velocity = deterministicDisplayVelocity(id)
    bodies.push({
      id,
      x: position.x,
      y: position.y,
      vx: moving ? velocity.vx : 0,
      vy: moving ? velocity.vy : 0,
      radius,
      mode: 'free',
    })
  }

  relaxLayout(bodies, bounds, obstacles)
  return new Map(bodies.map((body) => [body.id, { ...body }]))
}

export function createResourceBodies(
  ids: readonly string[],
  bounds: ResourceFieldBounds,
  radius: number,
  obstacles: readonly ResourceFieldObstacle[] = [],
): Map<string, ResourceBody> {
  return buildResourceBodies(ids, bounds, radius, obstacles, true)
}

export function stableResourceLayout(
  ids: readonly string[],
  bounds: ResourceFieldBounds,
  radius: number,
  obstacles: readonly ResourceFieldObstacle[] = [],
): Map<string, ResourceBody> {
  return buildResourceBodies(ids, bounds, radius, obstacles, false)
}

function cloneAndValidateBodies(
  bodies: ReadonlyMap<string, ResourceBody>,
  bounds: ResourceFieldBounds,
): ResourceBody[] {
  const result: ResourceBody[] = []
  const entries = [...bodies.entries()].sort(([left], [right]) => left.localeCompare(right))
  for (const [key, body] of entries) {
    if (key !== body.id || body.id.length === 0) {
      throw resourceRangeError('body map keys must match non-empty body IDs')
    }
    assertFinite(body.x, `${body.id}.x`)
    assertFinite(body.y, `${body.id}.y`)
    assertFinite(body.vx, `${body.id}.vx`)
    assertFinite(body.vy, `${body.id}.vy`)
    validateRadius(body.radius, bounds)
    if (body.mode !== 'free' && body.mode !== 'dragged') {
      throw resourceRangeError(`${body.id}.mode is invalid`)
    }
    result.push({ ...body })
  }
  return result
}

function reflectAgainstBounds(body: ResourceBody, bounds: ResourceFieldBounds): void {
  if (body.x <= body.radius) {
    body.x = body.radius
    if (body.vx < 0) {
      body.vx = -body.vx * RESOURCE_WALL_RESTITUTION
    }
  } else if (body.x >= bounds.width - body.radius) {
    body.x = bounds.width - body.radius
    if (body.vx > 0) {
      body.vx = -body.vx * RESOURCE_WALL_RESTITUTION
    }
  }

  if (body.y <= body.radius) {
    body.y = body.radius
    if (body.vy < 0) {
      body.vy = -body.vy * RESOURCE_WALL_RESTITUTION
    }
  } else if (body.y >= bounds.height - body.radius) {
    body.y = bounds.height - body.radius
    if (body.vy > 0) {
      body.vy = -body.vy * RESOURCE_WALL_RESTITUTION
    }
  }
}

function resolveObstacleCollision(
  body: ResourceBody,
  obstacle: ResourceFieldObstacle,
  bounds: ResourceFieldBounds,
): void {
  const closestX = clamp(body.x, obstacle.left, obstacle.right)
  const closestY = clamp(body.y, obstacle.top, obstacle.bottom)
  const deltaX = body.x - closestX
  const deltaY = body.y - closestY
  let distance = Math.hypot(deltaX, deltaY)
  if (distance > body.radius + GEOMETRY_EPSILON) {
    return
  }

  let normalX: number
  let normalY: number
  if (distance > GEOMETRY_EPSILON) {
    normalX = deltaX / distance
    normalY = deltaY / distance
  } else {
    const leftTarget = obstacle.left - body.radius
    const rightTarget = obstacle.right + body.radius
    const topTarget = obstacle.top - body.radius
    const bottomTarget = obstacle.bottom + body.radius
    const leftDistance =
      leftTarget >= body.radius ? Math.abs(body.x - leftTarget) : Number.POSITIVE_INFINITY
    const rightDistance =
      rightTarget <= bounds.width - body.radius
        ? Math.abs(rightTarget - body.x)
        : Number.POSITIVE_INFINITY
    const topDistance =
      topTarget >= body.radius ? Math.abs(body.y - topTarget) : Number.POSITIVE_INFINITY
    const bottomDistance =
      bottomTarget <= bounds.height - body.radius
        ? Math.abs(bottomTarget - body.y)
        : Number.POSITIVE_INFINITY
    const nearestDistance = Math.min(leftDistance, rightDistance, topDistance, bottomDistance)
    if (!Number.isFinite(nearestDistance)) {
      throw resourceRangeError(`obstacle ${obstacle.id} leaves no valid escape side`)
    }
    if (nearestDistance === leftDistance) {
      normalX = -1
      normalY = 0
      distance = body.radius - leftDistance
    } else if (nearestDistance === rightDistance) {
      normalX = 1
      normalY = 0
      distance = body.radius - rightDistance
    } else if (nearestDistance === topDistance) {
      normalX = 0
      normalY = -1
      distance = body.radius - topDistance
    } else {
      normalX = 0
      normalY = 1
      distance = body.radius - bottomDistance
    }
  }

  const penetration = Math.max(0, body.radius - distance)
  body.x += normalX * penetration
  body.y += normalY * penetration
  const normalVelocity = body.vx * normalX + body.vy * normalY
  if (normalVelocity < 0) {
    const reflection = (1 + RESOURCE_WALL_RESTITUTION) * normalVelocity
    body.vx -= reflection * normalX
    body.vy -= reflection * normalY
  }
}

function resolvePairCollision(
  left: ResourceBody,
  right: ResourceBody,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): number {
  const leftXBefore = left.x
  const leftYBefore = left.y
  const rightXBefore = right.x
  const rightYBefore = right.y
  const deltaX = right.x - left.x
  const deltaY = right.y - left.y
  let separation = Math.hypot(deltaX, deltaY)
  const minimumSeparation = left.radius + right.radius
  if (separation > minimumSeparation + GEOMETRY_EPSILON) {
    return 0
  }

  let normalX: number
  let normalY: number
  if (separation <= GEOMETRY_EPSILON) {
    const hash = hashDisplayId(`${left.id}\u0000${right.id}`)
    const angle = (hash / 0x1_0000_0000) * Math.PI * 2
    normalX = Math.cos(angle)
    normalY = Math.sin(angle)
    separation = 0
  } else {
    normalX = deltaX / separation
    normalY = deltaY / separation
  }

  const penetration = Math.max(0, minimumSeparation - separation)
  const positionalCorrection = penetration <= GEOMETRY_EPSILON ? 0 : penetration
  if (left.mode === 'free' && right.mode === 'free') {
    const halfPenetration = positionalCorrection / 2
    left.x -= normalX * halfPenetration
    left.y -= normalY * halfPenetration
    right.x += normalX * halfPenetration
    right.y += normalY * halfPenetration

    const relativeNormalVelocity =
      (right.vx - left.vx) * normalX + (right.vy - left.vy) * normalY
    if (relativeNormalVelocity < 0) {
      const impulse = (-(1 + RESOURCE_RESTITUTION) * relativeNormalVelocity) / 2
      left.vx -= impulse * normalX
      left.vy -= impulse * normalY
      right.vx += impulse * normalX
      right.vy += impulse * normalY
    }
  } else if (left.mode === 'dragged' && right.mode === 'free') {
    right.x += normalX * positionalCorrection
    right.y += normalY * positionalCorrection
    const relativeNormalVelocity =
      (right.vx - left.vx) * normalX + (right.vy - left.vy) * normalY
    if (relativeNormalVelocity < 0) {
      const impulse = (1 + RESOURCE_RESTITUTION) * relativeNormalVelocity
      right.vx -= impulse * normalX
      right.vy -= impulse * normalY
    }
  } else if (left.mode === 'free' && right.mode === 'dragged') {
    left.x -= normalX * positionalCorrection
    left.y -= normalY * positionalCorrection
    const outwardNormalX = -normalX
    const outwardNormalY = -normalY
    const relativeNormalVelocity =
      (left.vx - right.vx) * outwardNormalX +
      (left.vy - right.vy) * outwardNormalY
    if (relativeNormalVelocity < 0) {
      const impulse = (1 + RESOURCE_RESTITUTION) * relativeNormalVelocity
      left.vx -= impulse * outwardNormalX
      left.vy -= impulse * outwardNormalY
    }
  }

  if (left.mode === 'free' && (left.x !== leftXBefore || left.y !== leftYBefore)) {
    projectFreeBodyToStaticConstraints(left, bounds, obstacles)
  }
  if (right.mode === 'free' && (right.x !== rightXBefore || right.y !== rightYBefore)) {
    projectFreeBodyToStaticConstraints(right, bounds, obstacles)
  }

  if (bodiesOverlap(left, right)) {
    let locallyResolved = false
    if (left.mode === 'dragged' && right.mode === 'free') {
      locallyResolved = tryPlaceBodyOnPairBoundary(
        right,
        left,
        normalX,
        normalY,
        bounds,
        obstacles,
      )
    } else if (left.mode === 'free' && right.mode === 'dragged') {
      locallyResolved = tryPlaceBodyOnPairBoundary(
        left,
        right,
        -normalX,
        -normalY,
        bounds,
        obstacles,
      )
    } else if (left.mode === 'free' && right.mode === 'free') {
      locallyResolved = tryPlaceBodyOnPairBoundary(
        right,
        left,
        normalX,
        normalY,
        bounds,
        obstacles,
      )
      if (!locallyResolved) {
        locallyResolved = tryPlaceBodyOnPairBoundary(
          left,
          right,
          -normalX,
          -normalY,
          bounds,
          obstacles,
        )
      }
    }
    if (!locallyResolved || bodiesOverlap(left, right)) {
      throw resourceRangeError(`pair ${left.id}/${right.id} cannot be resolved locally`)
    }
  }

  let moved = 0
  if (left.x !== leftXBefore || left.y !== leftYBefore) {
    moved |= PAIR_LEFT_MOVED
  }
  if (right.x !== rightXBefore || right.y !== rightYBefore) {
    moved |= PAIR_RIGHT_MOVED
  }
  return moved | PAIR_CONTACT
}

function bodySatisfiesStaticConstraints(
  body: ResourceBody,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): boolean {
  return circleSatisfiesStaticConstraints(
    body.x,
    body.y,
    body.radius,
    bounds,
    obstacles,
  )
}

function circleSatisfiesStaticConstraints(
  x: number,
  y: number,
  radius: number,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): boolean {
  if (
    x < radius - GEOMETRY_EPSILON ||
    x > bounds.width - radius + GEOMETRY_EPSILON ||
    y < radius - GEOMETRY_EPSILON ||
    y > bounds.height - radius + GEOMETRY_EPSILON
  ) {
    return false
  }
  for (const obstacle of obstacles) {
    if (circleOverlapsObstacle(x, y, radius, obstacle)) {
      return false
    }
  }
  return true
}

function rigidCandidateStatus(
  initialX: number,
  initialY: number,
  candidateX: number,
  candidateY: number,
  radius: number,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): number {
  let status =
    candidateX !== initialX || candidateY !== initialY ? RIGID_CANDIDATE_PROGRESS : 0
  if (
    Number.isFinite(candidateX) &&
    Number.isFinite(candidateY) &&
    circleSatisfiesStaticConstraints(candidateX, candidateY, radius, bounds, obstacles)
  ) {
    status |= RIGID_CANDIDATE_VALID
  }
  return status
}

function directionFallsWithinContactCone(
  directionX: number,
  directionY: number,
  lowerX: number,
  lowerY: number,
  upperX: number,
  upperY: number,
): boolean {
  return (
    lowerX * directionY - lowerY * directionX >= -CONTACT_ANGLE_EPSILON &&
    directionX * upperY - directionY * upperX >= -CONTACT_ANGLE_EPSILON
  )
}

function projectFreeBodyToStaticConstraints(
  body: ResourceBody,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): void {
  const vx = body.vx
  const vy = body.vy
  for (let pass = 0; pass <= obstacles.length; pass += 1) {
    body.x = clamp(body.x, body.radius, bounds.width - body.radius)
    body.y = clamp(body.y, body.radius, bounds.height - body.radius)
    for (const obstacle of obstacles) {
      resolveObstacleCollision(body, obstacle, bounds)
    }
    if (bodySatisfiesStaticConstraints(body, bounds, obstacles)) {
      body.vx = vx
      body.vy = vy
      return
    }
  }
  body.vx = vx
  body.vy = vy
  throw resourceRangeError(`body ${body.id} cannot satisfy static constraints`)
}

function tryPairBoundaryCandidate(
  body: ResourceBody,
  anchor: ResourceBody,
  directionX: number,
  directionY: number,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): boolean {
  const separation = body.radius + anchor.radius
  const x = anchor.x + directionX * separation
  const y = anchor.y + directionY * separation
  if (!circleSatisfiesStaticConstraints(x, y, body.radius, bounds, obstacles)) {
    return false
  }
  body.x = x
  body.y = y
  return true
}

function tryPlaceBodyOnPairBoundary(
  body: ResourceBody,
  anchor: ResourceBody,
  preferredX: number,
  preferredY: number,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): boolean {
  return (
    tryPairBoundaryCandidate(body, anchor, preferredX, preferredY, bounds, obstacles) ||
    tryPairBoundaryCandidate(body, anchor, -preferredX, -preferredY, bounds, obstacles) ||
    tryPairBoundaryCandidate(body, anchor, -preferredY, preferredX, bounds, obstacles) ||
    tryPairBoundaryCandidate(body, anchor, preferredY, -preferredX, bounds, obstacles)
  )
}

function bodiesOverlap(left: ResourceBody, right: ResourceBody): boolean {
  const deltaX = right.x - left.x
  const deltaY = right.y - left.y
  const minimumSeparation = left.radius + right.radius - SEPARATION_TOLERANCE
  return deltaX * deltaX + deltaY * deltaY < minimumSeparation * minimumSeparation
}

function findContactComponent(parents: Int32Array, index: number): number {
  let root = index
  while (parents[root] !== root) {
    root = parents[root]
  }
  let current = index
  while (parents[current] !== current) {
    const next = parents[current]
    parents[current] = root
    current = next
  }
  return root
}

function unionContactComponents(
  parents: Int32Array,
  leftIndex: number,
  rightIndex: number,
): void {
  const leftRoot = findContactComponent(parents, leftIndex)
  const rightRoot = findContactComponent(parents, rightIndex)
  if (leftRoot === rightRoot) {
    return
  }
  if (leftRoot < rightRoot) {
    parents[rightRoot] = leftRoot
  } else {
    parents[leftRoot] = rightRoot
  }
}

function capBodySpeed(body: ResourceBody): void {
  const speed = Math.hypot(body.vx, body.vy)
  if (speed > RESOURCE_MAX_SPEED) {
    const scale = RESOURCE_MAX_SPEED / speed
    body.vx *= scale
    body.vy *= scale
  }
}

function assertFiniteBody(body: ResourceBody): void {
  if (
    !Number.isFinite(body.x) ||
    !Number.isFinite(body.y) ||
    !Number.isFinite(body.vx) ||
    !Number.isFinite(body.vy)
  ) {
    throw resourceRangeError(`body ${body.id} produced non-finite motion`)
  }
}

function applyDeterministicContactExpansion(
  bodies: ResourceBody[],
  cascadeBodies: Uint8Array,
  contactParents: Int32Array,
  initialPositions: Float64Array,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
  deltaSeconds: number,
): void {
  const COMPONENT_COUNT = 0
  const COMPONENT_CENTER_X = 1
  const COMPONENT_CENTER_Y = 2
  const COMPONENT_MIN_DRIFT_X = 3
  const COMPONENT_MAX_DRIFT_X = 4
  const COMPONENT_MIN_DRIFT_Y = 5
  const COMPONENT_MAX_DRIFT_Y = 6
  const COMPONENT_DRIFT_X = 7
  const COMPONENT_DRIFT_Y = 8
  const COMPONENT_MAX_BASIS_SQUARED = 9
  const COMPONENT_SCALE = 10
  const COMPONENT_RIGID_FALLBACK_MASK = 11
  const COMPONENT_RIGID_FALLBACK_VX = 12
  const COMPONENT_RIGID_FALLBACK_VY = 13
  const COMPONENT_CONTACT_NORMAL_COUNT = 14
  const COMPONENT_CONTACT_NORMAL_ANCHOR = 15
  const COMPONENT_CONTACT_MIN_POSITIVE_PI = 16
  const COMPONENT_CONTACT_MAX_POSITIVE_PI = 17
  const COMPONENT_CONTACT_MIN_NEGATIVE_PI = 18
  const COMPONENT_CONTACT_MAX_NEGATIVE_PI = 19
  const COMPONENT_CONTINUOUS_INTERIOR_X = 20
  const COMPONENT_CONTINUOUS_INTERIOR_Y = 21
  const COMPONENT_CONTINUOUS_LOWER_X = 22
  const COMPONENT_CONTINUOUS_LOWER_Y = 23
  const COMPONENT_CONTINUOUS_UPPER_X = 24
  const COMPONENT_CONTINUOUS_UPPER_Y = 25
  const COMPONENT_CONTINUOUS_FALLBACK_MASK = 26
  const COMPONENT_CONTACT_FIXED_FALLBACK_MASK = 27
  const COMPONENT_RIGID_PROGRESS_MASK = 28
  const COMPONENT_CONTINUOUS_PROGRESS_MASK = 29
  const COMPONENT_STAT_STRIDE = 30
  const componentStats = new Float64Array(bodies.length * COMPONENT_STAT_STRIDE)
  const recordContactNormal = (offset: number, normalX: number, normalY: number): void => {
    const angle = Math.atan2(normalY, normalX)
    const count = componentStats[offset + COMPONENT_CONTACT_NORMAL_COUNT]
    if (count === 0) {
      componentStats[offset + COMPONENT_CONTACT_NORMAL_COUNT] = 1
      componentStats[offset + COMPONENT_CONTACT_NORMAL_ANCHOR] = angle
      return
    }

    let relativeAngle = angle - componentStats[offset + COMPONENT_CONTACT_NORMAL_ANCHOR]
    if (relativeAngle <= -Math.PI) {
      relativeAngle += Math.PI * 2
    } else if (relativeAngle > Math.PI) {
      relativeAngle -= Math.PI * 2
    }
    const isAntipodal =
      Math.abs(Math.abs(relativeAngle) - Math.PI) <= CONTACT_ANGLE_EPSILON
    const positivePiAngle = isAntipodal ? Math.PI : relativeAngle
    const negativePiAngle = isAntipodal ? -Math.PI : relativeAngle
    componentStats[offset + COMPONENT_CONTACT_MIN_POSITIVE_PI] = Math.min(
      componentStats[offset + COMPONENT_CONTACT_MIN_POSITIVE_PI],
      positivePiAngle,
    )
    componentStats[offset + COMPONENT_CONTACT_MAX_POSITIVE_PI] = Math.max(
      componentStats[offset + COMPONENT_CONTACT_MAX_POSITIVE_PI],
      positivePiAngle,
    )
    componentStats[offset + COMPONENT_CONTACT_MIN_NEGATIVE_PI] = Math.min(
      componentStats[offset + COMPONENT_CONTACT_MIN_NEGATIVE_PI],
      negativePiAngle,
    )
    componentStats[offset + COMPONENT_CONTACT_MAX_NEGATIVE_PI] = Math.max(
      componentStats[offset + COMPONENT_CONTACT_MAX_NEGATIVE_PI],
      negativePiAngle,
    )
    componentStats[offset + COMPONENT_CONTACT_NORMAL_COUNT] = count + 1
  }

  for (let index = 0; index < bodies.length; index += 1) {
    if (cascadeBodies[index] === 0) {
      continue
    }
    const root = findContactComponent(contactParents, index)
    const offset = root * COMPONENT_STAT_STRIDE
    componentStats[offset + COMPONENT_COUNT] += 1
    componentStats[offset + COMPONENT_CENTER_X] += initialPositions[index * 2]
    componentStats[offset + COMPONENT_CENTER_Y] += initialPositions[index * 2 + 1]
  }

  for (let root = 0; root < bodies.length; root += 1) {
    const offset = root * COMPONENT_STAT_STRIDE
    const count = componentStats[offset + COMPONENT_COUNT]
    if (count <= 1) {
      continue
    }
    componentStats[offset + COMPONENT_CENTER_X] /= count
    componentStats[offset + COMPONENT_CENTER_Y] /= count
    componentStats[offset + COMPONENT_MIN_DRIFT_X] = Number.NEGATIVE_INFINITY
    componentStats[offset + COMPONENT_MAX_DRIFT_X] = Number.POSITIVE_INFINITY
    componentStats[offset + COMPONENT_MIN_DRIFT_Y] = Number.NEGATIVE_INFINITY
    componentStats[offset + COMPONENT_MAX_DRIFT_Y] = Number.POSITIVE_INFINITY
  }

  for (let index = 0; index < bodies.length; index += 1) {
    if (cascadeBodies[index] === 0) {
      continue
    }
    const root = findContactComponent(contactParents, index)
    const offset = root * COMPONENT_STAT_STRIDE
    if (componentStats[offset + COMPONENT_COUNT] <= 1) {
      continue
    }
    const centerX = componentStats[offset + COMPONENT_CENTER_X]
    const centerY = componentStats[offset + COMPONENT_CENTER_Y]
    const deltaX = initialPositions[index * 2] - centerX
    const deltaY = initialPositions[index * 2 + 1] - centerY
    const body = bodies[index]
    if (body.x <= body.radius + GEOMETRY_EPSILON) {
      componentStats[offset + COMPONENT_MIN_DRIFT_X] = Math.max(
        componentStats[offset + COMPONENT_MIN_DRIFT_X],
        -deltaX,
      )
    }
    if (body.x >= bounds.width - body.radius - GEOMETRY_EPSILON) {
      componentStats[offset + COMPONENT_MAX_DRIFT_X] = Math.min(
        componentStats[offset + COMPONENT_MAX_DRIFT_X],
        -deltaX,
      )
    }
    if (body.y <= body.radius + GEOMETRY_EPSILON) {
      componentStats[offset + COMPONENT_MIN_DRIFT_Y] = Math.max(
        componentStats[offset + COMPONENT_MIN_DRIFT_Y],
        -deltaY,
      )
    }
    if (body.y >= bounds.height - body.radius - GEOMETRY_EPSILON) {
      componentStats[offset + COMPONENT_MAX_DRIFT_Y] = Math.min(
        componentStats[offset + COMPONENT_MAX_DRIFT_Y],
        -deltaY,
      )
    }
  }

  for (let root = 0; root < bodies.length; root += 1) {
    const offset = root * COMPONENT_STAT_STRIDE
    if (componentStats[offset + COMPONENT_COUNT] <= 1) {
      continue
    }
    const minimumDriftX = componentStats[offset + COMPONENT_MIN_DRIFT_X]
    const maximumDriftX = componentStats[offset + COMPONENT_MAX_DRIFT_X]
    const minimumDriftY = componentStats[offset + COMPONENT_MIN_DRIFT_Y]
    const maximumDriftY = componentStats[offset + COMPONENT_MAX_DRIFT_Y]
    // Opposing wall contacts can make the radial common-drift interval empty.
    // Keep that basis safe at zero; a bounded rigid alternative is considered below.
    componentStats[offset + COMPONENT_DRIFT_X] =
      minimumDriftX <= maximumDriftX
        ? clamp(0, minimumDriftX, maximumDriftX)
        : 0
    componentStats[offset + COMPONENT_DRIFT_Y] =
      minimumDriftY <= maximumDriftY
        ? clamp(0, minimumDriftY, maximumDriftY)
        : 0
  }

  // A saved position may be exactly tangent to an obstacle. Scaling an inward
  // radial basis never makes that direction statically valid, so project each
  // component's common drift into the tangent's outward half-plane first.
  // This is bounded O(component bodies * obstacles), not another body-pair pass.
  for (let pass = 0; pass < MAX_CONTACT_DRIFT_PROJECTION_PASSES; pass += 1) {
    let driftChanged = false
    for (let index = 0; index < bodies.length; index += 1) {
      if (cascadeBodies[index] === 0) {
        continue
      }
      const root = findContactComponent(contactParents, index)
      const offset = root * COMPONENT_STAT_STRIDE
      if (componentStats[offset + COMPONENT_COUNT] <= 1) {
        continue
      }
      const initialX = initialPositions[index * 2]
      const initialY = initialPositions[index * 2 + 1]
      const deltaFromCenterX = initialX - componentStats[offset + COMPONENT_CENTER_X]
      const deltaFromCenterY = initialY - componentStats[offset + COMPONENT_CENTER_Y]
      for (const obstacle of obstacles) {
        const obstacleDeltaX = initialX - clamp(initialX, obstacle.left, obstacle.right)
        const obstacleDeltaY = initialY - clamp(initialY, obstacle.top, obstacle.bottom)
        const obstacleDistanceSquared =
          obstacleDeltaX * obstacleDeltaX + obstacleDeltaY * obstacleDeltaY
        const radiusSquared = bodies[index].radius * bodies[index].radius
        if (Math.abs(obstacleDistanceSquared - radiusSquared) > GEOMETRY_EPSILON) {
          continue
        }
        const driftX = componentStats[offset + COMPONENT_DRIFT_X]
        const driftY = componentStats[offset + COMPONENT_DRIFT_Y]
        const outwardMotion =
          (deltaFromCenterX + driftX) * obstacleDeltaX +
          (deltaFromCenterY + driftY) * obstacleDeltaY
        if (outwardMotion >= -GEOMETRY_EPSILON) {
          continue
        }
        const correction = -outwardMotion / obstacleDistanceSquared
        const correctedDriftX = driftX + obstacleDeltaX * correction
        const correctedDriftY = driftY + obstacleDeltaY * correction
        componentStats[offset + COMPONENT_DRIFT_X] = clamp(
          correctedDriftX,
          componentStats[offset + COMPONENT_MIN_DRIFT_X],
          componentStats[offset + COMPONENT_MAX_DRIFT_X],
        )
        componentStats[offset + COMPONENT_DRIFT_Y] = clamp(
          correctedDriftY,
          componentStats[offset + COMPONENT_MIN_DRIFT_Y],
          componentStats[offset + COMPONENT_MAX_DRIFT_Y],
        )
        driftChanged = true
      }
    }
    if (!driftChanged) {
      break
    }
  }

  for (let index = 0; index < bodies.length; index += 1) {
    if (cascadeBodies[index] === 0) {
      continue
    }
    const root = findContactComponent(contactParents, index)
    const offset = root * COMPONENT_STAT_STRIDE
    if (componentStats[offset + COMPONENT_COUNT] <= 1) {
      continue
    }
    const centerX = componentStats[offset + COMPONENT_CENTER_X]
    const centerY = componentStats[offset + COMPONENT_CENTER_Y]
    const driftX = componentStats[offset + COMPONENT_DRIFT_X]
    const driftY = componentStats[offset + COMPONENT_DRIFT_Y]
    const velocityBasisX = initialPositions[index * 2] - centerX + driftX
    const velocityBasisY = initialPositions[index * 2 + 1] - centerY + driftY
    componentStats[offset + COMPONENT_MAX_BASIS_SQUARED] = Math.max(
      componentStats[offset + COMPONENT_MAX_BASIS_SQUARED],
      velocityBasisX * velocityBasisX + velocityBasisY * velocityBasisY,
    )
  }

  for (let root = 0; root < bodies.length; root += 1) {
    const offset = root * COMPONENT_STAT_STRIDE
    const maximumVelocityBasis = Math.sqrt(
      componentStats[offset + COMPONENT_MAX_BASIS_SQUARED],
    )
    if (maximumVelocityBasis > GEOMETRY_EPSILON) {
      componentStats[offset + COMPONENT_SCALE] =
        RESOURCE_COLLISION_RESPONSE_SPEED / maximumVelocityBasis
    }
  }

  if (deltaSeconds > GEOMETRY_EPSILON) {
    for (let index = 0; index < bodies.length; index += 1) {
      if (cascadeBodies[index] === 0) {
        continue
      }
      const root = findContactComponent(contactParents, index)
      const offset = root * COMPONENT_STAT_STRIDE
      const centerX = componentStats[offset + COMPONENT_CENTER_X]
      const centerY = componentStats[offset + COMPONENT_CENTER_Y]
      const velocityBasisX =
        initialPositions[index * 2] - centerX +
        componentStats[offset + COMPONENT_DRIFT_X]
      const velocityBasisY =
        initialPositions[index * 2 + 1] - centerY +
        componentStats[offset + COMPONENT_DRIFT_Y]
      let candidateScale = componentStats[offset + COMPONENT_SCALE]
      let candidateIsValid = false
      for (
        let attempt = 0;
        attempt <= MAX_CONTACT_EXPANSION_SCALE_HALVINGS;
        attempt += 1
      ) {
        candidateIsValid = circleSatisfiesStaticConstraints(
          initialPositions[index * 2] + velocityBasisX * candidateScale * deltaSeconds,
          initialPositions[index * 2 + 1] +
            velocityBasisY * candidateScale * deltaSeconds,
          bodies[index].radius,
          bounds,
          obstacles,
        )
        if (candidateIsValid) {
          break
        }
        candidateScale *= 0.5
      }
      componentStats[offset + COMPONENT_SCALE] = Math.min(
        componentStats[offset + COMPONENT_SCALE],
        candidateIsValid ? candidateScale : 0,
      )
    }
  }

  // A rigid translation is safe at an exact wall/AABB contact when its direction
  // has a non-negative dot product with that contact's outward normal. In 2-D,
  // those homogeneous half-planes have a non-zero intersection exactly when all
  // active normal angles fit in one closed semicircle. Anchor the signed angles
  // at the first normal and retain both representations of an antipodal normal;
  // this computes the two boundary tangents and their interior bisector in one
  // O(component bodies * obstacles) scan, without another body-pair traversal.
  for (let index = 0; index < bodies.length; index += 1) {
    if (cascadeBodies[index] === 0) {
      continue
    }
    const root = findContactComponent(contactParents, index)
    const offset = root * COMPONENT_STAT_STRIDE
    if (
      componentStats[offset + COMPONENT_COUNT] <= 1 ||
      componentStats[offset + COMPONENT_SCALE] > GEOMETRY_EPSILON
    ) {
      continue
    }
    const initialX = initialPositions[index * 2]
    const initialY = initialPositions[index * 2 + 1]
    const radius = bodies[index].radius
    if (initialX <= radius + GEOMETRY_EPSILON) {
      recordContactNormal(offset, 1, 0)
    }
    if (initialX >= bounds.width - radius - GEOMETRY_EPSILON) {
      recordContactNormal(offset, -1, 0)
    }
    if (initialY <= radius + GEOMETRY_EPSILON) {
      recordContactNormal(offset, 0, 1)
    }
    if (initialY >= bounds.height - radius - GEOMETRY_EPSILON) {
      recordContactNormal(offset, 0, -1)
    }
    for (const obstacle of obstacles) {
      const obstacleDeltaX = initialX - clamp(initialX, obstacle.left, obstacle.right)
      const obstacleDeltaY = initialY - clamp(initialY, obstacle.top, obstacle.bottom)
      const obstacleDistanceSquared =
        obstacleDeltaX * obstacleDeltaX + obstacleDeltaY * obstacleDeltaY
      if (Math.abs(obstacleDistanceSquared - radius * radius) <= GEOMETRY_EPSILON) {
        recordContactNormal(offset, obstacleDeltaX, obstacleDeltaY)
      }
    }
  }

  for (let root = 0; root < bodies.length; root += 1) {
    const offset = root * COMPONENT_STAT_STRIDE
    if (componentStats[offset + COMPONENT_CONTACT_NORMAL_COUNT] === 0) {
      continue
    }
    const positiveSpan =
      componentStats[offset + COMPONENT_CONTACT_MAX_POSITIVE_PI] -
      componentStats[offset + COMPONENT_CONTACT_MIN_POSITIVE_PI]
    const negativeSpan =
      componentStats[offset + COMPONENT_CONTACT_MAX_NEGATIVE_PI] -
      componentStats[offset + COMPONENT_CONTACT_MIN_NEGATIVE_PI]
    let minimumAngle: number
    let maximumAngle: number
    if (positiveSpan <= Math.PI + CONTACT_ANGLE_EPSILON) {
      minimumAngle = componentStats[offset + COMPONENT_CONTACT_MIN_POSITIVE_PI]
      maximumAngle = componentStats[offset + COMPONENT_CONTACT_MAX_POSITIVE_PI]
    } else if (negativeSpan <= Math.PI + CONTACT_ANGLE_EPSILON) {
      minimumAngle = componentStats[offset + COMPONENT_CONTACT_MIN_NEGATIVE_PI]
      maximumAngle = componentStats[offset + COMPONENT_CONTACT_MAX_NEGATIVE_PI]
    } else {
      continue
    }

    const anchorAngle = componentStats[offset + COMPONENT_CONTACT_NORMAL_ANCHOR]
    const lowerBoundaryAngle = anchorAngle + maximumAngle - Math.PI / 2
    const upperBoundaryAngle = anchorAngle + minimumAngle + Math.PI / 2
    const interiorAngle = (lowerBoundaryAngle + upperBoundaryAngle) / 2
    componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_X] = Math.cos(interiorAngle)
    componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_Y] = Math.sin(interiorAngle)
    componentStats[offset + COMPONENT_CONTINUOUS_LOWER_X] = Math.cos(lowerBoundaryAngle)
    componentStats[offset + COMPONENT_CONTINUOUS_LOWER_Y] = Math.sin(lowerBoundaryAngle)
    componentStats[offset + COMPONENT_CONTINUOUS_UPPER_X] = Math.cos(upperBoundaryAngle)
    componentStats[offset + COMPONENT_CONTINUOUS_UPPER_Y] = Math.sin(upperBoundaryAngle)
    const lowerX = componentStats[offset + COMPONENT_CONTINUOUS_LOWER_X]
    const lowerY = componentStats[offset + COMPONENT_CONTINUOUS_LOWER_Y]
    const upperX = componentStats[offset + COMPONENT_CONTINUOUS_UPPER_X]
    const upperY = componentStats[offset + COMPONENT_CONTINUOUS_UPPER_Y]
    let fixedMask = 0
    if (directionFallsWithinContactCone(0, -1, lowerX, lowerY, upperX, upperY)) {
      fixedMask |= RIGID_FALLBACK_UP
    }
    if (directionFallsWithinContactCone(1, 0, lowerX, lowerY, upperX, upperY)) {
      fixedMask |= RIGID_FALLBACK_RIGHT
    }
    if (directionFallsWithinContactCone(0, 1, lowerX, lowerY, upperX, upperY)) {
      fixedMask |= RIGID_FALLBACK_DOWN
    }
    if (directionFallsWithinContactCone(-1, 0, lowerX, lowerY, upperX, upperY)) {
      fixedMask |= RIGID_FALLBACK_LEFT
    }
    if (
      directionFallsWithinContactCone(
        RIGID_FALLBACK_DIAGONAL_COMPONENT,
        -RIGID_FALLBACK_DIAGONAL_COMPONENT,
        lowerX,
        lowerY,
        upperX,
        upperY,
      )
    ) {
      fixedMask |= RIGID_FALLBACK_UP_RIGHT
    }
    if (
      directionFallsWithinContactCone(
        RIGID_FALLBACK_DIAGONAL_COMPONENT,
        RIGID_FALLBACK_DIAGONAL_COMPONENT,
        lowerX,
        lowerY,
        upperX,
        upperY,
      )
    ) {
      fixedMask |= RIGID_FALLBACK_DOWN_RIGHT
    }
    if (
      directionFallsWithinContactCone(
        -RIGID_FALLBACK_DIAGONAL_COMPONENT,
        RIGID_FALLBACK_DIAGONAL_COMPONENT,
        lowerX,
        lowerY,
        upperX,
        upperY,
      )
    ) {
      fixedMask |= RIGID_FALLBACK_DOWN_LEFT
    }
    if (
      directionFallsWithinContactCone(
        -RIGID_FALLBACK_DIAGONAL_COMPONENT,
        -RIGID_FALLBACK_DIAGONAL_COMPONENT,
        lowerX,
        lowerY,
        upperX,
        upperY,
      )
    ) {
      fixedMask |= RIGID_FALLBACK_UP_LEFT
    }
    componentStats[offset + COMPONENT_CONTACT_FIXED_FALLBACK_MASK] = fixedMask
  }

  // A radial basis can be blocked by opposing tangent normals even when the
  // whole component can safely slide as one rigid body. Preserve the stable
  // cardinal/diagonal preference, then test the continuous cone's interior and
  // boundary directions. Static endpoint validation halves the speed until a
  // representable candidate succeeds or every smaller endpoint would round back
  // to its saved position. Rigid translation keeps every saved pair separation
  // exact and requires no unordered-pair revisit.
  if (deltaSeconds > 0) {
    let rigidSpeed = RESOURCE_COLLISION_RESPONSE_SPEED
    while (rigidSpeed > 0) {
      const rigidStep = rigidSpeed * deltaSeconds
      if (rigidStep === 0) {
        break
      }
      const rigidDiagonalSpeed = rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
      const rigidDiagonalStep = rigidDiagonalSpeed * deltaSeconds
      let hasUnresolvedComponent = false
      for (let root = 0; root < bodies.length; root += 1) {
        const offset = root * COMPONENT_STAT_STRIDE
        const contactNormalCount = componentStats[offset + COMPONENT_CONTACT_NORMAL_COUNT]
        const hasContinuousFallback =
          componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_X] !== 0 ||
          componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_Y] !== 0
        const needsFallback =
          componentStats[offset + COMPONENT_COUNT] > 1 &&
          componentStats[offset + COMPONENT_SCALE] <= GEOMETRY_EPSILON &&
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] === 0 &&
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] === 0 &&
          (contactNormalCount === 0 || hasContinuousFallback)
        componentStats[offset + COMPONENT_RIGID_FALLBACK_MASK] = needsFallback
          ? contactNormalCount === 0
            ? RIGID_FALLBACK_ALL
            : componentStats[offset + COMPONENT_CONTACT_FIXED_FALLBACK_MASK]
          : 0
        componentStats[offset + COMPONENT_CONTINUOUS_FALLBACK_MASK] =
          needsFallback && hasContinuousFallback ? CONTINUOUS_FALLBACK_ALL : 0
        componentStats[offset + COMPONENT_RIGID_PROGRESS_MASK] =
          componentStats[offset + COMPONENT_RIGID_FALLBACK_MASK]
        componentStats[offset + COMPONENT_CONTINUOUS_PROGRESS_MASK] =
          componentStats[offset + COMPONENT_CONTINUOUS_FALLBACK_MASK]
        hasUnresolvedComponent ||= needsFallback
      }
      if (!hasUnresolvedComponent) {
        break
      }
      for (let index = 0; index < bodies.length; index += 1) {
        if (cascadeBodies[index] === 0) {
          continue
        }
        const root = findContactComponent(contactParents, index)
        const offset = root * COMPONENT_STAT_STRIDE
        let mask = componentStats[offset + COMPONENT_RIGID_FALLBACK_MASK]
        let continuousMask = componentStats[offset + COMPONENT_CONTINUOUS_FALLBACK_MASK]
        let progressMask = componentStats[offset + COMPONENT_RIGID_PROGRESS_MASK]
        let continuousProgressMask =
          componentStats[offset + COMPONENT_CONTINUOUS_PROGRESS_MASK]
        if (
          mask === 0 &&
          continuousMask === 0 &&
          progressMask === 0 &&
          continuousProgressMask === 0
        ) {
          continue
        }
        const initialX = initialPositions[index * 2]
        const initialY = initialPositions[index * 2 + 1]
        const radius = bodies[index].radius
        let candidateStatus: number
        if (((mask | progressMask) & RIGID_FALLBACK_UP) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX,
            initialY - rigidStep,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_UP
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_UP
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_RIGHT) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX + rigidStep,
            initialY,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_RIGHT
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_RIGHT
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_DOWN) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX,
            initialY + rigidStep,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_DOWN
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_DOWN
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_LEFT) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX - rigidStep,
            initialY,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_LEFT
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_LEFT
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_UP_RIGHT) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX + rigidDiagonalStep,
            initialY - rigidDiagonalStep,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_UP_RIGHT
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_UP_RIGHT
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_DOWN_RIGHT) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX + rigidDiagonalStep,
            initialY + rigidDiagonalStep,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_DOWN_RIGHT
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_DOWN_RIGHT
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_DOWN_LEFT) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX - rigidDiagonalStep,
            initialY + rigidDiagonalStep,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_DOWN_LEFT
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_DOWN_LEFT
          }
        }
        if (((mask | progressMask) & RIGID_FALLBACK_UP_LEFT) !== 0) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX - rigidDiagonalStep,
            initialY - rigidDiagonalStep,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            mask &= ~RIGID_FALLBACK_UP_LEFT
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            progressMask &= ~RIGID_FALLBACK_UP_LEFT
          }
        }
        if (
          ((continuousMask | continuousProgressMask) & CONTINUOUS_FALLBACK_INTERIOR) !== 0
        ) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX +
              rigidSpeed *
                componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_X] *
                deltaSeconds,
            initialY +
              rigidSpeed *
                componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_Y] *
                deltaSeconds,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            continuousMask &= ~CONTINUOUS_FALLBACK_INTERIOR
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            continuousProgressMask &= ~CONTINUOUS_FALLBACK_INTERIOR
          }
        }
        if (
          ((continuousMask | continuousProgressMask) &
            CONTINUOUS_FALLBACK_LOWER_BOUNDARY) !==
          0
        ) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX +
              rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_LOWER_X] * deltaSeconds,
            initialY +
              rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_LOWER_Y] * deltaSeconds,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            continuousMask &= ~CONTINUOUS_FALLBACK_LOWER_BOUNDARY
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            continuousProgressMask &= ~CONTINUOUS_FALLBACK_LOWER_BOUNDARY
          }
        }
        if (
          ((continuousMask | continuousProgressMask) &
            CONTINUOUS_FALLBACK_UPPER_BOUNDARY) !==
          0
        ) {
          candidateStatus = rigidCandidateStatus(
            initialX,
            initialY,
            initialX +
              rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_UPPER_X] * deltaSeconds,
            initialY +
              rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_UPPER_Y] * deltaSeconds,
            radius,
            bounds,
            obstacles,
          )
          if ((candidateStatus & RIGID_CANDIDATE_VALID) === 0) {
            continuousMask &= ~CONTINUOUS_FALLBACK_UPPER_BOUNDARY
          }
          if ((candidateStatus & RIGID_CANDIDATE_PROGRESS) === 0) {
            continuousProgressMask &= ~CONTINUOUS_FALLBACK_UPPER_BOUNDARY
          }
        }
        componentStats[offset + COMPONENT_RIGID_FALLBACK_MASK] = mask
        componentStats[offset + COMPONENT_CONTINUOUS_FALLBACK_MASK] = continuousMask
        componentStats[offset + COMPONENT_RIGID_PROGRESS_MASK] = progressMask
        componentStats[offset + COMPONENT_CONTINUOUS_PROGRESS_MASK] = continuousProgressMask
      }
      let needsSlowerAttempt = false
      for (let root = 0; root < bodies.length; root += 1) {
        const offset = root * COMPONENT_STAT_STRIDE
        const progressMask = componentStats[offset + COMPONENT_RIGID_PROGRESS_MASK]
        const continuousProgressMask =
          componentStats[offset + COMPONENT_CONTINUOUS_PROGRESS_MASK]
        const mask =
          componentStats[offset + COMPONENT_RIGID_FALLBACK_MASK] & progressMask
        const continuousMask =
          componentStats[offset + COMPONENT_CONTINUOUS_FALLBACK_MASK] &
          continuousProgressMask
        if ((mask & RIGID_FALLBACK_UP) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] = -rigidSpeed
        } else if ((mask & RIGID_FALLBACK_RIGHT) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] = rigidSpeed
        } else if ((mask & RIGID_FALLBACK_DOWN) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] = rigidSpeed
        } else if ((mask & RIGID_FALLBACK_LEFT) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] = -rigidSpeed
        } else if ((mask & RIGID_FALLBACK_UP_RIGHT) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            -rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
        } else if ((mask & RIGID_FALLBACK_DOWN_RIGHT) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
        } else if ((mask & RIGID_FALLBACK_DOWN_LEFT) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            -rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
        } else if ((mask & RIGID_FALLBACK_UP_LEFT) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            -rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            -rigidSpeed * RIGID_FALLBACK_DIAGONAL_COMPONENT
        } else if ((continuousMask & CONTINUOUS_FALLBACK_INTERIOR) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_X]
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_INTERIOR_Y]
        } else if ((continuousMask & CONTINUOUS_FALLBACK_LOWER_BOUNDARY) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_LOWER_X]
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_LOWER_Y]
        } else if ((continuousMask & CONTINUOUS_FALLBACK_UPPER_BOUNDARY) !== 0) {
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VX] =
            rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_UPPER_X]
          componentStats[offset + COMPONENT_RIGID_FALLBACK_VY] =
            rigidSpeed * componentStats[offset + COMPONENT_CONTINUOUS_UPPER_Y]
        } else if (progressMask !== 0 || continuousProgressMask !== 0) {
          needsSlowerAttempt = true
        }
      }
      if (!needsSlowerAttempt) {
        break
      }
      const nextRigidSpeed = rigidSpeed * 0.5
      if (!(nextRigidSpeed > 0) || !(nextRigidSpeed < rigidSpeed)) {
        break
      }
      rigidSpeed = nextRigidSpeed
    }
  }

  for (let index = 0; index < bodies.length; index += 1) {
    if (cascadeBodies[index] === 0) {
      continue
    }
    const root = findContactComponent(contactParents, index)
    const offset = root * COMPONENT_STAT_STRIDE
    const scale = componentStats[offset + COMPONENT_SCALE]
    if (scale > GEOMETRY_EPSILON) {
      bodies[index].vx =
        (initialPositions[index * 2] - componentStats[offset + COMPONENT_CENTER_X] +
          componentStats[offset + COMPONENT_DRIFT_X]) *
        scale
      bodies[index].vy =
        (initialPositions[index * 2 + 1] - componentStats[offset + COMPONENT_CENTER_Y] +
          componentStats[offset + COMPONENT_DRIFT_Y]) *
        scale
    } else {
      bodies[index].vx = componentStats[offset + COMPONENT_RIGID_FALLBACK_VX]
      bodies[index].vy = componentStats[offset + COMPONENT_RIGID_FALLBACK_VY]
    }
  }
}

export function stepResourceBodies(
  bodies: ReadonlyMap<string, ResourceBody>,
  boundsInput: ResourceFieldBounds,
  obstaclesInput: readonly ResourceFieldObstacle[],
  deltaSeconds: number,
): Map<string, ResourceBody> {
  const bounds = validateBounds(boundsInput)
  const obstacles = normalizeObstacles(obstaclesInput)
  assertFinite(deltaSeconds, 'deltaSeconds')
  if (deltaSeconds < 0) {
    throw resourceRangeError('deltaSeconds must not be negative')
  }
  const result = cloneAndValidateBodies(bodies, bounds)
  const containsDraggedBody = result.some((body) => body.mode === 'dragged')
  const initialPositions = new Float64Array(result.length * 2)
  const contactParents = new Int32Array(result.length)
  const cascadeBodies = new Uint8Array(result.length)
  const cascadeRoots = new Uint8Array(result.length)
  let inputSatisfiesStaticConstraints = true
  let inputPairsAreValid = true

  for (let index = 0; index < result.length; index += 1) {
    const body = result[index]
    contactParents[index] = index
    initialPositions[index * 2] = body.x
    initialPositions[index * 2 + 1] = body.y
    inputSatisfiesStaticConstraints &&= bodySatisfiesStaticConstraints(
      body,
      bounds,
      obstacles,
    )
    if (body.mode === 'free') {
      body.x += body.vx * deltaSeconds
      body.y += body.vy * deltaSeconds
      reflectAgainstBounds(body, bounds)
      for (const obstacle of obstacles) {
        resolveObstacleCollision(body, obstacle, bounds)
      }
    }
  }

  for (let pass = 0; pass < RESOURCE_COLLISION_PASSES; pass += 1) {
    const isFinalPass = pass === RESOURCE_COLLISION_PASSES - 1
    const visitedBodies = isFinalPass ? new Uint8Array(result.length) : null
    let invalidatedEarlierPair = false
    for (let leftIndex = 0; leftIndex < result.length; leftIndex += 1) {
      const left = result[leftIndex]
      for (let rightIndex = leftIndex + 1; rightIndex < result.length; rightIndex += 1) {
        if (pass === 0 && inputPairsAreValid) {
          const initialDeltaX =
            initialPositions[rightIndex * 2] - initialPositions[leftIndex * 2]
          const initialDeltaY =
            initialPositions[rightIndex * 2 + 1] - initialPositions[leftIndex * 2 + 1]
          const minimumInitialSeparation =
            left.radius + result[rightIndex].radius - SEPARATION_TOLERANCE
          inputPairsAreValid =
            initialDeltaX * initialDeltaX + initialDeltaY * initialDeltaY >=
            minimumInitialSeparation * minimumInitialSeparation
        }
        const moved = resolvePairCollision(
          left,
          result[rightIndex],
          bounds,
          obstacles,
        )
        if ((moved & PAIR_CONTACT) !== 0) {
          unionContactComponents(contactParents, leftIndex, rightIndex)
        } else if (visitedBodies !== null) {
          // If exactly one side of this pair is rolled back after the final pass,
          // its saved/current mixed configuration must remain legal. Fuse both
          // predicates into this existing traversal and union any dependency so
          // the eventual rollback closure cannot create a fresh overlap.
          const right = result[rightIndex]
          const minimumRollbackSeparation =
            left.radius + right.radius - SEPARATION_TOLERANCE
          const minimumRollbackSeparationSquared =
            minimumRollbackSeparation * minimumRollbackSeparation
          const initialLeftToCurrentRightX =
            right.x - initialPositions[leftIndex * 2]
          const initialLeftToCurrentRightY =
            right.y - initialPositions[leftIndex * 2 + 1]
          const currentLeftToInitialRightX =
            initialPositions[rightIndex * 2] - left.x
          const currentLeftToInitialRightY =
            initialPositions[rightIndex * 2 + 1] - left.y
          if (
            initialLeftToCurrentRightX * initialLeftToCurrentRightX +
                initialLeftToCurrentRightY * initialLeftToCurrentRightY <
              minimumRollbackSeparationSquared ||
            currentLeftToInitialRightX * currentLeftToInitialRightX +
                currentLeftToInitialRightY * currentLeftToInitialRightY <
              minimumRollbackSeparationSquared
          ) {
            unionContactComponents(contactParents, leftIndex, rightIndex)
          }
        }
        if (visitedBodies !== null) {
          const leftInvalidatedEarlierPair =
            (moved & PAIR_LEFT_MOVED) !== 0 && visitedBodies[leftIndex] !== 0
          const rightInvalidatedEarlierPair =
            (moved & PAIR_RIGHT_MOVED) !== 0 && visitedBodies[rightIndex] !== 0
          invalidatedEarlierPair ||=
            leftInvalidatedEarlierPair || rightInvalidatedEarlierPair
          if (leftInvalidatedEarlierPair) {
            cascadeBodies[leftIndex] = 1
          }
          if (rightInvalidatedEarlierPair) {
            cascadeBodies[rightIndex] = 1
          }
          visitedBodies[leftIndex] = 1
          visitedBodies[rightIndex] = 1
        }
      }
    }
    // A final-pass cascade cannot be validated without a forbidden third pair
    // traversal. Reject kinematic candidates. For an all-free frame whose input
    // was already valid, conservatively roll only the affected contact components
    // back one frame and give them bounded radial expansion for the next frame.
    if (invalidatedEarlierPair) {
      if (
        containsDraggedBody ||
        !inputSatisfiesStaticConstraints ||
        !inputPairsAreValid
      ) {
        throw resourceRangeError('two collision passes cannot resolve a local cascade')
      }
      for (let index = 0; index < result.length; index += 1) {
        if (cascadeBodies[index] !== 0) {
          cascadeRoots[findContactComponent(contactParents, index)] = 1
        }
      }
      for (let index = 0; index < result.length; index += 1) {
        const belongsToCascade =
          cascadeRoots[findContactComponent(contactParents, index)] !== 0
        cascadeBodies[index] = belongsToCascade ? 1 : 0
        if (belongsToCascade) {
          result[index].x = initialPositions[index * 2]
          result[index].y = initialPositions[index * 2 + 1]
        }
      }
      applyDeterministicContactExpansion(
        result,
        cascadeBodies,
        contactParents,
        initialPositions,
        bounds,
        obstacles,
        deltaSeconds,
      )
    }
  }

  for (const body of result) {
    if (!bodySatisfiesStaticConstraints(body, bounds, obstacles)) {
      throw resourceRangeError(`body ${body.id} violates static constraints`)
    }
    capBodySpeed(body)
    assertFiniteBody(body)
  }
  return new Map(result.map((body) => [body.id, body]))
}

export function dragResourceBody(
  bodies: ReadonlyMap<string, ResourceBody>,
  id: string,
  point: { x: number; y: number },
  boundsInput: ResourceFieldBounds,
  obstaclesInput: readonly ResourceFieldObstacle[],
): Map<string, ResourceBody> {
  const bounds = validateBounds(boundsInput)
  const obstacles = normalizeObstacles(obstaclesInput)
  assertFinite(point.x, 'point.x')
  assertFinite(point.y, 'point.y')
  const result = cloneAndValidateBodies(bodies, bounds)
  const body = result.find((candidate) => candidate.id === id)
  if (body === undefined) {
    return new Map(result.map((candidate) => [candidate.id, candidate]))
  }

  body.x = clamp(point.x, body.radius, bounds.width - body.radius)
  body.y = clamp(point.y, body.radius, bounds.height - body.radius)
  body.vx = 0
  body.vy = 0
  body.mode = 'dragged'
  for (let pass = 0; pass <= obstacles.length; pass += 1) {
    for (const obstacle of obstacles) {
      resolveObstacleCollision(body, obstacle, bounds)
      body.x = clamp(body.x, body.radius, bounds.width - body.radius)
      body.y = clamp(body.y, body.radius, bounds.height - body.radius)
    }
  }
  for (const obstacle of obstacles) {
    if (circleOverlapsObstacle(body.x, body.y, body.radius, obstacle)) {
      throw resourceRangeError('drag point cannot be resolved outside obstacles')
    }
  }
  assertFiniteBody(body)
  return new Map(result.map((candidate) => [candidate.id, candidate]))
}

export function nearestResourceInDirection(
  bodies: ReadonlyMap<string, ResourceBody>,
  fromId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): string | null {
  const origin = bodies.get(fromId)
  if (origin === undefined) {
    return null
  }

  let bestId: string | null = null
  let bestAngularPenalty = Number.POSITIVE_INFINITY
  let bestDistance = Number.POSITIVE_INFINITY
  const entries = [...bodies.entries()].sort(([left], [right]) => left.localeCompare(right))
  for (const [id, candidate] of entries) {
    if (id === fromId) {
      continue
    }
    const deltaX = candidate.x - origin.x
    const deltaY = candidate.y - origin.y
    let forward: number
    let perpendicular: number
    if (direction === 'left') {
      forward = -deltaX
      perpendicular = deltaY
    } else if (direction === 'right') {
      forward = deltaX
      perpendicular = deltaY
    } else if (direction === 'up') {
      forward = -deltaY
      perpendicular = deltaX
    } else {
      forward = deltaY
      perpendicular = deltaX
    }
    if (forward <= 0) {
      continue
    }
    const candidateDistance = Math.hypot(deltaX, deltaY)
    const angularPenalty = Math.abs(perpendicular) / candidateDistance
    if (
      angularPenalty < bestAngularPenalty - GEOMETRY_EPSILON ||
      (Math.abs(angularPenalty - bestAngularPenalty) <= GEOMETRY_EPSILON &&
        (candidateDistance < bestDistance - GEOMETRY_EPSILON ||
          (Math.abs(candidateDistance - bestDistance) <= GEOMETRY_EPSILON &&
            (bestId === null || id.localeCompare(bestId) < 0))))
    ) {
      bestId = id
      bestAngularPenalty = angularPenalty
      bestDistance = candidateDistance
    }
  }
  return bestId
}

function resourceGeometryIsEqual(
  leftBounds: ResourceFieldBounds,
  leftRadius: number,
  leftObstacles: readonly ResourceFieldObstacle[],
  rightBounds: ResourceFieldBounds,
  rightRadius: number,
  rightObstacles: readonly ResourceFieldObstacle[],
): boolean {
  if (
    leftBounds.width !== rightBounds.width ||
    leftBounds.height !== rightBounds.height ||
    leftRadius !== rightRadius ||
    leftObstacles.length !== rightObstacles.length
  ) {
    return false
  }
  for (let index = 0; index < leftObstacles.length; index += 1) {
    const left = leftObstacles[index]
    const right = rightObstacles[index]
    if (
      left.id !== right.id ||
      left.left !== right.left ||
      left.top !== right.top ||
      left.right !== right.right ||
      left.bottom !== right.bottom
    ) {
      return false
    }
  }
  return true
}

export class ResourceMotionController {
  private bodies: Map<string, ResourceBody>
  private bounds: ResourceFieldBounds
  private radius: number
  private obstacles: ResourceFieldObstacle[]
  private reducedMotion: boolean
  private disposed = false

  constructor(options: ResourceMotionControllerOptions) {
    this.bounds = validateBounds(options.bounds)
    this.radius = validateRadius(options.radius, this.bounds)
    this.obstacles = normalizeObstacles(options.obstacles ?? [])
    this.reducedMotion = options.reducedMotion ?? false
    this.bodies = this.reducedMotion
      ? stableResourceLayout(options.ids, this.bounds, this.radius, this.obstacles)
      : createResourceBodies(options.ids, this.bounds, this.radius, this.obstacles)
  }

  setIds(ids: readonly string[]): void {
    if (this.disposed) {
      return
    }
    this.bodies = this.reducedMotion
      ? stableResourceLayout(ids, this.bounds, this.radius, this.obstacles)
      : createResourceBodies(ids, this.bounds, this.radius, this.obstacles)
  }

  setGeometry(
    bounds: ResourceFieldBounds,
    radius: number,
    obstacles: readonly ResourceFieldObstacle[],
  ): void {
    if (this.disposed) {
      return
    }
    const nextBounds = validateBounds(bounds)
    const nextRadius = validateRadius(radius, nextBounds)
    const nextObstacles = normalizeObstacles(obstacles)
    if (
      resourceGeometryIsEqual(
        this.bounds,
        this.radius,
        this.obstacles,
        nextBounds,
        nextRadius,
        nextObstacles,
      )
    ) {
      return
    }
    const ids = [...this.bodies.keys()]
    const nextBodies = stableResourceLayout(ids, nextBounds, nextRadius, nextObstacles)
    if (!this.reducedMotion) {
      for (const [id, nextBody] of nextBodies) {
        const currentBody = this.bodies.get(id)
        if (currentBody?.mode === 'dragged') {
          continue
        }
        if (currentBody !== undefined && Math.hypot(currentBody.vx, currentBody.vy) > GEOMETRY_EPSILON) {
          nextBody.vx = currentBody.vx
          nextBody.vy = currentBody.vy
        } else {
          const velocity = deterministicDisplayVelocity(id)
          nextBody.vx = velocity.vx
          nextBody.vy = velocity.vy
        }
        capBodySpeed(nextBody)
      }
    }

    this.bounds = nextBounds
    this.radius = nextRadius
    this.obstacles = nextObstacles
    this.bodies = nextBodies
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.disposed || reducedMotion === this.reducedMotion) {
      return
    }
    if (reducedMotion) {
      const nextBodies = stableResourceLayout(
        [...this.bodies.keys()],
        this.bounds,
        this.radius,
        this.obstacles,
      )
      this.reducedMotion = true
      this.bodies = nextBodies
      return
    }

    const nextBodies = new Map<string, ResourceBody>()
    for (const [id, body] of this.bodies) {
      const velocity = deterministicDisplayVelocity(id)
      nextBodies.set(id, {
        ...body,
        vx: velocity.vx,
        vy: velocity.vy,
        mode: 'free',
      })
    }
    this.reducedMotion = false
    this.bodies = nextBodies
  }

  beginDrag(id: string): boolean {
    if (this.disposed) {
      return false
    }
    const body = this.bodies.get(id)
    if (body === undefined || body.mode === 'dragged') {
      return false
    }
    body.mode = 'dragged'
    body.vx = 0
    body.vy = 0
    return true
  }

  dragTo(id: string, point: { x: number; y: number }): boolean {
    if (this.disposed || this.bodies.get(id)?.mode !== 'dragged') {
      return false
    }
    try {
      const candidate = dragResourceBody(
        this.bodies,
        id,
        point,
        this.bounds,
        this.obstacles,
      )
      this.bodies = stepResourceBodies(candidate, this.bounds, this.obstacles, 0)
      return true
    } catch (error) {
      if (error instanceof RangeError) {
        return false
      }
      throw error
    }
  }

  endDrag(id: string, releaseVelocity: { x: number; y: number } = { x: 0, y: 0 }): boolean {
    if (this.disposed) {
      return false
    }
    const body = this.bodies.get(id)
    if (body === undefined || body.mode !== 'dragged') {
      return false
    }
    assertFinite(releaseVelocity.x, 'releaseVelocity.x')
    assertFinite(releaseVelocity.y, 'releaseVelocity.y')
    if (this.reducedMotion) {
      this.bodies = stableResourceLayout(
        [...this.bodies.keys()],
        this.bounds,
        this.radius,
        this.obstacles,
      )
      return true
    }
    body.mode = 'free'
    body.vx = releaseVelocity.x
    body.vy = releaseVelocity.y
    capBodySpeed(body)
    return true
  }

  cancelDrag(id: string): boolean {
    if (this.disposed) {
      return false
    }
    const body = this.bodies.get(id)
    if (body === undefined || body.mode !== 'dragged') {
      return false
    }
    if (this.reducedMotion) {
      this.bodies = stableResourceLayout(
        [...this.bodies.keys()],
        this.bounds,
        this.radius,
        this.obstacles,
      )
      return true
    }
    body.mode = 'free'
    body.vx = 0
    body.vy = 0
    return true
  }

  step(deltaSeconds: number): void {
    if (this.disposed || this.reducedMotion) {
      return
    }
    this.bodies = stepResourceBodies(
      this.bodies,
      this.bounds,
      this.obstacles,
      deltaSeconds,
    )
  }

  nearest(
    fromId: string,
    direction: 'left' | 'right' | 'up' | 'down',
  ): string | null {
    if (this.disposed) {
      return null
    }
    return nearestResourceInDirection(this.bodies, fromId, direction)
  }

  snapshot(): ResourceMotionSnapshot {
    const bodies = new Map<string, ResourceBody>()
    for (const [id, body] of this.bodies) {
      bodies.set(id, { ...body })
    }
    return {
      bodies,
      bounds: { ...this.bounds },
    }
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.bodies.clear()
    this.obstacles = []
  }
}
