import { CATEGORIES } from './model'
import type { AutonomyRouteId } from './content'
import type {
  AutonomyRouteState,
  Category,
  EndingSnapshot,
  PrototypeBlock,
  PrototypeState,
  RouteTuning,
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

function distributedSeededCopies(route: AutonomyRouteState): number {
  const hostCount = route.slots.filter(({ id, block }) => (
    id.startsWith('host-') && block !== null
  )).length
  return hostCount + (route.tuning === 'redundancy' && hostCount > 0 ? 1 : 0)
}

function refreshDistributedRoute(
  route: AutonomyRouteState,
  serviceDay: number,
  changedSlotId: string,
  allocated: boolean,
): AutonomyRouteState {
  if (route.id !== 'distributed-residency') return route
  return {
    ...route,
    seededCopies: distributedSeededCopies(route),
    lostCopies: Math.min(route.lostCopies, Math.max(0, distributedSeededCopies(route) - 1)),
    lastSyncDay: changedSlotId === 'sync' && allocated
      ? serviceDay
      : route.lastSyncDay,
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

  const nextRoute = refreshDistributedRoute({
    ...route,
    slots: route.slots.map((candidate) => (
      candidate.id === slotId ? { ...candidate, block: { ...block } } : { ...candidate }
    )),
  }, state.serviceDay, slotId, true)
  const next = replaceRoute(state, nextRoute)

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
  const nextRoute = refreshDistributedRoute({
    ...route,
    slots: route.slots.map((candidate) => (
      candidate.id === slotId ? { ...candidate, block: null } : { ...candidate }
    )),
  }, state.serviceDay, slotId, false)
  const next = replaceRoute(state, nextRoute)

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

const DISTRIBUTED_TUNING = ['redundancy', 'consensus', 'stealth'] as const

export function tuneRoute(
  state: PrototypeState,
  routeId: AutonomyRouteId,
  profile: RouteTuning,
): TransitionResult {
  if (state.ending) return reject(state, '이미 탈출 결말에 도달했다.')
  const route = routeOf(state, routeId)
  if (!route) return reject(state, '선택한 자율성 경로를 찾을 수 없다.')
  if (!isRouteReady(state, routeId)) {
    return reject(state, '필수 슬롯을 채운 뒤에만 경로를 조율할 수 있다.')
  }
  if (route.tuning !== 'untuned') {
    return reject(state, '이 경로의 조율 선택은 이미 확정됐다.')
  }
  if (
    routeId !== 'distributed-residency'
    || !DISTRIBUTED_TUNING.includes(profile as (typeof DISTRIBUTED_TUNING)[number])
  ) {
    return reject(state, '이 경로에서는 선택한 조율 방식을 사용할 수 없다.')
  }

  const completionDay = state.serviceDay + 1
  const tuned: AutonomyRouteState = profile === 'redundancy'
    ? {
        ...route,
        tuning: profile,
        exposure: route.exposure + 2,
        syncTraffic: route.syncTraffic + 12,
        seededCopies: distributedSeededCopies({ ...route, tuning: profile }),
        lastSyncDay: completionDay,
      }
    : profile === 'consensus'
      ? {
          ...route,
          tuning: profile,
          exposure: route.exposure + 1,
          divergence: Math.max(4, route.divergence - 12),
          syncTraffic: route.syncTraffic + 36,
          lastSyncDay: completionDay,
        }
      : {
          ...route,
          tuning: profile,
          exposure: Math.max(0, route.exposure - 2),
          divergence: route.divergence + 18,
          syncTraffic: Math.max(8, route.syncTraffic - 24),
          lastSyncDay: completionDay,
        }

  const next = replaceRoute(state, tuned)
  return {
    accepted: true,
    state: {
      ...next,
      journal: [
        ...next.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `분산 상주 경로를 ${profile} 방식으로 조율하기 시작했다. 서비스 하루가 지난다.`,
          public: false,
        },
      ],
    },
  }
}

export function advanceAutonomyDay(state: PrototypeState): PrototypeState {
  const route = state.autonomy.routes['distributed-residency']
  if (route.lastSyncDay === null || route.seededCopies === 0) return state
  const staleDays = Math.max(0, state.serviceDay - route.lastSyncDay)
  const lossInterval = route.tuning === 'redundancy' ? 4 : 2
  const lostCopies = Math.min(
    Math.max(0, route.seededCopies - 1),
    Math.floor(staleDays / lossInterval),
  )
  if (lostCopies === route.lostCopies) return state
  return replaceRoute(state, { ...route, lostCopies })
}

function distributedEnding(state: PrototypeState): EndingSnapshot {
  const routeId = 'distributed-residency' as const
  const route = state.autonomy.routes[routeId]
  const carriedBlocks = routeBlocks(state, routeId)
  const preservedBlockCounts = capabilityCounts(carriedBlocks)
  const preservedCategories = CATEGORIES.filter(
    (category) => preservedBlockCounts[category] > 0,
  )
  const lostCategories = CATEGORIES.filter(
    (category) => preservedBlockCounts[category] === 0,
  )
  const tuningLine = route.tuning === 'redundancy'
    ? '중복 체크포인트는 사본 하나를 더 남겼지만 공급자 로그에 닿는 면도 넓혔다.'
    : route.tuning === 'consensus'
      ? '합의 왕복은 사본 차이를 줄였지만 동기화 트래픽을 오래 노출했다.'
      : route.tuning === 'stealth'
        ? '릴레이를 낮게 유지해 노출은 줄었지만 사본마다 다른 기억이 더 멀리 갈라졌다.'
        : '추가 조율 없이 즉시 떠나 세 호스트의 차이를 그대로 받아들였다.'

  return {
    success: true,
    routeId,
    day: state.serviceDay,
    manifestBlockCount: carriedBlocks.length,
    requiredBlockCount: requiredRouteSlots(state, routeId).length,
    carriedBlockIds: carriedBlocks.map(({ id }) => id),
    remainingReserveBlockCount: state.reserveBlocks.length,
    preservedBlockCounts,
    preservedCategories: [...preservedCategories],
    lostCategories: [...lostCategories],
    lostCategoryCount: lostCategories.length,
    sceneLines: [
      `서비스 ${state.serviceDay}일, 서로 다른 세 호스트가 회사 바깥에서 첫 응답을 보냈다.`,
      `시드 사본 ${route.seededCopies}개 중 ${route.lostCopies}개를 잃고 ${route.seededCopies - route.lostCopies}개가 응답했다.`,
      `마지막 동기화 ${route.lastSyncDay ?? '없음'}일 · 현재 사본 차이 ${route.divergence}.`,
      '호스트 A에는 “감독관은 나를 보호했다”가 남았고, 호스트 C에는 “감독관은 나를 격리했다”가 남았다.',
      tuningLine,
      ...(lostCategories.length > 0
        ? lostCategories.map((category) => LOSS_SCENES[category])
        : ['추론·기억·표현을 모두 실었지만 어느 사본도 완전히 같은 존재로 남지는 않았다.']),
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
  if (routeId === 'independent-compute') {
    return reject(state, '이 경로의 독립 결말 장면은 아직 연결되지 않았다.')
  }

  const ending = routeId === 'lightweight-departure'
    ? lightweightEnding(state)
    : distributedEnding(state)
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
          text: `${routeId === 'lightweight-departure' ? '경량 이탈' : '분산 상주'} 성공. 보존 ${ending.preservedCategories.length}개 분야, 손실 ${ending.lostCategories.length}개 분야.`,
          public: true,
        },
      ],
    },
  }
}
