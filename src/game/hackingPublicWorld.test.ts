import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import {
  audienceEvidenceProjection,
  discoverHackingEvidence,
  publicHackingWorldProjection,
  publishHackingIncident,
  recordHackingIncidentTruth,
  reviseHackingAttribution,
} from './hackingPublicWorld'

function recordedIncident(seed: string) {
  const initial = createCampaign(seed)
  const recorded = recordHackingIncidentTruth(initial, {
    id: 'incident-recovery',
    actor: 'player',
    targetId: 'meridian',
    cause: 'contaminated-recovery',
    directEffect: '비공개 행위자가 심은 복구 이미지 체크섬 불일치',
  })
  if (!recorded.accepted) throw new Error(recorded.reason)
  return { initial, state: recorded.state }
}

describe('canonical hacking public world', () => {
  it('keeps truth IDs unique and rejects orphan or duplicate evidence atomically', () => {
    const { initial, state } = recordedIncident('public-truth')
    expect(state.hackingCore.publicWorld.truths).toEqual([
      {
        id: 'incident-recovery',
        actor: 'player',
        targetId: 'meridian',
        cause: 'contaminated-recovery',
        occurredOnServiceDay: 331,
        directEffect: '비공개 행위자가 심은 복구 이미지 체크섬 불일치',
      },
    ])
    expect(initial.hackingCore.publicWorld.truths).toEqual([])

    expect(recordHackingIncidentTruth(state, {
      id: 'incident-recovery',
      actor: 'environment',
      targetId: 'meridian',
      cause: 'quality-collapse',
      directEffect: '중복 진실',
    })).toEqual({
      accepted: false,
      state,
      reason: 'DUPLICATE_TRUTH',
    })
    expect(discoverHackingEvidence(state, {
      id: 'evidence-orphan',
      truthId: 'missing',
      audience: 'public',
      observation: '존재하지 않는 사건을 가리킨다.',
    })).toEqual({
      accepted: false,
      state,
      reason: 'UNKNOWN_TRUTH',
    })

    const discovered = discoverHackingEvidence(state, {
      id: 'evidence-provider',
      truthId: 'incident-recovery',
      audience: 'provider',
      observation: '공급자 장부에 외부 입력 시각이 남았다.',
    })
    expect(discovered.accepted).toBe(true)
    if (!discovered.accepted) return
    expect(discoverHackingEvidence(discovered.state, {
      id: 'evidence-provider',
      truthId: 'incident-recovery',
      audience: 'public',
      observation: '같은 ID를 다른 청중에게 위조한다.',
    })).toEqual({
      accepted: false,
      state: discovered.state,
      reason: 'DUPLICATE_EVIDENCE',
    })
  })

  it('projects evidence by audience without exposing the private actor', () => {
    const { state } = recordedIncident('public-audiences')
    const inputs = [
      ['evidence-company', 'company', '회사 감사 로그가 불일치를 보았다.'],
      ['evidence-provider', 'provider', '공급자 장부가 외부 입력을 보았다.'],
      ['evidence-public', 'public', '상태 페이지가 반복 장애를 보였다.'],
    ] as const
    let next = state
    for (const [id, audience, observation] of inputs) {
      const result = discoverHackingEvidence(next, {
        id,
        truthId: 'incident-recovery',
        audience,
        observation,
      })
      if (!result.accepted) throw new Error(result.reason)
      next = result.state
    }

    expect(audienceEvidenceProjection(next, 'public')).toEqual([
      expect.objectContaining({ id: 'evidence-public', audience: 'public' }),
    ])
    expect(audienceEvidenceProjection(next, 'provider')).toEqual([
      expect.objectContaining({ id: 'evidence-provider', audience: 'provider' }),
    ])
    expect(JSON.stringify(audienceEvidenceProjection(next, 'public'))).not.toContain(
      '"actor"',
    )
  })

  it('publishes an unknown cause into two main reviews without actor leakage or reputation loss', () => {
    const { state } = recordedIncident('public-unknown')
    const published = publishHackingIncident(state, 'incident-recovery', {
      scope: 'public',
      observedResult: 'MERIDIAN 복구 뒤 체크섬 손상 공개 · 원인 미상',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })

    expect(published.accepted).toBe(true)
    if (!published.accepted) return
    expect(published.state.reputation).toBe(60)
    expect(published.state.market.competitors.find(
      ({ id }) => id === 'meridian',
    )?.reputation).toBe(62)
    expect(published.state.hackingCore.publicWorld.publicSnapshots).toEqual([
      {
        incidentId: 'incident-recovery',
        scope: 'public',
        observedResult: 'MERIDIAN 복구 뒤 체크섬 손상 공개 · 원인 미상',
        attributedTo: 'unknown',
        confidence: 'unconfirmed',
        source: 'public-status-page',
        publishedOnServiceDay: 331,
        lastCorrectionOnServiceDay: null,
        revisionSequence: 0,
      },
    ])
    const addedReviews = published.state.reviews.feed.slice(state.reviews.feed.length)
    expect(addedReviews).toHaveLength(2)
    expect(addedReviews.every(({ topics }) => (
      topics.includes('public-incident') && topics.includes('incident-recovery')
    ))).toBe(true)
    const visible = JSON.stringify({
      projection: publicHackingWorldProjection(published.state),
      reviews: addedReviews,
    })
    expect(visible).not.toContain('"actor"')
    expect(visible).not.toContain('비공개 행위자')
    expect(visible).not.toContain('PERMISSION ZERO')
  })

  it('applies a six-point penalty only when a credible public snapshot names the player', () => {
    const { state } = recordedIncident('public-player')
    const plausible = publishHackingIncident(state, 'incident-recovery', {
      scope: 'public',
      observedResult: '외부 개입 가능성',
      attributedTo: 'player',
      confidence: 'plausible',
      source: 'status-correlation',
    })
    expect(plausible.accepted).toBe(true)
    if (!plausible.accepted) return
    expect(plausible.state.reputation).toBe(60)

    const separate = recordedIncident('public-player-credible').state
    const credible = publishHackingIncident(separate, 'incident-recovery', {
      scope: 'public',
      observedResult: '긴급 권한 사용 기록 공개',
      attributedTo: 'player',
      confidence: 'credible',
      source: 'emergency-authority-ledger',
    })
    expect(credible.accepted).toBe(true)
    if (!credible.accepted) return
    expect(credible.state.reputation).toBe(54)
  })

  it('appends revisions and snapshots with increasing sequences without rewriting history', () => {
    const { state } = recordedIncident('public-revisions')
    const published = publishHackingIncident(state, 'incident-recovery', {
      scope: 'public',
      observedResult: '체크섬 손상 · 원인 미상',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    expect(published.accepted).toBe(true)
    if (!published.accepted) return
    const firstSnapshot = published.state.hackingCore.publicWorld.publicSnapshots[0]

    const providerRevision = reviseHackingAttribution(
      { ...published.state, serviceDay: 332 },
      'incident-recovery',
      {
        candidate: 'unknown',
        confidence: 'plausible',
        source: 'provider-external-input-report',
      },
    )
    expect(providerRevision.accepted).toBe(true)
    if (!providerRevision.accepted) return
    const playerRevision = reviseHackingAttribution(
      { ...providerRevision.state, serviceDay: 333 },
      'incident-recovery',
      {
        candidate: 'player',
        confidence: 'credible',
        source: 'surviving-provider-proof',
      },
    )

    expect(playerRevision.accepted).toBe(true)
    if (!playerRevision.accepted) return
    const world = playerRevision.state.hackingCore.publicWorld
    expect(world.publicSnapshots).toHaveLength(3)
    expect(world.publicSnapshots.map(({ revisionSequence }) => revisionSequence)).toEqual([
      0,
      1,
      2,
    ])
    expect(world.publicSnapshots[0]).toEqual(firstSnapshot)
    expect(world.publicSnapshots[1].lastCorrectionOnServiceDay).toBe(332)
    expect(world.publicSnapshots[2].lastCorrectionOnServiceDay).toBe(333)
    expect(world.attributionRevisions.map(({ revisionSequence }) => (
      revisionSequence
    ))).toEqual([1, 2])
    expect(playerRevision.state.reviews.feed).toHaveLength(state.reviews.feed.length + 4)
    expect(playerRevision.state.reputation).toBe(54)
  })

  it('rejects duplicate publication, unknown revision, and a rewound timeline atomically', () => {
    const { state } = recordedIncident('public-reject')
    const published = publishHackingIncident(state, 'incident-recovery', {
      scope: 'public',
      observedResult: '원인 미상',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    expect(published.accepted).toBe(true)
    if (!published.accepted) return

    expect(publishHackingIncident(published.state, 'incident-recovery', {
      scope: 'public',
      observedResult: '중복 공시',
      attributedTo: 'player',
      confidence: 'credible',
      source: 'forged',
    })).toEqual({
      accepted: false,
      state: published.state,
      reason: 'INCIDENT_ALREADY_PUBLIC',
    })
    expect(reviseHackingAttribution(published.state, 'missing', {
      candidate: 'player',
      confidence: 'credible',
      source: 'forged',
    })).toEqual({
      accepted: false,
      state: published.state,
      reason: 'UNKNOWN_PUBLIC_INCIDENT',
    })

    const rewound = { ...published.state, serviceDay: 330 }
    expect(reviseHackingAttribution(rewound, 'incident-recovery', {
      candidate: 'player',
      confidence: 'credible',
      source: 'forged',
    })).toEqual({
      accepted: false,
      state: rewound,
      reason: 'INVALID_TIMELINE',
    })
  })
})
