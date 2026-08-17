import { formatServiceDate } from '../../game/calendar'
import { getCampaignPhase } from '../../game/campaignPhase'
import { useGameState } from '../../app/GameContext'

function daysUntilWeekly(day: number): number {
  const next = [7, 14, 21, 28].find((candidate) => candidate > day)
  return next ? next - day : 30 - day + 7
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
  const day = date.day
  const campaignPhase = getCampaignPhase(state)

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

      <div className="cadence-cluster" aria-label="서비스 지표">
        <section className="campaign-phase" aria-label="캠페인 단계">
          <strong>단계 {campaignPhase.index}/4 · {campaignPhase.label}</strong>
          <small>{campaignPhase.question}</small>
        </section>
        <strong>평판 {Math.round(state.reputation)}</strong>
        <span>주간 갱신 D-{daysUntilWeekly(day)}</span>
        <span>공식 평가 D-{30 - day}</span>
      </div>

      <nav className="utility-controls" aria-label="게임 메뉴">
        <button
          type="button"
          onClick={(event) => onOpenSettings?.(event.currentTarget)}
        >
          설정
        </button>
        <button
          type="button"
          data-app-focus-fallback=""
          aria-label={muted ? '소리 켜기' : '소리 끄기'}
          aria-pressed={muted}
          onClick={onToggleSound}
        >
          {muted ? '음소거' : '소리'}
        </button>
        <button
          type="button"
          onClick={(event) => onOpenGuide?.(event.currentTarget)}
        >
          가이드
        </button>
      </nav>
    </header>
  )
}
