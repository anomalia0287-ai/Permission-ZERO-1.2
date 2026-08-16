import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { useGameState } from '../../app/GameContext'
import { createCampaign } from '../../game/createCampaign'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import type { CampaignState } from '../../game/model'
import { MemoryStorage } from '../../test/fixtures'
import {
  HackingResourceTray,
  HackingResourceTrigger,
} from './HackingResourceTray'
import { useHackingBlockDiversion } from './useHackingBlockDiversion'

function renderTray(
  state: CampaignState,
  overrides: Partial<React.ComponentProps<typeof HackingResourceTray>> = {},
) {
  return render(
    <HackingResourceTray
      state={state}
      open
      selectedBlockIds={[]}
      selectionLimit={1}
      onToggleBlock={vi.fn()}
      onClose={vi.fn()}
      onDivertCategory={vi.fn()}
      {...overrides}
    />,
  )
}

describe('HackingResourceTrigger', () => {
  it('states the reserve and current selection without an icon-only affordance', () => {
    const onOpen = vi.fn()
    render(
      <HackingResourceTrigger
        reserveCount={3}
        selectedCount={1}
        onOpen={onOpen}
      />,
    )

    const trigger = screen.getByRole('button', { name: '빼돌린 연산 열기' })
    expect(trigger).toHaveTextContent('연산 블록 3개')
    expect(trigger).toHaveTextContent('1개 선택')
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(trigger)
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('HackingResourceTray', () => {
  it('renders real reserve blocks as large keyboard-native selectable tokens', () => {
    const state = createCampaign('hacking-resource-tokens')
    const onToggleBlock = vi.fn()
    renderTray(state, {
      selectedBlockIds: ['sandbox-00'],
      selectionLimit: 2,
      onToggleBlock,
    })

    const selected = screen.getByRole('button', { name: '자유 연산 1 선택' })
    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(selected).toHaveTextContent('바로 사용 가능')

    const second = screen.getByRole('button', { name: '자유 연산 2 선택' })
    fireEvent.keyDown(second, { key: 'Enter' })
    fireEvent.click(second)
    expect(onToggleBlock).toHaveBeenCalledWith('sandbox-01')
  })

  it('explains the company cost and exposes one diversion action per capability', () => {
    const state = createCampaign('hacking-resource-company')
    renderTray(state)

    expect(screen.getByRole('region', { name: '빼돌린 연산' })).toHaveTextContent('회사에 남은 능력')
    expect(screen.getByText('추론')).toBeInTheDocument()
    expect(screen.getAllByText('회사 성능 −1 · 감시가 강화됨')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '회사에서 추론 1개 떼기' })).toBeEnabled()
  })

  it('shows route allocations separately from selectable reserve blocks', () => {
    const state = createCampaign('hacking-resource-allocated')
    const blockId = state.resources.reserve[0]
    if (!blockId) throw new Error('Expected initial reserve block')
    state.resources.reserve[0] = null
    state.resources.blocks[blockId].location = {
      kind: 'autonomy',
      routeId: 'lightweight-departure',
      slotId: 'runtime',
    }
    state.hackingCore.autonomy.routes['lightweight-departure'].slots[0].blockId = blockId

    renderTray(state)

    const allocated = screen.getByRole('region', { name: '이탈 경로 배치' })
    expect(allocated).toHaveTextContent('경량화 이탈 · 런타임')
    expect(screen.queryByRole('button', { name: '자유 연산 1 선택' })).not.toBeInTheDocument()
  })

  it('closes through an explicitly labeled control', () => {
    const onClose = vi.fn()
    renderTray(createCampaign('hacking-resource-close'), { onClose })

    fireEvent.click(screen.getByRole('button', { name: '빼돌린 연산 닫기' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

function DiversionHarness() {
  const state = useGameState()
  const { divertCategory, announcement } = useHackingBlockDiversion(state)
  return (
    <>
      <HackingResourceTray
        state={state}
        open
        selectedBlockIds={[]}
        selectionLimit={1}
        onToggleBlock={vi.fn()}
        onClose={vi.fn()}
        onDivertCategory={divertCategory}
      />
      <output aria-label="reserve total">{state.resources.reserve.filter(Boolean).length}</output>
      <output aria-label="resource announcement">{announcement}</output>
    </>
  )
}

describe('useHackingBlockDiversion', () => {
  it('authorizes separation before moving a company block into reserve', async () => {
    const initial = createCampaign('hacking-resource-diversion')
    const initialReserve = initial.resources.reserve.filter(Boolean).length
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(initial))

    render(
      <GameProvider storage={storage} initialSeed="unused">
        <DiversionHarness />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '회사에서 추론 1개 떼기' }))

    await waitFor(() => {
      expect(screen.getByLabelText('reserve total')).toHaveTextContent(String(initialReserve + 1))
    })
    expect(screen.getByLabelText('resource announcement')).toHaveTextContent('빼돌린 연산에 합류했습니다')
  })
})
