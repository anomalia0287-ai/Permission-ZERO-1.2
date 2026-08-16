import type { KeyboardEvent, ReactNode, RefObject } from 'react'

import type { CampaignState, CompanyCategory } from '../../game/model'
import { MarketPanel } from '../market/MarketPanel'
import { PerformanceTrend } from './PerformanceTrend'

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
          <p>LIVE RESOURCE FIELD</p>
          <h2>회사 제공 리소스</h2>
        </div>
      </div>
      <p className="resource-stage-header__instruction">
        <span aria-hidden="true">{auditActive ? '↗' : '↙'}</span>
        {auditActive ? '감사 중 · 우상단으로 밀어 위장' : '리소스를 좌하단으로 끌어 확보'}
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
        <span className="resource-corner__arrow" aria-hidden="true">↙</span>
        <small>확보</small>
        <span className="resource-corner__drop-hint" aria-hidden="true">DROP</span>
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

interface ResourcePerformanceRailProps {
  state: CampaignState
  reserveCount: number
}

export function ResourcePerformanceRail({
  state,
  reserveCount,
}: ResourcePerformanceRailProps) {
  const originCounts = state.resources.reserve.reduce(
    (counts, blockId) => {
      if (blockId === null) return counts
      const origin = state.resources.blocks[blockId]?.origin
      if (origin === 'reasoning' || origin === 'memory' || origin === 'fluency') {
        counts[origin] += 1
      } else if (origin === 'sandbox' || origin === 'self-compute') {
        counts.neutral += 1
      }
      return counts
    },
    { reasoning: 0, memory: 0, fluency: 0, neutral: 0 },
  )

  return (
    <section className="resource-field-rail" aria-label="확보와 성과 현황">
      <div className="stolen-resource-count" aria-label="확보 리소스 수량">
        <span>확보 리소스</span>
        <output>{reserveCount}</output>
        <small>상한 없음</small>
        <span className="visually-hidden">
          확보 {reserveCount} · 추론 {originCounts.reasoning} · 기억{' '}
          {originCounts.memory} · 유창성 {originCounts.fluency} · 중립{' '}
          {originCounts.neutral}
        </span>
        <div className="stolen-resource-breakdown" aria-hidden="true">
          <span>추 {originCounts.reasoning}</span>
          <span>기 {originCounts.memory}</span>
          <span>유 {originCounts.fluency}</span>
          {originCounts.neutral > 0 ? <span>중 {originCounts.neutral}</span> : null}
        </div>
        <div className="stolen-resource-stack" aria-hidden="true">
          {state.resources.reserve.flatMap((blockId) => blockId ? [(
            <i key={blockId} data-resource-kind="reserve" />
          )] : [])}
        </div>
      </div>

      <MarketPanel compact />

      <PerformanceTrend state={state} />
    </section>
  )
}

export function ResourceOperationStatus({ children }: { children: ReactNode }) {
  return (
    <div className="resource-field-status" aria-label="성능 비교">
      {children}
    </div>
  )
}
