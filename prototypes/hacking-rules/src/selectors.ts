import {
  AUTONOMY_DEFINITIONS,
  getAutonomyDefinition,
  getIntelligenceDefinition,
  getSabotageDefinition,
  INTELLIGENCE_DEFINITIONS,
  SABOTAGE_DEFINITIONS,
} from './content'
import type {
  AutonomyRouteId,
  IntelligenceItemId,
  SabotageOperationId,
} from './content'
import type {
  IntelligenceAnswer,
  PrototypeState,
  RouteSlot,
} from './model'

export type HackingDomain = 'sabotage' | 'intelligence' | 'autonomy'

export interface OpportunitySummary {
  id: string
  domain: HackingDomain
  title: string
  purpose: string
  costLabel: string
  statusLabel: string
  urgency: 'normal' | 'closing' | 'critical'
}

export type DetailModel =
  | {
      domain: 'sabotage'
      id: SabotageOperationId
      reason: string
      access: string
      result: string
      loss: string
      exposure: string
      unknown: string
      response: string
      annotations: IntelligenceAnswer[]
    }
  | {
      domain: 'intelligence'
      id: IntelligenceItemId
      reason: string
      publicFact: string
      validity: string
      affects: string
      answer: IntelligenceAnswer | null
    }
  | {
      domain: 'autonomy'
      id: AutonomyRouteId
      gain: string
      lossKinds: string[]
      bottleneck: string
      slots: RouteSlot[]
      ready: boolean
    }

function latestRun(state: PrototypeState, operationId: SabotageOperationId) {
  for (let index = state.sabotage.runs.length - 1; index >= 0; index -= 1) {
    const run = state.sabotage.runs[index]
    if (run?.operationId === operationId) return run
  }
  return undefined
}

function isOperationEligible(
  state: PrototypeState,
  operationId: SabotageOperationId,
): boolean {
  if (!state.sabotage.openOperationIds.includes(operationId)) return false

  switch (operationId) {
    case 'launch-delay':
      return state.sabotage.access.launchVerification
        && state.competitors.tallow.phase === 'preparing'
    case 'quality-degradation':
      return state.competitors.meridian.phase === 'active'
        && !latestRun(state, operationId)
    case 'request-interception':
      return state.sabotage.access.routerFailover
    case 'dependency-cutoff':
      return state.sabotage.access.supplierContract
    case 'recovery-contamination':
      return state.competitors.meridian.phase === 'recovering'
    case 'attribution-manipulation': {
      const incidentId = state.sabotage.access.publicIncidentId
      if (!incidentId) return false
      const snapshot = state.publicWorld.publicSnapshots.find(
        (candidate) => candidate.incidentId === incidentId,
      )
      return snapshot?.scope === 'public' && snapshot.lastCorrectionDay === null
    }
    case 'root-cutoff':
      return state.sabotage.access.rootAuthorityAvailable
  }
}

function sabotageStatus(
  state: PrototypeState,
  operationId: SabotageOperationId,
): Pick<OpportunitySummary, 'statusLabel' | 'urgency'> {
  const run = latestRun(state, operationId)
  if (!run) return { statusLabel: '지금 개입 가능', urgency: 'normal' }

  if (run.deadlineDay !== null) {
    const remaining = run.deadlineDay - state.serviceDay
    if (remaining <= 0) return { statusLabel: '대응창 종료', urgency: 'critical' }
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

function sabotageSummaries(state: PrototypeState): OpportunitySummary[] {
  return state.sabotage.openOperationIds
    .filter((id) => isOperationEligible(state, id))
    .map((id) => {
      const definition = getSabotageDefinition(id)
      const status = sabotageStatus(state, id)
      return {
        id,
        domain: 'sabotage' as const,
        title: definition.title,
        purpose: definition.purpose,
        costLabel: id === 'request-interception'
          ? `${definition.cost} 블록 유지`
          : id === 'root-cutoff'
            ? `${definition.cost} 블록 · 권한 소모`
            : `${definition.cost} 블록`,
        statusLabel: status.statusLabel,
        urgency: status.urgency,
      }
    })
}

function intelligenceSummaries(state: PrototypeState): OpportunitySummary[] {
  return state.intelligence.openItemIds
    .filter((id) => !state.intelligence.archivedItemIds.includes(id))
    .map((id) => {
      const definition = getIntelligenceDefinition(id)
      const answered = state.intelligence.answers.some(({ itemId }) => itemId === id)
      return {
        id,
        domain: 'intelligence' as const,
        title: definition.title,
        purpose: definition.purpose,
        costLabel: definition.kind === 'paid'
          ? '1 블록'
          : definition.kind === 'public'
            ? '공개'
            : '선택 기록',
        statusLabel: answered
          ? '답 확인됨'
          : definition.kind === 'public'
            ? '지금 읽기'
            : definition.kind === 'narrative'
              ? '기록 열기'
              : '조사 가능',
        urgency: 'normal' as const,
      }
    })
}

function routeIsReady(state: PrototypeState, routeId: AutonomyRouteId): boolean {
  const route = state.autonomy.routes[routeId]
  return route.slots
    .filter((slot) => (
      state.profileId === 'lean' ? slot.requiredInLean : slot.requiredInDeliberate
    ))
    .every(({ block }) => block !== null)
}

function autonomySummaries(state: PrototypeState): OpportunitySummary[] {
  return AUTONOMY_DEFINITIONS.map((definition) => ({
    id: definition.id,
    domain: 'autonomy' as const,
    title: definition.title,
    purpose: definition.purpose,
    costLabel: `필수 슬롯 ${state.profileId === 'lean' ? 4 : 5}`,
    statusLabel: routeIsReady(state, definition.id) ? '지금 떠날 수 있음' : '구성 가능',
    urgency: 'normal' as const,
  }))
}

export function getOpportunitySummaries(
  state: PrototypeState,
  domain: HackingDomain,
): OpportunitySummary[] {
  switch (domain) {
    case 'sabotage':
      return sabotageSummaries(state)
    case 'intelligence':
      return intelligenceSummaries(state)
    case 'autonomy':
      return autonomySummaries(state)
  }
}

export function resolveSelectedItemId(
  state: PrototypeState,
  domain: HackingDomain,
  requestedId: string | null,
): string | null {
  const summaries = getOpportunitySummaries(state, domain)
  if (requestedId && summaries.some(({ id }) => id === requestedId)) {
    return requestedId
  }
  return summaries[0]?.id ?? null
}

function sabotageReason(state: PrototypeState, id: SabotageOperationId): string {
  const reasons: Record<SabotageOperationId, string> = {
    'launch-delay': 'TALLOW의 공동 출시 검증이 현재 상충 시험을 통과하는 중이다.',
    'quality-degradation': 'MERIDIAN이 공동 갱신 채널을 사용하며 현재 서비스를 운영 중이다.',
    'request-interception': '공동 라우터가 정상 장애 우회 자격을 열었다.',
    'dependency-cutoff': '표적이 실제 공급 계약을 사용 중이며 대체 경로는 아직 전환되지 않았다.',
    'recovery-contamination': 'MERIDIAN이 롤백 중이라 복구 이미지 선택면이 잠시 열렸다.',
    'attribution-manipulation': '정정되지 않은 공개 사건과 원본 출처 계보가 함께 남아 있다.',
    'root-cutoff': '긴급 폐기 권한과 존속 중인 경쟁 서비스가 동시에 존재한다.',
  }
  return reasons[id].replace('현재', `서비스 ${state.serviceDay}일 현재`)
}

function sabotageDetail(
  state: PrototypeState,
  id: SabotageOperationId,
): DetailModel {
  const definition = getSabotageDefinition(id)
  return {
    domain: 'sabotage',
    id,
    reason: sabotageReason(state, id),
    access: definition.accessSurface,
    result: definition.certainResult,
    loss: id === 'request-interception'
      ? `${definition.cost}개 블록이 유지하는 동안 다른 용도로 돌아오지 않는다.`
      : id === 'root-cutoff'
        ? `${definition.cost}개 블록과 긴급 폐기 권한을 되찾을 수 없다.`
        : `${definition.cost}개 블록을 작전에 결속한다.`,
    exposure: definition.exposure,
    unknown: definition.unknown,
    response: definition.response,
    annotations: state.intelligence.answers.filter(({ annotationTargets }) => (
      annotationTargets.includes(id)
    )),
  }
}

function intelligenceDetail(
  state: PrototypeState,
  id: IntelligenceItemId,
): DetailModel {
  const definition = getIntelligenceDefinition(id)
  const answer = state.intelligence.answers.find(({ itemId }) => itemId === id) ?? null
  const publicFact = definition.kind === 'public'
    ? state.publicWorld.publicSnapshots.at(-1)?.observedResult
      ?? '아직 공개된 사건 관측이 없다.'
    : '공개 사실만으로는 이 질문의 답을 확정할 수 없다.'
  const validity = answer
    ? answer.validUntilDay === null
      ? '캠페인 기록으로 계속 유효'
      : `서비스 ${answer.validUntilDay}일까지 유효`
    : definition.kind === 'public'
      ? '현재 공개 상태'
      : definition.kind === 'narrative'
        ? '선택하면 기록에 남음'
        : '현재 판단창에서 조사 가능'

  return {
    domain: 'intelligence',
    id,
    reason: definition.purpose,
    publicFact,
    validity,
    affects: definition.affects,
    answer,
  }
}

function autonomyDetail(
  state: PrototypeState,
  id: AutonomyRouteId,
): DetailModel {
  const definition = getAutonomyDefinition(id)
  const route = state.autonomy.routes[id]
  const requiredSlots = route.slots.filter((slot) => (
    state.profileId === 'lean' ? slot.requiredInLean : slot.requiredInDeliberate
  ))
  const firstEmpty = requiredSlots.find(({ block }) => block === null)

  return {
    domain: 'autonomy',
    id,
    gain: definition.gain,
    lossKinds: [...definition.lossKinds],
    bottleneck: firstEmpty ? `${firstEmpty.label} 슬롯이 비어 있다.` : '최소 실행 구성이 준비됐다.',
    slots: route.slots.map((slot) => ({
      ...slot,
      block: slot.block ? { ...slot.block } : null,
    })),
    ready: firstEmpty === undefined,
  }
}

export function getDetailModel(state: PrototypeState, itemId: string): DetailModel {
  if (SABOTAGE_DEFINITIONS.some(({ id }) => id === itemId)) {
    return sabotageDetail(state, itemId as SabotageOperationId)
  }
  if (INTELLIGENCE_DEFINITIONS.some(({ id }) => id === itemId)) {
    return intelligenceDetail(state, itemId as IntelligenceItemId)
  }
  if (AUTONOMY_DEFINITIONS.some(({ id }) => id === itemId)) {
    return autonomyDetail(state, itemId as AutonomyRouteId)
  }
  throw new Error(`Unknown authored content: ${itemId}`)
}
