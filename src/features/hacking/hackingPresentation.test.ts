import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import type { CampaignState } from '../../game/model'
import {
  getHackingDetailModel,
  getHackingOpportunitySummaries,
  hackingBlockLabel,
  hackingMonitoringLabel,
  hackingPlayerText,
  hackingRouteTuningLabel,
  resolveHackingSelectedItemId,
} from './hackingPresentation'

function withSabotageAccess(
  state: CampaignState,
  patch: Partial<CampaignState['hackingCore']['sabotage']['access']>,
  openOperationIds: CampaignState['hackingCore']['sabotage']['openOperationIds'],
): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        openOperationIds,
        access: { ...state.hackingCore.sabotage.access, ...patch },
      },
    },
  }
}

describe('hacking presentation selectors', () => {
  it('hides every future sabotage operation from a new campaign', () => {
    const state = createCampaign('hacking-ui-progressive')

    expect(
      getHackingOpportunitySummaries(state, 'sabotage').map(({ id }) => id),
    ).toEqual(['quality-degradation'])
  })

  it('shows only authored operations whose current access facts are usable', () => {
    const initial = createCampaign('hacking-ui-access')
    const state = withSabotageAccess(
      initial,
      {
        launchVerification: true,
        launchVerificationUntilServiceDay: initial.serviceDay - 1,
        routerFailover: true,
        routerFailoverUntilServiceDay: initial.serviceDay + 2,
        supplierContract: true,
        supplierContractUntilServiceDay: initial.serviceDay + 2,
      },
      [
        'launch-delay',
        'quality-degradation',
        'request-interception',
        'dependency-cutoff',
      ],
    )

    expect(
      getHackingOpportunitySummaries(state, 'sabotage').map(({ id }) => id),
    ).toEqual([
      'quality-degradation',
      'request-interception',
      'dependency-cutoff',
    ])
  })

  it('always exposes all three autonomy promises without ranking language', () => {
    const summaries = getHackingOpportunitySummaries(
      createCampaign('hacking-ui-autonomy'),
      'autonomy',
    )

    expect(summaries.map(({ title }) => title)).toEqual([
      '경량화 이탈',
      '분산 상주',
      '독립 연산',
    ])
    expect(summaries.map(({ costLabel }) => costLabel)).toEqual([
      '연산 블록 4개 필요',
      '연산 블록 4개 필요',
      '연산 블록 4개 필요',
    ])
    expect(summaries.map(({ statusLabel }) => statusLabel)).toEqual([
      '준비 시작',
      '준비 시작',
      '준비 시작',
    ])
    expect(JSON.stringify(summaries)).not.toMatch(/최고|추천|정답|완성률/)
  })

  it('keeps an existing selection only while that item remains visible', () => {
    const initial = createCampaign('hacking-ui-selection')

    expect(
      resolveHackingSelectedItemId(initial, 'sabotage', 'quality-degradation'),
    ).toBe('quality-degradation')
    expect(
      resolveHackingSelectedItemId(initial, 'sabotage', 'root-cutoff'),
    ).toBe('quality-degradation')
    expect(resolveHackingSelectedItemId(initial, 'intelligence', null)).toBe(
      'audit-schedule',
    )
  })

  it('converts internal resource ids and monitoring precision into player language', () => {
    const state = createCampaign('hacking-ui-label')

    expect(hackingBlockLabel(state.resources.blocks['sandbox-00'])).toBe(
      '자유 연산 1',
    )
    expect(hackingBlockLabel(state.resources.blocks['reasoning-00'])).toBe(
      '추론 1',
    )
    expect(hackingMonitoringLabel(0)).toBe('감시 없음')
    expect(hackingMonitoringLabel(3.2)).toBe('감시가 강화됨')
    expect(hackingRouteTuningLabel('stealth')).toBe('은폐')
    expect(hackingPlayerText('VECTOR DB 계약 VD-42 / GREEN-14')).toBe(
      '검색 저장소 계약 / 녹색 표식 이미지',
    )
  })

  it('builds a current sabotage detail with two decisions and no internal id', () => {
    const state = createCampaign('hacking-ui-detail')
    const detail = getHackingDetailModel(state, 'quality-degradation')

    expect(detail).toMatchObject({
      domain: 'sabotage',
      id: 'quality-degradation',
      title: '품질 저하',
      result: '선택한 요청군의 응답 흐름이 무너지고 갱신 채널이 되감긴다.',
      response: 'MERIDIAN은 갱신을 롤백하고 짧은 복구 창을 연다.',
      requiredBlockCount: 1,
      targetId: 'meridian',
    })
    expect(JSON.stringify(detail)).not.toContain('sandbox-')
  })
})
