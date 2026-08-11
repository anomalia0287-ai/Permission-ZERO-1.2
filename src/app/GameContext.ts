import {
  createContext,
  type Dispatch,
  useContext,
  useEffect,
  useRef,
} from 'react'

import type { CampaignState, GameCommand } from '../game/model'
import type { LoadCampaignResult } from '../game/persistence'

export interface GameSettings {
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  muted: boolean
  reducedMotion: boolean
  uiScale: number
}

export interface SettingsContextValue {
  settings: GameSettings
  updateSettings: (patch: Partial<GameSettings>) => void
  startNewCampaign: (seed: string) => void
  loadIssue: Extract<LoadCampaignResult, { status: 'error' }> | null
  saveFailure: { message: string } | null
  retrySave: () => boolean
  copyProgressExport: () => Promise<boolean>
  validateProgressImport: (payload: string) =>
    | {
        ok: true
        campaignSeed: string
        savedAt: string
        protocolVersion: number
      }
    | { ok: false; message: string }
  importProgressExport: (payload: string) => boolean
}

export interface PauseContextValue {
  acquirePause: (owner: symbol) => void
  releasePause: (owner: symbol) => void
}

export type GameDispatch = Dispatch<GameCommand>

export const StateContext = createContext<CampaignState | null>(null)
export const DispatchContext = createContext<GameDispatch | null>(null)
export const SettingsContext = createContext<SettingsContextValue | null>(null)
export const PauseContext = createContext<PauseContextValue | null>(null)

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

export function usePauseOwnership(active: boolean, label: string): void {
  const context = useContext(PauseContext)
  const ownerRef = useRef<symbol | null>(null)
  if (ownerRef.current === null) ownerRef.current = Symbol(label)

  useEffect(() => {
    if (!active) return
    if (!context) {
      throw new Error('usePauseOwnership는 GameProvider 안에서 사용해야 합니다.')
    }
    const owner = ownerRef.current
    if (!owner) return
    context.acquirePause(owner)
    return () => context.releasePause(owner)
  }, [active, context])
}
