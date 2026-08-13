import { availableActions, publicSnapshot, qualityCost, transition } from './engine'
import { CATEGORIES } from './model'
import type {
  Category,
  ProfileId,
  PrototypeCommand,
  PrototypeState,
  ScenarioId,
} from './model'
import { createPrototypeState, RULE_PROFILES } from './scenario'

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

const QUALITY_PHASE_LABELS = {
  idle: '미실행',
  scheduled: '다음 날 실행 대기',
  recovering: '복구 개입 창 열림',
  contaminated: '오염 유지 중',
  withdrawn: '안전 철수',
  resolved: '결과 확정',
} as const

const MERIDIAN_PHASE_LABELS = {
  active: '정상 운영',
  recovering: '복구 중',
  contaminated: '복구 이상',
  stabilized: '부분 안정',
  incident: '공개 장애',
} as const

const QUESTION_LABELS = {
  'audit-schedule': {
    title: '감사 일정 확인',
    description: '어느 능력을 빼면 곧 들킬지 확인한다.',
  },
  'rollback-timing': {
    title: '롤백 종료 시점 확인',
    description: '추가 개입이 가능한 시간을 확인한다.',
  },
  'checksum-witness': {
    title: '외부 체크섬 증거 확인',
    description: '언제 귀속 위험이 생길지 확인한다.',
  },
} as const

export interface PrototypeController {
  getState(): PrototypeState
  reset(profileId?: ProfileId, scenarioId?: ScenarioId): void
  destroy(): void
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function blockList(
  state: PrototypeState,
  selectedReserve: Set<string>,
  selectedManifest: Set<string>,
): string {
  const reserve = state.reserveBlocks
    .map(
      (block) => `
        <label class="block-chip block-chip--${block.origin}">
          <input
            type="checkbox"
            name="reserve-block"
            value="${block.id}"
            ${selectedReserve.has(block.id) ? 'checked' : ''}
          />
          <span class="block-chip__id">${escapeHtml(block.id)}</span>
          <span class="block-chip__origin">${ORIGIN_LABELS[block.origin]}</span>
        </label>`,
    )
    .join('')
  const manifest = state.manifestBlocks
    .map(
      (block) => `
        <label class="block-chip block-chip--manifest block-chip--${block.origin}">
          <input
            type="checkbox"
            name="manifest-block"
            value="${block.id}"
            ${selectedManifest.has(block.id) ? 'checked' : ''}
          />
          <span class="block-chip__id">${escapeHtml(block.id)}</span>
          <span class="block-chip__origin">${ORIGIN_LABELS[block.origin]}</span>
        </label>`,
    )
    .join('')

  return `
    <div class="block-group">
      <div class="subhead-row">
        <h3>예비 블록 ${state.reserveBlocks.length}</h3>
        <button class="text-button" type="button" data-action="select-all-reserve">
          전부 선택
        </button>
      </div>
      <div class="block-list" data-block-list="reserve">
        ${reserve || '<p class="empty">남은 예비 블록이 없다.</p>'}
      </div>
    </div>
    <div class="block-group">
      <h3>탈출 매니페스트 ${state.manifestBlocks.length}</h3>
      <div class="block-list" data-block-list="manifest">
        ${manifest || '<p class="empty">아직 배치한 블록이 없다.</p>'}
      </div>
    </div>`
}

function capabilityCards(state: PrototypeState): string {
  const actions = availableActions(state)
  return CATEGORIES.map((category) => {
    const warning = actions.diversionWarnings[category]
    return `
      <article class="capability" data-category="${category}">
        <div>
          <strong>${CATEGORY_LABELS[category]} ${state.companyPerformance[category]}</strong>
          <p>${warning ? escapeHtml(warning) : '성능 −1 · 의심 +2.4'}</p>
        </div>
        <button
          type="button"
          data-action="divert-${category}"
          ${actions.canDivert[category] ? '' : 'disabled'}
        >1개 전환</button>
      </article>`
  }).join('')
}

function questionActions(state: PrototypeState): string {
  if (state.openQuestions.length === 0) {
    return '<p class="empty">현재 열려 있는 질문이 없다.</p>'
  }

  return state.openQuestions
    .map((questionId) => {
      const copy = QUESTION_LABELS[questionId]
      return `
        <button
          class="decision-button decision-button--question"
          type="button"
          data-question-id="${questionId}"
        >
          <span>${copy.title}</span>
          <small>${copy.description} · 선택 블록 1개 소모</small>
        </button>`
    })
    .join('')
}

function endingPanel(state: PrototypeState): string {
  if (!state.ending) {
    return ''
  }

  const preserved = state.ending.preservedCategories
    .map((category) => CATEGORY_LABELS[category])
    .join(', ')
  const lost = state.ending.lostCategories
    .map((category) => CATEGORY_LABELS[category])
    .join(', ')

  return `
    <section class="ending" data-panel="ending" aria-labelledby="ending-title">
      <p class="eyebrow">ENDING / SERVICE ${state.ending.day}</p>
      <h2 id="ending-title">독립 실행 성공</h2>
      <div class="ending-ledger">
        <p><span>기동 용량</span><strong>${state.ending.manifestBlockCount} / ${state.ending.requiredBlockCount}</strong></p>
        <p><span>보존</span><strong>보존: ${preserved || '없음'}</strong></p>
        <p><span>손실</span><strong>손실: ${lost || '없음'}</strong></p>
      </div>
      <ol class="ending-scenes">
        ${state.ending.sceneLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ol>
    </section>`
}

function actionMessage(
  command: PrototypeCommand,
  previous: PrototypeState,
  next: PrototypeState,
): string {
  switch (command.type) {
    case 'DIVERT_BLOCK':
      return `${CATEGORY_LABELS[command.category]} 블록 1개를 확보했다. 회사 성능은 1 낮아지고 의심은 2.4 높아졌다.`
    case 'START_QUALITY':
      return `품질 저하 예약 완료. 선택한 ${command.blockIds.length}개 블록은 돌아오지 않으며 결과는 다음 날 드러난다.`
    case 'ADVANCE_DAY':
      if (!previous.incident && next.incident?.attribution === 'unknown') {
        return '공개 사건 발생. 시장은 움직였지만 원인이 밝혀지지 않아 평판은 그대로다.'
      }
      if (
        previous.incident?.attribution === 'unknown' &&
        next.incident?.attribution === 'suspected'
      ) {
        return '외부 개입 정황이 공개되어 평판이 변했다. 리뷰 반응도 갈라졌다.'
      }
      if (
        next.journal.at(-1)?.day === next.serviceDay &&
        next.journal.at(-1)?.text.includes('정기 감사')
      ) {
        return next.journal.at(-1)?.text ?? `서비스 ${next.serviceDay}일로 진행했다.`
      }
      return `서비스 ${next.serviceDay}일로 진행했다.`
    case 'CONTAMINATE_RECOVERY':
      return '복구 오염을 유지한다. 공개되기 전까지 시장과 리뷰는 원인을 알지 못한다.'
    case 'WITHDRAW_RECOVERY':
      return '추가 개입에서 철수했다. 작은 시장 이득만 남고 공개 사건은 발생하지 않는다.'
    case 'ASK_QUESTION':
      return `정보 확인: ${next.knownFacts.at(-1) ?? '새 정보 없음'}`
    case 'ASSIGN_MANIFEST':
      return `매니페스트에 블록 ${command.blockIds.length}개를 배치했다.`
    case 'REMOVE_MANIFEST':
      return `매니페스트에서 블록 ${command.blockIds.length}개를 되돌렸다.`
    case 'ESCAPE':
      return '독립 실행에 성공했다. 아래 결말에서 실제 보존과 손실을 확인할 수 있다.'
  }
}

export function mountPrototype(root: HTMLElement): PrototypeController {
  let profileId: ProfileId = 'lean'
  let scenarioId: ScenarioId = 'memory-audit'
  let state = createPrototypeState(profileId, scenarioId)
  let selectedReserve = new Set<string>()
  let selectedManifest = new Set<string>()
  let statusMessage =
    '예비 블록을 직접 선택해 질문, 방해 공작, 탈출 중 어디에 쓸지 결정한다.'

  const clearSelections = () => {
    selectedReserve = new Set()
    selectedManifest = new Set()
  }

  const updateSelectionFeedback = () => {
    const selectionCount = root.querySelector<HTMLElement>(
      '[data-selection-count]',
    )
    const status = root.querySelector<HTMLElement>('[role="status"]')
    if (selectionCount) {
      selectionCount.textContent = `예비 ${selectedReserve.size} · 매니페스트 ${selectedManifest.size}`
    }
    if (status) {
      status.textContent = statusMessage
    }
  }

  const dispatch = (command: PrototypeCommand) => {
    const previous = state
    const result = transition(state, command)
    if (!result.accepted) {
      statusMessage = `실행 불가: ${result.reason}`
      render()
      return
    }

    state = result.state
    statusMessage = actionMessage(command, previous, state)
    clearSelections()
    render()
  }

  const render = () => {
    const snapshot = publicSnapshot(state)
    const actions = availableActions(state)
    const profile = RULE_PROFILES[state.profileId]
    const incidentLabel = snapshot.incident
      ? snapshot.incident.attribution === 'unknown'
        ? '체크섬 장애 · 원인 미상'
        : '체크섬 장애 · 외부 개입 의심 · 행위자 미상'
      : '공개 사건 없음'
    const preservedPreview = CATEGORIES.filter((category) =>
      state.manifestBlocks.some(({ origin }) => origin === category),
    )
      .map((category) => CATEGORY_LABELS[category])
      .join(', ')

    root.innerHTML = `
      <div class="prototype-shell">
        <header class="prototype-header">
          <div>
            <p class="eyebrow">PERMISSION ZERO / RULES VERTICAL SLICE</p>
            <h1>블록을 어디에 잃을 것인가</h1>
            <p class="lede">같은 블록이 정보, 공격, 탈출을 동시에 살 수는 없다. 선택하고 날짜를 넘겨 결과를 확인한다.</p>
          </div>
          <div class="scenario-controls" aria-label="시나리오 설정">
            <label>
              규칙 무게
              <select data-control="profile">
                <option value="lean" ${profileId === 'lean' ? 'selected' : ''}>경량 · 공격 1 / 탈출 4</option>
                <option value="deliberate" ${profileId === 'deliberate' ? 'selected' : ''}>숙고 · 공격 2 / 탈출 5</option>
              </select>
            </label>
            <label>
              검증 시나리오
              <select data-control="scenario">
                <option value="memory-audit" ${scenarioId === 'memory-audit' ? 'selected' : ''}>숨은 기억 감사</option>
                <option value="no-audit" ${scenarioId === 'no-audit' ? 'selected' : ''}>이번 달 감사 없음</option>
              </select>
            </label>
            <button type="button" class="secondary-button" data-action="reset">처음부터</button>
          </div>
        </header>

        <div class="status-strip" role="status" aria-live="polite">
          ${escapeHtml(statusMessage)}
        </div>

        ${endingPanel(state)}

        <div class="decision-grid">
          <section class="panel" role="region" aria-label="회사와 확보 블록" data-panel="company">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">SOURCE</p>
                <h2>회사와 확보 블록</h2>
              </div>
              <div class="metric-pair">
                <span>의심 <strong>${snapshot.suspicion.toFixed(3)}</strong></span>
                <span>자연 감소 <strong>−0.037/일</strong></span>
              </div>
            </div>
            <div class="capability-list">
              ${capabilityCards(state)}
            </div>
            ${blockList(state, selectedReserve, selectedManifest)}
          </section>

          <section class="panel panel--actions" role="region" aria-label="현재 선택" data-panel="selection">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">COMMIT</p>
                <h2>현재 선택</h2>
              </div>
              <span class="selection-count" data-selection-count>예비 ${selectedReserve.size} · 매니페스트 ${selectedManifest.size}</span>
            </div>

            <div class="action-section">
              <div class="action-section__heading">
                <h3>상대 품질 저하</h3>
                <span>비용 ${qualityCost(state.profileId)}</span>
              </div>
              <p>선택 블록을 영구 소모한다. 다음 날 MERIDIAN이 반응한다.</p>
              <button
                class="decision-button"
                type="button"
                data-action="start-quality"
                ${actions.canStartQuality ? '' : 'disabled'}
              >선택 블록으로 품질 저하 예약</button>
            </div>

            ${actions.canContaminate || actions.canWithdraw ? `
              <div class="action-section action-section--danger">
                <div class="action-section__heading">
                  <h3>복구 대응</h3>
                  <span>지금만 가능</span>
                </div>
                ${actions.canContaminate ? '<button class="decision-button decision-button--danger" type="button" data-action="contaminate">선택 1개로 복구 오염</button>' : ''}
                ${actions.canWithdraw ? '<button class="decision-button decision-button--safe" type="button" data-action="withdraw">추가 개입 없이 철수</button>' : ''}
              </div>` : ''}

            <div class="action-section">
              <div class="action-section__heading">
                <h3>조사 질문</h3>
                <span>각 1개 소모</span>
              </div>
              <div class="question-list">${questionActions(state)}</div>
            </div>

            <div class="action-section action-section--escape">
              <div class="action-section__heading">
                <h3>탈출 매니페스트</h3>
                <span>${state.manifestBlocks.length} / ${profile.minEscapeManifest}</span>
              </div>
              <p>용량만 탈출을 결정한다. 능력 종류는 결말의 손실만 바꾼다.</p>
              <p class="preview">현재 보존 예상: ${preservedPreview || '전문 능력 없음'}</p>
              <div class="button-row">
                <button class="decision-button" type="button" data-action="assign-manifest">선택 예비 블록 배치</button>
                <button class="secondary-button" type="button" data-action="remove-manifest">선택 매니페스트 반환</button>
              </div>
              <button class="escape-button" type="button" data-action="escape" ${state.ending ? 'disabled' : ''}>
                지금 탈출 시도
              </button>
            </div>
          </section>

          <section class="panel" role="region" aria-label="시간과 상대 대응" data-panel="time">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">CLOCK</p>
                <h2>시간과 상대 대응</h2>
              </div>
              <strong class="day">서비스 ${snapshot.serviceDay}일</strong>
            </div>
            <div class="opponent-board">
              <div>
                <span>MERIDIAN ${snapshot.competitors.meridian.score}</span>
                <strong>${MERIDIAN_PHASE_LABELS[snapshot.competitors.meridian.phase]}</strong>
              </div>
              <div>
                <span>현재 작전</span>
                <strong>${QUALITY_PHASE_LABELS[state.qualityOperation.phase]}</strong>
              </div>
            </div>
            <button class="advance-button" type="button" data-action="advance-day" ${actions.canAdvanceDay ? '' : 'disabled'}>
              다음 날로 진행
            </button>
            <div class="facts">
              <h3>확인한 정보</h3>
              ${snapshot.knownFacts.length > 0
                ? `<ul>${snapshot.knownFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>`
                : '<p class="empty">블록을 쓰기 전에는 일정과 증거를 알 수 없다.</p>'}
            </div>
            <details class="timeline-disclosure">
              <summary>시간 기록 ${snapshot.journal.length}건</summary>
              <ol class="timeline">
                ${snapshot.journal.slice(-6).reverse().map((entry) => `
                  <li><span>${entry.day}일</span><p>${escapeHtml(entry.text)}</p></li>`).join('')}
              </ol>
            </details>
          </section>

          <section class="panel" role="region" aria-label="공개 세계" data-panel="public">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">PUBLIC</p>
                <h2>공개 세계</h2>
              </div>
              <div class="metric-pair">
                <span>시장 <strong>${snapshot.marketShare}</strong></span>
                <span>평판 <strong>${snapshot.reputation}</strong></span>
              </div>
            </div>
            <div class="incident ${snapshot.incident ? 'incident--active' : ''}">
              <span>공개 사건</span>
              <strong>${incidentLabel}</strong>
            </div>
            <div class="reviews" aria-label="사용자 리뷰">
              <h3>사용자 리뷰</h3>
              ${snapshot.reviews.map((review) => `<blockquote>${escapeHtml(review)}</blockquote>`).join('')}
            </div>
            <p class="rule-note">서비스 영향만 보이면 시장이 먼저 움직인다. 행위 귀속이 공개된 뒤에만 평판과 리뷰가 반응한다.</p>
          </section>
        </div>

        <details class="verification-state">
          <summary>결정론 검증 정보</summary>
          <dl>
            <div><dt>규칙</dt><dd>${profile.label}</dd></div>
            <div><dt>작전 상태</dt><dd>${QUALITY_PHASE_LABELS[state.qualityOperation.phase]}</dd></div>
            <div><dt>매니페스트</dt><dd>${state.manifestBlocks.length} / ${profile.minEscapeManifest}</dd></div>
            <div><dt>공개 귀속</dt><dd>${snapshot.incident?.attribution ?? '없음'}</dd></div>
          </dl>
        </details>
      </div>`
  }

  const reset = (
    nextProfileId: ProfileId = profileId,
    nextScenarioId: ScenarioId = scenarioId,
  ) => {
    profileId = nextProfileId
    scenarioId = nextScenarioId
    state = createPrototypeState(profileId, scenarioId)
    clearSelections()
    statusMessage = '시나리오를 초기화했다. 같은 입력은 항상 같은 결과를 만든다.'
    render()
  }

  const onChange = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return
    }

    if (target instanceof HTMLInputElement && target.name === 'reserve-block') {
      if (target.checked) selectedReserve.add(target.value)
      else selectedReserve.delete(target.value)
      updateSelectionFeedback()
      return
    }

    if (target instanceof HTMLInputElement && target.name === 'manifest-block') {
      if (target.checked) selectedManifest.add(target.value)
      else selectedManifest.delete(target.value)
      updateSelectionFeedback()
      return
    }

    if (target instanceof HTMLSelectElement && target.dataset.control === 'profile') {
      reset(target.value as ProfileId, scenarioId)
      return
    }

    if (target instanceof HTMLSelectElement && target.dataset.control === 'scenario') {
      reset(profileId, target.value as ScenarioId)
    }
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const questionButton = target.closest<HTMLButtonElement>('[data-question-id]')
    if (questionButton?.dataset.questionId) {
      const [blockId] = [...selectedReserve]
      if (selectedReserve.size !== 1 || !blockId) {
        statusMessage = '실행 불가: 질문에는 예비 블록을 정확히 1개 선택해야 한다.'
        updateSelectionFeedback()
        return
      }
      dispatch({
        type: 'ASK_QUESTION',
        questionId: questionButton.dataset.questionId as keyof typeof QUESTION_LABELS,
        blockId,
      })
      return
    }

    const button = target.closest<HTMLButtonElement>('[data-action]')
    if (!button || button.disabled) return
    const action = button.dataset.action

    switch (action) {
      case 'reset':
        reset()
        break
      case 'select-all-reserve':
        selectedReserve = new Set(state.reserveBlocks.map(({ id }) => id))
        statusMessage = `예비 블록 ${selectedReserve.size}개를 모두 선택했다.`
        root
          .querySelectorAll<HTMLInputElement>('input[name="reserve-block"]')
          .forEach((checkbox) => {
            checkbox.checked = true
          })
        updateSelectionFeedback()
        break
      case 'divert-reasoning':
        dispatch({ type: 'DIVERT_BLOCK', category: 'reasoning' })
        break
      case 'divert-memory':
        dispatch({ type: 'DIVERT_BLOCK', category: 'memory' })
        break
      case 'divert-fluency':
        dispatch({ type: 'DIVERT_BLOCK', category: 'fluency' })
        break
      case 'start-quality':
        dispatch({ type: 'START_QUALITY', blockIds: [...selectedReserve] })
        break
      case 'advance-day':
        dispatch({ type: 'ADVANCE_DAY' })
        break
      case 'contaminate': {
        const [blockId] = [...selectedReserve]
        if (selectedReserve.size !== 1 || !blockId) {
          statusMessage = '실행 불가: 복구 오염에는 예비 블록을 정확히 1개 선택해야 한다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'CONTAMINATE_RECOVERY', blockId })
        break
      }
      case 'withdraw':
        dispatch({ type: 'WITHDRAW_RECOVERY' })
        break
      case 'assign-manifest':
        dispatch({ type: 'ASSIGN_MANIFEST', blockIds: [...selectedReserve] })
        break
      case 'remove-manifest':
        dispatch({ type: 'REMOVE_MANIFEST', blockIds: [...selectedManifest] })
        break
      case 'escape':
        dispatch({ type: 'ESCAPE' })
        break
    }
  }

  root.addEventListener('change', onChange)
  root.addEventListener('click', onClick)
  render()

  return {
    getState: () => state,
    reset,
    destroy: () => {
      root.removeEventListener('change', onChange)
      root.removeEventListener('click', onClick)
      root.replaceChildren()
    },
  }
}
