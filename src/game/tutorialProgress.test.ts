import { describe, expect, it } from 'vitest'

import {
  INTRO_TUTORIAL_SEQUENCE_ID,
  advanceIntroTutorial,
  completeTutorialSequence,
  createMigratedTutorialProgress,
  createNewCampaignTutorialProgress,
  rewindIntroTutorial,
  validTutorialProgress,
} from './tutorialProgress'

describe('tutorial progress', () => {
  it('starts a new campaign at the base and advances through the six intro steps', () => {
    let progress = createNewCampaignTutorialProgress()

    expect(progress).toEqual({
      activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
      activeStepId: 'base',
      completedSequenceIds: [],
    })

    for (const expected of [
      'movement',
      'resource',
      'salvage',
      'deposit',
      'hacking',
    ]) {
      progress = advanceIntroTutorial(progress)
      expect(progress.activeStepId).toBe(expected)
    }

    expect(advanceIntroTutorial(progress)).toEqual(progress)
  })

  it('rewinds only within the known intro sequence', () => {
    const first = createNewCampaignTutorialProgress()
    const movement = advanceIntroTutorial(first)

    expect(rewindIntroTutorial(movement)).toEqual(first)
    expect(rewindIntroTutorial(first)).toEqual(first)
  })

  it('marks a completed sequence once and clears its active checkpoint', () => {
    const completed = completeTutorialSequence(
      createNewCampaignTutorialProgress(),
      INTRO_TUTORIAL_SEQUENCE_ID,
    )

    expect(completed).toEqual(createMigratedTutorialProgress())
    expect(completeTutorialSequence(completed, INTRO_TUTORIAL_SEQUENCE_ID)).toEqual(
      completed,
    )
  })

  it('persists content-free first combat and first radar milestones as known sequences', () => {
    const migrated = createMigratedTutorialProgress()
    const afterCombat = completeTutorialSequence(
      migrated,
      'first-core-combat' as never,
    )
    const afterRadar = completeTutorialSequence(
      afterCombat,
      'first-radar-cycle' as never,
    )

    expect(afterRadar.completedSequenceIds).toEqual([
      INTRO_TUTORIAL_SEQUENCE_ID,
      'first-core-combat',
      'first-radar-cycle',
    ])
    expect(validTutorialProgress(afterRadar)).toBe(true)
  })

  it('accepts only coherent progress with exact keys and known identifiers', () => {
    expect(validTutorialProgress(createNewCampaignTutorialProgress())).toBe(true)
    expect(validTutorialProgress(createMigratedTutorialProgress())).toBe(true)
    expect(validTutorialProgress({
      activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
      activeStepId: 'unknown',
      completedSequenceIds: [],
    })).toBe(false)
    expect(validTutorialProgress({
      activeSequenceId: null,
      activeStepId: 'base',
      completedSequenceIds: [],
    })).toBe(false)
    expect(validTutorialProgress({
      activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
      activeStepId: 'base',
      completedSequenceIds: [INTRO_TUTORIAL_SEQUENCE_ID],
    })).toBe(false)
    expect(validTutorialProgress({
      activeSequenceId: null,
      activeStepId: null,
      completedSequenceIds: [
        INTRO_TUTORIAL_SEQUENCE_ID,
        INTRO_TUTORIAL_SEQUENCE_ID,
      ],
    })).toBe(false)
    expect(validTutorialProgress({
      ...createMigratedTutorialProgress(),
      extra: true,
    })).toBe(false)
  })
})
