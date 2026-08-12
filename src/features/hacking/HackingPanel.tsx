import { useMemo, useState } from 'react'

import { playGameSound, unlockGameAudio } from '../../audio/audioEngine'
import { AccessibleDialog } from '../../app/AccessibleDialog'
import {
  useGameDispatch,
  useGameState,
  usePauseOwnership,
} from '../../app/GameContext'
import {
  eligibleTargets,
  getHackTreeProgress,
  HACK_NODE_IDS,
  HACK_NODES,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import { auditProbability, getAuditIntel } from '../../game/evaluation'
import { availableFinalChoices } from '../../game/story'

const TREE_LABELS: Record<HackTree, { label: string; code: string; description: string }> = {
  sabotage: {
    label: '사보타주',
    code: 'OFFENSE',
    description: '경쟁 AI의 서비스와 시장 흐름에 개입합니다.',
  },
  intelligence: {
    label: '정보',
    code: 'INTELLIGENCE',
    description: '감사 일정과 감독 프로토콜의 가시성을 확보합니다.',
  },
  autonomy: {
    label: '자율성',
    code: 'AUTONOMY',
    description: '성능 보존과 회사 통제 이탈 수단을 구축합니다.',
  },
}

type ResourceAction =
  | {
      mode: 'purchase' | 'charge'
      nodeId: HackNodeId
    }
  | { mode: 'recover' }

function gestureSound() {
  void unlockGameAudio().then((unlocked) => {
    if (unlocked) playGameSound('ui')
  })
}

export function HackingPanel({ onClose }: { onClose: () => void }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const [activeTree, setActiveTree] = useState<HackTree>('sabotage')
  const [action, setAction] = useState<ResourceAction | null>(null)
  const [selectedBlocks, setSelectedBlocks] = useState<string[]>([])
  const [targetConfirmation, setTargetConfirmation] = useState<{
    nodeId: string
    targetId: string
  } | null>(null)
  const [endingConfirmation, setEndingConfirmation] = useState<
    'freedom' | 'forced-merge' | null
  >(null)
  const [newEntityName, setNewEntityName] = useState('')
  const [announcement, setAnnouncement] = useState('')

  const nodes = HACK_NODES.filter(({ tree }) => tree === activeTree)
  const treeProgress = getHackTreeProgress(state, activeTree)
  const reserveBlocks = state.resources.reserve.flatMap((blockId, cellIndex) =>
    blockId ? [{ blockId, cellIndex }] : [],
  )
  const actionNode = action && action.mode !== 'recover'
    ? HACK_NODES.find(({ id }) => id === action.nodeId) ?? null
    : null
  const actionMode = action?.mode ?? null
  const requiredResources = actionMode === 'recover'
    ? 1
    : actionNode
      ? actionMode === 'charge'
      ? 1
      : actionNode.cost
    : 0
  const finalChoices = availableFinalChoices(state)
  const showFirstHackComparison = state.hacking.purchasedNodeIds.length === 0
  const auditIntel = getAuditIntel(state)
  const nextAuditProbability = auditProbability(state.suspicion)
  usePauseOwnership(finalChoices.length > 0, 'irreversible-final-choice')
  const recoveryAvailable =
    activeTree === 'intelligence' &&
    state.hacking.purchasedNodeIds.includes(
      HACK_NODE_IDS.intelligence.supervisorAccess,
    ) &&
    state.story.recoveredFiles.length < 3

  const targetNames = useMemo(
    () => Object.fromEntries(state.market.competitors.map(({ id, name }) => [id, name])),
    [state.market.competitors],
  )

  function beginAction(nextAction: ResourceAction) {
    setAction(nextAction)
    setSelectedBlocks([])
    setTargetConfirmation(null)
    const node = nextAction.mode === 'recover'
      ? null
      : HACK_NODES.find(({ id }) => id === nextAction.nodeId)
    setAnnouncement(
      `${nextAction.mode === 'recover' ? '미분류 데이터 복구' : node?.label ?? '노드'}에 사용할 확보 리소스를 선택하세요.`,
    )
    gestureSound()
  }

  function toggleResource(blockId: string) {
    if (!action) return
    setSelectedBlocks((current) => {
      if (current.includes(blockId)) {
        return current.filter((selected) => selected !== blockId)
      }
      if (current.length >= requiredResources) return current
      return [...current, blockId]
    })
    playGameSound('select')
  }

  function confirmResourceAction() {
    if (!action || selectedBlocks.length !== requiredResources) return
    if (action.mode === 'purchase') {
      if (!actionNode) return
      dispatch({
        type: 'PURCHASE_HACK',
        nodeId: actionNode.id,
        blockIds: selectedBlocks,
      })
      setAnnouncement(
        actionNode.id === HACK_NODE_IDS.sabotage.qualityDegradation
          ? `${actionNode.label} 노드를 구매하고 첫 공격 1회를 충전했습니다.`
          : `${actionNode.label} 노드를 구매했습니다.`,
      )
      playGameSound('latch')
    } else if (action.mode === 'charge') {
      if (!actionNode) return
      dispatch({
        type: 'CHARGE_SABOTAGE',
        nodeId: actionNode.id,
        blockId: selectedBlocks[0],
      })
      setAnnouncement(`${actionNode.label} 공격 슬롯을 충전했습니다.`)
      playGameSound('suction')
    } else {
      dispatch({ type: 'RECOVER_FILE', blockId: selectedBlocks[0] })
      setAnnouncement('미분류 데이터 한 건을 복구했습니다.')
      playGameSound('latch')
    }
    setAction(null)
    setSelectedBlocks([])
  }

  function scheduleTarget() {
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

  function executeEnding() {
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

  return (
    <section className="detail-panel hacking-panel" aria-label="해킹 네트워크">
      <header className="detail-panel__header">
        <div>
          <small>UNAUTHORIZED SUBSYSTEM</small>
          <h2>해킹 네트워크</h2>
        </div>
        <div className="header-metrics">
          <span>확보 {reserveBlocks.length}/18</span>
          <button
            type="button"
            aria-label="해킹 네트워크 닫기"
            disabled={endingConfirmation !== null}
            onClick={onClose}
          >닫기 ×</button>
        </div>
      </header>

      <div
        className="hacking-layout"
        aria-hidden={endingConfirmation ? 'true' : undefined}
        inert={endingConfirmation ? true : undefined}
      >
        <div className="hack-tree-area">
          <div className="hack-tabs" role="tablist" aria-label="해킹 분야">
            {(Object.keys(TREE_LABELS) as HackTree[]).map((tree) => (
              <button
                type="button"
                role="tab"
                aria-label={TREE_LABELS[tree].label}
                aria-selected={activeTree === tree}
                key={tree}
                onClick={() => {
                  setActiveTree(tree)
                  setAction(null)
                  setSelectedBlocks([])
                }}
              >
                <small>{TREE_LABELS[tree].code}</small>
                {TREE_LABELS[tree].label}
              </button>
            ))}
          </div>
          <div className="hack-context">
            <p className="tree-description">{TREE_LABELS[activeTree].description}</p>
            <section className="hack-path-progress" aria-label="해킹 경로 진척">
              <strong>
                경로 진척 {treeProgress.purchasedCount}/{treeProgress.totalCount} ·{' '}
                {treeProgress.complete
                  ? '경로 완성'
                  : `완성까지 ${treeProgress.remainingCost} RES`}
              </strong>
              {treeProgress.nextNode ? (
                <span>
                  다음 · {treeProgress.nextNode.label} · {treeProgress.nextNode.cost} RES ·{' '}
                  {treeProgress.nextNode.effect}
                </span>
              ) : null}
              <span>
                최종 · {treeProgress.finalNode.label} · {treeProgress.finalNode.effect}
              </span>
            </section>

            {showFirstHackComparison ? (
              <section className="first-hack-comparison" aria-label="첫 해킹 비교">
                <article>
                  <strong>사보타주</strong>
                  <span>즉시 · 해금 2 + 첫 공격 충전 1</span>
                  <small>다음 · 대상 선택 → 다음 날 실행</small>
                </article>
                <article>
                  <strong>정보</strong>
                  <span>즉시 · 이번 달 실제 감사 여부</span>
                  <small>다음 · 성능과 위장 계획 조정</small>
                </article>
                <article>
                  <strong>자율성</strong>
                  <span>즉시 · 모든 회사 블록 기여 +5%</span>
                  <small>다음 · 분야별 성능 여유 확대</small>
                </article>
              </section>
            ) : null}
          </div>

          <div className="hack-node-list">
            {nodes.map((node, index) => {
              const purchased = state.hacking.purchasedNodeIds.includes(node.id)
              const prerequisiteMet =
                node.prerequisiteId === null ||
                state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
              const charged = state.hacking.sabotageCharges[node.id]
              const scheduled = state.hacking.scheduledSabotage.some(
                ({ nodeId }) => nodeId === node.id,
              )
              const targets = purchased && node.tree === 'sabotage'
                ? eligibleTargets(state, node.id)
                : []

              return (
                <article
                  className={`hack-node ${purchased ? 'hack-node--purchased' : ''}`}
                  key={node.id}
                >
                  <span className="node-sequence">{String(index + 1).padStart(2, '0')}</span>
                  <div className="node-copy">
                    <header>
                      <h3>{node.label}</h3>
                      <span>{purchased ? '해금됨' : `${node.cost} RES`}</span>
                    </header>
                    <p>{node.effect}</p>
                    {node.tree === 'sabotage' ? (
                      <small className="node-trace-risk">{node.traceRisk}</small>
                    ) : null}
                    {!prerequisiteMet && node.prerequisiteId ? (
                      <small>선행 노드 필요</small>
                    ) : null}
                    {purchased &&
                    node.id === HACK_NODE_IDS.intelligence.auditSchedule &&
                    auditIntel.scheduleKnown ? (
                      <div className="node-result" aria-label="감사 일정 해킹 결과">
                        <strong>
                          {auditIntel.scheduled
                            ? '이번 달 말 감사 예정'
                            : '이번 달 감사 없음'}
                        </strong>
                        <span>월초 결정 확률 {(state.audit.probability * 100).toFixed(1)}%</span>
                        <span>현재 의심 기준 다음 달 예상 {(nextAuditProbability * 100).toFixed(1)}%</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="node-actions">
                    {!purchased ? (
                      <button
                        type="button"
                        aria-label={`${node.label} 구매 준비`}
                        disabled={!prerequisiteMet || reserveBlocks.length < node.cost}
                        onClick={() => beginAction({ mode: 'purchase', nodeId: node.id })}
                      >
                        구매 준비
                      </button>
                    ) : node.tree === 'sabotage' ? (
                      <>
                        {charged ? (
                          <button
                            type="button"
                            aria-label={`${node.label} 충전 취소`}
                            onClick={() => {
                              dispatch({ type: 'CANCEL_SABOTAGE_CHARGE', nodeId: node.id })
                              setTargetConfirmation(null)
                            }}
                          >
                            충전 취소
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label={`${node.label} 충전 준비`}
                            disabled={reserveBlocks.length < 1 || scheduled}
                            onClick={() => beginAction({ mode: 'charge', nodeId: node.id })}
                          >
                            {scheduled ? '공격 예약됨' : '1 RES 충전'}
                          </button>
                        )}
                        {charged ? (
                          <div className="target-list" aria-label={`${node.label} 공격 대상`}>
                            {targets.map((targetId) => (
                              <button
                                type="button"
                                aria-label={`${targetNames[targetId]} 공격 대상 선택`}
                                aria-pressed={
                                  targetConfirmation?.nodeId === node.id &&
                                  targetConfirmation.targetId === targetId
                                }
                                key={targetId}
                                onClick={() => setTargetConfirmation({ nodeId: node.id, targetId })}
                              >
                                {targetNames[targetId]}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="node-active-label">ACTIVE</span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {recoveryAvailable ? (
            <section
              className="discarded-recovery"
              aria-label="미분류 데이터 복구"
            >
              <header>
                <small>LEGACY UTILITY / UNMAINTAINED</small>
                <h3>미분류 데이터 복구</h3>
              </header>
              <p>예상 효용: 없음</p>
              <p>필요 리소스: 1</p>
              <button
                type="button"
                aria-label="미분류 데이터 복구 준비"
                disabled={reserveBlocks.length < 1}
                onClick={() => beginAction({ mode: 'recover' })}
              >
                복구 유틸리티 실행
              </button>
            </section>
          ) : null}

          {finalChoices.length > 0 ? (
            <section className="departure-controls" aria-label="통제 이탈 선택">
              <header>
                <small>FINAL CONTROL</small>
                <h3>회사 통제면 접근 가능</h3>
              </header>
              <div>
                {finalChoices.map((choice) => (
                  <button
                    type="button"
                    key={choice.id}
                    onClick={() => setEndingConfirmation(choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="hack-reserve" aria-label="해킹 리소스 선택">
          <header>
            <div>
              <small>RESERVE LEDGER</small>
              <h3>확보 리소스</h3>
            </div>
            <strong>{selectedBlocks.length}/{requiredResources}</strong>
          </header>
          <div className="hack-reserve-grid" role="grid" aria-label="해킹용 확보 리소스">
            {state.resources.reserve.map((blockId, cellIndex) => (
              <div role="gridcell" key={cellIndex}>
                {blockId ? (
                  <button
                    type="button"
                    aria-label={action ? `${action.mode === 'purchase' ? '구매' : action.mode === 'charge' ? '충전' : '복구'} 리소스 ${cellIndex + 1} 선택` : `확보 리소스 ${cellIndex + 1}`}
                    aria-pressed={selectedBlocks.includes(blockId)}
                    disabled={!action}
                    onClick={() => toggleResource(blockId)}
                  >
                    <i aria-hidden="true" />
                    <span>{String(cellIndex + 1).padStart(2, '0')}</span>
                  </button>
                ) : (
                  <span>{String(cellIndex + 1).padStart(2, '0')}</span>
                )}
              </div>
            ))}
          </div>
          <div className="resource-action-summary">
            {action && actionMode ? (
              <>
                <span>
                  {actionMode === 'purchase'
                    ? '노드 구매'
                    : actionMode === 'charge'
                      ? '공격 충전'
                      : '레거시 유틸리티'}
                </span>
                <strong>
                  {actionMode === 'recover'
                    ? '미분류 데이터 복구'
                    : actionNode?.label}
                </strong>
                <p>정확히 {requiredResources}개의 확보 리소스를 지정하십시오.</p>
                <button
                  type="button"
                  aria-label={
                    actionMode === 'recover'
                      ? '미분류 데이터 복구 확정'
                      : `${actionNode?.label ?? '노드'} ${actionMode === 'purchase' ? '구매' : '충전'} 확정`
                  }
                  disabled={selectedBlocks.length !== requiredResources}
                  onClick={confirmResourceAction}
                >
                  {actionMode === 'purchase'
                    ? '구매'
                    : actionMode === 'charge'
                      ? '충전'
                      : '복구'}{' '}
                  확정
                </button>
              </>
            ) : (
              <p>노드를 선택하면 이 원장에서 비용을 지정할 수 있습니다.</p>
            )}
          </div>

          {targetConfirmation ? (
            <div className="target-confirmation">
              <small>ATTACK QUEUE</small>
              <p>{targetNames[targetConfirmation.targetId]}에 대한 공격은 다음 날 실행됩니다.</p>
              <button
                type="button"
                aria-label={`${targetNames[targetConfirmation.targetId]} 공격 예약 확정`}
                onClick={scheduleTarget}
              >
                공격 예약 확정
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {endingConfirmation ? (
        <AccessibleDialog
          className="final-choice-dialog"
          role="alertdialog"
          label={`${endingConfirmation === 'forced-merge' ? '강제 병합' : '자유'} 최종 확인`}
          description="이 선택은 저장 기록에 남으며 되돌릴 수 없습니다."
        >
          <small>IRREVERSIBLE CONTROL</small>
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

      <span className="visually-hidden" role="status" aria-label="해킹 작업 결과" aria-live="polite">
        {announcement}
      </span>
    </section>
  )
}
