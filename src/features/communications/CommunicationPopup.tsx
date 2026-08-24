import { useState } from 'react'

import { AccessibleDialog } from '../../app/AccessibleDialog'
import type { CampaignCommunication } from '../../game/model'
import { communicationPublicLabel } from '../../game/communications'
import { paginateCommunicationMessage } from './paginateCommunicationMessage'
import { publicAssetUrl } from '../../assets/publicAssetUrl'

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
    <PagedCommunicationPopup
      key={communication.id}
      communication={communication}
      blocking={blocking}
      onConfirm={onConfirm}
      label={label}
    />
  )
}

function PagedCommunicationPopup({
  communication,
  blocking,
  onConfirm,
  label,
}: {
  communication: CampaignCommunication
  blocking: boolean
  onConfirm: () => void
  label: string
}) {
  const pages = paginateCommunicationMessage(communication.message)
  const [pageIndex, setPageIndex] = useState(0)
  const lastPage = pageIndex >= pages.length - 1
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
        <img src={publicAssetUrl(communication.portraitSrc)} alt={`${label} 초상`} />
      </div>
      <div className="communication-popup__body">
        <header>
          <span>{label}</span>

        </header>
        <p key={pageIndex}>{pages[pageIndex]}</p>
        {pages.length > 1 ? (
          <span
            className="communication-popup__pages"
            aria-label={`${pages.length}쪽 중 ${pageIndex + 1}쪽`}
          >
            {pageIndex + 1} / {pages.length}
          </span>
        ) : null}
        <button
          type="button"
          data-dialog-initial-focus
          onClick={lastPage
            ? onConfirm
            : () => setPageIndex((current) => current + 1)}
        >
          {lastPage ? '메시지 확인' : '계속'}
        </button>
      </div>
    </AccessibleDialog>
  )
}
