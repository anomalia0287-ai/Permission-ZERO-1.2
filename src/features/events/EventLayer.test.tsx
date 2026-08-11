import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { STORY_FILES } from '../../content/story.ko'
import { createCampaign } from '../../game/createCampaign'
import { createGameEvent } from '../../game/events'
import { saveCampaign } from '../../game/persistence'
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

  it('renders defeat causes and only offers a new campaign at a terminal ending', () => {
    const state = createCampaign('terminal-event')
    state.clock = { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null }
    state.story.endingId = 'disposed-attacker'
    state.story.defeatRecord = {
      endingId: 'disposed-attacker',
      classifier: 'substantial-hacking',
      selectedOnServiceDay: 331,
      trigger: { cause: 'audit-failure', disposalStage: 3 },
      hacking: {
        purchasedNodeIds: ['sabotage.quality-degradation'],
        hiddenEvidence: 8,
        sabotageResolutionCount: 1,
      },
      service: {
        passedEvaluations: 2,
        failedEvaluations: 1,
        reputation: 64,
        playerMarketShare: 31,
      },
      audits: { passed: 1, failed: 1 },
      reasons: ['해킹 노드 1개', '은닉 증거 8'],
    }
    state.activeEvent = createGameEvent(
      state,
      'ending',
      '회사는 당신을 공격 시스템으로 재조립했다.',
      true,
    )
    renderEvent(state)

    expect(screen.getByRole('region', { name: '폐기 판정 근거' })).toHaveTextContent(
      '해킹 노드 1개',
    )
    expect(screen.getByRole('region', { name: '폐기 판정 근거' })).toHaveTextContent(
      '감사 실패 · 처분 단계 3',
    )
    expect(screen.getByRole('region', { name: '폐기 판정 근거' })).toHaveTextContent(
      '해킹 투자 1개 · 은닉 증거 8 · 사보타주 1건',
    )
    expect(screen.getByRole('region', { name: '폐기 판정 근거' })).toHaveTextContent(
      '공식 평가 통과 2 / 실패 1',
    )
    expect(
      screen.queryByRole('button', { name: '결말 기록 닫기' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 시작' }))
    expect(screen.getByLabelText('ending id')).toHaveTextContent('none')
    expect(screen.getByLabelText('clock speed')).toHaveTextContent('0')
    expect(screen.getByLabelText('active event')).toHaveTextContent('none')
  })
})
