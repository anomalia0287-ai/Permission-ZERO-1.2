import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import * as audioEngine from '../../audio/audioEngine'
import { AccessibleDialog } from '../../app/AccessibleDialog'
import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useRuntimeSuspensionOwnership,
  useTutorialProgressActions,
} from '../../app/GameContext'
import { selectRecoveryContaminationOpportunities } from '../../game/causalGameplay'
import { auditProbability, getAuditIntel } from '../../game/evaluation'
import {
  getHackTreeProgress,
  HACK_NODE_IDS,
  HACK_NODES,
  type HackNodeDefinition,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import { availableFinalChoices } from '../../game/story'
import {
  INTRO_TUTORIAL_SEQUENCE_ID,
  completeTutorialSequence,
} from '../../game/tutorialProgress'
import { message } from '../../i18n/messages'
import { HackDepartureControls } from './HackDepartureControls'
import { HackNodeInspector } from './HackNodeInspector'
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
  void audioEngine.playHackingNetworkClick()
}

function stagingKey(mode: HackStagingMode, nodeId: HackNodeId | null): string {
  return `${mode}:${nodeId ?? 'confidential-recovery'}`
}

const HACKING_TUTORIAL_STEPS = [
  {
    id: 'trees',
    copy: '목적에 맞는 경로를 고른다. 사보타주는 경쟁사를 흔들고, 정보는 감사를 읽으며, 자율성은 탈출 조건을 연다.',
  },
  {
    id: 'nodes',
    copy: '빛이 들어온 노드가 지금 열 수 있는 경로다. 노드를 고르면 오른쪽에서 결과와 위험을 확인할 수 있다.',
  },
  {
    id: 'action',
    copy: '노드의 리소스 놓기를 누르면 투입 준비가 시작된다.',
  },
  {
    id: 'pocket',
    copy: '확보 포켓에서 요구 색상의 리소스를 눌러 채운 뒤 구매를 확정한다.',
  },
] as const

export function HackingPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const { updateTutorialProgress } = useTutorialProgressActions()
  const [activeTree, setActiveTree] = useState<HackTree>('sabotage')
  const [selectedNodeId, setSelectedNodeId] = useState<HackNodeId>(
    HACK_NODE_IDS.sabotage.qualityDegradation,
  )
  const [targetConfirmation, setTargetConfirmation] =
    useState<HackTargetConfirmation | null>(null)
  const [endingConfirmation, setEndingConfirmation] = useState<
    'freedom' | 'forced-merge' | null
  >(null)
  const [newEntityName, setNewEntityName] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [hackingTutorialIndex, setHackingTutorialIndex] = useState(0)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const nodeElementsRef = useRef(new Map<string, HTMLElement>())
  const recoveryElementRef = useRef<HTMLElement | null>(null)

  const nodes = HACK_NODES.filter(({ tree }) => tree === activeTree)
  const selectedNode = nodes.find(({ id }) => id === selectedNodeId) ?? nodes[0]
  const selectedNodeSequence = nodes.findIndex(({ id }) => id === selectedNode.id) + 1
  const selectedNodePurchased = state.hacking.purchasedNodeIds.includes(selectedNode.id)
  const selectedNodePrerequisiteMet =
    selectedNode.prerequisiteId === null ||
    state.hacking.purchasedNodeIds.includes(selectedNode.prerequisiteId)
  const selectedNodeConcealed =
    !selectedNodePurchased && !selectedNodePrerequisiteMet
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
  const staging = useHackResourceStaging({
    reserveBlockIds,
    reserveBlockOrigins,
  })
  const stagedBlocks = staging.stagedBlockIds.flatMap((blockId) => {
    const block = state.resources.blocks[blockId]
    return block ? [block] : []
  })
  const finalChoices = availableFinalChoices(state)
  const hackingTutorialActive =
    reserveBlocks.length > 0 &&
    state.tutorial.completedSequenceIds.includes(INTRO_TUTORIAL_SEQUENCE_ID) &&
    !state.tutorial.completedSequenceIds.includes('hacking-tree')
  const hackingTutorialStep = hackingTutorialActive
    ? HACKING_TUTORIAL_STEPS[hackingTutorialIndex]
    : null

  useEffect(() => {
    if (hackingTutorialActive) return
    const closeButton = closeButtonRef.current
    const outerDialog = closeButton?.closest<HTMLElement>('[role="dialog"]')
    const focused = document.activeElement
    if (
      closeButton &&
      outerDialog &&
      (
        focused === document.body ||
        focused === outerDialog ||
        !(focused instanceof HTMLElement) ||
        !focused.isConnected
      )
    ) {
      closeButton.focus()
    }
  }, [hackingTutorialActive])
  const auditIntel = getAuditIntel(state)
  const nextAuditProbability = auditProbability(state.suspicion)
  const openRecoveryOpportunity = selectRecoveryContaminationOpportunities(state).find(
    ({ status }) => status === 'open',
  )
  const recoveryAvailable =
    activeTree === 'intelligence' &&
    state.hacking.purchasedNodeIds.includes(
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ) &&
    state.story.recoveredFiles.length < 3

  useRuntimeSuspensionOwnership(
    finalChoices.length > 0,
    'irreversible-final-choice',
  )

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
    audioEngine.playGameSound('select')
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
      audioEngine.playGameSound('latch')
    } else if (target.mode === 'charge' && target.nodeId) {
      dispatch({ type: 'CHARGE_SABOTAGE', nodeId: target.nodeId, blockId: blockIds[0] })
      setAnnouncement(`${target.label} 공격 슬롯을 충전했습니다.`)
      audioEngine.playGameSound('suction')
    } else if (target.mode === 'recover') {
      dispatch({ type: 'RECOVER_FILE', blockId: blockIds[0] })
      setAnnouncement('미분류 데이터 한 건을 복구했습니다.')
      audioEngine.playGameSound('latch')
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
    audioEngine.playGameSound('alarm')
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
    audioEngine.playGameSound('alarm')
  }

  function changeTree(tree: HackTree): void {
    if (tree === activeTree) return
    if (staging.target !== null) cancelStaging()
    gestureSound()
    setActiveTree(tree)
    const firstNode = HACK_NODES.find((node) => node.tree === tree)
    if (firstNode) setSelectedNodeId(firstNode.id)
    setTargetConfirmation(null)
  }

  function cancelCharge(nodeId: HackNodeId): void {
    dispatch({ type: 'CANCEL_SABOTAGE_CHARGE', nodeId })
    setTargetConfirmation(null)
  }

  function advanceHackingTutorial(): void {
    if (!hackingTutorialStep) return
    gestureSound()
    if (hackingTutorialIndex < HACKING_TUTORIAL_STEPS.length - 1) {
      setHackingTutorialIndex((index) => index + 1)
      return
    }
    updateTutorialProgress(
      completeTutorialSequence(state.tutorial, 'hacking-tree'),
      true,
    )
  }

  function rewindHackingTutorial(): void {
    if (hackingTutorialIndex <= 0) return
    gestureSound()
    setHackingTutorialIndex((index) => Math.max(0, index - 1))
  }

  return (
    <section
      className="detail-panel hacking-panel hacking-panel--paper"
      aria-label={message(settings.locale, 'hacking.panel.label', {})}
      data-hacking-tutorial-step={hackingTutorialStep?.id}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && staging.target !== null) {
          event.stopPropagation()
          cancelStaging()
        }
      }}
    >
      <header className="hacking-panel__header">
        <div className="hacking-panel__identity">
          <span className="hacking-panel__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 12h5l3-8 3 16 3-8h2" />
            </svg>
          </span>
          <div>
            <span>{message(settings.locale, 'hacking.panel.eyebrow', {})}</span>
            <h2>{message(settings.locale, 'hacking.panel.title', {})}</h2>
          </div>
        </div>
        <div className="hacking-panel__summary">
          <strong>
            {message(settings.locale, 'hacking.pocket.count', {
              count: reserveBlocks.length,
            })}
          </strong>
          <button
            ref={closeButtonRef}
            type="button"
            className="hacking-panel__close"
            aria-label={message(settings.locale, 'hacking.panel.close', {})}
            disabled={endingConfirmation !== null || hackingTutorialActive}
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
        aria-hidden={endingConfirmation || hackingTutorialActive ? 'true' : undefined}
        inert={endingConfirmation || hackingTutorialActive ? true : undefined}
      >
        <HackTreeNavigator
          activeTree={activeTree}
          progress={treeProgress}
          onChange={changeTree}
        />

        <div className="hack-network-stage">
          <HackNodePath
            state={state}
            activeTree={activeTree}
            nodes={nodes}
            reserveCount={reserveBlocks.length}
            stagedBlocks={stagedBlocks}
            stagingTarget={staging.target}
            stagingReady={staging.ready}
            selectedNodeId={selectedNode.id}
            recoveryOpportunity={openRecoveryOpportunity}
            targetNames={targetNames}
            targetConfirmation={targetConfirmation}
            onBeginNodeAction={beginNodeAction}
            onConfirmResourceAction={confirmResourceAction}
            onCancelCharge={cancelCharge}
            onSelectTarget={setTargetConfirmation}
            onScheduleTarget={scheduleTarget}
            onExecuteRecoveryContamination={executeRecoveryContamination}
            onInspectNode={setSelectedNodeId}
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

        <aside className="hack-support-rail" aria-label="해킹 정보 및 확보 자원">
          <HackNodeInspector
            state={state}
            node={selectedNode}
            sequence={selectedNodeSequence}
            concealed={selectedNodeConcealed}
            purchased={selectedNodePurchased}
            prerequisiteMet={selectedNodePrerequisiteMet}
            auditIntel={auditIntel}
            nextAuditProbability={nextAuditProbability}
            recoveryOpportunity={openRecoveryOpportunity}
          />
          <HackResourcePocket
            state={state}
            reserveBlocks={reserveBlocks}
            stagedBlockIds={staging.stagedBlockIds}
            target={staging.target}
            getActiveTargetElement={getActiveTargetElement}
            onStage={stageResource}
            onInvalidDrop={() =>
              setAnnouncement(message(settings.locale, 'hacking.announcement.invalidDrop', {}))
            }
          />
        </aside>
      </div>

      {hackingTutorialStep ? (
        <AccessibleDialog
          className="hacking-tutorial"
          data-step={hackingTutorialStep.id}
          label="해킹 네트워크 사용 안내"
          description={hackingTutorialStep.copy}
          modal={false}
          dismissible={false}
          portal={false}
        >
          <section className="hacking-tutorial__card">
            <p>{hackingTutorialStep.copy}</p>
            <div className="hacking-tutorial__actions">
              {hackingTutorialIndex > 0 ? (
                <button type="button" onClick={rewindHackingTutorial}>이전</button>
              ) : null}
              <button
                type="button"
                data-dialog-initial-focus
                onClick={advanceHackingTutorial}
              >
                {hackingTutorialIndex === HACKING_TUTORIAL_STEPS.length - 1
                  ? '해킹 시작'
                  : '다음'}
              </button>
            </div>
          </section>
        </AccessibleDialog>
      ) : null}

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
