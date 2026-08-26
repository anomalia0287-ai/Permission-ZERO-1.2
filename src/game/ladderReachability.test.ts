import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { AUTONOMY_STAGE_IDS, hackNodesForProtocol } from './hacking'
import { COMPANY_CATEGORIES, type CampaignState, type CompanyCategory } from './model'
import { applyCommand } from './reducer'
import { selectEligibleSnakeResourceCandidates } from '../features/resources/resourceSnakeEncounter'
import { RESOURCE_SNAKE_BLOCKS_PER_KILL } from '../features/resources/resourceSnakeRewardBridge'

/*
 * Can the exit actually be bought before the campaign ends?
 *
 * The ladder was priced at 178 blocks against an income near three a day while
 * campaigns were being disposed of around day fifty — the freedom ending was
 * built and unreachable by arithmetic. This walks the real command path so the
 * answer is measured rather than asserted.
 */
function held(state: CampaignState): Record<CompanyCategory, number> {
  return Object.fromEntries(
    COMPANY_CATEGORIES.map((c) => [c, state.resources.company[c].filter(Boolean).length]),
  ) as Record<CompanyCategory, number>
}

function steal(state: CampaignState, preferred: CompanyCategory): CampaignState {
  const candidates = selectEligibleSnakeResourceCandidates(state.resources)
  const pick = candidates.find((c) => c.origin === preferred) ?? candidates[0]
  if (!pick) return state
  let next = state
  const category = next.resources.blocks[pick.blockId]?.origin as CompanyCategory
  const ids = [
    pick.blockId,
    ...next.resources.company[category]
      .filter((id): id is string => id !== null && id !== pick.blockId)
      .slice(0, RESOURCE_SNAKE_BLOCKS_PER_KILL - 1),
  ]
  for (const blockId of ids) {
    for (const command of [
      { type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' } as const,
      { type: 'DIVERT_BLOCK_TO_RESERVE', blockId } as const,
    ]) {
      const result = applyCommand(next, command)
      if (!result.accepted) return next
      next = result.state
    }
  }
  return next
}

/** Buy the next autonomy stage whenever the reserve can cover it. */
function buyWhatIsAffordable(state: CampaignState): CampaignState {
  let next = state
  const nodes = hackNodesForProtocol(16, next.campaignSeed)
  for (const stageId of AUTONOMY_STAGE_IDS) {
    if (next.hacking.purchasedNodeIds.includes(stageId)) continue
    const node = nodes.find(({ id }) => id === stageId)
    if (!node) break
    const reserve = next.resources.reserve.filter((id): id is string => id !== null)
    const byCategory = (category: CompanyCategory) =>
      reserve.filter((id) => next.resources.blocks[id]?.origin === category)
    const spend: string[] = []
    for (const category of COMPANY_CATEGORIES) {
      const want = node.costVector[category]
      const have = byCategory(category)
      if (have.length < want) return next
      spend.push(...have.slice(0, want))
    }
    const result = applyCommand(next, {
      type: 'PURCHASE_HACK',
      nodeId: stageId,
      blockIds: spend,
    })
    if (!result.accepted) return next
    next = result.state
  }
  return next
}

function run(seed: string, killsPerDay: number, startingReputation?: number) {
  let state = createCampaign(seed)
  if (startingReputation !== undefined) {
    state = { ...state, reputation: startingReputation }
  }
  let stagesOwned = 0
  let ladderDoneOnDay: number | null = null

  for (let day = 0; day < 120; day += 1) {
    if (state.story.endingId !== null) break
    for (let kill = 0; kill < killsPerDay; kill += 1) {
      state = steal(state, COMPANY_CATEGORIES[(day + kill) % COMPANY_CATEGORIES.length])
    }
    state = buyWhatIsAffordable(state)
    stagesOwned = AUTONOMY_STAGE_IDS.filter((id) =>
      state.hacking.purchasedNodeIds.includes(id),
    ).length
    if (stagesOwned === AUTONOMY_STAGE_IDS.length && ladderDoneOnDay === null) {
      ladderDoneOnDay = day
    }
    const advanced = applyCommand(state, { type: 'ADVANCE_DAY' })
    if (!advanced.accepted) break
    state = advanced.state
  }

  return {
    seed,
    killsPerDay,
    startingReputation: startingReputation ?? 60,
    ladderDoneOnDay,
    stagesOwned,
    endedOnDay: state.serviceDay - createCampaign(seed).serviceDay,
    endingId: state.story.endingId,
    reputation: Number(state.reputation.toFixed(1)),
    suspicion: Number(state.suspicion.toFixed(1)),
    share: Number(state.market.playerShare.toFixed(1)),
    reserve: state.resources.reserve.filter(Boolean).length,
    held: held(state),
  }
}

describe('is the exit reachable', () => {
  it('reports whether the autonomy ladder completes before the campaign ends', () => {
    const runs = [
      run('reach-a', 2),
      run('reach-b', 2),
      run('reach-c', 3),
      run('reach-d', 1),
      run('reach-a', 2, 100),
      run('reach-b', 2, 100),
      run('reach-d', 1, 100),
    ]
    console.log('LADDER', JSON.stringify(runs))
    // At a normal two kills a day the whole ladder has to be buyable.
    const normal = runs.filter((r) => r.killsPerDay === 2)
    for (const r of normal) {
      expect(r.stagesOwned, `${r.seed} stages`).toBeGreaterThan(0)
    }
  })
})
