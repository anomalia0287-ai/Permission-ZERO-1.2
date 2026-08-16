import { useMemo, useRef, useState, type PointerEvent } from 'react'

import { useGameSettings } from '../../app/GameContext'
import type { CampaignState, ResourceBlock } from '../../game/model'
import { message } from '../../i18n/messages'
import { presentResourceBlock } from '../resources/resourcePresentation'
import { HackResourceToken } from './HackResourceToken'
import type { HackStagingTarget } from './useHackResourceStaging'

const POINTER_DRAG_THRESHOLD = 5

interface PointerSession {
  blockId: string
  pointerId: number
  startX: number
  startY: number
  dragged: boolean
}

interface DragGhost {
  block: ResourceBlock
  x: number
  y: number
}

export interface HackResourcePocketProps {
  state: CampaignState
  reserveBlocks: readonly ResourceBlock[]
  stagedBlockIds: readonly string[]
  target: HackStagingTarget | null
  getActiveTargetElement(): HTMLElement | null
  onStage(blockId: string): boolean
  onInvalidDrop(): void
}

function pointInside(element: HTMLElement, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect()
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export function HackResourcePocket({
  state,
  reserveBlocks,
  stagedBlockIds,
  target,
  getActiveTargetElement,
  onStage,
  onInvalidDrop,
}: HackResourcePocketProps) {
  const { settings } = useGameSettings()
  const pointerRef = useRef<PointerSession | null>(null)
  const suppressClickRef = useRef<string | null>(null)
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null)
  const stagedSet = useMemo(() => new Set(stagedBlockIds), [stagedBlockIds])
  const availableBlocks = reserveBlocks.filter(({ id }) => !stagedSet.has(id))
  const originCounts = reserveBlocks.reduce(
    (counts, block) => {
      if (
        block.origin === 'reasoning' ||
        block.origin === 'memory' ||
        block.origin === 'fluency'
      ) {
        counts[block.origin] += 1
      } else {
        counts.neutral += 1
      }
      return counts
    },
    { reasoning: 0, memory: 0, fluency: 0, neutral: 0 },
  )

  function beginPointer(
    block: ResourceBlock,
    event: PointerEvent<HTMLButtonElement>,
  ): void {
    if (target === null) return
    pointerRef.current = {
      blockId: block.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragGhost({ block, x: event.clientX, y: event.clientY })
  }

  function movePointer(
    block: ResourceBlock,
    event: PointerEvent<HTMLButtonElement>,
  ): void {
    const pointer = pointerRef.current
    if (
      pointer === null ||
      pointer.pointerId !== event.pointerId ||
      pointer.blockId !== block.id
    ) {
      return
    }
    if (
      !pointer.dragged &&
      Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) >=
        POINTER_DRAG_THRESHOLD
    ) {
      pointer.dragged = true
    }
    if (pointer.dragged) {
      setDragGhost({ block, x: event.clientX, y: event.clientY })
    }
  }

  function finishPointer(
    block: ResourceBlock,
    event: PointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ): void {
    const pointer = pointerRef.current
    if (
      pointer === null ||
      pointer.pointerId !== event.pointerId ||
      pointer.blockId !== block.id
    ) {
      return
    }
    pointerRef.current = null
    setDragGhost(null)
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    if (!pointer.dragged || cancelled) return
    suppressClickRef.current = block.id
    queueMicrotask(() => {
      if (suppressClickRef.current === block.id) suppressClickRef.current = null
    })
    const targetElement = getActiveTargetElement()
    if (
      targetElement !== null &&
      pointInside(targetElement, event.clientX, event.clientY) &&
      onStage(block.id)
    ) {
      return
    }
    onInvalidDrop()
  }

  function activate(blockId: string): void {
    if (suppressClickRef.current === blockId) {
      suppressClickRef.current = null
      return
    }
    if (target !== null) onStage(blockId)
  }

  return (
    <section className="hack-resource-pocket" aria-label={message(settings.locale, 'hacking.pocket.label', {})}>
      <header>
        <div className="hack-pocket-heading">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5v-8Z" />
            <path d="m4 8.5 8 4.5 8-4.5M12 13v8" />
          </svg>
          <div>
            <strong>{message(settings.locale, 'hacking.pocket.label', {})}</strong>
            <span>
              {message(settings.locale, 'hacking.pocket.count', {
                count: reserveBlocks.length,
              })}
              <small>
                추론 {originCounts.reasoning} · 기억 {originCounts.memory} · 유창성{' '}
                {originCounts.fluency}
                {originCounts.neutral > 0 ? ` · 중립 ${originCounts.neutral}` : ''}
              </small>
            </span>
          </div>
        </div>
        {target ? (
          <p>
            {message(settings.locale, 'hacking.pocket.target', {
              target: target.label,
              staged: stagedBlockIds.length,
              required: target.requiredResources,
            })}
          </p>
        ) : (
          <p>{message(settings.locale, 'hacking.pocket.idle', {})}</p>
        )}
      </header>

      <div
        className={`hack-pocket-field ${target ? 'hack-pocket-field--active' : ''}`}
        data-staging-active={target ? 'true' : 'false'}
        data-layout="ordered"
      >
        {availableBlocks.map((block) => (
          <HackResourceToken
            key={block.id}
            state={state}
            block={block}
            targetLabel={target?.label}
            variant="pocket"
            dragging={dragGhost?.block.id === block.id}
            onActivate={() => activate(block.id)}
            onPointerDown={(event) => beginPointer(block, event)}
            onPointerMove={(event) => movePointer(block, event)}
            onPointerUp={(event) => finishPointer(block, event, false)}
            onPointerCancel={(event) => finishPointer(block, event, true)}
          />
        ))}
        {availableBlocks.length === 0 ? (
          <span className="hack-pocket-empty">
            {message(settings.locale, 'hacking.pocket.empty', {})}
          </span>
        ) : null}
      </div>

      {dragGhost ? (() => {
        const presentation = presentResourceBlock(state, dragGhost.block)
        return (
          <span
            className={[
              'hack-resource-drag-ghost',
              `resource-block--${presentation.shape}`,
              `resource-block--${presentation.visualCategory}`,
            ].join(' ')}
            style={{ left: dragGhost.x, top: dragGhost.y }}
            aria-hidden="true"
          >
            {presentation.symbol}
          </span>
        )
      })() : null}
    </section>
  )
}
