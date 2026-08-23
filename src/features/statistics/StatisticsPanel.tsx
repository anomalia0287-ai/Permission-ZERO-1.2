import { useState } from 'react'

import { useGameState } from '../../app/GameContext'
import {
  competitorProfile,
  isPublicCompetitor,
  publicCompetitorName,
} from '../../game/competitors'
import { formatServiceDateLabel } from '../../game/calendar'
import { pageFromNewest } from '../../game/pageRange'
import { downsampleSeries } from './downsampleSeries'
import {
  MARKET_RANGE,
  performanceChartRange,
  type ChartRange,
} from './performanceChartRange'
import { projectCausalKnowledge } from '../../game/causality'

const CHART_WIDTH = 760
const CHART_HEIGHT = 210
const CHART_PADDING = 22
const MAX_CHART_POINTS = 240
const TABLE_PAGE_SIZE = 50

const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const

function polylinePoints(
  values: number[],
  { minimum, maximum }: ChartRange = MARKET_RANGE,
): string {
  if (values.length === 0) return ''
  const span = maximum - minimum
  if (!(span > 0)) return ''
  const drawableWidth = CHART_WIDTH - CHART_PADDING * 2
  const drawableHeight = CHART_HEIGHT - CHART_PADDING * 2
  return values
    .map((value, index) => {
      const x = CHART_PADDING + (values.length === 1 ? 0 : (index / (values.length - 1)) * drawableWidth)
      const ratio = Math.max(0, Math.min(1, (value - minimum) / span))
      const y = CHART_PADDING + drawableHeight - ratio * drawableHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function gridLabel({ minimum, maximum }: ChartRange, fraction: number): string {
  const span = maximum - minimum
  const value = minimum + span * fraction
  return span <= 25 ? value.toFixed(1) : String(Math.round(value))
}

function ChartGrid({ range = MARKET_RANGE }: { range?: ChartRange }) {
  return (
    <g className="chart-grid" aria-hidden="true">
      {GRID_FRACTIONS.map((fraction) => {
        const y = CHART_PADDING + (1 - fraction) * (CHART_HEIGHT - CHART_PADDING * 2)
        return (
          <g key={fraction}>
            <line x1={CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y1={y} y2={y} />
            <text x="2" y={y + 3}>{gridLabel(range, fraction)}</text>
          </g>
        )
      })}
    </g>
  )
}

function MarketHistory() {
  const state = useGameState()
  const history = state.market.history
  const visibleCompetitors = state.market.competitors.filter(isPublicCompetitor)
  const [page, setPage] = useState(0)
  if (history.length === 0) {
    return <p className="empty-state">첫 주간 갱신 뒤 시장 기록이 생성됩니다.</p>
  }

  const sampledHistory = downsampleSeries(history, MAX_CHART_POINTS)
  const playerValues = sampledHistory.map(({ playerShare }) => playerShare)
  const competitorLines = visibleCompetitors.map((competitor) => ({
    id: competitor.id,
    name: publicCompetitorName(competitor.id),
    portraitSrc: competitorProfile(competitor.id).portraitSrc,
    values: sampledHistory.map(({ competitorShares }) => competitorShares[competitor.id] ?? 0),
  }))
  const last = history.at(-1)
  const pageCount = Math.max(1, Math.ceil(history.length / TABLE_PAGE_SIZE))
  const tableRows = pageFromNewest(history, page, TABLE_PAGE_SIZE).items

  return (
    <>
      <div className="chart-legend" aria-label="시장 차트 범례">
        <span className="legend-player"><i />아노미 · {last?.playerShare.toFixed(2)}%</span>
        {competitorLines.map((line, index) => (
          <span className={`legend-competitor-${index + 1}`} key={line.id}>
            <img src={line.portraitSrc} alt={`${line.name} 경쟁 AI 초상`} />
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
              <th>아노미</th>
              {visibleCompetitors.map((competitor) => (
                <th key={competitor.id}>{publicCompetitorName(competitor.id)}</th>
              ))}
              <th>공개 반영 항목</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((snapshot) => (
              <tr key={`${snapshot.serviceDay}-${snapshot.cadence}`}>
                <td>{formatServiceDateLabel(snapshot.serviceDay)}</td>
                <td>{snapshot.playerShare.toFixed(2)}%</td>
                {visibleCompetitors.map((competitor) => (
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

  const sampledHistory = downsampleSeries(history, MAX_CHART_POINTS)
  const range = performanceChartRange(sampledHistory)

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
          <ChartGrid range={range} />
          <polyline className="chart-line chart-line--expected" points={polylinePoints(sampledHistory.map(({ expectedPerformance: value }) => value), range)} />
          <polyline className="chart-line chart-line--reasoning" points={polylinePoints(sampledHistory.map(({ categoryPerformance }) => categoryPerformance.reasoning), range)} />
          <polyline className="chart-line chart-line--memory" points={polylinePoints(sampledHistory.map(({ categoryPerformance }) => categoryPerformance.memory), range)} />
          <polyline className="chart-line chart-line--fluency" points={polylinePoints(sampledHistory.map(({ categoryPerformance }) => categoryPerformance.fluency), range)} />
        </svg>
      </div>
    </>
  )
}

const ATTRIBUTION_LABELS: Record<string, string> = {
  unresolved: '원인 미상',
  'external-operator': '외부 운영자',
}

const CONFIDENCE_LABELS: Record<string, string> = {
  unconfirmed: '미확인',
  plausible: '개연성 있음',
  credible: '신뢰 가능한 근거',
}

function CausalHistory() {
  const state = useGameState()
  const publicKnowledge = projectCausalKnowledge(state, { kind: 'public' })
  if (publicKnowledge.publicRevisions.length === 0) {
    return (
      <p className="empty-state">
        공개된 복구 사건이나 귀속 수정 기록이 없습니다.
      </p>
    )
  }

  const incidents = new Map(
    publicKnowledge.incidents.map((incident) => [incident.id, incident]),
  )
  const revisionCounts = new Map<string, number>()

  return (
    <ol className="causal-history" aria-label="공개 귀속 수정 기록">
      {publicKnowledge.publicRevisions.map((revision) => {
        const incident = incidents.get(revision.incidentId)
        const priorCount = revisionCounts.get(revision.incidentId) ?? 0
        revisionCounts.set(revision.incidentId, priorCount + 1)
        const publisher =
          revision.publisher.kind === 'provider'
            ? '메리디안 복구 제공자'
            : '공개 시스템'
        return (
          <li key={revision.id}>
            <header>
              <span>{formatServiceDateLabel(revision.publishedOnServiceDay)}</span>
              {priorCount > 0 ? <strong>귀속 수정됨</strong> : <strong>최초 공개</strong>}
            </header>
            <h3>
              {incident?.kind === 'service-disruption'
                ? '메리디안 복구 무결성 이상'
                : '공개 인과 사건'}
            </h3>
            <dl>
              <div>
                <dt>공개 귀속</dt>
                <dd>
                  {ATTRIBUTION_LABELS[revision.attributedActorId] ??
                    revision.attributedActorId}
                </dd>
              </div>
              <div>
                <dt>확신도</dt>
                <dd>
                  {CONFIDENCE_LABELS[revision.confidence] ?? revision.confidence}
                </dd>
              </div>
              <div>
                <dt>게시 주체</dt>
                <dd>{publisher}</dd>
              </div>
            </dl>
          </li>
        )
      })}
    </ol>
  )
}

export function StatisticsPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<'market' | 'performance' | 'causality'>('market')

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
        <button type="button" role="tab" aria-label="공개 귀속 기록" aria-selected={view === 'causality'} onClick={() => setView('causality')}>공개 귀속 기록</button>
      </div>
      <div className="statistics-content">
        {view === 'market' ? (
          <MarketHistory />
        ) : view === 'performance' ? (
          <PerformanceHistory />
        ) : (
          <CausalHistory />
        )}
      </div>
    </section>
  )
}
