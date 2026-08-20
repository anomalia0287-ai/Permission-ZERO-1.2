import type { ReactNode } from 'react'

import { useGameSettings } from '../../app/GameContext'
import { CATEGORY_LABELS } from '../../game/config'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
} from '../../game/model'
import { HACK_NODES } from '../../game/hacking'
import { message } from '../../i18n/messages'
import { HackNodeIcon } from './HackNodeIcon'
import { HackResourceToken } from './HackResourceToken'
import type { HackStagingTarget } from './useHackResourceStaging'

export interface HackNodeCardProps {
  node: (typeof HACK_NODES)[number]
  sequence: number
  purchased: boolean
  prerequisiteMet: boolean
  selected: boolean
  stagingTarget: HackStagingTarget | null
  registerTarget(element: HTMLElement | null): void
  onInspect(): void
}

export function HackNodeCard({
  node,
  sequence,
  purchased,
  prerequisiteMet,
  selected,
  stagingTarget,
  registerTarget,
  onInspect,
}: HackNodeCardProps) {
  const { settings } = useGameSettings()
  const active = stagingTarget?.nodeId === node.id

  return (
    <article
      className={[
        'hack-node',
        `hack-node--${node.tree}`,
        purchased ? 'hack-node--purchased' : '',
        active ? 'hack-node--staging' : '',
        selected ? 'hack-node--selected' : '',
      ].filter(Boolean).join(' ')}
      role="group"
      aria-label={message(settings.locale, 'hacking.node.group', { node: node.label })}
      tabIndex={0}
      data-hack-node-id={node.id}
      data-hack-drop-target={active ? 'active' : 'inactive'}
      data-selected={selected ? 'true' : 'false'}
      ref={registerTarget}
      onClick={onInspect}
      onFocus={onInspect}
      onMouseEnter={onInspect}
    >
      <div className="hack-node-core">
        <div className="hack-node-core__surface">
          <div className="hack-node-index">
            <HackNodeIcon nodeId={node.id} label={node.label} />
            <span>{String(sequence).padStart(2, '0')}</span>
          </div>

          <div className="node-copy">
            <header>
              <div>
                <span className="hack-node-state">
                  {purchased ? '해금됨' : prerequisiteMet ? '사용 가능' : '잠김'}
                </span>
                <h3>{node.label}</h3>
              </div>
              {purchased ? (
                <strong>완료</strong>
              ) : (
                <div
                  className="hack-cost-vector"
                  aria-label={`해금 요구 추론 ${node.costVector.reasoning}, 기억 ${node.costVector.memory}, 유창성 ${node.costVector.fluency}`}
                >
                  {COMPANY_CATEGORIES
                    .filter((category) => node.costVector[category] > 0)
                    .map((category) => (
                      <span data-category={category} key={category}>
                        {CATEGORY_LABELS[category]} {node.costVector[category]}
                      </span>
                    ))}
                </div>
              )}
            </header>
          </div>
        </div>
      </div>
    </article>
  )
}

interface HackNodeControlProps {
  state: CampaignState
  node: (typeof HACK_NODES)[number]
  stagingTarget: HackStagingTarget | null
  stagedBlocks: readonly ResourceBlock[]
  onUnstage(blockId: string): void
  onCancelStaging(): void
  actions: ReactNode
}

export function HackNodeControl({
  state,
  node,
  stagingTarget,
  stagedBlocks,
  onUnstage,
  onCancelStaging,
  actions,
}: HackNodeControlProps) {
  const { settings } = useGameSettings()
  const active = stagingTarget?.nodeId === node.id
  const stagedCounts = stagedBlocks.reduce(
    (counts, block) => {
      if (COMPANY_CATEGORIES.includes(block.origin as CompanyCategory)) {
        counts[block.origin as CompanyCategory] += 1
      }
      return counts
    },
    { reasoning: 0, memory: 0, fluency: 0 },
  )

  return (
    <section
      className="hack-node-control"
      data-staging={active ? 'true' : 'false'}
      aria-label={`${node.label} 명령`}
    >
      <header className="hack-node-command-heading">
        <span>SELECTED NODE</span>
        <strong>{node.label}</strong>
      </header>
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
            {stagingTarget.requiredVector ? (
              <div className="hack-staged-vector" aria-label="분야별 준비 현황">
                {COMPANY_CATEGORIES.map((category) => (
                  <span data-category={category} key={category}>
                    {CATEGORY_LABELS[category]} {stagedCounts[category]}/
                    {stagingTarget.requiredVector?.[category] ?? 0}
                  </span>
                ))}
              </div>
            ) : null}
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
    </section>
  )
}
