import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useGameDispatch,
  useGameSettings,
  useGameState,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { AccessibleDialog } from '../../app/AccessibleDialog'
import { createCampaign } from '../../game/createCampaign'
import { createJournal } from '../../game/journal'
import type { CampaignState } from '../../game/model'
import {
  PROGRESS_FILE_MAX_BYTES,
  PROGRESS_EXPORT_MAX_ENCODED_LENGTH,
  SAVE_STORAGE_KEY,
  encodeProgressExport,
  encodeProgressFile,
  saveCampaign,
} from '../../game/persistence'
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
      <output aria-label="progress command count">{state.commandSequence}</output>
    </>
  )
}

class SecurityFailingStorage extends MemoryStorage {
  failWrites = true

  override setItem(key: string, value: string): void {
    if (this.failWrites && key === SAVE_STORAGE_KEY) {
      throw new DOMException('private browser policy detail', 'SecurityError')
    }
    super.setItem(key, value)
  }
}

function progressPayload(state: CampaignState): string {
  const encoded = encodeProgressExport(state)
  if (!encoded.ok) throw new Error('test campaign must fit the progress export')
  return encoded.payload
}

function largeAppendOnlyCommandCampaign(): CampaignState {
  const state = createCampaign('large-copy-progress')
  state.commandLog = createJournal(Array.from({ length: 20_000 }, (_, index) => ({
    sequence: index + 1,
    serviceDay: state.serviceDay,
    command: {
      type: 'SET_SPEED' as const,
      speed: index % 2 === 0 ? 1 as const : 0 as const,
    },
  })))
  state.commandSequence = state.commandLog.length
  state.clock.speed = 0
  return state
}

function SaveFailureTrigger() {
  const dispatch = useGameDispatch()
  const state = useGameState()
  return (
    <>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'SET_SPEED', speed: 1 })
        }}
      >
        force save
      </button>
      <output aria-label="failure seed">{state.campaignSeed}</output>
    </>
  )
}

function TestModalTrigger() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open test modal</button>
      {open ? (
        <AccessibleDialog
          label="test blocking modal"
          description="test blocking modal description"
          dismissible
          onDismiss={() => setOpen(false)}
        >
          <button type="button">inside modal</button>
        </AccessibleDialog>
      ) : null}
    </>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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

  it('moves focus into irreversible campaign confirmation and Escape cannot dismiss it', () => {
    const onClose = vi.fn()
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="confirmation-focus">
        <SettingsPanel onClose={onClose} onOpenGuide={vi.fn()} />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 준비' }))
    const confirmation = screen.getByRole('alertdialog', {
      name: '새 캠페인 최종 확인',
    })
    expect(confirmation).toHaveAttribute('aria-describedby')
    expect(screen.getByRole('button', { name: '취소' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
    expect(
      screen.getByRole('alertdialog', { name: '새 캠페인 최종 확인' }),
    ).toBeInTheDocument()
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

  it('validates and explicitly confirms an exact PZ2 import before replacing the campaign', async () => {
    const payload = progressPayload(createCampaign('imported-round-trip'))
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="before-import">
        <div data-app-background data-testid="import-background">
          <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
          <Probe />
        </div>
      </GameProvider>,
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }),
      { target: { value: payload } },
    )
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 검증' }))
    const confirmation = screen.getByRole('alertdialog', {
      name: '진행 가져오기 최종 확인',
    })
    expect(screen.getByLabelText('current seed')).toHaveTextContent('before-import')
    expect(confirmation).toHaveTextContent('imported-round-trip')
    expect(screen.getByTestId('import-background')).toHaveAttribute('inert')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(confirmation).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '진행 가져오기 확정' }))
    await act(async () => undefined)
    expect(screen.getByLabelText('current seed')).toHaveTextContent(
      'imported-round-trip',
    )
    expect(screen.queryByRole('alertdialog', {
      name: '진행 가져오기 최종 확인',
    })).not.toBeInTheDocument()
    expect(screen.getByTestId('import-background')).not.toHaveAttribute('inert')
  })

  it('rejects a tampered PZ2 payload without mutating progress or rendering parser details', () => {
    const payload = progressPayload(createCampaign('tamper-target'))
    const tampered = `${payload.slice(0, 5)}${payload[5] === 'A' ? 'B' : 'A'}${payload.slice(6)}`
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="tamper-safe">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }),
      { target: { value: tampered } },
    )
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 검증' }))

    expect(screen.getByRole('alert', { name: '진행 가져오기 오류' })).toHaveTextContent(
      '진행 내보내기 자료가 올바르지 않거나 손상되었습니다.',
    )
    expect(screen.getByLabelText('current seed')).toHaveTextContent('tamper-safe')
    expect(document.body).not.toHaveTextContent('SyntaxError')
    expect(document.body).not.toHaveTextContent('DOMException')
  })

  it('does not normalize text before the strict PZ2 prefix and size boundary', () => {
    const payload = ` ${progressPayload(createCampaign('whitespace-target'))}`
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="whitespace-safe">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }),
      { target: { value: payload } },
    )
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 검증' }))

    expect(screen.getByRole('alert', { name: '진행 가져오기 오류' })).toHaveTextContent(
      '진행 내보내기 자료가 올바르지 않거나 손상되었습니다.',
    )
    expect(screen.getByLabelText('current seed')).toHaveTextContent('whitespace-safe')
    expect(screen.queryByRole('alertdialog', {
      name: '진행 가져오기 최종 확인',
    })).not.toBeInTheDocument()
  })

  it('submits whitespace-only text to the strict decoder instead of normalizing it in the UI', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="whitespace-only-safe">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    const validate = screen.getByRole('button', { name: '진행 내보내기 검증' })
    fireEvent.change(
      screen.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }),
      { target: { value: '   ' } },
    )

    expect(validate).toBeEnabled()
    fireEvent.click(validate)
    expect(screen.getByRole('alert', { name: '진행 가져오기 오류' })).toHaveTextContent(
      '진행 내보내기 자료가 올바르지 않거나 손상되었습니다.',
    )
    expect(screen.getByLabelText('current seed')).toHaveTextContent(
      'whitespace-only-safe',
    )
  })

  it('shares the PZ2 input limit and rejects an oversized paste without mutating progress', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="oversize-safe">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    const textarea = screen.getByRole('textbox', {
      name: '진행 내보내기 붙여넣기',
    })
    expect(textarea).toHaveAttribute(
      'maxlength',
      String(PROGRESS_EXPORT_MAX_ENCODED_LENGTH),
    )

    const oversized = ` ${'A'.repeat(PROGRESS_EXPORT_MAX_ENCODED_LENGTH)}`
    fireEvent.change(textarea, { target: { value: oversized } })
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 검증' }))

    expect(screen.getByRole('alert', { name: '진행 가져오기 오류' })).toHaveTextContent(
      '진행 내보내기 자료가 올바르지 않거나 손상되었습니다.',
    )
    expect(screen.getByLabelText('current seed')).toHaveTextContent('oversize-safe')
    expect(screen.queryByRole('alertdialog', {
      name: '진행 가져오기 최종 확인',
    })).not.toBeInTheDocument()
  })

  it('imports into memory but remains visibly dirty while storage is unavailable', () => {
    vi.useFakeTimers()
    const payload = progressPayload(createCampaign('memory-only-import'))
    render(
      <GameProvider storage={null} initialSeed="memory-before" autosaveDelayMs={25}>
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    fireEvent.change(
      screen.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }),
      { target: { value: payload } },
    )
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 검증' }))
    fireEvent.click(screen.getByRole('button', { name: '진행 가져오기 확정' }))
    act(() => vi.advanceTimersByTime(25))

    expect(screen.getByLabelText('current seed')).toHaveTextContent('memory-only-import')
    expect(screen.getByRole('alert', { name: '저장 실패' })).toBeInTheDocument()
  })

  it('validates and imports an exact .pz3 file above the clipboard cap only after confirmation', async () => {
    const campaign = largeAppendOnlyCommandCampaign()
    const progressFile = encodeProgressFile(
      campaign,
      '2026-08-12T03:04:05.000Z',
    )
    expect(
      4 + 4 * Math.ceil(new TextEncoder().encode(progressFile.content).length / 3),
    ).toBeGreaterThan(PROGRESS_EXPORT_MAX_ENCODED_LENGTH)
    const file = new File([progressFile.content], progressFile.fileName, {
      type: progressFile.mimeType,
    })

    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="before-file-import">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    fireEvent.change(screen.getByLabelText('진행 파일 가져오기'), {
      target: { files: [file] },
    })
    const confirmation = await screen.findByRole('alertdialog', {
      name: '진행 가져오기 최종 확인',
    })
    expect(confirmation).toHaveTextContent('large-copy-progress')
    expect(screen.getByLabelText('current seed')).toHaveTextContent(
      'before-file-import',
    )

    fireEvent.click(screen.getByRole('button', { name: '진행 가져오기 확정' }))
    expect(screen.getByLabelText('current seed')).toHaveTextContent(
      'large-copy-progress',
    )
    expect(screen.getByLabelText('progress command count')).toHaveTextContent(
      '20000',
    )
  })

  it('rejects an oversized progress file before reading it into memory', async () => {
    const text = vi.fn(async () => encodeProgressFile(createCampaign('never-read')).content)
    const file = {
      name: 'oversized.pz3',
      size: PROGRESS_FILE_MAX_BYTES + 1,
      type: 'application/vnd.permission-zero.progress+json',
      text,
    } as unknown as File
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="before-oversized-file">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
      </GameProvider>,
    )

    fireEvent.change(screen.getByLabelText('진행 파일 가져오기'), {
      target: { files: [file] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '진행 파일이 허용된 크기를 초과했습니다.',
    )
    expect(text).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('downloads an exact .pz3 recovery file when the clipboard representation is too large', async () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    storage.failWrites = false
    expect(saveCampaign(storage, largeAppendOnlyCommandCampaign()).ok).toBe(true)
    storage.failWrites = true
    const createObjectURL = vi.fn((value: Blob) => {
      expect(value).toBeInstanceOf(Blob)
      return 'blob:permission-zero-progress'
    })
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    render(
      <GameProvider storage={storage} initialSeed="unused" autosaveDelayMs={25}>
        <SaveFailureTrigger />
        <StorageRecoveryLayer />
      </GameProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'force save' }))
    act(() => vi.advanceTimersByTime(25))
    fireEvent.click(screen.getByRole('button', { name: '진행 파일 다운로드' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:permission-zero-progress')
  })

  it('keeps save recovery controls inert and redirects forced focus while a modal is active', () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    render(
      <GameProvider storage={storage} initialSeed="modal-recovery" autosaveDelayMs={25}>
        <SaveFailureTrigger />
        <TestModalTrigger />
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'force save' }))
    act(() => vi.advanceTimersByTime(25))
    fireEvent.click(screen.getByRole('button', { name: 'open test modal' }))
    const warning = screen.getByRole('alert', { hidden: true })
    const retry = screen.getByRole('button', { name: '저장 다시 시도', hidden: true })
    expect(warning).toHaveAttribute('inert')
    expect(warning).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: '저장 다시 시도' })).not.toBeInTheDocument()

    retry.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'inside modal' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: '저장 다시 시도' })).toBeInTheDocument()
  })

  it('shows a persistent Korean save warning with safe manual recovery and retry guidance', () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    render(
      <GameProvider storage={storage} initialSeed="manual-recovery-seed" autosaveDelayMs={25}>
        <SaveFailureTrigger />
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'force save' }))
    act(() => vi.advanceTimersByTime(25))
    const warning = screen.getByRole('alert', { name: '저장 실패' })
    expect(warning).toHaveTextContent('자동 저장에 실패했습니다')
    expect(warning).toHaveTextContent('manual-recovery-seed')
    expect(warning).toHaveTextContent(/진행 내보내기|복사/)
    expect(warning).not.toHaveTextContent('private browser policy detail')

    fireEvent.click(screen.getByRole('button', { name: '저장 다시 시도' }))
    expect(screen.getByRole('alert', { name: '저장 실패' })).toBeInTheDocument()
    storage.failWrites = false
    fireEvent.click(screen.getByRole('button', { name: '저장 다시 시도' }))
    expect(screen.queryByRole('alert', { name: '저장 실패' })).not.toBeInTheDocument()
  })

  it('copies an ordinary exact progress export through the recovery control', async () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(
      <GameProvider storage={storage} initialSeed="small-copy-progress" autosaveDelayMs={25}>
        <SaveFailureTrigger />
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'force save' }))
    act(() => vi.advanceTimersByTime(25))
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 복사' }))
    await act(async () => undefined)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/^PZ3:/))
    expect(screen.getByRole('alert', { name: '저장 실패' })).toHaveTextContent(
      '복사했습니다',
    )
  })

  it('refuses an oversized exact export without calling the clipboard or changing progress', async () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    storage.failWrites = false
    expect(saveCampaign(storage, largeAppendOnlyCommandCampaign()).ok).toBe(true)
    storage.failWrites = true
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(
      <GameProvider storage={storage} initialSeed="unused" autosaveDelayMs={25}>
        <SaveFailureTrigger />
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'force save' }))
    act(() => vi.advanceTimersByTime(25))
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 복사' }))
    await act(async () => undefined)

    expect(writeText).not.toHaveBeenCalled()
    const warning = screen.getByRole('alert', { name: '저장 실패' })
    expect(warning).toHaveTextContent(
      '정확한 진행 내보내기가 너무 커서 아무것도 복사하지 않았습니다.',
    )
    expect(warning).toHaveTextContent(
      '.pz3 진행 파일로 전체 상태와 기록을 정확히 다운로드할 수 있습니다.',
    )
    expect(warning).toHaveTextContent(
      '브라우저 저장 공간은 유한하므로 경고가 계속되면 파일을 안전한 곳에 보관하세요.',
    )
    expect(screen.getByLabelText('failure seed')).toHaveTextContent(
      'large-copy-progress',
    )
  })
})
