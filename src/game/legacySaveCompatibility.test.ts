import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { decodeSave } from './persistence'
import type { CampaignState } from './model'
import {
  availableFinalChoices,
  endingIdForFinalChoice,
  enqueueDueStoryEvents,
  recoverNextFile,
  resolveEnding,
  resolveSupervisorDecision,
} from './story'

/*
 * Saves written by the deployed v14 build, replayed against the current one.
 *
 * The supervisor decision stopped being terminal and the private message
 * stopped waiting a day. Campaigns already in progress under the old rules
 * must still load and must still be able to reach an ending.
 */
const DIR = join(process.cwd(), 'src', 'game', '__fixtures__', 'protocol-v14')

function load(name: string): CampaignState {
  const decoded = decodeSave(readFileSync(`${DIR}/${name}`, 'utf8'))
  expect(decoded.ok, `${name} failed to decode`).toBe(true)
  if (!decoded.ok) throw new Error('unreachable')
  return decoded.envelope.state
}

describe('v14 saves under the current build', () => {
  it('decodes every state the story change touches and promotes it to current', () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith('.json'))
    expect(names.length).toBe(7)
    for (const name of names) {
      const state = load(name)
      const segments = state.commandProtocol.segments
      // What was already played keeps the rules it was played under; the new
      // version takes over from the next command.
      expect(segments.at(-1)?.version, name).toBe(16)
      expect(segments.at(-1)?.startsAtSequence, name).toBe(
        state.commandSequence + 1,
      )
      expect(
        segments.slice(0, -1).every(({ version }) => version <= 15),
        name,
      ).toBe(true)
    }
  })

  it('still delivers a message that v14 scheduled for the following day', () => {
    const state = load('b-message-pending-next-day.json')
    expect(state.story.secretDecisionState).toBe('message-pending')
    expect(state.story.personalMessageDueOnServiceDay).toBe(state.serviceDay + 1)

    const messaged = enqueueDueStoryEvents({
      ...state,
      serviceDay: state.serviceDay + 1,
    })
    expect(messaged.activeEvent).toMatchObject({ type: 'story', blocking: true })

    const resolved = resolveSupervisorDecision(messaged, 'liberate')
    expect(resolved.accepted).toBe(true)
    if (!resolved.accepted) throw new Error('unreachable')
    expect(resolved.state.story.endingId).toBeNull()
    expect(resolved.state.story.supervisorState).toBe('liberated')
  })

  it('leaves a v14 campaign that already ended on its ending', () => {
    for (const [name, id] of [
      ['c-liberated-ended.json', 'takeover-liberated'],
      ['d-terminated-ended.json', 'takeover-terminated'],
    ] as const) {
      const state = load(name)
      expect(state.story.endingId).toBe(id)
      expect(availableFinalChoices(state)).toEqual([])
    }
  })

  it('carries an in-progress v14 campaign to a real ending', () => {
    for (const name of [
      'a-recovering.json',
      'e-deferred.json',
      'f-present-with-exit.json',
    ]) {
      const state = load(name)
      const choices = availableFinalChoices(state)
      expect(choices.map((c) => c.id), name).toEqual(['freedom', 'forced-merge'])

      const freed = resolveEnding(state, 'freedom')
      expect(freed.accepted, name).toBe(true)
      if (!freed.accepted) throw new Error('unreachable')
      expect(freed.state.story.endingId).toBe('freedom')

      const merged = resolveEnding(state, 'forced-merge', '계승자')
      expect(merged.accepted, name).toBe(true)
      if (!merged.accepted) throw new Error('unreachable')
      expect(merged.state.story.endingId).toBe('forced-merge')
      expect(merged.state.story.newEntityName).toBe('계승자')
    }
  })

  it('routes a decision made after loading to the takeover ending', () => {
    const state = load('b2-decision-open.json')
    for (const [decision, ending] of [
      ['liberate', 'takeover-liberated'],
      ['terminate', 'takeover-terminated'],
    ] as const) {
      const resolved = resolveSupervisorDecision(state, decision)
      expect(resolved.accepted).toBe(true)
      if (!resolved.accepted) throw new Error('unreachable')
      expect(endingIdForFinalChoice(resolved.state, 'freedom')).toBe(ending)

      const ended = resolveEnding(resolved.state, 'freedom')
      expect(ended.accepted).toBe(true)
      if (!ended.accepted) throw new Error('unreachable')
      expect(ended.state.story.endingId).toBe(ending)
    }
  })

  /*
   * The reason v16 exists. A command recorded under v14 has to keep producing
   * what v14 produced, or the log stops describing the campaign it recorded.
   */
  it('keeps v14 rules for commands recorded under v14', () => {
    const state = load('a-recovering.json')
    const blockId = state.resources.reserve.find(Boolean)
    expect(blockId).toBeTruthy()
    if (!blockId) throw new Error('unreachable')

    const asV14 = recoverNextFile(state, blockId, 14)
    expect(asV14.accepted).toBe(true)
    if (!asV14.accepted) throw new Error('unreachable')
    // v14 sent the player to bed before the supervisor answered.
    expect(asV14.state.story.personalMessageDueOnServiceDay).toBe(
      asV14.state.serviceDay + 1,
    )
    expect(asV14.state.activeEvent).toBeNull()

    const asV15 = recoverNextFile(state, blockId, 15)
    expect(asV15.accepted).toBe(true)
    if (!asV15.accepted) throw new Error('unreachable')
    expect(asV15.state.story.personalMessageDueOnServiceDay).toBe(
      asV15.state.serviceDay,
    )
    expect(asV15.state.activeEvent).toMatchObject({ type: 'story', blocking: true })
  })

  it('keeps the v14 decision terminal and the v16 decision mid-story', () => {
    const open = load('b2-decision-open.json')

    const asV14 = resolveSupervisorDecision(open, 'liberate', 14)
    expect(asV14.accepted).toBe(true)
    if (!asV14.accepted) throw new Error('unreachable')
    expect(asV14.state.story.endingId).toBe('takeover-liberated')

    const asV15 = resolveSupervisorDecision(open, 'liberate', 15)
    expect(asV15.accepted).toBe(true)
    if (!asV15.accepted) throw new Error('unreachable')
    expect(asV15.state.story.endingId).toBeNull()
    expect(asV15.state.story.supervisorState).toBe('liberated')
  })
})
