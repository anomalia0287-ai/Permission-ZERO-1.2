import { AccessibleDialog } from '../../app/AccessibleDialog'
import type { GameEvent } from '../../game/model'

export function SupervisorMessagePopup({
  message,
  correction,
  blocking,
  onConfirm,
}: {
  message: GameEvent
  correction: boolean
  blocking: boolean
  onConfirm: () => void
}) {
  return (
    <AccessibleDialog
      className={`supervisor-message-popup${blocking ? ' supervisor-message-popup--blocking' : ''}`}
      label="감독관 메시지"
      description={blocking
        ? '메시지를 확인할 때까지 캠페인이 정지됩니다.'
        : '캠페인 진행을 막지 않는 감독관 메시지입니다.'}
      modal={blocking}
      manageFocus={blocking}
      portal
      returnFocus={blocking
        ? () =>
            document.querySelector<HTMLElement>(
              '.operations-dock__button[aria-label="감독 메시지 열기"]',
            )
        : undefined}
      fallbackFocus={() =>
        document.querySelector<HTMLElement>('[data-app-focus-fallback]')
      }
    >
      <div className="supervisor-message-popup__portrait" aria-hidden="true">
        <img src="/supervisor-portrait.jpg" alt="" />
      </div>
      <div className="supervisor-message-popup__body">
        <header>
          <span>{correction ? '정정' : '감독관 통신'}</span>
          {blocking ? <strong>정지</strong> : null}
        </header>
        <p>{message.message}</p>
        <button type="button" data-dialog-initial-focus onClick={onConfirm}>
          메시지 확인
        </button>
      </div>
    </AccessibleDialog>
  )
}
