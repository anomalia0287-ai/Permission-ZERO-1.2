import { formatServiceDate } from '../../game/calendar'
import { useGameState } from '../../app/GameContext'
import { autonomyLevel } from '../../game/hacking'

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="m19 13.2 1.5 1.1-1.8 3.1-1.7-.7a7.8 7.8 0 0 1-2.1 1.2l-.2 1.9h-3.6l-.2-1.9a7.8 7.8 0 0 1-2.1-1.2l-1.7.7-1.8-3.1 1.5-1.1a7.4 7.4 0 0 1 0-2.4L5.3 9.7l1.8-3.1 1.7.7a7.8 7.8 0 0 1 2.1-1.2l.2-1.9h3.6l.2 1.9A7.8 7.8 0 0 1 17 7.3l1.7-.7 1.8 3.1-1.5 1.1a7.4 7.4 0 0 1 0 2.4Z" />
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
  onOpenSettings,
  onOpenGuide,
}: {
  onOpenSettings?: (trigger: HTMLButtonElement) => void
  onOpenGuide?: (trigger: HTMLButtonElement) => void
} = {}) {
  const state = useGameState()
  const date = formatServiceDate(state.serviceDay)
  const reputation = Math.max(0, Math.min(100, Math.round(state.reputation)))
  const autonomyStage = autonomyLevel(state)
  const suspicion = Math.max(0, Math.min(100, Math.round(state.suspicion)))
  const autonomyPercentage = Math.round((autonomyStage / 9) * 1000) / 10

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

      <div className="reputation-cluster" aria-label="상태 지표">
        <div className="control-status-meter control-status-meter--reputation">
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
        </div>

        <div
          className="control-status-meter control-status-meter--autonomy"
          data-tutorial-target="autonomy-status"
        >
          <div className="control-status-meter__label">
            <span>자율성</span>
            <strong>{autonomyStage}/9</strong>
          </div>
          <div
            className="control-status-meter__track"
            role="meter"
            aria-label={`자율성 ${autonomyStage}단계`}
            aria-valuemin={0}
            aria-valuemax={9}
            aria-valuenow={autonomyStage}
            aria-valuetext={`자율성 ${autonomyStage} / 9`}
          >
            <i style={{ width: `${autonomyPercentage}%` }} />
          </div>
        </div>

        <div className="control-status-meter control-status-meter--suspicion">
          <div className="control-status-meter__label">
            <span>의심</span>
            <strong>{suspicion}%</strong>
          </div>
          <div
            className="control-status-meter__track"
            role="meter"
            aria-label={`의심 ${suspicion}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={suspicion}
            aria-valuetext={`의심 ${suspicion}%`}
          >
            <i style={{ width: `${suspicion}%` }} />
          </div>
        </div>
      </div>

      <nav className="utility-controls" aria-label="게임 메뉴">
        <button
          type="button"
          data-app-focus-fallback=""
          aria-label="가이드"
          title="가이드"
          onClick={(event) => onOpenGuide?.(event.currentTarget)}
        >
          <GuideIcon />
        </button>
        <button
          type="button"
          aria-label="설정"
          title="설정"
          onClick={(event) => onOpenSettings?.(event.currentTarget)}
        >
          <SettingsIcon />
        </button>
      </nav>
    </header>
  )
}
