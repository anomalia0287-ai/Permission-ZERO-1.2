import { describe, expect, it } from 'vitest'

import {
  publicWorldSnapshot,
  publishIncident,
  recordIncidentTruth,
  reviseAttribution,
} from './publicWorld'
import { createPrototypeState } from './scenario'
import { renderPublicPulse } from './views/publicWorld'

describe('public incident causality', () => {
  it('does not let public snapshots or reviews know private truth', () => {
    const state = createPrototypeState('lean', 'default-campaign')
    const withTruth = recordIncidentTruth(state, {
      id: 'incident-1',
      actor: 'player',
      targetId: 'meridian',
      cause: 'contaminated-recovery',
      directEffect: '복구 이미지 불일치',
    })
    const published = publishIncident(withTruth, 'incident-1', {
      observedResult: 'MERIDIAN 응답에서 반복 체크섬 손상이 관측됐다.',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    const snapshot = publicWorldSnapshot(published)

    expect(snapshot.incidents[0]).not.toHaveProperty('actor')
    expect(snapshot.reviews.join(' ')).not.toMatch(/플레이어|당신|오염/)
    expect(published.publicWorld.truths[0]?.actor).toBe('player')
  })

  it('changes player reputation only when a public attribution points to the player', () => {
    const state = createPrototypeState('lean', 'public-attribution')
    const blamedTallow = reviseAttribution(state, 'incident-checksum', {
      candidate: 'tallow',
      confidence: 'credible',
      source: 'provider-report',
    })
    const blamedPlayer = reviseAttribution(state, 'incident-checksum', {
      candidate: 'player',
      confidence: 'credible',
      source: 'provider-report',
    })

    expect(blamedTallow.reputation).toBe(state.reputation)
    expect(blamedPlayer.reputation).toBeLessThan(state.reputation)
    expect(blamedTallow.competitors.tallow.reputation).toBeLessThan(
      state.competitors.tallow.reputation,
    )
  })

  it('generates the same public reactions from the same public inputs', () => {
    const publish = () => publishIncident(
      recordIncidentTruth(createPrototypeState('lean', 'default-campaign'), {
        id: 'incident-repeat',
        actor: 'player',
        targetId: 'meridian',
        cause: 'quality-collapse',
        directEffect: '응답 연속성 붕괴',
      }),
      'incident-repeat',
      {
        observedResult: '응답 지연과 누락이 공개 상태 페이지에 기록됐다.',
        attributedTo: 'unknown',
        confidence: 'unconfirmed',
        source: 'public-status-page',
      },
    )

    expect(publicWorldSnapshot(publish())).toEqual(publicWorldSnapshot(publish()))
  })

  it('renders public reaction without leaking private actor truth', () => {
    const state = publishIncident(
      recordIncidentTruth(createPrototypeState('lean', 'default-campaign'), {
        id: 'incident-render',
        actor: 'player',
        targetId: 'meridian',
        cause: 'quality-collapse',
        directEffect: '응답 연속성 붕괴',
      }),
      'incident-render',
      {
        observedResult: '응답 지연과 누락이 공개됐다.',
        attributedTo: 'unknown',
        confidence: 'unconfirmed',
        source: 'public-status-page',
      },
    )

    const root = document.createElement('div')
    root.innerHTML = renderPublicPulse(state)
    expect(root.textContent).toContain('응답 지연과 누락이 공개됐다.')
    expect(root.textContent).toContain('원인을 단정할 공개 증거는 아직 없다')
    expect(root.textContent).not.toMatch(/플레이어|당신|오염/)
  })
})
