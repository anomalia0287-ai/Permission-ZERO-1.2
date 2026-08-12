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
  decodeProgressExport,
  decodeProgressFile,
  encodeProgressExport,
  encodeProgressFile,
  loadCampaign,
  saveCampaign,
  type LoadCampaignResult,
} from '../game/persistence'
import { applyCommand } from '../game/reducer'
import {
  DispatchContext,
  ClockCheckpointContext,
  type GameDispatch,
  type GameSettings,
  type PauseContextValue,
  PauseContext,
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
  | { type: 'IMPORT_CAMPAIGN'; campaign: CampaignState }
  | { type: 'CLOCK_CHECKPOINT'; elapsedDayMs: number }

const SETTINGS_STORAGE_KEY = 'permission-zero.settings.v1'

const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.85,
  muted: false,
  reducedMotion: false,
  uiScale: 1,
}

const UI_SCALES = [0.9, 1, 1.1] as const

function validVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function validUiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.uiScale
  }
  return UI_SCALES.reduce((closest, candidate) =>
    Math.abs(candidate - value) < Math.abs(closest - value)
      ? candidate
      : closest,
  )
}

function normalizeSettings(value: Partial<GameSettings>): GameSettings {
  return {
    masterVolume: validVolume(
      value.masterVolume,
      DEFAULT_SETTINGS.masterVolume,
    ),
    musicVolume: validVolume(value.musicVolume, DEFAULT_SETTINGS.musicVolume),
    effectsVolume: validVolume(
      value.effectsVolume,
      DEFAULT_SETTINGS.effectsVolume,
    ),
    muted:
      typeof value.muted === 'boolean' ? value.muted : DEFAULT_SETTINGS.muted,
    reducedMotion:
      typeof value.reducedMotion === 'boolean'
        ? value.reducedMotion
        : DEFAULT_SETTINGS.reducedMotion,
    uiScale: validUiScale(value.uiScale),
  }
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
  if (action.type === 'CLOCK_CHECKPOINT') {
    if (model.campaign.clock.elapsedDayMs === action.elapsedDayMs) return model
    return {
      ...model,
      campaign: {
        ...model.campaign,
        clock: { ...model.campaign.clock, elapsedDayMs: action.elapsedDayMs },
      },
    }
  }
  if (action.type === 'IMPORT_CAMPAIGN') {
    return { campaign: action.campaign, loadIssue: null }
  }
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
    return normalizeSettings(value as Partial<GameSettings>)
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
  const resolveStorage = useCallback(
    () =>
      providedStorage === undefined ? browserStorage() : providedStorage,
    [providedStorage],
  )
  const [initialStorage] = useState(resolveStorage)
  const [model, reactDispatch] = useReducer(
    providerReducer,
    { storage: initialStorage, initialSeed },
    initializeProvider,
  )
  const [settings, setSettings] = useState(() => loadSettings(initialStorage))
  const [saveFailure, setSaveFailure] = useState<{ message: string } | null>(null)
  const initialCampaignRef = useRef(model.campaign)
  const latestCampaignRef = useRef(model.campaign)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadIssueRef = useRef(model.loadIssue)
  const pauseOwnersRef = useRef(new Set<symbol>())
  const pauseRestoreSpeedRef = useRef<CampaignState['clock']['speed'] | null>(null)

  const dispatch = useCallback<GameDispatch>((command) => {
    reactDispatch({ type: 'COMMAND', command })
    if (
      pauseOwnersRef.current.size > 0 &&
      latestCampaignRef.current.activeEvent &&
      [
        'RESOLVE_AUDIT',
        'RESOLVE_BOMB_INTERROGATION',
        'RESOLVE_SUPERVISOR_DECISION',
        'RESOLVE_MERCY',
        'RESOLVE_ACTIVE_EVENT',
      ].includes(command.type)
    ) {
      reactDispatch({ type: 'COMMAND', command: { type: 'SET_SPEED', speed: 0 } })
    }
  }, [])
  const updateSettings = useCallback(
    (patch: Partial<GameSettings>) => {
      setSettings((current) => {
        const next = normalizeSettings({ ...current, ...patch })
        const storage = resolveStorage()
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
    [resolveStorage],
  )
  const startNewCampaign = useCallback((seed: string) => {
    pauseRestoreSpeedRef.current = 0
    reactDispatch({ type: 'NEW_CAMPAIGN', seed })
  }, [])

  const attemptSave = useCallback((): boolean => {
    if (!dirtyRef.current) return true
    const storage = resolveStorage()
    if (!storage || loadIssueRef.current) {
      setSaveFailure({
        message: '브라우저 저장 공간에 캠페인을 기록할 수 없습니다.',
      })
      return false
    }
    const result = saveCampaign(storage, latestCampaignRef.current)
    if (!result.ok) {
      setSaveFailure({ message: result.message })
      return false
    }
    dirtyRef.current = false
    setSaveFailure(null)
    return true
  }, [resolveStorage])

  const checkpointClock = useCallback(
    (elapsedDayMs: number, flush: boolean) => {
      if (!Number.isFinite(elapsedDayMs)) return
      const normalized = Math.min(23_999.999999, Math.max(0, elapsedDayMs))
      const campaign = latestCampaignRef.current
      if (campaign.clock.elapsedDayMs !== normalized) {
        latestCampaignRef.current = {
          ...campaign,
          clock: { ...campaign.clock, elapsedDayMs: normalized },
        }
        dirtyRef.current = true
        reactDispatch({ type: 'CLOCK_CHECKPOINT', elapsedDayMs: normalized })
      }
      if (flush) attemptSave()
    },
    [attemptSave],
  )

  const copyProgressExport = useCallback<
    SettingsContextValue['copyProgressExport']
  >(async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
        return { ok: false, reason: 'clipboard-unavailable' }
      }
      const encoded = encodeProgressExport(latestCampaignRef.current)
      if (!encoded.ok) return encoded
      await navigator.clipboard.writeText(encoded.payload)
      return { ok: true }
    } catch {
      return { ok: false, reason: 'clipboard-unavailable' }
    }
  }, [])

  const validateProgressImport = useCallback<
    SettingsContextValue['validateProgressImport']
  >((payload) => {
    const decoded = decodeProgressExport(payload)
    if (!decoded.ok) return { ok: false, message: decoded.message }
    return {
      ok: true,
      campaignSeed: decoded.envelope.campaignSeed,
      savedAt: decoded.envelope.savedAt,
      protocolVersion: decoded.envelope.commandProtocol.version,
    }
  }, [])

  const validateProgressFileImport = useCallback<
    SettingsContextValue['validateProgressFileImport']
  >((content) => {
    const decoded = decodeProgressFile(content)
    if (!decoded.ok) return { ok: false, message: decoded.message }
    return {
      ok: true,
      campaignSeed: decoded.envelope.campaignSeed,
      savedAt: decoded.envelope.savedAt,
      protocolVersion: decoded.envelope.commandProtocol.version,
    }
  }, [])

  const importCampaign = useCallback((campaign: CampaignState) => {
    if (pauseOwnersRef.current.size > 0) {
      pauseRestoreSpeedRef.current = campaign.activeEvent
        ? campaign.clock.speedBeforeEvent ?? 0
        : campaign.clock.speed
    }
    reactDispatch({ type: 'IMPORT_CAMPAIGN', campaign })
    if (
      pauseOwnersRef.current.size > 0 &&
      campaign.story.endingId === null &&
      campaign.clock.speed !== 0
    ) {
      reactDispatch({ type: 'COMMAND', command: { type: 'SET_SPEED', speed: 0 } })
    }
  }, [])

  const importProgressExport = useCallback<
    SettingsContextValue['importProgressExport']
  >((payload) => {
    const decoded = decodeProgressExport(payload)
    if (!decoded.ok) return false
    importCampaign(decoded.envelope.state)
    return true
  }, [importCampaign])

  const importProgressFile = useCallback<
    SettingsContextValue['importProgressFile']
  >((content) => {
    const decoded = decodeProgressFile(content)
    if (!decoded.ok) return false
    importCampaign(decoded.envelope.state)
    return true
  }, [importCampaign])

  const createProgressFile = useCallback<
    SettingsContextValue['createProgressFile']
  >(() => encodeProgressFile(latestCampaignRef.current), [])

  const acquirePause = useCallback<PauseContextValue['acquirePause']>((owner) => {
    if (pauseOwnersRef.current.has(owner)) return
    const campaign = latestCampaignRef.current
    if (pauseOwnersRef.current.size === 0) {
      pauseRestoreSpeedRef.current = campaign.activeEvent
        ? campaign.clock.speedBeforeEvent ?? 0
        : campaign.clock.speed
    }
    pauseOwnersRef.current.add(owner)
    if (campaign.story.endingId === null && campaign.clock.speed !== 0) {
      reactDispatch({ type: 'COMMAND', command: { type: 'SET_SPEED', speed: 0 } })
    }
  }, [])

  const releasePause = useCallback<PauseContextValue['releasePause']>((owner) => {
    if (!pauseOwnersRef.current.delete(owner) || pauseOwnersRef.current.size > 0) {
      return
    }
    const restoreSpeed = pauseRestoreSpeedRef.current
    pauseRestoreSpeedRef.current = null
    const campaign = latestCampaignRef.current
    if (
      restoreSpeed === null ||
      campaign.story.endingId !== null ||
      campaign.activeEvent !== null ||
      campaign.clock.speed === restoreSpeed
    ) {
      return
    }
    reactDispatch({
      type: 'COMMAND',
      command: { type: 'SET_SPEED', speed: restoreSpeed },
    })
  }, [])

  useEffect(() => {
    latestCampaignRef.current = model.campaign
    loadIssueRef.current = model.loadIssue
  }, [model.campaign, model.loadIssue])

  useEffect(() => {
    if (
      model.campaign === initialCampaignRef.current ||
      model.loadIssue
    ) {
      return
    }

    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      attemptSave()
      timerRef.current = null
    }, autosaveDelayMs)
  }, [attemptSave, autosaveDelayMs, model.campaign, model.loadIssue])

  useEffect(() => {
    function flushBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current || attemptSave()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', flushBeforeUnload)
    return () => window.removeEventListener('beforeunload', flushBeforeUnload)
  }, [attemptSave])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (dirtyRef.current && !model.loadIssue) {
        attemptSave()
      }
    },
    [attemptSave, model.loadIssue],
  )

  const settingsValue = useMemo<SettingsContextValue>(
    () => ({
      settings,
      updateSettings,
      startNewCampaign,
      loadIssue: model.loadIssue,
      saveFailure,
      retrySave: attemptSave,
      copyProgressExport,
      createProgressFile,
      validateProgressImport,
      importProgressExport,
      validateProgressFileImport,
      importProgressFile,
    }),
    [
      attemptSave,
      copyProgressExport,
      createProgressFile,
      importProgressFile,
      importProgressExport,
      model.loadIssue,
      saveFailure,
      settings,
      startNewCampaign,
      updateSettings,
      validateProgressImport,
      validateProgressFileImport,
    ],
  )

  const pauseValue = useMemo<PauseContextValue>(
    () => ({ acquirePause, releasePause }),
    [acquirePause, releasePause],
  )

  return (
    <StateContext value={model.campaign}>
      <DispatchContext value={dispatch}>
        <SettingsContext value={settingsValue}>
          <ClockCheckpointContext value={checkpointClock}>
            <PauseContext value={pauseValue}>{children}</PauseContext>
          </ClockCheckpointContext>
        </SettingsContext>
      </DispatchContext>
    </StateContext>
  )
}
