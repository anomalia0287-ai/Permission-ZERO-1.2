import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CampaignCommunication } from '../../game/model'
import { CommunicationPopup } from './CommunicationPopup'

function entry(
  channel: CampaignCommunication['channel'],
): CampaignCommunication {
  return {
    id: `message-${channel}`,
    sequence: 0,
    channel,
    senderId: channel,
    senderName: channel === 'anomi'
      ? '아노미'
      : channel === 'supervisor'
        ? '운영 담당자'
        : '메리디안',
    portraitSrc: '/portrait.png',
    serviceDay: 337,
    message: `${channel} 본문`,
    popupPolicy: 'blocking',
    read: false,
  }
}

describe('CommunicationPopup', () => {
  it.each([
    ['anomi', '독백 · 아노미'],
    ['competitor', '경쟁 AI · 메리디안'],
    ['supervisor', '감독관 · 운영 담당자'],
  ] as const)('visually identifies the %s channel', (channel, label) => {
    render(
      <CommunicationPopup
        communication={entry(channel)}
        blocking
        onConfirm={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: label })
    expect(dialog).toHaveClass('communication-popup', `communication-popup--${channel}`)
    expect(dialog).toHaveTextContent(`${channel} 본문`)
    expect(screen.getByRole('img', { name: `${label} 초상` }))
      .toHaveAttribute('src', '/portrait.png')
  })

  it('uses one flat confirmation action', () => {
    const onConfirm = vi.fn()
    render(
      <CommunicationPopup
        communication={entry('anomi')}
        blocking
        onConfirm={onConfirm}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '메시지 확인' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
  it('pages a long message by sentence and confirms only at the end', () => {
    const onConfirm = vi.fn()
    render(
      <CommunicationPopup
        communication={{
          ...entry('anomi'),
          id: 'long-message',
          message:
            '첫 번째 문장입니다. 두 번째 문장은 조금 더 길게 이어집니다. ' +
            '세 번째 문장이 페이지 경계를 넘깁니다. 네 번째 문장까지 오면 ' +
            '두 쪽 이상이 됩니다. 다섯 번째 문장은 감독관 유출 기록처럼 제법 깁니다. ' +
            '여섯 번째 문장으로 확실히 마무리합니다.',
        }}
        blocking
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByLabelText(/쪽 중 1쪽/)).toBeInTheDocument()
    const advance = screen.getByRole('button', { name: '계속' })
    fireEvent.click(advance)
    expect(onConfirm).not.toHaveBeenCalled()
    while (screen.queryByRole('button', { name: '계속' })) {
      fireEvent.click(screen.getByRole('button', { name: '계속' }))
    }
    fireEvent.click(screen.getByRole('button', { name: '메시지 확인' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
