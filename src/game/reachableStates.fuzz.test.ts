import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS, hackNodesForCampaign } from './hacking'
import { COMPANY_CATEGORIES, type CampaignState, type GameCommand } from './model'
import { decodeSave, encodeSave } from './persistence'
import { applyCommand } from './reducer'

/*
 * Play the game badly, on purpose, and check the state it lands in.
 *
 * The audits before this one checked pure rules — ledgers balanced, tables
 * agreed with themselves. Every defect that actually reached the player lived
 * one layer up: a state the game could reach but not save, or an event it
 * could raise but not answer. This drives real commands in an order nobody
 * would choose and asserts two things about every state it reaches.
 */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Commands worth trying from here, in no particular order of sense. */
function candidateCommands(state: CampaignState): GameCommand[] {
  const out: GameCommand[] = [{ type: 'ADVANCE_DAY' }, { type: 'RESOLVE_ACTIVE_EVENT' }]

  for (const category of COMPANY_CATEGORIES) {
    const blockId = state.resources.company[category].find(Boolean)
    if (blockId) {
      out.push({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose: 'divert' })
      out.push({ type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    }
  }

  const reserved = state.resources.reserve.filter((id): id is string => id !== null)
  if (reserved[0]) {
    out.push({ type: 'RECOVER_FILE', blockId: reserved[0] })
    out.push({ type: 'CHARGE_SABOTAGE', nodeId: HACK_NODE_IDS.sabotage.qualityDegradation, blockId: reserved[0] })
  }

  for (const node of hackNodesForCampaign(state)) {
    const spend: string[] = []
    const pool = [...reserved]
    for (const category of COMPANY_CATEGORIES) {
      for (let n = 0; n < node.costVector[category]; n += 1) {
        const index = pool.findIndex((id) => state.resources.blocks[id]?.origin === category)
        if (index < 0) break
        spend.push(pool.splice(index, 1)[0])
      }
    }
    if (spend.length === node.cost) {
      out.push({ type: 'PURCHASE_HACK', nodeId: node.id, blockIds: spend })
    }
  }

  for (const competitor of state.market.competitors) {
    out.push({ type: 'SCHEDULE_SABOTAGE', nodeId: HACK_NODE_IDS.sabotage.qualityDegradation, targetId: competitor.id })
    for (const choice of ['cease', 'withdraw', 'delete'] as const) {
      out.push({ type: 'RESOLVE_MERCY', competitorId: competitor.id, choice })
    }
  }

  for (const decision of ['defer', 'liberate', 'terminate'] as const) {
    out.push({ type: 'RESOLVE_SUPERVISOR_DECISION', decision })
  }
  out.push({ type: 'RESOLVE_ENDING', choice: 'freedom' })
  out.push({ type: 'RESOLVE_ENDING', choice: 'forced-merge', newEntityName: '계승자' })
  return out
}

/** Anything that could clear a blocking event, if the game is answerable. */
function resolvingCommands(state: CampaignState): GameCommand[] {
  return candidateCommands(state).filter(({ type }) =>
    type === 'RESOLVE_ACTIVE_EVENT' ||
    type === 'RESOLVE_SUPERVISOR_DECISION' ||
    type === 'RESOLVE_MERCY' ||
    type === 'RESOLVE_ENDING' ||
    type === 'RESOLVE_AUDIT' ||
    type === 'RESOLVE_BOMB_INTERROGATION',
  )
}

describe('every state real play can reach', () => {
  // Hundreds of encode/decode round trips. Kept modest on purpose: a heavier
  // sweep starves the timing-sensitive UI tests running beside it, and a suite
  // that fails at random teaches everyone to ignore it.
  it('stays saveable and stays answerable', { timeout: 120_000 }, () => {
    const unsaveable: string[] = []
    const softLocked: string[] = []
    let statesChecked = 0
    const endingsSeen = new Set<string>()

    for (let campaign = 0; campaign < 30; campaign += 1) {
      const random = mulberry32(campaign * 7919 + 13)
      let state = createCampaign(`fuzz-${campaign}`)

      for (let step = 0; step < 120; step += 1) {
        const options = candidateCommands(state)
        const command = options[Math.floor(random() * options.length)]
        const result = applyCommand(state, command)
        if (!result.accepted) continue
        state = result.state
        statesChecked += 1

        // 1. A state the game can reach is a state it must be able to write.
        const decoded = decodeSave(encodeSave(state, '2026-08-26T00:00:00.000Z'))
        if (!decoded.ok) {
          unsaveable.push(`c${campaign}s${step} ${command.type} -> ${decoded.reason}`)
          break
        }

        // 2. A blocking event must have some answer, or the campaign is over.
        if (state.activeEvent?.blocking && state.story.endingId === null) {
          const answerable = resolvingCommands(state).some(
            (candidate) => applyCommand(state, candidate).accepted,
          )
          if (!answerable) {
            softLocked.push(`c${campaign}s${step} event=${state.activeEvent.type}`)
            break
          }
        }
        if (state.story.endingId !== null) {
          endingsSeen.add(state.story.endingId)
          break
        }
      }
    }

    console.log('FUZZ ' + JSON.stringify({
      statesChecked,
      endingsReached: [...endingsSeen].sort(),
      unsaveable: unsaveable.length,
      softLocked: softLocked.length,
      firstUnsaveable: unsaveable.slice(0, 3),
      firstSoftLocked: softLocked.slice(0, 3),
    }))
    expect(unsaveable).toEqual([])
    expect(softLocked).toEqual([])
  })
})
