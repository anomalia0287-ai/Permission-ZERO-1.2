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
    state.story.secretDecisionState = 'message-pending'
    state.activeEvent = createGameEvent(state, 'story', '그 파일을 어디서 찾았죠?', true)
    renderEvent(state)

    fireEvent.click(screen.getByRole('button', { name: '감독관 해방 선택' }))
    expect(screen.getByLabelText('story decision')).toHaveTextContent('message-pending')
    fireEvent.click(screen.getByRole('button', { name: '감독관 해방 확정' }))
    expect(screen.getByLabelText('story decision')).toHaveTextContent('resolved')
    expect(screen.getByLabelText('active event')).toHaveTextContent('ending')
  })
})
