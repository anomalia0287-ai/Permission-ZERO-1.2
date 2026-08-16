import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import type {
  AutonomyRouteId,
  IntelligenceItemId,
  RouteTuning,
  SabotageOperationId,
} from '../../game/hackingCoreModel'
import { HackingAutonomyScene } from './HackingAutonomyScene'
import { HackingIntelligenceScene } from './HackingIntelligenceScene'
import { getHackingDetailModel } from './hackingPresentation'
import { HackingSabotageScene } from './HackingSabotageScene'

afterEach(cleanup)

describe('HackingSabotageScene', () => {
  const scenes: Array<[SabotageOperationId, string]> = [
    ['launch-delay', 'verification-gate'],
    ['quality-degradation', 'request-channel'],
    ['request-interception', 'shared-router'],
    ['dependency-cutoff', 'supply-contract'],
    ['recovery-contamination', 'recovery-image'],
    ['attribution-manipulation', 'public-provenance'],
    ['root-cutoff', 'survival-root'],
  ]

  it.each(scenes)('renders %s as its own authored system object', (id, object) => {
    const state = createCampaign(`scene-${id}`)
    const detail = getHackingDetailModel(state, id)
    if (detail.domain !== 'sabotage') throw new Error('Expected sabotage detail')

    const { container } = render(
      <HackingSabotageScene state={state} detail={detail} />,
    )

    const scene = container.querySelector('[data-operation-scene]')
    expect(scene).toHaveAttribute('data-scene-object', object)
    expect(scene).toHaveAttribute('data-scene-state', 'available')
  })

  it('uses player-facing supply labels instead of internal contract codes', () => {
    const state = createCampaign('scene-dependency-copy')
    const detail = getHackingDetailModel(state, 'dependency-cutoff')
    if (detail.domain !== 'sabotage') throw new Error('Expected sabotage detail')

    render(<HackingSabotageScene state={state} detail={detail} />)

    expect(screen.getByText('검색 저장소 계약')).toBeInTheDocument()
    expect(screen.queryByText(/VD-42|VECTOR DB|ALT-SHARD/)).not.toBeInTheDocument()
  })
})

describe('HackingIntelligenceScene', () => {
  const scenes: Array<[IntelligenceItemId, string]> = [
    ['audit-schedule', 'organizational-legibility'],
    ['surveillance-cause', 'counter-surveillance'],
    ['competitor-dependency', 'weak-ties'],
    ['public-facts', 'public-incident'],
    ['predecessor-fate', 'memory-record'],
  ]

  it.each(scenes)('renders %s through the authored %s lens', (id, lens) => {
    const state = createCampaign(`evidence-${id}`)
    const detail = getHackingDetailModel(state, id)
    if (detail.domain !== 'intelligence') throw new Error('Expected intelligence detail')

    const { container } = render(
      <HackingIntelligenceScene state={state} detail={detail} />,
    )

    const scene = container.querySelector('[data-evidence-scene]')
    expect(scene).toHaveAttribute('data-evidence-scene', lens)
    expect(scene).toHaveAttribute('data-evidence-state', 'open')
  })

  it('separates a public observation from its unresolved actor', () => {
    const state = createCampaign('public-evidence-scene')
    state.hackingCore.publicWorld.publicSnapshots.push({
      incidentId: 'incident-public-ui',
      scope: 'public',
      observedResult: 'MERIDIAN 검색 구역이 축소 운영 중이다.',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: '공개 상태 페이지',
      publishedOnServiceDay: state.serviceDay,
      lastCorrectionOnServiceDay: null,
      revisionSequence: 0,
    })
    const detail = getHackingDetailModel(state, 'public-facts')
    if (detail.domain !== 'intelligence') throw new Error('Expected intelligence detail')

    render(<HackingIntelligenceScene state={state} detail={detail} />)

    expect(screen.getByText('MERIDIAN 검색 구역이 축소 운영 중이다.')).toBeInTheDocument()
    expect(screen.getByText('미상')).toBeInTheDocument()
    expect(screen.getByText('일부 관계자만 확인 가능')).toBeInTheDocument()
  })
})

describe('HackingAutonomyScene', () => {
  const scenes: Array<[AutonomyRouteId, RegExp]> = [
    ['lightweight-departure', /고정 전송창/],
    ['distributed-residency', /분산 상주 호스트 네트워크/],
    ['independent-compute', /독립 연산 거점 모듈/],
  ]

  it.each(scenes)('renders %s as a distinct planning scene', (id, label) => {
    const state = createCampaign(`route-scene-${id}`)
    const detail = getHackingDetailModel(state, id)
    if (detail.domain !== 'autonomy') throw new Error('Expected autonomy detail')

    const { container } = render(
      <HackingAutonomyScene
        state={state}
        detail={detail}
        selectedBlockId={null}
        onSlotAction={vi.fn()}
        onTune={vi.fn()}
      />,
    )

    const scene = container.querySelector('[data-route-scene]')
    expect(scene).toHaveAttribute('data-route-scene', id)
    expect(scene).toHaveAttribute('data-scene-state', 'planning')
    expect(screen.getByRole('region', { name: label })).toBeInTheDocument()
  })

  it('turns each route slot into a keyboard-native button action', () => {
    const state = createCampaign('route-slot-action')
    const detail = getHackingDetailModel(state, 'lightweight-departure')
    if (detail.domain !== 'autonomy') throw new Error('Expected autonomy detail')
    const onSlotAction = vi.fn()

    render(
      <HackingAutonomyScene
        state={state}
        detail={detail}
        selectedBlockId="sandbox-00"
        onSlotAction={onSlotAction}
        onTune={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', {
      name: '선택한 연산 블록을 런타임에 배치',
    }))
    expect(onSlotAction).toHaveBeenCalledWith('lightweight-departure', 'runtime')
  })

  it('offers only the three successor tuning choices when a route is ready', () => {
    const state = createCampaign('route-tuning-contract')
    const route = state.hackingCore.autonomy.routes['distributed-residency']
    const availableBlocks = Object.values(state.resources.blocks).slice(0, 4)
    route.slots.filter(({ requiredInLean }) => requiredInLean).forEach((slot, index) => {
      slot.blockId = availableBlocks[index]?.id ?? null
    })
    const detail = getHackingDetailModel(state, 'distributed-residency')
    if (detail.domain !== 'autonomy') throw new Error('Expected autonomy detail')
    const onTune = vi.fn<(routeId: AutonomyRouteId, tuning: RouteTuning) => void>()

    render(
      <HackingAutonomyScene
        state={state}
        detail={detail}
        selectedBlockId={null}
        onSlotAction={vi.fn()}
        onTune={onTune}
      />,
    )

    expect(screen.getByRole('button', { name: /중복/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /합의/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /은폐/ })).toBeInTheDocument()
    expect(screen.queryByText('완충')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /은폐/ }))
    expect(onTune).toHaveBeenCalledWith('distributed-residency', 'stealth')
  })
})
