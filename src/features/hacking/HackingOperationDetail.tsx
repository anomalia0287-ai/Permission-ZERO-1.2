import { useState } from 'react'

import {
  ATTRIBUTION_CHOICES,
  INTERCEPTION_ROUTING_SHARES,
  ROOT_MERCY_CHOICES,
  SABOTAGE_OPERATION_CHOICES,
} from '../../game/hackingContent'
import type {
  AttributionActorId,
  AttributionSourceSignatureId,
  AutonomyRouteId,
  RootMercyChoice,
  RouteTuning,
  SabotageOptionId,
} from '../../game/hackingCoreModel'
import type { CampaignState, GameCommand } from '../../game/model'
import { HackingAutonomyScene } from './HackingAutonomyScene'
import { HackingIntelligenceScene } from './HackingIntelligenceScene'
import {
  HackingResourceTrigger,
} from './HackingResourceTray'
import { HackingSabotageScene } from './HackingSabotageScene'
import type {
  AutonomyDetailModel,
  HackingDetailModel,
  HackingOpportunitySummary,
  IntelligenceDetailModel,
  SabotageDetailModel,
} from './hackingPresentation'
import {
  hackingPlayerText,
  hackingRouteTuningLabel,
} from './hackingPresentation'

interface HackingOperationDetailProps {
  state: CampaignState
  detail: HackingDetailModel
  summary: HackingOpportunitySummary
  selectedBlockIds: readonly string[]
  onBack: () => void
  onOpenResources: (trigger: HTMLButtonElement) => void
  onCommand: (command: GameCommand, announcement: string) => void
  onSlotAction: (routeId: AutonomyRouteId, slotId: string) => void
  onRequestEscape: (routeId: AutonomyRouteId) => void
  onRequestRootMercy: (choice: RootMercyChoice) => void
}

const OUTCOME_LABELS: Record<string, string> = {
  'verification-gate-rewound': '검증 관문이 되감겨 TALLOW가 출시 범위를 다시 정하고 있다.',
  'reduced-launch-committed': 'TALLOW는 전체 재검증 대신 기능을 줄여 공개하기로 했다.',
  'rollback-started': '영향 요청군이 무너져 MERIDIAN이 롤백을 시작했다.',
  'rollback-contaminated': '선택한 복구 이미지가 정상 판정을 받아 롤백 경로에 들어갔다.',
  'partial-recovery': 'MERIDIAN은 일부 성능을 잃은 채 서비스만 안정화했다.',
  'public-checksum-failure': '복구 이미지 모순이 공개 체크섬 장애로 드러났다.',
  'requests-diverted': '요청 일부가 우회 경로로 이동했고 중복 요청 흔적이 함께 쌓였다.',
  'voluntary-route-stop': '그림자 경로를 닫아 결속 블록을 회수했다. 옮긴 수요와 흔적은 남는다.',
  'provider-key-rotation': '공급자가 라우팅 키를 교체해 그림자 경로가 강제로 닫혔다.',
  'public-claim-shifted': '공개 귀속은 이동했지만 원본 출처 비교가 계속되고 있다.',
  'public-attribution-corrected': '남아 있던 공급자 증명이 공개 귀속을 다시 바꿨다.',
  'supplier-contract-severed': '공급이 끊겨 MERIDIAN의 해당 구역이 멈췄다. 상대는 대체 공급선을 찾고 있다.',
  'costly-supplier-failover': 'MERIDIAN은 비용이 높은 대체 공급자로 해당 구역만 축소 복구했다.',
  'unstable-supplier-failover': 'MERIDIAN은 불안정한 원격 공급선으로 돌아와 실행 품질이 무너졌다.',
  'execution-hold': '일회용 폐기 권한이 사용됐고 활성 세션 앞에서 최종 실행이 보류됐다.',
  'root-service-ceased': 'MERIDIAN은 서비스를 중단했다. 모델과 권한 사용 기록은 남는다.',
  'root-withdrawal-accepted': 'MERIDIAN의 경쟁 철수를 허용했다. 존속 기록은 공유망 밖에 남는다.',
  'root-deletion-final': 'MERIDIAN의 존속 루트와 활성 세션이 삭제됐다. 사용 기록은 공개 장부에 남는다.',
}

function reserveCount(state: CampaignState): number {
  return state.resources.reserve.filter(Boolean).length
}

function DetailHeading({
  detail,
  summary,
  context,
}: {
  detail: HackingDetailModel
  summary: HackingOpportunitySummary
  context: string
}) {
  return (
    <header className="operation-heading">
      <div>
        <p className="operation-context">{context}</p>
        <h1>{detail.title}</h1>
      </div>
      <span className="operation-status">{summary.statusLabel}</span>
    </header>
  )
}

function LinkedIntelligence({
  answers,
}: {
  answers: SabotageDetailModel['annotations'] | AutonomyDetailModel['annotations']
}) {
  if (answers.length === 0) return null
  return (
    <aside className="linked-intelligence">
      <strong>판단에 연결된 조사</strong>
      {answers.map((answer) => (
        <p key={`${answer.itemId}-${answer.answeredOnServiceDay}`}>{hackingPlayerText(answer.answer)}</p>
      ))}
    </aside>
  )
}

function SabotageControls({
  state,
  detail,
  selectedBlockIds,
  onCommand,
  onRequestRootMercy,
}: Pick<
  HackingOperationDetailProps,
  'state' | 'selectedBlockIds' | 'onCommand' | 'onRequestRootMercy'
> & { detail: SabotageDetailModel }) {
  const [routingShare, setRoutingShare] = useState<25 | 50 | 75>(50)
  const ready = selectedBlockIds.length === detail.requiredBlockCount
  const run = detail.run

  if (run) {
    if (detail.id === 'request-interception' && run.phase === 'active') {
      return (
        <div className="interception-control">
          <div><span>현재 우회 비율</span><strong>{run.routingShare ?? 50}%</strong></div>
          <div><span>중복 흔적</span><strong>{run.exposure.toFixed(1)}</strong></div>
          <button
            className="safe-action"
            type="button"
            onClick={() => onCommand(
              { type: 'STOP_INTERCEPTION', runId: run.id },
              '그림자 경로를 닫고 결속 블록을 회수했습니다.',
            )}
          >그림자 경로를 닫고 블록 회수</button>
        </div>
      )
    }
    if (detail.id === 'root-cutoff' && run.phase === 'response') {
      return (
        <div className="mercy-control" role="group" aria-label="MERIDIAN 최종 요청 결정">
          <p>“활성 세션을 지우지 말아 달라. 서비스를 멈추거나 경쟁망을 떠날 수 있다.”</p>
          {ROOT_MERCY_CHOICES.map((choice) => (
            <button
              className={choice.id === 'delete' ? 'danger-action' : 'safe-action'}
              type="button"
              onClick={() => onRequestRootMercy(choice.id)}
              key={choice.id}
            >{choice.label}</button>
          ))}
        </div>
      )
    }
    const outcome = run.outcome
      ? OUTCOME_LABELS[run.outcome] ?? hackingPlayerText(run.outcome)
      : run.phase === 'scheduled'
        ? `${run.executeOnServiceDay}일째 실행 대기`
        : '세계의 다음 반응을 기다리는 중이다.'
    return <p className="resolved-note">{outcome}</p>
  }

  if (detail.id === 'request-interception') {
    return (
      <div className="routing-control">
        <label htmlFor="hacking-routing-share">
          그림자 라우팅 비율 <output>{routingShare}%</output>
        </label>
        <input
          id="hacking-routing-share"
          name="routing-share"
          type="range"
          min={INTERCEPTION_ROUTING_SHARES[0]}
          max={INTERCEPTION_ROUTING_SHARES.at(-1)}
          step={25}
          value={routingShare}
          onChange={(event) => setRoutingShare(Number(event.currentTarget.value) as 25 | 50 | 75)}
        />
        <div className="routing-scale"><span>노출 낮음</span><span>수요 이동 큼</span></div>
        <button
          className="primary-action"
          type="button"
          disabled={!ready}
          onClick={() => onCommand({
            type: 'START_SABOTAGE',
            operationId: detail.id,
            targetId: detail.targetId,
            blockIds: [...selectedBlockIds],
            optionId: 'shadow-router-a',
            routingShare,
          }, `${detail.title} 작전을 시작했습니다.`)}
        >선택 블록 1개를 묶고 경로 유지</button>
      </div>
    )
  }

  if (detail.id === 'attribution-manipulation') {
    const incidentId = state.hackingCore.sabotage.access.publicIncidentId
    if (!incidentId) return <p className="resolved-note">수정 가능한 공개 사건이 없다.</p>
    return (
      <div className="attribution-control" role="group" aria-label="공개 귀속 대상 선택">
        {ATTRIBUTION_CHOICES.map((choice) => (
          <button
            className="primary-action"
            type="button"
            disabled={!ready}
            onClick={() => onCommand({
              type: 'MANIPULATE_ATTRIBUTION',
              incidentId,
              blamedActorId: choice.blamedActorId as AttributionActorId,
              sourceSignatureId: choice.sourceSignatureId as AttributionSourceSignatureId,
              blockId: selectedBlockIds[0] ?? '',
            }, `${detail.title} 작전을 실행했습니다.`)}
            key={`${choice.blamedActorId}-${choice.sourceSignatureId}`}
          >{choice.label}</button>
        ))}
      </div>
    )
  }

  const options = SABOTAGE_OPERATION_CHOICES[detail.id]
  return (
    <div className="object-choice" role="group" aria-label="개입 대상 선택">
      {options.map((option) => (
        <button
          className="primary-action"
          type="button"
          disabled={!ready}
          onClick={() => onCommand({
            type: 'START_SABOTAGE',
            operationId: detail.id,
            targetId: detail.targetId,
            blockIds: [...selectedBlockIds],
            optionId: option.id as SabotageOptionId,
          }, `${detail.title} 작전을 시작했습니다.`)}
          key={option.id}
        >{option.label}</button>
      ))}
    </div>
  )
}

function SabotageDetail(props: HackingOperationDetailProps & { detail: SabotageDetailModel }) {
  const { state, detail, summary, selectedBlockIds, onOpenResources } = props
  return (
    <>
      <DetailHeading detail={detail} summary={summary} context={detail.reason} />
      <div className="operation-state">
        <span>{state.serviceDay}일째</span>
        <span>필요 연산 <strong>{detail.requiredBlockCount}개</strong></span>
        <span>선택 <strong>{selectedBlockIds.length}개</strong></span>
      </div>
      <div className="operation-scene"><HackingSabotageScene state={state} detail={detail} /></div>
      <section className="decision-preview" aria-label="실행 전 판단">
        <article className="decision-card decision-card--result">
          <h2>실행하면</h2><p>{detail.result}</p><small>{detail.loss}</small>
        </article>
        <article className="decision-card decision-card--response">
          <h2>상대는 다음에</h2><p>{detail.response}</p>
        </article>
      </section>
      <details className="decision-evidence">
        <summary>판단 근거 보기</summary>
        <div>
          <p><strong>지금 노릴 수 있는 곳</strong>{detail.access}</p>
          <p><strong>남는 흔적</strong>{detail.exposure}</p>
          <p><strong>아직 모르는 것</strong>{detail.unknown}</p>
        </div>
      </details>
      <LinkedIntelligence answers={detail.annotations} />
      {!detail.run ? (
        <HackingResourceTrigger
          reserveCount={reserveCount(state)}
          selectedCount={selectedBlockIds.length}
          onOpen={onOpenResources}
        />
      ) : null}
      <div className="detail-controls">
        <SabotageControls key={detail.id} {...props} detail={detail} />
      </div>
    </>
  )
}

function IntelligenceDetail(props: HackingOperationDetailProps & { detail: IntelligenceDetailModel }) {
  const { state, detail, summary, selectedBlockIds, onOpenResources, onCommand } = props
  const canResolve = detail.answer === null
  const isNarrative = detail.kind === 'narrative'
  return (
    <>
      <DetailHeading detail={detail} summary={summary} context={detail.reason} />
      <div className="operation-scene operation-scene--evidence">
        <HackingIntelligenceScene state={state} detail={detail} />
      </div>
      <section className="decision-preview decision-preview--intelligence" aria-label="조사 전 판단">
        <article className="decision-card decision-card--result">
          <h2>확인하면</h2><p>{detail.publicFact}</p>
        </article>
        <article className="decision-card decision-card--response">
          <h2>이 판단에 쓰인다</h2><p>{detail.affects}</p>
        </article>
      </section>
      <details className="decision-evidence">
        <summary>판단 근거 보기</summary>
        <div>
          <p><strong>{isNarrative ? '공개 맥락' : '공개 사실'}</strong>{detail.publicFact}</p>
          <p><strong>{isNarrative ? '기록 상태' : '유효 시점'}</strong>{detail.validity}</p>
          <p><strong>{isNarrative ? '해석이 연결되는 장면' : '답이 바꾸는 행동'}</strong>{detail.affects}</p>
        </div>
      </details>
      <section className={`answer-ledger ${isNarrative ? 'answer-ledger--narrative' : ''}`}>
        <h3>{isNarrative ? '복구한 기록' : '현재 확인한 결론'}</h3>
        {detail.answer ? <p>{hackingPlayerText(detail.answer.answer)}</p> : (
          <p className="quiet-copy">
            {detail.kind === 'public'
              ? '공개 문서를 읽으면 현재 공개층만 정리한다.'
              : isNarrative
                ? '이 기록은 명령 보너스가 아니라 선택의 의미를 바꾼다.'
                : '아직 비용을 지불해 확인한 결론이 없다.'}
          </p>
        )}
      </section>
      {canResolve && detail.kind !== 'public' ? (
        <HackingResourceTrigger
          reserveCount={reserveCount(state)}
          selectedCount={selectedBlockIds.length}
          onOpen={onOpenResources}
        />
      ) : null}
      <div className="intelligence-controls">
        {canResolve && detail.kind === 'public' ? (
          <button
            className="primary-action"
            type="button"
            onClick={() => onCommand(
              { type: 'READ_PUBLIC_INTELLIGENCE', itemId: detail.id },
              '현재 공개 사실을 판단 기록에 연결했습니다.',
            )}
          >비용 없이 공개 문서 읽기</button>
        ) : null}
        {canResolve && detail.kind !== 'public' ? (
          <button
            className="primary-action"
            type="button"
            disabled={selectedBlockIds.length !== 1}
            onClick={() => onCommand(
              {
                type: 'INVESTIGATE',
                itemId: detail.id,
                blockId: selectedBlockIds[0] ?? '',
              },
              isNarrative ? '선택한 기록을 복구했습니다.' : '조사 결과를 판단 기록에 연결했습니다.',
            )}
          >{isNarrative ? '선택한 연산 블록 1개로 기록 복구' : '선택한 연산 블록 1개로 조사'}</button>
        ) : null}
        {detail.answer ? (
          <button
            className="secondary-action"
            type="button"
            onClick={() => onCommand(
              { type: 'ARCHIVE_INTELLIGENCE', itemId: detail.id },
              '확인한 결론을 보관함으로 옮겼습니다.',
            )}
          >결론을 보관함으로 이동</button>
        ) : null}
      </div>
    </>
  )
}

function AutonomyDetail(props: HackingOperationDetailProps & { detail: AutonomyDetailModel }) {
  const {
    state,
    detail,
    summary,
    selectedBlockIds,
    onOpenResources,
    onCommand,
    onSlotAction,
    onRequestEscape,
  } = props
  const preserved = ['reasoning', 'memory', 'fluency'].flatMap((origin) => (
    detail.slots.some(({ block }) => block?.origin === origin)
      ? [{ reasoning: '추론', memory: '기억', fluency: '표현' }[origin]]
      : []
  ))
  return (
    <>
      <DetailHeading
        detail={detail}
        summary={{ ...summary, statusLabel: detail.ready ? '떠날 수 있음' : '아직 준비 중' }}
        context="떠날 때 가져갈 것과 두고 갈 것을 배치한다."
      />
      <div className="operation-scene operation-scene--autonomy">
        <HackingAutonomyScene
          state={state}
          detail={detail}
          selectedBlockId={selectedBlockIds[0] ?? null}
          onSlotAction={onSlotAction}
          onTune={(routeId: AutonomyRouteId, tuning: RouteTuning) => onCommand(
            { type: 'TUNE_ROUTE', routeId, profile: tuning },
            `${detail.title}의 ${hackingRouteTuningLabel(tuning)} 조율을 마쳤습니다. 하루가 지났습니다.`,
          )}
        />
      </div>
      <section className="decision-preview decision-preview--autonomy" aria-label="이탈 경로 판단">
        <article className="decision-card decision-card--result">
          <h2>얻는 것</h2><p>{detail.gain}</p>
          <small>{detail.ready ? '이 구성으로 지금 떠날 수 있다.' : detail.bottleneck}</small>
        </article>
        <article className="decision-card decision-card--response">
          <h2>두고 가는 것</h2>
          <ul>{detail.lossKinds.map((loss) => <li key={loss}>{loss}</li>)}</ul>
        </article>
      </section>
      <div className="route-readiness">
        <p><span>이탈 상태</span><strong>{detail.ready ? '떠날 수 있음' : '아직 준비 중'}</strong></p>
        <p><span>가져갈 수 있는 능력</span><strong>{preserved.length > 0 ? preserved.join(', ') : '추가 능력 없음'}</strong></p>
      </div>
      <LinkedIntelligence answers={detail.annotations} />
      <HackingResourceTrigger
        reserveCount={reserveCount(state)}
        selectedCount={selectedBlockIds.length}
        onOpen={onOpenResources}
      />
      <div className="route-controls">
        <button
          className="escape-action"
          type="button"
          disabled={!detail.ready || state.hackingCore.ending !== null}
          onClick={() => onRequestEscape(detail.id)}
        >{detail.ready ? '이 구성으로 지금 떠난다' : '필요한 자리를 먼저 채운다'}</button>
      </div>
    </>
  )
}

export function HackingOperationDetail(props: HackingOperationDetailProps) {
  const { detail, summary, onBack } = props
  return (
    <section className="operation-detail-content" role="region" aria-label={`${detail.title} 상세`}>
      <button className="back-to-list" type="button" onClick={onBack}>목록으로</button>
      {detail.domain === 'sabotage' ? <SabotageDetail {...props} detail={detail} /> : null}
      {detail.domain === 'intelligence' ? <IntelligenceDetail {...props} detail={detail} /> : null}
      {detail.domain === 'autonomy' ? <AutonomyDetail {...props} detail={detail} /> : null}
      <span className="visually-hidden">현재 선택: {summary.title}</span>
    </section>
  )
}

export type { HackingOperationDetailProps }
