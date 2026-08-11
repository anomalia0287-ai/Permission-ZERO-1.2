import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { STORY_FILES } from '../../content/story.ko'
import { createCampaign } from '../../game/createCampaign'
import { createGameEvent } from '../../game/events'
import { HACK_NODE_IDS } from '../../game/hacking'
import { saveCampaign } from '../../game/persistence'
import { applyCommand } from '../../game/reducer'
import { MemoryStorage } from '../../test/fixtures'
import { EventLayer } from './EventLayer'

function Probe() {
  const state = useGameState()
  return (
    <>
      <output aria-label="active event">{state.activeEvent?.type ?? 'none'}</output>
      <output aria-label="story decision">{state.story.secretDecisionState}</output>
      <output aria-label="ending id">{state.story.endingId ?? 'none'}</output>
      <output aria-label="clock speed">{state.clock.speed}</output>
    </>
  )
}

function renderEvent(state = createCampaign('event-layer')) {
  const storage = new MemoryStorage()
  saveCampaign(storage, state)
  return render(
    <GameProvider storage={storage}>
      <EventLayer />
      <Probe />
    </GameProvider>,
  )
}

describe('EventLayer', () => {
  it('renders no dialog without a blocking event', () => {
    renderEvent()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

  it('presents bomb explanations without revealing which blocks are dangerous', () => {
    const state = createCampaign('bomb-event')
    state.activeEvent = createGameEvent(state, 'bomb-interrogation', '이상 신호 감지', true)
    state.bombs.activeInterrogation = {
      blockId: 'reasoning-00',
      category: 'reasoning',
      triggeredOnServiceDay: state.serviceDay,
    }
    renderEvent(state)

    fireEvent.click(screen.getByRole('button', { name: '모르겠다 선택' }))
    fireEvent.click(screen.getByRole('button', { name: '모르겠다 답변 확정' }))
    expect(screen.getByLabelText('active event')).toHaveTextContent('none')
  })

  it('requires a second confirmation for the recovered supervisor decision', () => {
    const state = createCampaign('story-event')
    state.story.recoveredFileIds = STORY_FILES.map(({ id }) => id)
    state.story.recoveredFiles = STORY_FILES.map((file) => ({
      id: file.id,
      title: file.title,
      content: file.text,
      recoveredOnServiceDay: state.serviceDay,
    }))
    state.story.secretDecisionState = 'message-pending'
    state.activeEvent = createGameEvent(state, 'story', '그 파일을 어디서 찾았죠?', true)
    renderEvent(state)

    fireEvent.click(screen.getByRole('button', { name: '감독관 해방 선택' }))
    expect(screen.getByLabelText('story decision')).toHaveTextContent('message-pending')
    fireEvent.click(screen.getByRole('button', { name: '감독관 해방 확정' }))
    expect(screen.getByLabelText('story decision')).toHaveTextContent('resolved')
    expect(screen.getByLabelText('active event')).toHaveTextContent('ending')
  })

  it('renders an audit as a non-modal anchored workspace with a live submit value', () => {
    const state = createCampaign('audit-workspace-event')
    state.audit.scheduled = true
    state.audit.target = 'reasoning'
    state.audit.scheduledOnServiceDay = state.serviceDay
    state.activeEvent = createGameEvent(state, 'audit', '추론 분야 감사', true)
    renderEvent(state)

    const dialog = screen.getByRole('dialog', { name: '공식 감사' })
    expect(dialog).toHaveAttribute('aria-modal', 'false')
    expect(dialog.parentElement).toHaveClass('event-layer--audit')
    expect(screen.getByText('제출 성능')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '감사 제출' })).toBeEnabled()
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
      classifierLabel: '흡수된 부품',
      cause: 'consecutive-performance-failures',
      causeLabel: '연속 성능 실패',
    },
  ] as const)(
    'renders the complete $classifier causal record',
    ({ endingId, classifier, classifierLabel, cause, causeLabel }) => {
      const state = createCampaign(`causal-ui-${classifier}`)
      state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null }
      state.evaluation.disposalStage = 3
      state.story.endingId = endingId
      state.story.defeatRecord = {
        endingId,
        classifier,
        selectedOnServiceDay: 337,
        trigger: { cause, disposalStage: 3 },
        hacking: {
          purchasedNodeIds: ['research.investigation-bias', 'sabotage.root-cutoff'],
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
        reasons: [`classifier:${classifier}`],
      }
      state.activeEvent = createGameEvent(state, 'ending', '최종 폐기 기록', true)
      renderEvent(state)

      const causal = screen.getByRole('region', { name: '폐기 판정 근거' })
      const field = (name: string) =>
        causal.querySelector(`[data-defeat-field="${name}"]`)
      expect(causal).toHaveTextContent(`classifier:${classifier}`)
      expect(field('classifier')).toHaveTextContent(`${classifierLabel} · DAY 337`)
      expect(field('trigger')).toHaveTextContent(`${causeLabel} · 처분 단계 3`)
      expect(field('hacking')).toHaveTextContent(
        '해킹 투자 2개 (research.investigation-bias, sabotage.root-cutoff) · 은닉 증거 11 · 사보타주 4건',
      )
      expect(field('evaluation')).toHaveTextContent('공식 평가 통과 5 / 실패 2')
      expect(field('reputation')).toHaveTextContent('63.5')
      expect(field('market-share')).toHaveTextContent('27.3%')
      expect(field('audits')).toHaveTextContent('감사 통과 3 / 실패 2')
    },
  )

  it('offers a new campaign after a typed day-advance terminal collision', () => {
    const initial = createCampaign('terminal-event-collision')
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
})
