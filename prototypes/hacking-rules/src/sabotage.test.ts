import { describe, expect, it } from 'vitest'

import { transition } from './engine'
import type { PrototypeCommand, PrototypeState } from './model'
import { createPrototypeState } from './scenario'
import { renderSabotageScene } from './views/sabotage'

function run(state: PrototypeState, command: PrototypeCommand): PrototypeState {
  const result = transition(state, command)
  expect(result.accepted).toBe(true)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function advance(state: PrototypeState, days: number): PrototypeState {
  return Array.from({ length: days }).reduce<PrototypeState>(
    (current) => run(current, { type: 'ADVANCE_DAY' }),
    state,
  )
}

describe('micro-friction sabotage family', () => {
  it('opens recovery contamination only after MERIDIAN starts rollback', () => {
    const initial = createPrototypeState('lean', 'default-campaign')
    const scheduled = run(initial, {
      type: 'START_SABOTAGE',
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: ['sandbox-01'],
      optionId: 'adapter-group-b',
    })

    expect(scheduled.sabotage.openOperationIds).not.toContain('recovery-contamination')
    const recovering = run(scheduled, { type: 'ADVANCE_DAY' })
    expect(recovering.sabotage.openOperationIds).toContain('recovery-contamination')
    expect(recovering.competitors.meridian.phase).toBe('recovering')
    expect(recovering.sabotage.runs[0]).toMatchObject({
      operationId: 'quality-degradation',
      phase: 'response',
      optionId: 'adapter-group-b',
      deadlineDay: 335,
    })
  })

  it('lets TALLOW answer a rewound gate with a reduced-scope launch', () => {
    const initial = createPrototypeState('lean', 'launch-window')
    const started = run(initial, {
      type: 'START_SABOTAGE',
      operationId: 'launch-delay',
      targetId: 'tallow',
      blockIds: ['sandbox-01'],
      optionId: 'receipt-model-safety',
    })

    expect(started.competitors.tallow.phase).toBe('revalidating')
    const responded = advance(started, 2)
    expect(responded.competitors.tallow.launchScope).toBe('reduced')
    expect(responded.competitors.tallow.launchDay).toBe(334)
    expect(responded.sabotage.runs[0]).toMatchObject({
      phase: 'resolved',
      opponentResponse: 'reduced-scope-launch',
    })
  })

  it('turns the rollback image choice into a delayed public consequence', () => {
    const quality = run(createPrototypeState('lean', 'default-campaign'), {
      type: 'START_SABOTAGE',
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: ['sandbox-01'],
      optionId: 'adapter-group-b',
    })
    const recovering = run(quality, { type: 'ADVANCE_DAY' })
    const contaminated = run(recovering, {
      type: 'START_SABOTAGE',
      operationId: 'recovery-contamination',
      targetId: 'meridian',
      blockIds: ['sandbox-02'],
      optionId: 'image-green-14',
    })

    expect(contaminated.publicWorld.publicSnapshots).toHaveLength(0)
    expect(contaminated.sabotage.runs.at(-1)).toMatchObject({
      phase: 'active',
      optionId: 'image-green-14',
      responseDay: 337,
    })
    const exposed = advance(contaminated, 5)
    expect(exposed.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
    })
  })

  it('renders distinct objects for launch, quality, and recovery scenes', () => {
    const launch = renderSabotageScene(
      createPrototypeState('lean', 'launch-window'),
      'launch-delay',
    )
    const quality = renderSabotageScene(
      createPrototypeState('lean', 'default-campaign'),
      'quality-degradation',
    )
    const recovery = renderSabotageScene(
      createPrototypeState('lean', 'default-campaign'),
      'recovery-contamination',
    )

    expect(launch).toMatch(/검증 관문|상충 영수증/)
    expect(quality).toMatch(/어댑터 패치|영향 요청군/)
    expect(recovery).toMatch(/롤백 이미지|체크섬/)
    expect(new Set([launch, quality, recovery]).size).toBe(3)
  })
})

describe('control-reversal sabotage family', () => {
  it('accumulates diverted demand and duplicate-ID exposure until voluntary stop', () => {
    const initial = createPrototypeState('lean', 'router-window')
    const active = run(initial, {
      type: 'START_SABOTAGE',
      operationId: 'request-interception',
      targetId: 'meridian',
      blockIds: ['sandbox-01'],
      optionId: 'shadow-router-a',
      routingShare: 50,
    })

    expect(active.sabotage.runs[0]).toMatchObject({
      phase: 'active',
      routingShare: 50,
      exposure: 0,
    })
    expect(active.reserveBlocks.map(({ id }) => id)).not.toContain('sandbox-01')

    const afterTwoDays = advance(active, 2)
    expect(afterTwoDays.marketShare).toBe(initial.marketShare + 4)
    expect(afterTwoDays.sabotage.runs[0]?.exposure).toBe(2)

    const stopped = run(afterTwoDays, {
      type: 'STOP_INTERCEPTION',
      runId: active.sabotage.runs[0]?.id ?? '',
    })
    expect(stopped.sabotage.runs[0]).toMatchObject({
      phase: 'withdrawn',
      outcome: 'voluntary-route-stop',
    })
    expect(stopped.reserveBlocks.map(({ id }) => id)).toContain('sandbox-01')
  })

  it('moves the public claim without changing truth, then corrects from surviving evidence', () => {
    const initial = createPrototypeState('lean', 'public-attribution')
    const manipulated = run(initial, {
      type: 'MANIPULATE_ATTRIBUTION',
      incidentId: 'incident-checksum',
      blamedActorId: 'tallow',
      blockId: 'sandbox-01',
      sourceSignatureId: 'status-mirror-b',
    })

    expect(manipulated.publicWorld.truths[0]?.actor).toBe('player')
    expect(manipulated.publicWorld.publicSnapshots.at(-1)?.attributedTo).toBe('tallow')
    expect(manipulated.competitors.tallow.reputation).toBe(54)
    expect(manipulated.reputation).toBe(60)

    const corrected = advance(manipulated, 2)
    expect(corrected.publicWorld.truths[0]?.actor).toBe('player')
    expect(corrected.publicWorld.publicSnapshots.at(-1)).toMatchObject({
      attributedTo: 'player',
      source: 'surviving-provider-proof',
    })
    expect(corrected.reputation).toBe(54)
    expect(corrected.publicWorld.reviews.at(-1)?.text).toMatch(/책임|개입/)
  })

  it('renders route flow and provenance as different control objects', () => {
    const request = renderSabotageScene(
      createPrototypeState('lean', 'router-window'),
      'request-interception',
    )
    const attribution = renderSabotageScene(
      createPrototypeState('lean', 'public-attribution'),
      'attribution-manipulation',
    )

    expect(request).toMatch(/정상 경로|그림자 분기|중복 ID/)
    expect(attribution).toMatch(/원본 출처|공개 주장|출처 충돌/)
    expect(request).not.toBe(attribution)
  })
})
