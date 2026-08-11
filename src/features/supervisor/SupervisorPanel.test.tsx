import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GameProvider } from '../../app/GameProvider'
import { STORY_FILES } from '../../content/story.ko'
import { createCampaign } from '../../game/createCampaign'
import { saveCampaign } from '../../game/persistence'
import { MemoryStorage } from '../../test/fixtures'
import { SupervisorHistoryPanel, SupervisorPanel } from './SupervisorPanel'

describe('SupervisorPanel', () => {
  it('shows the current oversight message and opens past communications', () => {
    const onOpenHistory = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="supervisor-ui">
        <SupervisorPanel
          onOpenHistory={onOpenHistory}
          onOpenStatistics={vi.fn()}
        />
      </GameProvider>,
    )

    expect(screen.getByText('의심 0')).toBeInTheDocument()
    expect(screen.getByText(/새로운 감독 주기가 시작/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '과거 내역' }))
    expect(onOpenHistory).toHaveBeenCalledTimes(1)
  })

  it('preserves dated messages in a detailed history view', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="supervisor-history">
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    expect(screen.getByRole('region', { name: '감독 통신 기록' })).toBeInTheDocument()
    expect(screen.getByText('DAY 331')).toBeInTheDocument()
    expect(screen.getByText(/새로운 감독 주기가 시작/)).toBeInTheDocument()
  })

  it('keeps recovered full file snapshots permanently rereadable in the archive', () => {
    const state = createCampaign('supervisor-file-archive')
    state.story.recoveredFileIds = STORY_FILES.map(({ id }) => id)
    state.story.recoveredFiles = STORY_FILES.map((file, index) => ({
      id: file.id,
      title: file.title,
      content: file.text,
      recoveredOnServiceDay: 340 + index,
    }))
    const storage = new MemoryStorage()
    saveCampaign(storage, state)

    render(
      <GameProvider storage={storage}>
        <SupervisorHistoryPanel onClose={vi.fn()} />
      </GameProvider>,
    )

    const archive = screen.getByRole('region', { name: '복구 파일 기록' })
    expect(archive).toBeInTheDocument()
    for (const file of STORY_FILES) {
      fireEvent.click(screen.getByText(file.title))
      expect(screen.getByText(file.text)).toBeVisible()
    }
    expect(screen.getByText('DAY 342')).toBeInTheDocument()
  })
})
