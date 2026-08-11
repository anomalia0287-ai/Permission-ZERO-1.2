import { useCallback } from 'react'

import { ControlBar } from '../features/control/ControlBar'
import { ResourceBoard } from '../features/resources/ResourceBoard'
import type { ReviewSentiment } from '../game/model'
import { useGameDispatch, useGameState } from './GameContext'
import { GameProvider } from './GameProvider'
import { useGameClock } from './useGameClock'

const SENTIMENT_LABELS: Record<ReviewSentiment, string> = {
  positive: '호평',
  neutral: '일반',
  negative: '불만',
  prompt: '프롬프트',
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function PanelHeading({
  index,
  title,
  detail,
}: {
  index: string
  title: string
  detail: string
}) {
  return (
    <header className="panel-heading">
      <span className="panel-index">{index}</span>
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </header>
  )
}

function ReviewPanel() {
  const reviews = useGameState().reviews.feed.slice(-6).reverse()

  return (
    <section className="workspace-panel review-panel" aria-label="유저 리뷰">
      <PanelHeading index="01" title="유저 리뷰" detail="PUBLIC RESPONSE STREAM" />
      <div className="review-stream" aria-live="polite">
        {reviews.map((review) => (
          <article
            className={`review-entry review-entry--${review.sentiment}`}
            key={review.id}
          >
            <header>
              <strong>{review.authorId}</strong>
              <span>{SENTIMENT_LABELS[review.sentiment]}</span>
              <time>DAY {review.serviceDay}</time>
            </header>
            <p>{review.text}</p>
          </article>
        ))}
      </div>
      <button className="subsystem-entry" type="button">
        <span>
          <small>비인가 서브시스템</small>
          해킹 네트워크
        </span>
        <span aria-hidden="true">접속 대기 ↗</span>
      </button>
    </section>
  )
}

function SupervisorPanel() {
  const state = useGameState()
  const latestEvent = state.activeEvent ?? state.eventLog.at(-1)

  return (
    <section className="workspace-panel supervisor-panel" aria-label="감독관">
      <PanelHeading index="03" title="감독관" detail="OVERSIGHT / MARKET WATCH" />

      <section className="supervisor-status" aria-label="감독 상태">
        <header>
          <div className="supervisor-avatar" aria-hidden="true">
            <span />
          </div>
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
          <button type="button">과거 내역</button>
        </header>
        <p>{latestEvent?.message ?? '감독 메시지가 없습니다.'}</p>
        <small>감독 채널은 모든 성능 변화를 기록합니다.</small>
      </section>

      <section className="market-watch" aria-label="경쟁 AI 현황">
        <header>
          <div>
            <span>시장 점유</span>
            <strong>당신 {state.market.playerShare.toFixed(1)}%</strong>
          </div>
          <small>WEEKLY NORMALIZED</small>
        </header>
        <div className="market-share-bar" aria-hidden="true">
          <i style={{ width: `${state.market.playerShare}%` }} />
        </div>
        <ul>
          {state.market.competitors.map((competitor) => (
            <li key={competitor.id}>
              <span>
                <i aria-hidden="true" />
                <strong>{competitor.name}</strong>
              </span>
              <span>{competitor.marketShare.toFixed(1)}%</span>
              <small>{competitor.status === 'active' ? '서비스 중' : '준비 중'}</small>
            </li>
          ))}
        </ul>
      </section>

      <div className="supervision-footer">
        <span>감사 확률</span>
        <strong>{Math.round(state.audit.probability * 100)}%</strong>
        <span>폐기 단계</span>
        <strong>{state.evaluation.disposalStage}/3</strong>
      </div>
    </section>
  )
}

function GameWorkspace() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const advanceDay = useCallback(() => dispatch({ type: 'ADVANCE_DAY' }), [dispatch])
  const dayProgress = useGameClock({ speed: state.clock.speed, onDay: advanceDay })

  return (
    <main className="game-shell" aria-label="PERMISSION ZERO">
      <ControlBar />
      <div className="day-progress" aria-hidden="true">
        <i style={{ width: `${dayProgress * 100}%` }} />
      </div>
      <div className="workspace-grid">
        <ReviewPanel />
        <ResourceBoard />
        <SupervisorPanel />
      </div>
    </main>
  )
}

export function App() {
  return (
    <GameProvider>
      <GameWorkspace />
    </GameProvider>
  )
}
