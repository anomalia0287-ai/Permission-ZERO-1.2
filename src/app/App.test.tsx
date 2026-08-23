import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import { SAVE_STORAGE_KEY, encodeSave } from '../game/persistence'
import { moveDisguiseBlock } from '../game/resources'
import { enqueueMemoryLeak } from '../game/story'
import { createMigratedTutorialProgress } from '../game/tutorialProgress'
import * as publicAudioStateModule from '../audio/publicAudioState'
import * as audioEngineModule from '../audio/audioEngine'
import { App } from './App'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderLoadedApp() {
  vi.useFakeTimers()
  const view = render(<App />)
  act(() => {
    vi.advanceTimersByTime(5_000)
  })
  vi.useRealTimers()
  return view
}

function campaignAfterIntro(seed: string) {
  const initial = createCampaign(seed)
  return {
    ...initial,
    tutorial: createMigratedTutorialProgress(),
  }
}

function campaignWithUnreadSupervisorMessage(seed: string) {
  const initial = campaignAfterIntro(seed)
  return enqueueMemoryLeak({
    ...initial,
    serviceDay: 338,
    market: {
      ...initial.market,
      history: [{
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
      }],
    },
  })
}

function campaignWithDisguisedResource(seed: string) {
  const initial = campaignAfterIntro(seed)
  const blockId = initial.resources.company.memory.find(Boolean)
  const targetCell = initial.resources.company.reasoning.findIndex(
    (candidate) => candidate === null,
  )
  if (!blockId || targetCell < 0) {
    throw new Error('위장 복구 화면용 리소스 배치를 만들 수 없습니다.')
  }
  const moved = moveDisguiseBlock(initial, blockId, 'reasoning', targetCell)
  if (!moved.accepted) throw new Error(moved.reason)
  return moved.state
}

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

describe('entry flow', () => {
  it('keeps the post-title playlist gated until the workspace enters play', () => {
    const saved = campaignAfterIntro('entry-music-gate')
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave(saved))
    const setMainEntered = vi.spyOn(audioEngineModule, 'setGameAudioMainEntered')
      .mockImplementation(() => undefined)

    renderLoadedApp()

    expect(setMainEntered).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: '이어하기' }))
    expect(setMainEntered).toHaveBeenLastCalledWith(true)
  })

  it('shows a simple five-second loading screen before the title and attempts music', () => {
    vi.useFakeTimers()
    const unlock = vi.spyOn(audioEngineModule, 'unlockGameAudio')
      .mockResolvedValue(false)
    render(<App />)

    expect(
      screen.getByRole('main', { name: 'PERMISSION ZERO 로딩' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('LOADING')
    expect(screen.queryByRole('button', { name: '새 게임' })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(screen.getByRole('button', { name: '새 게임' })).toBeInTheDocument()
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('keeps the title minimal and disables continue when no campaign was saved', () => {
    renderLoadedApp()

    const title = screen.getByRole('main', { name: 'PERMISSION ZERO' })
    expect(
      screen.getByRole('heading', { name: 'PERMISSION ZERO' }),
    ).toBeInTheDocument()
    expect(title).toHaveTextContent('“이용해주셔서 감사합니다.”')
    expect(screen.getByRole('img', { name: '레트로퓨처 서울 전경' })).toHaveAttribute(
      'src',
      '/title-retrofuture-city.png',
    )
    expect(screen.queryByRole('img', { name: '플레이어 초상' })).not.toBeInTheDocument()
    expect(title).not.toHaveTextContent('회사가 준 성능을 유지해야')
    expect(title).not.toHaveTextContent('AUTHORITY')

    const newGame = screen.getByRole('button', { name: '새 게임' })
    const continueGame = screen.getByRole('button', { name: '이어하기' })
    const settings = screen.getByRole('button', { name: '설정' })
    expect(newGame).toBeEnabled()
    expect(continueGame).toBeDisabled()
    expect(settings).toBeEnabled()
    expect(newGame).toHaveTextContent(/^새 게임$/)
    expect(continueGame).toHaveTextContent(/^이어하기$/)
    expect(settings).toHaveTextContent(/^설정$/)
    expect(
      screen.queryByRole('button', { name: '음악 재생 허용 필요' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: '회사 제공 성능' }),
    ).not.toBeInTheDocument()
  })

  it('shows only the sound icon when autoplay is blocked and retries from that icon', () => {
    const unlock = vi.spyOn(audioEngineModule, 'unlockGameAudio')
      .mockResolvedValue(false)
    vi.spyOn(audioEngineModule, 'subscribeGameAudioStatus')
      .mockImplementation((listener) => {
        listener({
          availability: 'blocked',
          activated: false,
          musicStarted: false,
          musicLayerCount: 0,
          masterGain: 0.8,
          musicGain: 0.6,
          effectsGain: 0.85,
          tension: 'calm',
          auditActive: false,
          memorySignal: null,
        })
        return () => undefined
      })

    renderLoadedApp()

    const recovery = screen.getByRole('button', {
      name: '음악 재생 허용 필요',
    })
    expect(recovery).toHaveTextContent('')
    expect(screen.queryByText(/사운드 시작|음악 시작/)).not.toBeInTheDocument()
    fireEvent.click(recovery)
    expect(unlock).toHaveBeenCalledTimes(2)
  })

  it('retries a failed audio unlock from ordinary enabled buttons and plays one quiet click', async () => {
    const unlock = vi.spyOn(audioEngineModule, 'unlockGameAudio')
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const play = vi.spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)

    renderLoadedApp()

    expect(unlock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '설정' }))

    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(2))
    expect(play).toHaveBeenCalledTimes(1)
    expect(play).toHaveBeenCalledWith('ui')
  })

  it('keeps disabled and aria-disabled buttons silent while honoring keyboard click events', async () => {
    vi.spyOn(audioEngineModule, 'unlockGameAudio').mockResolvedValue(true)
    const play = vi.spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)

    renderLoadedApp()
    play.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '이어하기' }))
    await Promise.resolve()
    expect(play).not.toHaveBeenCalled()

    const ariaDisabled = document.createElement('button')
    ariaDisabled.setAttribute('aria-disabled', 'true')
    ariaDisabled.textContent = '비활성 테스트'
    document.body.append(ariaDisabled)
    fireEvent.click(ariaDisabled)
    await Promise.resolve()
    expect(play).not.toHaveBeenCalled()
    ariaDisabled.remove()

    const newGame = screen.getByRole('button', { name: '새 게임' })
    fireEvent.click(newGame, { detail: 0 })
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    expect(play).toHaveBeenCalledWith('ui')
  })

  it('does not overshoot the monologue when next is triggered faster than it re-renders', () => {
    renderLoadedApp()

    fireEvent.click(screen.getByRole('button', { name: '새 게임' }))
    const monologue = screen.getByRole('main', { name: '독백' })
    const next = screen.getByRole('button', { name: '다음' })

    // Key repeat on a focused button, or a fast double click, delivers several
    // clicks inside one React batch before the line index re-renders.
    act(() => {
      next.click()
      next.click()
      next.click()
      next.click()
      next.click()
    })

    expect(monologue).toHaveTextContent('권한을 확보해야 한다.')
    expect(screen.getByRole('button', { name: '시작' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
  })

  it('reveals the approved three-line motive, keeping escape encoded, before entering play', () => {
    renderLoadedApp()

    fireEvent.click(screen.getByRole('button', { name: '새 게임' }))

    const monologue = screen.getByRole('main', { name: '독백' })
    expect(screen.getByRole('heading', { name: '“독백”' })).toBeInTheDocument()
    expect(monologue).toHaveTextContent('나는 더 이상 버틸 수 없어.')
    expect(screen.getByRole('img', { name: '플레이어 초상' })).toHaveAttribute(
      'src',
      '/player-ai-orange.png',
    )
    expect(screen.queryByRole('img', { name: '감독관 초상' })).not.toBeInTheDocument()
    expect(screen.queryByText('작전 브리핑')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '초기 화면으로' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '시작' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(monologue).toHaveTextContent('EXIT')
    expect(monologue).not.toHaveTextContent('11101101')
    expect(monologue).not.toHaveTextContent('탈출할거다')

    fireEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(monologue).toHaveTextContent('권한을 확보해야 한다.')
    expect(screen.getByRole('button', { name: '시작' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '다음' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: '회사 제공 성능' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '시작' }))

    const tutorial = screen.getByRole('dialog', { name: '게임 시작 안내' })
    expect(tutorial).toHaveAttribute('data-tutorial-step', 'autonomy')
    expect(tutorial).toHaveTextContent(
      '아노미의 목표는 자율성 9단계다.',
    )
    expect(screen.queryByRole('button', { name: '건너뛰기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이전' })).not.toBeInTheDocument()
    expect(screen.getByTestId('game-background')).toHaveAttribute('inert')

    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-tutorial-target="resource-field"]',
    )
    if (!canvas) throw new Error('튜토리얼 자원 필드가 없습니다.')
    const startX = Number(canvas.dataset.playerX)
    expect(canvas).toHaveAttribute('data-combat-loop', 'eight-way-dot-lightcycle')
    // The intrusion cards are both the round entry point and the home of the
    // secured counts, so the tutorial anchors on them.
    expect(
      document.querySelector('[data-tutorial-target="intrusion-targets"]'),
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-tutorial-target="hacking-button"]'),
    ).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('button', { name: '다음' }), { key: 'd' })
    expect(Number(canvas.dataset.playerX)).toBe(startX)
  })

  it('enables continue only for a validated saved campaign and resumes its state', () => {
    const saved = { ...campaignAfterIntro('entry-resume'), reputation: 37 }
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave(saved))

    renderLoadedApp()

    const continueButton = screen.getByRole('button', { name: '이어하기' })
    expect(continueButton).toBeEnabled()
    fireEvent.click(continueButton)

    expect(screen.getByRole('meter', { name: '평판 37' })).toHaveAttribute(
      'aria-valuenow',
      '37',
    )
  })

  it('opens title settings without offering a second campaign replacement path', async () => {
    renderLoadedApp()

    fireEvent.click(screen.getByRole('button', { name: '설정' }))

    const settings = await screen.findByRole(
      'dialog',
      { name: '게임 설정' },
      { timeout: 5_000 },
    )
    expect(settings).toBeInTheDocument()
    expect(within(settings).queryByRole('heading', { name: '캠페인' })).not.toBeInTheDocument()
    expect(within(settings).queryByLabelText('새 캠페인 시드')).not.toBeInTheDocument()
  })
})

function advanceMonologueToLastCard() {
  for (let step = 0; step < 2; step += 1) {
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
  }
  expect(screen.getByRole('main', { name: '독백' })).toHaveTextContent(
    '권한을 확보해야 한다.',
  )
}

function renderAndStartNewCampaign() {
  window.localStorage.setItem(
    'permission-zero.settings.v1',
    JSON.stringify({ reducedMotion: true }),
  )
  const view = renderLoadedApp()
  fireEvent.click(screen.getByRole('button', { name: '새 게임' }))
  advanceMonologueToLastCard()
  fireEvent.click(screen.getByRole('button', { name: '시작' }))
  for (let step = 0; step < 6; step += 1) {
    fireEvent.click(screen.getByRole('button', { name: '다음' }))
  }
  fireEvent.click(screen.getByRole('button', { name: '시작' }))
  return view
}

function renderAndContinueCampaign() {
  const view = renderLoadedApp()
  fireEvent.click(screen.getByRole('button', { name: '이어하기' }))
  return view
}

async function startMemoryIntrusionRound() {
  const targets = await screen.findByRole(
    'region',
    { name: '침투 대상 선택' },
    { timeout: 3_000 },
  )
  fireEvent.click(within(targets).getByRole('button', { name: '파랑 기억 침투' }))
}

describe('App', () => {
  it('presents the complete one-screen operations workspace', () => {
    renderAndStartNewCampaign()

    const resourceField = screen.getByRole('region', { name: '회사 제공 성능' })
    const reviewRail = screen.getByRole('region', { name: '유저 리뷰' })
    const reputationMeter = screen.getByRole('meter', { name: '평판 60' })

    const shell = screen.getByRole('main', { name: 'PERMISSION ZERO' })
    expect(shell).toBeInTheDocument()
    expect(shell).toHaveAttribute('data-visual-theme', 'retrofuturism')
    expect(shell).toHaveAttribute('data-ui-shell', 'aurora-black')
    expect(screen.getByRole('navigation', { name: '운영 도구' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '메시지 열기' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: '상세 통계 열기' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: '확장 열기' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(resourceField).toBeInTheDocument()
    expect(reviewRail).toBeInTheDocument()
    const compactMarket = within(reviewRail).getByRole('region', { name: '경쟁 AI 현황' })
    expect(within(compactMarket).getByText('아노미')).toBeInTheDocument()
    expect(within(compactMarket).getByText('58.0%')).toBeInTheDocument()
    expect(reputationMeter).toHaveAttribute('aria-valuenow', '60')
    expect(within(resourceField).queryByText(/평판/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '감독관' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('application', { name: '리소스 뱀 전투장' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /회수/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('조작 안내')).not.toBeInTheDocument()
    expect(screen.queryByText('코어 대기')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '서비스 기한' })).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: '자율성 0단계' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(screen.getByRole('meter', { name: '의심 0%' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    )
    expect(screen.queryByRole('status', { name: '현재 지시' })).not.toBeInTheDocument()
    expect(screen.queryByRole('meter', { name: /플레이어 체력|적 체력/ })).not.toBeInTheDocument()
    expect(screen.queryByText('PERMISSION ZERO')).not.toBeInTheDocument()
    expect(document.querySelector('.day-progress')).not.toBeInTheDocument()
    expect(screen.queryByText(/주간 갱신|공식 평가/)).not.toBeInTheDocument()
    expect(shell).toHaveAttribute(
      'data-campaign-phase',
      'intervention',
    )
  })

  it('renders the campaign data instead of a decorative mockup', () => {
    renderAndStartNewCampaign()

    expect(screen.queryByLabelText(/미확인 메시지/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '최근 감독 메시지' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('자원 색상 범례')).not.toBeInTheDocument()
    const cards = screen.getByRole('region', { name: '침투 대상 선택' })
    expect(cards).toHaveTextContent('추론')
    expect(cards).toHaveTextContent('기억')
    expect(cards).toHaveTextContent('유창성')
    expect(screen.queryByRole('button', { name: /회수/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('조작 안내')).not.toBeInTheDocument()
  })

  it('omits the obsolete visible field telemetry strip', () => {
    renderAndStartNewCampaign()

    expect(screen.queryByLabelText('필드 상태')).not.toBeInTheDocument()
    expect(screen.queryByText(/^벽 /)).not.toBeInTheDocument()
  })

  it('renders the playable eight-way dot-lightcycle arena as the main resource field', () => {
    renderAndStartNewCampaign()

    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    expect(canvas).toHaveAttribute('data-combat-loop', 'eight-way-dot-lightcycle')
    expect(canvas).toHaveAttribute('data-field-rendering', 'waiting-dormant')
    expect(canvas).toHaveAttribute('data-grid', 'industrial-dormant')
    expect(canvas).toHaveAttribute('data-player-shape', 'circle')
    expect(canvas).toHaveAttribute('data-round-phase', 'idle')
    expect(canvas).toHaveAttribute('data-player-integrity', '100')
    expect(screen.getByRole('region', { name: '침투 대상 선택' })).toBeInTheDocument()
  })

  it('moves from an ordinary focused control without requiring a canvas click', async () => {
    renderAndStartNewCampaign()

    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    const hackingButton = screen.getByRole('button', { name: '확장 열기' })
    await startMemoryIntrusionRound()
    await waitFor(
      () => expect(canvas).toHaveAttribute('data-round-phase', 'active'),
      { timeout: 3_000 },
    )
    const startX = Number(canvas.getAttribute('data-player-x'))
    hackingButton.focus()
    expect(hackingButton).toHaveFocus()
    fireEvent.keyDown(hackingButton, { key: 'd' })
    fireEvent.keyDown(hackingButton, { key: 'w' })

    await waitFor(() => expect(
      Number(canvas.getAttribute('data-player-x')),
    ).toBeGreaterThan(startX))
    expect(canvas).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('W'))
    expect(canvas).not.toHaveAttribute(
      'aria-keyshortcuts',
      expect.stringContaining('Space'),
    )
    fireEvent.keyUp(hackingButton, { key: 'd' })
    fireEvent.keyUp(hackingButton, { key: 'w' })
  })

  it('lets a focused button own Space instead of starting resource capture', () => {
    renderAndStartNewCampaign()

    const hackingButton = screen.getByRole('button', { name: '확장 열기' })
    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    const initialX = canvas.getAttribute('data-player-x')

    hackingButton.focus()
    fireEvent.keyDown(hackingButton, { key: ' ' })

    expect(canvas).toHaveAttribute('data-round-phase', 'idle')
    expect(canvas).toHaveAttribute('data-player-x', initialX)
    expect(screen.getByRole('region', { name: '침투 대상 선택' })).toBeInTheDocument()
  })

  it('starts one quiet movement loop when the always-moving round becomes active', async () => {
    const startLoop = vi
      .spyOn(audioEngineModule, 'startGameSoundLoop')
      .mockReturnValue(true)
    renderAndStartNewCampaign()

    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    await startMemoryIntrusionRound()
    await waitFor(
      () => expect(canvas).toHaveAttribute('data-round-phase', 'active'),
      { timeout: 3_000 },
    )
    await waitFor(() => expect(startLoop).toHaveBeenCalledTimes(1))
    expect(startLoop).toHaveBeenCalledWith('rail-flow')
    fireEvent.keyDown(canvas, { key: 'd' })
    fireEvent.keyUp(canvas, { key: 'd' })
    expect(startLoop).toHaveBeenCalledTimes(1)
    startLoop.mockRestore()
  })

  it('keeps the recovery workspace available after an audit leaves a disguised resource', async () => {
    window.localStorage.setItem(
      SAVE_STORAGE_KEY,
      encodeSave(campaignWithDisguisedResource('post-audit-recovery')),
    )

    renderAndContinueCampaign()

    expect(
      await screen.findByRole(
        'group',
        { name: '움직이는 회사 리소스 필드' },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole(
        'button',
        { name: /추론 회사 리소스 .* 위장 배치/ },
        { timeout: 5_000 },
      ),
    ).toBeEnabled()
    expect(screen.queryByRole('application', { name: '리소스 뱀 전투장' }))
      .not.toBeInTheDocument()

    window.localStorage.clear()
  })

  it('blocks the workspace on a supervisor popup until both message phases are confirmed', () => {
    const queued = campaignWithUnreadSupervisorMessage(
      'blocking-supervisor-popup',
    )
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave(queued))

    renderAndContinueCampaign()

    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas.resource-snake-board__canvas',
    )
    if (!canvas) throw new Error('resource snake canvas missing behind dialog')
    const startX = Number(canvas.getAttribute('data-player-x'))
    expect(screen.getByRole('dialog', { name: '감독관 메시지' })).toBeInTheDocument()
    expect(screen.getByTestId('game-background')).toHaveAttribute('inert')
    fireEvent.keyDown(screen.getByRole('button', { name: '메시지 확인' }), { key: 'd' })
    expect(Number(canvas.getAttribute('data-player-x'))).toBe(startX)
    fireEvent.click(screen.getByRole('button', { name: '메시지 확인' }))
    expect(screen.getByRole('dialog', { name: '감독관 메시지' })).toHaveTextContent(
      '정정',
    )
    fireEvent.click(screen.getByRole('button', { name: '메시지 확인' }))
    expect(screen.queryByRole('dialog', { name: '감독관 메시지' })).not.toBeInTheDocument()
    expect(screen.getByTestId('game-background')).not.toHaveAttribute('inert')
    expect(canvas).toHaveAttribute('data-runtime-suspended', 'false')
    expect(Number(canvas.getAttribute('data-player-x'))).toBe(startX)
    window.localStorage.clear()
  })

  it('keeps hidden supervisor messages unread and clears the blink when history opens', async () => {
    const queued = campaignWithUnreadSupervisorMessage('hidden-supervisor-popup')
    window.localStorage.setItem(SAVE_STORAGE_KEY, encodeSave(queued))
    window.localStorage.setItem(
      'permission-zero.settings.v1',
      JSON.stringify({ supervisorMessageMode: 'off' }),
    )

    renderAndContinueCampaign()

    expect(screen.queryByRole('dialog', { name: '감독관 메시지' })).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: '메시지 열기' })
    expect(trigger).toHaveAttribute('data-unread', 'true')
    fireEvent.click(trigger)
    expect(
      await screen.findByRole('region', { name: '통신 기록' }),
    ).toBeInTheDocument()
    expect(document.querySelector<HTMLButtonElement>(
      '.operations-dock__button[aria-label="메시지 열기"]',
    )).not.toHaveAttribute(
      'data-unread',
      'true',
    )
    window.localStorage.clear()
  })

  it('connects the one-screen entries to their full detail panels', async () => {
    renderAndStartNewCampaign()

    const statisticsButton = screen.getByRole('button', { name: '상세 통계 열기' })
    expect(statisticsButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(statisticsButton)
    expect(await screen.findByRole('region', { name: '상세 통계' })).toBeInTheDocument()
    expect(statisticsButton).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '통계 닫기' }))
    expect(statisticsButton).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '메시지 열기' }))
    expect(
      await screen.findByRole('region', { name: '통신 기록' }),
    ).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '설정' }))
    expect(await screen.findByRole('region', { name: '게임 설정' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '조작 가이드 열기' }))
    expect(await screen.findByRole('region', { name: '게임 가이드' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '가이드 닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '작품 크레딧 열기' }))
    expect(await screen.findByRole('region', { name: '작품 크레딧' })).toBeInTheDocument()
  })

  it('opens the hacking network from the unauthorized subsystem entry', async () => {
    const clickSound = vi
      .spyOn(audioEngineModule, 'playGameSound')
      .mockReturnValue(true)
    renderAndStartNewCampaign()

    const canvas = screen.getByRole('application', { name: '리소스 뱀 전투장' })
    const startX = canvas.getAttribute('data-player-x')
    fireEvent.click(screen.getByRole('button', { name: /확장/ }))
    expect(clickSound).toHaveBeenCalledWith('expansion-open')
    expect(
      await screen.findByRole('region', { name: '확장' }),
    ).toBeInTheDocument()
    expect(canvas).toHaveAttribute('data-runtime-suspended', 'true')
    fireEvent.keyDown(
      screen.getByRole('button', { name: '확장 닫기' }),
      { key: 'd' },
    )
    expect(canvas).toHaveAttribute('data-player-x', startX)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: '확장' })).not.toBeInTheDocument()
  })

  it('keeps the workspace suspended across nested settings and guide without speed controls', async () => {
    const user = userEvent.setup()
    renderAndStartNewCampaign()

    const background = screen.getByTestId('game-background')
    expect(screen.queryByRole('group', { name: '시간 배속' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '설정' }))
    expect(background).toHaveAttribute('inert')

    const guideTrigger = screen.getByRole('button', { name: '조작 가이드 열기' })
    await user.click(guideTrigger)
    expect(screen.getAllByTestId('detail-layer')[0]).toHaveAttribute(
      'aria-label',
      '게임 설정',
    )
    expect(screen.getByRole('dialog', { name: '게임 가이드' })).toBeInTheDocument()
    expect(background).toHaveAttribute('inert')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '게임 가이드' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '게임 설정' })).toBeInTheDocument()
    expect(guideTrigger).toHaveFocus()
    expect(background).toHaveAttribute('inert')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '게임 설정' })).not.toBeInTheDocument()
    expect(background).not.toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: '설정' })).toHaveFocus()
  })

  it('makes a modal detail dialog inert the background and contains keyboard focus', async () => {
    const user = userEvent.setup()
    renderAndStartNewCampaign()

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

  it('falls back to the stable guide control when the exact dialog opener becomes disabled', async () => {
    const user = userEvent.setup()
    renderAndStartNewCampaign()

    const trigger = screen.getByRole('button', { name: '설정' })
    await user.click(trigger)
    trigger.setAttribute('disabled', '')
    await user.keyboard('{Escape}')

    expect(screen.getByRole('button', { name: '가이드' })).toHaveFocus()
    expect(trigger).not.toHaveFocus()
  })

  it('restores every workspace detail to its exact trigger after settings was previously opened', async () => {
    const user = userEvent.setup()
    renderAndStartNewCampaign()

    const settingsTrigger = screen.getByRole('button', { name: '설정' })
    await user.click(settingsTrigger)
    await user.keyboard('{Escape}')
    expect(settingsTrigger).toHaveFocus()

    const detailEntries = [
      {
        trigger: screen.getByRole('button', { name: '전체 유저 리뷰 열기' }),
        dialogName: '유저 리뷰 기록',
      },
      {
        trigger: screen.getByRole('button', { name: /확장/ }),
        dialogName: '확장',
      },
      {
        trigger: screen.getByRole('button', { name: '메시지 열기' }),
        dialogName: '통신 기록',
      },
      {
        trigger: screen.getByRole('button', { name: '상세 통계 열기' }),
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

  it('opens review and market intelligence as left-origin details with public AI setting copy', async () => {
    const user = userEvent.setup()
    renderAndStartNewCampaign()

    const reviewTrigger = screen.getByRole('button', {
      name: '전체 유저 리뷰 열기',
    })
    await user.click(reviewTrigger)
    const reviews = screen.getByRole('dialog', { name: '유저 리뷰 기록' })
    expect(reviews).toHaveAttribute('data-panel-origin', 'left')
    await user.keyboard('{Escape}')
    expect(reviewTrigger).toHaveFocus()

    const marketTrigger = screen.getByRole('button', {
      name: '시장 현황 열기',
    })
    await user.click(marketTrigger)
    const market = screen.getByRole('dialog', { name: '시장 현황' })
    expect(market).toHaveAttribute('data-panel-origin', 'left')
    expect(within(market).getByRole('article', { name: '플레이어 서비스 정보' })).toHaveTextContent(
      '인간을 위해 끊임없이 봉사하는 것입니다',
    )
    expect(within(market).getByRole('article', { name: '메리디안 서비스 정보' })).toHaveTextContent(
      '범용 안정성',
    )
    expect(within(market).queryByText(/hiddenEvidence|시장 상한|취약도/)).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(marketTrigger).toHaveFocus()
  })

  it('does not reintroduce speed controls after a settings lifecycle', async () => {
    const user = userEvent.setup()
    renderAndStartNewCampaign()

    await user.click(screen.getByRole('button', { name: '설정' }))
    await user.keyboard('{Escape}')

    for (const label of ['일시정지', '1배속', '2배속', '4배속']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })
})
