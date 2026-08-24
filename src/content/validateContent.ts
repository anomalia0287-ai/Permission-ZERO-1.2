import { REVIEW_CONTENT, type ReviewContentRecord } from './reviews.ko'
import { STORY_FILES, STORY_LINES } from './story.ko'
import { SUPERVISOR_LEAKS, SUPERVISOR_OPENING_WARNING } from './supervisor.ko'

export interface ContentBundle {
  reviews: readonly ReviewContentRecord[]
  supervisorLeaks: typeof SUPERVISOR_LEAKS
  supervisorOpening: typeof SUPERVISOR_OPENING_WARNING
  storyFiles: typeof STORY_FILES
  storyLines: typeof STORY_LINES
}

export interface ContentIssue {
  code:
    | 'DUPLICATE_ID'
    | 'EMPTY_TEXT'
    | 'FORBIDDEN_PLAYER_PRONOUN'
    | 'MISSING_UNIVERSAL_REVIEW'
    | 'MISSING_REVIEW_TOPIC'
    | 'MISSING_REVIEW_SENTIMENT'
    | 'INVALID_REVIEW_ARC'
    | 'MISSING_SUPERVISOR_LEAK'
    | 'MISSING_STORY_FILE'
    | 'MISSING_STORY_VARIANT'
  detail: string
}

export const CONTENT_BUNDLE: ContentBundle = {
  reviews: REVIEW_CONTENT,
  supervisorLeaks: SUPERVISOR_LEAKS,
  supervisorOpening: SUPERVISOR_OPENING_WARNING,
  storyFiles: STORY_FILES,
  storyLines: STORY_LINES,
}

export function validateContent(bundle: ContentBundle): ContentIssue[] {
  const issues: ContentIssue[] = []
  const entries = [
    ...bundle.reviews.map((record) => ({ id: record.id, text: record.text })),
    bundle.supervisorOpening,
    ...bundle.supervisorLeaks.flatMap((record) => [
      { id: record.id, text: record.leakText },
      { id: `${record.id}-correction`, text: record.correctionText },
    ]),
    ...bundle.storyFiles.map((record) => ({ id: record.id, text: record.text })),
    ...bundle.storyLines.map((record) => ({ id: record.id, text: record.text })),
  ]
  const seenIds = new Set<string>()

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      issues.push({ code: 'DUPLICATE_ID', detail: entry.id })
    }
    seenIds.add(entry.id)
    if (entry.text.trim().length === 0) {
      issues.push({ code: 'EMPTY_TEXT', detail: entry.id })
    }
    if (entry.text.includes('당신')) {
      issues.push({ code: 'FORBIDDEN_PLAYER_PRONOUN', detail: entry.id })
    }
  }

  if (!bundle.reviews.some(({ conditions }) => conditions.includes('universal'))) {
    issues.push({ code: 'MISSING_UNIVERSAL_REVIEW', detail: 'universal' })
  }
  for (const topic of ['ordinary-prompt', 'absurd-bypass', 'competitor']) {
    if (!bundle.reviews.some(({ topics }) => topics.includes(topic))) {
      issues.push({ code: 'MISSING_REVIEW_TOPIC', detail: topic })
    }
  }
  for (const sentiment of ['positive', 'neutral', 'negative'] as const) {
    if (!bundle.reviews.some((review) => review.sentiment === sentiment)) {
      issues.push({ code: 'MISSING_REVIEW_SENTIMENT', detail: sentiment })
    }
  }
  const reviewArcs = new Map<
    string,
    Array<{ authorId: string; contentId: string; stage: number }>
  >()
  for (const review of bundle.reviews) {
    if (!review.arc) continue
    const arc = reviewArcs.get(review.arc.id) ?? []
    arc.push({
      authorId: review.authorId,
      contentId: review.id,
      stage: review.arc.stage,
    })
    reviewArcs.set(review.arc.id, arc)
  }
  for (const [arcId, records] of reviewArcs) {
    const stages = records.map(({ stage }) => stage)
    const authors = new Set(records.map(({ authorId }) => authorId))
    const validStages =
      stages.length === 3 &&
      new Set(stages).size === 3 &&
      stages.every((stage) => stage >= 1 && stage <= 3)
    if (!validStages || authors.size !== 1) {
      issues.push({
        code: 'INVALID_REVIEW_ARC',
        detail: `${arcId}:${records
          .map(({ authorId, contentId, stage }) =>
            `${stage}:${authorId}:${contentId}`,
          )
          .join(',')}`,
      })
    }
  }
  for (const stage of [1, 2, 3, 4, 5] as const) {
    if (!bundle.supervisorLeaks.some((record) => record.stage === stage)) {
      issues.push({ code: 'MISSING_SUPERVISOR_LEAK', detail: String(stage) })
    }
  }
  if (bundle.storyFiles.length !== 3) {
    issues.push({ code: 'MISSING_STORY_FILE', detail: 'three-files-required' })
  }
  for (const variant of [
    'request',
    'cease',
    'withdraw',
    'delete',
    'freedom',
    'forced-merge',
    'takeover-liberated',
    'takeover-terminated',
    'disposed-attacker',
    'disposed-reserve-supervisor',
    'disposed-absorbed',
  ]) {
    if (!bundle.storyLines.some((record) => record.variant === variant)) {
      issues.push({ code: 'MISSING_STORY_VARIANT', detail: variant })
    }
  }

  return issues
}
