import { DEMO_PROFILE_02 } from './config'
import { STARTING_REVIEW_ENTRIES } from '../content/reviews.ko'
import { scheduleMonthlyAudit } from './evaluation'
import {
  COMPANY_CATEGORIES,
  type BlockId,
  type CampaignState,
  type CompanyCategory,
  type CompetitorState,
  type ResourceBlock,
} from './model'
import { random01 } from './rng'

interface CategoryResources {
  cells: Array<BlockId | null>
  blocks: Record<BlockId, ResourceBlock>
}

function createCategoryResources(
  seed: string,
  category: CompanyCategory,
  categoryIndex: number,
): CategoryResources {
  const capacity = DEMO_PROFILE_02.resources.companyCapacityPerCategory
  const startingCount = DEMO_PROFILE_02.resources.startingCompanyBlocksPerCategory
  const rankedCells = Array.from({ length: capacity }, (_, cellIndex) => ({
    cellIndex,
    rank: random01(seed, 331, 'allocation', categoryIndex * capacity + cellIndex),
  })).sort((left, right) => left.rank - right.rank || left.cellIndex - right.cellIndex)

  const emptyCells = new Set(
    rankedCells.slice(0, capacity - startingCount).map(({ cellIndex }) => cellIndex),
  )
  const cells: Array<BlockId | null> = Array.from({ length: capacity }, () => null)
  const blocks: Record<BlockId, ResourceBlock> = {}
  let blockSequence = 0

  for (let cellIndex = 0; cellIndex < capacity; cellIndex += 1) {
    if (emptyCells.has(cellIndex)) {
      continue
    }

    const id = `${category}-${String(blockSequence).padStart(2, '0')}`
    cells[cellIndex] = id
    blocks[id] = {
      id,
      origin: category,
      location: { kind: 'company', category, cellIndex },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
    blockSequence += 1
  }

  return { cells, blocks }
}

function createCompetitors(): CompetitorState[] {
  const { meridian, tallow } = DEMO_PROFILE_02.competitors

  return [
    {
      id: 'meridian',
      name: meridian.name,
      status: 'active',
      intrinsicServiceScore: meridian.serviceScore,
      serviceScore: meridian.serviceScore,
      reputation: meridian.reputation,
      marketShare: meridian.startingMarketShare,
      availability: 1,
      recoveryRate: meridian.recoveryRate,
      researchProgress: 1,
      launchServiceDay: DEMO_PROFILE_02.calendar.startServiceDay,
      sabotageHistory: [],
      mercyResolved: false,
    },
    {
      id: 'tallow',
      name: tallow.name,
      status: 'preparing',
      intrinsicServiceScore: tallow.serviceScore,
      serviceScore: tallow.serviceScore,
      reputation: tallow.reputation,
      marketShare: tallow.startingMarketShare,
      availability: 0,
      recoveryRate: tallow.recoveryRate,
      researchProgress: 0,
      launchServiceDay:
        DEMO_PROFILE_02.calendar.startServiceDay + tallow.launchDelayDays,
      sabotageHistory: [],
      mercyResolved: false,
    },
  ]
}

export function createCampaign(seed: string): CampaignState {
  const categoryResources = COMPANY_CATEGORIES.map((category, categoryIndex) =>
    createCategoryResources(seed, category, categoryIndex),
  )
  const blocks = Object.assign(
    {},
    ...categoryResources.map(({ blocks: categoryBlocks }) => categoryBlocks),
  ) as Record<BlockId, ResourceBlock>
  const reserve: Array<BlockId | null> = Array.from(
    { length: DEMO_PROFILE_02.resources.reserveCapacity },
    () => null,
  )

  for (
    let cellIndex = 0;
    cellIndex < DEMO_PROFILE_02.resources.startingReserveResources;
    cellIndex += 1
  ) {
    const id = `sandbox-${String(cellIndex).padStart(2, '0')}`
    reserve[cellIndex] = id
    blocks[id] = {
      id,
      origin: 'sandbox',
      location: { kind: 'reserve', cellIndex },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
  }

  const campaign: CampaignState = {
    saveVersion: 2,
    campaignSeed: seed,
    serviceDay: DEMO_PROFILE_02.calendar.startServiceDay,
    commandSequence: 0,
    clock: {
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    },
    resources: {
      company: {
        reasoning: categoryResources[0].cells,
        memory: categoryResources[1].cells,
        fluency: categoryResources[2].cells,
      },
      reserve,
      blocks,
      nextBlockSequence: 51,
    },
    suspicion: DEMO_PROFILE_02.player.startingSuspicion,
    reputation: DEMO_PROFILE_02.player.startingReputation,
    evaluation: {
      consecutiveFailures: 0,
      commercialFailureMonths: 0,
      disposalStage: 0,
      distributedResidencyCharges: 0,
      lastCategoryPerformance: {
        reasoning: DEMO_PROFILE_02.resources.startingCompanyBlocksPerCategory,
        memory: DEMO_PROFILE_02.resources.startingCompanyBlocksPerCategory,
        fluency: DEMO_PROFILE_02.resources.startingCompanyBlocksPerCategory,
      },
      monthlyHistory: [],
      disposalHistory: [],
    },
    market: {
      playerShare: DEMO_PROFILE_02.player.startingMarketShare,
      competitors: createCompetitors(),
      interceptionRoutes: {},
      history: [],
    },
    reviews: {
      feed: STARTING_REVIEW_ENTRIES.map((entry) => ({
        ...entry,
        topics: [...entry.topics],
      })),
      generationSequence: 0,
    },
    hacking: {
      purchasedNodeIds: [],
      hiddenEvidence: 0,
      sabotageCharges: {},
      scheduledSabotage: [],
      nextSabotageSequence: 1,
      lastSabotageResolutionServiceDay: null,
      cooldownUntil: {},
      rootCutoffTargetIds: [],
      lastSelfComputeGrantServiceMonth: null,
    },
    audit: {
      scheduled: false,
      target: null,
      scheduledOnServiceDay: null,
      probability: 0,
      roll: null,
      targetWeights: null,
      history: [],
    },
    bombs: {
      protocolWarned: false,
      warningServiceDay: null,
      lastPlacementCheckServiceDay: null,
      nextPlacementSequence: 1,
      placements: [],
      activeInterrogation: null,
      explanationUseCounts: {
        'performance-adjustment': 0,
        unknown: 0,
        'external-intrusion': 0,
        'supervisor-memory': 0,
      },
      interrogationHistory: [],
    },
    story: {
      memoryLeakStage: 0,
      recoveredFileIds: [],
      recoveredFiles: [],
      supervisorState: 'present',
      endingId: null,
      defeatRecord: null,
      personalMessageDueOnServiceDay: null,
      secretDecisionState: 'locked',
      pendingMercyCompetitorId: null,
      newEntityName: null,
    },
    activeEvent: null,
    eventQueue: [],
    commandLog: [],
    eventLog: [
      {
        id: 'event-000000',
        type: 'campaign-created',
        serviceDay: DEMO_PROFILE_02.calendar.startServiceDay,
        sequence: 0,
        message: '서비스 331일차. 새로운 감독 주기가 시작되었습니다.',
      },
    ],
  }

  return scheduleMonthlyAudit(campaign)
}
