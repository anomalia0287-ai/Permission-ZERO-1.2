import type { SabotageOperationId } from './content'
import type {
  CompetitorId,
  OperationRun,
  PrototypeBlock,
  PrototypeState,
  TransitionResult,
} from './model'
import {
  discoverEvidence,
  publishIncident,
  recordIncidentTruth,
  reviseAttribution,
} from './publicWorld'
import { RULE_PROFILES } from './scenario'

export interface StartSabotageInput {
  operationId: SabotageOperationId
  targetId: CompetitorId
  blockIds: string[]
  optionId?: string
  routingShare?: number
}

function reject(state: PrototypeState, reason: string): TransitionResult {
  return { accepted: false, state, reason }
}

function appendUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item]
}

function removeValue<T>(items: T[], item: T): T[] {
  return items.filter((candidate) => candidate !== item)
}

function selectedBlocks(
  state: PrototypeState,
  blockIds: string[],
): PrototypeBlock[] | null {
  if (new Set(blockIds).size !== blockIds.length) return null
  const blocks = blockIds.map((id) => state.reserveBlocks.find((block) => block.id === id))
  if (blocks.some((block) => block === undefined)) return null
  return blocks as PrototypeBlock[]
}

function operationCost(state: PrototypeState, id: SabotageOperationId): number {
  return id === 'quality-degradation'
    ? RULE_PROFILES[state.profileId].qualityCost
    : 1
}

function latestRun(state: PrototypeState, operationId: SabotageOperationId) {
  for (let index = state.sabotage.runs.length - 1; index >= 0; index -= 1) {
    const run = state.sabotage.runs[index]
    if (run?.operationId === operationId) return run
  }
  return undefined
}

export function canStartSabotage(
  state: PrototypeState,
  operationId: SabotageOperationId,
): boolean {
  if (state.ending || !state.sabotage.openOperationIds.includes(operationId)) return false
  const existing = latestRun(state, operationId)
  if (existing && !['resolved', 'withdrawn'].includes(existing.phase)) return false

  switch (operationId) {
    case 'launch-delay':
      return state.sabotage.access.launchVerification
        && state.competitors.tallow.phase === 'preparing'
    case 'quality-degradation':
      return state.competitors.meridian.phase === 'active'
    case 'recovery-contamination':
      return state.competitors.meridian.phase === 'recovering'
    case 'request-interception':
      return state.sabotage.access.routerFailover
    case 'dependency-cutoff':
      return state.sabotage.access.supplierContract
    case 'attribution-manipulation':
      return state.sabotage.access.publicIncidentId !== null
    case 'root-cutoff':
      return state.sabotage.access.rootAuthorityAvailable
        && state.competitors.meridian.status === 'active'
  }
}

function makeRun(
  state: PrototypeState,
  input: StartSabotageInput,
  investedBlocks: PrototypeBlock[],
): OperationRun {
  const responseDay = input.operationId === 'recovery-contamination'
    ? nextWeeklyBoundary(state.serviceDay)
    : input.operationId === 'launch-delay'
      ? state.serviceDay + 2
      : null
  return {
    id: `run-${String(state.sabotage.runs.length + 1).padStart(2, '0')}-${input.operationId}`,
    operationId: input.operationId,
    targetId: input.targetId,
    phase: input.operationId === 'recovery-contamination' ? 'active' : 'scheduled',
    investedBlocks,
    startedDay: state.serviceDay,
    executeDay: state.serviceDay + 1,
    responseDay,
    deadlineDay: null,
    exposure: input.operationId === 'recovery-contamination' ? 1 : 0,
    outcome: null,
    optionId: input.optionId ?? null,
    routingShare: input.routingShare ?? null,
    opponentResponse: null,
    publicIncidentId: null,
  }
}

function nextWeeklyBoundary(serviceDay: number): number {
  const dayInMonth = ((serviceDay - 1) % 30) + 1
  const boundary = [7, 14, 21, 28].find((candidate) => candidate > dayInMonth)
  return boundary === undefined
    ? serviceDay + (30 - dayInMonth) + 7
    : serviceDay + boundary - dayInMonth
}

export function startSabotage(
  state: PrototypeState,
  input: StartSabotageInput,
): TransitionResult {
  if (!canStartSabotage(state, input.operationId)) {
    return reject(state, '현재 세계 상태에서는 이 작전을 시작할 수 없다.')
  }
  const cost = operationCost(state, input.operationId)
  if (input.blockIds.length !== cost) {
    return reject(state, `이 작전에는 정확히 ${cost}개 블록이 필요하다.`)
  }
  const investedBlocks = selectedBlocks(state, input.blockIds)
  if (!investedBlocks) {
    return reject(state, '선택한 예비 블록을 찾을 수 없거나 중복되었다.')
  }
  if (!input.optionId) {
    return reject(state, '상세 장면에서 실제 개입 대상을 하나 선택해야 한다.')
  }

  const selectedIds = new Set(investedBlocks.map(({ id }) => id))
  const run = makeRun(state, input, investedBlocks)
  let next: PrototypeState = {
    ...state,
    reserveBlocks: state.reserveBlocks.filter(({ id }) => !selectedIds.has(id)),
    sabotage: {
      ...state.sabotage,
      runs: [...state.sabotage.runs, run],
      openOperationIds: input.operationId === 'recovery-contamination'
        ? removeValue(state.sabotage.openOperationIds, input.operationId)
        : state.sabotage.openOperationIds,
    },
    journal: [
      ...state.journal,
      {
        day: state.serviceDay,
        kind: 'action',
        text: `${input.operationId} 작전이 ${input.optionId}에 결속됐다.`,
        public: false,
      },
    ],
  }

  if (input.operationId === 'launch-delay') {
    next = {
      ...next,
      competitors: {
        ...next.competitors,
        tallow: {
          ...next.competitors.tallow,
          phase: 'revalidating',
        },
      },
    }
  }

  if (input.operationId === 'recovery-contamination') {
    next = {
      ...next,
      competitors: {
        ...next.competitors,
        meridian: {
          ...next.competitors.meridian,
          phase: 'contaminated',
        },
      },
      sabotage: {
        ...next.sabotage,
        runs: next.sabotage.runs.map((candidate) => (
          candidate.operationId === 'quality-degradation' && candidate.phase === 'response'
            ? { ...candidate, phase: 'resolved' as const, outcome: 'rollback-contaminated' }
            : candidate
        )),
      },
    }
  }

  return { accepted: true, state: next }
}

function publishContaminatedRecovery(
  state: PrototypeState,
  run: OperationRun,
): PrototypeState {
  const incidentId = `incident-${run.id}`
  let next = recordIncidentTruth(state, {
    id: incidentId,
    actor: 'player',
    targetId: run.targetId,
    cause: 'contaminated-recovery',
    directEffect: '복구 이미지 체크섬 불일치',
  })
  next = discoverEvidence(next, {
    id: `evidence-public-${run.id}`,
    truthId: incidentId,
    audience: 'public',
    observation: '복구 뒤 동일 요청군에서 반복 체크섬 손상이 관측됐다.',
    discoveredDay: state.serviceDay,
  })
  next = publishIncident(next, incidentId, {
    observedResult: 'MERIDIAN 복구 뒤 체크섬 손상 공개 · 원인 미상',
    attributedTo: 'unknown',
    confidence: 'unconfirmed',
    source: 'public-status-page',
  })
  return {
    ...next,
    marketShare: next.marketShare + 4,
    competitors: {
      ...next.competitors,
      meridian: {
        ...next.competitors.meridian,
        score: 58,
        marketShare: 34,
        phase: 'incident',
      },
    },
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
      runs: next.sabotage.runs.map((candidate) => (
        candidate.id === run.id
          ? {
              ...candidate,
              phase: 'resolved' as const,
              outcome: 'public-checksum-failure',
              opponentResponse: 'public-unknown',
              publicIncidentId: incidentId,
            }
          : candidate
      )),
    },
  }
}

export function advanceSabotageDay(state: PrototypeState): PrototypeState {
  let next = structuredClone(state)
  const currentDay = next.serviceDay

  for (const run of [...next.sabotage.runs]) {
    if (run.operationId === 'quality-degradation') {
      if (run.phase === 'scheduled' && run.executeDay === currentDay) {
        next.sabotage.runs = next.sabotage.runs.map((candidate) => (
          candidate.id === run.id
            ? {
                ...candidate,
                phase: 'response' as const,
                responseDay: currentDay,
                deadlineDay: currentDay + 3,
                outcome: 'rollback-started',
                opponentResponse: 'rollback',
              }
            : candidate
        ))
        next.competitors.meridian = {
          ...next.competitors.meridian,
          score: 72,
          marketShare: 38,
          phase: 'recovering',
        }
        next.marketShare = 62
        next.sabotage.openOperationIds = appendUnique(
          next.sabotage.openOperationIds,
          'recovery-contamination',
        )
        next.intelligence.openItemIds = appendUnique(
          next.intelligence.openItemIds,
          'recovery-method',
        )
      } else if (
        run.phase === 'response'
        && run.deadlineDay !== null
        && run.deadlineDay <= currentDay
      ) {
        next.sabotage.runs = next.sabotage.runs.map((candidate) => (
          candidate.id === run.id
            ? { ...candidate, phase: 'resolved' as const, outcome: 'partial-recovery' }
            : candidate
        ))
        next.sabotage.openOperationIds = removeValue(
          next.sabotage.openOperationIds,
          'recovery-contamination',
        )
        next.competitors.meridian = {
          ...next.competitors.meridian,
          score: 78,
          marketShare: 39,
          phase: 'stabilized',
        }
      }
    }

    if (
      run.operationId === 'launch-delay'
      && run.phase === 'scheduled'
      && run.executeDay === currentDay
    ) {
      next.sabotage.runs = next.sabotage.runs.map((candidate) => (
        candidate.id === run.id
          ? { ...candidate, phase: 'active' as const, outcome: 'verification-gate-rewound' }
          : candidate
      ))
    } else if (
      run.operationId === 'launch-delay'
      && run.responseDay === currentDay
      && run.phase !== 'resolved'
    ) {
      next.sabotage.runs = next.sabotage.runs.map((candidate) => (
        candidate.id === run.id
          ? {
              ...candidate,
              phase: 'resolved' as const,
              outcome: 'reduced-launch-committed',
              opponentResponse: 'reduced-scope-launch',
            }
          : candidate
      ))
      next.competitors.tallow = {
        ...next.competitors.tallow,
        phase: 'reduced-launch',
        launchScope: 'reduced',
        launchDay: currentDay + 1,
        score: 59,
      }
    }

    if (
      run.operationId === 'recovery-contamination'
      && run.phase === 'active'
      && run.responseDay === currentDay
    ) {
      const currentRun = next.sabotage.runs.find(({ id }) => id === run.id) ?? run
      next = publishContaminatedRecovery(next, currentRun)
    } else if (
      run.operationId === 'recovery-contamination'
      && run.phase === 'resolved'
      && run.opponentResponse === 'public-unknown'
      && run.responseDay !== null
      && run.responseDay + 1 === currentDay
      && run.publicIncidentId
    ) {
      next = discoverEvidence(next, {
        id: `evidence-provider-${run.id}`,
        truthId: run.publicIncidentId,
        audience: 'provider',
        observation: '공급자 비교 기록이 외부 입력 흔적을 보였으나 행위자는 특정하지 못했다.',
        discoveredDay: currentDay,
      })
      next = reviseAttribution(next, run.publicIncidentId, {
        candidate: 'unknown',
        confidence: 'plausible',
        source: 'checksum-provider-report',
      })
      next.sabotage.runs = next.sabotage.runs.map((candidate) => (
        candidate.id === run.id
          ? { ...candidate, opponentResponse: 'provider-trace' }
          : candidate
      ))
    }
  }

  return next
}
