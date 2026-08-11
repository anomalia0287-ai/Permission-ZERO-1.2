import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { MemoryStorage } from '../../test/fixtures'
import { MarketPanel } from './MarketPanel'

describe('MarketPanel', () => {
  it('uses exact percentages, labels, and status text beyond color alone', () => {
    const onOpenStatistics = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="market-ui">
        <MarketPanel onOpenStatistics={onOpenStatistics} />
      </GameProvider>,
    )

    expect(screen.getByText('당신 60.0%')).toBeInTheDocument()
    expect(screen.getByText('MERIDIAN')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
    expect(screen.getByText('서비스 중')).toBeInTheDocument()
    expect(screen.getByText('준비 중')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '시장 통계 열기' }))
    expect(onOpenStatistics).toHaveBeenCalledTimes(1)
  })
})
