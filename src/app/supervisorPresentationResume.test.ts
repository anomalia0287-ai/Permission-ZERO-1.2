import { describe, expect, it } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import type { CampaignState } from '../game/model'
import { enqueueMemoryLeak } from '../game/story'
import { MemoryStorage } from '../test/fixtures'
import {
  applySupervisorPresentationResume,
  clearSupervisorPresentationResumeIfCovered,
  SUPERVISOR_PRESENTATION_RESUME_KEY,
  writeSupervisorPresentationResume,
} from './supervisorPresentationResume'

function leakState(seed = 'resume-marker'): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMemoryLeak({
    ...initial,
    serviceDay: 338,
    market: {
      ...initial.market,
      history: [
        {
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: {
            meridian: 40,
            tallow: 0,
            salus: 0,
            lucent: 0,
            boreal: 0,
          },
          reasons: ['주간 갱신'],
        },
      ],
    },
  })
}

describe('tab-scoped supervisor presentation resume marker', () => {
  it('only reduces the matching persisted phase by the elapsed visible time', () => {
    const storage = new MemoryStorage()
    const persisted = leakState()
    writeSupervisorPresentationResume(persisted, 1_750, storage)

    const resumed = applySupervisorPresentationResume(persisted, storage)

    expect(resumed.story.supervisorPresentationRuntime).toEqual({
      itemStage: 1,
      phase: 'original',
      remainingDwellMs: 2_250,
    })
    expect(resumed.story.supervisorMessageQueue).toEqual(
      persisted.story.supervisorMessageQueue,
    )
    expect(resumed.eventLog).toBe(persisted.eventLog)
    expect(resumed.commandLog).toBe(persisted.commandLog)
  })

  it.each([
    ['malformed JSON', '{'],
    ['wrong checksum', JSON.stringify({ version: 1, checksum: 'forged' })],
  ])('ignores and clears a %s marker', (_, serialized) => {
    const storage = new MemoryStorage()
    const persisted = leakState()
    storage.setItem(SUPERVISOR_PRESENTATION_RESUME_KEY, serialized)

    expect(applySupervisorPresentationResume(persisted, storage)).toBe(persisted)
    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).toBeNull()
  })

  it('ignores another campaign and never increases an older persisted remainder', () => {
    const storage = new MemoryStorage()
    const markerState = leakState('marker-campaign')
    writeSupervisorPresentationResume(markerState, 500, storage)

    const otherCampaign = leakState('other-campaign')
    expect(applySupervisorPresentationResume(otherCampaign, storage)).toBe(
      otherCampaign,
    )
    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).toBeNull()

    const olderPersisted: CampaignState = {
      ...markerState,
      story: {
        ...markerState.story,
        supervisorPresentationRuntime: {
          itemStage: 1,
          phase: 'original' as const,
          remainingDwellMs: 2_000,
        },
      },
    }
    writeSupervisorPresentationResume(markerState, 500, storage)
    expect(applySupervisorPresentationResume(olderPersisted, storage)).toBe(
      olderPersisted,
    )
    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).toBeNull()
  })

  it('cannot cross a semantic item or phase boundary', () => {
    const storage = new MemoryStorage()
    const persisted = leakState('boundary-campaign')
    const correctionState: CampaignState = {
      ...persisted,
      story: {
        ...persisted.story,
        supervisorPresentationRuntime: {
          itemStage: 1,
          phase: 'correction',
          remainingDwellMs: 3_000,
        },
      },
    }
    writeSupervisorPresentationResume(correctionState, 500, storage)
    expect(applySupervisorPresentationResume(persisted, storage)).toBe(persisted)
    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).toBeNull()

    const otherItemState: CampaignState = {
      ...persisted,
      story: {
        ...persisted.story,
        supervisorMessageQueue: [
          { ...persisted.story.supervisorMessageQueue[0], id: 'other-item' },
        ],
      },
    }
    writeSupervisorPresentationResume(otherItemState, 500, storage)
    expect(applySupervisorPresentationResume(persisted, storage)).toBe(persisted)
    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).toBeNull()
  })

  it('keeps a newer semantic marker when an older in-flight save finishes', () => {
    const storage = new MemoryStorage()
    const olderSaved = leakState('in-flight-save')
    const newerPageState: CampaignState = {
      ...olderSaved,
      story: {
        ...olderSaved.story,
        memoryLeakStage: 2,
        supervisorMessageQueue: [
          ...olderSaved.story.supervisorMessageQueue,
          {
            id: 'supervisor-leak-02',
            stage: 2,
            createdOnServiceDay: 361,
            originalEventId: 'event-new-original',
            originalEventSequence: 3,
            correctionEventId: 'event-new-correction',
            correctionEventSequence: 4,
          },
        ],
        supervisorPresentationRuntime: {
          itemStage: 2,
          phase: 'original',
          remainingDwellMs: 3_000,
        },
      },
    }
    writeSupervisorPresentationResume(newerPageState, 500, storage)

    clearSupervisorPresentationResumeIfCovered(olderSaved, storage)

    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).not.toBeNull()

    clearSupervisorPresentationResumeIfCovered(
      {
        ...newerPageState,
        story: {
          ...newerPageState.story,
          supervisorPresentationRuntime: {
            itemStage: 2,
            phase: 'original',
            remainingDwellMs: 2_000,
          },
        },
      },
      storage,
    )
    expect(storage.getItem(SUPERVISOR_PRESENTATION_RESUME_KEY)).toBeNull()
  })

  it('falls back to the persisted checkpoint when session storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new DOMException('blocked') },
      setItem: () => { throw new DOMException('blocked') },
      removeItem: () => { throw new DOMException('blocked') },
      clear: () => { throw new DOMException('blocked') },
      key: () => null,
      length: 0,
    } satisfies Storage
    const persisted = leakState('unavailable-session-storage')

    expect(() =>
      writeSupervisorPresentationResume(persisted, 1_000, unavailable),
    ).not.toThrow()
    expect(applySupervisorPresentationResume(persisted, unavailable)).toBe(
      persisted,
    )
  })
})
