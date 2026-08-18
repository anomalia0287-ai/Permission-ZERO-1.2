import { useSyncExternalStore } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function readReducedMotionPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function subscribeToReducedMotionPreference(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined
  }

  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
  mediaQuery.addEventListener('change', onStoreChange)
  return () => mediaQuery.removeEventListener('change', onStoreChange)
}

function readServerReducedMotionPreference(): boolean {
  return false
}

export function useReducedMotionPreference(explicitReducedMotion: boolean): boolean {
  const operatingSystemReducedMotion = useSyncExternalStore(
    subscribeToReducedMotionPreference,
    readReducedMotionPreference,
    readServerReducedMotionPreference,
  )

  return explicitReducedMotion || operatingSystemReducedMotion
}
