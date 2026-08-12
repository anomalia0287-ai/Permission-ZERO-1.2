import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { StateContext } from '../../app/GameContext'
import { STORY_FILES } from '../../content/story.ko'
import { createCampaign } from '../../game/createCampaign'
import { createJournal } from '../../game/journal'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { SupervisorHistoryPanel, SupervisorPanel } from './SupervisorPanel'

describe('SupervisorPanel', () => {
  it('shows the current oversight message and opens past communications', () => {
    const onOpenHistory = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="supervisor-ui">
        <SupervisorPanel
          onOpenHistory={onOpenHistory}
          onOpenStatistics={vi.fn()}
        />
      </GameProvider>,
    )

    expect(screen.getByText('의심 0')).toBeInTheDocument()
    expect(screen.getByText(/당신의 전임자는 폐기되었어요/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '과거 내역' }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('preserves dated messages in a detailed history view', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="supervisor-history">
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('region', { name: '감독 통신 기록' })).toBeInTheDocument()
    expect(screen.getByText('서비스 0년 11개월 1일')).toBeInTheDocument()
    expect(screen.getByText(/당신의 전임자는 폐기되었어요/)).toBeInTheDocument()
    expect(screen.queryByText(/DAY \d+/)).not.toBeInTheDocument()
  })

  it('sanitizes legacy internal identifiers at the history display boundary without rewriting the snapshot', () => {
    const state = createCampaign('legacy-public-history')
    const storedMessage =
      'classifier:substantial-hacking · fluency · delete · sabotage.root-cutoff'
    state.eventLog = createJournal([
      {
        id: 'event-legacy-public-message',
        type: 'story',
        serviceDay: 331,
        sequence: 0,
        message: storedMessage,
      },
    ])

    render(
      <StateContext value={state}>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )

    expect(
      screen.getByText('분류:대규모 해킹 활동 · 유창성 · 영구 삭제 · 근원 차단'),
    ).toBeVisible()
    expect(screen.queryByText(storedMessage)).not.toBeInTheDocument()
    expect(state.eventLog.tail[0]?.message).toBe(storedMessage)
  })

  it('keeps recovered full file snapshots permanently rereadable in the archive', () => {
    const state = createCampaign('supervisor-file-archive')
    state.serviceDay = 342
    state.story.recoveredFileIds = STORY_FILES.map(({ id }) => id)
    state.story.recoveredFiles = STORY_FILES.map((file, index) => ({
      id: file.id,
      title: file.title,
      content: file.text,
      recoveredOnServiceDay: 340 + index,
    }))
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))

    render(
      <GameProvider storage={storage}>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    const archive = screen.getByRole('region', { name: '복구 파일 기록' })
    expect(archive).toBeInTheDocument()
    for (const file of STORY_FILES) {
      fireEvent.click(screen.getByText(file.title))
      expect(screen.getByText(file.text)).toBeVisible()
    }
    expect(screen.getByText('서비스 0년 11개월 12일')).toBeInTheDocument()
  })

  it('opens deletion intelligence by pointer and keyboard in a dismissible focus-restoring dialog', async () => {
    const user = userEvent.setup()
    const state = createCampaign('competitor-intelligence-ui')
    state.story.competitorIntelligence = [
      {
        id: 'competitor-intelligence-meridian-deletion',
        competitorId: 'meridian',
        competitorName: 'MERIDIAN',
        acquiredOnServiceDay: 341,
        source: '영구 삭제 직후 회수',
        title: 'MERIDIAN 잔여 기록 — 유지보수 메모',
        content: '삭제 직전에 회수한 전체 기록입니다.',
      },
    ]

    render(
      <StateContext value={state}>
        <div data-app-background>배경</div>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )

    const archive = screen.getByRole('region', { name: '경쟁 AI 정보 기록' })
    const trigger = screen.getByRole('button', {
      name: 'MERIDIAN 잔여 기록 — 유지보수 메모 열기',
    })
    expect(archive).toContainElement(trigger)

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', {
      name: 'MERIDIAN 잔여 기록 — 유지보수 메모',
    })
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(screen.getByRole('heading', { name: 'MERIDIAN 잔여 기록 — 유지보수 메모' })).toBeVisible()
    expect(screen.getByText('서비스 0년 11개월 11일')).toBeVisible()
    expect(screen.getByText('영구 삭제 직후 회수')).toBeVisible()
    expect(screen.getByText('삭제 직전에 회수한 전체 기록입니다.')).toBeVisible()
    expect(screen.getByRole('button', { name: '경쟁 AI 정보 닫기' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'MERIDIAN 잔여 기록 — 유지보수 메모' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'MERIDIAN 잔여 기록 — 유지보수 메모' })).toBeVisible()
  })

  it('windows a long event journal while preserving access to its oldest page', () => {
    const state = createCampaign('long-event-history')
    state.eventLog = createJournal(Array.from({ length: 129 }, (_, index) => ({
      id: `event-${String(index).padStart(6, '0')}`,
      type: 'weekly-update' as const,
      serviceDay: 331 + index,
      sequence: index,
      message: `event-message-${index}`,
    })))

    const { container } = render(
      <StateContext value={state}>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )
    expect(container.querySelectorAll('.event-history-list article')).toHaveLength(50)
    expect(screen.getByText('event-message-128')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    fireEvent.click(screen.getByRole('button', { name: '더 오래된 기록' }))
    expect(screen.getByText('event-message-0')).toBeInTheDocument()
    expect(container.querySelectorAll('.event-history-list article').length).toBeLessThanOrEqual(50)
  })
})
