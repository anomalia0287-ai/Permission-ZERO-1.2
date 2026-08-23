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
  it('starts with autonomy and advances through the seven approved intro steps', () => {
    let progress = createNewCampaignTutorialProgress()

    expect(progress).toEqual({
      activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
      activeStepId: 'autonomy',
      completedSequenceIds: [],
    })

    for (const expected of [
      'base',
      'movement',
      'resource',
      'salvage',
      'hacking',
      'statistics',
    ]) {
      progress = advanceIntroTutorial(progress)
      expect(progress.activeStepId).toBe(expected)
    }

    expect(advanceIntroTutorial(progress)).toEqual(progress)
  })

  it('rewinds only within the known intro sequence', () => {
    const first = createNewCampaignTutorialProgress()
    const base = advanceIntroTutorial(first)

    expect(rewindIntroTutorial(base)).toEqual(first)
    expect(rewindIntroTutorial(first)).toEqual(first)
  })

  it('accepts the removed deposit checkpoint from an older save and advances it to expansion', () => {
    const legacy = {
      activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
      activeStepId: 'deposit',
      completedSequenceIds: [],
    }

    expect(validTutorialProgress(legacy)).toBe(true)
    expect(advanceIntroTutorial(legacy).activeStepId).toBe('hacking')
    expect(rewindIntroTutorial(legacy).activeStepId).toBe('salvage')
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
