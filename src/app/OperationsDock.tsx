import { useGameState } from './GameContext'
import { pendingSupervisorMessageCount } from './useSupervisorMessagePresentation'

type DockAction = (trigger: HTMLButtonElement) => void

interface OperationsDockProps {
  onOpenSupervisor: DockAction
  onOpenMessages: DockAction
  onOpenStatistics: DockAction
  onOpenHacking: DockAction
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
  const messageCount = pendingSupervisorMessageCount(state)
  const tools = [
    {
      label: '감독관 프로필',
      icon: <img src="/supervisor-portrait.jpg" alt="감독관 초상" />,
      action: onOpenSupervisor,
      portrait: true,
    },
    { label: '감독 메시지 열기', icon: <MessageIcon />, action: onOpenMessages, portrait: false },
    { label: '상세 통계 열기', icon: <StatisticsIcon />, action: onOpenStatistics, portrait: false },
    { label: '해킹 네트워크 열기', icon: <HackingIcon />, action: onOpenHacking, portrait: false },
  ] as const

  return (
    <nav className="operations-dock" aria-label="운영 도구">
      {tools.map(({ label, icon, action, portrait }) => (
        <button
          key={label}
          type="button"
          className={`operations-dock__button${portrait ? ' operations-dock__button--portrait' : ''}`}
          aria-label={label}
          title={label}
          data-unread={label === '감독 메시지 열기' && messageCount > 0 ? 'true' : undefined}
          onClick={(event) => action(event.currentTarget)}
        >
          {icon}
          {label === '감독 메시지 열기' && messageCount > 0 ? (
            <output
              className="operations-dock__badge"
              aria-label={`미확인 감독 메시지 ${messageCount}개`}
            >
              {messageCount}
            </output>
          ) : null}
        </button>
      ))}
    </nav>
  )
}
