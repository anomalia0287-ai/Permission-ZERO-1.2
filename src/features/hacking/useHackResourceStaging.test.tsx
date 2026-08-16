import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  useHackResourceStaging,
  type HackStagingTarget,
} from './useHackResourceStaging'

const purchaseTarget: HackStagingTarget = {
  key: 'purchase:sabotage.quality-degradation',
  mode: 'purchase',
  nodeId: 'sabotage.quality-degradation',
  label: '품질 저하',
  requiredResources: 2,
}

const chargeTarget: HackStagingTarget = {
  key: 'charge:sabotage.quality-degradation',
  mode: 'charge',
  nodeId: 'sabotage.quality-degradation',
  label: '품질 저하',
  requiredResources: 1,
}

describe('useHackResourceStaging', () => {
  it('stages each real reserve block once and stops at the target capacity', () => {
    const { result } = renderHook(() =>
      useHackResourceStaging({ reserveBlockIds: ['block-a', 'block-b', 'block-c'] }),
    )

    act(() => result.current.begin(purchaseTarget))
    act(() => {
      expect(result.current.stage('block-a')).toBe(true)
      expect(result.current.stage('block-a')).toBe(false)
      expect(result.current.stage('block-b')).toBe(true)
      expect(result.current.stage('block-c')).toBe(false)
    })

    expect(result.current.stagedBlockIds).toEqual(['block-a', 'block-b'])
    expect(result.current.ready).toBe(true)
  })

  it('returns a staged block to the pocket without changing the reserve input', () => {
    const reserveBlockIds = ['block-a', 'block-b']
    const { result } = renderHook(() =>
      useHackResourceStaging({ reserveBlockIds }),
    )

    act(() => result.current.begin(purchaseTarget))
    act(() => result.current.stage('block-a'))
    act(() => result.current.unstage('block-a'))

    expect(result.current.stagedBlockIds).toEqual([])
    expect(reserveBlockIds).toEqual(['block-a', 'block-b'])
  })

  it('clears prepared blocks when the active node or action changes', () => {
    const { result } = renderHook(() =>
      useHackResourceStaging({ reserveBlockIds: ['block-a', 'block-b'] }),
    )

    act(() => result.current.begin(purchaseTarget))
    act(() => result.current.stage('block-a'))
    act(() => result.current.begin(chargeTarget))

    expect(result.current.target).toEqual(chargeTarget)
    expect(result.current.stagedBlockIds).toEqual([])
    expect(result.current.ready).toBe(false)
  })

  it('prunes a prepared block immediately when it leaves the real reserve', () => {
    const { result, rerender } = renderHook(
      ({ reserveBlockIds }: { reserveBlockIds: readonly string[] }) =>
        useHackResourceStaging({ reserveBlockIds }),
      { initialProps: { reserveBlockIds: ['block-a', 'block-b'] } },
    )

    act(() => result.current.begin(purchaseTarget))
    act(() => result.current.stage('block-a'))
    rerender({ reserveBlockIds: ['block-b'] })

    expect(result.current.stagedBlockIds).toEqual([])
    expect(result.current.ready).toBe(false)
  })

  it('discards all UI-only staging when cancelled', () => {
    const { result } = renderHook(() =>
      useHackResourceStaging({ reserveBlockIds: ['block-a', 'block-b'] }),
    )

    act(() => result.current.begin(purchaseTarget))
    act(() => result.current.stage('block-a'))
    act(() => result.current.cancel())

    expect(result.current.target).toBeNull()
    expect(result.current.stagedBlockIds).toEqual([])
    expect(result.current.ready).toBe(false)
  })
})
