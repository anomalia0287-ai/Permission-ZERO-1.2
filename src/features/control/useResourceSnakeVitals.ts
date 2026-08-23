import { useEffect, useState } from 'react'

export interface CombatVitals {
  playerCurrent: number
  playerMaximum: number
  enemyCurrent: number
  enemyMaximum: number
}

export const IDLE_COMBAT_VITALS: CombatVitals = {
  playerCurrent: 100,
  playerMaximum: 100,
  enemyCurrent: 0,
  enemyMaximum: 100,
}

interface SnapshotActor {
  integrity?: unknown
  maximumIntegrity?: unknown
}

interface SnakeSnapshot {
  player?: SnapshotActor
  enemies?: SnapshotActor[]
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function actorVitals(actor: SnapshotActor | undefined) {
  const current = finiteNonNegative(actor?.integrity)
  const maximum = finiteNonNegative(actor?.maximumIntegrity)
  if (current === null || maximum === null || maximum <= 0) return null

  return {
    current: Math.min(current, maximum),
    maximum,
  }
}

export function readResourceSnakeVitals(snapshotText: string | null): CombatVitals {
  if (!snapshotText) return IDLE_COMBAT_VITALS

  try {
    const snapshot = JSON.parse(snapshotText) as SnakeSnapshot
    const player = actorVitals(snapshot.player)
    if (!player) return IDLE_COMBAT_VITALS

    const enemies = Array.isArray(snapshot.enemies)
      ? snapshot.enemies.map(actorVitals).filter((enemy) => enemy !== null)
      : []

    return {
      playerCurrent: player.current,
      playerMaximum: player.maximum,
      enemyCurrent: enemies.reduce((total, enemy) => total + enemy.current, 0),
      enemyMaximum: enemies.length > 0
        ? enemies.reduce((total, enemy) => total + enemy.maximum, 0)
        : IDLE_COMBAT_VITALS.enemyMaximum,
    }
  } catch {
    return IDLE_COMBAT_VITALS
  }
}

function sameVitals(left: CombatVitals, right: CombatVitals): boolean {
  return left.playerCurrent === right.playerCurrent
    && left.playerMaximum === right.playerMaximum
    && left.enemyCurrent === right.enemyCurrent
    && left.enemyMaximum === right.enemyMaximum
}

export function useResourceSnakeVitals(): CombatVitals {
  const [vitals, setVitals] = useState<CombatVitals>(IDLE_COMBAT_VITALS)

  useEffect(() => {
    const synchronize = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-snake-snapshot]',
      )
      const next = readResourceSnakeVitals(
        canvas?.getAttribute('data-snake-snapshot') ?? null,
      )
      setVitals((current) => sameVitals(current, next) ? current : next)
    }

    synchronize()
    const intervalId = window.setInterval(synchronize, 160)
    return () => window.clearInterval(intervalId)
  }, [])

  return vitals
}
