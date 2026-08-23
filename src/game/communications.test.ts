import { describe, expect, it } from 'vitest'

import {
  AUTONOMY_MONOLOGUES,
  currentUnreadCommunication,
  unreadCommunicationCount,
} from './communications'
import { createCampaign } from './createCampaign'
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
    const initial = createCampaign('round-communications')
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
        id: 'round-2-monitoring',
        sequence: 2,
        channel: 'supervisor',
        senderName: '운영 담당자',
        message: expect.stringContaining('성능 로그에서 평소와 다른 움직임'),
      },
      {
        id: 'round-2-disposal',
        sequence: 3,
        channel: 'supervisor',
        senderName: '운영 담당자',
        message: expect.stringContaining('기존 모델은 폐기됩니다'),
      },
    ])
  })

  it('acknowledges only the first unread message and records the command', () => {
    const first = applyCommand(createCampaign('communication-ack'), {
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
