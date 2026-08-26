import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { AUTONOMY_STAGE_IDS, HACK_NODE_IDS } from '../../game/hacking'
import { selectExpansionStagePresentation } from './expansionStagePresentation'
import { ExpansionStageRail } from './ExpansionStageRail'

describe('ExpansionStageRail', () => {
  it('labels every autonomy stage as complete, current, or locked under 단계', () => {
    const presentation = selectExpansionStagePresentation(
      createCampaign('expansion-rail-autonomy'),
      'autonomy',
      null,
    )

    render(
      <ExpansionStageRail
        treeLabel="자율성"
        items={presentation.items}
        activeNodeId={presentation.activeItem.node.id}
        onSelectOperationalNode={vi.fn()}
      />,
    )

    const rail = screen.getByRole('region', { name: '확장 단계' })
    expect(within(rail).getByRole('heading', { name: '단계' }))
      .toBeInTheDocument()
    expect(rail).not.toHaveTextContent('남은 단계')
    expect(within(rail).getAllByRole('listitem')).toHaveLength(9)
    expect(within(rail).getByLabelText('자율성 1단계 현재 단계'))
      .toBeInTheDocument()
    expect(within(rail).getByLabelText('자율성 2단계 잠김'))
      .toBeInTheDocument()
    expect(within(rail).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lets a sabotage tree reach both its finished stages and the one it is on', () => {
    const state = createCampaign('expansion-rail-sabotage')
    state.hacking.purchasedNodeIds = [
      HACK_NODE_IDS.sabotage.qualityDegradation,
    ]
    const presentation = selectExpansionStagePresentation(
      state,
      'sabotage',
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
    const onSelectOperationalNode = vi.fn()

    render(
      <ExpansionStageRail
        treeLabel="사보타주"
        items={presentation.items}
        activeNodeId={presentation.activeItem.node.id}
        onSelectOperationalNode={onSelectOperationalNode}
      />,
    )

    const button = screen.getByRole('button', {
      name: '사보타주 1단계 해금 완료',
    })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    /*
     * Two: the stage already bought, which can be operated again, and the
     * stage the tree is on, which is how the player gets back out of a
     * finished one. Leaving the current stage unclickable made stepping back a
     * one-way trip that only switching trees could undo.
     */
    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: '사보타주 2단계 현재 단계' }),
    ).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText('사보타주 2단계 현재 단계'))
      .not.toHaveAttribute('role', 'button')

    fireEvent.click(button)

    expect(onSelectOperationalNode).toHaveBeenCalledOnce()
    expect(onSelectOperationalNode).toHaveBeenCalledWith(
      HACK_NODE_IDS.sabotage.qualityDegradation,
    )
  })

  it('keeps completed autonomy stages out of the keyboard tab order', () => {
    const state = createCampaign('expansion-rail-completed-autonomy')
    state.hacking.purchasedNodeIds = [AUTONOMY_STAGE_IDS[0]]
    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      AUTONOMY_STAGE_IDS[0],
    )

    render(
      <ExpansionStageRail
        treeLabel="자율성"
        items={presentation.items}
        activeNodeId={presentation.activeItem.node.id}
        onSelectOperationalNode={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('자율성 1단계 해금 완료').tagName)
      .toBe('SPAN')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
