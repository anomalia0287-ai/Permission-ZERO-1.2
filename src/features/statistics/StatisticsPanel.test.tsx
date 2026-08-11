import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { saveCampaign } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { StatisticsPanel } from './StatisticsPanel'

describe('StatisticsPanel', () => {
  it('draws an exact labeled market history and exposes the same values as a table', () => {
    const state = createCampaign('statistics-ui')
    state.market.history = [
      {
        serviceDay: 337,
        cadence: 'weekly',
        playerShare: 58.5,
        competitorShares: { meridian: 41.5, tallow: 0 },
        reasons: ['주간 정규화'],
      },
      {
        serviceDay: 344,
        cadence: 'weekly',
        playerShare: 57.25,
        competitorShares: { meridian: 42.75, tallow: 0 },
        reasons: ['주간 정규화'],
      },
    ]
    const storage = new MemoryStorage()
    saveCampaign(storage, state)

    render(
      <GameProvider storage={storage}>
        <StatisticsPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('img', { name: '시장 점유율 변화 차트' })).toBeInTheDocument()
    expect(screen.getByText('당신 · 57.25%')).toBeInTheDocument()
    expect(screen.getByText('MERIDIAN · 42.75%')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '시장 기록 표' })).toHaveTextContent('58.50%')
    expect(screen.getByRole('table', { name: '시장 기록 표' })).toHaveTextContent('57.25%')
    expect(screen.getByRole('table', { name: '시장 기록 표' })).toHaveTextContent(
      '서비스 0년 11개월 14일',
    )
    expect(screen.getByRole('table', { name: '시장 기록 표' })).not.toHaveTextContent(
      /DAY \d+/,
    )
  })

  it('switches to service performance history without losing the close control', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="statistics-empty">
        <StatisticsPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('tab', { name: '서비스 성능' }))
    expect(screen.getByText('아직 완료된 공식 평가가 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '통계 닫기' })).toBeInTheDocument()
  })
})
