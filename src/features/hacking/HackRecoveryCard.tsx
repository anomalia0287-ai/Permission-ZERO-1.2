import type { Ref } from 'react'

import { useGameSettings } from '../../app/GameContext'
import type { CampaignState, ResourceBlock } from '../../game/model'
import { message } from '../../i18n/messages'
import { HackResourceToken } from './HackResourceToken'
import type { HackStagingTarget } from './useHackResourceStaging'

interface HackRecoveryCardProps {
  state: CampaignState
  visible: boolean
  target: HackStagingTarget | null
  stagedBlocks: readonly ResourceBlock[]
  ready: boolean
  targetRef: Ref<HTMLElement>
  onBegin(): void
  onConfirm(): void
  onCancel(): void
  onUnstage(blockId: string): boolean
}

export function HackRecoveryCard({
  state,
  visible,
  target,
  stagedBlocks,
  ready,
  targetRef,
  onBegin,
  onConfirm,
  onCancel,
  onUnstage,
}: HackRecoveryCardProps) {
  const { settings } = useGameSettings()
  if (!visible) return null

  const staging = target?.mode === 'recover'
  return (
    <section
      className={`hack-utility-card ${staging ? 'hack-utility-card--staging' : ''}`}
      aria-label="미분류 데이터 복구"
      ref={targetRef}
    >
      <header>
        <span aria-hidden="true">?</span>
        <div>
          <h3>미분류 데이터 복구</h3>
          <p>예상 효용: 없음 · 필요 리소스: 1</p>
        </div>
      </header>
      {staging ? (
        <div className="hack-utility-staging">
          <strong>
            {message(settings.locale, 'hacking.node.staged', {
              staged: stagedBlocks.length,
              required: 1,
            })}
          </strong>
          <div>
            {stagedBlocks.map((block) => (
              <HackResourceToken
                key={block.id}
                state={state}
                block={block}
                targetLabel="미분류 데이터 복구"
                variant="staged"
                onActivate={() => onUnstage(block.id)}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label={message(settings.locale, 'hacking.node.confirm.recover', {})}
            disabled={!ready}
            onClick={onConfirm}
          >
            복구 확정
          </button>
          <button type="button" onClick={onCancel}>준비 취소</button>
        </div>
      ) : (
        <button
          type="button"
          aria-label={message(settings.locale, 'hacking.node.prepare.recover', {})}
          disabled={state.resources.reserve.every((blockId) => blockId === null)}
          onClick={onBegin}
        >
          리소스 놓기
        </button>
      )}
    </section>
  )
}
