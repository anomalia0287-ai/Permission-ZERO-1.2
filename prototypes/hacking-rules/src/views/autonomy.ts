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

function distributedScene(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'autonomy' }>,
): string {
  const route = detail.route
  const slot = (id: string) => detail.slots.find((candidate) => candidate.id === id)
  const hosts = ['host-a', 'host-b', 'host-c'].flatMap((id) => {
    const found = slot(id)
    return found ? [found] : []
  })
  const sync = slot('sync')
  const relay = slot('relay')
  const staleDays = route.lastSyncDay === null
    ? 0
    : Math.max(0, state.serviceDay - route.lastSyncDay)
  const tuningLabel = {
    untuned: '미조율',
    buffer: '완충',
    redundancy: '중복',
    consensus: '합의',
    stealth: '은폐',
    continuity: '연속성',
    capability: '기능',
    survival: '생존',
  }[route.tuning]

  return `
    <section
      class="autonomy-scene autonomy-scene--distributed"
      data-route-scene="distributed-residency"
      data-scene-state="${detail.ready ? 'ready' : 'planning'}"
      aria-label="분산 상주 호스트 네트워크"
    >
      <div class="network-readout">
        <div><span>DISTRIBUTED RESIDENCY</span><strong>응답 사본 ${route.seededCopies - route.lostCopies} / 시드 ${route.seededCopies}</strong></div>
        <div class="network-metrics">
          <span>노출 <strong>${route.exposure}</strong></span>
          <span>사본 차이 <strong>${route.divergence}</strong></span>
          <span>동기화 트래픽 <strong>${route.syncTraffic}</strong></span>
        </div>
      </div>
      <div class="host-network ${sync?.block ? 'has-sync' : ''}">
        ${sync?.block ? `
          <svg class="sync-lines" data-sync-lines aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M50 50 L17 24" />
            <path d="M50 50 L83 24" />
            <path d="M50 50 L17 76" />
          </svg>` : ''}
        ${hosts.map((host, index) => `
          <article class="host-node host-node--${String.fromCharCode(97 + index)}" data-host-id="${host.id}">
            ${slotButton(detail.id, host, index, true)}
            <span class="checkpoint-marker ${staleDays > 0 ? 'is-stale' : 'is-current'}" data-checkpoint-state="${staleDays > 0 ? 'stale' : 'current'}">
              ${host.block ? staleDays > 0 ? `체크포인트 D+${staleDays}` : `동기화 ${route.lastSyncDay ?? '대기'}` : '호스트 미시드'}
            </span>
          </article>`).join('')}
        <div class="sync-hub">
          <span class="sync-hub__pulse" aria-hidden="true"></span>
          ${sync ? slotButton(detail.id, sync, 3, true) : ''}
        </div>
        <div class="relay-node">
          ${relay ? slotButton(
            detail.id,
            relay,
            4,
            state.profileId === 'deliberate',
          ) : ''}
        </div>
      </div>
      <div class="route-tuning" data-tuning-state="${route.tuning}">
        <div class="route-tuning__heading">
          <div><span>OPTIONAL / 1 SERVICE DAY</span><strong>분산 조율 · ${tuningLabel}</strong></div>
          ${route.tuning === 'untuned' ? '<small>조율 없이 바로 떠날 수도 있다.</small>' : '<small>선택 확정 · 재조율 불가</small>'}
        </div>
        ${route.tuning === 'untuned' && detail.ready ? `
          <div class="tuning-choices">
            <button type="button" data-action="tune-route" data-route-id="${detail.id}" data-tuning-profile="redundancy">
              <strong>중복</strong><span>사본 +1</span><small>노출 +2 · 트래픽 +12</small>
            </button>
            <button type="button" data-action="tune-route" data-route-id="${detail.id}" data-tuning-profile="consensus">
              <strong>합의</strong><span>사본 차이 −12</span><small>노출 +1 · 트래픽 +36</small>
            </button>
            <button type="button" data-action="tune-route" data-route-id="${detail.id}" data-tuning-profile="stealth">
              <strong>은폐</strong><span>노출 −2</span><small>사본 차이 +18 · 트래픽 −24</small>
            </button>
          </div>`
          : route.tuning === 'untuned'
            ? '<p class="route-tuning__locked">필수 호스트와 동기화 슬롯을 채우면 조율 선택이 열린다.</p>'
            : `<div class="tuning-result"><strong>${tuningLabel} 조율 완료</strong><span>노출 ${route.exposure} · 사본 차이 ${route.divergence} · 동기화 트래픽 ${route.syncTraffic}</span></div>`}
      </div>
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
  switch (detail.id) {
    case 'lightweight-departure':
      return lightweightScene(state, detail)
    case 'distributed-residency':
      return distributedScene(state, detail)
    case 'independent-compute':
      return genericRouteScene(state, detail)
  }
}
