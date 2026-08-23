import type { RecoveryContaminationOpportunity } from '../../game/causalGameplay'
import { competitorProfile, isCompetitorId } from '../../game/competitors'
import type { getAuditIntel } from '../../game/evaluation'
import {
  eligibleTargets,
  HACK_NODE_IDS,
  type HackNodeDefinition,
  type HackNodeId,
} from '../../game/hacking'
import type { CampaignState } from '../../game/model'
import type { FinalChoice } from '../../game/story'
import { HackDepartureControls } from './HackDepartureControls'
import { HackRecoveryCard } from './HackRecoveryCard'
import type { ExpansionStagePresentation } from './expansionStagePresentation'

const RESOURCE_PRESENTATION = {
  reasoning: { colorName: '빨강', label: '추론' },
  memory: { colorName: '파랑', label: '기억' },
  fluency: { colorName: '노랑', label: '유창성' },
} as const

export interface ExpansionTargetConfirmation {
  nodeId: HackNodeId
  targetId: string
}

export interface ExpansionStageOperationsProps {
  state: CampaignState
  presentation: ExpansionStagePresentation
  reserveCount: number
  auditIntel: ReturnType<typeof getAuditIntel>
  nextAuditProbability: number
  recoveryAvailable: boolean
  recoveryOpportunity?: RecoveryContaminationOpportunity
  targetNames: Readonly<Record<string, string>>
  targetConfirmation: ExpansionTargetConfirmation | null
  finalChoices: readonly FinalChoice[]
  onPurchase(node: HackNodeDefinition): void
  onCharge(node: HackNodeDefinition): void
  onCancelCharge(nodeId: HackNodeId): void
  onSelectTarget(confirmation: ExpansionTargetConfirmation): void
  onScheduleTarget(): void
  onRecover(): void
  onExecuteRecoveryContamination(opportunityId: string): void
  onChooseEnding(choice: FinalChoice['id']): void
}

export function ExpansionStageOperations(
  props: ExpansionStageOperationsProps,
) {
  if (props.finalChoices.length > 0) {
    return (
      <section className="expansion-stage-operations" aria-label="운용">
        <h3>운용</h3>
        <p className="expansion-stage-operations__status">
          최종 통제 경계를 열었습니다. 되돌릴 수 없는 선택을 확정하십시오.
        </p>
        <HackDepartureControls
          choices={props.finalChoices}
          onChoose={props.onChooseEnding}
        />
      </section>
    )
  }

  const activeItem = props.presentation.activeItem
  const resourceDeficits = props.presentation.resourceDeficits
  const canSpend = resourceDeficits.length === 0
  const activeSabotage = activeItem.status === 'complete' &&
    activeItem.node.tree === 'sabotage'
  const charged = activeSabotage
    ? props.state.hacking.sabotageCharges[activeItem.node.id]
    : undefined
  const scheduledEntry = activeSabotage
    ? props.state.hacking.scheduledSabotage.find(
        ({ nodeId }) => nodeId === activeItem.node.id,
      )
    : undefined
  const scheduled = scheduledEntry !== undefined
  const targets = activeSabotage && charged
    ? eligibleTargets(props.state, activeItem.node.id)
    : []
  const activeRecoveryOpportunity =
    activeSabotage &&
    charged !== undefined &&
    activeItem.node.id === HACK_NODE_IDS.sabotage.qualityDegradation &&
    props.recoveryOpportunity?.status === 'open'
      ? props.recoveryOpportunity
      : undefined
  const showAuditResult =
    props.presentation.tree === 'intelligence' &&
    props.auditIntel.scheduleKnown

  return (
    <section className="expansion-stage-operations" aria-label="운용">
      <h3>운용</h3>
      {activeItem.status === 'current' ? (
        <div className="expansion-stage-operations__spend">
          <button
            type="button"
            aria-label={`${activeItem.node.label} ${
              canSpend ? '리소스 지출' : '필요 리소스 부족'
            }`}
            disabled={!canSpend}
            onClick={() => props.onPurchase(activeItem.node)}
          >
            {canSpend ? '리소스 지출' : '필요 리소스 부족'}
          </button>
          {resourceDeficits.length > 0 ? (
            <ul aria-label={`${activeItem.node.label} 부족 리소스`}>
              {resourceDeficits.map(({ category, missing }) => {
                const categoryPresentation = RESOURCE_PRESENTATION[category]
                return (
                  <li data-category={category} key={category}>
                    {categoryPresentation.colorName} ·{' '}
                    {categoryPresentation.label} {missing}개 부족
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {activeItem.status === 'complete' &&
      activeItem.node.tree !== 'sabotage' ? (
        <p className="expansion-stage-operations__status">해금 완료</p>
      ) : null}
      {activeSabotage && !charged ? (
        <div className="expansion-stage-operations__charge">
          <button
            type="button"
            aria-label={`${activeItem.node.label} ${
              scheduled ? '공격 예약됨' : '리소스 1개 충전'
            }`}
            disabled={props.reserveCount < 1 || scheduled}
            onClick={() => props.onCharge(activeItem.node)}
          >
            {scheduled ? '공격 예약됨' : '리소스 1개 충전'}
          </button>
          {scheduledEntry ? (
            <div
              className="expansion-stage-operations__schedule"
              role="status"
              aria-label={`${activeItem.node.label} 예약 상태`}
            >
              <strong>
                {props.targetNames[scheduledEntry.targetId] ??
                  scheduledEntry.targetId}
              </strong>
              <span>
                서비스 {scheduledEntry.executeOnServiceDay}일차 실행
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
      {activeSabotage && charged ? (
        <div className="expansion-stage-operations__sabotage">
          <button
            type="button"
            aria-label={`${activeItem.node.label} 충전 취소`}
            onClick={() => props.onCancelCharge(activeItem.node.id)}
          >
            충전 취소
          </button>
          {activeRecoveryOpportunity ? (
            <div
              className="expansion-stage-operations__recovery-contamination"
              role="group"
              aria-label="메리디안 복구 오염 기회"
            >
              <span>실행 기회</span>
              <strong>메리디안 롤백 관측됨</strong>
              <small>
                복구 경로 오염 가능 · 서비스{' '}
                {activeRecoveryOpportunity.expiresOnServiceDay}일차까지
              </small>
              <small>
                품질 저하 충전 1회를 사용해 기존 영향 기간을 15일 연장합니다.
              </small>
              <button
                type="button"
                className="recovery-contamination-confirm"
                aria-label="메리디안 복구 오염 실행 확정"
                onClick={() => props.onExecuteRecoveryContamination(
                  activeRecoveryOpportunity.id,
                )}
              >
                복구 오염 실행 확정
              </button>
            </div>
          ) : (
            <div
              className="expansion-stage-operations__targets"
              aria-label={`${activeItem.node.label} 공격 대상`}
            >
              {targets.length === 0 ? <p>사용 가능한 대상 없음</p> : null}
              {targets.map((targetId) => {
                const targetName = props.targetNames[targetId] ?? targetId
                const portraitSrc = isCompetitorId(targetId)
                  ? competitorProfile(targetId).portraitSrc
                  : null
                const selected =
                  props.targetConfirmation?.nodeId === activeItem.node.id &&
                  props.targetConfirmation.targetId === targetId

                return (
                  <button
                    type="button"
                    aria-label={`${targetName} 공격 대상 선택`}
                    aria-pressed={selected}
                    key={targetId}
                    onClick={() => props.onSelectTarget({
                      nodeId: activeItem.node.id,
                      targetId,
                    })}
                  >
                    {portraitSrc ? (
                      <img
                        className="expansion-stage-operations__target-portrait"
                        src={portraitSrc}
                        alt={`${targetName} 경쟁 AI 초상`}
                      />
                    ) : null}
                    <span>{targetName}</span>
                  </button>
                )
              })}
              {props.targetConfirmation?.nodeId === activeItem.node.id ? (
                <button
                  type="button"
                  className="expansion-stage-operations__target-confirm"
                  aria-label={`${
                    props.targetNames[props.targetConfirmation.targetId] ??
                    props.targetConfirmation.targetId
                  } 공격 예약 확정`}
                  onClick={props.onScheduleTarget}
                >
                  공격 예약 확정
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {showAuditResult ? (
        <div
          className="expansion-stage-operations__result"
          role="group"
          aria-label="감사 일정 확장 결과"
        >
          <span>확보 정보</span>
          <strong>
            {props.auditIntel.scheduled
              ? '이번 달 말 감사 예정'
              : '이번 달 감사 없음'}
          </strong>
          <small>
            월초 결정 확률 {(props.state.audit.probability * 100).toFixed(1)}%
          </small>
          <small>
            현재 의심 기준 다음 달 예상{' '}
            {(props.nextAuditProbability * 100).toFixed(1)}%
          </small>
        </div>
      ) : null}
      <HackRecoveryCard
        visible={props.recoveryAvailable}
        enabled={props.reserveCount > 0}
        onRecover={props.onRecover}
      />
      <HackDepartureControls
        choices={props.finalChoices}
        onChoose={props.onChooseEnding}
      />
    </section>
  )
}
