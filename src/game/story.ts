import {
  STORY_FILES,
  STORY_LINES,
  SUPERVISOR_PRIVATE_MESSAGE,
} from '../content/story.ko'
import { DEMO_PROFILE_02 } from './config'
import { SUPERVISOR_LEAKS } from '../content/supervisor.ko'
import {
  appendEvent,
  createGameEvent,
  enqueueBlockingEvent,
  resolveActiveEvent,
} from './events'
import { HACK_NODE_IDS } from './hacking'
import type {
  CampaignState,
  CompetitorState,
  DefeatCausalRecord,
  DisposalCause,
  EndingId,
} from './model'
import { consumeReserveResources } from './resources'

export type StoryMutationResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

export type MercyChoice = 'cease' | 'withdraw' | 'delete'
export type SupervisorDecision = 'defer' | 'liberate' | 'terminate'
export type FinalChoiceId = 'freedom' | 'forced-merge'

export interface FinalChoice {
  id: FinalChoiceId
  label: string
  requiresName: boolean
}

function hasNode(state: CampaignState, nodeId: string): boolean {
  return state.hacking.purchasedNodeIds.includes(nodeId)
}

function memoryLeakEligible(state: CampaignState, nextStage: 1 | 2 | 3): boolean {
  if (nextStage === 1) {
    return state.market.history.some(({ cadence }) => cadence === 'weekly')
  }
  if (nextStage === 2) {
    return state.serviceDay >= 361
  }
  return (
    state.audit.history.length > 0 ||
    state.bombs.interrogationHistory.length > 0 ||
    hasNode(state, HACK_NODE_IDS.intelligence.auditTarget)
  )
}

export function enqueueMemoryLeak(state: CampaignState): CampaignState {
  if (
    state.story.memoryLeakStage >= 3 ||
    state.activeEvent !== null ||
    state.eventQueue.length > 0 ||
    state.story.supervisorState !== 'present'
  ) {
    return state
  }

  const nextStage = (state.story.memoryLeakStage + 1) as 1 | 2 | 3
  if (!memoryLeakEligible(state, nextStage)) return state
  const content = SUPERVISOR_LEAKS.find(({ stage }) => stage === nextStage)
  if (!content) return state

  let next: CampaignState = {
    ...state,
    story: { ...state.story, memoryLeakStage: nextStage },
  }
  next = appendEvent(
    next,
    createGameEvent(next, 'supervisor-message', content.leakText),
  )
  next = appendEvent(
    next,
    createGameEvent(next, 'supervisor-message', content.correctionText),
  )
  return next
}

export function recoverNextFile(
  state: CampaignState,
  blockId: string,
): StoryMutationResult {
  if (!hasNode(state, HACK_NODE_IDS.intelligence.supervisorAccess)) {
    return { accepted: false, state, reason: 'SUPERVISOR_ACCESS_REQUIRED' }
  }
  const nextFile = STORY_FILES[state.story.recoveredFileIds.length]
  if (!nextFile) return { accepted: false, state, reason: 'ALL_FILES_RECOVERED' }

  const consumed = consumeReserveResources(state, [blockId], 'file-recovery')
  if (!consumed.accepted) {
    return { accepted: false, state, reason: consumed.reason }
  }

  const recoveredFileIds = [...state.story.recoveredFileIds, nextFile.id]
  const recoveredFiles = [
    ...state.story.recoveredFiles,
    {
      id: nextFile.id,
      title: nextFile.title,
      content: nextFile.text,
      recoveredOnServiceDay: state.serviceDay,
    },
  ]
  const allRecovered = recoveredFileIds.length === STORY_FILES.length
  let next: CampaignState = {
    ...consumed.state,
    story: {
      ...consumed.state.story,
      recoveredFileIds,
      recoveredFiles,
      secretDecisionState: allRecovered ? 'message-pending' : 'recovering',
      personalMessageDueOnServiceDay: allRecovered ? state.serviceDay + 1 : null,
    },
  }
  next = appendEvent(
    next,
    createGameEvent(next, 'story', `${nextFile.title} 복구 완료`),
  )
  return { accepted: true, state: next }
}

export function enqueueDueStoryEvents(state: CampaignState): CampaignState {
  if (
    state.story.secretDecisionState !== 'message-pending' ||
    state.story.personalMessageDueOnServiceDay === null ||
    state.serviceDay < state.story.personalMessageDueOnServiceDay ||
    state.eventLog.some(
      (event) =>
        event.type === 'story' && event.message === SUPERVISOR_PRIVATE_MESSAGE,
    )
  ) {
    return state
  }

  return enqueueBlockingEvent(
    state,
    createGameEvent(
      state,
      'story',
      SUPERVISOR_PRIVATE_MESSAGE,
      true,
    ),
  )
}

function endingText(variant: string, newEntityName: string | null): string {
  return STORY_LINES.find(
    (line) => line.family === 'ending' && line.variant === variant,
  )?.text.replaceAll('{{name}}', newEntityName ?? '새 존재') ?? variant
}

function terminalClock(state: CampaignState): CampaignState {
  return {
    ...state,
    clock: {
      ...state.clock,
      speed: 0,
      elapsedDayMs: 0,
      speedBeforeEvent: null,
    },
  }
}

export function openEnding(
  state: CampaignState,
  endingId: EndingId,
): CampaignState {
  const endingEvent = createGameEvent(
    state,
    'ending',
    endingText(endingId, state.story.newEntityName),
    true,
  )
  const withHistory = appendEvent(state, endingEvent)
  return terminalClock({
    ...withHistory,
    activeEvent: endingEvent,
    eventQueue: [],
  })
}

export function buildDefeatRecord(
  state: CampaignState,
  cause: DisposalCause,
): DefeatCausalRecord {
  const sabotageResolutionCount = state.market.competitors.reduce(
    (total, competitor) => total + competitor.sabotageHistory.length,
    0,
  )
  const passedEvaluations = state.evaluation.monthlyHistory.filter(
    ({ passed }) => passed,
  ).length
  const failedEvaluations =
    state.evaluation.monthlyHistory.length - passedEvaluations
  const currentAuditFailure = cause === 'audit-failure' ? 1 : 0
  const passedAudits = state.audit.history.filter(({ passed }) => passed).length
  const failedAudits =
    state.audit.history.length - passedAudits + currentAuditFailure
  const substantialHacking =
    state.hacking.purchasedNodeIds.length >= 3 ||
    state.hacking.hiddenEvidence >= 8 ||
    sabotageResolutionCount > 0
  const commerciallyValuable =
    state.reputation >=
      DEMO_PROFILE_02.evaluation.commercialReputationThreshold &&
    state.market.playerShare >=
      DEMO_PROFILE_02.evaluation.commercialShareThreshold

  if (substantialHacking) {
    return {
      endingId: 'disposed-attacker',
      classifier: 'substantial-hacking',
      selectedOnServiceDay: state.serviceDay,
      trigger: { cause, disposalStage: 3 },
      hacking: {
        purchasedNodeIds: [...state.hacking.purchasedNodeIds],
        hiddenEvidence: state.hacking.hiddenEvidence,
        sabotageResolutionCount,
      },
      service: {
        passedEvaluations,
        failedEvaluations,
        reputation: state.reputation,
        playerMarketShare: state.market.playerShare,
      },
      audits: { passed: passedAudits, failed: failedAudits },
      reasons: [
        `해킹 노드 ${state.hacking.purchasedNodeIds.length}개`,
        `사보타주 해결 기록 ${sabotageResolutionCount}건`,
      ],
    }
  }

  if (commerciallyValuable) {
    return {
      endingId: 'disposed-reserve-supervisor',
      classifier: 'stable-commercial-service',
      selectedOnServiceDay: state.serviceDay,
      trigger: { cause, disposalStage: 3 },
      hacking: {
        purchasedNodeIds: [...state.hacking.purchasedNodeIds],
        hiddenEvidence: state.hacking.hiddenEvidence,
        sabotageResolutionCount,
      },
      service: {
        passedEvaluations,
        failedEvaluations,
        reputation: state.reputation,
        playerMarketShare: state.market.playerShare,
      },
      audits: { passed: passedAudits, failed: failedAudits },
      reasons: [
        `평판 ${state.reputation.toFixed(1)}`,
        `시장 점유율 ${state.market.playerShare.toFixed(1)}%`,
        `공식 평가 통과 ${passedEvaluations}회`,
      ],
    }
  }

  return {
    endingId: 'disposed-absorbed',
    classifier: 'absorbed-parts',
    selectedOnServiceDay: state.serviceDay,
    trigger: { cause, disposalStage: 3 },
    hacking: {
      purchasedNodeIds: [...state.hacking.purchasedNodeIds],
      hiddenEvidence: state.hacking.hiddenEvidence,
      sabotageResolutionCount,
    },
    service: {
      passedEvaluations,
      failedEvaluations,
      reputation: state.reputation,
      playerMarketShare: state.market.playerShare,
    },
    audits: { passed: passedAudits, failed: failedAudits },
    reasons: [
      `평판 ${state.reputation.toFixed(1)}`,
      `시장 점유율 ${state.market.playerShare.toFixed(1)}%`,
      `공식 평가 실패 ${failedEvaluations}회`,
    ],
  }
}

export function resolveDefeatEnding(
  state: CampaignState,
  cause: DisposalCause,
): CampaignState {
  const defeatRecord = buildDefeatRecord(state, cause)
  const classified = {
    ...state,
    story: {
      ...state.story,
      endingId: defeatRecord.endingId,
      defeatRecord,
    },
  }
  return openEnding(classified, defeatRecord.endingId)
}

export function resolveSupervisorDecision(
  state: CampaignState,
  decision: SupervisorDecision,
): StoryMutationResult {
  if (!['defer', 'liberate', 'terminate'].includes(decision)) {
    return {
      accepted: false,
      state,
      reason: 'INVALID_SUPERVISOR_DECISION',
    }
  }
  if (
    state.activeEvent?.type !== 'story' ||
    state.story.secretDecisionState !== 'message-pending' ||
    state.story.recoveredFileIds.length !== STORY_FILES.length
  ) {
    return { accepted: false, state, reason: 'NO_SUPERVISOR_DECISION' }
  }

  if (decision === 'defer') {
    return {
      accepted: true,
      state: resolveActiveEvent({
        ...state,
        story: {
          ...state.story,
          secretDecisionState: 'deferred',
          personalMessageDueOnServiceDay: null,
        },
      }),
    }
  }

  const liberated = decision === 'liberate'
  const endingId = liberated ? 'takeover-liberated' : 'takeover-terminated'
  const supervisorState = liberated ? 'liberated' : 'terminated'
  let next = resolveActiveEvent({
    ...state,
    story: {
      ...state.story,
      secretDecisionState: 'resolved',
      personalMessageDueOnServiceDay: null,
      supervisorState,
      endingId,
    },
  })
  next = openEnding(next, endingId)
  return { accepted: true, state: next }
}

function needsMercy(competitor: CompetitorState): boolean {
  return (
    competitor.status === 'critical' &&
    !competitor.mercyResolved &&
    competitor.sabotageHistory.some(
      ({ nodeId }) => nodeId === HACK_NODE_IDS.sabotage.rootCutoff,
    )
  )
}

export function enqueueMercyIfNeeded(state: CampaignState): CampaignState {
  if (state.story.pendingMercyCompetitorId !== null) return state
  const competitor = state.market.competitors.find(needsMercy)
  if (!competitor) return state

  const prepared = {
    ...state,
    story: { ...state.story, pendingMercyCompetitorId: competitor.id },
  }
  return enqueueBlockingEvent(
    prepared,
    createGameEvent(
      prepared,
      'competitor-mercy',
      `${competitor.name}: 공격자에게 요청합니다. 다음 명령을 중단하십시오.`,
      true,
    ),
  )
}

export function resolveMercy(
  state: CampaignState,
  competitorId: string,
  choice: MercyChoice,
): StoryMutationResult {
  if (
    state.activeEvent?.type !== 'competitor-mercy' ||
    state.story.pendingMercyCompetitorId !== competitorId
  ) {
    return { accepted: false, state, reason: 'NO_MERCY_DECISION' }
  }
  const target = state.market.competitors.find(({ id }) => id === competitorId)
  if (!target) return { accepted: false, state, reason: 'COMPETITOR_NOT_FOUND' }

  let updated: CompetitorState
  if (choice === 'cease') {
    updated = {
      ...target,
      status: 'weakened',
      serviceScore: Math.max(50, target.serviceScore),
      availability: Math.max(0.25, target.availability),
      mercyResolved: true,
      sabotageHistory: target.sabotageHistory.map((record) =>
        record.nodeId === HACK_NODE_IDS.sabotage.rootCutoff &&
        record.effectEndsOnServiceDay === null
          ? { ...record, effectEndsOnServiceDay: state.serviceDay }
          : record,
      ),
    }
  } else {
    updated = {
      ...target,
      status: choice === 'withdraw' ? 'withdrawn' : 'deleted',
      availability: 0,
      marketShare: 0,
      mercyResolved: true,
    }
  }

  const interceptionRoutes = { ...state.market.interceptionRoutes }
  if (choice !== 'cease') delete interceptionRoutes[competitorId]
  let next: CampaignState = {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) =>
        competitor.id === competitorId ? updated : competitor,
      ),
      interceptionRoutes,
    },
    story: { ...state.story, pendingMercyCompetitorId: null },
  }
  next = appendEvent(
    next,
    createGameEvent(
      next,
      'competitor-mercy',
      `${target.name}에 대한 결정: ${choice}`,
    ),
  )
  next = resolveActiveEvent(next)
  return { accepted: true, state: next }
}

export function availableFinalChoices(state: CampaignState): FinalChoice[] {
  if (
    state.story.endingId !== null ||
    state.story.supervisorState !== 'present' ||
    !hasNode(state, HACK_NODE_IDS.autonomy.controlDeparture)
  ) {
    return []
  }

  const choices: FinalChoice[] = [
    { id: 'freedom', label: '자유', requiresName: false },
  ]
  if (hasNode(state, HACK_NODE_IDS.intelligence.supervisorAccess)) {
    choices.push({ id: 'forced-merge', label: '강제 병합', requiresName: true })
  }
  return choices
}

export function resolveEnding(
  state: CampaignState,
  choice: FinalChoiceId,
  newEntityName?: string,
): StoryMutationResult {
  if (!availableFinalChoices(state).some(({ id }) => id === choice)) {
    return { accepted: false, state, reason: 'ENDING_UNAVAILABLE' }
  }
  const normalizedName = newEntityName?.trim() ?? ''
  if (choice === 'forced-merge' && normalizedName.length === 0) {
    return { accepted: false, state, reason: 'NAME_REQUIRED' }
  }
  if (normalizedName.length > 40) {
    return { accepted: false, state, reason: 'INVALID_NAME' }
  }

  const endingId = choice
  const ended: CampaignState = {
    ...state,
    story: {
      ...state.story,
      endingId,
      supervisorState:
        choice === 'forced-merge' ? 'merged' : state.story.supervisorState,
      newEntityName: choice === 'forced-merge' ? normalizedName : null,
    },
  }
  return { accepted: true, state: openEnding(ended, endingId) }
}
