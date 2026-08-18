import { useGameSettings } from '../../app/GameContext'
import type { RecoveryContaminationOpportunity } from '../../game/causalGameplay'
import {
  canAffordHackNode,
  eligibleTargets,
  HACK_NODE_IDS,
  type HackNodeDefinition,
  type HackNodeId,
  type HackTree,
} from '../../game/hacking'
import type { CampaignState, ResourceBlock } from '../../game/model'
import { message } from '../../i18n/messages'
import { HackNodeCard } from './HackNodeCard'
import { HackNodeIcon } from './HackNodeIcon'
import { HACK_TREE_PRESENTATION } from './hackingPresentation'
import type { HackStagingTarget } from './useHackResourceStaging'

export interface HackTargetConfirmation {
  nodeId: string
  targetId: string
}

interface HackNodePathProps {
  state: CampaignState
  activeTree: HackTree
  nodes: readonly HackNodeDefinition[]
  reserveCount: number
  stagedBlocks: readonly ResourceBlock[]
  stagingTarget: HackStagingTarget | null
  stagingReady: boolean
  selectedNodeId: HackNodeId
  recoveryOpportunity?: RecoveryContaminationOpportunity
  targetNames: Readonly<Record<string, string>>
  targetConfirmation: HackTargetConfirmation | null
  onBeginNodeAction(mode: 'purchase' | 'charge', node: HackNodeDefinition): void
  onConfirmResourceAction(): void
  onCancelCharge(nodeId: HackNodeId): void
  onSelectTarget(confirmation: HackTargetConfirmation): void
  onScheduleTarget(): void
  onExecuteRecoveryContamination(opportunityId: string): void
  onInspectNode(nodeId: HackNodeId): void
  onRegisterNode(nodeId: string, element: HTMLElement | null): void
  onUnstage(blockId: string): boolean
  onCancelStaging(): void
}

export function HackNodePath({
  state,
  activeTree,
  nodes,
  reserveCount,
  stagedBlocks,
  stagingTarget,
  stagingReady,
  selectedNodeId,
  recoveryOpportunity,
  targetNames,
  targetConfirmation,
  onBeginNodeAction,
  onConfirmResourceAction,
  onCancelCharge,
  onSelectTarget,
  onScheduleTarget,
  onExecuteRecoveryContamination,
  onInspectNode,
  onRegisterNode,
  onUnstage,
  onCancelStaging,
}: HackNodePathProps) {
  const { settings } = useGameSettings()

  return (
    <ol
      className="hack-node-list"
      data-active-tree={activeTree}
      aria-label={`${HACK_TREE_PRESENTATION[activeTree].label} 해킹 경로`}
    >
      {nodes.map((node, index) => {
        const purchased = state.hacking.purchasedNodeIds.includes(node.id)
        const prerequisiteMet =
          node.prerequisiteId === null ||
          state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
        if (!purchased && !prerequisiteMet) {
          return (
            <li className="hack-path-step" data-path-step={index + 1} key={node.id}>
              <article
                className={`hack-node hack-node--concealed ${selectedNodeId === node.id ? 'hack-node--selected' : ''}`}
                role="group"
                aria-label={`미확인 해킹 단계 ${index + 1}`}
                tabIndex={0}
                data-selected={selectedNodeId === node.id ? 'true' : 'false'}
                onClick={() => onInspectNode(node.id)}
                onFocus={() => onInspectNode(node.id)}
                onMouseEnter={() => onInspectNode(node.id)}
              >
                <div className="hack-node-index">
                  <HackNodeIcon label="미확인 단계" concealed />
                  <span>??</span>
                </div>
                <div className="node-copy">
                  <header>
                    <div>
                      <span className="hack-node-state">암호화됨</span>
                      <h3>미확인 단계</h3>
                    </div>
                    <strong>요구 미확인</strong>
                  </header>
                </div>
                <div className="hack-node-control">
                  <span className="node-active-label">접근 불가</span>
                </div>
              </article>
            </li>
          )
        }
        const charged = state.hacking.sabotageCharges[node.id]
        const scheduled = state.hacking.scheduledSabotage.some(
          ({ nodeId }) => nodeId === node.id,
        )
        const targets = purchased && node.tree === 'sabotage'
          ? eligibleTargets(state, node.id)
          : []
        const nodeRecoveryOpportunity =
          node.id === HACK_NODE_IDS.sabotage.qualityDegradation
            ? recoveryOpportunity
            : undefined
        const activeNodeStaging = stagingTarget?.nodeId === node.id
          ? stagingTarget
          : null

        let actions
        if (!purchased) {
          actions = activeNodeStaging?.mode === 'purchase' ? (
            <button
              type="button"
              className="hack-node-confirm"
              aria-label={message(settings.locale, 'hacking.node.confirm.purchase', {
                node: node.label,
              })}
              disabled={!stagingReady}
              onClick={onConfirmResourceAction}
            >
              구매 확정
            </button>
          ) : (
            <button
              type="button"
              aria-label={message(settings.locale, 'hacking.node.prepare.purchase', {
                node: node.label,
              })}
              disabled={!prerequisiteMet || !canAffordHackNode(state, node)}
              onClick={() => onBeginNodeAction('purchase', node)}
            >
              리소스 놓기
            </button>
          )
        } else if (node.tree === 'sabotage') {
          actions = (
            <>
              {charged ? (
                <button
                  type="button"
                  aria-label={`${node.label} 충전 취소`}
                  onClick={() => onCancelCharge(node.id)}
                >
                  충전 취소
                </button>
              ) : activeNodeStaging?.mode === 'charge' ? (
                <button
                  type="button"
                  className="hack-node-confirm"
                  aria-label={message(settings.locale, 'hacking.node.confirm.charge', {
                    node: node.label,
                  })}
                  disabled={!stagingReady}
                  onClick={onConfirmResourceAction}
                >
                  충전 확정
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={message(settings.locale, 'hacking.node.prepare.charge', {
                    node: node.label,
                  })}
                  disabled={reserveCount < 1 || scheduled}
                  onClick={() => onBeginNodeAction('charge', node)}
                >
                  {scheduled ? '공격 예약됨' : '리소스 1개 놓기'}
                </button>
              )}
              {charged && nodeRecoveryOpportunity ? (
                <button
                  className="recovery-contamination-confirm"
                  type="button"
                  aria-label="MERIDIAN 복구 오염 실행 확정"
                  onClick={() => onExecuteRecoveryContamination(nodeRecoveryOpportunity.id)}
                >
                  복구 오염 실행 확정
                </button>
              ) : charged ? (
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
                      onClick={() => onSelectTarget({ nodeId: node.id, targetId })}
                    >
                      {targetNames[targetId]}
                    </button>
                  ))}
                  {targetConfirmation?.nodeId === node.id ? (
                    <button
                      type="button"
                      className="hack-target-confirm"
                      aria-label={`${targetNames[targetConfirmation.targetId]} 공격 예약 확정`}
                      onClick={onScheduleTarget}
                    >
                      공격 예약 확정
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )
        } else {
          actions = <span className="node-active-label">활성</span>
        }

        return (
          <li className="hack-path-step" data-path-step={index + 1} key={node.id}>
            <HackNodeCard
              state={state}
              node={node}
              sequence={index + 1}
              purchased={purchased}
              prerequisiteMet={prerequisiteMet}
              selected={selectedNodeId === node.id}
              stagingTarget={activeNodeStaging}
              stagedBlocks={stagedBlocks}
              registerTarget={(element) => onRegisterNode(node.id, element)}
              onUnstage={onUnstage}
              onCancelStaging={onCancelStaging}
              onInspect={() => onInspectNode(node.id)}
              actions={actions}
            />
          </li>
        )
      })}
    </ol>
  )
}
