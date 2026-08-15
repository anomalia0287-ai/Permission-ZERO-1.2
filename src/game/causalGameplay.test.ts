import { describe, expect, it } from 'vitest'
import {
  projectCausalKnowledge,
  recordCausalEvidence,
  recordCausalIncident,
} from './causality'
import { rollCausalResponseOutcome } from './causalOutcomes'
import {
  processCausalResponses,
  rollbackActionForRoll,
  rollbackOpportunityDays,
  selectRecoveryContaminationOpportunities,
  type CausalGameplayOperations,
  type MeridianRollbackActionId,
} from './causalGameplay'
import { createCampaign } from './createCampaign'
import {
  cancelSabotageCharge,
  chargeSabotage,
  HACK_NODE_IDS,
  purchaseHackNode,
  resolveScheduledSabotage,
  scheduleSabotage,
} from './hacking'
import type { CampaignState, CausalIncident } from './model'
import { decodeSave, encodeSave } from './persistence'

const ROLLBACK_ACTIONS = [
  'response.meridian.rollback.fast',
  'response.meridian.rollback.standard',
  'response.meridian.rollback.forensic',
] as const satisfies readonly MeridianRollbackActionId[]

interface QualityFixture {
  state: CampaignState
  quality: CausalIncident
  roll: number
}

function reserveIds(state: CampaignState, count: number): string[] {
  const ids = state.resources.reserve.filter(
    (blockId): blockId is string => blockId !== null,
  )
  if (ids.length < count) {
    throw new Error(`Expected ${count} reserve resources, found ${ids.length}`)
  }
  return ids.slice(0, count)
}

function requireHackingState(
  result: ReturnType<
    | typeof purchaseHackNode
    | typeof cancelSabotageCharge
    | typeof chargeSabotage
    | typeof scheduleSabotage
  >,
): CampaignState {
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function resolveQualityRoot(seed: string): Omit<QualityFixture, 'roll'> {
  const nodeId = HACK_NODE_IDS.sabotage.qualityDegradation
  let state = createCampaign(seed)
  const selected = reserveIds(state, 3)
  state = requireHackingState(purchaseHackNode(state, nodeId, selected))
  state = requireHackingState(cancelSabotageCharge(state, nodeId))
  state = requireHackingState(chargeSabotage(state, nodeId, selected[2]))
  state = requireHackingState(scheduleSabotage(state, nodeId, 'meridian'))

  const due = { ...state, serviceDay: state.serviceDay + 1 }
  const resolved = resolveScheduledSabotage(due)
  if (!resolved.resolved) {
    throw new Error(`Quality sabotage did not resolve: ${JSON.stringify(resolved)}`)
  }
  const quality = resolved.state.causality.incidents.find(
    ({ actionId }) => actionId === 'sabotage.quality-degradation',
  )
  if (!quality) throw new Error('Native quality root was not recorded')
  return { state: resolved.state, quality }
}

function expectedActionForRoll(roll: number): MeridianRollbackActionId {
  if (roll < 1 / 3) return 'response.meridian.rollback.fast'
  if (roll < 2 / 3) return 'response.meridian.rollback.standard'
  return 'response.meridian.rollback.forensic'
}

let cachedProfiles: Map<MeridianRollbackActionId, QualityFixture> | null = null

function profileFixtures(): Map<MeridianRollbackActionId, QualityFixture> {
  if (cachedProfiles) return cachedProfiles

  const found = new Map<MeridianRollbackActionId, QualityFixture>()
  for (let index = 0; index < 10_000 && found.size < ROLLBACK_ACTIONS.length; index += 1) {
    const fixture = resolveQualityRoot(`causal-gameplay-profile-${index}`)
    const roll = rollCausalResponseOutcome(fixture.state, fixture.quality)
    const actionId = expectedActionForRoll(roll)
    if (!found.has(actionId)) found.set(actionId, { ...fixture, roll })
  }
  if (found.size !== ROLLBACK_ACTIONS.length) {
    throw new Error('Unable to find deterministic seeds for all rollback profiles')
  }
  cachedProfiles = found
  return found
}

function fixtureFor(actionId: MeridianRollbackActionId): QualityFixture {
  const fixture = profileFixtures().get(actionId)
  if (!fixture) throw new Error(`Missing deterministic fixture for ${actionId}`)
  return fixture
}

function isRollbackAction(
  actionId: CausalIncident['actionId'],
): actionId is MeridianRollbackActionId {
  return ROLLBACK_ACTIONS.some((candidate) => candidate === actionId)
}

function rollbackChildren(
  state: CampaignState,
  parentIncidentId: string,
): CausalIncident[] {
  return state.causality.incidents.filter(
    (incident) =>
      incident.parentIncidentId === parentIncidentId &&
      isRollbackAction(incident.actionId),
  )
}

function requireProcessed(state: CampaignState): CampaignState {
  const result = processCausalResponses(state)
  if (!result.processed) throw new Error(result.reason)
  return result.state
}

function appendVisibleQualityRoot(
  state: CampaignState,
  incidentId: string,
): { state: CampaignState; incident: CausalIncident } {
  const recorded = recordCausalIncident(state, {
    incidentId,
    actionId: 'sabotage.quality-degradation',
    parentIncidentId: null,
    kind: 'sabotage',
    occurredOnServiceDay: state.serviceDay,
    targetId: 'meridian',
    actualActorId: 'player',
  })
  if (!recorded.accepted) throw new Error(recorded.reason)

  const evidenced = recordCausalEvidence(recorded.state, {
    evidenceId: `evidence:${incidentId}`,
    incidentId: recorded.incident.id,
    kind: 'meridian-quality-regression',
    discoveredOnServiceDay: state.serviceDay,
    audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
  })
  if (!evidenced.accepted) throw new Error(evidenced.reason)
  return { state: evidenced.state, incident: recorded.incident }
}

function requireRollback(
  state: CampaignState,
  quality: CausalIncident,
): CausalIncident {
  const children = rollbackChildren(state, quality.id)
  expect(children).toHaveLength(1)
  const rollback = children[0]
  if (!rollback) throw new Error('Rollback child was not recorded')
  return rollback
}

describe('rollback profile contracts', () => {
  it('uses exact half-open thirds at every floating-point boundary', () => {
    expect(rollbackActionForRoll(0)).toBe('response.meridian.rollback.fast')
    expect(rollbackActionForRoll(1 / 3 - Number.EPSILON)).toBe(
      'response.meridian.rollback.fast',
    )
    expect(rollbackActionForRoll(1 / 3)).toBe(
      'response.meridian.rollback.standard',
    )
    expect(rollbackActionForRoll(2 / 3 - Number.EPSILON)).toBe(
      'response.meridian.rollback.standard',
    )
    expect(rollbackActionForRoll(2 / 3)).toBe(
      'response.meridian.rollback.forensic',
    )
    expect(rollbackActionForRoll(1 - Number.EPSILON)).toBe(
      'response.meridian.rollback.forensic',
    )
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -Number.EPSILON, 1, 2])(
    'rejects an invalid rollback roll (%s)',
    (roll) => {
      expect(() => rollbackActionForRoll(roll)).toThrow(RangeError)
    },
  )

  it('maps rollback actions to exactly two, three, and four service days', () => {
    expect(
      ROLLBACK_ACTIONS.map((actionId) => [
        actionId,
        rollbackOpportunityDays(actionId),
      ]),
    ).toEqual([
      ['response.meridian.rollback.fast', 2],
      ['response.meridian.rollback.standard', 3],
      ['response.meridian.rollback.forensic', 4],
    ])
  })
})

describe('causal response orchestration', () => {
  it.each(ROLLBACK_ACTIONS)(
    'records the deterministic %s profile through the real quality-root path',
    (expectedAction) => {
      const fixture = fixtureFor(expectedAction)
      expect(expectedActionForRoll(fixture.roll)).toBe(expectedAction)
      const beforeEventLog = fixture.state.eventLog
      const beforeEventCount = fixture.state.eventLog.length

      const result = processCausalResponses(fixture.state)

      expect(result.processed).toBe(true)
      if (!result.processed) return
      const rollback = requireRollback(result.state, fixture.quality)
      expect(rollback).toMatchObject({
        actionId: expectedAction,
        parentIncidentId: fixture.quality.id,
        kind: 'competitor-response',
        occurredOnServiceDay: fixture.state.serviceDay,
        targetId: 'meridian',
        privateTruth: { actualActorId: 'meridian' },
      })

      const linkedEvidence = result.state.causality.evidence.filter(
        ({ incidentId }) => incidentId === rollback.id,
      )
      expect(linkedEvidence).toEqual([
        expect.objectContaining({
          kind: 'company-observed-meridian-rollback',
          legacySummary: null,
          audiences: [
            { kind: 'company' },
            { kind: 'competitor', competitorId: 'meridian' },
          ],
        }),
      ])

      const company = projectCausalKnowledge(result.state, { kind: 'company' })
      const meridian = projectCausalKnowledge(result.state, {
        kind: 'competitor',
        competitorId: 'meridian',
      })
      const tallow = projectCausalKnowledge(result.state, {
        kind: 'competitor',
        competitorId: 'tallow',
      })
      const publicKnowledge = projectCausalKnowledge(result.state, {
        kind: 'public',
      })
      for (const visible of [company, meridian]) {
        expect(visible.incidents.map(({ id }) => id)).toContain(rollback.id)
        expect(visible.evidence.map(({ id }) => id)).toContain(linkedEvidence[0]?.id)
      }
      for (const hidden of [tallow, publicKnowledge]) {
        expect(hidden.incidents.map(({ id }) => id)).not.toContain(rollback.id)
        expect(hidden.evidence.map(({ id }) => id)).not.toContain(
          linkedEvidence[0]?.id,
        )
      }

      expect(result.state.eventLog).toBe(beforeEventLog)
      expect(result.state.eventLog.length).toBe(beforeEventCount)
    },
  )

  it('returns the exact same state object when the daily response is retried', () => {
    const fixture = fixtureFor('response.meridian.rollback.standard')
    const first = requireProcessed(fixture.state)
    const before = {
      incidents: first.causality.incidents.length,
      evidence: first.causality.evidence.length,
      nextIncidentSequence: first.causality.nextIncidentSequence,
      nextEvidenceSequence: first.causality.nextEvidenceSequence,
    }

    const second = processCausalResponses(first)

    expect(second).toEqual({ processed: true, state: first })
    if (!second.processed) return
    expect(second.state).toBe(first)
    expect({
      incidents: second.state.causality.incidents.length,
      evidence: second.state.causality.evidence.length,
      nextIncidentSequence: second.state.causality.nextIncidentSequence,
      nextEvidenceSequence: second.state.causality.nextEvidenceSequence,
    }).toEqual(before)
  })

  it.each(ROLLBACK_ACTIONS)(
    'enforces one rollback-family child and exact-ID retry for %s',
    (selectedAction) => {
      const fixture = fixtureFor(selectedAction)
      const processed = requireProcessed(fixture.state)
      const rollback = requireRollback(processed, fixture.quality)

      const retry = recordCausalIncident(processed, {
        incidentId: rollback.id,
        actionId: selectedAction,
        parentIncidentId: fixture.quality.id,
        kind: 'competitor-response',
        occurredOnServiceDay: processed.serviceDay,
        targetId: 'meridian',
        actualActorId: 'meridian',
      })
      expect(retry).toMatchObject({
        accepted: true,
        applied: false,
        incident: rollback,
      })
      if (!retry.accepted) return
      expect(retry.state).toBe(processed)

      for (const otherAction of ROLLBACK_ACTIONS.filter(
        (actionId) => actionId !== selectedAction,
      )) {
        const conflicting = recordCausalIncident(processed, {
          incidentId: `conflict:${fixture.quality.id}:${otherAction}`,
          actionId: otherAction,
          parentIncidentId: fixture.quality.id,
          kind: 'competitor-response',
          occurredOnServiceDay: processed.serviceDay,
          targetId: 'meridian',
          actualActorId: 'meridian',
        })
        expect(conflicting).toEqual({
          accepted: false,
          state: processed,
          reason: 'INVALID_ACTION',
        })
      }
    },
  )

  it('rolls back the incident write when its linked evidence write fails', () => {
    const fixture = fixtureFor('response.meridian.rollback.fast')
    let incidentCalls = 0
    let evidenceCalls = 0
    const operations: CausalGameplayOperations = {
      recordIncident(state, input) {
        incidentCalls += 1
        return recordCausalIncident(state, input)
      },
      recordEvidence(state, input) {
        evidenceCalls += 1
        void input
        return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
      },
    }
    const originalCausality = fixture.state.causality

    const result = processCausalResponses(fixture.state, operations)

    expect(result).toEqual({
      processed: false,
      state: fixture.state,
      reason: 'INVALID_EVIDENCE',
    })
    expect(result.state).toBe(fixture.state)
    expect(result.state.causality).toBe(originalCausality)
    expect(incidentCalls).toBe(1)
    expect(evidenceCalls).toBe(1)
    expect(rollbackChildren(fixture.state, fixture.quality.id)).toEqual([])
  })

  it('processes roots in incident sequence and discards every earlier response if a later root fails', () => {
    const fixture = fixtureFor('response.meridian.rollback.forensic')
    const second = appendVisibleQualityRoot(
      fixture.state,
      'quality-root-second-atomic-call',
    )
    const orderedRootIds = [fixture.quality.id, second.incident.id]
    const attemptedRootIds: string[] = []
    let evidenceCalls = 0
    const operations: CausalGameplayOperations = {
      recordIncident(state, input) {
        if (input.parentIncidentId) attemptedRootIds.push(input.parentIncidentId)
        return recordCausalIncident(state, input)
      },
      recordEvidence(state, input) {
        evidenceCalls += 1
        if (evidenceCalls === 2) {
          return { accepted: false, state, reason: 'INVALID_EVIDENCE' }
        }
        return recordCausalEvidence(state, input)
      },
    }

    const result = processCausalResponses(second.state, operations)

    expect(attemptedRootIds).toEqual(orderedRootIds)
    expect(evidenceCalls).toBe(2)
    expect(result).toEqual({
      processed: false,
      state: second.state,
      reason: 'INVALID_EVIDENCE',
    })
    expect(result.state).toBe(second.state)
    expect(
      result.state.causality.incidents.filter(({ actionId }) =>
        isRollbackAction(actionId),
      ),
    ).toEqual([])
  })

  it('does not respond to a raw quality root that MERIDIAN cannot observe', () => {
    const initial = createCampaign('unseen-private-quality-root')
    const recorded = recordCausalIncident(initial, {
      incidentId: 'unseen-quality-root',
      actionId: 'sabotage.quality-degradation',
      parentIncidentId: null,
      kind: 'sabotage',
      occurredOnServiceDay: initial.serviceDay,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    if (!recorded.accepted) throw new Error(recorded.reason)
    expect(recorded.state.causality.incidents).toContainEqual(recorded.incident)
    expect(
      projectCausalKnowledge(recorded.state, {
        kind: 'competitor',
        competitorId: 'meridian',
      }).incidents,
    ).toEqual([])

    const result = processCausalResponses(recorded.state)

    expect(result).toEqual({ processed: true, state: recorded.state })
    expect(result.state).toBe(recorded.state)
    expect(rollbackChildren(result.state, recorded.incident.id)).toEqual([])
  })

  it('rejects an integrity-refreshed v7 save forged with two rollback-family siblings', () => {
    const fixture = fixtureFor('response.meridian.rollback.fast')
    const processed = requireProcessed(fixture.state)
    const rollback = requireRollback(processed, fixture.quality)
    const forgedSibling: CausalIncident = {
      ...rollback,
      id: 'forged-rollback-family-sibling',
      sequence: processed.causality.nextIncidentSequence,
      actionId: 'response.meridian.rollback.forensic',
    }
    const forged: CampaignState = {
      ...processed,
      causality: {
        ...processed.causality,
        nextIncidentSequence: processed.causality.nextIncidentSequence + 1,
        incidents: [...processed.causality.incidents, forgedSibling],
      },
    }

    const encoded = encodeSave(forged, '2026-08-15T00:00:00.000Z')
    const portable = JSON.parse(encoded) as {
      version: number
      integrity: { checkpointHash: string }
    }

    expect(portable.version).toBe(7)
    expect(portable.integrity.checkpointHash).toMatch(/^[0-9a-f]{8}$/)
    expect(decodeSave(encoded)).toMatchObject({
      ok: false,
      reason: 'CORRUPT_SAVE',
    })
  })
})

describe('recovery-contamination opportunity projection', () => {
  it.each(ROLLBACK_ACTIONS)(
    'derives the exact open window for %s without persisted opportunity state',
    (actionId) => {
      const fixture = fixtureFor(actionId)
      const processed = requireProcessed(fixture.state)
      const rollback = requireRollback(processed, fixture.quality)

      expect(selectRecoveryContaminationOpportunities(processed)).toEqual([
        {
          id: `follow-up:${rollback.id}:recovery-contamination`,
          sourceIncidentId: rollback.id,
          nodeId: 'sabotage.quality-degradation',
          opensOnServiceDay: rollback.occurredOnServiceDay,
          expiresOnServiceDay:
            rollback.occurredOnServiceDay + rollbackOpportunityDays(actionId),
          status: 'open',
        },
      ])
    },
  )

  it('keeps the deadline inclusive, expires afterward, and gives used status precedence', () => {
    const fixture = fixtureFor('response.meridian.rollback.standard')
    const processed = requireProcessed(fixture.state)
    const rollback = requireRollback(processed, fixture.quality)
    const expiresOnServiceDay =
      rollback.occurredOnServiceDay +
      rollbackOpportunityDays('response.meridian.rollback.standard')
    const atDeadline = { ...processed, serviceDay: expiresOnServiceDay }
    const afterDeadline = { ...processed, serviceDay: expiresOnServiceDay + 1 }

    expect(selectRecoveryContaminationOpportunities(atDeadline)).toEqual([
      expect.objectContaining({ status: 'open', expiresOnServiceDay }),
    ])
    expect(selectRecoveryContaminationOpportunities(afterDeadline)).toEqual([
      expect.objectContaining({ status: 'expired', expiresOnServiceDay }),
    ])

    const recovered = recordCausalIncident(afterDeadline, {
      incidentId: `recovery-child:${rollback.id}`,
      actionId: 'follow-up.recovery-contamination',
      parentIncidentId: rollback.id,
      kind: 'service-disruption',
      occurredOnServiceDay: rollback.occurredOnServiceDay + 1,
      targetId: 'meridian',
      actualActorId: 'player',
    })
    if (!recovered.accepted) throw new Error(recovered.reason)
    expect(selectRecoveryContaminationOpportunities(recovered.state)).toEqual([
      expect.objectContaining({ status: 'used', expiresOnServiceDay }),
    ])
  })

  it('visibility-gates through company evidence before inspecting a raw rollback', () => {
    const fixture = fixtureFor('response.meridian.rollback.forensic')
    const processed = requireProcessed(fixture.state)
    const rollback = requireRollback(processed, fixture.quality)
    const hidden: CampaignState = {
      ...processed,
      causality: {
        ...processed.causality,
        evidence: processed.causality.evidence.filter(
          ({ incidentId }) => incidentId !== rollback.id,
        ),
      },
    }
    expect(hidden.causality.incidents).toContainEqual(rollback)
    expect(
      projectCausalKnowledge(hidden, { kind: 'company' }).incidents.map(
        ({ id }) => id,
      ),
    ).not.toContain(rollback.id)

    expect(selectRecoveryContaminationOpportunities(hidden)).toEqual([])
  })

  it('returns sequence-sorted fresh derived values for multiple visible rollbacks', () => {
    const fixture = fixtureFor('response.meridian.rollback.fast')
    const second = appendVisibleQualityRoot(
      fixture.state,
      'quality-root-second-opportunity-order',
    )
    const processed = requireProcessed(second.state)
    const rollbackIds = processed.causality.incidents
      .filter(({ actionId }) => isRollbackAction(actionId))
      .sort((left, right) => left.sequence - right.sequence)
      .map(({ id }) => id)

    const firstSelection = selectRecoveryContaminationOpportunities(processed)
    const secondSelection = selectRecoveryContaminationOpportunities(processed)

    expect(firstSelection.map(({ sourceIncidentId }) => sourceIncidentId)).toEqual(
      rollbackIds,
    )
    expect(firstSelection).toEqual(secondSelection)
    expect(firstSelection).not.toBe(secondSelection)
    expect(firstSelection[0]).not.toBe(secondSelection[0])

    firstSelection.reverse()
    const firstMutated = firstSelection[0]
    if (firstMutated) firstMutated.status = 'used'
    expect(
      selectRecoveryContaminationOpportunities(processed).map(
        ({ sourceIncidentId, status }) => ({ sourceIncidentId, status }),
      ),
    ).toEqual(
      rollbackIds.map((sourceIncidentId) => ({
        sourceIncidentId,
        status: 'open',
      })),
    )
  })

  it('does not persist opportunities, window copies, or a response roll', () => {
    const fixture = fixtureFor('response.meridian.rollback.standard')
    const processed = requireProcessed(fixture.state)
    expect(selectRecoveryContaminationOpportunities(processed)).toHaveLength(1)

    const encoded = encodeSave(processed, '2026-08-15T00:00:00.000Z')

    expect(encoded).not.toContain('"opportunities"')
    expect(encoded).not.toContain('"expiresOnServiceDay"')
    expect(encoded).not.toContain('"responseRoll"')
    expect(encoded).not.toContain('"causalResponseRoll"')
    expect(decodeSave(encoded).ok).toBe(true)
  })
})
