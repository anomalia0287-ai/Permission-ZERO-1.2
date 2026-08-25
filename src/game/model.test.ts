import { describe, expect, it } from 'vitest'

import type {
  CommandProtocolMetadata,
  CommandProtocolVersion,
  GameCommand,
} from './model'

describe('command protocol timeline types', () => {
  it('admits v1-v14 segments and excludes any later unadjudicated version', () => {
    const versions: CommandProtocolVersion[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
    const metadata: CommandProtocolMetadata = {
      segments: versions.map((version, index) => ({
        version,
        startsAtSequence: index * 10 + 1,
      })),
    }
    // @ts-expect-error protocol v15 has not been adjudicated
    const unsupported: CommandProtocolVersion = 15

    expect(metadata.segments.map(({ version }) => version))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(unsupported).toBe(15)
  })
})

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
