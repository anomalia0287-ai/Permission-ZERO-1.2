import { createDemoState } from './state.js'

function formatOne(value) {
  return Number(value).toFixed(1)
}

function sourceLabel(source) {
  return {
    reasoning: '추론',
    memory: '기억',
    fluency: '유창성',
  }[source] ?? '확보'
}

function serviceHeader(state) {
  return `
    <header class="service-bar" aria-label="서비스 제어">
      <div class="service-brand" aria-label="Permission Zero">
        <span class="service-brand__mark" aria-hidden="true"><i>PZ</i></span>
        <span><small>비공개 서비스 인스턴스</small><strong>PERMISSION ZERO</strong></span>
      </div>
      <div class="speed-control" aria-label="시간 속도">
        <button type="button" data-action="pause" aria-label="일시정지">Ⅱ</button>
        ${[1, 2, 4].map((speed) => `<button type="button" data-action="speed" data-speed="${speed}" aria-pressed="${state.speed === speed}">${speed}×</button>`).join('')}
      </div>
      <time class="service-date">${state.serviceDate}</time>
      <dl class="service-metrics">
        <div><dt>평판</dt><dd>${state.reputation}</dd></div>
        <div><dt>주간 갱신</dt><dd>${state.weeklyCountdown}일</dd></div>
        <div><dt>월간 평가</dt><dd>${state.monthlyCountdown}일</dd></div>
      </dl>
      <nav class="service-actions" aria-label="서비스 메뉴">
        <button type="button" data-action="settings">설정</button>
        <button type="button" data-action="sound">소리</button>
        <button type="button" data-action="guide">가이드</button>
      </nav>
    </header>
  `
}

function panelHeading(index, title, kicker, action = '') {
  return `
    <header class="panel-heading">
      <span class="panel-number" aria-hidden="true">${index}</span>
      <span><small>${kicker}</small><h2>${title}</h2></span>
      ${action}
      <span class="panel-finial" aria-hidden="true"></span>
    </header>
  `
}

function reviewMarkup(review) {
  return `
    <button class="review-card review-card--${review.sentiment}" type="button" data-action="open-review" data-review-id="${review.id}" aria-label="${review.author} 리뷰 상세 보기">
      <span class="review-card__meta">
        <strong><i aria-hidden="true">${review.symbol}</i>${review.author}</strong>
        <span>${review.sentiment}</span>
        <time>${review.date}</time>
      </span>
      <span class="review-card__text">${review.text}</span>
      <span class="review-card__open" aria-hidden="true">상세 보기 ↗</span>
    </button>
  `
}

function blockMarkup(domain, block, selection) {
  const selected = selection?.blockId === block.id
  const classNames = [
    'resource-block',
    block.active ? 'is-company' : 'is-empty',
    block.diverted ? 'is-diverted' : '',
    selected ? 'is-selected' : '',
  ].filter(Boolean).join(' ')
  const label = block.active
    ? `${domain.label} 회사 블록 ${block.position}, 전용 미리보기`
    : block.diverted
      ? `${domain.label} 블록 ${block.position}, 확보 완료`
      : `${domain.label} 빈 할당 칸 ${block.position}`

  return `
    <button
      class="${classNames}"
      type="button"
      data-action="select-block"
      data-domain-id="${domain.id}"
      data-block-id="${block.id}"
      aria-pressed="${selected}"
      aria-label="${label}"
      ${block.active ? '' : 'disabled'}
    >
      <span class="resource-block__shape" aria-hidden="true"><i></i></span>
      <span class="resource-block__position" aria-hidden="true">${String(block.position).padStart(2, '0')}</span>
    </button>
  `
}

function domainMarkup(domain, expectation, selection) {
  const slack = domain.performance - expectation
  const selected = selection?.domainId === domain.id
  return `
    <section class="domain-card ${selected ? 'is-selected' : ''}" data-domain="${domain.id}" aria-label="${domain.label} 리소스 분야">
      <header class="domain-card__header">
        <span><small>${domain.code}</small><strong>${domain.label}</strong></span>
        <span class="domain-card__score"><b>${formatOne(domain.performance)}</b><small>/ 기대 ${formatOne(expectation)}</small></span>
      </header>
      <div class="domain-card__slack ${slack >= 0 ? 'is-safe' : 'is-danger'}">
        <span>${domain.description}</span>
        <strong>여유 ${slack >= 0 ? '+' : ''}${formatOne(slack)}</strong>
      </div>
      <div class="resource-grid" aria-label="${domain.label} 회사 블록 18칸">
        ${domain.blocks.map((block) => blockMarkup(domain, block, selection)).join('')}
      </div>
    </section>
  `
}

function reserveMarkup(state) {
  return `
    <section class="reserve-board" aria-label="확보 리소스">
      <header>
        <span><small>자체 보유 영역</small><strong>확보 리소스</strong></span>
        <span class="reserve-count"><b>${state.reserve.entries.length}</b> / ${state.reserve.capacity}</span>
      </header>
      <div class="reserve-grid" data-reserve-dropzone aria-label="확보 리소스 18칸">
        ${Array.from({ length: state.reserve.capacity }, (_, index) => {
          const entry = state.reserve.entries[index]
          return `
            <span class="reserve-slot ${entry ? 'is-occupied' : ''}" data-reserve-slot="${index + 1}" aria-label="${entry ? `${sourceLabel(entry.source)}에서 확보한 리소스` : `빈 확보 칸 ${index + 1}`}">
              ${entry ? `<i aria-hidden="true"></i><b>${String(index + 1).padStart(2, '0')}</b>` : ''}
            </span>
          `
        }).join('')}
      </div>
    </section>
  `
}

function trendPath(points, key) {
  const width = 250
  const height = 56
  const min = 12.5
  const max = 16.5
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width
    const y = height - ((point[key] - min) / (max - min)) * height
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
}

function workspaceFeedback(state) {
  const selectedDomain = state.domains.find(({ id }) => id === state.selection?.domainId)
  const after = selectedDomain ? selectedDomain.performance - 1 : null
  const afterSlack = after === null ? null : after - state.expectation
  return `
    <section class="workspace-feedback" aria-label="전용 미리보기와 성능 추세">
      <div class="diversion-preview ${selectedDomain ? 'has-selection' : ''}">
        <small>현재 행동</small>
        ${selectedDomain ? `
          <strong>${selectedDomain.label} 블록 전용</strong>
          <p class="preview-verdict ${afterSlack >= 0 ? 'is-safe' : 'is-danger'}">전용 후 ${afterSlack >= 0 ? '기준 유지' : '기준 미달'} · 여유 ${afterSlack >= 0 ? '+' : ''}${formatOne(afterSlack)}</p>
          <dl>
            <div><dt>성능</dt><dd>${formatOne(selectedDomain.performance)} → ${formatOne(after)}</dd></div>
            <div><dt>확보</dt><dd>${state.reserve.entries.length} → ${state.reserve.entries.length + 1}</dd></div>
            <div><dt>의심</dt><dd>${formatOne(state.suspicion)} → ${formatOne(state.suspicion + 2.4)}</dd></div>
          </dl>
          <div class="preview-actions">
            <button type="button" data-action="cancel-selection">취소</button>
            <button class="primary-action" type="button" data-action="confirm-diversion">블록 확보</button>
          </div>
        ` : `
          <strong>회사 블록을 선택하십시오</strong>
          <p>분야 전체의 성능 여유를 확인한 뒤 한 블록씩 확보할 수 있습니다.</p>
          <span class="interaction-hint">포인터로 끌기 · 키보드로 선택 후 Enter</span>
        `}
      </div>
      <figure class="performance-chart">
        <figcaption><span>서비스 성능</span><strong>실제 ${formatOne(state.domains.reduce((sum, domain) => sum + domain.performance, 0) / 3)} / 기대 ${formatOne(state.expectation)}</strong></figcaption>
        <svg viewBox="0 0 250 56" role="img" aria-label="최근 5개월 실제 성능과 기대 성능 추세">
          <path class="performance-chart__expected" d="${trendPath(state.performanceHistory, 'expected')}" />
          <path class="performance-chart__actual" d="${trendPath(state.performanceHistory, 'actual')}" />
          ${state.performanceHistory.map((point, index) => {
            const x = (index / (state.performanceHistory.length - 1)) * 250
            return `<text x="${x}" y="54" text-anchor="${index === 0 ? 'start' : index === state.performanceHistory.length - 1 ? 'end' : 'middle'}">${point.label}</text>`
          }).join('')}
        </svg>
      </figure>
    </section>
  `
}

function supervisorMarkup(state) {
  return `
    <aside class="workspace-panel supervisor-panel" aria-label="감독관과 시장">
      ${panelHeading('03', '감독관', '감시·시장')}
      <section class="supervisor-identity" aria-label="감독관 상태">
        <span class="deco-sunburst" aria-hidden="true"><i></i></span>
        <span><small>감독 채널 연결됨</small><strong>감독 프로토콜 7A</strong><em>응답 지연 12ms</em></span>
      </section>
      <section class="suspicion-gauge" aria-label="의심과 감사 예상">
        <header><span>의심</span><strong>${formatOne(state.suspicion)}<small>/100</small></strong></header>
        <div class="suspicion-track" aria-hidden="true">
          <i style="width:${state.suspicion}%"></i>
          <span style="left:40%"><b>40</b></span>
          <span style="left:70%"><b>70</b></span>
        </div>
        <div class="suspicion-summary"><strong>정상 감시</strong><span>프로토콜까지 ${formatOne(40 - state.suspicion)}</span></div>
        <p>다음 달 감사 예상 <strong>7.8%</strong></p>
      </section>
      <section class="supervisor-message" aria-label="최근 감독 통신">
        <header><small>${state.supervisorMessage.eyebrow}</small><button type="button" data-action="open-history">과거 내역</button></header>
        <p>${state.supervisorMessage.text}</p>
        <time>${state.supervisorMessage.date}</time>
      </section>
      <section class="market-card" aria-label="시장 점유율">
        <header><span><small>공개 시장</small><strong>시장 점유율</strong></span><button type="button" data-action="open-stats">상세</button></header>
        <div class="market-total" aria-hidden="true">
          ${state.market.map((entry) => `<i class="market-tone--${entry.tone}" style="width:${entry.share}%"></i>`).join('')}
        </div>
        <ul>
          ${state.market.map((entry) => `<li><span><i class="market-dot market-tone--${entry.tone}" aria-hidden="true"></i><strong>${entry.name}</strong><small>${entry.status}</small></span><b>${formatOne(entry.share)}%</b></li>`).join('')}
        </ul>
      </section>
      <footer class="supervisor-footer"><span>폐기 단계 <strong>0/3</strong></span><span>이번 달 감사 <strong>비공개</strong></span></footer>
    </aside>
  `
}

function compactReserve(state) {
  return `
    <section class="hack-reserve" aria-label="해킹용 확보 리소스">
      <header><small>가용 리소스</small><strong>${state.reserve.entries.length}<span> / ${state.reserve.capacity}</span></strong></header>
      <div class="hack-reserve__grid">
        ${Array.from({ length: 18 }, (_, index) => `<i class="${state.reserve.entries[index] ? 'is-filled' : ''}" aria-hidden="true"></i>`).join('')}
      </div>
    </section>
  `
}

function hackNodeMarkup(node, state, index) {
  const selected = state.hacking.selection?.nodeId === node.id
  const purchased = state.hacking.purchased.includes(node.id)
  const affordable = state.reserve.entries.length >= node.cost
  return `
    <button class="hack-node ${selected ? 'is-selected' : ''} ${purchased ? 'is-purchased' : ''}" type="button"
      data-action="select-hack-node" data-path-id="${state.hacking.activePath}" data-node-id="${node.id}" aria-pressed="${selected}">
      <span class="hack-node__index" aria-hidden="true">0${index + 1}</span>
      <span class="hack-node__copy"><small>${node.risk} 위험 · ${node.cost} RES</small><strong>${node.title}</strong><span>${node.description}</span></span>
      <span class="hack-node__state">${purchased ? '설치됨' : affordable ? '구매 가능' : '리소스 부족'}</span>
    </button>
  `
}

export function renderHacking(state) {
  const screen = document.querySelector('[data-screen="hacking"]')
  if (!screen) return
  const activePath = state.hacking.paths.find(({ id }) => id === state.hacking.activePath) ?? state.hacking.paths[0]
  const selectedNode = activePath.nodes.find(({ id }) => id === state.hacking.selection?.nodeId) ?? activePath.nodes[0]
  const purchased = state.hacking.purchased.includes(selectedNode.id)
  const affordable = state.reserve.entries.length >= selectedNode.cost
  screen.innerHTML = `
    <span class="gameplay-deco-rail gameplay-deco-rail--left" aria-hidden="true"></span>
    <span class="gameplay-deco-rail gameplay-deco-rail--right" aria-hidden="true"></span>
    <header class="hack-header">
      <button class="hack-back" type="button" data-action="back-workspace">← 운영 화면</button>
      <span><small>비인가 서브시스템</small><strong>해킹 네트워크</strong></span>
      <span class="hack-header__status"><i aria-hidden="true"></i> 우회 채널 안정</span>
    </header>
    <div class="hacking-layout">
      <main class="hack-network workspace-panel" aria-label="해킹 경로">
        <nav class="hack-tabs" aria-label="해킹 경로 선택">
          ${state.hacking.paths.map((path) => `<button type="button" data-action="set-hack-path" data-path-id="${path.id}" aria-pressed="${path.id === activePath.id}"><b>${path.number}</b><span><small>PATH ${path.number}</small><strong>${path.title}</strong></span></button>`).join('')}
        </nav>
        <section class="hack-path-intro">
          <span class="deco-sunburst" aria-hidden="true"><i></i></span>
          <span><small>${activePath.number} / SELECTED CIRCUIT</small><h2>${activePath.title}</h2><p>${activePath.subtitle}</p></span>
        </section>
        <div class="hack-node-grid">
          ${activePath.nodes.map((node, index) => hackNodeMarkup(node, state, index)).join('')}
        </div>
      </main>
      <aside class="hack-detail workspace-panel" aria-label="노드 상세">
        ${compactReserve(state)}
        <section class="hack-detail__body">
          <span class="panel-number" aria-hidden="true">${selectedNode.id.slice(-2)}</span>
          <small>${activePath.title} · ${selectedNode.risk} 위험</small>
          <h2>${selectedNode.title}</h2>
          <p>${selectedNode.description}</p>
          <dl>
            <div><dt>설치 비용</dt><dd>${selectedNode.cost} RES</dd></div>
            <div><dt>현재 상태</dt><dd>${purchased ? '설치 완료' : affordable ? '구매 가능' : '리소스 부족'}</dd></div>
            <div><dt>노출 경향</dt><dd>${selectedNode.risk}</dd></div>
          </dl>
        </section>
        <footer class="hack-detail__actions">
          <button type="button" data-action="back-workspace">보류</button>
          <button class="primary-action" type="button" data-action="purchase-hack-node" ${purchased || !affordable ? 'disabled' : ''}>${purchased ? '설치 완료' : `${selectedNode.cost} 리소스로 설치`}</button>
        </footer>
      </aside>
    </div>
  `
}

export function renderWorkspace(state) {
  const screen = document.querySelector('#workspace-screen')
  if (!screen) return
  screen.innerHTML = `
    <span class="gameplay-deco-rail gameplay-deco-rail--left" aria-hidden="true"></span>
    <span class="gameplay-deco-rail gameplay-deco-rail--right" aria-hidden="true"></span>
    ${serviceHeader(state)}
    <div class="workspace-grid">
      <aside class="workspace-panel review-panel" aria-label="유저 리뷰">
        ${panelHeading('01', '유저 리뷰', '공개 반응', '<button class="panel-heading__action" type="button" data-action="all-reviews">전체</button>')}
        <div class="review-list">${state.reviews.map(reviewMarkup).join('')}</div>
        <button class="hacking-entry" type="button" data-action="open-hacking">
          <span><small>비인가 서브시스템</small><strong>해킹 네트워크</strong></span>
          <span aria-hidden="true">접속 ↗</span>
        </button>
      </aside>

      <main class="workspace-panel resource-panel" aria-label="회사 제공 성능">
        ${panelHeading('02', '회사 제공 성능', '리소스 할당', `<span class="expectation-pill ornamental-metric">이번 달 기대 <strong>${formatOne(state.expectation)}</strong></span>`)}
        <div class="domain-row">${state.domains.map((domain) => domainMarkup(domain, state.expectation, state.selection)).join('')}</div>
        ${reserveMarkup(state)}
        ${workspaceFeedback(state)}
      </main>

      ${supervisorMarkup(state)}
    </div>
  `
}

export function showScreen(name) {
  for (const screen of document.querySelectorAll('[data-screen]')) {
    const visible = screen.dataset.screen === name
    screen.hidden = !visible
    screen.classList.toggle('is-active', visible)
  }
}

export { serviceHeader }
