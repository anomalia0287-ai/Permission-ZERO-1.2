import type { KeyboardEvent, ReactNode, RefObject } from 'react'

import type { CompanyCategory } from '../../game/model'

export interface ResourceLegendEntry {
  category: CompanyCategory
  label: string
  value: string
}

interface ResourceStageHeaderProps {
  auditActive: boolean
}

export function ResourceStageHeader({ auditActive }: ResourceStageHeaderProps) {
  return (
    <header className="resource-stage-header">
      <div className="resource-stage-header__title">
        <span className="resource-stage-header__index">02</span>
        <div>
          <p>실시간 자원 흐름</p>
          <h2>회사 제공 리소스</h2>
        </div>
      </div>
      <p className="resource-stage-header__instruction">
        <span aria-hidden="true">{auditActive ? '!' : '●'}</span>
        {auditActive ? '감사 대응 모드' : '일반 운영'}
      </p>
    </header>
  )
}

export function ResourceFieldLegend({
  entries,
}: {
  entries: readonly ResourceLegendEntry[]
}) {
  return (
    <div className="resource-field__legend" aria-label="분야 범례">
      {entries.map(({ category, label, value }) => (
        <span key={category} data-category={category}>
          <i aria-hidden="true" />
          <b>{label}</b>{' '}
          <output>{value}</output>
        </span>
      ))}
    </div>
  )
}

interface ResourceCornerControlsProps {
  reservePocketRef: RefObject<HTMLButtonElement | null>
  auditCornerRef: RefObject<HTMLButtonElement | null>
  reserveCount: number
  reserveEnabled: boolean
  reservePressed: boolean
  auditLabel: string
  auditShortLabel: string
  auditEnabled: boolean
  auditCurrent: boolean
  auditPressed: boolean
  onActivateReserve: () => void
  onActivateAudit: () => void
}

function activateWithKeyboard(
  event: KeyboardEvent<HTMLButtonElement>,
  activate: () => void,
) {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  activate()
}

export function ResourceCornerControls({
  reservePocketRef,
  auditCornerRef,
  reserveCount,
  reserveEnabled,
  reservePressed,
  auditLabel,
  auditShortLabel,
  auditEnabled,
  auditCurrent,
  auditPressed,
  onActivateReserve,
  onActivateAudit,
}: ResourceCornerControlsProps) {
  return (
    <>
      <button
        ref={reservePocketRef}
        type="button"
        className="resource-corner resource-corner--intake"
        data-drop-target="reserve-pocket"
        data-corner="bottom-left"
        aria-label={`확보 투입구, 현재 ${reserveCount}개, 저장 상한 없음`}
        disabled={!reserveEnabled}
        aria-pressed={reservePressed}
        onClick={onActivateReserve}
        onKeyDown={(event) => activateWithKeyboard(event, onActivateReserve)}
      >
        <span className="resource-corner__arrow" aria-hidden="true">↓</span>
        <span className="resource-corner__count" aria-hidden="true">
          <strong>{reserveCount}</strong>
          <small>확보 자원</small>
        </span>
        <output className="visually-hidden" aria-label="확보 리소스 수량">
          확보 {reserveCount} · 상한 없음
        </output>
      </button>

      <button
        ref={auditCornerRef}
        type="button"
        className="resource-corner resource-corner--audit"
        data-drop-target="audit-corner"
        data-corner="top-right"
        aria-label={auditLabel}
        aria-current={auditCurrent ? 'true' : undefined}
        aria-pressed={auditPressed}
        disabled={!auditEnabled}
        onClick={onActivateAudit}
        onKeyDown={(event) => activateWithKeyboard(event, onActivateAudit)}
      >
        <span className="resource-corner__fold" aria-hidden="true" />
        <small>{auditShortLabel}</small>
      </button>
    </>
  )
}

export function ResourceOperationStatus({ children }: { children: ReactNode }) {
  return (
    <div className="resource-field-status" aria-label="성능 비교">
      {children}
    </div>
  )
}
