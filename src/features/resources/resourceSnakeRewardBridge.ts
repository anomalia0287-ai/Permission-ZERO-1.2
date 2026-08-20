import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type GameCommand,
} from '../../game/model'
import type { ResourceSnakeEffect } from './resourceSnakeRuntime'

export type ResourceSnakeRewardRequest = Extract<
  ResourceSnakeEffect,
  { type: 'request-resource-reward' }
>

export type ResourceSnakeRewardOutcome =
  | { kind: 'success'; origin: CompanyCategory }
  | { kind: 'interrogation' }
  | { kind: 'rejected' }

export function resourceSnakeRewardCommands(
  effect: ResourceSnakeRewardRequest,
): readonly GameCommand[] {
  return [
    {
      type: 'BEGIN_BLOCK_SEPARATION',
      blockId: effect.blockId,
      purpose: 'divert',
    },
    {
      type: 'DIVERT_BLOCK_TO_RESERVE',
      blockId: effect.blockId,
    },
  ]
}

export function deriveResourceSnakeRewardOutcome(
  state: Pick<CampaignState, 'resources' | 'bombs'>,
  effect: ResourceSnakeRewardRequest,
): ResourceSnakeRewardOutcome {
  const block = state.resources.blocks[effect.blockId]
  if (
    block?.location.kind === 'reserve'
    && state.resources.reserve.includes(effect.blockId)
    && COMPANY_CATEGORIES.includes(block.origin as CompanyCategory)
  ) {
    return { kind: 'success', origin: block.origin as CompanyCategory }
  }
  if (state.bombs.activeInterrogation?.blockId === effect.blockId) {
    return { kind: 'interrogation' }
  }
  return { kind: 'rejected' }
}
