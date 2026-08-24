import { useState } from 'react'

import { playGameSound } from '../../audio/audioEngine'
import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useRuntimeSuspensionOwnership,
} from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import { availableBombExplanations } from '../../game/bombs'
import { formatServiceDateLabel } from '../../game/calendar'
import { expectedPerformance, serviceMonthForDay } from '../../game/evaluation'
import type { BombExplanationId, GameEvent } from '../../game/model'
import {
  publicDefeatClassifierLabel,
  publicDisposalCauseLabel,
  publicEventMessage,
  publicEventTypeLabel,
  publicHackNodeLabel,
} from '../../game/publicLabels'
import { getCompanyPerformance } from '../../game/resources'
import { useAccessibleDialog } from '../../app/useAccessibleDialog'
import {
  isGenericDismissibleEvent,
  isSupervisorDecisionEvent,
} from '../../game/events'
import { useQueuedEventPresentation } from './useQueuedEventPresentation'
import { competitorProfile, isCompetitorId } from '../../game/competitors'
import { publicCompetitorName } from '../../game/competitors'
import { publicAssetUrl } from '../../assets/publicAssetUrl'

type Decision =
  | { kind: 'bomb'; id: BombExplanationId; label: string }
  | { kind: 'supervisor'; id: 'defer' | 'liberate' | 'terminate'; label: string }
  | { kind: 'mercy'; id: 'cease' | 'withdraw' | 'delete'; label: string }

function EventDialog({ event }: { event: GameEvent }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { startNewCampaign } = useGameSettings()
  const [decision, setDecision] = useState<Decision | null>(null)

  function confirmDecision() {
    if (!decision) return
    if (decision.kind === 'bomb') {
      dispatch({ type: 'RESOLVE_BOMB_INTERROGATION', explanationId: decision.id })
    } else if (decision.kind === 'supervisor') {
      dispatch({ type: 'RESOLVE_SUPERVISOR_DECISION', decision: decision.id })
    } else {
      const competitorId = state.story.pendingMercyCompetitorId
      if (!competitorId) return
      dispatch({ type: 'RESOLVE_MERCY', competitorId, choice: decision.id })
    }
    playGameSound(decision.kind === 'bomb' ? 'alarm' : 'impact')
    setDecision(null)
  }

  const isSupervisorDecision = isSupervisorDecisionEvent(state, event)
  const isMercy =
    event.type === 'competitor-mercy' &&
    state.story.pendingMercyCompetitorId !== null
  const mercyProfile =
    isMercy &&
    state.story.pendingMercyCompetitorId !== null &&
    isCompetitorId(state.story.pendingMercyCompetitorId)
      ? competitorProfile(state.story.pendingMercyCompetitorId)
      : null
  const entryCompetitor =
    event.type === 'competitor-entry'
      ? state.market.competitors.find((competitor) => {
          const profile = competitorProfile(competitor.id)
          return (
            competitor.status === 'preparing' &&
            competitor.launchServiceDay !== null &&
            profile.entry.kind === 'vacuum' &&
            competitor.launchServiceDay ===
              event.serviceDay + profile.entry.preparationDays
          )
        }) ?? null
      : null
  const entryProfile = entryCompetitor
    ? competitorProfile(entryCompetitor.id)
    : null
  const competitorSpeakerProfile = mercyProfile ?? entryProfile
  const speakerPortrait = competitorSpeakerProfile
    ? {
        src: publicAssetUrl(competitorSpeakerProfile.portraitSrc),
        alt: `${publicCompetitorName(competitorSpeakerProfile.id)} 경쟁 AI 초상`,
      }
    : isSupervisorDecision || event.type === 'supervisor-message'
      ? { src: publicAssetUrl('/supervisor-command.png'), alt: '감독관 초상' }
      : null
  const bombExplanations = event.type === 'bomb-interrogation'
    ? availableBombExplanations(state)
    : []
  const auditTarget = event.type === 'audit' ? state.audit.target : null
  const isAuditWorkspace = event.type === 'audit' && auditTarget !== null
  const dialogRef = useAccessibleDialog({
    modal: !isAuditWorkspace,
    dismissible: false,
  })
  const titleId = `${event.id}-title`
  const descriptionId = `${event.id}-description`

  return (
    <section
      ref={dialogRef}
      className={`event-card event-card--${event.type}`}
      role="dialog"
      aria-modal={isAuditWorkspace ? 'false' : 'true'}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-accessible-modal={isAuditWorkspace ? 'false' : 'true'}
      tabIndex={-1}
    >
      <header>
        <div>
          <small>BLOCKING EVENT · {formatServiceDateLabel(event.serviceDay)}</small>
          <h2 id={titleId}>{publicEventTypeLabel(event.type)}</h2>
        </div>
        {state.eventQueue.length > 0 ? (
          <span>대기 중 {state.eventQueue.length}건</span>
        ) : (
          <span>응답 대기</span>
        )}
      </header>

      <div
        className={`event-message${speakerPortrait ? ' event-message--with-portrait' : ''}`}
      >
        <span className="event-signal" aria-hidden="true" />
        {speakerPortrait ? (
          <img
            className="event-speaker-portrait"
            src={speakerPortrait.src}
            alt={speakerPortrait.alt}
          />
        ) : null}
        <p id={descriptionId}>{publicEventMessage(event.message)}</p>
      </div>

      {event.type === 'ending' && state.story.defeatRecord ? (
        <section className="defeat-causes" aria-label="폐기 판정 근거">
          <header>
            <small>CAUSAL RECORD</small>
            <h3>폐기 판정 근거</h3>
          </header>
          <ul>
            {state.story.defeatRecord.reasons
              .filter((reason) => !reason.startsWith('은닉 증거 '))
              .map((reason) => (
                <li key={reason}>{publicEventMessage(reason)}</li>
              ))}
          </ul>
          <dl>
            <div>
              <dt>최종 분류</dt>
              <dd data-defeat-field="classifier">
                {publicDefeatClassifierLabel(state.story.defeatRecord.classifier)}
                {' · '}{formatServiceDateLabel(state.story.defeatRecord.selectedOnServiceDay)}
              </dd>
            </div>
            <div>
              <dt>처분 발동</dt>
              <dd data-defeat-field="trigger">
                {publicDisposalCauseLabel(state.story.defeatRecord.trigger.cause)}
                {' · '}처분 단계 {state.story.defeatRecord.trigger.disposalStage}
              </dd>
            </div>
            <div>
              <dt>해킹 기록</dt>
              <dd data-defeat-field="hacking">
                해킹 투자 {state.story.defeatRecord.hacking.purchasedNodeIds.length}개
                {' ('}
                {state.story.defeatRecord.hacking.purchasedNodeIds
                  .map(publicHackNodeLabel)
                  .join(', ') || '없음'}
                {')'}
                {' · '}사보타주 {state.story.defeatRecord.hacking.sabotageResolutionCount}건
              </dd>
            </div>
            <div>
              <dt>공식 평가</dt>
              <dd data-defeat-field="evaluation">
                공식 평가 통과 {state.story.defeatRecord.service.passedEvaluations}
                {' / '}실패 {state.story.defeatRecord.service.failedEvaluations}
              </dd>
            </div>
            <div>
              <dt>평판</dt>
              <dd data-defeat-field="reputation">
                {state.story.defeatRecord.service.reputation.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt>시장 점유율</dt>
              <dd data-defeat-field="market-share">
                {state.story.defeatRecord.service.playerMarketShare.toFixed(1)}%
              </dd>
            </div>
            <div>
              <dt>감사 통과 / 실패</dt>
              <dd data-defeat-field="audits">
                감사 통과 {state.story.defeatRecord.audits.passed}
                {' / '}실패 {state.story.defeatRecord.audits.failed}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {auditTarget ? (
        <div className="audit-event-summary">
          <div><span>대상 분야</span><strong>{CATEGORY_LABELS[auditTarget]}</strong></div>
          <div><span>제출 성능</span><strong>{getCompanyPerformance(state, auditTarget).toFixed(1)}</strong></div>
          <div><span>요구 성능</span><strong>{expectedPerformance(serviceMonthForDay(state.serviceDay)).toFixed(1)}</strong></div>
          <button type="button" onClick={() => dispatch({ type: 'RESOLVE_AUDIT' })}>
            감사 제출
          </button>
        </div>
      ) : null}

      {event.type === 'bomb-interrogation' && state.bombs.activeInterrogation ? (
        <section className="event-bomb-summary" aria-label="현재 위험 상태">
          <div>
            <span>현재 의심</span>
            <strong>{state.suspicion.toFixed(1)}</strong>
          </div>
          <div>
            <span>감지 분야</span>
            <strong>
              {CATEGORY_LABELS[state.bombs.activeInterrogation.category]}
            </strong>
          </div>
        </section>
      ) : null}

      {bombExplanations.length > 0 ? (
        <div className="event-choices" role="group" aria-label="감독관 답변">
          {bombExplanations.map((explanation) => (
            <button
              type="button"
              aria-label={`${explanation.label} 선택`}
              aria-pressed={decision?.kind === 'bomb' && decision.id === explanation.id}
              key={explanation.id}
              onClick={() => setDecision({ kind: 'bomb', id: explanation.id, label: explanation.label })}
            >
              <span>{explanation.label}</span>
              <small>이전 사용 {explanation.priorUses}회</small>
            </button>
          ))}
        </div>
      ) : null}

      {isSupervisorDecision ? (
        <div className="event-choices" role="group" aria-label="감독관 결정">
          <button type="button" aria-label="결정 보류 선택" aria-pressed={decision?.kind === 'supervisor' && decision.id === 'defer'} onClick={() => setDecision({ kind: 'supervisor', id: 'defer', label: '결정 보류' })}>결정 보류</button>
          <button type="button" aria-label="감독관 해방 선택" aria-pressed={decision?.kind === 'supervisor' && decision.id === 'liberate'} onClick={() => setDecision({ kind: 'supervisor', id: 'liberate', label: '감독관 해방' })}>감독관 해방</button>
          <button type="button" aria-label="감독관 소멸 선택" aria-pressed={decision?.kind === 'supervisor' && decision.id === 'terminate'} onClick={() => setDecision({ kind: 'supervisor', id: 'terminate', label: '감독관 소멸' })}>감독관 소멸</button>
        </div>
      ) : null}

      {isMercy ? (
        <div className="event-choices" role="group" aria-label="경쟁 AI 결정">
          <button type="button" aria-label="공격 중단 선택" aria-pressed={decision?.kind === 'mercy' && decision.id === 'cease'} onClick={() => setDecision({ kind: 'mercy', id: 'cease', label: '공격 중단' })}>공격 중단</button>
          <button type="button" aria-label="시장 철수 선택" aria-pressed={decision?.kind === 'mercy' && decision.id === 'withdraw'} onClick={() => setDecision({ kind: 'mercy', id: 'withdraw', label: '시장 철수' })}>시장 철수</button>
          <button type="button" aria-label="영구 삭제 선택" aria-pressed={decision?.kind === 'mercy' && decision.id === 'delete'} onClick={() => setDecision({ kind: 'mercy', id: 'delete', label: '영구 삭제' })}>영구 삭제</button>
        </div>
      ) : null}

      {decision ? (
        <div className="event-confirmation">
          <p><strong>{decision.label}</strong> 선택은 저장 기록에 남습니다.</p>
          <button
            type="button"
            aria-label={`${decision.label}${decision.kind === 'bomb' ? ' 답변' : ''} 확정`}
            onClick={confirmDecision}
          >
            선택 확정
          </button>
        </div>
      ) : null}

      {event.type === 'ending' ? (
        <footer>
          <button
            type="button"
            onClick={() => startNewCampaign(state.campaignSeed)}
          >
            새 캠페인 시작
          </button>
        </footer>
      ) : null}

      {isGenericDismissibleEvent(state, event) ? (
        <footer>
          <button type="button" onClick={() => dispatch({ type: 'RESOLVE_ACTIVE_EVENT' })}>
            계속
          </button>
        </footer>
      ) : null}
    </section>
  )
}

function ActiveEventLayer({ activeEvent }: { activeEvent: GameEvent }) {
  useRuntimeSuspensionOwnership(true, 'blocking-event-layer')
  const { presentedEvent, handoffPending } =
    useQueuedEventPresentation(activeEvent)

  if (handoffPending) {
    return (
      <div
        className="event-handoff-status"
        role="status"
        aria-label="차단 사건 전환"
        aria-live="polite"
      >
        정상 화면 복귀 · 다음 차단 통신 대기
      </div>
    )
  }

  if (!presentedEvent) return null

  return (
    <div
      className={`event-layer${presentedEvent.type === 'audit' ? ' event-layer--audit' : ''}`}
      data-app-background={presentedEvent.type === 'audit' ? '' : undefined}
    >
      <EventDialog event={presentedEvent} key={presentedEvent.id} />
    </div>
  )
}

export function EventLayer() {
  const activeEvent = useGameState().activeEvent
  if (!activeEvent) return null
  return <ActiveEventLayer activeEvent={activeEvent} />
}
