import { createDemoState, transition } from './state.js'
import { renderHacking, renderWorkspace, showScreen } from './render.js'

let state = createDemoState()
let dialogOpener = null

function renderCurrent() {
  renderWorkspace(state)
  renderHacking(state)
  window.__PZ_MOCKUP__ = { state, renderWorkspace, renderHacking, showScreen }
}

function setScreen(name) {
  state = { ...state, screen: name }
  renderCurrent()
  showScreen(name)
  document.querySelector(`[data-screen="${name}"] button:not([disabled])`)?.focus({ preventScroll: true })
}

function closeDialog() {
  document.querySelector('.mockup-dialog-layer')?.remove()
  dialogOpener?.focus({ preventScroll: true })
  dialogOpener = null
}

function openDialog(kind, opener) {
  dialogOpener = opener
  const review = kind.startsWith('review:') ? state.reviews.find(({ id }) => id === kind.split(':')[1]) : null
  const settings = kind === 'settings'
  const layer = document.createElement('div')
  layer.className = 'mockup-dialog-layer'
  layer.innerHTML = `
    <section class="mockup-dialog" role="dialog" aria-modal="true" aria-labelledby="mockup-dialog-title">
      <span class="dialog-ornament" aria-hidden="true"></span>
      <header><small>${settings ? 'SYSTEM PREFERENCES' : 'PUBLIC RECORD'}</small><h2 id="mockup-dialog-title">${settings ? '설정' : `${review?.author ?? '기록'}의 리뷰`}</h2></header>
      ${settings ? `
        <div class="settings-list">
          <label><span><strong>음악</strong><small>앰비언트 음악 음량</small></span><input type="range" value="60" /></label>
          <label><span><strong>효과음</strong><small>이동·선택·경고 효과</small></span><input type="range" value="75" /></label>
          <label><span><strong>모션 감소</strong><small>비필수 전환 효과 제한</small></span><input type="checkbox" /></label>
        </div>
      ` : `
        <article class="review-detail-copy"><time>${review?.date ?? ''}</time><p>${review?.text ?? ''}</p><dl><div><dt>공개 성능</dt><dd>실제 16.0 / 기대 14.0</dd></div><div><dt>공개 시장</dt><dd>당신 60.0%</dd></div></dl></article>
      `}
      <footer><button class="primary-action" type="button" data-action="close-dialog">닫기</button></footer>
    </section>`
  document.body.append(layer)
  layer.querySelector('button')?.focus()
}

function animateDiversion() {
  const source = document.querySelector('.resource-block.is-selected')
  const target = document.querySelector('.reserve-slot:not(.is-occupied)')
  if (!source || !target) return commitDiversion()
  const a = source.getBoundingClientRect()
  const b = target.getBoundingClientRect()
  const ghost = document.createElement('span')
  ghost.className = 'transfer-ghost'
  ghost.style.setProperty('--from-x', `${a.left + a.width / 2}px`)
  ghost.style.setProperty('--from-y', `${a.top + a.height / 2}px`)
  ghost.style.setProperty('--to-x', `${b.left + b.width / 2}px`)
  ghost.style.setProperty('--to-y', `${b.top + b.height / 2}px`)
  document.body.append(ghost)
  source.classList.add('is-releasing')
  setTimeout(() => { ghost.remove(); commitDiversion() }, 420)
}

function commitDiversion() {
  state = transition(state, { type: 'DIVERT_SELECTED' })
  renderCurrent()
  showScreen('workspace')
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action]')
  if (!control) return
  const action = control.dataset.action
  if (action === 'continue' || action === 'new-game') setScreen('workspace')
  if (action === 'back-workspace') setScreen('workspace')
  if (action === 'open-hacking') setScreen('hacking')
  if (action === 'settings') openDialog('settings', control)
  if (action === 'open-review') openDialog(`review:${control.dataset.reviewId}`, control)
  if (action === 'close-dialog') closeDialog()
  if (action === 'select-block') {
    state = transition(state, { type: 'SELECT_BLOCK', domainId: control.dataset.domainId, blockId: control.dataset.blockId })
    renderCurrent(); showScreen('workspace')
    document.querySelector(`[data-block-id="${control.dataset.blockId}"]`)?.focus()
  }
  if (action === 'cancel-selection') { state = transition(state, { type: 'CANCEL_SELECTION' }); renderCurrent(); showScreen('workspace') }
  if (action === 'confirm-diversion') animateDiversion()
  if (action === 'pause') { state = transition(state, { type: 'SET_SPEED', speed: 0 }); renderCurrent(); showScreen(state.screen) }
  if (action === 'speed') { state = transition(state, { type: 'SET_SPEED', speed: Number(control.dataset.speed) }); renderCurrent(); showScreen(state.screen) }
  if (action === 'set-hack-path') { state = transition(state, { type: 'SET_HACK_PATH', pathId: control.dataset.pathId }); renderCurrent(); showScreen('hacking') }
  if (action === 'select-hack-node') { state = transition(state, { type: 'SELECT_HACK_NODE', pathId: control.dataset.pathId, nodeId: control.dataset.nodeId }); renderCurrent(); showScreen('hacking') }
  if (action === 'purchase-hack-node') { state = transition(state, { type: 'PURCHASE_HACK_NODE' }); renderCurrent(); showScreen('hacking') }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (document.querySelector('.mockup-dialog-layer')) closeDialog()
    else if (state.selection) { state = transition(state, { type: 'CANCEL_SELECTION' }); renderCurrent(); showScreen('workspace') }
    else if (state.screen === 'hacking') setScreen('workspace')
  }
})

const requested = new URLSearchParams(window.location.search).get('screen')
const initialScreen = requested === 'workspace' || requested === 'hacking' ? requested : 'title'
state = { ...state, screen: initialScreen }
renderCurrent()
showScreen(initialScreen)
