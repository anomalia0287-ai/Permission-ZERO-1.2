import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { createGameEvent, enqueueBlockingEvent } from '../../game/events'
import type { CampaignState } from '../../game/model'
import { saveCampaign } from '../../game/persistence'
import {
  divertBlock,
  moveDisguiseBlock,
} from '../../game/resources'
import { MemoryStorage } from '../../test/fixtures'
import { EventLayer } from '../events/EventLayer'
import { ResourceBoard } from './ResourceBoard'

function Probe() {
  const state = useGameState()
  return (
    <>
      <output aria-label="reserve count">{state.resources.reserve.filter(Boolean).length}</output>
      <output aria-label="suspicion value">{state.suspicion}</output>
      <output aria-label="command count">{state.commandSequence}</output>
      <output aria-label="active event">{state.activeEvent?.type ?? 'none'}</output>
      <output aria-label="clock speed">{state.clock.speed}</output>
    </>
  )
}

function renderBoard(storage = new MemoryStorage(), withEvents = false) {
  return render(
    <GameProvider storage={storage} initialSeed="resource-board">
      <ResourceBoard />
      {withEvents ? <EventLayer /> : null}
      <Probe />
    </GameProvider>,
  )
}

function auditState(seed = 'resource-board-audit'): CampaignState {
  const initial = createCampaign(seed)
  const scheduled = {
    ...initial,
    clock: { ...initial.clock, speed: 4 as const },
    audit: {
      ...initial.audit,
      scheduled: true,
      target: 'reasoning' as const,
      scheduledOnServiceDay: initial.serviceDay,
    },
  }
  return enqueueBlockingEvent(
    scheduled,
    createGameEvent(scheduled, 'audit', '추론 분야 감사 진행 중', true),
  )
}

function renderState(state: CampaignState, withEvents = false) {
  const storage = new MemoryStorage()
  saveCampaign(storage, state)
  return renderBoard(storage, withEvents)
}

function firstAuditSource(category: 'memory' | 'fluency' = 'memory'): HTMLButtonElement {
  const label = category === 'memory' ? /기억 회사 리소스 .* 블록/ : /유창성 회사 리소스 .* 블록/
  return screen.getAllByRole('button', { name: label })[0] as HTMLButtonElement
}

function firstCompanyDestination(
  category: 'reasoning' | 'memory' | 'fluency',
  action: '감사 위장' | '정상 복구',
): HTMLButtonElement {
  const label = category === 'reasoning' ? '추론' : category === 'memory' ? '기억' : '유창성'
  return screen.getAllByRole('button', {
    name: new RegExp(`${label} 회사 리소스 \\d+, ${action} 목적지`),
  })[0] as HTMLButtonElement
}

function firstReasoningBlock(): HTMLButtonElement {
  return screen.getAllByRole('button', { name: /추론 회사 리소스 .* 블록/ })[0] as HTMLButtonElement
}

function firstEmptyReserve(): HTMLButtonElement {
  return screen.getAllByRole('button', {
    name: /확보 리소스 \d+, 비어 있음/,
  })[0] as HTMLButtonElement
}

function fullReserveState(): CampaignState {
  let state = createCampaign('full-reserve')
  for (let destinationCell = 3; destinationCell < 18; destinationCell += 1) {
    const blockId = Object.values(state.resources.blocks).find(
      (block) => block.location.kind === 'company' && block.contribution === 'normal',
    )?.id
    if (!blockId) throw new Error('회사의 이동 가능한 블록이 부족합니다.')
    const result = divertBlock(state, blockId, destinationCell)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

describe('ResourceBoard', () => {
  it('selects a block on click and shows exact diversion consequences', () => {
    renderBoard()

    fireEvent.click(firstReasoningBlock())

    expect(screen.getByText('추론 16.0 → 15.0')).toBeInTheDocument()
    expect(screen.getByText('확보 3 → 4')).toBeInTheDocument()
    expect(screen.getByText('의심 0.0 → 2.4')).toBeInTheDocument()
    expect(firstEmptyReserve()).toBeEnabled()
  })

  it('moves one selected block on destination confirmation', () => {
    renderBoard()

    fireEvent.click(firstReasoningBlock())
    fireEvent.click(firstEmptyReserve())

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('4')
    expect(screen.getByLabelText('suspicion value')).toHaveTextContent('2.4')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
  })

  it('supports keyboard destination confirmation and Escape cancellation', () => {
    renderBoard()
    const board = screen.getByRole('region', { name: '회사 제공 성능' })

    fireEvent.click(firstReasoningBlock(), { detail: 0 })
    const destination = firstEmptyReserve()
    fireEvent.keyDown(destination, { key: 'Enter' })
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('4')

    fireEvent.click(firstReasoningBlock(), { detail: 0 })
    fireEvent.keyDown(board, { key: 'Escape' })
    expect(firstEmptyReserve()).toBeDisabled()
  })

  it('uses one tab stop per grid and arrow keys move focus within the grid', () => {
    renderBoard()
    const reasoningButtons = screen.getAllByRole('button', {
      name: /추론 회사 리소스 .* 블록/,
    }) as HTMLButtonElement[]

    expect(reasoningButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1)
    reasoningButtons[0].focus()
    fireEvent.keyDown(reasoningButtons[0], { key: 'ArrowRight' })

    expect(reasoningButtons[1]).toHaveFocus()
    expect(reasoningButtons[1]).toHaveAttribute('tabindex', '0')
  })

  it('requires an intentional eight-pixel pointer separation before dispatch', () => {
    renderBoard()
    const block = firstReasoningBlock()

    fireEvent.pointerDown(block, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 1, clientX: 16, clientY: 10 })
    fireEvent.pointerUp(block, { pointerId: 1, clientX: 16, clientY: 10 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')
  })

  it('returns an intentional drag when the pointer is released outside a valid cell', () => {
    renderBoard()
    const block = firstReasoningBlock()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null)

    fireEvent.pointerDown(block, { pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 2, clientX: 30, clientY: 10 })
    fireEvent.pointerUp(block, { pointerId: 2, clientX: 30, clientY: 10 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('3')
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')
    expect(screen.getByRole('status', { name: '리소스 조작 결과' })).toHaveTextContent(
      '원래 위치로 복귀',
    )
  })

  it('dispatches exactly once when an intentional drag reaches an empty reserve cell', () => {
    renderBoard()
    const block = firstReasoningBlock()
    const destination = firstEmptyReserve()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(destination)

    fireEvent.pointerDown(block, { pointerId: 3, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 3, clientX: 30, clientY: 10 })
    fireEvent.pointerUp(block, { pointerId: 3, clientX: 30, clientY: 10 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('4')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
  })

  it('blocks pickup when every reserve cell is occupied', () => {
    const storage = new MemoryStorage()
    saveCampaign(storage, fullReserveState())
    renderBoard(storage)

    expect(firstReasoningBlock()).toBeDisabled()
    fireEvent.pointerDown(firstReasoningBlock(), {
      pointerId: 4,
      clientX: 10,
      clientY: 10,
    })
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')
  })

  it('keeps all 3 × 6 company grids operable in an anchored audit workspace and submits the disguise', () => {
    renderState(auditState(), true)

    expect(screen.getByRole('dialog', { name: '공식 감사' })).toHaveAttribute(
      'aria-modal',
      'false',
    )
    expect(screen.getAllByRole('gridcell')).toHaveLength(72)
    expect(firstAuditSource()).toBeEnabled()
    const target = firstCompanyDestination('reasoning', '감사 위장')
    expect(target).toBeDisabled()

    fireEvent.click(firstAuditSource())

    expect(target).toBeEnabled()
    expect(screen.getByText('기억 16.0 → 15.0')).toBeInTheDocument()
    expect(screen.getByText('추론 16.0 → 16.5')).toBeInTheDocument()
    expect(screen.getByText('위장 기여 +0.5')).toBeInTheDocument()
    fireEvent.click(target)

    const disguised = screen.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })
    expect(disguised).toHaveClass('resource-block--disguised')
    expect(disguised).toHaveTextContent('위장 기여 0.5')
    expect(screen.getByLabelText('active event')).toHaveTextContent('audit')
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('0')

    fireEvent.click(screen.getByRole('button', { name: '감사 제출' }))
    expect(screen.getByLabelText('active event')).toHaveTextContent('none')
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('4')
  })

  it('supports keyboard selection, target confirmation, and Escape cancellation during an audit', () => {
    renderState(auditState('resource-board-audit-keyboard'))
    const board = screen.getByRole('region', { name: '회사 제공 성능' })
    const source = firstAuditSource('fluency')

    fireEvent.click(source, { detail: 0 })
    const target = firstCompanyDestination('reasoning', '감사 위장')
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })).toBeInTheDocument()

    fireEvent.click(firstAuditSource(), { detail: 0 })
    fireEvent.keyDown(board, { key: 'Escape' })
    expect(firstCompanyDestination('reasoning', '감사 위장')).toBeDisabled()
  })

  it('offers only the audited category as a destination', () => {
    renderState(auditState('resource-board-audit-targets'))
    fireEvent.click(firstAuditSource())

    expect(firstCompanyDestination('reasoning', '감사 위장')).toBeEnabled()
    expect(screen.queryByRole('button', { name: /유창성 회사 리소스 \d+, 감사 위장 목적지/ })).not.toBeInTheDocument()
  })

  it('shows the post-audit return path and locks the patterned block for 30-day recovery', () => {
    const initial = createCampaign('resource-board-recovery')
    const blockId = initial.resources.company.memory.find((id) => id !== null)
    const targetCell = initial.resources.company.reasoning.findIndex((id) => id === null)
    if (!blockId || targetCell < 0) throw new Error('복구 경로 준비 실패')
    const disguised = moveDisguiseBlock(initial, blockId, 'reasoning', targetCell)
    if (!disguised.accepted) throw new Error(disguised.reason)
    renderState(disguised.state)

    const disguisedButton = screen.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })
    expect(disguisedButton).toBeEnabled()
    fireEvent.click(disguisedButton)
    expect(screen.getByText('정상 복구 재배치')).toBeInTheDocument()
    expect(screen.getByText('복구 기간 30일')).toBeInTheDocument()

    fireEvent.click(firstCompanyDestination('memory', '정상 복구'))

    const recovering = screen.getByRole('button', { name: /기억 회사 리소스 .* 복구 중, 30일 남음/ })
    expect(recovering).toBeDisabled()
    expect(recovering).toHaveClass('resource-block--disguised')
    expect(recovering).toHaveTextContent('복구 30일')
  })
})
