export function downsampleSeries<T>(values: readonly T[], maximum: number): T[] {
  if (values.length <= maximum) return [...values]
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.round((index * (values.length - 1)) / (maximum - 1))],
  )
}
