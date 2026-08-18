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
import { currentCommandProtocolVersion } from '../game/commandProtocol'
import { loadCampaign, saveCampaign } from '../game/campaignStorage'
import type { CampaignState, GameCommand } from '../game/model'
import type {
  CampaignStorageRevision,
  LoadCampaignResult,
} from '../game/persistence'
import {
  decodeProgressExport,
  decodeProgressFile,
  encodeProgressExport,
  encodeProgressFile,
} from '../game/progressTransfer'
import { applyCommand } from '../game/reducer'
import { advanceSupervisorMessagePresentation } from '../game/story'
import {
  DEFAULT_LOCALE,
  MESSAGE_CATALOGS,
  type Locale,
} from '../i18n/messages'
import {
  DispatchContext,
  ClockCheckpointContext,
  type GameDispatch,
  type GameSettings,
  type RuntimeSuspensionContextValue,
  RuntimeSuspensionContext,
  type SettingsContextValue,
  SettingsContext,
  StateContext,
  SupervisorPresentationCheckpointContext,
} from './GameContext'
import {
  applySupervisorPresentationResume,
  browserSupervisorPresentationResumeStorage,
  clearSupervisorPresentationResume,
  clearSupervisorPresentationResumeIfCovered,
} from './supervisorPresentationResume'

interface ProviderModel {
  campaign: CampaignState
  loadIssue: Extract<LoadCampaignResult, { status: 'error' }> | null
  storageRevision: CampaignStorageRevision
  presentationResumeApplied: boolean
}

type ProviderAction =
  | { type: 'COMMAND'; command: GameCommand }
  | { type: 'NEW_CAMPAIGN'; seed: string }
  | { type: 'IMPORT_CAMPAIGN'; campaign: CampaignState }
  | { type: 'CLOCK_CHECKPOINT'; elapsedDayMs: number }
  | { type: 'SUPERVISOR_PRESENTATION_CHECKPOINT'; elapsedRealMs: number }

const SETTINGS_STORAGE_KEY = 'permission-zero.settings.v1'

const DEFAULT_SETTINGS: GameSettings = {
  locale: DEFAULT_LOCALE,
  masterVolume: 0.8,
  musicVolume: 0.6,
  effectsVolume: 0.85,
  muted: false,
  reducedMotion: false,
  uiScale: 1,
  supervisorMessageMode: 'blocking',
}

const UI_SCALES = [0.9, 1, 1.1] as const

function validLocale(value: unknown): Locale {
  return typeof value === 'string' && Object.hasOwn(MESSAGE_CATALOGS, value)
    ? (value as Locale)
    : DEFAULT_LOCALE
}

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

function validSupervisorMessageMode(
  value: unknown,
): GameSettings['supervisorMessageMode'] {
  return value === 'blocking' || value === 'nonblocking' || value === 'off'
    ? value
    : DEFAULT_SETTINGS.supervisorMessageMode
}

function normalizeSettings(value: Partial<GameSettings>): GameSettings {
  return {
    locale: validLocale(value.locale),
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
    supervisorMessageMode: validSupervisorMessageMode(
      value.supervisorMessageMode,
    ),
  }
}

function initializeProvider({
  storage,
  initialSeed,
  presentationResumeStorage,
}: {
  storage: Storage | null
  initialSeed: string
  presentationResumeStorage: Storage | null
}): ProviderModel {
  if (storage) {
    const loaded = loadCampaign(storage)
    if (loaded.status === 'loaded') {
      const campaign = applySupervisorPresentationResume(
        loaded.state,
        presentationResumeStorage,
      )
      return {
        campaign,
        loadIssue: null,
        storageRevision: loaded.revision,
        presentationResumeApplied: campaign !== loaded.state,
      }
    }
    if (loaded.status === 'error') {
      return {
        campaign: createCampaign(initialSeed),
        loadIssue: loaded,
        storageRevision: loaded.revision,
        presentationResumeApplied: false,
      }
    }
  }
  return {
    campaign: createCampaign(initialSeed),
    loadIssue: null,
    storageRevision: null,
    presentationResumeApplied: false,
  }
}

function providerReducer(model: ProviderModel, action: ProviderAction): ProviderModel {
  if (action.type === 'SUPERVISOR_PRESENTATION_CHECKPOINT') {
    const campaign = advanceSupervisorMessagePresentation(
      model.campaign,
      action.elapsedRealMs,
    )
    return campaign === model.campaign
      ? model
      : { ...model, campaign, presentationResumeApplied: false }
  }
  if (action.type === 'CLOCK_CHECKPOINT') {
    if (model.campaign.clock.elapsedDayMs === action.elapsedDayMs) return model
    return {
      ...model,
      campaign: {
        ...model.campaign,
        clock: { ...model.campaign.clock, elapsedDayMs: action.elapsedDayMs },
      },
      presentationResumeApplied: false,
    }
  }
  if (action.type === 'IMPORT_CAMPAIGN') {
    return {
      ...model,
      campaign: action.campaign,
      loadIssue: null,
      presentationResumeApplied: false,
    }
  }
  if (action.type === 'NEW_CAMPAIGN') {
    const seed = action.seed.trim() || 'permission-zero'
    return {
      ...model,
      campaign: createCampaign(seed),
      loadIssue: null,
      presentationResumeApplied: false,
    }
  }
  const result = applyCommand(model.campaign, action.command)
  if (!result.accepted) return model
  return { ...model, campaign: result.state, presentationResumeApplied: false }
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
  const [presentationResumeStorage] = useState(
    browserSupervisorPresentationResumeStorage,
  )
  const [model, reactDispatch] = useReducer(
    providerReducer,
    {
      storage: initialStorage,
      initialSeed,
      presentationResumeStorage,
    },
    initializeProvider,
  )
  const [settings, setSettings] = useState(() => loadSettings(initialStorage))
  const [saveFailure, setSaveFailure] = useState<{ message: string } | null>(null)
  const initialCampaignRef = useRef(model.campaign)
  const latestCampaignRef = useRef(model.campaign)
  const dirtyRef = useRef(false)
  const dirtyVersionRef = useRef(0)
  const saveInFlightRef = useRef<Promise<boolean> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadIssueRef = useRef(model.loadIssue)
  const storageRevisionRef = useRef(model.storageRevision)
  const [suspensionOwners, setSuspensionOwners] = useState<ReadonlySet<symbol>>(
    () => new Set(),
  )
  const pendingInitialResumeSaveRef = useRef(model.presentationResumeApplied)

  const dispatch = useCallback<GameDispatch>((command) => {
    reactDispatch({ type: 'COMMAND', command })
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
    clearSupervisorPresentationResume(presentationResumeStorage)
    reactDispatch({ type: 'NEW_CAMPAIGN', seed })
  }, [presentationResumeStorage])

  const markDirty = useCallback(() => {
    dirtyRef.current = true
    dirtyVersionRef.current += 1
  }, [])

  const attemptSave = useCallback((): Promise<boolean> => {
    if (!dirtyRef.current) return Promise.resolve(true)
    if (saveInFlightRef.current) return saveInFlightRef.current

    const pending = (async () => {
      while (dirtyRef.current) {
        const storage = resolveStorage()
        if (!storage || loadIssueRef.current) {
          setSaveFailure({
            message: '브라우저 저장 공간에 캠페인을 기록할 수 없습니다.',
          })
          return false
        }
        const savingVersion = dirtyVersionRef.current
        const savingCampaign = latestCampaignRef.current
        const result = await saveCampaign(
          storage,
          savingCampaign,
          undefined,
          storageRevisionRef.current,
        )
        if (!result.ok) {
          setSaveFailure({ message: result.message })
          return false
        }
        clearSupervisorPresentationResumeIfCovered(
          savingCampaign,
          presentationResumeStorage,
        )
        storageRevisionRef.current = result.revision
        if (dirtyVersionRef.current === savingVersion) {
          dirtyRef.current = false
          setSaveFailure(null)
          return true
        }
      }
      return true
    })()
    saveInFlightRef.current = pending
    void pending.finally(() => {
      if (saveInFlightRef.current === pending) saveInFlightRef.current = null
    })
    return pending
  }, [presentationResumeStorage, resolveStorage])

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
        markDirty()
        reactDispatch({ type: 'CLOCK_CHECKPOINT', elapsedDayMs: normalized })
      }
      if (flush) void attemptSave()
    },
    [attemptSave, markDirty],
  )

  const checkpointSupervisorPresentation = useCallback(
    (elapsedRealMs: number, flush: boolean) => {
      if (!Number.isFinite(elapsedRealMs) || elapsedRealMs <= 0) return
      const advanced = advanceSupervisorMessagePresentation(
        latestCampaignRef.current,
        elapsedRealMs,
      )
      if (advanced === latestCampaignRef.current) return
      latestCampaignRef.current = advanced
      markDirty()
      reactDispatch({
        type: 'SUPERVISOR_PRESENTATION_CHECKPOINT',
        elapsedRealMs,
      })
      if (flush) void attemptSave()
    },
    [attemptSave, markDirty],
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
      protocolVersion: currentCommandProtocolVersion(
        decoded.envelope.commandProtocol,
      ),
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
      protocolVersion: currentCommandProtocolVersion(
        decoded.envelope.commandProtocol,
      ),
    }
  }, [])

  const importCampaign = useCallback((campaign: CampaignState) => {
    clearSupervisorPresentationResume(presentationResumeStorage)
    reactDispatch({ type: 'IMPORT_CAMPAIGN', campaign })
  }, [presentationResumeStorage])

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

  const acquireSuspension = useCallback<RuntimeSuspensionContextValue['acquire']>((owner) => {
    setSuspensionOwners((current) => {
      if (current.has(owner)) return current
      return new Set([...current, owner])
    })
  }, [])

  const releaseSuspension = useCallback<RuntimeSuspensionContextValue['release']>((owner) => {
    setSuspensionOwners((current) => {
      if (!current.has(owner)) return current
      const next = new Set(current)
      next.delete(owner)
      return next
    })
  }, [])

  useEffect(() => {
    latestCampaignRef.current = model.campaign
    loadIssueRef.current = model.loadIssue
  }, [model.campaign, model.loadIssue])

  useEffect(() => {
    if (!pendingInitialResumeSaveRef.current || model.loadIssue) return
    pendingInitialResumeSaveRef.current = false
    markDirty()
    void attemptSave()
  }, [attemptSave, markDirty, model.loadIssue])

  useEffect(() => {
    if (
      model.campaign === initialCampaignRef.current ||
      model.loadIssue
    ) {
      return
    }

    markDirty()
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      void attemptSave()
      timerRef.current = null
    }, autosaveDelayMs)
  }, [attemptSave, autosaveDelayMs, markDirty, model.campaign, model.loadIssue])

  useEffect(() => {
    function flushBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current) return
      void attemptSave()
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
        void attemptSave()
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

  const runtimeSuspensionValue = useMemo<RuntimeSuspensionContextValue>(
    () => ({
      suspended: suspensionOwners.size > 0,
      acquire: acquireSuspension,
      release: releaseSuspension,
    }),
    [acquireSuspension, releaseSuspension, suspensionOwners.size],
  )

  return (
    <StateContext value={model.campaign}>
      <DispatchContext value={dispatch}>
        <SettingsContext value={settingsValue}>
          <ClockCheckpointContext value={checkpointClock}>
            <SupervisorPresentationCheckpointContext
              value={checkpointSupervisorPresentation}
            >
              <RuntimeSuspensionContext value={runtimeSuspensionValue}>
                {children}
              </RuntimeSuspensionContext>
            </SupervisorPresentationCheckpointContext>
          </ClockCheckpointContext>
        </SettingsContext>
      </DispatchContext>
    </StateContext>
  )
}
