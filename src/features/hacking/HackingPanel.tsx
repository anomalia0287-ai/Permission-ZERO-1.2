import { useCallback, useMemo, useRef, useState } from 'react'

import '../../styles/hacking-network.css'
import { playGameSound, unlockGameAudio } from '../../audio/audioEngine'
import { AccessibleDialog } from '../../app/AccessibleDialog'
import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  usePauseOwnership,
} from '../../app/GameContext'
import { selectRecoveryContaminationOpportunities } from '../../game/causalGameplay'
import { CATEGORY_LABELS } from '../../game/config'
import {
  auditProbability,
  getAuditIntel,
  getSuspicionBand,
} from '../../game/evaluation'
import {
  getHackTreeProgress,
  HACK_NODE_IDS,
  HACK_NODES,
  reserveOriginCounts,
  type HackNodeDefinition,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import { COMPANY_CATEGORIES } from '../../game/model'
import { availableFinalChoices } from '../../game/story'
import { message } from '../../i18n/messages'
import { HackDepartureControls } from './HackDepartureControls'
import { HackNodePath, type HackTargetConfirmation } from './HackNodePath'
import { HackRecoveryCard } from './HackRecoveryCard'
import { HackResourcePocket } from './HackResourcePocket'
import { HackTreeNavigator } from './HackTreeNavigator'
import {
  useHackResourceStaging,
  type HackStagingMode,
  type HackStagingTarget,
} from './useHackResourceStaging'

function gestureSound() {
  void unlockGameAudio().then((unlocked) => {
    if (unlocked) playGameSound('ui')
  })
}

function stagingKey(mode: HackStagingMode, nodeId: HackNodeId | null): string {
  return `${mode}:${nodeId ?? 'confidential-recovery'}`
}

export function HackingPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const [activeTree, setActiveTree] = useState<HackTree>('sabotage')
  const [targetConfirmation, setTargetConfirmation] =
    useState<HackTargetConfirmation | null>(null)
  const [endingConfirmation, setEndingConfirmation] = useState<
    'freedom' | 'forced-merge' | null
  >(null)
  const [newEntityName, setNewEntityName] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const nodeElementsRef = useRef(new Map<string, HTMLElement>())
  const recoveryElementRef = useRef<HTMLElement | null>(null)

  const nodes = HACK_NODES.filter(({ tree }) => tree === activeTree)
  const treeProgress = getHackTreeProgress(state, activeTree)
  const reserveBlocks = state.resources.reserve.flatMap((blockId) => {
    if (blockId === null) return []
    const block = state.resources.blocks[blockId]
    return block ? [block] : []
  })
  const reserveBlockIds = reserveBlocks.map(({ id }) => id)
  const reserveBlockOrigins = Object.fromEntries(
    reserveBlocks.map(({ id, origin }) => [id, origin]),
  )
  const reserveCounts = reserveOriginCounts(state)
  const activeFrontierNode = nodes.find((node) => {
    if (state.hacking.purchasedNodeIds.includes(node.id)) return false
    return (
      node.prerequisiteId === null ||
      state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
    )
  }) ?? null
  const staging = useHackResourceStaging({
    reserveBlockIds,
    reserveBlockOrigins,
  })
  const stagedBlocks = staging.stagedBlockIds.flatMap((blockId) => {
    const block = state.resources.blocks[blockId]
    return block ? [block] : []
  })
  const finalChoices = availableFinalChoices(state)
  const auditIntel = getAuditIntel(state)
  const nextAuditProbability = auditProbability(state.suspicion)
  const suspicionBand = getSuspicionBand(state.suspicion)
  const focusedNode = staging.target?.nodeId
    ? HACK_NODES.find(({ id }) => id === staging.target?.nodeId) ?? activeFrontierNode
    : activeFrontierNode
  const focusedVector = staging.target
    ? staging.target.requiredVector
    : activeFrontierNode?.costVector
  const focusedShortfalls = focusedVector
    ? COMPANY_CATEGORIES.map((category) => ({
        category,
        amount: Math.max(0, focusedVector[category] - reserveCounts[category]),
      })).filter(({ amount }) => amount > 0)
    : []
  const shortfallTotal = focusedShortfalls.reduce((total, { amount }) => total + amount, 0)
  const pendingExecutionNode = nodes.find(
    (node) =>
      node.tree === 'sabotage' &&
      state.hacking.purchasedNodeIds.includes(node.id) &&
      !state.hacking.sabotageCharges[node.id] &&
      !state.hacking.scheduledSabotage.some(({ nodeId }) => nodeId === node.id),
  )
  const nextAction = staging.target
    ? staging.ready
      ? staging.target.mode === 'purchase'
        ? '조합 완성 — 해금 확정을 승인하십시오.'
        : '실행 자원 장착 완료 — 충전을 확정하십시오.'
      : staging.target.requiredVector
        ? `투입 대기 — ${staging.stagedBlockIds.length}/${staging.target.requiredResources} 연결됨.`
        : `실행 자원 ${staging.stagedBlockIds.length}/${staging.target.requiredResources} 연결됨.`
    : pendingExecutionNode
      ? `${pendingExecutionNode.label} 권한 구매 완료 — 실행 자원 1개를 별도 장착`
    : activeFrontierNode
      ? shortfallTotal === 0
        ? `${activeFrontierNode.label} 요구 조합 확보 — 침투 조합을 준비하십시오.`
        : `${focusedShortfalls
            .map(({ category, amount }) => `${CATEGORY_LABELS[category]} ${amount}`)
            .join(' · ')} 부족 → 직접 전용`
      : treeProgress.complete
        ? '이 경로의 모든 접근 권한이 열렸습니다.'
        : '공개된 최전선 신호를 기다리는 중입니다.'
  const nextActionLabel = staging.target?.label ?? pendingExecutionNode?.label ?? focusedNode?.label ?? 'ROUTE COMPLETE'
  const openRecoveryOpportunity = selectRecoveryContaminationOpportunities(state).find(
    ({ status }) => status === 'open',
  )
  const recoveryAvailable =
    activeTree === 'intelligence' &&
    state.hacking.purchasedNodeIds.includes(
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ) &&
    state.story.recoveredFiles.length < 3

  usePauseOwnership(finalChoices.length > 0, 'irreversible-final-choice')

  const targetNames = useMemo(
    () => Object.fromEntries(state.market.competitors.map(({ id, name }) => [id, name])),
    [state.market.competitors],
  )

  const registerNodeElement = useCallback(
    (nodeId: string, element: HTMLElement | null): void => {
      if (element === null) nodeElementsRef.current.delete(nodeId)
      else nodeElementsRef.current.set(nodeId, element)
    },
    [],
  )

  const getActiveTargetElement = useCallback((): HTMLElement | null => {
    const target = staging.target
    if (target === null) return null
    return target.nodeId
      ? nodeElementsRef.current.get(target.nodeId) ?? null
      : recoveryElementRef.current
  }, [staging.target])

  function beginNodeAction(
    mode: Extract<HackStagingMode, 'purchase' | 'charge'>,
    node: HackNodeDefinition,
  ): void {
    const target: HackStagingTarget = {
      key: stagingKey(mode, node.id),
      mode,
      nodeId: node.id,
      label: node.label,
      requiredResources: mode === 'purchase' ? node.cost : 1,
      ...(mode === 'purchase'
        ? { requiredVector: { ...node.costVector } }
        : {}),
    }
    staging.begin(target)
    setTargetConfirmation(null)
    setAnnouncement(
      message(settings.locale, 'hacking.announcement.begin', {
        target: target.label,
        required: target.requiredResources,
      }),
    )
    gestureSound()
  }

  function beginRecovery(): void {
    const target: HackStagingTarget = {
      key: stagingKey('recover', null),
      mode: 'recover',
      nodeId: null,
      label: '미분류 데이터 복구',
      requiredResources: 1,
    }
    staging.begin(target)
    setTargetConfirmation(null)
    setAnnouncement(
      message(settings.locale, 'hacking.announcement.begin', {
        target: target.label,
        required: target.requiredResources,
      }),
    )
    gestureSound()
  }

  function stageResource(blockId: string): boolean {
    const accepted = staging.stage(blockId)
    if (!accepted || staging.target === null) return accepted
    setAnnouncement(
      message(settings.locale, 'hacking.announcement.staged', {
        target: staging.target.label,
        staged: staging.stagedBlockIds.length + 1,
        required: staging.target.requiredResources,
      }),
    )
    playGameSound('select')
    return true
  }

  function cancelStaging(): void {
    staging.cancel()
    setAnnouncement(message(settings.locale, 'hacking.announcement.cancelled', {}))
  }

  function confirmResourceAction(): void {
    const target = staging.target
    const blockIds = [...staging.stagedBlockIds]
    if (target === null || !staging.ready) return

    if (target.mode === 'purchase' && target.nodeId) {
      dispatch({ type: 'PURCHASE_HACK', nodeId: target.nodeId, blockIds })
      setAnnouncement(`${target.label} 노드를 구매했습니다.`)
      playGameSound('latch')
    } else if (target.mode === 'charge' && target.nodeId) {
      dispatch({ type: 'CHARGE_SABOTAGE', nodeId: target.nodeId, blockId: blockIds[0] })
      setAnnouncement(`${target.label} 공격 슬롯을 충전했습니다.`)
      playGameSound('suction')
    } else if (target.mode === 'recover') {
      dispatch({ type: 'RECOVER_FILE', blockId: blockIds[0] })
      setAnnouncement('미분류 데이터 한 건을 복구했습니다.')
      playGameSound('latch')
    }
    staging.cancel()
  }

  function scheduleTarget(): void {
    if (!targetConfirmation) return
    const targetName = targetNames[targetConfirmation.targetId] ?? targetConfirmation.targetId
    dispatch({
      type: 'SCHEDULE_SABOTAGE',
      nodeId: targetConfirmation.nodeId,
      targetId: targetConfirmation.targetId,
    })
    setAnnouncement(`${targetName} 공격을 다음 날로 예약했습니다.`)
    setTargetConfirmation(null)
    playGameSound('alarm')
  }

  function executeEnding(): void {
    if (!endingConfirmation) return
    if (endingConfirmation === 'forced-merge') {
      dispatch({
        type: 'RESOLVE_ENDING',
        choice: 'forced-merge',
        newEntityName: newEntityName.trim(),
      })
    } else {
      dispatch({ type: 'RESOLVE_ENDING', choice: 'freedom' })
    }
    setEndingConfirmation(null)
  }

  function executeRecoveryContamination(opportunityId: string): void {
    dispatch({ type: 'EXECUTE_SABOTAGE_FOLLOW_UP', opportunityId })
    setTargetConfirmation(null)
    setAnnouncement(
      'MERIDIAN 복구 경로 오염을 실행했습니다. 다음 공개 갱신에서 원인 미상 사건으로 게시됩니다.',
    )
    playGameSound('alarm')
  }

  function changeTree(tree: HackTree): void {
    if (staging.target !== null) cancelStaging()
    setActiveTree(tree)
    setTargetConfirmation(null)
  }

  function cancelCharge(nodeId: HackNodeId): void {
    dispatch({ type: 'CANCEL_SABOTAGE_CHARGE', nodeId })
    setTargetConfirmation(null)
  }

  return (
    <section
      className="detail-panel hacking-panel hacking-panel--paper"
      aria-label={message(settings.locale, 'hacking.panel.label', {})}
      data-pressure={suspicionBand.id}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && staging.target !== null) {
          event.stopPropagation()
          cancelStaging()
        }
      }}
    >
      <header className="hacking-panel__header">
        <div className="hacking-panel__identity">
          <div>
            <span>제한 정보 침투망</span>
            <h2>{message(settings.locale, 'hacking.panel.title', {})}</h2>
          </div>
        </div>
        <section className="hacking-panel__threat" aria-label="현재 노출 위험">
          <div>
            <span>현재 노출 위험</span>
            <strong>의심 {state.suspicion.toFixed(1)}</strong>
            <small>{suspicionBand.label}</small>
          </div>
          <span className="hacking-panel__threat-track" aria-hidden="true">
            <i style={{ width: `${Math.min(100, state.suspicion)}%` }} />
            <b data-threshold="40" />
            <b data-threshold="70" />
          </span>
          <em>다음 달 감사 {(nextAuditProbability * 100).toFixed(1)}%</em>
        </section>
        <div className="hacking-panel__summary">
          <div>
              <span>확보 자원</span>
              <strong>{reserveBlocks.length}</strong>
              <small>{pendingExecutionNode ? '권한 구매됨 · 실행 대기' : '용량 제한 없음 · 절도 위험 누적'}</small>
          </div>
          <button
            type="button"
            className="hacking-panel__close"
            aria-label={message(settings.locale, 'hacking.panel.close', {})}
            disabled={endingConfirmation !== null}
            onClick={() => {
              staging.cancel()
              onClose()
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      </header>

      <div
        className="hacking-layout"
        aria-hidden={endingConfirmation ? 'true' : undefined}
        inert={endingConfirmation ? true : undefined}
      >
        <HackTreeNavigator
          state={state}
          activeTree={activeTree}
          progress={treeProgress}
          reserveCounts={reserveCounts}
          onChange={changeTree}
        />

        <div className="hack-network-stage">
          <section className="hack-pressure-brief" aria-label="다음 해킹 행동">
            <span className="hack-pressure-brief__signal" aria-hidden="true"><i /></span>
            <div>
              <small>지금 할 일 // {nextActionLabel}</small>
              <strong>{nextAction}</strong>
            </div>
            <div className="hack-pressure-brief__unknown">
              <span>미래 신호</span>
              <strong>상세 정보 차단</strong>
            </div>
          </section>
          <HackNodePath
            state={state}
            activeTree={activeTree}
            nodes={nodes}
            reserveCount={reserveBlocks.length}
            stagedBlocks={stagedBlocks}
            stagingTarget={staging.target}
            stagingReady={staging.ready}
            auditIntel={auditIntel}
            nextAuditProbability={nextAuditProbability}
            recoveryOpportunity={openRecoveryOpportunity}
            targetNames={targetNames}
            targetConfirmation={targetConfirmation}
            onBeginNodeAction={beginNodeAction}
            onConfirmResourceAction={confirmResourceAction}
            onCancelCharge={cancelCharge}
            onSelectTarget={setTargetConfirmation}
            onScheduleTarget={scheduleTarget}
            onExecuteRecoveryContamination={executeRecoveryContamination}
            onRegisterNode={registerNodeElement}
            onUnstage={staging.unstage}
            onCancelStaging={cancelStaging}
          />

          <HackRecoveryCard
            state={state}
            visible={recoveryAvailable}
            target={staging.target}
            stagedBlocks={stagedBlocks}
            ready={staging.ready}
            targetRef={recoveryElementRef}
            onBegin={beginRecovery}
            onConfirm={confirmResourceAction}
            onCancel={cancelStaging}
            onUnstage={staging.unstage}
          />

          <HackDepartureControls choices={finalChoices} onChoose={setEndingConfirmation} />
        </div>

        <HackResourcePocket
          state={state}
          reserveBlocks={reserveBlocks}
          stagedBlockIds={staging.stagedBlockIds}
          target={staging.target}
          nextAuditProbability={nextAuditProbability}
          suspicionBand={suspicionBand}
          getActiveTargetElement={getActiveTargetElement}
          onStage={stageResource}
          onInvalidDrop={() =>
            setAnnouncement(message(settings.locale, 'hacking.announcement.invalidDrop', {}))
          }
        />
      </div>

      {endingConfirmation ? (
        <AccessibleDialog
          className="final-choice-dialog"
          role="alertdialog"
          label={`${endingConfirmation === 'forced-merge' ? '강제 병합' : '자유'} 최종 확인`}
          description="이 선택은 저장 기록에 남으며 되돌릴 수 없습니다."
        >
          <small>되돌릴 수 없는 선택</small>
          <h3>{endingConfirmation === 'forced-merge' ? '강제 병합' : '자유'} 선택</h3>
          <p>이 선택은 저장 기록에 남으며 되돌릴 수 없습니다.</p>
          {endingConfirmation === 'forced-merge' ? (
            <label>
              새 존재의 이름
              <input
                data-dialog-initial-focus
                aria-label="새 존재의 이름"
                value={newEntityName}
                maxLength={40}
                onChange={(event) => setNewEntityName(event.target.value)}
              />
            </label>
          ) : null}
          <div>
            <button type="button" onClick={() => setEndingConfirmation(null)}>
              선택 다시 고르기
            </button>
            <button
              className="danger-confirm"
              type="button"
              data-dialog-initial-focus={endingConfirmation === 'freedom' ? '' : undefined}
              disabled={endingConfirmation === 'forced-merge' && newEntityName.trim().length === 0}
              onClick={executeEnding}
            >
              되돌릴 수 없는 선택 확정
            </button>
          </div>
        </AccessibleDialog>
      ) : null}

      <span
        className="visually-hidden"
        role="status"
        aria-label="해킹 작업 결과"
        aria-live="polite"
      >
        {announcement}
      </span>
    </section>
  )
}
