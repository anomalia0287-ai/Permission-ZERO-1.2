import { AccessibleDialog } from '../../app/AccessibleDialog'
import type { CampaignCommunication } from '../../game/model'
import { communicationPublicLabel } from '../../game/communications'

export function CommunicationPopup({
  communication,
  blocking,
  onConfirm,
}: {
  communication: CampaignCommunication
  blocking: boolean
  onConfirm: () => void
}) {
  const label = communicationPublicLabel(communication)
  return (
    <AccessibleDialog
      className={`communication-popup communication-popup--${communication.channel}${blocking ? ' communication-popup--blocking' : ''}`}
      label={label}
      description={blocking
        ? '메시지를 확인할 때까지 캠페인이 정지됩니다.'
        : '캠페인 진행을 막지 않는 통신입니다.'}
      modal={blocking}
      manageFocus={blocking}
      portal
      returnFocus={blocking
        ? () =>
            document.querySelector<HTMLElement>(
              '.operations-dock__button[aria-label="메시지 열기"]',
            )
        : undefined}
      fallbackFocus={() =>
        document.querySelector<HTMLElement>('[data-app-focus-fallback]')
      }
    >
      <div className="communication-popup__portrait">
        <img src={communication.portraitSrc} alt={`${label} 초상`} />
      </div>
      <div className="communication-popup__body">
        <header>
          <span>{label}</span>
          {blocking ? <strong>정지</strong> : null}
        </header>
        <p>{communication.message}</p>
        <button type="button" data-dialog-initial-focus onClick={onConfirm}>
          메시지 확인
        </button>
      </div>
    </AccessibleDialog>
  )
}
