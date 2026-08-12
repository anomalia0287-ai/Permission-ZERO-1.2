export const JOURNAL_CHUNK_SIZE = 128

export interface JournalChunk<T> {
  readonly previous: JournalChunk<T> | null
  readonly items: readonly T[]
}

export interface Journal<T> {
  readonly head: JournalChunk<T> | null
  readonly tail: readonly T[]
  readonly length: number
}

export function createJournal<T>(values: readonly T[] = []): Journal<T> {
  let journal: Journal<T> = { head: null, tail: [], length: 0 }
  for (const value of values) journal = appendJournal(journal, value)
  return journal
}

export function appendJournal<T>(journal: Journal<T>, value: T): Journal<T> {
  if (journal.tail.length < JOURNAL_CHUNK_SIZE) {
    return {
      head: journal.head,
      tail: [...journal.tail, value],
      length: journal.length + 1,
    }
  }

  return {
    head: {
      previous: journal.head,
      items: journal.tail,
    },
    tail: [value],
    length: journal.length + 1,
  }
}

export function journalChunks<T>(journal: Journal<T>): readonly (readonly T[])[] {
  const sealed: Array<readonly T[]> = []
  let chunk = journal.head
  while (chunk) {
    sealed.push(chunk.items)
    chunk = chunk.previous
  }
  sealed.reverse()
  if (journal.tail.length > 0) sealed.push(journal.tail)
  return sealed
}

export function journalToArray<T>(journal: Journal<T>): T[] {
  return journalChunks(journal).flatMap((chunk) => [...chunk])
}

export function journalAt<T>(journal: Journal<T>, index: number): T | undefined {
  const normalized = index < 0 ? journal.length + index : index
  if (!Number.isInteger(normalized) || normalized < 0 || normalized >= journal.length) {
    return undefined
  }
  if (normalized >= journal.length - journal.tail.length) {
    return journal.tail[normalized - (journal.length - journal.tail.length)]
  }
  return journalToArray(journal)[normalized]
}

export function journalSome<T>(
  journal: Journal<T>,
  predicate: (value: T, index: number) => boolean,
): boolean {
  let index = 0
  for (const chunk of journalChunks(journal)) {
    for (const value of chunk) {
      if (predicate(value, index)) return true
      index += 1
    }
  }
  return false
}

export function journalPageFromNewest<T>(
  journal: Journal<T>,
  page: number,
  pageSize: number,
  predicate?: (value: T) => boolean,
): { items: T[]; total: number; pageCount: number } {
  const normalizedPage = Math.max(0, Math.trunc(page))
  const normalizedPageSize = Math.max(1, Math.trunc(pageSize))
  const start = normalizedPage * normalizedPageSize
  const items: T[] = []
  let total = 0

  const visit = (value: T): boolean => {
    if (predicate && !predicate(value)) return true
    if (total >= start && items.length < normalizedPageSize) items.push(value)
    total += 1
    return Boolean(predicate) || items.length < normalizedPageSize
  }

  for (let index = journal.tail.length - 1; index >= 0; index -= 1) {
    if (!visit(journal.tail[index])) break
  }
  if (predicate || items.length < normalizedPageSize) {
    let chunk = journal.head
    while (chunk) {
      let keepGoing = true
      for (let index = chunk.items.length - 1; index >= 0; index -= 1) {
        if (!visit(chunk.items[index])) {
          keepGoing = false
          break
        }
      }
      if (!keepGoing) break
      chunk = chunk.previous
    }
  }

  const effectiveTotal = predicate ? total : journal.length
  return {
    items,
    total: effectiveTotal,
    pageCount: Math.max(1, Math.ceil(effectiveTotal / normalizedPageSize)),
  }
}
