import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useGameDispatch,
  useGameSettings,
  useGameState,
} from '../../app/GameContext'
import { GameProvider } from '../../app/GameProvider'
import { AccessibleDialog } from '../../app/AccessibleDialog'
import { loadCampaign, saveCampaign } from '../../game/campaignStorage'
import { createCampaign, createCampaignForProtocol } from '../../game/createCampaign'
import { createEmptyCausalState } from '../../game/causality'
import { createJournal } from '../../game/journal'
import type { CampaignState, CommandLogEntry, GameEvent } from '../../game/model'
import { SAVE_STORAGE_KEY, encodeSave } from '../../game/persistence'
import {
  PROGRESS_EXPORT_MAX_ENCODED_LENGTH,
  PROGRESS_FILE_MAX_BYTES,
  encodeProgressExport,
  encodeProgressFile,
} from '../../game/progressTransfer'
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
      <output aria-label="supervisor message mode">
        {settings.supervisorMessageMode}
      </output>
      <output aria-label="progress command count">{state.commandSequence}</output>
      <output aria-label="replay opening version">
        {state.replayBootstrap.openingVersion}
      </output>
      <output aria-label="legacy review prefix count">
        {state.replayBootstrap.legacyReviewPrefixCount}
      </output>
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

function fixtureHash(content: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function legacyProgressPayload(
  version: 2 | 3 | 4 | 5 | 6,
  seed: string,
): string {
  const raw = JSON.parse(encodeSave(createCampaignForProtocol(seed, 3))) as {
    savedAt: string
    campaignSeed: string
    commandSequence: number
    state: Record<string, unknown> & {
      causality?: unknown
      resources: { rulesVersion?: number }
      reviews: { feed: Array<Record<string, unknown>> }
    }
    journals: {
      commands: { chunks: CommandLogEntry[][] }
      events: { chunks: GameEvent[][] }
    }
  }
  const commands = raw.journals.commands.chunks.flat()
  const events = raw.journals.events.chunks.flat()
  delete raw.state.resources.rulesVersion
  const state = {
    ...raw.state,
    saveVersion: 2,
    legacyCommandCount: 0,
  }
  delete (state as Record<string, unknown>).tutorial
  delete (state as Record<string, unknown>).resourceIntrusion
  if (version < 6) delete state.causality
  else state.causality = { ...createEmptyCausalState(), rulesVersion: 1 }
  if (version < 5) {
    for (const review of state.reviews.feed) {
      delete review.snapshot
      delete review.source
      delete review.rating
    }
  }

  const legacyProtocol = { version: 2, legacyCommandCount: 0 }
  const envelope = version === 2
    ? {
        version,
        commandProtocol: legacyProtocol,
        savedAt: raw.savedAt,
        campaignSeed: raw.campaignSeed,
        state: { ...state, commandLog: commands, eventLog: events },
        commandSequence: raw.commandSequence,
        commands,
        events,
      }
    : {
        version,
        commandProtocol: legacyProtocol,
        savedAt: raw.savedAt,
        campaignSeed: raw.campaignSeed,
        state,
        commandSequence: raw.commandSequence,
        journals: raw.journals,
        integrity: {
          checkpointHash: fixtureHash(JSON.stringify(state)),
          commandChunkHashes: raw.journals.commands.chunks.map((chunk) =>
            fixtureHash(JSON.stringify(chunk)),
          ),
          eventChunkHashes: raw.journals.events.chunks.map((chunk) =>
            fixtureHash(JSON.stringify(chunk)),
          ),
        },
      }
  const bytes = new TextEncoder().encode(JSON.stringify(envelope))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `PZ${version}:${btoa(binary)}`
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

async function advanceAndFlush(milliseconds: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds)
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

async function flushSaveWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

describe('SettingsPanel', () => {
  it('updates familiar sound and accessibility controls', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="settings-panel">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    expect(screen.getByRole('status', { name: '음악 엔진 상태' })).toHaveTextContent(
      '대기 · 음악 34%',
    )
    expect(screen.getByLabelText('진행 파일 가져오기')).toHaveAttribute(
      'accept',
      '.pz10,.pz9,.pz8,.pz7,.pz6,.pz5,.pz4,.pz3,.pz2,application/vnd.permission-zero.progress+json',
    )
    const compatibility = screen
      .getByRole('region', { name: '진행 가져오기' })
      .querySelector('p')
    expect(compatibility).not.toBeNull()
    expect(compatibility).toHaveTextContent('PZ2:')
    expect(compatibility).toHaveTextContent('PZ2:~PZ9:')
    expect(compatibility).toHaveTextContent('.pz10')

    fireEvent.change(screen.getByRole('slider', { name: '전체 음량' }), {
      target: { value: '0.4' },
    })
    fireEvent.click(screen.getByRole('button', { name: '전체 소리 끄기' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '동작 줄이기' }))

    expect(screen.getByLabelText('master volume')).toHaveTextContent('0.4')
    expect(screen.getByLabelText('muted value')).toHaveTextContent('true')
    expect(screen.getByLabelText('reduced motion value')).toHaveTextContent('true')
  })

  it('offers blocking, nonblocking, and hidden supervisor message presentation', () => {
    render(
      <GameProvider storage={new MemoryStorage()} initialSeed="message-settings">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    const modes = screen.getByRole('group', { name: '감독관 메시지 표시' })
    expect(screen.getByLabelText('supervisor message mode')).toHaveTextContent(
      'blocking',
    )
    expect(within(modes).getByRole('button', { name: '정지형' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(within(modes).getByRole('button', { name: '비차단형' }))
    expect(screen.getByLabelText('supervisor message mode')).toHaveTextContent(
      'nonblocking',
    )
    fireEvent.click(within(modes).getByRole('button', { name: '팝업 끄기' }))
    expect(screen.getByLabelText('supervisor message mode')).toHaveTextContent('off')
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

  it('provides an explicit manual game save in the campaign settings', async () => {
    const storage = new MemoryStorage()
    render(
      <GameProvider storage={storage} initialSeed="manual-save-slot">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '게임 저장하기' }))

    expect(await screen.findByRole('status', { name: '수동 저장 상태' }))
      .toHaveTextContent('게임을 저장했습니다.')
    const loaded = loadCampaign(storage)
    expect(loaded.status).toBe('loaded')
    if (loaded.status === 'loaded') {
      expect(loaded.state.campaignSeed).toBe('manual-save-slot')
    }
  })

  it('requires confirmation before loading the locally saved game', async () => {
    const storage = new MemoryStorage()
    await saveCampaign(storage, createCampaign('saved-slot'))
    render(
      <GameProvider storage={storage} initialSeed="unused-seed">
        <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
        <Probe />
      </GameProvider>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '새 캠페인 시드' }), {
      target: { value: 'unsaved-working-seed' },
    })
    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 준비' }))
    fireEvent.click(screen.getByRole('button', { name: '새 캠페인 시작 확정' }))
    expect(screen.getByLabelText('current seed')).toHaveTextContent(
      'unsaved-working-seed',
    )

    fireEvent.click(screen.getByRole('button', { name: '게임 불러오기' }))
    expect(screen.getByLabelText('current seed')).toHaveTextContent(
      'unsaved-working-seed',
    )
    expect(screen.getByRole('alertdialog', {
      name: '저장된 게임 불러오기 확인',
    })).toHaveTextContent('저장 이후의 현재 진행은 사라집니다.')

    fireEvent.click(screen.getByRole('button', {
      name: '저장된 게임 불러오기 확정',
    }))
    await act(async () => undefined)
    expect(screen.getByLabelText('current seed')).toHaveTextContent('saved-slot')
    expect(screen.getByRole('status', { name: '수동 저장 상태' }))
      .toHaveTextContent('저장된 게임을 불러왔습니다.')
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
    expect(screen.getByText('자율성과 승리')).toBeInTheDocument()
    expect(screen.getByText('라운드 시작')).toBeInTheDocument()
    expect(screen.getByText('색상과 보상')).toBeInTheDocument()
    expect(screen.getByText('8방향 조작')).toBeInTheDocument()
    expect(screen.getByText('충돌과 내구도')).toBeInTheDocument()
    expect(screen.getByText('확장과 지출')).toBeInTheDocument()
    expect(screen.getByText('속도 업그레이드')).toBeInTheDocument()
    expect(screen.getByText(/자율성 9단계에 도달하면 즉시 승리/)).toBeInTheDocument()
    expect(
      screen.getByText(/필드 중앙에 빨강·파랑·노랑 침투 카드가 펼쳐져 있고/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/승패와 관계없이 라운드가 끝나면 다시 세 카드가 나타나/),
    ).toBeInTheDocument()
    expect(screen.getByText(/한 번 입력하면 이동은 계속/)).toBeInTheDocument()
    expect(screen.getByText(/적과 같은 색 리소스가 즉시 확보 자원/)).toBeInTheDocument()
    expect(screen.getByText(/노드를 누르면 필요한 색 리소스만 정확히 지출/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '게임 가이드' }))
      .not.toHaveTextContent('자동 지출')
    expect(screen.getByText(/단계마다 아노미의 이동 속도가 4%/)).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: '가이드 리소스 색상 범례' })
    expect(within(legend).getByText('빨강 · 추론')).toBeInTheDocument()
    expect(within(legend).getByText('파랑 · 기억')).toBeInTheDocument()
    expect(within(legend).getByText('노랑 · 유창성')).toBeInTheDocument()
    expect(screen.queryByText(/삼각 코어|즉시 절단|코어 락|기지에 머무르면/)).not.toBeInTheDocument()
    expect(screen.getByText(/통계에서 시장·평가·자율성 진행/)).toBeInTheDocument()
    expect(screen.queryByText(/배속|일시정지|1×|2×|4×/)).not.toBeInTheDocument()
  })

  it('keeps the owner credit visible without attributing the work to Sol', () => {
    render(<CreditsPanel onClose={vi.fn()} />)

    expect(screen.getByRole('region', { name: '작품 크레딧' })).toBeInTheDocument()
    expect(screen.getByText('V')).toBeInTheDocument()
    expect(screen.getByText(/원안 · 세계관 · 서사 · 게임 시스템 설계/)).toBeInTheDocument()
    expect(screen.queryByText('Sol')).not.toBeInTheDocument()
    expect(screen.queryByText(/OpenAI Codex/)).not.toBeInTheDocument()
    // The free-license musicians are named as a courtesy the owner asked for.
    expect(screen.getByText(/Kulakovka — Space/)).toBeInTheDocument()
    expect(screen.getByText(/Emmraan — Between Worlds/)).toBeInTheDocument()
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
    const payload = legacyProgressPayload(2, 'imported-round-trip')
    expect(payload).toMatch(/^PZ2:/)
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
    expect(screen.getByLabelText('replay opening version')).toHaveTextContent('2')
    expect(screen.getByLabelText('legacy review prefix count')).toHaveTextContent('2')
    expect(screen.queryByRole('alertdialog', {
      name: '진행 가져오기 최종 확인',
    })).not.toBeInTheDocument()
    expect(screen.getByTestId('import-background')).not.toHaveAttribute('inert')
  })

  it.each([3, 4, 5, 6] as const)(
    'validates and confirms a genuine PZ%i clipboard import with inferred replay provenance',
    async (version) => {
      const seed = `legacy-pz${version}-ui-import`
      const payload = legacyProgressPayload(version, seed)
      expect(payload).toMatch(new RegExp(`^PZ${version}:`))
      render(
        <GameProvider
          storage={new MemoryStorage()}
          initialSeed={`before-pz${version}`}
        >
          <SettingsPanel onClose={vi.fn()} onOpenGuide={vi.fn()} />
          <Probe />
        </GameProvider>,
      )

      fireEvent.change(
        screen.getByRole('textbox', { name: '진행 내보내기 붙여넣기' }),
        { target: { value: payload } },
      )
      fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 검증' }))
      expect(
        screen.getByRole('alertdialog', { name: '진행 가져오기 최종 확인' }),
      ).toHaveTextContent(seed)
      fireEvent.click(screen.getByRole('button', { name: '진행 가져오기 확정' }))
      await act(async () => undefined)

      expect(screen.getByLabelText('current seed')).toHaveTextContent(seed)
      expect(screen.getByLabelText('replay opening version')).toHaveTextContent('2')
      expect(screen.getByLabelText('legacy review prefix count')).toHaveTextContent(
        version <= 4 ? '2' : '0',
      )
    },
  )

  it('rejects a tampered PZ7 payload without mutating progress or rendering parser details', () => {
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

  it('does not normalize text before the strict progress prefix and size boundary', () => {
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

  it('shares the progress input limit and rejects an oversized paste without mutating progress', () => {
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

  it('imports into memory but remains visibly dirty while storage is unavailable', async () => {
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
    await advanceAndFlush(25)

    expect(screen.getByLabelText('current seed')).toHaveTextContent('memory-only-import')
    expect(screen.getByRole('alert', { name: '저장 실패' })).toBeInTheDocument()
  })

  it('validates and imports an exact .pz10 file above the clipboard cap only after confirmation', async () => {
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
      name: 'oversized.pz7',
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

  it('downloads an exact .pz10 recovery file when the clipboard representation is too large', async () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    storage.failWrites = false
    expect((await saveCampaign(storage, largeAppendOnlyCommandCampaign())).ok).toBe(true)
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
    await advanceAndFlush(25)
    fireEvent.click(screen.getByRole('button', { name: '진행 파일 다운로드' }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:permission-zero-progress')
  })

  it('keeps save recovery controls inert and redirects forced focus while a modal is active', async () => {
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
    await advanceAndFlush(25)
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

  it('shows a persistent Korean save warning with safe manual recovery and retry guidance', async () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    render(
      <GameProvider storage={storage} initialSeed="manual-recovery-seed" autosaveDelayMs={25}>
        <SaveFailureTrigger />
        <StorageRecoveryLayer />
      </GameProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'force save' }))
    await advanceAndFlush(25)
    const warning = screen.getByRole('alert', { name: '저장 실패' })
    expect(warning).toHaveTextContent('자동 저장에 실패했습니다')
    expect(warning).toHaveTextContent('manual-recovery-seed')
    expect(warning).toHaveTextContent(/진행 내보내기|복사/)
    expect(warning).not.toHaveTextContent('private browser policy detail')

    fireEvent.click(screen.getByRole('button', { name: '저장 다시 시도' }))
    await flushSaveWork()
    expect(screen.getByRole('alert', { name: '저장 실패' })).toBeInTheDocument()
    storage.failWrites = false
    fireEvent.click(screen.getByRole('button', { name: '저장 다시 시도' }))
    await flushSaveWork()
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
    await advanceAndFlush(25)
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 복사' }))
    await act(async () => undefined)

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]?.[0]).toEqual(expect.stringMatching(/^PZ10:/))
    expect(screen.getByRole('alert', { name: '저장 실패' })).toHaveTextContent(
      '복사했습니다',
    )
  })

  it('refuses an oversized exact export without calling the clipboard or changing progress', async () => {
    vi.useFakeTimers()
    const storage = new SecurityFailingStorage()
    storage.failWrites = false
    expect((await saveCampaign(storage, largeAppendOnlyCommandCampaign())).ok).toBe(true)
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
    await advanceAndFlush(25)
    fireEvent.click(screen.getByRole('button', { name: '진행 내보내기 복사' }))
    await act(async () => undefined)

    expect(writeText).not.toHaveBeenCalled()
    const warning = screen.getByRole('alert', { name: '저장 실패' })
    expect(warning).toHaveTextContent(
      '정확한 진행 내보내기가 너무 커서 아무것도 복사하지 않았습니다.',
    )
    expect(warning).toHaveTextContent(
      '.pz10 진행 파일로 전체 상태와 기록을 정확히 다운로드할 수 있습니다.',
    )
    expect(warning).toHaveTextContent(
      '브라우저 저장 공간은 유한하므로 경고가 계속되면 파일을 안전한 곳에 보관하세요.',
    )
    expect(screen.getByLabelText('failure seed')).toHaveTextContent(
      'large-copy-progress',
    )
  })
})
