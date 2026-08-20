import { formatServiceDate } from '../../game/calendar'
import { getSuspicionStage } from '../../game/evaluation'
import { useGameState } from '../../app/GameContext'
import { getGameDirective } from '../../app/gameDirective'

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="m19 13.2 1.5 1.1-1.8 3.1-1.7-.7a7.8 7.8 0 0 1-2.1 1.2l-.2 1.9h-3.6l-.2-1.9a7.8 7.8 0 0 1-2.1-1.2l-1.7.7-1.8-3.1 1.5-1.1a7.4 7.4 0 0 1 0-2.4L5.3 9.7l1.8-3.1 1.7.7a7.8 7.8 0 0 1 2.1-1.2l.2-1.9h3.6l.2 1.9A7.8 7.8 0 0 1 17 7.3l1.7-.7 1.8 3.1-1.5 1.1a7.4 7.4 0 0 1 0 2.4Z" />
    </svg>
  )
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 4V5L9 9H5Z" />
      {muted ? <path d="m17 9 4 6m0-6-4 6" /> : <path d="M17 9.2a4 4 0 0 1 0 5.6m2.4-8a7.4 7.4 0 0 1 0 10.4" />}
    </svg>
  )
}

function GuideIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5h5.2c1 0 1.8.8 1.8 1.8v13.2c0-1-.8-1.8-1.8-1.8H5V4.5Zm14 0h-5.2c-1 0-1.8.8-1.8 1.8v13.2c0-1 .8-1.8 1.8-1.8H19V4.5Z" />
    </svg>
  )
}

export function ControlBar({
  muted = false,
  onOpenSettings,
  onToggleSound,
  onOpenGuide,
}: {
  muted?: boolean
  onOpenSettings?: (trigger: HTMLButtonElement) => void
  onToggleSound?: () => void
  onOpenGuide?: (trigger: HTMLButtonElement) => void
} = {}) {
  const state = useGameState()
  const date = formatServiceDate(state.serviceDay)
  const reputation = Math.max(0, Math.min(100, Math.round(state.reputation)))
  const suspicionStage = getSuspicionStage(state.suspicion)
  const directive = getGameDirective(state)

  return (
    <header className="control-bar">
      <div className="control-identity" role="group" aria-label="서비스 기한">
        <div>
          <span className="micro-label">SERVICE TERM</span>
          <time>
            서비스 {date.year}년 {date.month}개월 {date.day}일
          </time>
        </div>
      </div>

      <div className="reputation-cluster">
        <div
          className="current-directive"
          role="status"
          aria-label="현재 지시"
          data-directive={directive.id}
        >
          <span>{directive.eyebrow}</span>
          <strong>{directive.title}</strong>
          <small>{directive.detail}</small>
          <b>{directive.progress}</b>
        </div>
        <div className="reputation-cluster__label">
          <span>평판</span>
          <strong>{reputation}</strong>
        </div>
        <div
          className="reputation-meter"
          role="meter"
          aria-label={`평판 ${reputation}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={reputation}
        >
          <i style={{ width: `${reputation}%` }} />
        </div>
        <div
          className="suspicion-meter"
          role="meter"
          aria-label={`의심 ${suspicionStage}단계`}
          aria-valuemin={1}
          aria-valuemax={10}
          aria-valuenow={suspicionStage}
        >
          <strong>의심 {suspicionStage}단계</strong>
          <span aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
              <i key={index} data-active={index < suspicionStage ? 'true' : undefined} />
            ))}
          </span>
        </div>
      </div>

      <nav className="utility-controls" aria-label="게임 메뉴">
        <button
          type="button"
          aria-label="설정"
          title="설정"
          onClick={(event) => onOpenSettings?.(event.currentTarget)}
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          data-app-focus-fallback=""
          aria-label={muted ? '소리 켜기' : '소리 끄기'}
          aria-pressed={muted}
          onClick={onToggleSound}
        >
          <SoundIcon muted={muted} />
        </button>
        <button
          type="button"
          aria-label="가이드"
          title="가이드"
          onClick={(event) => onOpenGuide?.(event.currentTarget)}
        >
          <GuideIcon />
        </button>
      </nav>
    </header>
  )
}
