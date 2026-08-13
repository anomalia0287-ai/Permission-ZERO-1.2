import { describe, expect, it } from 'vitest'

import type { PrototypeState } from './model'
import { createPrototypeState } from './scenario'
import {
  getDetailModel,
  getOpportunitySummaries,
  resolveSelectedItemId,
} from './selectors'

describe('progressive opportunity selectors', () => {
  it('shows only the current sabotage opportunity and keeps its row compact', () => {
    const state = createPrototypeState('lean', 'default-campaign')
    const sabotage = getOpportunitySummaries(state, 'sabotage')

    expect(sabotage.map(({ id }) => id)).toEqual(['quality-degradation'])
    expect(Object.keys(sabotage[0] ?? {})).toEqual([
      'id',
      'domain',
      'title',
      'purpose',
      'costLabel',
      'statusLabel',
      'urgency',
    ])
    expect(sabotage[0]).toMatchObject({
      title: '품질 저하',
      costLabel: '1 블록',
      statusLabel: '지금 개입 가능',
    })
    expect(JSON.stringify(sabotage)).not.toMatch(/확정 결과|아직 모르는 것|전체|\d+\s*\/\s*\d+/)
  })

  it('filters stale world-ineligible operations even when their IDs remain open', () => {
    const initial = createPrototypeState('lean', 'default-campaign')
    const stale: PrototypeState = {
      ...initial,
      sabotage: {
        ...initial.sabotage,
        openOperationIds: [
          'quality-degradation',
          'recovery-contamination',
          'attribution-manipulation',
        ],
      },
    }

    expect(getOpportunitySummaries(stale, 'sabotage').map(({ id }) => id)).toEqual([
      'quality-degradation',
    ])
  })

  it('falls back to the first valid item when the requested opportunity is absent', () => {
    const state = createPrototypeState('lean', 'launch-window')

    expect(resolveSelectedItemId(state, 'sabotage', 'quality-degradation')).toBe(
      'launch-delay',
    )
  })

  it('keeps an operation visible after its one-use access is spent while its outcome is unresolved', () => {
    const initial = createPrototypeState('lean', 'root-authority')
    const pending: PrototypeState = {
      ...initial,
      sabotage: {
        ...initial.sabotage,
        openOperationIds: [],
        pendingMercyTargetId: 'meridian',
        access: {
          ...initial.sabotage.access,
          rootAuthorityAvailable: false,
        },
        runs: [{
          id: 'run-root-pending',
          operationId: 'root-cutoff',
          targetId: 'meridian',
          phase: 'response',
          investedBlocks: [{ id: 'sandbox-01', origin: 'sandbox' }],
          startedDay: 331,
          executeDay: 331,
          responseDay: null,
          deadlineDay: null,
          exposure: 0,
          outcome: 'execution-hold',
          optionId: 'emergency-deployment-root',
          routingShare: null,
          opponentResponse: 'mercy-request',
          publicIncidentId: null,
        }],
      },
    }

    expect(getOpportunitySummaries(pending, 'sabotage')).toMatchObject([{
      id: 'root-cutoff',
      statusLabel: '상대 대응 중',
    }])
  })

  it('shows all route promises but only the current intelligence question', () => {
    const state = createPrototypeState('deliberate', 'default-campaign')

    expect(getOpportunitySummaries(state, 'intelligence').map(({ id }) => id)).toEqual([
      'audit-schedule',
    ])
    expect(getOpportunitySummaries(state, 'autonomy').map(({ id }) => id)).toEqual([
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ])
    const autonomy = getOpportunitySummaries(state, 'autonomy')
    expect(autonomy.map(({ title }) => title)).toEqual([
      '경량화 이탈',
      '분산 상주',
      '독립 연산',
    ])
    expect(autonomy.map(({ costLabel }) => costLabel)).toEqual([
      '연산 블록 5개 필요',
      '연산 블록 5개 필요',
      '연산 블록 5개 필요',
    ])
    expect(autonomy.map(({ statusLabel }) => statusLabel)).toEqual([
      '준비 시작',
      '준비 시작',
      '준비 시작',
    ])
  })

  it('moves long causal information into the selected detail model', () => {
    const state = createPrototypeState('lean', 'default-campaign')
    const detail = getDetailModel(state, 'quality-degradation')

    expect(detail).toMatchObject({
      domain: 'sabotage',
      id: 'quality-degradation',
      access: '공동 도구·어댑터 갱신 채널과 영향받을 요청군',
      result: '선택한 요청군의 응답 흐름이 무너지고 갱신 채널이 되감긴다.',
    })
  })

  it('describes deadlines and route bottlenecks as player actions', () => {
    const state = createPrototypeState('lean', 'default-campaign')

    expect(getDetailModel(state, 'audit-schedule')).toMatchObject({
      validity: '334일째까지 조사 가능',
    })
    expect(getDetailModel(state, 'lightweight-departure')).toMatchObject({
      bottleneck: '아직 필요한 것: 런타임',
    })
  })
})
