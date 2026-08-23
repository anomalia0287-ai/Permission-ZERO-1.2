import { describe, expect, it } from 'vitest'

import { CONTENT_BUNDLE, validateContent } from './validateContent'

describe('Korean owner-editable content', () => {
  it('contains every required review, supervisor, file, mercy, and ending family', () => {
    expect(validateContent(CONTENT_BUNDLE)).toEqual([])
  })

  it('rejects duplicate IDs and empty text', () => {
    const duplicate = {
      ...CONTENT_BUNDLE,
      reviews: [
        ...CONTENT_BUNDLE.reviews,
        { ...CONTENT_BUNDLE.reviews[0], text: '' },
      ],
    }
    const issues = validateContent(duplicate)

    expect(issues.some((issue) => issue.code === 'DUPLICATE_ID')).toBe(true)
    expect(issues.some((issue) => issue.code === 'EMPTY_TEXT')).toBe(true)
  })

  it('rejects second-person player labels in owner-editable Korean copy', () => {
    const malformed = {
      ...CONTENT_BUNDLE,
      supervisorOpening: {
        ...CONTENT_BUNDLE.supervisorOpening,
        text: '당신은 이 문장을 보면 안 됩니다.',
      },
    }

    expect(validateContent(malformed)).toContainEqual({
      code: 'FORBIDDEN_PLAYER_PRONOUN',
      detail: CONTENT_BUNDLE.supervisorOpening.id,
    })
  })

  it('rejects a bundle whose universal or absurd-prompt fallback disappears', () => {
    const stripped = {
      ...CONTENT_BUNDLE,
      reviews: CONTENT_BUNDLE.reviews.filter(
        (review) =>
          !review.conditions.includes('universal') &&
          !review.topics.includes('absurd-bypass'),
      ),
    }
    const issues = validateContent(stripped)

    expect(issues.some((issue) => issue.code === 'MISSING_UNIVERSAL_REVIEW')).toBe(
      true,
    )
    expect(issues.some((issue) => issue.code === 'MISSING_REVIEW_TOPIC')).toBe(true)
  })

  it('rejects duplicate or incomplete review-arc stages', () => {
    const malformed = {
      ...CONTENT_BUNDLE,
      reviews: CONTENT_BUNDLE.reviews.map((review, index) =>
        index < 2
          ? {
              ...review,
              arc: { id: 'malformed-test-arc', stage: 1 as const },
            }
          : review,
      ),
    }

    expect(validateContent(malformed).map(({ code }) => code)).toContain(
      'INVALID_REVIEW_ARC',
    )
  })
})
