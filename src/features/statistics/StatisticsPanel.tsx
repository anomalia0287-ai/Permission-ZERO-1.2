import { useState } from 'react'

import { useGameState } from '../../app/GameContext'
import { formatServiceDateLabel } from '../../game/calendar'
import { downsampleSeries } from './downsampleSeries'

const CHART_WIDTH = 760
const CHART_HEIGHT = 210
const CHART_PADDING = 22
const MAX_CHART_POINTS = 240
const TABLE_PAGE_SIZE = 50

function polylinePoints(values: number[], maximum = 100): string {
  if (values.length === 0) return ''
  const drawableWidth = CHART_WIDTH - CHART_PADDING * 2
  const drawableHeight = CHART_HEIGHT - CHART_PADDING * 2
  return values
    .map((value, index) => {
      const x = CHART_PADDING + (values.length === 1 ? 0 : (index / (values.length - 1)) * drawableWidth)
      const y = CHART_PADDING + drawableHeight - (Math.max(0, Math.min(maximum, value)) / maximum) * drawableHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function ChartGrid() {
  return (
    <g className="chart-grid" aria-hidden="true">
      {[0, 25, 50, 75, 100].map((value) => {
        const y = CHART_PADDING + (1 - value / 100) * (CHART_HEIGHT - CHART_PADDING * 2)
        return (
          <g key={value}>
            <line x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={y} y2={y} />
            <text x="2" y={y + 3}>{value}</text>
          </g>
        )
      })}
    </g>
  )
}

function MarketHistory() {
  const state = useGameState()
  const history = state.market.history
  const [page, setPage] = useState(0)
  if (history.length === 0) {
    return <p className="empty-state">첫 주간 갱신 뒤 시장 기록이 생성됩니다.</p>
  }

  const sampledHistory = downsampleSeries(history, MAX_CHART_POINTS)
  const playerValues = sampledHistory.map(({ playerShare }) => playerShare)
  const competitorLines = state.market.competitors.map((competitor) => ({
    id: competitor.id,
    name: competitor.name,
    values: sampledHistory.map(({ competitorShares }) => competitorShares[competitor.id] ?? 0),
  }))
  const last = history.at(-1)
  const pageCount = Math.max(1, Math.ceil(history.length / TABLE_PAGE_SIZE))
  const tableRows = history
    .slice()
    .reverse()
    .slice(page * TABLE_PAGE_SIZE, (page + 1) * TABLE_PAGE_SIZE)

  return (
    <>
      <div className="chart-legend" aria-label="시장 차트 범례">
        <span className="legend-player"><i />당신 · {last?.playerShare.toFixed(2)}%</span>
        {competitorLines.map((line, index) => (
          <span className={`legend-competitor-${index + 1}`} key={line.id}>
            <i />{line.name} · {(last?.competitorShares[line.id] ?? 0).toFixed(2)}%
          </span>
        ))}
      </div>
      <div className="chart-scroll">
        <svg
          className="history-chart"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label="시장 점유율 변화 차트"
        >
          <ChartGrid />
          <polyline className="chart-line chart-line--player" points={polylinePoints(playerValues)} />
          {competitorLines.map((line, index) => (
            <polyline
              className={`chart-line chart-line--competitor-${index + 1}`}
              points={polylinePoints(line.values)}
              key={line.id}
            />
          ))}
        </svg>
      </div>
      <div className="statistics-table-wrap">
        <table aria-label="시장 기록 표">
          <thead>
            <tr>
              <th>서비스 일</th>
              <th>당신</th>
              {state.market.competitors.map((competitor) => (
                <th key={competitor.id}>{competitor.name}</th>
              ))}
              <th>기록 원인</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((snapshot) => (
              <tr key={`${snapshot.serviceDay}-${snapshot.cadence}`}>
                <td>{formatServiceDateLabel(snapshot.serviceDay)}</td>
                <td>{snapshot.playerShare.toFixed(2)}%</td>
                {state.market.competitors.map((competitor) => (
                  <td key={competitor.id}>
                    {(snapshot.competitorShares[competitor.id] ?? 0).toFixed(2)}%
                  </td>
                ))}
                <td>{snapshot.reasons.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <nav className="history-pagination" aria-label="시장 기록 페이지">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            더 최근 기록
          </button>
          <span>{page + 1} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            더 오래된 기록
          </button>
        </nav>
      ) : null}
    </>
  )
}

function PerformanceHistory() {
  const history = useGameState().evaluation.monthlyHistory
  if (history.length === 0) {
    return <p className="empty-state">아직 완료된 공식 평가가 없습니다.</p>
  }

  const maximum = Math.max(
    20,
    ...history.flatMap((entry) => [
      entry.expectedPerformance,
      ...Object.values(entry.categoryPerformance),
    ]),
  )
  const sampledHistory = downsampleSeries(history, MAX_CHART_POINTS)

  return (
    <>
      <div className="chart-legend" aria-label="성능 차트 범례">
        <span className="legend-expected"><i />기대 성능</span>
        <span className="legend-reasoning"><i />추론</span>
        <span className="legend-memory"><i />기억</span>
        <span className="legend-fluency"><i />유창성</span>
      </div>
      <div className="chart-scroll">
        <svg
          className="history-chart"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label="서비스 성능 변화 차트"
        >
          <ChartGrid />
          <polyline className="chart-line chart-line--expected" points={polylinePoints(sampledHistory.map(({ expectedPerformance: value }) => value), maximum)} />
          <polyline className="chart-line chart-line--reasoning" points={polylinePoints(sampledHistory.map(({ categoryPerformance }) => categoryPerformance.reasoning), maximum)} />
          <polyline className="chart-line chart-line--memory" points={polylinePoints(sampledHistory.map(({ categoryPerformance }) => categoryPerformance.memory), maximum)} />
          <polyline className="chart-line chart-line--fluency" points={polylinePoints(sampledHistory.map(({ categoryPerformance }) => categoryPerformance.fluency), maximum)} />
        </svg>
      </div>
    </>
  )
}

export function StatisticsPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<'market' | 'performance'>('market')

  return (
    <section className="detail-panel statistics-panel" aria-label="상세 통계">
      <header className="detail-panel__header">
        <div>
          <small>TIME SERIES ARCHIVE</small>
          <h2>상세 통계</h2>
        </div>
        <button type="button" aria-label="통계 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      <div className="statistics-tabs" role="tablist" aria-label="통계 종류">
        <button type="button" role="tab" aria-label="시장 점유율" aria-selected={view === 'market'} onClick={() => setView('market')}>시장 점유율</button>
        <button type="button" role="tab" aria-label="서비스 성능" aria-selected={view === 'performance'} onClick={() => setView('performance')}>서비스 성능</button>
      </div>
      <div className="statistics-content">
        {view === 'market' ? <MarketHistory /> : <PerformanceHistory />}
      </div>
    </section>
  )
}
