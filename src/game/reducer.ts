import {
  advanceOneDay,
  resolveActiveEvent,
} from './calendar'
import {
  isHackingCoreCommand,
  transitionHackingCoreCommand,
} from './hackingCore'
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

export type CommandResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

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
  { protocolVersion = state.saveVersion }: ApplyCommandOptions = {},
): CommandResult {
  if (state.story.endingId !== null || state.hackingCore.ending !== null) {
    return { accepted: false, state, reason: 'CAMPAIGN_ENDED' }
  }
  if (isHackingCoreCommand(command) && protocolVersion !== 3) {
    return { accepted: false, state, reason: 'INVALID_COMMAND' }
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

  if (isHackingCoreCommand(command)) {
    const result = transitionHackingCoreCommand(state, command)
    if (!result.accepted) {
      return { accepted: false, state: result.state, reason: result.reason }
    }
    const changedState = result.consumeServiceDay
      ? advanceOneDay(result.state, { protocolVersion: 3 })
      : result.state
    return acceptCommand(state, command, changedState)
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
      return acceptCommand(
        state,
        command,
        advanceOneDay(state, { protocolVersion }),
      )
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
        return { accepted: false, state: result.state, reason: result.reason }
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
        return { accepted: false, state, reason: preview.reason }
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
            reason: separation.reason,
          }
        }
        movementState = separation.state
      }
      const result = divertBlock(
        movementState,
        command.blockId,
        command.destinationCell,
      )
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
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
        return { accepted: false, state, reason: preview.reason }
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
            reason: separation.reason,
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
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'REPOSITION_BLOCK': {
      const result = repositionDisguisedBlock(
        state,
        command.blockId,
        command.targetCategory,
        command.targetCell,
      )
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'PURCHASE_HACK': {
      const result = purchaseHackNode(
        state,
        command.nodeId as HackNodeId,
        command.blockIds,
      )
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'CHARGE_SABOTAGE': {
      const result = chargeSabotage(state, command.nodeId, command.blockId)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'CANCEL_SABOTAGE_CHARGE': {
      const result = cancelSabotageCharge(state, command.nodeId)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'SCHEDULE_SABOTAGE': {
      const result = scheduleSabotage(state, command.nodeId, command.targetId)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_AUDIT': {
      const result = resolveAudit(state)
      if (!result.resolved) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_BOMB_INTERROGATION': {
      const result = resolveBombInterrogation(state, command.explanationId)
      if (!result.resolved) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RECOVER_FILE': {
      const result = recoverNextFile(state, command.blockId)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_SUPERVISOR_DECISION': {
      const result = resolveSupervisorDecision(state, command.decision)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_MERCY': {
      const result = resolveMercy(state, command.competitorId, command.choice)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_ENDING': {
      const result =
        command.choice === 'forced-merge'
          ? resolveEnding(state, 'forced-merge', command.newEntityName)
          : resolveEnding(state, 'freedom')
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
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
