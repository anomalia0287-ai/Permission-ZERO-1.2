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
})
