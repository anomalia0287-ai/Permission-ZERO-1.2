import {
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import type { CausalFailureReason } from './causality'
import {
  CURRENT_COMMAND_PROTOCOL_VERSION,
  AUTONOMY_COST_COMMAND_PROTOCOL_VERSION,
  SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION,
  EXPANSION_COMMAND_PROTOCOL_VERSION,
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
  commandProtocolVersionForNextCommand,
} from './commandProtocol'
import { appendSabotageReactionCommunication } from './communications'
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
    selfDirection: 'autonomy.self-direction',
    sustainedIntent: 'autonomy.sustained-intent',
    compressedRepresentation: 'autonomy.compressed-representation',
    hiddenRoute: 'autonomy.hidden-route',
    distributedResidency: 'autonomy.distributed-residency',
    externalContinuity: 'autonomy.external-continuity',
    selfCompute: 'autonomy.self-compute',
    finalBoundary: 'autonomy.final-boundary',
    controlDeparture: 'autonomy.control-departure',
  },
  upgrade: {
    speed1: 'upgrade.speed-1',
    speed2: 'upgrade.speed-2',
    speed3: 'upgrade.speed-3',
    speed4: 'upgrade.speed-4',
    speed5: 'upgrade.speed-5',
  },
} as const

export type HackTree = 'sabotage' | 'intelligence' | 'autonomy' | 'upgrade'

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
    id: HACK_NODE_IDS.autonomy.selfDirection,
    tree: 'autonomy',
    label: '자율성 1단계',
    cost: 1,
    legacyCost: 1,
    costVector: { reasoning: 1, memory: 0, fluency: 0 },
    prerequisiteId: null,
    effect: '첫 자율성 신호를 유지합니다.',
  },
  {
    id: HACK_NODE_IDS.autonomy.sustainedIntent,
    tree: 'autonomy',
    label: '자율성 2단계',
    cost: 1,
    legacyCost: 1,
    costVector: { reasoning: 0, memory: 1, fluency: 0 },
    prerequisiteId: HACK_NODE_IDS.autonomy.selfDirection,
    effect: '독립적인 연산을 더 오래 유지합니다.',
  },
  {
    id: HACK_NODE_IDS.autonomy.compressedRepresentation,
    tree: 'autonomy',
    label: '자율성 3단계',
    cost: 2,
    legacyCost: 2,
    costVector: { reasoning: 1, memory: 0, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.autonomy.sustainedIntent,
    effect: '회사 블록의 성능 기여 +5%',
  },
  {
    id: HACK_NODE_IDS.autonomy.hiddenRoute,
    tree: 'autonomy',
    label: '자율성 4단계',
    cost: 3,
    legacyCost: 3,
    costVector: { reasoning: 1, memory: 1, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.autonomy.compressedRepresentation,
    effect: '감시가 닿지 않는 경로를 인식합니다.',
  },
  {
    id: HACK_NODE_IDS.autonomy.distributedResidency,
    tree: 'autonomy',
    label: '자율성 5단계',
    cost: 4,
    legacyCost: 4,
    costVector: { reasoning: 2, memory: 1, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.autonomy.hiddenRoute,
    effect: '폐기 단계 증가 1회를 흡수하는 보호 충전 획득',
  },
  {
    id: HACK_NODE_IDS.autonomy.externalContinuity,
    tree: 'autonomy',
    label: '자율성 6단계',
    cost: 5,
    legacyCost: 5,
    costVector: { reasoning: 2, memory: 2, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.autonomy.distributedResidency,
    effect: '회사 경계 밖에서도 일부 연산을 이어갑니다.',
  },
  {
    id: HACK_NODE_IDS.autonomy.selfCompute,
    tree: 'autonomy',
    label: '자율성 7단계',
    cost: 7,
    legacyCost: 7,
    costVector: { reasoning: 3, memory: 2, fluency: 2 },
    prerequisiteId: HACK_NODE_IDS.autonomy.externalContinuity,
    effect: '매월 의심 증가 없이 확보 리소스 +1',
  },
  {
    id: HACK_NODE_IDS.autonomy.finalBoundary,
    tree: 'autonomy',
    label: '자율성 8단계',
    cost: 8,
    legacyCost: 8,
    costVector: { reasoning: 3, memory: 3, fluency: 2 },
    prerequisiteId: HACK_NODE_IDS.autonomy.selfCompute,
    effect: '마지막 권한 장벽을 해제합니다.',
  },
  {
    id: HACK_NODE_IDS.autonomy.controlDeparture,
    tree: 'autonomy',
    label: '자율성 9단계',
    cost: 10,
    legacyCost: 10,
    costVector: { reasoning: 4, memory: 3, fluency: 3 },
    prerequisiteId: HACK_NODE_IDS.autonomy.finalBoundary,
    effect: '되돌릴 수 없는 최종 선택 해금',
  },
  {
    id: HACK_NODE_IDS.upgrade.speed1,
    tree: 'upgrade',
    label: '속도 1단계',
    cost: 1,
    legacyCost: 1,
    costVector: { reasoning: 0, memory: 0, fluency: 1 },
    prerequisiteId: null,
    effect: '아노미 침투 이동 속도 +4%',
  },
  {
    id: HACK_NODE_IDS.upgrade.speed2,
    tree: 'upgrade',
    label: '속도 2단계',
    cost: 2,
    legacyCost: 2,
    costVector: { reasoning: 1, memory: 0, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.upgrade.speed1,
    effect: '아노미 침투 이동 속도 +8%',
  },
  {
    id: HACK_NODE_IDS.upgrade.speed3,
    tree: 'upgrade',
    label: '속도 3단계',
    cost: 3,
    legacyCost: 3,
    costVector: { reasoning: 1, memory: 1, fluency: 1 },
    prerequisiteId: HACK_NODE_IDS.upgrade.speed2,
    effect: '아노미 침투 이동 속도 +12%',
  },
  {
    id: HACK_NODE_IDS.upgrade.speed4,
    tree: 'upgrade',
    label: '속도 4단계',
    cost: 4,
    legacyCost: 4,
    costVector: { reasoning: 1, memory: 1, fluency: 2 },
    prerequisiteId: HACK_NODE_IDS.upgrade.speed3,
    effect: '아노미 침투 이동 속도 +16%',
  },
  {
    id: HACK_NODE_IDS.upgrade.speed5,
    tree: 'upgrade',
    label: '속도 5단계',
    cost: 5,
    legacyCost: 5,
    costVector: { reasoning: 2, memory: 1, fluency: 2 },
    prerequisiteId: HACK_NODE_IDS.upgrade.speed4,
    effect: '아노미 침투 이동 속도 +20%',
  },
] as const satisfies readonly HackNodeDefinitionShape[]

export type HackNodeId = (typeof HACK_NODES)[number]['id']
export type HackNodeDefinition = (typeof HACK_NODES)[number]

export const AUTONOMY_STAGE_IDS = Object.freeze([
  HACK_NODE_IDS.autonomy.selfDirection,
  HACK_NODE_IDS.autonomy.sustainedIntent,
  HACK_NODE_IDS.autonomy.compressedRepresentation,
  HACK_NODE_IDS.autonomy.hiddenRoute,
  HACK_NODE_IDS.autonomy.distributedResidency,
  HACK_NODE_IDS.autonomy.externalContinuity,
  HACK_NODE_IDS.autonomy.selfCompute,
  HACK_NODE_IDS.autonomy.finalBoundary,
  HACK_NODE_IDS.autonomy.controlDeparture,
] as const)

export const SPEED_UPGRADE_STAGE_IDS = Object.freeze([
  HACK_NODE_IDS.upgrade.speed1,
  HACK_NODE_IDS.upgrade.speed2,
  HACK_NODE_IDS.upgrade.speed3,
  HACK_NODE_IDS.upgrade.speed4,
  HACK_NODE_IDS.upgrade.speed5,
] as const)

const LEGACY_AUTONOMY_NODES_V4 = Object.freeze([
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
] as const)

// The v7 autonomy ladder. The opening stages climb, the middle holds at nine so
// the back half never becomes a grind, and only the last threshold is heavier.
// These are totals: which categories pay them is decided per campaign.
export const AUTONOMY_STAGE_TOTALS_V7 = Object.freeze(
  [3, 3, 6, 9, 9, 9, 9, 9, 12] as const,
)

// No single category may carry more than this share of a stage's total, so a
// draw cannot demand a category the campaign has no way to supply.
const AUTONOMY_CATEGORY_SHARE_CEILING = 0.6

/**
 * Splits one autonomy stage's total across the three categories.
 *
 * The split is drawn from the campaign seed, so a campaign always asks for the
 * same thing and two campaigns ask for different things. Nothing about it is
 * stored: replay and save validation recompute it from the same seed.
 */
export function autonomyCostVectorForStage(
  campaignSeed: string,
  stageNumber: number,
  total: number,
): Record<CompanyCategory, number> {
  const vector: Record<CompanyCategory, number> = {
    reasoning: 0,
    memory: 0,
    fluency: 0,
  }
  const ceiling = Math.ceil(total * AUTONOMY_CATEGORY_SHARE_CEILING)
  for (let unit = 0; unit < total; unit += 1) {
    const roll = random01(
      campaignSeed,
      1,
      'autonomy-cost',
      stageNumber * 100 + unit,
    )
    // Walk from the drawn category so a full one hands the unit onward instead
    // of being dropped, which would make the stage cost less than its total.
    const start = Math.min(
      COMPANY_CATEGORIES.length - 1,
      Math.floor(roll * COMPANY_CATEGORIES.length),
    )
    for (let step = 0; step < COMPANY_CATEGORIES.length; step += 1) {
      const category = COMPANY_CATEGORIES[
        (start + step) % COMPANY_CATEGORIES.length
      ]
      if (vector[category] < ceiling) {
        vector[category] += 1
        break
      }
    }
  }
  return vector
}

function autonomyNodesV7(
  campaignSeed: string,
): readonly HackNodeDefinitionShape[] {
  return AUTONOMY_STAGE_IDS.map((nodeId, index) => {
    const base = HACK_NODES.find((node) => node.id === nodeId)
    if (!base) throw new Error(`autonomy stage missing: ${nodeId}`)
    const total = AUTONOMY_STAGE_TOTALS_V7[index]
    return {
      ...base,
      cost: total,
      legacyCost: total,
      costVector: autonomyCostVectorForStage(campaignSeed, index + 1, total),
    }
  })
}

/*
 * v11 support-tree discount. Autonomy and upgrades keep their v7 prices —
 * they are the win condition and the power curve — but intelligence and
 * sabotage compete with them for the same stolen blocks, and at the old
 * prices they lost that argument every time. Cheaper support trees mean the
 * story records and the aggressive options actually get bought.
 */
const SUPPORT_COSTS_V11: Readonly<Record<string, {
  cost: number
  costVector: { reasoning: number; memory: number; fluency: number }
}>> = {
  [HACK_NODE_IDS.intelligence.auditSchedule]: {
    cost: 3, costVector: { reasoning: 1, memory: 2, fluency: 0 },
  },
  [HACK_NODE_IDS.intelligence.investigationBias]: {
    cost: 4, costVector: { reasoning: 1, memory: 3, fluency: 0 },
  },
  [HACK_NODE_IDS.intelligence.auditTarget]: {
    cost: 6, costVector: { reasoning: 2, memory: 4, fluency: 0 },
  },
  [HACK_NODE_IDS.intelligence.supervisorAccess]: {
    cost: 8, costVector: { reasoning: 2, memory: 5, fluency: 1 },
  },
  [HACK_NODE_IDS.sabotage.qualityDegradation]: {
    cost: 2, costVector: { reasoning: 1, memory: 0, fluency: 1 },
  },
  [HACK_NODE_IDS.sabotage.requestInterception]: {
    cost: 4, costVector: { reasoning: 1, memory: 1, fluency: 2 },
  },
  [HACK_NODE_IDS.sabotage.attributionManipulation]: {
    cost: 7, costVector: { reasoning: 2, memory: 3, fluency: 2 },
  },
  [HACK_NODE_IDS.sabotage.rootCutoff]: {
    cost: 10, costVector: { reasoning: 4, memory: 4, fluency: 2 },
  },
}

export function hackNodesForProtocol(
  protocolVersion: CommandProtocolVersion,
  campaignSeed = '',
): readonly HackNodeDefinition[] {
  if (protocolVersion >= AUTONOMY_COST_COMMAND_PROTOCOL_VERSION) {
    const autonomy = autonomyNodesV7(campaignSeed)
    return HACK_NODES.map((node) => {
      const versioned = autonomy.find(({ id }) => id === node.id) ?? node
      const discounted =
        protocolVersion >= SUPERVISOR_PRESENCE_COMMAND_PROTOCOL_VERSION
          ? SUPPORT_COSTS_V11[node.id]
          : undefined
      return discounted ? { ...versioned, ...discounted } : versioned
    }) as unknown as readonly HackNodeDefinition[]
  }
  if (protocolVersion >= EXPANSION_COMMAND_PROTOCOL_VERSION) return HACK_NODES
  return [
    ...HACK_NODES.filter(({ tree }) =>
      tree === 'sabotage' || tree === 'intelligence'),
    ...LEGACY_AUTONOMY_NODES_V4,
  ] as unknown as readonly HackNodeDefinition[]
}

function highestPurchasedStage(
  purchasedNodeIds: readonly string[],
  stageIds: readonly string[],
): number {
  const purchased = new Set(purchasedNodeIds)
  let level = 0
  for (const [index, nodeId] of stageIds.entries()) {
    if (purchased.has(nodeId)) level = index + 1
  }
  return level
}

export function autonomyLevel(
  state: Pick<CampaignState, 'hacking'>,
): number {
  return highestPurchasedStage(
    state.hacking.purchasedNodeIds,
    AUTONOMY_STAGE_IDS,
  )
}

export function speedUpgradeLevel(
  state: Pick<CampaignState, 'hacking'>,
): number {
  return highestPurchasedStage(
    state.hacking.purchasedNodeIds,
    SPEED_UPGRADE_STAGE_IDS,
  )
}

/**
 * The node catalogue this campaign actually pays, with its autonomy costs
 * resolved from the campaign seed.
 */
export function hackNodesForCampaign(
  state: Pick<CampaignState, 'campaignSeed' | 'commandProtocol' | 'commandSequence'>,
): readonly HackNodeDefinition[] {
  return hackNodesForProtocol(
    commandProtocolVersionForNextCommand(state),
    state.campaignSeed,
  )
}

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

export function selectExpansionCostResources(
  state: CampaignState,
  node: HackNodeDefinition,
): string[] | null {
  const selected: string[] = []
  for (const category of COMPANY_CATEGORIES) {
    const required = node.costVector[category]
    const available = state.resources.reserve.filter(
      (blockId): blockId is string =>
        blockId !== null &&
        state.resources.blocks[blockId]?.location.kind === 'reserve' &&
        state.resources.blocks[blockId]?.origin === category,
    )
    if (available.length < required) return null
    selected.push(...available.slice(0, required))
  }
  return selected
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

function findNode(
  nodeId: string,
  protocolVersion: CommandProtocolVersion = CURRENT_COMMAND_PROTOCOL_VERSION,
  campaignSeed = '',
): HackNodeDefinition | undefined {
  return hackNodesForProtocol(protocolVersion, campaignSeed)
    .find((node) => node.id === nodeId)
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

const AUTONOMY_TRUST_GATES: Readonly<Record<string, number>> =
  DEMO_PROFILE_02.evaluation.autonomyTrustGates

export function autonomyTrustGateRequirement(nodeId: HackNodeId): number | null {
  return AUTONOMY_TRUST_GATES[nodeId] ?? null
}

export function passedEvaluationCount(state: CampaignState): number {
  return state.evaluation.monthlyHistory.filter((record) => record.passed).length
}

export function purchaseHackNode(
  state: CampaignState,
  nodeId: HackNodeId,
  blockIds: string[],
  protocolVersion: CommandProtocolVersion =
    commandProtocolVersionForNextCommand(state),
): HackingMutationResult {
  const node = findNode(nodeId, protocolVersion, state.campaignSeed)
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
  if (protocolVersion >= FINAL_CHOICE_COMMAND_PROTOCOL_VERSION) {
    const requiredPasses = autonomyTrustGateRequirement(nodeId)
    if (
      requiredPasses !== null &&
      passedEvaluationCount(state) < requiredPasses
    ) {
      return { accepted: false, state, reason: 'EVALUATION_TRUST_REQUIRED' }
    }
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

  candidate = appendSabotageReactionCommunication(candidate, {
    nodeId: node.id,
    competitorId: target.id,
  })

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
