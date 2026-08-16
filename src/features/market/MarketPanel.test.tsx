import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { createCampaign } from '../../game/createCampaign'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { MarketPanel } from './MarketPanel'

describe('MarketPanel', () => {
  it('uses exact percentages, labels, and status text beyond color alone', () => {
    const onOpenStatistics = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="market-ui">
        <MarketPanel onOpenStatistics={onOpenStatistics} />
      </GameProvider>,
    )

    const donut = screen.getByRole('img', {
      name: '시장 점유율: 당신 60.0%, MERIDIAN 40.0%, TALLOW 0.0%. 합계 100.0%',
    })
    expect(donut).toHaveClass('market-share-donut')
    expect(screen.getByRole('list', { name: '시장 점유율 범례' })).toBeInTheDocument()
    expect(screen.getByText('당신', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getAllByText('60.0%')).toHaveLength(2)
    expect(screen.getByText('MERIDIAN')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    expect(screen.getByText('TALLOW')).toBeInTheDocument()
    expect(screen.getByText('0.0%')).toBeInTheDocument()
    expect(screen.getByText('서비스 중')).toBeInTheDocument()
    expect(screen.getByText('준비 중')).toBeInTheDocument()
    expect(screen.getAllByTestId('market-legend-marker')).toHaveLength(3)
    expect(
      screen.getAllByRole('listitem').reduce(
        (sum, item) => sum + Number(item.getAttribute('data-market-share')),
        0,
      ),
    ).toBe(100)
    fireEvent.click(screen.getByRole('button', { name: '시장 통계 열기' }))
    expect(onOpenStatistics).toHaveBeenCalledTimes(1)
  })

  it('draws every non-zero share as an exact accessible donut segment', () => {
    const storage = new MemoryStorage()
    const initial = createCampaign('market-three-segment-mutation')
    const state = {
      ...initial,
      market: {
        ...initial.market,
        playerShare: 50,
        competitors: initial.market.competitors.map((competitor, index) => ({
          ...competitor,
          marketShare: index === 0 ? 30 : 20,
        })),
      },
    }
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state, '2026-08-12T00:00:00.000Z'))

    render(
      <GameProvider storage={storage}>
        <MarketPanel onOpenStatistics={vi.fn()} />
      </GameProvider>,
    )

    const donut = screen.getByRole('img', {
      name: '시장 점유율: 당신 50.0%, MERIDIAN 30.0%, TALLOW 20.0%. 합계 100.0%',
    })
    expect(donut.getAttribute('style')).toContain(
      'conic-gradient(var(--reserve) 0% 50%, var(--company) 50% 80%, var(--prompt) 80% 100%)',
    )
    expect(
      screen.getAllByRole('listitem').map((item) => item.getAttribute('data-market-share')),
    ).toEqual(['50', '30', '20'])
    expect(screen.getByText('30.0%')).toBeInTheDocument()
    expect(screen.getByText('20.0%')).toBeInTheDocument()
  })

  it('shows the exact latest share delta and current public calculation inputs', () => {
    const state = createCampaign('market-feedback-ui')
    state.serviceDay = 344
    state.market.playerShare = 57.25
    state.market.competitors = state.market.competitors.map((competitor, index) => ({
      ...competitor,
      marketShare: index === 0 ? 42.75 : 0,
    }))
    state.market.history = [
      {
        serviceDay: 337,
        cadence: 'weekly',
        playerShare: 55,
        competitorShares: { meridian: 45, tallow: 0 },
        reasons: ['이전 공개 입력'],
      },
      {
        serviceDay: 344,
        cadence: 'weekly',
        playerShare: 57.25,
        competitorShares: { meridian: 42.75, tallow: 0 },
        reasons: ['현재 공개 입력'],
      },
    ]
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))

    render(
      <GameProvider storage={storage}>
        <MarketPanel onOpenStatistics={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByText('직전 기록 대비 +2.25%p')).toBeInTheDocument()
    const inputs = screen.getByRole('group', { name: '공개 계산 입력' })
    expect(inputs).toHaveTextContent('평균 성능 16.0 / 기대 14.0')
    expect(inputs).toHaveTextContent('평판 60')
    expect(inputs).toHaveTextContent('MERIDIAN 성능 82.0 · 평판 62 · 가용성 100%')
  })

  it('renders a compact chart for the wide shelf below the intake corner without a text action', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="market-shelf">
        <MarketPanel compact />
      </GameProvider>,
    )

    const panel = screen.getByRole('region', { name: '경쟁 AI 현황' })
    expect(panel).toHaveClass('market-watch--compact')
    expect(panel).toContainElement(screen.getByRole('img', { name: /시장 점유율:/ }))
    expect(screen.getByRole('list', { name: '시장 점유율 범례' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '시장 통계 열기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '공개 계산 입력' })).not.toBeInTheDocument()
  })
})
