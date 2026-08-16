import { useMemo, useRef, useState, type PointerEvent } from 'react'

import { useGameSettings } from '../../app/GameContext'
import { CATEGORY_LABELS, DEMO_PROFILE_02 } from '../../game/config'
import type { SuspicionBand } from '../../game/evaluation'
import type { HackNodeDefinition } from '../../game/hacking'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
} from '../../game/model'
import { getCompanyPerformance } from '../../game/resources'
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
  focusNode: HackNodeDefinition | null
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
  focusNode,
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
  const comparisonVector = target
    ? target.requiredVector ?? null
    : focusNode?.costVector ?? null
  const comparisonLabel = target?.label ?? focusNode?.label ?? '경로 완료'
  const companyPerformance = Object.fromEntries(
    COMPANY_CATEGORIES.map((category) => [
      category,
      getCompanyPerformance(state, category),
    ]),
  ) as Record<CompanyCategory, number>
  const totalVectorShortfall = comparisonVector
    ? COMPANY_CATEGORIES.reduce(
        (total, category) =>
          total + Math.max(0, comparisonVector[category] - originCounts[category]),
        0,
      )
    : 0

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
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5v-8Z" />
            <path d="m4 8.5 8 4.5 8-4.5M12 13v8" />
          </svg>
          <div>
            <span>STOLEN COMPUTE // 무상한 저장</span>
            <strong>{message(settings.locale, 'hacking.pocket.label', {})}</strong>
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
      </header>

      <section className="hack-balance-board" aria-label="현재 자원과 해금 비용 비교">
        <header>
          <div>
            <small>CURRENT VECTOR</small>
            <strong>{comparisonLabel}</strong>
          </div>
          <span>{target?.mode === 'charge' ? '실행 충전' : target?.mode === 'recover' ? '복구 투입' : '해금 비용'}</span>
        </header>
        <div className="hack-balance-legend" aria-hidden="true">
          <span>분야</span><span>보유</span><span>요구</span><span>판정</span>
        </div>
        <div className="hack-balance-rows">
          {COMPANY_CATEGORIES.map((category) => {
            const held = originCounts[category]
            const required = comparisonVector?.[category] ?? 0
            const deficit = Math.max(0, required - held)
            const surplus = Math.max(0, held - required)
            const status = comparisonVector === null
              ? 'neutral'
              : deficit > 0
                ? 'deficit'
                : surplus > 0
                  ? 'surplus'
                  : 'ready'
            return (
              <div className="hack-balance-row" data-category={category} data-status={status} key={category}>
                <span className="hack-balance-row__identity">
                  <i aria-hidden="true">{RESOURCE_CATEGORY_VISUALS[category].symbol}</i>
                  <b>{CATEGORY_LABELS[category]}</b>
                  <small>회사 잔여 성능 {companyPerformance[category]}</small>
                </span>
                <strong>{held}</strong>
                <strong>{comparisonVector ? required : '—'}</strong>
                <em>
                  {comparisonVector === null
                    ? '자유 선택'
                    : deficit > 0
                      ? `부족 ${deficit}`
                      : surplus > 0
                        ? `과잉 ${surplus}`
                        : '정확'}
                </em>
              </div>
            )
          })}
        </div>
        <div
          className="hack-balance-verdict"
          data-state={comparisonVector === null ? 'neutral' : totalVectorShortfall > 0 ? 'blocked' : 'ready'}
        >
          <span aria-hidden="true">{comparisonVector === null ? '↳' : totalVectorShortfall > 0 ? '!' : '✓'}</span>
          <div>
            <strong>
              {comparisonVector === null
                ? '분야 제한 없음 — 아무 자원 1개를 직접 선택'
                : totalVectorShortfall > 0
                  ? `분야 조합 불일치 — ${totalVectorShortfall}개 부족`
                  : '현재 최전선의 정확한 조합 확보'}
            </strong>
            <small>많이 보유해도 잘못된 분야는 해금 비용을 대신하지 못합니다.</small>
          </div>
        </div>
      </section>

      <section className="hack-pocket-stream" aria-label="확보 자원 흐름">
        <header>
          <div>
            <small>LIVE CONTRABAND</small>
            <strong>확보 자원 {availableBlocks.length}</strong>
          </div>
          {target ? (
            <span>{message(settings.locale, 'hacking.pocket.target', {
              target: target.label,
              staged: stagedBlockIds.length,
              required: target.requiredResources,
            })}</span>
          ) : (
            <span>칸·용량 제한 없음 // 선택 시 현재 계약에 투입</span>
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
          <span className="hack-pocket-empty">
            {message(settings.locale, 'hacking.pocket.empty', {})}
          </span>
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
