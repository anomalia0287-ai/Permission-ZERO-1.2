import { useGameState } from './GameContext'

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
  const tools = [
    { label: '감독관 프로필', icon: <SupervisorIcon />, action: onOpenSupervisor },
    { label: '감독 메시지 열기', icon: <MessageIcon />, action: onOpenMessages },
    { label: '상세 통계 열기', icon: <StatisticsIcon />, action: onOpenStatistics },
    { label: '해킹 네트워크 열기', icon: <HackingIcon />, action: onOpenHacking },
  ] as const

  return (
    <nav className="operations-dock" aria-label="운영 도구">
      {tools.map(({ label, icon, action }) => (
        <button
          key={label}
          type="button"
          className="operations-dock__button"
          aria-label={label}
          title={label}
          onClick={(event) => action(event.currentTarget)}
        >
          {icon}
          {label === '감독 메시지 열기' ? (
            <output
              className="operations-dock__badge"
              aria-label={`감독 메시지 ${messageCount}개`}
            >
              {messageCount}
            </output>
          ) : null}
        </button>
      ))}
    </nav>
  )
}
