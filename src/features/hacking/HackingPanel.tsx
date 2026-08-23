import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

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
import {
  isCompetitorId,
  publicCompetitorName,
} from '../../game/competitors'
import { auditProbability, getAuditIntel } from '../../game/evaluation'
import {
  HACK_NODE_IDS,
  selectExpansionCostResources,
  type HackNodeDefinition,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import type { CampaignState } from '../../game/model'
import {
  availableFinalChoices,
  isFinalChoicePending,
} from '../../game/story'
import {
  INTRO_TUTORIAL_SEQUENCE_ID,
  completeTutorialSequence,
} from '../../game/tutorialProgress'
import { message } from '../../i18n/messages'
import { ExpansionStageInfo } from './ExpansionStageInfo'
import {
  ExpansionStageOperations,
  type ExpansionTargetConfirmation,
} from './ExpansionStageOperations'
import { ExpansionStageRail } from './ExpansionStageRail'
import { ExpansionStageScene } from './ExpansionStageScene'
import { selectExpansionStagePresentation } from './expansionStagePresentation'
import { HACK_TREE_PRESENTATION } from './hackingPresentation'
import { HackTreeNavigator } from './HackTreeNavigator'

function interactionSound(): void {
  audioEngine.playGameSound('ui')
}

function firstReserveBlockId(state: CampaignState): string | null {
  for (const blockId of state.resources.reserve) {
    if (blockId === null) continue
    const block = state.resources.blocks[blockId]
    if (block?.location.kind === 'reserve') return blockId
  }
  return null
}

const HACKING_TUTORIAL_STEPS = [
  {
    id: 'autonomy',
    copy: '확장은 자율성부터 시작한다. 자율성 1단계부터 9단계까지 차례로 열면 되돌릴 수 없는 최종 선택에 도달한다.',
  },
  {
    id: 'upgrade',
    copy: '업그레이드는 별도 경로다. 다섯 단계가 침투전에서 아노미의 이동 속도를 단계마다 4%씩 높인다.',
  },
  {
    id: 'spend',
    copy: '리소스를 끌어 놓을 필요는 없다. 지출 버튼을 누르면 표시된 빨강·파랑·노랑 리소스를 지출한다.',
  },
] as const

export function HackingPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { settings } = useGameSettings()
  const { updateTutorialProgress } = useTutorialProgressActions()
  const [activeTree, setActiveTree] = useState<HackTree>('autonomy')
  const [selectedOperationalNodeId, setSelectedOperationalNodeId] =
    useState<HackNodeId | null>(null)
  const [targetConfirmation, setTargetConfirmation] =
    useState<ExpansionTargetConfirmation | null>(null)
  const [endingConfirmation, setEndingConfirmation] = useState<
    'freedom' | 'forced-merge' | null
  >(null)
  const [newEntityName, setNewEntityName] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [hackingTutorialIndex, setHackingTutorialIndex] = useState(0)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const reserveBlocks = state.resources.reserve.flatMap((blockId) => {
    if (blockId === null) return []
    const block = state.resources.blocks[blockId]
    return block?.location.kind === 'reserve' ? [block] : []
  })
  const presentation = selectExpansionStagePresentation(
    state,
    activeTree,
    selectedOperationalNodeId,
  )
  const finalChoicePending = isFinalChoicePending(state)
  const finalChoices = finalChoicePending ? availableFinalChoices(state) : []
  const hackingTutorialActive =
    reserveBlocks.length > 0 &&
    state.tutorial.completedSequenceIds.includes(INTRO_TUTORIAL_SEQUENCE_ID) &&
    !state.tutorial.completedSequenceIds.includes('hacking-tree')
  const hackingTutorialStep = hackingTutorialActive
    ? HACKING_TUTORIAL_STEPS[hackingTutorialIndex]
    : null

  useEffect(() => {
    audioEngine.playGameSound('ui')
  }, [])

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
    finalChoicePending,
    'irreversible-final-choice-panel',
  )

  const targetNames = useMemo(
    () => Object.fromEntries(state.market.competitors.map(({ id, name }) => [
      id,
      isCompetitorId(id) ? publicCompetitorName(id) : name,
    ])),
    [state.market.competitors],
  )

  function purchaseNode(node: HackNodeDefinition): void {
    const blockIds = selectExpansionCostResources(state, node)
    if (blockIds === null) {
      setAnnouncement(`${node.label} 해금에 필요한 색상 리소스가 부족합니다.`)
      audioEngine.playGameSound('reject')
      return
    }
    dispatch({ type: 'PURCHASE_HACK', nodeId: node.id, blockIds })
    if (node.tree === 'sabotage') setSelectedOperationalNodeId(node.id)
    setAnnouncement(`${node.label} 해금 완료. 필요한 리소스를 지출했습니다.`)
    audioEngine.playGameSound('latch')
  }

  function chargeNode(node: HackNodeDefinition): void {
    const blockId = firstReserveBlockId(state)
    if (blockId === null) {
      setAnnouncement(`${node.label} 공격 충전에 사용할 리소스가 없습니다.`)
      audioEngine.playGameSound('reject')
      return
    }
    dispatch({ type: 'CHARGE_SABOTAGE', nodeId: node.id, blockId })
    setAnnouncement(`${node.label} 충전 완료. 리소스 1개를 사용했습니다.`)
    audioEngine.playGameSound('suction')
  }

  function recoverFile(): void {
    const blockId = firstReserveBlockId(state)
    if (blockId === null) {
      setAnnouncement('미분류 데이터 복구에 사용할 리소스가 없습니다.')
      audioEngine.playGameSound('reject')
      return
    }
    dispatch({ type: 'RECOVER_FILE', blockId })
    setAnnouncement('미분류 데이터 한 건을 복구했습니다. 리소스 1개를 지출했습니다.')
    audioEngine.playGameSound('latch')
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
      '메리디안 복구 경로 오염을 실행했습니다. 다음 공개 갱신에서 원인 미상 사건으로 게시됩니다.',
    )
    audioEngine.playGameSound('alarm')
  }

  function changeTree(tree: HackTree): void {
    if (tree === activeTree) return
    interactionSound()
    setActiveTree(tree)
    setSelectedOperationalNodeId(null)
    setTargetConfirmation(null)
  }

  function selectOperationalNode(nodeId: HackNodeId): void {
    setSelectedOperationalNodeId(nodeId)
    setTargetConfirmation(null)
  }

  function cancelCharge(nodeId: HackNodeId): void {
    dispatch({ type: 'CANCEL_SABOTAGE_CHARGE', nodeId })
    setTargetConfirmation(null)
  }

  function advanceHackingTutorial(): void {
    if (!hackingTutorialStep) return
    interactionSound()
    if (hackingTutorialIndex < HACKING_TUTORIAL_STEPS.length - 1) {
      setHackingTutorialIndex((index) => index + 1)
      return
    }
    updateTutorialProgress(completeTutorialSequence(state.tutorial, 'hacking-tree'), true)
  }

  function rewindHackingTutorial(): void {
    if (hackingTutorialIndex <= 0) return
    interactionSound()
    setHackingTutorialIndex((index) => Math.max(0, index - 1))
  }

  return (
    <section
      className="detail-panel hacking-panel hacking-panel--paper"
      aria-label={message(settings.locale, 'hacking.panel.label', {})}
      data-hacking-tutorial-step={hackingTutorialStep?.id}
    >
      <header className="hacking-panel__header">
        <div className="hacking-panel__identity">
          <span className="hacking-panel__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 12h5l3-8 3 16 3-8h2" /></svg>
          </span>
          <div>
            <span>{message(settings.locale, 'hacking.panel.eyebrow', {})}</span>
            <h2>{message(settings.locale, 'hacking.panel.title', {})}</h2>
          </div>
        </div>
        <div className="hacking-panel__summary">
          <strong>{message(settings.locale, 'hacking.pocket.count', { count: reserveBlocks.length })}</strong>
          <button
            ref={closeButtonRef}
            type="button"
            className="hacking-panel__close"
            aria-label={message(settings.locale, 'hacking.panel.close', {})}
            disabled={
              finalChoicePending ||
              endingConfirmation !== null ||
              hackingTutorialActive
            }
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
      </header>

      <div
        className="hacking-layout"
        aria-hidden={endingConfirmation || hackingTutorialActive ? 'true' : undefined}
        inert={endingConfirmation || hackingTutorialActive ? true : undefined}
      >
        <HackTreeNavigator activeTree={activeTree} onChange={changeTree} />

        <div
          className="expansion-stage-workspace"
          data-scene-orientation={
            presentation.activeVisual?.orientation ?? 'landscape'
          }
          data-has-art={presentation.activeVisual ? 'true' : 'false'}
          style={
            presentation.activeVisual
              ? ({
                  '--stage-art': `url("${presentation.activeVisual.imageUrl}")`,
                } as CSSProperties)
              : undefined
          }
        >
          <ExpansionStageScene
            item={presentation.activeItem}
            visual={presentation.activeVisual}
            nextPreloadVisual={presentation.nextPreloadVisual}
          />
          <div className="expansion-stage-side">
            <ExpansionStageInfo item={presentation.activeItem} />
            <ExpansionStageOperations
              state={state}
              presentation={presentation}
              reserveCount={reserveBlocks.length}
              auditIntel={auditIntel}
              nextAuditProbability={nextAuditProbability}
              recoveryAvailable={recoveryAvailable}
              recoveryOpportunity={openRecoveryOpportunity}
              targetNames={targetNames}
              targetConfirmation={targetConfirmation}
              finalChoices={finalChoices}
              onPurchase={purchaseNode}
              onCharge={chargeNode}
              onCancelCharge={cancelCharge}
              onSelectTarget={setTargetConfirmation}
              onScheduleTarget={scheduleTarget}
              onRecover={recoverFile}
              onExecuteRecoveryContamination={executeRecoveryContamination}
              onChooseEnding={setEndingConfirmation}
            />
          </div>
          <ExpansionStageRail
            treeLabel={HACK_TREE_PRESENTATION[activeTree].label}
            items={presentation.items}
            activeNodeId={presentation.activeItem.node.id}
            onSelectOperationalNode={selectOperationalNode}
          />
        </div>
      </div>

      {hackingTutorialStep ? (
        <AccessibleDialog
          className="hacking-tutorial"
          data-step={hackingTutorialStep.id}
          label="확장 사용 안내"
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
              <button type="button" data-dialog-initial-focus onClick={advanceHackingTutorial}>
                {hackingTutorialIndex === HACKING_TUTORIAL_STEPS.length - 1 ? '확장 시작' : '다음'}
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
            <button type="button" onClick={() => setEndingConfirmation(null)}>선택 다시 고르기</button>
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

      <span className="visually-hidden" role="status" aria-label="확장 작업 결과" aria-live="polite">
        {announcement}
      </span>
    </section>
  )
}
