import type { CSSProperties } from 'react'

import { RESOURCE_SNAKE_CATEGORIES } from './resourceSnakeCategoryPresentation'

export interface ResourceSnakeCategoryLegendProps {
  ariaLabel?: string
  className?: string
}

export function ResourceSnakeCategoryLegend({
  ariaLabel = '리소스 색상 범례',
  className,
}: ResourceSnakeCategoryLegendProps) {
  const classes = ['resource-category-legend', className].filter(Boolean).join(' ')

  return (
    <ul className={classes} aria-label={ariaLabel}>
      {RESOURCE_SNAKE_CATEGORIES.map((entry) => (
        <li
          key={entry.category}
          className="resource-category-legend__item"
          data-category={entry.category}
          data-color={entry.color}
          data-resource-label={entry.label}
          style={{ '--resource-category-color': entry.color } as CSSProperties}
        >
          <i className="resource-category-legend__swatch" aria-hidden="true" />
          <span>{entry.colorName} · {entry.label}</span>
        </li>
      ))}
    </ul>
  )
}

