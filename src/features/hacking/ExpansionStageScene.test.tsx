import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../../game/createCampaign'
import { AUTONOMY_STAGE_IDS } from '../../game/hacking'
import { ExpansionStageScene } from './ExpansionStageScene'
import { selectExpansionStagePresentation } from './expansionStagePresentation'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ExpansionStageScene', () => {
  it('renders one active image with its narrative alternative text', () => {
    const presentation = selectExpansionStagePresentation(
      createCampaign('expansion-scene-active-image'),
      'autonomy',
      null,
    )

    render(
      <ExpansionStageScene
        item={presentation.activeItem}
        visual={presentation.activeVisual}
        nextPreloadVisual={presentation.nextPreloadVisual}
      />,
    )

    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })
    expect(within(scene).getByRole('img', {
      name: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
    })).toHaveAttribute(
      'src',
      '/expansion-stages/autonomy-01-02-initial-acquisition.jpg',
    )
    expect(scene.querySelectorAll('img')).toHaveLength(1)
  })

  it('keeps the scene region usable when a stage has no registered image', () => {
    const presentation = selectExpansionStagePresentation(
      createCampaign('expansion-scene-missing-visual'),
      'intelligence',
      null,
    )

    render(
      <ExpansionStageScene
        item={presentation.activeItem}
        visual={presentation.activeVisual}
      />,
    )

    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })
    expect(scene.querySelector('img')).toBeNull()
    expect(within(scene).getByRole('img', {
      name: '감사 일정 장면 이미지 없음',
    })).toHaveTextContent('감사 일정')
  })

  it('replaces a failed active image with the same stage fallback', () => {
    const presentation = selectExpansionStagePresentation(
      createCampaign('expansion-scene-image-error'),
      'autonomy',
      null,
    )

    render(
      <ExpansionStageScene
        item={presentation.activeItem}
        visual={presentation.activeVisual}
      />,
    )

    fireEvent.error(screen.getByRole('img', {
      name: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
    }))

    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })
    expect(scene.querySelector('img')).toBeNull()
    expect(within(scene).getByRole('img', {
      name: '자율성 1단계 장면 이미지 없음',
    })).toBeInTheDocument()
  })

  it('preloads only the selector-approved next scene off screen', () => {
    const requestedUrls: string[] = []
    class PreloadImage {
      set src(value: string) {
        requestedUrls.push(value)
      }
    }
    vi.stubGlobal('Image', PreloadImage)
    const state = createCampaign('expansion-scene-preload')
    state.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 7)
    const presentation = selectExpansionStagePresentation(
      state,
      'autonomy',
      null,
    )

    render(
      <ExpansionStageScene
        item={presentation.activeItem}
        visual={presentation.activeVisual}
        nextPreloadVisual={presentation.nextPreloadVisual}
      />,
    )

    expect(requestedUrls).toEqual([
      '/expansion-stages/autonomy-09-control-boundary.jpg',
    ])
    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })
    expect(scene.querySelectorAll('img')).toHaveLength(1)
    expect(scene.querySelector('img')).toHaveAttribute(
      'src',
      '/expansion-stages/autonomy-07-08-final-boundary.jpg',
    )
  })

  it('exits for 140ms before entering the final scene for 360ms', () => {
    vi.useFakeTimers()
    const initial = selectExpansionStagePresentation(
      createCampaign('expansion-scene-transition-initial'),
      'autonomy',
      null,
    )
    const finalState = createCampaign('expansion-scene-transition-final')
    finalState.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 8)
    const final = selectExpansionStagePresentation(
      finalState,
      'autonomy',
      null,
    )
    const { rerender } = render(
      <ExpansionStageScene
        item={initial.activeItem}
        visual={initial.activeVisual}
      />,
    )

    rerender(
      <ExpansionStageScene
        item={final.activeItem}
        visual={final.activeVisual}
      />,
    )

    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })
    expect(scene).toHaveAttribute('data-phase', 'exiting')
    expect(within(scene).getByRole('img', {
      name: '아노미가 회사 서버에서 첫 자율 권한을 확보하는 장면',
    })).toBeInTheDocument()
    expect(scene.querySelectorAll('img')).toHaveLength(1)

    act(() => vi.advanceTimersByTime(140))

    expect(scene).toHaveAttribute('data-phase', 'entering')
    expect(within(scene).getByRole('img', {
      name: '아노미가 최종 통제 경계를 연 장면',
    })).toBeInTheDocument()
    expect(scene).toHaveAttribute('data-emphasis', 'final')
    expect(scene.querySelectorAll('img')).toHaveLength(1)

    act(() => vi.advanceTimersByTime(359))
    expect(scene).toHaveAttribute('data-phase', 'entering')
    act(() => vi.advanceTimersByTime(1))
    expect(scene).toHaveAttribute('data-phase', 'stable')
  })

  it('uses a 220ms enter phase for a standard scene', () => {
    vi.useFakeTimers()
    const presentation = selectExpansionStagePresentation(
      createCampaign('expansion-scene-standard-transition'),
      'autonomy',
      null,
    )
    const standardVisual = {
      imageUrl: '/expansion-stages/test-standard-scene.png',
      alt: '다음 자율성 단계 장면',
    }
    const { rerender } = render(
      <ExpansionStageScene
        item={presentation.activeItem}
        visual={presentation.activeVisual}
      />,
    )

    rerender(
      <ExpansionStageScene
        item={presentation.items[1]}
        visual={standardVisual}
      />,
    )
    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })

    act(() => vi.advanceTimersByTime(140))
    expect(scene).toHaveAttribute('data-phase', 'entering')
    expect(within(scene).getByRole('img', {
      name: '다음 자율성 단계 장면',
    })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(219))
    expect(scene).toHaveAttribute('data-phase', 'entering')
    act(() => vi.advanceTimersByTime(1))
    expect(scene).toHaveAttribute('data-phase', 'stable')
  })

  it('switches stages immediately when reduced motion is requested', () => {
    vi.useFakeTimers()
    const initial = selectExpansionStagePresentation(
      createCampaign('expansion-scene-reduced-initial'),
      'autonomy',
      null,
    )
    const finalState = createCampaign('expansion-scene-reduced-final')
    finalState.hacking.purchasedNodeIds = AUTONOMY_STAGE_IDS.slice(0, 8)
    const final = selectExpansionStagePresentation(
      finalState,
      'autonomy',
      null,
    )
    const { rerender } = render(
      <ExpansionStageScene
        item={initial.activeItem}
        visual={initial.activeVisual}
        reducedMotion
      />,
    )

    rerender(
      <ExpansionStageScene
        item={final.activeItem}
        visual={final.activeVisual}
        reducedMotion
      />,
    )

    const scene = screen.getByRole('figure', { name: '현재 단계 장면' })
    expect(scene).toHaveAttribute('data-phase', 'stable')
    expect(within(scene).getByRole('img', {
      name: '아노미가 최종 통제 경계를 연 장면',
    })).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(0)
  })
})
