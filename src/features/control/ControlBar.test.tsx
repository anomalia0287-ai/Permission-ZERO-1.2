import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { MemoryStorage } from '../../test/fixtures'
import { ControlBar } from './ControlBar'

function SpeedProbe() {
  return <output aria-label="current speed">{useGameState().clock.speed}</output>
}

describe('ControlBar', () => {
  it('shows the service date and familiar pause/speed controls', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="control-bar">
        <ControlBar />
        <SpeedProbe />
      </GameProvider>,
    )

    expect(screen.getByText('서비스 0년 11개월 1일')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '일시정지' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: '4배속' }))
    expect(screen.getByLabelText('current speed')).toHaveTextContent('4')
    expect(screen.getByRole('button', { name: '4배속' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows reputation and the next scheduled cadence in plain language', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="control-metrics">
        <ControlBar />
      </GameProvider>,
    )

    expect(screen.getByText('평판 60')).toBeInTheDocument()
    expect(screen.getByText('주간 갱신 D-6')).toBeInTheDocument()
    expect(screen.getByText('공식 평가 D-29')).toBeInTheDocument()
  })
})
