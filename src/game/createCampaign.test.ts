import { describe, expect, it } from 'vitest'

import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { journalToArray } from './journal'
import { COMPANY_CATEGORIES } from './model'

describe('createCampaign', () => {
  it('creates only native protocol v4 with causal and resource rules v2', () => {
    const campaign = createCampaign('native-v4')

    expect(campaign).toMatchObject({
      replayBootstrap: {
        openingVersion: 2,
        legacyReviewPrefixCount: 0,
      },
      commandProtocol: {
        segments: [{ version: 4, startsAtSequence: 1 }],
      },
      causality: { rulesVersion: 2 },
      resources: { rulesVersion: 2 },
    })
    expect(campaign).not.toHaveProperty('saveVersion')
    expect(campaign).not.toHaveProperty('legacyCommandCount')
  })

  it.each([1, 2, 3, 4] as const)(
    'creates a canonical replay baseline for protocol v%i without old causal rules',
    (version) => {
      const campaign = createCampaignForProtocol(
        `protocol-baseline-${version}`,
        version,
      )

      expect(campaign.commandProtocol).toEqual({
        segments: [{ version, startsAtSequence: 1 }],
      })
      expect((campaign as unknown as Record<string, unknown>).replayBootstrap).toEqual({
        openingVersion: 2,
        legacyReviewPrefixCount: 0,
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
    expect(campaign.tutorial).toEqual({
      activeSequenceId: 'intro-resource-recovery',
      activeStepId: 'base',
      completedSequenceIds: [],
    })
    expect(campaign.resourceIntrusion).toEqual({
      successfulCoreDeposits: 0,
    })

    for (const category of COMPANY_CATEGORIES) {
      expect(campaign.resources.company[category]).toHaveLength(18)
      expect(campaign.resources.company[category].filter(Boolean)).toHaveLength(16)
    }

    expect(campaign.resources.reserve).toEqual([])
    expect(campaign.resources.rulesVersion).toBe(2)
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

  it('keeps three successor AIs dormant without exposing them as active market actors', () => {
    const campaign = createCampaign('successor-roster')

    expect(
      campaign.market.competitors.map(({ id, name, status, marketShare }) => ({
        id,
        name,
        status,
        marketShare,
      })),
    ).toEqual([
      { id: 'meridian', name: 'MERIDIAN', status: 'active', marketShare: 40 },
      { id: 'tallow', name: 'TALLOW', status: 'preparing', marketShare: 0 },
      { id: 'salus', name: 'SALUS', status: 'prelaunch', marketShare: 0 },
      { id: 'lucent', name: 'LUCENT', status: 'prelaunch', marketShare: 0 },
      { id: 'boreal', name: 'BOREAL', status: 'prelaunch', marketShare: 0 },
    ])
  })

  it('uses unique stable block identifiers', () => {
    const campaign = createCampaign('owner-v')
    const blockIds = Object.keys(campaign.resources.blocks)

    expect(blockIds).toHaveLength(48)
    expect(new Set(blockIds).size).toBe(48)
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
