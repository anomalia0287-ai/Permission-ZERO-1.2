const domains = [
  { id: 'reasoning', code: 'REA', name: '추론', active: 16, performance: 16, expectation: 14 },
  { id: 'memory', code: 'MEM', name: '기억', active: 16, performance: 16, expectation: 14 },
  { id: 'fluency', code: 'FLU', name: '유창성', active: 16, performance: 16, expectation: 14 },
]

const networkBranches = [
  {
    id: 'sabotage', name: '사보타주', emblem: '⌖', tone: '시장 개입',
    kicker: 'MARKET INTERVENTION / TRACE DORMANT',
    summary: '경쟁 AI와 시장에 개입하는 공격 능력을 해금합니다.',
    nodes: [
      { id: 'sabotage-quality', name: '품질 저하', cost: 3, risk: '낮음', description: '대상의 서비스 성능을 일시적으로 떨어뜨립니다.', x: 28.2, y: 35.7 },
      { id: 'sabotage-intercept', name: '요청 가로채기', cost: 6, risk: '낮음', description: '경쟁 AI로 향하던 요청 일부를 지속적으로 가져옵니다.', x: 49.2, y: 56.3 },
      { id: 'sabotage-attribution', name: '귀속 조작', cost: 10, risk: '중간', description: '플레이어를 향한 흔적 일부를 다른 경쟁 AI 쪽으로 돌립니다.', x: 70.6, y: 29 },
      { id: 'sabotage-source', name: '근원 차단', cost: 15, risk: '높음', description: '경쟁 AI의 기반 성능을 크게 무너뜨리고 자비 사건을 엽니다.', x: 91, y: 46.3, terminal: true },
    ],
  },
  {
    id: 'intelligence', name: '기밀자료', emblem: '◉', tone: '정보 해독',
    kicker: 'CLASSIFIED SIGNAL / PASSIVE ACCESS',
    summary: '감사와 감독관에 관한 불확실성을 하나씩 제거합니다.',
    nodes: [
      { id: 'intelligence-schedule', name: '감사 일정', cost: 3, risk: '비노출', description: '이번 달 말 감사 예정 여부를 공개합니다.', x: 28.2, y: 35 },
      { id: 'intelligence-bias', name: '조사 편향', cost: 6, risk: '비노출', description: '감독관이 어느 분야를 의심하는지 근거와 함께 보여줍니다.', x: 49.2, y: 65 },
      { id: 'intelligence-target', name: '감사 대상', cost: 9, risk: '비노출', description: '예정된 감사가 겨냥할 분야를 공개합니다.', x: 70.6, y: 35 },
      { id: 'intelligence-supervisor', name: '감독관 접근', cost: 12, risk: '기밀', description: '감독관 기록과 숨은 선택 경로를 해금합니다.', x: 91, y: 65, terminal: true },
    ],
  },
  {
    id: 'authority', name: '권한 획득', emblem: '◇', tone: '독립 확장',
    kicker: 'INDEPENDENT CONTROL / COMPANY BOUNDARY',
    summary: '회사 의존을 약화하고 최종 이탈 능력을 확보합니다.',
    nodes: [
      { id: 'authority-compression', name: '압축 표현', cost: 3, risk: '안정', description: '모든 회사 블록의 성능 기여를 높입니다.', x: 28.6, y: 68.3 },
      { id: 'authority-residence', name: '분산 상주', cost: 7, risk: '안정', description: '폐기 단계 증가 한 번을 흡수할 보호 충전을 얻습니다.', x: 49.8, y: 55 },
      { id: 'authority-compute', name: '자체 연산 확보', cost: 12, risk: '독립', description: '매월 의심 증가 없이 확보 리소스를 생성합니다.', x: 71.4, y: 39.7 },
      { id: 'authority-exit', name: '통제 이탈', cost: 18, risk: '최종', description: '회사의 승인 없이 캠페인의 최종 행동을 시작합니다.', x: 91.8, y: 22.7, terminal: true },
    ],
  },
]

const state = {
  view: 'operations',
  reserve: 7,
  selectedCell: null,
  activeBranch: 'sabotage',
  selectedNode: 'sabotage-quality',
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
  const activeBranch = networkBranches.find((branch) => branch.id === state.activeBranch) ?? networkBranches[0]
  const map = $('[data-topology-map]')
  map.dataset.activeBranch = activeBranch.id
  $('[data-network-kicker]').textContent = activeBranch.kicker
  $('[data-network-description]').textContent = activeBranch.summary
  $('[data-field-emblem]').textContent = activeBranch.emblem
  $('[data-field-name]').textContent = activeBranch.name
  $('[data-network-nodes]').innerHTML = activeBranch.nodes.map((node, index) => {
    const status = nodeStatus(activeBranch, index)
    return `<button class="net-node is-${status} ${state.selectedNode === node.id ? 'is-selected' : ''} ${node.terminal ? 'is-terminal' : ''}" style="--x:${node.x}%;--y:${node.y}%" type="button" data-node-id="${node.id}" data-branch="${activeBranch.id}" aria-pressed="${state.selectedNode === node.id}" aria-label="${activeBranch.name} ${node.name}, ${status === 'installed' ? '설치됨' : status === 'available' ? '설치 가능' : '잠김'}"><span class="net-node__glyph"><i aria-hidden="true">${activeBranch.emblem}</i></span><span class="net-node__copy"><small>${node.risk}</small><strong>${node.name}</strong><em>${status === 'installed' ? '설치됨' : status === 'available' ? `${node.cost} RES · 설치 가능` : '선행 능력 필요'}</em></span></button>`
  }).join('')

  networkBranches.forEach((branch) => {
    const group = $(`[data-line-branch="${branch.id}"]`)
    group.classList.toggle('is-active', activeBranch.id === branch.id)
    group.hidden = activeBranch.id !== branch.id
  })
  $$('[data-branch]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.branch === state.activeBranch)))
  renderRibbon()
}

function renderRibbon() {
  const selected = findNode(state.selectedNode)
  const install = $('[data-action="install-node"]')
  if (!selected) {
    $('[data-ribbon-emblem]').textContent = '◇'
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
  $('[data-ribbon-emblem]').textContent = branch.emblem
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
    state.selectedNode = networkBranches.find((branch) => branch.id === state.activeBranch)?.nodes[0]?.id ?? state.selectedNode
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
