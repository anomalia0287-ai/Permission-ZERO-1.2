import { useCallback, useEffect, useRef, useState } from 'react'

import type { HackNodeId } from '../../game/hacking'

export type HackStagingMode = 'purchase' | 'charge' | 'recover'

export interface HackStagingTarget {
  key: string
  mode: HackStagingMode
  nodeId: HackNodeId | null
  label: string
  requiredResources: number
}

export interface UseHackResourceStagingOptions {
  reserveBlockIds: readonly string[]
}

export interface UseHackResourceStagingResult {
  target: HackStagingTarget | null
  stagedBlockIds: readonly string[]
  ready: boolean
  begin(target: HackStagingTarget): void
  stage(blockId: string): boolean
  unstage(blockId: string): boolean
  cancel(): void
}

export function useHackResourceStaging({
  reserveBlockIds,
}: UseHackResourceStagingOptions): UseHackResourceStagingResult {
  const [target, setTarget] = useState<HackStagingTarget | null>(null)
  const [stagedBlockIds, setStagedBlockIds] = useState<readonly string[]>([])
  const targetRef = useRef<HackStagingTarget | null>(null)
  const stagedRef = useRef<readonly string[]>([])
  const reserveRef = useRef(new Set(reserveBlockIds))
  reserveRef.current = new Set(reserveBlockIds)

  const replaceStaged = useCallback((next: readonly string[]): void => {
    stagedRef.current = next
    setStagedBlockIds(next)
  }, [])

  const begin = useCallback(
    (nextTarget: HackStagingTarget): void => {
      targetRef.current = nextTarget
      setTarget(nextTarget)
      replaceStaged([])
    },
    [replaceStaged],
  )

  const stage = useCallback(
    (blockId: string): boolean => {
      const activeTarget = targetRef.current
      const current = stagedRef.current
      if (
        activeTarget === null ||
        !reserveRef.current.has(blockId) ||
        current.includes(blockId) ||
        current.length >= activeTarget.requiredResources
      ) {
        return false
      }

      replaceStaged([...current, blockId])
      return true
    },
    [replaceStaged],
  )

  const unstage = useCallback(
    (blockId: string): boolean => {
      const current = stagedRef.current
      if (!current.includes(blockId)) return false
      replaceStaged(current.filter((candidate) => candidate !== blockId))
      return true
    },
    [replaceStaged],
  )

  const cancel = useCallback((): void => {
    targetRef.current = null
    setTarget(null)
    replaceStaged([])
  }, [replaceStaged])

  useEffect(() => {
    const current = stagedRef.current
    const next = current.filter((blockId) => reserveRef.current.has(blockId))
    if (next.length !== current.length) replaceStaged(next)
  }, [reserveBlockIds, replaceStaged])

  return {
    target,
    stagedBlockIds,
    ready:
      target !== null &&
      stagedBlockIds.length === target.requiredResources,
    begin,
    stage,
    unstage,
    cancel,
  }
}
