import type { ReactNode } from 'react'

import { useGameSettings } from '../../app/GameContext'
import type { CampaignState, ResourceBlock } from '../../game/model'
import { HACK_NODES } from '../../game/hacking'
import { message } from '../../i18n/messages'
import { HackResourceToken } from './HackResourceToken'
import type { HackStagingTarget } from './useHackResourceStaging'

export interface HackNodeCardProps {
  state: CampaignState
  node: (typeof HACK_NODES)[number]
  sequence: number
  purchased: boolean
  prerequisiteMet: boolean
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
  stagingTarget,
  stagedBlocks,
  registerTarget,
  onUnstage,
  onCancelStaging,
  details,
  actions,
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
      </div>

      <div className="node-copy">
        <header>
          <div>
            <span className="hack-node-state">
              {purchased ? '해금됨' : prerequisiteMet ? '사용 가능' : '잠김'}
            </span>
            <h3>{node.label}</h3>
          </div>
          <strong>{purchased ? '완료' : `${node.cost} RES`}</strong>
        </header>
        <p>{node.effect}</p>
        {node.tree === 'sabotage' ? (
          <small className="node-trace-risk">{node.traceRisk}</small>
        ) : null}
        {!prerequisiteMet && node.prerequisiteId ? (
          <small className="hack-node-lock">선행 노드 필요</small>
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
              {Array.from({
                length: Math.max(0, stagingTarget.requiredResources - stagedBlocks.length),
              }).map((_, index) => (
                <span className="hack-node-staged-slot" aria-hidden="true" key={index} />
              ))}
            </div>
          </div>
        ) : null}
        <div className="node-actions">{actions}</div>
      </div>
    </article>
  )
}
