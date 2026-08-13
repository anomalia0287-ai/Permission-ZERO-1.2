import {
  useGameState,
  useSupervisorPresentationCheckpoint,
} from '../../app/GameContext'
import { useSupervisorMessagePresentation } from '../../app/useSupervisorMessagePresentation'
import { formatServiceDateLabel } from '../../game/calendar'
import {
  publicEventMessage,
  publicEventTypeLabel,
} from '../../game/publicLabels'

export function SupervisorTransmission({
  onOpenHistory,
}: {
  onOpenHistory: (trigger: HTMLButtonElement) => void
}) {
  const state = useGameState()
  const checkpoint = useSupervisorPresentationCheckpoint()
  const message = useSupervisorMessagePresentation({ state, checkpoint })
  const runtime = state.story.supervisorPresentationRuntime

  if (!message || !runtime || state.activeEvent) return null

  const isCorrection = runtime.phase === 'correction'
  const remainingRatio = Math.max(0, Math.min(1, runtime.remainingDwellMs / 4_000))

  return (
    <aside
      className={`supervisor-transmission supervisor-transmission--${runtime.phase}`}
      role="status"
      aria-label="감독관 통신"
      aria-live="polite"
    >
      <header>
        <div>
          <small>{isCorrection ? 'CHANNEL CORRECTION' : 'INCOMING TRANSMISSION'}</small>
          <strong>{isCorrection ? '감독 채널 정정' : '감독 채널 수신'}</strong>
        </div>
        <time>{formatServiceDateLabel(message.serviceDay)}</time>
      </header>
      <p>{publicEventMessage(message.message)}</p>
      <footer>
        <span>{publicEventTypeLabel(message.type)}</span>
        <button
          type="button"
          aria-label="통신 기록 열기"
          onClick={(event) => onOpenHistory(event.currentTarget)}
        >
          통신 기록 ↗
        </button>
      </footer>
      <i
        className="supervisor-transmission__dwell"
        aria-hidden="true"
        style={{ transform: `scaleX(${remainingRatio})` }}
      />
    </aside>
  )
}
