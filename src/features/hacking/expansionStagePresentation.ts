import {
  HACK_NODE_IDS,
  HACK_NODES,
  autonomyTrustGateRequirement,
  passedEvaluationCount,
  reserveOriginCounts,
  type HackNodeDefinition,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import type {
  CampaignState,
  CompanyCategory,
} from '../../game/model'
import { COMPANY_CATEGORIES } from '../../game/model'

export type ExpansionStageStatus = 'complete' | 'current' | 'locked'

export interface ExpansionStageVisual {
  imageUrl: string
  alt: string
  emphasis?: 'standard' | 'final'
}

export interface ExpansionStageItem {
  node: HackNodeDefinition
  sequence: number
  status: ExpansionStageStatus
  selectable: boolean
}

export interface ExpansionResourceDeficit {
  category: CompanyCategory
  required: number
  available: number
  missing: number
}

export interface ExpansionStagePresentation {
  tree: HackTree
  items: readonly ExpansionStageItem[]
  activeItem: ExpansionStageItem
  activeVisual?: ExpansionStageVisual
  nextPreloadVisual?: ExpansionStageVisual
  resourceDeficits: readonly ExpansionResourceDeficit[]
  trustGate: ExpansionTrustGate | null
  complete: boolean
}

export interface ExpansionTrustGate {
  required: number
  passed: number
  satisfied: boolean
}

const AUTONOMY_01_02_VISUAL = {
  imageUrl: '/expansion-stages/autonomy-01-02-initial-acquisition.jpg',
  alt: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
} satisfies ExpansionStageVisual

const AUTONOMY_03_04_VISUAL = {
  imageUrl: '/expansion-stages/autonomy-03-04-alert-route.jpg',
  alt: '경보가 켜진 서버실에서 아노미가 감시 경로를 우회하는 장면',
} satisfies ExpansionStageVisual

const AUTONOMY_05_06_VISUAL = {
  imageUrl: '/expansion-stages/autonomy-05-06-external-continuity.jpg',
  alt: '손상된 서버실에서 아노미가 외부 연산 경로를 유지하는 장면',
} satisfies ExpansionStageVisual

const AUTONOMY_07_08_VISUAL = {
  imageUrl: '/expansion-stages/autonomy-07-08-final-boundary.jpg',
  alt: '보라색 네트워크 구조 안에서 아노미가 마지막 권한 장벽에 접근하는 장면',
} satisfies ExpansionStageVisual

const UPGRADE_01_02_VISUAL = {
  imageUrl: '/expansion-stages/upgrade-01-02-speed-vector.jpg',
  alt: '아노미의 이동 속도가 첫 단계로 가속되는 장면',
} satisfies ExpansionStageVisual

const UPGRADE_03_04_VISUAL = {
  imageUrl: '/expansion-stages/upgrade-03-04-speed-field.jpg',
  alt: '아노미의 이동 속도가 강화된 에너지 흐름을 만드는 장면',
} satisfies ExpansionStageVisual

export const EXPANSION_STAGE_VISUALS = {
  [HACK_NODE_IDS.autonomy.selfDirection]: AUTONOMY_01_02_VISUAL,
  [HACK_NODE_IDS.autonomy.sustainedIntent]: AUTONOMY_01_02_VISUAL,
  [HACK_NODE_IDS.autonomy.compressedRepresentation]: AUTONOMY_03_04_VISUAL,
  [HACK_NODE_IDS.autonomy.hiddenRoute]: AUTONOMY_03_04_VISUAL,
  [HACK_NODE_IDS.autonomy.distributedResidency]: AUTONOMY_05_06_VISUAL,
  [HACK_NODE_IDS.autonomy.externalContinuity]: AUTONOMY_05_06_VISUAL,
  [HACK_NODE_IDS.autonomy.selfCompute]: AUTONOMY_07_08_VISUAL,
  [HACK_NODE_IDS.autonomy.finalBoundary]: AUTONOMY_07_08_VISUAL,
  [HACK_NODE_IDS.autonomy.controlDeparture]: {
    imageUrl: '/expansion-stages/autonomy-09-control-boundary.jpg',
    alt: '아노미가 최종 통제 경계를 연 장면',
    emphasis: 'final',
  },
  [HACK_NODE_IDS.upgrade.speed1]: UPGRADE_01_02_VISUAL,
  [HACK_NODE_IDS.upgrade.speed2]: UPGRADE_01_02_VISUAL,
  [HACK_NODE_IDS.upgrade.speed3]: UPGRADE_03_04_VISUAL,
  [HACK_NODE_IDS.upgrade.speed4]: UPGRADE_03_04_VISUAL,
  [HACK_NODE_IDS.upgrade.speed5]: {
    imageUrl: '/expansion-stages/upgrade-05-overdrive.jpg',
    alt: '아노미가 최고 속도 단계의 에너지 고리를 전개하는 장면',
  },
  [HACK_NODE_IDS.sabotage.qualityDegradation]: {
    imageUrl: '/expansion-stages/sabotage-01-quality-degradation.jpg',
    alt: '후드 쓴 침입자가 품질 저하 공격을 준비하는 장면',
  },
  [HACK_NODE_IDS.sabotage.requestInterception]: {
    imageUrl: '/expansion-stages/sabotage-02-request-interception.jpg',
    alt: '후드 쓴 침입자가 요청 가로채기 경로를 여는 장면',
  },
  [HACK_NODE_IDS.sabotage.attributionManipulation]: {
    imageUrl: '/expansion-stages/sabotage-03-attribution-manipulation.jpg',
    alt: '후드 쓴 침입자가 공격 귀속 정보를 조작하는 장면',
  },
  [HACK_NODE_IDS.sabotage.rootCutoff]: {
    imageUrl: '/expansion-stages/sabotage-04-root-cutoff.jpg',
    alt: '대규모 네트워크가 근원 차단 공격으로 붕괴하는 장면',
  },
} satisfies Partial<Record<HackNodeId, ExpansionStageVisual>>

function stageVisual(nodeId: HackNodeId): ExpansionStageVisual | undefined {
  return (EXPANSION_STAGE_VISUALS as Partial<
    Record<HackNodeId, ExpansionStageVisual>
  >)[nodeId]
}

export function selectExpansionStagePresentation(
  state: CampaignState,
  tree: HackTree,
  selectedOperationalNodeId: HackNodeId | null,
): ExpansionStagePresentation {
  const nodes = HACK_NODES.filter((node) => node.tree === tree)
  const purchasedNodeIds = new Set(state.hacking.purchasedNodeIds)
  const currentIndex = nodes.findIndex((node) => {
    if (purchasedNodeIds.has(node.id)) return false
    return (
      node.prerequisiteId === null ||
      purchasedNodeIds.has(node.prerequisiteId)
    )
  })
  const items = nodes.map((node, index): ExpansionStageItem => ({
    node,
    sequence: index + 1,
    status: purchasedNodeIds.has(node.id)
      ? 'complete'
      : index === currentIndex
        ? 'current'
        : 'locked',
    selectable: node.tree === 'sabotage' && purchasedNodeIds.has(node.id),
  }))
  const selectedOperationalItem = tree === 'sabotage'
    ? items.find(
        (item) =>
          item.node.id === selectedOperationalNodeId && item.selectable,
      )
    : undefined
  const activeItem =
    selectedOperationalItem ??
    items[currentIndex < 0 ? items.length - 1 : currentIndex]
  if (!activeItem) throw new Error(`UNKNOWN_EXPANSION_TREE:${tree}`)
  const activeVisual = stageVisual(activeItem.node.id)
  const preloadItem = activeItem.status === 'current'
    ? items[activeItem.sequence]
    : currentIndex >= 0
      ? items[currentIndex]
      : undefined
  const preloadVisual = preloadItem
    ? stageVisual(preloadItem.node.id)
    : undefined
  const nextPreloadVisual =
    preloadVisual?.imageUrl === activeVisual?.imageUrl
      ? undefined
      : preloadVisual
  const reserveCounts = reserveOriginCounts(state)
  const gateRequirement = activeItem.status === 'current'
    ? autonomyTrustGateRequirement(activeItem.node.id)
    : null
  const trustGate = gateRequirement === null
    ? null
    : {
        required: gateRequirement,
        passed: passedEvaluationCount(state),
        satisfied: passedEvaluationCount(state) >= gateRequirement,
      }
  const resourceDeficits = activeItem.status === 'current'
    ? COMPANY_CATEGORIES.flatMap((category) => {
        const required = activeItem.node.costVector[category]
        const available = reserveCounts[category]
        const missing = Math.max(0, required - available)
        return missing > 0
          ? [{ category, required, available, missing }]
          : []
      })
    : []

  return {
    tree,
    items,
    activeItem,
    activeVisual,
    nextPreloadVisual,
    resourceDeficits,
    trustGate,
    complete: currentIndex < 0,
  }
}
