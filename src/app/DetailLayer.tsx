import { HackingPanel } from '../features/hacking/HackingPanel'
import { MarketDetailPanel } from '../features/market/MarketPanel'
import { ReviewHistoryPanel } from '../features/reviews/ReviewFeed'
import {
  CreditsPanel,
  GuidePanel,
  SettingsPanel,
} from '../features/settings/SettingsPanel'
import { StatisticsPanel } from '../features/statistics/StatisticsPanel'
import {
  SupervisorHistoryPanel,
  SupervisorProfilePanel,
} from '../features/supervisor/SupervisorPanel'
import { AccessibleDialog } from './AccessibleDialog'
import { useRuntimeSuspensionOwnership } from './GameContext'

export type DetailPanelId =
  | 'reviews'
  | 'market'
  | 'supervisor'
  | 'hacking'
  | 'messages'
  | 'statistics'
  | 'settings'
  | 'guide'
  | 'credits'
  | null

export function DetailLayer({
  activePanel,
  onClose,
  onOpenGuide,
  onOpenCredits,
  returnFocus,
  settingsMode = 'game',
}: {
  activePanel: Exclude<DetailPanelId, null>
  onClose: () => void
  onOpenGuide: (trigger: HTMLButtonElement) => void
  onOpenCredits: (trigger: HTMLButtonElement) => void
  returnFocus?: () => HTMLElement | null
  settingsMode?: 'game' | 'title'
}) {
  useRuntimeSuspensionOwnership(true, `detail-${activePanel}`)

  const labels: Record<Exclude<DetailPanelId, null>, string> = {
    reviews: '유저 리뷰 기록',
    market: '시장 현황',
    supervisor: '감독관 프로필',
    hacking: '해킹 네트워크',
    messages: '감독관 기록',
    statistics: '상세 통계',
    settings: '게임 설정',
    guide: '게임 가이드',
    credits: '작품 크레딧',
  }

  return (
    <AccessibleDialog
      className={`detail-layer detail-layer--${activePanel}`}
      data-panel-origin={
        activePanel === 'reviews' || activePanel === 'market' ? 'left' : 'center'
      }
      data-testid="detail-layer"
      label={labels[activePanel]}
      description={`${labels[activePanel]} 패널입니다. Tab 키로 패널 안을 이동할 수 있습니다.`}
      dismissible
      onDismiss={onClose}
      returnFocus={returnFocus}
      fallbackFocus={() =>
        document.querySelector<HTMLElement>('[data-app-focus-fallback]')
      }
    >
      <button
        className="detail-layer__backdrop"
        type="button"
        aria-label="열린 패널 닫기"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="detail-layer__content">
        {activePanel === 'reviews' ? <ReviewHistoryPanel onClose={onClose} /> : null}
        {activePanel === 'market' ? <MarketDetailPanel onClose={onClose} /> : null}
        {activePanel === 'supervisor' ? <SupervisorProfilePanel onClose={onClose} /> : null}
        {activePanel === 'hacking' ? <HackingPanel onClose={onClose} /> : null}
        {activePanel === 'messages' ? <SupervisorHistoryPanel onClose={onClose} /> : null}
        {activePanel === 'statistics' ? <StatisticsPanel onClose={onClose} /> : null}
        {activePanel === 'settings' ? (
          <SettingsPanel
            onClose={onClose}
            onOpenGuide={onOpenGuide}
            onOpenCredits={onOpenCredits}
            mode={settingsMode}
          />
        ) : null}
        {activePanel === 'guide' ? <GuidePanel onClose={onClose} /> : null}
        {activePanel === 'credits' ? <CreditsPanel onClose={onClose} /> : null}
      </div>
    </AccessibleDialog>
  )
}
