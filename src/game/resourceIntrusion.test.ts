import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { applyCommand } from './reducer'
import {
  anomiMaximumSpeed,
  resourceSnakeBotMaximumSpeed,
} from './resourceIntrusion'

describe('persisted InIt round progression', () => {
  it.each([
    [0, 9],
    [10, 10],
    [20, 11],
    [30, 12],
    [35, 12.5],
    [999, 12.5],
  ])('maps %i completed rounds to a %f bot maximum speed', (rounds, speed) => {
    expect(resourceSnakeBotMaximumSpeed(rounds)).toBe(speed)
  })

  it.each([
    [0, 12],
    [1, 12.48],
    [2, 12.96],
    [3, 13.44],
    [4, 13.92],
    [5, 14.4],
    [99, 14.4],
  ])('applies speed upgrade level %i only to Anomi', (level, speed) => {
    expect(anomiMaximumSpeed(level)).toBeCloseTo(speed, 8)
  })

  it('counts a victory and a defeat once and rejects duplicate round completion', () => {
    const initial = createCampaign('round-progression')
    const victory = applyCommand(initial, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'victory',
    })
    expect(victory.accepted).toBe(true)
    if (!victory.accepted) return
    expect(victory.state.resourceIntrusion).toMatchObject({
      completedRounds: 1,
      lastOutcome: 'victory',
    })

    const duplicate = applyCommand(victory.state, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'victory',
    })
    expect(duplicate).toMatchObject({
      accepted: false,
      reason: 'ROUND_SEQUENCE_MISMATCH',
    })

    const defeat = applyCommand(victory.state, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 2,
      outcome: 'defeat',
    })
    expect(defeat.accepted).toBe(true)
    if (!defeat.accepted) return
    expect(defeat.state.resourceIntrusion).toMatchObject({
      completedRounds: 2,
      lastOutcome: 'defeat',
    })
  })

  it('raises suspicion and posts an Anomi trace notice when a round is lost', () => {
    const initial = createCampaign('round-defeat-trace')
    const defeat = applyCommand(initial, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'defeat',
    })
    expect(defeat.accepted).toBe(true)
    if (!defeat.accepted) return
    expect(defeat.state.suspicion).toBe(initial.suspicion + 5)
    const notice = defeat.state.resourceIntrusion.communications.find(
      ({ id }) => id === 'intrusion-defeat-1',
    )
    expect(notice).toMatchObject({
      channel: 'anomi',
      popupPolicy: 'nonblocking',
      read: false,
    })
    expect(notice?.message).toContain('의심')
  })

  it('keeps a victorious round free of the defeat penalty', () => {
    const initial = createCampaign('round-victory-clean')
    const victory = applyCommand(initial, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'victory',
    })
    expect(victory.accepted).toBe(true)
    if (!victory.accepted) return
    expect(victory.state.suspicion).toBe(initial.suspicion)
    expect(victory.state.resourceIntrusion.communications.some(
      ({ id }) => id.startsWith('intrusion-defeat-'),
    )).toBe(false)
  })

  it('leaves protocol v5 defeats penalty-free for historical replays', () => {
    const initial = createCampaignForProtocol('round-defeat-v5', 5)
    const defeat = applyCommand(initial, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'defeat',
    })
    expect(defeat.accepted).toBe(true)
    if (!defeat.accepted) return
    expect(defeat.state.suspicion).toBe(initial.suspicion)
    expect(defeat.state.resourceIntrusion.communications.some(
      ({ id }) => id.startsWith('intrusion-defeat-'),
    )).toBe(false)
  })
})
