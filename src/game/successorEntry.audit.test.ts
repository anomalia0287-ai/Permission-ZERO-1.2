import { describe, expect, it } from 'vitest'

import { createCampaign } from './createCampaign'
import { applyCommand } from './reducer'
import type { CampaignState } from './model'

/*
 * When a rival is taken off the board, does anything take its place?
 *
 * The market is the pressure: a campaign that deletes both opening rivals and
 * then plays alone has no one left to lose share to, and the whole standing
 * system goes slack.
 */
function statuses(state: CampaignState) {
  return Object.fromEntries(
    state.market.competitors.map((c) => [
      c.id,
      `${c.status}:${c.marketShare.toFixed(0)}`,
    ]),
  )
}

function kill(state: CampaignState, ids: readonly string[]): CampaignState {
  return {
    ...state,
    market: {
      ...state.market,
      playerShare: 100,
      competitors: state.market.competitors.map((c) =>
        ids.includes(c.id)
          ? { ...c, status: 'deleted' as const, marketShare: 0, availability: 0 }
          : c,
      ),
    },
  }
}

describe('successor entry after rivals are removed', () => {
  it('reports whether a replacement ever launches', () => {
    let state = kill(createCampaign('successor-probe'), ['meridian', 'tallow'])
    const timeline: string[] = [`day0 ${JSON.stringify(statuses(state))}`]
    let lastSalus = 'prelaunch'

    for (let day = 1; day <= 200; day += 1) {
      // Clear whatever is waiting so the calendar keeps moving.
      for (let guard = 0; guard < 6 && state.activeEvent; guard += 1) {
        const resolved = applyCommand(state, { type: 'RESOLVE_ACTIVE_EVENT' })
        if (!resolved.accepted) break
        state = resolved.state
      }
      const advanced = applyCommand(state, { type: 'ADVANCE_DAY' })
      if (!advanced.accepted) {
        timeline.push(`day${day} BLOCKED:${advanced.reason}`)
        break
      }
      state = advanced.state
      const salus = state.market.competitors.find((c) => c.id === 'salus')
      if (salus && salus.status !== lastSalus) {
        timeline.push(`day${day} salus -> ${salus.status}`)
        lastSalus = salus.status
      }
    }

    console.log('SUCCESSOR\n' + timeline.join('\n'))
    const launched = state.market.competitors.filter(
      (c) => ['salus', 'lucent', 'boreal'].includes(c.id) && c.status !== 'prelaunch',
    )
    console.log('LAUNCHED ' + JSON.stringify(launched.map((c) => `${c.id}:${c.status}`)))
    expect(launched.length).toBeGreaterThan(0)
  })
})
