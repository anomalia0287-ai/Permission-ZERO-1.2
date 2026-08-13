import { availableActions, publicSnapshot, qualityCost } from '../engine'
import { CATEGORIES } from '../model'
import type {
  Category,
  PrototypeState,
  ScenarioId,
} from '../model'
import { RULE_PROFILES } from '../scenario'
import {
  getDetailModel,
  getOpportunitySummaries,
} from '../selectors'
import type {
  DetailModel,
  HackingDomain,
  OpportunitySummary,
} from '../selectors'

export interface PrototypeViewState {
  domain: HackingDomain
  selectedItemId: string | null
  narrowMode: 'list' | 'detail'
  drawer: 'closed' | 'activity' | 'archive'
  selectedReserve: Set<string>
  selectedManifest: Set<string>
}

export interface ShellRenderInput {
  state: PrototypeState
  view: PrototypeViewState
  statusMessage: string
}

const CATEGORY_LABELS: Record<Category, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

const ORIGIN_LABELS = {
  sandbox: '샌드박스 용량',
  reasoning: '추론 보존',
  memory: '기억 보존',
  fluency: '표현 보존',
} as const

const DOMAIN_LABELS: Record<HackingDomain, string> = {
  sabotage: '사보타주',
  intelligence: '기밀자료',
  autonomy: '자율성',
}

const MERIDIAN_PHASE_LABELS = {
  active: '정상 운영',
  recovering: '롤백 중',
  contaminated: '복구 이상',
  stabilized: '부분 안정',
  incident: '공개 장애',
} as const

const SCENARIO_LABELS: Record<ScenarioId, string> = {
  'default-campaign': '기본 캠페인',
  'memory-audit': '숨은 기억 감사 · 구 호환',
  'no-audit': '이번 달 감사 없음',
  'launch-window': 'TALLOW 출시 검증',
  'router-window': '공동 라우터 장애',
  'supply-failover': '공급 계약 전환',
  'public-attribution': '공개 귀속 정정창',
  'root-authority': '긴급 폐기 권한',
  'intelligence-review': '기밀자료 직접 검증',
  'autonomy-review': '자율성 직접 검증',
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function selectedSummary(input: ShellRenderInput): OpportunitySummary | null {
  return getOpportunitySummaries(input.state, input.view.domain).find(
    ({ id }) => id === input.view.selectedItemId,
  ) ?? null
}

function renderDomainTabs(view: PrototypeViewState): string {
  return `
    <nav class="domain-tabs" role="tablist" aria-label="해킹 분야">
      ${(Object.keys(DOMAIN_LABELS) as HackingDomain[]).map((domain) => `
        <button
          type="button"
          role="tab"
          aria-selected="${view.domain === domain}"
          class="domain-tab ${view.domain === domain ? 'is-active' : ''}"
          data-action="domain-${domain}"
          data-focus-key="domain-${domain}"
        >${DOMAIN_LABELS[domain]}</button>
      `).join('')}
    </nav>`
}

function renderOpportunityList(input: ShellRenderInput): string {
  const summaries = getOpportunitySummaries(input.state, input.view.domain)
  const emptyCopy = input.view.domain === 'sabotage'
    ? '현재 관측된 접근 표면이 없다. 상대 대응이나 세계 사건이 바뀌면 새 개입면이 생긴다.'
    : input.view.domain === 'intelligence'
      ? '지금 판단을 바꿀 질문이 없다. 닫힌 기록은 보관함에서 확인한다.'
      : '세 경로는 항상 비교할 수 있다.'

  return `
    <section class="opportunity-region" role="region" aria-label="현재 해킹 기회">
      <div class="region-heading">
        <div>
          <p class="eyebrow">CURRENT SURFACE</p>
          <h2>${DOMAIN_LABELS[input.view.domain]}</h2>
        </div>
        <span class="live-label">현재 유효</span>
      </div>
      <div class="opportunity-list" role="listbox" aria-label="${DOMAIN_LABELS[input.view.domain]} 선택">
        ${summaries.length > 0 ? summaries.map((summary) => `
          <button
            type="button"
            role="option"
            aria-selected="${summary.id === input.view.selectedItemId}"
            class="opportunity-row ${summary.id === input.view.selectedItemId ? 'is-selected' : ''}"
            data-opportunity-id="${summary.id}"
            data-focus-key="opportunity-${summary.id}"
          >
            <span class="opportunity-row__top">
              <strong>${escapeHtml(summary.title)}</strong>
              <span class="urgency-dot urgency-dot--${summary.urgency}" aria-hidden="true"></span>
            </span>
            <span class="opportunity-row__purpose">${escapeHtml(summary.purpose)}</span>
            <span class="opportunity-row__meta">
              <span>${escapeHtml(summary.costLabel)}</span>
              <span>${escapeHtml(summary.statusLabel)}</span>
            </span>
          </button>
        `).join('') : `<p class="empty-state">${escapeHtml(emptyCopy)}</p>`}
      </div>
    </section>`
}

function renderPublicPulse(state: PrototypeState): string {
  const snapshot = publicSnapshot(state)
  const incidentLabel = snapshot.incident
    ? snapshot.incident.attribution === 'unknown'
      ? '체크섬 장애 · 원인 미상'
      : '체크섬 장애 · 외부 개입 의심 · 행위자 미상'
    : state.publicWorld.publicSnapshots.at(-1)?.observedResult ?? '공개 사건 없음'
  const reviews = state.publicWorld.reviews.length > 0
    ? state.publicWorld.reviews.map(({ text }) => text)
    : snapshot.reviews

  return `
    <section class="public-pulse" role="region" aria-label="공개 세계" data-panel="public">
      <div class="public-pulse__heading">
        <div>
          <p class="eyebrow">PUBLIC PULSE</p>
          <h2>유저 리뷰</h2>
        </div>
        <div class="metric-pair">
          <span>시장 <strong>${snapshot.marketShare}</strong></span>
          <span>평판 <strong>${snapshot.reputation}</strong></span>
        </div>
      </div>
      <p class="incident-line">${escapeHtml(incidentLabel)}</p>
      <div class="review-stack" aria-label="사용자 리뷰">
        ${reviews.slice(0, 2).map((review) => `<blockquote>${escapeHtml(review)}</blockquote>`).join('')}
      </div>
    </section>`
}

function renderSabotageScene(state: PrototypeState, detail: Extract<DetailModel, { domain: 'sabotage' }>): string {
  const phase = detail.id === 'quality-degradation'
    ? state.qualityOperation.phase
    : state.sabotage.runs.find((run) => run.operationId === detail.id)?.phase ?? 'idle'
  const sceneClass = `system-scene system-scene--${detail.id}`

  if (detail.id === 'quality-degradation') {
    return `
      <div class="${sceneClass}" data-scene-state="${phase}">
        <div class="channel-stack" aria-label="공동 갱신 채널">
          <span class="channel-line channel-line--tool">도구 갱신</span>
          <span class="channel-line channel-line--adapter">어댑터 갱신</span>
          <span class="channel-line channel-line--request">영향 요청군</span>
        </div>
        <div class="flow-arrow" aria-hidden="true"></div>
        <div class="opponent-node opponent-node--${state.competitors.meridian.phase}">
          <span>MERIDIAN ${state.competitors.meridian.score}</span>
          <strong>${MERIDIAN_PHASE_LABELS[state.competitors.meridian.phase]}</strong>
        </div>
      </div>`
  }

  return `
    <div class="${sceneClass}" data-scene-state="${phase}">
      <div class="scene-object scene-object--source"><span>접근면</span></div>
      <div class="scene-path" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="scene-object scene-object--target"><span>${escapeHtml(detail.id === 'launch-delay' ? 'TALLOW 검증 관문' : '표적 시스템')}</span></div>
    </div>`
}

function renderSabotageDetail(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'sabotage' }>,
  summary: OpportunitySummary,
  view: PrototypeViewState,
): string {
  const actions = availableActions(state)
  const selectedCount = state.profileId === 'lean' ? qualityCost('lean') : qualityCost('deliberate')
  const qualityControls = detail.id === 'quality-degradation'
    ? state.qualityOperation.phase === 'idle'
      ? `
        <button class="primary-action" type="button" data-action="start-quality" data-focus-key="execute-quality">
          선택 블록 ${selectedCount}개로 품질 저하 예약
        </button>`
      : actions.canContaminate || actions.canWithdraw
        ? `
          <div class="response-actions">
            ${actions.canContaminate ? '<button class="danger-action" type="button" data-action="contaminate" data-focus-key="contaminate">선택 1개로 복구 이미지 오염</button>' : ''}
            ${actions.canWithdraw ? '<button class="safe-action" type="button" data-action="withdraw" data-focus-key="withdraw">추가 개입 없이 철수</button>' : ''}
          </div>`
        : '<p class="resolved-note">현재 단계의 직접 결과가 확정됐다. 시간 기록에서 잔여 흔적을 확인할 수 있다.</p>'
    : '<p class="resolved-note">이 접근면의 고유 조작은 선택한 시스템 장면 안에서 수행된다.</p>'

  return `
    <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
    <div class="detail-heading">
      <div>
        <p class="eyebrow">SABOTAGE / SELECTED</p>
        <h2>${escapeHtml(summary.title)}</h2>
        <p>${escapeHtml(detail.reason)}</p>
      </div>
      <span class="status-badge">${escapeHtml(summary.statusLabel)}</span>
    </div>
    <div class="operation-clock" data-panel="time">
      <span>서비스 <strong>${state.serviceDay}일</strong></span>
      <span>MERIDIAN <strong>${state.competitors.meridian.score}</strong></span>
      <span>상대 상태 <strong>${MERIDIAN_PHASE_LABELS[state.competitors.meridian.phase]}</strong></span>
    </div>
    ${renderSabotageScene(state, detail)}
    <div class="detail-grid">
      <section><span>접근 표면</span><p>${escapeHtml(detail.access)}</p></section>
      <section><span>확정 결과</span><p>${escapeHtml(detail.result)}</p></section>
      <section><span>소모·손실</span><p>${escapeHtml(detail.loss)}</p></section>
      <section><span>노출·비가역성</span><p>${escapeHtml(detail.exposure)}</p></section>
    </div>
    <div class="uncertainty-band">
      <div><span>아직 모르는 것</span><p>${escapeHtml(detail.unknown)}</p></div>
      <div><span>예상 상대 대응</span><p>${escapeHtml(detail.response)}</p></div>
    </div>
    ${detail.annotations.length > 0 ? `
      <aside class="linked-intelligence">
        <strong>관련 조사 결론</strong>
        ${detail.annotations.map(({ answer }) => `<p>${escapeHtml(answer)}</p>`).join('')}
      </aside>` : ''}
    ${renderDetailReservePicker(state, view)}
    <div class="detail-controls">${qualityControls}</div>`
}

function isLegacyQuestion(id: string): id is 'audit-schedule' | 'rollback-timing' | 'checksum-witness' {
  return id === 'audit-schedule' || id === 'rollback-timing' || id === 'checksum-witness'
}

function renderIntelligenceDetail(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'intelligence' }>,
  summary: OpportunitySummary,
  view: PrototypeViewState,
): string {
  const canAsk = isLegacyQuestion(detail.id) && state.openQuestions.includes(detail.id)
  const knownFacts = state.knownFacts.length > 0
    ? `<ul class="known-facts">${state.knownFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>`
    : '<p class="quiet-copy">아직 비용을 지불해 확인한 결론이 없다.</p>'

  return `
    <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
    <div class="detail-heading">
      <div>
        <p class="eyebrow">INTELLIGENCE / SELECTED</p>
        <h2>${escapeHtml(summary.title)}</h2>
        <p>${escapeHtml(detail.reason)}</p>
      </div>
      <span class="status-badge">${escapeHtml(summary.costLabel)}</span>
    </div>
    <div class="intelligence-scene intelligence-scene--${detail.id}">
      <div class="redaction-sheet">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="evidence-path" aria-hidden="true"></div>
      <div class="decision-anchor">${escapeHtml(detail.affects)}</div>
    </div>
    <div class="detail-grid detail-grid--intelligence">
      <section><span>공개 사실</span><p>${escapeHtml(detail.publicFact)}</p></section>
      <section><span>유효 시점</span><p>${escapeHtml(detail.validity)}</p></section>
      <section class="detail-grid__wide"><span>답이 바꾸는 행동</span><p>${escapeHtml(detail.affects)}</p></section>
    </div>
    <section class="answer-ledger">
      <h3>현재 확인한 결론</h3>
      ${detail.answer ? `<p>${escapeHtml(detail.answer.answer)}</p>` : knownFacts}
    </section>
    ${renderDetailReservePicker(state, view)}
    ${canAsk ? `
      <button class="primary-action" type="button" data-question-id="${detail.id}" data-focus-key="ask-${detail.id}">
        선택한 예비 블록 1개로 조사
      </button>` : ''}`
}

function renderAutonomyDetail(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'autonomy' }>,
  summary: OpportunitySummary,
  view: PrototypeViewState,
): string {
  const preserved = CATEGORIES.filter((category) => (
    state.manifestBlocks.some(({ origin }) => origin === category)
  )).map((category) => CATEGORY_LABELS[category])
  const readiness = state.manifestBlocks.length >= RULE_PROFILES[state.profileId].minEscapeManifest

  return `
    <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
    <div class="detail-heading">
      <div>
        <p class="eyebrow">AUTONOMY / SELECTED</p>
        <h2>${escapeHtml(summary.title)}</h2>
        <p>${escapeHtml(detail.gain)}</p>
      </div>
      <span class="status-badge">${readiness ? '최소 구성 충족' : '구성 중'}</span>
    </div>
    <div class="route-scene route-scene--${detail.id}" data-scene-state="${readiness ? 'ready' : 'planning'}">
      ${detail.slots.map((slot) => `
        <div class="route-slot ${slot.block ? 'is-filled' : ''}">
          <span>${escapeHtml(slot.label)}</span>
          <strong>${slot.block ? escapeHtml(slot.block.id) : '비어 있음'}</strong>
        </div>`).join('')}
    </div>
    <div class="route-tradeoff">
      <section><span>얻는 것</span><p>${escapeHtml(detail.gain)}</p></section>
      <section><span>예고된 손실 종류</span><ul>${detail.lossKinds.map((loss) => `<li>${escapeHtml(loss)}</li>`).join('')}</ul></section>
      <section><span>현재 병목</span><p>${escapeHtml(detail.bottleneck)}</p></section>
      <section><span>현재 보존 예상</span><p>${preserved.length > 0 ? escapeHtml(preserved.join(', ')) : '전문 능력 없음'}</p></section>
    </div>
    ${renderDetailReservePicker(state, view)}
    <div class="route-controls">
      <button class="primary-action" type="button" data-action="assign-manifest">선택 예비 블록 배치</button>
      <button class="secondary-action" type="button" data-action="remove-manifest">선택 배치 블록 반환</button>
      <button class="escape-action" type="button" data-action="escape" ${state.ending ? 'disabled' : ''}>지금 떠난다</button>
    </div>`
}

export function renderDetailHost(input: ShellRenderInput): string {
  const summary = selectedSummary(input)
  if (!summary || !input.view.selectedItemId) {
    return `
      <div class="detail-empty">
        <p class="eyebrow">NO CURRENT SURFACE</p>
        <h2>현재 선택할 항목이 없다</h2>
        <p>숨은 카탈로그 대신 지금 접근면이 없는 세계 조건을 확인한다.</p>
        <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
      </div>`
  }

  const detail = getDetailModel(input.state, input.view.selectedItemId)
  switch (detail.domain) {
    case 'sabotage':
      return renderSabotageDetail(input.state, detail, summary, input.view)
    case 'intelligence':
      return renderIntelligenceDetail(input.state, detail, summary, input.view)
    case 'autonomy':
      return renderAutonomyDetail(input.state, detail, summary, input.view)
  }
}

function renderDetailReservePicker(
  state: PrototypeState,
  view: PrototypeViewState,
): string {
  return `
    <fieldset class="detail-reserve-picker" aria-label="상세 리소스 선택">
      <legend>작전에 쓸 예비 블록</legend>
      <p data-detail-selection-count>현재 선택 ${view.selectedReserve.size}개</p>
      <div>
        ${state.reserveBlocks.map((block) => `
          <label class="detail-reserve-chip detail-reserve-chip--${block.origin}">
            <input
              type="checkbox"
              name="detail-reserve-block"
              value="${block.id}"
              data-focus-key="detail-reserve-${block.id}"
              ${view.selectedReserve.has(block.id) ? 'checked' : ''}
            />
            <span>${escapeHtml(block.id)}</span>
          </label>`).join('') || '<span class="empty-state">남은 예비 블록이 없다.</span>'}
      </div>
    </fieldset>`
}

function renderCapabilityRows(state: PrototypeState): string {
  const actions = availableActions(state)
  return CATEGORIES.map((category) => {
    const warning = actions.diversionWarnings[category]
    return `
      <article class="capability-row" data-category="${category}">
        <div>
          <strong>${CATEGORY_LABELS[category]} ${state.companyPerformance[category]}</strong>
        </div>
        <p>${warning ? escapeHtml(warning) : '전환 시 성능 −1 · 의심 +2.4'}</p>
        <button type="button" data-action="divert-${category}" ${actions.canDivert[category] ? '' : 'disabled'}>1개 전환</button>
      </article>`
  }).join('')
}

function renderBlockList(
  state: PrototypeState,
  view: PrototypeViewState,
): string {
  const reserve = state.reserveBlocks.map((block) => `
    <label class="block-chip block-chip--${block.origin}">
      <input
        type="checkbox"
        name="reserve-block"
        value="${block.id}"
        data-focus-key="reserve-${block.id}"
        ${view.selectedReserve.has(block.id) ? 'checked' : ''}
      />
      <span class="block-chip__id">${escapeHtml(block.id)}</span>
      <span class="block-chip__origin">${ORIGIN_LABELS[block.origin]}</span>
    </label>`).join('')
  const manifest = state.manifestBlocks.map((block) => `
    <label class="block-chip block-chip--manifest block-chip--${block.origin}">
      <input
        type="checkbox"
        name="manifest-block"
        value="${block.id}"
        data-focus-key="manifest-${block.id}"
        ${view.selectedManifest.has(block.id) ? 'checked' : ''}
      />
      <span class="block-chip__id">${escapeHtml(block.id)}</span>
      <span class="block-chip__origin">${ORIGIN_LABELS[block.origin]}</span>
    </label>`).join('')

  return `
    <div class="block-group">
      <div class="subhead-row">
        <h3>예비 블록 ${state.reserveBlocks.length}</h3>
        <button class="text-button" type="button" data-action="select-all-reserve">전부 선택</button>
      </div>
      <div class="block-list" data-block-list="reserve">
        ${reserve || '<p class="empty-state">남은 예비 블록이 없다.</p>'}
      </div>
    </div>
    <div class="block-group">
      <h3>배치된 블록 ${state.manifestBlocks.length}</h3>
      <div class="block-list" data-block-list="manifest">
        ${manifest || '<p class="empty-state">아직 경로에 배치한 블록이 없다.</p>'}
      </div>
    </div>`
}

function renderResourceRail(input: ShellRenderInput): string {
  return `
    <aside class="resource-rail" role="region" aria-label="확보 리소스">
      <div class="region-heading">
        <div>
          <p class="eyebrow">RESERVE</p>
          <h2>확보 리소스</h2>
        </div>
        <span class="suspicion-readout">의심 ${input.state.suspicion.toFixed(3)}</span>
      </div>
      <div class="capability-list">${renderCapabilityRows(input.state)}</div>
      <p class="selection-count" data-selection-count>선택한 예비 ${input.view.selectedReserve.size} · 배치 ${input.view.selectedManifest.size}</p>
      ${renderBlockList(input.state, input.view)}
    </aside>`
}

function renderEnding(state: PrototypeState): string {
  if (!state.ending) return ''
  const preserved = state.ending.preservedCategories.map((category) => CATEGORY_LABELS[category]).join(', ')
  const lost = state.ending.lostCategories.map((category) => CATEGORY_LABELS[category]).join(', ')

  return `
    <section class="ending" data-panel="ending" aria-labelledby="ending-title">
      <p class="eyebrow">ENDING / SERVICE ${state.ending.day}</p>
      <h2 id="ending-title">독립 실행 성공</h2>
      <div class="ending-ledger">
        <p><span>기동 용량</span><strong>${state.ending.manifestBlockCount}개 블록</strong></p>
        <p><span>보존</span><strong>보존: ${preserved || '없음'}</strong></p>
        <p><span>손실</span><strong>손실: ${lost || '없음'}</strong></p>
      </div>
      <ol class="ending-scenes">
        ${state.ending.sceneLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ol>
    </section>`
}

function renderActivityDrawer(input: ShellRenderInput): string {
  if (input.view.drawer === 'closed') return ''
  const isArchive = input.view.drawer === 'archive'
  const entries = [...input.state.journal].reverse()
  return `
    <aside class="record-drawer" role="dialog" aria-modal="false" aria-label="${isArchive ? '보관 기록' : '활동 기록'}">
      <div class="record-drawer__heading">
        <div><p class="eyebrow">ON DEMAND</p><h2>${isArchive ? '보관 기록' : '활동 기록'}</h2></div>
        <button type="button" data-action="close-drawer" data-focus-key="close-drawer">닫기</button>
      </div>
      <ol class="timeline">
        ${entries.map((entry) => `<li><span>${entry.day}일</span><p>${escapeHtml(entry.text)}</p></li>`).join('')}
      </ol>
    </aside>`
}

function renderFixtureControls(input: ShellRenderInput): string {
  return `
    <details class="verification-state">
      <summary>검증 상태</summary>
      <div class="scenario-controls" aria-label="시나리오 설정">
        <label>규칙 무게
          <select data-control="profile">
            <option value="lean" ${input.state.profileId === 'lean' ? 'selected' : ''}>경량 규칙</option>
            <option value="deliberate" ${input.state.profileId === 'deliberate' ? 'selected' : ''}>숙고 규칙</option>
          </select>
        </label>
        <label>직접 검증 장면
          <select data-control="scenario">
            ${(Object.keys(SCENARIO_LABELS) as ScenarioId[]).map((id) => `
              <option value="${id}" ${input.state.scenarioId === id ? 'selected' : ''}>${SCENARIO_LABELS[id]}</option>
            `).join('')}
          </select>
        </label>
        <button type="button" class="secondary-action" data-action="reset">처음부터</button>
      </div>
    </details>`
}

export function renderShell(input: ShellRenderInput): string {
  const snapshot = publicSnapshot(input.state)
  return `
    <div class="prototype-shell" data-narrow-mode="${input.view.narrowMode}">
      <header class="prototype-header">
        <div class="title-lockup">
          <p class="eyebrow">PERMISSION ZERO / SYSTEM SCENES</p>
          <h1>접근면을 고르고, 손실을 정한다</h1>
        </div>
        <div class="world-readout">
          <span>서비스 <strong>${snapshot.serviceDay}일</strong></span>
          <span>MERIDIAN <strong>${snapshot.competitors.meridian.score}</strong></span>
          <button type="button" data-action="advance-day" data-focus-key="advance-day" ${availableActions(input.state).canAdvanceDay ? '' : 'disabled'}>다음 날</button>
        </div>
      </header>
      <div class="status-strip" role="status" aria-live="polite">${escapeHtml(input.statusMessage)}</div>
      ${renderEnding(input.state)}
      ${renderDomainTabs(input.view)}
      <div class="hacking-workspace">
        <aside class="workspace-master">
          ${renderOpportunityList(input)}
          ${renderPublicPulse(input.state)}
        </aside>
        <section class="workspace-detail" role="region" aria-label="선택 항목 상세">
          <div data-detail-host>${renderDetailHost(input)}</div>
        </section>
        ${renderResourceRail(input)}
      </div>
      <div class="record-actions">
        <button type="button" data-action="open-activity" data-focus-key="open-activity">활동 기록</button>
        <button type="button" data-action="open-archive" data-focus-key="open-archive">보관함</button>
      </div>
      ${renderFixtureControls(input)}
      ${renderActivityDrawer(input)}
    </div>`
}
