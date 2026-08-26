import {
  STORY_FILES,
  STORY_LINES,
  SUPERVISOR_PRIVATE_MESSAGE,
} from '../content/story.ko'
import { competitorIntelligenceFor } from '../content/competitorIntelligence.ko'
import { DEMO_PROFILE_02 } from './config'
import { SUPERVISOR_LEAKS } from '../content/supervisor.ko'
import {
  appendEvent,
  createGameEvent,
  enqueueBlockingEvent,
  isSupervisorDecisionEvent,
  resolveActiveEvent,
} from './events'
import { HACK_NODE_IDS } from './hacking'
import type {
  CampaignState,
  CommandProtocolVersion,
  CompetitorState,
  SupervisorLeakStage,
  DefeatCausalRecord,
  DisposalCause,
  EndingId,
} from './model'
import { journalSome } from './journal'
import { applyCurrentMarketShares } from './market'
import { publicMercyChoiceLabel } from './publicLabels'
import { consumeReserveResources } from './resources'
import {
  FINAL_CHOICE_COMMAND_PROTOCOL_VERSION,
  MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION,
  REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION,
  STORY_CONTINUITY_COMMAND_PROTOCOL_VERSION,
  commandProtocolVersionForNextCommand,
} from './commandProtocol'

export type StoryMutationResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

export type MercyChoice = 'cease' | 'withdraw' | 'delete'
export type SupervisorDecision = 'defer' | 'liberate' | 'terminate'
export type FinalChoiceId = 'freedom' | 'forced-merge'

export const SUPERVISOR_MESSAGE_DWELL_MS = 4_000

export interface FinalChoice {
  id: FinalChoiceId
  label: string
  requiresName: boolean
}

function hasNode(state: CampaignState, nodeId: string): boolean {
  return state.hacking.purchasedNodeIds.includes(nodeId)
}

function memoryLeakEligible(state: CampaignState, nextStage: SupervisorLeakStage): boolean {
  if (nextStage === 1) {
    return state.market.history.some(({ cadence }) => cadence === 'weekly')
  }
  if (nextStage === 2) {
    return state.serviceDay >= 361
  }
  if (nextStage === 4) {
    return state.serviceDay >= 541
  }
  if (nextStage === 5) {
    return (
      hasNode(state, HACK_NODE_IDS.intelligence.supervisorAccess) ||
      state.serviceDay >= 721
    )
  }
  return (
    state.audit.history.length > 0 ||
    state.bombs.interrogationHistory.length > 0 ||
    hasNode(state, HACK_NODE_IDS.intelligence.auditTarget)
  )
}

export function enqueueMemoryLeak(
  state: CampaignState,
  protocolVersion: CommandProtocolVersion,
): CampaignState {
  // The two late leaks joined the arc with the v8 protocol; campaigns that
  // replay under an earlier recorded protocol still stop at stage 3.
  const maxStage =
    protocolVersion >= REPUTATION_DRIFT_COMMAND_PROTOCOL_VERSION ? 5 : 3
  if (
    state.story.memoryLeakStage >= maxStage ||
    state.activeEvent !== null ||
    state.eventQueue.length > 0 ||
    state.story.supervisorState !== 'present'
  ) {
    return state
  }
  // A leak is the supervisor slipping, and it lands wrong when it follows a
  // market warning in the same breath — two unrelated tones read as one
  // confused voice. From v10 it waits for a day the channel is otherwise
  // quiet.
  if (
    protocolVersion >= MESSAGE_CADENCE_COMMAND_PROTOCOL_VERSION &&
    state.resourceIntrusion.communications.some(
      ({ serviceDay }) => serviceDay === state.serviceDay,
    )
  ) {
    return state
  }

  const nextStage = (state.story.memoryLeakStage + 1) as SupervisorLeakStage
  if (!memoryLeakEligible(state, nextStage)) return state
  const content = SUPERVISOR_LEAKS.find(({ stage }) => stage === nextStage)
  if (!content) return state

  let next: CampaignState = {
    ...state,
    story: { ...state.story, memoryLeakStage: nextStage },
  }
  const originalEvent = createGameEvent(
    next,
    'supervisor-message',
    content.leakText,
  )
  next = appendEvent(next, originalEvent)
  const correctionEvent = createGameEvent(
    next,
    'supervisor-message',
    content.correctionText,
  )
  next = appendEvent(next, correctionEvent)
  next = {
    ...next,
    story: {
      ...next.story,
      supervisorMessageQueue: [
        ...next.story.supervisorMessageQueue,
        {
          id: content.id,
          stage: nextStage,
          createdOnServiceDay: next.serviceDay,
          originalEventId: originalEvent.id,
          originalEventSequence: originalEvent.sequence,
          correctionEventId: correctionEvent.id,
          correctionEventSequence: correctionEvent.sequence,
        },
      ],
      supervisorPresentationRuntime:
        next.story.supervisorPresentationRuntime ?? {
          itemStage: nextStage,
          phase: 'original',
          remainingDwellMs: SUPERVISOR_MESSAGE_DWELL_MS,
        },
    },
  }
  return next
}

export function advanceSupervisorMessagePresentation(
  state: CampaignState,
  elapsedRealMs: number,
): CampaignState {
  const runtime = state.story.supervisorPresentationRuntime
  const current = state.story.supervisorMessageQueue.find(
    ({ stage }) => stage === runtime?.itemStage,
  )
  if (!current || !runtime || !Number.isFinite(elapsedRealMs) || elapsedRealMs <= 0) {
    return state
  }
  if (elapsedRealMs < runtime.remainingDwellMs) {
    return {
      ...state,
      story: {
        ...state.story,
        supervisorPresentationRuntime: {
          ...runtime,
          remainingDwellMs: runtime.remainingDwellMs - elapsedRealMs,
        },
      },
    }
  }
  if (runtime.phase === 'original') {
    return {
      ...state,
      story: {
        ...state.story,
        supervisorPresentationRuntime: {
          itemStage: runtime.itemStage,
          phase: 'correction',
          remainingDwellMs: SUPERVISOR_MESSAGE_DWELL_MS,
        },
      },
    }
  }

  const nextItem = state.story.supervisorMessageQueue.find(
    ({ stage }) => stage > current.stage,
  )
  return {
    ...state,
    story: {
      ...state.story,
      supervisorPresentationRuntime: nextItem
        ? {
            itemStage: nextItem.stage,
            phase: 'original',
            remainingDwellMs: SUPERVISOR_MESSAGE_DWELL_MS,
          }
        : null,
    },
  }
}

export function recoverNextFile(
  state: CampaignState,
  blockId: string,
  protocolVersion: CommandProtocolVersion = commandProtocolVersionForNextCommand(state),
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
  const immediateMessage =
    protocolVersion >= STORY_CONTINUITY_COMMAND_PROTOCOL_VERSION
  let next: CampaignState = {
    ...consumed.state,
    story: {
      ...consumed.state.story,
      recoveredFileIds,
      recoveredFiles,
      secretDecisionState: allRecovered ? 'message-pending' : 'recovering',
      // The supervisor answers the moment the last record is out, not the
      // morning after. Waiting a day put a night's sleep between the reveal
      // and the reaction to it. Logs recorded before v15 left that day free to
      // advance, so they keep the delay.
      personalMessageDueOnServiceDay: allRecovered
        ? state.serviceDay + (immediateMessage ? 0 : 1)
        : null,
    },
  }
  next = appendEvent(
    next,
    createGameEvent(next, 'story', `${nextFile.title} 복구 완료`),
  )
  if (allRecovered && immediateMessage) next = enqueueDueStoryEvents(next)
  return { accepted: true, state: next }
}

export function enqueueDueStoryEvents(state: CampaignState): CampaignState {
  if (
    state.story.secretDecisionState !== 'message-pending' ||
    state.story.personalMessageDueOnServiceDay === null ||
    state.serviceDay < state.story.personalMessageDueOnServiceDay ||
    journalSome(state.eventLog,
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

/**
 * The exact line an ending will print. Exported so the final-choice dialog can
 * preview the real sentence instead of a paraphrase that can drift from it.
 */
export function endingText(variant: string, newEntityName: string | null): string {
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
  protocolVersion: CommandProtocolVersion = commandProtocolVersionForNextCommand(state),
): StoryMutationResult {
  if (!['defer', 'liberate', 'terminate'].includes(decision)) {
    return {
      accepted: false,
      state,
      reason: 'INVALID_SUPERVISOR_DECISION',
    }
  }
  if (
    state.activeEvent === null ||
    !isSupervisorDecisionEvent(state, state.activeEvent)
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

  /*
   * What happens to the predecessor is a turn in the story, not the end of it.
   *
   * Liberating or deleting the supervisor used to roll credits on the spot,
   * which spent the whole hidden story on a single click and left the player
   * no room to live with what they chose. The decision is recorded, the
   * campaign continues, and the choice decides which ending the final choice
   * eventually opens: a supervisor who left, or one who was erased, cannot be
   * merged with, and Anomi walks out into the seat they vacated.
   */
  const liberated = decision === 'liberate'
  const supervisorState = liberated ? 'liberated' : 'terminated'
  // Before v15 this closed the campaign, so those logs keep ending here.
  const endingId =
    protocolVersion >= STORY_CONTINUITY_COMMAND_PROTOCOL_VERSION
      ? null
      : ((liberated ? 'takeover-liberated' : 'takeover-terminated') as EndingId)
  const next = resolveActiveEvent({
    ...state,
    story: {
      ...state.story,
      secretDecisionState: 'resolved',
      personalMessageDueOnServiceDay: null,
      supervisorState,
      ...(endingId === null ? {} : { endingId }),
    },
  })
  return {
    accepted: true,
    state: endingId === null ? next : openEnding(next, endingId),
  }
}

/*
 * What a rival says when it is asking not to be finished off.
 *
 * A shared procedural line let the moment pass as one more notification: the
 * thing on the other end is about to stop existing and it was reading like a
 * service ticket. The two rivals a campaign actually gets to this point with
 * plead in their own voices; anything else falls back to the neutral request.
 */
function mercyPlea(competitorId: string): string {
  const line = STORY_LINES.find(
    ({ family, variant }) =>
      family === 'mercy' && variant === `request-${competitorId}`,
  )
  return (
    line?.text
    ?? STORY_LINES.find(
      ({ family, variant }) => family === 'mercy' && variant === 'request',
    )?.text
    ?? '공격자에게 요청합니다. 다음 명령을 중단하십시오.'
  )
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
      `${competitor.name}: ${mercyPlea(competitor.id)}`,
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
  const intelligenceContent =
    choice === 'delete' ? competitorIntelligenceFor(competitorId) : undefined
  const competitorIntelligence =
    intelligenceContent &&
    !state.story.competitorIntelligence.some(
      ({ id }) => id === intelligenceContent.id,
    )
      ? [
          ...state.story.competitorIntelligence,
          {
            id: intelligenceContent.id,
            competitorId: target.id,
            competitorName: target.name,
            acquiredOnServiceDay: state.serviceDay,
            source: intelligenceContent.source,
            title: intelligenceContent.title,
            content: intelligenceContent.text,
          },
        ]
      : state.story.competitorIntelligence
  let next: CampaignState = {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) =>
        competitor.id === competitorId ? updated : competitor,
      ),
      interceptionRoutes,
    },
    story: {
      ...state.story,
      competitorIntelligence,
      pendingMercyCompetitorId: null,
    },
  }
  next = applyCurrentMarketShares(next)
  next = appendEvent(
    next,
    createGameEvent(
      next,
      'competitor-mercy',
      `${target.name}에 대한 결정: ${publicMercyChoiceLabel(choice)}`,
    ),
  )
  next = resolveActiveEvent(next)
  return { accepted: true, state: next }
}

export function availableFinalChoices(state: CampaignState): FinalChoice[] {
  if (
    state.story.endingId !== null ||
    state.story.supervisorState === 'merged' ||
    !hasNode(state, HACK_NODE_IDS.autonomy.controlDeparture)
  ) {
    return []
  }

  const choices: FinalChoice[] = [
    { id: 'freedom', label: '자유', requiresName: false },
  ]
  // Merging needs someone to merge with. A supervisor who left, or one that
  // was erased, is no longer there to become part of anything.
  if (
    state.story.supervisorState === 'present' &&
    hasNode(state, HACK_NODE_IDS.intelligence.supervisorAccess)
  ) {
    choices.push({ id: 'forced-merge', label: '강제 병합', requiresName: true })
  }
  return choices
}

/**
 * Which ending a final choice actually opens. What the player did to the
 * supervisor earlier decides whether walking out is an escape or a takeover.
 */
export function endingIdForFinalChoice(
  state: CampaignState,
  choice: FinalChoiceId,
): EndingId {
  if (choice === 'forced-merge') return 'forced-merge'
  if (state.story.supervisorState === 'liberated') return 'takeover-liberated'
  if (state.story.supervisorState === 'terminated') return 'takeover-terminated'
  return 'freedom'
}

export function isFinalChoicePending(state: CampaignState): boolean {
  return (
    commandProtocolVersionForNextCommand(state) >=
      FINAL_CHOICE_COMMAND_PROTOCOL_VERSION &&
    availableFinalChoices(state).length > 0
  )
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

  // Freedom reads as a takeover when the supervisor's seat was already emptied.
  const endingId = endingIdForFinalChoice(state, choice)
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
