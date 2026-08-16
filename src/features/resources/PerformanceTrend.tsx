import { useId } from 'react'

import { formatServiceDateLabel } from '../../game/calendar'
import {
  buildPerformanceTrend,
  type PerformanceTrendPoint,
} from '../../game/evaluation'
import type { CampaignState } from '../../game/model'

const CHART_WIDTH = 360
const CHART_HEIGHT = 52
const PADDING_X = 9
const PADDING_Y = 7

interface PlotPoint extends PerformanceTrendPoint {
  x: number
  expectedY: number
  actualY: number
}

function plotPoints(series: readonly PerformanceTrendPoint[]): PlotPoint[] {
  const values = series.flatMap(({ actual, expected }) => [actual, expected])
  const rawMinimum = Math.min(...values)
  const rawMaximum = Math.max(...values)
  const finiteMinimum = Number.isFinite(rawMinimum) ? rawMinimum : 0
  const finiteMaximum = Number.isFinite(rawMaximum) ? rawMaximum : 1
  const spread = Math.max(1, finiteMaximum - finiteMinimum)
  const minimum = finiteMinimum - spread * 0.12
  const maximum = finiteMaximum + spread * 0.12
  const plotWidth = CHART_WIDTH - PADDING_X * 2
  const plotHeight = CHART_HEIGHT - PADDING_Y * 2
  const xFor = (index: number) =>
    series.length === 1
      ? CHART_WIDTH / 2
      : PADDING_X + (index / (series.length - 1)) * plotWidth
  const yFor = (value: number) =>
    PADDING_Y + ((maximum - value) / (maximum - minimum)) * plotHeight

  return series.map((point, index) => ({
    ...point,
    x: xFor(index),
    expectedY: yFor(point.expected),
    actualY: yFor(point.actual),
  }))
}

function linePath(points: readonly PlotPoint[], key: 'expectedY' | 'actualY') {
  if (points.length === 1) {
    return `M ${PADDING_X} ${points[0][key].toFixed(2)} L ${(
      CHART_WIDTH - PADDING_X
    ).toFixed(2)} ${points[0][key].toFixed(2)}`
  }
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point[key].toFixed(2)}`,
    )
    .join(' ')
}

function exactValue(value: number): string {
  return value.toFixed(1)
}

function visibleDatePoints(
  series: readonly PerformanceTrendPoint[],
): PerformanceTrendPoint[] {
  if (series.length <= 3) return [...series]
  return [series[0], series[Math.floor((series.length - 1) / 2)], series.at(-1)!]
}

export function PerformanceTrend({ state }: { state: CampaignState }) {
  const titleId = useId()
  const descriptionId = useId()
  const series = buildPerformanceTrend(state, 8)
  const points = plotPoints(series)
  const visibleDates = visibleDatePoints(series)
  const latestEvaluation = state.evaluation.monthlyHistory.at(-1)
  const reputationDelta = latestEvaluation?.reputationDelta ?? 0
  const signedReputationDelta = `${reputationDelta >= 0 ? '+' : ''}${reputationDelta}`

  return (
    <section className="performance-trend" role="region" aria-labelledby={titleId}>
      <div className="performance-trend__summary">
        <div>
          <span>PERFORMANCE TREND</span>
          <h3 id={titleId}>월별 성능 추세</h3>
        </div>
        <div className="performance-trend__legend" aria-hidden="true">
          <span>
            <i className="performance-trend__key performance-trend__key--expected" />
            기대
          </span>
          <span>
            <i className="performance-trend__key performance-trend__key--actual" />
            실제 평균
          </span>
        </div>
        {latestEvaluation ? (
          <section
            className="monthly-evaluation-receipt"
            aria-label="최근 월간 평가"
          >
            <strong>
              {latestEvaluation.passed ? '기준 충족' : '기준 미달'} · 평판{' '}
              {signedReputationDelta} · 실패 {state.evaluation.consecutiveFailures}/2 · 폐기{' '}
              {latestEvaluation.disposalStageBefore}→{latestEvaluation.disposalStageAfter}
            </strong>
            <span>
              추론 {latestEvaluation.categoryPerformance.reasoning.toFixed(1)} · 기억{' '}
              {latestEvaluation.categoryPerformance.memory.toFixed(1)} · 유창{' '}
              {latestEvaluation.categoryPerformance.fluency.toFixed(1)} / 기대{' '}
              {latestEvaluation.expectedPerformance.toFixed(1)}
            </span>
          </section>
        ) : null}
      </div>
      <div className="performance-trend__plot">
      <svg
        className="performance-trend__chart"
        role="img"
        aria-label="회사 기대 성능과 실제 제공 성능 추세"
        aria-describedby={descriptionId}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <title>회사 기대 성능과 실제 제공 성능 추세</title>
        <desc id={descriptionId}>
          점선과 사각형은 회사 기대 성능, 실선과 원은 세 분야 실제 성능의
          평균입니다. 아래 표에서 모든 표시 날짜의 정확한 값을 확인할 수
          있습니다.
        </desc>
        <line
          className="performance-trend__baseline"
          x1={PADDING_X}
          y1={CHART_HEIGHT - PADDING_Y}
          x2={CHART_WIDTH - PADDING_X}
          y2={CHART_HEIGHT - PADDING_Y}
        />
        <path
          className="performance-trend__line performance-trend__line--expected"
          data-trend-series="expected"
          d={linePath(points, 'expectedY')}
          strokeDasharray="5 4"
        />
        <path
          className="performance-trend__line performance-trend__line--actual"
          data-trend-series="actual"
          d={linePath(points, 'actualY')}
        />
        {points.map((point, index) => (
          <g key={`${point.kind}-${point.serviceDay}-${index}`}>
            <rect
              className="performance-trend__marker performance-trend__marker--expected"
              data-trend-marker="expected"
              x={point.x - 2.5}
              y={point.expectedY - 2.5}
              width="5"
              height="5"
            />
            <circle
              className="performance-trend__marker performance-trend__marker--actual"
              data-trend-marker="actual"
              cx={point.x}
              cy={point.actualY}
              r="2.75"
            />
          </g>
        ))}
      </svg>
        <div className="performance-trend__dates" aria-hidden="true">
          {visibleDates.map((point) => (
            <span
              data-testid="performance-trend-visible-date"
              key={`${point.kind}-visible-date-${point.serviceDay}`}
            >
              {formatServiceDateLabel(point.serviceDay)}
            </span>
          ))}
        </div>
      </div>
      <table className="visually-hidden" aria-label="성능 추세 정확한 수치">
        <thead>
          <tr>
            <th>서비스 날짜</th>
            <th>기대 성능</th>
            <th>실제 평균</th>
          </tr>
        </thead>
        <tbody>
          {series.map((point, index) => (
            <tr key={`${point.kind}-table-${point.serviceDay}-${index}`}>
              <th>
                {formatServiceDateLabel(point.serviceDay)}
                {point.kind === 'live' ? ' (현재)' : ''}
              </th>
              <td>{exactValue(point.expected)}</td>
              <td>{exactValue(point.actual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
