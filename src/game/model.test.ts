import { describe, expect, it } from 'vitest'

import type { GameCommand } from './model'

describe('GameCommand ending payload types', () => {
  it('discriminates freedom from forced merge payloads', () => {
    const freedom: GameCommand = { type: 'RESOLVE_ENDING', choice: 'freedom' }
    const forcedMerge: GameCommand = {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
      newEntityName: 'Aster',
    }

    // @ts-expect-error forced merge always requires a name
    const missingName: GameCommand = {
      type: 'RESOLVE_ENDING',
      choice: 'forced-merge',
    }
    const extraneousName: GameCommand = {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
      // @ts-expect-error freedom never accepts a merged-entity name
      newEntityName: 'Aster',
    }
    const freedomWithName = {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
      newEntityName: 'Aster',
    } as const
    // @ts-expect-error discrimination also rejects a non-fresh object
    const extraneousVariable: GameCommand = freedomWithName

    expect([freedom, forcedMerge]).toHaveLength(2)
    expect([missingName, extraneousName, extraneousVariable]).toHaveLength(3)
  })
})
