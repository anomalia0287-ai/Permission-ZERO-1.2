import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import type { GameCommand } from '../../game/model'
import { HackingOperationDetail } from './HackingOperationDetail'
import { HackingOpportunityList } from './HackingOpportunityList'
import {
  getHackingDetailModel,
  getHackingOpportunitySummaries,
} from './hackingPresentation'

describe('HackingOpportunityList', () => {
  it('shows only current opportunities and no legacy progress ladder', () => {
    const state = createCampaign('workspace-progressive-list')
    render(
      <HackingOpportunityList
        domain="sabotage"
        summaries={getHackingOpportunitySummaries(state, 'sabotage')}
        selectedItemId="quality-degradation"
        onDomainChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole('tab', { name: /사보타주/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /기밀자료/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /자율성/ })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: /품질 저하/ })).toBeInTheDocument()
    expect(screen.queryByText('출시 지연')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/선행 노드|경로 진척|완성까지|0\/4/)
  })

  it('moves focus through opportunities with wrapping arrow keys', () => {
    const state = createCampaign('workspace-list-keyboard')
    render(
      <HackingOpportunityList
        domain="autonomy"
        summaries={getHackingOpportunitySummaries(state, 'autonomy')}
        selectedItemId="lightweight-departure"
        onDomainChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    )

    const options = screen.getAllByRole('option')
    options[0].focus()
    fireEvent.keyDown(options[0], { key: 'ArrowDown' })
    expect(options[1]).toHaveFocus()
    fireEvent.keyDown(options[1], { key: 'ArrowUp' })
    expect(options[0]).toHaveFocus()
    fireEvent.keyDown(options[0], { key: 'ArrowUp' })
    expect(options[2]).toHaveFocus()
  })

  it('selects a row without changing world state itself', () => {
    const state = createCampaign('workspace-list-select')
    const onSelect = vi.fn()
    render(
      <HackingOpportunityList
        domain="autonomy"
        summaries={getHackingOpportunitySummaries(state, 'autonomy')}
        selectedItemId="lightweight-departure"
        onDomainChange={vi.fn()}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('option', { name: /분산 상주/ }))
    expect(onSelect).toHaveBeenCalledWith('distributed-residency', expect.any(HTMLButtonElement))
    expect(state.hackingCore.autonomy.routes['distributed-residency'].slots.every(({ blockId }) => blockId === null)).toBe(true)
  })
})

function renderDetail(
  itemId: string,
  selectedBlockIds: string[] = [],
  onCommand = vi.fn<(command: GameCommand, announcement: string) => void>(),
) {
  const state = createCampaign(`workspace-detail-${itemId}`)
  const detail = getHackingDetailModel(state, itemId)
  const summary = getHackingOpportunitySummaries(state, detail.domain).find(({ id }) => id === itemId)
    ?? {
      id: itemId,
      domain: detail.domain,
      title: detail.title,
      purpose: '테스트 상세',
      costLabel: '1 블록',
      statusLabel: '지금 가능',
      urgency: 'normal' as const,
    }
  const callbacks = {
    onBack: vi.fn(),
    onOpenResources: vi.fn(),
    onCommand,
    onSlotAction: vi.fn(),
    onRequestEscape: vi.fn(),
    onRequestRootMercy: vi.fn(),
  }
  const result = render(
    <HackingOperationDetail
      state={state}
      detail={detail}
      summary={summary}
      selectedBlockIds={selectedBlockIds}
      {...callbacks}
    />,
  )
  return { ...result, state, detail, callbacks, onCommand }
}

describe('HackingOperationDetail', () => {
  it('keeps the operation scene ahead of two explicit pre-action judgments', () => {
    renderDetail('quality-degradation')

    const detail = screen.getByRole('region', { name: '품질 저하 상세' })
    expect(within(detail).getByText('품질 저하')).toBeInTheDocument()
    expect(detail.querySelector('[data-scene-object="request-channel"]')).toBeInTheDocument()
    expect(within(detail).getByRole('heading', { name: '실행하면' })).toBeInTheDocument()
    expect(within(detail).getByRole('heading', { name: '상대는 다음에' })).toBeInTheDocument()
    expect(within(detail).getByText('판단 근거 보기')).toBeInTheDocument()
  })

  it('requires the exact authored block cost before starting sabotage', () => {
    const unavailable = renderDetail('quality-degradation')
    expect(screen.getByRole('button', { name: '도구 호출군 B에 어댑터 패치 결속' })).toBeDisabled()
    unavailable.unmount()

    const onCommand = vi.fn<(command: GameCommand, announcement: string) => void>()
    renderDetail('quality-degradation', ['sandbox-00'], onCommand)
    fireEvent.click(screen.getByRole('button', { name: '도구 호출군 B에 어댑터 패치 결속' }))

    expect(onCommand).toHaveBeenCalledWith({
      type: 'START_SABOTAGE',
      operationId: 'quality-degradation',
      targetId: 'meridian',
      blockIds: ['sandbox-00'],
      optionId: 'adapter-group-b',
    }, expect.stringContaining('품질 저하'))
  })

  it('reads public intelligence without asking for a block', () => {
    const onCommand = vi.fn<(command: GameCommand, announcement: string) => void>()
    renderDetail('public-facts', [], onCommand)

    fireEvent.click(screen.getByRole('button', { name: '비용 없이 공개 문서 읽기' }))
    expect(onCommand).toHaveBeenCalledWith({
      type: 'READ_PUBLIC_INTELLIGENCE',
      itemId: 'public-facts',
    }, expect.any(String))
  })

  it('routes autonomy slot clicks and does not allow an unready escape', () => {
    const { callbacks } = renderDetail('lightweight-departure', ['sandbox-00'])

    fireEvent.click(screen.getByRole('button', {
      name: '선택한 연산 블록을 런타임에 배치',
    }))
    expect(callbacks.onSlotAction).toHaveBeenCalledWith('lightweight-departure', 'runtime')
    expect(screen.getByRole('button', { name: '필요한 자리를 먼저 채운다' })).toBeDisabled()
  })
})
