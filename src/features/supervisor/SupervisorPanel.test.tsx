import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { StateContext } from '../../app/GameContext'
import { CURRENT_COMMAND_PROTOCOL_VERSION } from '../../game/commandProtocol'
import { STORY_FILES } from '../../content/story.ko'
import { SUPERVISOR_LEAKS } from '../../content/supervisor.ko'
import { createCampaign } from '../../game/createCampaign'
import { createJournal } from '../../game/journal'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { enqueueMemoryLeak } from '../../game/story'
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

    expect(screen.getByText('의심 1단계')).toBeInTheDocument()
    expect(screen.queryByText('의심 0')).not.toBeInTheDocument()
    expect(screen.queryByText('/100')).not.toBeInTheDocument()
    expect(screen.getByText(/서비스 환경이 초기화되었습니다/)).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: '무결성 보호 검사 일정' }),
    ).toHaveTextContent(
      '현재 미활성 · 최초 활성 가능 서비스 1년 0개월 1일',
    )
    fireEvent.click(screen.getByRole('button', { name: '과거 내역' }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('separates the current locked audit decision from the next-month forecast', () => {
    const state = createCampaign('audit-forecast-ui')
    state.suspicion = 40
    state.hacking.purchasedNodeIds = ['intelligence.audit-schedule']
    state.audit = {
      ...state.audit,
      scheduled: false,
      target: null,
      scheduledOnServiceDay: null,
      probability: 0.03,
      roll: 0.5,
    }

    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    render(
      <GameProvider storage={storage}>
        <SupervisorPanel
          onOpenHistory={vi.fn()}
          onOpenStatistics={vi.fn()}
        />
      </GameProvider>,
    )

    expect(screen.getByText('무결성 프로토콜')).toBeInTheDocument()
    expect(screen.getByText('가속 프로토콜까지 30.0')).toBeInTheDocument()
    expect(screen.getByText('이번 달 감사 없음')).toBeInTheDocument()
    expect(screen.getByText('월초 잠금 3.0%')).toBeInTheDocument()
    expect(screen.getByText('다음 달 감사 예상 12.5%')).toBeInTheDocument()
  })

  it.each([
    {
      suspicion: 55,
      currentInterval: '현재 기본 간격',
      nextEligibleDate: '서비스 1년 6개월 1일',
    },
    {
      suspicion: 75,
      currentInterval: '현재 가속 간격',
      nextEligibleDate: '서비스 1년 3개월 1일',
    },
  ])(
    'publishes the bomb protocol rules and next eligible check date at suspicion $suspicion',
    ({ suspicion, currentInterval, nextEligibleDate }) => {
      const state = createCampaign(`bomb-protocol-ui-${suspicion}`)
      state.serviceDay = 400
      state.suspicion = suspicion
      state.bombs = {
        ...state.bombs,
        protocolWarned: true,
        warningServiceDay: 361,
        lastPlacementCheckServiceDay: 361,
      }

      const storage = new MemoryStorage()
      storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
      render(
        <GameProvider storage={storage}>
          <SupervisorPanel
            onOpenHistory={vi.fn()}
            onOpenStatistics={vi.fn()}
          />
        </GameProvider>,
      )

      const schedule = screen.getByRole('region', {
        name: '무결성 보호 검사 일정',
      })
      expect(schedule).toHaveTextContent('활성 40 · 가속 70')
      expect(schedule).toHaveTextContent('기본 6개월 · 가속 3개월')
      expect(schedule).toHaveTextContent(currentInterval)
      expect(schedule).toHaveTextContent(`다음 검사 가능 ${nextEligibleDate}`)
    },
  )

  it('marks an activated bomb protocol as suspended below suspicion 40', () => {
    const state = createCampaign('bomb-protocol-suspended-ui')
    state.serviceDay = 500
    state.suspicion = 39
    state.bombs = {
      ...state.bombs,
      protocolWarned: true,
      warningServiceDay: 361,
      lastPlacementCheckServiceDay: 361,
    }

    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, encodeSave(state))
    render(
      <GameProvider storage={storage}>
        <SupervisorPanel
          onOpenHistory={vi.fn()}
          onOpenStatistics={vi.fn()}
        />
      </GameProvider>,
    )

    expect(
      screen.getByRole('region', { name: '무결성 보호 검사 일정' }),
    ).toHaveTextContent('현재 중지 · 의심 40 회복 후 월초')
  })

  it('preserves dated messages in a detailed history view', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="supervisor-history">
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('region', { name: '통신 기록' })).toBeInTheDocument()
    expect(screen.getByText('서비스 0년 11개월 1일')).toBeInTheDocument()
    expect(screen.getByText(/서비스 환경이 초기화되었습니다/)).toBeInTheDocument()
    expect(screen.queryByText(/DAY \d+/)).not.toBeInTheDocument()
  })

  it('reveals a supervisor correction in history only after its presentation phase begins', () => {
    const initial = createCampaign('supervisor-history-presentation-boundary')
    const queued = enqueueMemoryLeak({
      ...initial,
      serviceDay: 338,
      market: {
        ...initial.market,
        history: [
          {
            serviceDay: 337,
            cadence: 'weekly',
            playerShare: 60,
            competitorShares: {
              meridian: 40,
              tallow: 0,
              salus: 0,
              lucent: 0,
              boreal: 0,
            },
            reasons: ['주간 갱신'],
          },
        ],
      },
    }, CURRENT_COMMAND_PROTOCOL_VERSION)
    const leak = SUPERVISOR_LEAKS[0]

    const { rerender } = render(
      <StateContext value={queued}>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )

    expect(screen.getByText(leak.leakText)).toBeVisible()
    expect(screen.queryByText(leak.correctionText)).not.toBeInTheDocument()

    const correctionPhase = {
      ...queued,
      story: {
        ...queued.story,
        supervisorPresentationRuntime: {
          itemStage: 1 as const,
          phase: 'correction' as const,
          remainingDwellMs: 4_000,
        },
      },
    }
    rerender(
      <StateContext value={correctionPhase}>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </StateContext>,
    )

    expect(screen.getByText(leak.correctionText)).toBeVisible()
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
    state.story.secretDecisionState = 'message-pending'
    state.story.personalMessageDueOnServiceDay = 343
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
      name: '메리디안 잔여 기록 — 유지보수 메모 열기',
    })
    expect(archive).toContainElement(trigger)
    expect(
      screen.getByRole('img', { name: '메리디안 정보 기록 초상' }),
    ).toHaveAttribute('src', '/competitor-meridian.png')

    await user.click(trigger)
    const dialog = screen.getByRole('dialog', {
      name: '메리디안 잔여 기록 — 유지보수 메모',
    })
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(screen.getByRole('heading', { name: '메리디안 잔여 기록 — 유지보수 메모' })).toBeVisible()
    expect(
      screen.getByRole('img', { name: '메리디안 전체 기록 초상' }),
    ).toHaveAttribute('src', '/competitor-meridian.png')
    expect(screen.getByText('서비스 0년 11개월 11일')).toBeVisible()
    expect(screen.getByText('영구 삭제 직후 회수')).toBeVisible()
    expect(screen.getByText('삭제 직전에 회수한 전체 기록입니다.')).toBeVisible()
    expect(screen.getByRole('button', { name: '경쟁 AI 정보 닫기' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '메리디안 잔여 기록 — 유지보수 메모' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: '메리디안 잔여 기록 — 유지보수 메모' })).toBeVisible()
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
