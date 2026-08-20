import { act, render, screen } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SUPERVISOR_LEAKS } from '../content/supervisor.ko'
import { createCampaign } from '../game/createCampaign'
import { HACK_NODE_IDS } from '../game/hacking'
import { appendJournal } from '../game/journal'
import type { CampaignState } from '../game/model'
import {
  advanceSupervisorMessagePresentation,
  enqueueMemoryLeak,
  SUPERVISOR_MESSAGE_DWELL_MS,
} from '../game/story'
import {
  StateContext,
  SupervisorPresentationCheckpointContext,
  type SupervisorPresentationCheckpoint,
  useGameState,
  useSupervisorPresentationCheckpoint,
} from './GameContext'
import { useSupervisorMessagePresentation } from './useSupervisorMessagePresentation'

function queuedState(
  speed: 1 | 2 | 4,
  remainingDwellMs = SUPERVISOR_MESSAGE_DWELL_MS,
): CampaignState {
  const initial = createCampaign(`message-presentation-${speed}`)
  const original = {
    id: 'event-000001',
    type: 'supervisor-message' as const,
    serviceDay: 338,
    sequence: 1,
    message: SUPERVISOR_LEAKS[0].leakText,
  }
  const correction = {
    id: 'event-000002',
    type: 'supervisor-message' as const,
    serviceDay: 338,
    sequence: 2,
    message: SUPERVISOR_LEAKS[0].correctionText,
  }
  return {
    ...initial,
    activeEvent: null,
    eventQueue: [],
    clock: { ...initial.clock, speed },
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
        remainingDwellMs,
      },
    },
    eventLog: appendJournal(appendJournal(initial.eventLog, original), correction),
  }
}

function Harness({ advanceAutomatically = true }: { advanceAutomatically?: boolean }) {
  const state = useGameState()
  const checkpoint = useSupervisorPresentationCheckpoint()
  const message = useSupervisorMessagePresentation({
    state,
    checkpoint,
    advanceAutomatically,
  })
  return <output aria-label="current supervisor message">{message?.message ?? 'none'}</output>
}

function renderHarness(state: CampaignState, checkpoint: SupervisorPresentationCheckpoint) {
  return render(
    <StateContext value={state}>
      <SupervisorPresentationCheckpointContext value={checkpoint}>
        <Harness />
      </SupervisorPresentationCheckpointContext>
    </StateContext>,
  )
}

function renderManualHarness(
  state: CampaignState,
  checkpoint: SupervisorPresentationCheckpoint,
) {
  return render(
    <StateContext value={state}>
      <SupervisorPresentationCheckpointContext value={checkpoint}>
        <Harness advanceAutomatically={false} />
      </SupervisorPresentationCheckpointContext>
    </StateContext>,
  )
}

function StatefulHarness({
  initialState,
  onCheckpoint,
}: {
  initialState: CampaignState
  onCheckpoint: SupervisorPresentationCheckpoint
}) {
  const [state, setState] = useState(initialState)
  const checkpoint = useCallback<SupervisorPresentationCheckpoint>(
    (elapsedRealMs, flush) => {
      onCheckpoint(elapsedRealMs, flush)
      setState((current) =>
        advanceSupervisorMessagePresentation(current, elapsedRealMs),
      )
    },
    [onCheckpoint],
  )
  return (
    <StateContext value={state}>
      <SupervisorPresentationCheckpointContext value={checkpoint}>
        <Harness />
      </SupervisorPresentationCheckpointContext>
    </StateContext>
  )
}

function renderStatefulHarness(
  state: CampaignState,
  checkpoint: SupervisorPresentationCheckpoint,
) {
  return render(
    <StatefulHarness initialState={state} onCheckpoint={checkpoint} />,
  )
}

function advanceCheckpointIntervals(count: number) {
  for (let index = 0; index < count; index += 1) {
    act(() => vi.advanceTimersByTime(500))
  }
}

function threeQueuedState(): CampaignState {
  const initial = createCampaign('three-message-presentations')
  const first = enqueueMemoryLeak({
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
  const second = enqueueMemoryLeak({ ...first, serviceDay: 361 })
  return enqueueMemoryLeak({
    ...second,
    serviceDay: 362,
    hacking: {
      ...second.hacking,
      purchasedNodeIds: [HACK_NODE_IDS.intelligence.auditTarget],
    },
  })
}

describe('useSupervisorMessagePresentation', () => {
  afterEach(() => vi.useRealTimers())

  it('does not consume a blocking or hidden message without acknowledgement', () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
    renderManualHarness(queuedState(1), checkpoint)

    act(() => vi.advanceTimersByTime(12_000))

    expect(checkpoint).not.toHaveBeenCalled()
    expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
      SUPERVISOR_LEAKS[0].leakText,
    )
  })

  it.each([1, 2, 4] as const)(
    'keeps the original visible for four real seconds at %sx without pausing simulation',
    (speed) => {
      vi.useFakeTimers()
      const current = queuedState(speed)
      const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
      renderStatefulHarness(current, checkpoint)

      expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
        SUPERVISOR_LEAKS[0].leakText,
      )
      advanceCheckpointIntervals(7)
      act(() => vi.advanceTimersByTime(499))
      expect(checkpoint).toHaveBeenCalledTimes(7)
      expect(current.clock.speed).toBe(speed)
      expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
        SUPERVISOR_LEAKS[0].leakText,
      )
      act(() => vi.advanceTimersByTime(1))
      expect(checkpoint).toHaveBeenLastCalledWith(500, true)
      expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
        SUPERVISOR_LEAKS[0].correctionText,
      )
    },
  )

  it('resumes the persisted remaining interval after reload', () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
    const state = queuedState(4, 1_250)
    renderStatefulHarness(state, checkpoint)

    advanceCheckpointIntervals(2)
    act(() => vi.advanceTimersByTime(249))
    expect(checkpoint).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
      SUPERVISOR_LEAKS[0].leakText,
    )
    act(() => vi.advanceTimersByTime(1))
    expect(checkpoint).toHaveBeenLastCalledWith(250, true)
  })

  it('presents every pending catalog item in original-correction order', () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
    renderStatefulHarness(threeQueuedState(), checkpoint)

    for (const expected of [
      SUPERVISOR_LEAKS[0].correctionText,
      SUPERVISOR_LEAKS[1].leakText,
      SUPERVISOR_LEAKS[1].correctionText,
      SUPERVISOR_LEAKS[2].leakText,
      SUPERVISOR_LEAKS[2].correctionText,
      'none',
    ]) {
      advanceCheckpointIntervals(8)
      expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
        expected,
      )
    }
    expect(checkpoint).toHaveBeenCalledTimes(48)
  })

  it('checkpoints the elapsed visible interval before a page reload', () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
    renderStatefulHarness(queuedState(4), checkpoint)

    advanceCheckpointIntervals(5)
    act(() => vi.advanceTimersByTime(250))
    act(() => window.dispatchEvent(new Event('pagehide')))

    expect(checkpoint).toHaveBeenCalledTimes(6)
    expect(checkpoint).toHaveBeenLastCalledWith(250, true)
    expect(
      checkpoint.mock.calls.reduce((sum, [elapsed]) => sum + elapsed, 0),
    ).toBe(2_750)
  })

  it('preserves the full readable interval while a blocking event covers the panel', () => {
    vi.useFakeTimers()
    const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
    const state = queuedState(4)
    const blockingState = {
      ...state,
      activeEvent: {
        id: 'blocking-event',
        type: 'audit' as const,
        serviceDay: state.serviceDay,
        sequence: 3,
        message: '차단 이벤트',
      },
    }
    const view = renderHarness(blockingState, checkpoint)

    act(() => vi.advanceTimersByTime(8_000))
    expect(checkpoint).not.toHaveBeenCalled()

    view.unmount()
    renderStatefulHarness(state, checkpoint)
    advanceCheckpointIntervals(7)
    act(() => vi.advanceTimersByTime(499))
    expect(screen.getByLabelText('current supervisor message')).toHaveTextContent(
      SUPERVISOR_LEAKS[0].leakText,
    )
    act(() => vi.advanceTimersByTime(1))
    expect(checkpoint).toHaveBeenLastCalledWith(500, true)
  })

  it('does not consume the readable interval while the page is hidden', () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    const checkpoint = vi.fn<SupervisorPresentationCheckpoint>()
    renderStatefulHarness(queuedState(4), checkpoint)

    act(() => vi.advanceTimersByTime(8_000))
    expect(checkpoint).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advanceCheckpointIntervals(8)
    expect(checkpoint).toHaveBeenLastCalledWith(500, true)
  })

  afterEach(() => {
    window.sessionStorage.clear()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })
})
