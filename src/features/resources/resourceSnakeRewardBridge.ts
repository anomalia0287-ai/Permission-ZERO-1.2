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

/**
 * Blocks a single kill is worth.
 *
 * One made the climb crawl — the autonomy line runs to dozens of blocks and a
 * round yields one or two kills — while three made a round trivial. Two keeps
 * the round meaningful and the campaign moving.
 */
export const RESOURCE_SNAKE_BLOCKS_PER_KILL = 2

/**
 * The reserved block the guard was carrying, plus one more of the same
 * category taken from the company grid. The second block is chosen from the
 * live state so it is always a real, currently-held company block.
 */
export function resourceSnakeRewardCommands(
  effect: ResourceSnakeRewardRequest,
  state?: Pick<CampaignState, 'resources'>,
): readonly GameCommand[] {
  const commands: GameCommand[] = [
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
  if (!state) return commands
  const reserved = state.resources.blocks[effect.blockId]
  const category = reserved?.origin
  if (!category || !COMPANY_CATEGORIES.includes(category as CompanyCategory)) {
    return commands
  }
  const extras = state.resources.company[category as CompanyCategory]
    .filter((blockId): blockId is string => (
      blockId !== null && blockId !== effect.blockId
    ))
    .slice(0, RESOURCE_SNAKE_BLOCKS_PER_KILL - 1)
  for (const blockId of extras) {
    commands.push(
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' },
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId },
    )
  }
  return commands
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
