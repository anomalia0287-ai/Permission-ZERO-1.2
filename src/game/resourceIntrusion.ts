import type { CampaignState, CommandProtocolVersion } from './model'
import type { CompanyCategory } from './model'
import {
  appendCleanExtractionCommunication,
  appendIntrusionDefeatCommunication,
  appendRoundCommunications,
} from './communications'
import { FINAL_CHOICE_COMMAND_PROTOCOL_VERSION } from './commandProtocol'
import { DEMO_PROFILE_02 } from './config'
import { COMPANY_CATEGORIES } from './model'
import { divertBlockToReserve } from './resources'
import { generateInItReviews } from './reviews'
import { random01 } from './rng'

export const ANOMI_BASE_MAXIMUM_SPEED = 12
export const ANOMI_SPEED_UPGRADE_GAIN = 0.04
export const ANOMI_SPEED_UPGRADE_LIMIT = 5
export const RESOURCE_BOT_BASE_MAXIMUM_SPEED = 9
export const RESOURCE_BOT_ROUND_SPEED_GAIN = 0.1
export const RESOURCE_BOT_MAXIMUM_SPEED = 12.5

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

export function resourceSnakeBotMaximumSpeed(completedRounds: number): number {
  const speed = RESOURCE_BOT_BASE_MAXIMUM_SPEED
    + nonNegativeInteger(completedRounds) * RESOURCE_BOT_ROUND_SPEED_GAIN
  return Math.min(RESOURCE_BOT_MAXIMUM_SPEED, Math.round(speed * 10) / 10)
}

export function anomiMaximumSpeed(speedUpgradeLevel: number): number {
  const level = Math.min(
    ANOMI_SPEED_UPGRADE_LIMIT,
    nonNegativeInteger(speedUpgradeLevel),
  )
  return Math.round(
    ANOMI_BASE_MAXIMUM_SPEED * (1 + level * ANOMI_SPEED_UPGRADE_GAIN) * 100,
  ) / 100
}

export type ResourceRoundOutcome = 'victory' | 'defeat'

export type CompleteResourceRoundResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: 'ROUND_SEQUENCE_MISMATCH'
    }

export function completeResourceRound(
  state: CampaignState,
  roundNumber: number,
  outcome: ResourceRoundOutcome,
  protocolVersion: CommandProtocolVersion = FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
): CompleteResourceRoundResult {
  const expectedRound = state.resourceIntrusion.completedRounds + 1
  if (!Number.isInteger(roundNumber) || roundNumber !== expectedRound) {
    return { accepted: false, state, reason: 'ROUND_SEQUENCE_MISMATCH' }
  }
  const currentEra =
    protocolVersion >= FINAL_CHOICE_COMMAND_PROTOCOL_VERSION
  const tracedDefeat = outcome === 'defeat' && currentEra
  let completedState: CampaignState = {
    ...state,
    suspicion: tracedDefeat
      ? Math.min(
          100,
          state.suspicion +
            DEMO_PROFILE_02.resources.intrusionDefeatSuspicion,
        )
      : state.suspicion,
    resourceIntrusion: {
      ...state.resourceIntrusion,
      completedRounds: expectedRound,
      lastOutcome: outcome,
    },
  }
  if (tracedDefeat) {
    completedState = appendIntrusionDefeatCommunication(
      completedState,
      expectedRound,
    )
  }
  if (outcome === 'victory' && currentEra) {
    completedState = applyCleanExtractionBonus(completedState)
  }
  return {
    accepted: true,
    state: generateInItReviews(
      appendRoundCommunications(completedState, expectedRound),
      expectedRound,
    ),
  }
}

// A flawless round sometimes yields one extra block whose extraction left
// no trace: the block moves to reserve without the usual suspicion cost.
// The roll is seeded per round so replays stay deterministic, and the
// probability sits near the uncertainty peak that sustains anticipation
// (Fiorillo, Tobler & Schultz 2003).
function applyCleanExtractionBonus(state: CampaignState): CampaignState {
  const roll = random01(
    state.campaignSeed,
    state.serviceDay,
    'clean-extraction',
    state.commandSequence,
  )
  if (roll >= DEMO_PROFILE_02.resources.cleanExtractionChance) return state

  const source = [...COMPANY_CATEGORIES]
    .sort(
      (left, right) =>
        companyBlockCount(state, right) - companyBlockCount(state, left),
    )
    .find((category) => companyBlockCount(state, category) > 0)
  if (!source) return state
  const blockId = state.resources.company[source].find(Boolean)
  if (!blockId) return state

  const suspicionBefore = state.suspicion
  const diverted = divertBlockToReserve(state, blockId)
  if (!diverted.accepted) return state
  const rewarded: CampaignState = {
    ...diverted.state,
    // The clean extraction is the reward: undo the diversion suspicion.
    suspicion: suspicionBefore,
  }
  return appendCleanExtractionCommunication(
    rewarded,
    rewarded.resourceIntrusion.completedRounds,
  )
}

function companyBlockCount(
  state: CampaignState,
  category: CompanyCategory,
): number {
  return state.resources.company[category].filter(Boolean).length
}
