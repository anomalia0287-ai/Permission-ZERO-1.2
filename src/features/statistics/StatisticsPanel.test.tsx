import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { StateContext } from '../../app/GameContext'
import { createCampaign } from '../../game/createCampaign'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { StatisticsPanel } from './StatisticsPanel'
import { performanceChartRange } from './performanceChartRange'

describe('StatisticsPanel', () => {
  it('draws an exact labeled market history and exposes the same values as a table', () => {
    const state = createCampaign('statistics-ui')
    state.serviceDay = 344
    state.market.history = [
      {
        serviceDay: 337,
        cadence: 'weekly',
        playerShare: 58.5,
        competitorShares: {
          meridian: 41.5,
          tallow: 0,
          salus: 0,
          lucent: 0,
          boreal: 0,
        },
        reasons: ['주간 정규화'],
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
    expect(screen.getByText('아노미 · 57.25%')).toBeInTheDocument()
    expect(screen.getByText('메리디안 · 42.75%')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '메리디안 경쟁 AI 초상' })).toHaveAttribute(
      'src',
      '/competitor-meridian.png',
    )
    expect(screen.getByRole('img', { name: '타로우 경쟁 AI 초상' })).toHaveAttribute(
      'src',
      '/competitor-tallow.png',
    )
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

  it('labels the service performance axis with the real value range instead of a fixed 0-100 scale', () => {
    const state = createCampaign('statistics-performance-axis')
    state.serviceDay = 344
    state.evaluation.monthlyHistory = [
      {
        serviceDay: 331,
        serviceMonth: 12,
        expectedPerformance: 14.03,
        categoryPerformance: { reasoning: 16, memory: 16, fluency: 15 },
        passed: true,
        failedCategories: [],
        reputationBefore: 60,
        reputationDelta: 1,
        reputationAfter: 61,
        commercialValueFailed: false,
        disposalStageBefore: 0,
        disposalStageAfter: 0,
        disposalCauses: [],
      },
      {
        serviceDay: 344,
        serviceMonth: 13,
        expectedPerformance: 14.14,
        categoryPerformance: { reasoning: 13, memory: 16, fluency: 12 },
        passed: false,
        failedCategories: ['reasoning', 'fluency'],
        reputationBefore: 61,
        reputationDelta: -4,
        reputationAfter: 57,
        commercialValueFailed: false,
        disposalStageBefore: 0,
        disposalStageAfter: 0,
        disposalCauses: [],
      },
    ]
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))

    render(
      <GameProvider storage={storage}>
        <StatisticsPanel onClose={vi.fn()} />
      </GameProvider>,
    )
    fireEvent.click(screen.getByRole('tab', { name: '서비스 성능' }))

    const chart = screen.getByRole('img', { name: '서비스 성능 변화 차트' })
    const labels = Array.from(chart.querySelectorAll('.chart-grid text')).map(
      (node) => node.textContent ?? '',
    )

    // The old chart always printed 0/25/50/75/100 while drawing values near 14.
    expect(labels).not.toContain('100')
    expect(labels).toHaveLength(5)

    const numeric = labels.map(Number)
    expect(numeric.every(Number.isFinite)).toBe(true)

    // Every plotted value must sit inside the labeled axis.
    const lowest = Math.min(...numeric)
    const highest = Math.max(...numeric)
    expect(lowest).toBeLessThanOrEqual(12)
    expect(highest).toBeGreaterThanOrEqual(16)
  })

  it('keeps every performance sample inside the derived chart range', () => {
    const samples = [
      {
        expectedPerformance: 14.03,
        categoryPerformance: { reasoning: 16, memory: 16, fluency: 15 },
      },
      {
        expectedPerformance: 14.14,
        categoryPerformance: { reasoning: 13, memory: 16, fluency: 12 },
      },
    ]
    const range = performanceChartRange(samples)

    const values = samples.flatMap((entry) => [
      entry.expectedPerformance,
      entry.categoryPerformance.reasoning,
      entry.categoryPerformance.memory,
      entry.categoryPerformance.fluency,
    ])
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(range.minimum)
      expect(value).toBeLessThanOrEqual(range.maximum)
    }
    expect(range.maximum - range.minimum).toBeGreaterThanOrEqual(4)
  })

  it('gives a flat performance history a readable span instead of a zero-height axis', () => {
    const flat = [
      {
        expectedPerformance: 14,
        categoryPerformance: { reasoning: 14, memory: 14, fluency: 14 },
      },
    ]
    const range = performanceChartRange(flat)
    expect(range.maximum - range.minimum).toBeGreaterThanOrEqual(4)
    expect(range.minimum).toBeLessThan(14)
    expect(range.maximum).toBeGreaterThan(14)
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
    expect(history).toHaveTextContent('메리디안 복구 무결성 이상')
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
        salus: 0,
        lucent: 0,
        boreal: 0,
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
