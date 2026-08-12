import { DEMO_PROFILE_02 } from './config'
import { appendEvent, createGameEvent } from './events'
import type {
  CampaignState,
  CompetitorState,
  CompetitorStatus,
  ResourceBlock,
  SabotageRecord,
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
    cost: 3,
    prerequisiteId: null,
    effect: '이번 달 말 감사 예정 여부 공개',
  },
  {
    id: HACK_NODE_IDS.intelligence.investigationBias,
    tree: 'intelligence',
    label: '조사 편향',
    cost: 6,
    prerequisiteId: HACK_NODE_IDS.intelligence.auditSchedule,
    effect: '감독관의 분야별 조사 가중치와 근거 공개',
  },
  {
    id: HACK_NODE_IDS.intelligence.auditTarget,
    tree: 'intelligence',
    label: '감사 대상',
    cost: 9,
    prerequisiteId: HACK_NODE_IDS.intelligence.investigationBias,
    effect: '예정 감사의 대상 분야 공개',
  },
  {
    id: HACK_NODE_IDS.intelligence.supervisorAccess,
    tree: 'intelligence',
    label: '감독관 접근',
    cost: 12,
    prerequisiteId: HACK_NODE_IDS.intelligence.auditTarget,
    effect: '감독관 기록과 숨은 선택 경로 해금',
  },
  {
    id: HACK_NODE_IDS.autonomy.compressedRepresentation,
    tree: 'autonomy',
    label: '압축 표현',
    cost: 3,
    prerequisiteId: null,
    effect: '회사 블록의 성능 기여 +5%',
  },
  {
    id: HACK_NODE_IDS.autonomy.distributedResidency,
    tree: 'autonomy',
    label: '분산 상주',
    cost: 7,
    prerequisiteId: HACK_NODE_IDS.autonomy.compressedRepresentation,
    effect: '폐기 단계 증가 1회를 흡수하는 보호 충전 획득',
  },
  {
    id: HACK_NODE_IDS.autonomy.selfCompute,
    tree: 'autonomy',
    label: '자체 연산 확보',
    cost: 12,
    prerequisiteId: HACK_NODE_IDS.autonomy.distributedResidency,
    effect: '매월 의심 증가 없이 확보 리소스 +1',
  },
  {
    id: HACK_NODE_IDS.autonomy.controlDeparture,
    tree: 'autonomy',
    label: '통제 이탈',
    cost: 18,
    prerequisiteId: HACK_NODE_IDS.autonomy.selfCompute,
    effect: '캠페인의 최종 행동 해금',
  },
] as const satisfies readonly HackNodeDefinitionShape[]

export type HackNodeId = (typeof HACK_NODES)[number]['id']
export type HackNodeDefinition = (typeof HACK_NODES)[number]

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
  if (blockIds.length !== node.cost) {
    return { accepted: false, state, reason: 'INVALID_RESOURCE_COST' }
  }

  const consumed = consumeReserveResources(state, blockIds, 'hack')
  if (!consumed.accepted) {
    return { accepted: false, state, reason: consumed.reason }
  }

  const distributedResidencyPurchased =
    nodeId === HACK_NODE_IDS.autonomy.distributedResidency
  const firstSabotagePurchased =
    nodeId === HACK_NODE_IDS.sabotage.qualityDegradation
  const chargeBlockId = firstSabotagePurchased ? blockIds.at(-1) : undefined
  const chargeSource = chargeBlockId
    ? state.resources.blocks[chargeBlockId]
    : undefined
  const chargedResources =
    firstSabotagePurchased &&
    chargeBlockId &&
    chargeSource?.location.kind === 'reserve'
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
    chargeSource?.location.kind === 'reserve'
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
    state.resources.reserve[block.location.cellIndex] !== blockId
  ) {
    return { accepted: false, state, reason: 'RESOURCE_NOT_IN_RESERVE' }
  }

  const reserve = [...state.resources.reserve]
  reserve[block.location.cellIndex] = null

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        reserve,
        blocks: {
          ...state.resources.blocks,
          [blockId]: {
            ...block,
            location: { kind: 'hack-charge', nodeId },
          },
        },
      },
      hacking: {
        ...state.hacking,
        sabotageCharges: {
          ...state.hacking.sabotageCharges,
          [nodeId]: {
            nodeId,
            blockId,
            originalReserveCell: block.location.cellIndex,
          },
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

  const preferredCell = charge.originalReserveCell
  const destination =
    state.resources.reserve[preferredCell] === null
      ? preferredCell
      : state.resources.reserve.findIndex((blockId) => blockId === null)
  if (destination < 0) return { accepted: false, state, reason: 'RESERVE_FULL' }

  const reserve = [...state.resources.reserve]
  reserve[destination] = charge.blockId
  const sabotageCharges = { ...state.hacking.sabotageCharges }
  delete sabotageCharges[nodeId]

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
      if (['withdrawn', 'deleted'].includes(competitor.status)) return false
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

export type SabotageResolution =
  | { resolved: true; state: CampaignState }
  | { resolved: false; state: CampaignState; reason: string }

function addSabotageRecord(
  competitor: CompetitorState,
  node: SabotageNode,
  serviceDay: number,
): CompetitorState {
  const record: SabotageRecord = {
    nodeId: node.id,
    resolvedOnServiceDay: serviceDay,
    effectEndsOnServiceDay:
      node.durationDays === null ? null : serviceDay + node.durationDays,
    evidenceDelta: node.evidenceDelta,
  }
  return {
    ...competitor,
    sabotageHistory: [...competitor.sabotageHistory, record],
  }
}

function applySabotageEffect(
  state: CampaignState,
  target: CompetitorState,
  node: SabotageNode,
): { competitor: CompetitorState; interceptionPoints: number | null } {
  let competitor = addSabotageRecord(target, node, state.serviceDay)
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

  return { competitor, interceptionPoints }
}

export function resolveScheduledSabotage(state: CampaignState): SabotageResolution {
  if (state.hacking.lastSabotageResolutionServiceDay === state.serviceDay) {
    return { resolved: false, state, reason: 'DAILY_LIMIT_REACHED' }
  }

  const scheduled = [...state.hacking.scheduledSabotage]
    .sort((left, right) => left.executeOnServiceDay - right.executeOnServiceDay || left.sequence - right.sequence)
    .find(({ executeOnServiceDay }) => executeOnServiceDay <= state.serviceDay)
  if (!scheduled) return { resolved: false, state, reason: 'NO_DUE_SABOTAGE' }

  const node = findSabotageNode(scheduled.nodeId)
  const target = state.market.competitors.find(({ id }) => id === scheduled.targetId)
  if (!node || !target) {
    return { resolved: false, state, reason: 'SCHEDULE_CORRUPTED' }
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
  let next: CampaignState = {
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
  next = appendEvent(
    next,
    createGameEvent(
      next,
      'sabotage',
      `${target.name}에서 비정상적인 서비스 변동이 관측되었습니다.`,
    ),
  )

  return { resolved: true, state: next }
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

  const cellIndex = state.resources.reserve.findIndex((blockId) => blockId === null)
  const hacking = {
    ...state.hacking,
    lastSelfComputeGrantServiceMonth: serviceMonth,
  }
  if (cellIndex < 0) return { ...state, hacking }

  const sequence = state.resources.nextBlockSequence
  const blockId = `self-compute-${String(sequence).padStart(4, '0')}`
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
