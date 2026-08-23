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
})
