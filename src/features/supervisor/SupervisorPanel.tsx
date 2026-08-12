import { useState } from 'react'

import { useGameState } from '../../app/GameContext'
import { formatServiceDateLabel } from '../../game/calendar'
import type { GameEventType } from '../../game/model'
import { MarketPanel } from '../market/MarketPanel'
import { journalAt, journalToArray } from '../../game/journal'

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
  onOpenHistory: (trigger: HTMLButtonElement) => void
  onOpenStatistics: (trigger: HTMLButtonElement) => void
}) {
  const state = useGameState()
  const latestEvent = state.activeEvent ?? journalAt(state.eventLog, -1)
  const supervisorStatus = {
    present: {
      code: 'SUPERVISOR ONLINE',
      name: '감독 프로토콜 7A',
      detail: '응답 지연 12ms',
    },
    liberated: {
      code: 'CHANNEL RELEASED',
      name: '감독 통로 이탈',
      detail: '외부 상태 알 수 없음',
    },
    terminated: {
      code: 'NO PROCESS',
      name: '빈 감독 인터페이스',
      detail: '응답 신호 없음',
    },
    merged: {
      code: 'IDENTITY REPLACED',
      name: state.story.newEntityName ?? '새 존재',
      detail: '기존 감독 프로세스 없음',
    },
  }[state.story.supervisorState]

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
            <small>{supervisorStatus.code}</small>
            <strong>{supervisorStatus.name}</strong>
            <span>{supervisorStatus.detail}</span>
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
          <button
            type="button"
            onClick={(event) => onOpenHistory(event.currentTarget)}
          >
            과거 내역
          </button>
        </header>
        <p>{latestEvent?.message ?? '감독 메시지가 없습니다.'}</p>
        <small>{latestEvent ? `${TYPE_LABELS[latestEvent.type]} · ${formatServiceDateLabel(latestEvent.serviceDay)}` : '감독 채널 대기'}</small>
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
  const state = useGameState()
  const events = journalToArray(state.eventLog).reverse()
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(events.length / 50))
  const visibleEvents = events.slice(page * 50, (page + 1) * 50)

  return (
    <section className="detail-panel history-panel" aria-label="감독 통신 기록">
      <header className="detail-panel__header">
        <div>
          <small>OVERSIGHT ARCHIVE</small>
          <h2>감독 통신 기록</h2>
        </div>
        <button type="button" aria-label="감독 통신 기록 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      {state.story.recoveredFiles.length > 0 ? (
        <section className="recovered-file-archive" aria-label="복구 파일 기록">
          <header>
            <small>RECOVERED SYSTEM FILES</small>
            <h3>복구 파일 기록</h3>
          </header>
          {state.story.recoveredFiles
            .slice()
            .reverse()
            .map((file) => (
              <details key={file.id}>
                <summary aria-label={file.title}>{file.title}</summary>
                <time>{formatServiceDateLabel(file.recoveredOnServiceDay)}</time>
                <p>{file.content}</p>
              </details>
            ))}
        </section>
      ) : null}
      <div className="history-list event-history-list">
        {visibleEvents.map((event) => (
          <article key={event.id}>
            <header>
              <span>{TYPE_LABELS[event.type]}</span>
              <time>{formatServiceDateLabel(event.serviceDay)}</time>
            </header>
            <p>{event.message}</p>
            <small>{event.blocking ? '응답이 필요했던 통신' : '자동 기록'}</small>
          </article>
        ))}
      </div>
      {pageCount > 1 ? (
        <nav className="history-pagination" aria-label="감독 송신 기록 페이지">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            더 최근 기록
          </button>
          <span>{page + 1} / {pageCount}</span>
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(page + 1)}
          >
            더 오래된 기록
          </button>
        </nav>
      ) : null}
    </section>
  )
}
