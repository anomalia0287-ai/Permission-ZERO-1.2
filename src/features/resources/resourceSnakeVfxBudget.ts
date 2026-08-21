export type ResourceSnakeVfxKind =
  | 'telegraph'
  | 'contact'
  | 'power-cut'
  | 'explosion'
  | 'fragment'

export type ResourceSnakeVfxPriority =
  | 'critical'
  | 'gameplay'
  | 'accent'
  | 'ambient'

export interface ResourceSnakeVfxCandidate {
  id: string
  kind: ResourceSnakeVfxKind
  startedAtMs: number
  priority: ResourceSnakeVfxPriority
}

export const RESOURCE_SNAKE_VFX_BUDGET = Object.freeze({
  total: 37,
  reducedTotal: 10,
  telegraph: 2,
  contact: 12,
  powerCut: 8,
  explosion: 4,
  fragment: 36,
  reduced: Object.freeze({
    telegraph: 2,
    contact: 4,
    powerCut: 4,
    explosion: 2,
    fragment: 0,
  }),
})

const PRIORITY_WEIGHT: Readonly<Record<ResourceSnakeVfxPriority, number>> = {
  critical: 3,
  gameplay: 2,
  accent: 1,
  ambient: 0,
}

const NORMAL_KIND_LIMIT: Readonly<Record<ResourceSnakeVfxKind, number>> = {
  telegraph: RESOURCE_SNAKE_VFX_BUDGET.telegraph,
  contact: RESOURCE_SNAKE_VFX_BUDGET.contact,
  'power-cut': RESOURCE_SNAKE_VFX_BUDGET.powerCut,
  explosion: RESOURCE_SNAKE_VFX_BUDGET.explosion,
  fragment: RESOURCE_SNAKE_VFX_BUDGET.fragment,
}

const REDUCED_KIND_LIMIT: Readonly<Record<ResourceSnakeVfxKind, number>> = {
  telegraph: RESOURCE_SNAKE_VFX_BUDGET.reduced.telegraph,
  contact: RESOURCE_SNAKE_VFX_BUDGET.reduced.contact,
  'power-cut': RESOURCE_SNAKE_VFX_BUDGET.reduced.powerCut,
  explosion: RESOURCE_SNAKE_VFX_BUDGET.reduced.explosion,
  fragment: RESOURCE_SNAKE_VFX_BUDGET.reduced.fragment,
}

const VFX_KINDS = new Set<ResourceSnakeVfxKind>([
  'telegraph',
  'contact',
  'power-cut',
  'explosion',
  'fragment',
])

const VFX_PRIORITIES = new Set<ResourceSnakeVfxPriority>([
  'critical',
  'gameplay',
  'accent',
  'ambient',
])

function candidateIsValid(
  candidate: ResourceSnakeVfxCandidate,
): candidate is ResourceSnakeVfxCandidate {
  return candidate.id.trim().length > 0
    && Number.isFinite(candidate.startedAtMs)
    && VFX_KINDS.has(candidate.kind)
    && VFX_PRIORITIES.has(candidate.priority)
}

function compareSelectionPriority(
  left: ResourceSnakeVfxCandidate,
  right: ResourceSnakeVfxCandidate,
): number {
  return PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority]
    || right.startedAtMs - left.startedAtMs
    || left.id.localeCompare(right.id)
}

/**
 * Selects a bounded, deterministic VFX set. The function owns no persistent
 * resources, so pause/reset/death cleanup is idempotent: omitted candidates
 * disappear on the next presentation projection.
 */
export function selectResourceSnakeVfx<T extends ResourceSnakeVfxCandidate>(
  candidates: readonly T[],
  reducedMotion: boolean,
): T[] {
  const kindLimits = reducedMotion ? REDUCED_KIND_LIMIT : NORMAL_KIND_LIMIT
  const totalLimit = reducedMotion
    ? RESOURCE_SNAKE_VFX_BUDGET.reducedTotal
    : RESOURCE_SNAKE_VFX_BUDGET.total
  const seenIds = new Set<string>()
  const kindCounts = new Map<ResourceSnakeVfxKind, number>()
  const selected: T[] = []

  for (const candidate of [...candidates].filter(candidateIsValid).sort(compareSelectionPriority)) {
    if (seenIds.has(candidate.id)) continue
    const count = kindCounts.get(candidate.kind) ?? 0
    if (count >= kindLimits[candidate.kind]) continue
    seenIds.add(candidate.id)
    kindCounts.set(candidate.kind, count + 1)
    selected.push(candidate)
    if (selected.length >= totalLimit) break
  }

  return selected
}
