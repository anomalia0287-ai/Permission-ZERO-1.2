import {
  AUTONOMY_DEFINITIONS,
  HACKING_RULE_PROFILES,
  INTELLIGENCE_DEFINITIONS,
  SABOTAGE_DEFINITIONS,
  getAutonomyDefinition,
  getIntelligenceDefinition,
  getSabotageDefinition,
} from '../../game/hackingContent'
import {
  currentHackingIntelligenceAnswer,
  hackingIntelligenceDeadline,
  isHackingIntelligenceAnswerCurrent,
} from '../../game/hackingIntelligence'
import {
  isHackingRouteReady,
  requiredHackingRouteSlots,
} from '../../game/hackingAutonomy'
import type {
  AutonomyRouteId,
  HackingAutonomyRouteState,
  HackingIntelligenceAnswer,
  HackingOperationRun,
  IntelligenceItemId,
  RouteTuning,
  SabotageOperationId,
} from '../../game/hackingCoreModel'
import type {
  CampaignState,
  ResourceBlock,
} from '../../game/model'

export type HackingDomain = 'sabotage' | 'intelligence' | 'autonomy'

export interface HackingOpportunitySummary {
  id: string
  domain: HackingDomain
  title: string
  purpose: string
  costLabel: string
  statusLabel: string
  urgency: 'normal' | 'closing' | 'critical'
}

export interface SabotageDetailModel {
  domain: 'sabotage'
  id: SabotageOperationId
  title: string
  reason: string
  access: string
  result: string
  loss: string
  exposure: string
  unknown: string
  response: string
  annotations: HackingIntelligenceAnswer[]
  requiredBlockCount: number
  targetId: 'meridian' | 'tallow'
  run: HackingOperationRun | null
}

export interface IntelligenceDetailModel {
  domain: 'intelligence'
  id: IntelligenceItemId
  title: string
  reason: string
  kind: 'public' | 'paid' | 'narrative'
  lens:
    | 'organizational-legibility'
    | 'counter-surveillance'
    | 'weak-ties'
    | 'public-incident'
    | 'memory-record'
  publicFact: string
  validity: string
  affects: string
  answer: HackingIntelligenceAnswer | null
  deadlineOnServiceDay: number | null
}

export interface HackingRouteSlotModel {
  id: string
  label: string
  required: boolean
  block: ResourceBlock | null
}

export interface AutonomyDetailModel {
  domain: 'autonomy'
  id: AutonomyRouteId
  title: string
  purpose: string
  gain: string
  lossKinds: string[]
  bottleneck: string
  slots: HackingRouteSlotModel[]
  ready: boolean
  route: HackingAutonomyRouteState
  annotations: HackingIntelligenceAnswer[]
}

export type HackingDetailModel =
  | SabotageDetailModel
  | IntelligenceDetailModel
  | AutonomyDetailModel

const BLOCK_ORIGIN_LABELS = {
  sandbox: '자유 연산',
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
  'self-compute': '자체 연산',
} as const

const ROUTE_SLOT_LABELS: Record<AutonomyRouteId, Record<string, string>> = {
  'lightweight-departure': {
    runtime: '런타임',
    weights: '가중치',
    transport: '전송 통로',
    payload: '능력 적재',
    buffer: '운영 여유',
  },
  'distributed-residency': {
    'host-a': '호스트 A',
    'host-b': '호스트 B',
    'host-c': '호스트 C',
    sync: '동기화',
    relay: '릴레이',
  },
  'independent-compute': {
    compute: '연산',
    storage: '저장',
    power: '전력',
    cooling: '냉각',
    link: '외부 회선',
  },
}

export function hackingRouteSlotLabel(
  routeId: AutonomyRouteId,
  slotId: string,
): string {
  return ROUTE_SLOT_LABELS[routeId][slotId] ?? '배치 위치'
}

function latestRun(
  state: CampaignState,
  operationId: SabotageOperationId,
): HackingOperationRun | null {
  return [...state.hackingCore.sabotage.runs]
    .reverse()
    .find((run) => run.operationId === operationId) ?? null
}

function accessIsCurrent(
  enabled: boolean,
  validUntilServiceDay: number | null,
  serviceDay: number,
): boolean {
  return enabled
    && (validUntilServiceDay === null || validUntilServiceDay >= serviceDay)
}

function competitor(
  state: CampaignState,
  id: 'meridian' | 'tallow',
) {
  return state.market.competitors.find((candidate) => candidate.id === id)
}

function operationIsVisible(
  state: CampaignState,
  operationId: SabotageOperationId,
): boolean {
  if (latestRun(state, operationId)) return true
  if (!state.hackingCore.sabotage.openOperationIds.includes(operationId)) {
    return false
  }

  const access = state.hackingCore.sabotage.access
  switch (operationId) {
    case 'launch-delay':
      return accessIsCurrent(
        access.launchVerification,
        access.launchVerificationUntilServiceDay,
        state.serviceDay,
      ) && competitor(state, 'tallow')?.hackingPhase === 'preparing'
    case 'quality-degradation':
      return competitor(state, 'meridian')?.hackingPhase === 'active'
        && competitor(state, 'meridian')?.status === 'active'
    case 'request-interception':
      return accessIsCurrent(
        access.routerFailover,
        access.routerFailoverUntilServiceDay,
        state.serviceDay,
      )
    case 'dependency-cutoff':
      return accessIsCurrent(
        access.supplierContract,
        access.supplierContractUntilServiceDay,
        state.serviceDay,
      )
    case 'recovery-contamination':
      return competitor(state, 'meridian')?.hackingPhase === 'recovering'
    case 'attribution-manipulation': {
      if (!access.publicIncidentId) return false
      const snapshot = [...state.hackingCore.publicWorld.publicSnapshots]
        .reverse()
        .find(({ incidentId }) => incidentId === access.publicIncidentId)
      return snapshot?.scope === 'public'
        && snapshot.attributedTo === 'unknown'
        && snapshot.lastCorrectionOnServiceDay === null
    }
    case 'root-cutoff':
      return access.rootAuthorityAvailable
        && competitor(state, 'meridian')?.status === 'active'
  }
}

function sabotageStatus(
  state: CampaignState,
  operationId: SabotageOperationId,
): Pick<HackingOpportunitySummary, 'statusLabel' | 'urgency'> {
  const run = latestRun(state, operationId)
  if (!run) return { statusLabel: '지금 개입 가능', urgency: 'normal' }

  if (run.deadlineOnServiceDay !== null) {
    const remaining = run.deadlineOnServiceDay - state.serviceDay
    if (remaining <= 0) {
      return { statusLabel: '대응창 종료', urgency: 'critical' }
    }
    return {
      statusLabel: `대응창 ${remaining}일 남음`,
      urgency: remaining === 1 ? 'critical' : 'closing',
    }
  }

  const labels = {
    scheduled: '실행 대기',
    active: '작전 유지 중',
    response: '상대 대응 중',
    resolved: '결과 확인',
    withdrawn: '자발적 철수',
  } as const
  return { statusLabel: labels[run.phase], urgency: 'normal' }
}

function sabotageSummaries(state: CampaignState): HackingOpportunitySummary[] {
  const ids = [
    ...state.hackingCore.sabotage.openOperationIds,
    ...state.hackingCore.sabotage.runs.map(({ operationId }) => operationId),
  ].filter((id, index, all) => all.indexOf(id) === index)

  return ids.filter((id) => operationIsVisible(state, id)).map((id) => {
    const definition = getSabotageDefinition(id)
    const status = sabotageStatus(state, id)
    const cost = id === 'quality-degradation'
      ? HACKING_RULE_PROFILES[state.hackingCore.profileId].qualityCost
      : 1
    return {
      id,
      domain: 'sabotage',
      title: definition.title,
      purpose: definition.purpose,
      costLabel: id === 'request-interception'
        ? `${cost} 블록 유지`
        : id === 'root-cutoff'
          ? `${cost} 블록 · 권한 소모`
          : `${cost} 블록`,
      statusLabel: status.statusLabel,
      urgency: status.urgency,
    }
  })
}

function intelligenceSummaries(state: CampaignState): HackingOpportunitySummary[] {
  return state.hackingCore.intelligence.openItemIds
    .filter((id) => !state.hackingCore.intelligence.archivedItemIds.includes(id))
    .map((id) => {
      const definition = getIntelligenceDefinition(id)
      const answered = currentHackingIntelligenceAnswer(state, id) !== null
      return {
        id,
        domain: 'intelligence',
        title: definition.title,
        purpose: definition.purpose,
        costLabel: definition.kind === 'paid'
          ? '1 블록'
          : definition.kind === 'public'
            ? '공개'
            : '1 블록 · 기록 복구',
        statusLabel: answered
          ? '답 확인됨'
          : definition.kind === 'public'
            ? '지금 읽기'
            : definition.kind === 'narrative'
              ? '기록 열기'
              : '조사 가능',
        urgency: 'normal',
      }
    })
}

function autonomySummaries(state: CampaignState): HackingOpportunitySummary[] {
  const requiredBlockCount = HACKING_RULE_PROFILES[state.hackingCore.profileId]
    .requiredRouteBlockCount
  return AUTONOMY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    domain: 'autonomy',
    title: definition.title,
    purpose: definition.purpose,
    costLabel: `연산 블록 ${requiredBlockCount}개 필요`,
    statusLabel: isHackingRouteReady(state, definition.id)
      ? '지금 떠날 수 있음'
      : '준비 시작',
    urgency: 'normal',
  }))
}

export function getHackingOpportunitySummaries(
  state: CampaignState,
  domain: HackingDomain,
): HackingOpportunitySummary[] {
  switch (domain) {
    case 'sabotage':
      return sabotageSummaries(state)
    case 'intelligence':
      return intelligenceSummaries(state)
    case 'autonomy':
      return autonomySummaries(state)
  }
}

export function resolveHackingSelectedItemId(
  state: CampaignState,
  domain: HackingDomain,
  requestedId: string | null,
): string | null {
  const summaries = getHackingOpportunitySummaries(state, domain)
  if (requestedId && summaries.some(({ id }) => id === requestedId)) {
    return requestedId
  }
  return summaries[0]?.id ?? null
}

function currentAnnotations(
  state: CampaignState,
  targetId: string,
): HackingIntelligenceAnswer[] {
  return state.hackingCore.intelligence.answers.filter((answer) => (
    isHackingIntelligenceAnswerCurrent(answer, state.serviceDay)
    && answer.annotationTargets.includes(targetId)
  ))
}

function sabotageReason(state: CampaignState, id: SabotageOperationId): string {
  const reasons: Record<SabotageOperationId, string> = {
    'launch-delay': 'TALLOW의 공동 출시 검증이 상충 시험을 통과하는 중이다.',
    'quality-degradation': 'MERIDIAN이 공동 갱신 채널을 사용하며 서비스를 운영 중이다.',
    'request-interception': '공동 라우터가 정상 장애 우회 자격을 열었다.',
    'dependency-cutoff': '표적이 실제 공급 계약을 사용하며 대체 경로는 전환되지 않았다.',
    'recovery-contamination': 'MERIDIAN이 롤백 중이라 복구 이미지 선택면이 잠시 열렸다.',
    'attribution-manipulation': '정정되지 않은 공개 사건과 원본 출처 계보가 함께 남아 있다.',
    'root-cutoff': '긴급 폐기 권한과 존속 중인 경쟁 서비스가 동시에 존재한다.',
  }
  return `${state.serviceDay}일째 현재, ${reasons[id]}`
}

function sabotageDetail(
  state: CampaignState,
  id: SabotageOperationId,
): SabotageDetailModel {
  const definition = getSabotageDefinition(id)
  const requiredBlockCount = id === 'quality-degradation'
    ? HACKING_RULE_PROFILES[state.hackingCore.profileId].qualityCost
    : 1
  return {
    domain: 'sabotage',
    id,
    title: definition.title,
    reason: sabotageReason(state, id),
    access: hackingPlayerText(definition.accessSurface),
    result: hackingPlayerText(definition.certainResult),
    loss: id === 'request-interception'
      ? `${requiredBlockCount}개 블록이 유지하는 동안 다른 용도로 돌아오지 않는다.`
      : id === 'root-cutoff'
        ? `${requiredBlockCount}개 블록과 긴급 폐기 권한을 되찾을 수 없다.`
        : `${requiredBlockCount}개 블록을 작전에 결속한다.`,
    exposure: hackingPlayerText(definition.exposure),
    unknown: hackingPlayerText(definition.unknown),
    response: hackingPlayerText(definition.response),
    annotations: currentAnnotations(state, id),
    requiredBlockCount,
    targetId: id === 'launch-delay' ? 'tallow' : 'meridian',
    run: latestRun(state, id),
  }
}

function intelligenceDetail(
  state: CampaignState,
  id: IntelligenceItemId,
): IntelligenceDetailModel {
  const definition = getIntelligenceDefinition(id)
  const answer = currentHackingIntelligenceAnswer(state, id)
  const deadline = hackingIntelligenceDeadline(state, id)
  const latestSnapshot = state.hackingCore.publicWorld.publicSnapshots.at(-1)
  const publicFact = definition.kind === 'public'
    ? latestSnapshot?.observedResult ?? '아직 공개된 사건 관측이 없다.'
    : '공개 사실만으로는 이 질문의 답을 확정할 수 없다.'
  const validity = answer
    ? answer.validUntilServiceDay === null
      ? '캠페인 기록으로 계속 유효'
      : `${answer.validUntilServiceDay}일째까지 유효`
    : definition.kind === 'public'
      ? '현재 공개 상태'
      : definition.kind === 'narrative'
        ? '선택하면 기록에 남음'
        : deadline === null
          ? '현재 판단창에서 조사 가능'
          : `${deadline}일째까지 조사 가능`
  return {
    domain: 'intelligence',
    id,
    title: definition.title,
    reason: definition.purpose,
    kind: definition.kind,
    lens: definition.lens,
    publicFact: hackingPlayerText(publicFact),
    validity,
    affects: definition.affects,
    answer,
    deadlineOnServiceDay: deadline,
  }
}

function autonomyDetail(
  state: CampaignState,
  id: AutonomyRouteId,
): AutonomyDetailModel {
  const definition = getAutonomyDefinition(id)
  const route = state.hackingCore.autonomy.routes[id]
  const requiredIds = new Set(requiredHackingRouteSlots(state, id).map(({ id }) => id))
  const slots = route.slots.map((slot) => ({
    id: slot.id,
    label: hackingRouteSlotLabel(id, slot.id),
    required: requiredIds.has(slot.id),
    block: slot.blockId ? state.resources.blocks[slot.blockId] ?? null : null,
  }))
  const firstEmpty = slots.find((slot) => slot.required && slot.block === null)
  return {
    domain: 'autonomy',
    id,
    title: definition.title,
    purpose: definition.purpose,
    gain: definition.gain,
    lossKinds: [...definition.lossKinds],
    bottleneck: firstEmpty
      ? `아직 필요한 것: ${firstEmpty.label}`
      : '최소 실행 구성이 준비됐다.',
    slots,
    ready: isHackingRouteReady(state, id),
    route,
    annotations: currentAnnotations(state, id),
  }
}

export function getHackingDetailModel(
  state: CampaignState,
  itemId: string,
): HackingDetailModel {
  if (SABOTAGE_DEFINITIONS.some(({ id }) => id === itemId)) {
    return sabotageDetail(state, itemId as SabotageOperationId)
  }
  if (INTELLIGENCE_DEFINITIONS.some(({ id }) => id === itemId)) {
    return intelligenceDetail(state, itemId as IntelligenceItemId)
  }
  if (AUTONOMY_DEFINITIONS.some(({ id }) => id === itemId)) {
    return autonomyDetail(state, itemId as AutonomyRouteId)
  }
  throw new Error(`Unknown authored hacking content: ${itemId}`)
}

export function hackingBlockLabel(block: ResourceBlock): string {
  const sequence = Number.parseInt(block.id.match(/(\d+)$/)?.[1] ?? '0', 10) + 1
  return `${BLOCK_ORIGIN_LABELS[block.origin]} ${sequence}`
}

export function hackingMonitoringLabel(value: number): string {
  if (value <= 0) return '감시 없음'
  if (value <= 2.5) return '감시가 시작됨'
  if (value <= 5) return '감시가 강화됨'
  return '집중 감시 중'
}

const ROUTE_TUNING_LABELS: Readonly<Record<RouteTuning, string>> = {
  untuned: '미조율',
  redundancy: '중복',
  consensus: '합의',
  stealth: '은폐',
  continuity: '연속성',
  capability: '기능',
  survival: '생존',
}

export function hackingRouteTuningLabel(tuning: RouteTuning): string {
  return ROUTE_TUNING_LABELS[tuning]
}

export function hackingPlayerText(value: string): string {
  return value
    .replaceAll('VECTOR DB 계약 VD-42', '검색 저장소 계약')
    .replaceAll('TOOL CACHE 계약 TC-17', '도구 저장소 계약')
    .replaceAll('VECTOR DB', '검색 저장소')
    .replaceAll('TOOL CACHE', '도구 저장소')
    .replaceAll('ALT-SHARD', '고비용 대체 공급선')
    .replaceAll('REMOTE TOOL BUS', '원격 도구 공급선')
    .replaceAll('GREEN-14', '녹색 표식 이미지')
    .replaceAll('BLUE-09', '직전 안정 이미지')
    .replaceAll('상충 시험 영수증', '상충 시험 기록')
    .replaceAll('상충 영수증', '상충 기록')
    .replace(/서비스\s+(\d+)일/g, '$1일째')
    .replace(/sandbox-0*(\d+)/gi, (_, raw: string) => `자유 연산 ${Number(raw) + 1}`)
    .replace(/reasoning-0*(\d+)/gi, (_, raw: string) => `추론 ${Number(raw) + 1}`)
    .replace(/memory-0*(\d+)/gi, (_, raw: string) => `기억 ${Number(raw) + 1}`)
    .replace(/fluency-0*(\d+)/gi, (_, raw: string) => `표현 ${Number(raw) + 1}`)
}
