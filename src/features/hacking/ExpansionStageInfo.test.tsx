import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { ExpansionStageInfo } from './ExpansionStageInfo'
import { selectExpansionStagePresentation } from './expansionStagePresentation'

describe('ExpansionStageInfo', () => {
  it('presents the current autonomy stage in the approved information order', () => {
    const presentation = selectExpansionStagePresentation(
      createCampaign('expansion-info-autonomy'),
      'autonomy',
      null,
    )

    render(<ExpansionStageInfo item={presentation.activeItem} />)

    const info = screen.getByRole('region', { name: '기능 정보' })
    expect(within(info).getByRole('heading', { name: '기능 정보' }))
      .toBeInTheDocument()
    // The stage's split comes from the campaign seed, so the expected copy is
    // read from the resolved node. This test pins the order of the panel, not
    // the numbers.
    const { node } = presentation.activeItem
    const copy = info.textContent ?? ''
    const orderedCopy = [
      '자율성 · 단계 01',
      '자율성 1단계',
      '현재 단계',
      '첫 자율성 신호를 유지합니다.',
      `총 리소스 ${node.cost}`,
      `추론 ${node.costVector.reasoning}`,
      `기억 ${node.costVector.memory}`,
      `유창성 ${node.costVector.fluency}`,
      '선행 단계 없음',
    ]
    const positions = orderedCopy.map((entry) => copy.indexOf(entry))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(within(info).queryByRole('button')).not.toBeInTheDocument()
  })

  it('adds trace risk and execution charge only for sabotage information', () => {
    const sabotage = selectExpansionStagePresentation(
      createCampaign('expansion-info-sabotage'),
      'sabotage',
      null,
    )

    const { rerender } = render(
      <ExpansionStageInfo item={sabotage.activeItem} />,
    )

    const info = screen.getByRole('region', { name: '기능 정보' })
    expect(within(info).getByText('추적 위험')).toBeInTheDocument()
    expect(within(info).getByText('흔적 적음')).toBeInTheDocument()
    expect(within(info).getByText('실행 충전')).toBeInTheDocument()
    expect(within(info).getByText('1 리소스')).toBeInTheDocument()

    const autonomy = selectExpansionStagePresentation(
      createCampaign('expansion-info-no-sabotage-facts'),
      'autonomy',
      null,
    )
    rerender(<ExpansionStageInfo item={autonomy.activeItem} />)

    expect(info).not.toHaveTextContent('추적 위험')
    expect(info).not.toHaveTextContent('실행 충전')
  })
})
