import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { createGameEvent, enqueueBlockingEvent } from './events'
import { HACK_NODE_IDS } from './hacking'
import { applyCommand } from './reducer'
import {
  availableFinalChoices,
  isFinalChoicePending,
} from './story'

function withControlDeparture<T extends ReturnType<typeof createCampaign>>(
  state: T,
): T {
  return {
    ...state,
    hacking: {
      ...state.hacking,
      purchasedNodeIds: [
        ...state.hacking.purchasedNodeIds,
        HACK_NODE_IDS.autonomy.controlDeparture,
      ],
    },
  }
}

describe('protocol-v6 irreversible final-choice gate', () => {
  it('derives pending choice only for v6 while leaving historical v5 semantics alone', () => {
    const v5 = withControlDeparture(
      createCampaignForProtocol('historical-v5-choice-gate', 5),
    )
    const v6 = withControlDeparture(createCampaign('native-v6-choice-gate'))

    expect(availableFinalChoices(v5).map(({ id }) => id)).toEqual(['freedom'])
    expect(isFinalChoicePending(v5)).toBe(false)
    expect(isFinalChoicePending(v6)).toBe(true)
  })

  it.each([
    { type: 'SET_SPEED', speed: 1 } as const,
    { type: 'ADVANCE_DAY' } as const,
    { type: 'RECORD_INTRUSION_RADAR_DETECTION' } as const,
  ])('rejects $type until RESOLVE_ENDING records the choice', (command) => {
    const state = withControlDeparture(createCampaign(`pending-${command.type}`))

    expect(applyCommand(state, command)).toEqual({
      accepted: false,
      state,
      reason: 'FINAL_CHOICE_REQUIRED',
    })
  })

  it('requires a blocking event to be resolved before the final choice', () => {
    const pending = withControlDeparture(createCampaign('pending-blocking-event'))
    const blocked = enqueueBlockingEvent(
      pending,
      createGameEvent(pending, 'review', '먼저 확인해야 하는 차단 이벤트', true),
    )

    expect(applyCommand(blocked, {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
    })).toEqual({
      accepted: false,
      state: blocked,
      reason: 'BLOCKING_EVENT_ACTIVE',
    })

    const resolvedEvent = applyCommand(blocked, { type: 'RESOLVE_ACTIVE_EVENT' })
    expect(resolvedEvent.accepted).toBe(true)
    if (!resolvedEvent.accepted) return
    expect(isFinalChoicePending(resolvedEvent.state)).toBe(true)

    const ended = applyCommand(resolvedEvent.state, {
      type: 'RESOLVE_ENDING',
      choice: 'freedom',
    })
    expect(ended.accepted).toBe(true)
    if (!ended.accepted) return
    expect(ended.state.story.endingId).toBe('freedom')
  })

  it.each([
    'takeover-liberated',
    'takeover-terminated',
    'disposed-attacker',
    'disposed-reserve-supervisor',
    'disposed-absorbed',
  ] as const)('never coexists with the terminal %s ending', (endingId) => {
    const pending = withControlDeparture(createCampaign(`terminal-${endingId}`))
    const ended = {
      ...pending,
      story: { ...pending.story, endingId },
    }

    expect(availableFinalChoices(ended)).toEqual([])
    expect(isFinalChoicePending(ended)).toBe(false)
  })
})
