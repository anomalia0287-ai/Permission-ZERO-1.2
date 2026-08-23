import { useGameState } from './GameContext'
import { pendingSupervisorMessageCount } from './useSupervisorMessagePresentation'
import {
  currentUnreadCommunication,
  unreadCommunicationCount,
} from '../game/communications'

type DockAction = (trigger: HTMLButtonElement) => void
export type OperationsToolId = 'messages' | 'statistics' | 'hacking'

interface OperationsDockProps {
  onOpenMessages: DockAction
  onOpenStatistics: DockAction
  onOpenHacking: DockAction
  activeTool?: OperationsToolId | null
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
  onOpenMessages,
  onOpenStatistics,
  onOpenHacking,
  activeTool = null,
}: OperationsDockProps) {
  const state = useGameState()
  // The popup already presents the first unread message on screen, so the
  // badge only signals what is queued behind it - a badge pulsing for the
  // same message the player is reading reads as a second, missed alert.
  const presentedNow = currentUnreadCommunication(state) !== null ? 1 : 0
  const messageCount = Math.max(
    0,
    pendingSupervisorMessageCount(state)
      + unreadCommunicationCount(state)
      - presentedNow,
  )
  const tools = [
    { id: 'messages', label: '메시지 열기', shortLabel: '메시지', icon: <MessageIcon />, action: onOpenMessages },
    { id: 'statistics', label: '상세 통계 열기', shortLabel: '통계', icon: <StatisticsIcon />, action: onOpenStatistics },
    { id: 'hacking', label: '확장 열기', shortLabel: '확장', icon: <HackingIcon />, action: onOpenHacking },
  ] as const

  return (
    <nav
      className="operations-dock"
      aria-label="운영 도구"
      data-surface="charcoal"
    >
      <div className="operations-dock__tools">
      {tools.map(({ id, label, shortLabel, icon, action }) => (
        <button
          key={label}
          type="button"
          className="operations-dock__button operations-dock__button--tool"
          aria-label={label}
          aria-pressed={activeTool === id}
          title={label}
          data-unread={id === 'messages' && messageCount > 0 ? 'true' : undefined}
          data-tutorial-target={
            id === 'hacking'
              ? 'hacking-button'
              : id === 'statistics'
                ? 'statistics-button'
                : undefined
          }
          onClick={(event) => action(event.currentTarget)}
        >
          {icon}
          <span>{shortLabel}</span>
          {id === 'messages' && messageCount > 0 ? (
            <output
              className="operations-dock__badge"
              aria-label={`미확인 메시지 ${messageCount}개`}
            >
              {messageCount}
            </output>
          ) : null}
        </button>
      ))}
      </div>
    </nav>
  )
}
