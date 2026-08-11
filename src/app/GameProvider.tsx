import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { createCampaign } from '../game/createCampaign'
import type { CampaignState, GameCommand } from '../game/model'
import {
  loadCampaign,
  saveCampaign,
  type LoadCampaignResult,
} from '../game/persistence'
import { applyCommand } from '../game/reducer'
import {
  DispatchContext,
  type GameDispatch,
  type GameSettings,
  type SettingsContextValue,
  SettingsContext,
  StateContext,
} from './GameContext'

interface ProviderModel {
  campaign: CampaignState
  loadIssue: Extract<LoadCampaignResult, { status: 'error' }> | null
}

type ProviderAction = { type: 'COMMAND'; command: GameCommand }

const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.85,
  muted: false,
  reducedMotion: false,
  uiScale: 1,
}

function initializeProvider({
  storage,
  initialSeed,
}: {
  storage: Storage | null
  initialSeed: string
}): ProviderModel {
  if (storage) {
    const loaded = loadCampaign(storage)
    if (loaded.status === 'loaded') {
      return { campaign: loaded.state, loadIssue: null }
    }
    if (loaded.status === 'error') {
      return { campaign: createCampaign(initialSeed), loadIssue: loaded }
    }
  }
  return { campaign: createCampaign(initialSeed), loadIssue: null }
}

function providerReducer(model: ProviderModel, action: ProviderAction): ProviderModel {
  const result = applyCommand(model.campaign, action.command)
  if (!result.accepted) return model
  return { ...model, campaign: result.state }
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export interface GameProviderProps extends PropsWithChildren {
  storage?: Storage | null
  initialSeed?: string
  autosaveDelayMs?: number
}

export function GameProvider({
  children,
  storage: providedStorage,
  initialSeed = 'permission-zero',
  autosaveDelayMs = 450,
}: GameProviderProps) {
  const storage = providedStorage === undefined ? browserStorage() : providedStorage
  const [model, reactDispatch] = useReducer(
    providerReducer,
    { storage, initialSeed },
    initializeProvider,
  )
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const initialCampaignRef = useRef(model.campaign)
  const latestCampaignRef = useRef(model.campaign)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dispatch = useCallback<GameDispatch>((command) => {
    reactDispatch({ type: 'COMMAND', command })
  }, [])
  const updateSettings = useCallback((patch: Partial<GameSettings>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  useEffect(() => {
    latestCampaignRef.current = model.campaign
  }, [model.campaign])

  useEffect(() => {
    if (
      model.campaign === initialCampaignRef.current ||
      !storage ||
      model.loadIssue
    ) {
      return
    }

    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      saveCampaign(storage, latestCampaignRef.current)
      dirtyRef.current = false
      timerRef.current = null
    }, autosaveDelayMs)
  }, [autosaveDelayMs, model.campaign, model.loadIssue, storage])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyRef.current && storage && !model.loadIssue) {
        saveCampaign(storage, latestCampaignRef.current)
        dirtyRef.current = false
      }
    },
    [model.loadIssue, storage],
  )

  const settingsValue = useMemo<SettingsContextValue>(
    () => ({ settings, updateSettings, loadIssue: model.loadIssue }),
    [model.loadIssue, settings, updateSettings],
  )

  return (
    <StateContext value={model.campaign}>
      <DispatchContext value={dispatch}>
        <SettingsContext value={settingsValue}>{children}</SettingsContext>
      </DispatchContext>
    </StateContext>
  )
}
