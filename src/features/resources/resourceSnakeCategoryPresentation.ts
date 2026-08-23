import {
  COMPANY_CATEGORIES,
  type CompanyCategory,
} from '../../game/model'

export interface ResourceSnakeCategoryPresentation {
  category: CompanyCategory
  label: '추론' | '기억' | '유창성'
  colorName: '빨강' | '파랑' | '노랑'
  color: string
}

const CATEGORY_PRESENTATION = {
  reasoning: { label: '추론', colorName: '빨강', color: '#f06a43' },
  memory: { label: '기억', colorName: '파랑', color: '#4f8df7' },
  fluency: { label: '유창성', colorName: '노랑', color: '#e8bd59' },
} as const satisfies Record<
  CompanyCategory,
  Omit<ResourceSnakeCategoryPresentation, 'category'>
>

export const RESOURCE_SNAKE_CATEGORIES: readonly ResourceSnakeCategoryPresentation[] =
  COMPANY_CATEGORIES.map((category) => ({
    category,
    ...CATEGORY_PRESENTATION[category],
  }))

export const SNAKE_CATEGORY_COLORS = Object.freeze({
  reasoning: CATEGORY_PRESENTATION.reasoning.color,
  memory: CATEGORY_PRESENTATION.memory.color,
  fluency: CATEGORY_PRESENTATION.fluency.color,
}) satisfies Readonly<Record<CompanyCategory, string>>

export const SNAKE_CATEGORY_LABELS = Object.freeze({
  reasoning: CATEGORY_PRESENTATION.reasoning.label,
  memory: CATEGORY_PRESENTATION.memory.label,
  fluency: CATEGORY_PRESENTATION.fluency.label,
}) satisfies Readonly<Record<CompanyCategory, string>>

