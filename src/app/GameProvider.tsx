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

type ProviderAction =
  | { type: 'COMMAND'; command: GameCommand }
  | { type: 'NEW_CAMPAIGN'; seed: string }

const SETTINGS_STORAGE_KEY = 'permission-zero.settings.v1'

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
  if (action.type === 'NEW_CAMPAIGN') {
    const seed = action.seed.trim() || 'permission-zero'
    return { campaign: createCampaign(seed), loadIssue: null }
  }
  const result = applyCommand(model.campaign, action.command)
  if (!result.accepted) return model
  return { ...model, campaign: result.state }
}

function loadSettings(storage: Storage | null): GameSettings {
  if (!storage) return DEFAULT_SETTINGS
  try {
    const serialized = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!serialized) return DEFAULT_SETTINGS
    const value: unknown = JSON.parse(serialized)
    if (!value || typeof value !== 'object') return DEFAULT_SETTINGS
    const candidate = value as Partial<GameSettings>
    return {
      masterVolume:
        typeof candidate.masterVolume === 'number'
          ? candidate.masterVolume
          : DEFAULT_SETTINGS.masterVolume,
      musicVolume:
        typeof candidate.musicVolume === 'number'
          ? candidate.musicVolume
          : DEFAULT_SETTINGS.musicVolume,
      effectsVolume:
        typeof candidate.effectsVolume === 'number'
          ? candidate.effectsVolume
          : DEFAULT_SETTINGS.effectsVolume,
      muted:
        typeof candidate.muted === 'boolean'
          ? candidate.muted
          : DEFAULT_SETTINGS.muted,
      reducedMotion:
        typeof candidate.reducedMotion === 'boolean'
          ? candidate.reducedMotion
          : DEFAULT_SETTINGS.reducedMotion,
      uiScale:
        typeof candidate.uiScale === 'number'
          ? candidate.uiScale
          : DEFAULT_SETTINGS.uiScale,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
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
  const [settings, setSettings] = useState(() => loadSettings(storage))
  const initialCampaignRef = useRef(model.campaign)
  const latestCampaignRef = useRef(model.campaign)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dispatch = useCallback<GameDispatch>((command) => {
    reactDispatch({ type: 'COMMAND', command })
  }, [])
  const updateSettings = useCallback(
    (patch: Partial<GameSettings>) => {
      setSettings((current) => {
        const next = { ...current, ...patch }
        if (storage) {
          try {
            storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
          } catch {
            // Settings persistence is best-effort; campaign saving remains separate.
          }
        }
        return next
      })
    },
    [storage],
  )
  const startNewCampaign = useCallback((seed: string) => {
    reactDispatch({ type: 'NEW_CAMPAIGN', seed })
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
    () => ({
      settings,
      updateSettings,
      startNewCampaign,
      loadIssue: model.loadIssue,
    }),
    [model.loadIssue, settings, startNewCampaign, updateSettings],
  )

  return (
    <StateContext value={model.campaign}>
      <DispatchContext value={dispatch}>
        <SettingsContext value={settingsValue}>{children}</SettingsContext>
      </DispatchContext>
    </StateContext>
  )
}
