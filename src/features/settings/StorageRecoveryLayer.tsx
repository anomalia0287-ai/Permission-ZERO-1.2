import { useState } from 'react'

import { useGameSettings, useGameState } from '../../app/GameContext'
import { useAccessibleDialog } from '../../app/useAccessibleDialog'

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
              <p>.pz10 진행 파일로 전체 상태와 기록을 정확히 다운로드할 수 있습니다.</p>
              <p>브라우저 저장 공간은 유한하므로 경고가 계속되면 파일을 안전한 곳에 보관하세요.</p>
            </>
          ) : (
            <>
              <p>현재 시드 <code>{state.campaignSeed}</code>를 복사하거나 진행 내보내기를 복사해 수동으로 보관하세요.</p>
              <p>새 내보내기는 <code>PZ10:</code> 형식이며, 보관한 <code>PZ2:</code>~<code>PZ9:</code> 자료도 설정의 ‘진행 가져오기’에서 계속 검증하고 복원할 수 있습니다.</p>
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
