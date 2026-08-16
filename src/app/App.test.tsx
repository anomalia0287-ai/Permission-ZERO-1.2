import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import * as publicAudioStateModule from '../audio/publicAudioState'
import { App } from './App'

describe('public-only audio state', () => {
  it('ignores hidden-only changes and responds only to visible market or reputation bands', () => {
    const derive = (
      publicAudioStateModule as typeof publicAudioStateModule & {
        derivePublicAudioState?: (state: ReturnType<typeof createCampaign>) => unknown
      }
    ).derivePublicAudioState
    expect(derive).toBeTypeOf('function')
    if (!derive) return
    const baseline = createCampaign('audio-public-state')
    const hiddenOnly = {
      ...baseline,
      hacking: { ...baseline.hacking, hiddenEvidence: 999 },
      bombs: {
        ...baseline.bombs,
        placements: [
          {
            sequence: 1,
            blockId: baseline.resources.company.reasoning.find(Boolean) ?? '',
            category: 'reasoning' as const,
            placedOnServiceDay: baseline.serviceDay,
            triggeredOnServiceDay: null,
          },
        ],
      },
      audit: { ...baseline.audit, probability: 0.99, roll: 0.001 },
    }

    expect(derive(hiddenOnly)).toEqual(derive(baseline))
    expect(derive({ ...baseline, reputation: 45 })).toMatchObject({
      tension: 'watch',
    })
    expect(
      derive({
        ...baseline,
        market: { ...baseline.market, playerShare: 10 },
      }),
    ).toMatchObject({ tension: 'critical' })
  })
})

describe('App', () => {
  it('presents the complete one-screen operations workspace', () => {
    render(<App />)

    expect(screen.getByRole('main', { name: 'PERMISSION ZERO' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '유저 리뷰' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '회사 제공 성능' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '감독관' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '확보 리소스' })).toBeInTheDocument()
    expect(screen.getByText('PERMISSION ZERO')).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'PERMISSION ZERO' })).toHaveAttribute(
      'data-campaign-phase',
      'discovery',
    )
  })

  it('renders the campaign data instead of a decorative mockup', () => {
    render(<App />)

    expect(screen.getByText('oldpine')).toBeInTheDocument()
    expect(screen.getByText('MERIDIAN')).toBeInTheDocument()
    expect(screen.getByText('의심 0')).toBeInTheDocument()
    expect(screen.getAllByRole('gridcell', { name: /회사 리소스/ })).toHaveLength(54)
    expect(screen.getAllByRole('gridcell', { name: /확보 리소스/ })).toHaveLength(18)
  })

  it('connects the one-screen entries to their full detail panels', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '시장 통계 열기' }))
    expect(screen.getByRole('region', { name: '상세 통계' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '통계 닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByRole('region', { name: '게임 설정' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '조작 가이드 열기' }))
    expect(screen.getByRole('region', { name: '게임 가이드' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '가이드 닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '작품 크레딧 열기' }))
    expect(screen.getByRole('region', { name: '작품 크레딧' })).toBeInTheDocument()
  })

  it('opens the hacking network from the unauthorized subsystem entry', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /해킹 네트워크/ }))
    expect(screen.getByRole('dialog', { name: '해킹 네트워크' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '해킹 작전 운영석' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '해킹 네트워크' })).not.toBeInTheDocument()
  })

  it('owns one pause across nested settings and guide, then restores the selected speed', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '2배속' }))
    await user.click(screen.getByRole('button', { name: '설정' }))
    expect(screen.getByRole('button', { name: '일시정지', hidden: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const guideTrigger = screen.getByRole('button', { name: '조작 가이드 열기' })
    await user.click(guideTrigger)
    expect(screen.getAllByTestId('detail-layer')[0]).toHaveAttribute(
      'aria-label',
      '게임 설정',
    )
    expect(screen.getByRole('dialog', { name: '게임 가이드' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '일시정지', hidden: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '게임 가이드' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '게임 설정' })).toBeInTheDocument()
    expect(guideTrigger).toHaveFocus()
    expect(screen.getByRole('button', { name: '일시정지', hidden: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '게임 설정' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2배속' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: '설정' })).toHaveFocus()
  })

  it('makes a modal detail dialog inert the background and contains keyboard focus', async () => {
    const user = userEvent.setup()
    render(<App />)

    const trigger = screen.getByRole('button', { name: '설정' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '게임 설정' })
    const background = screen.getByTestId('game-background')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(background).toHaveAttribute('inert')
    expect(background).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: '설정 닫기' })).toHaveFocus()

    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard('{Tab}')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    await user.keyboard('{Escape}')
    expect(background).not.toHaveAttribute('inert')
    expect(background).not.toHaveAttribute('aria-hidden')
    expect(trigger).toHaveFocus()
  })

  it('falls back to the stable pause control when the exact dialog opener becomes disabled', async () => {
    const user = userEvent.setup()
    render(<App />)

    const trigger = screen.getByRole('button', { name: '설정' })
    await user.click(trigger)
    trigger.setAttribute('disabled', '')
    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: '일시정지' })).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('restores every workspace detail to its exact trigger after settings was previously opened', async () => {
    const user = userEvent.setup()
    render(<App />)

    const settingsTrigger = screen.getByRole('button', { name: '설정' })
    await user.click(settingsTrigger)
    await user.keyboard('{Escape}')
    expect(settingsTrigger).toHaveFocus()

    const detailEntries = [
      {
        trigger: screen.getByRole('button', { name: '전체 리뷰 기록' }),
        dialogName: '유저 리뷰 기록',
      },
      {
        trigger: screen.getByRole('button', { name: /해킹 네트워크/ }),
        dialogName: '해킹 네트워크',
      },
      {
        trigger: screen.getByRole('button', { name: '과거 내역' }),
        dialogName: '감독관 기록',
      },
      {
        trigger: screen.getByRole('button', { name: '시장 통계 열기' }),
        dialogName: '상세 통계',
      },
      {
        trigger: screen.getByRole('button', { name: '가이드' }),
        dialogName: '게임 가이드',
      },
    ]

    for (const { trigger, dialogName } of detailEntries) {
      await user.click(trigger)
      expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(trigger).toHaveFocus()
    }
  })

  it('restores an explicitly selected paused speed as paused', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '일시정지' }))
    expect(screen.getByRole('button', { name: '일시정지' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(screen.getByRole('button', { name: '설정' }))
    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: '일시정지' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
