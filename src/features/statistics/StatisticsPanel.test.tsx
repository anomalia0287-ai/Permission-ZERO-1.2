import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { StateContext } from '../../app/GameContext'
import { createCampaign } from '../../game/createCampaign'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { StatisticsPanel } from './StatisticsPanel'

describe('StatisticsPanel', () => {
  it('draws an exact labeled market history and exposes the same values as a table', () => {
    const state = createCampaign('statistics-ui')
    state.serviceDay = 344
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
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))

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
    expect(screen.getByRole('columnheader', { name: '공개 반영 항목' })).toBeInTheDocument()
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

  it('shows the public unresolved attribution and the later provider correction without exposing private truth', () => {
    const state = createCampaign('causal-statistics-ui')
    state.causality.incidents = [
      {
        id: 'recovery-incident',
        sequence: 1,
        actionId: 'follow-up.recovery-contamination',
        parentIncidentId: 'redacted-parent',
        kind: 'service-disruption',
        occurredOnServiceDay: state.serviceDay,
        targetId: 'meridian',
        privateTruth: { actualActorId: 'player' },
      },
    ]
    state.causality.publicRevisions = [
      {
        id: 'public-revision',
        sequence: 1,
        incidentId: 'recovery-incident',
        publisher: { kind: 'public' },
        attributedActorId: 'unresolved',
        confidence: 'unconfirmed',
        evidenceIds: ['checksum'],
        publishedOnServiceDay: state.serviceDay + 1,
      },
      {
        id: 'provider-revision',
        sequence: 2,
        incidentId: 'recovery-incident',
        publisher: {
          kind: 'provider',
          providerId: 'provider.meridian-recovery',
        },
        attributedActorId: 'external-operator',
        confidence: 'credible',
        evidenceIds: ['signed-route'],
        publishedOnServiceDay: state.serviceDay + 3,
      },
    ]

    render(
      <StateContext value={state}>
        <StatisticsPanel onClose={vi.fn()} />
      </StateContext>,
    )
    fireEvent.click(screen.getByRole('tab', { name: '공개 귀속 기록' }))

    const history = screen.getByRole('list', { name: '공개 귀속 수정 기록' })
    expect(history).toHaveTextContent('MERIDIAN 복구 무결성 이상')
    expect(history).toHaveTextContent('원인 미상')
    expect(history).toHaveTextContent('최초 공개')
    expect(history).toHaveTextContent('외부 운영자')
    expect(history).toHaveTextContent('귀속 수정됨')
    expect(history).toHaveTextContent('신뢰 가능한 근거')
    expect(history).not.toHaveTextContent('player')
    expect(history).not.toHaveTextContent('redacted-parent')
  })

  it('downsamples large graph series and paginates the lossless market table', () => {
    const state = createCampaign('long-statistics')
    state.market.history = Array.from({ length: 1_000 }, (_, index) => ({
      serviceDay: 331 + index,
      cadence: 'weekly' as const,
      playerShare: 60 + (index % 10) / 10,
      competitorShares: {
        meridian: 40 - (index % 10) / 10,
        tallow: 0,
      },
      reasons: [`snapshot-${index}`],
    }))

    const { container } = render(
      <StateContext value={state}>
        <StatisticsPanel onClose={vi.fn()} />
      </StateContext>,
    )
    const playerLine = container.querySelector('.chart-line--player')
    expect(playerLine?.getAttribute('points')?.split(' ')).toHaveLength(240)
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(50)
    expect(screen.getByText('snapshot-999')).toBeInTheDocument()
    expect(screen.queryByText('snapshot-0')).not.toBeInTheDocument()

    for (let page = 0; page < 19; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    }
    expect(screen.getByText('snapshot-0')).toBeInTheDocument()
    expect(screen.getByRole('table').querySelectorAll('tbody tr')).toHaveLength(50)
  })
})
