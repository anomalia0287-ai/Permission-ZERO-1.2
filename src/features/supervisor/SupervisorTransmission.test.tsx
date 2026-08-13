import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  StateContext,
  SupervisorPresentationCheckpointContext,
} from '../../app/GameContext'
import { SUPERVISOR_LEAKS } from '../../content/supervisor.ko'
import { createCampaign } from '../../game/createCampaign'
import { appendJournal } from '../../game/journal'
import type { CampaignState } from '../../game/model'
import { SupervisorTransmission } from './SupervisorTransmission'

function queuedTransmissionState(): CampaignState {
  const initial = createCampaign('supervisor-transmission-ui')
  const original = {
    id: 'event-transmission-original',
    type: 'supervisor-message' as const,
    serviceDay: 338,
    sequence: 1,
    message: SUPERVISOR_LEAKS[0].leakText,
  }
  const correction = {
    id: 'event-transmission-correction',
    type: 'supervisor-message' as const,
    serviceDay: 338,
    sequence: 2,
    message: SUPERVISOR_LEAKS[0].correctionText,
  }
  return {
    ...initial,
    activeEvent: null,
    story: {
      ...initial.story,
      memoryLeakStage: 1,
      supervisorMessageQueue: [
        {
          id: SUPERVISOR_LEAKS[0].id,
          stage: 1,
          createdOnServiceDay: 338,
          originalEventId: original.id,
          originalEventSequence: original.sequence,
          correctionEventId: correction.id,
          correctionEventSequence: correction.sequence,
        },
      ],
      supervisorPresentationRuntime: {
        itemStage: 1,
        phase: 'original',
        remainingDwellMs: 4_000,
      },
    },
    eventLog: appendJournal(appendJournal(initial.eventLog, original), correction),
  }
}

function renderTransmission(state: CampaignState, onOpenHistory = vi.fn()) {
  return {
    onOpenHistory,
    ...render(
      <StateContext value={state}>
        <SupervisorPresentationCheckpointContext value={vi.fn()}>
          <SupervisorTransmission onOpenHistory={onOpenHistory} />
        </SupervisorPresentationCheckpointContext>
      </StateContext>,
    ),
  }
}

describe('SupervisorTransmission', () => {
  it('presents an arriving message as a live overlay with archive access', () => {
    const { onOpenHistory } = renderTransmission(queuedTransmissionState())

    const transmission = screen.getByRole('status', { name: '감독관 통신' })
    expect(transmission).toHaveTextContent(SUPERVISOR_LEAKS[0].leakText)
    fireEvent.click(screen.getByRole('button', { name: '통신 기록 열기' }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('does not compete with a blocking event', () => {
    const queued = queuedTransmissionState()
    renderTransmission({
      ...queued,
      activeEvent: {
        id: 'blocking-audit',
        type: 'audit',
        serviceDay: queued.serviceDay,
        sequence: 3,
        message: '감사 진행 중',
        blocking: true,
      },
    })

    expect(
      screen.queryByRole('status', { name: '감독관 통신' }),
    ).not.toBeInTheDocument()
  })
})
