import { describe, expect, it } from 'vitest'

import {
  ATTRIBUTION_CHOICES,
  INTERCEPTION_ROUTING_SHARES,
  ROOT_MERCY_CHOICES,
  SABOTAGE_OPERATION_CHOICES,
} from './sabotageContracts'

describe('canonical sabotage contracts', () => {
  it('contains the complete twelve-ID operation and attribution allowlist', () => {
    const operationOptionIds = Object.values(SABOTAGE_OPERATION_CHOICES)
      .flatMap((choices) => choices.map(({ id }) => id))
    const attributionSourceIds = ATTRIBUTION_CHOICES.map(
      ({ sourceSignatureId }) => sourceSignatureId,
    )

    expect([...operationOptionIds, ...attributionSourceIds]).toEqual([
      'receipt-model-safety',
      'receipt-tool-locale',
      'adapter-group-b',
      'adapter-group-c',
      'image-green-14',
      'image-blue-09',
      'shadow-router-a',
      'supplier-vector-db',
      'supplier-tool-cache',
      'emergency-deployment-root',
      'status-mirror-b',
      'recovery-notice-a',
    ])
  })

  it('keeps routing shares and mercy decisions exact and ordered', () => {
    expect(INTERCEPTION_ROUTING_SHARES).toEqual([25, 50, 75])
    expect(ROOT_MERCY_CHOICES.map(({ id }) => id)).toEqual([
      'cease',
      'withdraw',
      'delete',
    ])
  })

  it('keeps attribution sources bound to their authored actors', () => {
    expect(ATTRIBUTION_CHOICES.map((choice) => ({
      actor: choice.blamedActorId,
      source: choice.sourceSignatureId,
    }))).toEqual([
      { actor: 'tallow', source: 'status-mirror-b' },
      { actor: 'meridian', source: 'recovery-notice-a' },
    ])
  })
})
