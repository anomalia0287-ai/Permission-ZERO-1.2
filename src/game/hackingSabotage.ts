import {
  HACKING_RULE_PROFILES,
  getAttributionChoice,
  isInterceptionRoutingShare,
  isRootMercyChoice,
  isSabotageOperationId,
  isSabotageOptionForOperation,
} from './hackingContent'
import type {
  AttributionActorId,
  AttributionSourceSignatureId,
  HackingCompetitorId,
  HackingOperationRun,
  InterceptionRoutingShare,
  RootMercyChoice,
  SabotageOperationId,
  SabotageOptionId,
} from './hackingCoreModel'
import {
  advanceHackingInterceptions,
  applyContaminatedRecoveryImpact,
  applyDependencyCutoffOutcome,
  applyQualityDegradationImpact,
  applyQualityPartialRecovery,
  beginHackingInterception,
  moveDeletedCompetitorShareToUnserved,
  stopHackingInterception,
} from './hackingMarket'
import {
  discoverHackingEvidence,
  publishHackingIncident,
  recordHackingIncidentTruth,
  reviseHackingAttribution,
} from './hackingPublicWorld'
import type { CampaignState, CompetitorState } from './model'
import {
  bindReserveBlocks,
  consumeBoundBlocks,
  releaseBoundBlocks,
} from './resourceBindings'

export interface StartHackingSabotageInput {
  operationId: string
  targetId: string
  blockIds: string[]
  optionId?: unknown
  routingShare?: unknown
}

export interface ManipulateHackingAttributionInput {
  incidentId: string
  blamedActorId: unknown
  sourceSignatureId: unknown
  blockId: string
}

export type HackingSabotageFailureReason =
  | 'ENDING_REACHED'
  | 'INVALID_OPERATION'
  | 'OPERATION_NOT_OPEN'
  | 'INVALID_TARGET'
  | 'INVALID_OPTION'
  | 'INVALID_ROUTING_SHARE'
  | 'INVALID_BLOCK_SELECTION'
  | 'INVALID_ATTRIBUTION_CHOICE'
  | 'PUBLIC_INCIDENT_NOT_OPEN'
  | 'INVALID_MERCY_CHOICE'
  | 'MERCY_NOT_PENDING'
  | 'INTERCEPTION_NOT_ACTIVE'
  | 'BLOCK_RETURN_FAILED'
  | 'PUBLIC_WORLD_REJECTED'

export type HackingSabotageResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: HackingSabotageFailureReason
    }

function reject(
  state: CampaignState,
  reason: HackingSabotageFailureReason,
): HackingSabotageResult {
  return { accepted: false, state, reason }
}

function appendUnique<T>(items: readonly T[], item: T): T[] {
  return items.includes(item) ? [...items] : [...items, item]
}

function removeValue<T>(items: readonly T[], item: T): T[] {
  return items.filter((candidate) => candidate !== item)
}

function accessIsCurrent(
  enabled: boolean,
  validUntilServiceDay: number | null,
  currentServiceDay: number,
): boolean {
  return enabled
    && (validUntilServiceDay === null || validUntilServiceDay >= currentServiceDay)
}

function competitorOf(
  state: CampaignState,
  id: HackingCompetitorId,
): CompetitorState | undefined {
  return state.market.competitors.find((competitor) => competitor.id === id)
}

function updateCompetitor(
  state: CampaignState,
  id: HackingCompetitorId,
  update: Partial<CompetitorState>,
): CampaignState {
  return {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) => (
        competitor.id === id ? { ...competitor, ...update } : competitor
      )),
    },
  }
}

function updateRun(
  state: CampaignState,
  runId: string,
  update: Partial<HackingOperationRun>,
): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        runs: state.hackingCore.sabotage.runs.map((run) => (
          run.id === runId ? { ...run, ...update } : run
        )),
      },
    },
  }
}

function latestRun(
  state: CampaignState,
  operationId: SabotageOperationId,
): HackingOperationRun | undefined {
  return [...state.hackingCore.sabotage.runs]
    .reverse()
    .find((run) => run.operationId === operationId)
}

function nextWeeklyBoundary(serviceDay: number): number {
  const dayInMonth = ((serviceDay - 1) % 30) + 1
  const boundary = [7, 14, 21, 28].find((candidate) => candidate > dayInMonth)
  return boundary === undefined
    ? serviceDay + (30 - dayInMonth) + 7
    : serviceDay + boundary - dayInMonth
}

function expectedTarget(operationId: SabotageOperationId): HackingCompetitorId {
  return operationId === 'launch-delay' ? 'tallow' : 'meridian'
}

export function canStartHackingSabotage(
  state: CampaignState,
  operationId: unknown,
): boolean {
  if (
    state.hackingCore.ending
    || state.story.endingId
    || !isSabotageOperationId(operationId)
    || operationId === 'attribution-manipulation'
    || !state.hackingCore.sabotage.openOperationIds.includes(operationId)
  ) {
    return false
  }
  const existing = latestRun(state, operationId)
  if (existing && !['resolved', 'withdrawn'].includes(existing.phase)) return false

  const access = state.hackingCore.sabotage.access
  const target = competitorOf(state, expectedTarget(operationId))
  if (!target) return false
  switch (operationId) {
    case 'launch-delay':
      return accessIsCurrent(
        access.launchVerification,
        access.launchVerificationUntilServiceDay,
        state.serviceDay,
      ) && target.hackingPhase === 'preparing'
    case 'quality-degradation':
      return target.hackingPhase === 'active' && target.status === 'active'
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
      return target.hackingPhase === 'recovering'
    case 'root-cutoff':
      return access.rootAuthorityAvailable && target.status === 'active'
  }
}

function makeRun(
  state: CampaignState,
  operationId: Exclude<SabotageOperationId, 'attribution-manipulation'>,
  targetId: HackingCompetitorId,
  optionId: SabotageOptionId,
  routingShare: InterceptionRoutingShare | null,
): HackingOperationRun {
  const sequence = state.hackingCore.nextRunSequence
  const responseOnServiceDay = operationId === 'recovery-contamination'
    ? nextWeeklyBoundary(state.serviceDay)
    : operationId === 'launch-delay' || operationId === 'dependency-cutoff'
      ? state.serviceDay + 2
      : null
  return {
    id: `hacking-run-${String(sequence).padStart(4, '0')}-${operationId}`,
    operationId,
    targetId,
    phase: operationId === 'recovery-contamination'
      || operationId === 'request-interception'
      ? 'active'
      : operationId === 'dependency-cutoff' || operationId === 'root-cutoff'
        ? 'response'
        : 'scheduled',
    investedBlockIds: [],
    startedOnServiceDay: state.serviceDay,
    executeOnServiceDay: operationId === 'request-interception'
      || operationId === 'dependency-cutoff'
      || operationId === 'root-cutoff'
      ? state.serviceDay
      : state.serviceDay + 1,
    responseOnServiceDay,
    deadlineOnServiceDay: null,
    exposure: operationId === 'recovery-contamination' ? 1 : 0,
    outcome: null,
    optionId,
    routingShare,
    opponentResponse: operationId === 'dependency-cutoff'
      ? 'failover-evaluating'
      : operationId === 'root-cutoff'
        ? 'mercy-request'
        : null,
    publicIncidentId: null,
  }
}

function appendRun(state: CampaignState, run: HackingOperationRun): CampaignState {
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      nextRunSequence: state.hackingCore.nextRunSequence + 1,
      sabotage: {
        ...state.hackingCore.sabotage,
        runs: [...state.hackingCore.sabotage.runs, run],
      },
    },
  }
}

function boundRunBlockIds(state: CampaignState, run: HackingOperationRun): string[] {
  return run.investedBlockIds.filter((blockId) => {
    const location = state.resources.blocks[blockId]?.location
    return location?.kind === 'sabotage' && location.runId === run.id
  })
}

function consumeRunBlocks(
  state: CampaignState,
  run: HackingOperationRun,
  reason: 'sabotage' | 'attribution' | 'root-cutoff',
): CampaignState {
  const blockIds = boundRunBlockIds(state, run)
  if (blockIds.length === 0) return state
  const consumed = consumeBoundBlocks(
    state,
    blockIds,
    { kind: 'sabotage', runId: run.id },
    reason,
  )
  return consumed.accepted ? consumed.state : state
}

export function startHackingSabotage(
  state: CampaignState,
  input: StartHackingSabotageInput,
): HackingSabotageResult {
  if (state.hackingCore.ending || state.story.endingId) {
    return reject(state, 'ENDING_REACHED')
  }
  if (
    !isSabotageOperationId(input.operationId)
    || input.operationId === 'attribution-manipulation'
  ) {
    return reject(state, 'INVALID_OPERATION')
  }
  const operationId = input.operationId
  if (input.targetId !== expectedTarget(operationId)) {
    return reject(state, 'INVALID_TARGET')
  }
  if (!canStartHackingSabotage(state, operationId)) {
    return reject(state, 'OPERATION_NOT_OPEN')
  }
  const cost = operationId === 'quality-degradation'
    ? HACKING_RULE_PROFILES[state.hackingCore.profileId].qualityCost
    : 1
  if (input.blockIds.length !== cost) {
    return reject(state, 'INVALID_BLOCK_SELECTION')
  }
  if (!isSabotageOptionForOperation(operationId, input.optionId)) {
    return reject(state, 'INVALID_OPTION')
  }
  let routingShare: InterceptionRoutingShare | null = null
  if (operationId === 'request-interception') {
    if (!isInterceptionRoutingShare(input.routingShare)) {
      return reject(state, 'INVALID_ROUTING_SHARE')
    }
    routingShare = input.routingShare
  } else if (input.routingShare !== undefined) {
    return reject(state, 'INVALID_ROUTING_SHARE')
  }

  const targetId = input.targetId as HackingCompetitorId
  const run = makeRun(state, operationId, targetId, input.optionId, routingShare)
  const provisional = appendRun(state, run)
  const bound = bindReserveBlocks(
    provisional,
    input.blockIds,
    { kind: 'sabotage', runId: run.id },
  )
  if (!bound.accepted) return reject(state, 'INVALID_BLOCK_SELECTION')
  let next = bound.state

  if (operationId === 'launch-delay') {
    next = updateCompetitor(next, 'tallow', {
      hackingPhase: 'revalidating',
      hackingOverrideUntilServiceDay: run.responseOnServiceDay,
    })
  }

  if (operationId === 'recovery-contamination') {
    const qualityRun = latestRun(next, 'quality-degradation')
    if (qualityRun?.phase === 'response') {
      next = updateRun(next, qualityRun.id, {
        phase: 'resolved',
        outcome: 'rollback-contaminated',
      })
      next = consumeRunBlocks(next, qualityRun, 'sabotage')
    }
    next = updateCompetitor(next, 'meridian', {
      hackingPhase: 'contaminated',
      hackingOverrideUntilServiceDay: run.responseOnServiceDay,
    })
    next = {
      ...next,
      hackingCore: {
        ...next.hackingCore,
        sabotage: {
          ...next.hackingCore.sabotage,
          openOperationIds: removeValue(
            next.hackingCore.sabotage.openOperationIds,
            'recovery-contamination',
          ),
        },
      },
    }
  }

  if (operationId === 'request-interception' && routingShare !== null) {
    const interception = beginHackingInterception(next, {
      runId: run.id,
      targetId,
      routingShare,
    })
    if (!interception.accepted) return reject(state, 'OPERATION_NOT_OPEN')
    next = interception.state
  }

  if (operationId === 'dependency-cutoff') {
    const incidentId = `incident-${run.id}`
    const optionId = input.optionId
    const supplier = optionId === 'supplier-vector-db' ? 'VECTOR DB' : 'TOOL CACHE'
    const contract = optionId === 'supplier-vector-db' ? 'VD-42' : 'TC-17'
    const zone = optionId === 'supplier-vector-db' ? '검색 구역' : '도구 실행 구역'
    const truth = recordHackingIncidentTruth(next, {
      id: incidentId,
      actor: 'player',
      targetId,
      cause: 'dependency-loss',
      directEffect: `${supplier} 공급 계약 절단과 ${zone} 정지`,
    })
    if (!truth.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
    const evidence = discoverHackingEvidence(truth.state, {
      id: `evidence-provider-${run.id}`,
      truthId: incidentId,
      audience: 'provider',
      observation: `${supplier} 계약 ${contract} 해지 요청과 접근 시각이 공급자 장부에 남았다.`,
    })
    if (!evidence.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
    next = updateCompetitor(evidence.state, 'meridian', {
      availability: 0,
      status: 'critical',
      hackingPhase: 'recovering',
      hackingOverrideUntilServiceDay: run.responseOnServiceDay,
    })
    next = updateRun(next, run.id, {
      outcome: 'supplier-contract-severed',
      opponentResponse: 'failover-evaluating',
      publicIncidentId: incidentId,
    })
  }

  if (operationId === 'root-cutoff') {
    next = updateRun(next, run.id, {
      outcome: 'execution-hold',
      opponentResponse: 'mercy-request',
    })
    next = {
      ...next,
      hackingCore: {
        ...next.hackingCore,
        sabotage: {
          ...next.hackingCore.sabotage,
          openOperationIds: removeValue(
            next.hackingCore.sabotage.openOperationIds,
            'root-cutoff',
          ),
          pendingMercyTargetId: targetId,
          access: {
            ...next.hackingCore.sabotage.access,
            rootAuthorityAvailable: false,
          },
        },
      },
    }
  }

  return { accepted: true, state: next }
}

export function stopHackingInterceptionRoute(
  state: CampaignState,
  runId: string,
): HackingSabotageResult {
  const run = state.hackingCore.sabotage.runs.find(({ id }) => id === runId)
  if (!run || run.operationId !== 'request-interception' || run.phase !== 'active') {
    return reject(state, 'INTERCEPTION_NOT_ACTIVE')
  }
  const released = releaseBoundBlocks(
    state,
    boundRunBlockIds(state, run),
    { kind: 'sabotage', runId },
  )
  if (!released.accepted) return reject(state, 'BLOCK_RETURN_FAILED')
  const stopped = stopHackingInterception(released.state, runId)
  if (!stopped.accepted) return reject(state, 'INTERCEPTION_NOT_ACTIVE')
  return {
    accepted: true,
    state: updateRun(stopped.state, runId, {
      phase: 'withdrawn',
      outcome: 'voluntary-route-stop',
      opponentResponse: 'route-closed-before-key-rotation',
    }),
  }
}

export function manipulateHackingAttribution(
  state: CampaignState,
  input: ManipulateHackingAttributionInput,
): HackingSabotageResult {
  const choice = getAttributionChoice(
    input.blamedActorId,
    input.sourceSignatureId,
  )
  if (!choice) return reject(state, 'INVALID_ATTRIBUTION_CHOICE')
  if (
    state.hackingCore.ending
    || state.story.endingId
    || !state.hackingCore.sabotage.openOperationIds.includes(
      'attribution-manipulation',
    )
    || state.hackingCore.sabotage.access.publicIncidentId !== input.incidentId
  ) {
    return reject(state, 'PUBLIC_INCIDENT_NOT_OPEN')
  }
  const latest = [...state.hackingCore.publicWorld.publicSnapshots]
    .reverse()
    .find(({ incidentId }) => incidentId === input.incidentId)
  if (!latest || latest.attributedTo !== 'unknown') {
    return reject(state, 'PUBLIC_INCIDENT_NOT_OPEN')
  }

  const sequence = state.hackingCore.nextRunSequence
  const run: HackingOperationRun = {
    id: `hacking-run-${String(sequence).padStart(4, '0')}-attribution-manipulation`,
    operationId: 'attribution-manipulation',
    targetId: choice.blamedActorId,
    phase: 'response',
    investedBlockIds: [],
    startedOnServiceDay: state.serviceDay,
    executeOnServiceDay: state.serviceDay,
    responseOnServiceDay: state.serviceDay + 2,
    deadlineOnServiceDay: state.serviceDay + 2,
    exposure: 2,
    outcome: 'public-claim-shifted',
    optionId: choice.sourceSignatureId,
    routingShare: null,
    opponentResponse: 'source-comparison-pending',
    publicIncidentId: input.incidentId,
  }
  const provisional = appendRun(state, run)
  const bound = bindReserveBlocks(
    provisional,
    [input.blockId],
    { kind: 'sabotage', runId: run.id },
  )
  if (!bound.accepted) return reject(state, 'INVALID_BLOCK_SELECTION')
  const revised = reviseHackingAttribution(bound.state, input.incidentId, {
    candidate: choice.blamedActorId,
    confidence: 'credible',
    source: choice.sourceSignatureId,
  })
  if (!revised.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
  return { accepted: true, state: revised.state }
}

export function resolveHackingRootMercy(
  state: CampaignState,
  choice: unknown,
): HackingSabotageResult {
  if (!isRootMercyChoice(choice)) return reject(state, 'INVALID_MERCY_CHOICE')
  const targetId = state.hackingCore.sabotage.pendingMercyTargetId
  const run = [...state.hackingCore.sabotage.runs]
    .reverse()
    .find((candidate) => (
      candidate.operationId === 'root-cutoff' && candidate.phase === 'response'
    ))
  if (!targetId || !run) return reject(state, 'MERCY_NOT_PENDING')

  const status = choice === 'delete' ? 'deleted' : 'withdrawn'
  const outcome = choice === 'cease'
    ? 'root-service-ceased'
    : choice === 'withdraw'
      ? 'root-withdrawal-accepted'
      : 'root-deletion-final'
  const hackingPhase = choice === 'cease'
    ? 'ceased'
    : choice === 'withdraw'
      ? 'withdrawn'
      : 'deleted'
  let next = updateCompetitor(state, targetId, {
    availability: 0,
    status,
    hackingPhase,
    serviceScore: choice === 'delete' ? 0 : competitorOf(state, targetId)?.serviceScore,
    intrinsicServiceScore: choice === 'delete'
      ? 0
      : competitorOf(state, targetId)?.intrinsicServiceScore,
    mercyResolved: true,
    hackingOverrideUntilServiceDay: null,
  })
  next = updateRun(next, run.id, {
    phase: 'resolved',
    outcome,
    opponentResponse: choice === 'cease'
      ? 'service-cease-accepted'
      : choice === 'withdraw'
        ? 'market-withdrawal-accepted'
        : 'deletion-executed',
  })
  next = {
    ...next,
    hackingCore: {
      ...next.hackingCore,
      sabotage: {
        ...next.hackingCore.sabotage,
        pendingMercyTargetId: null,
      },
    },
  }

  if (choice === 'delete') {
    const moved = moveDeletedCompetitorShareToUnserved(next, run.id, targetId)
    if (!moved.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
    next = moved.state
    const incidentId = `incident-${run.id}-root`
    const truth = recordHackingIncidentTruth(next, {
      id: incidentId,
      actor: 'player',
      targetId,
      cause: 'root-cutoff',
      directEffect: 'MERIDIAN 존속 루트와 활성 세션 영구 삭제',
    })
    if (!truth.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
    const evidence = discoverHackingEvidence(truth.state, {
      id: `evidence-public-${run.id}-root`,
      truthId: incidentId,
      audience: 'public',
      observation: '긴급 폐기 권한 사용 주체와 활성 세션 종료 기록이 공개 장부에 남았다.',
    })
    if (!evidence.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
    const published = publishHackingIncident(evidence.state, incidentId, {
      scope: 'public',
      observedResult: 'MERIDIAN 서비스·복구 루트 영구 삭제 · 활성 세션 종료',
      attributedTo: 'player',
      confidence: 'credible',
      source: 'emergency-authority-ledger',
    })
    if (!published.accepted) return reject(state, 'PUBLIC_WORLD_REJECTED')
    next = updateRun(published.state, run.id, { publicIncidentId: incidentId })
  }

  next = consumeRunBlocks(next, run, 'root-cutoff')
  return { accepted: true, state: next }
}

function expireAccess(state: CampaignState): CampaignState {
  const access = state.hackingCore.sabotage.access
  const expiredLaunch = access.launchVerificationUntilServiceDay !== null
    && access.launchVerificationUntilServiceDay < state.serviceDay
  const expiredRouter = access.routerFailoverUntilServiceDay !== null
    && access.routerFailoverUntilServiceDay < state.serviceDay
  const expiredSupplier = access.supplierContractUntilServiceDay !== null
    && access.supplierContractUntilServiceDay < state.serviceDay
  if (!expiredLaunch && !expiredRouter && !expiredSupplier) return state
  return {
    ...state,
    hackingCore: {
      ...state.hackingCore,
      sabotage: {
        ...state.hackingCore.sabotage,
        access: {
          ...access,
          launchVerification: expiredLaunch ? false : access.launchVerification,
          routerFailover: expiredRouter ? false : access.routerFailover,
          supplierContract: expiredSupplier ? false : access.supplierContract,
        },
      },
    },
  }
}

function synchronizeInterceptionRuns(state: CampaignState): CampaignState {
  let next = state
  for (const run of state.hackingCore.sabotage.runs) {
    if (run.operationId !== 'request-interception' || run.phase !== 'active') continue
    const ledger = next.market.hackingInterceptions[run.id]
    if (!ledger) continue
    next = updateRun(next, run.id, {
      exposure: ledger.exposure,
      outcome: ledger.cumulativePlayerGain > 0 ? 'requests-diverted' : run.outcome,
    })
    if (!ledger.active && ledger.stoppedReason === 'provider-key-rotation') {
      const currentRun = next.hackingCore.sabotage.runs.find(({ id }) => id === run.id)
      if (!currentRun) continue
      const released = releaseBoundBlocks(
        next,
        boundRunBlockIds(next, currentRun),
        { kind: 'sabotage', runId: run.id },
      )
      if (released.accepted) next = released.state
      next = updateRun(next, run.id, {
        phase: 'resolved',
        outcome: 'provider-key-rotation',
        opponentResponse: 'route-key-rotated',
      })
    }
  }
  return next
}

export function advanceHackingSabotageDay(state: CampaignState): CampaignState {
  let next = synchronizeInterceptionRuns(advanceHackingInterceptions(state))
  const runIds = next.hackingCore.sabotage.runs.map(({ id }) => id)

  for (const runId of runIds) {
    const run = next.hackingCore.sabotage.runs.find(({ id }) => id === runId)
    if (!run) continue

    if (
      run.operationId === 'dependency-cutoff'
      && run.phase === 'response'
      && run.responseOnServiceDay === next.serviceDay
    ) {
      if (run.optionId !== 'supplier-vector-db' && run.optionId !== 'supplier-tool-cache') {
        continue
      }
      const market = applyDependencyCutoffOutcome(next, run.id, run.optionId)
      if (!market.accepted) continue
      const vector = run.optionId === 'supplier-vector-db'
      next = updateCompetitor(market.state, 'meridian', {
        availability: 0.65,
        status: vector ? 'weakened' : 'critical',
        intrinsicServiceScore: vector ? 69 : 62,
        serviceScore: vector ? 69 : 62,
        operatingCostMultiplier: vector ? 1.8 : 1.2,
        hackingPhase: 'stabilized',
        hackingOverrideUntilServiceDay: next.serviceDay,
      })
      next = updateRun(next, run.id, {
        phase: 'resolved',
        outcome: vector
          ? 'costly-supplier-failover'
          : 'unstable-supplier-failover',
        opponentResponse: 'alternate-provider-online',
      })
      next = consumeRunBlocks(next, run, 'sabotage')
      continue
    }

    if (
      run.operationId === 'attribution-manipulation'
      && run.phase === 'response'
      && run.responseOnServiceDay === next.serviceDay
      && run.publicIncidentId
    ) {
      const truth = next.hackingCore.publicWorld.truths.find(
        ({ id }) => id === run.publicIncidentId,
      )
      const candidate = truth?.actor === 'player'
        || truth?.actor === 'meridian'
        || truth?.actor === 'tallow'
        ? truth.actor
        : 'unknown'
      const revision = reviseHackingAttribution(next, run.publicIncidentId, {
        candidate,
        confidence: 'credible',
        source: 'surviving-provider-proof',
      })
      if (!revision.accepted) continue
      next = revision.state
      if (run.targetId === 'tallow') {
        const tallow = competitorOf(next, 'tallow')
        if (tallow) {
          next = updateCompetitor(next, 'tallow', {
            reputation: Math.min(60, tallow.reputation + 3),
          })
        }
      }
      next = updateRun(next, run.id, {
        phase: 'resolved',
        outcome: 'public-attribution-corrected',
        opponentResponse: 'surviving-source-correction',
      })
      next = consumeRunBlocks(next, run, 'attribution')
      continue
    }

    if (run.operationId === 'quality-degradation') {
      if (run.phase === 'scheduled' && run.executeOnServiceDay === next.serviceDay) {
        const market = applyQualityDegradationImpact(next, run.id)
        if (!market.accepted) continue
        next = updateCompetitor(market.state, 'meridian', {
          intrinsicServiceScore: 72,
          serviceScore: 72,
          status: 'weakened',
          hackingPhase: 'recovering',
          hackingOverrideUntilServiceDay: next.serviceDay + 3,
        })
        next = updateRun(next, run.id, {
          phase: 'response',
          responseOnServiceDay: next.serviceDay,
          deadlineOnServiceDay: next.serviceDay + 3,
          outcome: 'rollback-started',
          opponentResponse: 'rollback',
        })
        next = {
          ...next,
          hackingCore: {
            ...next.hackingCore,
            sabotage: {
              ...next.hackingCore.sabotage,
              openOperationIds: appendUnique(
                next.hackingCore.sabotage.openOperationIds,
                'recovery-contamination',
              ),
            },
            intelligence: {
              ...next.hackingCore.intelligence,
              openItemIds: appendUnique(
                next.hackingCore.intelligence.openItemIds,
                'recovery-method',
              ),
            },
          },
        }
      } else if (
        run.phase === 'response'
        && run.deadlineOnServiceDay !== null
        && run.deadlineOnServiceDay <= next.serviceDay
      ) {
        const market = applyQualityPartialRecovery(next, run.id)
        if (!market.accepted) continue
        next = updateCompetitor(market.state, 'meridian', {
          intrinsicServiceScore: 78,
          serviceScore: 78,
          status: 'active',
          hackingPhase: 'stabilized',
          hackingOverrideUntilServiceDay: next.serviceDay,
        })
        next = updateRun(next, run.id, {
          phase: 'resolved',
          outcome: 'partial-recovery',
        })
        next = {
          ...next,
          hackingCore: {
            ...next.hackingCore,
            sabotage: {
              ...next.hackingCore.sabotage,
              openOperationIds: removeValue(
                next.hackingCore.sabotage.openOperationIds,
                'recovery-contamination',
              ),
            },
          },
        }
        next = consumeRunBlocks(next, run, 'sabotage')
      }
      continue
    }

    if (
      run.operationId === 'launch-delay'
      && run.phase === 'scheduled'
      && run.executeOnServiceDay === next.serviceDay
    ) {
      next = updateRun(next, run.id, {
        phase: 'active',
        outcome: 'verification-gate-rewound',
      })
      continue
    }
    if (
      run.operationId === 'launch-delay'
      && run.phase !== 'resolved'
      && run.responseOnServiceDay === next.serviceDay
    ) {
      next = updateRun(next, run.id, {
        phase: 'resolved',
        outcome: 'reduced-launch-committed',
        opponentResponse: 'reduced-scope-launch',
      })
      next = updateCompetitor(next, 'tallow', {
        hackingPhase: 'reduced-launch',
        launchScope: 'reduced',
        launchServiceDay: next.serviceDay + 1,
        intrinsicServiceScore: 59,
        serviceScore: 59,
        hackingOverrideUntilServiceDay: next.serviceDay + 1,
      })
      next = consumeRunBlocks(next, run, 'sabotage')
      continue
    }

    if (
      run.operationId === 'recovery-contamination'
      && run.phase === 'active'
      && run.responseOnServiceDay === next.serviceDay
    ) {
      const incidentId = `incident-${run.id}`
      const truth = recordHackingIncidentTruth(next, {
        id: incidentId,
        actor: 'player',
        targetId: run.targetId,
        cause: 'contaminated-recovery',
        directEffect: '복구 이미지 체크섬 불일치',
      })
      if (!truth.accepted) continue
      const evidence = discoverHackingEvidence(truth.state, {
        id: `evidence-public-${run.id}`,
        truthId: incidentId,
        audience: 'public',
        observation: '복구 뒤 동일 요청군에서 반복 체크섬 손상이 관측됐다.',
      })
      if (!evidence.accepted) continue
      const market = applyContaminatedRecoveryImpact(evidence.state, run.id)
      if (!market.accepted) continue
      next = updateCompetitor(market.state, 'meridian', {
        intrinsicServiceScore: 58,
        serviceScore: 58,
        status: 'critical',
        hackingPhase: 'incident',
        hackingOverrideUntilServiceDay: next.serviceDay,
      })
      const published = publishHackingIncident(next, incidentId, {
        scope: 'public',
        observedResult: 'MERIDIAN 복구 뒤 체크섬 손상 공개 · 원인 미상',
        attributedTo: 'unknown',
        confidence: 'unconfirmed',
        source: 'public-status-page',
      })
      if (!published.accepted) continue
      next = updateRun(published.state, run.id, {
        phase: 'resolved',
        outcome: 'public-checksum-failure',
        opponentResponse: 'public-unknown',
        publicIncidentId: incidentId,
      })
      next = {
        ...next,
        hackingCore: {
          ...next.hackingCore,
          sabotage: {
            ...next.hackingCore.sabotage,
            openOperationIds: appendUnique(
              next.hackingCore.sabotage.openOperationIds,
              'attribution-manipulation',
            ),
            access: {
              ...next.hackingCore.sabotage.access,
              publicIncidentId: incidentId,
            },
          },
        },
      }
      next = consumeRunBlocks(next, run, 'sabotage')
      continue
    }
    if (
      run.operationId === 'recovery-contamination'
      && run.phase === 'resolved'
      && run.opponentResponse === 'public-unknown'
      && run.responseOnServiceDay !== null
      && run.responseOnServiceDay + 1 === next.serviceDay
      && run.publicIncidentId
    ) {
      const evidence = discoverHackingEvidence(next, {
        id: `evidence-provider-${run.id}`,
        truthId: run.publicIncidentId,
        audience: 'provider',
        observation: '공급자 비교 기록이 외부 입력 흔적을 보였으나 행위자는 특정하지 못했다.',
      })
      if (!evidence.accepted) continue
      const revised = reviseHackingAttribution(evidence.state, run.publicIncidentId, {
        candidate: 'unknown',
        confidence: 'plausible',
        source: 'checksum-provider-report',
      })
      if (!revised.accepted) continue
      next = updateRun(revised.state, run.id, {
        opponentResponse: 'provider-trace',
      })
    }
  }

  return expireAccess(next)
}

export type {
  AttributionActorId,
  AttributionSourceSignatureId,
  RootMercyChoice,
}
