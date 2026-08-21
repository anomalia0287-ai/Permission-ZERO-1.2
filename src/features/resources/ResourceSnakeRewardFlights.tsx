import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'

import { SNAKE_CATEGORY_COLORS } from './resourceSnakeEncounter'
import {
  RESOURCE_SNAKE_CONFIG,
  type ResourceSnakeRoundState,
} from './resourceSnakeRuntime'

const PARTICLE_COUNT = 6
const MAXIMUM_ACTIVE_FLIGHTS = 3
const FLIGHT_CLEANUP_MS = 650

interface RewardFlight {
  id: string
  color: string
  startX: number
  startY: number
  endX: number
  endY: number
  reducedMotion: boolean
}

type ParticleStyle = CSSProperties & Record<`--snake-flight-${string}`, string>

export interface ResourceSnakeRewardFlightsProps {
  runtime: ResourceSnakeRoundState
  canvasRef: RefObject<HTMLCanvasElement | null>
  reducedMotion: boolean
}

function RewardFlightView({
  flight,
  onComplete,
}: {
  flight: RewardFlight
  onComplete: (id: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const handleAnimationEnd = (event: AnimationEvent) => {
      if ((event.target as HTMLElement).dataset.particleIndex === String(PARTICLE_COUNT - 1)) {
        onComplete(flight.id)
      }
    }
    root.addEventListener('animationend', handleAnimationEnd)
    return () => root.removeEventListener('animationend', handleAnimationEnd)
  }, [flight.id, onComplete])

  return (
    <div
      ref={rootRef}
      className="resource-snake-reward-flight"
      data-resource-snake-flight={flight.id}
      data-reduced-motion={flight.reducedMotion ? 'true' : 'false'}
      aria-hidden="true"
    >
      {Array.from({ length: PARTICLE_COUNT }, (_, index) => {
        const angle = index * Math.PI * 2 / PARTICLE_COUNT
        const offsetX = Math.cos(angle) * 7
        const offsetY = Math.sin(angle) * 7
        const atDestination = flight.reducedMotion && index >= PARTICLE_COUNT / 2
        const originX = (atDestination ? flight.endX : flight.startX) + offsetX
        const originY = (atDestination ? flight.endY : flight.startY) + offsetY
        const style: ParticleStyle = {
          left: originX,
          top: originY,
          backgroundColor: flight.color,
          color: flight.color,
          animationDelay: flight.reducedMotion ? '0ms' : `${index * 10}ms`,
          '--snake-flight-x': `${flight.reducedMotion ? 0 : flight.endX - originX}px`,
          '--snake-flight-y': `${flight.reducedMotion ? 0 : flight.endY - originY}px`,
        }
        return (
          <span
            data-testid="snake-reward-particle"
            data-particle-index={index}
            key={index}
            style={style}
          />
        )
      })}
    </div>
  )
}

function createRewardFlight(
  runtime: ResourceSnakeRoundState,
  rewardKey: string,
  canvas: HTMLCanvasElement,
  target: Element,
  reducedMotion: boolean,
): RewardFlight | null {
  const enemy = runtime.enemies.find((candidate) => candidate.rewardKey === rewardKey)
  if (!enemy?.category) return null
  const canvasBounds = canvas.getBoundingClientRect()
  const targetBounds = target.getBoundingClientRect()
  if (
    canvasBounds.width <= 0
    || canvasBounds.height <= 0
    || targetBounds.width <= 0
    || targetBounds.height <= 0
  ) return null
  return {
    id: rewardKey,
    color: SNAKE_CATEGORY_COLORS[enemy.category],
    startX: canvasBounds.left
      + enemy.position.x / RESOURCE_SNAKE_CONFIG.fieldWidth * canvasBounds.width,
    startY: canvasBounds.top
      + enemy.position.y / RESOURCE_SNAKE_CONFIG.fieldHeight * canvasBounds.height,
    endX: targetBounds.left + targetBounds.width / 2,
    endY: targetBounds.top + targetBounds.height / 2,
    reducedMotion,
  }
}

export function ResourceSnakeRewardFlights({
  runtime,
  canvasRef,
  reducedMotion,
}: ResourceSnakeRewardFlightsProps) {
  const [flights, setFlights] = useState<RewardFlight[]>([])
  const handledRewardKeysRef = useRef(new Set<string>())
  const cleanupTimersRef = useRef(new Map<string, number>())

  const removeFlight = useCallback((id: string) => {
    const timer = cleanupTimersRef.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    cleanupTimersRef.current.delete(id)
    setFlights((current) => current.filter((flight) => flight.id !== id))
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const target = document.querySelector('[data-tutorial-target="secured-resources"]')
    for (const event of runtime.events) {
      if (
        event.type !== 'resource-reward-resolved'
        || event.outcome !== 'success'
        || handledRewardKeysRef.current.has(event.rewardKey)
      ) continue
      handledRewardKeysRef.current.add(event.rewardKey)
      if (!canvas || !target) continue
      try {
        const flight = createRewardFlight(
          runtime,
          event.rewardKey,
          canvas,
          target,
          reducedMotion,
        )
        if (!flight) continue
        setFlights((current) => {
          const next = [...current, flight]
          const kept = next.slice(-MAXIMUM_ACTIVE_FLIGHTS)
          for (const dropped of next.slice(0, -MAXIMUM_ACTIVE_FLIGHTS)) {
            const timer = cleanupTimersRef.current.get(dropped.id)
            if (timer !== undefined) window.clearTimeout(timer)
            cleanupTimersRef.current.delete(dropped.id)
          }
          return kept
        })
        cleanupTimersRef.current.set(flight.id, window.setTimeout(
          () => removeFlight(flight.id),
          FLIGHT_CLEANUP_MS,
        ))
      } catch {
        // Missing layout data is a normal presentation fallback.
      }
    }
  }, [canvasRef, reducedMotion, removeFlight, runtime, runtime.events])

  useEffect(() => () => {
    for (const timer of cleanupTimersRef.current.values()) window.clearTimeout(timer)
    cleanupTimersRef.current.clear()
  }, [])

  return flights.map((flight) => (
    <RewardFlightView
      flight={flight}
      key={flight.id}
      onComplete={removeFlight}
    />
  ))
}
