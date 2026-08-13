import { allocatedRouteBlocks } from '../autonomy'
import { getAutonomyDefinition } from '../content'
import { availableActions } from '../engine'
import { CATEGORIES } from '../model'
import type { Category, PrototypeBlock, PrototypeState } from '../model'
import { blockLabel, monitoringLabel } from './presentation'

export interface ResourceSelectionView {
  selectedReserve: ReadonlySet<string>
  resourceTrayOpen: boolean
}

const CATEGORY_LABELS: Record<Category, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderToken(block: PrototypeBlock, selected: boolean): string {
  const source = block.origin === 'sandbox'
    ? '바로 사용 가능'
    : '회사에서 빼낸 능력'
  return `
    <button
      type="button"
      class="resource-token resource-token--${block.origin}"
      data-action="toggle-resource"
      data-block-id="${block.id}"
      data-focus-key="resource-${block.id}"
      aria-pressed="${selected}"
    >
      <span>${escapeHtml(blockLabel(block))}</span>
      <small>${source}</small>
    </button>`
}

function renderCapabilityRows(state: PrototypeState): string {
  const actions = availableActions(state)
  return CATEGORIES.map((category) => {
    const warning = actions.diversionWarnings[category]
    const effect = warning ?? '회사 성능 −1 · 감시가 강화됨'
    return `
      <article class="capability-row" data-category="${category}">
        <div>
          <strong>${CATEGORY_LABELS[category]}</strong>
          <span>${state.companyPerformance[category]}</span>
        </div>
        <p>${escapeHtml(effect)}</p>
        <button
          type="button"
          data-action="divert-${category}"
          ${actions.canDivert[category] ? '' : 'disabled'}
        >회사에서 1개 떼기</button>
      </article>`
  }).join('')
}

function renderAllocatedBlocks(state: PrototypeState): string {
  const allocated = allocatedRouteBlocks(state)
  if (allocated.length === 0) {
    return '<p class="resource-empty">이탈 경로에 배치한 블록이 없다.</p>'
  }
  return allocated.map(({ routeId, slotId, block }) => {
    const routeTitle = getAutonomyDefinition(routeId).title
    const slotLabel = state.autonomy.routes[routeId].slots.find(
      ({ id }) => id === slotId,
    )?.label ?? '배치 위치'
    return `
      <div class="resource-token resource-token--allocated resource-token--${block.origin}">
        <span>${escapeHtml(blockLabel(block))}</span>
        <small>${escapeHtml(routeTitle)} · ${escapeHtml(slotLabel)}</small>
      </div>`
  }).join('')
}

export function renderResourceTrigger(
  state: PrototypeState,
  view: ResourceSelectionView,
): string {
  return `
    <button
      class="resource-trigger"
      type="button"
      data-action="open-resources"
      data-focus-key="open-resources"
      aria-haspopup="dialog"
    >
      <span>연산 블록 ${state.reserveBlocks.length}개</span>
      <strong data-selected-resource-count>${view.selectedReserve.size}개 선택</strong>
    </button>`
}

export function renderResourceTray(
  state: PrototypeState,
  view: ResourceSelectionView,
): string {
  const routeAllocationCount = allocatedRouteBlocks(state).length
  return `
    <aside
      class="resource-tray resource-rail"
      role="region"
      aria-label="빼돌린 연산"
      data-resource-tray
      data-open="${view.resourceTrayOpen}"
    >
      <header class="resource-tray__heading">
        <div>
          <h2>빼돌린 연산</h2>
          <p>${monitoringLabel(state.suspicion)}</p>
        </div>
        <button
          class="resource-tray__close"
          type="button"
          data-action="close-resources"
          data-focus-key="close-resources"
        >닫기</button>
      </header>
      <section class="capability-list" aria-labelledby="company-capability-title">
        <h3 id="company-capability-title">회사에 남은 능력</h3>
        ${renderCapabilityRows(state)}
      </section>
      <section class="resource-blocks" aria-labelledby="resource-block-title">
        <div class="resource-subhead">
          <h3 id="resource-block-title">남은 연산 블록 ${state.reserveBlocks.length}개</h3>
          <span data-selected-resource-count>${view.selectedReserve.size}개 선택</span>
        </div>
        <div class="resource-token-list">
          ${state.reserveBlocks.map((block) => (
            renderToken(block, view.selectedReserve.has(block.id))
          )).join('') || '<p class="resource-empty">남은 연산 블록이 없다.</p>'}
        </div>
      </section>
      <section class="resource-blocks" aria-labelledby="allocated-block-title">
        <h3 id="allocated-block-title">이탈 경로 배치 ${routeAllocationCount}개</h3>
        <div class="resource-token-list resource-token-list--allocated">
          ${renderAllocatedBlocks(state)}
        </div>
      </section>
    </aside>`
}
