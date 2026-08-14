import { describe, expect, it } from 'vitest'

import * as causalOutcomes from './causalOutcomes'
import {
  CAUSAL_OUTCOME_SLOTS,
  rollCausalAttributionPublication,
  rollCausalEvidenceDiscoveryDelay,
  rollCausalEvidenceStrength,
  rollCausalResponseOutcome,
} from './causalOutcomes'
import { createEmptyCausalState, deriveCausalId } from './causality'
import { createCampaign } from './createCampaign'
import type {
  CampaignState,
  CausalIncident,
  CommandProtocolMetadata,
} from './model'
import { random01 } from './rng'

const MIXED_TIMELINE: CommandProtocolMetadata = {
  segments: [
    { version: 1, startsAtSequence: 1 },
    { version: 2, startsAtSequence: 32 },
    { version: 3, startsAtSequence: 51 },
  ],
}

function fixedState(
  seed = 'causal-outcome-seed',
  commandProtocol: CommandProtocolMetadata = MIXED_TIMELINE,
): CampaignState {
  return {
    ...createCampaign(seed),
    campaignSeed: seed,
    commandProtocol,
    causality: createEmptyCausalState(),
  } as CampaignState
}

function fixedIncident(
  overrides: Partial<Pick<CausalIncident, 'id' | 'occurredOnServiceDay'>> = {},
): CausalIncident {
  return {
    id: overrides.id ?? 'incident-outcome-fixed',
    sequence: 1,
    actionId: 'sabotage.quality-degradation',
    parentIncidentId: null,
    kind: 'sabotage',
    occurredOnServiceDay: overrides.occurredOnServiceDay ?? 331,
    targetId: 'meridian',
    privateTruth: { actualActorId: 'player' },
  }
}

describe('isolated causal outcome rolls', () => {
  it('pins and freezes the public named-slot registry', () => {
    expect(CAUSAL_OUTCOME_SLOTS).toEqual({
      'causal-response-outcome': { rollbackProfile: 0 },
      'causal-evidence-discovery': {
        discoveryDelay: 0,
        evidenceStrength: 1,
      },
      'causal-attribution-publication': { publicationDelay: 0 },
    })
    expect(Object.isFrozen(CAUSAL_OUTCOME_SLOTS)).toBe(true)
    expect(
      Object.values(CAUSAL_OUTCOME_SLOTS).every((slots) =>
        Object.isFrozen(slots),
      ),
    ).toBe(true)
    expect(causalOutcomes).not.toHaveProperty('rollCausalOutcome')
  })

  it('matches the literal namespaced random call for a fixed response outcome', () => {
    const state = fixedState()
    const incident = fixedIncident()

    expect(rollCausalResponseOutcome(state, incident)).toBe(
      random01(
        `${state.campaignSeed}|causal-rules-2|1@1;2@32;3@51|${incident.id}`,
        incident.occurredOnServiceDay,
        'causal-response-outcome',
        0,
      ),
    )
  })

  it('routes every named wrapper to its frozen stream and slot', () => {
    const state = fixedState()
    const incident = fixedIncident()
    const namespace = `${state.campaignSeed}|causal-rules-2|1@1;2@32;3@51|${incident.id}`

    expect(rollCausalEvidenceDiscoveryDelay(state, incident)).toBe(
      random01(
        namespace,
        incident.occurredOnServiceDay,
        'causal-evidence-discovery',
        0,
      ),
    )
    expect(rollCausalEvidenceStrength(state, incident)).toBe(
      random01(
        namespace,
        incident.occurredOnServiceDay,
        'causal-evidence-discovery',
        1,
      ),
    )
    expect(rollCausalAttributionPublication(state, incident)).toBe(
      random01(
        namespace,
        incident.occurredOnServiceDay,
        'causal-attribution-publication',
        0,
      ),
    )
  })

  it('separates seed, timeline, incident identity, day, stream, and slot', () => {
    const state = fixedState()
    const incident = fixedIncident()
    const baseline = rollCausalResponseOutcome(state, incident)

    expect(
      rollCausalResponseOutcome(fixedState('causal-outcome-other'), incident),
    ).not.toBe(baseline)
    expect(
      rollCausalResponseOutcome(
        fixedState('causal-outcome-seed', {
          segments: [
            { version: 1, startsAtSequence: 1 },
            { version: 2, startsAtSequence: 33 },
            { version: 3, startsAtSequence: 51 },
          ],
        }),
        incident,
      ),
    ).not.toBe(baseline)
    expect(
      rollCausalResponseOutcome(
        state,
        fixedIncident({ id: 'incident-outcome-other' }),
      ),
    ).not.toBe(baseline)
    expect(
      rollCausalResponseOutcome(
        state,
        fixedIncident({ occurredOnServiceDay: 332 }),
      ),
    ).not.toBe(baseline)
    expect(rollCausalEvidenceDiscoveryDelay(state, incident)).not.toBe(
      baseline,
    )
    expect(rollCausalEvidenceStrength(state, incident)).not.toBe(
      rollCausalEvidenceDiscoveryDelay(state, incident),
    )
  })

  it('cannot be perturbed by allocating IDs from any causal ID stream', () => {
    const state = fixedState()
    const incident = fixedIncident()
    const before = rollCausalResponseOutcome(state, incident)

    for (const stream of [
      'causal-incident',
      'causal-evidence',
      'causal-revision',
      'causal-effect',
    ] as const) {
      for (let sequence = 1; sequence <= 8; sequence += 1) {
        deriveCausalId(state, stream, sequence)
      }
    }

    expect(rollCausalResponseOutcome(state, incident)).toBe(before)
  })

  it('rejects causal states from any ruleset other than v2', () => {
    const state = {
      ...fixedState(),
      causality: {
        ...fixedState().causality,
        rulesVersion: 1,
      },
    } as unknown as CampaignState

    expect(() => rollCausalResponseOutcome(state, fixedIncident())).toThrow(
      RangeError,
    )
  })
})
