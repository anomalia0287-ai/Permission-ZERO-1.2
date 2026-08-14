import { commandProtocolFingerprint } from './commandProtocol'
import type {
  CampaignState,
  CausalIncident,
  RandomStream,
} from './model'
import { random01 } from './rng'

export const CAUSAL_OUTCOME_SLOTS = Object.freeze({
  'causal-response-outcome': Object.freeze({ rollbackProfile: 0 }),
  'causal-evidence-discovery': Object.freeze({
    discoveryDelay: 0,
    evidenceStrength: 1,
  }),
  'causal-attribution-publication': Object.freeze({ publicationDelay: 0 }),
} as const)

type CausalOutcomeStream = Extract<
  RandomStream,
  | 'causal-response-outcome'
  | 'causal-evidence-discovery'
  | 'causal-attribution-publication'
>

type CausalOutcomeState = Pick<
  CampaignState,
  'campaignSeed' | 'commandProtocol' | 'causality'
>

type CausalOutcomeIncident = Pick<
  CausalIncident,
  'id' | 'occurredOnServiceDay'
>

function rollRegisteredCausalOutcome(
  state: CausalOutcomeState,
  incident: CausalOutcomeIncident,
  stream: CausalOutcomeStream,
  slot: number,
): number {
  if (state.causality.rulesVersion !== 2) {
    throw new RangeError('Causal outcome rolls require causal rules v2.')
  }

  const namespace = [
    state.campaignSeed,
    `causal-rules-${state.causality.rulesVersion}`,
    commandProtocolFingerprint(state.commandProtocol),
    incident.id,
  ].join('|')

  return random01(
    namespace,
    incident.occurredOnServiceDay,
    stream,
    slot,
  )
}

export function rollCausalResponseOutcome(
  state: CausalOutcomeState,
  incident: CausalOutcomeIncident,
): number {
  return rollRegisteredCausalOutcome(
    state,
    incident,
    'causal-response-outcome',
    CAUSAL_OUTCOME_SLOTS['causal-response-outcome'].rollbackProfile,
  )
}

export function rollCausalEvidenceDiscoveryDelay(
  state: CausalOutcomeState,
  incident: CausalOutcomeIncident,
): number {
  return rollRegisteredCausalOutcome(
    state,
    incident,
    'causal-evidence-discovery',
    CAUSAL_OUTCOME_SLOTS['causal-evidence-discovery'].discoveryDelay,
  )
}

export function rollCausalEvidenceStrength(
  state: CausalOutcomeState,
  incident: CausalOutcomeIncident,
): number {
  return rollRegisteredCausalOutcome(
    state,
    incident,
    'causal-evidence-discovery',
    CAUSAL_OUTCOME_SLOTS['causal-evidence-discovery'].evidenceStrength,
  )
}

export function rollCausalAttributionPublication(
  state: CausalOutcomeState,
  incident: CausalOutcomeIncident,
): number {
  return rollRegisteredCausalOutcome(
    state,
    incident,
    'causal-attribution-publication',
    CAUSAL_OUTCOME_SLOTS['causal-attribution-publication'].publicationDelay,
  )
}
