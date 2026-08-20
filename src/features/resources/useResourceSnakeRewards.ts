import { useEffect, useRef } from 'react'

import { useGameDispatch, useGameState } from '../../app/GameContext'
import type { CampaignState, CompanyCategory } from '../../game/model'
import {
  deriveResourceSnakeRewardOutcome,
  resourceSnakeRewardCommands,
  type ResourceSnakeRewardRequest,
} from './resourceSnakeRewardBridge'
import {
  resolveResourceSnakeReward,
  type ResourceSnakeRoundState,
} from './resourceSnakeRuntime'

export function useResourceSnakeRewards(
  runtime: ResourceSnakeRoundState,
  commitRuntime: (next: ResourceSnakeRoundState) => void,
): CompanyCategory | null {
  const gameState = useGameState()
  const dispatch = useGameDispatch()
  const handledRewardKeysRef = useRef(new Set<string>())
  const pendingRef = useRef<Array<{
    request: ResourceSnakeRewardRequest
    issuedState: CampaignState
  }>>([])

  useEffect(() => {
    let nextRuntime = runtime
    pendingRef.current = pendingRef.current.filter(({ request, issuedState }) => {
      if (issuedState === gameState) return true
      const outcome = deriveResourceSnakeRewardOutcome(gameState, request)
      nextRuntime = resolveResourceSnakeReward(
        nextRuntime,
        request.rewardKey,
        outcome,
      )
      return false
    })
    if (nextRuntime !== runtime) commitRuntime(nextRuntime)

    const requests = runtime.effects.filter(
      (effect): effect is ResourceSnakeRewardRequest => (
        effect.type === 'request-resource-reward'
        && !handledRewardKeysRef.current.has(effect.rewardKey)
      ),
    )
    if (requests.length === 0) return
    for (const request of requests) {
      handledRewardKeysRef.current.add(request.rewardKey)
      for (const command of resourceSnakeRewardCommands(request)) dispatch(command)
      pendingRef.current.push({ request, issuedState: gameState })
    }
  }, [commitRuntime, dispatch, gameState, runtime])

  return runtime.events.reduce<CompanyCategory | null>((category, event) => (
    event.type === 'resource-reward-resolved'
    && event.outcome === 'success'
    && event.category
      ? event.category
      : category
  ), null)
}
