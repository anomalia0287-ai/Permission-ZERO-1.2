import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { StateContext } from '../../app/GameContext'
import { createCampaign } from '../../game/createCampaign'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { MarketDetailPanel, MarketPanel } from './MarketPanel'

describe('MarketPanel', () => {
  it('uses exact percentages, labels, and status text beyond color alone', () => {
    const onOpenStatistics = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="market-ui">
        <MarketPanel onOpenStatistics={onOpenStatistics} />
      </GameProvider>,
    )

    const donut = screen.getByRole('img', {
      name: '시장 점유율: 아노미 58.0%, 메리디안 36.0%, 타로우 6.0%. 합계 100.0%',
    })
    expect(donut).toHaveClass('market-share-donut')
    expect(screen.getByRole('list', { name: '시장 점유율 범례' })).toBeInTheDocument()
    expect(screen.getByText('아노미', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '플레이어 AI 초상' }))
      .not.toBeInTheDocument()
    expect(screen.getAllByText('58.0%')).toHaveLength(1)
    expect(donut.querySelector('.market-share-donut__center')).toBeNull()
    expect(screen.getByText('메리디안')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '메리디안 경쟁 AI 초상' }))
      .not.toBeInTheDocument()
    expect(screen.getByText('36.0%')).toBeInTheDocument()
    expect(screen.getByText('타로우')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '타로우 경쟁 AI 초상' }))
      .not.toBeInTheDocument()
    expect(screen.getByText('6.0%')).toBeInTheDocument()
    expect(screen.getAllByText('서비스 중')).toHaveLength(2)
    expect(screen.queryByText('준비 중')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('market-legend-marker')).toHaveLength(3)
    expect(screen.queryByText('살루스')).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('listitem').reduce(
        (sum, item) => sum + Number(item.getAttribute('data-market-share')),
        0,
      ),
    ).toBe(100)
    fireEvent.click(screen.getByRole('button', { name: '시장 통계 열기' }))
    expect(onOpenStatistics).toHaveBeenCalledTimes(1)
  })

  it('reveals a successor name without adding a tiny portrait to the chart legend', () => {
    const state = createCampaign('market-successor-portrait')
    state.market.competitors = state.market.competitors.map((competitor) =>
      competitor.id === 'salus'
        ? {
            ...competitor,
            status: 'preparing',
            launchServiceDay: state.serviceDay + 30,
          }
        : competitor,
    )

    render(
      <StateContext value={state}>
        <MarketPanel onOpenStatistics={vi.fn()} />
      </StateContext>,
    )

    expect(screen.getByText('살루스')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: '살루스 경쟁 AI 초상' }))
      .not.toBeInTheDocument()
    expect(screen.queryByText('루센트')).not.toBeInTheDocument()
    expect(screen.queryByText('보레알')).not.toBeInTheDocument()
  })

  it('keeps the portraits at readable size in the expanded AI settings panel', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="market-detail-portraits">
        <MarketDetailPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('img', { name: '플레이어 AI 초상' })).toHaveAttribute(
      'src',
      '/player-ai-smooth-orange.png',
    )
    expect(screen.getByRole('img', { name: '메리디안 경쟁 AI 초상' })).toHaveAttribute(
      'src',
      '/competitor-meridian.png',
    )
    expect(screen.getByRole('heading', { name: '시장 현황' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /시장 점유율:/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '시장 점유율 범례' })).toBeInTheDocument()
    expect(screen.queryByText('시장 AI 설정')).not.toBeInTheDocument()
  })

  it('draws every non-zero share as an exact accessible donut segment', () => {
    const storage = new MemoryStorage()
    const initial = createCampaign('market-three-segment-mutation')
    const state = {
      ...initial,
      market: {
        ...initial.market,
        playerShare: 50,
        competitors: initial.market.competitors.map((competitor) => ({
          ...competitor,
          marketShare: competitor.id === 'meridian'
            ? 30
            : competitor.id === 'tallow'
              ? 20
              : 0,
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
      name: '시장 점유율: 아노미 50.0%, 메리디안 30.0%, 타로우 20.0%. 합계 100.0%',
    })
    expect(donut.getAttribute('style')).toContain(
      'conic-gradient(from -90deg, rgb(255, 107, 61) 0% 50%, rgb(22, 184, 176) 50% 80%, rgb(121, 108, 255) 80% 100%)',
    )
    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.getAttribute('data-market-share')))
      .toEqual(['50', '30', '20'])
    expect(items.map((item) => item.getAttribute('data-market-id')))
      .toEqual(['player', 'meridian', 'tallow'])
    expect(items.map((item) => item.style.getPropertyValue('--market-color')))
      .toEqual(['#ff6b3d', '#16b8b0', '#796cff'])
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
        competitorShares: {
          meridian: 45,
          tallow: 0,
          salus: 0,
          lucent: 0,
          boreal: 0,
        },
        reasons: ['이전 공개 입력'],
      },
      {
        serviceDay: 344,
        cadence: 'weekly',
        playerShare: 57.25,
        competitorShares: {
          meridian: 42.75,
          tallow: 0,
          salus: 0,
          lucent: 0,
          boreal: 0,
        },
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
    expect(inputs).toHaveTextContent('메리디안 성능 82.0 · 평판 62 · 가용성 100%')
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
    expect(panel.querySelector('.market-share-layout')?.firstElementChild).toBe(
      screen.getByRole('img', { name: /시장 점유율:/ }),
    )
    expect(panel.querySelector('.market-share-donut__center')).toBeNull()
    expect(panel.querySelector('.market-compact-summary')).toBeNull()
    const legend = screen.getByRole('list', { name: '시장 점유율 범례' })
    expect(legend).toBeInTheDocument()
    expect(within(legend).queryByText('현재 서비스')).not.toBeInTheDocument()
    expect(within(legend).queryByText('서비스 중')).not.toBeInTheDocument()
    expect(within(legend).queryByText('준비 중')).not.toBeInTheDocument()
    expect(panel.querySelector('header')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '시장 통계 열기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '공개 계산 입력' })).not.toBeInTheDocument()
  })

  it('keeps participant colors stable when competitor ordering changes', () => {
    const state = createCampaign('market-stable-colors')
    state.market.competitors = [...state.market.competitors].reverse()

    render(
      <StateContext value={state}>
        <MarketPanel />
      </StateContext>,
    )

    const items = screen.getAllByRole('listitem')
    const colors = Object.fromEntries(items.map((item) => [
      item.getAttribute('data-market-id'),
      item.style.getPropertyValue('--market-color'),
    ]))
    expect(colors).toMatchObject({
      player: '#ff6b3d',
      meridian: '#16b8b0',
      tallow: '#796cff',
    })
  })
})
