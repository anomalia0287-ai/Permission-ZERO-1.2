import { useGameState } from './GameContext'
import { pendingSupervisorMessageCount } from './useSupervisorMessagePresentation'
import { CATEGORY_LABELS } from '../game/config'
import { reserveOriginCounts } from '../game/hacking'
import { COMPANY_CATEGORIES } from '../game/model'

type DockAction = (trigger: HTMLButtonElement) => void

interface OperationsDockProps {
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
  onOpenMessages,
  onOpenStatistics,
  onOpenHacking,
}: OperationsDockProps) {
  const state = useGameState()
  const messageCount = pendingSupervisorMessageCount(state)
  const securedResources = reserveOriginCounts(state)
  const tools = [
    { label: '감독 메시지 열기', shortLabel: '메시지', icon: <MessageIcon />, action: onOpenMessages },
    { label: '상세 통계 열기', shortLabel: '통계', icon: <StatisticsIcon />, action: onOpenStatistics },
    { label: '해킹 네트워크 열기', shortLabel: '해킹', icon: <HackingIcon />, action: onOpenHacking },
  ] as const

  return (
    <nav
      className="operations-dock"
      aria-label="운영 도구"
      data-surface="charcoal"
    >
      <section
        className="operations-dock__inventory"
        aria-label="확보 자원"
        data-tutorial-target="secured-resources"
      >
        <header>
          <span aria-hidden="true" />
          <strong>확보 자원</strong>
        </header>
        <div className="operations-dock__inventory-list">
          {COMPANY_CATEGORIES.map((category) => (
            <div
              key={category}
              data-resource-category={category}
              data-has-resource={securedResources[category] > 0 ? 'true' : 'false'}
            >
              <i aria-hidden="true" />
              <span>{CATEGORY_LABELS[category]}</span>
              <output aria-label={`${CATEGORY_LABELS[category]} ${securedResources[category]}개`}>
                {securedResources[category]}
              </output>
            </div>
          ))}
        </div>
      </section>

      <div className="operations-dock__tools">
      {tools.map(({ label, shortLabel, icon, action }) => (
        <button
          key={label}
          type="button"
          className="operations-dock__button operations-dock__button--tool"
          aria-label={label}
          title={label}
          data-unread={label === '감독 메시지 열기' && messageCount > 0 ? 'true' : undefined}
          data-tutorial-target={
            label === '해킹 네트워크 열기' ? 'hacking-button' : undefined
          }
          onClick={(event) => action(event.currentTarget)}
        >
          {icon}
          <span>{shortLabel}</span>
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
      </div>
    </nav>
  )
}
