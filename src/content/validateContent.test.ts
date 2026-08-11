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
})
