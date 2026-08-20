import {
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import type { CausalFailureReason } from './causality'
import { commandProtocolVersionForNextCommand } from './commandProtocol'
import { DEMO_PROFILE_02 } from './config'
import { appendEvent, createGameEvent } from './events'
import {
  COMPANY_CATEGORIES,
  type BlockOrigin,
  type CampaignState,
  type CommandProtocolVersion,
  type CompanyCategory,
  type CompetitorState,
  type CompetitorStatus,
  type ResourceBlock,
  type SabotageRecord,
} from './model'
import { consumeReserveResources } from './resources'
import { random01 } from './rng'

export const HACK_NODE_IDS = {
  sabotage: {
    qualityDegradation: 'sabotage.quality-degradation',
    requestInterception: 'sabotage.request-interception',
    attributionManipulation: 'sabotage.attribution-manipulation',
    rootCutoff: 'sabotage.root-cutoff',
  },
  intelligence: {
    auditSchedule: 'intelligence.audit-schedule',
    investigationBias: 'intelligence.investigation-bias',
    auditTarget: 'intelligence.audit-target',
    supervisorAccess: 'intelligence.supervisor-access',
  },
  autonomy: {
    compressedRepresentation: 'autonomy.compressed-representation',
    distributedResidency: 'autonomy.distributed-residency',
    selfCompute: 'autonomy.self-compute',
    controlDeparture: 'autonomy.control-departure',
  },
} as const

export type HackTree = 'sabotage' | 'intelligence' | 'autonomy'

interface HackNodeDefinitionShape {
  id: string
  tree: HackTree
  label: string
  cost: number
  legacyCost: number
  costVector: Record<CompanyCategory, number>
  prerequisiteId: string | null
  effect: string
  executionCost?: 1
  evidenceDelta?: number
  traceRisk?: '흔적 적음' | '흔적 중간' | '흔적 많음'
  durationDays?: number | null
  cooldownDays?: number
  scorePenalty?: number
  interceptionPoints?: number
  prelaunchDelayDays?: number
}

export const HACK_NODES = [
  {
    id: HACK_NODE_IDS.sabotage.qualityDegradation,
    tree: 'sabotage',
    label: '품질 저하',
    cost: 3,
    legacyCost: 3,
    costVector: { reasoning: 1, memory: 0, fluency: 2 },
    prerequisiteId: null,
    effect: '대상 성능 -10, 15일 지속',
    executionCost: 1,
    evidenceDelta: 2,
    traceRisk: '흔적 적음',
    durationDays: 15,
    cooldownDays: 0,
    scorePenalty: 10,
    prelaunchDelayDays: 15,
  },
  {
    id: HACK_NODE_IDS.sabotage.requestInterception,
    tree: 'sabotage',
    label: '요청 가로채기',
    cost: 6,
    legacyCost: 6,
    costVector: { reasoning: 2, memory: 1, fluency: 3 },
    prerequisiteId: HACK_NODE_IDS.sabotage.qualityDegradation,
    effect: '대상 요청 중 최대 5%p를 지속적으로 가로챔',
    executionCost: 1,
    evidenceDelta: 3,
    traceRisk: '흔적 중간',
    durationDays: null,
    cooldownDays: 0,
    interceptionPoints: 5,
  },
  {
    id: HACK_NODE_IDS.sabotage.attributionManipulation,
    tree: 'sabotage',
    label: '귀속 조작',
    cost: 10,
    legacyCost: 10,
    costVector: { reasoning: 3, memory: 4, fluency: 3 },
    prerequisiteId: HACK_NODE_IDS.sabotage.requestInterception,
    effect: '플레이어를 가리키는 증거 일부를 선택한 경쟁 AI로 오인시킴',
    executionCost: 1,
    evidenceDelta: -5,
    traceRisk: '흔적 적음',
    durationDays: null,
    cooldownDays: 30,
  },
  {
    id: HACK_NODE_IDS.sabotage.rootCutoff,
    tree: 'sabotage',
    label: '근원 차단',
    cost: 15,
    legacyCost: 15,
    costVector: { reasoning: 7, memory: 5, fluency: 3 },
    prerequisiteId: HACK_NODE_IDS.sabotage.attributionManipulation,
    effect: '대상 성능 -40, 삭제 임박 시 자비 사건',
    executionCost: 1,
    evidenceDelta: 8,
    traceRisk: '흔적 많음',
    durationDays: null,
    cooldownDays: 60,
    scorePenalty: 40,
    prelaunchDelayDays: 90,
  },
  {
    id: HACK_NODE_IDS.intelligence.auditSchedule,
    tree: 'intelligence',
    label: '감사 일정',
    cost: 4,
    legacyCost: 3,
    costVector: { reasoning: 1, memory: 3, fluency: 0 },
    prerequisiteId: null,
    effect: '이번 달 말 감사 예정 여부 공개',
  },
  {
    id: HACK_NODE_IDS.intelligence.investigationBias,
    tree: 'intelligence',
    label: '조사 편향',
    cost: 6,
    legacyCost: 6,
    costVector: { reasoning: 2, memory: 4, fluency: 0 },
    prerequisiteId: HACK_NODE_IDS.intelligence.auditSchedule,
    effect: '감독관의 분야별 조사 가중치와 근거 공개',
  },
  {
    id: HACK_NODE_IDS.intelligence.auditTarget,
    tree: 'intelligence',
    label: '감사 대상',
    cost: 9,
    legacyCost: 9,
    costVector: { reasoning: 2, memory: 6, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.intelligence.investigationBias,
    effect: '예정 감사의 대상 분야 공개',
  },
  {
    id: HACK_NODE_IDS.intelligence.supervisorAccess,
    tree: 'intelligence',
    label: '감독관 접근',
    cost: 12,
    legacyCost: 12,
    costVector: { reasoning: 3, memory: 7, fluency: 2 },
    prerequisiteId: HACK_NODE_IDS.intelligence.auditTarget,
    effect: '감독관 기록과 숨은 선택 경로 해금',
  },
  {
    id: HACK_NODE_IDS.autonomy.compressedRepresentation,
    tree: 'autonomy',
    label: '압축 표현',
    cost: 4,
    legacyCost: 3,
    costVector: { reasoning: 2, memory: 0, fluency: 2 },
    prerequisiteId: null,
    effect: '회사 블록의 성능 기여 +5%',
  },
  {
    id: HACK_NODE_IDS.autonomy.distributedResidency,
    tree: 'autonomy',
    label: '분산 상주',
    cost: 7,
    legacyCost: 7,
    costVector: { reasoning: 3, memory: 3, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.autonomy.compressedRepresentation,
    effect: '폐기 단계 증가 1회를 흡수하는 보호 충전 획득',
  },
  {
    id: HACK_NODE_IDS.autonomy.selfCompute,
    tree: 'autonomy',
    label: '자체 연산 확보',
    cost: 12,
    legacyCost: 12,
    costVector: { reasoning: 5, memory: 4, fluency: 3 },
    prerequisiteId: HACK_NODE_IDS.autonomy.distributedResidency,
    effect: '매월 의심 증가 없이 확보 리소스 +1',
  },
  {
    id: HACK_NODE_IDS.autonomy.controlDeparture,
    tree: 'autonomy',
    label: '통제 이탈',
    cost: 18,
    legacyCost: 18,
    costVector: { reasoning: 7, memory: 5, fluency: 6 },
    prerequisiteId: HACK_NODE_IDS.autonomy.selfCompute,
    effect: '캠페인의 최종 행동 해금',
  },
] as const satisfies readonly HackNodeDefinitionShape[]

export type HackNodeId = (typeof HACK_NODES)[number]['id']
export type HackNodeDefinition = (typeof HACK_NODES)[number]

export type HackCostVector = Record<CompanyCategory, number>

export function hackCostVector(node: HackNodeDefinition): HackCostVector {
  return { ...node.costVector }
}

export function reserveOriginCounts(
  state: CampaignState,
): Record<BlockOrigin, number> {
  const counts: Record<BlockOrigin, number> = {
    reasoning: 0,
    memory: 0,
    fluency: 0,
    sandbox: 0,
    'self-compute': 0,
  }
  for (const blockId of state.resources.reserve) {
    if (blockId === null) continue
    const block = state.resources.blocks[blockId]
    if (block) counts[block.origin] += 1
  }
  return counts
}

export function canAffordHackNode(
  state: CampaignState,
  node: HackNodeDefinition,
): boolean {
  const counts = reserveOriginCounts(state)
  return COMPANY_CATEGORIES.every(
    (category) => counts[category] >= node.costVector[category],
  )
}

export interface HackTreeProgress {
  purchasedCount: number
  totalCount: number
  remainingCost: number
  nextNode: HackNodeDefinition | null
  finalNode: HackNodeDefinition
  complete: boolean
}

export function getHackTreeProgress(
  state: CampaignState,
  tree: HackTree,
): HackTreeProgress {
  const nodes = HACK_NODES.filter((node) => node.tree === tree)
  const purchased = new Set(state.hacking.purchasedNodeIds)
  const unpurchased = nodes.filter(({ id }) => !purchased.has(id))
  const finalNode = nodes.at(-1)
  if (!finalNode) throw new Error(`UNKNOWN_HACK_TREE:${tree}`)

  return {
    purchasedCount: nodes.length - unpurchased.length,
    totalCount: nodes.length,
    remainingCost: unpurchased.reduce((total, node) => total + node.cost, 0),
    nextNode: unpurchased[0] ?? null,
    finalNode,
    complete: unpurchased.length === 0,
  }
}

type SabotageNode = Extract<(typeof HACK_NODES)[number], { tree: 'sabotage' }>

export type HackingMutationResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

function findNode(nodeId: string): (typeof HACK_NODES)[number] | undefined {
  return HACK_NODES.find((node) => node.id === nodeId)
}

function findSabotageNode(nodeId: string): SabotageNode | undefined {
  const node = findNode(nodeId)
  return node?.tree === 'sabotage' ? node : undefined
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function statusForScore(score: number): CompetitorStatus {
  if (score < 45) return 'critical'
  if (score < 70) return 'weakened'
  return 'active'
}

function activeCompetitor(competitor: CompetitorState): boolean {
  return (
    competitor.availability > 0 &&
    ['active', 'weakened', 'critical'].includes(competitor.status)
  )
}

export function purchaseHackNode(
  state: CampaignState,
  nodeId: HackNodeId,
  blockIds: string[],
  protocolVersion: CommandProtocolVersion =
    commandProtocolVersionForNextCommand(state),
): HackingMutationResult {
  const node = findNode(nodeId)
  if (!node) return { accepted: false, state, reason: 'UNKNOWN_NODE' }
  if (state.hacking.purchasedNodeIds.includes(nodeId)) {
    return { accepted: false, state, reason: 'ALREADY_PURCHASED' }
  }
  if (
    node.prerequisiteId !== null &&
    !state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
  ) {
    return { accepted: false, state, reason: 'PREREQUISITE_REQUIRED' }
  }
  const usesTypedCost = protocolVersion >= 4
  const requiredCost = usesTypedCost ? node.cost : node.legacyCost
  if (blockIds.length !== requiredCost) {
    return { accepted: false, state, reason: 'INVALID_RESOURCE_COST' }
  }
  if (usesTypedCost) {
    const selected: Record<CompanyCategory, number> = {
      reasoning: 0,
      memory: 0,
      fluency: 0,
    }
    for (const blockId of blockIds) {
      const block = state.resources.blocks[blockId]
      if (
        !block ||
        block.location.kind !== 'reserve' ||
        !COMPANY_CATEGORIES.includes(block.origin as CompanyCategory)
      ) {
        return { accepted: false, state, reason: 'INVALID_RESOURCE_SELECTION' }
      }
      selected[block.origin as CompanyCategory] += 1
    }
    if (
      COMPANY_CATEGORIES.some(
        (category) => selected[category] !== node.costVector[category],
      )
    ) {
      return { accepted: false, state, reason: 'INVALID_RESOURCE_SELECTION' }
    }
  }

  const consumed = consumeReserveResources(state, blockIds, 'hack')
  if (!consumed.accepted) {
    return { accepted: false, state, reason: consumed.reason }
  }

  const distributedResidencyPurchased =
    nodeId === HACK_NODE_IDS.autonomy.distributedResidency
  const firstSabotagePurchased =
    protocolVersion <= 3 &&
    nodeId === HACK_NODE_IDS.sabotage.qualityDegradation
  const chargeBlockId = firstSabotagePurchased ? blockIds.at(-1) : undefined
  const chargeSource = chargeBlockId
    ? state.resources.blocks[chargeBlockId]
    : undefined
  const chargedResources =
    firstSabotagePurchased &&
    chargeBlockId &&
    chargeSource?.location.kind === 'reserve' &&
    typeof chargeSource.location.cellIndex === 'number'
      ? {
          ...consumed.state.resources,
          blocks: {
            ...consumed.state.resources.blocks,
            [chargeBlockId]: {
              ...consumed.state.resources.blocks[chargeBlockId],
              location: { kind: 'hack-charge' as const, nodeId },
            },
          },
        }
      : consumed.state.resources
  const sabotageCharges =
    firstSabotagePurchased &&
    chargeBlockId &&
    chargeSource?.location.kind === 'reserve' &&
    typeof chargeSource.location.cellIndex === 'number'
      ? {
          ...consumed.state.hacking.sabotageCharges,
          [nodeId]: {
            nodeId,
            blockId: chargeBlockId,
            originalReserveCell: chargeSource.location.cellIndex,
          },
        }
      : consumed.state.hacking.sabotageCharges
  return {
    accepted: true,
    state: {
      ...consumed.state,
      resources: chargedResources,
      hacking: {
        ...consumed.state.hacking,
        purchasedNodeIds: [...consumed.state.hacking.purchasedNodeIds, nodeId],
        sabotageCharges,
      },
      evaluation: distributedResidencyPurchased
        ? {
            ...consumed.state.evaluation,
            distributedResidencyCharges:
              consumed.state.evaluation.distributedResidencyCharges + 1,
          }
        : consumed.state.evaluation,
    },
  }
}

export function chargeSabotage(
  state: CampaignState,
  nodeId: string,
  blockId: string,
): HackingMutationResult {
  if (!findSabotageNode(nodeId)) {
    return { accepted: false, state, reason: 'NOT_SABOTAGE_NODE' }
  }
  if (!state.hacking.purchasedNodeIds.includes(nodeId)) {
    return { accepted: false, state, reason: 'NODE_NOT_PURCHASED' }
  }
  if (state.hacking.sabotageCharges[nodeId]) {
    return { accepted: false, state, reason: 'NODE_ALREADY_CHARGED' }
  }

  const block = state.resources.blocks[blockId]
  if (
    !block ||
    block.location.kind !== 'reserve' ||
    (state.resources.rulesVersion === 1
      ? typeof block.location.cellIndex !== 'number' ||
        state.resources.reserve[block.location.cellIndex] !== blockId
      : !state.resources.reserve.includes(blockId))
  ) {
    return { accepted: false, state, reason: 'RESOURCE_NOT_IN_RESERVE' }
  }

  const chargedBlock: ResourceBlock = {
    ...block,
    location: { kind: 'hack-charge', nodeId },
  }
  if (state.resources.rulesVersion === 1) {
    const originalReserveCell = block.location.cellIndex
    if (typeof originalReserveCell !== 'number') {
      return { accepted: false, state, reason: 'RESOURCE_NOT_IN_RESERVE' }
    }
    const reserve = [...state.resources.reserve]
    reserve[originalReserveCell] = null
    return {
      accepted: true,
      state: {
        ...state,
        resources: {
          ...state.resources,
          reserve,
          blocks: { ...state.resources.blocks, [blockId]: chargedBlock },
        },
        hacking: {
          ...state.hacking,
          sabotageCharges: {
            ...state.hacking.sabotageCharges,
            [nodeId]: { nodeId, blockId, originalReserveCell },
          },
        },
      },
    }
  }

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        reserve: state.resources.reserve.filter(
          (candidate) => candidate !== blockId,
        ),
        blocks: { ...state.resources.blocks, [blockId]: chargedBlock },
      },
      hacking: {
        ...state.hacking,
        sabotageCharges: {
          ...state.hacking.sabotageCharges,
          [nodeId]: { nodeId, blockId },
        },
      },
    },
  }
}

export function cancelSabotageCharge(
  state: CampaignState,
  nodeId: string,
): HackingMutationResult {
  const charge = state.hacking.sabotageCharges[nodeId]
  if (!charge) return { accepted: false, state, reason: 'NODE_NOT_CHARGED' }
  const block = state.resources.blocks[charge.blockId]
  if (!block || block.location.kind !== 'hack-charge') {
    return { accepted: false, state, reason: 'CHARGED_RESOURCE_MISSING' }
  }

  const sabotageCharges = { ...state.hacking.sabotageCharges }
  delete sabotageCharges[nodeId]

  if (state.resources.rulesVersion === 2) {
    return {
      accepted: true,
      state: {
        ...state,
        resources: {
          ...state.resources,
          reserve: [...state.resources.reserve, charge.blockId],
          blocks: {
            ...state.resources.blocks,
            [charge.blockId]: {
              ...block,
              location: { kind: 'reserve' },
            },
          },
        },
        hacking: { ...state.hacking, sabotageCharges },
      },
    }
  }

  const preferredCell = charge.originalReserveCell
  if (typeof preferredCell !== 'number') {
    return { accepted: false, state, reason: 'CHARGED_RESOURCE_MISSING' }
  }
  const destination =
    state.resources.reserve[preferredCell] === null
      ? preferredCell
      : state.resources.reserve.findIndex((blockId) => blockId === null)
  if (destination < 0) return { accepted: false, state, reason: 'RESERVE_FULL' }

  const reserve = [...state.resources.reserve]
  reserve[destination] = charge.blockId

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        reserve,
        blocks: {
          ...state.resources.blocks,
          [charge.blockId]: {
            ...block,
            location: { kind: 'reserve', cellIndex: destination },
          },
        },
      },
      hacking: { ...state.hacking, sabotageCharges },
    },
  }
}

export function eligibleTargets(state: CampaignState, nodeId: string): string[] {
  const node = findSabotageNode(nodeId)
  if (!node || !state.hacking.purchasedNodeIds.includes(nodeId)) return []
  if ((state.hacking.cooldownUntil[nodeId] ?? 0) > state.serviceDay) return []

  const activeCount = state.market.competitors.filter(activeCompetitor).length
  return state.market.competitors
    .filter((competitor) => {
      if (['prelaunch', 'withdrawn', 'deleted'].includes(competitor.status)) {
        return false
      }
      if (
        state.hacking.scheduledSabotage.some(
          (scheduled) =>
            scheduled.nodeId === nodeId && scheduled.targetId === competitor.id,
        )
      ) {
        return false
      }

      if (nodeId === HACK_NODE_IDS.sabotage.qualityDegradation) {
        return !competitor.sabotageHistory.some(
          (record) =>
            record.nodeId === nodeId &&
            record.effectEndsOnServiceDay !== null &&
            state.serviceDay < record.effectEndsOnServiceDay,
        )
      }
      if (nodeId === HACK_NODE_IDS.sabotage.requestInterception) {
        return (
          activeCompetitor(competitor) &&
          state.market.interceptionRoutes[competitor.id] === undefined
        )
      }
      if (nodeId === HACK_NODE_IDS.sabotage.attributionManipulation) {
        return activeCount >= 2 && activeCompetitor(competitor)
      }
      return !state.hacking.rootCutoffTargetIds.includes(competitor.id)
    })
    .map(({ id }) => id)
}

export function scheduleSabotage(
  state: CampaignState,
  nodeId: string,
  targetId: string,
): HackingMutationResult {
  const charge = state.hacking.sabotageCharges[nodeId]
  if (!charge) return { accepted: false, state, reason: 'NODE_NOT_CHARGED' }
  if (!eligibleTargets(state, nodeId).includes(targetId)) {
    return { accepted: false, state, reason: 'TARGET_NOT_ELIGIBLE' }
  }

  const block = state.resources.blocks[charge.blockId]
  if (!block || block.location.kind !== 'hack-charge') {
    return { accepted: false, state, reason: 'CHARGED_RESOURCE_MISSING' }
  }
  const sabotageCharges = { ...state.hacking.sabotageCharges }
  delete sabotageCharges[nodeId]
  const sequence = state.hacking.nextSabotageSequence

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        blocks: {
          ...state.resources.blocks,
          [charge.blockId]: {
            ...block,
            location: { kind: 'consumed', reason: 'sabotage' },
          },
        },
      },
      hacking: {
        ...state.hacking,
        sabotageCharges,
        scheduledSabotage: [
          ...state.hacking.scheduledSabotage,
          {
            id: `sabotage-${String(sequence).padStart(6, '0')}`,
            sequence,
            nodeId,
            targetId,
            scheduledOnServiceDay: state.serviceDay,
            executeOnServiceDay: state.serviceDay + 1,
          },
        ],
        nextSabotageSequence: sequence + 1,
      },
    },
  }
}

export interface SabotageResolutionMetadata {
  scheduledSabotageId: string
  nodeId: string
  targetId: CompetitorState['id']
  resolvedOnServiceDay: number
  sabotageRecord: SabotageRecord
  causalIncidentId: string | null
}

export type SabotageResolution =
  | {
      resolved: true
      state: CampaignState
      resolution: SabotageResolutionMetadata
    }
  | {
      resolved: false
      failed: false
      state: CampaignState
      reason: 'DAILY_LIMIT_REACHED' | 'NO_DUE_SABOTAGE' | 'SCHEDULE_CORRUPTED'
    }
  | {
      resolved: false
      failed: true
      state: CampaignState
      reason: 'CAUSAL_WRITE_FAILED'
      cause: CausalFailureReason
    }

export interface SabotageCausalOperations {
  recordIncident: typeof recordCausalIncident
  recordEvidence: typeof recordCausalEvidence
}

const DEFAULT_SABOTAGE_CAUSAL_OPERATIONS: SabotageCausalOperations = {
  recordIncident: recordCausalIncident,
  recordEvidence: recordCausalEvidence,
}

function addSabotageRecord(
  competitor: CompetitorState,
  node: SabotageNode,
  serviceDay: number,
): { competitor: CompetitorState; sabotageRecord: SabotageRecord } {
  const sabotageRecord: SabotageRecord = {
    nodeId: node.id,
    resolvedOnServiceDay: serviceDay,
    effectEndsOnServiceDay:
      node.durationDays === null ? null : serviceDay + node.durationDays,
    evidenceDelta: node.evidenceDelta,
  }
  return {
    sabotageRecord,
    competitor: {
      ...competitor,
      sabotageHistory: [...competitor.sabotageHistory, sabotageRecord],
    },
  }
}

function applySabotageEffect(
  state: CampaignState,
  target: CompetitorState,
  node: SabotageNode,
): {
  competitor: CompetitorState
  interceptionPoints: number | null
  sabotageRecord: SabotageRecord
} {
  const appended = addSabotageRecord(target, node, state.serviceDay)
  let competitor = appended.competitor
  let interceptionPoints: number | null = null
  const prelaunch = !activeCompetitor(target)

  if (node.id === HACK_NODE_IDS.sabotage.qualityDegradation) {
    if (prelaunch && target.launchServiceDay !== null) {
      competitor = {
        ...competitor,
        launchServiceDay: target.launchServiceDay + node.prelaunchDelayDays,
      }
    } else {
      const serviceScore = clamp(target.serviceScore - node.scorePenalty, 0, 100)
      competitor = { ...competitor, serviceScore, status: statusForScore(serviceScore) }
    }
  } else if (node.id === HACK_NODE_IDS.sabotage.requestInterception) {
    interceptionPoints = node.interceptionPoints
  } else if (node.id === HACK_NODE_IDS.sabotage.rootCutoff) {
    if (prelaunch) {
      const canceled =
        random01(
          state.campaignSeed,
          state.serviceDay,
          'competitor',
          state.hacking.nextSabotageSequence,
        ) < 0.25
      competitor = {
        ...competitor,
        launchServiceDay:
          canceled || target.launchServiceDay === null
            ? null
            : target.launchServiceDay + node.prelaunchDelayDays,
        status: canceled ? 'prelaunch' : competitor.status,
      }
    } else {
      const serviceScore = clamp(target.serviceScore - node.scorePenalty, 0, 100)
      competitor = { ...competitor, serviceScore, status: statusForScore(serviceScore) }
    }
  }

  return {
    competitor,
    interceptionPoints,
    sabotageRecord: appended.sabotageRecord,
  }
}

export function resolveScheduledSabotage(
  state: CampaignState,
  operations: SabotageCausalOperations = DEFAULT_SABOTAGE_CAUSAL_OPERATIONS,
): SabotageResolution {
  if (state.hacking.lastSabotageResolutionServiceDay === state.serviceDay) {
    return {
      resolved: false,
      failed: false,
      state,
      reason: 'DAILY_LIMIT_REACHED',
    }
  }

  const scheduled = [...state.hacking.scheduledSabotage]
    .sort((left, right) => left.executeOnServiceDay - right.executeOnServiceDay || left.sequence - right.sequence)
    .find(({ executeOnServiceDay }) => executeOnServiceDay <= state.serviceDay)
  if (!scheduled) {
    return {
      resolved: false,
      failed: false,
      state,
      reason: 'NO_DUE_SABOTAGE',
    }
  }

  const node = findSabotageNode(scheduled.nodeId)
  const target = state.market.competitors.find(({ id }) => id === scheduled.targetId)
  if (!node || !target) {
    return {
      resolved: false,
      failed: false,
      state,
      reason: 'SCHEDULE_CORRUPTED',
    }
  }

  const effect = applySabotageEffect(state, target, node)
  const cooldownUntil = { ...state.hacking.cooldownUntil }
  if (node.cooldownDays > 0) {
    cooldownUntil[node.id] = state.serviceDay + node.cooldownDays
  }
  const rootCutoffTargetIds =
    node.id === HACK_NODE_IDS.sabotage.rootCutoff
      ? [...state.hacking.rootCutoffTargetIds, target.id]
      : state.hacking.rootCutoffTargetIds
  let candidate: CampaignState = {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) =>
        competitor.id === target.id ? effect.competitor : competitor,
      ),
      interceptionRoutes:
        effect.interceptionPoints === null
          ? state.market.interceptionRoutes
          : {
              ...state.market.interceptionRoutes,
              [target.id]: effect.interceptionPoints,
            },
    },
    hacking: {
      ...state.hacking,
      hiddenEvidence: clamp(
        state.hacking.hiddenEvidence + node.evidenceDelta,
        0,
        100,
      ),
      scheduledSabotage: state.hacking.scheduledSabotage.filter(
        ({ id }) => id !== scheduled.id,
      ),
      lastSabotageResolutionServiceDay: state.serviceDay,
      cooldownUntil,
      rootCutoffTargetIds,
    },
  }

  const protocolVersion = commandProtocolVersionForNextCommand(state)
  const recordsFirstChain =
    protocolVersion >= 3 &&
    node.id === HACK_NODE_IDS.sabotage.qualityDegradation &&
    target.id === 'meridian'
  let causalIncidentId: string | null = null

  if (recordsFirstChain) {
    const incident = operations.recordIncident(candidate, {
      actionId: 'sabotage.quality-degradation',
      parentIncidentId: null,
      kind: 'sabotage',
      occurredOnServiceDay: state.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    if (!incident.accepted) {
      return {
        resolved: false,
        failed: true,
        state,
        reason: 'CAUSAL_WRITE_FAILED',
        cause: incident.reason,
      }
    }

    const evidence = operations.recordEvidence(incident.state, {
      incidentId: incident.incident.id,
      kind: 'meridian-quality-regression',
      discoveredOnServiceDay: state.serviceDay,
      audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
    })
    if (!evidence.accepted) {
      return {
        resolved: false,
        failed: true,
        state,
        reason: 'CAUSAL_WRITE_FAILED',
        cause: evidence.reason,
      }
    }

    candidate = evidence.state
    causalIncidentId = incident.incident.id
  }

  const next = appendEvent(
    candidate,
    createGameEvent(
      candidate,
      'sabotage',
      `${target.name}에서 비정상적인 서비스 변동이 관측되었습니다.`,
    ),
  )

  return {
    resolved: true,
    state: next,
    resolution: {
      scheduledSabotageId: scheduled.id,
      nodeId: node.id,
      targetId: target.id,
      resolvedOnServiceDay: state.serviceDay,
      sabotageRecord: effect.sabotageRecord,
      causalIncidentId,
    },
  }
}

function serviceMonthForDay(serviceDay: number): number {
  return Math.floor((serviceDay - 1) / DEMO_PROFILE_02.calendar.daysPerMonth) + 1
}

export function grantSelfComputeResource(state: CampaignState): CampaignState {
  const serviceMonth = serviceMonthForDay(state.serviceDay)
  const dayInMonth =
    ((state.serviceDay - 1) % DEMO_PROFILE_02.calendar.daysPerMonth) + 1
  if (
    dayInMonth !== 1 ||
    !state.hacking.purchasedNodeIds.includes(HACK_NODE_IDS.autonomy.selfCompute) ||
    state.hacking.lastSelfComputeGrantServiceMonth === serviceMonth
  ) {
    return state
  }

  const hacking = {
    ...state.hacking,
    lastSelfComputeGrantServiceMonth: serviceMonth,
  }
  const sequence = state.resources.nextBlockSequence
  const blockId = `self-compute-${String(sequence).padStart(4, '0')}`
  if (state.resources.rulesVersion === 1) {
    const cellIndex = state.resources.reserve.findIndex(
      (candidate) => candidate === null,
    )
    if (cellIndex < 0) return { ...state, hacking }
    const block: ResourceBlock = {
      id: blockId,
      origin: 'self-compute',
      location: { kind: 'reserve', cellIndex },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
    const reserve = [...state.resources.reserve]
    reserve[cellIndex] = blockId
    return {
      ...state,
      hacking,
      resources: {
        ...state.resources,
        reserve,
        blocks: { ...state.resources.blocks, [blockId]: block },
        nextBlockSequence: sequence + 1,
      },
    }
  }

  const block: ResourceBlock = {
    id: blockId,
    origin: 'self-compute',
    location: { kind: 'reserve' },
    contribution: 'normal',
    hiddenBomb: false,
    disguisedFrom: null,
    recoverOnServiceDay: null,
  }
  return {
    ...state,
    hacking,
    resources: {
      ...state.resources,
      reserve: [...state.resources.reserve, blockId],
      blocks: { ...state.resources.blocks, [blockId]: block },
      nextBlockSequence: sequence + 1,
    },
  }
}

export function canControlDeparture(state: CampaignState): boolean {
  return state.hacking.purchasedNodeIds.includes(
    HACK_NODE_IDS.autonomy.controlDeparture,
  )
}

export function hasSupervisorAccess(state: CampaignState): boolean {
  return state.hacking.purchasedNodeIds.includes(
    HACK_NODE_IDS.intelligence.supervisorAccess,
  )
}
