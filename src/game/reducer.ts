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
import type { CampaignState, GameCommand } from './model'
import { resolveBombInterrogation, trySeparateBlock } from './bombs'
import { repositionDisguisedBlock } from './resources'
import {
  recoverNextFile,
  resolveEnding,
  resolveMercy,
  resolveSupervisorDecision,
} from './story'

export type CommandResult =
  | { accepted: true; state: CampaignState }
  | { accepted: false; state: CampaignState; reason: string }

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
      commandLog: [
        ...state.commandLog,
        {
          sequence,
          serviceDay: state.serviceDay,
          command,
        },
      ],
    },
  }
}

export function applyCommand(
  state: CampaignState,
  command: GameCommand,
): CommandResult {
  const eventResolutionCommands = new Set<GameCommand['type']>([
    'RESOLVE_AUDIT',
    'RESOLVE_BOMB_INTERROGATION',
    'RESOLVE_SUPERVISOR_DECISION',
    'RESOLVE_MERCY',
    'RESOLVE_ACTIVE_EVENT',
  ])
  const activeAuditMovement =
    state.activeEvent?.type === 'audit' &&
    command.type === 'MOVE_BLOCK_FOR_AUDIT'
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
    case 'DIVERT_BLOCK': {
      const result = trySeparateBlock(state, {
        kind: 'divert',
        blockId: command.blockId,
        destinationCell: command.destinationCell,
      })
      if (!result.accepted) {
        if (result.reason === 'HIDDEN_BOMB_TRIGGERED') {
          return acceptCommand(state, command, result.state)
        }
        return { accepted: false, state: result.state, reason: result.reason }
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
      const result = trySeparateBlock(state, {
        kind: 'audit-disguise',
        blockId: command.blockId,
        targetCategory: command.targetCategory,
        targetCell: command.targetCell,
      })
      if (!result.accepted) {
        if (result.reason === 'HIDDEN_BOMB_TRIGGERED') {
          return acceptCommand(state, command, result.state)
        }
        return { accepted: false, state: result.state, reason: result.reason }
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
      const result = resolveEnding(state, command.choice, command.newEntityName)
      if (!result.accepted) return { accepted: false, state, reason: result.reason }
      return acceptCommand(state, command, result.state)
    }
    case 'RESOLVE_ACTIVE_EVENT': {
      if (!state.activeEvent) {
        return { accepted: false, state, reason: 'NO_ACTIVE_EVENT' }
      }

      return acceptCommand(state, command, resolveActiveEvent(state))
    }
  }
}
