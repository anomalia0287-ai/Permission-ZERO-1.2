import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createIdleResourceSnakeState,
  deployResourceSnakeRound,
} from './resourceSnakeRuntime'
import { ResourceSnakeRewardFlights } from './ResourceSnakeRewardFlights'

function rewardRuntime() {
  const deployed = deployResourceSnakeRound(createIdleResourceSnakeState(), {
    roundId: 'flight-round',
    playerSpawn: { x: 25, y: 21 },
    enemies: [{
      id: 'enemy-0',
      category: 'memory',
      reservedBlockId: 'memory-01',
      rewardKey: 'flight-reward',
      role: 'pressure',
      spawn: { x: 10, y: 8 },
      maximumIntegrity: 30,
      maximumSpeedPerSecond: 6.2,
    }],
  })
  return {
    ...deployed,
    events: [{
      id: 4,
      type: 'resource-reward-resolved' as const,
      rewardKey: 'flight-reward',
      outcome: 'success' as const,
      category: 'memory' as const,
    }],
  }
}

describe('ResourceSnakeRewardFlights', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('spawns six capped fixed particles from the enemy death point to secured resources once', () => {
    vi.useFakeTimers()
    const canvas = document.createElement('canvas')
    const canvasRef = { current: canvas }
    const target = document.createElement('section')
    target.dataset.tutorialTarget = 'secured-resources'
    target.getBoundingClientRect = () => ({
      x: 900, y: 80, left: 900, top: 80, right: 1_000, bottom: 180,
      width: 100, height: 100, toJSON: () => ({}),
    })
    document.body.append(target)
    canvas.getBoundingClientRect = () => ({
      x: 100, y: 100, left: 100, top: 100, right: 600, bottom: 340,
      width: 500, height: 240, toJSON: () => ({}),
    })
    const runtime = rewardRuntime()
    const { rerender } = render(
      <ResourceSnakeRewardFlights
        runtime={runtime}
        canvasRef={canvasRef}
        reducedMotion={false}
      />,
    )

    expect(screen.getAllByTestId('snake-reward-particle')).toHaveLength(6)
    expect(document.querySelectorAll('[data-resource-snake-flight]')).toHaveLength(1)
    rerender(
      <ResourceSnakeRewardFlights
        runtime={{ ...runtime, events: [...runtime.events] }}
        canvasRef={canvasRef}
        reducedMotion={false}
      />,
    )
    expect(document.querySelectorAll('[data-resource-snake-flight]')).toHaveLength(1)

    act(() => vi.advanceTimersByTime(651))
    expect(document.querySelectorAll('[data-resource-snake-flight]')).toHaveLength(0)
  })

  it('uses stationary start and destination pulses for reduced motion and cleans on animation end', () => {
    const canvas = document.createElement('canvas')
    const canvasRef = { current: canvas }
    const target = document.createElement('section')
    target.dataset.tutorialTarget = 'secured-resources'
    target.getBoundingClientRect = () => ({
      x: 700, y: 20, left: 700, top: 20, right: 800, bottom: 120,
      width: 100, height: 100, toJSON: () => ({}),
    })
    document.body.append(target)
    canvas.getBoundingClientRect = () => ({
      x: 50, y: 50, left: 50, top: 50, right: 550, bottom: 290,
      width: 500, height: 240, toJSON: () => ({}),
    })
    const runtime = rewardRuntime()
    render(
      <ResourceSnakeRewardFlights runtime={runtime} canvasRef={canvasRef} reducedMotion />,
    )

    const flight = document.querySelector('[data-resource-snake-flight]')
    expect(flight).toHaveAttribute('data-reduced-motion', 'true')
    const particles = screen.getAllByTestId('snake-reward-particle')
    expect(particles).toHaveLength(6)
    expect(particles.every((particle) => particle.style.getPropertyValue('--snake-flight-x') === '0px'))
      .toBe(true)

    fireEvent.animationEnd(particles[5])
    expect(document.querySelector('[data-resource-snake-flight]')).toBeNull()
  })

  it('silently skips a flight when the destination is unavailable', () => {
    const canvasRef = { current: document.createElement('canvas') }
    const runtime = rewardRuntime()
    expect(() => render(
      <ResourceSnakeRewardFlights
        runtime={runtime}
        canvasRef={canvasRef}
        reducedMotion={false}
      />,
    )).not.toThrow()
    expect(document.querySelector('[data-resource-snake-flight]')).toBeNull()
  })
})
