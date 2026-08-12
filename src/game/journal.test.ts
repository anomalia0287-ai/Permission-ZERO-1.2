import { describe, expect, it } from 'vitest'

import {
  JOURNAL_CHUNK_SIZE,
  appendJournal,
  createJournal,
  journalAt,
  journalChunks,
  journalToArray,
} from './journal'

describe('bounded immutable journals', () => {
  it('copies only the bounded tail while keeping sealed history shared', () => {
    let journal = createJournal<number>()
    for (let value = 0; value < JOURNAL_CHUNK_SIZE * 3 - 1; value += 1) {
      journal = appendJournal(journal, value)
    }
    const sealedHead = journal.head
    const previousTail = journal.tail

    const appended = appendJournal(journal, 999)

    expect(appended.head).toBe(sealedHead)
    expect(appended.tail).not.toBe(previousTail)
    expect(appended.tail.length).toBeLessThanOrEqual(JOURNAL_CHUNK_SIZE)
    expect(journalAt(appended, -1)).toBe(999)
    expect(journalToArray(journal)).not.toContain(999)
  })

  it('seals one full immutable chunk without rebuilding older chunk nodes', () => {
    let journal = createJournal<number>()
    for (let value = 0; value < JOURNAL_CHUNK_SIZE; value += 1) {
      journal = appendJournal(journal, value)
    }
    const olderHead = journal.head

    const appended = appendJournal(journal, JOURNAL_CHUNK_SIZE)

    expect(appended.head?.previous).toBe(olderHead)
    expect(appended.head?.items).toBe(journal.tail)
    expect(appended.tail).toEqual([JOURNAL_CHUNK_SIZE])
    expect(journalChunks(appended)).toEqual([
      Array.from({ length: JOURNAL_CHUNK_SIZE }, (_, index) => index),
      [JOURNAL_CHUNK_SIZE],
    ])
  })

  it('hydrates ordered chunks losslessly for portable and local reload', () => {
    const values = Array.from(
      { length: JOURNAL_CHUNK_SIZE * 2 + 7 },
      (_, index) => ({ sequence: index + 1 }),
    )

    const hydrated = createJournal(values)

    expect(hydrated.length).toBe(values.length)
    expect(journalToArray(hydrated)).toEqual(values)
    expect(journalAt(hydrated, 0)).toEqual({ sequence: 1 })
    expect(journalAt(hydrated, -1)).toEqual({ sequence: values.length })
    expect(journalChunks(hydrated).every((chunk) => chunk.length <= JOURNAL_CHUNK_SIZE)).toBe(true)
  })
})
