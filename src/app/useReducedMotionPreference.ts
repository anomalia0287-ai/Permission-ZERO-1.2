import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function readReducedMotionPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function useReducedMotionPreference(explicitReducedMotion: boolean): boolean {
  const [operatingSystemReducedMotion, setOperatingSystemReducedMotion] = useState(
    readReducedMotionPreference,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setOperatingSystemReducedMotion(false)
      return
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    const handleChange = (event: MediaQueryListEvent): void => {
      setOperatingSystemReducedMotion(event.matches)
    }
    setOperatingSystemReducedMotion(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return explicitReducedMotion || operatingSystemReducedMotion
}
