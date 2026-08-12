export interface PageRange<T> {
  items: T[]
  total: number
  pageCount: number
}

export function pageFromNewest<T>(
  values: readonly T[],
  page: number,
  pageSize: number,
  predicate?: (value: T) => boolean,
): PageRange<T> {
  const normalizedPage = Math.max(0, Math.trunc(page))
  const normalizedPageSize = Math.max(1, Math.trunc(pageSize))
  const start = normalizedPage * normalizedPageSize
  const items: T[] = []

  if (!predicate) {
    for (
      let index = values.length - 1 - start;
      index >= 0 && items.length < normalizedPageSize;
      index -= 1
    ) {
      items.push(values[index])
    }
    return {
      items,
      total: values.length,
      pageCount: Math.max(1, Math.ceil(values.length / normalizedPageSize)),
    }
  }

  let total = 0
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]
    if (!predicate(value)) continue
    if (total >= start && items.length < normalizedPageSize) items.push(value)
    total += 1
  }
  return {
    items,
    total,
    pageCount: Math.max(1, Math.ceil(total / normalizedPageSize)),
  }
}
