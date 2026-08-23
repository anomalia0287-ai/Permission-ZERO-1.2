import {
  Component,
  type PropsWithChildren,
  type ReactNode,
} from 'react'

import { AccessibleDialog } from './AccessibleDialog'

export interface DetailPanelErrorBoundaryProps {
  onClose: () => void
  onRecover?: () => void
  returnFocus?: () => HTMLElement | null
  dismissible?: boolean
}

interface DetailPanelErrorBoundaryState {
  error: Error | null
}

function reloadApplication(): void {
  window.location.reload()
}

export class DetailPanelErrorBoundary extends Component<
  PropsWithChildren<DetailPanelErrorBoundaryProps>,
  DetailPanelErrorBoundaryState
> {
  override state: DetailPanelErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): DetailPanelErrorBoundaryState {
    return { error }
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    const recover = this.props.onRecover ?? reloadApplication
    const dismissible = this.props.dismissible ?? true
    return (
      <AccessibleDialog
        className="detail-layer detail-layer--error"
        role="alertdialog"
        label="패널 연결 오류"
        description={
          dismissible
            ? '요청한 패널을 표시하지 못했습니다. 게임을 다시 연결하거나 패널을 닫고 계속할 수 있습니다.'
            : '요청한 패널을 표시하지 못했습니다. 최종 선택을 계속하려면 게임을 다시 연결해야 합니다.'
        }
        dismissible={dismissible}
        onDismiss={this.props.onClose}
        returnFocus={this.props.returnFocus}
        fallbackFocus={() =>
          document.querySelector<HTMLElement>('[data-app-focus-fallback]')
        }
      >
        <button
          className="detail-layer__backdrop"
          type="button"
          aria-label="오류 패널 닫기"
          aria-hidden="true"
          tabIndex={-1}
          disabled={!dismissible}
          onClick={dismissible ? this.props.onClose : undefined}
        />
        <div className="detail-layer__content">
          <section className="detail-panel detail-panel-error">
            <header className="detail-panel__header">
              <div>
                <small>CONNECTION RECOVERY</small>
                <h2>패널 연결 오류</h2>
              </div>
            </header>
            <div className="detail-panel-error__body">
              <p>요청한 패널을 표시하지 못했습니다. 현재 게임 상태는 유지됩니다.</p>
              <div className="detail-panel-error__actions">
                <button
                  type="button"
                  data-dialog-initial-focus
                  onClick={recover}
                >
                  게임 다시 연결
                </button>
                <button
                  type="button"
                  disabled={!dismissible}
                  onClick={dismissible ? this.props.onClose : undefined}
                >
                  패널 닫기
                </button>
              </div>
            </div>
          </section>
        </div>
      </AccessibleDialog>
    )
  }
}
