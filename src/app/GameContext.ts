import { createContext, type Dispatch, useContext } from 'react'

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
  loadIssue: Extract<LoadCampaignResult, { status: 'error' }> | null
}

export type GameDispatch = Dispatch<GameCommand>

export const StateContext = createContext<CampaignState | null>(null)
export const DispatchContext = createContext<GameDispatch | null>(null)
export const SettingsContext = createContext<SettingsContextValue | null>(null)

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
