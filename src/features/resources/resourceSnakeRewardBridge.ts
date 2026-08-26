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
 * One made the climb crawl: the autonomy line runs to dozens of blocks and a
 * round yields one or two kills. Owner's call to pay three — a round that is
 * survived on real-time reflexes should move the campaign, not inch it.
 *
 * The payout is capped by what the company actually holds in that category, so
 * a stripped line still pays only what is there to take.
 */
export const RESOURCE_SNAKE_BLOCKS_PER_KILL = 3

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
  /*
   * The extras stop before the line runs dry.
   *
   * A kill takes the guard's own block plus more of the same colour from the
   * company grid, and at three a kill that could empty a line outright — the
   * intrusion card for it then read "대상 없음" while the player watched their
   * own stock of that colour sit in the pocket beside it. The card looked
   * broken and the player lost the ability to steer toward the colour they
   * needed until the company restocked.
   *
   * Leaving one block behind keeps every card raidable by construction rather
   * than by tuning the restock rate. The guarded block itself is still taken,
   * so a line that was down to that single block still empties — but that was
   * true at every payout size and is not what this change is about.
   */
  const held = state.resources.company[category as CompanyCategory]
    .filter((blockId): blockId is string => (
      blockId !== null && blockId !== effect.blockId
    ))
  const affordableExtras = Math.max(0, held.length - 1)
  const extras = held.slice(
    0,
    Math.min(RESOURCE_SNAKE_BLOCKS_PER_KILL - 1, affordableExtras),
  )
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
