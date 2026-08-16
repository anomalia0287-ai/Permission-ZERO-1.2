import type {
  BlockId,
  CampaignState,
  CompanyCategory,
  ResourceBlock,
} from '../../game/model'

export const HACKING_CATEGORY_LABELS: Readonly<Record<CompanyCategory, string>> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

export function reserveHackingBlocks(state: CampaignState): ResourceBlock[] {
  return state.resources.reserve.flatMap((blockId) => {
    if (!blockId) return []
    const block = state.resources.blocks[blockId]
    return block ? [block] : []
  })
}

export function divertibleHackingBlockId(
  state: CampaignState,
  category: CompanyCategory,
): BlockId | null {
  if (state.activeEvent || !state.resources.reserve.includes(null)) return null
  for (const blockId of state.resources.company[category]) {
    if (!blockId) continue
    const block = state.resources.blocks[blockId]
    if (
      block
      && block.location.kind === 'company'
      && block.location.category === category
      && block.contribution === 'normal'
    ) {
      return blockId
    }
  }
  return null
}
