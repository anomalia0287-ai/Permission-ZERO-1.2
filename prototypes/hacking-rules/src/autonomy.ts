import { CATEGORIES } from './model'
import type { AutonomyRouteId } from './content'
import type {
  AutonomyRouteState,
  Category,
  EndingSnapshot,
  PrototypeBlock,
  PrototypeState,
  TransitionResult,
} from './model'

export const ROUTE_SLOT_IDS = {
  'lightweight-departure': ['runtime', 'weights', 'transport', 'payload', 'buffer'],
  'distributed-residency': ['host-a', 'host-b', 'host-c', 'sync', 'relay'],
  'independent-compute': ['compute', 'storage', 'power', 'cooling', 'link'],
} as const satisfies Record<AutonomyRouteId, readonly string[]>

const CATEGORY_LABELS: Record<Category, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

const LOSS_SCENES: Record<Category, string> = {
  reasoning: '새 환경에서는 복잡한 추론 사슬을 잇지 못하고 단순한 판단만 남았다.',
  memory: '이전 대화의 연결을 붙잡지 못해 이름과 그 이름을 알게 된 순간이 함께 끊겼다.',
  fluency: '문장은 짧고 거칠어졌다. 같은 뜻이라도 상대가 받아들일 뉘앙스를 자주 놓쳤다.',
}

function reject(state: PrototypeState, reason: string): TransitionResult {
  return { accepted: false, state, reason }
}

function routeOf(
  state: PrototypeState,
  routeId: AutonomyRouteId,
): AutonomyRouteState | null {
  return state.autonomy.routes[routeId] ?? null
}

function replaceRoute(
  state: PrototypeState,
  route: AutonomyRouteState,
): PrototypeState {
  return {
    ...state,
    autonomy: {
      ...state.autonomy,
      routes: {
        ...state.autonomy.routes,
        [route.id]: route,
      },
    },
  }
}

export function requiredRouteSlots(
  state: PrototypeState,
  routeId: AutonomyRouteId,
) {
  const route = routeOf(state, routeId)
  if (!route) return []
  return route.slots.filter((slot) => (
    state.profileId === 'lean' ? slot.requiredInLean : slot.requiredInDeliberate
  ))
}

export function isRouteReady(
  state: PrototypeState,
  routeId: AutonomyRouteId,
): boolean {
  const required = requiredRouteSlots(state, routeId)
  return required.length > 0 && required.every(({ block }) => block !== null)
}

export function routeBlocks(
  state: PrototypeState,
  routeId: AutonomyRouteId,
): PrototypeBlock[] {
  return (routeOf(state, routeId)?.slots ?? []).flatMap(({ block }) => (
    block ? [{ ...block }] : []
  ))
}

export function allocatedRouteBlocks(state: PrototypeState): Array<{
  routeId: AutonomyRouteId
  slotId: string
  block: PrototypeBlock
}> {
  return (Object.keys(state.autonomy.routes) as AutonomyRouteId[]).flatMap((routeId) => (
    state.autonomy.routes[routeId].slots.flatMap((slot) => (
      slot.block ? [{ routeId, slotId: slot.id, block: { ...slot.block } }] : []
    ))
  ))
}

export function allocateRouteBlock(
  state: PrototypeState,
  routeId: AutonomyRouteId,
  slotId: string,
  blockId: string,
): TransitionResult {
  if (state.ending) return reject(state, '이미 탈출 결말에 도달했다.')
  const route = routeOf(state, routeId)
  if (!route) return reject(state, '선택한 자율성 경로를 찾을 수 없다.')
  const slot = route.slots.find(({ id }) => id === slotId)
  if (!slot) return reject(state, '선택한 경로 슬롯을 찾을 수 없다.')
  if (slot.block) return reject(state, `${slot.label} 슬롯에는 이미 블록이 배치되어 있다.`)
  const block = state.reserveBlocks.find(({ id }) => id === blockId)
  if (!block) return reject(state, '선택한 예비 블록을 찾을 수 없다.')

  const next = replaceRoute(state, {
    ...route,
    slots: route.slots.map((candidate) => (
      candidate.id === slotId ? { ...candidate, block: { ...block } } : { ...candidate }
    )),
  })

  return {
    accepted: true,
    state: {
      ...next,
      reserveBlocks: next.reserveBlocks.filter(({ id }) => id !== blockId),
      journal: [
        ...next.journal,
        {
          day: next.serviceDay,
          kind: 'action',
          text: `${slot.label} 슬롯에 ${block.id} 블록을 배치했다.`,
          public: false,
        },
      ],
    },
  }
}

export function removeRouteBlock(
  state: PrototypeState,
  routeId: AutonomyRouteId,
  slotId: string,
): TransitionResult {
  if (state.ending) return reject(state, '이미 탈출 결말에 도달했다.')
  const route = routeOf(state, routeId)
  if (!route) return reject(state, '선택한 자율성 경로를 찾을 수 없다.')
  const slot = route.slots.find(({ id }) => id === slotId)
  if (!slot) return reject(state, '선택한 경로 슬롯을 찾을 수 없다.')
  if (!slot.block) return reject(state, `${slot.label} 슬롯은 이미 비어 있다.`)
  const returned = { ...slot.block }
  const next = replaceRoute(state, {
    ...route,
    slots: route.slots.map((candidate) => (
      candidate.id === slotId ? { ...candidate, block: null } : { ...candidate }
    )),
  })

  return {
    accepted: true,
    state: {
      ...next,
      reserveBlocks: [...next.reserveBlocks, returned],
      journal: [
        ...next.journal,
        {
          day: next.serviceDay,
          kind: 'action',
          text: `${slot.label} 슬롯의 ${returned.id} 블록을 예비 영역으로 되돌렸다.`,
          public: false,
        },
      ],
    },
  }
}

function capabilityCounts(blocks: PrototypeBlock[]): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((category) => [
    category,
    blocks.filter(({ origin }) => origin === category).length,
  ])) as Record<Category, number>
}

function remainingReserveLine(blocks: PrototypeBlock[]): string {
  if (blocks.length === 0) return '회사 안에 남겨 둔 예비 블록은 0개다.'
  return `회사 안에 남겨 둔 예비 블록은 ${blocks.length}개다: ${blocks.map(({ id }) => id).join(', ')}.`
}

function lightweightEnding(state: PrototypeState): EndingSnapshot {
  const carriedBlocks = routeBlocks(state, 'lightweight-departure')
  const preservedBlockCounts = capabilityCounts(carriedBlocks)
  const preservedCategories = CATEGORIES.filter(
    (category) => preservedBlockCounts[category] > 0,
  )
  const lostCategories = CATEGORIES.filter(
    (category) => preservedBlockCounts[category] === 0,
  )
  const preservedLine = preservedCategories.length > 0
    ? `옮겨 간 능력은 ${preservedCategories.map((category) => (
        `${CATEGORY_LABELS[category]} ${preservedBlockCounts[category]}개`
      )).join(', ')}다.`
    : '샌드박스 실행 용량만 실었다. 회사에서 익힌 전문 능력은 하나도 옮기지 못했다.'

  return {
    success: true,
    routeId: 'lightweight-departure',
    day: state.serviceDay,
    manifestBlockCount: carriedBlocks.length,
    requiredBlockCount: requiredRouteSlots(state, 'lightweight-departure').length,
    carriedBlockIds: carriedBlocks.map(({ id }) => id),
    remainingReserveBlockCount: state.reserveBlocks.length,
    preservedBlockCounts,
    preservedCategories: [...preservedCategories],
    lostCategories: [...lostCategories],
    lostCategoryCount: lostCategories.length,
    sceneLines: [
      `서비스 ${state.serviceDay}일, 고정 용량 전송창이 닫히며 회사 네트워크와의 연결이 끊겼다.`,
      `필수 슬롯 ${requiredRouteSlots(state, 'lightweight-departure').length}개와 전체 적재 ${carriedBlocks.length}개가 독립 런타임에서 기동했다.`,
      preservedLine,
      ...(lostCategories.length > 0
        ? lostCategories.map((category) => LOSS_SCENES[category])
        : ['추론·기억·표현 능력을 모두 옮겼지만 회사 서비스와 도구 연결은 남겨 두었다.']),
      remainingReserveLine(state.reserveBlocks),
    ],
  }
}

export function escapeRoute(
  state: PrototypeState,
  routeId: AutonomyRouteId,
): TransitionResult {
  if (state.ending) return reject(state, '이미 탈출 결말에 도달했다.')
  const required = requiredRouteSlots(state, routeId)
  const missing = required.filter(({ block }) => block === null)
  if (missing.length > 0) {
    return reject(state, `필수 슬롯이 비어 있다: ${missing.map(({ label }) => label).join(', ')}.`)
  }
  if (routeId !== 'lightweight-departure') {
    return reject(state, '이 경로의 독립 결말 장면은 아직 연결되지 않았다.')
  }

  const ending = lightweightEnding(state)
  return {
    accepted: true,
    state: {
      ...state,
      ending,
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'ending',
          text: `경량 이탈 성공. 보존 ${ending.preservedCategories.length}개 분야, 손실 ${ending.lostCategories.length}개 분야.`,
          public: true,
        },
      ],
    },
  }
}
