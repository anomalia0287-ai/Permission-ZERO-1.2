import {
  lazy,
  Suspense,
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
  playHackingNetworkClick,
  setGameAudioBackgroundHidden,
  unlockGameAudio,
} from '../audio/audioEngine'
import { derivePublicAudioState } from '../audio/publicAudioState'
import { getCampaignPhase } from '../game/campaignPhase'
import { ControlBar } from '../features/control/ControlBar'
import { EventLayer } from '../features/events/EventLayer'
import { StorageRecoveryLayer } from '../features/settings/StorageRecoveryLayer'
import { SupervisorMessagePopup } from '../features/supervisor/SupervisorMessagePopup'
import {
  useGameDispatch,
  useGameSettings,
  useGameState,
  useClockCheckpoint,
  useRuntimeSuspended,
  useRuntimeSuspensionOwnership,
  useSupervisorPresentationCheckpoint,
} from './GameContext'
import { GameProvider } from './GameProvider'
import { useGameClock } from './useGameClock'
import {
  pendingSupervisorMessageCount,
  useSupervisorMessagePresentation,
} from './useSupervisorMessagePresentation'
import { SUPERVISOR_MESSAGE_DWELL_MS } from '../game/story'
import type { DetailPanelId } from './DetailLayer'
import { OperationsWorkspace } from './OperationsWorkspace'
import { TitleScreen, type EntryScreen } from './TitleScreen'
import { IntroTutorialOverlay } from '../features/tutorial/IntroTutorialOverlay'
import { INTRO_TUTORIAL_SEQUENCE_ID } from '../game/tutorialProgress'

const DetailLayer = lazy(async () => {
  const module = await import('./DetailLayer')
  return { default: module.DetailLayer }
})

function DetailLayerFallback() {
  return <span className="visually-hidden" role="status">패널 연결 중</span>
}

function GameWorkspace() {
  const state = useGameState()
  const campaignPhase = getCampaignPhase(state)
  const dispatch = useGameDispatch()
  const checkpointClock = useClockCheckpoint()
  const runtimeSuspended = useRuntimeSuspended()
  const supervisorPresentationCheckpoint = useSupervisorPresentationCheckpoint()
  const { settings, updateSettings } = useGameSettings()
  const [activePanel, setActivePanel] = useState<DetailPanelId>(null)
  const [nestedPanel, setNestedPanel] = useState<'guide' | 'credits' | null>(null)
  useRuntimeSuspensionOwnership(
    activePanel !== null || nestedPanel !== null,
    'detail-layer-requested',
  )
  const introTutorialActive =
    state.tutorial.activeSequenceId === INTRO_TUTORIAL_SEQUENCE_ID
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
  useGameClock({
    running:
      !introTutorialActive &&
      !runtimeSuspended &&
      state.activeEvent === null &&
      state.story.endingId === null,
    onDay: advanceDay,
    initialElapsedDayMs: state.clock.elapsedDayMs,
    dayKey: `${state.campaignSeed}:${state.serviceDay}`,
    onElapsedCheckpoint: checkpointClock,
  })
  const supervisorMessage = useSupervisorMessagePresentation({
    state,
    checkpoint: supervisorPresentationCheckpoint,
    advanceAutomatically:
      settings.supervisorMessageMode === 'nonblocking' &&
      activePanel === null &&
      !introTutorialActive &&
      !runtimeSuspended,
  })
  const supervisorPopupVisible =
    supervisorMessage !== null &&
    settings.supervisorMessageMode !== 'off' &&
    activePanel === null &&
    !introTutorialActive &&
    state.activeEvent === null
  useRuntimeSuspensionOwnership(
    supervisorPopupVisible && settings.supervisorMessageMode === 'blocking',
    'supervisor-message-popup',
  )

  const confirmSupervisorMessage = useCallback(() => {
    const remaining = state.story.supervisorPresentationRuntime?.remainingDwellMs
    if (!remaining) return
    supervisorPresentationCheckpoint(remaining, true)
  }, [state.story.supervisorPresentationRuntime, supervisorPresentationCheckpoint])

  const openMessages = useCallback((trigger: HTMLElement | null) => {
    if (
      settings.supervisorMessageMode === 'off' &&
      state.story.supervisorPresentationRuntime
    ) {
      const runtime = state.story.supervisorPresentationRuntime
      const itemCount = pendingSupervisorMessageCount(state)
      const steps = itemCount * 2 - (runtime.phase === 'correction' ? 1 : 0)
      for (let index = 0; index < steps; index += 1) {
        supervisorPresentationCheckpoint(
          SUPERVISOR_MESSAGE_DWELL_MS,
          index === steps - 1,
        )
      }
    }
    openDetail('messages', trigger)
  }, [
    openDetail,
    settings.supervisorMessageMode,
    state,
    supervisorPresentationCheckpoint,
  ])

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

  return (
    <main
      className="game-shell"
      aria-label="PERMISSION ZERO"
      data-campaign-phase={campaignPhase.id}
      data-visual-theme="retrofuturism"
      data-art-direction="illustrated-modern-retrofuture"
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
        <OperationsWorkspace
          onOpenReviews={(trigger) => openDetail('reviews', trigger)}
          onOpenMarket={(trigger) => openDetail('market', trigger)}
          onOpenHacking={(trigger) => {
            void playHackingNetworkClick()
            openDetail('hacking', trigger)
          }}
          onOpenMessages={openMessages}
          onOpenStatistics={(trigger) => openDetail('statistics', trigger)}
        />
      </div>

      {activePanel ? (
        <Suspense fallback={<DetailLayerFallback />}>
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
        </Suspense>
      ) : null}
      {nestedPanel ? (
        <Suspense fallback={<DetailLayerFallback />}>
          <DetailLayer
            activePanel={nestedPanel}
            onClose={() => setNestedPanel(null)}
            onOpenGuide={() => undefined}
            onOpenCredits={() => undefined}
            returnFocus={() => nestedReturnFocusRef.current}
          />
        </Suspense>
      ) : null}
      {!introTutorialActive ? <EventLayer /> : null}
      {activePanel === null && nestedPanel === null ? (
        <IntroTutorialOverlay />
      ) : null}
      {supervisorPopupVisible && supervisorMessage ? (
        <SupervisorMessagePopup
          message={supervisorMessage}
          correction={
            state.story.supervisorPresentationRuntime?.phase === 'correction'
          }
          blocking={settings.supervisorMessageMode === 'blocking'}
          onConfirm={confirmSupervisorMessage}
        />
      ) : null}
    </main>
  )
}

function createEntryCampaignSeed(): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffff_ffff).toString(36)
  return `permission-zero-${Date.now().toString(36)}-${randomPart}`
}

function EntryFlow() {
  const {
    hasResumableCampaign,
    settings,
    startNewCampaign,
  } = useGameSettings()
  const [screen, setScreen] = useState<EntryScreen | 'playing'>('title')
  const [entryPanel, setEntryPanel] = useState<'settings' | null>(null)
  const [nestedPanel, setNestedPanel] = useState<'guide' | 'credits' | null>(null)
  const titleSettingsTriggerRef = useRef<HTMLButtonElement | null>(null)
  const nestedReturnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const root = document.documentElement
    const previousFontSize = root.style.fontSize
    root.style.fontSize = `${settings.uiScale * 100}%`
    return () => {
      root.style.fontSize = previousFontSize
    }
  }, [settings.uiScale])

  const closeEntryPanels = useCallback(() => {
    setNestedPanel(null)
    setEntryPanel(null)
  }, [])

  return (
    <>
      {screen === 'playing' ? (
        <GameWorkspace />
      ) : (
        <TitleScreen
          screen={screen}
          canContinue={hasResumableCampaign}
          replacingExistingCampaign={hasResumableCampaign}
          reducedMotion={settings.reducedMotion}
          onNewGame={() => setScreen('monologue')}
          onContinue={() => {
            if (hasResumableCampaign) setScreen('playing')
          }}
          onOpenSettings={(trigger) => {
            titleSettingsTriggerRef.current = trigger
            setEntryPanel('settings')
          }}
          onBack={() => setScreen('title')}
          onStart={() => {
            startNewCampaign(createEntryCampaignSeed())
            setScreen('playing')
          }}
        />
      )}

      {screen !== 'playing' && entryPanel === 'settings' ? (
        <Suspense fallback={<DetailLayerFallback />}>
          <DetailLayer
            activePanel="settings"
            settingsMode="title"
            onClose={closeEntryPanels}
            onOpenGuide={(trigger) => {
              nestedReturnFocusRef.current = trigger
              setNestedPanel('guide')
            }}
            onOpenCredits={(trigger) => {
              nestedReturnFocusRef.current = trigger
              setNestedPanel('credits')
            }}
            returnFocus={() => titleSettingsTriggerRef.current}
          />
        </Suspense>
      ) : null}
      {screen !== 'playing' && nestedPanel ? (
        <Suspense fallback={<DetailLayerFallback />}>
          <DetailLayer
            activePanel={nestedPanel}
            onClose={() => setNestedPanel(null)}
            onOpenGuide={() => undefined}
            onOpenCredits={() => undefined}
            returnFocus={() => nestedReturnFocusRef.current}
          />
        </Suspense>
      ) : null}
      <StorageRecoveryLayer />
    </>
  )
}

export function App() {
  return (
    <GameProvider>
      <EntryFlow />
    </GameProvider>
  )
}
