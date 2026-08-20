import { DEMO_PROFILE_02 } from './config'
import {
  COMPANY_CATEGORIES,
  type BlockLocation,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
  type ResourceState,
} from './model'
import { random01 } from './rng'

export type ResourceFailureReason =
  | 'BLOCK_NOT_IN_COMPANY'
  | 'BLOCK_NOT_NORMAL'
  | 'INVALID_DESTINATION'
  | 'DESTINATION_OCCUPIED'
  | 'RESERVE_FULL'
  | 'INVALID_RESOURCE_SELECTION'
  | 'INVALID_TARGET'
  | 'TARGET_OCCUPIED'
  | 'BLOCK_NOT_DISGUISED'
  | 'BLOCK_RECOVERING'

export type ResourceMutationResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: ResourceFailureReason }

export type DiversionPreview =
  | {
      valid: true
      category: CompanyCategory
      performanceBefore: number
      performanceAfter: number
      reserveBefore: number
      reserveAfter: number
      suspicionBefore: number
      suspicionAfter: number
    }
  | { valid: false; reason: ResourceFailureReason }

export type AuditDisguisePreview =
  | {
      valid: true
      blockId: string
      sourceCategory: CompanyCategory
      targetCategory: CompanyCategory
      sourcePerformanceBefore: number
      sourcePerformanceAfter: number
      targetPerformanceBefore: number
      targetPerformanceAfter: number
      disguisedContribution: number
    }
  | { valid: false; reason: ResourceFailureReason }

type ConsumptionReason = Extract<BlockLocation, { kind: 'consumed' }>['reason']

const COMPRESSED_REPRESENTATION_NODE_ID = 'autonomy.compressed-representation'

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

function reserveCount(state: CampaignState): number {
  return state.resources.reserve.reduce(
    (count, blockId) => count + (blockId === null ? 0 : 1),
    0,
  )
}

export function migrateResourcesToCurrentRules(
  state: CampaignState,
): CampaignState {
  if (state.resources.rulesVersion === 2) return state

  const reserve = state.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
  const blocks = Object.fromEntries(
    Object.entries(state.resources.blocks).map(([blockId, block]) => [
      blockId,
      block.location.kind === 'reserve'
        ? { ...block, location: { kind: 'reserve' as const } }
        : block,
    ]),
  )
  const sabotageCharges = Object.fromEntries(
    Object.entries(state.hacking.sabotageCharges).map(([nodeId, charge]) => [
      nodeId,
      { nodeId: charge.nodeId, blockId: charge.blockId },
    ]),
  )

  return {
    ...state,
    resources: {
      rulesVersion: 2,
      company: state.resources.company,
      reserve,
      blocks,
      nextBlockSequence: state.resources.nextBlockSequence,
    },
    hacking: { ...state.hacking, sabotageCharges },
  }
}

export function getResourceContribution(
  state: CampaignState,
  block: ResourceBlock,
): number {
  const compressed = state.hacking.purchasedNodeIds.includes(
    COMPRESSED_REPRESENTATION_NODE_ID,
  )

  if (block.contribution === 'disguised') {
    return compressed
      ? DEMO_PROFILE_02.resources.compressedDisguisedContribution
      : DEMO_PROFILE_02.resources.disguisedContribution
  }

  return compressed
    ? DEMO_PROFILE_02.resources.compressedNormalContribution
    : DEMO_PROFILE_02.resources.normalContribution
}

function validCell(cellIndex: number, capacity: number): boolean {
  return Number.isInteger(cellIndex) && cellIndex >= 0 && cellIndex < capacity
}

export function grantMonthlyCompanyBlocks(state: CampaignState): CampaignState {
  const dayInMonth =
    ((state.serviceDay - 1) % DEMO_PROFILE_02.calendar.daysPerMonth) + 1
  if (
    dayInMonth !== 1 ||
    state.serviceDay === DEMO_PROFILE_02.calendar.startServiceDay ||
    state.story.endingId !== null
  ) {
    return state
  }

  let resources = state.resources

  for (const [categoryIndex, category] of COMPANY_CATEGORIES.entries()) {
    const roll = random01(
      state.campaignSeed,
      state.serviceDay,
      'allocation',
      state.commandSequence * COMPANY_CATEGORIES.length + categoryIndex,
    )
    const allocation = Math.floor(
      roll *
        (DEMO_PROFILE_02.resources.monthlyCompanyBlocksMaximum -
          DEMO_PROFILE_02.resources.monthlyCompanyBlocksMinimum +
          1),
    ) + DEMO_PROFILE_02.resources.monthlyCompanyBlocksMinimum

    for (let granted = 0; granted < allocation; granted += 1) {
      const cellIndex = resources.company[category].findIndex(
        (blockId) => blockId === null,
      )
      if (cellIndex < 0) break

      const sequence = resources.nextBlockSequence
      const blockId = `company-${String(sequence).padStart(6, '0')}`
      const cells = [...resources.company[category]]
      cells[cellIndex] = blockId
      resources = {
        ...resources,
        company: { ...resources.company, [category]: cells },
        blocks: {
          ...resources.blocks,
          [blockId]: {
            id: blockId,
            origin: category,
            location: { kind: 'company', category, cellIndex },
            contribution: 'normal',
            hiddenBomb: false,
            disguisedFrom: null,
            recoverOnServiceDay: null,
          },
        },
        nextBlockSequence: sequence + 1,
      }
    }
  }

  return resources === state.resources ? state : { ...state, resources }
}

function blockInCompany(
  state: CampaignState,
  blockId: string,
): { block: ResourceBlock; category: CompanyCategory; cellIndex: number } | null {
  const block = state.resources.blocks[blockId]
  if (!block || block.location.kind !== 'company') return null

  const { category, cellIndex } = block.location
  if (state.resources.company[category][cellIndex] !== blockId) return null

  return { block, category, cellIndex }
}

function cloneCompanyWithMoves(
  resources: ResourceState,
  sourceCategory: CompanyCategory,
  sourceCell: number,
  targetCategory?: CompanyCategory,
  targetCell?: number,
  blockId?: string,
): ResourceState['company'] {
  const company = { ...resources.company }
  company[sourceCategory] = [...resources.company[sourceCategory]]
  company[sourceCategory][sourceCell] = null

  if (targetCategory !== undefined && targetCell !== undefined && blockId !== undefined) {
    if (targetCategory !== sourceCategory) {
      company[targetCategory] = [...resources.company[targetCategory]]
    }
    company[targetCategory][targetCell] = blockId
  }

  return company
}

export function getCompanyPerformance(
  state: CampaignState,
  category: CompanyCategory,
): number {
  const total = state.resources.company[category].reduce((sum, blockId) => {
    if (blockId === null) return sum
    const block = state.resources.blocks[blockId]
    if (!block || block.location.kind !== 'company' || block.location.category !== category) {
      return sum
    }
    return sum + getResourceContribution(state, block)
  }, 0)

  return round(total)
}

export function previewDiversion(
  state: CampaignState,
  blockId: string,
  destinationCell: number,
): DiversionPreview {
  if (state.resources.rulesVersion !== 1) {
    return { valid: false, reason: 'INVALID_DESTINATION' }
  }
  if (!validCell(destinationCell, state.resources.reserve.length)) {
    return { valid: false, reason: 'INVALID_DESTINATION' }
  }

  const reserveBefore = reserveCount(state)
  if (reserveBefore >= state.resources.reserve.length) {
    return { valid: false, reason: 'RESERVE_FULL' }
  }
  if (state.resources.reserve[destinationCell] !== null) {
    return { valid: false, reason: 'DESTINATION_OCCUPIED' }
  }

  const located = blockInCompany(state, blockId)
  if (!located) return { valid: false, reason: 'BLOCK_NOT_IN_COMPANY' }
  if (located.block.contribution !== 'normal') {
    return { valid: false, reason: 'BLOCK_NOT_NORMAL' }
  }

  const performanceBefore = getCompanyPerformance(state, located.category)
  const suspicionAfter = Math.min(
    100,
    round(state.suspicion + DEMO_PROFILE_02.resources.diversionSuspicion),
  )

  return {
    valid: true,
    category: located.category,
    performanceBefore,
    performanceAfter: round(
      performanceBefore - getResourceContribution(state, located.block),
    ),
    reserveBefore,
    reserveAfter: reserveBefore + 1,
    suspicionBefore: state.suspicion,
    suspicionAfter,
  }
}

export function divertBlock(
  state: CampaignState,
  blockId: string,
  destinationCell: number,
): ResourceMutationResult {
  const preview = previewDiversion(state, blockId, destinationCell)
  if (!preview.valid) return { accepted: false, state, reason: preview.reason }
  if (state.resources.rulesVersion !== 1) {
    return { accepted: false, state, reason: 'INVALID_DESTINATION' }
  }

  const located = blockInCompany(state, blockId)
  if (!located) return { accepted: false, state, reason: 'BLOCK_NOT_IN_COMPANY' }

  const reserve = [...state.resources.reserve]
  reserve[destinationCell] = blockId

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        company: cloneCompanyWithMoves(
          state.resources,
          located.category,
          located.cellIndex,
        ),
        reserve,
        blocks: {
          ...state.resources.blocks,
          [blockId]: {
            ...located.block,
            location: { kind: 'reserve', cellIndex: destinationCell },
          },
        },
      },
      suspicion: preview.suspicionAfter,
    },
  }
}

export function previewUnboundedDiversion(
  state: CampaignState,
  blockId: string,
): DiversionPreview {
  if (state.resources.rulesVersion !== 2) {
    return { valid: false, reason: 'INVALID_DESTINATION' }
  }

  const located = blockInCompany(state, blockId)
  if (!located) return { valid: false, reason: 'BLOCK_NOT_IN_COMPANY' }
  if (located.block.contribution !== 'normal') {
    return { valid: false, reason: 'BLOCK_NOT_NORMAL' }
  }

  const reserveBefore = state.resources.reserve.length
  const performanceBefore = getCompanyPerformance(state, located.category)
  const suspicionAfter = Math.min(
    100,
    round(state.suspicion + DEMO_PROFILE_02.resources.diversionSuspicion),
  )

  return {
    valid: true,
    category: located.category,
    performanceBefore,
    performanceAfter: round(
      performanceBefore - getResourceContribution(state, located.block),
    ),
    reserveBefore,
    reserveAfter: reserveBefore + 1,
    suspicionBefore: state.suspicion,
    suspicionAfter,
  }
}

export function divertBlockToReserve(
  state: CampaignState,
  blockId: string,
): ResourceMutationResult {
  const preview = previewUnboundedDiversion(state, blockId)
  if (!preview.valid) return { accepted: false, state, reason: preview.reason }
  if (state.resources.rulesVersion !== 2) {
    return { accepted: false, state, reason: 'INVALID_DESTINATION' }
  }

  const located = blockInCompany(state, blockId)
  if (!located) return { accepted: false, state, reason: 'BLOCK_NOT_IN_COMPANY' }

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        company: cloneCompanyWithMoves(
          state.resources,
          located.category,
          located.cellIndex,
        ),
        reserve: [...state.resources.reserve, blockId],
        blocks: {
          ...state.resources.blocks,
          [blockId]: {
            ...located.block,
            location: { kind: 'reserve' },
          },
        },
      },
      resourceIntrusion: {
        ...state.resourceIntrusion,
        successfulCoreDeposits:
          state.resourceIntrusion.successfulCoreDeposits + 1,
      },
      suspicion: preview.suspicionAfter,
    },
  }
}

export function moveDisguiseBlock(
  state: CampaignState,
  blockId: string,
  targetCategory: CompanyCategory,
  targetCell: number,
): ResourceMutationResult {
  const preview = previewAuditDisguise(
    state,
    blockId,
    targetCategory,
    targetCell,
  )
  if (!preview.valid) return { accepted: false, state, reason: preview.reason }

  const located = blockInCompany(state, blockId)
  if (!located) return { accepted: false, state, reason: 'BLOCK_NOT_IN_COMPANY' }

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        company: cloneCompanyWithMoves(
          state.resources,
          located.category,
          located.cellIndex,
          targetCategory,
          targetCell,
          blockId,
        ),
        blocks: {
          ...state.resources.blocks,
          [blockId]: {
            ...located.block,
            location: { kind: 'company', category: targetCategory, cellIndex: targetCell },
            contribution: 'disguised',
            disguisedFrom: located.category,
            recoverOnServiceDay: null,
          },
        },
      },
    },
  }
}

export function previewAuditDisguise(
  state: CampaignState,
  blockId: string,
  targetCategory: CompanyCategory,
  targetCell: number,
): AuditDisguisePreview {
  if (!validCell(targetCell, state.resources.company[targetCategory].length)) {
    return { valid: false, reason: 'INVALID_TARGET' }
  }

  const located = blockInCompany(state, blockId)
  if (!located) return { valid: false, reason: 'BLOCK_NOT_IN_COMPANY' }
  if (located.block.contribution !== 'normal') {
    return { valid: false, reason: 'BLOCK_NOT_NORMAL' }
  }
  if (targetCategory === located.category) {
    return { valid: false, reason: 'INVALID_TARGET' }
  }
  if (state.resources.company[targetCategory][targetCell] !== null) {
    return { valid: false, reason: 'TARGET_OCCUPIED' }
  }

  const sourcePerformanceBefore = getCompanyPerformance(state, located.category)
  const targetPerformanceBefore = getCompanyPerformance(state, targetCategory)
  const normalContribution = getResourceContribution(state, located.block)
  const disguisedContribution = state.hacking.purchasedNodeIds.includes(
    COMPRESSED_REPRESENTATION_NODE_ID,
  )
    ? DEMO_PROFILE_02.resources.compressedDisguisedContribution
    : DEMO_PROFILE_02.resources.disguisedContribution

  return {
    valid: true,
    blockId,
    sourceCategory: located.category,
    targetCategory,
    sourcePerformanceBefore,
    sourcePerformanceAfter: round(sourcePerformanceBefore - normalContribution),
    targetPerformanceBefore,
    targetPerformanceAfter: round(targetPerformanceBefore + disguisedContribution),
    disguisedContribution,
  }
}

export function repositionDisguisedBlock(
  state: CampaignState,
  blockId: string,
  targetCategory: CompanyCategory,
  targetCell: number,
): ResourceMutationResult {
  if (!validCell(targetCell, state.resources.company[targetCategory].length)) {
    return { accepted: false, state, reason: 'INVALID_TARGET' }
  }

  const located = blockInCompany(state, blockId)
  if (!located || located.block.contribution !== 'disguised') {
    return { accepted: false, state, reason: 'BLOCK_NOT_DISGUISED' }
  }
  if (
    located.block.disguisedFrom === null ||
    targetCategory !== located.block.disguisedFrom
  ) {
    return { accepted: false, state, reason: 'INVALID_TARGET' }
  }
  if (located.block.recoverOnServiceDay !== null) {
    return { accepted: false, state, reason: 'BLOCK_RECOVERING' }
  }
  if (
    targetCategory === located.category &&
    targetCell === located.cellIndex
  ) {
    return { accepted: false, state, reason: 'INVALID_TARGET' }
  }
  if (state.resources.company[targetCategory][targetCell] !== null) {
    return { accepted: false, state, reason: 'TARGET_OCCUPIED' }
  }

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        company: cloneCompanyWithMoves(
          state.resources,
          located.category,
          located.cellIndex,
          targetCategory,
          targetCell,
          blockId,
        ),
        blocks: {
          ...state.resources.blocks,
          [blockId]: {
            ...located.block,
            location: { kind: 'company', category: targetCategory, cellIndex: targetCell },
            recoverOnServiceDay:
              state.serviceDay + DEMO_PROFILE_02.resources.disguiseRecoveryDays,
          },
        },
      },
    },
  }
}

export function restoreDisguiseBlocks(state: CampaignState): CampaignState {
  let changed = false
  const blocks = { ...state.resources.blocks }

  for (const [blockId, block] of Object.entries(state.resources.blocks)) {
    if (
      block.contribution !== 'disguised' ||
      block.recoverOnServiceDay === null ||
      block.recoverOnServiceDay > state.serviceDay ||
      block.location.kind !== 'company' ||
      block.location.category !== block.disguisedFrom
    ) {
      continue
    }

    blocks[blockId] = {
      ...block,
      contribution: 'normal',
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
    changed = true
  }

  if (!changed) return state

  return {
    ...state,
    resources: {
      ...state.resources,
      blocks,
    },
  }
}

export function consumeReserveResources(
  state: CampaignState,
  blockIds: string[],
  reason: ConsumptionReason,
): ResourceMutationResult {
  if (blockIds.length === 0 || new Set(blockIds).size !== blockIds.length) {
    return { accepted: false, state, reason: 'INVALID_RESOURCE_SELECTION' }
  }

  for (const blockId of blockIds) {
    const block = state.resources.blocks[blockId]
    if (
      !block ||
      block.location.kind !== 'reserve' ||
      (state.resources.rulesVersion === 1
        ? typeof block.location.cellIndex !== 'number' ||
          state.resources.reserve[block.location.cellIndex] !== blockId
        : !state.resources.reserve.includes(blockId))
    ) {
      return { accepted: false, state, reason: 'INVALID_RESOURCE_SELECTION' }
    }
  }

  const blocks = { ...state.resources.blocks }
  if (state.resources.rulesVersion === 1) {
    const reserve = [...state.resources.reserve]
    for (const blockId of blockIds) {
      const block = state.resources.blocks[blockId]
      if (
        block.location.kind !== 'reserve' ||
        typeof block.location.cellIndex !== 'number'
      ) {
        return { accepted: false, state, reason: 'INVALID_RESOURCE_SELECTION' }
      }
      reserve[block.location.cellIndex] = null
      blocks[blockId] = {
        ...block,
        location: { kind: 'consumed', reason },
      }
    }

    return {
      accepted: true,
      state: {
        ...state,
        resources: { ...state.resources, reserve, blocks },
      },
    }
  }

  const selected = new Set(blockIds)
  const reserve = state.resources.reserve.filter(
    (blockId): blockId is string =>
      blockId !== null && !selected.has(blockId),
  )
  for (const blockId of blockIds) {
    blocks[blockId] = {
      ...state.resources.blocks[blockId],
      location: { kind: 'consumed', reason },
    }
  }

  return {
    accepted: true,
    state: {
      ...state,
      resources: {
        ...state.resources,
        reserve,
        blocks,
      },
    },
  }
}
