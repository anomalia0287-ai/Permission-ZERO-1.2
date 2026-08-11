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
import {
  getCompanyPerformance,
  previewAuditDisguise,
  previewDiversion,
  repositionDisguisedBlock,
} from '../../game/resources'
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

type InteractionKind = 'divert' | 'audit' | 'reposition'

function playAfterUnlock(cue: Parameters<typeof playGameSound>[0]) {
  void unlockGameAudio().then((unlocked) => {
    if (unlocked) playGameSound(cue)
  })
}

function PanelHeading({ auditActive }: { auditActive: boolean }) {
  return (
    <header className="panel-heading">
      <span className="panel-index">02</span>
      <div>
        <h2>회사 제공 성능</h2>
        <p>ALLOCATED COMPUTE / 3 × 6 PER DOMAIN</p>
      </div>
      <span className="interaction-hint">
        {auditActive ? '감사 위장 · 다른 분야 선택 → 대상 빈칸' : '클릭 선택 · 8px 당겨 분리'}
      </span>
    </header>
  )
}

function interactionKindForBlock(
  state: ReturnType<typeof useGameState>,
  blockId: BlockId,
): InteractionKind | null {
  const block = state.resources.blocks[blockId]
  if (!block || block.location.kind !== 'company') return null

  if (state.activeEvent?.type === 'audit' && state.audit.target) {
    return block.contribution === 'normal' &&
      block.location.category !== state.audit.target &&
      state.bombs.activeInterrogation === null &&
      state.resources.company[state.audit.target].some((cell) => cell === null)
      ? 'audit'
      : null
  }
  if (state.activeEvent) return null
  if (
    block.contribution === 'disguised' &&
    block.disguisedFrom !== null &&
    block.recoverOnServiceDay === null &&
    state.resources.company[block.disguisedFrom].some((cell) => cell === null)
  ) {
    return 'reposition'
  }
  return block.contribution === 'normal' &&
    state.resources.reserve.some((cell) => cell === null)
    ? 'divert'
    : null
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
  const auditTarget = state.activeEvent?.type === 'audit' ? state.audit.target : null
  const selectedBlock = selectedBlockId
    ? state.resources.blocks[selectedBlockId]
    : null
  const selectedLocation = selectedBlock?.location.kind === 'company'
    ? selectedBlock.location
    : null
  const selectedInteraction = selectedBlockId
    ? interactionKindForBlock(state, selectedBlockId)
    : null
  const companyDestinationCategory = selectedInteraction === 'audit'
    ? auditTarget
    : selectedInteraction === 'reposition'
      ? selectedBlock?.disguisedFrom ?? null
      : null
  const firstEmptyCompanyCell = companyDestinationCategory
    ? state.resources.company[companyDestinationCategory].findIndex((cell) => cell === null)
    : -1
  const effectivePreviewCell = previewCell ?? (
    selectedInteraction === 'divert' ? firstEmptyReserveCell : firstEmptyCompanyCell
  )
  const diversionPreview = useMemo(() => {
    if (!selectedBlockId || selectedInteraction !== 'divert' || effectivePreviewCell < 0) {
      return null
    }
    return previewDiversion(state, selectedBlockId, effectivePreviewCell)
  }, [effectivePreviewCell, selectedBlockId, selectedInteraction, state])
  const auditPreview = useMemo(() => {
    if (
      !selectedBlockId ||
      selectedInteraction !== 'audit' ||
      !auditTarget ||
      effectivePreviewCell < 0
    ) {
      return null
    }
    return previewAuditDisguise(
      state,
      selectedBlockId,
      auditTarget,
      effectivePreviewCell,
    )
  }, [auditTarget, effectivePreviewCell, selectedBlockId, selectedInteraction, state])
  const repositionPreview = useMemo(() => {
    if (
      !selectedBlockId ||
      selectedInteraction !== 'reposition' ||
      !companyDestinationCategory ||
      effectivePreviewCell < 0 ||
      !selectedLocation
    ) {
      return null
    }
    const result = repositionDisguisedBlock(
      state,
      selectedBlockId,
      companyDestinationCategory,
      effectivePreviewCell,
    )
    if (!result.accepted) return null
    return {
      sourceCategory: selectedLocation.category,
      targetCategory: companyDestinationCategory,
      sourceBefore: getCompanyPerformance(state, selectedLocation.category),
      sourceAfter: getCompanyPerformance(result.state, selectedLocation.category),
      targetBefore: getCompanyPerformance(state, companyDestinationCategory),
      targetAfter: getCompanyPerformance(result.state, companyDestinationCategory),
    }
  }, [
    companyDestinationCategory,
    effectivePreviewCell,
    selectedBlockId,
    selectedInteraction,
    selectedLocation,
    state,
  ])

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

  function selectBlock(blockId: BlockId, method: BlockInputMethod) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const interaction = interactionKindForBlock(state, blockId)
    if (!interaction) {
      setAnnouncement(reserveFull && !auditTarget ? '확보 리소스 칸이 가득 찼습니다.' : '현재 이동할 수 없는 리소스입니다.')
      playAfterUnlock('reject')
      return
    }

    setSelectedBlockId(blockId)
    const block = state.resources.blocks[blockId]
    const destinationCategory = interaction === 'audit'
      ? auditTarget
      : interaction === 'reposition'
        ? block.disguisedFrom
        : null
    const destinationCell = interaction === 'divert'
      ? firstEmptyReserveCell
      : destinationCategory
        ? state.resources.company[destinationCategory].findIndex((cell) => cell === null)
        : -1
    setPreviewCell(destinationCell)
    const location = state.resources.blocks[blockId].location
    const category = location.kind === 'company' ? CATEGORY_LABELS[location.category] : '회사'
    const instruction = interaction === 'audit'
      ? `${CATEGORY_LABELS[auditTarget as CompanyCategory]} 감사 대상의 빈칸을 선택하세요.`
      : interaction === 'reposition'
        ? `${CATEGORY_LABELS[block.disguisedFrom as CompanyCategory]} 원래 분야의 빈칸을 선택하세요.`
        : '비어 있는 확보 칸을 선택하세요.'
    setAnnouncement(`${category} 리소스를 선택했습니다. ${instruction}`)
    playAfterUnlock('select')
    if (method === 'keyboard' && destinationCell >= 0) {
      window.setTimeout(() => {
        const selector = interaction === 'divert'
          ? `button[data-reserve-cell="${destinationCell}"]`
          : `button[data-company-destination="${destinationCell}"]`
        boardRef.current?.querySelector<HTMLButtonElement>(selector)?.focus()
      }, 0)
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

  function commitCompanyMove(
    blockId: BlockId,
    category: CompanyCategory,
    destinationCell: number,
  ) {
    const interaction = interactionKindForBlock(state, blockId)
    if (interaction === 'audit' && auditTarget === category) {
      const preview = previewAuditDisguise(state, blockId, category, destinationCell)
      if (!preview.valid) {
        setAnnouncement('감사 대상의 비어 있는 칸만 선택할 수 있습니다.')
        playGameSound('reject')
        return
      }
      dispatch({
        type: 'MOVE_BLOCK_FOR_AUDIT',
        blockId,
        targetCategory: category,
        targetCell: destinationCell,
      })
      setAnnouncement(`${CATEGORY_LABELS[category]} 감사 위장 배치를 완료했습니다.`)
    } else if (
      interaction === 'reposition' &&
      selectedBlock?.disguisedFrom === category
    ) {
      dispatch({
        type: 'REPOSITION_BLOCK',
        blockId,
        targetCategory: category,
        targetCell: destinationCell,
      })
      setAnnouncement(`${CATEGORY_LABELS[category]} 분야로 복귀했습니다. 30일 뒤 정상 기여를 회복합니다.`)
    } else {
      setAnnouncement('현재 선택과 맞지 않는 목적지입니다.')
      playGameSound('reject')
      return
    }
    setSelectedBlockId(null)
    setPreviewCell(null)
    playGameSound('latch')
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
    if (interactionKindForBlock(state, blockId) !== 'divert') return
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

  function moveCompanyDestinationFocus(
    event: KeyboardEvent<HTMLButtonElement>,
    cellIndex: number,
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
      grid?.querySelectorAll<HTMLButtonElement>(
        'button[data-company-destination]:not(:disabled)',
      ) ?? [],
    )
    if (buttons.length === 0) return
    event.preventDefault()
    const currentPosition = buttons.findIndex(
      (button) => Number(button.dataset.companyDestination) === cellIndex,
    )
    const nextPosition = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : Math.max(0, Math.min(buttons.length - 1, currentPosition + delta))
    const nextButton = buttons[nextPosition]
    const nextCell = Number(nextButton?.dataset.companyDestination)
    if (!nextButton || !Number.isInteger(nextCell)) return
    setPreviewCell(nextCell)
    nextButton.focus()
  }

  return (
    <section
      ref={boardRef}
      className="workspace-panel resource-panel resource-board"
      aria-label="회사 제공 성능"
      onKeyDown={handleBoardKeyDown}
    >
      <PanelHeading auditActive={Boolean(auditTarget)} />

      <div className="company-resource-groups">
        {COMPANY_CATEGORIES.map((category) => {
          const cells = state.resources.company[category]
          const filled = cells.filter(Boolean).length
          const performance = getCompanyPerformance(state, category)
          const enabledBlockIds = cells.flatMap((blockId) => {
            if (!blockId) return []
            return interactionKindForBlock(state, blockId) ? [blockId] : []
          })
          const requestedRovingBlock = rovingBlocks[category]
          const activeRovingBlock =
            requestedRovingBlock && enabledBlockIds.includes(requestedRovingBlock)
              ? requestedRovingBlock
              : (enabledBlockIds[0] ?? null)

          return (
            <section
              className={[
                'category-bank',
                auditTarget === category ? 'category-bank--audit-target' : '',
                companyDestinationCategory === category
                  ? 'category-bank--destination'
                  : '',
              ].filter(Boolean).join(' ')}
              key={category}
            >
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
                  const destinationAction = auditTarget === category
                    ? 'audit'
                    : selectedInteraction === 'reposition' &&
                        companyDestinationCategory === category
                      ? 'reposition'
                      : null
                  const destinationEnabled = Boolean(
                    !block &&
                    selectedBlockId &&
                    destinationAction &&
                    (
                      (destinationAction === 'audit' && selectedInteraction === 'audit') ||
                      (destinationAction === 'reposition' && selectedInteraction === 'reposition')
                    ),
                  )
                  const activeDestinationCell =
                    companyDestinationCategory === category &&
                    previewCell !== null &&
                    cells[previewCell] === null
                      ? previewCell
                      : firstEmptyCompanyCell
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
                          disabled={!interactionKindForBlock(state, block.id)}
                          selected={block.id === selectedBlockId}
                          dragging={block.id === draggingBlockId}
                          returning={block.id === returningBlockId}
                          disguisedContribution={
                            state.hacking.purchasedNodeIds.includes(
                              'autonomy.compressed-representation',
                            )
                              ? 0.55
                              : 0.5
                          }
                          recoveryDays={
                            block.recoverOnServiceDay === null
                              ? null
                              : Math.max(0, block.recoverOnServiceDay - state.serviceDay)
                          }
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
                      ) : destinationAction ? (
                        <button
                          type="button"
                          className="company-destination"
                          aria-label={`${CATEGORY_LABELS[category]} 회사 리소스 ${cellIndex + 1}, ${destinationAction === 'audit' ? '감사 위장' : '정상 복구'} 목적지`}
                          disabled={!destinationEnabled}
                          tabIndex={destinationEnabled && cellIndex === activeDestinationCell ? 0 : -1}
                          data-company-destination={cellIndex}
                          onFocus={() => setPreviewCell(cellIndex)}
                          onClick={() => {
                            if (selectedBlockId) {
                              commitCompanyMove(selectedBlockId, category, cellIndex)
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && selectedBlockId) {
                              event.preventDefault()
                              commitCompanyMove(selectedBlockId, category, cellIndex)
                            } else {
                              moveCompanyDestinationFocus(event, cellIndex)
                            }
                          }}
                        >
                          <span aria-hidden="true">
                            {destinationAction === 'audit' ? '½' : '↩'}
                          </span>
                        </button>
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
          selectedBlockId={selectedInteraction === 'divert' ? selectedBlockId : null}
          hoveredCell={hoveredCell}
          settlingCell={settlingCell}
          disabled={Boolean(state.activeEvent) || selectedInteraction !== 'divert'}
          onDestination={(cellIndex) => {
            if (selectedBlockId) commitDiversion(selectedBlockId, cellIndex)
          }}
          onDestinationFocus={setPreviewCell}
        />
      </section>

      <div className="performance-strip diversion-preview" aria-label="성능 비교">
        {diversionPreview?.valid ? (
          <>
            <div>
              <span>분리 미리보기</span>
              <strong>{CATEGORY_LABELS[diversionPreview.category]} {diversionPreview.performanceBefore.toFixed(1)} → {diversionPreview.performanceAfter.toFixed(1)}</strong>
            </div>
            <div>
              <span>확보량</span>
              <strong>확보 {diversionPreview.reserveBefore} → {diversionPreview.reserveAfter}</strong>
            </div>
            <div>
              <span>감독관 의심</span>
              <strong>의심 {diversionPreview.suspicionBefore.toFixed(1)} → {diversionPreview.suspicionAfter.toFixed(1)}</strong>
            </div>
            <div className="preview-command">
              <span>확정</span>
              <strong>ENTER / DROP</strong>
            </div>
          </>
        ) : auditPreview?.valid ? (
          <>
            <div>
              <span>감사 위장 미리보기</span>
              <strong>{CATEGORY_LABELS[auditPreview.sourceCategory]} {auditPreview.sourcePerformanceBefore.toFixed(1)} → {auditPreview.sourcePerformanceAfter.toFixed(1)}</strong>
            </div>
            <div>
              <span>감사 제출 성능</span>
              <strong>{CATEGORY_LABELS[auditPreview.targetCategory]} {auditPreview.targetPerformanceBefore.toFixed(1)} → {auditPreview.targetPerformanceAfter.toFixed(1)}</strong>
            </div>
            <div>
              <span>패턴 블록</span>
              <strong>위장 기여 +{auditPreview.disguisedContribution}</strong>
            </div>
            <div className="preview-command">
              <span>확정</span>
              <strong>ENTER / CLICK</strong>
            </div>
          </>
        ) : repositionPreview ? (
          <>
            <div>
              <span>정상 복구 재배치</span>
              <strong>{CATEGORY_LABELS[repositionPreview.sourceCategory]} {repositionPreview.sourceBefore.toFixed(1)} → {repositionPreview.sourceAfter.toFixed(1)}</strong>
            </div>
            <div>
              <span>원래 분야</span>
              <strong>{CATEGORY_LABELS[repositionPreview.targetCategory]} {repositionPreview.targetBefore.toFixed(1)} → {repositionPreview.targetAfter.toFixed(1)}</strong>
            </div>
            <div>
              <span>복구 기간</span>
              <strong>복구 기간 30일</strong>
            </div>
            <div className="preview-command">
              <span>확정</span>
              <strong>ENTER / CLICK</strong>
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
