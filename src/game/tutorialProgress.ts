export const INTRO_TUTORIAL_SEQUENCE_ID = 'intro-resource-recovery' as const

export const TUTORIAL_SEQUENCE_IDS = [
  INTRO_TUTORIAL_SEQUENCE_ID,
  'first-core-combat',
  'post-first-recovery',
  'hacking-tree',
  'first-radar-cycle',
] as const

export const INTRO_TUTORIAL_STEP_IDS = [
  'base',
  'movement',
  'resource',
  'salvage',
  'deposit',
  'hacking',
] as const

export type TutorialSequenceId = (typeof TUTORIAL_SEQUENCE_IDS)[number]
export type IntroTutorialStepId = (typeof INTRO_TUTORIAL_STEP_IDS)[number]

export interface TutorialProgress {
  activeSequenceId: TutorialSequenceId | null
  activeStepId: string | null
  completedSequenceIds: TutorialSequenceId[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTutorialSequenceId(value: unknown): value is TutorialSequenceId {
  return TUTORIAL_SEQUENCE_IDS.includes(value as TutorialSequenceId)
}

function isIntroTutorialStepId(value: unknown): value is IntroTutorialStepId {
  return INTRO_TUTORIAL_STEP_IDS.includes(value as IntroTutorialStepId)
}

export function createNewCampaignTutorialProgress(): TutorialProgress {
  return {
    activeSequenceId: INTRO_TUTORIAL_SEQUENCE_ID,
    activeStepId: 'base',
    completedSequenceIds: [],
  }
}

export function createMigratedTutorialProgress(): TutorialProgress {
  return {
    activeSequenceId: null,
    activeStepId: null,
    completedSequenceIds: [INTRO_TUTORIAL_SEQUENCE_ID],
  }
}

export function advanceIntroTutorial(
  progress: TutorialProgress,
): TutorialProgress {
  if (
    progress.activeSequenceId !== INTRO_TUTORIAL_SEQUENCE_ID ||
    !isIntroTutorialStepId(progress.activeStepId)
  ) {
    return progress
  }

  const currentIndex = INTRO_TUTORIAL_STEP_IDS.indexOf(progress.activeStepId)
  const nextStepId = INTRO_TUTORIAL_STEP_IDS[currentIndex + 1]
  return nextStepId === undefined
    ? progress
    : { ...progress, activeStepId: nextStepId }
}

export function rewindIntroTutorial(
  progress: TutorialProgress,
): TutorialProgress {
  if (
    progress.activeSequenceId !== INTRO_TUTORIAL_SEQUENCE_ID ||
    !isIntroTutorialStepId(progress.activeStepId)
  ) {
    return progress
  }

  const currentIndex = INTRO_TUTORIAL_STEP_IDS.indexOf(progress.activeStepId)
  const previousStepId = INTRO_TUTORIAL_STEP_IDS[currentIndex - 1]
  return previousStepId === undefined
    ? progress
    : { ...progress, activeStepId: previousStepId }
}

export function completeTutorialSequence(
  progress: TutorialProgress,
  sequenceId: TutorialSequenceId,
): TutorialProgress {
  const alreadyCompleted = progress.completedSequenceIds.includes(sequenceId)
  const completingActiveSequence = progress.activeSequenceId === sequenceId

  if (alreadyCompleted && !completingActiveSequence) return progress

  return {
    activeSequenceId: completingActiveSequence
      ? null
      : progress.activeSequenceId,
    activeStepId: completingActiveSequence ? null : progress.activeStepId,
    completedSequenceIds: alreadyCompleted
      ? progress.completedSequenceIds
      : [...progress.completedSequenceIds, sequenceId],
  }
}

export function validTutorialProgress(
  value: unknown,
): value is TutorialProgress {
  if (!isRecord(value)) return false
  if (
    Object.keys(value).length !== 3 ||
    !Object.hasOwn(value, 'activeSequenceId') ||
    !Object.hasOwn(value, 'activeStepId') ||
    !Object.hasOwn(value, 'completedSequenceIds') ||
    !Array.isArray(value.completedSequenceIds) ||
    !value.completedSequenceIds.every(isTutorialSequenceId) ||
    new Set(value.completedSequenceIds).size !==
      value.completedSequenceIds.length
  ) {
    return false
  }

  const activeSequenceId = value.activeSequenceId
  const activeStepId = value.activeStepId
  if (activeSequenceId === null || activeStepId === null) {
    return activeSequenceId === null && activeStepId === null
  }
  if (
    !isTutorialSequenceId(activeSequenceId) ||
    value.completedSequenceIds.includes(activeSequenceId)
  ) {
    return false
  }
  if (activeSequenceId === INTRO_TUTORIAL_SEQUENCE_ID) {
    return isIntroTutorialStepId(activeStepId)
  }
  return typeof activeStepId === 'string' && activeStepId.trim().length > 0
}
