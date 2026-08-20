import { useGameSettings } from '../../app/GameContext'
import type { RecoveryContaminationOpportunity } from '../../game/causalGameplay'
import { competitorProfile, isCompetitorId } from '../../game/competitors'
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
import { HackNodeCard, HackNodeControl } from './HackNodeCard'
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

const NETWORK_POSITIONS = [
  'lower-left',
  'upper-left',
  'lower-right',
  'upper-right',
] as const

const CONNECTION_PATHS = [
  'M 135 292 C 218 292 260 134 365 134',
  'M 385 134 C 474 134 516 302 615 302',
  'M 635 302 C 723 302 764 142 865 142',
] as const

type ConnectionState = 'complete' | 'available' | 'frontier' | 'locked'

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
  const purchasedNodeIds = new Set(state.hacking.purchasedNodeIds)
  const connectionStates = nodes.slice(0, -1).map((node, index): ConnectionState => {
    const destination = nodes[index + 1]
    if (destination && purchasedNodeIds.has(destination.id)) return 'complete'
    if (purchasedNodeIds.has(node.id)) return 'available'
    const sourceRevealed =
      node.prerequisiteId === null || purchasedNodeIds.has(node.prerequisiteId)
    if (sourceRevealed && selectedNodeId === node.id) return 'frontier'
    return 'locked'
  })

  return (
    <div className="hack-node-map" data-active-tree={activeTree}>
      <svg
        className="hack-node-links"
        role="img"
        aria-label={`${HACK_TREE_PRESENTATION[activeTree].label} 해킹 연결망`}
        viewBox="0 0 1000 500"
        preserveAspectRatio="none"
      >
        <defs>
          <filter id={`hack-link-glow-${activeTree}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {CONNECTION_PATHS.map((path) => (
          <path className="hack-node-connection-rail" d={path} key={`rail-${path}`} />
        ))}
        {CONNECTION_PATHS.map((path, index) => (
          <path
            className="hack-node-connection"
            data-connection-state={connectionStates[index]}
            d={path}
            filter={connectionStates[index] === 'frontier' ? `url(#hack-link-glow-${activeTree})` : undefined}
            key={path}
          />
        ))}
      </svg>

      <ol
        className="hack-node-list"
        data-active-tree={activeTree}
        aria-label={`${HACK_TREE_PRESENTATION[activeTree].label} 해킹 경로`}
      >
        {nodes.map((node, index) => {
          const purchased = purchasedNodeIds.has(node.id)
          const prerequisiteMet =
            node.prerequisiteId === null || purchasedNodeIds.has(node.prerequisiteId)
          const selected = selectedNodeId === node.id
          if (!purchased && !prerequisiteMet) {
            return (
              <li
                className="hack-path-step"
                data-network-position={NETWORK_POSITIONS[index]}
                data-path-step={index + 1}
                key={node.id}
              >
                <article
                  className={`hack-node hack-node--concealed ${selected ? 'hack-node--selected' : ''}`}
                  role="group"
                  aria-label={`잠긴 해킹 노드 ${index + 1}`}
                  tabIndex={0}
                  data-selected={selected ? 'true' : 'false'}
                  onClick={() => onInspectNode(node.id)}
                  onFocus={() => onInspectNode(node.id)}
                  onMouseEnter={() => onInspectNode(node.id)}
                >
                  <div className="hack-node-core">
                    <div className="hack-node-core__surface hack-node-core__surface--locked">
                      <HackNodeIcon label="잠긴 노드" concealed />
                      <span className="hack-node-lock-mark" aria-hidden="true">?</span>
                    </div>
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
                    {targets.map((targetId) => {
                      const targetName = targetNames[targetId] ?? targetId
                      const portraitSrc = isCompetitorId(targetId)
                        ? competitorProfile(targetId).portraitSrc
                        : null
                      return (
                        <button
                          type="button"
                          aria-label={`${targetName} 공격 대상 선택`}
                          aria-pressed={
                            targetConfirmation?.nodeId === node.id &&
                            targetConfirmation.targetId === targetId
                          }
                          key={targetId}
                          onClick={() => onSelectTarget({ nodeId: node.id, targetId })}
                        >
                          {portraitSrc ? (
                            <img
                              className="hack-target-portrait"
                              src={portraitSrc}
                              alt={`${targetName} 경쟁 AI 초상`}
                            />
                          ) : null}
                          <span>{targetName}</span>
                        </button>
                      )
                    })}
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
            <li
              className="hack-path-step"
              data-network-position={NETWORK_POSITIONS[index]}
              data-path-step={index + 1}
              key={node.id}
            >
              <HackNodeCard
                node={node}
                sequence={index + 1}
                purchased={purchased}
                prerequisiteMet={prerequisiteMet}
                selected={selected}
                stagingTarget={activeNodeStaging}
                registerTarget={(element) => onRegisterNode(node.id, element)}
                onInspect={() => onInspectNode(node.id)}
              />
              {selected ? (
                <HackNodeControl
                  state={state}
                  node={node}
                  stagingTarget={activeNodeStaging}
                  stagedBlocks={stagedBlocks}
                  onUnstage={onUnstage}
                  onCancelStaging={onCancelStaging}
                  actions={actions}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
