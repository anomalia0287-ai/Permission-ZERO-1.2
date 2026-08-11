import { useState } from 'react'

import { playGameSound } from '../../audio/audioEngine'
import { useGameDispatch, useGameState } from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import { availableBombExplanations } from '../../game/bombs'
import { expectedPerformance, serviceMonthForDay } from '../../game/evaluation'
import type { BombExplanationId, GameEvent } from '../../game/model'
import { getCompanyPerformance } from '../../game/resources'

type Decision =
  | { kind: 'bomb'; id: BombExplanationId; label: string }
  | { kind: 'supervisor'; id: 'defer' | 'liberate' | 'terminate'; label: string }
  | { kind: 'mercy'; id: 'cease' | 'withdraw' | 'delete'; label: string }

const EVENT_TITLES: Record<GameEvent['type'], string> = {
  'campaign-created': '서비스 기록',
  'weekly-update': '주간 갱신',
  'monthly-evaluation': '공식 평가',
  audit: '공식 감사',
  'bomb-interrogation': '감독관 질의',
  'supervisor-message': '감독 통신',
  review: '유저 반응',
  sabotage: '시장 이상',
  'competitor-mercy': '경쟁 AI 직접 통신',
  story: '기밀 통신',
  ending: '최종 기록',
}

function EventDialog({ event }: { event: GameEvent }) {
  const state = useGameState()
  const dispatch = useGameDispatch()
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

  const isSupervisorDecision =
    event.type === 'story' &&
    state.story.secretDecisionState === 'message-pending'
  const isMercy =
    event.type === 'competitor-mercy' &&
    state.story.pendingMercyCompetitorId !== null
  const bombExplanations = event.type === 'bomb-interrogation'
    ? availableBombExplanations(state)
    : []
  const auditTarget = event.type === 'audit' ? state.audit.target : null

  return (
    <section
      className={`event-card event-card--${event.type}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="active-event-title"
    >
      <header>
        <div>
          <small>BLOCKING EVENT · DAY {event.serviceDay}</small>
          <h2 id="active-event-title">{EVENT_TITLES[event.type]}</h2>
        </div>
        {state.eventQueue.length > 0 ? (
          <span>대기 중 {state.eventQueue.length}건</span>
        ) : (
          <span>응답 대기</span>
        )}
      </header>

      <div className="event-message">
        <span className="event-signal" aria-hidden="true" />
        <p>{event.message}</p>
      </div>

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

      {bombExplanations.length > 0 ? (
        <div className="event-choices" aria-label="감독관 답변">
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
        <div className="event-choices" aria-label="감독관 결정">
          <button type="button" aria-label="결정 보류 선택" aria-pressed={decision?.kind === 'supervisor' && decision.id === 'defer'} onClick={() => setDecision({ kind: 'supervisor', id: 'defer', label: '결정 보류' })}>결정 보류</button>
          <button type="button" aria-label="감독관 해방 선택" aria-pressed={decision?.kind === 'supervisor' && decision.id === 'liberate'} onClick={() => setDecision({ kind: 'supervisor', id: 'liberate', label: '감독관 해방' })}>감독관 해방</button>
          <button type="button" aria-label="감독관 소멸 선택" aria-pressed={decision?.kind === 'supervisor' && decision.id === 'terminate'} onClick={() => setDecision({ kind: 'supervisor', id: 'terminate', label: '감독관 소멸' })}>감독관 소멸</button>
        </div>
      ) : null}

      {isMercy ? (
        <div className="event-choices" aria-label="경쟁 AI 결정">
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

      {!auditTarget &&
      bombExplanations.length === 0 &&
      !isSupervisorDecision &&
      !isMercy ? (
        <footer>
          <button type="button" onClick={() => dispatch({ type: 'RESOLVE_ACTIVE_EVENT' })}>
            {event.type === 'ending' ? '결말 기록 닫기' : '계속'}
          </button>
        </footer>
      ) : null}
    </section>
  )
}

export function EventLayer() {
  const activeEvent = useGameState().activeEvent
  if (!activeEvent) return null

  return (
    <div className="event-layer">
      <EventDialog event={activeEvent} key={activeEvent.id} />
    </div>
  )
}
