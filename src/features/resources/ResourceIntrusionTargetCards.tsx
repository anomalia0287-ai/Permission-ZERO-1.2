import type { CSSProperties } from 'react'

import type { CompanyCategory } from '../../game/model'
import type { SnakeResourceCandidate } from './resourceSnakeEncounter'
import { SNAKE_CATEGORY_COLORS } from './resourceSnakeCategoryPresentation'
import {
  RESOURCE_INTRUSION_TARGETS,
  resourceIntrusionTargetCounts,
} from './resourceIntrusionTargets'

export type ResourceIntrusionTargetPhase = 'choosing' | 'launching'

interface ResourceIntrusionTargetCardsProps {
  candidates: readonly SnakeResourceCandidate[]
  phase: ResourceIntrusionTargetPhase
  selectedCategory: CompanyCategory | null
  reducedMotion: boolean
  onSelect: (category: CompanyCategory) => void
}

type TargetCardStyle = CSSProperties & {
  '--target-card-index': number
  '--target-card-color': string
}

export function ResourceIntrusionTargetCards({
  candidates,
  phase,
  selectedCategory,
  reducedMotion,
  onSelect,
}: ResourceIntrusionTargetCardsProps) {
  const counts = resourceIntrusionTargetCounts(candidates)

  return (
    <section
      className="resource-intrusion-targets"
      aria-label="침투 대상 선택"
      data-phase={phase}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-tutorial-target="intrusion-targets"
    >
      {RESOURCE_INTRUSION_TARGETS.map((target, index) => {
        const count = counts[target.category]
        const available = count > 0
        const selected = selectedCategory === target.category
        const actionLabel = available
          ? `${target.colorName} ${target.resourceName} 침투`
          : `${target.colorName} ${target.resourceName} 대상 없음`
        const style: TargetCardStyle = {
          '--target-card-index': index,
          '--target-card-color': SNAKE_CATEGORY_COLORS[target.category],
        }

        return (
          <article
            key={target.category}
            className="resource-intrusion-target-card"
            aria-label={`${target.colorName} ${target.resourceName} 대상`}
            data-category={target.category}
            data-phase={phase}
            data-selected={selected ? 'true' : 'false'}
            data-available={available ? 'true' : 'false'}
            style={style}
          >
            <div className="resource-intrusion-target-card__visual">
              <img
                src={target.imageUrl}
                alt={`${target.colorName} ${target.resourceName} 침투 대상`}
              />
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className="resource-intrusion-target-card__copy">
              <span>{target.colorName}</span>
              <strong>{target.resourceName}</strong>
              <small>{available ? `대상 ${count}` : '확보 가능한 리소스 없음'}</small>
            </div>
            <button
              type="button"
              aria-label={actionLabel}
              disabled={!available || phase === 'launching'}
              onClick={() => onSelect(target.category)}
            >
              {available ? '침투' : '대상 없음'}
            </button>
          </article>
        )
      })}
    </section>
  )
}
