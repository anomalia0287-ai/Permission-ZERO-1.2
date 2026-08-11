import { useCallback } from 'react'

import { ControlBar } from '../features/control/ControlBar'
import { CATEGORY_LABELS } from '../game/config'
import { COMPANY_CATEGORIES, type ReviewSentiment } from '../game/model'
import { useGameDispatch, useGameState } from './GameContext'
import { GameProvider } from './GameProvider'
import { useGameClock } from './useGameClock'

const SENTIMENT_LABELS: Record<ReviewSentiment, string> = {
  positive: '호평',
  neutral: '일반',
  negative: '불만',
  prompt: '프롬프트',
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

function ResourceCell({
  blockId,
  label,
  index,
  kind,
}: {
  blockId: string | null
  label: string
  index: number
  kind: 'company' | 'reserve'
}) {
  const state = blockId ? '할당됨' : '비어 있음'
  const source = blockId?.startsWith('sandbox') ? '자체 지급' : '회사 할당'

  return (
    <div
      className={`resource-cell ${blockId ? 'resource-cell--filled' : ''} resource-cell--${kind}`}
      role="gridcell"
      aria-label={`${label} ${index + 1}, ${state}`}
      data-block-id={blockId ?? undefined}
    >
      {blockId ? (
        <span className="resource-block" aria-hidden="true">
          <i />
          <small>{source}</small>
        </span>
      ) : (
        <span className="empty-coordinate" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
      )}
    </div>
  )
}

function ResourcePanel() {
  const state = useGameState()

  return (
    <section className="workspace-panel resource-panel" aria-label="회사 제공 성능">
      <PanelHeading
        index="02"
        title="회사 제공 성능"
        detail="ALLOCATED COMPUTE / 3 × 6 PER DOMAIN"
      />

      <div className="company-resource-groups">
        {COMPANY_CATEGORIES.map((category) => {
          const cells = state.resources.company[category]
          const filled = cells.filter(Boolean).length
          const performance = state.evaluation.lastCategoryPerformance[category]

          return (
            <section className="category-bank" key={category}>
              <header>
                <div>
                  <span className="category-code">{category.slice(0, 3).toUpperCase()}</span>
                  <h3>{CATEGORY_LABELS[category]}</h3>
                </div>
                <output aria-label={`${CATEGORY_LABELS[category]} 할당량`}>
                  {filled}<small>/18</small>
                </output>
              </header>
              <div
                className="resource-grid company-grid"
                role="grid"
                aria-label={`${CATEGORY_LABELS[category]} 회사 리소스`}
              >
                {cells.map((blockId, index) => (
                  <ResourceCell
                    key={`${category}-${index}`}
                    blockId={blockId}
                    label={`${CATEGORY_LABELS[category]} 회사 리소스`}
                    index={index}
                    kind="company"
                  />
                ))}
              </div>
              <footer>
                <span>현재 기여도</span>
                <strong>{performance.toFixed(1)}</strong>
              </footer>
            </section>
          )
        })}
      </div>

      <section className="reserve-bank" aria-label="확보 리소스">
        <header>
          <div>
            <span className="reserve-pulse" aria-hidden="true" />
            <div>
              <h3>확보 리소스</h3>
              <p>회사 원장 외부 · 최대 18 블록</p>
            </div>
          </div>
          <output>
            {state.resources.reserve.filter(Boolean).length}<small>/18</small>
          </output>
        </header>
        <div className="resource-grid reserve-grid" role="grid" aria-label="확보 리소스 저장소">
          {state.resources.reserve.map((blockId, index) => (
            <ResourceCell
              key={`reserve-${index}`}
              blockId={blockId}
              label="확보 리소스"
              index={index}
              kind="reserve"
            />
          ))}
        </div>
      </section>

      <div className="performance-strip" aria-label="성능 비교">
        <div>
          <span>회사 기대 성능</span>
          <strong>12.6</strong>
        </div>
        {COMPANY_CATEGORIES.map((category) => (
          <div key={category}>
            <span>{CATEGORY_LABELS[category]}</span>
            <strong>{state.evaluation.lastCategoryPerformance[category].toFixed(1)}</strong>
          </div>
        ))}
      </div>
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
            <span>의심 {Math.round(state.suspicion)}</span>
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
        <ResourcePanel />
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
