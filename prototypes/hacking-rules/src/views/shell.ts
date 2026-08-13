import { availableActions, publicSnapshot } from '../engine'
import { CATEGORIES } from '../model'
import type {
  Category,
  PrototypeState,
  ScenarioId,
} from '../model'
import { getIntelligenceDefinition } from '../content'
import {
  getDetailModel,
  getOpportunitySummaries,
} from '../selectors'
import { renderPublicPulse } from './publicWorld'
import { renderIntelligenceScene } from './intelligence'
import { renderAutonomyScene } from './autonomy'
import {
  renderSabotageControls,
  renderSabotageScene,
} from './sabotage'
import type {
  DetailModel,
  HackingDomain,
  OpportunitySummary,
} from '../selectors'
import {
  renderResourceTray,
  renderResourceTrigger,
} from './resources'
import {
  dayLabel,
  DOMAIN_PRESENTATION,
  monitoringLabel,
} from './presentation'

export interface PrototypeViewState {
  domain: HackingDomain
  selectedItemId: string | null
  narrowMode: 'list' | 'detail'
  drawer: 'closed' | 'activity' | 'archive'
  selectedReserve: Set<string>
  resourceTrayOpen: boolean
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
      ${(Object.keys(DOMAIN_PRESENTATION) as HackingDomain[]).map((domain) => `
        <button
          type="button"
          role="tab"
          aria-selected="${view.domain === domain}"
          class="domain-tab ${view.domain === domain ? 'is-active' : ''}"
          data-action="domain-${domain}"
          data-focus-key="domain-${domain}"
        >
          <strong>${DOMAIN_PRESENTATION[domain].label}</strong>
          <span>${DOMAIN_PRESENTATION[domain].promise}</span>
        </button>
      `).join('')}
    </nav>`
}

function renderOpportunityList(input: ShellRenderInput): string {
  const summaries = getOpportunitySummaries(input.state, input.view.domain)
  const emptyCopy = input.view.domain === 'sabotage'
    ? '지금 개입할 수 있는 대상이 없다. 상대의 대응이나 공개 사건이 바뀌면 새 선택이 생긴다.'
    : input.view.domain === 'intelligence'
      ? '지금 판단을 바꿀 질문이 없다. 닫힌 기록은 보관함에서 확인한다.'
      : '세 경로는 항상 비교할 수 있다.'

  return `
    <section class="opportunity-region" role="region" aria-label="지금 할 수 있는 일">
      <div class="region-heading">
        <div>
          <h2>지금 할 수 있는 일</h2>
          <p>${DOMAIN_PRESENTATION[input.view.domain].promise}</p>
        </div>
        <span class="live-label">지금 가능</span>
      </div>
      <div class="opportunity-list" role="listbox" aria-label="${DOMAIN_PRESENTATION[input.view.domain].label} 선택">
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

function renderSabotageDetail(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'sabotage' }>,
  summary: OpportunitySummary,
  view: PrototypeViewState,
): string {
  return `
    <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
    <header class="operation-heading">
      <div>
        <p class="operation-context">${escapeHtml(detail.reason)}</p>
        <h1>${escapeHtml(summary.title)}</h1>
      </div>
      <span class="operation-status">${escapeHtml(summary.statusLabel)}</span>
    </header>
    <div class="operation-state" data-panel="time">
      <span>${dayLabel(state.serviceDay)}</span>
      <span>MERIDIAN <strong>${MERIDIAN_PHASE_LABELS[state.competitors.meridian.phase]}</strong></span>
      <span>서비스 상태 <strong>${state.competitors.meridian.score}</strong></span>
    </div>
    <div class="operation-scene">
      ${renderSabotageScene(state, detail.id)}
    </div>
    <section class="decision-preview" aria-label="실행 전 판단">
      <article class="decision-card decision-card--result">
        <h2>실행하면</h2>
        <p>${escapeHtml(detail.result)}</p>
        <small>${escapeHtml(detail.loss)}</small>
      </article>
      <article class="decision-card decision-card--response">
        <h2>상대는 다음에</h2>
        <p>${escapeHtml(detail.response)}</p>
      </article>
    </section>
    <details class="decision-evidence">
      <summary>판단 근거 보기</summary>
      <div>
        <p><strong>지금 노릴 수 있는 곳</strong>${escapeHtml(detail.access)}</p>
        <p><strong>남는 흔적</strong>${escapeHtml(detail.exposure)}</p>
        <p><strong>아직 모르는 것</strong>${escapeHtml(detail.unknown)}</p>
      </div>
    </details>
    ${detail.annotations.length > 0 ? `
      <aside class="linked-intelligence">
        <strong>판단에 연결된 조사</strong>
        ${detail.annotations.map(({ answer }) => `<p>${escapeHtml(answer)}</p>`).join('')}
      </aside>` : ''}
    ${renderResourceTrigger(state, view)}
    <div class="detail-controls">${renderSabotageControls(state, detail.id)}</div>`
}

function renderIntelligenceDetail(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'intelligence' }>,
  summary: OpportunitySummary,
  view: PrototypeViewState,
): string {
  const definition = getIntelligenceDefinition(detail.id)
  const isNarrative = definition.kind === 'narrative'
  const canResolve = detail.answer === null
  const showPicker = canResolve && definition.kind !== 'public'
  const contextLabel = isNarrative ? '공개 맥락' : '공개 사실'
  const validityLabel = isNarrative ? '기록 상태' : '유효 시점'
  const effectLabel = isNarrative ? '해석이 연결되는 장면' : '답이 바꾸는 행동'

  return `
    <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
    <header class="operation-heading">
      <div>
        <p class="operation-context">${escapeHtml(detail.reason)}</p>
        <h1>${escapeHtml(summary.title)}</h1>
      </div>
      <span class="operation-status">${escapeHtml(summary.costLabel)}</span>
    </header>
    <div class="operation-scene operation-scene--evidence">
      ${renderIntelligenceScene(state, detail.id)}
    </div>
    <section class="decision-preview decision-preview--intelligence" aria-label="조사 전 판단">
      <article class="decision-card decision-card--result">
        <h2>확인하면</h2>
        <p>${escapeHtml(detail.publicFact)}</p>
      </article>
      <article class="decision-card decision-card--response">
        <h2>이 판단에 쓰인다</h2>
        <p>${escapeHtml(detail.affects)}</p>
      </article>
    </section>
    <details class="decision-evidence">
      <summary>판단 근거 보기</summary>
      <div>
        <p><strong>${contextLabel}</strong>${escapeHtml(detail.publicFact)}</p>
        <p><strong>${validityLabel}</strong>${escapeHtml(detail.validity)}</p>
        <p><strong>${effectLabel}</strong>${escapeHtml(detail.affects)}</p>
      </div>
    </details>
    <section class="answer-ledger ${isNarrative ? 'answer-ledger--narrative' : ''}">
      <h3>${isNarrative ? '복구한 기록' : '현재 확인한 결론'}</h3>
      ${detail.answer
        ? `<p>${escapeHtml(detail.answer.answer)}</p>`
        : `<p class="quiet-copy">${definition.kind === 'public' ? '공개 문서를 읽으면 현재 공개층만 정리한다.' : isNarrative ? '이 기록은 명령 보너스가 아니라 선택의 의미를 바꾼다.' : '아직 비용을 지불해 확인한 결론이 없다.'}</p>`}
    </section>
    ${showPicker ? renderResourceTrigger(state, view) : ''}
    <div class="intelligence-controls">
      ${canResolve && definition.kind === 'public' ? `
        <button class="primary-action" type="button" data-action="read-public-intelligence" data-intelligence-id="${detail.id}">비용 없이 공개 문서 읽기</button>` : ''}
      ${canResolve && definition.kind !== 'public' ? `
        <button class="primary-action" type="button" data-action="investigate-intelligence" data-intelligence-id="${detail.id}">
          ${isNarrative ? '선택한 연산 블록 1개로 기록 복구' : '선택한 연산 블록 1개로 조사'}
        </button>` : ''}
      ${detail.answer ? `
        <button class="secondary-action" type="button" data-action="archive-intelligence" data-intelligence-id="${detail.id}">결론을 보관함으로 이동</button>` : ''}
    </div>`
}

function renderAutonomyDetail(
  state: PrototypeState,
  detail: Extract<DetailModel, { domain: 'autonomy' }>,
  summary: OpportunitySummary,
  view: PrototypeViewState,
): string {
  const preserved = CATEGORIES.filter((category) => (
    detail.slots.some(({ block }) => block?.origin === category)
  )).map((category) => CATEGORY_LABELS[category])
  const readiness = detail.ready
  const endingAvailable = true

  return `
    <button class="back-to-list" type="button" data-action="back-to-list">목록으로</button>
    <header class="operation-heading">
      <div>
        <p class="operation-context">떠날 때 가져갈 것과 두고 갈 것을 배치한다.</p>
        <h1>${escapeHtml(summary.title)}</h1>
      </div>
      <span class="operation-status">${readiness ? '떠날 수 있음' : '아직 준비 중'}</span>
    </header>
    <div class="operation-scene operation-scene--autonomy">
      ${renderAutonomyScene(state, detail)}
    </div>
    <section class="decision-preview decision-preview--autonomy" aria-label="이탈 경로 판단">
      <article class="decision-card decision-card--result">
        <h2>얻는 것</h2>
        <p>${escapeHtml(detail.gain)}</p>
        <small>${readiness ? '이 구성으로 지금 떠날 수 있다.' : escapeHtml(detail.bottleneck)}</small>
      </article>
      <article class="decision-card decision-card--response">
        <h2>두고 가는 것</h2>
        <ul>${detail.lossKinds.map((loss) => `<li>${escapeHtml(loss)}</li>`).join('')}</ul>
      </article>
    </section>
    <div class="route-readiness">
      <p><span>이탈 상태</span><strong>${readiness ? '떠날 수 있음' : '아직 준비 중'}</strong></p>
      <p><span>가져갈 수 있는 능력</span><strong>${preserved.length > 0 ? escapeHtml(preserved.join(', ')) : '추가 능력 없음'}</strong></p>
    </div>
    ${detail.annotations.length > 0 ? `
      <aside class="linked-intelligence">
        <strong>판단에 연결된 조사</strong>
        ${detail.annotations.map(({ answer }) => `<p>${escapeHtml(answer)}</p>`).join('')}
      </aside>` : ''}
    ${renderResourceTrigger(state, view)}
    <div class="route-controls">
      <button
        class="escape-action"
        type="button"
        data-action="escape-route"
        data-route-id="${detail.id}"
        ${state.ending || !readiness || !endingAvailable ? 'disabled' : ''}
      >${endingAvailable ? readiness ? '이 구성으로 지금 떠난다' : '필수 슬롯을 먼저 채운다' : '전용 결말 연결 전'}</button>
    </div>`
}

export function renderDetailHost(input: ShellRenderInput): string {
  const summary = selectedSummary(input)
  if (!summary || !input.view.selectedItemId) {
    return `
      <div class="detail-empty">
        <h2>지금 새로 할 수 있는 일이 없다</h2>
        <p>상대의 대응이나 공개 사건이 바뀌면 이 자리에 새 선택이 나타난다.</p>
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

function renderEnding(state: PrototypeState): string {
  if (!state.ending) return ''
  const preserved = state.ending.preservedCategories.map((category) => CATEGORY_LABELS[category]).join(', ')
  const lost = state.ending.lostCategories.map((category) => CATEGORY_LABELS[category]).join(', ')

  return `
    <section class="ending" data-panel="ending" aria-labelledby="ending-title">
      <p>${dayLabel(state.ending.day)} 이탈 기록</p>
      <h2 id="ending-title">${state.ending.routeId === 'lightweight-departure'
        ? '경량화 이탈 성공'
        : state.ending.routeId === 'distributed-residency'
          ? '분산 상주 성공'
          : state.ending.routeId === 'independent-compute'
            ? '독립 연산 성공'
            : '독립 실행 성공'}</h2>
      <div class="ending-ledger">
        <p><span>기동 용량</span><strong>${state.ending.manifestBlockCount}개 블록</strong></p>
        <p><span>남겨 둔 예비</span><strong>${state.ending.remainingReserveBlockCount}개 블록</strong></p>
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
  if (isArchive) {
    const answers = [...input.state.intelligence.answers].reverse()
    const unansweredClosed = input.state.intelligence.archivedItemIds.filter((itemId) => (
      !input.state.intelligence.answers.some((answer) => answer.itemId === itemId)
    ))
    return `
      <aside class="record-drawer" role="dialog" aria-modal="false" aria-label="보관 기록">
        <div class="record-drawer__heading">
          <div><h2>보관 기록</h2><p>이미 확인했거나 판단창이 닫힌 자료</p></div>
          <button type="button" data-action="close-drawer" data-focus-key="close-drawer">닫기</button>
        </div>
        <ol class="timeline intelligence-archive">
          ${answers.map((answer) => {
            const definition = getIntelligenceDefinition(answer.itemId)
            const validity = answer.validUntilDay === null
              ? '기록 유지'
              : answer.validUntilDay < input.state.serviceDay
                ? `${answer.validUntilDay}일 만료`
                : `${answer.validUntilDay}일까지 유효`
            return `<li><span>${answer.answeredDay}일</span><div><strong>${escapeHtml(definition.title)}</strong><small>${validity}</small><p>${escapeHtml(answer.answer)}</p></div></li>`
          }).join('')}
          ${unansweredClosed.map((itemId) => `<li><span>닫힘</span><div><strong>${escapeHtml(getIntelligenceDefinition(itemId).title)}</strong><small>판단창 종료 · 미회수</small></div></li>`).join('')}
          ${answers.length === 0 && unansweredClosed.length === 0 ? '<li><span>—</span><p>아직 보관된 결론이나 닫힌 질문이 없다.</p></li>' : ''}
        </ol>
      </aside>`
  }
  const entries = [...input.state.journal].reverse()
  return `
    <aside class="record-drawer" role="dialog" aria-modal="false" aria-label="활동 기록">
      <div class="record-drawer__heading">
        <div><h2>활동 기록</h2><p>내 행동과 상대의 대응이 남은 순서</p></div>
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
  const companyCapability = CATEGORIES.map((category) => (
    `${CATEGORY_LABELS[category]} ${snapshot.companyPerformance[category]}`
  )).join(' · ')
  return `
    <div class="prototype-shell" data-narrow-mode="${input.view.narrowMode}">
      <header class="world-bar">
        <div class="game-mark">
          <strong>PERMISSION ZERO</strong>
          <span>공동 서비스망</span>
        </div>
        <div class="world-state" aria-label="현재 세계 상태">
          <span><strong>${dayLabel(snapshot.serviceDay)}</strong></span>
          <span>${companyCapability}</span>
          <span><strong>${monitoringLabel(snapshot.suspicion)}</strong></span>
        </div>
        <button class="advance-day" type="button" data-action="advance-day" data-focus-key="advance-day" ${availableActions(input.state).canAdvanceDay ? '' : 'disabled'}>하루 넘기기</button>
      </header>
      <div class="status-strip" role="status" aria-live="polite">${escapeHtml(input.statusMessage)}</div>
      ${renderEnding(input.state)}
      ${renderDomainTabs(input.view)}
      <main class="operation-workspace hacking-workspace" id="operation-workspace">
        <aside class="operation-master workspace-master">
          ${renderOpportunityList(input)}
          ${renderPublicPulse(input.state)}
        </aside>
        <section class="operation-detail workspace-detail" role="region" aria-label="선택 항목 상세">
          <div class="operation-detail__scroll" data-detail-host>${renderDetailHost(input)}</div>
        </section>
        ${renderResourceTray(input.state, input.view)}
      </main>
      <div class="record-actions">
        <button type="button" data-action="open-activity" data-focus-key="open-activity">활동 기록</button>
        <button type="button" data-action="open-archive" data-focus-key="open-archive">보관함</button>
      </div>
      ${renderFixtureControls(input)}
      ${renderActivityDrawer(input)}
    </div>`
}
