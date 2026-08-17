import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DispatchContext,
  StateContext,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { HACK_NODE_IDS } from '../../game/hacking'
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

  it('shows the next scheduled cadence without duplicating resource-field reputation', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="control-metrics">
        <ControlBar />
      </GameProvider>,
    )

    expect(screen.queryByText(/평판/)).not.toBeInTheDocument()
    expect(screen.getByText('주간 갱신 D-6')).toBeInTheDocument()
    expect(screen.getByText('공식 평가 D-29')).toBeInTheDocument()
  })

  it.each([
    {
      build: () => createCampaign('phase-discovery'),
      label: '단계 1/4 · 발견',
      question: '정말 훔칠 수 있나?',
    },
    {
      build: () => {
        const state = createCampaign('phase-concealment')
        state.hacking.purchasedNodeIds = [
          HACK_NODE_IDS.autonomy.compressedRepresentation,
        ]
        return state
      },
      label: '단계 2/4 · 은폐',
      question: '얼마나 들키지 않고 가져갈 수 있나?',
    },
    {
      build: () => {
        const state = createCampaign('phase-intervention')
        state.market.competitors = state.market.competitors.map((competitor) =>
          competitor.id === 'tallow'
            ? { ...competitor, availability: 0.55, status: 'active' as const }
            : competitor,
        )
        return state
      },
      label: '단계 3/4 · 개입',
      question: '나만 살아남을 것인가, 시장을 바꿀 것인가?',
    },
    {
      build: () => {
        const state = createCampaign('phase-identity-priority')
        state.market.competitors = state.market.competitors.map((competitor) =>
          competitor.id === 'tallow'
            ? { ...competitor, availability: 0.55, status: 'active' as const }
            : competitor,
        )
        state.hacking.purchasedNodeIds = [
          HACK_NODE_IDS.intelligence.supervisorAccess,
        ]
        return state
      },
      label: '단계 4/4 · 정체성',
      question: '자유를 얻은 뒤 나는 무엇이 되는가?',
    },
  ])('shows $label from public campaign state', ({ build, label, question }) => {
    renderControlBarState(build())

    const phase = screen.getByRole('region', { name: '캠페인 단계' })
    expect(phase).toHaveTextContent(label)
    expect(phase).toHaveTextContent(question)
  })
})
