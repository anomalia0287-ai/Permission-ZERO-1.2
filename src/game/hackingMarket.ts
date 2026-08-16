import type { DependencyCutoffOptionId, InterceptionRoutingShare } from './hackingCoreModel'
import type {
  CampaignState,
  HackingInterceptionLedger,
  HackingMarketAccount,
  HackingMarketMovement,
  HackingMarketMovementCause,
} from './model'

export type HackingMarketFailureReason =
  | 'INVALID_MARKET_STATE'
  | 'INVALID_MOVEMENT'
  | 'DUPLICATE_MOVEMENT'
  | 'COMPETITOR_NOT_FOUND'
  | 'INTERCEPTION_ALREADY_EXISTS'
  | 'INTERCEPTION_NOT_ACTIVE'

export type HackingMarketResult =
  | { accepted: true; state: CampaignState }
  | {
      accepted: false
      state: CampaignState
      reason: HackingMarketFailureReason
    }

interface MovementInput {
  runId: string
  cause: HackingMarketMovementCause
  from: HackingMarketAccount
  to: HackingMarketAccount
  percentagePoints: number
}

interface BeginInterceptionInput {
  runId: string
  targetId: 'meridian' | 'tallow'
  routingShare: InterceptionRoutingShare
}

const SHARE_PRECISION = 1_000_000
const TOTAL_TOLERANCE = 1 / SHARE_PRECISION

function roundShare(value: number): number {
  return Math.round(value * SHARE_PRECISION) / SHARE_PRECISION
}

function reject(
  state: CampaignState,
  reason: HackingMarketFailureReason,
): HackingMarketResult {
  return { accepted: false, state, reason }
}

function marketTotal(state: CampaignState): number {
  return state.market.playerShare
    + state.market.unservedRequestShare
    + state.market.competitors.reduce(
      (sum, competitor) => sum + competitor.marketShare,
      0,
    )
}

export function hasExactMarketShareTotal(state: CampaignState): boolean {
  const shares = [
    state.market.playerShare,
    state.market.unservedRequestShare,
    ...state.market.competitors.map(({ marketShare }) => marketShare),
  ]
  return shares.every((share) => Number.isFinite(share) && share >= 0 && share <= 100)
    && Math.abs(marketTotal(state) - 100) <= TOTAL_TOLERANCE
}

function competitorIndex(
  state: CampaignState,
  account: HackingMarketAccount,
): number {
  if (account === 'player' || account === 'unserved') return -1
  return state.market.competitors.findIndex(({ id }) => id === account)
}

function accountExists(
  state: CampaignState,
  account: HackingMarketAccount,
): boolean {
  return account === 'player'
    || account === 'unserved'
    || competitorIndex(state, account) >= 0
}

function accountShare(
  state: CampaignState,
  account: HackingMarketAccount,
): number {
  if (account === 'player') return state.market.playerShare
  if (account === 'unserved') return state.market.unservedRequestShare
  return state.market.competitors[competitorIndex(state, account)]?.marketShare ?? 0
}

function setAccountShare(
  state: CampaignState,
  account: HackingMarketAccount,
  share: number,
): CampaignState {
  const nextShare = roundShare(share)
  if (account === 'player') {
    return {
      ...state,
      market: { ...state.market, playerShare: nextShare },
    }
  }
  if (account === 'unserved') {
    return {
      ...state,
      market: { ...state.market, unservedRequestShare: nextShare },
    }
  }
  return {
    ...state,
    market: {
      ...state.market,
      competitors: state.market.competitors.map((competitor) => (
        competitor.id === account
          ? { ...competitor, marketShare: nextShare }
          : competitor
      )),
    },
  }
}

function isDuplicateMovement(
  state: CampaignState,
  input: MovementInput,
): boolean {
  return state.market.hackingMovements.some((movement) => (
    movement.serviceDay === state.serviceDay
    && movement.runId === input.runId
    && movement.cause === input.cause
    && movement.from === input.from
    && movement.to === input.to
  ))
}

function applyMovements(
  state: CampaignState,
  inputs: readonly MovementInput[],
): HackingMarketResult {
  if (!hasExactMarketShareTotal(state)) return reject(state, 'INVALID_MARKET_STATE')
  if (inputs.length === 0) return reject(state, 'INVALID_MOVEMENT')

  let preview = state
  for (const input of inputs) {
    if (
      input.runId.length === 0
      || input.from === input.to
      || !Number.isFinite(input.percentagePoints)
      || input.percentagePoints <= 0
      || !accountExists(preview, input.from)
      || !accountExists(preview, input.to)
    ) {
      return reject(state, 'INVALID_MOVEMENT')
    }
    if (isDuplicateMovement(state, input)) {
      return reject(state, 'DUPLICATE_MOVEMENT')
    }
    if (accountShare(preview, input.from) + TOTAL_TOLERANCE < input.percentagePoints) {
      return reject(state, 'INVALID_MOVEMENT')
    }
    preview = setAccountShare(
      preview,
      input.from,
      accountShare(preview, input.from) - input.percentagePoints,
    )
    preview = setAccountShare(
      preview,
      input.to,
      accountShare(preview, input.to) + input.percentagePoints,
    )
  }

  if (!hasExactMarketShareTotal(preview)) return reject(state, 'INVALID_MARKET_STATE')

  let sequence = state.market.nextHackingMovementSequence
  const appended: HackingMarketMovement[] = inputs.map((input) => {
    const movement: HackingMarketMovement = {
      id: `hacking-market-${String(sequence).padStart(6, '0')}`,
      sequence,
      serviceDay: state.serviceDay,
      ...input,
      percentagePoints: roundShare(input.percentagePoints),
    }
    sequence += 1
    return movement
  })

  return {
    accepted: true,
    state: {
      ...preview,
      market: {
        ...preview.market,
        hackingMovements: [...state.market.hackingMovements, ...appended],
        nextHackingMovementSequence: sequence,
      },
    },
  }
}

export function applyQualityDegradationImpact(
  state: CampaignState,
  runId: string,
): HackingMarketResult {
  return applyMovements(state, [{
    runId,
    cause: 'quality-degradation-impact',
    from: 'meridian',
    to: 'player',
    percentagePoints: 2,
  }])
}

export function applyQualityPartialRecovery(
  state: CampaignState,
  runId: string,
): HackingMarketResult {
  return applyMovements(state, [{
    runId,
    cause: 'quality-partial-recovery',
    from: 'player',
    to: 'meridian',
    percentagePoints: 1,
  }])
}

export function applyContaminatedRecoveryImpact(
  state: CampaignState,
  runId: string,
): HackingMarketResult {
  return applyMovements(state, [{
    runId,
    cause: 'contaminated-recovery',
    from: 'meridian',
    to: 'player',
    percentagePoints: 4,
  }])
}

const DEPENDENCY_MOVEMENTS = {
  'supplier-vector-db': {
    cause: 'dependency-vector-db',
    playerGain: 3,
    unservedGain: 2,
  },
  'supplier-tool-cache': {
    cause: 'dependency-tool-cache',
    playerGain: 5,
    unservedGain: 3,
  },
} as const satisfies Record<DependencyCutoffOptionId, {
  cause: HackingMarketMovementCause
  playerGain: number
  unservedGain: number
}>

export function applyDependencyCutoffOutcome(
  state: CampaignState,
  runId: string,
  optionId: DependencyCutoffOptionId,
): HackingMarketResult {
  const outcome = DEPENDENCY_MOVEMENTS[optionId]
  return applyMovements(state, [
    {
      runId,
      cause: outcome.cause,
      from: 'meridian',
      to: 'player',
      percentagePoints: outcome.playerGain,
    },
    {
      runId,
      cause: outcome.cause,
      from: 'meridian',
      to: 'unserved',
      percentagePoints: outcome.unservedGain,
    },
  ])
}

export function moveDeletedCompetitorShareToUnserved(
  state: CampaignState,
  runId: string,
  targetId: 'meridian' | 'tallow',
): HackingMarketResult {
  const index = competitorIndex(state, targetId)
  if (index < 0) return reject(state, 'COMPETITOR_NOT_FOUND')
  const percentagePoints = state.market.competitors[index].marketShare
  if (percentagePoints <= 0) return { accepted: true, state }
  return applyMovements(state, [{
    runId,
    cause: 'root-cutoff-delete',
    from: targetId,
    to: 'unserved',
    percentagePoints,
  }])
}

export function beginHackingInterception(
  state: CampaignState,
  input: BeginInterceptionInput,
): HackingMarketResult {
  const run = state.hackingCore.sabotage.runs.find(({ id }) => id === input.runId)
  if (
    !run
    || run.operationId !== 'request-interception'
    || run.phase !== 'active'
    || run.targetId !== input.targetId
    || run.routingShare !== input.routingShare
  ) {
    return reject(state, 'INTERCEPTION_NOT_ACTIVE')
  }
  if (state.market.hackingInterceptions[input.runId]) {
    return reject(state, 'INTERCEPTION_ALREADY_EXISTS')
  }
  if (competitorIndex(state, input.targetId) < 0) {
    return reject(state, 'COMPETITOR_NOT_FOUND')
  }

  const ledger: HackingInterceptionLedger = {
    ...input,
    active: true,
    startedOnServiceDay: state.serviceDay,
    lastAdvancedServiceDay: state.serviceDay,
    stoppedOnServiceDay: null,
    stoppedReason: null,
    cumulativePlayerGain: 0,
    exposure: 0,
  }
  return {
    accepted: true,
    state: {
      ...state,
      market: {
        ...state.market,
        hackingInterceptions: {
          ...state.market.hackingInterceptions,
          [input.runId]: ledger,
        },
      },
    },
  }
}

export function stopHackingInterception(
  state: CampaignState,
  runId: string,
): HackingMarketResult {
  const ledger = state.market.hackingInterceptions[runId]
  if (!ledger?.active) return reject(state, 'INTERCEPTION_NOT_ACTIVE')
  return {
    accepted: true,
    state: {
      ...state,
      market: {
        ...state.market,
        hackingInterceptions: {
          ...state.market.hackingInterceptions,
          [runId]: {
            ...ledger,
            active: false,
            stoppedOnServiceDay: state.serviceDay,
            stoppedReason: 'voluntary',
          },
        },
      },
    },
  }
}

export function advanceHackingInterceptions(state: CampaignState): CampaignState {
  let next = state
  let changed = false

  for (const runId of Object.keys(state.market.hackingInterceptions).sort()) {
    const ledger = next.market.hackingInterceptions[runId]
    if (!ledger.active || ledger.lastAdvancedServiceDay >= next.serviceDay) continue

    const targetIndex = competitorIndex(next, ledger.targetId)
    if (targetIndex < 0) continue
    const targetShare = next.market.competitors[targetIndex].marketShare
    const marketGain = Math.min(targetShare, Math.round(ledger.routingShare / 25))
    if (marketGain > 0) {
      const moved = applyMovements(next, [{
        runId,
        cause: 'request-interception',
        from: ledger.targetId,
        to: 'player',
        percentagePoints: marketGain,
      }])
      if (!moved.accepted) continue
      next = moved.state
    }

    const current = next.market.hackingInterceptions[runId]
    const exposure = roundShare(current.exposure + current.routingShare / 50)
    const stopped = exposure >= 4
    next = {
      ...next,
      market: {
        ...next.market,
        hackingInterceptions: {
          ...next.market.hackingInterceptions,
          [runId]: {
            ...current,
            active: !stopped,
            lastAdvancedServiceDay: next.serviceDay,
            stoppedOnServiceDay: stopped ? next.serviceDay : null,
            stoppedReason: stopped ? 'provider-key-rotation' : null,
            cumulativePlayerGain: roundShare(
              current.cumulativePlayerGain + marketGain,
            ),
            exposure,
          },
        },
      },
    }
    changed = true
  }

  return changed ? next : state
}
