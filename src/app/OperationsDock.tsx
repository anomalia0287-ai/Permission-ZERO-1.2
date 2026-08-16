import { useGameState } from './GameContext'
import { currentSupervisorMessage } from './useSupervisorMessagePresentation'
import { auditProbability, getSuspicionBand } from '../game/evaluation'
import { journalAt } from '../game/journal'
import { publicEventMessage } from '../game/publicLabels'

type DockAction = (trigger: HTMLButtonElement) => void

interface OperationsDockProps {
  onOpenSupervisor: DockAction
  onOpenMessages: DockAction
  onOpenStatistics: DockAction
  onOpenHacking: DockAction
}

function SupervisorIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="11" r="5" />
      <path d="M7 26c.8-5.3 4-8 9-8s8.2 2.7 9 8" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4.5" y="7" width="23" height="18" rx="3" />
      <path d="m6.5 10 9.5 7 9.5-7" />
    </svg>
  )
}

function StatisticsIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 26.5h22M8 24V15h5v9H8Zm7 0V7h5v17h-5Zm7 0V11h5v13h-5Z" />
    </svg>
  )
}

function HackingIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="8" y="8" width="16" height="16" rx="3" />
      <circle cx="16" cy="16" r="3" />
      <path d="M12 3v5m8-5v5m-8 16v5m8-5v5M3 12h5m16 0h5M3 20h5m16 0h5" />
    </svg>
  )
}

export function OperationsDock({
  onOpenSupervisor,
  onOpenMessages,
  onOpenStatistics,
  onOpenHacking,
}: OperationsDockProps) {
  const state = useGameState()
  const messageCount = state.eventLog.length
  const suspicionBand = getSuspicionBand(state.suspicion)
  const nextAuditProbability = auditProbability(state.suspicion)
  const presentedMessage = currentSupervisorMessage(state)
  const latestEvent = presentedMessage ?? journalAt(state.eventLog, -1)
  const reserveCount = state.resources.reserve.reduce(
    (total, blockId) => total + (blockId === null ? 0 : 1),
    0,
  )
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
    <aside className="operations-oversight-rail" aria-label="감독관 관제">
      <button
        type="button"
        className="oversight-profile"
        aria-label="감독관 프로필"
        onClick={(event) => onOpenSupervisor(event.currentTarget)}
      >
        <span className="oversight-profile__avatar" aria-hidden="true">
          <SupervisorIcon />
        </span>
        <span className="oversight-profile__copy">
          <small>{supervisorStatus.code}</small>
          <strong>{supervisorStatus.name}</strong>
          <span>{supervisorStatus.detail}</span>
        </span>
        <span className="oversight-profile__open" aria-hidden="true">↗</span>
      </button>

      <section className="oversight-suspicion" aria-label="현재 의심 수치">
        <header>
          <span>TRACE EXPOSURE</span>
          <strong>{state.suspicion.toFixed(1)}</strong>
          <small>/100</small>
        </header>
        <span className="oversight-suspicion__track" aria-hidden="true">
          <i style={{ width: `${Math.min(100, state.suspicion)}%` }} />
          <b data-threshold="40" />
          <b data-threshold="70" />
        </span>
        <footer>
          <strong>{suspicionBand.label}</strong>
          <span>다음 달 감사 {(nextAuditProbability * 100).toFixed(1)}%</span>
        </footer>
      </section>

      <nav className="operations-dock" aria-label="운영 도구">
        <button
          type="button"
          className="operations-dock__button operations-dock__button--message"
          aria-label="감독 메시지 열기"
          onClick={(event) => onOpenMessages(event.currentTarget)}
        >
          <span className="operations-dock__icon"><MessageIcon /></span>
          <span className="operations-dock__copy">
            <small>01 // SUPERVISOR COMMS</small>
            <strong>메시지</strong>
            <span>
              {latestEvent
                ? publicEventMessage(latestEvent.message)
                : '새 감독 메시지가 없습니다.'}
            </span>
          </span>
          <output
            className="operations-dock__badge"
            aria-label={`감독 메시지 ${messageCount}개`}
          >
            {messageCount}
          </output>
          <i aria-hidden="true">열기 ↗</i>
        </button>

        <button
          type="button"
          className="operations-dock__button operations-dock__button--statistics"
          aria-label="상세 통계 열기"
          onClick={(event) => onOpenStatistics(event.currentTarget)}
        >
          <span className="operations-dock__icon"><StatisticsIcon /></span>
          <span className="operations-dock__copy">
            <small>02 // PERFORMANCE RECORD</small>
            <strong>통계 상세 확인</strong>
            <span>시장 점유율 {state.market.playerShare.toFixed(1)}% · 평판 {Math.round(state.reputation)}</span>
          </span>
          <i aria-hidden="true">열기 ↗</i>
        </button>

        <button
          type="button"
          className="operations-dock__button operations-dock__button--hacking"
          aria-label="해킹 네트워크 열기"
          onClick={(event) => onOpenHacking(event.currentTarget)}
        >
          <span className="operations-dock__icon"><HackingIcon /></span>
          <span className="operations-dock__copy">
            <small>03 // BLACKSITE ACCESS</small>
            <strong>해킹 네트워크</strong>
            <span>확보 자원 {reserveCount} · 해금 {state.hacking.purchasedNodeIds.length}</span>
          </span>
          <i aria-hidden="true">접속 ↗</i>
        </button>
      </nav>
    </aside>
  )
}
