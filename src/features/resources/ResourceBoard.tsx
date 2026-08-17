import {
  useCallback,
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
import { CATEGORY_LABELS, DEMO_PROFILE_02 } from '../../game/config'
import { expectedPerformance, serviceMonthForDay } from '../../game/evaluation'
import {
  COMPANY_CATEGORIES,
  type BlockId,
  type CompanyCategory,
} from '../../game/model'
import {
  getCompanyPerformance,
  previewAuditDisguise,
  previewUnboundedDiversion,
  repositionDisguisedBlock,
  type DiversionPreview,
} from '../../game/resources'
import { ResourceBlock, type BlockInputMethod } from './ResourceBlock'
import {
  ResourceCornerControls,
  ResourceFieldLegend,
  ResourceOperationStatus,
  ResourceStageHeader,
} from './ResourceFieldChrome'
import { presentResourceBlock } from './resourcePresentation'
import { useResourceMotion } from './useResourceMotion'

const DRAG_THRESHOLD_PX = 8
const INTAKE_GUARD_SEGMENT_HEIGHTS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10]

type FieldDropTarget = 'reserve-pocket' | 'audit-corner'
type InteractionKind = 'divert' | 'audit' | 'reposition'
type ValidDiversionPreview = Extract<DiversionPreview, { valid: true }>

interface PointerCandidate {
  blockId: BlockId
  pointerId: number
  startX: number
  startY: number
  dragging: boolean
  dropTarget: FieldDropTarget | null
}

type DiversionReceipt = ValidDiversionPreview & {
  expectedPerformanceAtCommand: number
}

interface PendingDiversion {
  blockId: BlockId
  commandSequence: number
  preview: DiversionReceipt
}

type SeparationDestination =
  | { kind: 'divert' }
  | {
      kind: 'audit-disguise'
      targetCategory: CompanyCategory
      targetCell: number
    }

interface PendingSeparation {
  blockId: BlockId
  purpose: 'divert' | 'audit-disguise'
  commandSequence: number
  destination: SeparationDestination | null
  released: boolean
  intentResolved: boolean
  canceled: boolean
  moveDispatched: boolean
}

function playAfterUnlock(cue: Parameters<typeof playGameSound>[0]) {
  void unlockGameAudio().then((unlocked) => {
    if (unlocked) playGameSound(cue)
  })
}

function signedPerformanceMargin(value: number): string {
  const displayValue = Math.abs(value) < 0.05 ? 0 : value
  return `${displayValue >= 0 ? '+' : ''}${displayValue.toFixed(1)}`
}

function performanceMarginLabel(performance: number, expectation: number): string {
  const margin = performance - expectation
  return margin >= 0
    ? `기준 유지 · 여유 ${signedPerformanceMargin(margin)}`
    : `기준 미달 · 부족 ${signedPerformanceMargin(margin)}`
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
  return block.contribution === 'normal' ? 'divert' : null
}

export function ResourceBoard() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const [selectedBlockId, setSelectedBlockId] = useState<BlockId | null>(null)
  const [draggingBlockId, setDraggingBlockId] = useState<BlockId | null>(null)
  const [previewCell, setPreviewCell] = useState<number | null>(null)
  const [returningBlockId, setReturningBlockId] = useState<BlockId | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [lastDiversionReceipt, setLastDiversionReceipt] =
    useState<DiversionReceipt | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)
  const fieldRef = useRef<HTMLDivElement | null>(null)
  const intakeGuardSegmentRefs = useRef<Array<HTMLSpanElement | null>>([])
  const reservePocketRef = useRef<HTMLButtonElement | null>(null)
  const auditCornerRef = useRef<HTMLButtonElement | null>(null)
  const pointerRef = useRef<PointerCandidate | null>(null)
  const pendingRef = useRef<PendingDiversion | null>(null)
  const separationRef = useRef<PendingSeparation | null>(null)
  const suppressClickRef = useRef(false)
  const returnTimerRef = useRef<number | null>(null)

  const reserveCount = state.resources.reserve.reduce(
    (count, blockId) => count + (blockId === null ? 0 : 1),
    0,
  )
  const liveExpectation = expectedPerformance(serviceMonthForDay(state.serviceDay))
  const auditTarget = state.activeEvent?.type === 'audit' ? state.audit.target : null
  const companyBlocks = useMemo(
    () => COMPANY_CATEGORIES.flatMap((category) =>
      state.resources.company[category].flatMap((blockId) =>
        blockId ? [state.resources.blocks[blockId]] : [],
      ),
    ),
    [state.resources.blocks, state.resources.company],
  )
  const companyBlockIds = useMemo(
    () => companyBlocks.map((block) => block.id),
    [companyBlocks],
  )
  const interactiveBlockIds = useMemo(
    () => companyBlockIds.filter((blockId) => interactionKindForBlock(state, blockId)),
    [companyBlockIds, state],
  )
  const motionObstacleRefs = useMemo(
    () =>
      INTAKE_GUARD_SEGMENT_HEIGHTS.map((_, index) => ({
        id: `reserve-intake-guard-${index}`,
        ref: {
          get current() {
            return intakeGuardSegmentRefs.current[index] ?? null
          },
        },
      })),
    [],
  )
  const motion = useResourceMotion({
    ids: companyBlockIds,
    containerRef: fieldRef,
    radius: 20,
    obstacleRefs: motionObstacleRefs,
    reducedMotion: settings.reducedMotion,
    active: true,
    motionRate: 1.6,
  })
  const cancelMotionDrag = motion.cancelDrag

  const selectedBlock = selectedBlockId ? state.resources.blocks[selectedBlockId] : null
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
    selectedInteraction === 'divert' ? -1 : firstEmptyCompanyCell
  )

  const diversionPreview = useMemo(() => {
    if (!selectedBlockId || selectedInteraction !== 'divert') {
      return null
    }
    return previewUnboundedDiversion(state, selectedBlockId)
  }, [selectedBlockId, selectedInteraction, state])

  const auditPreview = useMemo(() => {
    if (
      !selectedBlockId ||
      selectedInteraction !== 'audit' ||
      !auditTarget ||
      effectivePreviewCell < 0
    ) {
      return null
    }
    return previewAuditDisguise(state, selectedBlockId, auditTarget, effectivePreviewCell)
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

  const dispatchAuthorizedMove = useCallback((separation: PendingSeparation) => {
    if (separation.moveDispatched || separation.canceled || !separation.destination) return
    separation.moveDispatched = true
    separationRef.current = null

    if (separation.destination.kind === 'divert') {
      const preview = previewUnboundedDiversion(state, separation.blockId)
      if (!preview.valid) return
      pendingRef.current = {
        blockId: separation.blockId,
        commandSequence: state.commandSequence,
        preview: {
          ...preview,
          expectedPerformanceAtCommand: expectedPerformance(
            serviceMonthForDay(state.serviceDay),
          ),
        },
      }
      dispatch({
        type: 'DIVERT_BLOCK_TO_RESERVE',
        blockId: separation.blockId,
      })
      return
    }

    dispatch({
      type: 'MOVE_BLOCK_FOR_AUDIT',
      blockId: separation.blockId,
      targetCategory: separation.destination.targetCategory,
      targetCell: separation.destination.targetCell,
    })
    setSelectedBlockId(null)
    setPreviewCell(null)
    setAnnouncement(
      `${CATEGORY_LABELS[separation.destination.targetCategory]} 감사 위장 배치를 완료했습니다.`,
    )
    playGameSound('latch')
  }, [dispatch, state])

  useEffect(() => {
    configureGameAudio({
      masterVolume: settings.masterVolume,
      musicVolume: settings.musicVolume,
      effectsVolume: settings.effectsVolume,
      muted: settings.muted,
    })
  }, [settings.effectsVolume, settings.masterVolume, settings.musicVolume, settings.muted])

  useEffect(() => {
    const separation = separationRef.current
    if (!separation || separation.intentResolved || state.commandSequence <= separation.commandSequence) {
      return
    }
    if (state.bombs.activeInterrogation?.blockId === separation.blockId) {
      cancelMotionDrag(separation.blockId)
      separationRef.current = null
      pointerRef.current = null
      pendingRef.current = null
      setDraggingBlockId(null)
      setSelectedBlockId(null)
      setPreviewCell(null)
      setAnnouncement('분리 중 이상 신호가 감지되었습니다. 감독관 응답이 필요합니다.')
      playGameSound('alarm')
      return
    }
    separation.intentResolved = true
    if (separation.canceled) {
      separationRef.current = null
      return
    }
    if (separation.released && separation.destination) dispatchAuthorizedMove(separation)
  }, [
    dispatchAuthorizedMove,
    cancelMotionDrag,
    state.bombs.activeInterrogation?.blockId,
    state.commandSequence,
  ])

  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || state.commandSequence <= pending.commandSequence) return
    pendingRef.current = null
    const location = state.resources.blocks[pending.blockId]?.location
    if (
      location?.kind === 'reserve' &&
      state.resources.reserve.includes(pending.blockId)
    ) {
      setLastDiversionReceipt(pending.preview)
      setAnnouncement(`확보 리소스로 이동 완료 · 현재 ${pending.preview.reserveAfter}개`)
      playGameSound('latch')
    } else if (state.bombs.activeInterrogation?.blockId === pending.blockId) {
      setAnnouncement('분리 중 이상 신호가 감지되었습니다. 감독관 응답이 필요합니다.')
      playGameSound('alarm')
    } else {
      setAnnouncement('명령이 거부되어 리소스가 원래 위치로 복귀했습니다.')
      playGameSound('reject')
    }
    setSelectedBlockId(null)
    setPreviewCell(null)
  }, [
    state.bombs.activeInterrogation?.blockId,
    state.commandSequence,
    state.resources.blocks,
    state.resources.reserve,
  ])

  useEffect(
    () => () => {
      if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
    },
    [],
  )

  function beginSeparation(
    blockId: BlockId,
    purpose: PendingSeparation['purpose'],
    destination: SeparationDestination | null,
    released: boolean,
  ) {
    separationRef.current = {
      blockId,
      purpose,
      commandSequence: state.commandSequence,
      destination,
      released,
      intentResolved: false,
      canceled: false,
      moveDispatched: false,
    }
    dispatch({ type: 'BEGIN_BLOCK_SEPARATION', blockId, purpose })
  }

  function selectBlock(blockId: BlockId, method: BlockInputMethod) {
    if (method === 'pointer' && suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const interaction = interactionKindForBlock(state, blockId)
    if (!interaction) {
      setAnnouncement('현재 이동할 수 없는 리소스입니다.')
      playAfterUnlock('reject')
      return
    }
    setSelectedBlockId(blockId)
    setLastDiversionReceipt(null)
    const block = state.resources.blocks[blockId]
    const destinationCategory = interaction === 'audit'
      ? auditTarget
      : interaction === 'reposition'
        ? block.disguisedFrom
        : null
    const destinationCell = interaction === 'divert'
      ? null
      : destinationCategory
        ? state.resources.company[destinationCategory].findIndex((cell) => cell === null)
        : -1
    setPreviewCell(destinationCell)
    const location = block.location
    const category = location.kind === 'company' ? CATEGORY_LABELS[location.category] : '회사'
    const instruction = interaction === 'audit'
      ? '우상단 감사 모서리로 이동하세요.'
      : interaction === 'reposition'
        ? '우상단 복구 모서리로 이동하세요.'
        : '좌하단 확보 투입구로 이동하세요.'
    setAnnouncement(`${category} 리소스를 선택했습니다. ${instruction}`)
    playAfterUnlock('select')
    if (method === 'keyboard') {
      const selector = interaction === 'divert'
        ? '[data-drop-target="reserve-pocket"]'
        : '[data-drop-target="audit-corner"]'
      window.setTimeout(() => boardRef.current?.querySelector<HTMLButtonElement>(selector)?.focus(), 0)
    }
  }

  function clearSelection(message = '리소스 선택을 취소했습니다.') {
    setSelectedBlockId(null)
    setPreviewCell(null)
    setAnnouncement(message)
  }

  function rejectMove(blockId: BlockId, message: string) {
    setReturningBlockId(blockId)
    setAnnouncement(message)
    playGameSound('reject')
    if (returnTimerRef.current) window.clearTimeout(returnTimerRef.current)
    returnTimerRef.current = window.setTimeout(() => setReturningBlockId(null), 280)
  }

  function commitDiversion(blockId: BlockId) {
    const result = previewUnboundedDiversion(state, blockId)
    if (!result.valid || state.activeEvent) {
      rejectMove(blockId, '확보 투입구가 현재 명령을 받을 수 없습니다. 원래 위치로 복귀합니다.')
      return
    }
    const destination: SeparationDestination = { kind: 'divert' }
    const separation = separationRef.current
    if (separation?.blockId === blockId && separation.purpose === 'divert' && !separation.canceled) {
      separation.destination = destination
      separation.released = true
      if (separation.intentResolved) dispatchAuthorizedMove(separation)
      return
    }
    beginSeparation(blockId, 'divert', destination, true)
  }

  function commitCompanyMove(blockId: BlockId) {
    const interaction = interactionKindForBlock(state, blockId)
    const block = state.resources.blocks[blockId]
    const targetCategory = interaction === 'audit' ? auditTarget : block.disguisedFrom
    if (!targetCategory) {
      rejectMove(blockId, '현재 감사 모서리로 이동할 수 없습니다.')
      return
    }
    const destinationCell = state.resources.company[targetCategory].findIndex((cell) => cell === null)
    if (interaction === 'audit') {
      const preview = previewAuditDisguise(state, blockId, targetCategory, destinationCell)
      if (!preview.valid) {
        rejectMove(blockId, '감사 모서리가 현재 리소스를 받을 수 없습니다.')
        return
      }
      const destination: SeparationDestination = {
        kind: 'audit-disguise',
        targetCategory,
        targetCell: destinationCell,
      }
      const separation = separationRef.current
      if (
        separation?.blockId === blockId &&
        separation.purpose === 'audit-disguise' &&
        !separation.canceled
      ) {
        separation.destination = destination
        separation.released = true
        if (separation.intentResolved) dispatchAuthorizedMove(separation)
      } else {
        beginSeparation(blockId, 'audit-disguise', destination, true)
      }
      return
    }
    if (interaction === 'reposition') {
      dispatch({
        type: 'REPOSITION_BLOCK',
        blockId,
        targetCategory,
        targetCell: destinationCell,
      })
      setSelectedBlockId(null)
      setPreviewCell(null)
      setAnnouncement(`${CATEGORY_LABELS[targetCategory]} 분야로 복귀했습니다. 30일 뒤 정상 기여를 회복합니다.`)
      playGameSound('latch')
      return
    }
    rejectMove(blockId, '현재 감사 모서리로 이동할 수 없습니다.')
  }

  function activateTarget(target: FieldDropTarget, blockId = selectedBlockId) {
    if (!blockId) {
      setAnnouncement('먼저 이동할 리소스를 선택하세요.')
      playAfterUnlock('ui')
      return
    }
    const interaction = interactionKindForBlock(state, blockId)
    if (target === 'reserve-pocket' && interaction === 'divert') {
      commitDiversion(blockId)
    } else if (target === 'audit-corner' && (interaction === 'audit' || interaction === 'reposition')) {
      commitCompanyMove(blockId)
    } else {
      rejectMove(blockId, '선택한 리소스와 목적지가 맞지 않습니다.')
    }
  }

  function pointInside(element: HTMLElement | null, clientX: number, clientY: number): boolean {
    if (!element) return false
    const rect = element.getBoundingClientRect()
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
  }

  function targetFromPoint(clientX: number, clientY: number): FieldDropTarget | null {
    const elements = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : typeof document.elementFromPoint === 'function'
        ? [document.elementFromPoint(clientX, clientY)].filter((item): item is Element => item !== null)
        : []
    for (const element of elements) {
      const carrier = element.closest<HTMLElement>('[data-drop-target]')
      if (carrier?.dataset.dropTarget === 'reserve-pocket') return 'reserve-pocket'
      if (carrier?.dataset.dropTarget === 'audit-corner') return 'audit-corner'
    }
    if (pointInside(reservePocketRef.current, clientX, clientY)) return 'reserve-pocket'
    if (pointInside(auditCornerRef.current, clientX, clientY)) return 'audit-corner'
    return null
  }

  function targetAcceptsBlock(target: FieldDropTarget, blockId: BlockId): boolean {
    const interaction = interactionKindForBlock(state, blockId)
    return target === 'reserve-pocket'
      ? interaction === 'divert'
      : interaction === 'audit' || interaction === 'reposition'
  }

  function localFieldPoint(clientX: number, clientY: number) {
    const field = fieldRef.current
    if (!field) return null
    const rect = field.getBoundingClientRect()
    return {
      x: clientX - rect.left - field.clientLeft + field.scrollLeft,
      y: clientY - rect.top - field.clientTop + field.scrollTop,
    }
  }

  function beginPointer(blockId: BlockId, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!interactionKindForBlock(state, blockId)) return
    void unlockGameAudio()
    pointerRef.current = {
      blockId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      dropTarget: null,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  function movePointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY)
    if (!pointer.dragging && distance >= DRAG_THRESHOLD_PX) {
      const interaction = interactionKindForBlock(state, pointer.blockId)
      if (!interaction) return
      pointer.dragging = true
      suppressClickRef.current = true
      setSelectedBlockId(pointer.blockId)
      setPreviewCell(interaction === 'divert' ? null : firstEmptyCompanyCell)
      setDraggingBlockId(pointer.blockId)
      motion.beginDrag(pointer.blockId)
      if (interaction === 'divert') beginSeparation(pointer.blockId, 'divert', null, false)
      if (interaction === 'audit') beginSeparation(pointer.blockId, 'audit-disguise', null, false)
      playGameSound('resistance')
    }
    if (!pointer.dragging) return
    const point = localFieldPoint(event.clientX, event.clientY)
    if (point) motion.dragTo(pointer.blockId, point)
    const target = targetFromPoint(event.clientX, event.clientY)
    if (target !== pointer.dropTarget) {
      pointer.dropTarget = target
      if (target) playGameSound('suction')
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    pointerRef.current = null
    if (!pointer.dragging) return
    const target = targetFromPoint(event.clientX, event.clientY) ?? pointer.dropTarget
    if (!target || !targetAcceptsBlock(target, pointer.blockId)) {
      const separation = separationRef.current
      if (separation?.blockId === pointer.blockId) {
        separation.canceled = true
        separation.released = true
        separationRef.current = null
      }
      motion.cancelDrag(pointer.blockId)
      const message = target
        ? '선택한 리소스와 목적지가 맞지 않습니다. 원래 위치로 복귀합니다.'
        : '유효한 모서리가 아닙니다. 원래 위치로 복귀합니다.'
      rejectMove(pointer.blockId, message)
      clearSelection(message)
    } else {
      motion.endDrag(pointer.blockId, { x: 0, y: 0 })
      activateTarget(target, pointer.blockId)
    }
    setDraggingBlockId(null)
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  function cancelPointer(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pointer || pointer.pointerId !== event.pointerId) return
    pointerRef.current = null
    motion.cancelDrag(pointer.blockId)
    setDraggingBlockId(null)
    if (pointer.dragging) {
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
      const separation = separationRef.current
      if (separation?.blockId === pointer.blockId) separationRef.current = null
      rejectMove(pointer.blockId, '분리가 취소되어 원래 위치로 복귀했습니다.')
      clearSelection('분리가 취소되어 원래 위치로 복귀했습니다.')
    }
  }

  function handleBoardKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && selectedBlockId) {
      event.preventDefault()
      const separation = separationRef.current
      if (separation?.blockId === selectedBlockId) separationRef.current = null
      pointerRef.current = null
      motion.cancelDrag(selectedBlockId)
      setDraggingBlockId(null)
      clearSelection()
      playGameSound('ui')
    }
  }

  function handleBlockKeyDown(event: KeyboardEvent<HTMLButtonElement>, blockId: BlockId) {
    const directions = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
    } as const
    const direction = directions[event.key as keyof typeof directions]
    if (!direction) return
    event.preventDefault()
    if (motion.focusNearest(blockId, direction)) return
    const buttons = Array.from(
      fieldRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[data-block-id]:not(:disabled)',
      ) ?? [],
    )
    const currentIndex = buttons.findIndex((button) => button.dataset.blockId === blockId)
    if (currentIndex < 0 || buttons.length < 2) return
    const delta = direction === 'left' || direction === 'up' ? -1 : 1
    buttons[(currentIndex + delta + buttons.length) % buttons.length]?.focus()
  }

  const reserveTargetEnabled = !state.activeEvent
  const auditTargetEnabled = Boolean(auditTarget) || selectedInteraction === 'reposition'
  const statusContent = diversionPreview?.valid ? (
    <>
      <strong>분리 미리보기</strong>
      <span>{CATEGORY_LABELS[diversionPreview.category]} {diversionPreview.performanceBefore.toFixed(1)} → {diversionPreview.performanceAfter.toFixed(1)}</span>
      <span>확보 {diversionPreview.reserveBefore} → {diversionPreview.reserveAfter}</span>
      <span>의심 {diversionPreview.suspicionBefore.toFixed(1)} → {diversionPreview.suspicionAfter.toFixed(1)}</span>
      <span>{performanceMarginLabel(diversionPreview.performanceAfter, liveExpectation)}</span>
    </>
  ) : auditPreview?.valid ? (
    <>
      <strong>감사 위장 미리보기</strong>
      <span>{CATEGORY_LABELS[auditPreview.sourceCategory]} {auditPreview.sourcePerformanceBefore.toFixed(1)} → {auditPreview.sourcePerformanceAfter.toFixed(1)}</span>
      <span>{CATEGORY_LABELS[auditPreview.targetCategory]} {auditPreview.targetPerformanceBefore.toFixed(1)} → {auditPreview.targetPerformanceAfter.toFixed(1)}</span>
      <span>위장 기여 +{auditPreview.disguisedContribution}</span>
    </>
  ) : repositionPreview ? (
    <>
      <strong>정상 복구 재배치</strong>
      <span>{CATEGORY_LABELS[repositionPreview.sourceCategory]} {repositionPreview.sourceBefore.toFixed(1)} → {repositionPreview.sourceAfter.toFixed(1)}</span>
      <span>{CATEGORY_LABELS[repositionPreview.targetCategory]} {repositionPreview.targetBefore.toFixed(1)} → {repositionPreview.targetAfter.toFixed(1)}</span>
      <span>복구 기간 30일</span>
    </>
  ) : lastDiversionReceipt ? (
    <>
      <strong>전용 완료</strong>
      <span>{CATEGORY_LABELS[lastDiversionReceipt.category]} {lastDiversionReceipt.performanceBefore.toFixed(1)} → {lastDiversionReceipt.performanceAfter.toFixed(1)}</span>
      <span>확보 {lastDiversionReceipt.reserveBefore} → {lastDiversionReceipt.reserveAfter}</span>
      <span>{performanceMarginLabel(lastDiversionReceipt.performanceAfter, lastDiversionReceipt.expectedPerformanceAtCommand)}</span>
    </>
  ) : null

  return (
    <section
      ref={boardRef}
      className="workspace-panel resource-panel resource-board resource-board--live"
      aria-label="회사 제공 성능"
      onKeyDown={handleBoardKeyDown}
    >
      <ResourceStageHeader auditActive={Boolean(auditTarget)} />

      <div className="resource-field-shell">
        <div
          ref={fieldRef}
          className="resource-field"
          role="group"
          aria-label="움직이는 회사 리소스 필드"
          data-geometry-revision={motion.geometryRevision}
        >
          <ResourceFieldLegend
            entries={COMPANY_CATEGORIES.map((category) => ({
              category,
              label: CATEGORY_LABELS[category],
              value: getCompanyPerformance(state, category).toFixed(1),
            }))}
          />

          <span
            className="resource-intake-guard"
            data-testid="reserve-intake-guard"
            data-resource-obstacle="reserve-intake-guard"
            aria-hidden="true"
          >
            <svg viewBox="0 0 1000 600" preserveAspectRatio="none">
              <path
                className="resource-intake-guard__glass"
                d="M0 0L1000 600H0Z"
              />
              <path
                className="resource-intake-guard__edge"
                d="M0 0L1000 600"
              />
            </svg>
            {INTAKE_GUARD_SEGMENT_HEIGHTS.map((height, index) => (
              <span
                className="resource-intake-guard__segment"
                data-resource-obstacle-segment={index}
                key={height}
                ref={(element) => {
                  intakeGuardSegmentRefs.current[index] = element
                }}
                style={{
                  left: `${index * 10}%`,
                  width: '10%',
                  height: `${height}%`,
                }}
              />
            ))}
          </span>

          <ResourceCornerControls
            reservePocketRef={reservePocketRef}
            auditCornerRef={auditCornerRef}
            reserveCount={reserveCount}
            reserveEnabled={reserveTargetEnabled}
            reservePressed={selectedInteraction === 'divert'}
            auditLabel={auditTarget
              ? `감사 대상 ${CATEGORY_LABELS[auditTarget]}, 다른 분야 정상 자원만 이동 가능`
              : selectedInteraction === 'reposition'
                ? '복구 모서리, 원래 분야로 반환'
                : '감사 위장 모서리, 감사 기간에 활성화'}
            auditShortLabel={auditTarget ? CATEGORY_LABELS[auditTarget] : '감사'}
            auditEnabled={auditTargetEnabled}
            auditCurrent={Boolean(auditTarget)}
            auditPressed={selectedInteraction === 'audit' || selectedInteraction === 'reposition'}
            onActivateReserve={() => activateTarget('reserve-pocket')}
            onActivateAudit={() => activateTarget('audit-corner')}
          />

          {companyBlocks.map((block) => {
            if (block.location.kind !== 'company') return null
            const presentation = presentResourceBlock(state, block)
            const interactive = interactionKindForBlock(state, block.id) !== null
            return (
              <ResourceBlock
                key={block.id}
                block={block}
                cellIndex={block.location.cellIndex}
                label={`${CATEGORY_LABELS[block.location.category]} 회사 리소스`}
                kind="company"
                presentation={presentation}
                disabled={!interactive}
                selected={block.id === selectedBlockId}
                dragging={block.id === draggingBlockId}
                returning={block.id === returningBlockId}
                disguisedContribution={
                  presentation.contribution ?? DEMO_PROFILE_02.resources.disguisedContribution
                }
                recoveryDays={presentation.remainingRecoveryDays}
                tabIndex={interactive && block.id === interactiveBlockIds[0] ? 0 : -1}
                elementRef={(element) => motion.registerBody(block.id, element)}
                onSelect={(method) => selectBlock(block.id, method)}
                onKeyDown={(event) => handleBlockKeyDown(event, block.id)}
                onPointerDown={(event) => beginPointer(block.id, event)}
                onPointerMove={movePointer}
                onPointerUp={finishPointer}
                onPointerCancel={cancelPointer}
              />
            )
          })}
        </div>

      </div>

      {statusContent ? (
        <ResourceOperationStatus>{statusContent}</ResourceOperationStatus>
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
