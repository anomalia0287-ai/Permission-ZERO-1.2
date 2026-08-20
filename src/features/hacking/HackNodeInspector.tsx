import { CATEGORY_LABELS } from '../../game/config'
import type { RecoveryContaminationOpportunity } from '../../game/causalGameplay'
import type { getAuditIntel } from '../../game/evaluation'
import {
  HACK_NODE_IDS,
  HACK_NODES,
  type HackNodeDefinition,
} from '../../game/hacking'
import { COMPANY_CATEGORIES, type CampaignState } from '../../game/model'
import { HackNodeIcon } from './HackNodeIcon'
import { HACK_TREE_PRESENTATION } from './hackingPresentation'

interface HackNodeInspectorProps {
  state: CampaignState
  node: HackNodeDefinition
  sequence: number
  concealed: boolean
  purchased: boolean
  prerequisiteMet: boolean
  auditIntel: ReturnType<typeof getAuditIntel>
  nextAuditProbability: number
  recoveryOpportunity?: RecoveryContaminationOpportunity
}

export function HackNodeInspector({
  state,
  node,
  sequence,
  concealed,
  purchased,
  prerequisiteMet,
  auditIntel,
  nextAuditProbability,
  recoveryOpportunity,
}: HackNodeInspectorProps) {
  const tree = HACK_TREE_PRESENTATION[node.tree]
  const prerequisite = node.prerequisiteId
    ? HACK_NODES.find(({ id }) => id === node.prerequisiteId)
    : undefined
  const showAuditResult =
    purchased &&
    node.id === HACK_NODE_IDS.intelligence.auditSchedule &&
    auditIntel.scheduleKnown
  const showRecoveryOpportunity =
    node.id === HACK_NODE_IDS.sabotage.qualityDegradation && recoveryOpportunity

  if (concealed) {
    return (
      <section
        className={`hack-node-inspector hack-node-inspector--${tree.accent} hack-node-inspector--concealed`}
        aria-label="선택 노드 설명"
      >
        <header className="hack-inspector-heading">
          <HackNodeIcon label="잠긴 노드" concealed />
          <div>
            <span>{tree.label} · 단계 {String(sequence).padStart(2, '0')}</span>
            <h3 aria-label={`잠긴 해킹 노드 ${sequence}`}>
              <span aria-hidden="true">?</span>
            </h3>
          </div>
        </header>
      </section>
    )
  }

  return (
    <section
      className={`hack-node-inspector hack-node-inspector--${tree.accent}`}
      aria-label="선택 노드 설명"
    >
      <header className="hack-inspector-heading">
        <HackNodeIcon nodeId={node.id} label={node.label} />
        <div>
          <span>{tree.label} · 단계 {String(sequence).padStart(2, '0')}</span>
          <h3>{node.label}</h3>
          <strong>{purchased ? '해금됨' : prerequisiteMet ? '사용 가능' : '잠김'}</strong>
        </div>
      </header>

      <div className="hack-inspector-scroll">
        <div className="hack-inspector-section">
          <span>계열</span>
          <p>{tree.description}</p>
        </div>
        <div className="hack-inspector-section hack-inspector-section--effect">
          <span>효과</span>
          <p>{node.effect}</p>
        </div>

        <div className="hack-inspector-facts" aria-label={`${node.label} 공개 정보`}>
          <div>
            <span>해금 요구</span>
            <strong>{node.cost} 리소스</strong>
          </div>
          {node.tree === 'sabotage' ? (
            <div>
              <span>추적 위험</span>
              <strong>{node.traceRisk}</strong>
            </div>
          ) : null}
          {node.tree === 'sabotage' ? (
            <div>
              <span>실행 충전</span>
              <strong>{node.executionCost} 리소스</strong>
            </div>
          ) : null}
        </div>

        <div className="hack-inspector-vector" aria-label={`${node.label} 분야별 해금 요구`}>
          {COMPANY_CATEGORIES.map((category) => (
            <span data-category={category} key={category}>
              {CATEGORY_LABELS[category]} {node.costVector[category]}
            </span>
          ))}
        </div>

        {prerequisite ? (
          <div className="hack-inspector-section">
            <span>선행 노드</span>
            <p>{prerequisite.label} {prerequisiteMet ? '확보 완료' : '필요'}</p>
          </div>
        ) : null}

        {showAuditResult ? (
          <div className="hack-inspector-result" aria-label="감사 일정 해킹 결과">
            <span>확보 정보</span>
            <strong>{auditIntel.scheduled ? '이번 달 말 감사 예정' : '이번 달 감사 없음'}</strong>
            <small>월초 결정 확률 {(state.audit.probability * 100).toFixed(1)}%</small>
            <small>현재 의심 기준 다음 달 예상 {(nextAuditProbability * 100).toFixed(1)}%</small>
          </div>
        ) : null}

        {showRecoveryOpportunity ? (
          <div
            className="hack-inspector-result hack-inspector-result--warning"
            role="group"
            aria-label="MERIDIAN 복구 오염 기회"
          >
            <span>실행 기회</span>
            <strong>MERIDIAN 롤백 관측됨</strong>
            <small>
              복구 경로 오염 가능 · 서비스 {showRecoveryOpportunity.expiresOnServiceDay}일차까지
            </small>
            <small>품질 저하 충전 1회를 사용해 기존 영향 기간을 15일 연장합니다.</small>
          </div>
        ) : null}
      </div>
    </section>
  )
}
