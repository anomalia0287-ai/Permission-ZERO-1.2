import type { DetailPanelId } from './DetailLayer'
import { AccessibleDialog } from './AccessibleDialog'

const DETAIL_PANEL_LABELS: Record<Exclude<DetailPanelId, null>, string> = {
  reviews: '유저 리뷰 기록',
  market: '시장 현황',
  supervisor: '감독관 프로필',
  hacking: '확장',
  messages: '통신 기록',
  statistics: '상세 통계',
  settings: '게임 설정',
  guide: '게임 가이드',
  credits: '작품 크레딧',
}

export function DetailLayerLoadingShell({
  activePanel,
  onClose,
  returnFocus,
  dismissible = true,
}: {
  activePanel: Exclude<DetailPanelId, null>
  onClose: () => void
  returnFocus?: () => HTMLElement | null
  dismissible?: boolean
}) {
  const panelLabel = DETAIL_PANEL_LABELS[activePanel]

  return (
    <AccessibleDialog
      className={`detail-layer detail-layer--${activePanel}`}
      data-panel-origin={
        activePanel === 'reviews' || activePanel === 'market' ? 'left' : 'center'
      }
      aria-busy="true"
      label={`${panelLabel} 불러오는 중`}
      description={
        dismissible
          ? `${panelLabel} 패널을 연결하고 있습니다. 로딩 중에도 이 창을 닫을 수 있습니다.`
          : `${panelLabel} 패널을 연결하고 있습니다. 최종 선택을 마칠 때까지 이 창을 닫을 수 없습니다.`
      }
      dismissible={dismissible}
      onDismiss={onClose}
      returnFocus={returnFocus}
      fallbackFocus={() =>
        document.querySelector<HTMLElement>('[data-app-focus-fallback]')
      }
    >
      <button
        className="detail-layer__backdrop"
        type="button"
        aria-label={`${panelLabel} 로딩 닫기`}
        aria-hidden="true"
        tabIndex={-1}
        disabled={!dismissible}
        onClick={dismissible ? onClose : undefined}
      />
      <div className="detail-layer__content">
        <section className="detail-panel detail-panel-loading">
          <header className="detail-panel__header">
            <div>
              <small>CONNECTING</small>
              <h2>{panelLabel}</h2>
            </div>
            <button
              type="button"
              data-dialog-initial-focus
              aria-label={`${panelLabel} 로딩 닫기`}
              disabled={!dismissible}
              onClick={dismissible ? onClose : undefined}
            >
              닫기 ×
            </button>
          </header>
          <div className="detail-panel-error__body">
            <p role="status">패널 연결 중</p>
          </div>
        </section>
      </div>
    </AccessibleDialog>
  )
}
