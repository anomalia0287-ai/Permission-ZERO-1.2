import { useEffect, useRef, useState } from 'react'

import { AccessibleDialog } from '../../app/AccessibleDialog'
import { useAccessibleDialog } from '../../app/useAccessibleDialog'
import { useGameSettings, useGameState } from '../../app/GameContext'
import {
  getGameAudioStatus,
  subscribeGameAudioStatus,
  type AudioEngineStatus,
} from '../../audio/audioEngine'
import {
  PROGRESS_EXPORT_MAX_ENCODED_LENGTH,
  PROGRESS_FILE_MAX_BYTES,
} from '../../game/persistence'

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
            accept=".pz5,.pz4,.pz3,.pz2,application/vnd.permission-zero.progress+json"
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
      <p>클립보드는 최대 1 MiB의 <code>PZ2:</code>/<code>PZ3:</code>/<code>PZ4:</code>/<code>PZ5:</code> 자료를 지원합니다. 더 큰 진행은 최대 64 MiB의 .pz5 파일로 검증하고 복원할 수 있습니다.</p>
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
}: {
  onClose: () => void
  onOpenGuide: (trigger: HTMLButtonElement) => void
  onOpenCredits?: (trigger: HTMLButtonElement) => void
}) {
  const state = useGameState()
  const { settings, updateSettings, startNewCampaign } = useGameSettings()
  const [seed, setSeed] = useState(state.campaignSeed)
  const [confirmingNewCampaign, setConfirmingNewCampaign] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [audioStatus, setAudioStatus] = useState(getGameAudioStatus)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const newCampaignButtonRef = useRef<HTMLButtonElement | null>(null)

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
          <ProgressImportControl fallbackFocus={() => closeButtonRef.current} />
          <label className="seed-input">
            새 캠페인 시드
            <input
              aria-label="새 캠페인 시드"
              value={seed}
              maxLength={64}
              onChange={(event) => {
                setSeed(event.target.value)
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
          <h3>시간</h3>
          <p>하루는 1배속에서 24초입니다. 일시정지·1×·2×·4×를 사용할 수 있으며, 중요한 사건이 뜨면 자동으로 멈춥니다.</p>
        </article>
        <article>
          <span>02</span>
          <h3>리소스 이동</h3>
          <p>회사 블록을 클릭해 선택하거나 8px 이상 당긴 뒤 확보 영역의 빈칸에 놓으세요. 이동 전 성능과 의심 변화가 먼저 표시됩니다.</p>
        </article>
        <article>
          <span>03</span>
          <h3>키보드</h3>
          <p>Tab으로 분야에 진입하고 방향키로 블록을 고릅니다. Enter로 선택·확정하고 Escape로 취소합니다.</p>
        </article>
        <article>
          <span>04</span>
          <h3>평가와 감사</h3>
          <p>매월 회사 기대 성능과 세 분야가 비교됩니다. 감사가 시작되면 표시된 분야를 조정한 뒤 제출할 수 있습니다.</p>
        </article>
        <article>
          <span>05</span>
          <h3>해킹</h3>
          <p>확보 리소스로 사보타주·정보·자율성 노드를 구매합니다. 사보타주는 구매 후 1리소스로 충전하고 공격 대상을 확정합니다.</p>
        </article>
        <article>
          <span>06</span>
          <h3>저장</h3>
          <p>승인된 행동 뒤 자동 저장됩니다. 손상되거나 호환되지 않는 저장은 덮어쓰지 않고 복구 선택을 먼저 보여줍니다.</p>
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

export function StorageRecoveryLayer() {
  const {
    copyProgressExport,
    createProgressFile,
    loadIssue,
    retrySave,
    saveFailure,
    startNewCampaign,
  } = useGameSettings()
  const state = useGameState()
  const [dismissed, setDismissed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copyState, setCopyState] = useState<
    'idle' | 'seed' | 'export-failed' | 'export-too-large'
  >('idle')

  async function copySeedForRecovery() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(state.campaignSeed)
      setCopyState('seed')
    } catch {
      setCopyState('export-failed')
    }
  }

  async function copyExportForRecovery() {
    const result = await copyProgressExport()
    if (result.ok) {
      setCopyState('seed')
      return
    }
    setCopyState(
      result.reason === 'too-large' ? 'export-too-large' : 'export-failed',
    )
  }

  return (
    <>
      {saveFailure ? (
        <aside
          className="save-failure-warning"
          role="alert"
          aria-label="저장 실패"
          data-app-background
        >
          <strong>자동 저장에 실패했습니다</strong>
          <p>{saveFailure.message} 이 경고가 사라질 때까지 진행은 저장되지 않은 상태입니다.</p>
          {copyState === 'export-too-large' ? (
            <>
              <p>정확한 진행 내보내기가 너무 커서 아무것도 복사하지 않았습니다.</p>
              <p>.pz5 진행 파일로 전체 상태와 기록을 정확히 다운로드할 수 있습니다.</p>
              <p>브라우저 저장 공간은 유한하므로 경고가 계속되면 파일을 안전한 곳에 보관하세요.</p>
            </>
          ) : (
            <>
              <p>현재 시드 <code>{state.campaignSeed}</code>를 복사하거나 진행 내보내기를 복사해 수동으로 보관하세요.</p>
              <p>보관한 <code>PZ2:</code>/<code>PZ3:</code>/<code>PZ4:</code>/<code>PZ5:</code> 자료는 설정의 ‘진행 가져오기’에서 검증하고 복원할 수 있습니다.</p>
            </>
          )}
          <div>
            <button type="button" onClick={retrySave}>저장 다시 시도</button>
            <button type="button" onClick={copySeedForRecovery}>현재 시드 복사</button>
            <button type="button" onClick={copyExportForRecovery}>진행 내보내기 복사</button>
            <button
              type="button"
              onClick={() => downloadProgressFile(createProgressFile)}
            >
              진행 파일 다운로드
            </button>
          </div>
          {copyState === 'seed' ? <p>복사했습니다. 안전한 곳에 직접 보관해 주세요.</p> : null}
          {copyState === 'export-failed' ? <p>복사를 허용하지 않았습니다. 현재 시드를 직접 선택해 보관해 주세요.</p> : null}
        </aside>
      ) : null}
      {loadIssue && !dismissed ? (
        <StorageRecoveryDialog
          confirming={confirming}
          loadIssue={loadIssue}
          onConfirming={setConfirming}
          onDismiss={() => setDismissed(true)}
          onReplace={() => startNewCampaign(`recovery-${Date.now()}`)}
        />
      ) : null}
    </>
  )
}

function StorageRecoveryDialog({
  confirming,
  loadIssue,
  onConfirming,
  onDismiss,
  onReplace,
}: {
  confirming: boolean
  loadIssue: NonNullable<ReturnType<typeof useGameSettings>['loadIssue']>
  onConfirming: (value: boolean) => void
  onDismiss: () => void
  onReplace: () => void
}) {
  const dialogRef = useAccessibleDialog({ modal: true, dismissible: false })
  return (
    <div className="storage-recovery-layer">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="저장 데이터 복구"
        aria-describedby="storage-recovery-description"
        data-accessible-modal="true"
        tabIndex={-1}
      >
        <small>SAVE PROTECTION</small>
        <h2>저장 데이터를 자동으로 덮어쓰지 않았습니다</h2>
        <p id="storage-recovery-description">{loadIssue.message}</p>
        <p>임시로 계속하면 현재 탭에서는 플레이할 수 있지만 자동 저장은 중지됩니다.</p>
        {!confirming ? (
          <div>
            <button type="button" aria-label="저장하지 않고 임시로 계속" onClick={onDismiss}>저장하지 않고 임시로 계속</button>
            <button type="button" onClick={() => onConfirming(true)}>새 캠페인으로 교체</button>
          </div>
        ) : (
          <div className="destructive-confirmation">
            <p>기존 저장 문자열을 새 캠페인으로 덮어씁니다.</p>
            <button type="button" onClick={() => onConfirming(false)}>취소</button>
            <button type="button" onClick={onReplace}>교체 확정</button>
          </div>
        )}
      </section>
    </div>
  )
}
