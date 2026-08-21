import {
  COMPANY_CATEGORIES,
  type CompanyCategory,
  type ResourceState,
} from '../../game/model'
import type {
  ResourceSnakeRoundState,
  SnakeEnemySetup,
  SnakeRoundSetup,
} from './resourceSnakeRuntime'
import {
  cyanEncounterStageForProgress,
  cyanEnemySpeed,
  cyanLightcycleProfile,
  type CyanEncounterStage,
  type CyanLightcycleProfile,
  type SnakeDoctrine,
} from './resourceSnakeCyanProfile'

export const SNAKE_CATEGORY_COLORS = {
  reasoning: '#f06a43',
  memory: '#4f8df7',
  fluency: '#e8bd59',
} as const

export interface SnakeResourceCandidate {
  blockId: string
  origin: CompanyCategory
  contribution: 'normal' | 'disguised'
  hiddenBomb: boolean
}

export interface SnakeShuffleBagState {
  cycle: number
  remainingCategories: CompanyCategory[]
}

export interface CreateSnakeEncounterInput {
  campaignSeed: string
  roundOrdinal: number
  successfulDeposits: number
  candidates: readonly SnakeResourceCandidate[]
  bag: SnakeShuffleBagState
}

export interface SnakePlannerProfile {
  lookaheadMs: 1_000 | 1_400 | 1_600 | 1_800 | 2_000 | 2_200 | 2_500
  candidateCount: 48 | 72 | 96
  planningHz: 6 | 7 | 8 | 9 | 10 | 12 | 14
  commitMs: 180 | 220 | 260 | 320 | 360 | 420
  rolloutStepMs: 50
}

export interface SnakeEncounterResult {
  setup: SnakeRoundSetup | null
  bag: SnakeShuffleBagState
  disabledReason: 'no-eligible-resource' | null
  stage: CyanEncounterStage
  doctrine: SnakeDoctrine
  cyanProfile: CyanLightcycleProfile
  plannerProfile: SnakePlannerProfile
}

interface CyanEncounterConfiguration {
  enemyCount: 1 | 2
  maximumIntegrity: 30 | 50 | 65
}

const ENCOUNTER_CONFIGURATION: Readonly<
  Record<CyanEncounterStage, CyanEncounterConfiguration>
> = Object.freeze({
  'cyan-intro': Object.freeze({ enemyCount: 1, maximumIntegrity: 30 }),
  'cyan-advanced': Object.freeze({ enemyCount: 1, maximumIntegrity: 65 }),
  'cyan-dual-role': Object.freeze({ enemyCount: 2, maximumIntegrity: 50 }),
})

function hash(value: string): number {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return result >>> 0
}

function isCompanyCategory(value: unknown): value is CompanyCategory {
  return COMPANY_CATEGORIES.includes(value as CompanyCategory)
}

/**
 * Establishes the authoritative campaign-to-encounter boundary.  Compact
 * candidates intentionally do not carry location or company-membership proof.
 */
export function selectEligibleSnakeResourceCandidates(
  resources: Pick<ResourceState, 'company' | 'blocks'>,
): SnakeResourceCandidate[] {
  return Object.entries(resources.blocks)
    .filter(([blockId, block]) => (
      blockId === block.id
      && block.location.kind === 'company'
      && block.contribution === 'normal'
      && isCompanyCategory(block.origin)
      && resources.company[block.location.category][block.location.cellIndex] === block.id
    ))
    .map(([, block]) => ({
      blockId: block.id,
      origin: block.origin as CompanyCategory,
      contribution: block.contribution,
      hiddenBomb: block.hiddenBomb,
    }))
    .sort((left, right) => left.blockId.localeCompare(right.blockId))
}

function compactEligibleCandidates(
  candidates: readonly SnakeResourceCandidate[],
): SnakeResourceCandidate[] {
  const seenBlockIds = new Set<string>()
  return [...candidates]
    .filter((candidate) => candidate.contribution === 'normal' && isCompanyCategory(candidate.origin))
    .sort((left, right) => (
      left.blockId.localeCompare(right.blockId) || left.origin.localeCompare(right.origin)
    ))
    .filter((candidate) => {
      if (seenBlockIds.has(candidate.blockId)) return false
      seenBlockIds.add(candidate.blockId)
      return true
    })
}

function availableCategories(candidates: readonly SnakeResourceCandidate[]): CompanyCategory[] {
  return COMPANY_CATEGORIES.filter((category) => candidates.some((candidate) => candidate.origin === category))
}

function newBagCycle(
  campaignSeed: string,
  cycle: number,
  categories: readonly CompanyCategory[],
): SnakeShuffleBagState {
  return {
    cycle,
    remainingCategories: [...categories].sort((left, right) => (
      hash(`${campaignSeed}:snake:bag:${cycle}:${right}`)
      - hash(`${campaignSeed}:snake:bag:${cycle}:${left}`)
      || left.localeCompare(right)
    )),
  }
}

function chooseCategory(
  campaignSeed: string,
  candidates: readonly SnakeResourceCandidate[],
  bag: SnakeShuffleBagState,
  excludedCategories: ReadonlySet<CompanyCategory> = new Set(),
): { category: CompanyCategory; bag: SnakeShuffleBagState } | null {
  const available = availableCategories(candidates)
  if (available.length === 0) return null
  const availableSet = new Set(available)
  const remaining = bag.remainingCategories.filter((category, index, source) => (
    availableSet.has(category) && source.indexOf(category) === index
  ))
  const fromCurrentBag = remaining.find((category) => !excludedCategories.has(category))
  if (fromCurrentBag) {
    return {
      category: fromCurrentBag,
      bag: {
        cycle: bag.cycle,
        remainingCategories: remaining.filter((category) => category !== fromCurrentBag),
      },
    }
  }

  const nextCycle = newBagCycle(campaignSeed, bag.cycle + 1, available)
  const fromNextCycle = nextCycle.remainingCategories.find(
    (category) => !excludedCategories.has(category),
  )
  if (fromNextCycle) {
    return {
      category: fromNextCycle,
      bag: {
        cycle: nextCycle.cycle,
        remainingCategories: nextCycle.remainingCategories.filter(
          (category) => category !== fromNextCycle,
        ),
      },
    }
  }

  const category = remaining[0] ?? nextCycle.remainingCategories[0]
  const current = remaining.length > 0
    ? { cycle: bag.cycle, remainingCategories: remaining }
    : nextCycle
  return {
    category,
    bag: {
      cycle: current.cycle,
      remainingCategories: current.remainingCategories.filter((candidate) => candidate !== category),
    },
  }
}

function chooseBlock(
  campaignSeed: string,
  roundOrdinal: number,
  category: CompanyCategory,
  candidates: readonly SnakeResourceCandidate[],
): SnakeResourceCandidate {
  return candidates
    .filter((candidate) => candidate.origin === category)
    .sort((left, right) => (
      hash(`${campaignSeed}:${roundOrdinal}:${category}:${right.blockId}`)
      - hash(`${campaignSeed}:${roundOrdinal}:${category}:${left.blockId}`)
      || left.blockId.localeCompare(right.blockId)
    ))[0]
}

function desiredEnemyCount(
  stage: CyanEncounterStage,
  candidateCount: number,
): 1 | 2 {
  if (candidateCount < 2) return 1
  return ENCOUNTER_CONFIGURATION[stage].enemyCount
}

export function createResourceSnakeEncounter(
  input: CreateSnakeEncounterInput,
): SnakeEncounterResult {
  const stage = cyanEncounterStageForProgress(input.successfulDeposits)
  const cyanProfile = cyanLightcycleProfile(stage)
  const configuration = ENCOUNTER_CONFIGURATION[stage]
  const plannerProfile: SnakePlannerProfile = {
    lookaheadMs: cyanProfile.lookaheadMs,
    candidateCount: cyanProfile.candidateCount,
    planningHz: cyanProfile.planningHz,
    commitMs: cyanProfile.commitMs,
    rolloutStepMs: cyanProfile.rolloutStepMs,
  }
  const candidates = compactEligibleCandidates(input.candidates)
  if (candidates.length === 0) {
    return {
      setup: null,
      bag: input.bag,
      disabledReason: 'no-eligible-resource',
      stage,
      doctrine: cyanProfile.doctrine,
      cyanProfile,
      plannerProfile,
    }
  }

  const count = Math.min(desiredEnemyCount(stage, candidates.length), candidates.length)
  const roundId = `${input.campaignSeed}:snake:${input.roundOrdinal}`
  const selected: SnakeResourceCandidate[] = []
  let bag = input.bag
  let pool = candidates
  for (let index = 0; index < count; index += 1) {
    const choice = chooseCategory(
      input.campaignSeed,
      pool,
      bag,
      new Set(selected.map((candidate) => candidate.origin)),
    )
    if (!choice) break
    const block = chooseBlock(input.campaignSeed, input.roundOrdinal, choice.category, pool)
    selected.push(block)
    bag = choice.bag
    pool = pool.filter((candidate) => candidate.blockId !== block.blockId)
  }

  const twoEnemies = selected.length === 2
  const enemies: SnakeEnemySetup[] = selected.map((block, index) => {
    const id = `enemy-${index}` as const
    const role = twoEnemies && index === 1 ? 'blocker' : 'pressure'
    return {
      id,
      category: block.origin,
      reservedBlockId: block.blockId,
      rewardKey: `${roundId}:${id}:${block.blockId}`,
      role,
      spawn: twoEnemies
        ? { x: index === 0 ? 16 : 34, y: 3.5 }
        : { x: 25, y: 3.5 },
      maximumIntegrity: configuration.maximumIntegrity,
      maximumSpeedPerSecond: cyanEnemySpeed(stage, role),
    }
  })
  return {
    setup: { roundId, playerSpawn: { x: 25, y: 21 }, enemies },
    bag,
    disabledReason: null,
    stage,
    doctrine: cyanProfile.doctrine,
    cyanProfile,
    plannerProfile,
  }
}

/**
 * Cancels invalid reservations in place. The active duel remains intact and
 * cannot select another block after deployment.
 */
export function reconcileSnakeReservations(
  state: ResourceSnakeRoundState,
  eligibleBlockIds: ReadonlySet<string>,
): ResourceSnakeRoundState {
  const cancelled = new Set(
    state.enemies
      .filter((enemy) => (
        enemy.reservedBlockId
        && enemy.reservationStatus !== 'resolved'
        && enemy.reservationStatus !== 'cancelled'
        && !eligibleBlockIds.has(enemy.reservedBlockId)
      ))
      .map((enemy) => enemy.rewardKey)
      .filter((rewardKey): rewardKey is string => rewardKey !== null),
  )
  if (cancelled.size === 0) return state

  let next: ResourceSnakeRoundState = {
    ...state,
    enemies: state.enemies.map((enemy) => (
      enemy.rewardKey && cancelled.has(enemy.rewardKey)
        ? { ...enemy, reservationStatus: 'cancelled' as const }
        : enemy
    )),
    effects: state.effects.filter((effect) => !cancelled.has(effect.rewardKey)),
  }
  for (const enemy of next.enemies) {
    if (!enemy.rewardKey || !cancelled.has(enemy.rewardKey)) continue
    next = {
      ...next,
      events: [...next.events, {
        id: next.nextEventId,
        type: 'resource-reward-resolved',
        rewardKey: enemy.rewardKey,
        outcome: 'cancelled',
        category: enemy.category,
      }],
      nextEventId: next.nextEventId + 1,
    }
  }
  return next
}
