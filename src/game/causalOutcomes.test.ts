import { describe, expect, it } from 'vitest'

import * as causalOutcomes from './causalOutcomes'
import {
  CAUSAL_OUTCOME_SLOTS,
  rollCausalAttributionPublication,
  rollCausalEvidenceDiscoveryDelay,
  rollCausalEvidenceStrength,
  rollCausalResponseOutcome,
} from './causalOutcomes'
import {
  applyCausalEffect,
  appendPublicAttributionRevision,
  createEmptyCausalState,
  deriveCausalId,
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
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
    let state = fixedState()
    const incident = fixedIncident()
    const before = rollCausalResponseOutcome(state, incident)
    const expectedIds = Object.fromEntries(([
      'causal-incident',
      'causal-evidence',
      'causal-revision',
      'causal-effect',
    ] as const).map((stream) => [stream, deriveCausalId(state, stream, 1)]))

    const quality = recordCausalIncident(state, {
      actionId: 'sabotage.quality-degradation',
      parentIncidentId: null,
      kind: 'sabotage',
      occurredOnServiceDay: state.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    if (!quality.accepted) throw new Error(quality.reason)
    const rollback = recordCausalIncident(quality.state, {
      actionId: 'response.meridian.rollback.standard',
      parentIncidentId: quality.incident.id,
      kind: 'competitor-response',
      occurredOnServiceDay: state.serviceDay,
      targetId: 'meridian',
      actualActorId: 'meridian',
    })
    if (!rollback.accepted) throw new Error(rollback.reason)
    const recovery = recordCausalIncident(rollback.state, {
      actionId: 'follow-up.recovery-contamination',
      parentIncidentId: rollback.incident.id,
      kind: 'service-disruption',
      occurredOnServiceDay: state.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    if (!recovery.accepted) throw new Error(recovery.reason)
    const evidence = recordCausalEvidence(recovery.state, {
      incidentId: recovery.incident.id,
      kind: 'public-recovery-checksum-anomaly',
      discoveredOnServiceDay: state.serviceDay,
      audiences: [{ kind: 'public' }],
    })
    if (!evidence.accepted) throw new Error(evidence.reason)
    const revision = appendPublicAttributionRevision(evidence.state, {
      incidentId: recovery.incident.id,
      publisher: { kind: 'public' },
      attributedActorId: 'unresolved',
      evidenceIds: [evidence.evidence.id],
      publishedOnServiceDay: state.serviceDay,
    })
    if (!revision.accepted) throw new Error(revision.reason)
    const effect = applyCausalEffect(revision.state, {
      incidentId: recovery.incident.id,
      revisionId: revision.revision.id,
      appliedOnServiceDay: state.serviceDay,
      effect: { kind: 'reputation', targetId: 'player', delta: -1 },
    })
    if (!effect.accepted) throw new Error(effect.reason)
    state = effect.state

    expect({
      incident: quality.incident.id,
      evidence: evidence.evidence.id,
      revision: revision.revision.id,
      effect: effect.appliedEffect.id,
    }).toEqual({
      incident: expectedIds['causal-incident'],
      evidence: expectedIds['causal-evidence'],
      revision: expectedIds['causal-revision'],
      effect: expectedIds['causal-effect'],
    })
    expect(state.causality).toMatchObject({
      nextIncidentSequence: 4,
      nextEvidenceSequence: 2,
      nextRevisionSequence: 2,
      nextEffectSequence: 2,
    })
    expect(state.causality.incidents).toHaveLength(3)
    expect(state.causality.evidence).toHaveLength(1)
    expect(state.causality.publicRevisions).toHaveLength(1)
    expect(state.causality.appliedEffects).toHaveLength(1)

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
