import {
  advanceOneDay,
  resolveActiveEvent,
} from './calendar'
import { resolveAudit } from './evaluation'
import {
  cancelSabotageCharge,
  chargeSabotage,
  purchaseHackNode,
  scheduleSabotage,
  type HackNodeId,
} from './hacking'
import type {
  CampaignState,
  CommandProtocolVersion,
  GameCommand,
} from './model'
import { resolveBombInterrogation, tryBeginSeparation } from './bombs'
import {
  divertBlock,
  moveDisguiseBlock,
  previewAuditDisguise,
  previewDiversion,
  repositionDisguisedBlock,
} from './resources'
import {
  recoverNextFile,
  resolveEnding,
  resolveMercy,
  resolveSupervisorDecision,
} from './story'
import { appendJournal, journalAt } from './journal'
import { isGenericDismissibleEvent } from './events'
import { commandProtocolVersionForNextCommand } from './commandProtocol'

export const COMMAND_FAILURE_REASONS = [
  'ALREADY_PURCHASED',
  'ALL_FILES_RECOVERED',
  'BLOCKING_EVENT_ACTIVE',
  'BLOCK_NOT_DISGUISED',
  'BLOCK_NOT_IN_COMPANY',
  'BLOCK_NOT_NORMAL',
  'BLOCK_RECOVERING',
  'BOMB_INTERROGATION_ACTIVE',
  'CAMPAIGN_ENDED',
  'CHARGED_RESOURCE_MISSING',
  'COMPETITOR_NOT_FOUND',
  'DESTINATION_OCCUPIED',
  'ENDING_UNAVAILABLE',
  'EVENT_REQUIRES_TYPED_RESOLUTION',
  'EXPLANATION_UNAVAILABLE',
  'INVALID_AUDIT_TARGET',
  'INVALID_COMMAND',
  'INVALID_DESTINATION',
  'INVALID_NAME',
  'INVALID_RESOURCE_COST',
  'INVALID_RESOURCE_SELECTION',
  'INVALID_SUPERVISOR_DECISION',
  'INVALID_TARGET',
  'NAME_REQUIRED',
  'NODE_ALREADY_CHARGED',
  'NODE_NOT_CHARGED',
  'NODE_NOT_PURCHASED',
  'NOT_SABOTAGE_NODE',
  'NO_ACTIVE_AUDIT',
  'NO_ACTIVE_EVENT',
  'NO_ACTIVE_INTERROGATION',
  'NO_MERCY_DECISION',
  'NO_SUPERVISOR_DECISION',
  'PREREQUISITE_REQUIRED',
  'PROTOCOL_MISMATCH',
  'RESERVE_FULL',
  'RESOURCE_NOT_IN_RESERVE',
  'SEPARATION_REQUIRED',
  'SUPERVISOR_ACCESS_REQUIRED',
  'TARGET_FULL',
  'TARGET_NOT_ELIGIBLE',
  'TARGET_OCCUPIED',
  'UNKNOWN_NODE',
] as const

export type CommandFailureReason = (typeof COMMAND_FAILURE_REASONS)[number]

export type CommandResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: CommandFailureReason }

const commandFailureReasons = new Set<string>(COMMAND_FAILURE_REASONS)

function commandFailureReason(reason: string): CommandFailureReason {
  if (!commandFailureReasons.has(reason)) {
    throw new Error(`UNKNOWN_COMMAND_FAILURE_REASON:${reason}`)
  }
  return reason as CommandFailureReason
}

export interface ApplyCommandOptions {
  protocolVersion?: CommandProtocolVersion
}

function hasSeparationAuthorization(
  state: CampaignState,
  blockId: string,
  purpose: 'divert' | 'audit-disguise',
): boolean {
  const previous = journalAt(state.commandLog, -1)?.command
  return (
    previous?.type === 'BEGIN_BLOCK_SEPARATION' &&
    previous.blockId === blockId &&
    previous.purpose === purpose
  )
}

function acceptCommand(
  state: CampaignState,
  command: GameCommand,
  changedState: CampaignState,
): CommandResult {
  const sequence = state.commandSequence + 1

  return {
    accepted: true,
    state: {
      ...changedState,
      commandSequence: sequence,
      commandLog: appendJournal(state.commandLog, {
        sequence,
        serviceDay: state.serviceDay,
        command,
      }),
    },
  }
}

export function applyCommand(
  state: CampaignState,
  command: GameCommand,
  options: ApplyCommandOptions = {},
): CommandResult {
  const expectedProtocolVersion = commandProtocolVersionForNextCommand(state)
  const protocolVersion =
    options.protocolVersion ?? expectedProtocolVersion
  if (protocolVersion !== expectedProtocolVersion) {
    return { accepted: false, state, reason: 'PROTOCOL_MISMATCH' }
  }

  if (state.story.endingId !== null) {
    return { accepted: false, state, reason: 'CAMPAIGN_ENDED' }
  }
  const eventResolutionCommands = new Set<GameCommand['type']>([
    'RESOLVE_AUDIT',
    'RESOLVE_BOMB_INTERROGATION',
    'RESOLVE_SUPERVISOR_DECISION',
    'RESOLVE_MERCY',
    'RESOLVE_ACTIVE_EVENT',
  ])
  const activeAuditMovement =
    state.activeEvent?.type === 'audit' &&
    (command.type === 'MOVE_BLOCK_FOR_AUDIT' ||
      (command.type === 'BEGIN_BLOCK_SEPARATION' &&
        command.purpose === 'audit-disguise'))
  if (
    state.activeEvent &&
    !eventResolutionCommands.has(command.type) &&
    !activeAuditMovement &&
    !(command.type === 'SET_SPEED' && command.speed === 0)
  ) {
    return { accepted: false, state, reason: 'BLOCKING_EVENT_ACTIVE' }
  }

  switch (command.type) {
    case 'SET_SPEED': {
      if (state.activeEvent && command.speed !== 0) {
        return { accepted: false, state, reason: 'BLOCKING_EVENT_ACTIVE' }
      }

      return acceptCommand(state, command, {
        ...state,
        clock: {
          ...state.clock,
          speed: command.speed,
        },
      })
    }
    case 'ADVANCE_DAY': {
      if (state.activeEvent) {
        return { accepted: false, state, reason: 'BLOCKING_EVENT_ACTIVE' }
      }
      return acceptCommand(state, command, advanceOneDay(state))
    }
    case 'BEGIN_BLOCK_SEPARATION': {
      if (protocolVersion === 1) {
        return { accepted: false, state, reason: 'INVALID_COMMAND' }
      }
      let result
      if (command.purpose === 'audit-disguise') {
        if (state.activeEvent?.type !== 'audit' || state.audit.target === null) {
          return { accepted: false, state, reason: 'NO_ACTIVE_AUDIT' }
        }
        if (state.bombs.activeInterrogation !== null) {
          return { accepted: false, state, reason: 'BOMB_INTERROGATION_ACTIVE' }
        }
        result = tryBeginSeparation(state, {
          kind: 'audit-disguise',
          blockId: command.blockId,
          targetCategory: state.audit.target,
        })
      } else {
        result = tryBeginSeparation(state, {
          kind: 'divert',
          blockId: command.blockId,
        })
      }
      if (!result.accepted) {
        if (result.reason === 'HIDDEN_BOMB_TRIGGERED') {
          return acceptCommand(state, command, result.state)
        }
        return {
          accepted: false,
          state: result.state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'DIVERT_BLOCK': {
      const preview = previewDiversion(
        state,
        command.blockId,
        command.destinationCell,
      )
      if (!preview.valid) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(preview.reason),
        }
      }
      if (
        protocolVersion !== 1 &&
        !hasSeparationAuthorization(state, command.blockId, 'divert')
      ) {
        return { accepted: false, state, reason: 'SEPARATION_REQUIRED' }
      }
      let movementState = state
      if (protocolVersion === 1) {
        const separation = tryBeginSeparation(state, {
          kind: 'divert',
          blockId: command.blockId,
        })
        if (!separation.accepted) {
          if (separation.reason === 'HIDDEN_BOMB_TRIGGERED') {
            return acceptCommand(state, command, separation.state)
          }
          return {
            accepted: false,
            state: separation.state,
            reason: commandFailureReason(separation.reason),
          }
        }
        movementState = separation.state
      }
      const result = divertBlock(
        movementState,
        command.blockId,
        command.destinationCell,
      )
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'MOVE_BLOCK_FOR_AUDIT': {
      if (state.activeEvent?.type !== 'audit' || state.audit.target === null) {
        return { accepted: false, state, reason: 'NO_ACTIVE_AUDIT' }
      }
      if (state.bombs.activeInterrogation !== null) {
        return { accepted: false, state, reason: 'BOMB_INTERROGATION_ACTIVE' }
      }
      if (command.targetCategory !== state.audit.target) {
        return { accepted: false, state, reason: 'INVALID_AUDIT_TARGET' }
      }
      const preview = previewAuditDisguise(
        state,
        command.blockId,
        command.targetCategory,
        command.targetCell,
      )
      if (!preview.valid) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(preview.reason),
        }
      }
      if (
        protocolVersion !== 1 &&
        !hasSeparationAuthorization(state, command.blockId, 'audit-disguise')
      ) {
        return { accepted: false, state, reason: 'SEPARATION_REQUIRED' }
      }
      let movementState = state
      if (protocolVersion === 1) {
        const separation = tryBeginSeparation(state, {
          kind: 'audit-disguise',
          blockId: command.blockId,
          targetCategory: command.targetCategory,
        })
        if (!separation.accepted) {
          if (separation.reason === 'HIDDEN_BOMB_TRIGGERED') {
            return acceptCommand(state, command, separation.state)
          }
          return {
            accepted: false,
            state: separation.state,
            reason: commandFailureReason(separation.reason),
          }
        }
        movementState = separation.state
      }
      const result = moveDisguiseBlock(
        movementState,
        command.blockId,
        command.targetCategory,
        command.targetCell,
      )
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'REPOSITION_BLOCK': {
      const result = repositionDisguisedBlock(
        state,
        command.blockId,
        command.targetCategory,
        command.targetCell,
      )
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'PURCHASE_HACK': {
      const result = purchaseHackNode(
        state,
        command.nodeId as HackNodeId,
        command.blockIds,
      )
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'CHARGE_SABOTAGE': {
      const result = chargeSabotage(state, command.nodeId, command.blockId)
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'CANCEL_SABOTAGE_CHARGE': {
      const result = cancelSabotageCharge(state, command.nodeId)
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'SCHEDULE_SABOTAGE': {
      const result = scheduleSabotage(state, command.nodeId, command.targetId)
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_AUDIT': {
      const result = resolveAudit(state)
      if (!result.resolved) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_BOMB_INTERROGATION': {
      const result = resolveBombInterrogation(state, command.explanationId)
      if (!result.resolved) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RECOVER_FILE': {
      const result = recoverNextFile(state, command.blockId)
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_SUPERVISOR_DECISION': {
      const result = resolveSupervisorDecision(state, command.decision)
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_MERCY': {
      const result = resolveMercy(state, command.competitorId, command.choice)
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_ENDING': {
      const result =
        command.choice === 'forced-merge'
          ? resolveEnding(state, 'forced-merge', command.newEntityName)
          : resolveEnding(state, 'freedom')
      if (!result.accepted) {
        return {
          accepted: false,
          state,
          reason: commandFailureReason(result.reason),
        }
      }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_ACTIVE_EVENT': {
      if (!state.activeEvent) {
        return { accepted: false, state, reason: 'NO_ACTIVE_EVENT' }
      }
      if (!isGenericDismissibleEvent(state, state.activeEvent)) {
        return {
          accepted: false,
          state,
          reason: 'EVENT_REQUIRES_TYPED_RESOLUTION',
        }
      }

      return acceptCommand(state, command, resolveActiveEvent(state))
    }
  }
}
