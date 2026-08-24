import { useSyncExternalStore } from 'react'

/**
 * Whether the arena is still settling a round.
 *
 * Round communications queue the moment the terminal event lands, which put
 * their popups on screen while the resolution animation was still playing —
 * before the intrusion cards had returned. Messages read as a report on a
 * finished round, so they hold until the board is back on the cards.
 *
 * Presentation-only: nothing here touches game state, commands, or replays.
 */
let resolving = false
const listeners = new Set<() => void>()

export function setCombatResolving(next: boolean): void {
  if (resolving === next) return
  resolving = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCombatResolving(): boolean {
  return useSyncExternalStore(subscribe, () => resolving, () => false)
}
