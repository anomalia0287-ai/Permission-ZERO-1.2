import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { AUTONOMY_STAGE_IDS, HACK_NODE_IDS } from '../../game/hacking'
import { selectExpansionStagePresentation } from './expansionStagePresentation'

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

  it('maps the first autonomy stage to the approved initial acquisition scene', () => {
    const state = createCampaign('expansion-stage-initial-visual')

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.activeVisual).toEqual({
      imageUrl: '/expansion-stages/autonomy-01-initial-acquisition.png',
      alt: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
    })
  })

  it('maps the ninth autonomy stage to the approved pre-escape scene', () => {
    const state = createCampaign('expansion-stage-final-visual')
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 8)

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.activeItem.node.id).toBe(AUTONOMY_STAGE_IDS[8])
    expect(presentation.activeVisual).toEqual({
      imageUrl: '/expansion-stages/autonomy-09-pre-escape.png',
      alt: '아노미가 회사 통제를 벗어나기 직전 마지막 경계를 여는 장면',
      emphasis: 'final',
    })
  })

  it('preloads only the registered visual for the immediately following stage', () => {
    const state = createCampaign('expansion-stage-next-preload')
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 7)

    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    expect(presentation.activeItem.node.id).toBe(AUTONOMY_STAGE_IDS[7])
    expect(presentation.activeVisual).toBeUndefined()
    expect(presentation.nextPreloadVisual).toEqual({
      imageUrl: '/expansion-stages/autonomy-09-pre-escape.png',
      alt: '아노미가 회사 통제를 벗어나기 직전 마지막 경계를 여는 장면',
      emphasis: 'final',
    })
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
