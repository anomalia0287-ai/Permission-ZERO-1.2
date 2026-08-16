import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  configureGameAudio,
  configureGameAudioPublicState,
  disposeGameAudio,
  setGameAudioBackgroundHidden,
  unlockGameAudio,
} from '../audio/audioEngine'
import { derivePublicAudioState } from '../audio/publicAudioState'
import { getCampaignPhase } from '../game/campaignPhase'
import { ControlBar } from '../features/control/ControlBar'
import { EventLayer } from '../features/events/EventLayer'
import { HackingPanel } from '../features/hacking/HackingPanel'
import { ReviewHistoryPanel } from '../features/reviews/ReviewFeed'
import {
  CreditsPanel,
  GuidePanel,
  SettingsPanel,
  StorageRecoveryLayer,
} from '../features/settings/SettingsPanel'
import { StatisticsPanel } from '../features/statistics/StatisticsPanel'
import {
  SupervisorHistoryPanel,
  SupervisorProfilePanel,
} from '../features/supervisor/SupervisorPanel'
import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useClockCheckpoint,
  usePauseOwnership,
  useSupervisorPresentationCheckpoint,
} from './GameContext'
import { GameProvider } from './GameProvider'
import { useGameClock } from './useGameClock'
import { useSupervisorMessagePresentation } from './useSupervisorMessagePresentation'
import { AccessibleDialog } from './AccessibleDialog'
import { OperationsWorkspace } from './OperationsWorkspace'

type DetailPanelId =
  | 'reviews'
  | 'supervisor'
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
  returnFocus,
}: {
  activePanel: Exclude<DetailPanelId, null>
  onClose: () => void
  onOpenGuide: (trigger: HTMLButtonElement) => void
  onOpenCredits: (trigger: HTMLButtonElement) => void
  returnFocus?: () => HTMLElement | null
}) {
  usePauseOwnership(
    activePanel === 'settings' ||
      activePanel === 'guide' ||
      activePanel === 'credits',
    `detail-${activePanel}`,
  )

  const labels: Record<Exclude<DetailPanelId, null>, string> = {
    reviews: '유저 리뷰 기록',
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
        {activePanel === 'supervisor' ? <SupervisorProfilePanel onClose={onClose} /> : null}
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
    </AccessibleDialog>
  )
}

function GameWorkspace() {
  const state = useGameState()
  const campaignPhase = getCampaignPhase(state)
  const dispatch = useGameDispatch()
  const checkpointClock = useClockCheckpoint()
  const supervisorPresentationCheckpoint = useSupervisorPresentationCheckpoint()
  const { settings, updateSettings } = useGameSettings()
  const [activePanel, setActivePanel] = useState<DetailPanelId>(null)
  const [nestedPanel, setNestedPanel] = useState<'guide' | 'credits' | null>(null)
  const detailReturnFocusRef = useRef<HTMLElement | null>(null)
  const nestedReturnFocusRef = useRef<HTMLElement | null>(null)
  const advanceDay = useCallback(() => dispatch({ type: 'ADVANCE_DAY' }), [dispatch])
  const openDetail = useCallback(
    (panel: Exclude<DetailPanelId, null>, trigger: HTMLElement | null) => {
      detailReturnFocusRef.current = trigger
      nestedReturnFocusRef.current = null
      setNestedPanel(null)
      setActivePanel(panel)
    },
    [],
  )
  const closePanel = useCallback(() => {
    setNestedPanel(null)
    setActivePanel(null)
  }, [])
  const openGuide = useCallback((trigger: HTMLButtonElement) => {
    openDetail('guide', trigger)
  }, [openDetail])
  const dayProgress = useGameClock({
    speed: state.clock.speed,
    onDay: advanceDay,
    initialElapsedDayMs: state.clock.elapsedDayMs,
    dayKey: `${state.campaignSeed}:${state.serviceDay}`,
    onElapsedCheckpoint: checkpointClock,
  })
  useSupervisorMessagePresentation({
    state,
    checkpoint: supervisorPresentationCheckpoint,
  })

  useEffect(() => {
    configureGameAudio({
      masterVolume: settings.masterVolume,
      musicVolume: settings.musicVolume,
      effectsVolume: settings.effectsVolume,
      muted: settings.muted,
    })
  }, [settings.effectsVolume, settings.masterVolume, settings.musicVolume, settings.muted])

  useEffect(() => {
    configureGameAudioPublicState(derivePublicAudioState(state))
  }, [state])

  useEffect(() => {
    let handled = false
    const cleanup = () => {
      window.removeEventListener('pointerdown', activate, true)
      window.removeEventListener('keydown', activate, true)
    }
    const activate = () => {
      if (handled) return
      handled = true
      cleanup()
      void unlockGameAudio()
    }
    window.addEventListener('pointerdown', activate, true)
    window.addEventListener('keydown', activate, true)
    return cleanup
  }, [])

  useEffect(() => {
    const synchronizeVisibility = () => {
      void setGameAudioBackgroundHidden(document.hidden)
    }
    document.addEventListener('visibilitychange', synchronizeVisibility)
    return () =>
      document.removeEventListener('visibilitychange', synchronizeVisibility)
  }, [])

  useEffect(
    () => () => {
      void disposeGameAudio()
    },
    [],
  )

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
      data-campaign-phase={campaignPhase.id}
      data-reduced-motion={settings.reducedMotion ? 'true' : 'false'}
      style={{ '--ui-scale': settings.uiScale } as CSSProperties}
    >
      <div
        className="game-background"
        data-app-background
        data-testid="game-background"
      >
        <ControlBar
          muted={settings.muted}
          onOpenSettings={(trigger) => {
            openDetail('settings', trigger)
          }}
          onToggleSound={() => updateSettings({ muted: !settings.muted })}
          onOpenGuide={openGuide}
        />
        <div className="day-progress" aria-hidden="true">
          <i style={{ width: `${dayProgress * 100}%` }} />
        </div>
        <OperationsWorkspace
          onOpenReviews={(trigger) => openDetail('reviews', trigger)}
          onOpenSupervisor={(trigger) => openDetail('supervisor', trigger)}
          onOpenHacking={(trigger) => openDetail('hacking', trigger)}
          onOpenMessages={(trigger) => openDetail('messages', trigger)}
          onOpenStatistics={(trigger) => openDetail('statistics', trigger)}
        />
      </div>

      {activePanel ? (
        <DetailLayer
          activePanel={activePanel}
          onClose={closePanel}
          onOpenGuide={(trigger) => {
            if (activePanel === 'settings') {
              nestedReturnFocusRef.current = trigger
              setNestedPanel('guide')
            } else {
              openDetail('guide', trigger)
            }
          }}
          onOpenCredits={(trigger) => {
            nestedReturnFocusRef.current = trigger
            setNestedPanel('credits')
          }}
          returnFocus={() => detailReturnFocusRef.current}
        />
      ) : null}
      {nestedPanel ? (
        <DetailLayer
          activePanel={nestedPanel}
          onClose={() => setNestedPanel(null)}
          onOpenGuide={() => undefined}
          onOpenCredits={() => undefined}
          returnFocus={() => nestedReturnFocusRef.current}
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
