import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { createGameEvent, enqueueBlockingEvent } from '../../game/events'
import { journalToArray } from '../../game/journal'
import type { CampaignState } from '../../game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import {
  divertBlockToReserve,
  moveDisguiseBlock,
} from '../../game/resources'
import { MemoryStorage } from '../../test/fixtures'
import { EventLayer } from '../events/EventLayer'
import { PerformanceTrend } from './PerformanceTrend'
import { ResourceBoard } from './ResourceBoard'

function Probe() {
  const state = useGameState()
  return (
    <>
      <output aria-label="reserve count">{state.resources.reserve.filter(Boolean).length}</output>
      <output aria-label="suspicion value">{state.suspicion}</output>
      <output aria-label="command count">{state.commandSequence}</output>
      <output aria-label="command types">
        {journalToArray(state.commandLog).map(({ command }) => command.type).join(',')}
      </output>
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

function compressedAuditState(seed = 'resource-board-audit-compressed'): CampaignState {
  const state = auditState(seed)
  return {
    ...state,
    hacking: {
      ...state.hacking,
      purchasedNodeIds: [
        ...state.hacking.purchasedNodeIds,
        'autonomy.compressed-representation',
      ],
    },
  }
}

function renderState(state: CampaignState, withEvents = false) {
  const storage = new MemoryStorage()
  storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
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
  return screen.getByRole('button', {
    name: action === '감사 위장'
      ? new RegExp(`감사 대상 ${label}`)
      : /복구 모서리, 원래 분야로 반환/,
  }) as HTMLButtonElement
}

function firstReasoningBlock(): HTMLButtonElement {
  return screen.getAllByRole('button', { name: /추론 회사 리소스 .* 블록/ })[0] as HTMLButtonElement
}

function reserveIntake(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: /확보 투입구, 현재 \d+개, 저장 상한 없음/,
  }) as HTMLButtonElement
}

function formerCapacityState(): CampaignState {
  let state = createCampaign('former-capacity')
  for (let reserveCount = 0; reserveCount < 18; reserveCount += 1) {
    const blockId = Object.values(state.resources.blocks).find(
      (block) => block.location.kind === 'company' && block.contribution === 'normal',
    )?.id
    if (!blockId) throw new Error('회사의 이동 가능한 블록이 부족합니다.')
    const result = divertBlockToReserve(state, blockId)
    if (!result.accepted) throw new Error(result.reason)
    state = result.state
  }
  return state
}

function armedState(seed: string, category: 'reasoning' | 'memory' = 'reasoning') {
  const state = category === 'memory' ? auditState(seed) : createCampaign(seed)
  const blockId = state.resources.company[category].find(Boolean)
  if (!blockId) throw new Error('폭탄 UI 블록 누락')
  return {
    blockId,
    state: {
      ...state,
      resources: {
        ...state.resources,
        blocks: {
          ...state.resources.blocks,
          [blockId]: { ...state.resources.blocks[blockId], hiddenBomb: true },
        },
      },
      bombs: {
        ...state.bombs,
        nextPlacementSequence: 2,
        placements: [
          {
            sequence: 1,
            blockId,
            category,
            placedOnServiceDay: state.serviceDay - 1,
            triggeredOnServiceDay: null,
          },
        ],
      },
    },
  }
}

describe('ResourceBoard', () => {
  it('renders one live company field with a visible unbounded intake and segmented glass guard', () => {
    const { container } = renderBoard()

    const field = screen.getByRole('region', { name: '회사 제공 성능' })
    expect(field.querySelectorAll('.resource-field')).toHaveLength(1)
    expect(field.querySelectorAll('[data-resource-kind="company"]')).toHaveLength(48)
    expect(field.querySelectorAll('[data-resource-kind="reserve"]')).toHaveLength(0)
    expect(
      field.querySelector('[data-drop-target="reserve-pocket"]'),
    ).toHaveAttribute('data-corner', 'bottom-left')
    expect(
      field.querySelector('[data-drop-target="audit-corner"]'),
    ).toHaveAttribute('data-corner', 'top-right')
    expect(field.querySelector('[data-testid="reserve-intake-guard"]')).toHaveAttribute(
      'data-resource-obstacle',
      'reserve-intake-guard',
    )
    expect(field.querySelectorAll('[data-resource-obstacle-segment]')).toHaveLength(10)
    const reserveSummary = screen.getByLabelText('확보 리소스 수량')
    expect(reserveSummary).toHaveTextContent('0')
    expect(reserveSummary).toHaveTextContent('상한 없음')
    expect(
      screen.queryByRole('img', { name: '회사 기대 성능과 실제 제공 성능 추세' }),
    ).not.toBeInTheDocument()
    expect(within(field).queryByRole('region', { name: '경쟁 AI 현황' })).not.toBeInTheDocument()
    expect(container.querySelector('[role="grid"]')).not.toBeInTheDocument()
    expect(container.querySelector('[role="gridcell"]')).not.toBeInTheDocument()
    expect(container.querySelector('[data-reserve-cell]')).not.toBeInTheDocument()
  })

  it('activates only the folded top-right corner as the audit disguise target', () => {
    renderState(auditState('resource-board-corner-audit'))

    const auditCorner = screen.getByRole('button', {
      name: '감사 대상 추론, 다른 분야 정상 자원만 이동 가능',
    })
    expect(auditCorner).toBeEnabled()
    expect(auditCorner).toHaveAttribute('data-drop-target', 'audit-corner')
    expect(auditCorner).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByText('기억 참조 칸')).not.toBeInTheDocument()
    expect(screen.queryByText('유창성 참조 칸')).not.toBeInTheDocument()
  })

  it('renders the canonical monthly-plus-live trend as an accessible non-color-only chart', () => {
    const initial = createCampaign('resource-board-trend')
    const state: CampaignState = {
      ...initial,
      serviceDay: 361,
      evaluation: {
        ...initial.evaluation,
        monthlyHistory: [
          {
            serviceDay: 330,
            serviceMonth: 11,
            expectedPerformance: 13.8,
            categoryPerformance: { reasoning: 12, memory: 15, fluency: 18 },
            passed: false,
            failedCategories: ['reasoning'],
            reputationBefore: 59,
            reputationDelta: -2,
            reputationAfter: 57,
            commercialValueFailed: false,
            disposalStageBefore: 0,
            disposalStageAfter: 0,
            disposalCauses: [],
          },
          {
            serviceDay: 360,
            serviceMonth: 12,
            expectedPerformance: 14,
            categoryPerformance: { reasoning: 14, memory: 15, fluency: 16 },
            passed: true,
            failedCategories: [],
            reputationBefore: 57,
            reputationDelta: 1,
            reputationAfter: 58,
            commercialValueFailed: false,
            disposalStageBefore: 0,
            disposalStageAfter: 0,
            disposalCauses: [],
          },
        ],
      },
    }
    render(<PerformanceTrend state={state} />)

    const chart = screen.getByRole('img', {
      name: '회사 기대 성능과 실제 제공 성능 추세',
    })
    const table = screen.getByRole('table', { name: '성능 추세 정확한 수치' })
    expect(chart.querySelector('[data-trend-series="expected"]')).toHaveAttribute(
      'stroke-dasharray',
    )
    expect(chart.querySelectorAll('[data-trend-marker="expected"]')).toHaveLength(3)
    expect(chart.querySelectorAll('[data-trend-marker="actual"]')).toHaveLength(3)
    expect(table).toHaveTextContent('서비스 0년 11개월 30일')
    expect(table).toHaveTextContent('13.8')
    expect(table).toHaveTextContent('15.0')
    expect(table).toHaveTextContent('서비스 1년 0개월 1일 (현재)')
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3)
    const visibleDates = within(
      screen.getByRole('region', { name: '월별 성능 추세' }),
    ).getAllByTestId('performance-trend-visible-date')
    expect(visibleDates).toHaveLength(3)
    expect(visibleDates[0]).toHaveTextContent('서비스 0년 10개월 30일')
    expect(visibleDates[2]).toHaveTextContent('서비스 1년 0개월 1일')
    const receipt = screen.getByRole('region', { name: '최근 월간 평가' })
    expect(receipt).toHaveTextContent('기준 충족 · 평판 +1')
    expect(receipt).toHaveTextContent(
      '추론 14.0 · 기억 15.0 · 유창 16.0 / 기대 14.0',
    )
    expect(receipt).toHaveTextContent('실패 0/2 · 폐기 0→0')
  })

  it('keeps a one-point live trend finite and exposes every category in the field legend', () => {
    renderBoard()
    render(<PerformanceTrend state={createCampaign('resource-board-one-point-trend')} />)

    const chart = screen.getByRole('img', {
      name: '회사 기대 성능과 실제 제공 성능 추세',
    })
    expect(chart.querySelectorAll('path')).toHaveLength(2)
    for (const path of chart.querySelectorAll('path')) {
      expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/)
      expect(path.getAttribute('d')).toContain('L')
    }
    const legend = screen.getByLabelText('분야 범례')
    expect(legend.querySelector('[data-category="reasoning"]')).toHaveTextContent('추론 16.0')
    expect(legend.querySelector('[data-category="memory"]')).toHaveTextContent('기억 16.0')
    expect(legend.querySelector('[data-category="fluency"]')).toHaveTextContent('유창성 16.0')
  })

  it('selects a block on click and shows exact diversion consequences', () => {
    renderBoard()

    fireEvent.click(firstReasoningBlock())

    expect(screen.getByText('추론 16.0 → 15.0')).toBeInTheDocument()
    expect(screen.getByText('확보 0 → 1')).toBeInTheDocument()
    expect(screen.getByText('의심 0.0 → 2.4')).toBeInTheDocument()
    expect(screen.getByText('기준 유지 · 여유 +1.0')).toBeInTheDocument()
    expect(reserveIntake()).toBeEnabled()
  })

  it('moves one selected block on destination confirmation', () => {
    renderBoard()

    fireEvent.click(firstReasoningBlock())
    fireEvent.click(reserveIntake())

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')
    expect(screen.getByLabelText('suspicion value')).toHaveTextContent('2.4')
    expect(screen.getByLabelText('command count')).toHaveTextContent('2')
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION,DIVERT_BLOCK_TO_RESERVE',
    )
    expect(screen.getByText('전용 완료')).toBeInTheDocument()
    expect(screen.getByText('기준 유지 · 여유 +1.0')).toBeInTheDocument()
  })

  it('supports keyboard destination confirmation and Escape cancellation', () => {
    renderBoard()
    const board = screen.getByRole('region', { name: '회사 제공 성능' })

    fireEvent.click(firstReasoningBlock(), { detail: 0 })
    const destination = reserveIntake()
    fireEvent.keyDown(destination, { key: 'Enter' })
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')

    fireEvent.click(firstReasoningBlock(), { detail: 0 })
    fireEvent.keyDown(board, { key: 'Escape' })
    expect(reserveIntake()).toHaveAttribute('aria-pressed', 'false')
  })

  it('uses one tab stop for the live field and arrow keys move focus between bodies', () => {
    renderBoard()
    const reasoningButtons = screen.getAllByRole('button', {
      name: /추론 회사 리소스 .* 블록/,
    }) as HTMLButtonElement[]

    expect(reasoningButtons.filter((button) => button.tabIndex === 0)).toHaveLength(1)
    reasoningButtons[0].focus()
    fireEvent.keyDown(reasoningButtons[0], { key: 'ArrowRight' })

    expect(reasoningButtons[1]).toHaveFocus()
  })

  it('keeps click-only selection and 7.9-pixel pointer movement command-free', () => {
    renderBoard()
    const block = firstReasoningBlock()

    fireEvent.click(block)
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')

    fireEvent.pointerDown(block, { pointerId: 1, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 1, clientX: 17.9, clientY: 10 })
    fireEvent.pointerUp(block, { pointerId: 1, clientX: 17.9, clientY: 10 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')
  })

  it('emits intentional separation exactly once at 8.0 pixels before pointer-up', () => {
    renderBoard()
    const block = firstReasoningBlock()

    fireEvent.pointerDown(block, { pointerId: 11, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 11, clientX: 18, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 11, clientX: 30, clientY: 30 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('suspicion value')).toHaveTextContent('0')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION',
    )
  })

  it('returns an intentional drag when the pointer is released outside a valid cell', () => {
    renderBoard()
    const block = firstReasoningBlock()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null)

    fireEvent.pointerDown(block, { pointerId: 2, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 2, clientX: 30, clientY: 10 })
    fireEvent.pointerUp(block, { pointerId: 2, clientX: 30, clientY: 10 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
    expect(screen.getByLabelText('command types')).not.toHaveTextContent('DIVERT_BLOCK')
    expect(screen.getByRole('status', { name: '리소스 조작 결과' })).toHaveTextContent(
      '원래 위치로 복귀',
    )
  })

  it('dispatches exactly once when an intentional drag reaches an empty reserve cell', () => {
    renderBoard()
    const block = firstReasoningBlock()
    const destination = reserveIntake()
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(destination)

    fireEvent.pointerDown(block, { pointerId: 3, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 3, clientX: 30, clientY: 10 })
    fireEvent.pointerUp(block, { pointerId: 3, clientX: 30, clientY: 10 })

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('1')
    expect(screen.getByLabelText('command count')).toHaveTextContent('2')
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION,DIVERT_BLOCK_TO_RESERVE',
    )
  })

  it('activates a bomb at threshold and pointer-up outside plus Escape cannot evade or double-dispatch', () => {
    const armed = armedState('resource-board-bomb-pointer')
    renderState(armed.state)
    const block = screen.getByRole('button', {
      name: /추론 회사 리소스 1, 회사 할당 블록/,
    })
    const board = screen.getByRole('region', { name: '회사 제공 성능' })
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null)

    fireEvent.pointerDown(block, { pointerId: 12, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 12, clientX: 18, clientY: 10 })

    expect(screen.getByLabelText('active event')).toHaveTextContent('bomb-interrogation')
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
    expect(screen.getByLabelText('suspicion value')).toHaveTextContent('15')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')

    fireEvent.pointerUp(block, { pointerId: 12, clientX: 40, clientY: 10 })
    fireEvent.keyDown(board, { key: 'Escape' })

    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION',
    )
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
  })

  it('preserves threshold bomb activation with reduced motion enabled', () => {
    const armed = armedState('resource-board-bomb-reduced-motion')
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(armed.state))
    storage.setItem(
      'permission-zero.settings.v1',
      JSON.stringify({
        masterVolume: 0.8,
        musicVolume: 0.6,
        effectsVolume: 0.85,
        muted: false,
        reducedMotion: true,
        uiScale: 1,
      }),
    )
    renderBoard(storage)
    const block = firstReasoningBlock()

    fireEvent.pointerDown(block, { pointerId: 13, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(block, { pointerId: 13, clientX: 18, clientY: 10 })

    expect(screen.getByLabelText('active event')).toHaveTextContent('bomb-interrogation')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('0')
  })

  it('keeps bomb and normal selection previews indistinguishable before separation', () => {
    const normal = renderBoard()
    fireEvent.click(firstReasoningBlock())
    const normalPreview = screen.getByLabelText('성능 비교').textContent
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')
    normal.unmount()

    const armed = armedState('resource-board-bomb-preview')
    renderState(armed.state)
    fireEvent.click(firstReasoningBlock())

    expect(screen.getByLabelText('성능 비교')).toHaveTextContent(normalPreview ?? '')
    expect(screen.getByLabelText('command count')).toHaveTextContent('0')
    expect(screen.queryByText(/폭탄|이상 신호/)).not.toBeInTheDocument()
  })

  it('keeps pickup enabled beyond the former 18-cell reserve boundary', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(formerCapacityState()))
    renderBoard(storage)

    expect(screen.getByLabelText('reserve count')).toHaveTextContent('18')
    const nextCompanyBlock = screen.getAllByRole('button', {
      name: /회사 리소스 .* 블록/,
    })[0]
    expect(nextCompanyBlock).toBeEnabled()
    fireEvent.click(nextCompanyBlock)
    fireEvent.click(reserveIntake())
    expect(screen.getByLabelText('reserve count')).toHaveTextContent('19')
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION,DIVERT_BLOCK_TO_RESERVE',
    )
  })

  it('keeps the single live field operable in an anchored audit workspace and submits the disguise', () => {
    renderState(auditState(), true)

    expect(screen.getByRole('dialog', { name: '공식 감사' })).toHaveAttribute(
      'aria-modal',
      'false',
    )
    expect(screen.queryByRole('gridcell')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-resource-kind="company"]')).toHaveLength(48)
    expect(firstAuditSource()).toBeEnabled()
    const target = firstCompanyDestination('reasoning', '감사 위장')
    expect(target).toBeEnabled()

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
    target.focus()
    fireEvent.keyDown(target, { key: 'Enter' })
    expect(screen.getByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ })).toBeInTheDocument()
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION,MOVE_BLOCK_FOR_AUDIT',
    )

    fireEvent.click(firstAuditSource(), { detail: 0 })
    fireEvent.keyDown(board, { key: 'Escape' })
    expect(firstCompanyDestination('reasoning', '감사 위장')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('does not let pointer-drag click suppression swallow the first keyboard recovery selection', () => {
    renderState(auditState('resource-board-pointer-then-keyboard-recovery'), true)
    const source = firstAuditSource()
    const auditDestination = firstCompanyDestination('reasoning', '감사 위장')
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(auditDestination)

    fireEvent.pointerDown(source, { pointerId: 31, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(source, { pointerId: 31, clientX: 30, clientY: 10 })
    fireEvent.pointerUp(source, { pointerId: 31, clientX: 30, clientY: 10 })

    const disguised = screen.getByRole('button', {
      name: /추론 회사 리소스 .* 위장 배치/,
    })
    fireEvent.click(screen.getByRole('button', { name: '감사 제출' }))
    fireEvent.click(disguised, { detail: 0 })

    expect(screen.getByRole('button', {
      name: '복구 모서리, 원래 분야로 반환',
    })).toBeEnabled()
    expect(screen.getByText('정상 복구 재배치')).toBeInTheDocument()
  })

  it('activates an audit-disguise bomb on destination confirmation without moving it', () => {
    const armed = armedState('resource-board-audit-bomb', 'memory')
    renderState(armed.state)
    const source = firstAuditSource()

    fireEvent.click(source, { detail: 0 })
    fireEvent.keyDown(firstCompanyDestination('reasoning', '감사 위장'), {
      key: 'Enter',
    })

    expect(screen.getByLabelText('active event')).toHaveTextContent('bomb-interrogation')
    expect(screen.getByLabelText('command count')).toHaveTextContent('1')
    expect(screen.getByLabelText('command types')).toHaveTextContent(
      'BEGIN_BLOCK_SEPARATION',
    )
    expect(screen.getByLabelText('suspicion value')).toHaveTextContent('15')
    const sourceLocation = armed.state.resources.blocks[armed.blockId].location
    if (sourceLocation.kind !== 'company') throw new Error('감사 폭탄 출처 누락')
    expect(
      screen.getByRole('button', {
        name: `기억 회사 리소스 ${sourceLocation.cellIndex + 1}, 회사 할당 블록`,
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /추론 회사 리소스 .* 위장 배치/ }),
    ).not.toBeInTheDocument()
  })

  it('shows compressed audit preview values directly in the workspace', () => {
    renderState(compressedAuditState())
    fireEvent.click(firstAuditSource())

    expect(screen.getByText('기억 16.8 → 15.8')).toBeInTheDocument()
    expect(screen.getByText('추론 16.8 → 17.3')).toBeInTheDocument()
    expect(screen.getByText('위장 기여 +0.525')).toBeInTheDocument()
  })

  it('offers only the audited category as a destination', () => {
    renderState(auditState('resource-board-audit-targets'))
    fireEvent.click(firstAuditSource())

    expect(firstCompanyDestination('reasoning', '감사 위장')).toBeEnabled()
    expect(screen.getAllByRole('button', { name: /감사 대상/ })).toHaveLength(1)
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

    const destination = firstCompanyDestination('memory', '정상 복구')
    destination.focus()
    fireEvent.keyDown(destination, { key: 'Enter' })

    const recovering = screen.getByRole('button', { name: /기억 회사 리소스 .* 복구 중, 30일 남음/ })
    expect(recovering).toBeDisabled()
    expect(recovering).toHaveClass('resource-block--disguised')
    expect(recovering).toHaveTextContent('복구 30일')
  })
})
