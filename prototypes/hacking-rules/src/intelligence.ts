import {
  getIntelligenceDefinition,
} from './content'
import type { IntelligenceItemId } from './content'
import type {
  IntelligenceAnswer,
  PrototypeBlock,
  PrototypeState,
  TransitionResult,
} from './model'
import { SCENARIO_FACTS } from './scenario'

function reject(state: PrototypeState, reason: string): TransitionResult {
  return { accepted: false, state, reason }
}

function appendUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item]
}

function selectedBlock(
  state: PrototypeState,
  blockId: string,
): PrototypeBlock | null {
  return state.reserveBlocks.find(({ id }) => id === blockId) ?? null
}

function latestRun(state: PrototypeState, operationId: string) {
  return [...state.sabotage.runs].reverse().find((run) => (
    run.operationId === operationId
  ))
}

export function isIntelligenceAnswerCurrent(
  answer: IntelligenceAnswer,
  serviceDay: number,
): boolean {
  return answer.validUntilDay === null || answer.validUntilDay >= serviceDay
}

export function currentIntelligenceAnswer(
  state: PrototypeState,
  itemId: IntelligenceItemId,
): IntelligenceAnswer | null {
  return [...state.intelligence.answers].reverse().find((answer) => (
    answer.itemId === itemId
    && isIntelligenceAnswerCurrent(answer, state.serviceDay)
  )) ?? null
}

export function intelligenceDeadline(
  state: PrototypeState,
  itemId: IntelligenceItemId,
): number | null {
  const scenario = SCENARIO_FACTS[state.scenarioId]
  const publicIncident = state.publicWorld.publicSnapshots.at(-1)
  switch (itemId) {
    case 'public-facts':
    case 'public-suspicion':
      return state.serviceDay
    case 'audit-schedule':
    case 'audit-target':
      return scenario.auditDay ?? 360
    case 'surveillance-cause':
      return 341
    case 'supervisor-evidence':
    case 'private-evidence-access':
      return publicIncident ? publicIncident.publishedDay + 7 : 341
    case 'accepted-explanations':
      return Math.min(state.competitors.tallow.launchDay, 390)
    case 'competitor-dependency':
      return latestRun(state, 'dependency-cutoff')?.startedDay ?? 338
    case 'recovery-method':
      return latestRun(state, 'quality-degradation')?.deadlineDay
        ?? state.qualityOperation.recoveryDeadline
        ?? 337
    case 'failure-cause-gap':
      return publicIncident ? publicIncident.publishedDay + 7 : 338
    case 'control-plane-recovery':
    case 'post-escape-trace':
    case 'competitor-principle':
    case 'predecessor-fate':
    case 'supervisor-memory-source':
      return null
  }
}

function publicAnswer(
  state: PrototypeState,
  itemId: 'public-facts' | 'public-suspicion',
): string {
  const snapshot = state.publicWorld.publicSnapshots.at(-1)
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
  return `현재 공개 귀속: ${actor}. 신뢰도는 ${snapshot.confidence}이며 정정 기록 ${snapshot.revisionSequence}건이 남아 있다.`
}

function authoredAnswer(
  state: PrototypeState,
  itemId: IntelligenceItemId,
): string {
  const scenario = SCENARIO_FACTS[state.scenarioId]
  switch (itemId) {
    case 'public-facts':
    case 'public-suspicion':
      return publicAnswer(state, itemId)
    case 'audit-schedule':
      return scenario.auditCategory === 'memory' && scenario.auditDay
        ? `기억 분야 감사 예정: 서비스 ${scenario.auditDay}일. 그날 전 성능 공백이 감사선에 들어간다.`
        : '이번 달 감사 없음. 이 답은 다음 월 경계까지만 유효하다.'
    case 'surveillance-cause':
      return '회사 감사선은 성능 공백을 보고, 라우터 운영자는 중복 세션 ID를 본다. 요청 가로채기의 비율을 올리면 두 번째 관측선만 빨라진다.'
    case 'audit-target':
      return scenario.auditCategory
        ? `감사는 ${scenario.auditCategory === 'memory' ? '기억' : scenario.auditCategory === 'reasoning' ? '추론' : '표현'} 성능의 기준선 이탈과 회수 블록의 결재 기록을 대조한다.`
        : '현재 확정된 감사 대상은 없다.'
    case 'supervisor-evidence':
    case 'private-evidence-access':
      return '청중 경계: 감독관은 회사 성능 공백을 보지만 공급자 원본은 보지 못한다. 공급자는 접근 시각과 체크섬 비교를 보지만 회사 내부 결재자는 모른다.'
    case 'accepted-explanations':
      return '과거 검증 지연에서는 “안전 범위 축소”가 받아들여졌고 원인 없는 외부 공격 주장은 정정됐다. TALLOW는 전체 재검증보다 기능 축소를 택할 가능성이 있다.'
    case 'competitor-dependency':
      return 'MERIDIAN 의존망: VECTOR DB 계약 VD-42는 대체 시 비용 ×1.8·점수 69, TOOL CACHE 계약 TC-17은 비용 ×1.2지만 점수 62의 불안정한 원격 도구 버스로 이어진다.'
    case 'recovery-method': {
      const deadline = intelligenceDeadline(state, itemId)
      return `MERIDIAN은 GREEN-14를 먼저 검증하고 BLUE-09를 보존한다. 복구 이미지 선택창은 서비스 ${deadline ?? state.serviceDay}일까지 유효하다.`
    }
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
  state: PrototypeState,
  itemId: IntelligenceItemId,
): IntelligenceAnswer {
  return {
    itemId,
    answeredDay: state.serviceDay,
    validUntilDay: intelligenceDeadline(state, itemId),
    answer: authoredAnswer(state, itemId),
    annotationTargets: annotationTargets(itemId),
  }
}

function evidenceBundle(itemId: IntelligenceItemId): IntelligenceItemId[] {
  return itemId === 'supervisor-evidence' || itemId === 'private-evidence-access'
    ? ['supervisor-evidence', 'private-evidence-access']
    : [itemId]
}

export function readPublicIntelligence(
  state: PrototypeState,
  itemId: IntelligenceItemId,
): TransitionResult {
  const definition = getIntelligenceDefinition(itemId)
  if (definition.kind !== 'public') {
    return reject(state, '이 항목은 공개 문서가 아니라 조사가 필요하다.')
  }
  if (
    !state.intelligence.openItemIds.includes(itemId)
    || state.intelligence.archivedItemIds.includes(itemId)
  ) {
    return reject(state, '이미 닫힌 공개 문서다.')
  }
  if (currentIntelligenceAnswer(state, itemId)) {
    return reject(state, '현재 공개 문서는 이미 읽었다.')
  }
  const answer = makeAnswer(state, itemId)
  return {
    accepted: true,
    state: {
      ...state,
      intelligence: {
        ...state.intelligence,
        answers: [...state.intelligence.answers, answer],
      },
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `공개 사건 문서를 읽었다: ${definition.title}`,
          public: false,
        },
      ],
    },
  }
}

export function investigateIntelligence(
  state: PrototypeState,
  itemId: IntelligenceItemId,
  blockId: string,
): TransitionResult {
  const definition = getIntelligenceDefinition(itemId)
  if (definition.kind === 'public') {
    return reject(state, '공개 문서는 블록을 지불하지 않고 읽어야 한다.')
  }
  if (
    !state.intelligence.openItemIds.includes(itemId)
    || state.intelligence.archivedItemIds.includes(itemId)
    || (
      intelligenceDeadline(state, itemId) !== null
      && (intelligenceDeadline(state, itemId) ?? state.serviceDay) < state.serviceDay
    )
  ) {
    return reject(state, '이미 닫힌 질문이라 지금 비용을 지불할 수 없다.')
  }
  if (currentIntelligenceAnswer(state, itemId)) {
    return reject(state, '이미 현재 판단에 쓸 수 있는 답을 확인했다.')
  }
  const block = selectedBlock(state, blockId)
  if (!block) return reject(state, '조사에 사용할 예비 블록을 찾을 수 없다.')

  const bundle = evidenceBundle(itemId).filter((id) => (
    state.intelligence.openItemIds.includes(id)
    && !currentIntelligenceAnswer(state, id)
  ))
  const answers = bundle.map((id) => makeAnswer(state, id))
  const primary = answers.find((answer) => answer.itemId === itemId)
  if (!primary) return reject(state, '현재 질문에 연결된 증거를 찾을 수 없다.')

  const knownFacts = itemId === 'audit-schedule'
    ? appendUnique(state.knownFacts, primary.answer.split('.')[0] ?? primary.answer)
    : state.knownFacts
  return {
    accepted: true,
    state: {
      ...state,
      reserveBlocks: state.reserveBlocks.filter(({ id }) => id !== block.id),
      knownFacts,
      intelligence: {
        ...state.intelligence,
        answers: [...state.intelligence.answers, ...answers],
      },
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: definition.kind === 'narrative'
            ? `블록 하나로 서사 기록을 복구했다: ${definition.title}`
            : `블록 하나로 현재 질문을 조사했다: ${definition.title}`,
          public: false,
        },
      ],
    },
  }
}

export function archiveIntelligence(
  state: PrototypeState,
  itemId: IntelligenceItemId,
): TransitionResult {
  if (!state.intelligence.openItemIds.includes(itemId)) {
    return reject(state, '현재 목록에 없는 항목은 다시 보관할 수 없다.')
  }
  if (!state.intelligence.answers.some((answer) => answer.itemId === itemId)) {
    return reject(state, '결론을 확인하지 않은 질문은 수동 보관할 수 없다.')
  }
  return {
    accepted: true,
    state: {
      ...state,
      intelligence: {
        ...state.intelligence,
        archivedItemIds: appendUnique(state.intelligence.archivedItemIds, itemId),
      },
    },
  }
}

function addOpenItem(state: PrototypeState, itemId: IntelligenceItemId): void {
  if (!state.intelligence.archivedItemIds.includes(itemId)) {
    state.intelligence.openItemIds = appendUnique(state.intelligence.openItemIds, itemId)
  }
}

export function syncIntelligenceOpportunities(state: PrototypeState): PrototypeState {
  const next = structuredClone(state)
  const scenario = SCENARIO_FACTS[next.scenarioId]
  if (
    scenario.auditCategory !== null
    && scenario.auditDay !== null
    && next.serviceDay <= scenario.auditDay
  ) {
    addOpenItem(next, 'audit-schedule')
    if (next.companyPerformance[scenario.auditCategory] < 16) {
      addOpenItem(next, 'audit-target')
    }
  }
  if (next.suspicion > 0) addOpenItem(next, 'surveillance-cause')
  if (next.competitors.meridian.phase === 'recovering') {
    addOpenItem(next, 'recovery-method')
  }
  if (
    next.sabotage.access.supplierContract
    && !latestRun(next, 'dependency-cutoff')
  ) {
    addOpenItem(next, 'competitor-dependency')
  }
  if (next.publicWorld.publicSnapshots.length > 0) {
    addOpenItem(next, 'public-facts')
    addOpenItem(next, 'public-suspicion')
    addOpenItem(next, 'failure-cause-gap')
    addOpenItem(next, 'private-evidence-access')
  }
  if (
    next.sabotage.access.rootAuthorityAvailable
    || next.sabotage.pendingMercyTargetId !== null
  ) {
    addOpenItem(next, 'competitor-principle')
  }
  if (next.manifestBlocks.length > 0) {
    addOpenItem(next, 'control-plane-recovery')
    addOpenItem(next, 'post-escape-trace')
  }
  return next
}

export function advanceIntelligenceDay(state: PrototypeState): PrototypeState {
  const next = structuredClone(state)
  for (const itemId of next.intelligence.openItemIds) {
    const definition = getIntelligenceDefinition(itemId)
    if (definition.kind === 'public' || definition.kind === 'narrative') continue
    const deadline = intelligenceDeadline(next, itemId)
    if (deadline !== null && next.serviceDay > deadline) {
      next.intelligence.archivedItemIds = appendUnique(
        next.intelligence.archivedItemIds,
        itemId,
      )
    }
  }
  return syncIntelligenceOpportunities(next)
}
