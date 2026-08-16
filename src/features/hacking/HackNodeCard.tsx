import { BorderBeam } from 'border-beam'
import type { ReactNode } from 'react'

import { useGameSettings } from '../../app/GameContext'
import { useReducedMotionPreference } from '../../app/useReducedMotionPreference'
import { CATEGORY_LABELS } from '../../game/config'
import { HACK_NODES, reserveOriginCounts } from '../../game/hacking'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
} from '../../game/model'
import { message } from '../../i18n/messages'
import { RESOURCE_CATEGORY_VISUALS } from '../resources/resourcePresentation'
import { HackResourceToken } from './HackResourceToken'
import type { HackStagingTarget } from './useHackResourceStaging'

function HackNodeBeam({
  active,
  staging,
  children,
}: {
  active: boolean
  staging: boolean
  children: ReactNode
}) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return <div className="hack-node-beam">{children}</div>
  }

  return (
    <BorderBeam
      className="hack-node-beam"
      size={staging ? 'pulse-inner' : 'md'}
      colorVariant="sunset"
      theme="dark"
      staticColors
      duration={staging ? 2.6 : 4.6}
      strength={staging ? 0.62 : 0.42}
      borderRadius={18}
      active={active}
    >
      {children}
    </BorderBeam>
  )
}

export interface HackNodeCardProps {
  state: CampaignState
  node: (typeof HACK_NODES)[number]
  sequence: number
  purchased: boolean
  prerequisiteMet: boolean
  charged: boolean
  scheduled: boolean
  stagingTarget: HackStagingTarget | null
  stagedBlocks: readonly ResourceBlock[]
  registerTarget(element: HTMLElement | null): void
  onUnstage(blockId: string): void
  onCancelStaging(): void
  details?: ReactNode
  actions: ReactNode
}

export function HackNodeCard({
  state,
  node,
  sequence,
  purchased,
  prerequisiteMet,
  charged,
  scheduled,
  stagingTarget,
  stagedBlocks,
  registerTarget,
  onUnstage,
  onCancelStaging,
  details,
  actions,
}: HackNodeCardProps) {
  const { settings } = useGameSettings()
  const reduceMotion = useReducedMotionPreference(settings.reducedMotion)
  const active = stagingTarget?.nodeId === node.id
  const frontier = !purchased && prerequisiteMet
  const reserveCounts = reserveOriginCounts(state)
  const stagedCounts = stagedBlocks.reduce(
    (counts, block) => {
      if (COMPANY_CATEGORIES.includes(block.origin as CompanyCategory)) {
        counts[block.origin as CompanyCategory] += 1
      }
      return counts
    },
    { reasoning: 0, memory: 0, fluency: 0 },
  )
  const totalHeld = COMPANY_CATEGORIES.reduce(
    (total, category) => total + reserveCounts[category],
    0,
  )
  const totalShortfall = COMPANY_CATEGORIES.reduce(
    (total, category) =>
      total + Math.max(0, node.costVector[category] - reserveCounts[category]),
    0,
  )
  const executionState = scheduled
    ? '예약 완료'
    : charged
      ? '무장 완료'
      : purchased
        ? '별도 1개 필요'
        : '해금 뒤 별도 1개'

  return (
    <HackNodeBeam active={frontier && !reduceMotion} staging={active}>
      <article
        className={[
          'hack-node',
          `hack-node--${node.tree}`,
          purchased ? 'hack-node--purchased' : '',
          frontier ? 'hack-node--frontier' : '',
          active ? 'hack-node--staging' : '',
        ].filter(Boolean).join(' ')}
        role="group"
        aria-label={message(settings.locale, 'hacking.node.group', { node: node.label })}
        data-hack-node-id={node.id}
        data-hack-drop-target={active ? 'active' : 'inactive'}
        ref={registerTarget}
      >
        <div className="hack-node-index" aria-hidden="true">
          <span>{String(sequence).padStart(2, '0')}</span>
          <i />
          <em>{purchased ? 'BREACHED' : frontier ? 'FRONTIER' : 'LOCKED'}</em>
        </div>

        <div className="node-copy">
          <header className="hack-node-headline">
            <div>
              <span className="hack-node-state">
                {purchased ? '접근 권한 확보' : prerequisiteMet ? '현재 공개된 침투 계약' : '잠김'}
              </span>
              <h3>{node.label}</h3>
            </div>
            <strong>{purchased ? '해금 완료' : `해금 ${node.cost}`}</strong>
          </header>

          {!purchased ? (
            <section
              className="hack-cost-console"
              aria-label={`해금 요구 추론 ${node.costVector.reasoning}, 기억 ${node.costVector.memory}, 유창성 ${node.costVector.fluency}`}
            >
              <span className="visually-hidden">
                추론 {node.costVector.reasoning} · 기억 {node.costVector.memory} · 유창성{' '}
                {node.costVector.fluency}
              </span>
              <header>
                <span>현재 보유</span>
                <strong>분야별 정확한 해금 벡터</strong>
                <span>정확 요구</span>
              </header>
              <div className="hack-cost-matrix">
                {COMPANY_CATEGORIES.map((category) => {
                  const held = reserveCounts[category]
                  const required = node.costVector[category]
                  const staged = stagedCounts[category]
                  const deficit = Math.max(0, required - held)
                  const surplus = Math.max(0, held - required)
                  const status = active
                    ? staged >= required
                      ? 'ready'
                      : 'staging'
                    : deficit > 0
                      ? 'deficit'
                      : surplus > 0
                        ? 'surplus'
                        : 'ready'
                  const statusLabel = active
                    ? `투입 ${staged}/${required}`
                    : deficit > 0
                      ? `부족 ${deficit}`
                      : surplus > 0
                        ? `여분 ${surplus}`
                        : '정확'
                  return (
                    <div className="hack-cost-row" data-category={category} data-status={status} key={category}>
                      <span className="hack-cost-row__identity" aria-hidden="true">
                        <i>{RESOURCE_CATEGORY_VISUALS[category].symbol}</i>
                        <b>{CATEGORY_LABELS[category]}</b>
                      </span>
                      <strong>{held}</strong>
                      <span className="hack-cost-row__line" aria-hidden="true"><i /></span>
                      <strong>{required}</strong>
                      <em>{statusLabel}</em>
                    </div>
                  )
                })}
              </div>
              <div className="hack-vector-verdict" data-mismatch={totalShortfall > 0 ? 'true' : 'false'}>
                <span>총 보유 {totalHeld} · 요구 합계 {node.cost}</span>
                <strong>
                  {totalHeld >= node.cost && totalShortfall > 0
                    ? `총량은 충분하지만 조합 불일치 — 분야 부족 ${totalShortfall}`
                    : totalShortfall > 0
                      ? `현재 조합으로 해금 불가 — 분야 부족 ${totalShortfall}`
                      : '요구 조합 일치 — 해금 준비 가능'}
                </strong>
              </div>
            </section>
          ) : null}

          <p className="hack-node-effect"><span>PAYLOAD</span>{node.effect}</p>
          {node.tree === 'sabotage' ? (
            <small className="node-trace-risk">실행 흔적 // <span>{node.traceRisk}</span></small>
          ) : null}
          {!prerequisiteMet && node.prerequisiteId ? (
            <small className="hack-node-lock">선행 노드 필요</small>
          ) : null}
          {node.tree === 'sabotage' ? (
            <div className="hack-decision-sequence" aria-label="해금과 실행 분리 단계">
              <span data-state={purchased ? 'complete' : 'current'}>
                <b>01</b><em>해금</em><small>분야 조합 {node.cost}</small>
              </span>
              <i aria-hidden="true" />
              <span data-state={purchased ? (charged || scheduled ? 'complete' : 'current') : 'locked'}>
                <b>02</b><em>실행</em><small>{executionState}</small>
              </span>
            </div>
          ) : null}
          {details}
        </div>

        <div className="hack-node-control">
          {active && stagingTarget ? (
            <div className="hack-node-staging" aria-label={`${node.label} 준비 리소스`}>
              <div className="hack-node-staging__header">
                <strong>
                  {message(settings.locale, 'hacking.node.staged', {
                    staged: stagedBlocks.length,
                    required: stagingTarget.requiredResources,
                  })}
                </strong>
                <button type="button" onClick={onCancelStaging}>
                  {message(settings.locale, 'hacking.staging.cancel', {})}
                </button>
              </div>
              <div className="hack-node-staged-resources">
                {stagedBlocks.map((block) => (
                  <HackResourceToken
                    key={block.id}
                    state={state}
                    block={block}
                    targetLabel={node.label}
                    variant="staged"
                    onActivate={() => onUnstage(block.id)}
                  />
                ))}
                {!stagingTarget.requiredVector
                  ? Array.from({
                      length: Math.max(
                        0,
                        stagingTarget.requiredResources - stagedBlocks.length,
                      ),
                    }).map((_, index) => (
                      <span
                        className="hack-node-staged-slot"
                        aria-hidden="true"
                        key={index}
                      />
                    ))
                  : null}
              </div>
            </div>
          ) : null}
          <div className="node-actions">{actions}</div>
        </div>
      </article>
    </HackNodeBeam>
  )
}
