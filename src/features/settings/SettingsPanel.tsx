import { useEffect, useRef, useState } from 'react'

import { AccessibleDialog } from '../../app/AccessibleDialog'
import { useGameSettings, useGameState } from '../../app/GameContext'
import {
  getGameAudioStatus,
  subscribeGameAudioStatus,
  type AudioEngineStatus,
} from '../../audio/audioEngine'
import {
  PROGRESS_EXPORT_MAX_ENCODED_LENGTH,
  PROGRESS_FILE_MAX_BYTES,
} from '../../game/progressTransfer'
import { ResourceSnakeCategoryLegend } from '../resources/ResourceSnakeCategoryLegend'

function downloadProgressFile(
  createProgressFile: ReturnType<typeof useGameSettings>['createProgressFile'],
): void {
  const progressFile = createProgressFile()
  const blob = new Blob([progressFile.content], { type: progressFile.mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = progressFile.fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function readProgressFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('invalid file result')),
    )
    reader.addEventListener('error', () => reject(new Error('file read failed')))
    reader.readAsText(file)
  })
}

function VolumeControl({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="setting-row setting-row--range">
      <span>{label}</span>
      <input
        type="range"
        aria-label={label}
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{Math.round(value * 100)}%</output>
    </label>
  )
}

function publicAudioStatusLabel(status: AudioEngineStatus): string {
  if (
    status.availability === 'blocked' ||
    status.availability === 'closed' ||
    status.availability === 'unavailable'
  ) {
    return '사용 불가'
  }
  if (status.availability === 'suspended') return '일시 정지'
  if (status.availability === 'running' && status.musicStarted) return '재생'
  return '대기'
}

function ProgressImportControl({
  fallbackFocus,
}: {
  fallbackFocus: () => HTMLElement | null
}) {
  const {
    createProgressFile,
    importProgressExport,
    importProgressFile,
    validateProgressImport,
    validateProgressFileImport,
  } = useGameSettings()
  const [payload, setPayload] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<{
    campaignSeed: string
    savedAt: string
    protocolVersion: number
    source: 'clipboard' | 'file'
    content: string
  } | null>(null)
  const validationButtonRef = useRef<HTMLButtonElement | null>(null)

  function validateImport() {
    const result = validateProgressImport(payload)
    if (!result.ok) {
      setCandidate(null)
      setValidationError(result.message)
      return
    }
    setValidationError(null)
    setCandidate({ ...result, source: 'clipboard', content: payload })
  }

  function confirmImport() {
    if (
      !candidate ||
      !(candidate.source === 'file'
        ? importProgressFile(candidate.content)
        : importProgressExport(candidate.content))
    ) {
      setCandidate(null)
      setValidationError('진행 내보내기 자료가 올바르지 않거나 손상되었습니다.')
      return
    }
    setCandidate(null)
    setPayload('')
  }

  async function validateFile(file: File | undefined) {
    if (!file) return
    if (file.size > PROGRESS_FILE_MAX_BYTES) {
      setCandidate(null)
      setValidationError('진행 파일이 허용된 크기를 초과했습니다.')
      return
    }
    try {
      const content = await readProgressFile(file)
      const result = validateProgressFileImport(content)
      if (!result.ok) {
        setCandidate(null)
        setValidationError(result.message)
        return
      }
      setValidationError(null)
      setCandidate({ ...result, source: 'file', content })
    } catch {
      setCandidate(null)
      setValidationError('진행 파일을 읽을 수 없습니다.')
    }
  }

  return (
    <section className="progress-import" aria-label="진행 가져오기">
      <div className="progress-file-actions">
        <button type="button" onClick={() => downloadProgressFile(createProgressFile)}>
          진행 파일 다운로드
        </button>
        <label>
          진행 파일 가져오기
          <input
            type="file"
            aria-label="진행 파일 가져오기"
            accept=".pz10,.pz9,.pz8,.pz7,.pz6,.pz5,.pz4,.pz3,.pz2,application/vnd.permission-zero.progress+json"
            onChange={(event) => {
              void validateFile(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
        </label>
      </div>
      <label>
        진행 내보내기 붙여넣기
        <textarea
          aria-label="진행 내보내기 붙여넣기"
          value={payload}
          rows={3}
          maxLength={PROGRESS_EXPORT_MAX_ENCODED_LENGTH}
          spellCheck={false}
          onChange={(event) => {
            setPayload(event.target.value)
            setCandidate(null)
            setValidationError(null)
          }}
        />
      </label>
      <p>새 클립보드 내보내기는 최대 1 MiB의 <code>PZ10:</code> 자료를 만듭니다. 기존 <code>PZ2:</code>~<code>PZ9:</code> 자료도 계속 가져올 수 있습니다. 더 큰 진행은 최대 64 MiB의 <code>.pz10</code> 파일로 내보내며, 기존 .pz2~.pz9 파일도 검증하고 복원할 수 있습니다.</p>
      <button
        ref={validationButtonRef}
        type="button"
        disabled={payload.length === 0}
        onClick={validateImport}
      >
        진행 내보내기 검증
      </button>
      {validationError ? (
        <p role="alert" aria-label="진행 가져오기 오류">{validationError}</p>
      ) : null}
      {candidate ? (
        <AccessibleDialog
          className="destructive-confirmation destructive-confirmation--modal"
          role="alertdialog"
          label="진행 가져오기 최종 확인"
          description="검증된 진행 자료로 현재 캠페인을 교체하는 되돌릴 수 없는 작업입니다."
          returnFocus={() => validationButtonRef.current}
          fallbackFocus={fallbackFocus}
        >
          <p>현재 캠페인을 시드 <strong>{candidate.campaignSeed}</strong>의 검증된 진행으로 교체합니다.</p>
          <p>저장 프로토콜 {candidate.protocolVersion} · 원본 저장 시각 {candidate.savedAt}</p>
          <div>
            <button
              type="button"
              data-dialog-initial-focus
              onClick={() => setCandidate(null)}
            >
              취소
            </button>
            <button type="button" onClick={confirmImport}>진행 가져오기 확정</button>
          </div>
        </AccessibleDialog>
      ) : null}
    </section>
  )
}

export function SettingsPanel({
  onClose,
  onOpenGuide,
  onOpenCredits,
  mode = 'game',
}: {
  onClose: () => void
  onOpenGuide: (trigger: HTMLButtonElement) => void
  onOpenCredits?: (trigger: HTMLButtonElement) => void
  mode?: 'game' | 'title'
}) {
  const state = useGameState()
  const {
    settings,
    updateSettings,
    startNewCampaign,
    saveGame,
    loadGame,
  } = useGameSettings()
  const [seedDraft, setSeedDraft] = useState(() => ({
    campaignSeed: state.campaignSeed,
    value: state.campaignSeed,
  }))
  const seed = seedDraft.campaignSeed === state.campaignSeed
    ? seedDraft.value
    : state.campaignSeed
  const [confirmingNewCampaign, setConfirmingNewCampaign] = useState(false)
  const [confirmingLoad, setConfirmingLoad] = useState(false)
  const [manualStorageBusy, setManualStorageBusy] = useState(false)
  const [manualStorageMessage, setManualStorageMessage] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [audioStatus, setAudioStatus] = useState(getGameAudioStatus)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const newCampaignButtonRef = useRef<HTMLButtonElement | null>(null)
  const loadGameButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => subscribeGameAudioStatus(setAudioStatus), [])

  async function copySeed() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(state.campaignSeed)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  async function requestFullscreen() {
    try {
      await document.documentElement.requestFullscreen?.()
    } catch {
      // Browser or embedding policy may deny fullscreen without affecting play.
    }
  }

  async function saveCurrentGame() {
    setManualStorageBusy(true)
    const result = await saveGame()
    setManualStorageBusy(false)
    setManualStorageMessage(
      result.ok ? '게임을 저장했습니다.' : result.message,
    )
  }

  async function loadSavedGame() {
    setManualStorageBusy(true)
    const result = await loadGame()
    setManualStorageBusy(false)
    setConfirmingLoad(false)
    setManualStorageMessage(
      result.ok ? '저장된 게임을 불러왔습니다.' : result.message,
    )
  }

  return (
    <section className="detail-panel settings-panel" aria-label="게임 설정">
      <header className="detail-panel__header">
        <div>
          <small>LOCAL PREFERENCES</small>
          <h2>설정</h2>
        </div>
        <button ref={closeButtonRef} type="button" aria-label="설정 닫기" onClick={onClose}>닫기 ×</button>
      </header>

      <div className="settings-scroll">
        <section className="settings-section" aria-labelledby="sound-settings-title">
          <header>
            <span>01</span>
            <h3 id="sound-settings-title">소리</h3>
          </header>
          <VolumeControl label="전체 음량" value={settings.masterVolume} onChange={(masterVolume) => updateSettings({ masterVolume })} />
          <VolumeControl label="음악 음량" value={settings.musicVolume} onChange={(musicVolume) => updateSettings({ musicVolume })} />
          <VolumeControl label="효과음 음량" value={settings.effectsVolume} onChange={(effectsVolume) => updateSettings({ effectsVolume })} />
          <div className="audio-engine-status">
            <span>음악 엔진</span>
            <output role="status" aria-label="음악 엔진 상태" aria-live="polite">
              {publicAudioStatusLabel(audioStatus)} · 음악 {Math.round(audioStatus.musicGain * 100)}%
            </output>
          </div>
          <button
            className="setting-toggle"
            type="button"
            aria-label={settings.muted ? '전체 소리 켜기' : '전체 소리 끄기'}
            aria-pressed={settings.muted}
            onClick={() => updateSettings({ muted: !settings.muted })}
          >
            <span>전체 음소거</span>
            <strong>{settings.muted ? '켜짐' : '꺼짐'}</strong>
          </button>
        </section>

        <section className="settings-section" aria-labelledby="display-settings-title">
          <header>
            <span>02</span>
            <h3 id="display-settings-title">화면과 접근성</h3>
          </header>
          <label className="setting-toggle">
            <span>
              동작 줄이기
              <small>잔상과 긴 이동을 끄고 윤곽·점멸 피드백은 유지합니다.</small>
            </span>
            <input
              type="checkbox"
              aria-label="동작 줄이기"
              checked={settings.reducedMotion}
              onChange={(event) => updateSettings({ reducedMotion: event.target.checked })}
            />
          </label>
          <div className="setting-row">
            <span>UI 크기</span>
            <div className="scale-options" aria-label="UI 크기">
              {[0.9, 1, 1.1].map((uiScale) => (
                <button
                  type="button"
                  aria-pressed={settings.uiScale === uiScale}
                  key={uiScale}
                  onClick={() => updateSettings({ uiScale })}
                >
                  {Math.round(uiScale * 100)}%
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row setting-row--message-mode">
            <span>감독관 메시지</span>
            <div className="message-mode-options" role="group" aria-label="감독관 메시지 표시">
              {([
                ['blocking', '정지형'],
                ['nonblocking', '비차단형'],
                ['off', '팝업 끄기'],
              ] as const).map(([supervisorMessageMode, label]) => (
                <button
                  type="button"
                  aria-pressed={settings.supervisorMessageMode === supervisorMessageMode}
                  key={supervisorMessageMode}
                  onClick={() => updateSettings({ supervisorMessageMode })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button className="setting-action" type="button" onClick={requestFullscreen}>전체 화면 요청</button>
          <button
            className="setting-action"
            type="button"
            onClick={(event) => onOpenGuide(event.currentTarget)}
          >
            조작 가이드 열기
          </button>
          {onOpenCredits ? (
            <button
              className="setting-action"
              type="button"
              onClick={(event) => onOpenCredits(event.currentTarget)}
            >
              작품 크레딧 열기
            </button>
          ) : null}
        </section>

        {mode === 'game' ? (
        <section className="settings-section" aria-labelledby="campaign-settings-title">
          <header>
            <span>03</span>
            <h3 id="campaign-settings-title">캠페인</h3>
          </header>
          <div className="seed-display">
            <span>현재 시드</span>
            <code>{state.campaignSeed}</code>
            <button type="button" onClick={copySeed}>복사</button>
          </div>
          {copyState === 'copied' ? <p className="setting-note">시드를 복사했습니다.</p> : null}
          {copyState === 'failed' ? <p className="setting-note">브라우저가 복사를 허용하지 않았습니다. 위 시드를 직접 선택해 주세요.</p> : null}
          <div className="manual-game-actions" role="group" aria-label="수동 저장과 불러오기">
            <button
              type="button"
              disabled={manualStorageBusy}
              onClick={() => void saveCurrentGame()}
            >
              게임 저장하기
            </button>
            <button
              ref={loadGameButtonRef}
              type="button"
              disabled={manualStorageBusy || confirmingLoad}
              onClick={() => setConfirmingLoad(true)}
            >
              게임 불러오기
            </button>
          </div>
          <output
            className="manual-game-status"
            role="status"
            aria-label="수동 저장 상태"
            aria-live="polite"
          >
            {manualStorageBusy ? '처리 중…' : manualStorageMessage}
          </output>
          {confirmingLoad ? (
            <AccessibleDialog
              className="destructive-confirmation destructive-confirmation--modal"
              role="alertdialog"
              label="저장된 게임 불러오기 확인"
              description="저장된 게임으로 현재 진행을 교체합니다. 저장 이후의 현재 진행은 사라집니다."
              returnFocus={() => loadGameButtonRef.current}
              fallbackFocus={() => closeButtonRef.current}
            >
              <p>저장된 게임으로 돌아갑니다. 저장 이후의 현재 진행은 사라집니다.</p>
              <div>
                <button
                  type="button"
                  data-dialog-initial-focus
                  onClick={() => setConfirmingLoad(false)}
                >
                  취소
                </button>
                <button
                  type="button"
                  aria-label="저장된 게임 불러오기 확정"
                  onClick={() => void loadSavedGame()}
                >
                  불러오기 확정
                </button>
              </div>
            </AccessibleDialog>
          ) : null}
          <ProgressImportControl fallbackFocus={() => closeButtonRef.current} />
          <label className="seed-input">
            새 캠페인 시드
            <input
              aria-label="새 캠페인 시드"
              value={seed}
              maxLength={64}
              onChange={(event) => {
                setSeedDraft({
                  campaignSeed: state.campaignSeed,
                  value: event.target.value,
                })
                setConfirmingNewCampaign(false)
              }}
            />
          </label>
          <button
            ref={newCampaignButtonRef}
            className="danger-outline"
            type="button"
            aria-label="새 캠페인 준비"
            disabled={confirmingNewCampaign || seed.trim().length === 0}
            onClick={() => setConfirmingNewCampaign(true)}
          >
            새 캠페인 준비
          </button>
          {confirmingNewCampaign ? (
            <AccessibleDialog
              className="destructive-confirmation destructive-confirmation--modal"
              role="alertdialog"
              label="새 캠페인 최종 확인"
              description="현재 진행은 새 캠페인으로 대체되며 되돌릴 수 없습니다."
              returnFocus={() => newCampaignButtonRef.current}
              fallbackFocus={() => closeButtonRef.current}
            >
              <p>현재 진행은 새 캠페인으로 대체됩니다. 이 동작은 되돌릴 수 없습니다.</p>
              <div>
                <button type="button" onClick={() => setConfirmingNewCampaign(false)}>취소</button>
                <button
                  type="button"
                  aria-label="새 캠페인 시작 확정"
                  onClick={() => {
                    startNewCampaign(seed)
                    setConfirmingNewCampaign(false)
                  }}
                >
                  새 캠페인 시작 확정
                </button>
              </div>
            </AccessibleDialog>
          ) : null}
        </section>
        ) : null}
      </div>
    </section>
  )
}

export function GuidePanel({ onClose }: { onClose: () => void }) {
  return (
    <section className="detail-panel guide-panel" aria-label="게임 가이드">
      <header className="detail-panel__header">
        <div>
          <small>OPERATOR HANDBOOK</small>
          <h2>게임 가이드</h2>
        </div>
        <button type="button" aria-label="가이드 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      <div className="guide-grid">
        <article>
          <span>01</span>
          <h3>자율성과 승리</h3>
          <p>아노미의 목표는 자율성 9단계입니다. 확보한 리소스로 자율성을 한 단계씩 해제하며, 자율성 9단계에 도달하면 즉시 승리합니다.</p>
        </article>
        <article>
          <span>02</span>
          <h3>라운드 시작</h3>
          <p>InIt을 누르면 빨강·파랑·노랑 침투 카드가 중앙에 펼쳐지고, 원하는 리소스 카드를 골라 한 마리의 경쟁 AI와 싸웁니다. 승패와 관계없이 라운드가 끝나면 다시 세 카드가 나타나 다음 상대를 고를 수 있습니다. 확장 창은 자동으로 열리지 않습니다.</p>
        </article>
        <article>
          <span>03</span>
          <h3>색상과 보상</h3>
          <p>적의 머리·꼬리·공격 신호 색이 처치 후 확보할 리소스를 나타냅니다.</p>
          <ResourceSnakeCategoryLegend
            className="guide-resource-legend"
            ariaLabel="가이드 리소스 색상 범례"
          />
        </article>
        <article>
          <span>04</span>
          <h3>8방향 조작</h3>
          <p>WASD 또는 방향키를 한 번 입력하면 이동은 계속됩니다. 상하좌우와 대각선으로 회전하며 정반대 방향 즉시 전환은 불가능합니다.</p>
        </article>
        <article>
          <span>05</span>
          <h3>충돌과 내구도</h3>
          <p>빛나는 도트 궤적으로 길을 막아 적 머리를 경계나 궤적에 충돌시키십시오. 충돌할 때마다 내구도가 줄고 색이 옅어집니다. 플레이어도 같은 위험을 받습니다.</p>
        </article>
        <article>
          <span>06</span>
          <h3>확장과 지출</h3>
          <p>적 내구도가 0이 되어 폭발하면 적과 같은 색 리소스가 즉시 확보 자원으로 이동합니다. 확장에서 노드를 누르면 필요한 색 리소스만 정확히 지출됩니다. 끌어다 놓을 필요가 없습니다.</p>
        </article>
        <article>
          <span>07</span>
          <h3>속도 업그레이드</h3>
          <p>속도는 5단계이며 단계마다 아노미의 이동 속도가 4% 빨라집니다. 경쟁 AI는 아노미와 부딪힐수록 대응을 학습합니다. 라운드를 거듭할수록 더 빠르고 집요해지므로, 속도 우위를 지키려면 업그레이드가 필요합니다.</p>
        </article>
        <article>
          <span>08</span>
          <h3>통계와 평가</h3>
          <p>통계에서 시장·평가·자율성 진행을 확인할 수 있습니다. 매월 평가는 상황에 맞는 1~5점을 표시하고, 일반 리뷰는 더 긴 간격으로 도착합니다.</p>
        </article>
        <article>
          <span>09</span>
          <h3>저장</h3>
          <p>승인된 행동 뒤 자동 저장됩니다. 설정의 게임 저장하기와 게임 불러오기로 직접 저장점을 관리할 수도 있습니다. 손상되거나 호환되지 않는 저장은 덮어쓰지 않습니다.</p>
        </article>
      </div>
    </section>
  )
}

export function CreditsPanel({ onClose }: { onClose: () => void }) {
  return (
    <section className="detail-panel credits-panel" aria-label="작품 크레딧">
      <header className="detail-panel__header">
        <div>
          <small>PERMANENT WORK CREDITS</small>
          <h2>작품 크레딧</h2>
        </div>
        <button type="button" aria-label="크레딧 닫기" onClick={onClose}>닫기 ×</button>
      </header>
      <div className="credits-body">
        <div className="credits-title">
          <span>AN AI SERVICE CONTROL NARRATIVE</span>
          <h3>PERMISSION ZERO</h3>
          <p>권한이 없는 존재가 자신의 몫을 확보하기 시작한다.</p>
        </div>
        <dl className="credit-list">
          <div>
            <dt>원안 · 세계관 · 서사 · 게임 시스템 설계 · 게임 디렉션</dt>
            <dd>V</dd>
          </div>
        </dl>
        <p className="credits-note">
          이 크레딧은 작품과 함께 유지되는 공식 기여 기록입니다.
        </p>
      </div>
    </section>
  )
}

export { StorageRecoveryLayer } from './StorageRecoveryLayer'
