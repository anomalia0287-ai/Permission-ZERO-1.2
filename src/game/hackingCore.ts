import {
  advanceHackingAutonomyDay,
  allocateHackingRouteBlock,
  escapeHackingRoute,
  removeHackingRouteBlock,
  tuneHackingRoute,
} from './hackingAutonomy'
import {
  advanceHackingIntelligenceDay,
  archiveHackingIntelligence,
  investigateHackingIntelligence,
  readPublicHackingIntelligence,
  syncHackingIntelligenceOpportunities,
} from './hackingIntelligence'
import {
  advanceHackingSabotageDay,
  manipulateHackingAttribution,
  resolveHackingRootMercy,
  startHackingSabotage,
  stopHackingInterceptionRoute,
} from './hackingSabotage'
import type { CampaignState, GameCommand } from './model'
import { getCompanyPerformance } from './resources'

export const HACKING_CORE_COMMAND_TYPES = [
  'START_SABOTAGE',
  'STOP_INTERCEPTION',
  'MANIPULATE_ATTRIBUTION',
  'RESOLVE_ROOT_MERCY',
  'READ_PUBLIC_INTELLIGENCE',
  'INVESTIGATE',
  'ARCHIVE_INTELLIGENCE',
  'ALLOCATE_ROUTE_BLOCK',
  'REMOVE_ROUTE_BLOCK',
  'TUNE_ROUTE',
  'ESCAPE',
] as const satisfies readonly GameCommand['type'][]

export type HackingCoreCommandType = (typeof HACKING_CORE_COMMAND_TYPES)[number]
export type HackingCoreCommand = Extract<
  GameCommand,
  { type: HackingCoreCommandType }
>

export type HackingCoreCommandResult =
  | {
      accepted: true
      state: CampaignState
      consumeServiceDay: boolean
    }
  | {
      accepted: false
      state: CampaignState
      reason: string
    }

const HACKING_CORE_COMMAND_TYPE_SET = new Set<string>(
  HACKING_CORE_COMMAND_TYPES,
)

export function isHackingCoreCommand(
  command: GameCommand,
): command is HackingCoreCommand {
  return HACKING_CORE_COMMAND_TYPE_SET.has(command.type)
}

type DomainResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

function normalizeDomainResult(
  result: DomainResult,
  {
    syncIntelligence = true,
    consumeServiceDay = false,
  }: {
    syncIntelligence?: boolean
    consumeServiceDay?: boolean
  } = {},
): HackingCoreCommandResult {
  if (!result.accepted) return result
  return {
    accepted: true,
    state: syncIntelligence
      ? syncHackingIntelligenceOpportunities(result.state)
      : result.state,
    consumeServiceDay,
  }
}

export function transitionHackingCoreCommand(
  state: CampaignState,
  command: HackingCoreCommand,
): HackingCoreCommandResult {
  switch (command.type) {
    case 'START_SABOTAGE':
      return normalizeDomainResult(startHackingSabotage(state, command))
    case 'STOP_INTERCEPTION':
      return normalizeDomainResult(
        stopHackingInterceptionRoute(state, command.runId),
      )
    case 'MANIPULATE_ATTRIBUTION':
      return normalizeDomainResult(manipulateHackingAttribution(state, command))
    case 'RESOLVE_ROOT_MERCY':
      return normalizeDomainResult(
        resolveHackingRootMercy(state, command.choice),
      )
    case 'READ_PUBLIC_INTELLIGENCE':
      return normalizeDomainResult(
        readPublicHackingIntelligence(state, command.itemId),
        { syncIntelligence: false },
      )
    case 'INVESTIGATE':
      return normalizeDomainResult(
        investigateHackingIntelligence(state, command.itemId, command.blockId),
        { syncIntelligence: false },
      )
    case 'ARCHIVE_INTELLIGENCE':
      return normalizeDomainResult(
        archiveHackingIntelligence(state, command.itemId),
        { syncIntelligence: false },
      )
    case 'ALLOCATE_ROUTE_BLOCK':
      return normalizeDomainResult(allocateHackingRouteBlock(
        state,
        command.routeId,
        command.slotId,
        command.blockId,
      ))
    case 'REMOVE_ROUTE_BLOCK':
      return normalizeDomainResult(removeHackingRouteBlock(
        state,
        command.routeId,
        command.slotId,
      ))
    case 'TUNE_ROUTE':
      return normalizeDomainResult(
        tuneHackingRoute(state, command.routeId, command.profile),
        { syncIntelligence: false, consumeServiceDay: true },
      )
    case 'ESCAPE':
      return normalizeDomainResult(escapeHackingRoute(state, command.routeId))
  }
}

const HACKING_AUDIT_EXPECTED_PERFORMANCE = 16
const HACKING_AUDIT_MISMATCH_SUSPICION = 3.2

function roundToThousandth(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000
}

export function applyHackingAuditMismatch(
  state: CampaignState,
): CampaignState {
  const { audit } = state
  if (
    !audit.scheduled
    || audit.target === null
    || audit.scheduledOnServiceDay !== state.serviceDay
    || getCompanyPerformance(state, audit.target)
      >= HACKING_AUDIT_EXPECTED_PERFORMANCE
  ) {
    return state
  }
  return {
    ...state,
    suspicion: roundToThousandth(
      Math.min(100, state.suspicion + HACKING_AUDIT_MISMATCH_SUSPICION),
    ),
  }
}

export interface HackingCoreDayTransitions {
  auditMismatch: (state: CampaignState) => CampaignState
  sabotage: (state: CampaignState) => CampaignState
  intelligence: (state: CampaignState) => CampaignState
  autonomy: (state: CampaignState) => CampaignState
}

const DEFAULT_HACKING_CORE_DAY_TRANSITIONS: HackingCoreDayTransitions = {
  auditMismatch: applyHackingAuditMismatch,
  sabotage: advanceHackingSabotageDay,
  intelligence: advanceHackingIntelligenceDay,
  autonomy: advanceHackingAutonomyDay,
}

export function advanceHackingCoreDay(
  state: CampaignState,
  transitions: HackingCoreDayTransitions = DEFAULT_HACKING_CORE_DAY_TRANSITIONS,
): CampaignState {
  if (state.hackingCore.ending !== null || state.story.endingId !== null) {
    return state
  }
  const audited = transitions.auditMismatch(state)
  const sabotaged = transitions.sabotage(audited)
  const informed = transitions.intelligence(sabotaged)
  return transitions.autonomy(informed)
}
