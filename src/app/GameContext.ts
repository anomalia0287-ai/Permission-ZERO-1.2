import {
  createContext,
  type Dispatch,
  useContext,
  useEffect,
  useRef,
} from 'react'

import type { CampaignState, GameCommand } from '../game/model'
import type { LoadCampaignResult } from '../game/persistence'
import type { ProgressFile } from '../game/progressTransfer'
import type { TutorialProgress } from '../game/tutorialProgress'
import type { Locale } from '../i18n/messages'

export interface GameSettings {
  locale: Locale
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  muted: boolean
  reducedMotion: boolean
  uiScale: number
  supervisorMessageMode: SupervisorMessageMode
}

export type SupervisorMessageMode = 'blocking' | 'nonblocking' | 'off'

export type CopyProgressExportResult =
  | { ok: true }
  | { ok: false; reason: 'too-large' | 'clipboard-unavailable' }

export type ProgressImportValidationResult =
  | {
      ok: true
      campaignSeed: string
      savedAt: string
      protocolVersion: number
    }
  | { ok: false; message: string }

export interface SettingsContextValue {
  settings: GameSettings
  updateSettings: (patch: Partial<GameSettings>) => void
  startNewCampaign: (seed: string) => void
  hasResumableCampaign: boolean
  loadIssue: Extract<LoadCampaignResult, { status: 'error' }> | null
  saveFailure: { message: string } | null
  retrySave: () => Promise<boolean>
  copyProgressExport: () => Promise<CopyProgressExportResult>
  createProgressFile: () => ProgressFile
  validateProgressImport: (payload: string) => ProgressImportValidationResult
  importProgressExport: (payload: string) => boolean
  validateProgressFileImport: (content: string) => ProgressImportValidationResult
  importProgressFile: (content: string) => boolean
}

export interface RuntimeSuspensionContextValue {
  suspended: boolean
  acquire: (owner: symbol) => void
  release: (owner: symbol) => void
}

export interface TutorialProgressContextValue {
  updateTutorialProgress: (next: TutorialProgress, flush?: boolean) => void
}

export type ClockCheckpoint = (elapsedDayMs: number, flush: boolean) => void
export type SupervisorPresentationCheckpoint = (
  elapsedRealMs: number,
  flush: boolean,
) => void

export type GameDispatch = Dispatch<GameCommand>

export const StateContext = createContext<CampaignState | null>(null)
export const DispatchContext = createContext<GameDispatch | null>(null)
export const SettingsContext = createContext<SettingsContextValue | null>(null)
export const RuntimeSuspensionContext =
  createContext<RuntimeSuspensionContextValue | null>(null)
export const ClockCheckpointContext = createContext<ClockCheckpoint | null>(null)
export const SupervisorPresentationCheckpointContext =
  createContext<SupervisorPresentationCheckpoint | null>(null)
export const TutorialProgressContext =
  createContext<TutorialProgressContextValue | null>(null)

export function useGameState(): CampaignState {
  const state = useContext(StateContext)
  if (!state) throw new Error('useGameState는 GameProvider 안에서 사용해야 합니다.')
  return state
}

export function useGameDispatch(): GameDispatch {
  const dispatch = useContext(DispatchContext)
  if (!dispatch) throw new Error('useGameDispatch는 GameProvider 안에서 사용해야 합니다.')
  return dispatch
}

export function useGameSelector<T>(
  selector: (state: CampaignState) => T,
): T {
  return selector(useGameState())
}

export function useGameSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useGameSettings는 GameProvider 안에서 사용해야 합니다.')
  return context
}

export function useClockCheckpoint(): ClockCheckpoint {
  const context = useContext(ClockCheckpointContext)
  if (!context) {
    throw new Error('useClockCheckpoint는 GameProvider 안에서 사용해야 합니다.')
  }
  return context
}

export function useSupervisorPresentationCheckpoint(): SupervisorPresentationCheckpoint {
  const context = useContext(SupervisorPresentationCheckpointContext)
  if (!context) {
    throw new Error(
      'useSupervisorPresentationCheckpoint는 GameProvider 안에서 사용해야 합니다.',
    )
  }
  return context
}

export function useTutorialProgressActions(): TutorialProgressContextValue {
  const context = useContext(TutorialProgressContext)
  if (!context) {
    throw new Error(
      'useTutorialProgressActions는 GameProvider 안에서 사용해야 합니다.',
    )
  }
  return context
}

export function useRuntimeSuspended(): boolean {
  const context = useContext(RuntimeSuspensionContext)
  if (!context) {
    throw new Error('useRuntimeSuspended는 GameProvider 안에서 사용해야 합니다.')
  }
  return context.suspended
}

export function useRuntimeSuspensionOwnership(
  active: boolean,
  label: string,
): void {
  const context = useContext(RuntimeSuspensionContext)
  const ownerRef = useRef<symbol | null>(null)
  if (ownerRef.current === null) ownerRef.current = Symbol(label)

  const acquire = context?.acquire
  const release = context?.release

  useEffect(() => {
    if (!active) return
    if (!acquire || !release) {
      throw new Error(
        'useRuntimeSuspensionOwnership는 GameProvider 안에서 사용해야 합니다.',
      )
    }
    const owner = ownerRef.current
    if (!owner) return
    acquire(owner)
    return () => release(owner)
  }, [acquire, active, release])
}
