import { render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { MemoryStorage } from '../../test/fixtures'
import { selectEligibleSnakeResourceCandidates } from './resourceSnakeEncounter'
import {
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
  type ResourceSnakeRoundState,
} from './resourceSnakeRuntime'
import { useResourceSnakeRewards } from './useResourceSnakeRewards'

function RewardHarness() {
  const campaign = useGameState()
  const [candidate] = useState(
    () => selectEligibleSnakeResourceCandidates(campaign.resources)[0],
  )
  const [runtime, setRuntime] = useState<ResourceSnakeRoundState>(() => {
    const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
      roundId: 'reward-round',
      playerSpawn: { x: 25, y: 21 },
      enemies: [{
        id: 'enemy-0',
        category: candidate.origin,
        reservedBlockId: candidate.blockId,
        rewardKey: `reward:${candidate.blockId}`,
        role: 'pressure',
        spawn: { x: 25, y: 3.5 },
        maximumIntegrity: 30,
        maximumSpeedPerSecond: 6.2,
      }],
    })
    return {
      ...deployed,
      enemies: deployed.enemies.map((enemy) => ({
        ...enemy,
        phase: 'exploding' as const,
        integrity: 0,
        reservationStatus: 'pending' as const,
      })),
      effects: [{
        id: 1,
        type: 'request-resource-reward',
        rewardKey: `reward:${candidate.blockId}`,
        roundId: 'reward-round',
        enemyId: 'enemy-0',
        blockId: candidate.blockId,
      }],
    }
  })
  const acquiredCategory = useResourceSnakeRewards(runtime, setRuntime)
  const block = campaign.resources.blocks[candidate.blockId]
  return (
    <output
      data-location={block.location.kind}
      data-reservation={runtime.enemies[0].reservationStatus ?? 'none'}
      data-player-category={acquiredCategory ?? 'white'}
    />
  )
}

describe('useResourceSnakeRewards', () => {
  it('settles a runtime reward through the campaign and returns the acquired player color', async () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="snake-reward-hook">
        <RewardHarness />
      </GameProvider>,
    )

    await waitFor(() => {
      const result = screen.getByRole('status')
      expect(result).toHaveAttribute('data-location', 'reserve')
      expect(result).toHaveAttribute('data-reservation', 'resolved')
      expect(result).not.toHaveAttribute('data-player-category', 'white')
    })
  })
})
