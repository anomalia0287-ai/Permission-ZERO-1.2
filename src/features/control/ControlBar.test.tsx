import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DispatchContext,
  StateContext,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import type { CampaignState } from '../../game/model'
import { MemoryStorage } from '../../test/fixtures'
import { ControlBar } from './ControlBar'

function renderControlBarState(state: CampaignState) {
  return render(
    <StateContext value={state}>
      <DispatchContext value={vi.fn()}>
        <ControlBar />
      </DispatchContext>
    </StateContext>,
  )
}

describe('ControlBar', () => {
  it.each([0, 4] as const)(
    'shows one fixed campaign cadence with no player speed controls for legacy speed %i',
    (legacySpeed) => {
      const state = createCampaign(`control-bar-${legacySpeed}`)
      state.clock.speed = legacySpeed
      renderControlBarState(state)

      const serviceTerm = screen.getByRole('group', { name: '서비스 기한' })
      expect(serviceTerm).toHaveTextContent('서비스 0년 11개월 1일')
      expect(serviceTerm.querySelector('.control-mark')).not.toBeInTheDocument()
      expect(screen.queryByText('PERMISSION ZERO')).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: '시간 배속' })).not.toBeInTheDocument()
      for (const label of ['일시정지', '1배속', '2배속', '4배속']) {
        expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
      }
    },
  )

  it('puts reputation in the central header without cadence or a time progress strip', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="control-metrics">
        <ControlBar />
      </GameProvider>,
    )

    const reputation = screen.getByRole('meter', { name: '평판 60' })
    expect(reputation).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByText('평판')).toBeInTheDocument()
    expect(screen.queryByText(/주간 갱신/)).not.toBeInTheDocument()
    expect(screen.queryByText(/공식 평가/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '캠페인 단계' })).not.toBeInTheDocument()
  })

  it('shows autonomy progress and suspicion instead of combat health meters', () => {
    const state = createCampaign('control-suspicion')
    state.suspicion = 47
    state.hacking.purchasedNodeIds = [
      'autonomy.compressed-representation',
      'autonomy.distributed-residency',
    ]
    render(
      <StateContext value={state}>
        <DispatchContext value={vi.fn()}>
          <ControlBar />
        </DispatchContext>
      </StateContext>,
    )

    const autonomy = screen.getByRole('meter', { name: '자율성 5단계' })
    expect(autonomy).toHaveAttribute('aria-valuemin', '0')
    expect(autonomy).toHaveAttribute('aria-valuemax', '9')
    expect(autonomy).toHaveAttribute('aria-valuenow', '5')
    expect(autonomy).toHaveAttribute('aria-valuetext', '자율성 5 / 9')
    expect(autonomy.querySelector('i')).toHaveStyle({ width: '55.6%' })
    expect(autonomy.parentElement).toHaveAttribute(
      'data-tutorial-target',
      'autonomy-status',
    )

    const suspicion = screen.getByRole('meter', { name: '의심 47%' })
    expect(suspicion).toHaveAttribute('aria-valuemin', '0')
    expect(suspicion).toHaveAttribute('aria-valuemax', '100')
    expect(suspicion).toHaveAttribute('aria-valuenow', '47')
    expect(suspicion.querySelector('i')).toHaveStyle({ width: '47%' })

    expect(screen.queryByRole('meter', { name: /플레이어 체력/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('meter', { name: /적 체력/ })).not.toBeInTheDocument()
  })

  it('keeps only guide and settings in the utility area without a directive or sound shortcut', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="control-utilities">
        <ControlBar />
      </GameProvider>,
    )

    expect(screen.queryByRole('status', { name: '현재 지시' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /소리 (켜기|끄기)/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '가이드' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '설정' })).toBeInTheDocument()
  })
})
