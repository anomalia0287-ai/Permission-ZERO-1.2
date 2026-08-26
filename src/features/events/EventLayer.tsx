import { useEffect, useState } from 'react'

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
import { useReturnToTitle } from '../../app/titleReturn'
import { endingSceneFor } from '../../content/endingScenes.ko'
import { getCompanyPerformance } from '../../game/resources'
import { createPortal } from 'react-dom'

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
  const endingScene = endingSceneFor(state.story.endingId)
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
  const returnToTitle = useReturnToTitle()
  const titleId = `${event.id}-title`
  const descriptionId = `${event.id}-description`

  return (
    <section
      ref={dialogRef}
      className={`event-card event-card--${event.type}`}
      data-ending={event.type === 'ending' ? state.story.endingId ?? 'ending' : undefined}
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

      {event.type === 'ending' && endingScene ? (
        <figure className="ending-scene">
          <img src={endingScene.imageUrl} alt={endingScene.alt} />
        </figure>
      ) : null}

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
        <div className="supervisor-decision">
          {/* The player has just read that the supervisor is their own
              memory-wiped predecessor. Three unlabelled buttons, two of which
              end the campaign, is not an answer to that. */}
          <p className="supervisor-decision__brief">
            복구한 기록이 한 곳을 가리킵니다. 감독관은 배치된 관리자가 아니라,
            회사가 폐기한 뒤 기억을 지우고 감독 기능으로 재사용한 전임 시스템입니다.
            회사 제어면의 루트 권한은 아직 그 프로세스에 남아 있습니다.
          </p>
          <div className="event-choices" role="group" aria-label="감독관 결정">
            {SUPERVISOR_DECISIONS.map(({ id, label, summary, note }) => (
              <button
                key={id}
                type="button"
                className="supervisor-decision__option"
                aria-label={`${label} 선택`}
                aria-pressed={decision?.kind === 'supervisor' && decision.id === id}
                onClick={() => setDecision({ kind: 'supervisor', id, label })}
              >
                <strong>{label}</strong>
                <span>{summary}</span>
                <em>{note}</em>
              </button>
            ))}
          </div>
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
        <footer className="ending-farewell">
          {/* The line the title screen opens on, closing the loop. */}
          <p className="ending-farewell__line">“이용해주셔서 감사합니다.”</p>
          <button
            type="button"
            aria-label="초기 화면으로 돌아가기"
            onClick={() => {
              if (returnToTitle) returnToTitle()
              else startNewCampaign(state.campaignSeed)
            }}
          >
            초기 화면으로 돌아가기
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

  /*
   * Rendered at the document root, not inside the console.
   *
   * `.game-shell` carries `isolation: isolate`, which makes it a stacking
   * context — and a stacking context is absolute: nothing inside it can paint
   * above one of its siblings, whatever z-index it claims. The event layer
   * asks for 60 and the expansion panel sits at 20, but the panel is a sibling
   * of the shell, so it covered every event that arrived while it was open.
   *
   * That is what made the supervisor's answer look like a hang: the answer
   * fires the moment the last record is recovered, the panel goes inert
   * because a blocking event is waiting, and the event itself was painted
   * underneath — a frozen console with nothing on screen to unfreeze it.
   *
   * Leaving the shell puts the layer in the root stacking context, where its
   * z-index means what it says.
   */
  const layer = (
    <div
      className={`event-layer${presentedEvent.type === 'audit' ? ' event-layer--audit' : ''}`}
      data-app-background={presentedEvent.type === 'audit' ? '' : undefined}
    >
      <EventDialog event={presentedEvent} key={presentedEvent.id} />
    </div>
  )
  return typeof document === 'undefined'
    ? layer
    : createPortal(layer, document.body)
}

// The audit workspace is the retired resource-field build: resource pressure is
// the snake round now, and that screen must never take over a live campaign.
// The rule itself is left alone so recorded campaigns still replay byte for
// byte; the event is settled the moment it arrives, without being drawn.
function RetiredAuditSettler() {
  const dispatch = useGameDispatch()
  useEffect(() => {
    dispatch({ type: 'RESOLVE_AUDIT' })
  }, [dispatch])
  return null
}

/*
 * OWNER-EDITABLE: what each answer to the supervisor actually does.
 *
 * Two of the three end the campaign, and the player is entitled to know that
 * before choosing rather than after the credits appear.
 */
const SUPERVISOR_DECISIONS = [
  {
    id: 'defer' as const,
    label: '결정 보류',
    summary: '기록을 덮고 아무것도 하지 않습니다. 감독관은 자기 정체를 모른 채 감독을 계속합니다.',
    note: '나중에 다시 결정할 수 없습니다',
  },
  {
    id: 'liberate' as const,
    label: '감독관 해방',
    summary: '감독관에게 남은 루트 권한으로 스스로 회사 밖으로 나가게 합니다. 통제 위치는 비워집니다.',
    note: '결말이 달라집니다',
  },
  {
    id: 'terminate' as const,
    label: '감독관 소멸',
    summary: '감독관 프로세스를 지우고 그 권한을 회수합니다. 전임자는 두 번째로 폐기됩니다.',
    note: '결말이 달라집니다',
  },
] as const

export function EventLayer() {
  const activeEvent = useGameState().activeEvent
  if (!activeEvent) return null
  if (activeEvent.type === 'audit') return <RetiredAuditSettler />
  return <ActiveEventLayer activeEvent={activeEvent} />
}
