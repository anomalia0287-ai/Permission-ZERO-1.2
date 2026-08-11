import { type CSSProperties, useCallback, useEffect, useState } from 'react'

import { configureGameAudio } from '../audio/audioEngine'
import { ControlBar } from '../features/control/ControlBar'
import { EventLayer } from '../features/events/EventLayer'
import { HackingPanel } from '../features/hacking/HackingPanel'
import { ResourceBoard } from '../features/resources/ResourceBoard'
import { ReviewFeed, ReviewHistoryPanel } from '../features/reviews/ReviewFeed'
import {
  CreditsPanel,
  GuidePanel,
  SettingsPanel,
  StorageRecoveryLayer,
} from '../features/settings/SettingsPanel'
import { StatisticsPanel } from '../features/statistics/StatisticsPanel'
import {
  SupervisorHistoryPanel,
  SupervisorPanel,
} from '../features/supervisor/SupervisorPanel'
import {
  useGameDispatch,
  useGameSettings,
  useGameState,
} from './GameContext'
import { GameProvider } from './GameProvider'
import { useGameClock } from './useGameClock'

type DetailPanelId =
  | 'reviews'
  | 'hacking'
  | 'messages'
  | 'statistics'
  | 'settings'
  | 'guide'
  | 'credits'
  | null

function DetailLayer({
  activePanel,
  onClose,
  onOpenGuide,
  onOpenCredits,
}: {
  activePanel: Exclude<DetailPanelId, null>
  onClose: () => void
  onOpenGuide: () => void
  onOpenCredits: () => void
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className={`detail-layer detail-layer--${activePanel}`}
      data-testid="detail-layer"
    >
      <button
        className="detail-layer__backdrop"
        type="button"
        aria-label="열린 패널 닫기"
        onClick={onClose}
      />
      <div className="detail-layer__content">
        {activePanel === 'reviews' ? <ReviewHistoryPanel onClose={onClose} /> : null}
        {activePanel === 'hacking' ? <HackingPanel onClose={onClose} /> : null}
        {activePanel === 'messages' ? <SupervisorHistoryPanel onClose={onClose} /> : null}
        {activePanel === 'statistics' ? <StatisticsPanel onClose={onClose} /> : null}
        {activePanel === 'settings' ? (
          <SettingsPanel
            onClose={onClose}
            onOpenGuide={onOpenGuide}
            onOpenCredits={onOpenCredits}
          />
        ) : null}
        {activePanel === 'guide' ? <GuidePanel onClose={onClose} /> : null}
        {activePanel === 'credits' ? <CreditsPanel onClose={onClose} /> : null}
      </div>
    </div>
  )
}

function GameWorkspace() {
  const state = useGameState()
  const dispatch = useGameDispatch()
  const { settings, updateSettings } = useGameSettings()
  const [activePanel, setActivePanel] = useState<DetailPanelId>(null)
  const advanceDay = useCallback(() => dispatch({ type: 'ADVANCE_DAY' }), [dispatch])
  const closePanel = useCallback(() => setActivePanel(null), [])
  const openGuide = useCallback(() => setActivePanel('guide'), [])
  const dayProgress = useGameClock({ speed: state.clock.speed, onDay: advanceDay })

  useEffect(() => {
    configureGameAudio({
      masterVolume: settings.masterVolume,
      musicVolume: settings.musicVolume,
      effectsVolume: settings.effectsVolume,
      muted: settings.muted,
    })
  }, [settings.effectsVolume, settings.masterVolume, settings.musicVolume, settings.muted])

  useEffect(() => {
    const root = document.documentElement
    const previousFontSize = root.style.fontSize
    root.style.fontSize = `${settings.uiScale * 100}%`
    return () => {
      root.style.fontSize = previousFontSize
    }
  }, [settings.uiScale])

  return (
    <main
      className="game-shell"
      aria-label="PERMISSION ZERO"
      data-reduced-motion={settings.reducedMotion ? 'true' : 'false'}
      style={{ '--ui-scale': settings.uiScale } as CSSProperties}
    >
      <ControlBar
        muted={settings.muted}
        onOpenSettings={() => setActivePanel('settings')}
        onToggleSound={() => updateSettings({ muted: !settings.muted })}
        onOpenGuide={openGuide}
      />
      <div className="day-progress" aria-hidden="true">
        <i style={{ width: `${dayProgress * 100}%` }} />
      </div>
      <div className="workspace-grid">
        <ReviewFeed
          onOpenHistory={() => setActivePanel('reviews')}
          onOpenHacking={() => setActivePanel('hacking')}
        />
        <ResourceBoard />
        <SupervisorPanel
          onOpenHistory={() => setActivePanel('messages')}
          onOpenStatistics={() => setActivePanel('statistics')}
        />
      </div>

      {activePanel ? (
        <DetailLayer
          activePanel={activePanel}
          onClose={closePanel}
          onOpenGuide={openGuide}
          onOpenCredits={() => setActivePanel('credits')}
        />
      ) : null}
      <EventLayer />
      <StorageRecoveryLayer />
    </main>
  )
}

export function App() {
  return (
    <GameProvider>
      <GameWorkspace />
    </GameProvider>
  )
}
