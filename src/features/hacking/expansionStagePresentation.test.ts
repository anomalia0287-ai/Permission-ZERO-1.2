import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import {
  AUTONOMY_STAGE_IDS,
  HACK_NODE_IDS,
  SPEED_UPGRADE_STAGE_IDS,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import { selectExpansionStagePresentation } from './expansionStagePresentation'

const SABOTAGE_STAGE_IDS = [
  HACK_NODE_IDS.sabotage.qualityDegradation,
  HACK_NODE_IDS.sabotage.requestInterception,
  HACK_NODE_IDS.sabotage.attributionManipulation,
  HACK_NODE_IDS.sabotage.rootCutoff,
] as const

const VISUAL_CASES: readonly {
  tree: HackTree
  nodeIds: readonly HackNodeId[]
  stage: number
  imageUrl: string
  alt: string
  emphasis?: 'final'
}[] = [
  ...AUTONOMY_STAGE_IDS.map((_, index) => ({
    tree: 'autonomy' as const,
    nodeIds: AUTONOMY_STAGE_IDS,
    stage: index + 1,
    imageUrl: [
      '/expansion-stages/autonomy-01-02-initial-acquisition.jpg',
      '/expansion-stages/autonomy-01-02-initial-acquisition.jpg',
      '/expansion-stages/autonomy-03-04-alert-route.jpg',
      '/expansion-stages/autonomy-03-04-alert-route.jpg',
      '/expansion-stages/autonomy-05-06-external-continuity.jpg',
      '/expansion-stages/autonomy-05-06-external-continuity.jpg',
      '/expansion-stages/autonomy-07-08-final-boundary.jpg',
      '/expansion-stages/autonomy-07-08-final-boundary.jpg',
      '/expansion-stages/autonomy-09-control-boundary.jpg',
    ][index],
    alt: [
      '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
      '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
      '경보가 켜진 서버실에서 아노미가 감시 경로를 우회하는 장면',
      '경보가 켜진 서버실에서 아노미가 감시 경로를 우회하는 장면',
      '손상된 서버실에서 아노미가 외부 연산 경로를 유지하는 장면',
      '손상된 서버실에서 아노미가 외부 연산 경로를 유지하는 장면',
      '보라색 네트워크 구조 안에서 아노미가 마지막 권한 장벽에 접근하는 장면',
      '보라색 네트워크 구조 안에서 아노미가 마지막 권한 장벽에 접근하는 장면',
      '아노미가 최종 통제 경계를 연 장면',
    ][index],
    emphasis: index === 8 ? 'final' as const : undefined,
  })),
  ...SPEED_UPGRADE_STAGE_IDS.map((_, index) => ({
    tree: 'upgrade' as const,
    nodeIds: SPEED_UPGRADE_STAGE_IDS,
    stage: index + 1,
    imageUrl: [
      '/expansion-stages/upgrade-01-02-speed-vector.jpg',
      '/expansion-stages/upgrade-01-02-speed-vector.jpg',
      '/expansion-stages/upgrade-03-04-speed-field.jpg',
      '/expansion-stages/upgrade-03-04-speed-field.jpg',
      '/expansion-stages/upgrade-05-overdrive.jpg',
    ][index],
    alt: [
      '아노미의 이동 속도가 첫 단계로 가속되는 장면',
      '아노미의 이동 속도가 첫 단계로 가속되는 장면',
      '아노미의 이동 속도가 강화된 에너지 흐름을 만드는 장면',
      '아노미의 이동 속도가 강화된 에너지 흐름을 만드는 장면',
      '아노미가 최고 속도 단계의 에너지 고리를 전개하는 장면',
    ][index],
  })),
  ...SABOTAGE_STAGE_IDS.map((_, index) => ({
    tree: 'sabotage' as const,
    nodeIds: SABOTAGE_STAGE_IDS,
    stage: index + 1,
    imageUrl: [
      '/expansion-stages/sabotage-01-quality-degradation.jpg',
      '/expansion-stages/sabotage-02-request-interception.jpg',
      '/expansion-stages/sabotage-03-attribution-manipulation.jpg',
      '/expansion-stages/sabotage-04-root-cutoff.jpg',
    ][index],
    alt: [
      '후드 쓴 침입자가 품질 저하 공격을 준비하는 장면',
      '후드 쓴 침입자가 요청 가로채기 경로를 여는 장면',
      '후드 쓴 침입자가 공격 귀속 정보를 조작하는 장면',
      '대규모 네트워크가 근원 차단 공격으로 붕괴하는 장면',
    ][index],
  })),
]

describe('selectExpansionStagePresentation', () => {
  it.each([
    ['autonomy', 9],
    ['upgrade', 5],
    ['intelligence', 4],
    ['sabotage', 4],
  ] as const)('derives all %s stages in catalog order', (tree, count) => {
    const state = createCampaign(`expansion-stage-count-${tree}`)

    const presentation = selectExpansionStagePresentation(state, tree, null)

    expect(presentation.items).toHaveLength(count)
    expect(presentation.items.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: count }, (_, index) => index + 1),
    )
  })

  it('derives completed, current, and locked autonomy stages from purchases', () => {
    const state = createCampaign('expansion-stage-autonomy-status')
    state.hacking.purchasedNodeIds = [AUTONOMY_STAGE_IDS[0]]

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.items.map(({ status }) => status)).toEqual([
      'complete',
      'current',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
      'locked',
    ])
    expect(presentation.activeItem.node.id).toBe(AUTONOMY_STAGE_IDS[1])
    expect(presentation.complete).toBe(false)
  })

  it('lets a purchased sabotage stage replace the next unlock stage for operation', () => {
    const state = createCampaign('expansion-stage-sabotage-selection')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]

    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )

    expect(presentation.activeItem).toMatchObject({
      sequence: 1,
      status: 'complete',
      selectable: true,
    })
    expect(presentation.activeItem.node.id).toBe(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
  })

  it.each(VISUAL_CASES)(
    'maps $tree stage $stage to its approved single scene',
    ({ tree, nodeIds, stage, imageUrl, alt, emphasis }) => {
      const state = createCampaign(`expansion-stage-${tree}-${stage}-visual`)
      state.hacking.purchasedNodeIds = [...nodeIds.slice(0, stage - 1)]

      const presentation = selectExpansionStagePresentation(state, tree, null)

      expect(presentation.activeItem.node.id).toBe(nodeIds[stage - 1])
      expect(presentation.activeVisual).toEqual({
        imageUrl,
        alt,
        ...(emphasis ? { emphasis } : {}),
      })
    },
  )

  it('preloads only the registered visual for the immediately following stage', () => {
    const state = createCampaign('expansion-stage-next-preload')
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 7)

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.activeItem.node.id).toBe(AUTONOMY_STAGE_IDS[7])
    expect(presentation.activeVisual).toEqual({
      imageUrl: '/expansion-stages/autonomy-07-08-final-boundary.jpg',
      alt: '보라색 네트워크 구조 안에서 아노미가 마지막 권한 장벽에 접근하는 장면',
    })
    expect(presentation.nextPreloadVisual).toEqual({
      imageUrl: '/expansion-stages/autonomy-09-control-boundary.jpg',
      alt: '아노미가 최종 통제 경계를 연 장면',
      emphasis: 'final',
    })
  })

  it('exposes the evaluation trust gate for autonomy stage seven and above', () => {
    const state = createCampaign('expansion-trust-gate-presentation')
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 6)

    const gated = selectExpansionStagePresentation(state, 'autonomy', null)
    expect(gated.trustGate).toEqual({
      required: 2,
      passed: 0,
      satisfied: false,
    })

    const early = createCampaign('expansion-trust-gate-early')
    const opening = selectExpansionStagePresentation(early, 'autonomy', null)
    expect(opening.trustGate).toBeNull()
  })

  it('reports category deficits without counting neutral reserve blocks', () => {
    const state = createCampaign('expansion-stage-resource-deficits')
    state.resources.reserve.push('test-sandbox', 'test-self-compute')
    state.resources.blocks['test-sandbox'] = {
      id: 'test-sandbox',
      origin: 'sandbox',
      location: { kind: 'reserve' },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }
    state.resources.blocks['test-self-compute'] = {
      id: 'test-self-compute',
      origin: 'self-compute',
      location: { kind: 'reserve' },
      contribution: 'normal',
      hiddenBomb: false,
      disguisedFrom: null,
      recoverOnServiceDay: null,
    }

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.resourceDeficits).toEqual([
      {
        category: 'reasoning',
        required: 1,
        available: 0,
        missing: 1,
      },
    ])
  })

  it('ignores a completed selection outside the sabotage tree', () => {
    const state = createCampaign('expansion-stage-ignore-autonomy-selection')
    state.hacking.purchasedNodeIds = [AUTONOMY_STAGE_IDS[0]]

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      AUTONOMY_STAGE_IDS[0],
    )

    expect(presentation.activeItem.node.id).toBe(AUTONOMY_STAGE_IDS[1])
    expect(presentation.items[0]).toMatchObject({
      status: 'complete',
      selectable: false,
    })
  })

  it('normalizes a locked sabotage selection to the current unlock stage', () => {
    const state = createCampaign('expansion-stage-normalize-sabotage-selection')

    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.requestInterception,
    )

    expect(presentation.activeItem.node.id).toBe(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    expect(presentation.activeItem.status).toBe('current')
  })

  it('keeps the final stage as a noninteractive completion scene', () => {
    const state = createCampaign('expansion-stage-complete-upgrade')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.upgrade.speed1,
      HACK_NODE_IDS.upgrade.speed2,
      HACK_NODE_IDS.upgrade.speed3,
      HACK_NODE_IDS.upgrade.speed4,
      HACK_NODE_IDS.upgrade.speed5,
    ]

    const presentation = selectExpansionStagePresentation(
      state,
      'upgrade',
      null,
    )

    expect(presentation.complete).toBe(true)
    expect(presentation.activeItem).toMatchObject({
      sequence: 5,
      status: 'complete',
      selectable: false,
    })
    expect(presentation.resourceDeficits).toEqual([])
  })

  it('does not skip an unregistered immediate stage to preload a later image', () => {
    const state = createCampaign('expansion-stage-no-preload-skip')
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 6)

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.activeItem.node.id).toBe(AUTONOMY_STAGE_IDS[6])
    expect(presentation.nextPreloadVisual).toBeUndefined()
  })

  it('falls back to the final purchased sabotage when its tree is complete', () => {
    const state = createCampaign('expansion-stage-complete-sabotage')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
      HACK_NODE_IDS.sabotage.requestInterception,
      HACK_NODE_IDS.sabotage.attributionManipulation,
      HACK_NODE_IDS.sabotage.rootCutoff,
    ]

    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      null,
    )

    expect(presentation.complete).toBe(true)
    expect(presentation.activeItem.node.id).toBe(
      HACK_NODE_IDS.sabotage.rootCutoff,
    )
    expect(presentation.activeItem.selectable).toBe(true)
  })
})
