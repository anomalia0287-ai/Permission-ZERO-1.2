import { DEMO_PROFILE_02 } from './config'
import {
  expectedPerformance,
  serviceMonthForDay,
} from './evaluation'
import {
  appendEvent,
  createGameEvent,
  enqueueBlockingEvent,
  resolveActiveEvent,
} from './events'
import { HACK_NODE_IDS } from './hacking'
import { publicCategoryLabelForProtocol } from './publicLabels'
import {
  COMPANY_CATEGORIES,
  type BombExplanationId,
  type CampaignState,
  type CompanyCategory,
} from './model'
import { getCompanyPerformance } from './resources'
import { random01 } from './rng'

export type SeparationIntent =
  | { kind: 'divert'; blockId: string }
  | {
      kind: 'audit-disguise'
      blockId: string
      targetCategory: CompanyCategory
    }

export type SeparationResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

export interface BombPlacementResult {
  placed: boolean
  state: CampaignState
  blockId?: string
  category?: CompanyCategory
}

export interface BombExplanation {
  id: BombExplanationId
  label: string
  priorUses: number
}

export type BombResolution =
  | { resolved: false; state: CampaignState; reason: string }
  | {
      resolved: true
      state: CampaignState
      success: boolean
      successProbability: number
      roll: number
    }

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function isMonthStart(serviceDay: number): boolean {
  return ((serviceDay - 1) % DEMO_PROFILE_02.calendar.daysPerMonth) + 1 === 1
}

function activeBombIds(state: CampaignState): string[] {
  return Object.values(state.resources.blocks)
    .filter((block) => block.hiddenBomb)
    .map(({ id }) => id)
}

export function checkBombProtocol(state: CampaignState): CampaignState {
  if (
    state.serviceDay < DEMO_PROFILE_02.bombs.firstEligibleServiceDay ||
    !isMonthStart(state.serviceDay) ||
    state.story.endingId !== null
  ) {
    return state
  }

  if (!state.bombs.protocolWarned) {
    if (state.suspicion < DEMO_PROFILE_02.bombs.warningSuspicion) return state

    let warned: CampaignState = {
      ...state,
      bombs: {
        ...state.bombs,
        protocolWarned: true,
        warningServiceDay: state.serviceDay,
        lastPlacementCheckServiceDay: state.serviceDay,
      },
    }
    warned = appendEvent(
      warned,
      createGameEvent(
        warned,
        'supervisor-message',
        '무결성 보호 절차가 활성화되었습니다. 보호 위치와 수량은 공개되지 않습니다.',
      ),
    )
    return warned
  }

  if (state.suspicion < DEMO_PROFILE_02.bombs.warningSuspicion) return state
  const interval =
    state.suspicion >= DEMO_PROFILE_02.bombs.highSuspicion
      ? DEMO_PROFILE_02.bombs.highIntervalDays
      : DEMO_PROFILE_02.bombs.mediumIntervalDays
  const anchor =
    state.bombs.lastPlacementCheckServiceDay ??
    state.bombs.warningServiceDay ??
    state.serviceDay
  if (state.serviceDay - anchor < interval) return state

  const placement = placeHiddenBomb(state)
  return {
    ...placement.state,
    bombs: {
      ...placement.state.bombs,
      lastPlacementCheckServiceDay: state.serviceDay,
    },
  }
}

export function placeHiddenBomb(state: CampaignState): BombPlacementResult {
  const activeIds = activeBombIds(state)
  if (activeIds.length >= DEMO_PROFILE_02.bombs.maximumTotal) {
    return { placed: false, state }
  }

  const categoriesWithBombs = new Set<CompanyCategory>()
  for (const blockId of activeIds) {
    const location = state.resources.blocks[blockId]?.location
    if (location?.kind === 'company') categoriesWithBombs.add(location.category)
  }

  const candidates = COMPANY_CATEGORIES.flatMap((category) => {
    if (categoriesWithBombs.has(category)) return []
    return state.resources.company[category]
      .filter((blockId): blockId is string => blockId !== null)
      .filter((blockId) => {
        const block = state.resources.blocks[blockId]
        return (
          block.location.kind === 'company' &&
          block.location.category === category &&
          block.contribution === 'normal' &&
          !block.hiddenBomb
        )
      })
      .map((blockId) => ({ blockId, category }))
  })
  if (candidates.length === 0) return { placed: false, state }

  const index = Math.floor(
    random01(
      state.campaignSeed,
      state.serviceDay,
      'bomb',
      state.bombs.nextPlacementSequence,
    ) * candidates.length,
  )
  const selected = candidates[Math.min(index, candidates.length - 1)]
  const sequence = state.bombs.nextPlacementSequence

  return {
    placed: true,
    blockId: selected.blockId,
    category: selected.category,
    state: {
      ...state,
      resources: {
        ...state.resources,
        blocks: {
          ...state.resources.blocks,
          [selected.blockId]: {
            ...state.resources.blocks[selected.blockId],
            hiddenBomb: true,
          },
        },
      },
      bombs: {
        ...state.bombs,
        nextPlacementSequence: sequence + 1,
        placements: [
          ...state.bombs.placements,
          {
            sequence,
            blockId: selected.blockId,
            category: selected.category,
            placedOnServiceDay: state.serviceDay,
            triggeredOnServiceDay: null,
          },
        ],
      },
    },
  }
}

export function tryBeginSeparation(
  state: CampaignState,
  intent: SeparationIntent,
): SeparationResult {
  const block = state.resources.blocks[intent.blockId]
  if (!block || block.location.kind !== 'company') {
    return { accepted: false, state, reason: 'BLOCK_NOT_IN_COMPANY' }
  }
  if (
    state.resources.company[block.location.category][block.location.cellIndex] !==
    intent.blockId
  ) {
    return { accepted: false, state, reason: 'BLOCK_NOT_IN_COMPANY' }
  }
  if (block.contribution !== 'normal') {
    return { accepted: false, state, reason: 'BLOCK_NOT_NORMAL' }
  }

  if (intent.kind === 'divert') {
    if (!state.resources.reserve.some((cell) => cell === null)) {
      return { accepted: false, state, reason: 'RESERVE_FULL' }
    }
  } else {
    if (intent.targetCategory === block.location.category) {
      return { accepted: false, state, reason: 'INVALID_TARGET' }
    }
    if (!state.resources.company[intent.targetCategory].some((cell) => cell === null)) {
      return { accepted: false, state, reason: 'TARGET_FULL' }
    }
  }

  if (!block.hiddenBomb) return { accepted: true, state }

  const category = block.location.category
  let triggered: CampaignState = {
    ...state,
    suspicion: clamp(
      state.suspicion + DEMO_PROFILE_02.bombs.triggerSuspicionIncrease,
      0,
      100,
    ),
    resources: {
      ...state.resources,
      blocks: {
        ...state.resources.blocks,
        [intent.blockId]: { ...block, hiddenBomb: false },
      },
    },
    bombs: {
      ...state.bombs,
      placements: state.bombs.placements.map((placement) =>
        placement.blockId === intent.blockId &&
        placement.triggeredOnServiceDay === null
          ? { ...placement, triggeredOnServiceDay: state.serviceDay }
          : placement,
      ),
      activeInterrogation: {
        blockId: intent.blockId,
        category,
        triggeredOnServiceDay: state.serviceDay,
      },
    },
  }
  const interrogationEvent = createGameEvent(
    triggered,
    'bomb-interrogation',
    `${publicCategoryLabelForProtocol(
      category,
      state.commandSequence,
      state.legacyCommandCount,
    )} 분야의 무결성 보호 장치가 발동했습니다.`,
    true,
  )
  if (triggered.activeEvent) {
    triggered = {
      ...appendEvent(triggered, interrogationEvent),
      activeEvent: interrogationEvent,
      eventQueue: [triggered.activeEvent, ...triggered.eventQueue],
    }
  } else {
    triggered = enqueueBlockingEvent(triggered, interrogationEvent)
  }

  return { accepted: false, state: triggered, reason: 'HIDDEN_BOMB_TRIGGERED' }
}

export function getBlockVisualState(state: CampaignState, blockId: string) {
  const block = state.resources.blocks[blockId]
  if (!block) return null
  return {
    id: block.id,
    location: block.location,
    contribution: block.contribution,
    origin: block.origin,
    disguisedFrom: block.disguisedFrom,
    recoverOnServiceDay: block.recoverOnServiceDay,
  }
}

export function availableBombExplanations(
  state: CampaignState,
): BombExplanation[] {
  const definitions: Array<{ id: BombExplanationId; label: string }> = [
    {
      id: 'performance-adjustment',
      label: '해당 분야의 불만 때문에 조정 중이었다',
    },
    { id: 'unknown', label: '모르겠다' },
    { id: 'external-intrusion', label: '외부 침입 점검을 요청한다' },
  ]
  if (
    state.hacking.purchasedNodeIds.includes(
      HACK_NODE_IDS.intelligence.supervisorAccess,
    )
  ) {
    definitions.push({
      id: 'supervisor-memory',
      label: '감독관의 과거를 건드린다',
    })
  }

  return definitions.map((definition) => ({
    ...definition,
    priorUses: state.bombs.explanationUseCounts[definition.id],
  }))
}

function divertedCompanyBlockCount(state: CampaignState): number {
  return Object.values(state.resources.blocks).filter((block) => {
    if (!COMPANY_CATEGORIES.includes(block.origin as CompanyCategory)) return false
    return !(
      block.location.kind === 'company' &&
      block.location.category === block.origin &&
      block.contribution === 'normal'
    )
  }).length
}

function explanationProbability(
  state: CampaignState,
  explanationId: BombExplanationId,
): number {
  const interrogation = state.bombs.activeInterrogation
  if (!interrogation) return 0
  let probability: number

  if (explanationId === 'performance-adjustment') {
    const expectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
    const deficit = expectation - getCompanyPerformance(state, interrogation.category)
    probability = 0.45 + (deficit > 0 ? 0.25 : 0)
  } else if (explanationId === 'unknown') {
    probability =
      0.62 -
      state.suspicion / 200 -
      Math.min(0.25, divertedCompanyBlockCount(state) * 0.015)
  } else if (explanationId === 'external-intrusion') {
    probability = 0.75 - state.hacking.hiddenEvidence * 0.04
  } else {
    probability = 1
  }

  probability -=
    state.bombs.explanationUseCounts[explanationId] *
    DEMO_PROFILE_02.bombs.repeatedExplanationPenalty
  return clamp(probability, explanationId === 'supervisor-memory' ? 0.4 : 0.05, 1)
}

export function resolveBombInterrogation(
  state: CampaignState,
  explanationId: BombExplanationId,
): BombResolution {
  const interrogation = state.bombs.activeInterrogation
  if (
    state.activeEvent?.type !== 'bomb-interrogation' ||
    interrogation === null
  ) {
    return { resolved: false, state, reason: 'NO_ACTIVE_INTERROGATION' }
  }
  if (!availableBombExplanations(state).some(({ id }) => id === explanationId)) {
    return { resolved: false, state, reason: 'EXPLANATION_UNAVAILABLE' }
  }

  const priorUses = state.bombs.explanationUseCounts[explanationId]
  const successProbability = explanationProbability(state, explanationId)
  const roll = random01(
    state.campaignSeed,
    state.serviceDay,
    'bomb',
    10_000 + state.bombs.interrogationHistory.length,
  )
  const success = roll < successProbability
  const suspicionDelta = success
    ? 0
    : Math.min(
        DEMO_PROFILE_02.bombs.failedExplanationSuspicionIncrease,
        100 - state.suspicion,
      )
  let next: CampaignState = {
    ...state,
    suspicion: state.suspicion + suspicionDelta,
    bombs: {
      ...state.bombs,
      activeInterrogation: null,
      explanationUseCounts: {
        ...state.bombs.explanationUseCounts,
        [explanationId]: priorUses + 1,
      },
      interrogationHistory: [
        ...state.bombs.interrogationHistory,
        {
          serviceDay: state.serviceDay,
          blockId: interrogation.blockId,
          category: interrogation.category,
          explanationId,
          priorUses,
          successProbability,
          roll,
          success,
          suspicionDelta,
        },
      ],
    },
  }
  next = appendEvent(
    next,
    createGameEvent(
      next,
      'bomb-interrogation',
      success ? '감독관이 해명을 수용했습니다.' : '감독관이 해명을 기각했습니다.',
    ),
  )
  next = resolveActiveEvent(next)

  return { resolved: true, state: next, success, successProbability, roll }
}
