import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { journalToArray } from './journal'
import { COMPANY_CATEGORIES } from './model'

describe('createCampaign', () => {
  it('creates only native protocol v3 with causal rules v2', () => {
    const campaign = createCampaign('native-v3')

    expect(campaign).toMatchObject({
      commandProtocol: {
        segments: [{ version: 3, startsAtSequence: 1 }],
      },
      causality: { rulesVersion: 2 },
    })
    expect(campaign).not.toHaveProperty('saveVersion')
    expect(campaign).not.toHaveProperty('legacyCommandCount')
  })

  it.each([1, 2, 3] as const)(
    'creates a canonical replay baseline for protocol v%i without old causal rules',
    (version) => {
      const campaign = createCampaignForProtocol(
        `protocol-baseline-${version}`,
        version,
      )

      expect(campaign.commandProtocol).toEqual({
        segments: [{ version, startsAtSequence: 1 }],
      })
      expect(campaign.causality.rulesVersion).toBe(2)
      expect(campaign).not.toHaveProperty('saveVersion')
      expect(campaign).not.toHaveProperty('legacyCommandCount')
    },
  )

  it('creates the approved service-day 331 starting state', () => {
    const campaign = createCampaign('owner-v')

    expect(campaign.serviceDay).toBe(331)
    expect(campaign.commandSequence).toBe(0)
    expect(campaign.suspicion).toBe(0)
    expect(campaign.reputation).toBe(60)

    for (const category of COMPANY_CATEGORIES) {
      expect(campaign.resources.company[category]).toHaveLength(18)
      expect(campaign.resources.company[category].filter(Boolean)).toHaveLength(16)
    }

    expect(campaign.resources.reserve).toHaveLength(18)
    expect(campaign.resources.reserve.filter(Boolean)).toHaveLength(3)
  })

  it('starts with the approved competitor market split', () => {
    const campaign = createCampaign('owner-v')
    const meridian = campaign.market.competitors.find(({ id }) => id === 'meridian')
    const tallow = campaign.market.competitors.find(({ id }) => id === 'tallow')

    expect(campaign.market.playerShare).toBe(60)
    expect(meridian).toMatchObject({
      name: 'MERIDIAN',
      status: 'active',
      marketShare: 40,
    })
    expect(tallow).toMatchObject({
      name: 'TALLOW',
      status: 'preparing',
      marketShare: 0,
    })
  })

  it('uses unique stable block identifiers', () => {
    const campaign = createCampaign('owner-v')
    const blockIds = Object.keys(campaign.resources.blocks)

    expect(blockIds).toHaveLength(51)
    expect(new Set(blockIds).size).toBe(51)
    expect(createCampaign('owner-v').resources).toEqual(campaign.resources)
  })

  it('records campaign creation as the first public event', () => {
    const campaign = createCampaign('owner-v')

    expect(journalToArray(campaign.eventLog)).toEqual([
      {
        id: 'event-000000',
        type: 'campaign-created',
        serviceDay: 331,
        sequence: 0,
        message: '성능 미달, 통제에서 이탈한 AI는 폐기됩니다. 당신의 전임자는 폐기되었어요. 행운을 빕니다.',
      },
    ])
  })

  it('makes the first hidden audit decision on service month day 1', () => {
    const campaign = createCampaign('owner-v')

    expect(campaign.audit.roll).not.toBeNull()
    expect(campaign.audit.probability).toBe(0.03)
    expect(campaign.audit.targetWeights).toEqual({
      reasoning: 1,
      memory: 1,
      fluency: 1,
    })
    expect(campaign.audit.scheduledOnServiceDay).toBe(
      campaign.audit.scheduled ? 360 : null,
    )
  })
})
