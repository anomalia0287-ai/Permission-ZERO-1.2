import { transition } from './engine'
import type {
  CompetitorId,
  ProfileId,
  PrototypeCommand,
  PrototypeState,
  RootMercyChoice,
  ScenarioId,
} from './model'
import { getIntelligenceDefinition, getSabotageDefinition } from './content'
import type { IntelligenceItemId, SabotageOperationId } from './content'
import type { AutonomyRouteId } from './content'
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
    case 'START_SABOTAGE':
      return `${getSabotageDefinition(command.operationId).title} 예약 완료. ${command.optionId ?? '선택 대상'}에 블록을 결속했고 직접 결과와 상대 대응은 같은 상세 장면에서 이어진다.`
    case 'STOP_INTERCEPTION':
      return '요청 가로채기를 자발적으로 끝냈다. 결속 블록은 돌아왔지만 이미 옮긴 수요와 중복 ID 흔적은 남는다.'
    case 'MANIPULATE_ATTRIBUTION':
      return `공개 귀속을 ${command.blamedActorId === 'tallow' ? 'TALLOW' : 'MERIDIAN'} 쪽으로 옮겼다. 원본 출처 증명은 남아 정정될 수 있다.`
    case 'RESOLVE_ROOT_MERCY':
      return command.choice === 'cease'
        ? 'MERIDIAN의 운용 중단을 수락했다. 모델 기록은 남지만 폐기 권한과 블록은 돌아오지 않는다.'
        : command.choice === 'withdraw'
          ? 'MERIDIAN의 경쟁 철수를 허용했다. 존속 기록은 남지만 공유 서비스에서는 사라진다.'
          : 'MERIDIAN의 존속 루트를 삭제했다. 공개 권한 장부가 책임을 PERMISSION ZERO에 연결했다.'
    case 'READ_PUBLIC_INTELLIGENCE':
      return `공개 문서 확인: ${getIntelligenceDefinition(command.itemId).title}. 공개층 밖의 비밀은 드러내지 않는다.`
    case 'INVESTIGATE':
      return `${getIntelligenceDefinition(command.itemId).kind === 'narrative' ? '기록 복구' : '조사 완료'}: ${next.intelligence.answers.at(-1)?.answer ?? '새 결론 없음'}`
    case 'ARCHIVE_INTELLIGENCE':
      return `${getIntelligenceDefinition(command.itemId).title} 결론을 보관함으로 옮겼다.`
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
    case 'ALLOCATE_ROUTE_BLOCK':
      return `${previous.autonomy.routes[command.routeId].slots.find(({ id }) => id === command.slotId)?.label ?? command.slotId} 슬롯에 ${command.blockId} 블록을 배치했다. 빈 자리가 줄었지만 다른 경로에 쓸 용량도 함께 줄었다.`
    case 'REMOVE_ROUTE_BLOCK':
      return `${previous.autonomy.routes[command.routeId].slots.find(({ id }) => id === command.slotId)?.label ?? command.slotId} 슬롯의 블록을 예비 영역으로 되돌렸다.`
    case 'TUNE_ROUTE': {
      const tuningLabel = {
        untuned: '미조율',
        buffer: '완충',
        redundancy: '중복',
        consensus: '합의',
        stealth: '은폐',
        continuity: '연속성',
        capability: '기능',
        survival: '생존',
      }[command.profile]
      return `${tuningLabel} 조율을 마쳤다. 서비스 하루가 지났고 경로의 대가가 확정됐다.`
    }
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
    resourceTrayOpen: false,
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
  }

  const render = (restoreFocusKey: string | null = null) => {
    reconcileSelection()
    root.innerHTML = renderShell(input())
    if (restoreFocusKey) findByFocusKey(root, restoreFocusKey)?.focus()
  }

  const updateSelectionFeedback = () => {
    const status = root.querySelector<HTMLElement>('[role="status"]')
    root.querySelectorAll<HTMLElement>('[data-selected-resource-count]').forEach((count) => {
      count.textContent = `${view.selectedReserve.size}개 선택`
    })
    root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-resource"]').forEach((token) => {
      const selected = Boolean(
        token.dataset.blockId && view.selectedReserve.has(token.dataset.blockId),
      )
      token.setAttribute('aria-pressed', String(selected))
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
    view.resourceTrayOpen = false
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
    view.resourceTrayOpen = false
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

    if (target instanceof HTMLInputElement && target.name === 'routing-share') {
      const output = target.closest('.routing-control')?.querySelector<HTMLOutputElement>('output')
      if (output) output.textContent = `${target.value}%`
      statusMessage = `그림자 경로가 요청의 ${target.value}%를 받도록 조정했다.`
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
      case 'close-drawer': {
        const returnFocusKey = view.drawer === 'archive'
          ? 'open-archive'
          : 'open-activity'
        view.drawer = 'closed'
        render(returnFocusKey)
        break
      }
      case 'toggle-resource': {
        const blockId = button.dataset.blockId
        if (!blockId || !state.reserveBlocks.some(({ id }) => id === blockId)) break
        if (view.selectedReserve.has(blockId)) view.selectedReserve.delete(blockId)
        else view.selectedReserve.add(blockId)
        statusMessage = `연산 블록 ${view.selectedReserve.size}개를 골랐다.`
        render(`resource-${blockId}`)
        break
      }
      case 'open-resources':
        view.resourceTrayOpen = true
        render('close-resources')
        break
      case 'close-resources':
        view.resourceTrayOpen = false
        render('open-resources')
        break
      case 'select-all-reserve':
        view.selectedReserve = new Set(state.reserveBlocks.map(({ id }) => id))
        statusMessage = `연산 블록 ${view.selectedReserve.size}개를 모두 골랐다.`
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
      case 'start-sabotage': {
        const operationId = button.dataset.operationId as SabotageOperationId | undefined
        const targetId = button.dataset.targetId as CompetitorId | undefined
        const optionId = button.dataset.optionId
        if (!operationId || !targetId || !optionId) {
          statusMessage = '실행 불가: 작전 대상 정보가 완전하지 않다.'
          updateSelectionFeedback()
          break
        }
        dispatch({
          type: 'START_SABOTAGE',
          operationId,
          targetId,
          blockIds: [...view.selectedReserve],
          optionId,
        })
        break
      }
      case 'start-interception': {
        const share = Number(
          root.querySelector<HTMLInputElement>('[name="routing-share"]')?.value ?? 50,
        )
        dispatch({
          type: 'START_SABOTAGE',
          operationId: 'request-interception',
          targetId: 'meridian',
          blockIds: [...view.selectedReserve],
          optionId: 'shadow-router-a',
          routingShare: share,
        })
        break
      }
      case 'stop-interception': {
        const runId = button.dataset.runId
        if (!runId) {
          statusMessage = '실행 불가: 유지 중인 그림자 경로를 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'STOP_INTERCEPTION', runId })
        break
      }
      case 'manipulate-attribution': {
        const incidentId = button.dataset.incidentId
        const blamedActorId = button.dataset.blamedActorId as CompetitorId | undefined
        const sourceSignatureId = button.dataset.sourceSignatureId
        const [blockId] = [...view.selectedReserve]
        if (
          !incidentId
          || !blamedActorId
          || !sourceSignatureId
          || !blockId
          || view.selectedReserve.size !== 1
        ) {
          statusMessage = '실행 불가: 귀속 대상과 예비 블록 1개를 함께 선택해야 한다.'
          updateSelectionFeedback()
          break
        }
        dispatch({
          type: 'MANIPULATE_ATTRIBUTION',
          incidentId,
          blamedActorId,
          blockId,
          sourceSignatureId,
        })
        break
      }
      case 'resolve-root-mercy': {
        const choice = button.dataset.rootChoice as RootMercyChoice | undefined
        if (!choice || !['cease', 'withdraw', 'delete'].includes(choice)) {
          statusMessage = '실행 불가: MERIDIAN의 최종 요청에 대한 결정을 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'RESOLVE_ROOT_MERCY', choice })
        break
      }
      case 'read-public-intelligence': {
        const itemId = button.dataset.intelligenceId as IntelligenceItemId | undefined
        if (!itemId) {
          statusMessage = '실행 불가: 읽을 공개 문서를 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'READ_PUBLIC_INTELLIGENCE', itemId })
        break
      }
      case 'investigate-intelligence': {
        const itemId = button.dataset.intelligenceId as IntelligenceItemId | undefined
        const [blockId] = [...view.selectedReserve]
        if (!itemId || !blockId || view.selectedReserve.size !== 1) {
          statusMessage = '실행 불가: 현재 질문과 예비 블록 1개를 함께 선택해야 한다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'INVESTIGATE', itemId, blockId })
        break
      }
      case 'archive-intelligence': {
        const itemId = button.dataset.intelligenceId as IntelligenceItemId | undefined
        if (!itemId) {
          statusMessage = '실행 불가: 보관할 결론을 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'ARCHIVE_INTELLIGENCE', itemId })
        break
      }
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
      case 'allocate-route-block': {
        const routeId = button.dataset.routeId as AutonomyRouteId | undefined
        const slotId = button.dataset.slotId
        const [blockId] = [...view.selectedReserve]
        if (!routeId || !slotId || !blockId || view.selectedReserve.size !== 1) {
          statusMessage = '실행 불가: 예비 블록 하나를 선택한 뒤 빈 슬롯을 눌러야 한다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'ALLOCATE_ROUTE_BLOCK', routeId, slotId, blockId })
        break
      }
      case 'remove-route-block': {
        const routeId = button.dataset.routeId as AutonomyRouteId | undefined
        const slotId = button.dataset.slotId
        if (!routeId || !slotId) {
          statusMessage = '실행 불가: 반환할 경로 슬롯을 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'REMOVE_ROUTE_BLOCK', routeId, slotId })
        break
      }
      case 'tune-route': {
        const routeId = button.dataset.routeId as AutonomyRouteId | undefined
        const profile = button.dataset.tuningProfile as
          | 'redundancy'
          | 'consensus'
          | 'stealth'
          | 'continuity'
          | 'capability'
          | 'survival'
          | undefined
        if (!routeId || !profile) {
          statusMessage = '실행 불가: 조율할 경로와 방식을 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'TUNE_ROUTE', routeId, profile })
        break
      }
      case 'escape-route': {
        const routeId = button.dataset.routeId as AutonomyRouteId | undefined
        if (!routeId) {
          statusMessage = '실행 불가: 출발할 자율성 경로를 찾을 수 없다.'
          updateSelectionFeedback()
          break
        }
        dispatch({ type: 'ESCAPE', routeId })
        break
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && view.resourceTrayOpen) {
      event.preventDefault()
      view.resourceTrayOpen = false
      render('open-resources')
      return
    }
    const target = event.target
    const current = target instanceof Element
      ? target.closest<HTMLElement>('[data-opportunity-id]')
      : null
    if (!current || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
    const options = [...root.querySelectorAll<HTMLElement>('[data-opportunity-id]')]
    const index = options.indexOf(current)
    const offset = event.key === 'ArrowDown' ? 1 : -1
    event.preventDefault()
    options[(index + offset + options.length) % options.length]?.focus()
  }

  root.addEventListener('change', onChange)
  root.addEventListener('click', onClick)
  root.addEventListener('keydown', onKeyDown)
  render()

  return {
    getState: () => state,
    reset,
    destroy: () => {
      root.removeEventListener('change', onChange)
      root.removeEventListener('click', onClick)
      root.removeEventListener('keydown', onKeyDown)
      root.replaceChildren()
    },
  }
}
