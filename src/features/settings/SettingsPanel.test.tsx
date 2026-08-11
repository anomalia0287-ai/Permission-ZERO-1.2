import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useGameSettings, useGameState } from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { SAVE_STORAGE_KEY } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import {
  CreditsPanel,
  GuidePanel,
  SettingsPanel,
  StorageRecoveryLayer,
} from './SettingsPanel'

function Probe() {
  const state = useGameState()
  const { settings } = useGameSettings()
  return (
    <>
      <output aria-label="current seed">{state.campaignSeed}</output>
      <output aria-label="master volume">{settings.masterVolume}</output>
      <output aria-label="muted value">{String(settings.muted)}</output>
      <output aria-label="reduced motion value">{String(settings.reducedMotion)}</output>
    </>
  )
}

describe('SettingsPanel', () => {
  it('updates familiar sound and accessibility controls', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="settings-panel">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    fireEvent.change(screen.getByRole('slider', { name: '전체 음량' }), {
      target: { value: '0.4' },
    })
    fireEvent.click(screen.getByRole('button', { name: '전체 소리 끄기' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '동작 줄이기' }))

    expect(screen.getByLabelText('master volume')).toHaveTextContent('0.4')
    expect(screen.getByLabelText('muted value')).toHaveTextContent('true')
    expect(screen.getByLabelText('reduced motion value')).toHaveTextContent('true')
  })

  it('requires a clear second confirmation before replacing the campaign', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="old-seed">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '새 캠페인 시드' }), {
      target: { value: 'new-seed' },
    })
    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 준비' }))
    expect(screen.getByLabelText('current seed')).toHaveTextContent('old-seed')
    expect(screen.getByText(/현재 진행은 새 캠페인으로 대체됩니다/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 시작 확정' }))
    expect(screen.getByLabelText('current seed')).toHaveTextContent('new-seed')
  })

  it('provides a plain-language controls guide', () => {
    render(<GuidePanel onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: '게임 가이드' })).toBeInTheDocument()
    expect(screen.getByText('리소스 이동')).toBeInTheDocument()
    expect(screen.getByText(/하루는 1배속에서 24초/)).toBeInTheDocument()
    expect(screen.getByText('키보드')).toBeInTheDocument()
  })

  it('keeps the agreed creative and implementation credits visible in the work', () => {
    render(<CreditsPanel onClose={vi.fn()} />)

    expect(screen.getByRole('region', { name: '작품 크레딧' })).toBeInTheDocument()
    expect(screen.getByText('V')).toBeInTheDocument()
    expect(screen.getByText('Sol')).toBeInTheDocument()
    expect(screen.getByText(/OpenAI Codex/)).toBeInTheDocument()
    expect(screen.getByText(/원안 · 세계관 · 서사/)).toBeInTheDocument()
    expect(screen.getByText(/시스템 설계 · 구현/)).toBeInTheDocument()
  })

  it('never silently discards a corrupt save', () => {
    const storage = new MemoryStorage()
    storage.setItem(SAVE_STORAGE_KEY, '{broken')
    render(
      <GameProvider storage={storage} initialSeed="safe-temporary">
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    expect(screen.getByRole('dialog', { name: '저장 데이터 복구' })).toBeInTheDocument()
    expect(screen.getByText(/손상되었거나/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '저장하지 않고 임시로 계속' }))
    expect(screen.queryByRole('dialog', { name: '저장 데이터 복구' })).not.toBeInTheDocument()
  })
})
