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
