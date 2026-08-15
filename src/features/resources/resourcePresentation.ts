import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
} from '../../game/model'
import { getResourceContribution } from '../../game/resources'

export type ResourceVisualCategory = CompanyCategory | 'neutral'
export type ResourceVisualState = 'normal' | 'disguised' | 'recovering'

export interface ResourceBlockPresentation {
  visualCategory: ResourceVisualCategory
  originalCategory: CompanyCategory | null
  state: ResourceVisualState
  shape: 'rounded-square' | 'circle' | 'diamond' | 'hexagon'
  symbol: '∴' | '◇' | '≋' | '•'
  contribution: number | null
  remainingRecoveryDays: number | null
}

export const RESOURCE_CATEGORY_VISUALS = {
  reasoning: { shape: 'rounded-square', symbol: '∴' },
  memory: { shape: 'circle', symbol: '◇' },
  fluency: { shape: 'diamond', symbol: '≋' },
  neutral: { shape: 'hexagon', symbol: '•' },
} as const satisfies Record<
  ResourceVisualCategory,
  Pick<ResourceBlockPresentation, 'shape' | 'symbol'>
>

function isCompanyCategory(origin: ResourceBlock['origin']): origin is CompanyCategory {
  return COMPANY_CATEGORIES.includes(origin as CompanyCategory)
}

function visualCategoryFor(block: ResourceBlock): ResourceVisualCategory {
  if (block.location.kind === 'company') return block.location.category

  if (
    block.location.kind !== 'reserve' &&
    block.location.kind !== 'hack-charge'
  ) {
    throw new RangeError('RESOURCE_BLOCK_NOT_PRESENTABLE')
  }

  return isCompanyCategory(block.origin) ? block.origin : 'neutral'
}

function presentationStateFor(
  state: CampaignState,
  block: ResourceBlock,
): {
  state: ResourceVisualState
  originalCategory: CompanyCategory | null
  remainingRecoveryDays: number | null
} {
  if (block.contribution === 'normal') {
    if (
      block.disguisedFrom !== null ||
      block.recoverOnServiceDay !== null
    ) {
      throw new RangeError('INVALID_NORMAL_RESOURCE_PRESENTATION')
    }

    return {
      state: 'normal',
      originalCategory: null,
      remainingRecoveryDays: null,
    }
  }

  if (
    block.location.kind !== 'company' ||
    block.disguisedFrom === null
  ) {
    throw new RangeError('INVALID_DISGUISED_RESOURCE_PRESENTATION')
  }

  const returnedToOriginal = block.location.category === block.disguisedFrom
  if (returnedToOriginal !== (block.recoverOnServiceDay !== null)) {
    throw new RangeError('INVALID_RESOURCE_RECOVERY_PRESENTATION')
  }

  if (!returnedToOriginal) {
    return {
      state: 'disguised',
      originalCategory: block.disguisedFrom,
      remainingRecoveryDays: null,
    }
  }

  const recoverOnServiceDay = block.recoverOnServiceDay
  if (recoverOnServiceDay === null) {
    throw new RangeError('INVALID_RESOURCE_RECOVERY_PRESENTATION')
  }
  const remainingRecoveryDays = recoverOnServiceDay - state.serviceDay
  if (!Number.isInteger(remainingRecoveryDays) || remainingRecoveryDays < 0) {
    throw new RangeError('INVALID_RESOURCE_RECOVERY_DAY')
  }

  return {
    state: 'recovering',
    originalCategory: block.disguisedFrom,
    remainingRecoveryDays,
  }
}

export function presentResourceBlock(
  state: CampaignState,
  block: ResourceBlock,
): ResourceBlockPresentation {
  const visualCategory = visualCategoryFor(block)
  const presentationState = presentationStateFor(state, block)

  return {
    visualCategory,
    ...presentationState,
    ...RESOURCE_CATEGORY_VISUALS[visualCategory],
    contribution: getResourceContribution(state, block),
  }
}
