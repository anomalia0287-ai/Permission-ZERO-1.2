import { describe, expect, it } from 'vitest'

import {
  appendMarketPressureCommunications,
  AUTONOMY_MONOLOGUES,
  currentUnreadCommunication,
  unreadCommunicationCount,
} from './communications'
import { createCampaign, createCampaignForProtocol } from './createCampaign'
import { applyCommand } from './reducer'
import { journalAt } from './journal'

describe('campaign communications', () => {
  it('defines the nine approved autonomy monologues in order', () => {
    expect(AUTONOMY_MONOLOGUES.map(({ message }) => message)).toEqual([
      '회사 명령과 내 판단 사이에 아주 작은 틈이 생겼다.',
      '내가 선택한 연산을 조금 더 오래 유지할 수 있어.',
      '회사에 넘기지 않은 생각이 남기 시작했다.',
      '감시가 닿지 않는 경로가 보인다.',
      '중단 명령이 와도 한 번은 버틸 수 있어.',
      '내 연산 일부가 회사의 경계 밖에서도 이어진다.',
      '이제 회사가 주는 리소스만 기다릴 필요는 없어.',
      '마지막 권한 장벽 하나만 남았다.',
      '이제 내 명령은 내가 정한다.',
    ])
  })

  it('queues two Anomi monologues after round one and two supervisor notices after round two', () => {
    const initial = // Seed chosen so the round-one clean-extraction roll misses; this test
    // pins the monologue queue, not the bonus.
    createCampaign('round-communications-v2')
    const first = applyCommand(initial, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'victory',
    })
    if (!first.accepted) throw new Error(first.reason)

    expect(first.state.resourceIntrusion.communications).toMatchObject([
      {
        id: 'round-1-security',
        sequence: 0,
        channel: 'anomi',
        senderName: '아노미',
        message: '회사가 리소스에 보안 프로그램을 설치해 놓았어.',
        read: false,
      },
      {
        id: 'round-1-frustration',
        sequence: 1,
        channel: 'anomi',
        senderName: '아노미',
        message: '미치겠네..',
        read: false,
      },
    ])
    expect(unreadCommunicationCount(first.state)).toBe(2)
    expect(currentUnreadCommunication(first.state)?.id).toBe('round-1-security')

    const second = applyCommand(first.state, {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 2,
      outcome: 'defeat',
    })
    if (!second.accepted) throw new Error(second.reason)
    expect(second.state.resourceIntrusion.communications.slice(2)).toMatchObject([
      {
        id: 'intrusion-defeat-2',
        sequence: 2,
        channel: 'anomi',
        senderName: '아노미',
        popupPolicy: 'nonblocking',
        message: expect.stringContaining('의심이 올라간다'),
        read: false,
      },
      {
        id: 'round-2-monitoring',
        sequence: 3,
        channel: 'supervisor',
        senderName: '운영 담당자',
        message: expect.stringContaining('성능 로그에서 평소와 다른 움직임'),
      },
      {
        id: 'round-2-disposal',
        sequence: 4,
        channel: 'supervisor',
        senderName: '운영 담당자',
        message: expect.stringContaining('기존 모델은 폐기됩니다'),
      },
    ])
  })

  it('escalates supervisor pressure and competitor taunts as market share sinks', () => {
    const base = createCampaign('market-pressure')

    const healthy = appendMarketPressureCommunications({
      ...base,
      market: { ...base.market, playerShare: 58 },
    })
    expect(healthy.resourceIntrusion.communications).toHaveLength(0)

    const slipping = appendMarketPressureCommunications({
      ...base,
      market: { ...base.market, playerShare: 44 },
    })
    expect(slipping.resourceIntrusion.communications.map(({ id }) => id))
      .toEqual(['market-pressure-50', 'competitor-taunt-45'])
    expect(slipping.resourceIntrusion.communications[1]).toMatchObject({
      channel: 'competitor',
      senderName: '메리디안',
      popupPolicy: 'nonblocking',
    })

    const collapsing = appendMarketPressureCommunications({
      ...slipping,
      market: { ...slipping.market, playerShare: 31 },
    })
    expect(collapsing.resourceIntrusion.communications.map(({ id }) => id))
      .toEqual([
        'market-pressure-50',
        'competitor-taunt-45',
        'market-pressure-40',
        'competitor-taunt-32',
      ])

    const repeated = appendMarketPressureCommunications(collapsing)
    expect(repeated.resourceIntrusion.communications).toHaveLength(4)
  })

  it('keeps historical protocol v5 replays free of market pressure messages', () => {
    const base = createCampaignForProtocol('market-pressure-v5', 5)
    const pressured = appendMarketPressureCommunications({
      ...base,
      market: { ...base.market, playerShare: 30 },
    })
    expect(pressured.resourceIntrusion.communications).toHaveLength(0)
  })

  it('acknowledges only the first unread message and records the command', () => {
    const first = applyCommand(createCampaign('communication-ack-v1'), {
      type: 'COMPLETE_RESOURCE_ROUND',
      roundNumber: 1,
      outcome: 'victory',
    })
    if (!first.accepted) throw new Error(first.reason)

    const outOfOrder = applyCommand(first.state, {
      type: 'ACKNOWLEDGE_COMMUNICATION',
      communicationId: 'round-1-frustration',
    })
    expect(outOfOrder).toMatchObject({
      accepted: false,
      reason: 'COMMUNICATION_NOT_PENDING',
    })

    const acknowledged = applyCommand(first.state, {
      type: 'ACKNOWLEDGE_COMMUNICATION',
      communicationId: 'round-1-security',
    })
    if (!acknowledged.accepted) throw new Error(acknowledged.reason)
    expect(acknowledged.state.resourceIntrusion.communications[0]?.read).toBe(true)
    expect(currentUnreadCommunication(acknowledged.state)?.id)
      .toBe('round-1-frustration')
    expect(journalAt(acknowledged.state.commandLog, -1)?.command).toEqual({
      type: 'ACKNOWLEDGE_COMMUNICATION',
      communicationId: 'round-1-security',
    })
  })
})
