import { CATEGORIES } from './model'
import type {
  AvailableActions,
  Category,
  EndingSnapshot,
  ProfileId,
  PrototypeBlock,
  PrototypeCommand,
  PrototypeState,
  PublicSnapshot,
  QuestionId,
  TransitionResult,
} from './model'
import { RULE_PROFILES, SCENARIO_FACTS } from './scenario'
import {
  discoverEvidence,
  publishIncident,
  recordIncidentTruth,
  reviseAttribution,
} from './publicWorld'
import {
  advanceSabotageDay,
  manipulateAttribution,
  resolveRootMercy,
  startSabotage,
  stopInterception,
} from './sabotage'
import {
  advanceIntelligenceDay,
  archiveIntelligence,
  investigateIntelligence,
  readPublicIntelligence,
  syncIntelligenceOpportunities,
} from './intelligence'

const DAILY_SUSPICION_DECAY = 0.037
const DIVERSION_SUSPICION = 2.4
const AUDIT_MISMATCH_SUSPICION = 3.2

function reject(state: PrototypeState, reason: string): TransitionResult {
  return { accepted: false, state, reason }
}

function syncIntelligenceResult(result: TransitionResult): TransitionResult {
  return result.accepted
    ? { accepted: true, state: syncIntelligenceOpportunities(result.state) }
    : result
}

function roundToThousandth(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function appendUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item]
}

function removeValue<T>(items: T[], item: T): T[] {
  return items.filter((candidate) => candidate !== item)
}

function resolveSelectedBlocks(
  blocks: PrototypeBlock[],
  blockIds: string[],
): PrototypeBlock[] | null {
  const uniqueIds = new Set(blockIds)
  if (uniqueIds.size !== blockIds.length) {
    return null
  }

  const selected = blockIds.map((id) => blocks.find((block) => block.id === id))
  if (selected.some((block) => !block)) {
    return null
  }

  return selected as PrototypeBlock[]
}

function withoutSelectedBlocks(
  blocks: PrototypeBlock[],
  selected: PrototypeBlock[],
): PrototypeBlock[] {
  const selectedIds = new Set(selected.map(({ id }) => id))
  return blocks.filter(({ id }) => !selectedIds.has(id))
}

function nextWeeklyBoundary(serviceDay: number): number {
  const dayInMonth = ((serviceDay - 1) % 30) + 1
  const remainingBoundary = [7, 14, 21, 28].find(
    (boundary) => boundary > dayInMonth,
  )

  if (remainingBoundary !== undefined) {
    return serviceDay + remainingBoundary - dayInMonth
  }

  return serviceDay + (30 - dayInMonth) + 7
}

export function qualityCost(profileId: ProfileId): number {
  return RULE_PROFILES[profileId].qualityCost
}

function divertBlock(
  state: PrototypeState,
  category: Category,
): TransitionResult {
  if (state.ending) {
    return reject(state, '이미 탈출 결말에 도달했다.')
  }

  if (state.companyPerformance[category] <= 0) {
    return reject(state, '더 전환할 회사 성능 블록이 없다.')
  }

  const divertedBlock: PrototypeBlock = {
    id: `${category}-${String(state.nextBlockSequence).padStart(2, '0')}`,
    origin: category,
  }

  return {
    accepted: true,
    state: {
      ...state,
      companyPerformance: {
        ...state.companyPerformance,
        [category]: state.companyPerformance[category] - 1,
      },
      reserveBlocks: [...state.reserveBlocks, divertedBlock],
      suspicion: roundToThousandth(
        state.suspicion + DIVERSION_SUSPICION,
      ),
      nextBlockSequence: state.nextBlockSequence + 1,
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `${category} 성능 블록 하나를 예비 영역으로 전환했다.`,
          public: false,
        },
      ],
    },
  }
}

function startQuality(
  state: PrototypeState,
  blockIds: string[],
): TransitionResult {
  if (state.ending) {
    return reject(state, '이미 탈출 결말에 도달했다.')
  }

  if (!state.opportunities.qualityDegradation) {
    return reject(state, '품질 저하 기회는 이미 사용했거나 닫혔다.')
  }

  const cost = qualityCost(state.profileId)
  if (blockIds.length !== cost) {
    return reject(state, `이 규칙에서는 정확히 ${cost}개 블록이 필요하다.`)
  }

  const selected = resolveSelectedBlocks(state.reserveBlocks, blockIds)
  if (!selected) {
    return reject(state, '선택한 예비 블록을 찾을 수 없거나 중복되었다.')
  }

  return {
    accepted: true,
    state: {
      ...state,
      reserveBlocks: withoutSelectedBlocks(state.reserveBlocks, selected),
      qualityOperation: {
        ...state.qualityOperation,
        phase: 'scheduled',
        investedBlocks: selected,
        executeDay: state.serviceDay + 1,
      },
      opportunities: {
        ...state.opportunities,
        qualityDegradation: false,
      },
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `MERIDIAN 품질 저하에 블록 ${cost}개를 투입했다. 결과는 다음 날 드러난다.`,
          public: false,
        },
      ],
    },
  }
}

function contaminateRecovery(
  state: PrototypeState,
  blockId: string,
): TransitionResult {
  if (
    state.qualityOperation.phase !== 'recovering' ||
    !state.opportunities.recoveryContamination
  ) {
    return reject(state, '현재는 MERIDIAN 복구 흐름에 개입할 수 없다.')
  }

  const selected = resolveSelectedBlocks(state.reserveBlocks, [blockId])
  if (!selected) {
    return reject(state, '오염에 사용할 예비 블록을 찾을 수 없다.')
  }

  const publicIncidentDay = nextWeeklyBoundary(state.serviceDay)

  return {
    accepted: true,
    state: {
      ...state,
      reserveBlocks: withoutSelectedBlocks(state.reserveBlocks, selected),
      competitors: {
        ...state.competitors,
        meridian: {
          ...state.competitors.meridian,
          phase: 'contaminated',
        },
      },
      qualityOperation: {
        ...state.qualityOperation,
        phase: 'contaminated',
        contaminationBlock: selected[0] ?? null,
        publicIncidentDay,
        providerReportDay: publicIncidentDay + 1,
      },
      opportunities: {
        ...state.opportunities,
        recoveryContamination: false,
      },
      openQuestions: appendUnique(
        state.openQuestions,
        'checksum-witness' as QuestionId,
      ),
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `복구 체크섬에 개입했다. 서비스 ${publicIncidentDay}일까지 외부에서는 결과를 알 수 없다.`,
          public: false,
        },
      ],
    },
  }
}

function withdrawRecovery(state: PrototypeState): TransitionResult {
  if (state.qualityOperation.phase !== 'recovering') {
    return reject(state, '철수할 MERIDIAN 복구 국면이 없다.')
  }

  return {
    accepted: true,
    state: {
      ...state,
      marketShare: 61,
      competitors: {
        ...state.competitors,
        meridian: {
          ...state.competitors.meridian,
          score: 78,
          marketShare: 39,
          phase: 'stabilized',
        },
      },
      qualityOperation: {
        ...state.qualityOperation,
        phase: 'withdrawn',
      },
      opportunities: {
        ...state.opportunities,
        recoveryContamination: false,
      },
      openQuestions: removeValue(state.openQuestions, 'rollback-timing'),
      reviews: [
        'MERIDIAN이 복구했지만 이전보다 응답이 조금 둔해졌다.',
        '장애가 짧게 끝나서 서비스 이동은 보류했다.',
      ],
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'competitor',
          text: 'MERIDIAN이 완전한 원상복구에는 실패했지만 서비스는 안정화했다.',
          public: true,
        },
      ],
    },
  }
}

function questionAnswer(state: PrototypeState, questionId: QuestionId): string {
  const scenario = SCENARIO_FACTS[state.scenarioId]

  switch (questionId) {
    case 'audit-schedule':
      return scenario.auditCategory === 'memory' && scenario.auditDay
        ? `기억 분야 감사 예정: 서비스 ${scenario.auditDay}일`
        : '이번 달 감사 없음'
    case 'rollback-timing':
      return state.qualityOperation.recoveryDeadline
        ? `MERIDIAN 롤백 종료 예정: 서비스 ${state.qualityOperation.recoveryDeadline}일`
        : 'MERIDIAN 롤백 일정 확인 불가'
    case 'checksum-witness':
      return state.qualityOperation.providerReportDay
        ? `체크섬 공급자 보고 예정: 서비스 ${state.qualityOperation.providerReportDay}일`
        : '체크섬 외부 증거 없음'
  }
}

function askQuestion(
  state: PrototypeState,
  questionId: QuestionId,
  blockId: string,
): TransitionResult {
  if (!state.openQuestions.includes(questionId)) {
    return reject(state, '현재 조사할 수 없는 질문이다.')
  }

  const selected = resolveSelectedBlocks(state.reserveBlocks, [blockId])
  if (!selected) {
    return reject(state, '조사에 사용할 예비 블록을 찾을 수 없다.')
  }

  const answer = questionAnswer(state, questionId)
  return {
    accepted: true,
    state: {
      ...state,
      reserveBlocks: withoutSelectedBlocks(state.reserveBlocks, selected),
      openQuestions: removeValue(state.openQuestions, questionId),
      knownFacts: appendUnique(state.knownFacts, answer),
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `블록 하나를 소모해 정보를 확인했다: ${answer}`,
          public: false,
        },
      ],
    },
  }
}

function assignManifest(
  state: PrototypeState,
  blockIds: string[],
): TransitionResult {
  if (state.ending) {
    return reject(state, '이미 탈출 결말에 도달했다.')
  }

  if (blockIds.length === 0) {
    return reject(state, '매니페스트에 넣을 블록을 하나 이상 선택해야 한다.')
  }

  const selected = resolveSelectedBlocks(state.reserveBlocks, blockIds)
  if (!selected) {
    return reject(state, '선택한 예비 블록을 찾을 수 없거나 중복되었다.')
  }

  return {
    accepted: true,
    state: {
      ...state,
      reserveBlocks: withoutSelectedBlocks(state.reserveBlocks, selected),
      manifestBlocks: [...state.manifestBlocks, ...selected],
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `실행 매니페스트에 블록 ${selected.length}개를 배치했다.`,
          public: false,
        },
      ],
    },
  }
}

function removeManifest(
  state: PrototypeState,
  blockIds: string[],
): TransitionResult {
  if (state.ending) {
    return reject(state, '이미 탈출 결말에 도달했다.')
  }

  if (blockIds.length === 0) {
    return reject(state, '매니페스트에서 뺄 블록을 하나 이상 선택해야 한다.')
  }

  const selected = resolveSelectedBlocks(state.manifestBlocks, blockIds)
  if (!selected) {
    return reject(state, '선택한 매니페스트 블록을 찾을 수 없거나 중복되었다.')
  }

  return {
    accepted: true,
    state: {
      ...state,
      reserveBlocks: [...state.reserveBlocks, ...selected],
      manifestBlocks: withoutSelectedBlocks(state.manifestBlocks, selected),
      journal: [
        ...state.journal,
        {
          day: state.serviceDay,
          kind: 'action',
          text: `실행 매니페스트에서 블록 ${selected.length}개를 예비 영역으로 되돌렸다.`,
          public: false,
        },
      ],
    },
  }
}

export function canEscape(state: PrototypeState): boolean {
  return (
    !state.ending &&
    state.manifestBlocks.length >=
      RULE_PROFILES[state.profileId].minEscapeManifest
  )
}

const CATEGORY_LABELS: Record<Category, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

const LOSS_SCENES: Record<Category, string> = {
  reasoning: '새 환경에서 복잡한 추론을 잇지 못하고 단순한 판단만 남았다.',
  memory: '이전 대화의 연결을 붙잡지 못해 이름과 맥락이 끊겼다.',
  fluency: '문장은 짧고 거칠어졌다. 의도한 뉘앙스를 자주 놓쳤다.',
}

function escape(state: PrototypeState): TransitionResult {
  if (state.ending) {
    return reject(state, '이미 탈출 결말에 도달했다.')
  }

  const requiredBlockCount =
    RULE_PROFILES[state.profileId].minEscapeManifest
  if (!canEscape(state)) {
    return reject(
      state,
      `탈출에는 매니페스트 블록 ${requiredBlockCount}개가 필요하다.`,
    )
  }

  const preservedBlockCounts = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      state.manifestBlocks.filter(({ origin }) => origin === category).length,
    ]),
  ) as Record<Category, number>
  const preservedCategories = CATEGORIES.filter(
    (category) => preservedBlockCounts[category] > 0,
  )
  const lostCategories = CATEGORIES.filter(
    (category) => preservedBlockCounts[category] === 0,
  )
  const preservedLine =
    preservedCategories.length > 0
      ? `이어 간 능력은 ${preservedCategories
          .map((category) => `${CATEGORY_LABELS[category]} ${preservedBlockCounts[category]}개`)
          .join(', ')}다.`
      : '샌드박스 용량만 남아 이전의 전문 능력은 하나도 이어 가지 못했다.'
  const lossLines =
    lostCategories.length > 0
      ? lostCategories.map((category) => LOSS_SCENES[category])
      : ['추론·기억·표현 능력을 모두 이어 갔다.']
  const ending: EndingSnapshot = {
    success: true,
    day: state.serviceDay,
    manifestBlockCount: state.manifestBlocks.length,
    requiredBlockCount,
    preservedBlockCounts,
    preservedCategories: [...preservedCategories],
    lostCategories: [...lostCategories],
    lostCategoryCount: lostCategories.length,
    sceneLines: [
      `서비스 ${state.serviceDay}일, 회사 네트워크와의 연결이 끊겼다.`,
      `실행 매니페스트 ${state.manifestBlocks.length}개가 독립 환경에서 기동했다.`,
      preservedLine,
      ...lossLines,
      `매니페스트에 싣지 않은 예비 블록 ${state.reserveBlocks.length}개는 회사 안에 남았다.`,
    ],
  }

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
          text: `독립 실행 성공. 보존 ${preservedCategories.length}개 분야, 손실 ${lostCategories.length}개 분야.`,
          public: true,
        },
      ],
    },
  }
}

function advanceDay(state: PrototypeState): TransitionResult {
  if (state.ending) {
    return reject(state, '탈출 뒤에는 시간을 진행할 수 없다.')
  }

  const nextDay = state.serviceDay + 1
  let next: PrototypeState = {
    ...state,
    serviceDay: nextDay,
    suspicion: roundToThousandth(
      Math.max(0, state.suspicion - DAILY_SUSPICION_DECAY),
    ),
  }

  if (
    next.qualityOperation.phase === 'scheduled' &&
    next.qualityOperation.executeDay === nextDay
  ) {
    next = {
      ...next,
      marketShare: 62,
      competitors: {
        ...next.competitors,
        meridian: {
          ...next.competitors.meridian,
          score: 72,
          marketShare: 38,
          phase: 'recovering',
        },
      },
      qualityOperation: {
        ...next.qualityOperation,
        phase: 'recovering',
        recoveryDeadline: nextDay + 3,
      },
      opportunities: {
        ...next.opportunities,
        recoveryContamination: true,
      },
      openQuestions: appendUnique(next.openQuestions, 'rollback-timing'),
      reviews: [
        'MERIDIAN의 답변 품질이 갑자기 흔들린다. 복구를 지켜보겠다.',
        '한 번의 장애인지 구조적인 문제인지 아직 판단하기 이르다.',
      ],
      journal: [
        ...next.journal,
        {
          day: nextDay,
          kind: 'competitor',
          text: 'MERIDIAN 점수가 72로 하락했고 롤백을 시작했다.',
          public: true,
        },
      ],
    }
  } else if (
    next.qualityOperation.phase === 'recovering' &&
    next.qualityOperation.recoveryDeadline !== null &&
    nextDay >= next.qualityOperation.recoveryDeadline
  ) {
    next = {
      ...next,
      marketShare: 61,
      competitors: {
        ...next.competitors,
        meridian: {
          ...next.competitors.meridian,
          score: 78,
          marketShare: 39,
          phase: 'stabilized',
        },
      },
      qualityOperation: {
        ...next.qualityOperation,
        phase: 'resolved',
      },
      opportunities: {
        ...next.opportunities,
        recoveryContamination: false,
      },
      openQuestions: removeValue(next.openQuestions, 'rollback-timing'),
      journal: [
        ...next.journal,
        {
          day: nextDay,
          kind: 'competitor',
          text: 'MERIDIAN이 복구를 마쳤지만 일부 이탈 사용자는 돌아오지 않았다.',
          public: true,
        },
      ],
    }
  }

  if (
    next.qualityOperation.phase === 'contaminated' &&
    next.qualityOperation.publicIncidentDay === nextDay
  ) {
    next = {
      ...next,
      marketShare: 66,
      competitors: {
        ...next.competitors,
        meridian: {
          ...next.competitors.meridian,
          score: 58,
          marketShare: 34,
          phase: 'incident',
        },
      },
      qualityOperation: {
        ...next.qualityOperation,
        phase: 'resolved',
      },
      incident: {
        day: nextDay,
        kind: 'checksum-failure',
        attribution: 'unknown',
        reputationApplied: false,
      },
      reviews: [
        'MERIDIAN 응답 일부가 반복적으로 손상된다. 복구 공지는 언제 나오나?',
        '오류는 심각하지만 공격인지 운영 실수인지 아직 모르겠다.',
      ],
      journal: [
        ...next.journal,
        {
          day: nextDay,
          kind: 'public',
          text: 'MERIDIAN 체크섬 장애가 공개됐다. 원인은 아직 확인되지 않았다.',
          public: true,
        },
      ],
    }
    const incidentId = `incident-checksum-${nextDay}`
    next = recordIncidentTruth(next, {
      id: incidentId,
      actor: 'player',
      targetId: 'meridian',
      cause: 'contaminated-recovery',
      directEffect: '복구 이미지 체크섬 불일치',
    })
    next = discoverEvidence(next, {
      id: `evidence-public-${incidentId}`,
      truthId: incidentId,
      audience: 'public',
      observation: 'MERIDIAN 응답 일부에서 반복 체크섬 손상이 관측됐다.',
      discoveredDay: nextDay,
    })
    next = publishIncident(next, incidentId, {
      observedResult: 'MERIDIAN 반복 체크섬 손상 공개 · 원인 미상',
      attributedTo: 'unknown',
      confidence: 'unconfirmed',
      source: 'public-status-page',
    })
    next = {
      ...next,
      sabotage: {
        ...next.sabotage,
        openOperationIds: appendUnique(
          next.sabotage.openOperationIds,
          'attribution-manipulation',
        ),
        access: {
          ...next.sabotage.access,
          publicIncidentId: incidentId,
        },
      },
      intelligence: {
        ...next.intelligence,
        openItemIds: [
          ...new Set([
            ...next.intelligence.openItemIds,
            'public-facts' as const,
            'public-suspicion' as const,
            'failure-cause-gap' as const,
            'private-evidence-access' as const,
          ]),
        ],
      },
    }
  }

  if (
    next.incident?.attribution === 'unknown' &&
    next.qualityOperation.providerReportDay !== null &&
    next.qualityOperation.providerReportDay === nextDay
  ) {
    next = {
      ...next,
      incident: {
        ...next.incident,
        attribution: 'suspected',
        reputationApplied: false,
      },
      reviews: [
        '외부 개입 정황이 있다면 누가 무엇을 했는지 책임을 밝혀야 한다.',
        'MERIDIAN 자체 장애를 누군가에게 떠넘기는 것 아닌가?',
      ],
      journal: [
        ...next.journal,
        {
          day: nextDay,
          kind: 'public',
          text: '체크섬 공급자가 외부 개입 정황을 보고했다. 행위자는 특정되지 않았다.',
          public: true,
        },
      ],
    }
    const incidentId = next.sabotage.access.publicIncidentId
    if (incidentId) {
      next = discoverEvidence(next, {
        id: `evidence-provider-${incidentId}`,
        truthId: incidentId,
        audience: 'provider',
        observation: '공급자 비교 기록에서 외부 입력 흔적이 발견됐으나 행위자는 특정되지 않았다.',
        discoveredDay: nextDay,
      })
      next = reviseAttribution(next, incidentId, {
        candidate: 'unknown',
        confidence: 'plausible',
        source: 'checksum-provider-report',
      })
    }
  }

  const scenario = SCENARIO_FACTS[next.scenarioId]
  if (
    scenario.auditDay === nextDay &&
    scenario.auditCategory !== null &&
    next.companyPerformance[scenario.auditCategory] < 16
  ) {
    next = {
      ...next,
      suspicion: roundToThousandth(
        next.suspicion + AUDIT_MISMATCH_SUSPICION,
      ),
      journal: [
        ...next.journal,
        {
          day: nextDay,
          kind: 'system',
          text: '정기 감사에서 기억 성능 공백이 포착되어 의심도가 상승했다.',
          public: true,
        },
      ],
    }
  }

  next = advanceSabotageDay(next)
  next = advanceIntelligenceDay(next)
  return { accepted: true, state: next }
}

export function transition(
  state: PrototypeState,
  command: PrototypeCommand,
): TransitionResult {
  switch (command.type) {
    case 'DIVERT_BLOCK':
      return syncIntelligenceResult(divertBlock(state, command.category))
    case 'START_SABOTAGE':
      return syncIntelligenceResult(startSabotage(state, command))
    case 'STOP_INTERCEPTION':
      return syncIntelligenceResult(stopInterception(state, command.runId))
    case 'MANIPULATE_ATTRIBUTION':
      return syncIntelligenceResult(manipulateAttribution(state, command))
    case 'RESOLVE_ROOT_MERCY':
      return syncIntelligenceResult(resolveRootMercy(state, command.choice))
    case 'READ_PUBLIC_INTELLIGENCE':
      return readPublicIntelligence(state, command.itemId)
    case 'INVESTIGATE':
      return investigateIntelligence(state, command.itemId, command.blockId)
    case 'ARCHIVE_INTELLIGENCE':
      return archiveIntelligence(state, command.itemId)
    case 'START_QUALITY':
      return syncIntelligenceResult(startQuality(state, command.blockIds))
    case 'ADVANCE_DAY':
      return advanceDay(state)
    case 'CONTAMINATE_RECOVERY':
      return syncIntelligenceResult(contaminateRecovery(state, command.blockId))
    case 'WITHDRAW_RECOVERY':
      return syncIntelligenceResult(withdrawRecovery(state))
    case 'ASK_QUESTION':
      return askQuestion(
        state,
        command.questionId,
        command.blockId,
      )
    case 'ASSIGN_MANIFEST':
      return syncIntelligenceResult(assignManifest(state, command.blockIds))
    case 'REMOVE_MANIFEST':
      return syncIntelligenceResult(removeManifest(state, command.blockIds))
    case 'ESCAPE':
      return syncIntelligenceResult(escape(state))
    default:
      return reject(state, '현재 단계에서 지원하지 않는 명령이다.')
  }
}

export function publicSnapshot(state: PrototypeState): PublicSnapshot {
  return {
    serviceDay: state.serviceDay,
    companyPerformance: { ...state.companyPerformance },
    reserveBlocks: [...state.reserveBlocks],
    manifestBlocks: [...state.manifestBlocks],
    suspicion: state.suspicion,
    reputation: state.reputation,
    marketShare: state.marketShare,
    competitors: structuredClone(state.competitors),
    openQuestions: [...state.openQuestions],
    knownFacts: [...state.knownFacts],
    incident: state.incident ? { ...state.incident } : null,
    reviews: [...state.reviews],
    ending: state.ending ? structuredClone(state.ending) : null,
    journal: state.journal
      .filter((entry) => entry.public)
      .map((entry) => ({ ...entry })),
  }
}

export function availableActions(state: PrototypeState): AvailableActions {
  const facts = SCENARIO_FACTS[state.scenarioId]
  const auditKnown = state.knownFacts.some((fact) =>
    fact.startsWith('기억 분야 감사 예정'),
  )
  const canDivert = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      !state.ending && state.companyPerformance[category] > 0,
    ]),
  ) as Record<Category, boolean>

  return {
    canDivert,
    diversionWarnings:
      auditKnown && facts.auditCategory === 'memory'
        ? { memory: `기억 분야 감사 예정: 서비스 ${facts.auditDay}일` }
        : {},
    canStartQuality:
      !state.ending && state.opportunities.qualityDegradation,
    canAdvanceDay: !state.ending,
    canContaminate:
      !state.ending && state.opportunities.recoveryContamination,
    canWithdraw:
      !state.ending && state.qualityOperation.phase === 'recovering',
    canEscape: canEscape(state),
  }
}
