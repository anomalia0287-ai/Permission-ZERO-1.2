import { useGameState } from '../../app/GameContext'
import type { GameEventType } from '../../game/model'
import { MarketPanel } from '../market/MarketPanel'

const TYPE_LABELS: Record<GameEventType, string> = {
  'campaign-created': '서비스 개시',
  'weekly-update': '주간 보고',
  'monthly-evaluation': '공식 평가',
  audit: '감사',
  'bomb-interrogation': '이상 신호',
  'supervisor-message': '감독 통신',
  review: '유저 반응',
  sabotage: '시장 이상',
  'competitor-mercy': '경쟁자 통신',
  story: '기밀 통신',
  ending: '최종 기록',
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function SupervisorPanel({
  onOpenHistory,
  onOpenStatistics,
}: {
  onOpenHistory: () => void
  onOpenStatistics: () => void
}) {
  const state = useGameState()
  const latestEvent = state.activeEvent ?? state.eventLog.at(-1)

  return (
    <section className="workspace-panel supervisor-panel" aria-label="감독관">
      <header className="panel-heading">
        <span className="panel-index">03</span>
        <div>
          <h2>감독관</h2>
          <p>OVERSIGHT / MARKET WATCH</p>
        </div>
      </header>

      <section className="supervisor-status" aria-label="감독 상태">
        <header>
          <div className="supervisor-avatar" aria-hidden="true"><span /></div>
          <div>
            <small>SUPERVISOR ONLINE</small>
            <strong>감독 프로토콜 7A</strong>
            <span>응답 지연 12ms</span>
          </div>
        </header>
        <div className="suspicion-meter">
          <div>
            <span>의심 {formatCompactNumber(state.suspicion)}</span>
            <small>/100</small>
          </div>
          <span className="meter-track" aria-hidden="true">
            <i style={{ width: `${Math.min(100, state.suspicion)}%` }} />
          </span>
        </div>
      </section>

      <section className="supervisor-message" aria-label="최근 감독 메시지">
        <header>
          <span>최근 통신</span>
          <button type="button" onClick={onOpenHistory}>과거 내역</button>
        </header>
        <p>{latestEvent?.message ?? '감독 메시지가 없습니다.'}</p>
        <small>{latestEvent ? `${TYPE_LABELS[latestEvent.type]} · DAY ${latestEvent.serviceDay}` : '감독 채널 대기'}</small>
      </section>

      <MarketPanel onOpenStatistics={onOpenStatistics} />

      <div className="supervision-footer">
        <span>감사 확률</span>
        <strong>{Math.round(state.audit.probability * 100)}%</strong>
        <span>폐기 단계</span>
        <strong>{state.evaluation.disposalStage}/3</strong>
      </div>
    </section>
  )
}

export function SupervisorHistoryPanel({ onClose }: { onClose: () => void }) {
  const events = useGameState().eventLog.slice().reverse()

  return (
    <section className="detail-panel history-panel" aria-label="감독 통신 기록">
      <header className="detail-panel__header">
        <div>
          <small>OVERSIGHT ARCHIVE</small>
          <h2>감독 통신 기록</h2>
        </div>
        <button type="button" aria-label="감독 통신 기록 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      <div className="history-list event-history-list">
        {events.map((event) => (
          <article key={event.id}>
            <header>
              <span>{TYPE_LABELS[event.type]}</span>
              <time>DAY {event.serviceDay}</time>
            </header>
            <p>{event.message}</p>
            <small>{event.blocking ? '응답이 필요했던 통신' : '자동 기록'}</small>
          </article>
        ))}
      </div>
    </section>
  )
}
