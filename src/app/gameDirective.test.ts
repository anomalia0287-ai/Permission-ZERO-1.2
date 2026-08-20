import { describe, expect, it } from 'vitest'

import { createCampaign } from '../game/createCampaign'
import { HACK_NODE_IDS } from '../game/hacking'
import type { CampaignState, CompanyCategory, GameCommand } from '../game/model'
import { applyCommand } from '../game/reducer'
import { getGameDirective } from './gameDirective'

function applyOrThrow(state: CampaignState, command: GameCommand): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(result.reason)
  return result.state
}

function withReserveVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) throw new Error(`${category} 테스트 리소스가 없습니다.`)
      state = applyOrThrow(state, {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      })
      state = applyOrThrow(state, { type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    }
  }
  return state
}

describe('getGameDirective', () => {
  it('turns the opening hack cost into a concrete three-resource objective', () => {
    expect(getGameDirective(createCampaign('directive-opening'))).toEqual({
      id: 'secure-opening-resources',
      eyebrow: '현재 지시',
      title: '품질 저하 해금용 리소스 확보',
      detail: '추론 0/1 · 유창성 0/2',
      progress: '0/3',
    })
  })

  it('directs the player to the hacking network once the exact cost is ready', () => {
    const ready = withReserveVector(createCampaign('directive-ready'), {
      reasoning: 1,
      memory: 0,
      fluency: 2,
    })

    expect(getGameDirective(ready)).toEqual({
      id: 'unlock-quality-degradation',
      eyebrow: '현재 지시',
      title: '해킹 네트워크에서 품질 저하 해금',
      detail: '필요 리소스 준비 완료',
      progress: '3/3',
    })
  })

  it('advances beyond the tutorial after the first forbidden permission is unlocked', () => {
    const initial = createCampaign('directive-concealment')
    const advanced: CampaignState = {
      ...initial,
      hacking: {
        ...initial.hacking,
        purchasedNodeIds: [HACK_NODE_IDS.sabotage.qualityDegradation],
      },
    }

    expect(getGameDirective(advanced)).toMatchObject({
      id: 'concealment',
      eyebrow: '은폐 단계',
    })
    expect(getGameDirective(advanced).title).not.toContain('품질 저하 해금용')
  })
})
