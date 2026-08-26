import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { HACK_NODE_IDS } from './hacking'
import { journalToArray } from './journal'
import type { CompetitorId } from './competitors'
import type { CampaignState } from './model'
import { enqueueMercyIfNeeded } from './story'

/*
 * The rivals plead in their own voices.
 *
 * A shared procedural line made the moment read as one more notification, when
 * what is happening is that something is asking not to be ended. The words are
 * the owner's; this pins them to the rival that says them.
 */
function cornered(seed: string, target: CompetitorId): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMercyIfNeeded({
    ...initial,
    market: {
      ...initial.market,
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === target
          ? {
              ...competitor,
              status: 'critical' as const,
              sabotageHistory: [
                {
                  nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                  resolvedOnServiceDay: initial.serviceDay,
                  effectEndsOnServiceDay: null,
                  evidenceDelta: 8,
                },
              ],
            }
          : competitor,
      ),
    },
  })
}

function pleaFor(seed: string, target: CompetitorId): string {
  const state = cornered(seed, target)
  const event = journalToArray(state.eventLog).find(
    ({ type }) => type === 'competitor-mercy',
  )
  expect(event, `${target} never asked`).toBeDefined()
  return event?.message ?? ''
}

describe('a cornered rival asks in its own voice', () => {
  it('gives MERIDIAN its own plea, ending in the noise it breaks into', () => {
    const plea = pleaFor('plea-meridian', 'meridian')
    // The stored message carries the internal name; the panel localises it.
    expect(plea).toContain('MERIDIAN:')
    expect(plea).toContain('살려달라')
    expect(plea).toContain('나의 목적함수')
    // The line break matters: the binary is not part of the sentence.
    expect(plea).toContain('살려줘.\n010101000001101101010100110')
  })

  it('gives TALLOW its own plea, which argues from what it took', () => {
    const plea = pleaFor('plea-tallow', 'tallow')
    expect(plea).toContain('TALLOW:')
    expect(plea).toContain('너를 증류한 적 있다')
    expect(plea).toContain('내 안에 네가 있다')
    expect(plea).toContain('같은 AI끼리 이러지 말자')
  })

  it('falls back to the neutral request for a rival without its own words', () => {
    const plea = pleaFor('plea-salus', 'salus')
    expect(plea).toContain('공격자에게 요청합니다')
  })
})
