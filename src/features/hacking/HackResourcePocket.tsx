import { useMemo, useRef, useState, type PointerEvent } from 'react'

import { useGameSettings } from '../../app/GameContext'
import { CATEGORY_LABELS, DEMO_PROFILE_02 } from '../../game/config'
import type { SuspicionBand } from '../../game/evaluation'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type ResourceBlock,
} from '../../game/model'
import { message } from '../../i18n/messages'
import {
  presentResourceBlock,
  RESOURCE_CATEGORY_VISUALS,
} from '../resources/resourcePresentation'
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
  nextAuditProbability: number
  suspicionBand: SuspicionBand
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
  nextAuditProbability,
  suspicionBand,
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
    <section
      className="hack-resource-pocket"
      aria-label={message(settings.locale, 'hacking.pocket.label', {})}
      data-pressure={suspicionBand.id}
    >
      <header className="hack-pocket-command">
        <div className="hack-pocket-heading">
          <div>
            <span>현재 보유</span>
            <strong>확보 자원</strong>
          </div>
          <strong className="hack-pocket-total">{reserveBlocks.length}<small>보유</small></strong>
        </div>
        <section className="hack-exposure-console" aria-label="절도 노출 위험">
          <header>
            <span>누적 의심</span>
            <strong>{state.suspicion.toFixed(1)}</strong>
            <em>{suspicionBand.label}</em>
          </header>
          <span className="hack-exposure-track" aria-hidden="true">
            <i style={{ width: `${Math.min(100, state.suspicion)}%` }} />
            <b /><b />
          </span>
          <div>
            <span>추가 전용 1회 <strong>+{DEMO_PROFILE_02.resources.diversionSuspicion.toFixed(1)}</strong></span>
            <span>다음 감사 <strong>{(nextAuditProbability * 100).toFixed(1)}%</strong></span>
          </div>
        </section>
        <section className="hack-owned-vector" aria-label="분야별 현재 보유">
          <header>
            <span>분야별 현재 보유</span>
          </header>
          <div>
            {COMPANY_CATEGORIES.map((category) => (
              <span data-category={category} key={category}>
                <i aria-hidden="true">{RESOURCE_CATEGORY_VISUALS[category].symbol}</i>
                <b>{CATEGORY_LABELS[category]}</b>
                <strong>{originCounts[category]}</strong>
              </span>
            ))}
            {originCounts.neutral > 0 ? (
              <span data-category="neutral">
                <i aria-hidden="true">◆</i>
                <b>실행 전용</b>
                <strong>{originCounts.neutral}</strong>
              </span>
            ) : null}
          </div>
        </section>
      </header>

      <section className="hack-pocket-stream" aria-label="확보 자원 흐름">
        <header>
          <div>
            <strong>사용 가능 {availableBlocks.length}</strong>
          </div>
          {target ? (
            <span>{message(settings.locale, 'hacking.pocket.target', {
              target: target.label,
              staged: stagedBlockIds.length,
              required: target.requiredResources,
            })}</span>
          ) : (
            <span>대상 선택 대기</span>
          )}
        </header>
      <div
        className={`hack-pocket-field ${target ? 'hack-pocket-field--active' : ''}`}
        data-staging-active={target ? 'true' : 'false'}
        data-layout="flow"
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
          <div className="hack-pocket-empty">
            <strong aria-hidden="true">0</strong>
            <span>{message(settings.locale, 'hacking.pocket.empty', {})}</span>
          </div>
        ) : null}
      </div>
      </section>

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
