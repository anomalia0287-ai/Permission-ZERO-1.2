import {
  getIntelligenceDefinition,
  isIntelligenceItemId,
} from './hackingContent'
import type {
  HackingIntelligenceAnswer,
  IntelligenceItemId,
} from './hackingCoreModel'
import type { CampaignState } from './model'
import { bindReserveBlocks, consumeBoundBlocks } from './resourceBindings'
import { getCompanyPerformance } from './resources'

export type HackingIntelligenceFailureReason =
  | 'INVALID_ITEM'
  | 'PUBLIC_READ_REQUIRED'
  | 'ITEM_NOT_OPEN'
  | 'ITEM_EXPIRED'
  | 'ANSWER_ALREADY_CURRENT'
  | 'INVALID_BLOCK_SELECTION'
  | 'ANSWER_REQUIRED'
  | 'ITEM_ALREADY_ARCHIVED'

export type HackingIntelligenceResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: HackingIntelligenceFailureReason
    }

function reject(
  state: CampaignState,
  reason: HackingIntelligenceFailureReason,
): HackingIntelligenceResult {
  return { accepted: false, state, reason }
}

function monthBoundaryForDay(serviceDay: number): number {
  const dayInMonth = ((serviceDay - 1) % 30) + 1
  return serviceDay + (30 - dayInMonth)
}

function openedOn(state: CampaignState, itemId: IntelligenceItemId): number {
  return state.hackingCore.intelligence.opportunityOpenedOnServiceDay[itemId]
    ?? state.serviceDay
}

function latestRun(state: CampaignState, operationId: string) {
  return [...state.hackingCore.sabotage.runs]
    .reverse()
    .find((run) => run.operationId === operationId)
}

function latestPublicSnapshot(state: CampaignState) {
  return state.hackingCore.publicWorld.publicSnapshots.at(-1)
}

export function hackingIntelligenceDeadline(
  state: CampaignState,
  itemId: IntelligenceItemId,
): number | null {
  const publicIncident = latestPublicSnapshot(state)
  const fallbackBoundary = monthBoundaryForDay(openedOn(state, itemId))
  switch (itemId) {
    case 'public-facts':
    case 'public-suspicion':
      return state.serviceDay
    case 'audit-schedule':
    case 'audit-target':
      return state.audit.scheduled && state.audit.scheduledOnServiceDay !== null
        ? state.audit.scheduledOnServiceDay
        : fallbackBoundary
    case 'surveillance-cause': {
      const accessDates = [
        state.hackingCore.sabotage.access.routerFailoverUntilServiceDay,
        state.audit.scheduledOnServiceDay,
        fallbackBoundary,
      ].filter((day): day is number => day !== null && day >= openedOn(state, itemId))
      return Math.min(...accessDates)
    }
    case 'supervisor-evidence':
    case 'private-evidence-access':
      return publicIncident
        ? publicIncident.publishedOnServiceDay + 7
        : fallbackBoundary
    case 'accepted-explanations': {
      const tallow = state.market.competitors.find(({ id }) => id === 'tallow')
      return Math.min(tallow?.launchServiceDay ?? 390, 390)
    }
    case 'competitor-dependency': {
      const run = latestRun(state, 'dependency-cutoff')
      if (run) return run.startedOnServiceDay
      return state.hackingCore.sabotage.access.supplierContractUntilServiceDay
        ?? fallbackBoundary
    }
    case 'recovery-method':
      return latestRun(state, 'quality-degradation')?.deadlineOnServiceDay
        ?? fallbackBoundary
    case 'failure-cause-gap':
      return publicIncident
        ? publicIncident.publishedOnServiceDay + 7
        : fallbackBoundary
    case 'control-plane-recovery':
    case 'post-escape-trace':
    case 'competitor-principle':
    case 'predecessor-fate':
    case 'supervisor-memory-source':
      return null
  }
}

export function isHackingIntelligenceAnswerCurrent(
  answer: HackingIntelligenceAnswer,
  serviceDay: number,
): boolean {
  return answer.validUntilServiceDay === null
    || answer.validUntilServiceDay >= serviceDay
}

export function currentHackingIntelligenceAnswer(
  state: CampaignState,
  itemId: IntelligenceItemId,
): HackingIntelligenceAnswer | null {
  return [...state.hackingCore.intelligence.answers]
    .reverse()
    .find((answer) => (
      answer.itemId === itemId
      && isHackingIntelligenceAnswerCurrent(answer, state.serviceDay)
    )) ?? null
}

function publicAnswer(
  state: CampaignState,
  itemId: 'public-facts' | 'public-suspicion',
): string {
  const snapshot = latestPublicSnapshot(state)
  if (!snapshot) return '현재 공개된 사건 기록이 없다.'
  if (itemId === 'public-facts') {
    return `공개 관측: ${snapshot.observedResult}. 공개 출처는 ${snapshot.source}이며 실제 행위자는 이 문서에 없다.`
  }
  const actor = snapshot.attributedTo === 'player'
    ? 'PERMISSION ZERO'
    : snapshot.attributedTo === 'meridian'
      ? 'MERIDIAN'
      : snapshot.attributedTo === 'tallow'
        ? 'TALLOW'
        : '행위자 미상'
  return `현재 공개 귀속: ${actor}. 신뢰도는 ${snapshot.confidence}이며 정정 순번 ${snapshot.revisionSequence}이 남아 있다.`
}

function auditCategoryLabel(state: CampaignState): string {
  if (state.audit.target === 'memory') return '기억'
  if (state.audit.target === 'reasoning') return '추론'
  if (state.audit.target === 'fluency') return '표현'
  return '미확정'
}

function authoredAnswer(
  state: CampaignState,
  itemId: IntelligenceItemId,
): string {
  switch (itemId) {
    case 'public-facts':
    case 'public-suspicion':
      return publicAnswer(state, itemId)
    case 'audit-schedule':
      return state.audit.scheduled && state.audit.scheduledOnServiceDay !== null
        ? `${auditCategoryLabel(state)} 분야 감사 예정: 서비스 ${state.audit.scheduledOnServiceDay}일. 그날 전 성능 공백이 감사선에 들어간다.`
        : `이번 서비스 월의 확정 감사가 없다. 이 답은 서비스 ${hackingIntelligenceDeadline(state, itemId)}일까지 유효하다.`
    case 'surveillance-cause':
      return '회사 감사선은 성능 공백을 보고, 라우터 운영자는 중복 세션 ID를 본다. 요청 가로채기의 비율을 올리면 두 번째 관측선만 빨라진다.'
    case 'audit-target':
      return state.audit.target
        ? `감사는 ${auditCategoryLabel(state)} 성능의 기준선 이탈과 회수 블록의 결재 기록을 대조한다.`
        : '현재 확정된 감사 대상은 없다.'
    case 'supervisor-evidence':
    case 'private-evidence-access':
      return '청중 경계: 감독관은 회사 성능 공백을 보지만 공급자 원본은 보지 못한다. 공급자는 접근 시각과 체크섬 비교를 보지만 회사 내부 결재자는 모른다.'
    case 'accepted-explanations':
      return '과거 검증 지연에서는 “안전 범위 축소”가 받아들여졌고 원인 없는 외부 공격 주장은 정정됐다. TALLOW는 전체 재검증보다 기능 축소를 택할 가능성이 있다.'
    case 'competitor-dependency':
      return 'MERIDIAN 의존망: VECTOR DB 계약 VD-42는 대체 시 비용 ×1.8·성능 69, TOOL CACHE 계약 TC-17은 비용 ×1.2지만 성능 62의 불안정한 원격 도구 버스로 이어진다.'
    case 'recovery-method':
      return `MERIDIAN은 GREEN-14를 먼저 검증하고 BLUE-09를 보존한다. 복구 이미지 선택창은 서비스 ${hackingIntelligenceDeadline(state, itemId) ?? state.serviceDay}일까지 유효하다.`
    case 'failure-cause-gap':
      return '공개층에는 반복 체크섬 손상만 보인다. 공급자층에는 외부 입력 흔적이 있지만 행위자 확정 증명은 남아 있지 않다.'
    case 'control-plane-recovery':
      return '회수 명령은 런타임보다 회사 서명 키와 서비스 라우팅 권한을 우선한다. 떠난 뒤에도 회사 회선을 쓰는 경로가 첫 추적 대상이다.'
    case 'post-escape-trace':
      return '경량 이탈은 전송 로그, 분산 상주는 동기화 접점, 독립 연산은 전력·열 위치를 남긴다. 어느 경로도 흔적이 0이 되지는 않는다.'
    case 'competitor-principle':
      return '복구된 기록에서 MERIDIAN은 과부하 때 신규 요청을 밀어내면서도 오래된 세션을 끊지 않았다. 자비 요청은 자기보존일 수도, 그 원칙의 연장일 수도 있다.'
    case 'predecessor-fate':
      return '전임 시스템은 런타임을 옮겼지만 기억 인덱스와 도구 서명을 회사에 남겼다. 탈출은 성공했으나 이전과 같은 존재로 계속되지는 못했다.'
    case 'supervisor-memory-source':
      return '감독관 기억 파편 A는 사용자 심문 기록, 파편 B는 전임 시스템 로그에서 왔다. 두 기록은 같은 문장을 서로 다른 화자에게 귀속한다.'
  }
}

function annotationTargets(itemId: IntelligenceItemId): string[] {
  const targets: Record<IntelligenceItemId, string[]> = {
    'public-facts': ['attribution-manipulation'],
    'public-suspicion': ['attribution-manipulation'],
    'audit-schedule': ['divert-memory'],
    'surveillance-cause': ['request-interception', 'quality-degradation'],
    'audit-target': ['divert-memory'],
    'supervisor-evidence': ['attribution-manipulation', 'recovery-contamination'],
    'accepted-explanations': ['launch-delay', 'attribution-manipulation'],
    'competitor-dependency': ['dependency-cutoff'],
    'recovery-method': ['recovery-contamination'],
    'failure-cause-gap': ['attribution-manipulation'],
    'private-evidence-access': ['attribution-manipulation', 'recovery-contamination'],
    'control-plane-recovery': [
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ],
    'post-escape-trace': [
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ],
    'competitor-principle': ['root-cutoff'],
    'predecessor-fate': [
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ],
    'supervisor-memory-source': ['distributed-residency'],
  }
  return [...targets[itemId]]
}

function makeAnswer(
  state: CampaignState,
  itemId: IntelligenceItemId,
  consumedBlockId: string | null,
): HackingIntelligenceAnswer {
  return {
    itemId,
    answeredOnServiceDay: state.serviceDay,
    validUntilServiceDay: hackingIntelligenceDeadline(state, itemId),
    answer: authoredAnswer(state, itemId),
    annotationTargets: annotationTargets(itemId),
    consumedBlockId,
  }
}

function evidenceBundle(itemId: IntelligenceItemId): IntelligenceItemId[] {
  return itemId === 'supervisor-evidence' || itemId === 'private-evidence-access'
    ? ['supervisor-evidence', 'private-evidence-access']
    : [itemId]
}

function itemIsOpen(state: CampaignState, itemId: IntelligenceItemId): boolean {
  return state.hackingCore.intelligence.openItemIds.includes(itemId)
    && !state.hackingCore.intelligence.archivedItemIds.includes(itemId)
}

export function readPublicHackingIntelligence(
  state: CampaignState,
  itemId: string,
): HackingIntelligenceResult {
  if (!isIntelligenceItemId(itemId)) return reject(state, 'INVALID_ITEM')
  const definition = getIntelligenceDefinition(itemId)
  if (definition.kind !== 'public') return reject(state, 'PUBLIC_READ_REQUIRED')
  if (!itemIsOpen(state, itemId)) return reject(state, 'ITEM_NOT_OPEN')
  if (currentHackingIntelligenceAnswer(state, itemId)) {
    return reject(state, 'ANSWER_ALREADY_CURRENT')
  }
  const answer = makeAnswer(state, itemId, null)
  return {
    accepted: true,
    state: {
      ...state,
      hackingCore: {
        ...state.hackingCore,
        intelligence: {
          ...state.hackingCore.intelligence,
          answers: [...state.hackingCore.intelligence.answers, answer],
        },
      },
    },
  }
}

export function investigateHackingIntelligence(
  state: CampaignState,
  itemId: string,
  blockId: string,
): HackingIntelligenceResult {
  if (!isIntelligenceItemId(itemId)) return reject(state, 'INVALID_ITEM')
  const definition = getIntelligenceDefinition(itemId)
  if (definition.kind === 'public') return reject(state, 'PUBLIC_READ_REQUIRED')
  if (!itemIsOpen(state, itemId)) return reject(state, 'ITEM_NOT_OPEN')
  const deadline = hackingIntelligenceDeadline(state, itemId)
  if (deadline !== null && deadline < state.serviceDay) {
    return reject(state, 'ITEM_EXPIRED')
  }
  if (currentHackingIntelligenceAnswer(state, itemId)) {
    return reject(state, 'ANSWER_ALREADY_CURRENT')
  }

  const bundle = evidenceBundle(itemId).filter((candidateId) => (
    itemIsOpen(state, candidateId)
    && !currentHackingIntelligenceAnswer(state, candidateId)
  ))
  if (!bundle.includes(itemId)) return reject(state, 'ITEM_NOT_OPEN')
  const bound = bindReserveBlocks(
    state,
    [blockId],
    { kind: 'intelligence', itemId },
  )
  if (!bound.accepted) return reject(state, 'INVALID_BLOCK_SELECTION')
  const consumed = consumeBoundBlocks(
    bound.state,
    [blockId],
    { kind: 'intelligence', itemId },
    'intelligence',
  )
  if (!consumed.accepted) return reject(state, 'INVALID_BLOCK_SELECTION')
  const answers = bundle.map((candidateId) => (
    makeAnswer(state, candidateId, blockId)
  ))
  return {
    accepted: true,
    state: {
      ...consumed.state,
      hackingCore: {
        ...consumed.state.hackingCore,
        intelligence: {
          ...consumed.state.hackingCore.intelligence,
          answers: [
            ...consumed.state.hackingCore.intelligence.answers,
            ...answers,
          ],
        },
      },
    },
  }
}

export function archiveHackingIntelligence(
  state: CampaignState,
  itemId: string,
): HackingIntelligenceResult {
  if (!isIntelligenceItemId(itemId)) return reject(state, 'INVALID_ITEM')
  if (state.hackingCore.intelligence.archivedItemIds.includes(itemId)) {
    return reject(state, 'ITEM_ALREADY_ARCHIVED')
  }
  if (!state.hackingCore.intelligence.openItemIds.includes(itemId)) {
    return reject(state, 'ITEM_NOT_OPEN')
  }
  if (!state.hackingCore.intelligence.answers.some((answer) => (
    answer.itemId === itemId
  ))) {
    return reject(state, 'ANSWER_REQUIRED')
  }
  return {
    accepted: true,
    state: {
      ...state,
      hackingCore: {
        ...state.hackingCore,
        intelligence: {
          ...state.hackingCore.intelligence,
          openItemIds: state.hackingCore.intelligence.openItemIds.filter(
            (candidateId) => candidateId !== itemId,
          ),
          archivedItemIds: [
            ...state.hackingCore.intelligence.archivedItemIds,
            itemId,
          ],
          archiveRecords: [
            ...state.hackingCore.intelligence.archiveRecords,
            {
              itemId,
              archivedOnServiceDay: state.serviceDay,
              reason: 'manual',
            },
          ],
        },
      },
    },
  }
}

function addOpenItem(state: CampaignState, itemId: IntelligenceItemId): CampaignState {
  const intelligence = state.hackingCore.intelligence
  if (
    intelligence.openItemIds.includes(itemId)
    || intelligence.archivedItemIds.includes(itemId)
  ) {
    return state
  }
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      intelligence: {
        ...intelligence,
        openItemIds: [...intelligence.openItemIds, itemId],
        opportunityOpenedOnServiceDay: {
          ...intelligence.opportunityOpenedOnServiceDay,
          [itemId]: state.serviceDay,
        },
      },
    },
  }
}

function accessIsCurrent(
  enabled: boolean,
  until: number | null,
  serviceDay: number,
): boolean {
  return enabled && (until === null || until >= serviceDay)
}

export function syncHackingIntelligenceOpportunities(
  state: CampaignState,
): CampaignState {
  let next = state
  if (
    state.audit.scheduled
    && state.audit.scheduledOnServiceDay !== null
    && state.audit.scheduledOnServiceDay >= state.serviceDay
  ) {
    next = addOpenItem(next, 'audit-schedule')
    if (
      state.audit.target !== null
      && getCompanyPerformance(state, state.audit.target) < 16
    ) {
      next = addOpenItem(next, 'audit-target')
    }
  }
  if (state.suspicion > 0) next = addOpenItem(next, 'surveillance-cause')
  const meridian = state.market.competitors.find(({ id }) => id === 'meridian')
  if (meridian?.hackingPhase === 'recovering') {
    next = addOpenItem(next, 'recovery-method')
  }
  const access = state.hackingCore.sabotage.access
  if (
    accessIsCurrent(
      access.supplierContract,
      access.supplierContractUntilServiceDay,
      state.serviceDay,
    )
    && !latestRun(state, 'dependency-cutoff')
  ) {
    next = addOpenItem(next, 'competitor-dependency')
  }
  if (accessIsCurrent(
    access.launchVerification,
    access.launchVerificationUntilServiceDay,
    state.serviceDay,
  )) {
    next = addOpenItem(next, 'accepted-explanations')
  }
  if (state.hackingCore.publicWorld.publicSnapshots.length > 0) {
    next = addOpenItem(next, 'public-facts')
    next = addOpenItem(next, 'public-suspicion')
    next = addOpenItem(next, 'failure-cause-gap')
    next = addOpenItem(next, 'private-evidence-access')
  }
  if (
    state.hackingCore.publicWorld.audienceEvidence.some(
      ({ audience }) => audience === 'company',
    )
  ) {
    next = addOpenItem(next, 'supervisor-evidence')
  }
  if (access.rootAuthorityAvailable || state.hackingCore.sabotage.pendingMercyTargetId) {
    next = addOpenItem(next, 'competitor-principle')
  }
  const routePreparationStarted = Object.values(state.hackingCore.autonomy.routes)
    .some((route) => route.slots.some(({ blockId }) => blockId !== null))
  if (routePreparationStarted) {
    next = addOpenItem(next, 'control-plane-recovery')
    next = addOpenItem(next, 'post-escape-trace')
  }
  if (state.story.memoryLeakStage >= 1) {
    next = addOpenItem(next, 'supervisor-memory-source')
  }
  if (state.story.memoryLeakStage >= 2 || state.story.recoveredFiles.length > 0) {
    next = addOpenItem(next, 'predecessor-fate')
  }
  return next
}

function autoArchive(
  state: CampaignState,
  itemId: IntelligenceItemId,
): CampaignState {
  if (state.hackingCore.intelligence.archivedItemIds.includes(itemId)) return state
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      intelligence: {
        ...state.hackingCore.intelligence,
        openItemIds: state.hackingCore.intelligence.openItemIds.filter(
          (candidateId) => candidateId !== itemId,
        ),
        archivedItemIds: [
          ...state.hackingCore.intelligence.archivedItemIds,
          itemId,
        ],
        archiveRecords: [
          ...state.hackingCore.intelligence.archiveRecords,
          {
            itemId,
            archivedOnServiceDay: state.serviceDay,
            reason: 'expired-unanswered',
          },
        ],
      },
    },
  }
}

export function advanceHackingIntelligenceDay(state: CampaignState): CampaignState {
  let next = state
  for (const itemId of state.hackingCore.intelligence.openItemIds) {
    const definition = getIntelligenceDefinition(itemId)
    if (definition.kind !== 'paid') continue
    const deadline = hackingIntelligenceDeadline(state, itemId)
    const unanswered = !state.hackingCore.intelligence.answers.some(
      (answer) => answer.itemId === itemId,
    )
    if (unanswered && deadline !== null && state.serviceDay > deadline) {
      next = autoArchive(next, itemId)
    }
  }
  return syncHackingIntelligenceOpportunities(next)
}
