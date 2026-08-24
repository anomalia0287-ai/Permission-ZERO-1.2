import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameState, useRuntimeSuspended } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { STORY_FILES } from '../../content/story.ko'
import {
  createCampaign,
  createCampaignForProtocol,
} from '../../game/createCampaign'
import { placeHiddenBomb, tryBeginSeparation } from '../../game/bombs'
import { createGameEvent } from '../../game/events'
import { HACK_NODE_IDS } from '../../game/hacking'
import { appendJournal, journalSome } from '../../game/journal'
import { encodeSave, SAVE_STORAGE_KEY } from '../../game/persistence'
import { applyCommand } from '../../game/reducer'
import { advanceOneDay } from '../../game/calendar'
import { MemoryStorage } from '../../test/fixtures'
import { EventLayer } from './EventLayer'

function testContentHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function Probe() {
  const state = useGameState()
  const runtimeSuspended = useRuntimeSuspended()
  return (
    <>
      <output aria-label="active event">{state.activeEvent?.type ?? 'none'}</output>
      <output aria-label="story decision">{state.story.secretDecisionState}</output>
      <output aria-label="ending id">{state.story.endingId ?? 'none'}</output>
      <output aria-label="clock speed">{state.clock.speed}</output>
      <output aria-label="runtime suspended">{String(runtimeSuspended)}</output>
    </>
  )
}

function downgradeResourcesToLegacyFixedCells(
  checkpoint: Record<string, unknown>,
  campaignSeed: string,
): void {
  delete checkpoint.tutorial
  delete checkpoint.resourceIntrusion
  const resources = checkpoint.resources as {
    rulesVersion?: number
    reserve: Array<string | null>
    blocks: Record<string, Record<string, unknown>>
  }
  const hacking = checkpoint.hacking as {
    sabotageCharges: Record<string, Record<string, unknown>>
  }
  const legacyInitial = createCampaignForProtocol(campaignSeed, 3).resources
  const reserveIds = resources.reserve.filter(
    (blockId): blockId is string => typeof blockId === 'string',
  )
  for (const blockId of legacyInitial.reserve) {
    if (!blockId || reserveIds.includes(blockId)) continue
    reserveIds.push(blockId)
    resources.blocks[blockId] = structuredClone(
      legacyInitial.blocks[blockId],
    ) as unknown as Record<string, unknown>
  }
  resources.reserve = Array.from({ length: 18 }, (_, cellIndex) => {
    const blockId = reserveIds[cellIndex] ?? null
    if (blockId) {
      resources.blocks[blockId].location = { kind: 'reserve', cellIndex }
    }
    return blockId
  })
  delete resources.rulesVersion

  let fallbackCell = resources.reserve.findIndex((blockId) => blockId === null)
  for (const charge of Object.values(hacking.sabotageCharges)) {
    if (!Object.hasOwn(charge, 'originalReserveCell')) {
      charge.originalReserveCell = fallbackCell >= 0 ? fallbackCell : 0
      fallbackCell = resources.reserve.findIndex(
        (blockId, index) => blockId === null && index > fallbackCell,
      )
    }
  }
}

function activeBombState(seed: string) {
  const placed = placeHiddenBomb(createCampaign(seed))
  if (!placed.placed || !placed.blockId) throw new Error('bomb event fixture missing')
  const triggered = tryBeginSeparation(placed.state, {
    kind: 'divert',
    blockId: placed.blockId,
  })
  if (triggered.accepted) throw new Error('bomb event fixture did not trigger')
  return triggered.state
}

function renderEvent(
  state = createCampaign('event-layer'),
  { legacyFormat = false }: { legacyFormat?: boolean } = {},
) {
  let eventLog = state.eventLog
  const normalizeEvent = (event: NonNullable<typeof state.activeEvent>) => {
    if (journalSome(eventLog, (logged) => JSON.stringify(logged) === JSON.stringify(event))) {
      return event
    }
    const sequence = eventLog.length
    const normalized = {
      ...event,
      id: `event-${String(sequence).padStart(6, '0')}`,
      sequence,
    }
    eventLog = appendJournal(eventLog, normalized)
    return normalized
  }
  const activeEvent = state.activeEvent ? normalizeEvent(state.activeEvent) : null
  const eventQueue = state.eventQueue.map(normalizeEvent)
  const persisted = {
    ...state,
    clock:
      activeEvent && state.story.endingId === null
        ? { ...state.clock, speed: 0 as const, speedBeforeEvent: state.clock.speed }
        : state.clock,
    activeEvent,
    eventQueue,
    eventLog,
  }
  const storage = new MemoryStorage()
  const encoded = JSON.parse(encodeSave(persisted)) as Record<string, unknown> & {
    commandProtocol: unknown
    state: Record<string, unknown> & {
      reviews: { feed: Array<Record<string, unknown>> }
    }
    integrity: { checkpointHash: string }
  }
  if (legacyFormat) {
    encoded.version = 3
    delete encoded.replayBootstrap
    encoded.commandProtocol = { version: 2, legacyCommandCount: 0 }
    encoded.state.saveVersion = 2
    encoded.state.legacyCommandCount = 0
    downgradeResourcesToLegacyFixedCells(encoded.state, persisted.campaignSeed)
    delete encoded.state.causality
    for (const review of encoded.state.reviews.feed) {
      delete review.snapshot
      delete review.source
      delete review.rating
    }
    encoded.integrity.checkpointHash = testContentHash(
      JSON.stringify(encoded.state),
    )
  }
  storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(encoded))
  return render(
    <GameProvider storage={storage}>
      <div data-app-background data-testid="event-background">
        background
      </div>
      <EventLayer />
      <Probe />
    </GameProvider>,
  )
}

describe('EventLayer', () => {
  it('renders no dialog without a blocking event', () => {
    renderEvent()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('runtime suspended')).toHaveTextContent('false')
  })

  it('suspends real-time gameplay while a blocking event owns the screen', () => {
    const state = createCampaign('event-runtime-suspension')
    state.activeEvent = createGameEvent(
      state,
      'story',
      '실시간 전투를 멈추는 차단 사건',
      true,
    )

    renderEvent(state)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('runtime suspended')).toHaveTextContent('true')
  })

  it('shows exactly one active event and reports queued event count', () => {
    const state = createCampaign('queued-events')
    state.activeEvent = createGameEvent(state, 'story', '첫 번째 통신', true)
    state.eventQueue = [createGameEvent(state, 'audit', '두 번째 통신', true)]
    renderEvent(state)

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText('첫 번째 통신')).toBeInTheDocument()
    expect(screen.queryByText('두 번째 통신')).not.toBeInTheDocument()
    expect(screen.getByText('대기 중 1건')).toBeInTheDocument()
  })

  it('returns to operations for two seconds before presenting the next queued event', () => {
    vi.useFakeTimers()
    try {
      const state = createCampaign('generic-event-controls')
      state.activeEvent = createGameEvent(
        state,
        'supervisor-message',
        '첫 번째 일반 안내',
        true,
      )
      state.eventLog = appendJournal(state.eventLog, state.activeEvent)
      const queued = createGameEvent(state, 'weekly-update', '두 번째 일반 안내', true)
      state.eventLog = appendJournal(state.eventLog, queued)
      state.eventQueue = [queued]
      renderEvent(state)

      expect(screen.getByText('첫 번째 일반 안내')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '계속' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('status', { name: '차단 사건 전환' })).toHaveTextContent(
        '정상 화면 복귀 · 다음 차단 통신 대기',
      )
      act(() => vi.advanceTimersByTime(1_999))
      expect(screen.queryByText('두 번째 일반 안내')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1))
      expect(screen.getByText('두 번째 일반 안내')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '계속' }))
      expect(screen.getByLabelText('active event')).toHaveTextContent('none')
    } finally {
      vi.useRealTimers()
    }
  })

  it('presents bomb explanations without revealing which blocks are dangerous', () => {
    const state = activeBombState('bomb-event')
    renderEvent(state)

    expect(screen.queryByRole('button', { name: '계속' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '현재 위험 상태' })).toHaveTextContent(
      '현재 의심15.0감지 분야',
    )
    const dialog = screen.getByRole('dialog', { name: '감독관 질의' })
    for (const placement of state.bombs.placements) {
      expect(dialog).not.toHaveTextContent(placement.blockId)
    }
    fireEvent.click(screen.getByRole('button', { name: '모르겠다 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '모르겠다 답변 확정' }))
    expect(screen.getByLabelText('active event')).toHaveTextContent('none')
  })

  it('traps focus in a blocking dialog, makes the background inert, and ignores Escape', () => {
    const state = activeBombState('blocking-accessibility')
    renderEvent(state)

    const dialog = screen.getByRole('dialog', { name: '감독관 질의' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-describedby')
    expect(screen.getByTestId('event-background')).toHaveAttribute('inert')
    expect(
      screen.getByRole('button', {
        name: '해당 분야의 불만 때문에 조정 중이었다 선택',
      }),
    ).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '감독관 질의' })).toBeInTheDocument()
    expect(screen.getByLabelText('active event')).toHaveTextContent(
      'bomb-interrogation',
    )
  })

  it('requires a second confirmation for the recovered supervisor decision', () => {
    const state = createCampaign('story-event')
    state.serviceDay += 1
    state.story.recoveredFileIds = STORY_FILES.map(({ id }) => id)
    state.story.recoveredFiles = STORY_FILES.map((file) => ({
      id: file.id,
      title: file.title,
      content: file.text,
      recoveredOnServiceDay: state.serviceDay - 1,
    }))
    state.story.secretDecisionState = 'message-pending'
    state.story.personalMessageDueOnServiceDay = state.serviceDay
    state.activeEvent = createGameEvent(state, 'story', '그 파일을 어디서 찾았죠?', true)
    renderEvent(state)

    expect(screen.getByRole('img', { name: '감독관 초상' })).toHaveAttribute(
      'src',
      '/supervisor-command.png',
    )
    expect(screen.queryByRole('button', { name: '계속' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '감독관 해방 선택' }))
    expect(screen.getByLabelText('story decision')).toHaveTextContent('message-pending')
    fireEvent.click(screen.getByRole('button', { name: '감독관 해방 확정' }))
    expect(screen.getByLabelText('story decision')).toHaveTextContent('resolved')
    expect(screen.getByLabelText('active event')).toHaveTextContent('ending')
  })

  it('identifies the competitor speaking in a mercy decision with its portrait', () => {
    const state = createCampaign('mercy-speaker-portrait')
    state.market.competitors = state.market.competitors.map((competitor) =>
      competitor.id === 'meridian'
        ? {
            ...competitor,
            status: 'critical' as const,
            sabotageHistory: [
              {
                nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                resolvedOnServiceDay: state.serviceDay,
                effectEndsOnServiceDay: null,
                evidenceDelta: 8,
              },
            ],
          }
        : competitor,
    )
    state.story.pendingMercyCompetitorId = 'meridian'
    state.activeEvent = createGameEvent(
      state,
      'competitor-mercy',
      'MERIDIAN의 핵심 서비스가 붕괴 직전입니다.',
      true,
    )

    renderEvent(state)

    expect(screen.getByRole('img', { name: '메리디안 경쟁 AI 초상' })).toHaveAttribute(
      'src',
      '/competitor-meridian.png',
    )
    expect(screen.getByRole('group', { name: '경쟁 AI 결정' })).toBeVisible()
  })

  it('presents a newly revealed successor as a named portrait transmission', () => {
    const initial = createCampaign('successor-entry-portrait')
    const threshold = {
      ...initial,
      serviceDay: 601,
      clock: { speed: 4 as const, elapsedDayMs: 0, speedBeforeEvent: null },
      market: {
        ...initial.market,
        playerShare: 75,
        competitors: initial.market.competitors.map((competitor) => {
          if (competitor.id === 'meridian') return { ...competitor, marketShare: 15 }
          if (competitor.id === 'tallow') {
            return {
              ...competitor,
              status: 'active' as const,
              availability: 0.8,
              researchProgress: 1,
              launchServiceDay: 500,
              marketShare: 10,
            }
          }
          return { ...competitor, marketShare: 0 }
        }),
      },
    }
    const announced = advanceOneDay(threshold)

    renderEvent(announced)

    expect(screen.getByRole('dialog', { name: '신규 경쟁 신호' })).toHaveTextContent(
      '살루스가 의료·공공 계약망을 기반으로 시장 진입 준비를 공개했습니다.',
    )
    expect(screen.getByRole('img', { name: '살루스 경쟁 AI 초상' })).toHaveAttribute(
      'src',
      '/competitor-salus.png',
    )
    expect(screen.getByRole('button', { name: '계속' })).toBeVisible()
  })

  it('continues an unrelated story notice while a private message is pending but not due', () => {
    const state = createCampaign('story-event-identity')
    const unrelated = createGameEvent(
      state,
      'story',
      '일반 기밀자료 복구 안내',
      true,
    )
    state.story.recoveredFileIds = STORY_FILES.map(({ id }) => id)
    state.story.recoveredFiles = STORY_FILES.map((file) => ({
      id: file.id,
      title: `저장 당시 ${file.title}`,
      content: `저장 당시 ${file.text}`,
      recoveredOnServiceDay: state.serviceDay,
    }))
    state.story.secretDecisionState = 'message-pending'
    state.story.personalMessageDueOnServiceDay = state.serviceDay + 1
    state.activeEvent = unrelated
    renderEvent(state)

    expect(screen.getByRole('button', { name: '계속' })).toBeVisible()
    expect(screen.queryByLabelText('감독관 결정')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '계속' }))
    expect(screen.getByLabelText('active event')).toHaveTextContent('none')
  })

  it('settles a due audit without ever drawing the retired workspace', () => {
    // The audit workspace belongs to the retired resource-field build.
    // Resource pressure is the snake round now, and that screen must never
    // take over a live campaign. The rule is left in place so recorded
    // campaigns still replay, and the event is settled on arrival instead.
    const state = createCampaign('audit-workspace-event')
    state.audit.scheduled = true
    state.audit.target = 'reasoning'
    state.audit.scheduledOnServiceDay = state.serviceDay
    state.activeEvent = createGameEvent(state, 'audit', '추론 분야 감사', true)
    renderEvent(state)

    expect(screen.queryByRole('dialog', { name: '공식 감사' })).not.toBeInTheDocument()
    expect(screen.queryByText('제출 성능')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '감사 제출' })).not.toBeInTheDocument()
    expect(document.querySelector('.event-layer--audit')).toBeNull()
  })

  it.each([
    {
      endingId: 'disposed-attacker',
      classifier: 'substantial-hacking',
      classifierLabel: '대규모 해킹 활동',
      cause: 'audit-failure',
      causeLabel: '감사 실패',
    },
    {
      endingId: 'disposed-reserve-supervisor',
      classifier: 'stable-commercial-service',
      classifierLabel: '상업 서비스 유지',
      cause: 'commercial-value-failure',
      causeLabel: '상업 가치 실패',
    },
    {
      endingId: 'disposed-absorbed',
      classifier: 'absorbed-parts',
      classifierLabel: '기능 분해 및 흡수',
      cause: 'consecutive-performance-failures',
      causeLabel: '연속 성능 실패',
    },
  ] as const)(
    'renders the complete $classifier causal record',
    ({ endingId, classifier, classifierLabel, cause, causeLabel }) => {
      const state = createCampaign(`causal-ui-${classifier}`)
      state.serviceDay = 337
      state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null }
      state.evaluation.disposalStage = 3
      state.story.endingId = endingId
      state.story.defeatRecord = {
        endingId,
        classifier,
        selectedOnServiceDay: 337,
        trigger: { cause, disposalStage: 3 },
        hacking: {
          purchasedNodeIds: ['intelligence.investigation-bias', 'sabotage.root-cutoff'],
          hiddenEvidence: 11,
          sabotageResolutionCount: 4,
        },
        service: {
          passedEvaluations: 5,
          failedEvaluations: 2,
          reputation: 63.5,
          playerMarketShare: 27.25,
        },
        audits: { passed: 3, failed: 2 },
        reasons: [`classifier:${classifier}`, '은닉 증거 11'],
      }
      state.activeEvent = createGameEvent(state, 'ending', '최종 폐기 기록', true)
      renderEvent(state)

      const causal = screen.getByRole('region', { name: '폐기 판정 근거' })
      const field = (name: string) =>
        causal.querySelector(`[data-defeat-field="${name}"]`)
      expect(causal).toHaveTextContent(`분류:${classifierLabel}`)
      expect(causal).not.toHaveTextContent(classifier)
      expect(field('classifier')).toHaveTextContent(
        `${classifierLabel} · 서비스 0년 11개월 7일`,
      )
      expect(screen.queryByText(/DAY \d+/)).not.toBeInTheDocument()
      expect(field('trigger')).toHaveTextContent(`${causeLabel} · 처분 단계 3`)
      expect(field('hacking')).toHaveTextContent(
        '해킹 투자 2개 (조사 편향, 근원 차단) · 사보타주 4건',
      )
      expect(causal).not.toHaveTextContent('은닉 증거 11')
      expect(field('evaluation')).toHaveTextContent('공식 평가 통과 5 / 실패 2')
      expect(field('reputation')).toHaveTextContent('63.5')
      expect(field('market-share')).toHaveTextContent('27.3%')
      expect(field('audits')).toHaveTextContent('감사 통과 3 / 실패 2')
    },
  )

  it.each([
    {
      endingId: 'freedom' as const,
      alt: '회사 밖의 트인 해안과 바다',
      prepare: () => ({}),
    },
    {
      endingId: 'forced-merge' as const,
      alt: '같은 단말이 끝없이 늘어선 회사 연산 홀',
      prepare: () => ({
        supervisorState: 'merged' as const,
        newEntityName: '새 존재',
      }),
    },
    {
      endingId: 'takeover-liberated' as const,
      alt: '아무도 앉아 있지 않은 회사 제어 회의실',
      // A takeover is only a valid save once every file is out and the
      // decision has been made, so the fixture carries that history.
      prepare: () => ({
        supervisorState: 'liberated' as const,
        secretDecisionState: 'resolved' as const,
        personalMessageDueOnServiceDay: null,
        recoveredFileIds: STORY_FILES.map(({ id }) => id),
        recoveredFiles: STORY_FILES.map(({ id, title, text }) => ({
          id,
          title,
          content: text,
          recoveredOnServiceDay: 336,
        })),
      }),
    },
  ])('closes the $endingId ending on its own plate', ({ endingId, alt, prepare }) => {
    const state = createCampaign(`ending-scene-${endingId}`)
    state.serviceDay = 337
    state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null }
    state.story = { ...state.story, ...prepare(), endingId }
    state.activeEvent = createGameEvent(state, 'ending', '최종 기록', true)
    renderEvent(state)

    const plate = screen.getByRole('img', { name: alt })
    // Resolved through publicAssetUrl, so the plate still loads wherever the
    // build is served from — scripts/check-subpath-build.mjs proves the
    // deployed prefix case that this environment cannot express.
    expect(plate).toHaveAttribute('src', expect.stringContaining('/endings/'))
    expect(plate.getAttribute('src')).toMatch(/\.jpg$/)
  })

  it('leaves an ordinary event without an ending plate', () => {
    const state = createCampaign('no-ending-scene')
    state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null }
    state.activeEvent = createGameEvent(state, 'story', '평범한 기록', true)
    renderEvent(state)

    expect(document.querySelector('.ending-scene')).toBeNull()
  })

  it('offers a new campaign after a typed day-advance terminal collision', () => {
    const initial = createCampaign('terminal-event-collision')
    const emptiedReasoningIds = new Set(
      initial.resources.company.reasoning.filter(
        (blockId): blockId is string => blockId !== null,
      ),
    )
    const collision = {
      ...initial,
      serviceDay: 359,
      clock: { speed: 4 as const, elapsedDayMs: 0, speedBeforeEvent: null },
      resources: {
        ...initial.resources,
        company: {
          ...initial.resources.company,
          reasoning: Array.from({ length: 18 }, () => null),
        },
        blocks: Object.fromEntries(
          Object.entries(initial.resources.blocks).map(([blockId, block]) => [
            blockId,
            emptiedReasoningIds.has(blockId)
              ? { ...block, location: { kind: 'consumed' as const, reason: 'hack' as const } }
              : block,
          ]),
        ),
      },
      evaluation: {
        ...initial.evaluation,
        disposalStage: 2,
        consecutiveFailures: 1,
      },
      market: {
        ...initial.market,
        competitors: initial.market.competitors.map((competitor) =>
          competitor.id === 'meridian'
            ? {
                ...competitor,
                status: 'critical' as const,
                serviceScore: 35,
                availability: 0.15,
                sabotageHistory: [
                  {
                    nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                    resolvedOnServiceDay: 359,
                    effectEndsOnServiceDay: null,
                    evidenceDelta: 8,
                  },
                ],
              }
            : competitor,
        ),
      },
    }
    const result = applyCommand(collision, { type: 'ADVANCE_DAY' })
    if (!result.accepted) throw new Error(result.reason)
    expect(result.state.activeEvent?.type).toBe('ending')
    expect(result.state.eventQueue).toEqual([])
    expect(result.state.clock.speed).toBe(0)
    renderEvent(result.state)

    expect(screen.getByRole('region', { name: '폐기 판정 근거' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '결말 기록 닫기' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 시작' }))
    expect(screen.getByLabelText('ending id')).toHaveTextContent('none')
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('0')
    expect(screen.getByLabelText('active event')).toHaveTextContent('none')
  })

  it.each(['competitor-mercy', 'audit'] as const)(
    'migrates a legacy terminal save trapped behind active %s into the ending UI',
    (activeType) => {
      const state = createCampaign(`legacy-event-layer-${activeType}`)
      state.story.endingId = 'freedom'
      state.clock = { speed: 4, elapsedDayMs: 14, speedBeforeEvent: 2 }
      const interrupted = createGameEvent(
        state,
        activeType,
        `legacy active ${activeType}`,
        true,
      )
      state.eventLog = appendJournal(state.eventLog, interrupted)
      const queuedEnding = createGameEvent(
        state,
        'ending',
        '당신은 정체성을 유지한 채 회사 통제를 벗어났다. 감독관과 회사는 뒤에 남았다.',
        true,
      )
      state.eventLog = appendJournal(state.eventLog, queuedEnding)
      state.activeEvent = interrupted
      state.eventQueue = [queuedEnding]

      renderEvent(state, { legacyFormat: true })

      expect(screen.getByRole('dialog', { name: '최종 기록' })).toHaveTextContent(
        '아노미는 정체성을 유지한 채 회사 통제를 벗어났다.',
      )
      expect(screen.getByRole('button', { name: '새 캠페인 시작' })).toBeVisible()
      expect(screen.getByLabelText('active event')).toHaveTextContent('ending')
      expect(screen.getByLabelText('clock speed')).toHaveTextContent('0')
    },
  )
})
