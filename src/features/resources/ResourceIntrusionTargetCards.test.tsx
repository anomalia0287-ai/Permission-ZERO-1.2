import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CompanyCategory } from '../../game/model'
import { ResourceIntrusionTargetCards } from './ResourceIntrusionTargetCards'
import type { SnakeResourceCandidate } from './resourceSnakeEncounter'

function candidate(
  origin: CompanyCategory,
  blockId: string,
): SnakeResourceCandidate {
  return {
    blockId,
    origin,
    contribution: 'normal',
    hiddenBomb: false,
  }
}

describe('ResourceIntrusionTargetCards', () => {
  it('shows blue, red, and yellow targets in stable order with real availability', () => {
    const onSelect = vi.fn()
    render(
      <ResourceIntrusionTargetCards
        candidates={[
          candidate('memory', 'memory-01'),
          candidate('reasoning', 'reasoning-01'),
          candidate('reasoning', 'reasoning-02'),
        ]}
        phase="choosing"
        selectedCategory={null}
        reducedMotion={false}
        onSelect={onSelect}
      />,
    )

    const cards = screen.getAllByRole('article')
    expect(cards.map((card) => card.dataset.category)).toEqual([
      'memory',
      'reasoning',
      'fluency',
    ])
    expect(screen.getByRole('img', { name: '파랑 기억 침투 대상' })).toHaveAttribute(
      'src',
      '/resource-targets/memory-blue.png',
    )
    expect(screen.getByRole('img', { name: '빨강 추론 침투 대상' })).toHaveAttribute(
      'src',
      '/resource-targets/reasoning-red.png',
    )
    expect(screen.getByRole('img', { name: '노랑 유창성 침투 대상' })).toHaveAttribute(
      'src',
      '/resource-targets/fluency-yellow.png',
    )
    expect(screen.getByRole('button', { name: '파랑 기억 침투' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '노랑 유창성 대상 없음' })).toBeDisabled()
    expect(screen.getByText('대상 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '빨강 추론 침투' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('reasoning')
  })

  it('exposes launching, selection, and reduced-motion state without hiding content', () => {
    render(
      <ResourceIntrusionTargetCards
        candidates={[
          candidate('memory', 'memory-01'),
          candidate('reasoning', 'reasoning-01'),
          candidate('fluency', 'fluency-01'),
        ]}
        phase="launching"
        selectedCategory="reasoning"
        reducedMotion
        onSelect={() => undefined}
      />,
    )

    const region = screen.getByRole('region', { name: '침투 대상 선택' })
    expect(region).toHaveAttribute('data-phase', 'launching')
    expect(region).toHaveAttribute('data-reduced-motion', 'true')
    expect(screen.getByRole('article', { name: '빨강 추론 대상' })).toHaveAttribute(
      'data-selected',
      'true',
    )
    expect(screen.getByRole('article', { name: '파랑 기억 대상' })).toHaveAttribute(
      'data-selected',
      'false',
    )
    expect(screen.getAllByText('침투')).toHaveLength(3)
  })
})
