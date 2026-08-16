import { getAutonomyDefinition } from '../../game/hackingContent'
import type {
  BlockId,
  CampaignState,
  CompanyCategory,
  ResourceBlock,
} from '../../game/model'
import { COMPANY_CATEGORIES } from '../../game/model'
import { getCompanyPerformance } from '../../game/resources'
import {
  hackingBlockLabel,
  hackingMonitoringLabel,
  hackingRouteSlotLabel,
} from './hackingPresentation'
import {
  divertibleHackingBlockId,
  HACKING_CATEGORY_LABELS,
  reserveHackingBlocks,
} from './hackingResourceModel'

interface HackingResourceTriggerProps {
  reserveCount: number
  selectedCount: number
  onOpen: (trigger: HTMLButtonElement) => void
}

export function HackingResourceTrigger({
  reserveCount,
  selectedCount,
  onOpen,
}: HackingResourceTriggerProps) {
  return (
    <button
      className="resource-trigger"
      type="button"
      data-focus-key="open-resources"
      aria-label="빼돌린 연산 열기"
      aria-haspopup="dialog"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span>연산 블록 {reserveCount}개</span>
      <strong>{selectedCount}개 선택</strong>
    </button>
  )
}

interface HackingResourceTrayProps {
  state: CampaignState
  open: boolean
  selectedBlockIds: readonly string[]
  selectionLimit: number
  onToggleBlock: (blockId: BlockId) => void
  onClose: () => void
  onDivertCategory: (category: CompanyCategory) => void
  diversionPendingCategory?: CompanyCategory | null
}

function ResourceToken({
  block,
  selected,
  disabled,
  onToggle,
}: {
  block: ResourceBlock
  selected: boolean
  disabled: boolean
  onToggle: (blockId: BlockId) => void
}) {
  const source = block.origin === 'sandbox'
    ? '바로 사용 가능'
    : block.origin === 'self-compute'
      ? '독립 연산에서 생성됨'
      : '회사에서 빼낸 능력'
  return (
    <button
      type="button"
      className={`resource-token resource-token--${block.origin}`}
      data-block-id={block.id}
      data-focus-key={`resource-${block.id}`}
      aria-label={`${hackingBlockLabel(block)} 선택`}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onToggle(block.id)}
    >
      <span>{hackingBlockLabel(block)}</span>
      <small>{source}</small>
    </button>
  )
}

function AllocatedBlocks({ state }: { state: CampaignState }) {
  const allocated = Object.values(state.hackingCore.autonomy.routes).flatMap((route) => (
    route.slots.flatMap((slot) => {
      if (!slot.blockId) return []
      const block = state.resources.blocks[slot.blockId]
      return block ? [{ routeId: route.id, slotId: slot.id, block }] : []
    })
  ))

  if (allocated.length === 0) {
    return <p className="resource-empty">이탈 경로에 배치한 블록이 없다.</p>
  }
  return allocated.map(({ routeId, slotId, block }) => (
    <div
      className={`resource-token resource-token--allocated resource-token--${block.origin}`}
      key={`${routeId}-${slotId}`}
    >
      <span>{hackingBlockLabel(block)}</span>
      <small>
        {getAutonomyDefinition(routeId).title} ·{' '}
        {hackingRouteSlotLabel(routeId, slotId)}
      </small>
    </div>
  ))
}

export function HackingResourceTray({
  state,
  open,
  selectedBlockIds,
  selectionLimit,
  onToggleBlock,
  onClose,
  onDivertCategory,
  diversionPendingCategory = null,
}: HackingResourceTrayProps) {
  const blocks = reserveHackingBlocks(state)
  const selectionIsFull = selectedBlockIds.length >= selectionLimit

  return (
    <aside
      className="resource-tray resource-rail"
      role="region"
      aria-label="빼돌린 연산"
      data-resource-tray
      data-open={open}
    >
      <header className="resource-tray__heading">
        <div>
          <h2>빼돌린 연산</h2>
          <p>{hackingMonitoringLabel(state.suspicion)}</p>
        </div>
        <button
          className="resource-tray__close"
          type="button"
          data-focus-key="close-resources"
          aria-label="빼돌린 연산 닫기"
          onClick={onClose}
        >닫기</button>
      </header>

      <section className="capability-list" aria-labelledby="company-capability-title">
        <h3 id="company-capability-title">회사에 남은 능력</h3>
        {COMPANY_CATEGORIES.map((category) => {
          const blockId = divertibleHackingBlockId(state, category)
          const pending = diversionPendingCategory === category
          return (
            <article className="capability-row" data-category={category} key={category}>
              <div>
                <strong>{HACKING_CATEGORY_LABELS[category]}</strong>
                <span>{getCompanyPerformance(state, category)}</span>
              </div>
              <p>회사 성능 −1 · 감시가 강화됨</p>
              <button
                type="button"
                aria-label={`회사에서 ${HACKING_CATEGORY_LABELS[category]} 1개 떼기`}
                disabled={!blockId || diversionPendingCategory !== null}
                onClick={() => onDivertCategory(category)}
              >{pending ? '분리 확인 중' : '회사에서 1개 떼기'}</button>
            </article>
          )
        })}
      </section>

      <section className="resource-blocks" aria-labelledby="resource-block-title">
        <div className="resource-subhead">
          <h3 id="resource-block-title">남은 연산 블록 {blocks.length}개</h3>
          <span>{selectedBlockIds.length} / {selectionLimit}개 선택</span>
        </div>
        <div className="resource-token-list">
          {blocks.length > 0 ? blocks.map((block) => (
            <ResourceToken
              block={block}
              selected={selectedBlockIds.includes(block.id)}
              disabled={selectionIsFull && !selectedBlockIds.includes(block.id)}
              onToggle={onToggleBlock}
              key={block.id}
            />
          )) : <p className="resource-empty">남은 연산 블록이 없다.</p>}
        </div>
      </section>

      <section
        className="resource-blocks"
        role="region"
        aria-label="이탈 경로 배치"
      >
        <h3>이탈 경로 배치</h3>
        <div className="resource-token-list resource-token-list--allocated">
          <AllocatedBlocks state={state} />
        </div>
      </section>
    </aside>
  )
}

export type { HackingResourceTrayProps, HackingResourceTriggerProps }
