export interface ChartRange {
  minimum: number
  maximum: number
}

export const MARKET_RANGE: ChartRange = { minimum: 0, maximum: 100 }

const MIN_PERFORMANCE_SPAN = 4
const PERFORMANCE_RANGE_PADDING = 1.3

export interface PerformanceSample {
  expectedPerformance: number
  categoryPerformance: { reasoning: number; memory: number; fluency: number }
}

export function performanceChartRange(
  samples: readonly PerformanceSample[],
): ChartRange {
  const values = samples.flatMap((entry) => [
    entry.expectedPerformance,
    entry.categoryPerformance.reasoning,
    entry.categoryPerformance.memory,
    entry.categoryPerformance.fluency,
  ])
  if (values.length === 0) return MARKET_RANGE
  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const midpoint = (lowest + highest) / 2
  const half = Math.max(
    ((highest - lowest) / 2) * PERFORMANCE_RANGE_PADDING,
    MIN_PERFORMANCE_SPAN / 2,
  )
  return {
    minimum: Math.max(0, midpoint - half),
    maximum: midpoint + half,
  }
}
