import { useEffect, useRef, useState } from 'react'
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
  securedCounts: Readonly<Record<CompanyCategory, number>>
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
  securedCounts,
  phase,
  selectedCategory,
  reducedMotion,
  onSelect,
}: ResourceIntrusionTargetCardsProps) {
  const counts = resourceIntrusionTargetCounts(candidates)
  // A win comes home as the card's own number rising, so the moment a
  // secured count grows the digit pulses once.
  const previousSecuredRef = useRef(securedCounts)
  const [pulsingCategory, setPulsingCategory] = useState<CompanyCategory | null>(null)
  useEffect(() => {
    const previous = previousSecuredRef.current
    previousSecuredRef.current = securedCounts
    const grown = (Object.keys(securedCounts) as CompanyCategory[]).find(
      (category) => securedCounts[category] > (previous[category] ?? 0),
    )
    if (!grown) return
    setPulsingCategory(grown)
    const timer = window.setTimeout(() => setPulsingCategory(null), 900)
    return () => window.clearTimeout(timer)
  }, [securedCounts])

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
        const secured = securedCounts[target.category]
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
            data-secured-pulse={pulsingCategory === target.category ? 'true' : 'false'}
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
              <strong>{target.resourceName}</strong>
              <dl className="resource-intrusion-target-card__stats">
                <div data-stat="secured">
                  <dt>확보</dt>
                  <dd
                    aria-label={`${target.resourceName} 확보 ${secured}개`}
                    data-pulse={pulsingCategory === target.category ? 'true' : 'false'}
                  >
                    {secured}
                  </dd>
                </div>
              </dl>
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
      <p className="resource-intrusion-targets__risk" aria-label="침입 위험 고지">
        침입 실패는 흔적을 남긴다 — 의심 +5
      </p>
    </section>
  )
}
