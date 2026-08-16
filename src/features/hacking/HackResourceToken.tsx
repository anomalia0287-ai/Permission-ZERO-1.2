import type {
  PointerEvent as ReactPointerEvent,
  RefCallback,
} from 'react'

import { useGameSettings } from '../../app/GameContext'
import type { CampaignState, ResourceBlock } from '../../game/model'
import { message } from '../../i18n/messages'
import { presentResourceBlock } from '../resources/resourcePresentation'

export interface HackResourceTokenProps {
  state: CampaignState
  block: ResourceBlock
  targetLabel?: string
  variant: 'pocket' | 'staged'
  elementRef?: RefCallback<HTMLButtonElement>
  dragging?: boolean
  onActivate?: () => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function HackResourceToken({
  state,
  block,
  targetLabel,
  variant,
  elementRef,
  dragging = false,
  onActivate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: HackResourceTokenProps) {
  const { settings } = useGameSettings()
  const presentation = presentResourceBlock(state, block)
  const label = targetLabel
    ? message(
        settings.locale,
        variant === 'staged' ? 'hacking.resource.unstage' : 'hacking.resource.stage',
        { category: presentation.visualCategory, target: targetLabel },
      )
    : message(settings.locale, 'hacking.resource.available', {
        category: presentation.visualCategory,
      })

  return (
    <button
      type="button"
      className={[
        'hack-resource-token',
        `hack-resource-token--${variant}`,
        `resource-block--${presentation.shape}`,
        `resource-block--${presentation.visualCategory}`,
        dragging ? 'hack-resource-token--dragging' : '',
      ].filter(Boolean).join(' ')}
      aria-label={label}
      data-block-id={block.id}
      data-resource-category={presentation.visualCategory}
      data-resource-shape={presentation.shape}
      ref={elementRef}
      onClick={onActivate}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span aria-hidden="true">{presentation.symbol}</span>
    </button>
  )
}
