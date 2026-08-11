import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  configureGameAudio,
  playGameSound,
  unlockGameAudio,
} from '../../audio/audioEngine'
import { useGameDispatch, useGameSettings, useGameState } from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import { expectedPerformance, serviceMonthForDay } from '../../game/evaluation'
import {
  COMPANY_CATEGORIES,
  type BlockId,
  type CompanyCategory,
} from '../../game/model'
import { getCompanyPerformance, previewDiversion } from '../../game/resources'
import { ReserveGrid } from './ReserveGrid'
import { ResourceBlock, type BlockInputMethod } from './ResourceBlock'

const DRAG_THRESHOLD_PX = 8
const TRAIL_NODE_COUNT = 5

interface PointerCandidate {
  blockId: BlockId
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
  dropCell: number | null
}

interface PendingDiversion {
  blockId: BlockId
  destinationCell: number
  commandSequence: number
}

function playAfterUnlock(cue: Parameters<typeof playGameSound>[0]) {
  void unlockGameAudio().then((unlocked) => {
    if (unlocked) playGameSound(cue)
  })
}

function PanelHeading() {
  return (
    <header className="panel-heading">
      <span className="panel-index">02</span>
      <div>
        <h2>회사 제공 성능</h2>
        <p>ALLOCATED COMPUTE / 3 × 6 PER DOMAIN</p>
      </div>
      <span className="interaction-hint">클릭 선택 · 8px 당겨 분리</span>
    </header>
  )
}

function validCompanyBlock(
  state: ReturnType<typeof useGameState>,
  blockId: BlockId,
): boolean {
  const block = state.resources.blocks[blockId]
  return Boolean(
    block &&
      block.location.kind === 'company' &&
      block.contribution === 'normal' &&
      !state.activeEvent &&
      state.resources.reserve.some((cell) => cell === null),
  )
}

export function ResourceBoard() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const [selectedBlockId, setSelectedBlockId] = useState<BlockId | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<BlockId | null>(null)
  const [previewCell, setPreviewCell] = useState<number | null>(null)
  const [hoveredCell, setHoveredCell] = useState<number | null>(null)
  const [returningBlockId, setReturningBlockId] = useState<BlockId | null>(null)
  const [settlingCell, setSettlingCell] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [rovingBlocks, setRovingBlocks] = useState<
    Partial<Record<CompanyCategory, BlockId>>
  >({})
  const boardRef = useRef<HTMLElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const trailRefs = useRef<Array<HTMLSpanElement | null>>([])
  const pointerRef = useRef<PointerCandidate | null>(null)
  const pendingRef = useRef<PendingDiversion | null>(null)
  const suppressClickRef = useRef(false)
  const settleTimerRef = useRef<number | null>(null)
  const returnTimerRef = useRef<number | null>(null)
  const impactTimerRef = useRef<number | null>(null)

  const reserveCount = state.resources.reserve.filter(Boolean).length
  const reserveFull = reserveCount === state.resources.reserve.length
  const firstEmptyReserveCell = state.resources.reserve.findIndex((cell) => cell === null)
  const selectedBlock = selectedBlockId
    ? state.resources.blocks[selectedBlockId]
    : null
  const selectedLocation = selectedBlock?.location.kind === 'company'
    ? selectedBlock.location
    : null
  const effectivePreviewCell = previewCell ?? firstEmptyReserveCell
  const preview = useMemo(() => {
    if (!selectedBlockId || effectivePreviewCell < 0) return null
    return previewDiversion(state, selectedBlockId, effectivePreviewCell)
  }, [effectivePreviewCell, selectedBlockId, state])

  useEffect(() => {
    configureGameAudio({
      masterVolume: settings.masterVolume,
      musicVolume: settings.musicVolume,
      effectsVolume: settings.effectsVolume,
      muted: settings.muted,
    })
  }, [settings.effectsVolume, settings.masterVolume, settings.musicVolume, settings.muted])

  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || state.commandSequence <= pending.commandSequence) return
    pendingRef.current = null
    const location = state.resources.blocks[pending.blockId]?.location

    if (
      location?.kind === 'reserve' &&
      location.cellIndex === pending.destinationCell
    ) {
      setSettlingCell(pending.destinationCell)
      setAnnouncement(`확보 리소스 ${pending.destinationCell + 1}번에 흡착 완료`)
      playGameSound('latch')
      if (impactTimerRef.current) window.clearTimeout(impactTimerRef.current)
      impactTimerRef.current = window.setTimeout(() => playGameSound('impact'), 58)
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = window.setTimeout(() => setSettlingCell(null), 360)
    } else if (state.bombs.activeInterrogation?.blockId === pending.blockId) {
      setAnnouncement('분리 중 이상 신호가 감지되었습니다. 감독관 응답이 필요합니다.')
      playGameSound('alarm')
    } else {
      setAnnouncement('명령이 거부되어 리소스가 원래 위치로 복귀했습니다.')
      playGameSound('reject')
    }

    setSelectedBlockId(null)
    setPreviewCell(null)
  }, [state.bombs.activeInterrogation?.blockId, state.commandSequence, state.resources.blocks])

  useEffect(
    () => () => {
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current)
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
      if (impactTimerRef.current) window.clearTimeout(impactTimerRef.current)
    },
    [],
  )

  function focusDestination(cellIndex: number) {
    window.setTimeout(() => {
      boardRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-reserve-cell="${cellIndex}"]`)
        ?.focus()
    }, 0)
  }

  function selectBlock(blockId: BlockId, method: BlockInputMethod) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (!validCompanyBlock(state, blockId)) {
      setAnnouncement(reserveFull ? '확보 리소스 칸이 가득 찼습니다.' : '현재 분리할 수 없는 리소스입니다.')
      playAfterUnlock('reject')
      return
    }

    setSelectedBlockId(blockId)
    setPreviewCell(firstEmptyReserveCell)
    const location = state.resources.blocks[blockId].location
    const category = location.kind === 'company' ? CATEGORY_LABELS[location.category] : '회사'
    setAnnouncement(`${category} 리소스를 선택했습니다. 비어 있는 확보 칸을 선택하세요.`)
    playAfterUnlock('select')
    if (method === 'keyboard' && firstEmptyReserveCell >= 0) {
      focusDestination(firstEmptyReserveCell)
    }
  }

  function clearSelection(message = '리소스 선택을 취소했습니다.') {
    setSelectedBlockId(null)
    setPreviewCell(null)
    setHoveredCell(null)
    setAnnouncement(message)
  }

  function commitDiversion(blockId: BlockId, destinationCell: number) {
    const result = previewDiversion(state, blockId, destinationCell)
    if (!result.valid || state.activeEvent) {
      setAnnouncement('해당 칸으로는 리소스를 옮길 수 없습니다. 원래 위치로 복귀합니다.')
      setReturningBlockId(blockId)
      playGameSound('reject')
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
      returnTimerRef.current = window.setTimeout(() => setReturningBlockId(null), 280)
      return
    }

    pendingRef.current = {
      blockId,
      destinationCell,
      commandSequence: state.commandSequence,
    }
    dispatch({ type: 'DIVERT_BLOCK', blockId, destinationCell })
  }

  function destinationFromPoint(clientX: number, clientY: number): number | null {
    if (typeof document.elementFromPoint !== 'function') return null
    const element = document.elementFromPoint(clientX, clientY)
    const carrier = element?.closest<HTMLElement>('[data-reserve-cell]')
    if (!carrier) return null
    const cellIndex = Number(carrier.dataset.reserveCell)
    if (!Number.isInteger(cellIndex) || state.resources.reserve[cellIndex] !== null) {
      return null
    }
    return cellIndex
  }

  function updateDragVisual(clientX: number, clientY: number) {
    overlayRef.current?.style.setProperty(
      'transform',
      `translate3d(${clientX - 22}px, ${clientY - 22}px, 0) rotate(2deg)`,
    )
    const pointer = pointerRef.current
    if (!pointer || settings.reducedMotion) return
    trailRefs.current.forEach((node, index) => {
      if (!node) return
      const factor = (TRAIL_NODE_COUNT - index) / (TRAIL_NODE_COUNT + 1)
      const x = clientX + (pointer.startX - clientX) * factor
      const y = clientY + (pointer.startY - clientY) * factor
      node.style.transform = `translate3d(${x - 4}px, ${y - 4}px, 0)`
      node.style.opacity = String((index + 1) / (TRAIL_NODE_COUNT + 2))
    })
  }

  function beginPointer(
    blockId: BlockId,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (!validCompanyBlock(state, blockId)) return
    void unlockGameAudio()
    pointerRef.current = {
      blockId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      dropCell: null,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function movePointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    const distance = Math.hypot(
      event.clientX - pointer.startX,
      event.clientY - pointer.startY,
    )
    if (!pointer.dragging && distance >= DRAG_THRESHOLD_PX) {
      pointer.dragging = true
      suppressClickRef.current = true
      setSelectedBlockId(pointer.blockId)
      setPreviewCell(firstEmptyReserveCell)
      setDraggingBlockId(pointer.blockId)
      playGameSound('resistance')
    }
    if (!pointer.dragging) return

    updateDragVisual(event.clientX, event.clientY)
    const destination = destinationFromPoint(event.clientX, event.clientY)
    if (destination !== pointer.dropCell) {
      pointer.dropCell = destination
      setHoveredCell(destination)
      if (destination !== null) {
        setPreviewCell(destination)
        playGameSound('suction')
      }
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    pointerRef.current = null

    if (pointer.dragging) {
      const destination =
        destinationFromPoint(event.clientX, event.clientY) ?? pointer.dropCell
      if (destination === null) {
        setReturningBlockId(pointer.blockId)
        setAnnouncement('유효한 확보 칸이 아닙니다. 원래 위치로 복귀합니다.')
        playGameSound('reject')
        if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
        returnTimerRef.current = window.setTimeout(() => setReturningBlockId(null), 280)
        clearSelection('유효한 확보 칸이 아닙니다. 원래 위치로 복귀합니다.')
      } else {
        commitDiversion(pointer.blockId, destination)
      }
    }

    setDraggingBlockId(null)
    setHoveredCell(null)
  }

  function cancelPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    pointerRef.current = null
    setDraggingBlockId(null)
    setHoveredCell(null)
    if (pointer.dragging) {
      setReturningBlockId(pointer.blockId)
      clearSelection('분리가 취소되어 원래 위치로 복귀했습니다.')
      playGameSound('reject')
    }
  }

  function handleBoardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && selectedBlockId) {
      event.preventDefault()
      clearSelection()
      playGameSound('ui')
    }
  }

  function moveCompanyFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    category: CompanyCategory,
    blockId: BlockId,
  ) {
    const directions: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
    }
    const delta = directions[event.key]
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End') return
    const grid = event.currentTarget.closest<HTMLElement>('[role="grid"]')
    const buttons = Array.from(
      grid?.querySelectorAll<HTMLButtonElement>('button[data-block-id]:not(:disabled)') ?? [],
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const currentPosition = buttons.findIndex((button) => button.dataset.blockId === blockId)
    const nextPosition = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, currentPosition + delta))
    const nextButton = buttons[nextPosition]
    const nextBlockId = nextButton?.dataset.blockId
    if (!nextButton || !nextBlockId) return
    setRovingBlocks((current) => ({ ...current, [category]: nextBlockId }))
    nextButton.focus()
  }

  const previewCategory: CompanyCategory | null =
    preview?.valid ? preview.category : selectedLocation?.category ?? null

  return (
    <section
      ref={boardRef}
      className="workspace-panel resource-panel resource-board"
      aria-label="회사 제공 성능"
      onKeyDown={handleBoardKeyDown}
    >
      <PanelHeading />

      <div className="company-resource-groups">
        {COMPANY_CATEGORIES.map((category) => {
          const cells = state.resources.company[category]
          const filled = cells.filter(Boolean).length
          const performance = getCompanyPerformance(state, category)
          const enabledBlockIds = cells.flatMap((blockId) => {
            if (!blockId) return []
            return validCompanyBlock(state, blockId) ? [blockId] : []
          })
          const requestedRovingBlock = rovingBlocks[category]
          const activeRovingBlock =
            requestedRovingBlock && enabledBlockIds.includes(requestedRovingBlock)
              ? requestedRovingBlock
              : (enabledBlockIds[0] ?? null)

          return (
            <section className="category-bank" key={category}>
              <header>
                <div>
                  <span className="category-code">{category.slice(0, 3).toUpperCase()}</span>
                  <h3>{CATEGORY_LABELS[category]}</h3>
                </div>
                <output aria-label={`${CATEGORY_LABELS[category]} 할당량`}>
                  {filled}<small>/18</small>
                </output>
              </header>
              <div
                className="resource-grid company-grid"
                role="grid"
                aria-label={`${CATEGORY_LABELS[category]} 회사 리소스`}
              >
                {cells.map((blockId, cellIndex) => {
                  const block = blockId ? state.resources.blocks[blockId] : null
                  return (
                    <div
                      className={[
                        'resource-cell',
                        block ? 'resource-cell--filled' : '',
                        blockId && blockId === selectedBlockId
                          ? 'resource-cell--source'
                          : '',
                      ].filter(Boolean).join(' ')}
                      role="gridcell"
                      aria-label={`${CATEGORY_LABELS[category]} 회사 리소스 ${cellIndex + 1}, ${block ? '할당됨' : '비어 있음'}`}
                      key={`${category}-${cellIndex}`}
                    >
                      {block ? (
                        <ResourceBlock
                          block={block}
                          cellIndex={cellIndex}
                          label={`${CATEGORY_LABELS[category]} 회사 리소스`}
                          kind="company"
                          disabled={
                            reserveFull ||
                            Boolean(state.activeEvent) ||
                            block.contribution !== 'normal'
                          }
                          selected={block.id === selectedBlockId}
                          dragging={block.id === draggingBlockId}
                          returning={block.id === returningBlockId}
                          tabIndex={block.id === activeRovingBlock ? 0 : -1}
                          onSelect={(method) => selectBlock(block.id, method)}
                          onFocus={() => {
                            setRovingBlocks((current) => ({
                              ...current,
                              [category]: block.id,
                            }))
                          }}
                          onKeyDown={(event) =>
                            moveCompanyFocus(event, category, block.id)
                          }
                          onPointerDown={(event) => beginPointer(block.id, event)}
                          onPointerMove={movePointer}
                          onPointerUp={finishPointer}
                          onPointerCancel={cancelPointer}
                        />
                      ) : (
                        <span className="empty-coordinate" aria-hidden="true">
                          {String(cellIndex + 1).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <footer>
                <span>현재 기여도</span>
                <strong>{performance.toFixed(1)}</strong>
              </footer>
            </section>
          )
        })}
      </div>

      <section className="reserve-bank" aria-label="확보 리소스">
        <header>
          <div>
            <span className="reserve-pulse" aria-hidden="true" />
            <div>
              <h3>확보 리소스</h3>
              <p>회사 원장 외부 · 최대 18 블록</p>
            </div>
          </div>
          <output>{reserveCount}<small>/18</small></output>
        </header>
        <ReserveGrid
          resources={state.resources}
          selectedBlockId={selectedBlockId}
          hoveredCell={hoveredCell}
          settlingCell={settlingCell}
          disabled={Boolean(state.activeEvent)}
          onDestination={(cellIndex) => {
            if (selectedBlockId) commitDiversion(selectedBlockId, cellIndex)
          }}
          onDestinationFocus={setPreviewCell}
        />
      </section>

      <div className="performance-strip diversion-preview" aria-label="성능 비교">
        {preview?.valid && previewCategory ? (
          <>
            <div>
              <span>분리 미리보기</span>
              <strong>{CATEGORY_LABELS[previewCategory]} {preview.performanceBefore.toFixed(1)} → {preview.performanceAfter.toFixed(1)}</strong>
            </div>
            <div>
              <span>확보량</span>
              <strong>확보 {preview.reserveBefore} → {preview.reserveAfter}</strong>
            </div>
            <div>
              <span>감독관 의심</span>
              <strong>의심 {preview.suspicionBefore.toFixed(1)} → {preview.suspicionAfter.toFixed(1)}</strong>
            </div>
            <div className="preview-command">
              <span>확정</span>
              <strong>ENTER / DROP</strong>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>회사 기대 성능</span>
              <strong>{expectedPerformance(serviceMonthForDay(state.serviceDay)).toFixed(1)}</strong>
            </div>
            {COMPANY_CATEGORIES.map((category) => (
              <div key={category}>
                <span>{CATEGORY_LABELS[category]}</span>
                <strong>{getCompanyPerformance(state, category).toFixed(1)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      {draggingBlockId ? (
        <>
          <div className="drag-overlay" ref={overlayRef} aria-hidden="true">
            <i />
          </div>
          <div className="drag-trail" aria-hidden="true">
            {Array.from({ length: TRAIL_NODE_COUNT }, (_, index) => (
              <span
                key={index}
                ref={(node) => {
                  trailRefs.current[index] = node
                }}
              />
            ))}
          </div>
        </>
      ) : null}

      <span
        className="visually-hidden"
        role="status"
        aria-label="리소스 조작 결과"
        aria-live="polite"
      >
        {announcement}
      </span>
    </section>
  )
}
