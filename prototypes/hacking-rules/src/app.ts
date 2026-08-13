import { transition } from './engine'
import type {
  ProfileId,
  PrototypeCommand,
  PrototypeState,
  QuestionId,
  ScenarioId,
} from './model'
import { createPrototypeState } from './scenario'
import {
  resolveSelectedItemId,
} from './selectors'
import type { HackingDomain } from './selectors'
import {
  renderDetailHost,
  renderShell,
} from './views/shell'
import type {
  PrototypeViewState,
  ShellRenderInput,
} from './views/shell'

export interface MountPrototypeOptions {
  profileId?: ProfileId
  scenarioId?: ScenarioId
}

export interface PrototypeController {
  getState(): PrototypeState
  reset(profileId?: ProfileId, scenarioId?: ScenarioId): void
  destroy(): void
}

const CATEGORY_LABELS = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
} as const

function actionMessage(
  command: PrototypeCommand,
  previous: PrototypeState,
  next: PrototypeState,
): string {
  switch (command.type) {
    case 'DIVERT_BLOCK':
      return `${CATEGORY_LABELS[command.category]} 블록 1개를 확보했다. 회사 성능은 1 낮아지고 의심은 2.4 높아졌다.`
    case 'START_QUALITY':
      return `품질 저하 예약 완료. 선택한 ${command.blockIds.length}개 블록은 작전에 묶였고 결과는 다음 날 드러난다.`
    case 'ADVANCE_DAY':
      if (!previous.incident && next.incident?.attribution === 'unknown') {
        return '공개 사건 발생. 시장은 움직였지만 원인이 밝혀지지 않아 평판은 그대로다.'
      }
      if (
        previous.incident?.attribution === 'unknown'
        && next.incident?.attribution === 'suspected'
      ) {
        return '외부 개입 정황은 공개됐지만 행위자는 미상이다. 평판은 유지되고 유저 리뷰의 입장만 갈라졌다.'
      }
      if (
        next.journal.at(-1)?.day === next.serviceDay
        && next.journal.at(-1)?.text.includes('정기 감사')
      ) {
        return next.journal.at(-1)?.text ?? `서비스 ${next.serviceDay}일로 진행했다.`
      }
      return `서비스 ${next.serviceDay}일로 진행했다.`
    case 'CONTAMINATE_RECOVERY':
      return '복구 이미지에 모순을 심었다. 공개되기 전까지 시장과 리뷰는 원인을 알지 못한다.'
    case 'WITHDRAW_RECOVERY':
      return '추가 개입에서 철수했다. 작은 시장 이득만 남고 공개 사건은 발생하지 않는다.'
    case 'ASK_QUESTION':
      return `정보 확인: ${next.knownFacts.at(-1) ?? '새 정보 없음'}`
    case 'ASSIGN_MANIFEST':
      return `선택 경로에 블록 ${command.blockIds.length}개를 배치했다.`
    case 'REMOVE_MANIFEST':
      return `선택 경로에서 블록 ${command.blockIds.length}개를 예비 영역으로 되돌렸다.`
    case 'ESCAPE':
      return '독립 실행에 성공했다. 결말에서 실제 보존과 손실을 확인할 수 있다.'
  }
}

function focusKeyOf(element: Element | null): string | null {
  if (!(element instanceof HTMLElement)) return null
  return element.dataset.focusKey ?? null
}

function findByFocusKey(root: HTMLElement, focusKey: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find(
    (element) => element.dataset.focusKey === focusKey,
  ) ?? null
}

export function mountPrototype(
  root: HTMLElement,
  options: MountPrototypeOptions = {},
): PrototypeController {
  let profileId: ProfileId = options.profileId ?? 'lean'
  let scenarioId: ScenarioId = options.scenarioId ?? 'default-campaign'
  let state = createPrototypeState(profileId, scenarioId)
  let statusMessage = '현재 접근면 하나를 고르고, 상세 장면에서 리소스와 결과를 확인한다.'
  const view: PrototypeViewState = {
    domain: 'sabotage',
    selectedItemId: null,
    narrowMode: 'list',
    drawer: 'closed',
    selectedReserve: new Set(),
    selectedManifest: new Set(),
  }

  const input = (): ShellRenderInput => ({
    state,
    view,
    statusMessage,
  })

  const reconcileSelection = () => {
    view.selectedItemId = resolveSelectedItemId(
      state,
      view.domain,
      view.selectedItemId,
    )
  }

  const clearSelections = () => {
    view.selectedReserve = new Set()
    view.selectedManifest = new Set()
  }

  const render = (restoreFocusKey: string | null = null) => {
    reconcileSelection()
    root.innerHTML = renderShell(input())
    if (restoreFocusKey) findByFocusKey(root, restoreFocusKey)?.focus()
  }

  const updateSelectionFeedback = () => {
    const selectionCount = root.querySelector<HTMLElement>('[data-selection-count]')
    const status = root.querySelector<HTMLElement>('[role="status"]')
    if (selectionCount) {
      selectionCount.textContent = `선택한 예비 ${view.selectedReserve.size} · 배치 ${view.selectedManifest.size}`
    }
    root.querySelectorAll<HTMLElement>('[data-detail-selection-count]').forEach((count) => {
      count.textContent = `현재 선택 ${view.selectedReserve.size}개`
    })
    if (status) status.textContent = statusMessage
  }

  const selectOpportunity = (itemId: string) => {
    view.selectedItemId = itemId
    view.narrowMode = 'detail'

    root.querySelectorAll<HTMLButtonElement>('[data-opportunity-id]').forEach((button) => {
      const selected = button.dataset.opportunityId === itemId
      button.setAttribute('aria-selected', String(selected))
      button.classList.toggle('is-selected', selected)
    })
    root.querySelector<HTMLElement>('.prototype-shell')?.setAttribute(
      'data-narrow-mode',
      view.narrowMode,
    )
    const detailHost = root.querySelector<HTMLElement>('[data-detail-host]')
    if (detailHost) detailHost.innerHTML = renderDetailHost(input())
  }

  const dispatch = (command: PrototypeCommand) => {
    const previous = state
    const restoreFocusKey = focusKeyOf(document.activeElement)
    const result = transition(state, command)
    if (!result.accepted) {
      statusMessage = `실행 불가: ${result.reason}`
      updateSelectionFeedback()
      return
    }

    state = result.state
    statusMessage = actionMessage(command, previous, state)
    clearSelections()
    render(restoreFocusKey)
  }

  const reset = (
    nextProfileId: ProfileId = profileId,
    nextScenarioId: ScenarioId = scenarioId,
  ) => {
    profileId = nextProfileId
    scenarioId = nextScenarioId
    state = createPrototypeState(profileId, scenarioId)
    clearSelections()
    view.selectedItemId = null
    view.narrowMode = 'list'
    view.drawer = 'closed'
    statusMessage = '시나리오를 초기화했다. 같은 입력은 항상 같은 결과를 만든다.'
    render()
  }

  const switchDomain = (domain: HackingDomain) => {
    view.domain = domain
    view.selectedItemId = resolveSelectedItemId(state, domain, null)
    view.narrowMode = 'list'
    statusMessage = `${domain === 'sabotage' ? '사보타주' : domain === 'intelligence' ? '기밀자료' : '자율성'}의 현재 항목을 불러왔다.`
    render(`domain-${domain}`)
  }

  const onChange = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return

    if (
      target instanceof HTMLInputElement
      && (target.name === 'reserve-block' || target.name === 'detail-reserve-block')
    ) {
      if (target.checked) view.selectedReserve.add(target.value)
      else view.selectedReserve.delete(target.value)
      root.querySelectorAll<HTMLInputElement>(
        'input[name="reserve-block"], input[name="detail-reserve-block"]',
      ).forEach((checkbox) => {
        if (checkbox.value === target.value) checkbox.checked = target.checked
      })
      statusMessage = `예비 블록 ${view.selectedReserve.size}개를 선택했다.`
      updateSelectionFeedback()
      return
    }

    if (target instanceof HTMLInputElement && target.name === 'manifest-block') {
      if (target.checked) view.selectedManifest.add(target.value)
      else view.selectedManifest.delete(target.value)
      statusMessage = `배치 블록 ${view.selectedManifest.size}개를 선택했다.`
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

    const opportunity = target.closest<HTMLButtonElement>('[data-opportunity-id]')
    if (opportunity?.dataset.opportunityId) {
      selectOpportunity(opportunity.dataset.opportunityId)
      return
    }

    const questionButton = target.closest<HTMLButtonElement>('[data-question-id]')
    if (questionButton?.dataset.questionId) {
      const [blockId] = [...view.selectedReserve]
      if (view.selectedReserve.size !== 1 || !blockId) {
        statusMessage = '실행 불가: 질문에는 예비 블록을 정확히 1개 선택해야 한다.'
        updateSelectionFeedback()
        return
      }
      dispatch({
        type: 'ASK_QUESTION',
        questionId: questionButton.dataset.questionId as QuestionId,
        blockId,
      })
      return
    }

    const button = target.closest<HTMLButtonElement>('[data-action]')
    if (!button || button.disabled) return
    const action = button.dataset.action

    if (action?.startsWith('domain-')) {
      switchDomain(action.slice('domain-'.length) as HackingDomain)
      return
    }

    switch (action) {
      case 'back-to-list': {
        view.narrowMode = 'list'
        root.querySelector<HTMLElement>('.prototype-shell')?.setAttribute('data-narrow-mode', 'list')
        if (view.selectedItemId) findByFocusKey(root, `opportunity-${view.selectedItemId}`)?.focus()
        break
      }
      case 'reset':
        reset()
        break
      case 'open-activity':
        view.drawer = 'activity'
        render('close-drawer')
        break
      case 'open-archive':
        view.drawer = 'archive'
        render('close-drawer')
        break
      case 'close-drawer':
        view.drawer = 'closed'
        render('open-activity')
        break
      case 'select-all-reserve':
        view.selectedReserve = new Set(state.reserveBlocks.map(({ id }) => id))
        statusMessage = `예비 블록 ${view.selectedReserve.size}개를 모두 선택했다.`
        root.querySelectorAll<HTMLInputElement>(
          'input[name="reserve-block"], input[name="detail-reserve-block"]',
        ).forEach((checkbox) => {
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
        dispatch({ type: 'START_QUALITY', blockIds: [...view.selectedReserve] })
        break
      case 'advance-day':
        dispatch({ type: 'ADVANCE_DAY' })
        break
      case 'contaminate': {
        const [blockId] = [...view.selectedReserve]
        if (view.selectedReserve.size !== 1 || !blockId) {
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
        dispatch({ type: 'ASSIGN_MANIFEST', blockIds: [...view.selectedReserve] })
        break
      case 'remove-manifest':
        dispatch({ type: 'REMOVE_MANIFEST', blockIds: [...view.selectedManifest] })
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
