import { createContext, useContext } from 'react'

/*
 * Lets the ending screen hand the player back to the title.
 *
 * The entry flow owns the screen state and sits inside the game provider, so
 * the callback travels down rather than through game state. The ending used to
 * offer "새 캠페인 시작", which starts a fresh campaign from the last screen of
 * the previous one; returning to the title is both what the player expects and
 * the only exit that cannot leave a half-swapped campaign behind.
 */
const TitleReturnContext = createContext<(() => void) | null>(null)

export const TitleReturnProvider = TitleReturnContext.Provider

export function useReturnToTitle(): (() => void) | null {
  return useContext(TitleReturnContext)
}
