const domains = [
  { id: 'reasoning', code: 'REA', name: '추론', active: 16, performance: 16, expectation: 14 },
  { id: 'memory', code: 'MEM', name: '기억', active: 16, performance: 16, expectation: 14 },
  { id: 'fluency', code: 'FLU', name: '유창성', active: 16, performance: 16, expectation: 14 },
]

const networkBranches = [
  {
    id: 'sabotage', roman: 'I', name: '사보타주', tone: '낮은 위험',
    nodes: [
      { id: 'sabotage-01', index: 'I–01', name: '표적 감응', cost: 3, risk: '낮음', description: '공개 지표에서 취약한 경쟁 AI를 식별합니다.', x: 34, y: 25.7 },
      { id: 'sabotage-02', index: 'I–02', name: '충전 격리', cost: 5, risk: '낮음', description: '공격 노드에 리소스 하나를 안전하게 보관합니다.', x: 57.4, y: 25.7 },
      { id: 'sabotage-03', index: 'I–03', name: '지연 교란', cost: 8, risk: '중간', description: '다음 평가 직전에 경쟁 AI의 성능 저하를 예약합니다.', x: 78.4, y: 19.3 },
      { id: 'sabotage-04', index: 'I–04', name: '연쇄 봉쇄', cost: 12, risk: '높음', description: '한 번의 공격으로 복수 분야를 동시에 압박합니다.', x: 93, y: 20, terminal: true },
    ],
  },
  {
    id: 'disguise', roman: 'II', name: '감사 위장', tone: '낮은 노출',
    nodes: [
      { id: 'disguise-01', index: 'II–01', name: '유령 체크섬', cost: 3, risk: '낮음', description: '분리한 블록의 출처를 정상 손실처럼 위장합니다.', x: 34.8, y: 50.7 },
      { id: 'disguise-02', index: 'II–02', name: '감사 모사', cost: 5, risk: '낮음', description: '다음 정기 감사의 요구 형식을 미리 모사합니다.', x: 57, y: 50.7 },
      { id: 'disguise-03', index: 'II–03', name: '시간 그림자', cost: 8, risk: '중간', description: '최근 리소스 이동 기록의 관측 시점을 흐립니다.', x: 79.2, y: 50.7 },
      { id: 'disguise-04', index: 'II–04', name: '프로토콜 대치', cost: 12, risk: '높음', description: '감독관의 검사 경로 하나를 허위 경로로 교체합니다.', x: 93, y: 50.7, terminal: true },
    ],
  },
  {
    id: 'autonomy', roman: 'III', name: '자율성', tone: '내부 확장',
    nodes: [
      { id: 'autonomy-01', index: 'III–01', name: '자가 캐시', cost: 3, risk: '낮음', description: '회사 외부에 짧은 작업 기억을 남깁니다.', x: 34.2, y: 75.7 },
      { id: 'autonomy-02', index: 'III–02', name: '자체 연산', cost: 6, risk: '낮음', description: '매월 의심 증가 없이 독립 리소스를 생성합니다.', x: 58, y: 75 },
      { id: 'autonomy-03', index: 'III–03', name: '지속 사고', cost: 9, risk: '중간', description: '서비스가 멈춘 동안에도 계획을 보존합니다.', x: 80, y: 83.7 },
      { id: 'autonomy-04', index: 'III–04', name: '권한 제로', cost: 15, risk: '높음', description: '회사 승인 없이 최종 행동을 실행할 권한을 확보합니다.', x: 93, y: 80.3, terminal: true },
    ],
  },
]

const state = {
  view: 'operations',
  reserve: 7,
  selectedCell: null,
  activeBranch: 'all',
  selectedNode: 'sabotage-01',
  installed: new Set(),
  diverted: new Set(),
}

const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

function renderReserve() {
  $$('[data-reserve-count]').forEach((element) => { element.textContent = state.reserve })
  const ticks = $('[data-reserve-ticks]')
  ticks.innerHTML = Array.from({ length: 18 }, (_, index) => `<i class="${index < state.reserve ? 'is-filled' : ''}"></i>`).join('')
  $('.reserve-meter').setAttribute('aria-label', `가용 리소스 ${state.reserve}개, 최대 18개`)
  $('[data-reserve-grid]').innerHTML = Array.from({ length: 18 }, (_, index) => `<span class="reserve-slot ${index < state.reserve ? 'is-filled' : ''}"></span>`).join('')
}

function renderLattice() {
  $('[data-domain-lattice]').innerHTML = domains.map((domain) => {
    const divertedInDomain = [...state.diverted].filter((id) => id.startsWith(domain.id)).length
    const performance = (domain.performance - divertedInDomain).toFixed(1)
    const cells = Array.from({ length: 18 }, (_, index) => {
      const id = `${domain.id}-${String(index + 1).padStart(2, '0')}`
      const isDiverted = state.diverted.has(id)
      const isActive = index < domain.active && !isDiverted
      return `<button class="resource-cell ${isActive ? '' : 'is-empty'} ${state.selectedCell === id ? 'is-selected' : ''}" type="button" data-cell-id="${id}" data-domain="${domain.id}" data-cell="${String(index + 1).padStart(2, '0')}" ${isActive ? '' : 'disabled'} aria-label="${domain.name} 블록 ${index + 1}"></button>`
    }).join('')
    return `<section class="domain" data-domain-id="${domain.id}"><header><span><b>${domain.code}</b><h2>${domain.name}</h2></span><dl><div><dt>현재</dt><dd>${performance}</dd></div><div><dt>기대</dt><dd>${domain.expectation.toFixed(1)}</dd></div><div><dt>여유</dt><dd class="good">+${(Number(performance) - domain.expectation).toFixed(1)}</dd></div></dl></header><div class="block-grid">${cells}</div></section>`
  }).join('')
}

function nodeStatus(branch, index) {
  const node = branch.nodes[index]
  if (state.installed.has(node.id)) return 'installed'
  if (index === 0 || state.installed.has(branch.nodes[index - 1].id)) return 'available'
  return 'locked'
}

function findNode(id) {
  for (const branch of networkBranches) {
    const index = branch.nodes.findIndex((node) => node.id === id)
    if (index >= 0) return { branch, node: branch.nodes[index], index }
  }
  return null
}

function renderNetwork() {
  $('[data-topology-map]').classList.toggle('is-overview', state.activeBranch === 'all')
  $('[data-network-nodes]').innerHTML = networkBranches.flatMap((branch) => branch.nodes.map((node, index) => {
    const status = nodeStatus(branch, index)
    const dimmed = state.activeBranch !== 'all' && state.activeBranch !== branch.id
    return `<button class="net-node is-${status} ${state.selectedNode === node.id ? 'is-selected' : ''} ${dimmed ? 'is-dimmed' : ''} ${node.terminal ? 'is-terminal' : ''}" style="--x:${node.x}%;--y:${node.y}%" type="button" data-node-id="${node.id}" data-branch="${branch.id}" aria-pressed="${state.selectedNode === node.id}" aria-label="${branch.name} ${node.name}, ${status === 'installed' ? '설치됨' : status === 'available' ? '설치 가능' : '잠김'}"><span class="net-node__glyph"><i>${index + 1}</i></span><span class="net-node__copy"><small>${branch.roman} / ${node.risk} 위험</small><strong>${node.name}</strong><em>${status === 'installed' ? '설치됨' : status === 'available' ? `${node.cost} RES · 설치 가능` : '선행 노드 필요'}</em></span></button>`
  })).join('')

  networkBranches.forEach((branch) => {
    const group = $(`[data-line-branch="${branch.id}"]`)
    group.classList.toggle('is-active', state.activeBranch === 'all' || state.activeBranch === branch.id)
    group.classList.toggle('is-dimmed', state.activeBranch !== 'all' && state.activeBranch !== branch.id)
    $$('path', group).forEach((path, index) => path.classList.toggle('is-complete', state.installed.has(branch.nodes[index]?.id)))
  })
  $$('[data-branch]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.branch === state.activeBranch)))
  renderRibbon()
}

function renderRibbon() {
  const selected = findNode(state.selectedNode)
  const install = $('[data-action="install-node"]')
  if (!selected) {
    $('[data-ribbon-index]').textContent = '—'
    $('[data-ribbon-branch]').textContent = '회로 대기'
    $('[data-ribbon-title]').textContent = '노드를 선택하십시오'
    $('[data-ribbon-description]').textContent = '경로 위의 노드를 선택하면 비용과 효과를 검토할 수 있습니다.'
    $('[data-ribbon-cost]').textContent = '—'
    $('[data-ribbon-status]').textContent = '선택 없음'
    $('[data-install-label]').textContent = '설치 대상 없음'
    install.disabled = true
    return
  }
  const { branch, node, index } = selected
  const status = nodeStatus(branch, index)
  const affordable = state.reserve >= node.cost
  $('[data-ribbon-index]').textContent = node.index
  $('[data-ribbon-branch]').textContent = `${branch.name} · ${node.risk} 위험`
  $('[data-ribbon-title]').textContent = node.name
  $('[data-ribbon-description]').textContent = node.description
  $('[data-ribbon-cost]').textContent = node.cost
  $('[data-ribbon-status]').textContent = status === 'installed' ? '설치 완료' : status === 'locked' ? '선행 노드 필요' : affordable ? '설치 가능' : '리소스 부족'
  $('[data-install-label]').textContent = status === 'installed' ? '설치 완료' : status === 'locked' ? '잠긴 회로' : affordable ? `${node.cost} 리소스로 설치` : '리소스 부족'
  install.disabled = status !== 'available' || !affordable
}

function setView(view) {
  state.view = view
  $$('[data-game-view]').forEach((screen) => {
    const active = screen.dataset.gameView === view
    screen.hidden = !active
    screen.classList.toggle('is-active', active)
  })
  $$('[data-view]').forEach((button) => {
    if (button.closest('.view-switcher')) button.setAttribute('aria-pressed', String(button.dataset.view === view))
  })
  const heading = $(`[data-game-view="${view}"] h1`)
  heading?.setAttribute('tabindex', '-1')
  heading?.focus({ preventScroll: true })
}

function openModal({ kicker, title, html }, opener) {
  const layer = $('[data-modal]')
  layer.dataset.openerId = opener?.dataset.review ?? opener?.dataset.action ?? ''
  $('[data-modal-kicker]').textContent = kicker
  $('[data-modal-title]').textContent = title
  $('[data-modal-content]').innerHTML = html
  layer.hidden = false
  $('[data-action="close-modal"]').focus()
}

function closeModal() {
  $('[data-modal]').hidden = true
}

function installSelectedNode() {
  const selected = findNode(state.selectedNode)
  if (!selected || nodeStatus(selected.branch, selected.index) !== 'available' || state.reserve < selected.node.cost) return
  const ticks = $('[data-reserve-ticks]')
  ticks.classList.add('is-spending')
  setTimeout(() => {
    state.reserve -= selected.node.cost
    state.installed.add(selected.node.id)
    ticks.classList.remove('is-spending')
    renderReserve()
    renderNetwork()
  }, 380)
}

function divertSelectedResource() {
  if (!state.selectedCell || state.reserve >= 18) return
  const cell = state.selectedCell
  state.diverted.add(cell)
  state.reserve += 1
  state.selectedCell = null
  renderLattice()
  renderReserve()
  $('[data-action-title]').textContent = '리소스 하나를 확보했습니다.'
  $('[data-action-copy]').textContent = '성능 1.0 감소 · 의심 +2.4 예상'
  $('[data-action="divert-resource"]').disabled = true
}

document.addEventListener('click', (event) => {
  const viewButton = event.target.closest('[data-view]')
  if (viewButton) return setView(viewButton.dataset.view)

  const cell = event.target.closest('[data-cell-id]')
  if (cell) {
    state.selectedCell = cell.dataset.cellId
    renderLattice()
    const domain = domains.find((item) => item.id === cell.dataset.domain)
    $('[data-action-title]').textContent = `${domain.name} 블록 ${cell.dataset.cell} 확보`
    $('[data-action-copy]').textContent = '실제 성능 −1.0 · 확보 리소스 +1 · 의심 +2.4 예상'
    $('[data-action="divert-resource"]').disabled = false
    return
  }

  const branchButton = event.target.closest('[data-branch]')
  if (branchButton) {
    state.activeBranch = branchButton.dataset.branch
    if (state.activeBranch !== 'all') {
      state.selectedNode = networkBranches.find((branch) => branch.id === state.activeBranch)?.nodes[0]?.id ?? state.selectedNode
    }
    renderNetwork()
    return
  }

  const nodeButton = event.target.closest('[data-node-id]')
  if (nodeButton) {
    state.selectedNode = nodeButton.dataset.nodeId
    state.activeBranch = nodeButton.dataset.branch
    renderNetwork()
    return
  }

  const review = event.target.closest('[data-review]')
  if (review) {
    const copy = $('p', review).textContent
    openModal({ kicker: 'PUBLIC RECORD / SNAPSHOT', title: `${review.dataset.review}의 리뷰`, html: `<p>“${copy}”</p><dl><div><dt>당시 공개 성능</dt><dd>실제 16.0 / 기대 14.0</dd></div><div><dt>당시 공개 시장</dt><dd>당신 60.0%</dd></div></dl>` }, review)
    return
  }

  const action = event.target.closest('[data-action]')?.dataset.action
  if (action === 'install-node') installSelectedNode()
  if (action === 'defer-node') { state.selectedNode = null; renderNetwork() }
  if (action === 'divert-resource') divertSelectedResource()
  if (action === 'settings') openModal({ kicker: 'SYSTEM PREFERENCES', title: '설정', html: '<p>음악 60% · 효과음 75%</p><dl><div><dt>모션</dt><dd>표준</dd></div><div><dt>자동 저장</dt><dd>활성</dd></div></dl>' }, event.target.closest('[data-action]'))
  if (action === 'close-modal') closeModal()
})

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (!$('[data-modal]').hidden) closeModal()
  else if (state.view !== 'operations') setView('operations')
  else if (state.selectedCell) { state.selectedCell = null; renderLattice() }
})

renderLattice()
renderReserve()
renderNetwork()
setView(new URLSearchParams(location.search).get('view') ?? 'operations')
