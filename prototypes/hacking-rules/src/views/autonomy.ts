import { CATEGORIES } from '../model'
import type { Category, PrototypeState, RouteSlot } from '../model'
import type { DetailModel } from '../selectors'

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

function slotButton(
  routeId: string,
  slot: RouteSlot,
  index: number,
  required: boolean,
): string {
  const action = slot.block ? 'remove-route-block' : 'allocate-route-block'
  const state = slot.block ? 'filled' : 'empty'
  const optional = required ? '' : ' route-slot--optional'
  const actionLabel = slot.block
    ? `${slot.label}의 ${slot.block.id} 반환`
    : `선택한 예비 블록을 ${slot.label}에 배치`
  return `
    <button
      class="route-slot route-slot--${state}${optional}"
      type="button"
      data-action="${action}"
      data-route-id="${routeId}"
      data-slot-id="${slot.id}"
      data-slot-state="${state}"
      data-focus-key="route-slot-${routeId}-${slot.id}"
      aria-label="${escapeHtml(actionLabel)}"
    >
      <span class="route-slot__index">${String(index + 1).padStart(2, '0')}</span>
      <span class="route-slot__label">${escapeHtml(slot.label)}</span>
      <strong>${slot.block ? escapeHtml(slot.block.id) : required ? '필수 · 비어 있음' : '선택 · 비어 있음'}</strong>
      <small>${slot.block ? '클릭하여 반환' : '블록 선택 후 클릭'}</small>
    </button>`
}

function lightweightScene(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'autonomy' }>,
): string {
  const carried = new Set(
    detail.slots.flatMap(({ block }) => (
      block && block.origin !== 'sandbox' ? [block.origin] : []
    )),
  )
  const filled = detail.slots.filter(({ block }) => block !== null).length
  const requiredCount = detail.slots.filter((slot) => (
    state.profileId === 'lean' ? slot.requiredInLean : slot.requiredInDeliberate
  )).length

  return `
    <section
      class="autonomy-scene autonomy-scene--lightweight"
      data-route-scene="lightweight-departure"
      data-scene-state="${detail.ready ? 'ready' : 'planning'}"
      aria-label="경량 이탈 고정 용량 전송창"
    >
      <div class="payload-window__header">
        <div><span>TRANSFER WINDOW</span><strong>고정 적재 ${filled} / ${detail.slots.length}</strong></div>
        <div class="payload-capacity" aria-label="필수 슬롯 ${requiredCount}개">
          ${detail.slots.map((slot, index) => `<i class="${slot.block ? 'is-filled' : ''}" title="${escapeHtml(slot.label)}">${index + 1}</i>`).join('')}
        </div>
      </div>
      <div class="payload-window__body">
        <div class="payload-slots">
          ${detail.slots.map((slot, index) => slotButton(
            detail.id,
            slot,
            index,
            state.profileId === 'lean' ? slot.requiredInLean : slot.requiredInDeliberate,
          )).join('')}
        </div>
        <aside class="capability-silhouettes" aria-label="능력 운반 상태">
          <span class="capability-silhouettes__label">CAPABILITY SHADOW</span>
          ${CATEGORIES.map((category) => `
            <div class="capability-silhouette ${carried.has(category) ? 'is-carried' : 'is-displaced'}" data-capability="${category}" data-capability-state="${carried.has(category) ? 'carried' : 'displaced'}">
              <i aria-hidden="true"></i>
              <span>${CATEGORY_LABELS[category]}</span>
              <strong>${carried.has(category) ? '함께 이동' : '회사에 잔류'}</strong>
            </div>`).join('')}
        </aside>
      </div>
      <p class="route-scene-instruction">예비 블록 하나를 선택해 빈 슬롯을 누른다. 채운 슬롯을 누르면 그 블록이 돌아온다.</p>
    </section>`
}

function genericRouteScene(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'autonomy' }>,
): string {
  return `
    <section class="autonomy-scene autonomy-scene--pending" data-route-scene="${detail.id}" data-scene-state="${detail.ready ? 'ready' : 'planning'}">
      <div class="payload-slots payload-slots--generic">
        ${detail.slots.map((slot, index) => slotButton(
          detail.id,
          slot,
          index,
          state.profileId === 'lean' ? slot.requiredInLean : slot.requiredInDeliberate,
        )).join('')}
      </div>
      <p class="route-scene-instruction">이 경로의 전용 조율 장면은 다음 구현 단계에서 연결된다.</p>
    </section>`
}

export function renderAutonomyScene(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'autonomy' }>,
): string {
  return detail.id === 'lightweight-departure'
    ? lightweightScene(state, detail)
    : genericRouteScene(state, detail)
}
