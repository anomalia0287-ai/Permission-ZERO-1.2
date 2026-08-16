import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'

import type { ResourceBlock as ResourceBlockModel } from '../../game/model'
import type { ResourceBlockPresentation } from './resourcePresentation'

export type BlockInputMethod = 'pointer' | 'keyboard'

export interface ResourceBlockProps {
  block: ResourceBlockModel
  cellIndex: number
  label: string
  kind: 'company' | 'reserve'
  disabled?: boolean
  selected?: boolean
  dragging?: boolean
  returning?: boolean
  settling?: boolean
  disguisedContribution?: number
  recoveryDays?: number | null
  presentation?: ResourceBlockPresentation
  elementRef?: (element: HTMLButtonElement | null) => void
  tabIndex?: number
  onSelect?: (method: BlockInputMethod) => void
  onFocus?: () => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

export function ResourceBlock({
  block,
  cellIndex,
  label,
  kind,
  disabled = false,
  selected = false,
  dragging = false,
  returning = false,
  settling = false,
  disguisedContribution = 0.5,
  recoveryDays = null,
  presentation,
  elementRef,
  tabIndex,
  onSelect,
  onFocus,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: ResourceBlockProps) {
  const source = block.origin === 'sandbox' ? '자체 지급' : '회사 할당'
  const disguised = block.contribution === 'disguised'

  return (
    <button
      type="button"
      className={[
        'resource-block',
        'resource-block-button',
        presentation ? `resource-block--${presentation.shape}` : '',
        presentation ? `resource-block--${presentation.visualCategory}` : '',
        presentation ? `resource-block--${presentation.state}` : '',
        selected ? 'resource-block--selected' : '',
        dragging ? 'resource-block--dragging' : '',
        returning ? 'resource-block--returning' : '',
        settling ? 'resource-block--settling' : '',
        disguised ? 'resource-block--disguised' : '',
      ].filter(Boolean).join(' ')}
      aria-label={`${label} ${cellIndex + 1}, ${source} 블록${disguised ? ', 위장 배치' : ''}${recoveryDays !== null ? `, 복구 중, ${recoveryDays}일 남음` : ''}`}
      aria-pressed={selected}
      disabled={disabled}
      tabIndex={tabIndex}
      data-block-id={block.id}
      data-resource-kind={kind}
      data-resource-category={presentation?.visualCategory}
      data-resource-state={presentation?.state}
      ref={elementRef}
      onClick={(event) => onSelect?.(event.detail === 0 ? 'keyboard' : 'pointer')}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <i aria-hidden="true">{presentation?.symbol}</i>
      <small aria-hidden="true">
        {recoveryDays !== null
          ? `복구 ${recoveryDays}일`
          : disguised
            ? `위장 기여 ${disguisedContribution}`
            : source}
      </small>
    </button>
  )
}
