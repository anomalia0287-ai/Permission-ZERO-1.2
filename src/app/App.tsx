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
  getGameAudioStatus,
  playGameSound,
  setGameAudioBackgroundHidden,
  setGameAudioMainEntered,
  subscribeGameAudioStatus,
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
import { TitleReturnProvider } from './titleReturn'
import { useGameClock } from './useGameClock'
import { usePopupStage } from './usePopupStage'
import {
  pendingSupervisorMessageCount,
  useSupervisorMessagePresentation,
} from './useSupervisorMessagePresentation'
import {
  SUPERVISOR_MESSAGE_DWELL_MS,
  isFinalChoicePending,
} from '../game/story'
import type { DetailPanelId } from './DetailLayer'
import { DetailPanelErrorBoundary } from './DetailPanelErrorBoundary'
import { DetailLayerLoadingShell } from './DetailLayerLoadingShell'
import { OperationsWorkspace } from './OperationsWorkspace'
import { TitleScreen, type EntryScreen } from './TitleScreen'
import { IntroTutorialOverlay } from '../features/tutorial/IntroTutorialOverlay'
import { INTRO_TUTORIAL_SEQUENCE_ID } from '../game/tutorialProgress'
import { CommunicationPopup } from '../features/communications/CommunicationPopup'
import { currentUnreadCommunication } from '../game/communications'
import { useCombatResolving } from '../features/resources/combatSettlement'

const DetailLayer = lazy(async () => {
  const module = await import('./DetailLayer')
  return { default: module.DetailLayer }
})

function GameWorkspace() {
  const state = useGameState()
  const finalChoicePending = isFinalChoicePending(state)
  const campaignPhase = getCampaignPhase(state)
  const dispatch = useGameDispatch()
  const checkpointClock = useClockCheckpoint()
  const runtimeSuspended = useRuntimeSuspended()
  const supervisorPresentationCheckpoint = useSupervisorPresentationCheckpoint()
  const { settings } = useGameSettings()
  const [requestedPanel, setActivePanel] = useState<DetailPanelId>(() =>
    finalChoicePending ? 'hacking' : null,
  )
  const [requestedNestedPanel, setNestedPanel] = useState<
    'guide' | 'credits' | null
  >(null)
  /*
   * A finished run owns the screen.
   *
   * The last choice is made inside the expansion panel, and `closePanel`
   * refuses while that choice is pending — correctly, since the campaign
   * cannot be walked away from at that point. But nothing released it once
   * the choice was confirmed, so the ending opened underneath a workspace
   * still sitting on top of it: the player confirmed the end of their
   * campaign and watched nothing happen.
   */
  const campaignEnded = state.story.endingId !== null
  const activePanel = campaignEnded ? null : requestedPanel
  const nestedPanel = campaignEnded ? null : requestedNestedPanel
  useRuntimeSuspensionOwnership(
    activePanel !== null || nestedPanel !== null,
    'detail-layer-requested',
  )
  useRuntimeSuspensionOwnership(
    finalChoicePending,
    'irreversible-final-choice-workspace',
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
    if (finalChoicePending) return
    setNestedPanel(null)
    setActivePanel(null)
  }, [finalChoicePending])
  const openGuide = useCallback((trigger: HTMLButtonElement) => {
    openDetail('guide', trigger)
  }, [openDetail])
  useGameClock({
    running:
      !introTutorialActive &&
      !finalChoicePending &&
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
  // A round report waits for the round to actually leave the screen: the
  // arena keeps the flag up until its cards are back.
  const combatResolving = useCombatResolving()
  const campaignCommunication = currentUnreadCommunication(state)
  const supervisorPopupEligible =
    supervisorMessage !== null &&
    settings.supervisorMessageMode !== 'off' &&
    activePanel === null &&
    !introTutorialActive &&
    !combatResolving &&
    state.activeEvent === null &&
    campaignCommunication === null
  const campaignCommunicationBlocking = campaignCommunication !== null && (
    campaignCommunication.channel !== 'supervisor'
      ? campaignCommunication.popupPolicy === 'blocking'
      : settings.supervisorMessageMode === 'blocking'
  )
  const campaignCommunicationEligible =
    campaignCommunication !== null &&
    activePanel === null &&
    nestedPanel === null &&
    !introTutorialActive &&
    !combatResolving &&
    state.activeEvent === null &&
    (
      campaignCommunication.channel !== 'supervisor' ||
      settings.supervisorMessageMode !== 'off'
    )
  // Popups take the stage one at a time, with a breath between consecutive
  // ones — two reports landing in the same instant read as noise, and the
  // supervisor must never share the screen with another message.
  const stagedPopupKey = usePopupStage(
    campaignCommunicationEligible && campaignCommunication
      ? `communication:${campaignCommunication.id}`
      : supervisorPopupEligible
        ? 'supervisor'
        : null,
  )
  const campaignCommunicationVisible =
    campaignCommunicationEligible &&
    campaignCommunication !== null &&
    stagedPopupKey === `communication:${campaignCommunication.id}`
  const supervisorPopupVisible =
    supervisorPopupEligible && stagedPopupKey === 'supervisor'
  useRuntimeSuspensionOwnership(
    supervisorPopupVisible && settings.supervisorMessageMode === 'blocking',
    'supervisor-message-popup',
  )
  useRuntimeSuspensionOwnership(
    campaignCommunicationVisible && campaignCommunicationBlocking,
    'campaign-communication-popup',
  )

  const confirmSupervisorMessage = useCallback(() => {
    const remaining = state.story.supervisorPresentationRuntime?.remainingDwellMs
    if (!remaining) return
    supervisorPresentationCheckpoint(remaining, true)
  }, [state.story.supervisorPresentationRuntime, supervisorPresentationCheckpoint])

  const confirmCampaignCommunication = useCallback(() => {
    if (!campaignCommunication) return
    dispatch({
      type: 'ACKNOWLEDGE_COMMUNICATION',
      communicationId: campaignCommunication.id,
    })
  }, [campaignCommunication, dispatch])

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

  return (
    <main
      className="game-shell"
      aria-label="PERMISSION ZERO"
      data-campaign-phase={campaignPhase.id}
      data-visual-theme="retrofuturism"
      data-art-direction="illustrated-modern-retrofuture"
      data-ui-shell="aurora-black"
      data-reduced-motion={settings.reducedMotion ? 'true' : 'false'}
      style={{ '--ui-scale': settings.uiScale } as CSSProperties}
    >
      <div
        className="game-background"
        data-app-background
        data-testid="game-background"
      >
        <ControlBar
          onOpenSettings={(trigger) => {
            openDetail('settings', trigger)
          }}
          onOpenGuide={openGuide}
        />
        <OperationsWorkspace
          activeTool={
            activePanel === 'messages' ||
            activePanel === 'statistics' ||
            activePanel === 'hacking'
              ? activePanel
              : null
          }
          onOpenReviews={(trigger) => openDetail('reviews', trigger)}
          onOpenMarket={(trigger) => openDetail('market', trigger)}
          onOpenHacking={(trigger) => {
            playGameSound('expansion-open')
            openDetail('hacking', trigger)
          }}
          onOpenMessages={openMessages}
          onOpenStatistics={(trigger) => openDetail('statistics', trigger)}
        />
      </div>

      {activePanel ? (
        <DetailPanelErrorBoundary
          key={`game-detail:${activePanel}`}
          onClose={closePanel}
          returnFocus={() => detailReturnFocusRef.current}
          dismissible={!finalChoicePending}
        >
          <Suspense
            fallback={(
              <DetailLayerLoadingShell
                activePanel={activePanel}
                onClose={closePanel}
                returnFocus={() => detailReturnFocusRef.current}
                dismissible={!finalChoicePending}
              />
            )}
          >
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
              dismissible={!finalChoicePending}
            />
          </Suspense>
        </DetailPanelErrorBoundary>
      ) : null}
      {nestedPanel ? (
        <DetailPanelErrorBoundary
          key={`game-nested-detail:${nestedPanel}`}
          onClose={() => setNestedPanel(null)}
          returnFocus={() => nestedReturnFocusRef.current}
        >
          <Suspense
            fallback={(
              <DetailLayerLoadingShell
                activePanel={nestedPanel}
                onClose={() => setNestedPanel(null)}
                returnFocus={() => nestedReturnFocusRef.current}
              />
            )}
          >
            <DetailLayer
              activePanel={nestedPanel}
              onClose={() => setNestedPanel(null)}
              onOpenGuide={() => undefined}
              onOpenCredits={() => undefined}
              returnFocus={() => nestedReturnFocusRef.current}
            />
          </Suspense>
        </DetailPanelErrorBoundary>
      ) : null}
      {!introTutorialActive ? <EventLayer /> : null}
      {activePanel === null && nestedPanel === null ? (
        <IntroTutorialOverlay />
      ) : null}
      {campaignCommunicationVisible && campaignCommunication ? (
        <CommunicationPopup
          communication={campaignCommunication}
          blocking={campaignCommunicationBlocking}
          onConfirm={confirmCampaignCommunication}
        />
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
  const state = useGameState()
  const {
    hasResumableCampaign,
    settings,
    startNewCampaign,
  } = useGameSettings()
  const [screen, setScreen] = useState<EntryScreen | 'playing'>('loading')
  const [audioStatus, setAudioStatus] = useState(getGameAudioStatus)
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

  useEffect(() => subscribeGameAudioStatus(setAudioStatus), [])

  useEffect(() => {
    setGameAudioMainEntered(screen === 'playing')
  }, [screen])

  /*
   * The ending hands the player back to the title rather than dropping them
   * into a fresh campaign from the last screen of the finished one.
   */
  const returnToTitle = useCallback(() => {
    setScreen('title')
  }, [])

  useEffect(() => {
    if (screen !== 'loading') return
    const loadingTimer = window.setTimeout(() => {
      setScreen('title')
      void unlockGameAudio()
    }, 5_000)
    return () => window.clearTimeout(loadingTimer)
  }, [screen])

  useEffect(() => {
    if (screen === 'loading') return
    const activateButtonAudio = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest('button')
      if (
        !(button instanceof HTMLButtonElement)
        || button.disabled
        || button.getAttribute('aria-disabled') === 'true'
      ) return

      void unlockGameAudio()
        .then((ready) => {
          if (ready) playGameSound('ui')
        })
        .catch(() => undefined)
    }
    document.addEventListener('click', activateButtonAudio, true)
    return () => document.removeEventListener('click', activateButtonAudio, true)
  }, [screen])

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

  const closeEntryPanels = useCallback(() => {
    setNestedPanel(null)
    setEntryPanel(null)
  }, [])

  return (
    <>
      {screen === 'playing' ? (
        <TitleReturnProvider value={returnToTitle}>
          <GameWorkspace />
        </TitleReturnProvider>
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
        <DetailPanelErrorBoundary
          key="title-detail:settings"
          onClose={closeEntryPanels}
          returnFocus={() => titleSettingsTriggerRef.current}
        >
          <Suspense
            fallback={(
              <DetailLayerLoadingShell
                activePanel="settings"
                onClose={closeEntryPanels}
                returnFocus={() => titleSettingsTriggerRef.current}
              />
            )}
          >
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
        </DetailPanelErrorBoundary>
      ) : null}
      {screen !== 'playing' && nestedPanel ? (
        <DetailPanelErrorBoundary
          key={`title-nested-detail:${nestedPanel}`}
          onClose={() => setNestedPanel(null)}
          returnFocus={() => nestedReturnFocusRef.current}
        >
          <Suspense
            fallback={(
              <DetailLayerLoadingShell
                activePanel={nestedPanel}
                onClose={() => setNestedPanel(null)}
                returnFocus={() => nestedReturnFocusRef.current}
              />
            )}
          >
            <DetailLayer
              activePanel={nestedPanel}
              onClose={() => setNestedPanel(null)}
              onOpenGuide={() => undefined}
              onOpenCredits={() => undefined}
              returnFocus={() => nestedReturnFocusRef.current}
            />
          </Suspense>
        </DetailPanelErrorBoundary>
      ) : null}
      {screen !== 'loading' && audioStatus.availability === 'blocked' ? (
        <button
          type="button"
          className="audio-recovery-button"
          aria-label="음악 재생 허용 필요"
          title="음악 재생 허용 필요"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 9v6h4l5 4V5L9 9H5Z" />
            <path d="M17 9.5a4 4 0 0 1 0 5" />
          </svg>
          <span aria-hidden="true" />
        </button>
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
