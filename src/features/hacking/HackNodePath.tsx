import { useGameSettings } from '../../app/GameContext'
import type { RecoveryContaminationOpportunity } from '../../game/causalGameplay'
import { getAuditIntel } from '../../game/evaluation'
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
  auditIntel: ReturnType<typeof getAuditIntel>
  nextAuditProbability: number
  recoveryOpportunity?: RecoveryContaminationOpportunity
  targetNames: Readonly<Record<string, string>>
  targetConfirmation: HackTargetConfirmation | null
  onBeginNodeAction(mode: 'purchase' | 'charge', node: HackNodeDefinition): void
  onConfirmResourceAction(): void
  onCancelCharge(nodeId: HackNodeId): void
  onSelectTarget(confirmation: HackTargetConfirmation): void
  onScheduleTarget(): void
  onExecuteRecoveryContamination(opportunityId: string): void
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
  auditIntel,
  nextAuditProbability,
  recoveryOpportunity,
  targetNames,
  targetConfirmation,
  onBeginNodeAction,
  onConfirmResourceAction,
  onCancelCharge,
  onSelectTarget,
  onScheduleTarget,
  onExecuteRecoveryContamination,
  onRegisterNode,
  onUnstage,
  onCancelStaging,
}: HackNodePathProps) {
  const { settings } = useGameSettings()
  const hasFrontier = nodes.some((node) => {
    if (state.hacking.purchasedNodeIds.includes(node.id)) return false
    return (
      node.prerequisiteId === null ||
      state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
    )
  })

  return (
    <ol
      className="hack-node-list"
      data-active-tree={activeTree}
      data-has-frontier={hasFrontier ? 'true' : 'false'}
      aria-label={`${HACK_TREE_PRESENTATION[activeTree].label} 해킹 경로`}
    >
      {nodes.map((node, index) => {
        const purchased = state.hacking.purchasedNodeIds.includes(node.id)
        const prerequisiteMet =
          node.prerequisiteId === null ||
          state.hacking.purchasedNodeIds.includes(node.prerequisiteId)
        if (!purchased && !prerequisiteMet) {
          return (
            <li
              className="hack-path-step"
              data-node-status="concealed"
              data-path-step={index + 1}
              key={node.id}
            >
              <article
                className="hack-node hack-node--concealed"
                role="group"
                aria-label={`미확인 해킹 단계 ${index + 1}`}
              >
                <div className="hack-node-index" aria-hidden="true">
                  <span>??</span>
                  <i />
                </div>
                <div className="hack-cipher-copy">
                  <span className="hack-node-state">BLACKOUT // 암호화됨</span>
                  <h3>미확인 단계</h3>
                  <strong>비용 · 효과 · 보상 잠김</strong>
                </div>
                <span className="hack-cipher-scramble" aria-hidden="true">7F · ?? · A0</span>
                <p>현재 최전선 해금 시 공개</p>
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

        const details = (
          <>
            {purchased &&
            node.id === HACK_NODE_IDS.intelligence.auditSchedule &&
            auditIntel.scheduleKnown ? (
              <div className="node-result" aria-label="감사 일정 해킹 결과">
                <strong>
                  {auditIntel.scheduled ? '이번 달 말 감사 예정' : '이번 달 감사 없음'}
                </strong>
                <span>월초 결정 확률 {(state.audit.probability * 100).toFixed(1)}%</span>
                <span>현재 의심 기준 다음 달 예상 {(nextAuditProbability * 100).toFixed(1)}%</span>
              </div>
            ) : null}
            {nodeRecoveryOpportunity ? (
              <div
                className="recovery-contamination-opportunity"
                role="group"
                aria-label="MERIDIAN 복구 오염 기회"
              >
                <strong>MERIDIAN 롤백 관측됨</strong>
                <span>
                  복구 경로 오염 가능 · 서비스{' '}
                  {nodeRecoveryOpportunity.expiresOnServiceDay}일차까지
                </span>
                <small>품질 저하 충전 1회를 사용해 기존 영향 기간을 15일 연장합니다.</small>
              </div>
            ) : null}
          </>
        )

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
                해금 승인
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
              침투 조합 준비
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
                  실행 자원 장착
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
                  {scheduled ? '공격 예약됨' : '실행 자원 1개 준비'}
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
          <li
            className="hack-path-step"
            data-node-status={purchased ? 'purchased' : 'frontier'}
            data-path-step={index + 1}
            key={node.id}
          >
            <HackNodeCard
              state={state}
              node={node}
              sequence={index + 1}
              purchased={purchased}
              prerequisiteMet={prerequisiteMet}
              charged={Boolean(charged)}
              scheduled={scheduled}
              stagingTarget={activeNodeStaging}
              stagedBlocks={stagedBlocks}
              registerTarget={(element) => onRegisterNode(node.id, element)}
              onUnstage={onUnstage}
              onCancelStaging={onCancelStaging}
              details={details}
              actions={actions}
            />
          </li>
        )
      })}
    </ol>
  )
}
