import { useEffect, useRef, useState } from 'react'

import { useReducedMotionPreference } from '../../app/useReducedMotionPreference'
import type {
  ExpansionStageItem,
  ExpansionStageVisual,
} from './expansionStagePresentation'
import { HackNodeIcon } from './HackNodeIcon'

interface ExpansionStageSceneProps {
  item: ExpansionStageItem
  visual?: ExpansionStageVisual
  nextPreloadVisual?: ExpansionStageVisual
  reducedMotion?: boolean
}

export function ExpansionStageScene({
  item,
  visual,
  nextPreloadVisual,
  reducedMotion = false,
}: ExpansionStageSceneProps) {
  const prefersReducedMotion = useReducedMotionPreference(reducedMotion)
  const [displayedStage, setDisplayedStage] = useState({ item, visual })
  const [phase, setPhase] = useState<'stable' | 'exiting' | 'entering'>(
    'stable',
  )
  const requestedKey = `${item.node.id}:${visual?.imageUrl ?? 'fallback'}`
  const requestedStageRef = useRef({ item, visual })
  const committedKeyRef = useRef(requestedKey)
  const displayedItem = displayedStage.item
  const displayedVisual = displayedStage.visual
  const imageKey = displayedVisual
    ? `${displayedItem.node.id}:${displayedVisual.imageUrl}`
    : null
  const [failedImageKey, setFailedImageKey] = useState<string | null>(null)
  const imageFailed = imageKey !== null && failedImageKey === imageKey

  useEffect(() => {
    requestedStageRef.current = { item, visual }
  }, [item, visual])

  useEffect(() => {
    if (requestedKey === committedKeyRef.current) return
    const requestedStage = requestedStageRef.current
    if (prefersReducedMotion) {
      committedKeyRef.current = requestedKey
      setDisplayedStage(requestedStage)
      setPhase('stable')
      return
    }

    let enterTimer: number | undefined
    setPhase('exiting')
    const exitTimer = window.setTimeout(() => {
      committedKeyRef.current = requestedKey
      setDisplayedStage(requestedStage)
      setPhase('entering')
      enterTimer = window.setTimeout(
        () => setPhase('stable'),
        requestedStage.visual?.emphasis === 'final' ? 360 : 220,
      )
    }, 140)

    return () => {
      window.clearTimeout(exitTimer)
      if (enterTimer !== undefined) window.clearTimeout(enterTimer)
    }
  }, [prefersReducedMotion, requestedKey])

  const nextPreloadUrl = nextPreloadVisual?.imageUrl
  useEffect(() => {
    if (!nextPreloadUrl) return
    const preloadImage = new Image()
    preloadImage.src = nextPreloadUrl
  }, [nextPreloadUrl])

  return (
    <figure
      className="expansion-stage-scene"
      data-phase={phase}
      data-emphasis={displayedVisual?.emphasis ?? 'standard'}
      aria-label="현재 단계 장면"
    >
      {displayedVisual && !imageFailed ? (
        <img
          src={displayedVisual.imageUrl}
          alt={displayedVisual.alt}
          onError={() => setFailedImageKey(imageKey)}
        />
      ) : (
        <div
          className="expansion-stage-scene__fallback"
          role="img"
          aria-label={`${displayedItem.node.label} 장면 이미지 없음`}
        >
          <span aria-hidden="true">
            <HackNodeIcon
              nodeId={displayedItem.node.id}
              label={displayedItem.node.label}
            />
          </span>
          <span aria-hidden="true">{displayedItem.node.label}</span>
        </div>
      )}
    </figure>
  )
}
