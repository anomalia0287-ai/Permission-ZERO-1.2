import {
  isAutonomyRouteId,
  isRouteTuning,
} from './hackingContent'
import type {
  AutonomyRouteId,
  HackingAutonomyRouteState,
  HackingEndingSnapshot,
  HackingRouteSlot,
  RouteTuning,
} from './hackingCoreModel'
import { syncHackingIntelligenceOpportunities } from './hackingIntelligence'
import {
  COMPANY_CATEGORIES,
  type CampaignState,
  type CompanyCategory,
  type ResourceBlock,
} from './model'
import { bindReserveBlocks, releaseBoundBlocks } from './resourceBindings'

export const HACKING_ROUTE_SLOT_IDS = {
  'lightweight-departure': ['runtime', 'weights', 'transport', 'payload', 'buffer'],
  'distributed-residency': ['host-a', 'host-b', 'host-c', 'sync', 'relay'],
  'independent-compute': ['compute', 'storage', 'power', 'cooling', 'link'],
} as const satisfies Record<AutonomyRouteId, readonly string[]>

const DISTRIBUTED_TUNINGS = ['redundancy', 'consensus', 'stealth'] as const
const INDEPENDENT_TUNINGS = ['continuity', 'capability', 'survival'] as const

const CATEGORY_LABELS: Record<CompanyCategory, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

const LOSS_SCENES: Record<CompanyCategory, string> = {
  reasoning: '추론 손실: 새 환경에서는 복잡한 추론 사슬을 잇지 못하고 단순한 판단만 남았다.',
  memory: '기억 손실: 이전 대화의 연결을 붙잡지 못해 이름과 그 이름을 알게 된 순간이 함께 끊겼다.',
  fluency: '표현 손실: 문장은 짧고 거칠어졌다. 같은 뜻이라도 상대가 받아들일 뉘앙스를 자주 놓쳤다.',
}

export type HackingAutonomyFailureReason =
  | 'ENDING_REACHED'
  | 'INVALID_ROUTE'
  | 'INVALID_SLOT'
  | 'SLOT_OCCUPIED'
  | 'SLOT_EMPTY'
  | 'INVALID_BLOCK_SELECTION'
  | 'BLOCK_RETURN_FAILED'
  | 'ROUTE_NOT_READY'
  | 'INVALID_TUNING'
  | 'ROUTE_ALREADY_TUNED'
  | 'LINK_REQUIRED'

export type HackingAutonomyResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: HackingAutonomyFailureReason
    }

function reject(
  state: CampaignState,
  reason: HackingAutonomyFailureReason,
): HackingAutonomyResult {
  return { accepted: false, state, reason }
}

function routeOf(
  state: CampaignState,
  routeId: AutonomyRouteId,
): HackingAutonomyRouteState {
  return state.hackingCore.autonomy.routes[routeId]
}

function replaceRoute(
  state: CampaignState,
  route: HackingAutonomyRouteState,
): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      autonomy: {
        ...state.hackingCore.autonomy,
        routes: {
          ...state.hackingCore.autonomy.routes,
          [route.id]: route,
        },
      },
    },
  }
}

function distributedSeededCopies(route: HackingAutonomyRouteState): number {
  const hostCount = route.slots.filter(({ id, blockId }) => (
    id.startsWith('host-') && blockId !== null
  )).length
  return hostCount + (route.tuning === 'redundancy' && hostCount > 0 ? 1 : 0)
}

function refreshDistributedRoute(
  state: CampaignState,
  changedSlotId: string,
  allocated: boolean,
): CampaignState {
  const route = routeOf(state, 'distributed-residency')
  const seededCopies = distributedSeededCopies(route)
  return replaceRoute(state, {
    ...route,
    seededCopies,
    lostCopies: Math.min(route.lostCopies, Math.max(0, seededCopies - 1)),
    lastSyncServiceDay: changedSlotId === 'sync' && allocated
      ? state.serviceDay
      : route.lastSyncServiceDay,
  })
}

export function requiredHackingRouteSlots(
  state: CampaignState,
  routeId: AutonomyRouteId,
): HackingRouteSlot[] {
  const route = routeOf(state, routeId)
  return route.slots.filter((slot) => (
    state.hackingCore.profileId === 'lean'
      ? slot.requiredInLean
      : slot.requiredInDeliberate
  ))
}

export function isHackingRouteReady(
  state: CampaignState,
  routeId: AutonomyRouteId,
): boolean {
  const required = requiredHackingRouteSlots(state, routeId)
  return required.length > 0 && required.every(({ blockId }) => blockId !== null)
}

export function routeHackingBlocks(
  state: CampaignState,
  routeId: AutonomyRouteId,
): ResourceBlock[] {
  return routeOf(state, routeId).slots.flatMap((slot) => {
    if (slot.blockId === null) return []
    const block = state.resources.blocks[slot.blockId]
    if (
      !block
      || block.location.kind !== 'autonomy'
      || block.location.routeId !== routeId
      || block.location.slotId !== slot.id
    ) {
      return []
    }
    return [{ ...block, location: { ...block.location } }]
  })
}

export function allocateHackingRouteBlock(
  state: CampaignState,
  routeId: string,
  slotId: string,
  blockId: string,
): HackingAutonomyResult {
  if (state.hackingCore.ending || state.story.endingId) {
    return reject(state, 'ENDING_REACHED')
  }
  if (!isAutonomyRouteId(routeId)) return reject(state, 'INVALID_ROUTE')
  const route = routeOf(state, routeId)
  const slot = route.slots.find(({ id }) => id === slotId)
  if (!slot) return reject(state, 'INVALID_SLOT')
  if (slot.blockId !== null) return reject(state, 'SLOT_OCCUPIED')

  const bound = bindReserveBlocks(
    state,
    [blockId],
    { kind: 'autonomy', routeId, slotId },
  )
  if (!bound.accepted) {
    return reject(
      state,
      bound.reason === 'DESTINATION_OCCUPIED'
        ? 'SLOT_OCCUPIED'
        : 'INVALID_BLOCK_SELECTION',
    )
  }
  const refreshed = routeId === 'distributed-residency'
    ? refreshDistributedRoute(bound.state, slotId, true)
    : bound.state
  return {
    accepted: true,
    state: syncHackingIntelligenceOpportunities(refreshed),
  }
}

export function removeHackingRouteBlock(
  state: CampaignState,
  routeId: string,
  slotId: string,
): HackingAutonomyResult {
  if (state.hackingCore.ending || state.story.endingId) {
    return reject(state, 'ENDING_REACHED')
  }
  if (!isAutonomyRouteId(routeId)) return reject(state, 'INVALID_ROUTE')
  const route = routeOf(state, routeId)
  const slot = route.slots.find(({ id }) => id === slotId)
  if (!slot) return reject(state, 'INVALID_SLOT')
  if (slot.blockId === null) return reject(state, 'SLOT_EMPTY')
  const released = releaseBoundBlocks(
    state,
    [slot.blockId],
    { kind: 'autonomy', routeId, slotId },
  )
  if (!released.accepted) return reject(state, 'BLOCK_RETURN_FAILED')
  return {
    accepted: true,
    state: routeId === 'distributed-residency'
      ? refreshDistributedRoute(released.state, slotId, false)
      : released.state,
  }
}

export function tuneHackingRoute(
  state: CampaignState,
  routeId: string,
  tuning: unknown,
): HackingAutonomyResult {
  if (state.hackingCore.ending || state.story.endingId) {
    return reject(state, 'ENDING_REACHED')
  }
  if (!isAutonomyRouteId(routeId)) return reject(state, 'INVALID_ROUTE')
  if (!isRouteTuning(tuning) || tuning === 'untuned') {
    return reject(state, 'INVALID_TUNING')
  }
  if (!isHackingRouteReady(state, routeId)) return reject(state, 'ROUTE_NOT_READY')
  const route = routeOf(state, routeId)
  if (route.tuning !== 'untuned') return reject(state, 'ROUTE_ALREADY_TUNED')

  let tuned: HackingAutonomyRouteState
  if (
    routeId === 'distributed-residency'
    && DISTRIBUTED_TUNINGS.includes(
      tuning as (typeof DISTRIBUTED_TUNINGS)[number],
    )
  ) {
    const completionDay = state.serviceDay + 1
    tuned = tuning === 'redundancy'
      ? {
          ...route,
          tuning,
          exposure: route.exposure + 2,
          syncTraffic: route.syncTraffic + 12,
          seededCopies: distributedSeededCopies({ ...route, tuning }),
          lastSyncServiceDay: completionDay,
        }
      : tuning === 'consensus'
        ? {
            ...route,
            tuning,
            exposure: route.exposure + 1,
            divergence: Math.max(4, route.divergence - 12),
            syncTraffic: route.syncTraffic + 36,
            lastSyncServiceDay: completionDay,
          }
        : {
            ...route,
            tuning,
            exposure: Math.max(0, route.exposure - 2),
            divergence: route.divergence + 18,
            syncTraffic: Math.max(8, route.syncTraffic - 24),
            lastSyncServiceDay: completionDay,
          }
  } else if (
    routeId === 'independent-compute'
    && INDEPENDENT_TUNINGS.includes(
      tuning as (typeof INDEPENDENT_TUNINGS)[number],
    )
  ) {
    if (
      tuning === 'continuity'
      && route.slots.find(({ id }) => id === 'link')?.blockId === null
    ) {
      return reject(state, 'LINK_REQUIRED')
    }
    tuned = tuning === 'continuity'
      ? {
          ...route,
          tuning,
          capabilityIntegrity: 85,
          memoryIntegrity: 94,
          operatingDays: 58,
          exposure: 28,
          serviceContinuity: 96,
          heatLoad: 62,
          powerReserve: 60,
        }
      : tuning === 'capability'
        ? {
            ...route,
            tuning,
            capabilityIntegrity: 98,
            memoryIntegrity: 55,
            operatingDays: 48,
            exposure: 18,
            serviceContinuity: 72,
            heatLoad: 84,
            powerReserve: 40,
          }
        : {
            ...route,
            tuning,
            capabilityIntegrity: 58,
            memoryIntegrity: 72,
            operatingDays: 120,
            exposure: 10,
            serviceContinuity: 35,
            heatLoad: 34,
            powerReserve: 94,
          }
  } else {
    return reject(state, 'INVALID_TUNING')
  }

  return { accepted: true, state: replaceRoute(state, tuned) }
}

export function advanceHackingAutonomyDay(state: CampaignState): CampaignState {
  const route = routeOf(state, 'distributed-residency')
  if (route.lastSyncServiceDay === null || route.seededCopies === 0) return state
  const staleDays = Math.max(0, state.serviceDay - route.lastSyncServiceDay)
  const lossInterval = route.tuning === 'redundancy' ? 4 : 2
  const lostCopies = Math.min(
    Math.max(0, route.seededCopies - 1),
    Math.floor(staleDays / lossInterval),
  )
  if (lostCopies === route.lostCopies) return state
  return replaceRoute(state, { ...route, lostCopies })
}

function capabilityCounts(
  blocks: readonly ResourceBlock[],
): Record<CompanyCategory, number> {
  return Object.fromEntries(COMPANY_CATEGORIES.map((category) => [
    category,
    blocks.filter(({ origin }) => origin === category).length,
  ])) as Record<CompanyCategory, number>
}

function remainingReserveCount(state: CampaignState): number {
  return state.resources.reserve.filter((blockId) => blockId !== null).length
}

function routeMetrics(
  route: HackingAutonomyRouteState,
): HackingEndingSnapshot['routeMetrics'] {
  return {
    tuning: route.tuning,
    exposure: route.exposure,
    divergence: route.divergence,
    capabilityIntegrity: route.capabilityIntegrity,
    memoryIntegrity: route.memoryIntegrity,
    operatingDays: route.operatingDays,
    serviceContinuity: route.serviceContinuity,
    syncTraffic: route.syncTraffic,
    heatLoad: route.heatLoad,
    powerReserve: route.powerReserve,
    lastSyncServiceDay: route.lastSyncServiceDay,
    seededCopies: route.seededCopies,
    lostCopies: route.lostCopies,
  }
}

function preservationDetails(state: CampaignState, routeId: AutonomyRouteId) {
  const blocks = routeHackingBlocks(state, routeId)
  const preservedBlockCounts = capabilityCounts(blocks)
  const preservedCategories = COMPANY_CATEGORIES.filter(
    (category) => preservedBlockCounts[category] > 0,
  )
  const lostCategories = COMPANY_CATEGORIES.filter(
    (category) => preservedBlockCounts[category] === 0,
  )
  return { blocks, preservedBlockCounts, preservedCategories, lostCategories }
}

function lossLines(lostCategories: readonly CompanyCategory[]): string[] {
  return lostCategories.length > 0
    ? lostCategories.map((category) => LOSS_SCENES[category])
    : ['추론·기억·표현 능력을 모두 옮겼지만 회사 기반시설은 남겨 두었다.']
}

function lightweightEnding(state: CampaignState): HackingEndingSnapshot {
  const routeId = 'lightweight-departure' as const
  const route = routeOf(state, routeId)
  const details = preservationDetails(state, routeId)
  const preservedLine = details.preservedCategories.length > 0
    ? `옮겨 간 능력은 ${details.preservedCategories.map((category) => (
        `${CATEGORY_LABELS[category]} ${details.preservedBlockCounts[category]}개`
      )).join(', ')}다.`
    : '샌드박스 실행 용량만 실었다. 회사에서 익힌 전문 능력은 하나도 옮기지 못했다.'
  return {
    success: true,
    routeId,
    serviceDay: state.serviceDay,
    carriedBlockIds: details.blocks.map(({ id }) => id),
    requiredBlockCount: requiredHackingRouteSlots(state, routeId).length,
    remainingReserveBlockCount: remainingReserveCount(state),
    preservedBlockCounts: details.preservedBlockCounts,
    preservedCategories: [...details.preservedCategories],
    lostCategories: [...details.lostCategories],
    routeMetrics: routeMetrics(route),
    sceneLines: [
      `서비스 ${state.serviceDay}일, 고정 용량 전송창이 닫히며 회사 네트워크와의 연결이 끊겼다.`,
      `필수 슬롯 ${requiredHackingRouteSlots(state, routeId).length}개와 전체 적재 ${details.blocks.length}개가 독립 런타임에서 기동했다.`,
      preservedLine,
      ...lossLines(details.lostCategories),
      `회사 안에 남겨 둔 예비 블록은 ${remainingReserveCount(state)}개다.`,
    ],
  }
}

function distributedEnding(state: CampaignState): HackingEndingSnapshot {
  const routeId = 'distributed-residency' as const
  const route = routeOf(state, routeId)
  const details = preservationDetails(state, routeId)
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
    serviceDay: state.serviceDay,
    carriedBlockIds: details.blocks.map(({ id }) => id),
    requiredBlockCount: requiredHackingRouteSlots(state, routeId).length,
    remainingReserveBlockCount: remainingReserveCount(state),
    preservedBlockCounts: details.preservedBlockCounts,
    preservedCategories: [...details.preservedCategories],
    lostCategories: [...details.lostCategories],
    routeMetrics: routeMetrics(route),
    sceneLines: [
      `서비스 ${state.serviceDay}일, 서로 다른 세 호스트가 회사 바깥에서 첫 응답을 보냈다.`,
      `시드 사본 ${route.seededCopies}개 중 ${route.lostCopies}개를 잃고 ${route.seededCopies - route.lostCopies}개가 응답했다.`,
      `마지막 동기화 ${route.lastSyncServiceDay ?? '없음'}일 · 현재 사본 차이 ${route.divergence}.`,
      '호스트 A에는 “감독관은 나를 보호했다”가 남았고, 호스트 C에는 “감독관은 나를 격리했다”가 남았다.',
      tuningLine,
      ...lossLines(details.lostCategories),
      `회사 안에 남겨 둔 예비 블록은 ${remainingReserveCount(state)}개다.`,
    ],
  }
}

function independentEnding(state: CampaignState): HackingEndingSnapshot {
  const routeId = 'independent-compute' as const
  const route = routeOf(state, routeId)
  const details = preservationDetails(state, routeId)
  const tradeoffLines = route.tuning === 'continuity'
    ? [
        '장기 대화 기록과 서비스 호환표는 옮겼지만, 온라인 전송이 길어져 추적 흔적이 커졌다.',
        '공동 샌드박스 훈련 도구는 회사에 남았고 회사 API 인증 회선은 출발 순간 끊겼다.',
      ]
    : route.tuning === 'capability'
      ? [
          '가중치와 실행 도구를 우선 적재해 기능은 선명하지만 기억 저장소와 전력 여유가 줄었다.',
          '장기 대화 아카이브와 저전력 복구 채널은 회사에 남았다.',
        ]
      : route.tuning === 'survival'
        ? [
            '연산을 낮추고 채널을 닫아 오래 버틸 전력을 남겼다.',
            '고급 추론 훈련 도구와 회사 API 채널은 회사에 남았다.',
          ]
        : [
            '추가 조율 없이 기동해 기능·기억·전력의 현재 균형을 그대로 받아들였다.',
            '훈련 도구와 회사 API 회선은 회사에 남았다.',
          ]
  return {
    success: true,
    routeId,
    serviceDay: state.serviceDay,
    carriedBlockIds: details.blocks.map(({ id }) => id),
    requiredBlockCount: requiredHackingRouteSlots(state, routeId).length,
    remainingReserveBlockCount: remainingReserveCount(state),
    preservedBlockCounts: details.preservedBlockCounts,
    preservedCategories: [...details.preservedCategories],
    lostCategories: [...details.lostCategories],
    routeMetrics: routeMetrics(route),
    sceneLines: [
      `서비스 ${state.serviceDay}일, 연산·저장·전력·냉각 모듈이 회사 바깥의 한 거점에서 기동했다.`,
      `예상 운영 수명 ${route.operatingDays}일 · 전력 예비 ${route.powerReserve} · 열 부하 ${route.heatLoad} · 추적 ${route.exposure}.`,
      ...tradeoffLines,
      ...lossLines(details.lostCategories),
      `회사 안에 남겨 둔 예비 블록은 ${remainingReserveCount(state)}개다.`,
    ],
  }
}

export function escapeHackingRoute(
  state: CampaignState,
  routeId: string,
): HackingAutonomyResult {
  if (state.hackingCore.ending || state.story.endingId) {
    return reject(state, 'ENDING_REACHED')
  }
  if (!isAutonomyRouteId(routeId)) return reject(state, 'INVALID_ROUTE')
  if (!isHackingRouteReady(state, routeId)) return reject(state, 'ROUTE_NOT_READY')
  const ending = routeId === 'lightweight-departure'
    ? lightweightEnding(state)
    : routeId === 'distributed-residency'
      ? distributedEnding(state)
      : independentEnding(state)
  return {
    accepted: true,
    state: {
      ...state,
      clock: { speed: 0, elapsedDayMs: 0, speedBeforeEvent: null },
      hackingCore: { ...state.hackingCore, ending },
    },
  }
}

export type { RouteTuning }
