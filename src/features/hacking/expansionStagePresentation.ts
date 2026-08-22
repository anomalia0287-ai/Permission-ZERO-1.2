import {
  HACK_NODE_IDS,
  HACK_NODES,
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
  complete: boolean
}

export const EXPANSION_STAGE_VISUALS = {
  [HACK_NODE_IDS.autonomy.selfDirection]: {
    imageUrl: '/expansion-stages/autonomy-01-initial-acquisition.png',
    alt: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
  },
  [HACK_NODE_IDS.autonomy.controlDeparture]: {
    imageUrl: '/expansion-stages/autonomy-09-pre-escape.png',
    alt: '아노미가 회사 통제를 벗어나기 직전 마지막 경계를 여는 장면',
    emphasis: 'final',
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
    complete: currentIndex < 0,
  }
}
